"use client"
// Telemarketing → Hourly Sales (docs/telemarketing-spec.md §8 Hourly tracker, §9 auto
// hourly calculation, §10 Monthly Hourly Analysis, §30 extra metrics).
//
// Two views over the SAME buckets:
//   DAILY            — one specific day, hour by hour, DAILY TOTAL footer.
//   MONTHLY ANALYSIS — per-hour totals across a month + Avg Sales/Day + Best Day.
//
// Buckets come straight from the transaction timestamps (hourOfTime on sale_time /
// call_time) — walang manual hourly encoding (§9). Hour range is configurable via
// Telemarketing Settings (hourBlocks); anything that lands outside that window is
// still shown in a muted "Outside hours" row instead of being silently dropped.
// Every rate is recomputed from raw counts through computeTmKpis so this page can
// never contradict the dashboard (spec §34). Cancelled sales are excluded everywhere.
import { useCallback, useMemo, useState } from "react"
import { format } from "date-fns"
import {
  Clock3, RefreshCw, Eye, EyeOff, ShoppingCart, Wallet, Phone, PhoneCall,
  Percent, Sunrise, CalendarDays, CalendarRange,
} from "lucide-react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend, ResponsiveContainer,
} from "recharts"
import { StatCardsSkeleton, TableSkeleton, ChartSkeleton } from "@/components/business/Skeleton"
import {
  useTmSales, useTmCalls, useTmAgents, useTmSettings,
  computeTmKpis, activeSales, hourOfTime, hourLabel, todayStr, thisMonthStr,
  DEFAULT_HOUR_BLOCKS, type TmSale, type TmCall, type TmKpis,
} from "@/lib/telemarketing-store"

// ────────────────────────────────────────────────────────────────────────────
// Local helpers
// ────────────────────────────────────────────────────────────────────────────
const peso = (n: number) => "₱" + (isFinite(n) ? n : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtNum = (n: number) => (isFinite(n) ? n : 0).toLocaleString("en-PH")
const fmtPct = (n: number) => `${(isFinite(n) ? n : 0).toFixed(1)}%`
const shortHour = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h >= 12 ? "PM" : "AM"}`
const prettyDate = (d: string) => {
  if (!d) return "—"
  const dt = new Date(`${d}T00:00:00`)
  return isNaN(dt.getTime()) ? d : format(dt, "MMM d")
}

type ViewMode = "daily" | "monthly"
type SaleTypeFilter = "All" | "Upsell" | "Cross-sell"

/** Rows that actually carry the selected sale type (spec §4 filter behaviour). */
function typeRows(sales: TmSale[], saleType: SaleTypeFilter): TmSale[] {
  if (saleType === "All") return sales
  return sales.filter(s => saleType === "Upsell"
    ? (s.upsell_qty > 0 || s.upsell_amount > 0)
    : (s.cross_qty > 0 || s.cross_amount > 0))
}

/** Type-aware amount of one sale row — matches what the columns display. */
function amtOfRow(s: TmSale, saleType: SaleTypeFilter): number {
  return saleType === "Upsell" ? s.upsell_amount : saleType === "Cross-sell" ? s.cross_amount : s.total_amount
}

/**
 * One bucket's KPIs. Always goes through computeTmKpis (same conversion /
 * contact-rate definition as the dashboard); a sale-type filter only zeroes the
 * other side and re-points the totals at the selected side.
 */
function bucketKpis(sales: TmSale[], calls: TmCall[], saleType: SaleTypeFilter): TmKpis {
  const rows = typeRows(activeSales(sales), saleType)
  const k = computeTmKpis(rows, calls)
  if (saleType === "All") return k
  const up = saleType === "Upsell"
  const orders = up ? k.upsellOrders : k.crossOrders
  const amount = up ? k.upsellAmount : k.crossAmount
  return {
    ...k,
    upsellOrders: up ? k.upsellOrders : 0, upsellAmount: up ? k.upsellAmount : 0,
    crossOrders: up ? 0 : k.crossOrders, crossAmount: up ? 0 : k.crossAmount,
    totalOrders: orders, totalSales: amount,
    avgOrderValue: orders > 0 ? amount / orders : 0,
    salesPerConnectedCall: k.connectedCalls > 0 ? amount / k.connectedCalls : 0,
    ordersPerConnectedCall: k.connectedCalls > 0 ? orders / k.connectedCalls : 0,
  }
}

interface HourRow {
  key: string
  hour: number            // -1 = the "Outside hours" aggregate row
  outside: boolean
  label: string
  short: string
  k: TmKpis
  activeDays: number      // monthly: distinct days with any activity in this hour
  avgPerDay: number       // monthly: sales ÷ activeDays
  bestDay: string         // monthly: date with the highest sales in this hour
  bestDayAmount: number
}

// ────────────────────────────────────────────────────────────────────────────
// Small UI pieces (module scope — never nested inside the page component)
// ────────────────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color, icon: Icon, tip, valueClass }: {
  label: string; value: string; sub?: string; color: string; icon: any; tip?: string; valueClass?: string
}) {
  return (
    <div title={tip}
      className={`relative overflow-hidden ${color} rounded-xl px-3 py-2.5 sm:px-4 sm:py-3 cursor-default hover:opacity-95 transition-opacity flex items-center justify-between h-[70px] sm:h-[78px]`}>
      <div className="absolute left-0 top-0 bottom-0 flex items-center pointer-events-none select-none">
        <Icon strokeWidth={1} className="w-16 h-16 opacity-[0.08] text-white -ml-2" />
      </div>
      <div className="text-right ml-auto z-10 min-w-0">
        <p className={`font-bold text-white leading-none truncate ${valueClass ?? "text-lg sm:text-2xl"}`}>{value}</p>
        <p className="text-[11px] text-white/70 font-semibold mt-1 tracking-wider uppercase leading-tight">{label}</p>
        {sub && <p className="text-[10px] text-white/60 font-medium leading-tight mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  )
}

function ChartPanel({ title, shown, onToggle, loaded, extra, children }: {
  title: string; shown: boolean; onToggle: () => void; loaded: boolean
  extra?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <p className="text-sm font-bold text-slate-700 uppercase tracking-wide">{title}</p>
        <div className="flex items-center gap-2">
          {shown && extra}
          <button onClick={onToggle}
            className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${shown ? "border-blue-200 bg-blue-50 text-blue-600" : "border-slate-200 bg-slate-50 text-slate-400"}`}>
            {shown ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            {shown ? "Shown" : "Hidden"}
          </button>
        </div>
      </div>
      {shown && (loaded ? children : <ChartSkeleton height={280} />)}
    </div>
  )
}

