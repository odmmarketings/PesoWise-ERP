"use client"
// Telemarketing Dashboard (docs/telemarketing-spec.md §3–4, §6–7, §22, §28–29, §33).
// Every figure is computed from tm_sales + tm_calls rows filtered by the selected
// date range + agent + sale type. Cancelled sales are excluded everywhere (activeSales).
// Target cards always reflect the CURRENT month, regardless of the date filter.
import { useCallback, useMemo, useState } from "react"
import { format, startOfMonth } from "date-fns"
import {
  Headset, RefreshCw, TrendingUp, TrendingDown, Phone, PhoneCall, PhoneOff,
  Target, Wallet, ShoppingCart, Layers, AlertTriangle, Percent, Eye, EyeOff,
  CalendarClock, PhoneMissed, Sparkles, Users, ArrowRight,
} from "lucide-react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import { StatCardsSkeleton, TableSkeleton, ChartSkeleton } from "@/components/business/Skeleton"
import {
  useTmSales, useTmCalls, useTmLeads, useTmAgents, useTmTargets, useTmSettings,
  computeTmKpis, activeSales, remainingWorkingDays, requiredDailyPace,
  hourOfTime, hourLabel, WON_LEAD_STATUSES, todayStr, thisMonthStr,
  type TmSale, type TmLead,
} from "@/lib/telemarketing-store"

// ────────────────────────────────────────────────────────────────────────────
// Local helpers
// ────────────────────────────────────────────────────────────────────────────
function fmtPeso(n: number) {
  return "₱ " + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const fmtNum = (n: number) => n.toLocaleString("en-PH")
const fmtPct = (n: number) => `${n.toFixed(1)}%`
const shortHour = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h >= 12 ? "PM" : "AM"}`
// Store convention: sale_date/call_date are written with todayStr() (UTC slice) — match it.
const yesterdayStr = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10)

function defaultDateA() { return format(startOfMonth(new Date()), "yyyy-MM-dd") }
function defaultDateB() { return format(new Date(), "yyyy-MM-dd") }

// Working days elapsed this month up to (and including) today — for daily-avg pace checks.
function elapsedWorkingDays(month: string, workDays: number[]): number {
  const [y, m] = month.split("-").map(Number)
  const today = new Date()
  const lastD = Math.min(today.getDate(), new Date(y, m, 0).getDate())
  let count = 0
  for (let d = 1; d <= lastD; d++) if (workDays.includes(new Date(y, m - 1, d).getDay())) count++
  return Math.max(1, count)
}

type SaleTypeFilter = "All" | "Upsell" | "Cross-sell"

// ────────────────────────────────────────────────────────────────────────────
// Small UI pieces
// ────────────────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color, icon: Icon, tip }: {
  label: string; value: string; sub?: string; color: string; icon: any; tip?: string
}) {
  return (
    <div title={tip}
      className={`relative overflow-hidden ${color} rounded-xl px-3 py-2.5 sm:px-4 sm:py-3 cursor-default hover:opacity-95 transition-opacity flex items-center justify-between h-[70px] sm:h-[78px]`}>
      <div className="absolute left-0 top-0 bottom-0 flex items-center pointer-events-none select-none">
        <Icon strokeWidth={1} className="w-16 h-16 opacity-[0.08] text-white -ml-2" />
      </div>
      <div className="text-right ml-auto z-10 min-w-0">
        <p className="text-lg sm:text-2xl font-bold text-white leading-none truncate">{value}</p>
        <p className="text-[11px] text-white/70 font-semibold mt-1 tracking-wider uppercase leading-tight">{label}</p>
        {sub && <p className="text-[10px] text-white/60 font-medium leading-tight mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  )
}

function ChartPanel({ title, shown, onToggle, loaded, children }: {
  title: string; shown: boolean; onToggle: () => void; loaded: boolean; children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-bold text-slate-700 uppercase tracking-wide">{title}</p>
        <button onClick={onToggle}
          className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${shown ? "border-blue-200 bg-blue-50 text-blue-600" : "border-slate-200 bg-slate-50 text-slate-400"}`}>
          {shown ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          {shown ? "Shown" : "Hidden"}
        </button>
      </div>
      {shown && (loaded ? children : <ChartSkeleton height={260} />)}
    </div>
  )
}

const PIE_COLORS = ["#3b82f6", "#f59e0b"]

