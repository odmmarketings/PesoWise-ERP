"use client"
// ────────────────────────────────────────────────────────────────────────────
// Agent Performance (docs/telemarketing-spec.md §11 scorecard, §16 call metrics,
// §23 leaderboard, §24 KPI score, §25 product performance, §30 efficiency, §6–7 targets).
//
// Three chip-tabbed views over ONE filtered dataset: LEADERBOARD · SCORECARD · PRODUCTS.
// Every figure comes from tm_sales / tm_calls / tm_leads filtered to the selected date
// range (sale_date / call_date inside [dateA, dateB]); Cancelled sales are excluded via
// activeSales(). Per-agent grouping key matches the dashboard exactly: agent_id || agent_name.
// The agent-table conversion definition is copied from the dashboard so the two pages can
// never disagree:  convBase = distinct connected lead_ids (fallback connected calls),
// convHits = distinct sold lead_ids (fallback sale rows), conversion = min(100, hits/base×100).
//
// ══════════════════════════════════════════════════════════════════════════
// KPI SCORE FORMULA (spec §24) — implemented in computeKpiScore() below
// ══════════════════════════════════════════════════════════════════════════
// Seven components, each first reduced to a 0–100 sub-score (clamped), then weighted by
// the admin-configurable weights in tm_settings.kpi_weights (they sum to 100 by default:
// sales 30 · orders 15 · conversion 20 · contact 10 · upsell 10 · cross-sell 10 · productivity 5).
//
//   1. sales_achievement   = clamp( month-to-date sales  ÷ agent's sales_target  × 100 )
//   2. orders_achievement  = clamp( month-to-date orders ÷ agent's orders_target × 100 )
//        Both read the agent's CURRENT-MONTH row in tm_targets (same rule as the dashboard's
//        Target % column: targets are monthly, so achievement is month-to-date, NOT range-to-date).
//        No target row (or a zero target) → the component is "no target" (N/A), never 0.
//   3. conversion   = clamp( agent conversion% ÷ conversion_target × 100 ) when the agent has a
//        conversion_target set; otherwise RELATIVE: clamp( agent ÷ best-in-range × 100 ).
//   4. contact_rate = RELATIVE: clamp( agent contact% ÷ best contact% in range × 100 ).
//        3 and 4 are N/A when the measurement has no base (no connected customers / no calls in
//        range) or when nobody in range scored above zero — an agent is not punished for a metric
//        that cannot be measured.
//   5. upsell     = clamp( agent upsell revenue    ÷ top agent's upsell revenue    × 100 )
//   6. cross_sell = clamp( agent cross-sell revenue ÷ top agent's cross-sell revenue × 100 )
//   7. productivity = clamp( agent calls made ÷ top caller's calls × 100 )
//        5–7 are N/A only when the whole team scored zero in range (no top performer to rank against).
//
// RENORMALISATION: only the AVAILABLE (non-N/A) components are scored. Each gets
//   effWeight = weight ÷ Σ(weights of available components) × 100
//   points    = subScore × effWeight ÷ 100
//   KPI SCORE = Σ points  (0–100, rounded for display)
// So an agent with no target row is scored purely on the remaining components instead of being
// dragged down by a zero — and the breakdown table always shows weight · raw value · sub-score ·
// weighted points for every component, including the N/A ones and their reason (spec §24 requires
// management to see WHY a score came out the way it did).
// If NO component is available at all the score renders "—", never 0.
// ────────────────────────────────────────────────────────────────────────────
import { Fragment, useCallback, useMemo, useState } from "react"
import { format, startOfMonth } from "date-fns"
import {
  Award, RefreshCw, Trophy, Medal, ChevronDown, ChevronRight, Target, Wallet,
  ShoppingCart, Layers, TrendingUp, Phone, Percent, Sparkles,
  Clock, Gauge, Package, ListOrdered, UserCheck, Calculator,
} from "lucide-react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import { StatCardsSkeleton, TableSkeleton, ChartSkeleton } from "@/components/business/Skeleton"
import {
  useTmSales, useTmCalls, useTmLeads, useTmAgents, useTmTargets, useTmSettings,
  computeTmKpis, activeSales, remainingWorkingDays, requiredDailyPace, hourOfTime,
  WON_LEAD_STATUSES, todayStr, thisMonthStr,
  type TmKpiWeights, type TmLead,
} from "@/lib/telemarketing-store"

