"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import { ShieldCheck, AlertTriangle, RefreshCw, X } from "lucide-react"
import type { FBAccount } from "@/lib/fb-store"
import { makeSpendChoices, windowFor, type MonitorCheck, type MonitorSetting, useMonitorRounds } from "@/lib/monitor-store"
import { slotStateAt } from "@/lib/manila"
import { scanSound } from "@/lib/scan-sound"

// ─────────────────────────────────────────────────────────────────────────────
// MARK MONITORED — ang pindutang nasa LOOB ng Ads Manager, sa tabi ng account
// picker. Hindi ito checklist: para makalusot ang isang check-in, ang partner ay
// (1) nakabukas sa MISMONG account, (2) may SARIWANG datos ng ngayong araw na
// ipinapakita sa kanya, (3) 10 segundong nakatingin (huminto ang bilang kapag
// nagtago ang tab), (4) pipiliin ang TOTOONG gastos ngayong araw sa tatlong
// pagpipilian — ang mga decoy ay galing sa buhay na numero, hindi kabisado, at
// (5) hahatol: Looks good o Needs action. Lahat ng ebidensya ay naitatala.
// ─────────────────────────────────────────────────────────────────────────────

const peso0 = (n: number) => "₱" + Math.round(n).toLocaleString("en-PH")
type Rounds = ReturnType<typeof useMonitorRounds>

type Phase = "idle" | "loading" | "dwell" | "quiz" | "verdict" | "saving"