// ────────────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────────────
export default function TmDashboardPage() {
  const [dateA, setDateA] = useState(defaultDateA())
  const [dateB, setDateB] = useState(defaultDateB())
  const [agentF, setAgentF] = useState("")
  const [saleType, setSaleType] = useState<SaleTypeFilter>("All")
  const [show, setShow] = useState({ daily: true, hourly: true, pie: true, target: true })
  const [refreshing, setRefreshing] = useState(false)

  const salesStore = useTmSales()
  const callsStore = useTmCalls()
  const leadsStore = useTmLeads()
  const agentsStore = useTmAgents()
  const targetsStore = useTmTargets()
  const settings = useTmSettings()

  const { sales } = salesStore
  const { calls } = callsStore
  const { leads } = leadsStore
  const { agents } = agentsStore
  const { targets } = targetsStore

  const coreLoaded = salesStore.loaded && callsStore.loaded
  const month = thisMonthStr()
  const showUp = saleType !== "Cross-sell"
  const showCross = saleType !== "Upsell"

  // Type-aware amount/qty of one sale row (the sale-type filter, spec §4).
  const amtOf = useCallback((s: TmSale) =>
    saleType === "Upsell" ? s.upsell_amount : saleType === "Cross-sell" ? s.cross_amount : s.total_amount, [saleType])
  const qtyOf = useCallback((s: TmSale) =>
    saleType === "Upsell" ? s.upsell_qty : saleType === "Cross-sell" ? s.cross_qty : s.total_qty, [saleType])

  const refreshAll = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([
        salesStore.refresh(), callsStore.refresh(), leadsStore.refresh(),
        agentsStore.refresh(), targetsStore.refresh(),
      ])
    } finally { setRefreshing(false) }
  }, [salesStore.refresh, callsStore.refresh, leadsStore.refresh, agentsStore.refresh, targetsStore.refresh])

  // ── Range-filtered rows (date + agent; sale type handled by amtOf/qtyOf or KPI split) ──
  const rangeSales = useMemo(
    () => sales.filter(s => s.sale_date >= dateA && s.sale_date <= dateB && (!agentF || s.agent_id === agentF)),
    [sales, dateA, dateB, agentF])
  const rangeCalls = useMemo(
    () => calls.filter(c => c.call_date >= dateA && c.call_date <= dateB && (!agentF || c.agent_id === agentF)),
    [calls, dateA, dateB, agentF])
  const rangeActive = useMemo(() => activeSales(rangeSales), [rangeSales])

  // ── KPIs (§3): computeTmKpis for "All"; hand-computed split when a type filter is on ──
  const kpis = useMemo(() => {
    if (saleType === "All") return computeTmKpis(rangeSales, rangeCalls)
    const rows = rangeActive.filter(s => saleType === "Upsell"
      ? (s.upsell_qty > 0 || s.upsell_amount > 0)
      : (s.cross_qty > 0 || s.cross_amount > 0))
    const orders = rows.reduce((n, s) => n + (saleType === "Upsell" ? s.upsell_qty : s.cross_qty), 0)
    const amount = rows.reduce((n, s) => n + (saleType === "Upsell" ? s.upsell_amount : s.cross_amount), 0)
    const callsMade = rangeCalls.length
    const connectedCalls = rangeCalls.filter(c => c.connected).length
    const connectedLeads = new Set(rangeCalls.filter(c => c.connected && c.lead_id).map(c => c.lead_id))
    const soldLeads = new Set(rows.filter(s => s.lead_id).map(s => s.lead_id))
    const convBase = connectedLeads.size || connectedCalls
    const convHits = soldLeads.size || rows.length
    return {
      upsellOrders: saleType === "Upsell" ? orders : 0, upsellAmount: saleType === "Upsell" ? amount : 0,
      crossOrders: saleType === "Cross-sell" ? orders : 0, crossAmount: saleType === "Cross-sell" ? amount : 0,
      totalOrders: orders, totalSales: amount,
      callsMade, connectedCalls, notConnectedCalls: callsMade - connectedCalls,
      contactRate: callsMade > 0 ? (connectedCalls / callsMade) * 100 : 0,
      conversionRate: convBase > 0 ? Math.min(100, (convHits / convBase) * 100) : 0,
      avgOrderValue: orders > 0 ? amount / orders : 0,
      salesPerConnectedCall: connectedCalls > 0 ? amount / connectedCalls : 0,
      ordersPerConnectedCall: connectedCalls > 0 ? orders / connectedCalls : 0,
    }
  }, [saleType, rangeSales, rangeCalls, rangeActive])

  // ── Targets & pace (§6–7) — ALWAYS current month, independent of the date filter ──
  const monthActive = useMemo(
    () => activeSales(sales).filter(s => s.sale_date.slice(0, 7) === month && (!agentF || s.agent_id === agentF)),
    [sales, month, agentF])
  const monthSalesAmt = useMemo(() => monthActive.reduce((n, s) => n + amtOf(s), 0), [monthActive, amtOf])
  const targetRow = useMemo(
    () => targets.find(t => t.month === month && t.agent_id === (agentF || "")),
    [targets, month, agentF])
  const monthTarget = targetRow?.sales_target ?? 0
  const dailyTarget = targetRow?.daily_sales_target ?? 0
  const remainingQuota = monthTarget - monthSalesAmt
  const achievement = monthTarget > 0 ? (monthSalesAmt / monthTarget) * 100 : 0
  const remDays = useMemo(
    () => remainingWorkingDays(month, settings.general.work_days, todayStr()),
    [month, settings.general.work_days])
  const pace = requiredDailyPace(monthTarget, monthSalesAmt, remDays)

  // ── Chart data (§33 row 4) ──
  const dailyData = useMemo(() => {
    const byDate: Record<string, number> = {}
    for (const s of rangeActive) byDate[s.sale_date] = (byDate[s.sale_date] || 0) + amtOf(s)
    const out: { day: string; amount: number }[] = []
    const d = new Date(`${dateA}T00:00:00`)
    const end = new Date(`${dateB}T00:00:00`)
    let guard = 0
    while (d <= end && guard++ < 190) {
      out.push({ day: format(d, "MMM d"), amount: byDate[format(d, "yyyy-MM-dd")] || 0 })
      d.setDate(d.getDate() + 1)
    }
    return out
  }, [rangeActive, amtOf, dateA, dateB])

  const hourlyData = useMemo(() => {
    const buckets: Record<number, number> = {}
    for (const s of rangeActive) {
      const h = hourOfTime(s.sale_time)
      if (h >= 0) buckets[h] = (buckets[h] || 0) + amtOf(s)
    }
    const out: { hour: string; range: string; amount: number }[] = []
    for (let h = settings.hourBlocks.start; h <= settings.hourBlocks.end; h++)
      out.push({ hour: shortHour(h), range: hourLabel(h), amount: buckets[h] || 0 })
    return out
  }, [rangeActive, amtOf, settings.hourBlocks])

  const pieData = useMemo(() => [
    { name: "Upsell", value: kpis.upsellAmount },
    { name: "Cross-sell", value: kpis.crossAmount },
  ].filter(d => d.value > 0), [kpis.upsellAmount, kpis.crossAmount])

  const targetVsActual = useMemo(() => [
    { name: "Target", amount: monthTarget },
    { name: "Actual", amount: monthSalesAmt },
  ], [monthTarget, monthSalesAmt])

  // ── Agent performance table (§33 row 5) ──
  const agentTable = useMemo(() => {
    interface Row {
      id: string; name: string
      upOrders: number; upAmt: number; crossOrders: number; crossAmt: number
      totalOrders: number; totalSales: number; calls: number; connected: number
      connectedLeads: Set<string>; soldLeads: Set<string>; salesRows: number
    }
    const map = new Map<string, Row>()
    const ensure = (id: string, name: string): Row => {
      const key = id || name || "—"
      let r = map.get(key)
      if (!r) {
        r = { id: key, name: name || "(unnamed)", upOrders: 0, upAmt: 0, crossOrders: 0, crossAmt: 0,
          totalOrders: 0, totalSales: 0, calls: 0, connected: 0,
          connectedLeads: new Set(), soldLeads: new Set(), salesRows: 0 }
        map.set(key, r)
      }
      return r
    }
    for (const a of agents) if (!agentF || a.id === agentF) ensure(a.id, a.agent_name)
    for (const s of rangeActive) {
      const r = ensure(s.agent_id, s.agent_name)
      if (showUp) { r.upOrders += s.upsell_qty; r.upAmt += s.upsell_amount }
      if (showCross) { r.crossOrders += s.cross_qty; r.crossAmt += s.cross_amount }
      r.totalOrders = r.upOrders + r.crossOrders
      r.totalSales = r.upAmt + r.crossAmt
      if (amtOf(s) > 0 || qtyOf(s) > 0) { r.salesRows++; if (s.lead_id) r.soldLeads.add(s.lead_id) }
    }
    for (const c of rangeCalls) {
      const r = ensure(c.agent_id, c.agent_name)
      r.calls++
      if (c.connected) { r.connected++; if (c.lead_id) r.connectedLeads.add(c.lead_id) }
    }
    // Per-agent current-month sales (type-aware) for the Target % column.
    const monthByAgent: Record<string, number> = {}
    for (const s of activeSales(sales)) {
      if (s.sale_date.slice(0, 7) !== month) continue
      const key = s.agent_id || s.agent_name || "—"
      monthByAgent[key] = (monthByAgent[key] || 0) + amtOf(s)
    }
    const targetByAgent: Record<string, number> = {}
    for (const t of targets) if (t.month === month && t.agent_id) targetByAgent[t.agent_id] = t.sales_target

    const rows = [...map.values()].map(r => {
      const convBase = r.connectedLeads.size || r.connected
      const convHits = r.soldLeads.size || r.salesRows
      const target = targetByAgent[r.id]
      return {
        ...r,
        conversion: convBase > 0 ? Math.min(100, (convHits / convBase) * 100) : 0,
        targetPct: target && target > 0 ? ((monthByAgent[r.id] || 0) / target) * 100 : null,
      }
    }).sort((a, b) => b.totalSales - a.totalSales)

    const total = rows.reduce((t, r) => ({
      upOrders: t.upOrders + r.upOrders, upAmt: t.upAmt + r.upAmt,
      crossOrders: t.crossOrders + r.crossOrders, crossAmt: t.crossAmt + r.crossAmt,
      totalOrders: t.totalOrders + r.totalOrders, totalSales: t.totalSales + r.totalSales,
      calls: t.calls + r.calls, connected: t.connected + r.connected,
    }), { upOrders: 0, upAmt: 0, crossOrders: 0, crossAmt: 0, totalOrders: 0, totalSales: 0, calls: 0, connected: 0 })

    return { rows, total }
  }, [agents, agentF, rangeActive, rangeCalls, sales, targets, month, amtOf, qtyOf, showUp, showCross])

  // ── Today vs Yesterday (§22) — literal days, independent of the date filter ──
  const tvy = useMemo(() => {
    const calc = (day: string) => {
      const rows = activeSales(sales).filter(s => s.sale_date === day && (!agentF || s.agent_id === agentF))
      const upOrders = showUp ? rows.reduce((n, s) => n + s.upsell_qty, 0) : 0
      const upAmt = showUp ? rows.reduce((n, s) => n + s.upsell_amount, 0) : 0
      const crossOrders = showCross ? rows.reduce((n, s) => n + s.cross_qty, 0) : 0
      const crossAmt = showCross ? rows.reduce((n, s) => n + s.cross_amount, 0) : 0
      return { upOrders, upAmt, crossOrders, crossAmt, orders: upOrders + crossOrders, sales: upAmt + crossAmt }
    }
    const t = calc(todayStr())
    const y = calc(yesterdayStr())
    const diff = t.sales - y.sales
    const pctChange = y.sales > 0 ? (diff / y.sales) * 100 : t.sales > 0 ? 100 : 0
    return { t, y, diff, pctChange, ordersDiff: t.orders - y.orders }
  }, [sales, agentF, showUp, showCross])

  // ── Funnel (§29) ──
  const funnel = useMemo(() => {
    const pool = agentF ? leads.filter(l => l.assigned_to === agentF) : leads
    const connectedLeadIds = new Set(calls.filter(c => c.connected && c.lead_id).map(c => c.lead_id))
    const soldLeadIds = new Set(activeSales(sales).filter(s => s.lead_id).map(s => s.lead_id))
    const INTERESTED_PLUS = new Set(["Interested", ...WON_LEAD_STATUSES])
    const stages = [
      { label: "Assigned Leads", n: pool.length },
      { label: "Called", n: pool.filter(l => l.call_attempts > 0).length },
      { label: "Connected", n: pool.filter(l => connectedLeadIds.has(l.id)).length },
      { label: "Interested", n: pool.filter(l => INTERESTED_PLUS.has(l.status)).length },
      { label: "Sold", n: pool.filter(l => WON_LEAD_STATUSES.includes(l.status) || soldLeadIds.has(l.id)).length },
      { label: "Completed", n: pool.filter(l => l.status === "Completed").length },
    ]
    return stages.map((s, i) => ({
      ...s,
      pctOfPrev: i === 0 ? 100 : stages[i - 1].n > 0 ? (s.n / stages[i - 1].n) * 100 : 0,
      width: stages[0].n > 0 ? Math.max(2, (s.n / stages[0].n) * 100) : 2,
    }))
  }, [leads, calls, sales, agentF])

  // ── Action Required (§28) ──
  const actions = useMemo(() => {
    const today = todayStr()
    const open = (l: TmLead) => !WON_LEAD_STATUSES.includes(l.status) && l.status !== "Do Not Call" && l.status !== "Declined"
    const pool = agentF ? leads.filter(l => l.assigned_to === agentF) : leads
    const followupsToday = pool.filter(l => l.follow_up_date === today && open(l))
    const overdue = pool.filter(l => !!l.follow_up_date && l.follow_up_date < today && open(l))
    const uncalled = pool.filter(l => l.call_attempts === 0 && l.status !== "Do Not Call")
    const interestedOpen = pool.filter(l => l.status === "Interested")
    // Agents below daily target: month-to-date daily average vs daily_sales_target (targeted agents only).
    const elapsed = elapsedWorkingDays(month, settings.general.work_days)
    const monthByAgent: Record<string, number> = {}
    for (const s of activeSales(sales)) {
      if (s.sale_date.slice(0, 7) !== month) continue
      monthByAgent[s.agent_id] = (monthByAgent[s.agent_id] || 0) + s.total_amount
    }
    const belowTarget = agents
      .filter(a => a.status === "Active" && (!agentF || a.id === agentF))
      .map(a => {
        const t = targets.find(x => x.month === month && x.agent_id === a.id)
        if (!t || t.daily_sales_target <= 0) return null
        const avg = (monthByAgent[a.id] || 0) / elapsed
        return avg < t.daily_sales_target ? { name: a.agent_name, avg, target: t.daily_sales_target } : null
      })
      .filter((x): x is { name: string; avg: number; target: number } => x !== null)
    return { followupsToday, overdue, uncalled, interestedOpen, belowTarget }
  }, [leads, agents, targets, sales, agentF, month, settings.general.work_days])

  // ── Card definitions ──
  const row1 = [
    { label: "Upsell Orders", value: fmtNum(kpis.upsellOrders), color: "bg-blue-500", icon: ShoppingCart },
    { label: "Upsell Amount", value: fmtPeso(kpis.upsellAmount), color: "bg-blue-600", icon: Wallet },
    { label: "Cross-sell Orders", value: fmtNum(kpis.crossOrders), color: "bg-amber-500", icon: ShoppingCart },
    { label: "Cross-sell Amount", value: fmtPeso(kpis.crossAmount), color: "bg-amber-600", icon: Wallet },
    { label: "Total Orders", value: fmtNum(kpis.totalOrders), color: "bg-violet-600", icon: Layers },
    { label: "Grand Total Sales", value: fmtPeso(kpis.totalSales), color: "bg-emerald-600", icon: TrendingUp },
  ]
  const row2 = [
    { label: "Daily Target", value: targetRow ? fmtPeso(dailyTarget) : "—", color: "bg-slate-600", icon: Target,
      tip: agentF ? "This agent's daily sales target (current month)" : "Team daily sales target (current month)" },
    { label: "Current Sales", value: fmtPeso(monthSalesAmt), color: "bg-cyan-600", icon: TrendingUp,
      sub: "Month-to-date", tip: "Month-to-date sales vs the This Month Target" },
    { label: "Remaining (This Month Target)", value: targetRow ? fmtPeso(Math.max(0, remainingQuota)) : "—", color: "bg-rose-500", icon: Wallet,
      sub: targetRow ? `Pace: ${fmtPeso(pace)}/day · ${remDays} working day${remDays === 1 ? "" : "s"} left` : undefined,
      tip: "This Month Target − month-to-date sales; required daily pace below" },
    { label: "Achievement %", value: targetRow ? fmtPct(achievement) : "—", color: achievement >= 100 ? "bg-emerald-600" : "bg-indigo-600", icon: Percent,
      sub: targetRow ? `This Month Target: ${fmtPeso(monthTarget)}` : "No target set for this month" },
    { label: "Conversion %", value: fmtPct(kpis.conversionRate), color: "bg-fuchsia-600", icon: Sparkles,
      tip: "Customers with a successful sale ÷ unique connected customers (selected range)" },
    { label: "Avg Order Value", value: fmtPeso(kpis.avgOrderValue), color: "bg-teal-600", icon: Wallet },
  ]
  const row3 = [
    { label: "Calls Made", value: fmtNum(kpis.callsMade), color: "bg-sky-600", icon: Phone },
    { label: "Connected", value: fmtNum(kpis.connectedCalls), color: "bg-emerald-500", icon: PhoneCall },
    { label: "Not Connected", value: fmtNum(kpis.notConnectedCalls), color: "bg-orange-500", icon: PhoneOff },
    { label: "Contact Rate", value: fmtPct(kpis.contactRate), color: "bg-indigo-500", icon: Percent },
    { label: "Sales / Connected Call", value: fmtPeso(kpis.salesPerConnectedCall), color: "bg-slate-700", icon: PhoneCall },
  ]

  const gain = tvy.diff >= 0
  const rangeLabel = `${format(new Date(`${dateA}T00:00:00`), "MMM d, yyyy")} – ${format(new Date(`${dateB}T00:00:00`), "MMM d, yyyy")}`

  const agentOptions = useMemo(
    () => [...agents].sort((a, b) => a.agent_name.localeCompare(b.agent_name)),
    [agents])

  const actionGroups: { title: string; icon: any; tone: "amber" | "red"; count: number; lines: string[] }[] = [
    { title: "Follow-ups due today", icon: CalendarClock, tone: "amber", count: actions.followupsToday.length,
      lines: actions.followupsToday.map(l => l.customer_name || l.phone || l.id) },
    { title: "Overdue follow-ups", icon: AlertTriangle, tone: "red", count: actions.overdue.length,
      lines: actions.overdue.map(l => `${l.customer_name || l.phone || l.id} (${l.follow_up_date})`) },
    { title: "Uncalled leads", icon: PhoneMissed, tone: "amber", count: actions.uncalled.length,
      lines: actions.uncalled.map(l => l.customer_name || l.phone || l.id) },
    { title: "Interested but not closed", icon: Sparkles, tone: "amber", count: actions.interestedOpen.length,
      lines: actions.interestedOpen.map(l => l.customer_name || l.phone || l.id) },
    { title: "Agents below daily target", icon: Users, tone: "red", count: actions.belowTarget.length,
      lines: actions.belowTarget.map(a => `${a.name} — avg ${fmtPeso(a.avg)} vs ${fmtPeso(a.target)}/day`) },
  ]

  return (
    <div className="w-full space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-4 mb-1 border-b border-slate-100">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Headset className="w-5 h-5" /> TELEMARKETING DASHBOARD</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <DateRangePicker a={dateA} b={dateB} variant="header"
            onApply={(a, b) => { setDateA(a || defaultDateA()); setDateB(b || defaultDateB()) }} placeholder="This month" />
          <select value={agentF} onChange={e => setAgentF(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-100">
            <option value="">All agents</option>
            {agentOptions.map(a => (
              <option key={a.id} value={a.id}>{a.agent_name}{a.status === "Inactive" ? " (inactive)" : ""}</option>
            ))}
          </select>
          <select value={saleType} onChange={e => setSaleType(e.target.value as SaleTypeFilter)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-100">
            <option value="All">All sale types</option>
            <option value="Upsell">Upsell</option>
            <option value="Cross-sell">Cross-sell</option>
          </select>
          <button onClick={refreshAll} title="Refresh telemarketing data"
            className="h-9 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500 font-medium">
        {rangeLabel} · {rangeActive.length} sale{rangeActive.length === 1 ? "" : "s"} · {rangeCalls.length} call{rangeCalls.length === 1 ? "" : "s"}
        {saleType !== "All" ? ` · ${saleType} only` : ""}
      </p>

      {/* ── Row 1: Core Sales ── */}
      {coreLoaded ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {row1.map(c => <StatCard key={c.label} {...c} />)}
        </div>
      ) : <StatCardsSkeleton count={6} height="h-[70px] sm:h-[78px]" className="grid grid-cols-2 sm:grid-cols-3 gap-2.5" />}

      {/* ── Row 2: Performance / Targets (always current month) ── */}
      {coreLoaded && targetsStore.loaded && settings.loaded ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {row2.map(c => <StatCard key={c.label} {...c} />)}
        </div>
      ) : <StatCardsSkeleton count={6} height="h-[70px] sm:h-[78px]" className="grid grid-cols-2 sm:grid-cols-3 gap-2.5" />}

      {/* ── Row 3: Calls ── */}
      {coreLoaded ? (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          {row3.map(c => <StatCard key={c.label} {...c} />)}
        </div>
      ) : <StatCardsSkeleton count={5} height="h-[70px] sm:h-[78px]" className="grid grid-cols-2 sm:grid-cols-5 gap-2.5" />}

      {/* ── Row 4: Charts ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartPanel title="Daily Sales" shown={show.daily} onToggle={() => setShow(s => ({ ...s, daily: !s.daily }))} loaded={coreLoaded}>
          {dailyData.every(d => d.amount === 0)
            ? <p className="text-sm text-slate-400 text-center py-16">No sales in this range.</p>
            : (
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={dailyData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} width={70} tickFormatter={(v: number) => v.toLocaleString("en-PH")} />
                    <RTooltip formatter={(v: any) => fmtPeso(Number(v))} />
                    <Bar dataKey="amount" name="Sales" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
        </ChartPanel>

        <ChartPanel title="Hourly Sales" shown={show.hourly} onToggle={() => setShow(s => ({ ...s, hourly: !s.hourly }))} loaded={coreLoaded && settings.loaded}>
          {hourlyData.every(d => d.amount === 0)
            ? <p className="text-sm text-slate-400 text-center py-16">No timed sales in this range.</p>
            : (
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={hourlyData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} width={70} tickFormatter={(v: number) => v.toLocaleString("en-PH")} />
                    <RTooltip formatter={(v: any) => fmtPeso(Number(v))}
                      labelFormatter={(_: any, payload: any) => payload?.[0]?.payload?.range ?? ""} />
                    <Bar dataKey="amount" name="Sales" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
        </ChartPanel>

        <ChartPanel title="Upsell vs Cross-sell" shown={show.pie} onToggle={() => setShow(s => ({ ...s, pie: !s.pie }))} loaded={coreLoaded}>
          {pieData.length === 0
            ? <p className="text-sm text-slate-400 text-center py-16">No sales to chart in this range.</p>
            : (
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={95}
                      label={(e: any) => `${e.name}: ${fmtPeso(e.value)}`}>
                      {pieData.map((d, i) => <Cell key={d.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <RTooltip formatter={(v: any) => fmtPeso(Number(v))} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
        </ChartPanel>

        <ChartPanel title="Target vs Actual (This Month)" shown={show.target} onToggle={() => setShow(s => ({ ...s, target: !s.target }))} loaded={coreLoaded && targetsStore.loaded}>
          {monthTarget === 0 && monthSalesAmt === 0
            ? <p className="text-sm text-slate-400 text-center py-16">No target set and no sales this month.</p>
            : (
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={targetVsActual} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 10 }} width={70} tickFormatter={(v: number) => v.toLocaleString("en-PH")} />
                    <RTooltip formatter={(v: any) => fmtPeso(Number(v))} />
                    <Bar dataKey="amount" name="Amount" radius={[3, 3, 0, 0]}>
                      <Cell fill="#94a3b8" />
                      <Cell fill={monthSalesAmt >= monthTarget && monthTarget > 0 ? "#16a34a" : "#3b82f6"} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
        </ChartPanel>
      </div>

      {/* ── Row 5: Agent Performance ── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <p className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3">Agent Performance</p>
        {!(coreLoaded && agentsStore.loaded) ? <TableSkeleton rows={5} cols={8} /> : agentTable.rows.length === 0 ? (
          <p className="text-sm text-slate-400 italic py-4">No agents or activity in this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="bg-slate-50 border-y border-slate-200 text-xs text-slate-600">
                  <th className="text-left px-3 py-2.5 font-semibold">Agent</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Upsell Orders</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Upsell Amt</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Cross Orders</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Cross Amt</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Total Orders</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Total Sales</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Calls</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Connected</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Conversion %</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Target %</th>
                </tr>
              </thead>
              <tbody>
                {agentTable.rows.map(r => (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-medium text-slate-700">{r.name}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{fmtNum(r.upOrders)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{fmtPeso(r.upAmt)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{fmtNum(r.crossOrders)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{fmtPeso(r.crossAmt)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-700">{fmtNum(r.totalOrders)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-700">{fmtPeso(r.totalSales)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{fmtNum(r.calls)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{fmtNum(r.connected)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{fmtPct(r.conversion)}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${r.targetPct === null ? "text-slate-400" : r.targetPct >= 100 ? "text-emerald-600" : r.targetPct >= 70 ? "text-amber-600" : "text-red-600"}`}>
                      {r.targetPct === null ? "—" : fmtPct(r.targetPct)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-800">
                  <td className="px-3 py-2.5 text-xs uppercase">Total</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(agentTable.total.upOrders)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtPeso(agentTable.total.upAmt)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(agentTable.total.crossOrders)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtPeso(agentTable.total.crossAmt)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(agentTable.total.totalOrders)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtPeso(agentTable.total.totalSales)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(agentTable.total.calls)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(agentTable.total.connected)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtPct(kpis.conversionRate)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{!agentF && monthTarget > 0 ? fmtPct(achievement) : "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Today vs Yesterday + Funnel ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <p className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3">Today vs Yesterday</p>
          {!coreLoaded ? <TableSkeleton rows={4} cols={3} /> : (
            <>
              <div className="grid grid-cols-2 gap-3">
                {([["TODAY", tvy.t], ["YESTERDAY", tvy.y]] as const).map(([label, d]) => (
                  <div key={label} className="border border-slate-200 rounded-xl p-3">
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">{label}</p>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between"><span className="text-slate-500">Upsell Orders</span><span className="tabular-nums font-medium text-slate-700">{fmtNum(d.upOrders)}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Upsell Amount</span><span className="tabular-nums font-medium text-slate-700">{fmtPeso(d.upAmt)}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Cross Orders</span><span className="tabular-nums font-medium text-slate-700">{fmtNum(d.crossOrders)}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Cross Amount</span><span className="tabular-nums font-medium text-slate-700">{fmtPeso(d.crossAmt)}</span></div>
                      <div className="flex justify-between border-t border-slate-100 pt-1.5"><span className="text-slate-600 font-semibold">Grand Orders</span><span className="tabular-nums font-bold text-slate-800">{fmtNum(d.orders)}</span></div>
                      <div className="flex justify-between"><span className="text-slate-600 font-semibold">Grand Sales</span><span className="tabular-nums font-bold text-slate-800">{fmtPeso(d.sales)}</span></div>
                    </div>
                  </div>
                ))}
              </div>
              <div className={`mt-3 rounded-xl px-4 py-3 flex items-center justify-between ${gain ? "bg-emerald-50" : "bg-red-50"}`}>
                <div className={`flex items-center gap-2 font-semibold text-sm ${gain ? "text-emerald-700" : "text-red-700"}`}>
                  {gain ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  Difference
                  <span className="text-xs font-medium opacity-80">({tvy.ordersDiff >= 0 ? "+" : ""}{fmtNum(tvy.ordersDiff)} orders)</span>
                </div>
                <p className={`tabular-nums font-bold ${gain ? "text-emerald-700" : "text-red-700"}`}>
                  {gain ? "+" : "-"}{fmtPeso(Math.abs(tvy.diff))} <span className="text-xs font-semibold">({gain ? "+" : ""}{tvy.pctChange.toFixed(1)}%)</span>
                </p>
              </div>
            </>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <p className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3">Lead Funnel</p>
          {!(leadsStore.loaded && callsStore.loaded && salesStore.loaded) ? <TableSkeleton rows={6} cols={2} /> : funnel[0].n === 0 ? (
            <p className="text-sm text-slate-400 italic py-4">No leads{agentF ? " assigned to this agent" : ""} yet.</p>
          ) : (
            <div className="space-y-2.5">
              {funnel.map((s, i) => (
                <div key={s.label}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-semibold text-slate-600 flex items-center gap-1">
                      {i > 0 && <ArrowRight className="w-3 h-3 text-slate-300" />}{s.label}
                    </span>
                    <span className="tabular-nums text-slate-500">
                      <span className="font-bold text-slate-700">{fmtNum(s.n)}</span>
                      {i > 0 && <span className="ml-1.5">({s.pctOfPrev.toFixed(1)}% of prev)</span>}
                    </span>
                  </div>
                  <div className="h-4 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all"
                      style={{ width: `${s.width}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Action Required (§28) ── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <p className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" /> Action Required
        </p>
        {!(leadsStore.loaded && agentsStore.loaded && targetsStore.loaded && salesStore.loaded) ? <TableSkeleton rows={3} cols={4} /> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {actionGroups.map(g => (
              <div key={g.title}
                className={`rounded-xl border border-slate-200 p-3 border-l-4 ${g.tone === "red" ? "border-l-red-500" : "border-l-amber-400"} ${g.count === 0 ? "opacity-60" : ""}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                    <g.icon className={`w-3.5 h-3.5 ${g.tone === "red" ? "text-red-500" : "text-amber-500"}`} />
                    {g.title}
                  </p>
                  <span className={`text-sm font-bold tabular-nums ${g.count === 0 ? "text-slate-400" : g.tone === "red" ? "text-red-600" : "text-amber-600"}`}>{fmtNum(g.count)}</span>
                </div>
                {g.count === 0 ? (
                  <p className="text-xs text-slate-400 italic">All clear.</p>
                ) : (
                  <ul className="text-xs text-slate-600 space-y-0.5">
                    {g.lines.slice(0, 5).map((line, i) => <li key={i} className="truncate">• {line}</li>)}
                    {g.count > 5 && <li className="text-slate-400 font-medium">+{g.count - 5} more</li>}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pb-4" />
    </div>
  )
}
