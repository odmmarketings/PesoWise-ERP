"use client"
// Telemarketing — REPORTS (docs/telemarketing-spec.md §5 monthly daily-performance table,
// §20 report contents, §22 today-vs-yesterday, §6 targets).
//
// Phase 2 scope only: the monthly Daily Report + a ready-to-send Report Preview.
// Scheduled sending and Discord delivery are Phase 3 — Settings owns that config and this
// page only READS it (never renders the webhook URL) plus a manual "Copy as text".
// All figures come from tm_sales / tm_calls via telemarketing-store; Cancelled sales are
// excluded everywhere through activeSales().
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  FileText, RefreshCw, ShoppingCart, Wallet, Layers, Sigma, TrendingUp, TrendingDown,
  Target, Percent, Copy, Check, AlertTriangle, CalendarClock, Webhook,
} from "lucide-react"
import { StatCardsSkeleton, TableSkeleton } from "@/components/business/Skeleton"
import {
  useTmSales, useTmCalls, useTmAgents, useTmTargets, useTmSettings,
  computeTmKpis, activeSales, remainingWorkingDays, requiredDailyPace,
  nowTimeStr, todayStr, thisMonthStr,
} from "@/lib/telemarketing-store"

// ────────────────────────────────────────────────────────────────────────────
// Local helpers (page-local peso, per UI conventions)
// ────────────────────────────────────────────────────────────────────────────
const peso = (n: number) => "₱" + (isFinite(n) ? n : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (n: number) => (isFinite(n) ? n : 0).toLocaleString("en-PH")
const pct = (n: number) => `${(isFinite(n) ? n : 0).toFixed(1)}%`
const pad2 = (n: number) => String(n).padStart(2, "0")

const WD_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"]

// Store convention: sale_date / call_date are written with todayStr() (UTC slice) — match it.
const yesterdayStr = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10)

/** Real number of days in a "YYYY-MM" month — handles February + leap years. */
function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number)
  if (!y || !m) return 30
  return new Date(y, m, 0).getDate()
}
function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number)
  return y && m ? `${MONTH_NAMES[m - 1]} ${y}` : month
}
function dateLabel(d: string): string {
  const [y, m, dd] = d.split("-").map(Number)
  return y && m && dd ? `${MONTH_NAMES[m - 1]} ${dd}, ${y}` : d
}
/** "09:00" → "9:00 AM" */
function fmt12(t: string): string {
  const [h, mi] = t.split(":").map(Number)
  if (!Number.isFinite(h)) return t
  return `${h % 12 === 0 ? 12 : h % 12}:${pad2(Number.isFinite(mi) ? mi : 0)} ${h >= 12 ? "PM" : "AM"}`
}
const achClass = (p: number) => p >= 100 ? "text-emerald-600" : p >= 70 ? "text-amber-600" : "text-red-600"

const VIEWS = ["Daily Report", "Report Preview"] as const
type View = typeof VIEWS[number]

const SEL = "h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-100"

// ────────────────────────────────────────────────────────────────────────────
// Computed shapes
// ────────────────────────────────────────────────────────────────────────────
interface DayRow {
  date: string; day: number; wd: number
  upOrders: number; upAmt: number; crossOrders: number; crossAmt: number
  totalOrders: number; totalSales: number
  target: number | null            // null = no target expectation (rest day / no target row)
  remaining: number | null
  achievement: number | null
  workDay: boolean; isToday: boolean; isFuture: boolean
}

interface AgentRow {
  id: string; name: string
  upOrders: number; upAmt: number; crossOrders: number; crossAmt: number
  totalOrders: number; totalSales: number
  calls: number; connected: number
  conversion: number
  achievement: number | null
}

interface DayFig {
  upOrders: number; upAmt: number; crossOrders: number; crossAmt: number
  orders: number; sales: number
}

interface TeamBlock {
  upOrders: number; upAmt: number; crossOrders: number; crossAmt: number
  totalOrders: number; totalSales: number
  dailyTarget: number | null; remaining: number | null; achievement: number | null
}

// ────────────────────────────────────────────────────────────────────────────
// Plain-text report builder (the Discord-ready message this becomes in Phase 3).
// Monospace-aligned with spaces so it stays readable in a chat client.
// ────────────────────────────────────────────────────────────────────────────
const padR = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length))
const padL = (s: string, n: number) => (s.length >= n ? s : " ".repeat(n - s.length) + s)

