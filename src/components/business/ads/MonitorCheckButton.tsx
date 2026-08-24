"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import { ShieldCheck, AlertTriangle, RefreshCw, X } from "lucide-react"
import type { FBAccount } from "@/lib/fb-store"
import { makeSpendChoices, windowFor, type MonitorCheck, type MonitorSetting, useMonitorRounds } from "@/lib/monitor-store"
import { slotStateAt } from "@/lib/manila"
import { scanSound } from "@/lib/scan-sound"

// ─────────────────────────────────────────────────────────────────────────────
// MARK MONITORED — ang pindutang nasa LOOB ng Ads Manager, sa tabi ng account
// picker. Hindi ito checklist, at HINDI RIN ipinapakita ang sagot:
//
//   1. Sa sandaling BUKSAN ang account na bahagi ng round, kusang umaandar ang
//      1 MINUTONG review timer SA BACKGROUND (hatol ng may-ari, Ago 24 2026) —
//      hindi sa popup: doon mismo sa tunay na talahanayan sila tumitingin.
//      Bumibilang lang habang kita ang tab AT ang account na ito ang nakabukas;
//      ang paglipat ay pag-hinto, ang pagbalik ay pagpapatuloy.
//   2. Naka-DISABLE ang pindutan hangga't hindi tapos ang minuto — may kitang
//      countdown, para hindi basta mapindot agad.
//   3. Ang pindot ay DIRETSO SA TANONG: "magkano ang gastos ngayong araw?" —
//      tatlong pagpipilian, at WALANG lugar na nagpapakita ng numero bago nito
//      (tinanggal ang dating "Today on this account ₱X" — sagot na iyon; pati
//      ang ₱ sa round popup, tinanggal — iniulat ng may-ari na nakikita agad).
//   4. Mali ang sagot = 15 SEGUNDONG kandado na may countdown, at naitatala ang
//      bawat pagtatangka (ang first-try rate sa dashboard ang lumalantad).
//   5. Hatol (Looks good / Needs action) → tapos. Lahat ng ebidensya naitatala.
// ─────────────────────────────────────────────────────────────────────────────

const peso0 = (n: number) => "₱" + Math.round(n).toLocaleString("en-PH")
type Rounds = ReturnType<typeof useMonitorRounds>

type Phase = "idle" | "loading" | "quiz" | "verdict" | "saving"
const REVIEW_TARGET = 60_000     // 1 minuto ng tunay na pagtingin bago mag-unlock
const WRONG_LOCK_MS = 15_000     // kandado kada maling sagot

// ⚠ MODULE-LEVEL ang naipong review time kada check row: ang paglipat-lipat ng
// account (normal sa isang round) ay hindi dapat magpa-zero ng progreso — ang
// component ay nagre-remount kada palit ng account.
const REVIEW_MS = new Map<string, number>()