// ────────────────────────────────────────────────────────────────────────────
// Local helpers (peso helper matches the module convention — ₱ written via the Write tool)
// ────────────────────────────────────────────────────────────────────────────
const peso = (n: number) => "₱" + (isFinite(n) ? n : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtNum = (n: number) => (isFinite(n) ? n : 0).toLocaleString("en-PH")
const fmtPct = (n: number) => `${(isFinite(n) ? n : 0).toFixed(1)}%`
const fmtDec = (n: number) => (isFinite(n) ? n : 0).toFixed(2)
const clamp100 = (n: number) => (!isFinite(n) || n < 0 ? 0 : n > 100 ? 100 : n)

function defaultDateA() { return format(startOfMonth(new Date()), "yyyy-MM-dd") }
function defaultDateB() { return format(new Date(), "yyyy-MM-dd") }

const MONEY = "px-3 py-2.5 text-right tabular-nums"
const NO_PRODUCT = "(unspecified)"

type ViewKey = "leaderboard" | "scorecard" | "products"
const VIEWS: { key: ViewKey; label: string }[] = [
  { key: "leaderboard", label: "Leaderboard" },
  { key: "scorecard", label: "Scorecard" },
  { key: "products", label: "Products" },
]

const RANK_METRICS = [
  { key: "sales", label: "Total Sales" },
  { key: "upsell", label: "Upsell Sales" },
  { key: "cross", label: "Cross-sell Sales" },
  { key: "conversion", label: "Conversion Rate" },
  { key: "contact", label: "Contact Rate" },
  { key: "orders", label: "Orders" },
  { key: "target", label: "Target Achievement" },
  { key: "kpi", label: "KPI Score" },
] as const
type RankMetric = typeof RANK_METRICS[number]["key"]

// ────────────────────────────────────────────────────────────────────────────
// Per-agent aggregate + KPI score types
// ────────────────────────────────────────────────────────────────────────────
interface AgentAgg {
  id: string; name: string; roster: boolean; inactive: boolean
  upOrders: number; upAmt: number; crossOrders: number; crossAmt: number
  totalOrders: number; totalSales: number
  calls: number; connected: number; salesRows: number
  connectedLeads: Set<string>; soldLeads: Set<string>
}
interface AgentRow extends AgentAgg {
  hasData: boolean
  contactRate: number; conversion: number; convBase: number; aov: number
  monthSales: number; monthOrders: number
  targetSales: number; targetOrders: number; conversionTarget: number
  targetPct: number | null
  kpi: KpiScore
}
interface KpiCompRow {
  key: keyof TmKpiWeights; label: string; weight: number
  raw: string; sub: number | null; na?: string
  effWeight: number; points: number
}
interface KpiScore { score: number | null; rows: KpiCompRow[]; usedWeight: number }
interface KpiCtx {
  weights: TmKpiWeights
  bestConversion: number; bestContact: number
  topUpsell: number; topCross: number; topCalls: number
}

// Pure — see the formula block at the top of this file.
function computeKpiScore(a: Omit<AgentRow, "kpi">, ctx: KpiCtx): KpiScore {
  const w = ctx.weights
  type Draft = { key: keyof TmKpiWeights; label: string; raw: string; sub: number | null; na?: string }
  const drafts: Draft[] = []

  // 1 · Sales achievement (month-to-date vs the agent's monthly sales target)
  drafts.push(a.targetSales > 0
    ? { key: "sales_achievement", label: "Sales Achievement", sub: clamp100((a.monthSales / a.targetSales) * 100),
        raw: `${peso(a.monthSales)} of ${peso(a.targetSales)} (month-to-date)` }
    : { key: "sales_achievement", label: "Sales Achievement", sub: null, na: "no target",
        raw: "walang monthly sales target sa agent na ito" })

  // 2 · Orders achievement (month-to-date vs the agent's monthly orders target)
  drafts.push(a.targetOrders > 0
    ? { key: "orders_achievement", label: "Orders Achievement", sub: clamp100((a.monthOrders / a.targetOrders) * 100),
        raw: `${fmtNum(a.monthOrders)} of ${fmtNum(a.targetOrders)} orders (month-to-date)` }
    : { key: "orders_achievement", label: "Orders Achievement", sub: null, na: "no target",
        raw: "walang monthly orders target sa agent na ito" })

  // 3 · Conversion — against conversion_target when set, else relative to the best in range
  if (a.convBase <= 0) {
    drafts.push({ key: "conversion", label: "Conversion Rate", sub: null, na: "no base", raw: "walang connected customer sa range" })
  } else if (a.conversionTarget > 0) {
    drafts.push({ key: "conversion", label: "Conversion Rate", sub: clamp100((a.conversion / a.conversionTarget) * 100),
      raw: `${fmtPct(a.conversion)} vs target ${fmtPct(a.conversionTarget)}` })
  } else if (ctx.bestConversion > 0) {
    drafts.push({ key: "conversion", label: "Conversion Rate", sub: clamp100((a.conversion / ctx.bestConversion) * 100),
      raw: `${fmtPct(a.conversion)} vs best ${fmtPct(ctx.bestConversion)} (relative)` })
  } else {
    drafts.push({ key: "conversion", label: "Conversion Rate", sub: null, na: "no ranking base", raw: "walang nag-convert sa range" })
  }

  // 4 · Contact rate — always relative to the best contact rate in range
  if (a.calls <= 0) {
    drafts.push({ key: "contact_rate", label: "Contact Rate", sub: null, na: "no calls", raw: "walang tawag sa range" })
  } else if (ctx.bestContact > 0) {
    drafts.push({ key: "contact_rate", label: "Contact Rate", sub: clamp100((a.contactRate / ctx.bestContact) * 100),
      raw: `${fmtPct(a.contactRate)} vs best ${fmtPct(ctx.bestContact)} (relative)` })
  } else {
    drafts.push({ key: "contact_rate", label: "Contact Rate", sub: null, na: "no ranking base", raw: "walang connected call sa range" })
  }

  // 5 · Upsell revenue share vs the top upseller
  drafts.push(ctx.topUpsell > 0
    ? { key: "upsell", label: "Upsell Revenue", sub: clamp100((a.upAmt / ctx.topUpsell) * 100),
        raw: `${peso(a.upAmt)} vs top ${peso(ctx.topUpsell)} (relative)` }
    : { key: "upsell", label: "Upsell Revenue", sub: null, na: "no ranking base", raw: "walang upsell sa range" })

  // 6 · Cross-sell revenue share vs the top cross-seller
  drafts.push(ctx.topCross > 0
    ? { key: "cross_sell", label: "Cross-sell Revenue", sub: clamp100((a.crossAmt / ctx.topCross) * 100),
        raw: `${peso(a.crossAmt)} vs top ${peso(ctx.topCross)} (relative)` }
    : { key: "cross_sell", label: "Cross-sell Revenue", sub: null, na: "no ranking base", raw: "walang cross-sell sa range" })

  // 7 · Productivity — calls made vs the top caller
  drafts.push(ctx.topCalls > 0
    ? { key: "productivity", label: "Productivity (calls)", sub: clamp100((a.calls / ctx.topCalls) * 100),
        raw: `${fmtNum(a.calls)} calls vs top ${fmtNum(ctx.topCalls)} (relative)` }
    : { key: "productivity", label: "Productivity (calls)", sub: null, na: "no ranking base", raw: "walang tawag sa range" })

  const usedWeight = drafts.reduce((n, d) => n + (d.sub === null ? 0 : (w[d.key] || 0)), 0)
  const rows: KpiCompRow[] = drafts.map(d => {
    const weight = w[d.key] || 0
    const effWeight = d.sub === null || usedWeight <= 0 ? 0 : (weight / usedWeight) * 100
    return { ...d, weight, effWeight, points: d.sub === null ? 0 : (d.sub * effWeight) / 100 }
  })
  const score = usedWeight > 0 ? rows.reduce((n, r) => n + r.points, 0) : null
  return { score, rows, usedWeight }
}

// ────────────────────────────────────────────────────────────────────────────
// Small UI pieces (module scope — never nested inside another component)
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

function Panel({ title, icon: Icon, right, children }: {
  title: string; icon?: any; right?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <p className="text-sm font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-blue-500" />}{title}
        </p>
        {right}
      </div>
      {children}
    </div>
  )
}