function Chip({ active, onClick, icon: Icon, children }: {
  active: boolean; onClick: () => void; icon?: any; children: React.ReactNode
}) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 h-9 px-3 rounded-full border text-xs font-semibold transition-colors ${active ? "border-blue-200 bg-blue-50 text-blue-600" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50/70"}`}>
      {Icon && <Icon className="w-3.5 h-3.5" />}
      {children}
    </button>
  )
}

const TH = "px-3 py-2.5 font-semibold"
const TD = "px-3 py-2.5"
const NUM = "px-3 py-2.5 text-right tabular-nums"

// ────────────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────────────
export default function TmHourlyPage() {
  const [view, setView] = useState<ViewMode>("daily")
  const [day, setDay] = useState(todayStr())
  const [month, setMonth] = useState(thisMonthStr())
  const [agentF, setAgentF] = useState("")
  const [saleType, setSaleType] = useState<SaleTypeFilter>("All")
  const [chartShown, setChartShown] = useState(true)
  const [showOrders, setShowOrders] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const salesStore = useTmSales()
  const callsStore = useTmCalls()
  const agentsStore = useTmAgents()
  const settings = useTmSettings()

  const { sales } = salesStore
  const { calls } = callsStore
  const { agents } = agentsStore

  const coreLoaded = salesStore.loaded && callsStore.loaded
  const allLoaded = coreLoaded && settings.loaded

  const refreshAll = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([salesStore.refresh(), callsStore.refresh(), agentsStore.refresh()])
    } finally { setRefreshing(false) }
  }, [salesStore.refresh, callsStore.refresh, agentsStore.refresh])

  const agentOptions = useMemo(
    () => agents.filter(a => a.status === "Active").sort((a, b) => a.agent_name.localeCompare(b.agent_name)),
    [agents])

  // ── Configured hour window (defensive: a bad blob must not blank the page) ──
  const [hs, he] = useMemo(() => {
    const rs = settings.hourBlocks?.start, re = settings.hourBlocks?.end
    const start = Number.isFinite(rs) && rs >= 0 && rs <= 23 ? Math.floor(rs) : DEFAULT_HOUR_BLOCKS.start
    const endRaw = Number.isFinite(re) && re >= 1 && re <= 24 ? Math.floor(re) : DEFAULT_HOUR_BLOCKS.end
    return [start, endRaw > start ? endRaw : Math.min(24, start + 1)] as [number, number]
  }, [settings.hourBlocks])

  // ── Rows in scope for the selected view (date/month + agent; type-aware) ──
  const inScope = useCallback((d: string) => view === "daily" ? d === day : d.slice(0, 7) === month, [view, day, month])

  const scopedSales = useMemo(
    () => typeRows(
      activeSales(sales).filter(s => inScope(s.sale_date) && (!agentF || s.agent_id === agentF)),
      saleType),
    [sales, inScope, agentF, saleType])
  const scopedCalls = useMemo(
    () => calls.filter(c => inScope(c.call_date) && (!agentF || c.agent_id === agentF)),
    [calls, inScope, agentF])

  // ── Bucketing (§9) ──
  const rows = useMemo<HourRow[]>(() => {
    const bucketSales = new Map<number, TmSale[]>()
    const bucketCalls = new Map<number, TmCall[]>()
    const outSales: TmSale[] = []
    const outCalls: TmCall[] = []
    for (let h = hs; h < he; h++) { bucketSales.set(h, []); bucketCalls.set(h, []) }

    for (const s of scopedSales) {
      const h = hourOfTime(s.sale_time)
      const bin = bucketSales.get(h)
      if (h >= hs && h < he && bin) bin.push(s); else outSales.push(s)
    }
    for (const c of scopedCalls) {
      const h = hourOfTime(c.call_time)
      const bin = bucketCalls.get(h)
      if (h >= hs && h < he && bin) bin.push(c); else outCalls.push(c)
    }

    // Monthly extras: per-hour per-day sales + the days that showed any activity.
    const build = (hour: number, sIn: TmSale[], cIn: TmCall[], outside: boolean): HourRow => {
      const k = bucketKpis(sIn, cIn, saleType)
      const perDay = new Map<string, number>()
      const days = new Set<string>()
      if (view === "monthly") {
        for (const s of sIn) {
          const amt = amtOfRow(s, saleType)
          perDay.set(s.sale_date, (perDay.get(s.sale_date) || 0) + amt)
          if (s.sale_date) days.add(s.sale_date)
        }
        for (const c of cIn) if (c.call_date) days.add(c.call_date)
      }
      let bestDay = "", bestDayAmount = 0
      for (const [d, amt] of perDay) if (amt > bestDayAmount) { bestDay = d; bestDayAmount = amt }
      const activeDays = days.size
      return {
        key: outside ? "outside" : `h${hour}`,
        hour, outside,
        label: outside ? "Outside hours" : hourLabel(hour),
        short: outside ? "Outside" : shortHour(hour),
        k, activeDays,
        avgPerDay: activeDays > 0 ? k.totalSales / activeDays : 0,
        bestDay, bestDayAmount,
      }
    }

    const out: HourRow[] = []
    for (let h = hs; h < he; h++) out.push(build(h, bucketSales.get(h) ?? [], bucketCalls.get(h) ?? [], false))
    if (outSales.length > 0 || outCalls.length > 0) out.push(build(-1, outSales, outCalls, true))
    return out
  }, [scopedSales, scopedCalls, hs, he, saleType, view])

  const outsideRow = rows.find(r => r.outside) ?? null

  // ── Footer totals — recomputed from the RAW rows, never averaged rates (§8) ──
  const totals = useMemo(() => bucketKpis(scopedSales, scopedCalls, saleType), [scopedSales, scopedCalls, saleType])

  // Month-level Avg Sales/Day + Best Day for the footer.
  const monthWide = useMemo(() => {
    const perDay = new Map<string, number>()
    const days = new Set<string>()
    for (const s of scopedSales) {
      perDay.set(s.sale_date, (perDay.get(s.sale_date) || 0) + amtOfRow(s, saleType))
      if (s.sale_date) days.add(s.sale_date)
    }
    for (const c of scopedCalls) if (c.call_date) days.add(c.call_date)
    let bestDay = "", bestDayAmount = 0
    for (const [d, amt] of perDay) if (amt > bestDayAmount) { bestDay = d; bestDayAmount = amt }
    return { activeDays: days.size, avgPerDay: days.size > 0 ? totals.totalSales / days.size : 0, bestDay, bestDayAmount }
  }, [scopedSales, scopedCalls, saleType, totals.totalSales])

  // ── Peak hour (in-window rows only; the muted Outside row never wins) ──
  const peak = useMemo(() => {
    let best: HourRow | null = null
    for (const r of rows) if (!r.outside && r.k.totalSales > 0 && (!best || r.k.totalSales > best.k.totalSales)) best = r
    return best
  }, [rows])

  // ── Chart data ──
  const chartData = useMemo(
    () => rows.map(r => ({ x: r.short, range: r.label, sales: r.k.totalSales, orders: r.k.totalOrders })),
    [rows])
  const chartEmpty = chartData.every(d => d.sales === 0 && d.orders === 0)

  const periodLabel = view === "daily"
    ? (day ? format(new Date(`${day}T00:00:00`), "EEEE, MMM d, yyyy") : "—")
    : (month ? format(new Date(`${month}-01T00:00:00`), "MMMM yyyy") : "—")

  const cards = [
    { label: "Total Orders", value: fmtNum(totals.totalOrders), color: "bg-violet-600", icon: ShoppingCart },
    { label: "Total Sales", value: peso(totals.totalSales), color: "bg-emerald-600", icon: Wallet },
    { label: "Calls Made", value: fmtNum(totals.callsMade), color: "bg-sky-600", icon: Phone },
    { label: "Connected", value: fmtNum(totals.connectedCalls), color: "bg-blue-600", icon: PhoneCall },
    { label: "Contact Rate", value: fmtPct(totals.contactRate), color: "bg-indigo-500", icon: Percent,
      sub: `Conversion ${fmtPct(totals.conversionRate)}` },
    { label: peak ? `Best Hour · ${peso(peak.k.totalSales)}` : "Best Hour", value: peak ? peak.label : "—",
      color: "bg-amber-600", icon: Sunrise, valueClass: "text-sm sm:text-base",
      sub: peak ? `${fmtNum(peak.k.totalOrders)} order${peak.k.totalOrders === 1 ? "" : "s"}` : "No timed sales yet",
      tip: "Top-selling hour block for the selected period" },
  ]

  const inputCls = "h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
  const rowTone = (r: HourRow) => {
    if (r.outside) return "bg-slate-50/60 text-slate-400 italic"
    if (peak && r.hour === peak.hour) return "bg-emerald-50"
    const dead = r.k.totalSales === 0 && r.k.totalOrders === 0 && r.k.callsMade === 0
    return dead ? "text-slate-400" : "hover:bg-slate-50/70"
  }

  return (
    <div className="w-full space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-4 mb-1 border-b border-slate-100">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Clock3 className="w-5 h-5" /> HOURLY SALES</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Chip active={view === "daily"} onClick={() => setView("daily")} icon={CalendarDays}>Daily</Chip>
            <Chip active={view === "monthly"} onClick={() => setView("monthly")} icon={CalendarRange}>Monthly Analysis</Chip>
          </div>
          {view === "daily" ? (
            <input type="date" value={day} onChange={e => setDay(e.target.value || todayStr())} className={inputCls} />
          ) : (
            <input type="month" value={month} onChange={e => setMonth(e.target.value || thisMonthStr())} className={inputCls} />
          )}
          <select value={agentF} onChange={e => setAgentF(e.target.value)} className={inputCls}>
            <option value="">All Agents</option>
            {agentOptions.map(a => <option key={a.id} value={a.id}>{a.agent_name}</option>)}
          </select>
          <select value={saleType} onChange={e => setSaleType(e.target.value as SaleTypeFilter)} className={inputCls}>
            <option value="All">All sale types</option>
            <option value="Upsell">Upsell</option>
            <option value="Cross-sell">Cross-sell</option>
          </select>
          <button onClick={refreshAll} title="Refresh telemarketing data"
            className="h-9 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50/70">
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500 font-medium">
        {periodLabel} · {shortHour(hs)}–{shortHour(he % 24)} blocks · {scopedSales.length} sale{scopedSales.length === 1 ? "" : "s"} · {scopedCalls.length} call{scopedCalls.length === 1 ? "" : "s"}
        {saleType !== "All" ? ` · ${saleType} only` : ""}
        {view === "monthly" ? ` · ${monthWide.activeDays} active day${monthWide.activeDays === 1 ? "" : "s"}` : ""}
      </p>

      {/* ── KPI strip ── */}
      {allLoaded ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {cards.map(c => <StatCard key={c.label} {...c} />)}
        </div>
      ) : <StatCardsSkeleton count={6} height="h-[70px] sm:h-[78px]" className="grid grid-cols-2 sm:grid-cols-3 gap-2.5" />}

      {/* ── Chart ── */}
      <ChartPanel
        title={view === "daily" ? "Sales per Hour" : "Sales per Hour (Month Total)"}
        shown={chartShown} onToggle={() => setChartShown(s => !s)} loaded={allLoaded}
        extra={
          <Chip active={showOrders} onClick={() => setShowOrders(s => !s)} icon={ShoppingCart}>
            {showOrders ? "Orders on" : "Orders off"}
          </Chip>
        }>
        {chartEmpty ? (
          <p className="text-sm text-slate-400 text-center py-16">
            No timed activity for this {view === "daily" ? "day" : "month"}.
          </p>
        ) : (
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="x" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="sales" tick={{ fontSize: 10 }} width={70}
                  tickFormatter={(v: number) => v.toLocaleString("en-PH")} />
                {showOrders && <YAxis yAxisId="orders" orientation="right" tick={{ fontSize: 10 }} width={44} allowDecimals={false} />}
                <RTooltip
                  formatter={(v: any, name: any) => name === "Sales" ? peso(Number(v)) : fmtNum(Number(v))}
                  labelFormatter={(_: any, payload: any) => payload?.[0]?.payload?.range ?? ""} />
                {showOrders && <Legend />}
                <Bar yAxisId="sales" dataKey="sales" name="Sales" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
                {showOrders && <Bar yAxisId="orders" dataKey="orders" name="Orders" fill="#a78bfa" radius={[3, 3, 0, 0]} />}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </ChartPanel>

      {/* ── Table ── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <p className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3">
          {view === "daily" ? "Hourly Breakdown" : "Monthly Hourly Analysis"}
        </p>

        {!allLoaded ? <TableSkeleton rows={8} cols={view === "daily" ? 11 : 9} /> : (
          <div className="overflow-x-auto">
            {view === "daily" ? (
              <table className="w-full text-sm min-w-[1100px]">
                <thead>
                  <tr className="bg-slate-50 border-y border-slate-200 text-xs text-slate-600">
                    <th className={`text-left ${TH}`}>Time</th>
                    <th className={`text-right ${TH}`}>Upsell Orders</th>
                    <th className={`text-right ${TH}`}>Upsell Amount</th>
                    <th className={`text-right ${TH}`}>Cross-sell Orders</th>
                    <th className={`text-right ${TH}`}>Cross-sell Amount</th>
                    <th className={`text-right ${TH}`}>Total Orders</th>
                    <th className={`text-right ${TH}`}>Total Sales</th>
                    <th className={`text-right ${TH}`}>Calls Made</th>
                    <th className={`text-right ${TH}`}>Connected</th>
                    <th className={`text-right ${TH}`}>Contact Rate</th>
                    <th className={`text-right ${TH}`}>Conversion Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.key} className={`border-b border-slate-100 ${rowTone(r)}`}>
                      <td className={`${TD} font-medium ${r.outside ? "" : "text-slate-700"}`}>{r.label}</td>
                      <td className={NUM}>{fmtNum(r.k.upsellOrders)}</td>
                      <td className={NUM}>{peso(r.k.upsellAmount)}</td>
                      <td className={NUM}>{fmtNum(r.k.crossOrders)}</td>
                      <td className={NUM}>{peso(r.k.crossAmount)}</td>
                      <td className={`${NUM} font-semibold`}>{fmtNum(r.k.totalOrders)}</td>
                      <td className={`${NUM} font-semibold`}>{peso(r.k.totalSales)}</td>
                      <td className={NUM}>{fmtNum(r.k.callsMade)}</td>
                      <td className={NUM}>{fmtNum(r.k.connectedCalls)}</td>
                      <td className={NUM}>{fmtPct(r.k.contactRate)}</td>
                      <td className={NUM}>{fmtPct(r.k.conversionRate)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-800">
                    <td className={`${TD} text-xs uppercase`}>Daily Total</td>
                    <td className={NUM}>{fmtNum(totals.upsellOrders)}</td>
                    <td className={NUM}>{peso(totals.upsellAmount)}</td>
                    <td className={NUM}>{fmtNum(totals.crossOrders)}</td>
                    <td className={NUM}>{peso(totals.crossAmount)}</td>
                    <td className={NUM}>{fmtNum(totals.totalOrders)}</td>
                    <td className={NUM}>{peso(totals.totalSales)}</td>
                    <td className={NUM}>{fmtNum(totals.callsMade)}</td>
                    <td className={NUM}>{fmtNum(totals.connectedCalls)}</td>
                    <td className={NUM}>{fmtPct(totals.contactRate)}</td>
                    <td className={NUM}>{fmtPct(totals.conversionRate)}</td>
                  </tr>
                </tfoot>
              </table>
            ) : (
              <table className="w-full text-sm min-w-[980px]">
                <thead>
                  <tr className="bg-slate-50 border-y border-slate-200 text-xs text-slate-600">
                    <th className={`text-left ${TH}`}>Time</th>
                    <th className={`text-right ${TH}`}>Orders</th>
                    <th className={`text-right ${TH}`}>Sales</th>
                    <th className={`text-right ${TH}`}>Calls</th>
                    <th className={`text-right ${TH}`}>Connected</th>
                    <th className={`text-right ${TH}`}>Contact Rate</th>
                    <th className={`text-right ${TH}`}>Conversion</th>
                    <th className={`text-right ${TH}`}>Avg Sales/Day</th>
                    <th className={`text-right ${TH}`}>Best Day</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.key} className={`border-b border-slate-100 ${rowTone(r)}`}>
                      <td className={`${TD} font-medium ${r.outside ? "" : "text-slate-700"}`}>{r.label}</td>
                      <td className={`${NUM} font-semibold`}>{fmtNum(r.k.totalOrders)}</td>
                      <td className={`${NUM} font-semibold`}>{peso(r.k.totalSales)}</td>
                      <td className={NUM}>{fmtNum(r.k.callsMade)}</td>
                      <td className={NUM}>{fmtNum(r.k.connectedCalls)}</td>
                      <td className={NUM}>{fmtPct(r.k.contactRate)}</td>
                      <td className={NUM}>{fmtPct(r.k.conversionRate)}</td>
                      <td className={NUM} title={r.activeDays > 0 ? `${r.activeDays} active day${r.activeDays === 1 ? "" : "s"} in this hour` : undefined}>
                        {peso(r.avgPerDay)}
                      </td>
                      <td className={NUM}>
                        {r.bestDay ? (
                          <span className="inline-flex flex-col items-end leading-tight">
                            <span className="font-semibold">{prettyDate(r.bestDay)}</span>
                            <span className="text-[10px] text-slate-400">{peso(r.bestDayAmount)}</span>
                          </span>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-800">
                    <td className={`${TD} text-xs uppercase`}>Month Total</td>
                    <td className={NUM}>{fmtNum(totals.totalOrders)}</td>
                    <td className={NUM}>{peso(totals.totalSales)}</td>
                    <td className={NUM}>{fmtNum(totals.callsMade)}</td>
                    <td className={NUM}>{fmtNum(totals.connectedCalls)}</td>
                    <td className={NUM}>{fmtPct(totals.contactRate)}</td>
                    <td className={NUM}>{fmtPct(totals.conversionRate)}</td>
                    <td className={NUM}>{peso(monthWide.avgPerDay)}</td>
                    <td className={NUM}>
                      {monthWide.bestDay ? (
                        <span className="inline-flex flex-col items-end leading-tight">
                          <span>{prettyDate(monthWide.bestDay)}</span>
                          <span className="text-[10px] font-semibold text-slate-500">{peso(monthWide.bestDayAmount)}</span>
                        </span>
                      ) : "—"}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        )}

        {/* Notes — the "Outside hours" row is never silent, and rates are never averaged. */}
        <div className="mt-3 space-y-1">
          {outsideRow && (
            <p className="text-[11px] text-amber-600 font-medium">
              “Outside hours” holds {outsideRow.k.totalOrders > 0 || outsideRow.k.totalSales > 0
                ? `${fmtNum(outsideRow.k.totalOrders)} order${outsideRow.k.totalOrders === 1 ? "" : "s"} (${peso(outsideRow.k.totalSales)})`
                : "no sales"}{outsideRow.k.callsMade > 0 ? ` and ${fmtNum(outsideRow.k.callsMade)} call${outsideRow.k.callsMade === 1 ? "" : "s"}` : ""} logged
              outside the configured {shortHour(hs)}–{shortHour(he % 24)} window (or with an unreadable timestamp). It is included in the total —
              widen the hour blocks in Telemarketing Settings to break it down.
            </p>
          )}
          <p className="text-[11px] text-slate-400">
            Buckets are auto-derived from sale/call timestamps (10:37 → 10:00–11:00). Cancelled sales excluded.
            Contact Rate and Conversion in the footer are recomputed from the raw counts, not averaged across hours.
            {peak ? " Peak hour is highlighted green." : ""}
          </p>
        </div>
      </div>

      <div className="pb-4" />
    </div>
  )
}