function buildReportText(o: {
  dateStr: string; slotLabel: string; agentLabel: string
  team: TeamBlock; rows: AgentRow[]; total: Omit<AgentRow, "id" | "name" | "achievement" | "conversion"> & { conversion: number }
  today: DayFig; yest: DayFig
}): string {
  const L: string[] = []
  L.push(`TELEMARKETING SALES REPORT — ${dateLabel(o.dateStr)} (${o.slotLabel})`)
  L.push(`Scope: ${o.agentLabel}`)
  L.push("")
  L.push("OVERALL TEAM")
  const line = (label: string, value: string) => L.push(`  ${padR(label, 22)}${padL(value, 18)}`)
  line("Upsell Orders", num(o.team.upOrders))
  line("Upsell Amount", peso(o.team.upAmt))
  line("Cross-sell Orders", num(o.team.crossOrders))
  line("Cross-sell Amount", peso(o.team.crossAmt))
  line("Grand Total Orders", num(o.team.totalOrders))
  line("Grand Total Sales", peso(o.team.totalSales))
  line("Daily Target", o.team.dailyTarget === null ? "—" : peso(o.team.dailyTarget))
  line("Remaining Target", o.team.remaining === null ? "—" : peso(o.team.remaining))
  line("Achievement %", o.team.achievement === null ? "—" : pct(o.team.achievement))
  L.push("")
  L.push("PER AGENT")
  const arow = (name: string, orders: string, sales: string, calls: string, conn: string, conv: string, ach: string) =>
    L.push(`  ${padR(name, 18)}${padL(orders, 7)}${padL(sales, 16)}${padL(calls, 7)}${padL(conn, 7)}${padL(conv, 8)}${padL(ach, 9)}`)
  arow("Agent", "Orders", "Sales", "Calls", "Conn", "Conv%", "Ach%")
  if (o.rows.length === 0) L.push("  (walang activity)")
  for (const r of o.rows) {
    arow(r.name.slice(0, 18), num(r.totalOrders), peso(r.totalSales), num(r.calls), num(r.connected),
      pct(r.conversion), r.achievement === null ? "—" : pct(r.achievement))
  }
  arow("TOTAL", num(o.total.totalOrders), peso(o.total.totalSales), num(o.total.calls), num(o.total.connected),
    pct(o.total.conversion), "")
  L.push("")
  L.push("TODAY vs YESTERDAY (buong araw)")
  const cmp = (label: string, f: DayFig) =>
    L.push(`  ${padR(label, 12)}${padL(num(f.orders) + " orders", 14)}${padL(peso(f.sales), 18)}`)
  cmp("Today", o.today)
  cmp("Yesterday", o.yest)
  const diff = o.today.sales - o.yest.sales
  const change = o.yest.sales > 0 ? (diff / o.yest.sales) * 100 : o.today.sales > 0 ? 100 : 0
  const oDiff = o.today.orders - o.yest.orders
  L.push(`  ${padR("Difference", 12)}${padL((oDiff >= 0 ? "+" : "") + num(oDiff) + " orders", 14)}${padL((diff >= 0 ? "+" : "-") + peso(Math.abs(diff)), 18)}  (${diff >= 0 ? "+" : ""}${change.toFixed(1)}%)`)
  L.push("")
  L.push("Upsell/Cross-sell breakdown — Today: "
    + `${num(o.today.upOrders)} upsell / ${peso(o.today.upAmt)} · ${num(o.today.crossOrders)} cross / ${peso(o.today.crossAmt)}`)
  L.push("Upsell/Cross-sell breakdown — Yesterday: "
    + `${num(o.yest.upOrders)} upsell / ${peso(o.yest.upAmt)} · ${num(o.yest.crossOrders)} cross / ${peso(o.yest.crossAmt)}`)
  L.push("")
  L.push("Cancelled sales are excluded. Auto-generated by PesoWise Telemarketing.")
  return L.join("\n")
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through to the execCommand path */ }
  try {
    const ta = document.createElement("textarea")
    ta.value = text
    ta.setAttribute("readonly", "")
    ta.style.position = "fixed"
    ta.style.top = "-1000px"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}

// ────────────────────────────────────────────────────────────────────────────
// Module-scope UI pieces (never nested — nesting remounts children per keystroke)
// ────────────────────────────────────────────────────────────────────────────
function KpiCard({ label, value, color, icon: Icon }: { label: string; value: string; color: string; icon: any }) {
  return (
    <div className={`relative overflow-hidden ${color} rounded-xl px-3 py-2.5 sm:px-4 sm:py-3 h-[70px] sm:h-[78px] flex items-center justify-between`}>
      <Icon strokeWidth={1} className="absolute -left-2 w-16 h-16 opacity-[0.15] text-white" />
      <div className="text-right ml-auto z-10 min-w-0">
        <p className="text-lg sm:text-2xl font-bold text-white leading-none tabular-nums truncate">{value}</p>
        <p className="text-[10px] text-white/80 font-semibold mt-1 tracking-wider uppercase leading-tight">{label}</p>
      </div>
    </div>
  )
}