function EmptyPanel({ note }: { note?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-10 text-center">
      <Sparkles className="w-6 h-6 text-slate-300 mx-auto mb-2" />
      <p className="text-sm font-semibold text-slate-500">Walang data sa piniling range</p>
      <p className="text-xs text-slate-400 mt-1">{note ?? "Palitan ang date range o mag-encode muna ng sales/calls."}</p>
    </div>
  )
}

const scoreTone = (s: number) => s >= 80 ? "bg-emerald-500" : s >= 60 ? "bg-blue-500" : s >= 40 ? "bg-amber-500" : "bg-red-500"
const scoreText = (s: number) => s >= 80 ? "text-emerald-600" : s >= 60 ? "text-blue-600" : s >= 40 ? "text-amber-600" : "text-red-600"

function ScoreBar({ score, wide = false }: { score: number | null; wide?: boolean }) {
  if (score === null) return <span className="text-slate-400 text-xs">— no basis</span>
  return (
    <div className={`inline-flex items-center gap-2 ${wide ? "w-full" : ""}`}>
      <span className={`tabular-nums font-bold ${scoreText(score)}`}>{Math.round(score)}<span className="text-[10px] font-semibold text-slate-400">/100</span></span>
      <span className={`h-1.5 rounded-full bg-slate-100 overflow-hidden ${wide ? "flex-1" : "w-16"}`}>
        <span className={`block h-full rounded-full ${scoreTone(score)}`} style={{ width: `${clamp100(score)}%` }} />
      </span>
    </div>
  )
}

function RankBadge({ rank }: { rank: number }) {
  const tone = rank === 1 ? "bg-amber-100 text-amber-800" : rank === 2 ? "bg-slate-200 text-slate-700"
    : rank === 3 ? "bg-orange-100 text-orange-800" : "bg-slate-50 text-slate-500"
  return (
    <span className={`inline-flex items-center justify-center gap-1 min-w-[2.25rem] px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums ${tone}`}>
      {rank <= 3 && (rank === 1 ? <Trophy className="w-3 h-3" /> : <Medal className="w-3 h-3" />)}{rank}
    </span>
  )
}