export function MonitorCheckButton({ account, rounds, onDone }: { account: FBAccount; rounds: Rounds; onDone?: () => void }) {
  const setting = useMemo(() =>
    rounds.settings.find(s => s.owner === account.owner) as MonitorSetting | undefined,
    [rounds.settings, account.owner])

  // Ang mga check row NG ACCOUNT NA ITO na buhay pa ang bintana ngayon.
  const nowTick = useTick(1_000)
  const live = useMemo(() => {
    void nowTick
    const out: { check: MonitorCheck; state: "open" | "late" | "done" | "missed" }[] = []
    for (const c of rounds.checks) {
      if (c.account_id !== account.id) continue
      const w = windowFor(setting, c)
      if (!w) continue
      const s = slotStateAt(w)
      if (c.checked_at) { if (s !== "missed" || c.slot_date === todayOf()) out.push({ check: c, state: "done" }) }
      else if (s === "open" || s === "late") out.push({ check: c, state: s })
      else if (s === "missed" && c.slot_date === todayOf()) out.push({ check: c, state: "missed" })
    }
    return out.sort((a, b) => (b.check.slot_time).localeCompare(a.check.slot_time))
  }, [rounds.checks, account.id, setting, nowTick])

  const due = live.find(x => x.state === "open" || x.state === "late")
  const latest = live[0]

  const [phase, setPhase] = useState<Phase>("idle")
  // ⚠ Ang `due` ay nawawala kapag lumampas ang bintana HABANG nasa gitna ng
  // flow — hawak ang row para maitala pa rin ang huling save (huli, pero totoo).
  const [flowCheck, setFlowCheck] = useState<MonitorCheck | null>(null)
  const [pulled, setPulled] = useState<{ spend: number; active: number; at: string } | null>(null)
  const [fails, setFails] = useState(0)
  const [reviewMs, setReviewMs] = useState(0)
  const [choices, setChoices] = useState<number[]>([])
  const [attempts, setAttempts] = useState(1)
  const [lockedUntil, setLockedUntil] = useState(0)
  const [note, setNote] = useState("")
  const [err, setErr] = useState("")
  const noData = fails >= 2

  // Bagong account/slot → sariwang daloy (ang naipong review ay nasa REVIEW_MS).
  useEffect(() => {
    setPhase("idle"); setPulled(null); setFails(0); setNote(""); setErr(""); setAttempts(1)
    setReviewMs(due ? (REVIEW_MS.get(due.check.id) || 0) : 0)
  }, [account.id, due?.check.id])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── ANG BACKGROUND TIMER: umaandar sa sandaling BUKAS ang account na ito ────
  // Walang popup — ang partner ay malayang tumitingin sa tunay na talahanayan
  // habang bumibilang ito. Kita lang ang tab = bumibilang; hinto kapag hindi.
  useEffect(() => {
    if (!due || due.check.checked_at) return
    const key = due.check.id
    let last = Date.now()
    const iv = setInterval(() => {
      const t = Date.now()
      if (document.visibilityState === "visible") {
        const cur = Math.min(REVIEW_TARGET, (REVIEW_MS.get(key) || 0) + (t - last))
        REVIEW_MS.set(key, cur)
        setReviewMs(cur)
      }
      last = t
    }, 250)
    return () => clearInterval(iv)
  }, [due?.check.id, due?.check.checked_at])   // eslint-disable-line react-hooks/exhaustive-deps

  const reviewDone = reviewMs >= REVIEW_TARGET

  // Ang pindot: hilahin ang ebidensya (hindi ipinapakita!) → diretso sa tanong.
  async function startQuiz() {
    if (!due || !reviewDone) return
    setFlowCheck(due.check)
    setPhase("loading"); setErr("")
    try {
      const acct = String(account.ad_account_id).startsWith("act_") ? account.ad_account_id : `act_${account.ad_account_id}`
      const day = due.check.slot_date || todayOf()
      const r = await fetch(`/api/fb/insights?rich=1&account_id=${encodeURIComponent(acct)}&from=${day}&to=${day}&token=${encodeURIComponent(account.token)}`)
      const j = await r.json()
      if (!j?.success) throw new Error(j?.error || "fetch failed")
      const rows: any[] = j.rows || j.campaigns || []
      const spend = rows.reduce((s, x) => s + (Number(x.spend) || 0), 0)
      const active = rows.filter(x => /active/i.test(String(x.status || ""))).length
      setPulled({ spend, active, at: new Date().toISOString() })
      setFails(0)
      setChoices(makeSpendChoices(spend))
      setPhase("quiz")
    } catch {
      setFails(f => f + 1)
      setPhase("idle")
      setErr(fails + 1 >= 2 ? "" : "Could not load the account's data — try again.")
    }
  }

  function pick(v: number) {
    if (Date.now() < lockedUntil) return
    if (v === Math.round(pulled?.spend || 0)) { setPhase("verdict"); return }
    // Mali — 15 segundong kandado na may countdown, at bilang na naitatala.
    setAttempts(a => a + 1)
    setLockedUntil(Date.now() + WRONG_LOCK_MS)
  }

  async function save(verdict: "ok" | "action") {
    const target = flowCheck || due?.check
    if (!target) return
    setPhase("saving")
    const res = await rounds.checkIn(target, {
      spend_at_check: pulled?.spend || 0, active_campaigns: pulled?.active || 0,
      data_pulled_at: pulled?.at || "", dwell_ms: Math.round(REVIEW_MS.get(target.id) || reviewMs),
      quiz_attempts: attempts, verdict, note: note.trim().slice(0, 200), no_data: noData,
    })
    if (res === "done" || res === "already") {
      REVIEW_MS.delete(target.id)
      scanSound("ok")
      setPhase("idle")
      setFlowCheck(null)
      onDone?.()   // diretso sa susunod na account ng round
    } else { setErr(String(res)); setPhase("verdict") }
  }

  if (rounds.migrationNeeded || !setting || !latest) return null

  // ── Chip ────────────────────────────────────────────────────────────────────
  if (!due && phase === "idle") {
    const c = latest.check
    if (latest.state === "done") return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 whitespace-nowrap">
        <ShieldCheck className="w-3.5 h-3.5" /> Monitored ✓ {hm(c.checked_server_at || c.checked_at)}{c.checked_by_name ? ` · ${c.checked_by_name}` : ""}
      </span>
    )
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 whitespace-nowrap">
        <AlertTriangle className="w-3.5 h-3.5" /> Missed {c.slot_time}
      </span>
    )
  }

  const flowRef = due?.check || flowCheck
  if (!flowRef) return null
  const w = windowFor(setting, flowRef)
  const minsLeft = w ? Math.max(0, Math.round((w.lateCapMs - Date.now()) / 60_000)) : 0
  const secsToUnlock = Math.ceil(Math.max(0, REVIEW_TARGET - reviewMs) / 1000)
  const lockSecs = Math.ceil(Math.max(0, lockedUntil - Date.now()) / 1000)

  return (
    <div className="relative inline-flex items-center gap-2">
      {phase === "idle" && due && !reviewDone && (
        // Umaandar pa ang minuto — kita ang countdown, hindi mapipindot.
        <span className="relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-500 overflow-hidden whitespace-nowrap" title="Review this account's campaigns — the button unlocks after a full minute of looking.">
          <span className="absolute inset-y-0 left-0 bg-emerald-100" style={{ width: `${Math.min(100, reviewMs / REVIEW_TARGET * 100)}%` }} />
          <ShieldCheck className="w-4 h-4 relative" />
          <span className="relative">Reviewing… {secsToUnlock}s · {due.check.slot_time}</span>
        </span>
      )}
      {phase === "idle" && due && reviewDone && !noData && (
        <button onClick={startQuiz}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white whitespace-nowrap ${due.state === "late" ? "bg-rose-600 hover:bg-rose-700" : "bg-amber-500 hover:bg-amber-600"}`}>
          <ShieldCheck className="w-4 h-4" /> Mark Monitored · {due.check.slot_time}{due.state === "late" ? " (late)" : ""} · {minsLeft}m left
        </button>
      )}
      {phase === "idle" && due && reviewDone && noData && (
        <button onClick={() => { setFlowCheck(due.check); setPhase("verdict") }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-100 text-amber-800 hover:bg-amber-200 whitespace-nowrap"
          title="Meta is unreachable — noticing that IS monitoring; this check is recorded as no-data.">
          <AlertTriangle className="w-4 h-4" /> Mark Monitored (no data)
        </button>
      )}
      {phase === "loading" && (
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-600 whitespace-nowrap">
          <RefreshCw className="w-4 h-4 animate-spin" /> Preparing…
        </span>
      )}
      {err && phase === "idle" && <span className="text-[11px] text-rose-600">{err}</span>}

      {(phase === "quiz" || phase === "verdict" || phase === "saving") && (
        <div className="fixed inset-0 z-[97] bg-black/50 flex items-center justify-center p-4" role="dialog">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
              <p className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600" /> {flowRef.slot_time} check — {account.name}
              </p>
              <button onClick={() => setPhase("idle")} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>

            {phase === "quiz" && (
              <div className="p-5 space-y-3">
                <p className="text-sm font-semibold text-slate-800">How much has this account spent today?</p>
                <p className="text-[11px] text-slate-400">
                  You just spent a minute in this account — the answer is in what you reviewed. A wrong pick
                  locks the buttons for 15 seconds, and every attempt is recorded.
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {choices.map((v, i) => (
                    <button key={i} onClick={() => pick(v)} disabled={lockSecs > 0}
                      className="py-2.5 rounded-lg border border-slate-300 text-sm font-bold tabular-nums text-slate-800 hover:bg-slate-50 disabled:opacity-40">
                      {peso0(v)}
                    </button>
                  ))}
                </div>
                {lockSecs > 0 && <p className="text-[11px] text-rose-600 font-semibold">Wrong — locked for {lockSecs}s. Go look at the account, then try again. (attempt {attempts})</p>}
                {lockSecs === 0 && attempts > 1 && <p className="text-[11px] text-rose-600">Unlocked — look first, then pick. (attempt {attempts})</p>}
              </div>
            )}

            {(phase === "verdict" || phase === "saving") && (
              <div className="p-5 space-y-3">
                {noData && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
                    Meta is unreachable — this check is recorded as “no data”. Noticing the outage IS monitoring.
                  </div>
                )}
                <p className="text-sm font-semibold text-slate-800">Verdict for this account?</p>
                <input value={note} onChange={e => setNote(e.target.value)} placeholder="Optional note (e.g. CPP rising on campaign X)"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" maxLength={200} />
                {err && <p className="text-[11px] text-rose-600">⚠ {err} — retrying is safe.</p>}
                <div className="grid grid-cols-2 gap-2">
                  <button disabled={phase === "saving"} onClick={() => save("ok")}
                    className="py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-50">
                    {phase === "saving" ? "Saving…" : "Looks good ✓"}
                  </button>
                  <button disabled={phase === "saving"} onClick={() => save("action")}
                    className="py-2.5 rounded-lg bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 disabled:opacity-50">
                    Needs action ⚠
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function useTick(ms: number) {
  const [t, setT] = useState(0)
  const ref = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => { ref.current = setInterval(() => setT(x => x + 1), ms); return () => { if (ref.current) clearInterval(ref.current) } }, [ms])
  return t
}
const todayOf = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
const hm = (iso: string) => {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t + 8 * 3600_000).toISOString().slice(11, 16) : ""
}
