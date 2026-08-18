"use client"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ClipboardList, Plus, X, Pencil, Trash2, Check, Undo2, Send, Gift, Target, UserPlus, MailWarning,
  AlertTriangle, RefreshCw, Trophy, CheckCircle2, Hourglass,
} from "lucide-react"
import type { FBAccount } from "@/lib/fb-store"
import { VAT, usePageRts } from "@/lib/scaling-signals"
import { whoAmI, rosterEmailByName, type Me } from "@/lib/notify"
import {
  usePartnerTasks, deadlineInfo, badgeCount, monthKey, todayStr,
  type PartnerTask, type TaskStatus,
} from "@/lib/partner-tasks-store"
import { Skeleton } from "@/components/ui/dash"
import { useErpUsers, type ErpUser } from "@/lib/users-store"

// ─────────────────────────────────────────────────────────────────────────────
// PARTNER TASKS — trabaho kada media buyer, may deadline at premyo, at ang
// target ng buwan na sinusukat sa TUNAY na resulta ng ads.
//
// ⚠ WALANG INIMBENTONG NUMERO. Ang "actual" sa targets ay ang kabuuang
// purchase value at net ROAS ng mga ad account NG PARTNER NA IYON ngayong
// buwan, hinihila sa parehong /api/fb/insights na ginagamit ng Dashboard —
// hindi tinatayang numero, hindi mano-manong inilagay.
// ─────────────────────────────────────────────────────────────────────────────

const peso = (n: number) => "₱" + (isFinite(n) ? n : 0).toLocaleString("en-PH", { maximumFractionDigits: 0 })
const dec = (n: number) => (isFinite(n) ? n : 0).toFixed(2)
const actId = (s: string) => String(s).startsWith("act_") ? String(s) : `act_${s}`

// MTD kada account — module cache para hindi na humihila muli sa bawat balik
// sa tab (parehong padron ng MGR_CACHE / MODEL_CACHE).
type MtdPart = { spend: number; value: number; purchases: number }
const MTD_CACHE = new Map<string, { ts: number; part: MtdPart }>()
const MTD_INFLIGHT = new Map<string, Promise<MtdPart | null>>()
const MTD_TTL = 30 * 60_000

async function mapLimit<T>(items: T[], limit: number, fn: (i: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++])
  }))
}

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("") || "?"

/**
 * Sino sa roster ang may kinalaman sa ads.
 *
 * ⚠ PADRON, HINDI EKSAKTONG STRING — kagaya ng `WAREHOUSE_POSITION_RE`. Ang
 * Position ay FREE TEXT sa User Management, kaya "Advertiser / Partners",
 * "advertiser", "Partners", "Marketing", "Digital Marketing" at "MARKETING"
 * ay iisa ang ibig sabihin. Ang eksaktong pagtutugma ay mahuhuli ng dobleng
 * espasyo o ibang casing, at tahimik na mawawala ang tao sa listahan.
 */
export const ADS_POSITION_RE = /marketing|advertis|partner/i

const STATUS_META: Record<TaskStatus, { title: string; chip: string; col: string }> = {
  open: { title: "To do", chip: "bg-blue-50 text-blue-700", col: "border-blue-400" },
  review: { title: "For review", chip: "bg-amber-50 text-amber-700", col: "border-amber-400" },
  done: { title: "Done", chip: "bg-emerald-50 text-emerald-700", col: "border-emerald-500" },
}
const DEADLINE_TONE: Record<string, string> = {
  ok: "bg-slate-100 text-slate-600",
  soon: "bg-amber-50 text-amber-700",
  late: "bg-rose-50 text-rose-700",
  none: "bg-slate-100 text-slate-500",
}