// The §24 breakdown: weight · raw value · sub-score · weighted points for every component.
function KpiBreakdown({ kpi, agentName }: { kpi: KpiScore; agentName: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <Calculator className="w-3.5 h-3.5" /> KPI breakdown — {agentName}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[620px]">
          <thead>
            <tr className="text-slate-500 border-b border-slate-200">
              <th className="text-left px-2 py-1.5 font-semibold">Component</th>
              <th className="text-right px-2 py-1.5 font-semibold">Weight</th>
              <th className="text-left px-2 py-1.5 font-semibold">Raw value</th>
              <th className="text-right px-2 py-1.5 font-semibold">Sub-score</th>
              <th className="text-right px-2 py-1.5 font-semibold">Eff. weight</th>
              <th className="text-right px-2 py-1.5 font-semibold">Points</th>
            </tr>
          </thead>
          <tbody>
            {kpi.rows.map(r => (
              <tr key={r.key} className={`border-b border-slate-100 ${r.sub === null ? "opacity-70" : ""}`}>
                <td className="px-2 py-1.5 font-medium text-slate-700">{r.label}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{r.weight}</td>
                <td className="px-2 py-1.5 text-slate-500">{r.raw}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {r.sub === null
                    ? <span className="px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600 font-semibold">{r.na ?? "n/a"}</span>
                    : <span className={`font-semibold ${scoreText(r.sub)}`}>{r.sub.toFixed(1)}</span>}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{r.sub === null ? "—" : `${r.effWeight.toFixed(1)}`}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-slate-700">{r.sub === null ? "—" : r.points.toFixed(2)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-300 font-bold text-slate-800">
              <td className="px-2 py-1.5 uppercase text-[11px]">KPI Score</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{kpi.usedWeight}</td>
              <td className="px-2 py-1.5 text-slate-500 font-medium">
                {kpi.usedWeight > 0
                  ? "weights ng available components ay ini-renormalize sa 100"
                  : "walang measurable component"}
              </td>
              <td />
              <td />
              <td className="px-2 py-1.5 text-right tabular-nums">
                {kpi.score === null ? "—" : `${Math.round(kpi.score)}/100`}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MetricRow({ label, value, tip }: { label: string; value: string; tip?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-1.5 last:border-0" title={tip}>
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm font-semibold text-slate-700 tabular-nums">{value}</span>
    </div>
  )
}

const PIE_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#8b5cf6", "#ef4444", "#0ea5e9", "#f97316", "#14b8a6", "#a855f7", "#64748b"]

// ────────────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────────────
export default function TmPerformancePage() {
  const [view, setView] = useState<ViewKey>("leaderboard")
  const [dateA, setDateA] = useState(defaultDateA())
  const [dateB, setDateB] = useState(defaultDateB())
  const [rankBy, setRankBy] = useState<RankMetric>("sales")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [scAgent, setScAgent] = useState("")
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

  const coreLoaded = salesStore.loaded && callsStore.loaded && agentsStore.loaded && targetsStore.loaded && settings.loaded
  const month = thisMonthStr()

  const refreshAll = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([
        salesStore.refresh(), callsStore.refresh(), leadsStore.refresh(),
        agentsStore.refresh(), targetsStore.refresh(),
      ])
    } finally { setRefreshing(false) }
  }, [salesStore.refresh, callsStore.refresh, leadsStore.refresh, agentsStore.refresh, targetsStore.refresh])

  // ── Range-filtered rows ──
  const rangeSales = useMemo(
    () => sales.filter(s => s.sale_date >= dateA && s.sale_date <= dateB),
    [sales, dateA, dateB])
  const rangeActive = useMemo(() => activeSales(rangeSales), [rangeSales])
  const rangeCalls = useMemo(
    () => calls.filter(c => c.call_date >= dateA && c.call_date <= dateB),
    [calls, dateA, dateB])

  const hasAnyData = rangeActive.length > 0 || rangeCalls.length > 0

  // ── Current-month per-agent actuals (targets are monthly — spec §6–7) ──
  const monthByAgent = useMemo(() => {
    const m = new Map<string, { sales: number; orders: number }>()
    for (const s of activeSales(sales)) {
      if (s.sale_date.slice(0, 7) !== month) continue
      const key = s.agent_id || s.agent_name || "—"
      const cur = m.get(key) ?? { sales: 0, orders: 0 }
      cur.sales += s.total_amount
      cur.orders += s.total_qty
      m.set(key, cur)
    }
    return m
  }, [sales, month])

  const targetByAgent = useMemo(() => {
    const m = new Map<string, { sales: number; orders: number; conversion: number }>()
    for (const t of targets) {
      if (t.month !== month || !t.agent_id) continue
      m.set(t.agent_id, { sales: t.sales_target, orders: t.orders_target, conversion: t.conversion_target })
    }
    return m
  }, [targets, month])

  // ── Leaderboard aggregation + KPI scores (spec §23–24) ──
  const board = useMemo(() => {
    const map = new Map<string, AgentAgg>()
    const ensure = (id: string, name: string): AgentAgg => {
      const key = id || name || "—"
      let r = map.get(key)
      if (!r) {
        r = {
          id: key, name: name || "(unnamed)", roster: false, inactive: false,
          upOrders: 0, upAmt: 0, crossOrders: 0, crossAmt: 0, totalOrders: 0, totalSales: 0,
          calls: 0, connected: 0, salesRows: 0, connectedLeads: new Set(), soldLeads: new Set(),
        }
        map.set(key, r)
      }
      return r
    }
    for (const a of agents) {
      const r = ensure(a.id, a.agent_name)
      r.roster = true
      r.inactive = a.status === "Inactive"
      if (a.agent_name) r.name = a.agent_name
    }
    for (const s of rangeActive) {
      const r = ensure(s.agent_id, s.agent_name)
      r.upOrders += s.upsell_qty; r.upAmt += s.upsell_amount
      r.crossOrders += s.cross_qty; r.crossAmt += s.cross_amount
      r.totalOrders = r.upOrders + r.crossOrders
      r.totalSales = r.upAmt + r.crossAmt
      r.salesRows++
      if (s.lead_id) r.soldLeads.add(s.lead_id)
    }
    for (const c of rangeCalls) {
      const r = ensure(c.agent_id, c.agent_name)
      r.calls++
      if (c.connected) { r.connected++; if (c.lead_id) r.connectedLeads.add(c.lead_id) }
    }

    // Active roster agents always listed; INACTIVE ones only when they have data in range;
    // agents that only exist in the data (not in the roster) are always listed.
    const base = [...map.values()]
      .map(r => {
        const hasData = r.calls > 0 || r.salesRows > 0 || r.totalSales > 0 || r.totalOrders > 0
        const convBase = r.connectedLeads.size || r.connected
        const convHits = r.soldLeads.size || r.salesRows
        const t = targetByAgent.get(r.id)
        const m = monthByAgent.get(r.id)
        const targetSales = t?.sales ?? 0
        const monthSales = m?.sales ?? 0
        return {
          ...r, hasData,
          contactRate: r.calls > 0 ? (r.connected / r.calls) * 100 : 0,
          conversion: convBase > 0 ? Math.min(100, (convHits / convBase) * 100) : 0,
          convBase,
          aov: r.totalOrders > 0 ? r.totalSales / r.totalOrders : 0,
          monthSales, monthOrders: m?.orders ?? 0,
          targetSales, targetOrders: t?.orders ?? 0, conversionTarget: t?.conversion ?? 0,
          targetPct: targetSales > 0 ? (monthSales / targetSales) * 100 : null,
        }
      })
      .filter(r => (r.roster ? (!r.inactive || r.hasData) : true))

    const ctx: KpiCtx = {
      weights: settings.kpiWeights,
      bestConversion: base.reduce((n, r) => (r.convBase > 0 ? Math.max(n, r.conversion) : n), 0),
      bestContact: base.reduce((n, r) => (r.calls > 0 ? Math.max(n, r.contactRate) : n), 0),
      topUpsell: base.reduce((n, r) => Math.max(n, r.upAmt), 0),
      topCross: base.reduce((n, r) => Math.max(n, r.crossAmt), 0),
      topCalls: base.reduce((n, r) => Math.max(n, r.calls), 0),
    }
    const rows: AgentRow[] = base.map(r => ({ ...r, kpi: computeKpiScore(r, ctx) }))

    // TOTAL footer — rates are recomputed from the RAW counts, never averaged.
    const sum = rows.reduce((t, r) => ({
      upOrders: t.upOrders + r.upOrders, upAmt: t.upAmt + r.upAmt,
      crossOrders: t.crossOrders + r.crossOrders, crossAmt: t.crossAmt + r.crossAmt,
      totalOrders: t.totalOrders + r.totalOrders, totalSales: t.totalSales + r.totalSales,
      calls: t.calls + r.calls, connected: t.connected + r.connected,
    }), { upOrders: 0, upAmt: 0, crossOrders: 0, crossAmt: 0, totalOrders: 0, totalSales: 0, calls: 0, connected: 0 })
    const teamKpis = computeTmKpis(rangeSales, rangeCalls)
    const total = {
      ...sum,
      contactRate: sum.calls > 0 ? (sum.connected / sum.calls) * 100 : 0,
      conversion: teamKpis.conversionRate,
      aov: sum.totalOrders > 0 ? sum.totalSales / sum.totalOrders : 0,
    }
    return { rows, total }
  }, [agents, rangeActive, rangeCalls, rangeSales, targetByAgent, monthByAgent, settings.kpiWeights])

  const rankValue = useCallback((r: AgentRow, m: RankMetric): number => {
    switch (m) {
      case "sales": return r.totalSales
      case "upsell": return r.upAmt
      case "cross": return r.crossAmt
      case "conversion": return r.conversion
      case "contact": return r.contactRate
      case "orders": return r.totalOrders
      case "target": return r.targetPct ?? -1
      case "kpi": return r.kpi.score ?? -1
    }
  }, [])

  const ranked = useMemo(
    () => [...board.rows].sort((a, b) => rankValue(b, rankBy) - rankValue(a, rankBy) || b.totalSales - a.totalSales),
    [board.rows, rankBy, rankValue])

  const rankLabel = RANK_METRICS.find(m => m.key === rankBy)?.label ?? "Total Sales"

  // ── Agent options + resolved scorecard agent ──
  const agentOptions = useMemo(
    () => [...board.rows].sort((a, b) => a.name.localeCompare(b.name)),
    [board.rows])
  const scId = scAgent && board.rows.some(r => r.id === scAgent) ? scAgent : (ranked[0]?.id ?? "")
  const scRow = board.rows.find(r => r.id === scId) ?? null

  // ── SCORECARD extras (spec §11 + §16 + §30) ──
  const scorecard = useMemo(() => {
    if (!scRow) return null
    const keyOf = (id: string, name: string) => id || name || "—"
    const mySales = rangeActive.filter(s => keyOf(s.agent_id, s.agent_name) === scId)
    const myCalls = rangeCalls.filter(c => keyOf(c.agent_id, c.agent_name) === scId)

    const todaySales = activeSales(sales)
      .filter(s => s.sale_date === todayStr() && keyOf(s.agent_id, s.agent_name) === scId)
      .reduce((n, s) => n + s.total_amount, 0)

    const uniqueCustomers = new Set(myCalls.map(c => c.lead_id).filter(Boolean)).size
    const myLeads = leads.filter(l => l.assigned_to === scId)
    const open = (l: TmLead) => !WON_LEAD_STATUSES.includes(l.status) && l.status !== "Do Not Call" && l.status !== "Declined"
    const followUps = myLeads.filter(l => !!l.follow_up_date && open(l)).length

    // Active hours = distinct date+hour buckets in which this agent logged a sale OR a call.
    const hourKeys = new Set<string>()
    for (const s of mySales) { const h = hourOfTime(s.sale_time); if (h >= 0) hourKeys.add(`${s.sale_date}|${h}`) }
    for (const c of myCalls) { const h = hourOfTime(c.call_time); if (h >= 0) hourKeys.add(`${c.call_date}|${h}`) }
    const activeHours = hourKeys.size

    const remDays = remainingWorkingDays(month, settings.general.work_days, todayStr())
    const pace = requiredDailyPace(scRow.targetSales, scRow.monthSales, remDays)
    const targetRow = targets.find(t => t.month === month && t.agent_id === scId)

    const byDate: Record<string, number> = {}
    for (const s of mySales) byDate[s.sale_date] = (byDate[s.sale_date] || 0) + s.total_amount
    const daily: { day: string; amount: number }[] = []
    const d = new Date(`${dateA}T00:00:00`)
    const end = new Date(`${dateB}T00:00:00`)
    let guard = 0
    while (d <= end && guard++ < 190) {
      daily.push({ day: format(d, "MMM d"), amount: byDate[format(d, "yyyy-MM-dd")] || 0 })
      d.setDate(d.getDate() + 1)
    }

    return {
      todaySales, uniqueCustomers, leadsAssigned: myLeads.length, followUps,
      activeHours, remDays, pace, daily,
      salesPerConnected: scRow.connected > 0 ? scRow.totalSales / scRow.connected : 0,
      ordersPerConnected: scRow.connected > 0 ? scRow.totalOrders / scRow.connected : 0,
      salesPerHour: activeHours > 0 ? scRow.totalSales / activeHours : 0,
      ordersPerHour: activeHours > 0 ? scRow.totalOrders / activeHours : 0,
      remainingQuota: scRow.targetSales - scRow.monthSales,
      achievement: scRow.targetSales > 0 ? (scRow.monthSales / scRow.targetSales) * 100 : 0,
      dailyTarget: targetRow?.daily_sales_target ?? 0,
      hasTarget: scRow.targetSales > 0,
    }
  }, [scRow, scId, rangeActive, rangeCalls, sales, leads, month, settings.general.work_days, dateA, dateB, targets])

  // ── PRODUCTS (spec §25) — a product appears ONCE, aggregating both roles ──
  const products = useMemo(() => {
    interface P {
      name: string; upOrders: number; upRev: number; crossOrders: number; crossRev: number
      byAgent: Map<string, number>
    }
    const map = new Map<string, P>()
    const ensure = (raw: string): P => {
      const name = (raw || "").trim() || NO_PRODUCT
      let p = map.get(name)
      if (!p) { p = { name, upOrders: 0, upRev: 0, crossOrders: 0, crossRev: 0, byAgent: new Map() }; map.set(name, p) }
      return p
    }
    const bump = (p: P, agent: string, amt: number) => {
      const who = agent || "(unassigned)"
      p.byAgent.set(who, (p.byAgent.get(who) || 0) + amt)
    }
    for (const s of rangeActive) {
      if (s.upsell_qty > 0 || s.upsell_amount > 0) {
        const p = ensure(s.upsell_product)
        p.upOrders += s.upsell_qty; p.upRev += s.upsell_amount
        bump(p, s.agent_name || s.agent_id, s.upsell_amount)
      }
      if (s.cross_qty > 0 || s.cross_amount > 0) {
        const p = ensure(s.cross_product)
        p.crossOrders += s.cross_qty; p.crossRev += s.cross_amount
        bump(p, s.agent_name || s.agent_id, s.cross_amount)
      }
    }
    const rows = [...map.values()].map(p => {
      let topAgent = "—", topAmt = -1
      for (const [who, amt] of p.byAgent) if (amt > topAmt) { topAgent = who; topAmt = amt }
      return {
        name: p.name, upOrders: p.upOrders, upRev: p.upRev, crossOrders: p.crossOrders, crossRev: p.crossRev,
        totalOrders: p.upOrders + p.crossOrders, totalRev: p.upRev + p.crossRev,
        topAgent, topAmt: Math.max(0, topAmt),
      }
    }).sort((a, b) => b.totalRev - a.totalRev)

    const total = rows.reduce((t, r) => ({
      upOrders: t.upOrders + r.upOrders, upRev: t.upRev + r.upRev,
      crossOrders: t.crossOrders + r.crossOrders, crossRev: t.crossRev + r.crossRev,
      totalOrders: t.totalOrders + r.totalOrders, totalRev: t.totalRev + r.totalRev,
    }), { upOrders: 0, upRev: 0, crossOrders: 0, crossRev: 0, totalOrders: 0, totalRev: 0 })

    // Revenue-share pie: top 9 + "Others" so the legend never explodes.
    const withRev = rows.filter(r => r.totalRev > 0)
    const pie = withRev.slice(0, 9).map(r => ({ name: r.name, value: r.totalRev }))
    const others = withRev.slice(9).reduce((n, r) => n + r.totalRev, 0)
    if (others > 0) pie.push({ name: "Others", value: others })

    return { rows, total, pie }
  }, [rangeActive])

  const rangeLabel = `${format(new Date(`${dateA}T00:00:00`), "MMM d, yyyy")} – ${format(new Date(`${dateB}T00:00:00`), "MMM d, yyyy")}`

  // ── Scorecard card definitions ──
  const scCardsTarget = scRow && scorecard ? [
    { label: "Today's Sales", value: peso(scorecard.todaySales), color: "bg-blue-500", icon: TrendingUp, sub: todayStr() },
    { label: "Month Sales", value: peso(scRow.monthSales), color: "bg-cyan-600", icon: Wallet, sub: "Month-to-date" },
    { label: "Daily Target", value: scorecard.dailyTarget > 0 ? peso(scorecard.dailyTarget) : "—", color: "bg-slate-600", icon: Target,
      tip: "Agent's daily sales target for the current month (tm_targets)" },
    { label: "Monthly Target", value: scorecard.hasTarget ? peso(scRow.targetSales) : "—", color: "bg-indigo-600", icon: Target,
      sub: scorecard.hasTarget ? undefined : "No target set this month" },
    { label: "Remaining Quota", value: scorecard.hasTarget ? peso(Math.max(0, scorecard.remainingQuota)) : "—", color: "bg-rose-500", icon: Wallet,
      tip: "Monthly target − month-to-date sales" },
    { label: "Achievement %", value: scorecard.hasTarget ? fmtPct(scorecard.achievement) : "—",
      color: scorecard.achievement >= 100 ? "bg-emerald-600" : "bg-violet-600", icon: Percent },
    { label: "Required Daily Pace", value: scorecard.hasTarget ? peso(scorecard.pace) : "—", color: "bg-amber-600", icon: Gauge,
      sub: `${scorecard.remDays} working day${scorecard.remDays === 1 ? "" : "s"} left`,
      tip: "Remaining quota ÷ remaining working days this month (Settings → work days)" },
  ] : []

  const scCardsSales = scRow ? [
    { label: "Upsell Orders", value: fmtNum(scRow.upOrders), color: "bg-blue-500", icon: ShoppingCart },
    { label: "Upsell Amount", value: peso(scRow.upAmt), color: "bg-blue-600", icon: Wallet },
    { label: "Cross-sell Orders", value: fmtNum(scRow.crossOrders), color: "bg-amber-500", icon: ShoppingCart },
    { label: "Cross-sell Amount", value: peso(scRow.crossAmt), color: "bg-amber-600", icon: Wallet },
    { label: "Total Orders", value: fmtNum(scRow.totalOrders), color: "bg-violet-600", icon: Layers },
    { label: "Total Sales", value: peso(scRow.totalSales), color: "bg-emerald-600", icon: TrendingUp },
  ] : []

  return (
    <div className="w-full space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-4 mb-1 border-b border-slate-100">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Award className="w-5 h-5" /> AGENT PERFORMANCE</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            {VIEWS.map(v => (
              <button key={v.key} onClick={() => setView(v.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  view === v.key ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50/70"}`}>
                {v.label}
              </button>
            ))}
          </div>
          <DateRangePicker a={dateA} b={dateB} variant="header"
            onApply={(a, b) => { setDateA(a || defaultDateA()); setDateB(b || defaultDateB()) }} placeholder="This month" />
          <button onClick={refreshAll} title="Refresh telemarketing data"
            className="h-9 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50/70">
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500 font-medium">
        {rangeLabel} · {rangeActive.length} sale{rangeActive.length === 1 ? "" : "s"} · {rangeCalls.length} call{rangeCalls.length === 1 ? "" : "s"} ·
        {" "}{board.rows.length} agent{board.rows.length === 1 ? "" : "s"} · cancelled sales excluded
      </p>

      {/* ══════════════════ LEADERBOARD (§23) ══════════════════ */}
      {view === "leaderboard" && (
        <Panel title="Leaderboard" icon={Trophy}
          right={
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                <ListOrdered className="w-3.5 h-3.5" /> Rank by
              </label>
              <select value={rankBy} onChange={e => setRankBy(e.target.value as RankMetric)}
                className="h-9 rounded-lg border border-blue-200 bg-blue-50 px-2 text-sm font-semibold text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-100">
                {RANK_METRICS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </div>
          }>
          <p className="text-[11px] text-slate-400 -mt-1 mb-3">
            Ranked by <span className="font-semibold text-blue-600">{rankLabel}</span>. Spec §23: huwag lang raw sales ang basehan —
            palitan ang <span className="font-semibold">Rank by</span> para tingnan ang conversion, contact rate, achievement o KPI score.
            Pindutin ang isang row para sa KPI breakdown.
          </p>

          {!coreLoaded ? <TableSkeleton rows={6} cols={9} />
            : !hasAnyData || board.rows.length === 0 ? <EmptyPanel />
            : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[1180px]">
                  <thead>
                    <tr className="bg-slate-50 border-y border-slate-200 text-xs text-slate-600">
                      <th className="text-left px-3 py-2.5 font-semibold">Rank</th>
                      <th className="text-left px-3 py-2.5 font-semibold">Agent</th>
                      <th className="text-right px-3 py-2.5 font-semibold">Upsell Orders</th>
                      <th className="text-right px-3 py-2.5 font-semibold">Upsell Amt</th>
                      <th className="text-right px-3 py-2.5 font-semibold">Cross Orders</th>
                      <th className="text-right px-3 py-2.5 font-semibold">Cross Amt</th>
                      <th className="text-right px-3 py-2.5 font-semibold">Total Orders</th>
                      <th className="text-right px-3 py-2.5 font-semibold">Total Sales</th>
                      <th className="text-right px-3 py-2.5 font-semibold">Calls</th>
                      <th className="text-right px-3 py-2.5 font-semibold">Connected</th>
                      <th className="text-right px-3 py-2.5 font-semibold">Contact Rate</th>
                      <th className="text-right px-3 py-2.5 font-semibold">Conversion %</th>
                      <th className="text-right px-3 py-2.5 font-semibold">AOV</th>
                      <th className="text-right px-3 py-2.5 font-semibold">KPI Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.map((r, i) => (
                      <Fragment key={r.id}>
                        <tr onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                          className="border-b border-slate-100 hover:bg-blue-50/40 cursor-pointer">
                          <td className="px-3 py-2.5"><RankBadge rank={i + 1} /></td>
                          <td className="px-3 py-2.5 font-medium text-slate-700">
                            <span className="flex items-center gap-1.5">
                              {expanded === r.id ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-300" />}
                              {r.name}{r.inactive ? <span className="text-[11px] text-slate-400 font-normal">(inactive)</span> : null}
                            </span>
                          </td>
                          <td className={`${MONEY} text-slate-600`}>{fmtNum(r.upOrders)}</td>
                          <td className={`${MONEY} text-slate-600`}>{peso(r.upAmt)}</td>
                          <td className={`${MONEY} text-slate-600`}>{fmtNum(r.crossOrders)}</td>
                          <td className={`${MONEY} text-slate-600`}>{peso(r.crossAmt)}</td>
                          <td className={`${MONEY} font-semibold text-slate-700`}>{fmtNum(r.totalOrders)}</td>
                          <td className={`${MONEY} font-semibold text-slate-700`}>{peso(r.totalSales)}</td>
                          <td className={`${MONEY} text-slate-600`}>{fmtNum(r.calls)}</td>
                          <td className={`${MONEY} text-slate-600`}>{fmtNum(r.connected)}</td>
                          <td className={`${MONEY} text-slate-600`}>{fmtPct(r.contactRate)}</td>
                          <td className={`${MONEY} text-slate-600`}>{fmtPct(r.conversion)}</td>
                          <td className={`${MONEY} text-slate-600`}>{peso(r.aov)}</td>
                          <td className="px-3 py-2.5 text-right"><ScoreBar score={r.kpi.score} /></td>
                        </tr>
                        {expanded === r.id && (
                          <tr className="border-b border-slate-200 bg-slate-50/40">
                            <td colSpan={14} className="px-3 py-3">
                              <div className="flex flex-wrap items-center gap-4 mb-2 text-xs text-slate-500">
                                <span>Target achievement (this month): <span className={`font-bold tabular-nums ${r.targetPct === null ? "text-slate-400" : r.targetPct >= 100 ? "text-emerald-600" : r.targetPct >= 70 ? "text-amber-600" : "text-red-600"}`}>
                                  {r.targetPct === null ? "no target" : fmtPct(r.targetPct)}</span></span>
                                <span>Month-to-date: <span className="font-semibold tabular-nums text-slate-700">{peso(r.monthSales)}</span></span>
                                <button onClick={e => { e.stopPropagation(); setScAgent(r.id); setView("scorecard") }}
                                  className="text-blue-600 hover:text-blue-700 font-semibold underline underline-offset-2">
                                  Buksan ang full scorecard →
                                </button>
                              </div>
                              <KpiBreakdown kpi={r.kpi} agentName={r.name} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                    <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-800">
                      <td className="px-3 py-2.5 text-xs uppercase" colSpan={2}>Total</td>
                      <td className={MONEY}>{fmtNum(board.total.upOrders)}</td>
                      <td className={MONEY}>{peso(board.total.upAmt)}</td>
                      <td className={MONEY}>{fmtNum(board.total.crossOrders)}</td>
                      <td className={MONEY}>{peso(board.total.crossAmt)}</td>
                      <td className={MONEY}>{fmtNum(board.total.totalOrders)}</td>
                      <td className={MONEY}>{peso(board.total.totalSales)}</td>
                      <td className={MONEY}>{fmtNum(board.total.calls)}</td>
                      <td className={MONEY}>{fmtNum(board.total.connected)}</td>
                      <td className={MONEY}>{fmtPct(board.total.contactRate)}</td>
                      <td className={MONEY}>{fmtPct(board.total.conversion)}</td>
                      <td className={MONEY}>{peso(board.total.aov)}</td>
                      <td className={`${MONEY} text-slate-400 text-xs`} title="A KPI score cannot be averaged across agents — open a row instead.">—</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
        </Panel>
      )}

      {/* ══════════════════ SCORECARD (§11, §16, §30) ══════════════════ */}
      {view === "scorecard" && (
        <div className="space-y-4">
          <Panel title="Agent Scorecard" icon={UserCheck}
            right={
              <select value={scId} onChange={e => setScAgent(e.target.value)}
                className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-100">
                {agentOptions.length === 0 && <option value="">No agents</option>}
                {agentOptions.map(a => (
                  <option key={a.id} value={a.id}>{a.name}{a.inactive ? " (inactive)" : ""}</option>
                ))}
              </select>
            }>
            {!coreLoaded ? <StatCardsSkeleton count={7} height="h-[70px] sm:h-[78px]" className="grid grid-cols-2 sm:grid-cols-4 gap-2.5" />
              : !scRow || !scorecard ? <EmptyPanel note="Wala pang agent na may data — magdagdag ng agent o mag-encode ng sales." />
              : (
                <div className="space-y-4">
                  {/* Targets & pace (current month) */}
                  <div>
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Targets & pace (current month)</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {scCardsTarget.map(c => <StatCard key={c.label} {...c} />)}
                    </div>
                  </div>

                  {/* Sales in range */}
                  <div>
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Sales in selected range</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      {scCardsSales.map(c => <StatCard key={c.label} {...c} />)}
                    </div>
                  </div>

                  {/* Call + efficiency metrics */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5 text-sky-500" /> Call metrics (§16)
                      </p>
                      <MetricRow label="Leads Assigned" value={fmtNum(scorecard.leadsAssigned)}
                        tip="Leads currently assigned to this agent (assignment is not dated, so this is the live roster count — not range-filtered)" />
                      <MetricRow label="Calls Made" value={fmtNum(scRow.calls)} />
                      <MetricRow label="Unique Customers Called" value={fmtNum(scorecard.uniqueCustomers)}
                        tip="Distinct leads called inside the selected range" />
                      <MetricRow label="Connected" value={fmtNum(scRow.connected)} />
                      <MetricRow label="Not Connected" value={fmtNum(Math.max(0, scRow.calls - scRow.connected))} />
                      <MetricRow label="Contact Rate" value={fmtPct(scRow.contactRate)} tip="Connected ÷ calls made × 100" />
                      <MetricRow label="Follow-ups" value={fmtNum(scorecard.followUps)}
                        tip="Assigned leads with a scheduled follow-up that is still open (not won / declined / do-not-call)" />
                      <MetricRow label="Successful Sales" value={fmtNum(scRow.salesRows)}
                        tip="Non-cancelled sale records encoded by this agent in the range" />
                      <MetricRow label="Conversion" value={fmtPct(scRow.conversion)}
                        tip="Customers with a successful sale ÷ unique connected customers × 100" />
                    </div>

                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-violet-500" /> Efficiency metrics (§30)
                      </p>
                      <MetricRow label="Avg Order Value" value={peso(scRow.aov)} tip="Total sales ÷ total orders" />
                      <MetricRow label="Sales per Connected Call" value={peso(scorecard.salesPerConnected)} />
                      <MetricRow label="Orders per Connected Call" value={fmtDec(scorecard.ordersPerConnected)} />
                      <MetricRow label="Sales per Hour" value={peso(scorecard.salesPerHour)}
                        tip="Active hours = distinct date+hour buckets in which this agent logged a sale or a call inside the selected range" />
                      <MetricRow label="Orders per Hour" value={fmtDec(scorecard.ordersPerHour)}
                        tip="Active hours = distinct date+hour buckets in which this agent logged a sale or a call inside the selected range" />
                      <MetricRow label="Active Hours" value={fmtNum(scorecard.activeHours)}
                        tip="Distinct date+hour buckets with at least one sale or call by this agent in the range" />
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">KPI Score (§24)</p>
                        <ScoreBar score={scRow.kpi.score} wide />
                      </div>
                    </div>
                  </div>

                  <KpiBreakdown kpi={scRow.kpi} agentName={scRow.name} />
                </div>
              )}
          </Panel>

          <Panel title={`Daily Sales — ${scRow ? scRow.name : "—"}`} icon={TrendingUp}>
            {!coreLoaded ? <ChartSkeleton height={260} />
              : !scorecard || scorecard.daily.every(d => d.amount === 0)
                ? <EmptyPanel note="Walang sale ang agent na ito sa piniling range." />
                : (
                  <div style={{ width: "100%", height: 260 }}>
                    <ResponsiveContainer>
                      <BarChart data={scorecard.daily} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="day" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 10 }} width={70} tickFormatter={(v: number) => v.toLocaleString("en-PH")} />
                        <RTooltip formatter={(v: any) => peso(Number(v))} />
                        <Bar dataKey="amount" name="Sales" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
          </Panel>
        </div>
      )}

      {/* ══════════════════ PRODUCTS (§25) ══════════════════ */}
      {view === "products" && (
        <div className="space-y-4">
          <Panel title="Product Performance" icon={Package}>
            <p className="text-[11px] text-slate-400 -mt-1 mb-3">
              Isang row kada product, pinagsama ang upsell at cross-sell na papel nito. Sorted by Total Revenue.
              Blangkong product name → <span className="font-semibold">{NO_PRODUCT}</span>.
            </p>
            {!coreLoaded ? <TableSkeleton rows={6} cols={8} />
              : products.rows.length === 0 ? <EmptyPanel note="Walang sale na may product sa piniling range." />
              : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[900px]">
                    <thead>
                      <tr className="bg-slate-50 border-y border-slate-200 text-xs text-slate-600">
                        <th className="text-left px-3 py-2.5 font-semibold">Product</th>
                        <th className="text-right px-3 py-2.5 font-semibold">Upsell Orders</th>
                        <th className="text-right px-3 py-2.5 font-semibold">Upsell Revenue</th>
                        <th className="text-right px-3 py-2.5 font-semibold">Cross-sell Orders</th>
                        <th className="text-right px-3 py-2.5 font-semibold">Cross-sell Revenue</th>
                        <th className="text-right px-3 py-2.5 font-semibold">Total Orders</th>
                        <th className="text-right px-3 py-2.5 font-semibold">Total Revenue</th>
                        <th className="text-left px-3 py-2.5 font-semibold">Top Agent</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.rows.map(r => (
                        <tr key={r.name} className="border-b border-slate-100 hover:bg-blue-50/40">
                          <td className="px-3 py-2.5 font-medium text-slate-700">
                            {r.name === NO_PRODUCT ? <span className="text-slate-400 italic">{r.name}</span> : r.name}
                          </td>
                          <td className={`${MONEY} text-slate-600`}>{fmtNum(r.upOrders)}</td>
                          <td className={`${MONEY} text-slate-600`}>{peso(r.upRev)}</td>
                          <td className={`${MONEY} text-slate-600`}>{fmtNum(r.crossOrders)}</td>
                          <td className={`${MONEY} text-slate-600`}>{peso(r.crossRev)}</td>
                          <td className={`${MONEY} font-semibold text-slate-700`}>{fmtNum(r.totalOrders)}</td>
                          <td className={`${MONEY} font-semibold text-slate-700`}>{peso(r.totalRev)}</td>
                          <td className="px-3 py-2.5 text-slate-600">
                            {r.topAgent}
                            {r.topAmt > 0 && <span className="text-[11px] text-slate-400 ml-1.5 tabular-nums">{peso(r.topAmt)}</span>}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-800">
                        <td className="px-3 py-2.5 text-xs uppercase">Total</td>
                        <td className={MONEY}>{fmtNum(products.total.upOrders)}</td>
                        <td className={MONEY}>{peso(products.total.upRev)}</td>
                        <td className={MONEY}>{fmtNum(products.total.crossOrders)}</td>
                        <td className={MONEY}>{peso(products.total.crossRev)}</td>
                        <td className={MONEY}>{fmtNum(products.total.totalOrders)}</td>
                        <td className={MONEY}>{peso(products.total.totalRev)}</td>
                        <td className="px-3 py-2.5 text-slate-400 text-xs">{products.rows.length} product{products.rows.length === 1 ? "" : "s"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
          </Panel>

          <Panel title="Revenue Share" icon={Percent}>
            {!coreLoaded ? <ChartSkeleton height={280} />
              : products.pie.length === 0 ? <EmptyPanel note="Walang revenue na maipapakita sa piniling range." />
              : (
                <div style={{ width: "100%", height: 300 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={products.pie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={95}
                        label={(e: any) => `${e.name}: ${peso(e.value)}`}>
                        {products.pie.map((d, i) => <Cell key={d.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <RTooltip formatter={(v: any) => peso(Number(v))} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
          </Panel>
        </div>
      )}

      <div className="pb-4" />
    </div>
  )
}