function StatLine({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return (
    <div className={`flex items-center justify-between gap-4 py-1.5 ${strong ? "border-t border-slate-100 pt-2" : ""}`}>
      <span className={`text-sm ${strong ? "text-slate-600 font-semibold" : "text-slate-500"}`}>{label}</span>
      <span className={`text-sm tabular-nums ${tone ?? (strong ? "font-bold text-slate-800" : "font-medium text-slate-700")}`}>{value}</span>
    </div>
  )
}

function DayFigPanel({ label, fig }: { label: string; fig: DayFig }) {
  return (
    <div className="border border-slate-200 rounded-xl p-3">
      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">{label}</p>
      <StatLine label="Upsell Orders" value={num(fig.upOrders)} />
      <StatLine label="Upsell Amount" value={peso(fig.upAmt)} />
      <StatLine label="Cross-sell Orders" value={num(fig.crossOrders)} />
      <StatLine label="Cross-sell Amount" value={peso(fig.crossAmt)} />
      <StatLine label="Grand Orders" value={num(fig.orders)} strong />
      <StatLine label="Grand Sales" value={peso(fig.sales)} strong />
    </div>
  )
}

function SchedulePanel({ times, enabled, discordSet }: { times: string[]; enabled: boolean; discordSet: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 mb-2">
        <CalendarClock className="w-3.5 h-3.5" /> Configured Schedule (read-only — Settings owns this)
      </p>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {times.length === 0
          ? <span className="text-xs text-slate-400 italic">Walang naka-set na oras.</span>
          : times.map(t => (
            <span key={t} className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 tabular-nums">
              {fmt12(t)}
            </span>
          ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
          {enabled ? <Check className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
          Scheduled sending {enabled ? "enabled" : "disabled"}
        </span>
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${discordSet ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
          <Webhook className="w-3 h-3" />
          Discord webhook {discordSet ? "configured" : "not configured"}
        </span>
      </div>
      <p className="text-xs text-slate-500 mt-2.5">
        Ang automatic na pagpapadala ay Phase 3 — preview at manual copy lang muna ito.
      </p>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────────────
export default function TmReportsPage() {
  const [view, setView] = useState<View>("Daily Report")
  const [month, setMonth] = useState(thisMonthStr())
  const [agentF, setAgentF] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const [tick, setTick] = useState(0)

  const [prevDate, setPrevDate] = useState(todayStr())
  const [slot, setSlot] = useState("now")

  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null)
  const flash = useCallback((msg: string, err = false) => {
    setToast({ msg, err }); setTimeout(() => setToast(null), 2500)
  }, [])

  const salesStore = useTmSales()
  const callsStore = useTmCalls()
  const agentsStore = useTmAgents()
  const targetsStore = useTmTargets()
  const settings = useTmSettings()

  const { sales } = salesStore
  const { calls } = callsStore
  const { agents } = agentsStore
  const { targets } = targetsStore
  const workDays = settings.general.work_days

  const coreLoaded = salesStore.loaded && callsStore.loaded
  const fullyLoaded = coreLoaded && agentsStore.loaded && targetsStore.loaded && settings.loaded

  // "Now" cutoff is resolved on the client only (SSR would render a different clock).
  // "23:59" server-side = whole day, which is the safe default.
  const [nowHm, setNowHm] = useState("23:59")
  useEffect(() => { setNowHm(nowTimeStr()) }, [tick])

  const refreshAll = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([salesStore.refresh(), callsStore.refresh(), agentsStore.refresh(), targetsStore.refresh()])
      setTick(t => t + 1)
    } finally { setRefreshing(false) }
  }, [salesStore.refresh, callsStore.refresh, agentsStore.refresh, targetsStore.refresh])

  const activeAgents = useMemo(
    () => agents.filter(a => a.status === "Active").sort((a, b) => a.agent_name.localeCompare(b.agent_name)),
    [agents])
  const agentLabel = useMemo(
    () => (agentF ? (agents.find(a => a.id === agentF)?.agent_name || "Agent") : "All Agents"),
    [agentF, agents])

  // ══════════════════════════════════════════════════════════════════════════
  // DAILY REPORT (spec §5) — one row per calendar day of the selected month
  // ══════════════════════════════════════════════════════════════════════════
  const monthRows = useMemo(
    () => activeSales(sales).filter(s => s.sale_date.slice(0, 7) === month && (!agentF || s.agent_id === agentF)),
    [sales, month, agentF])

  // Target row: the selected agent's, or the TEAM row (agent_id === "") for All Agents.
  const monthTargetRow = useMemo(
    () => targets.find(t => t.month === month && t.agent_id === (agentF || "")),
    [targets, month, agentF])
  const perDayTarget = monthTargetRow && monthTargetRow.daily_sales_target > 0 ? monthTargetRow.daily_sales_target : null
  const monthlyTarget = monthTargetRow && monthTargetRow.sales_target > 0 ? monthTargetRow.sales_target : null

  const dailyRows = useMemo<DayRow[]>(() => {
    const [y, m] = month.split("-").map(Number)
    const last = daysInMonth(month)
    const today = todayStr()
    const byDate = new Map<string, { uo: number; ua: number; co: number; ca: number }>()
    for (const s of monthRows) {
      const b = byDate.get(s.sale_date) ?? { uo: 0, ua: 0, co: 0, ca: 0 }
      b.uo += s.upsell_qty; b.ua += s.upsell_amount; b.co += s.cross_qty; b.ca += s.cross_amount
      byDate.set(s.sale_date, b)
    }
    const out: DayRow[] = []
    for (let d = 1; d <= last; d++) {
      const date = `${month}-${pad2(d)}`
      const wd = y && m ? new Date(y, m - 1, d).getDay() : 0
      const workDay = workDays.includes(wd)
      const b = byDate.get(date) ?? { uo: 0, ua: 0, co: 0, ca: 0 }
      const totalSales = b.ua + b.ca
      // No target expectation on a rest day, and none when no target row exists.
      const target = workDay ? perDayTarget : null
      out.push({
        date, day: d, wd,
        upOrders: b.uo, upAmt: b.ua, crossOrders: b.co, crossAmt: b.ca,
        totalOrders: b.uo + b.co, totalSales,
        target,
        remaining: target === null ? null : Math.max(0, target - totalSales),
        achievement: target === null ? null : (totalSales / target) * 100,
        workDay, isToday: date === today, isFuture: date > today,
      })
    }
    return out
  }, [month, monthRows, workDays, perDayTarget])

  const monthTotal = useMemo(() => dailyRows.reduce((t, r) => ({
    upOrders: t.upOrders + r.upOrders, upAmt: t.upAmt + r.upAmt,
    crossOrders: t.crossOrders + r.crossOrders, crossAmt: t.crossAmt + r.crossAmt,
    totalOrders: t.totalOrders + r.totalOrders, totalSales: t.totalSales + r.totalSales,
  }), { upOrders: 0, upAmt: 0, crossOrders: 0, crossAmt: 0, totalOrders: 0, totalSales: 0 }), [dailyRows])

  const monthRemaining = monthlyTarget === null ? null : Math.max(0, monthlyTarget - monthTotal.totalSales)
  const monthAch = monthlyTarget === null ? null : (monthTotal.totalSales / monthlyTarget) * 100

  // Required Daily Pace (spec §6–7) — only meaningful for the current / a future month.
  const monthClosed = month < thisMonthStr()
  const remDays = useMemo(
    () => (monthClosed ? 0 : remainingWorkingDays(month, workDays, todayStr())),
    [month, workDays, monthClosed])
  const pace = monthlyTarget === null ? null : requiredDailyPace(monthlyTarget, monthTotal.totalSales, remDays)

  const monthKpis = useMemo(() => [
    { label: "Upsell Orders", value: num(monthTotal.upOrders), color: "bg-sky-600", icon: ShoppingCart },
    { label: "Upsell Amount", value: peso(monthTotal.upAmt), color: "bg-blue-600", icon: Wallet },
    { label: "Cross-sell Orders", value: num(monthTotal.crossOrders), color: "bg-violet-600", icon: ShoppingCart },
    { label: "Cross-sell Amount", value: peso(monthTotal.crossAmt), color: "bg-purple-600", icon: Wallet },
    { label: "Grand Total Orders", value: num(monthTotal.totalOrders), color: "bg-slate-800", icon: Layers },
    { label: "Grand Total Sales", value: peso(monthTotal.totalSales), color: "bg-emerald-600", icon: Sigma },
  ], [monthTotal])

  // ══════════════════════════════════════════════════════════════════════════
  // REPORT PREVIEW (spec §20) — figures for prevDate from 00:00 up to the slot
  // ══════════════════════════════════════════════════════════════════════════
  const cutoff = slot === "now" ? (prevDate === todayStr() ? nowHm : "23:59") : slot
  const slotLabel = slot === "now"
    ? (prevDate === todayStr() ? `as of ${fmt12(nowHm)} (now)` : "buong araw")
    : `${fmt12(slot)} edition`

  const prevSales = useMemo(
    () => activeSales(sales).filter(s =>
      s.sale_date === prevDate && (s.sale_time || "00:00") <= cutoff && (!agentF || s.agent_id === agentF)),
    [sales, prevDate, cutoff, agentF])
  const prevCalls = useMemo(
    () => calls.filter(c =>
      c.call_date === prevDate && (c.call_time || "00:00") <= cutoff && (!agentF || c.agent_id === agentF)),
    [calls, prevDate, cutoff, agentF])

  const prevMonth = prevDate.slice(0, 7)
  const prevTargetRow = useMemo(
    () => targets.find(t => t.month === prevMonth && t.agent_id === (agentF || "")),
    [targets, prevMonth, agentF])

  const team = useMemo<TeamBlock>(() => {
    const k = computeTmKpis(prevSales, prevCalls)
    const dailyTarget = prevTargetRow && prevTargetRow.daily_sales_target > 0 ? prevTargetRow.daily_sales_target : null
    return {
      upOrders: k.upsellOrders, upAmt: k.upsellAmount, crossOrders: k.crossOrders, crossAmt: k.crossAmount,
      totalOrders: k.totalOrders, totalSales: k.totalSales,
      dailyTarget,
      remaining: dailyTarget === null ? null : Math.max(0, dailyTarget - k.totalSales),
      achievement: dailyTarget === null ? null : (k.totalSales / dailyTarget) * 100,
    }
  }, [prevSales, prevCalls, prevTargetRow])

  const teamKpis = useMemo(() => computeTmKpis(prevSales, prevCalls), [prevSales, prevCalls])

  const perAgent = useMemo(() => {
    interface Acc {
      id: string; name: string
      upOrders: number; upAmt: number; crossOrders: number; crossAmt: number
      calls: number; connected: number
      connectedLeads: Set<string>; soldLeads: Set<string>; saleRows: number
    }
    const map = new Map<string, Acc>()
    const ensure = (id: string, name: string): Acc => {
      const key = id || name || "—"
      let a = map.get(key)
      if (!a) {
        a = { id: key, name: name || "(unnamed)", upOrders: 0, upAmt: 0, crossOrders: 0, crossAmt: 0,
          calls: 0, connected: 0, connectedLeads: new Set(), soldLeads: new Set(), saleRows: 0 }
        map.set(key, a)
      }
      return a
    }
    for (const a of agents) if (a.status === "Active" && (!agentF || a.id === agentF)) ensure(a.id, a.agent_name)
    for (const s of prevSales) {
      const a = ensure(s.agent_id, s.agent_name)
      a.upOrders += s.upsell_qty; a.upAmt += s.upsell_amount
      a.crossOrders += s.cross_qty; a.crossAmt += s.cross_amount
      a.saleRows++
      if (s.lead_id) a.soldLeads.add(s.lead_id)
    }
    for (const c of prevCalls) {
      const a = ensure(c.agent_id, c.agent_name)
      a.calls++
      if (c.connected) { a.connected++; if (c.lead_id) a.connectedLeads.add(c.lead_id) }
    }
    const dailyByAgent: Record<string, number> = {}
    for (const t of targets) if (t.month === prevMonth && t.agent_id) dailyByAgent[t.agent_id] = t.daily_sales_target

    const rows: AgentRow[] = [...map.values()].map(a => {
      const totalOrders = a.upOrders + a.crossOrders
      const totalSales = a.upAmt + a.crossAmt
      const convBase = a.connectedLeads.size || a.connected
      const convHits = a.soldLeads.size || a.saleRows
      const dt = dailyByAgent[a.id]
      return {
        id: a.id, name: a.name,
        upOrders: a.upOrders, upAmt: a.upAmt, crossOrders: a.crossOrders, crossAmt: a.crossAmt,
        totalOrders, totalSales, calls: a.calls, connected: a.connected,
        conversion: convBase > 0 ? Math.min(100, (convHits / convBase) * 100) : 0,
        achievement: dt && dt > 0 ? (totalSales / dt) * 100 : null,
      }
    }).sort((x, y) => y.totalSales - x.totalSales)

    const total = rows.reduce((t, r) => ({
      upOrders: t.upOrders + r.upOrders, upAmt: t.upAmt + r.upAmt,
      crossOrders: t.crossOrders + r.crossOrders, crossAmt: t.crossAmt + r.crossAmt,
      totalOrders: t.totalOrders + r.totalOrders, totalSales: t.totalSales + r.totalSales,
      calls: t.calls + r.calls, connected: t.connected + r.connected,
    }), { upOrders: 0, upAmt: 0, crossOrders: 0, crossAmt: 0, totalOrders: 0, totalSales: 0, calls: 0, connected: 0 })

    return { rows, total }
  }, [agents, agentF, prevSales, prevCalls, targets, prevMonth])

  // Today vs Yesterday (spec §22) — literal days, whole-day figures, agent-scoped.
  const tvy = useMemo(() => {
    const calc = (day: string): DayFig => {
      const rows = activeSales(sales).filter(s => s.sale_date === day && (!agentF || s.agent_id === agentF))
      const upOrders = rows.reduce((n, s) => n + s.upsell_qty, 0)
      const upAmt = rows.reduce((n, s) => n + s.upsell_amount, 0)
      const crossOrders = rows.reduce((n, s) => n + s.cross_qty, 0)
      const crossAmt = rows.reduce((n, s) => n + s.cross_amount, 0)
      return { upOrders, upAmt, crossOrders, crossAmt, orders: upOrders + crossOrders, sales: upAmt + crossAmt }
    }
    const t = calc(todayStr())
    const y = calc(yesterdayStr())
    const diff = t.sales - y.sales
    return {
      t, y, diff,
      pctChange: y.sales > 0 ? (diff / y.sales) * 100 : t.sales > 0 ? 100 : 0,
      ordersDiff: t.orders - y.orders,
    }
  }, [sales, agentF])

  const reportText = useMemo(() => buildReportText({
    dateStr: prevDate, slotLabel, agentLabel,
    team, rows: perAgent.rows,
    total: { ...perAgent.total, conversion: teamKpis.conversionRate },
    today: tvy.t, yest: tvy.y,
  }), [prevDate, slotLabel, agentLabel, team, perAgent, teamKpis.conversionRate, tvy])

  const onCopy = useCallback(async () => {
    const ok = await copyText(reportText)
    flash(ok ? "Copied!" : "Copy failed — select the text manually.", !ok)
  }, [reportText, flash])

  const gain = tvy.diff >= 0
  const slotTimes = settings.reportSchedule.times

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      <span className="text-sm text-slate-500 font-medium">Telemarketing / Reports</span>

      {toast && (
        <div className={`fixed top-4 right-4 z-50 ${toast.err ? "bg-red-600" : "bg-emerald-600"} text-white rounded-xl shadow-2xl px-4 py-3 text-sm flex items-center gap-2`}>
          {toast.err ? <AlertTriangle className="w-4 h-4" /> : <Check className="w-4 h-4" />} {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><FileText className="w-5 h-5" /> TELEMARKETING REPORTS</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              {VIEWS.map(v => (
                <button key={v} onClick={() => setView(v)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${view === v ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50/70"}`}>
                  {v}
                </button>
              ))}
            </div>
            {view === "Daily Report" && (
              <input type="month" value={month} onChange={e => setMonth(e.target.value || thisMonthStr())}
                title="Report month" className={`${SEL} tabular-nums`} />
            )}
            <select value={agentF} onChange={e => setAgentF(e.target.value)} title="Agent scope" className={SEL}>
              <option value="">All Agents</option>
              {activeAgents.map(a => <option key={a.id} value={a.id}>{a.agent_name}</option>)}
            </select>
            <button onClick={refreshAll} title="Refresh telemarketing data"
              className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50/70 hover:text-slate-700 transition-colors">
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-500 font-medium mt-3">
          {view === "Daily Report"
            ? `${monthLabel(month)} · ${agentLabel} · ${monthRows.length} sale${monthRows.length === 1 ? "" : "s"} (Cancelled excluded)`
            : `${dateLabel(prevDate)} · ${slotLabel} · ${agentLabel} · ${prevSales.length} sale${prevSales.length === 1 ? "" : "s"}, ${prevCalls.length} call${prevCalls.length === 1 ? "" : "s"}`}
        </p>
      </div>

      {/* ══════════════════ DAILY REPORT ══════════════════ */}
      {view === "Daily Report" && (
        <>
          {!coreLoaded ? (
            <StatCardsSkeleton count={6} height="h-[70px] sm:h-[78px]" className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5" />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
              {monthKpis.map(c => <KpiCard key={c.label} {...c} />)}
            </div>
          )}

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            {!fullyLoaded ? <TableSkeleton rows={10} cols={10} /> : (
              <>
                <div className="max-h-[65vh] overflow-auto">
                  <table className="w-full text-sm min-w-[1000px]">
                    <thead className="sticky top-0 z-40 bg-white">
                      <tr className="border-b border-slate-200 text-xs text-slate-600">
                        <th className="px-3 py-3 text-left font-semibold whitespace-nowrap bg-white">Day</th>
                        <th className="px-3 py-3 text-right font-semibold whitespace-nowrap bg-white">Upsell Orders</th>
                        <th className="px-3 py-3 text-right font-semibold whitespace-nowrap bg-white">Upsell Amount</th>
                        <th className="px-3 py-3 text-right font-semibold whitespace-nowrap bg-white">Cross-sell Orders</th>
                        <th className="px-3 py-3 text-right font-semibold whitespace-nowrap bg-white">Cross-sell Amount</th>
                        <th className="px-3 py-3 text-right font-semibold whitespace-nowrap bg-white">Total Orders</th>
                        <th className="px-3 py-3 text-right font-semibold whitespace-nowrap bg-white">Total Sales</th>
                        <th className="px-3 py-3 text-right font-semibold whitespace-nowrap bg-white">Target</th>
                        <th className="px-3 py-3 text-right font-semibold whitespace-nowrap bg-white">Remaining</th>
                        <th className="px-3 py-3 text-right font-semibold whitespace-nowrap bg-white">Achievement %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyRows.map(r => {
                        const muted = !r.workDay || r.isFuture
                        const rowCls = r.isToday
                          ? "bg-blue-50 font-semibold"
                          : muted ? "bg-slate-50/60 text-slate-400" : "hover:bg-slate-50/70"
                        const cell = `px-3 py-2 tabular-nums text-right whitespace-nowrap ${muted ? "text-slate-400" : "text-slate-700"}`
                        return (
                          <tr key={r.date} className={`border-b border-slate-100 ${rowCls}`}>
                            <td className={`px-3 py-2 whitespace-nowrap ${muted ? "text-slate-400" : "text-slate-700 font-medium"}`}>
                              <span className="tabular-nums">{pad2(r.day)}</span>
                              <span className="ml-1.5 text-[11px] text-slate-400">{WD_SHORT[r.wd]}</span>
                              {!r.workDay && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-slate-400">rest</span>}
                            </td>
                            {r.isFuture ? (
                              <>
                                <td className={cell}>—</td><td className={cell}>—</td>
                                <td className={cell}>—</td><td className={cell}>—</td>
                                <td className={cell}>—</td><td className={cell}>—</td>
                                <td className={cell}>{r.target === null ? "—" : peso(r.target)}</td>
                                <td className={cell}></td><td className={cell}></td>
                              </>
                            ) : (
                              <>
                                <td className={cell}>{num(r.upOrders)}</td>
                                <td className={cell}>{peso(r.upAmt)}</td>
                                <td className={cell}>{num(r.crossOrders)}</td>
                                <td className={cell}>{peso(r.crossAmt)}</td>
                                <td className={`${cell} font-semibold`}>{num(r.totalOrders)}</td>
                                <td className={`${cell} font-semibold`}>{peso(r.totalSales)}</td>
                                <td className={cell}>{r.target === null ? "—" : peso(r.target)}</td>
                                <td className={cell}>{r.remaining === null ? "" : peso(r.remaining)}</td>
                                <td className={`px-3 py-2 tabular-nums text-right whitespace-nowrap font-semibold ${r.achievement === null ? "text-slate-300" : achClass(r.achievement)}`}>
                                  {r.achievement === null ? "" : pct(r.achievement)}
                                </td>
                              </>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="font-bold text-slate-800">
                        <td className="px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300 text-xs uppercase whitespace-nowrap">Month Total</td>
                        <td className="px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300 tabular-nums text-right whitespace-nowrap">{num(monthTotal.upOrders)}</td>
                        <td className="px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300 tabular-nums text-right whitespace-nowrap">{peso(monthTotal.upAmt)}</td>
                        <td className="px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300 tabular-nums text-right whitespace-nowrap">{num(monthTotal.crossOrders)}</td>
                        <td className="px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300 tabular-nums text-right whitespace-nowrap">{peso(monthTotal.crossAmt)}</td>
                        <td className="px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300 tabular-nums text-right whitespace-nowrap">{num(monthTotal.totalOrders)}</td>
                        <td className="px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300 tabular-nums text-right whitespace-nowrap">{peso(monthTotal.totalSales)}</td>
                        <td className="px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300 tabular-nums text-right whitespace-nowrap" title="Monthly sales target (not the sum of daily targets)">
                          {monthlyTarget === null ? "—" : peso(monthlyTarget)}
                        </td>
                        <td className="px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300 tabular-nums text-right whitespace-nowrap">
                          {monthRemaining === null ? "" : peso(monthRemaining)}
                        </td>
                        <td className={`px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300 tabular-nums text-right whitespace-nowrap ${monthAch === null ? "text-slate-300" : achClass(monthAch)}`}>
                          {monthAch === null ? "" : pct(monthAch)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Pace summary (spec §6–7) */}
                <div className="border-t border-slate-100 px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-slate-500">
                  {monthlyTarget === null ? (
                    <span className="flex items-center gap-1.5 text-amber-600 font-medium">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Walang monthly target na naka-set para sa {monthLabel(month)} ({agentLabel}) — i-set ito sa Settings → Targets.
                    </span>
                  ) : (
                    <>
                      <span className="flex items-center gap-1.5 font-medium">
                        <Target className="w-3.5 h-3.5 text-slate-400" />
                        Monthly Target: <b className="text-slate-700 tabular-nums">{peso(monthlyTarget)}</b>
                      </span>
                      <span>Remaining Quota: <b className="text-slate-700 tabular-nums">{peso(monthRemaining ?? 0)}</b></span>
                      <span className="flex items-center gap-1.5">
                        <Percent className="w-3.5 h-3.5 text-slate-400" />
                        Achievement: <b className={`tabular-nums ${achClass(monthAch ?? 0)}`}>{pct(monthAch ?? 0)}</b>
                      </span>
                      <span>
                        Required Daily Pace: <b className="text-slate-700 tabular-nums">{monthClosed ? "—" : peso(pace ?? 0)}</b>
                        {" "}· {monthClosed ? "month closed" : `${remDays} working day${remDays === 1 ? "" : "s"} left`}
                      </span>
                      {perDayTarget === null && (
                        <span className="text-amber-600 font-medium">Walang daily target sa target row — blangko ang per-day Target column.</span>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ══════════════════ REPORT PREVIEW ══════════════════ */}
      {view === "Report Preview" && (
        <>
          {/* As-of controls + copy */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Report date</label>
                <input type="date" value={prevDate} onChange={e => setPrevDate(e.target.value || todayStr())} className={SEL} />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Time slot (as of)</label>
                <select value={slot} onChange={e => setSlot(e.target.value)} className={SEL}>
                  <option value="now">Now</option>
                  {slotTimes.map(t => <option key={t} value={t}>{fmt12(t)}</option>)}
                </select>
              </div>
            </div>
            <button onClick={onCopy}
              className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors">
              <Copy className="w-4 h-4" /> Copy as text
            </button>
          </div>

          {!fullyLoaded ? <TableSkeleton rows={8} cols={8} /> : (
            <>
              {/* OVERALL TEAM (spec §20) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="bg-white rounded-2xl border border-slate-200 p-4">
                  <p className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-2">Overall Team</p>
                  <StatLine label="Upsell Orders" value={num(team.upOrders)} />
                  <StatLine label="Upsell Amount" value={peso(team.upAmt)} />
                  <StatLine label="Cross-sell Orders" value={num(team.crossOrders)} />
                  <StatLine label="Cross-sell Amount" value={peso(team.crossAmt)} />
                  <StatLine label="Grand Total Orders" value={num(team.totalOrders)} strong />
                  <StatLine label="Grand Total Sales" value={peso(team.totalSales)} strong />
                  <StatLine label="Daily Target" value={team.dailyTarget === null ? "—" : peso(team.dailyTarget)} strong />
                  <StatLine label="Remaining Target" value={team.remaining === null ? "—" : peso(team.remaining)} />
                  <StatLine label="Target Achievement %"
                    value={team.achievement === null ? "—" : pct(team.achievement)}
                    tone={`font-bold ${team.achievement === null ? "text-slate-400" : achClass(team.achievement)}`} />
                  {team.dailyTarget === null && (
                    <p className="text-xs text-amber-600 mt-2 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" /> Walang daily target para sa {monthLabel(prevMonth)} ({agentLabel}).
                    </p>
                  )}
                </div>

                <SchedulePanel times={slotTimes} enabled={settings.reportSchedule.enabled}
                  discordSet={!!settings.discord.webhook_url} />
              </div>

              {/* PER AGENT */}
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <p className="text-sm font-bold text-slate-700 uppercase tracking-wide px-4 pt-4 pb-2">Per Agent</p>
                <div className="max-h-[65vh] overflow-auto">
                  <table className="w-full text-sm min-w-[1000px]">
                    <thead className="sticky top-0 z-40 bg-white">
                      <tr className="border-b border-slate-200 text-xs text-slate-600">
                        <th className="px-3 py-3 text-left font-semibold whitespace-nowrap bg-white">Agent</th>
                        <th className="px-3 py-3 text-right font-semibold whitespace-nowrap bg-white">Upsell Orders</th>
                        <th className="px-3 py-3 text-right font-semibold whitespace-nowrap bg-white">Upsell Amt</th>
                        <th className="px-3 py-3 text-right font-semibold whitespace-nowrap bg-white">Cross Orders</th>
                        <th className="px-3 py-3 text-right font-semibold whitespace-nowrap bg-white">Cross Amt</th>
                        <th className="px-3 py-3 text-right font-semibold whitespace-nowrap bg-white">Total Orders</th>
                        <th className="px-3 py-3 text-right font-semibold whitespace-nowrap bg-white">Total Sales</th>
                        <th className="px-3 py-3 text-right font-semibold whitespace-nowrap bg-white">Calls</th>
                        <th className="px-3 py-3 text-right font-semibold whitespace-nowrap bg-white">Connected</th>
                        <th className="px-3 py-3 text-right font-semibold whitespace-nowrap bg-white">Conversion %</th>
                        <th className="px-3 py-3 text-right font-semibold whitespace-nowrap bg-white">Achievement %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perAgent.rows.length === 0 ? (
                        <tr><td colSpan={11} className="px-4 py-8 text-center text-sm text-slate-400 italic">Walang agent o activity para sa araw na ito.</td></tr>
                      ) : perAgent.rows.map(r => (
                        <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/70">
                          <td className="px-3 py-2.5 font-medium text-slate-700 whitespace-nowrap">{r.name}</td>
                          <td className="px-3 py-2.5 tabular-nums text-right text-slate-600">{num(r.upOrders)}</td>
                          <td className="px-3 py-2.5 tabular-nums text-right text-slate-600 whitespace-nowrap">{peso(r.upAmt)}</td>
                          <td className="px-3 py-2.5 tabular-nums text-right text-slate-600">{num(r.crossOrders)}</td>
                          <td className="px-3 py-2.5 tabular-nums text-right text-slate-600 whitespace-nowrap">{peso(r.crossAmt)}</td>
                          <td className="px-3 py-2.5 tabular-nums text-right font-semibold text-slate-700">{num(r.totalOrders)}</td>
                          <td className="px-3 py-2.5 tabular-nums text-right font-semibold text-slate-700 whitespace-nowrap">{peso(r.totalSales)}</td>
                          <td className="px-3 py-2.5 tabular-nums text-right text-slate-600">{num(r.calls)}</td>
                          <td className="px-3 py-2.5 tabular-nums text-right text-slate-600">{num(r.connected)}</td>
                          <td className="px-3 py-2.5 tabular-nums text-right text-slate-600">{pct(r.conversion)}</td>
                          <td className={`px-3 py-2.5 tabular-nums text-right font-semibold ${r.achievement === null ? "text-slate-400" : achClass(r.achievement)}`}>
                            {r.achievement === null ? "—" : pct(r.achievement)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="font-bold text-slate-800">
                        <td className="px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300 text-xs uppercase">Total</td>
                        <td className="px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300 tabular-nums text-right">{num(perAgent.total.upOrders)}</td>
                        <td className="px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300 tabular-nums text-right whitespace-nowrap">{peso(perAgent.total.upAmt)}</td>
                        <td className="px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300 tabular-nums text-right">{num(perAgent.total.crossOrders)}</td>
                        <td className="px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300 tabular-nums text-right whitespace-nowrap">{peso(perAgent.total.crossAmt)}</td>
                        <td className="px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300 tabular-nums text-right">{num(perAgent.total.totalOrders)}</td>
                        <td className="px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300 tabular-nums text-right whitespace-nowrap">{peso(perAgent.total.totalSales)}</td>
                        <td className="px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300 tabular-nums text-right">{num(perAgent.total.calls)}</td>
                        <td className="px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300 tabular-nums text-right">{num(perAgent.total.connected)}</td>
                        <td className="px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300 tabular-nums text-right">{pct(teamKpis.conversionRate)}</td>
                        <td className={`px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300 tabular-nums text-right ${team.achievement === null ? "text-slate-400" : achClass(team.achievement)}`}>
                          {team.achievement === null ? "—" : pct(team.achievement)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* TODAY vs YESTERDAY (spec §22) */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4">
                <p className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-1">Today vs Yesterday</p>
                <p className="text-xs text-slate-400 mb-3">Buong araw ang paghahambing (hindi naka-cutoff sa slot) — {dateLabel(todayStr())} vs {dateLabel(yesterdayStr())}.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <DayFigPanel label="Today" fig={tvy.t} />
                  <DayFigPanel label="Yesterday" fig={tvy.y} />
                </div>
                <div className={`mt-3 rounded-xl px-4 py-3 ${gain ? "bg-emerald-50" : "bg-red-50"}`}>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className={`flex items-center gap-2 font-semibold text-sm ${gain ? "text-emerald-700" : "text-red-700"}`}>
                      {gain ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                      Difference
                    </div>
                    <div className={`flex items-center gap-4 text-sm font-bold tabular-nums ${gain ? "text-emerald-700" : "text-red-700"}`}>
                      <span>{gain ? "+" : "-"}{peso(Math.abs(tvy.diff))}</span>
                      <span>{gain ? "+" : ""}{tvy.pctChange.toFixed(1)}%</span>
                      <span>{tvy.ordersDiff >= 0 ? "+" : ""}{num(tvy.ordersDiff)} orders</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Plain-text preview — exactly what "Copy as text" puts on the clipboard */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                  <p className="text-sm font-bold text-slate-700 uppercase tracking-wide">Discord-ready Message</p>
                  <button onClick={onCopy}
                    className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50/70 transition-colors">
                    <Copy className="w-3.5 h-3.5" /> Copy as text
                  </button>
                </div>
                <pre className="text-[11px] leading-relaxed font-mono text-slate-600 bg-slate-50 rounded-xl p-3 overflow-x-auto whitespace-pre">{reportText}</pre>
              </div>
            </>
          )}
        </>
      )}

      <div className="pb-4" />
    </div>
  )
}