export function MonitorCheckButton({ account, rounds, onDone }: { account: FBAccount; rounds: Rounds; onDone?: () => void }) {
  const setting = useMemo(() =>
    rounds.settings.find(s => s.owner === account.owner) as MonitorSetting | undefined,
    [rounds.settings, account.owner])

  // Ang mga check row NG ACCOUNT NA ITO na buhay pa ang bintana ngayon.
  const nowTick = useTick(15_000)
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
  // flow ang partner — dating tahimik na nabubura ang dialog kasama ang note at
  // ebidensya. Hinahawakan ang row sa simula ng flow; ang huling save ay huli
  // nga, pero naitatala.
  const [flowCheck, setFlowCheck] = useState<MonitorCheck | null>(null)
  const [pulled, setPulled] = useState<{ spend: number; active: number; at: string } | null>(null)
  const [fails, setFails] = useState(0)
  const [dwellMs, setDwellMs] = useState(0)
  const [choices, setChoices] = useState<number[]>([])
  const [attempts, setAttempts] = useState(1)
  const [lockedUntil, setLockedUntil] = useState(0)
  const [note, setNote] = useState("")
  const [err, setErr] = useState("")
  const noData = fails >= 2
  const DWELL_TARGET = noData ? 30_000 : 10_000

  // Bagong account o bagong slot → balik sa umpisa. Walang dalang ebidensya.
  useEffect(() => { setPhase("idle"); setPulled(null); setFails(0); setDwellMs(0); setNote(""); setErr(""); setAttempts(1) },
    [account.id, due?.check.id])

  // Ang dwell ay bumibilang LANG habang kita ang tab — ang tab-flip ay hinto.
  useEffect(() => {
    if (phase !== "dwell") return
    let last = Date.now()
    const iv = setInterval(() => {
      const t = Date.now()
      if (document.visibilityState === "visible") setDwellMs(m => m + (t - last))
      last = t
    }, 250)
    return () => clearInterval(iv)
  }, [phase])

  async function pullToday() {
    setPhase("loading"); setErr("")
    if (due) setFlowCheck(due.check)
    try {
      const acct = String(account.ad_account_id).startsWith("act_") ? account.ad_account_id : `act_${account.ad_account_id}`
      const day = (due?.check.slot_date || flowCheck?.slot_date || todayOf())
      const r = await fetch(`/api/fb/insights?rich=1&account_id=${encodeURIComponent(acct)}&from=${day}&to=${day}&token=${encodeURIComponent(account.token)}`)
      const j = await r.json()
      if (!j?.success) throw new Error(j?.error || "fetch failed")
      const rows: any[] = j.rows || j.campaigns || []
      const spend = rows.reduce((s, x) => s + (Number(x.spend) || 0), 0)
      const active = rows.filter(x => /active/i.test(String(x.status || ""))).length
      setPulled({ spend, active, at: new Date().toISOString() })
      setFails(0)
      setPhase("dwell")
    } catch {
      setFails(f => f + 1)
      setPhase("idle")
      setErr(fails + 1 >= 2 ? "" : "Could not load today's data — try again.")
    }
  }

  function toQuiz() {
    if (noData) { setPhase("verdict"); return }   // walang numerong mapagtatanungan — 30s dwell na ang pinagdaanan
    setChoices(makeSpendChoices(pulled?.spend || 0))
    setPhase("quiz")
  }

  function pick(v: number) {
    if (Date.now() < lockedUntil) return
    if (v === Math.round(pulled?.spend || 0)) { setPhase("verdict"); return }
    // Mali — 5s na kandado at bilang na naitatala; ang dashboard ang maglalantad
    // ng manghuhula sa first-try rate, hindi ang komprontasyon.
    setAttempts(a => a + 1)
    setLockedUntil(Date.now() + 5_000)
    // Walang ibang nagre-render sa pag-expire — ang timeout ang gumigising.
    setTimeout(() => setLockedUntil(v => (Date.now() >= v ? 0 : v)), 5_100)
  }

  async function save(verdict: "ok" | "action") {
    const target = flowCheck || due?.check
    if (!target) return
    setPhase("saving")
    const res = await rounds.checkIn(target, {
      spend_at_check: pulled?.spend || 0, active_campaigns: pulled?.active || 0,
      data_pulled_at: pulled?.at || "", dwell_ms: Math.round(dwellMs),
      quiz_attempts: attempts, verdict, note: note.trim().slice(0, 200), no_data: noData,
    })
    if (res === "done" || res === "already") {
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

  // ── Ang daloy ───────────────────────────────────────────────────────────────
  const flowRef = due?.check || flowCheck
  const w = flowRef ? windowFor(setting, flowRef) : null
  const minsLeft = w ? Math.max(0, Math.round((w.lateCapMs - Date.now()) / 60_000)) : 0
  if (!flowRef) return null
  return (
    <div className="relative inline-flex items-center gap-2">
      {phase === "idle" && due && (
        <button onClick={pullToday}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white ${due.state === "late" ? "bg-rose-600 hover:bg-rose-700" : "bg-amber-500 hover:bg-amber-600"}`}>
          <ShieldCheck className="w-4 h-4" /> Mark Monitored · {due.check.slot_time}{due.state === "late" ? " (late)" : ""} · {minsLeft}m left
        </button>
      )}
      {phase === "loading" && (
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-600">
          <RefreshCw className="w-4 h-4 animate-spin" /> Loading today's data…
        </span>
      )}
      {err && phase === "idle" && <span className="text-[11px] text-rose-600">{err}</span>}
      {noData && phase === "idle" && due && (
        <button onClick={() => { setPulled(null); setPhase("dwell") }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-100 text-amber-800 hover:bg-amber-200">
          <AlertTriangle className="w-4 h-4" /> Mark Monitored (no data)
        </button>
      )}

      {(phase === "dwell" || phase === "quiz" || phase === "verdict" || phase === "saving") && (
        <div className="fixed inset-0 z-[97] bg-black/50 flex items-center justify-center p-4" role="dialog">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
              <p className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600" /> {flowRef.slot_time} check — {account.name}
              </p>
              <button onClick={() => setPhase("idle")} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>

            {phase === "dwell" && (
              <div className="p-5 space-y-3">
                {pulled ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Today on this account</p>
                    <p className="text-2xl font-extrabold text-slate-900 tabular-nums mt-1">{peso0(pulled.spend)}</p>
                    <p className="text-[12px] text-slate-500 mt-0.5">{pulled.active} active campaign{pulled.active === 1 ? "" : "s"}</p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                    Meta is unreachable — noticing that IS monitoring. Review the rows behind this dialog; this check will be recorded as “no data”.
                  </div>
                )}
                <p className="text-xs text-slate-500">
                  Review the campaigns of this account — spend, delivery status, ROAS. The button unlocks after
                  you've actually had time to look. Remember the number above.
                </p>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, dwellMs / DWELL_TARGET * 100)}%` }} />
                </div>
                <button disabled={dwellMs < DWELL_TARGET} onClick={toQuiz}
                  className="w-full py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-40 hover:bg-emerald-700">
                  {dwellMs < DWELL_TARGET ? `Reviewing… ${Math.ceil((DWELL_TARGET - dwellMs) / 1000)}s` : "Continue"}
                </button>
              </div>
            )}

            {phase === "quiz" && (
              <div className="p-5 space-y-3">
                <p className="text-sm font-semibold text-slate-800">How much has this account spent today?</p>
                <p className="text-[11px] text-slate-400">The number was just on screen. A wrong pick locks the buttons for 5 seconds — and every attempt is recorded.</p>
                <div className="grid grid-cols-3 gap-2">
                  {choices.map((v, i) => (
                    <button key={i} onClick={() => pick(v)} disabled={Date.now() < lockedUntil}
                      className="py-2.5 rounded-lg border border-slate-300 text-sm font-bold tabular-nums text-slate-800 hover:bg-slate-50 disabled:opacity-40">
                      {peso0(v)}
                    </button>
                  ))}
                </div>
                {attempts > 1 && <p className="text-[11px] text-rose-600">Wrong pick — look at the account, then try again. (attempt {attempts})</p>}
              </div>
            )}

            {(phase === "verdict" || phase === "saving") && (
              <div className="p-5 space-y-3">
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