export function PartnerTasks({ accounts, onSignals }: {
  accounts: FBAccount[]
  onSignals?: (n: number) => void
}) {
  const store = usePartnerTasks()
  const [me, setMe] = useState<Me>({ email: "", name: "", mother: false, position: "" })
  useEffect(() => { setMe(whoAmI()) }, [])
  const isAdmin = me.mother

  const live = useMemo(() => accounts.filter(a => !a.archived && a.token && a.ad_account_id), [accounts])
  const roster = useErpUsers()

  // ── SINO ANG PWEDENG BIGYAN NG TASK ───────────────────────────────────────
  // MARKETING at ADVERTISERS / PARTNERS LANG — hatol ng may-ari, Ago 18 2026.
  // Ang tab na ito ay nasa loob ng Facebook Ads: ang upseller, warehouse staff,
  // HR at delivering ay may account sa PesoWise pero walang trabaho rito, kaya
  // ang paglabas nila sa picker ay ingay na maaaring mauwi sa maling pagtatalaga.
  //
  // Ang PARTNER ay may ad account: siya lang ang may target sales/ROAS, dahil
  // siya lang ang may gastos na masusukat. Ang MARKETING ay tumatanggap ng
  // task, pero walang target — walang numerong pagbabatayan sa kanya.
  const partnerNames = useMemo(() => Array.from(new Set(
    live.map(a => a.owner).filter(Boolean))).sort(), [live])

  type Assignee = { name: string; email: string; role: string; partner: boolean }
  const assignees = useMemo<Assignee[]>(() => {
    const byName = new Map<string, Assignee>()
    const put = (name: string, email: string, role: string, partner: boolean) => {
      const key = name.trim()
      if (!key) return
      const prev = byName.get(key)
      // Ang partner-ness at ang email ay dinadagdag, hindi pinapalitan ng blangko.
      byName.set(key, {
        name: key,
        email: email || prev?.email || '',
        role: role || prev?.role || '',
        partner: partner || prev?.partner || false,
      })
    }
    // ⚠ ANG MAY AD ACCOUNT AY LAGING PAPASOK, kahit ano ang nakasulat na
    // position. Si Larry ay may tatlong ad account at BLANGKO ang position
    // niya sa roster (nasukat Ago 18 2026) — kung position lang ang batayan,
    // mawawala ang isang tunay na partner. Ang hawak na ad account ang
    // katunayan; ang position ay teksto lang na maaaring hindi napunan.
    for (const o of partnerNames) put(o, rosterEmailByName(o), 'Advertiser / Partners', true)
    for (const u of roster.users as ErpUser[]) {
      // Ang umalis na ay hindi na binibigyan ng bagong trabaho.
      if (u.status !== 'Active' || u.deleteAt) continue
      if (!ADS_POSITION_RE.test(u.position || '')) continue
      put((u.full_name || u.username || '').trim(), (u.email || '').toLowerCase(), u.position || '', false)
    }
    // Ang may lumang task/target ay nananatili sa listahan kahit inalis na ang
    // account niya — kung hindi, mauulila ang hilera nila sa board.
    for (const t of store.tasks) put(t.owner, rosterEmailByName(t.owner), '', false)
    for (const t of store.targets) put(t.owner, rosterEmailByName(t.owner), '', true)

    // ── IISANG TAO, IISANG CHIP ───────────────────────────────────────────────
    // ⚠ Ang isang tao ay maaaring may DALAWANG PANGALAN dito: ang nakalagay sa
    // ad account ("Eugene Andaya") at ang nasa roster ("Eugene Noval Andaya").
    // Dalawang chip iyon para sa iisang tao, at ang mali ang pipiliin mo ay
    // mapupunta sa pangalang hindi tugma sa ad accounts niya.
    //
    // Ang EMAIL ang tunay na pagkakakilanlan, kaya doon pinagsasama. At ang
    // PANGALANG MAY AD ACCOUNT ang pinapanatili — doon naka-key ang `ownerAgg`
    // at ang mga target, kaya ang ibang pangalan ay maglalaho ang mga numero.
    const byEmail = new Map<string, Assignee>()
    const out: Assignee[] = []
    for (const a of byName.values()) {
      if (!a.email) { out.push(a); continue }
      const prev = byEmail.get(a.email)
      if (!prev) { byEmail.set(a.email, a); out.push(a); continue }
      // Pagsamahin: manalo ang may ad account; panatilihin ang alam nating role.
      prev.partner = prev.partner || a.partner
      prev.role = prev.role || a.role
      if (a.partner && !partnerNames.includes(prev.name)) prev.name = a.name
    }
    return out.sort((a, b) =>
      (a.partner === b.partner ? 0 : a.partner ? -1 : 1) || a.name.localeCompare(b.name))
  }, [partnerNames, roster.users, store.tasks, store.targets])

  // Ang TARGETS ay para sa may ad account lang — ang iba ay walang spend na
  // masusukat, kaya ang target sales/ROAS ay walang kahulugan sa kanila.
  const owners = useMemo(() => Array.from(new Set([
    ...partnerNames,
    ...store.targets.map(t => t.owner),
  ])).sort(), [partnerNames, store.targets])

  // ── AKTUWAL NG BUWAN kada account → kada owner ─────────────────────────────
  const month = monthKey()
  const monthStart = `${month}-01`
  const today = todayStr()
  const [mtdByAcct, setMtdByAcct] = useState<Record<string, MtdPart & { owner: string; pageName: string }>>({})
  const [mtdLoading, setMtdLoading] = useState(true)
  const liveKey = useMemo(() => live.map(a => a.id).sort().join(","), [live])
  const rtsMap = usePageRts(live)

  useEffect(() => {
    if (live.length === 0) { setMtdLoading(false); return }
    let cancelled = false
    ;(async () => {
      const out: Record<string, MtdPart & { owner: string; pageName: string }> = {}
      const paint = () => { if (!cancelled) setMtdByAcct({ ...out }) }
      let anyMiss = false
      await mapLimit(live, 3, async a => {
        const key = `${a.id}|${month}`
        const hit = MTD_CACHE.get(key)
        if (hit && Date.now() - hit.ts < MTD_TTL) {
          out[a.id] = { ...hit.part, owner: a.owner || "", pageName: a.page_name || "" }; paint(); return
        }
        anyMiss = true
        let run = MTD_INFLIGHT.get(key)
        if (!run) {
          run = (async () => {
            try {
              const q = `token=${encodeURIComponent(a.token)}&account_id=${encodeURIComponent(actId(a.ad_account_id))}&from=${monthStart}&to=${today}`
              const rc = await fetch(`/api/fb/insights?rich=1&${q}`).then(r => r.json())
              if (!rc.success) return null
              const part: MtdPart = { spend: 0, value: 0, purchases: 0 }
              for (const c of rc.campaigns || []) {
                part.spend += Number(c.spend || 0)
                part.value += Number(c.purchaseValue || 0)
                part.purchases += Number(c.purchases || 0)
              }
              MTD_CACHE.set(key, { ts: Date.now(), part })
              return part
            } catch { return null }
          })()
          MTD_INFLIGHT.set(key, run)
          run.finally(() => MTD_INFLIGHT.delete(key))
        }
        const part = await run
        if (part) { out[a.id] = { ...part, owner: a.owner || "", pageName: a.page_name || "" }; paint() }
      })
      if (!cancelled) { setMtdByAcct({ ...out }); setMtdLoading(false) }
      void anyMiss
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey, month])

  // Kada owner: Σ spend, Σ value, at net ROAS na TIMBANG KADA ACCOUNT —
  // value×(1−RTS ng page ng account na iyon), tapos ÷ (Σspend × VAT). Ito ang
  // parehong house math ng Dashboard/Tracker, pinagsama lang sa antas ng owner.
  const ownerAgg = useMemo(() => {
    const m: Record<string, { spend: number; value: number; valueNet: number; purchases: number }> = {}
    for (const part of Object.values(mtdByAcct)) {
      const o = part.owner || "—"
      const rts = rtsMap.get(part.pageName) ?? 0
      if (!m[o]) m[o] = { spend: 0, value: 0, valueNet: 0, purchases: 0 }
      m[o].spend += part.spend; m[o].value += part.value
      m[o].valueNet += part.value * (1 - rts); m[o].purchases += part.purchases
    }
    return m
  }, [mtdByAcct, rtsMap])

  // ── Ang bilang sa tab ──────────────────────────────────────────────────────
  const badge = useMemo(() => badgeCount(store.tasks, me, rosterEmailByName), [store.tasks, me])
  useEffect(() => { onSignals?.(badge) }, [badge, onSignals])

  const mine = useCallback((t: PartnerTask) =>
    rosterEmailByName(t.owner) === me.email || t.owner.trim().toLowerCase() === me.name,
    [me])

  // ── Mga salaan ─────────────────────────────────────────────────────────────
  const [fOwner, setFOwner] = useState("All")
  const filtered = useMemo(() =>
    fOwner === "All" ? store.tasks : store.tasks.filter(t => t.owner === fOwner),
    [store.tasks, fOwner])

  const byStatus = useMemo(() => {
    const openT = filtered.filter(t => t.status === "open")
      // Overdue muna, tapos pinakamalapit na deadline; ang walang deadline sa dulo.
      .sort((a, b) => (a.deadline || "9999") < (b.deadline || "9999") ? -1 : 1)
    const review = filtered.filter(t => t.status === "review")
      .sort((a, b) => (a.submitted_at || "").localeCompare(b.submitted_at || ""))
    const done = filtered.filter(t => t.status === "done")
      .sort((a, b) => (b.done_at || "").localeCompare(a.done_at || ""))
    return { open: openT, review, done }
  }, [filtered])

  const overdueCount = useMemo(() =>
    filtered.filter(t => t.status !== "done" && t.deadline && t.deadline < today).length,
    [filtered, today])
  const doneThisMonth = useMemo(() =>
    filtered.filter(t => t.status === "done" && (t.done_at || "").slice(0, 7) === month).length,
    [filtered, month])

  // ── Mga modal ──────────────────────────────────────────────────────────────
  const [taskModal, setTaskModal] = useState<{ edit?: PartnerTask } | null>(null)
  const [targetModal, setTargetModal] = useState<string | null>(null)   // owner
  const [busy, setBusy] = useState(false)
  const [showAllDone, setShowAllDone] = useState(false)

  const targetOf = (owner: string) => store.targets.find(t => t.owner === owner)

  // ── UI ─────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {store.error && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-[13px] text-amber-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{store.error}</span>
        </div>
      )}

      {/* Summary — ang "dashboard sa loob": tapos / hindi pa / naghihintay. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {[
          { label: "To do", n: byStatus.open.length, icon: ClipboardList, tone: "text-blue-600 bg-blue-50" },
          { label: "For review", n: byStatus.review.length, icon: Hourglass, tone: "text-amber-600 bg-amber-50" },
          { label: "Done this month", n: doneThisMonth, icon: CheckCircle2, tone: "text-emerald-600 bg-emerald-50" },
          { label: "Overdue", n: overdueCount, icon: AlertTriangle, tone: overdueCount > 0 ? "text-rose-600 bg-rose-50" : "text-slate-500 bg-slate-100" },
        ].map((s, i) => (
          <div key={s.label} className="pw-rise bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3"
            style={{ ["--d" as any]: `${i * 45}ms` }}>
            <span className={`grid place-items-center w-9 h-9 rounded-lg shrink-0 ${s.tone}`}>
              <s.icon className="w-4.5 h-4.5 w-[18px] h-[18px]" />
            </span>
            <span className="min-w-0">
              <span className="block text-xl font-bold text-slate-900 leading-none tabular-nums">{store.loaded ? s.n : "…"}</span>
              <span className="block text-[11px] text-slate-500 font-semibold uppercase tracking-wide truncate">{s.label}</span>
            </span>
          </div>
        ))}
      </div>

      {/* ── MONTHLY TARGETS ────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
            <Target className="w-4 h-4 text-blue-600" /> Monthly targets — {month}
          </p>
          <span className="text-[11px] text-slate-400">actuals are live from Meta · sales = purchase value MTD · ROAS is net (after RTS, ÷1.12)</span>
          {mtdLoading && <RefreshCw className="w-3 h-3 animate-spin text-slate-400" />}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {owners.map((o, i) => {
            const tgt = targetOf(o)
            const act = ownerAgg[o]
            const salesPct = tgt && tgt.target_sales > 0 && act ? Math.min(100, (act.value / tgt.target_sales) * 100) : 0
            const netRoas = act && act.spend > 0 ? act.valueNet / (act.spend * VAT) : 0
            const roasOk = tgt && tgt.target_roas > 0 ? (netRoas >= tgt.target_roas ? "hit" : netRoas >= tgt.target_roas * 0.9 ? "near" : "off") : ""
            const salesHit = !!tgt && tgt.target_sales > 0 && !!act && act.value >= tgt.target_sales
            return (
              <div key={o} className="pw-rise bg-white border border-slate-200 rounded-xl p-3.5 space-y-2.5"
                style={{ ["--d" as any]: `${i * 45}ms` }}>
                <div className="flex items-center gap-2.5">
                  <span className="grid place-items-center w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-[11px] font-bold shrink-0">
                    {initials(o)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-slate-800 truncate">{o}</span>
                    <span className="block text-[11px] text-slate-400">
                      {act ? `${act.purchases} purchases · spend ${peso(act.spend)}` : mtdLoading ? "pulling this month…" : "no spend this month"}
                    </span>
                  </span>
                  {salesHit && roasOk !== "off" && <Trophy className="w-4 h-4 text-amber-500 shrink-0" />}
                  {isAdmin && (
                    <button onClick={() => setTargetModal(o)} title="Set this month's targets"
                      className="text-[11px] font-semibold px-2 py-1 rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-blue-600 shrink-0">
                      {tgt ? "Edit" : "Set targets"}
                    </button>
                  )}
                </div>
                {/* Sales laban sa target — progress bar, hindi lang numero. */}
                {tgt && tgt.target_sales > 0 ? (
                  <div className="space-y-1">
                    <div className="flex items-baseline justify-between text-[12px]">
                      <span className="text-slate-600 font-medium">Sales</span>
                      <span className="tabular-nums">
                        <b className="text-slate-800">{act ? peso(act.value) : "—"}</b>
                        <span className="text-slate-400"> / {peso(tgt.target_sales)}</span>
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className={`h-full rounded-full transition-[width] duration-500 ease-out ${salesHit ? "bg-emerald-500" : "bg-blue-500"}`}
                        style={{ width: `${salesPct}%` }} />
                    </div>
                    <p className="text-[11px] text-slate-400">
                      {salesHit ? "Target hit 🎉" : act ? `${peso(Math.max(0, tgt.target_sales - act.value))} to go` : ""}
                    </p>
                  </div>
                ) : (
                  <p className="text-[12px] text-slate-400 italic">No sales target set{isAdmin ? " — click Set targets" : ""}.</p>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  {tgt && tgt.target_roas > 0 && (
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                      roasOk === "hit" ? "bg-emerald-100 text-emerald-800"
                        : roasOk === "near" ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-700"}`}>
                      Net ROAS {dec(netRoas)} / {dec(tgt.target_roas)}
                    </span>
                  )}
                  {tgt?.reward && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 flex items-center gap-1">
                      <Gift className="w-3 h-3" /> {tgt.reward}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
          {owners.length === 0 && (
            <p className="text-sm text-slate-400 italic">No partners yet — owners come from your registered ad accounts.</p>
          )}
        </div>
      </div>

      {/* ── TASK BOARD ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
          <ClipboardList className="w-4 h-4 text-blue-600" /> Tasks
        </p>
        <select value={fOwner} onChange={e => setFOwner(e.target.value)}
          className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[12px] text-slate-600">
          <option value="All">Everyone</option>
          {assignees.map(a => <option key={a.name} value={a.name}>{a.name}</option>)}
        </select>
        {isAdmin && (
          <button onClick={() => setTaskModal({})}
            className="ml-auto flex items-center gap-1.5 h-8 px-3 rounded-lg bg-blue-600 text-white text-[12px] font-semibold hover:bg-blue-700 active:scale-95 transition">
            <Plus className="w-3.5 h-3.5" /> New task
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {(["open", "review", "done"] as TaskStatus[]).map(st => {
          const meta = STATUS_META[st]
          const list = st === "done" && !showAllDone ? byStatus.done.slice(0, 8) : byStatus[st]
          return (
            <div key={st} className={`bg-slate-50 rounded-xl border border-slate-200 border-t-2 ${meta.col} p-2.5 space-y-2`}>
              <p className="text-[12px] font-bold text-slate-600 uppercase tracking-wide px-1 flex items-center justify-between">
                {meta.title}
                <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-white border border-slate-200 text-slate-500 tabular-nums">
                  {byStatus[st].length}
                </span>
              </p>
              {!store.loaded && <Skeleton className="h-16 w-full text-slate-400" />}
              {store.loaded && byStatus[st].length === 0 && (
                <p className="text-[12px] text-slate-400 italic px-1 py-3">
                  {st === "open" ? "Nothing to do." : st === "review" ? "Nothing waiting for review." : "Nothing done yet."}
                </p>
              )}
              {list.map((t, i) => {
                const dl = deadlineInfo(t.deadline, t.status, today)
                return (
                  <div key={t.id} className="pw-rise bg-white rounded-lg border border-slate-200 p-3 space-y-1.5 shadow-sm"
                    style={{ ["--d" as any]: `${Math.min(i, 8) * 35}ms` }}>
                    <div className="flex items-start gap-2">
                      <span className="grid place-items-center w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-[9px] font-bold shrink-0 mt-0.5"
                        title={t.owner}>
                        {initials(t.owner)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[13px] font-semibold leading-snug ${st === "done" ? "text-slate-500" : "text-slate-800"}`}>{t.title}</span>
                        {t.details && <span className="block text-[11px] text-slate-500 leading-snug mt-0.5 line-clamp-2">{t.details}</span>}
                      </span>
                      {isAdmin && (
                        <span className="flex items-center gap-0.5 shrink-0">
                          <button onClick={() => setTaskModal({ edit: t })} title="Edit"
                            className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-slate-50"><Pencil className="w-3 h-3" /></button>
                          <button onClick={() => { if (confirm(`Delete task "${t.title}"?`)) store.deleteTask(t.id) }} title="Delete"
                            className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-slate-50"><Trash2 className="w-3 h-3" /></button>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${DEADLINE_TONE[dl.tone]}`}>{dl.label}</span>
                      {t.reward && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex items-center gap-1 ${
                          st === "done" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                          <Gift className="w-2.5 h-2.5" /> {st === "done" ? `Earned: ${t.reward}` : t.reward}
                        </span>
                      )}
                      {st === "done" && t.approved_by && (
                        <span className="text-[10px] text-slate-400">by {t.approved_by} · {(t.done_at || "").slice(0, 10)}</span>
                      )}
                      {st === "review" && (
                        <span className="text-[10px] text-slate-400">submitted {(t.submitted_at || "").slice(0, 10)}</span>
                      )}
                    </div>
                    {/* Mga aksyon: partner → Mark as done; may-ari → Approve / Return. */}
                    {(st !== "done") && (
                      <div className="flex items-center gap-1.5 pt-0.5">
                        {st === "open" && mine(t) && !isAdmin && (
                          <button onClick={() => store.submitTask(t)} disabled={busy}
                            className="text-[11px] font-semibold flex items-center gap-1 px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 active:scale-95 transition">
                            <Send className="w-3 h-3" /> Mark as done
                          </button>
                        )}
                        {st === "open" && !mine(t) && !isAdmin && (
                          <span className="text-[10px] text-slate-400 italic">Assigned to {t.owner}</span>
                        )}
                        {st === "review" && !isAdmin && mine(t) && (
                          <span className="text-[10px] text-amber-600 font-medium">Waiting for the owner&apos;s review…</span>
                        )}
                        {isAdmin && (
                          <>
                            <button onClick={() => { setBusy(true); store.approveTask(t).finally(() => setBusy(false)) }} disabled={busy}
                              title={t.reward ? `Approve — grants: ${t.reward}` : "Approve"}
                              className="text-[11px] font-semibold flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95 transition disabled:opacity-50">
                              <Check className="w-3 h-3" /> {st === "review" ? "Approve" : "Complete"}
                            </button>
                            {st === "review" && (
                              <button onClick={() => { setBusy(true); store.returnTask(t).finally(() => setBusy(false)) }} disabled={busy}
                                className="text-[11px] font-semibold flex items-center gap-1 px-2 py-1 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50 active:scale-95 transition disabled:opacity-50">
                                <Undo2 className="w-3 h-3" /> Return
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              {st === "done" && byStatus.done.length > 8 && !showAllDone && (
                <button onClick={() => setShowAllDone(true)}
                  className="w-full text-[11px] font-semibold text-slate-500 hover:text-blue-600 py-1">
                  Show all {byStatus.done.length} done →
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* ── MODALS ─────────────────────────────────────────────────────────── */}
      {taskModal && (
        <TaskModal
          edit={taskModal.edit}
          assignees={assignees}
          busy={busy}
          onClose={() => setTaskModal(null)}
          onSave={async (v) => {
            setBusy(true)
            const err = taskModal.edit
              ? (await store.updateTask(taskModal.edit.id, { title: v.title, details: v.details, owner: v.owners[0], deadline: v.deadline, reward: v.reward }), "")
              : await store.createTasks(v)
            setBusy(false)
            if (err) alert(err); else setTaskModal(null)
          }} />
      )}
      {targetModal && (
        <TargetModal
          owner={targetModal}
          month={month}
          existing={targetOf(targetModal)}
          busy={busy}
          onClose={() => setTargetModal(null)}
          onSave={async (v) => {
            setBusy(true)
            const err = await store.setTarget(targetModal, v)
            setBusy(false)
            if (err) alert(err); else setTargetModal(null)
          }} />
      )}
    </div>
  )
}

// ── Modal ng task: bago (multi-partner) o pag-edit (isang partner) ───────────
function TaskModal({ edit, assignees, busy, onClose, onSave }: {
  edit?: PartnerTask
  assignees: { name: string; email: string; role: string; partner: boolean }[]
  busy: boolean
  onClose: () => void
  onSave: (v: { title: string; details: string; owners: string[]; deadline: string; reward: string }) => void
}) {
  const [title, setTitle] = useState(edit?.title || "")
  const [details, setDetails] = useState(edit?.details || "")
  const [sel, setSel] = useState<Set<string>>(new Set(edit ? [edit.owner] : []))
  const [deadline, setDeadline] = useState(edit?.deadline || "")
  const [reward, setReward] = useState(edit?.reward || "")
  const toggle = (o: string) => setSel(prev => {
    if (edit) return new Set([o])   // sa edit, isa lang ang may-ari ng task
    const n = new Set(prev); n.has(o) ? n.delete(o) : n.add(o); return n
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-3"
      onClick={onClose}>
      <div className="pw-rise bg-white rounded-xl shadow-2xl ring-1 ring-black/5 w-full max-w-md flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-800">{edit ? "Edit task" : "New task"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-3 text-sm">
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Task</span>
            <input value={title} onChange={e => setTitle(e.target.value)} autoFocus
              placeholder="e.g. Launch 5 new creatives for Cystcare"
              className="mt-1 w-full h-9 rounded-lg border border-slate-200 px-3" />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Details <span className="normal-case font-normal">(optional)</span></span>
            <textarea value={details} onChange={e => setDetails(e.target.value)} rows={2}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 resize-none" />
          </label>
          {/* ⚠ DALAWANG PANGKAT, IISANG LISTAHAN. Ang PARTNERS ay may ad
              account (sila lang ang may target sales/ROAS); ang MARKETING ay
              tumatanggap ng task pero walang target — walang gastos na
              masusukat sa kanya. Ang iba pang tauhan (upseller, warehouse,
              HR, delivering) ay wala rito: walang trabaho sa loob ng Ads.
              Ang walang company email ay MAAARI PA RING atasan, pero
              hayagang sinasabi na hindi siya makakatanggap ng abiso —
              mas mabuting malaman mo iyon bago mag-assign kaysa magtaka
              kung bakit walang kumikilos. */}
          {(["partner", "marketing"] as const).map(group => {
            const list = assignees.filter(a => group === "partner" ? a.partner : !a.partner)
            if (list.length === 0) return null
            return (
              <div key={group}>
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                  {group === "partner"
                    ? (edit ? "Advertisers / Partners" : "Advertisers / Partners — one task each")
                    : (edit ? "Marketing" : "Marketing — one task each")}
                </span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {list.map(a => (
                    <button key={a.name} onClick={() => toggle(a.name)}
                      title={[a.role, a.email || "no company email — will not be notified"].filter(Boolean).join(" · ")}
                      className={`text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border transition flex items-center gap-1.5 ${
                        sel.has(a.name) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:border-slate-300"}`}>
                      {a.name}
                      {!a.email && <MailWarning className="w-3 h-3 text-amber-500 shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
          {[...sel].some(n => !assignees.find(a => a.name === n)?.email) && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
              <MailWarning className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>Someone selected has no company email in User Management, so they will see the task on this board but get no notification.</span>
            </p>
          )}
          {/* Ang pagdagdag ng tao ay nasa User Management — doon ang buong
              porma (company email, position, permissions). Hindi natin iyon
              inuulit dito; itinuturo lang. */}
          <a href="/business/users" target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-blue-600 hover:text-blue-700">
            <UserPlus className="w-3.5 h-3.5" /> Add someone in User Management →
          </a>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Deadline</span>
              <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)}
                className="mt-1 w-full h-9 rounded-lg border border-slate-200 px-2" />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Reward <span className="normal-case font-normal">(optional)</span></span>
              <input value={reward} onChange={e => setReward(e.target.value)} placeholder="e.g. ₱500 GCash"
                className="mt-1 w-full h-9 rounded-lg border border-slate-200 px-3" />
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50">
          <button onClick={onClose} className="h-9 px-4 rounded-lg border border-slate-300 text-sm font-semibold text-slate-600 hover:bg-white">Cancel</button>
          <button disabled={busy || !title.trim() || sel.size === 0}
            onClick={() => onSave({ title, details, owners: [...sel], deadline, reward })}
            className="h-9 px-4 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
            {busy ? "Saving…" : edit ? "Save" : sel.size > 1 ? `Assign to ${sel.size} partners` : "Assign"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal ng target ng buwan ─────────────────────────────────────────────────
function TargetModal({ owner, month, existing, busy, onClose, onSave }: {
  owner: string
  month: string
  existing?: { target_sales: number; target_roas: number; reward: string }
  busy: boolean
  onClose: () => void
  onSave: (v: { target_sales: number; target_roas: number; reward: string }) => void
}) {
  const [sales, setSales] = useState(existing?.target_sales ? String(existing.target_sales) : "")
  const [roas, setRoas] = useState(existing?.target_roas ? String(existing.target_roas) : "")
  const [reward, setReward] = useState(existing?.reward || "")

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-3"
      onClick={onClose}>
      <div className="pw-rise bg-white rounded-xl shadow-2xl ring-1 ring-black/5 w-full max-w-sm overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
            <Target className="w-4 h-4 text-blue-600" /> {owner} — {month}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-3 text-sm">
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Target sales (purchase value, ₱)</span>
            <input type="number" min="0" value={sales} onChange={e => setSales(e.target.value)} placeholder="e.g. 150000"
              className="mt-1 w-full h-9 rounded-lg border border-slate-200 px-3 tabular-nums" />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Target net ROAS</span>
            <input type="number" min="0" step="0.1" value={roas} onChange={e => setRoas(e.target.value)} placeholder="e.g. 3.9"
              className="mt-1 w-full h-9 rounded-lg border border-slate-200 px-3 tabular-nums" />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Reward for hitting it <span className="normal-case font-normal">(optional)</span></span>
            <input value={reward} onChange={e => setReward(e.target.value)} placeholder="e.g. ₱2,000 bonus"
              className="mt-1 w-full h-9 rounded-lg border border-slate-200 px-3" />
          </label>
          <p className="text-[11px] text-slate-400 leading-snug">
            Actuals are pulled live from Meta for this partner&apos;s ad accounts — sales is month-to-date purchase value; ROAS is net (after the page&apos;s RTS rate, ÷ 1.12 VAT), the same math as Testing/Scaling.
          </p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50">
          <button onClick={onClose} className="h-9 px-4 rounded-lg border border-slate-300 text-sm font-semibold text-slate-600 hover:bg-white">Cancel</button>
          <button disabled={busy}
            onClick={() => onSave({ target_sales: Number(sales) || 0, target_roas: Number(roas) || 0, reward })}
            className="h-9 px-4 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
            {busy ? "Saving…" : "Save targets"}
          </button>
        </div>
      </div>
    </div>
  )
}
