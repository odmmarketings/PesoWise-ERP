"use client"
import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  Truck, RefreshCw, Eye, EyeOff, AlertTriangle, PhoneCall, PackageCheck,
  Undo2, Users, ClipboardList, CalendarClock, type LucideIcon,
} from "lucide-react"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import { useActivePages } from "@/lib/pages-store"
import { cachedJson, PANCAKE_CONCURRENCY } from "@/lib/pancake-cache"
import { currentUserEmail } from "@/lib/current-user"
import { useDeliveryTeam, resolveDeliveryRole } from "@/lib/delivery-team-store"
import { useDeliveryOrders, TERMINAL_STATUSES, todayStr, type DeliveryOrder } from "@/lib/delivery-store"

// ──────────────────────────────────────────────────────────────────────────────
// LOGISTICS DASHBOARD — real-time na tanaw ng delivery operations: KPI cards,
// daily summary, Delivered-vs-RTS trend, operational alerts, agent leaderboard.
// Scope = delivery_orders na naka-assign sa napiling date range; ang delivery
// status ay live Pancake (parcel_status) na may snapshot fallback. Ang mga agent
// ay makikita lang ang sariling numbers (parehong client-side filtering ng
// workspaces); admin/supervisor ang nakakakita ng lahat + leaderboard.
// ──────────────────────────────────────────────────────────────────────────────

const CHARTS_KEY = "pesowise_delivery_charts"
const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const nfmt = (n: number) => n.toLocaleString("en-PH")
const pct = (num: number, den: number) => (den > 0 ? `${((num / den) * 100).toFixed(1)}%` : "—")

async function fetchPageRows(apiKey: string, pageId: string, from: string, to: string, noCache = false): Promise<any[]> {
  const json = await cachedJson(
    `/api/pancake/orders?api_key=${encodeURIComponent(apiKey)}&page_id=${encodeURIComponent(pageId)}`
    + `&from=${from}&to=${to}&phase=rows&basis=sales_order${noCache ? "&nocache=1" : ""}`,
    { force: noCache }
  )
  return Array.isArray(json.rows) ? json.rows : []
}
async function mapLimit<T>(items: T[], limit: number, fn: (i: T) => Promise<void>) {
  let i = 0; await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) await fn(items[i++]) }))
}

/** Live courier status ng record — live Pancake kung nasa window, kung hindi snapshot. */
const statusOf = (r: DeliveryOrder, liveById: Map<string, any>) =>
  liveById.get(r.order_id)?.parcel_status || r.parcel_status_snapshot || ""

const isDelivered = (r: DeliveryOrder, live: Map<string, any>) =>
  statusOf(r, live) === "Delivered" || r.agent_status === "Delivered"
const isRts = (r: DeliveryOrder, live: Map<string, any>) => {
  const s = statusOf(r, live)
  return s === "Returned" || s === "Returning" || r.agent_status === "Returned/RTS"
}
const isContacted = (r: DeliveryOrder) => r.call_attempts > 0 || r.last_contact_at !== ""

export default function LogisticsDashboardPage() {
  const activePages = useActivePages()
  const pagesWithCreds = useMemo(() => activePages.filter(p => p.api_key && (p.pancake_page_id || p.shop_id)), [activePages])
  const store = useDeliveryOrders()
  const teamStore = useDeliveryTeam()
  const me = currentUserEmail().toLowerCase()
  const role = resolveDeliveryRole(currentUserEmail(), teamStore.team)
  const isAgent = role === "agent"

  // ── Date range (assigned_date scope) — default This month ───────────────────
  const now = new Date()
  const [dateA, setDateA] = useState(fmt(new Date(now.getFullYear(), now.getMonth(), 1)))
  const [dateB, setDateB] = useState(fmt(now))

  // ── Filters ─────────────────────────────────────────────────────────────────
  const [fAgent, setFAgent] = useState("All")
  const [fQueue, setFQueue] = useState("All")
  const [fStatus, setFStatus] = useState("All")
  const [fCourier, setFCourier] = useState("All")
  const [fStore, setFStore] = useState("All")

  // ── Scope: assigned sa loob ng range + filters (+ agent self-scope) ─────────
  const scoped = useMemo(() => {
    let list = Object.values(store.orders).filter(r => r.assigned_date >= dateA && r.assigned_date <= dateB)
    if (isAgent) list = list.filter(r => r.assigned_to_email === me)
    if (fAgent !== "All") list = list.filter(r => (r.assigned_to_name || r.assigned_to_email) === fAgent)
    if (fQueue !== "All") list = list.filter(r => r.assignment_type === fQueue.toLowerCase())
    if (fStatus !== "All") list = list.filter(r => r.agent_status === fStatus)
    if (fCourier !== "All") list = list.filter(r => r.courier === fCourier)
    if (fStore !== "All") list = list.filter(r => r.page_name === fStore)
    return list
  }, [store.orders, dateA, dateB, isAgent, me, fAgent, fQueue, fStatus, fCourier, fStore])

  // ── Live Pancake join (para totoo ang Delivered/RTS kahit gumagalaw pa) ─────
  const [liveRows, setLiveRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const pagesKey = pagesWithCreds.map(p => `${p.api_key}~${p.pancake_page_id || p.shop_id}~${p.name}`).join("|")
  const fetchFrom = useMemo(() => {
    const oldest = Object.values(store.orders).reduce((m, r) => (r.order_date && r.order_date < m ? r.order_date : m), dateA)
    const clamp = fmt(new Date(Date.now() - 60 * 86400_000))
    return oldest < clamp ? clamp : oldest
  }, [store.orders, dateA])
  const rangeKey = `${fetchFrom}|${dateB}`
  async function load(noCache = false) {
    if (pagesWithCreds.length === 0) { setLiveRows([]); return }
    setLoading(true)
    const out: any[] = []
    await mapLimit(pagesWithCreds, PANCAKE_CONCURRENCY, async p => {
      try {
        const rs = await fetchPageRows(p.api_key, p.pancake_page_id || p.shop_id, fetchFrom, fmt(new Date()), noCache)
        for (const r of rs) out.push({ ...r, page_name: p.name })
      } catch { /* per-page errors ay hindi dapat magpabagsak sa dashboard */ }
    })
    setLiveRows(out); setLoading(false)
  }
  useEffect(() => { load() }, [pagesKey, rangeKey])   // eslint-disable-line react-hooks/exhaustive-deps
  const liveById = useMemo(() => {
    const m = new Map<string, any>()
    for (const r of liveRows) m.set(String(r.id), r)
    return m
  }, [liveRows])

  // ── KPIs ────────────────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const total = scoped.length
    const delivered = scoped.filter(r => isDelivered(r, liveById)).length
    const rts = scoped.filter(r => isRts(r, liveById)).length
    const ofd = scoped.filter(r => ["Out for Delivery", "In-Transit", "Shipped Out", "Picked Up"].includes(statusOf(r, liveById))).length
    const contacted = scoped.filter(isContacted).length
    const problematic = scoped.filter(r => r.assignment_type === "problematic")
    const recovered = problematic.filter(r => r.agent_status === "Recovery" || r.agent_status === "Delivered").length
    const count = (s: string) => scoped.filter(r => r.agent_status === s).length
    return {
      total, delivered, rts, ofd, contacted,
      problematic: problematic.length, recovered,
      pending: count("Pending"), rescheduled: count("Rescheduled"),
      canceled: count("Canceled"), returned: count("Returned/RTS"),
    }
  }, [scoped, liveById])

  // ── Daily summary + chart data (by assigned_date) ───────────────────────────
  const byDay = useMemo(() => {
    const days = new Map<string, { assigned: number; contacted: number; delivered: number; rts: number; recovered: number }>()
    for (const r of scoped) {
      const d = r.assigned_date
      if (!d) continue
      const row = days.get(d) || { assigned: 0, contacted: 0, delivered: 0, rts: 0, recovered: 0 }
      row.assigned++
      if (isContacted(r)) row.contacted++
      if (isDelivered(r, liveById)) row.delivered++
      if (isRts(r, liveById)) row.rts++
      if (r.assignment_type === "problematic" && (r.agent_status === "Recovery" || r.agent_status === "Delivered")) row.recovered++
      days.set(d, row)
    }
    return Array.from(days.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [scoped, liveById])
  const chartData = useMemo(() =>
    [...byDay].reverse().map(([d, r]) => ({ day: d.slice(5), Delivered: r.delivered, RTS: r.rts })),
  [byDay])

  // ── Alerts ──────────────────────────────────────────────────────────────────
  const today = todayStr()
  const alerts = useMemo(() => {
    const open = scoped.filter(r => !TERMINAL_STATUSES.includes(r.agent_status))
    const overdue = open.filter(r => r.next_follow_up && r.next_follow_up < today)
    const reschedToday = open.filter(r => r.agent_status === "Rescheduled" && r.reschedule_date && r.reschedule_date <= today && !r.reschedule_confirmed)
    const untouched = open.filter(r => r.agent_status === "Pending" && r.assigned_date < today)
    const unassignedProblematic = liveRows.filter(r =>
      ["Problematic", "Returning", "Returned"].includes(r.parcel_status) && !store.orders[String(r.id)]).length
    return { overdue, reschedToday, untouched, unassignedProblematic }
  }, [scoped, liveRows, store.orders, today])

  // ── Leaderboard (admin/supervisor lang) ─────────────────────────────────────
  const leaderboard = useMemo(() => {
    if (isAgent) return []
    const m = new Map<string, { name: string; assigned: number; contacted: number; delivered: number; rts: number; recovered: number }>()
    for (const r of scoped) {
      const key = r.assigned_to_email || "—"
      const row = m.get(key) || { name: r.assigned_to_name || r.assigned_to_email || "—", assigned: 0, contacted: 0, delivered: 0, rts: 0, recovered: 0 }
      row.assigned++
      if (isContacted(r)) row.contacted++
      if (isDelivered(r, liveById)) row.delivered++
      if (isRts(r, liveById)) row.rts++
      if (r.assignment_type === "problematic" && (r.agent_status === "Recovery" || r.agent_status === "Delivered")) row.recovered++
      m.set(key, row)
    }
    return Array.from(m.values()).sort((a, b) => b.delivered - a.delivered)
  }, [scoped, liveById, isAgent])

  // ── Chart collapse (persisted, warehouse idiom) ─────────────────────────────
  const [showCharts, setShowCharts] = useState(true)
  useEffect(() => { try { setShowCharts(localStorage.getItem(CHARTS_KEY) !== "0") } catch {} }, [])
  const toggleCharts = () => setShowCharts(s => { try { localStorage.setItem(CHARTS_KEY, s ? "0" : "1") } catch {}; return !s })

  const agentNames = useMemo(() => Array.from(new Set(Object.values(store.orders).map(r => r.assigned_to_name || r.assigned_to_email).filter(Boolean))).sort(), [store.orders])
  const couriers = useMemo(() => Array.from(new Set(Object.values(store.orders).map(r => r.courier).filter(Boolean))).sort(), [store.orders])
  const stores = useMemo(() => Array.from(new Set(Object.values(store.orders).map(r => r.page_name).filter(Boolean))).sort(), [store.orders])

  const SEL = "h-8 rounded-lg border border-slate-300 px-2 text-xs bg-white focus:outline-none focus:border-blue-400"

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 pb-4 mb-1 border-b border-slate-100">
        <div>
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2">
            <Truck className="w-5 h-5" /> LOGISTICS DASHBOARD
          </h1>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Delivery & Problematic operations · your role: <span className="font-semibold uppercase">{role}</span>
            {isAgent && " · sariling numbers mo lang ang makikita"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DateRangePicker a={dateA} b={dateB} variant="header" placeholder="This month"
            onApply={(a, b) => {
              setDateA(a || fmt(new Date(now.getFullYear(), now.getMonth(), 1)))
              setDateB(b || a || fmt(new Date()))
            }} />
          <button onClick={() => load(true)} title="Refresh live delivery statuses"
            className="h-9 w-9 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 flex items-center justify-center">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button onClick={toggleCharts} title={showCharts ? "Hide charts" : "Show charts"}
            className="h-9 px-3 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 text-sm">
            {showCharts ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />} Charts
          </button>
        </div>
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="font-semibold uppercase tracking-wider text-[10px]">Filters:</span>
        {!isAgent && (
          <select className={SEL} value={fAgent} onChange={e => setFAgent(e.target.value)}>
            <option>All</option>{agentNames.map(a => <option key={a}>{a}</option>)}
          </select>
        )}
        <select className={SEL} value={fQueue} onChange={e => setFQueue(e.target.value)}>
          <option>All</option><option>Delivering</option><option>Problematic</option>
        </select>
        <select className={SEL} value={fStatus} onChange={e => setFStatus(e.target.value)}>
          <option>All</option>
          {["Pending", "Unreachable", "Contacted", "Reminded", "Rescheduled", "Resolved", "Recovery", "Delivered", "Canceled", "Returned/RTS", "Other"].map(s => <option key={s}>{s}</option>)}
        </select>
        <select className={SEL} value={fCourier} onChange={e => setFCourier(e.target.value)}>
          <option>All</option>{couriers.map(c => <option key={c}>{c}</option>)}
        </select>
        <select className={SEL} value={fStore} onChange={e => setFStore(e.target.value)}>
          <option>All</option>{stores.map(s => <option key={s}>{s}</option>)}
        </select>
        <span className="text-slate-400">scope: assigned {dateA} → {dateB}</span>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-7 gap-2.5">
        <Kpi label="Total Assigned" value={nfmt(kpi.total)} color="bg-blue-600" icon={ClipboardList} />
        <Kpi label="Out for Delivery" value={nfmt(kpi.ofd)} color="bg-sky-500" icon={Truck} loading={loading} />
        <Kpi label="Delivered" value={nfmt(kpi.delivered)} color="bg-emerald-600" icon={PackageCheck} loading={loading} />
        <Kpi label="RTS" value={nfmt(kpi.rts)} color="bg-rose-600" icon={Undo2} loading={loading} />
        <Kpi label="Delivery Rate" value={pct(kpi.delivered, kpi.total)} color="bg-emerald-500" icon={PackageCheck} loading={loading} />
        <Kpi label="RTS Rate" value={pct(kpi.rts, kpi.total)} color="bg-rose-500" icon={Undo2} loading={loading} />
        <Kpi label="Contact Rate" value={pct(kpi.contacted, kpi.total)} color="bg-indigo-500" icon={PhoneCall} />
        <Kpi label="Problematic" value={nfmt(kpi.problematic)} color="bg-red-600" icon={AlertTriangle} />
        <Kpi label="Recovered" value={nfmt(kpi.recovered)} color="bg-purple-600" icon={PackageCheck} />
        <Kpi label="Recovery Rate" value={pct(kpi.recovered, kpi.problematic)} color="bg-purple-500" icon={PackageCheck} />
        <Kpi label="Pending" value={nfmt(kpi.pending)} color="bg-slate-500" icon={CalendarClock} />
        <Kpi label="Rescheduled" value={nfmt(kpi.rescheduled)} color="bg-amber-500" icon={CalendarClock} />
        <Kpi label="Canceled" value={nfmt(kpi.canceled)} color="bg-red-500" icon={AlertTriangle} />
        <Kpi label="Returned" value={nfmt(kpi.returned)} color="bg-rose-700" icon={Undo2} />
      </div>

      {kpi.total === 0 && (
        <p className="text-sm text-slate-400">
          Walang assigned orders sa range na ito — mag-assign muna sa <Link className="text-blue-600 underline underline-offset-2" href="/business/delivery/operations">Delivery Operations</Link> o <Link className="text-blue-600 underline underline-offset-2" href="/business/delivery/problematic">Problematic / RTS Ops</Link>.
        </p>
      )}

      {/* Trend chart */}
      {showCharts && chartData.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <p className="text-sm font-bold text-slate-800">Delivered vs RTS — daily</p>
          <p className="text-[11px] text-slate-400 mb-3">by assigned date, sa napiling range</p>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData} margin={{ left: 0, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="Delivered" stroke="#10b981" strokeWidth={2} dot={{ r: 2.5 }} />
              <Line type="monotone" dataKey="RTS" stroke="#ef4444" strokeWidth={2} dot={{ r: 2.5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Alerts */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <p className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4 text-amber-500" /> Operational Alerts
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5 text-sm">
          <AlertCard n={alerts.overdue.length} label="Overdue follow-ups" sub="next follow-up date lumipas na" href="/business/delivery/operations" tone={alerts.overdue.length > 0 ? "bad" : "ok"} />
          <AlertCard n={alerts.reschedToday.length} label="Reschedules due (unconfirmed)" sub="due today o lumipas, hindi pa kumpirmado" href="/business/delivery/operations" tone={alerts.reschedToday.length > 0 ? "warn" : "ok"} />
          <AlertCard n={alerts.untouched.length} label="Assigned but untouched" sub="Pending pa rin mula kahapon o mas matagal" href="/business/delivery/operations" tone={alerts.untouched.length > 0 ? "warn" : "ok"} />
          <AlertCard n={alerts.unassignedProblematic} label="Unassigned problematic" sub="live Problematic/RTS na walang agent" href="/business/delivery/problematic" tone={alerts.unassignedProblematic > 0 ? "bad" : "ok"} />
        </div>
      </div>

      {/* Daily summary */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <p className="text-sm font-bold text-slate-800 mb-3">Daily Operations Summary</p>
        <div className="overflow-x-auto scrollbar-dark">
          <table className="w-full text-sm border border-slate-200">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left">
                {["Date", "Assigned", "Contacted", "Contact %", "Delivered", "Delivery %", "RTS", "RTS %", "Recovered"].map(h => (
                  <th key={h} className="px-3 py-2 text-xs font-bold text-slate-600 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byDay.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">No assignments in this range.</td></tr>}
              {byDay.map(([d, r], i) => {
                const prev = byDay[i + 1]?.[1]
                const delta = prev ? r.delivered - prev.delivered : 0
                return (
                  <tr key={d} className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
                    <td className="px-3 py-2 font-medium text-slate-700 whitespace-nowrap">{d}{d === today && <span className="ml-1.5 text-[10px] font-bold text-blue-600">TODAY</span>}</td>
                    <td className="px-3 py-2 tabular-nums">{r.assigned}</td>
                    <td className="px-3 py-2 tabular-nums">{r.contacted}</td>
                    <td className="px-3 py-2 tabular-nums">{pct(r.contacted, r.assigned)}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {r.delivered}
                      {prev != null && delta !== 0 && <span className={`ml-1 text-[10px] font-bold ${delta > 0 ? "text-emerald-600" : "text-rose-600"}`}>{delta > 0 ? `▲${delta}` : `▼${-delta}`}</span>}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{pct(r.delivered, r.assigned)}</td>
                    <td className="px-3 py-2 tabular-nums">{r.rts}</td>
                    <td className="px-3 py-2 tabular-nums">{pct(r.rts, r.assigned)}</td>
                    <td className="px-3 py-2 tabular-nums">{r.recovered}</td>
                  </tr>
                )
              })}
            </tbody>
            {byDay.length > 0 && (
              <tfoot>
                <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold text-slate-800">
                  <td className="px-3 py-2">TOTAL</td>
                  <td className="px-3 py-2 tabular-nums">{kpi.total}</td>
                  <td className="px-3 py-2 tabular-nums">{kpi.contacted}</td>
                  <td className="px-3 py-2 tabular-nums">{pct(kpi.contacted, kpi.total)}</td>
                  <td className="px-3 py-2 tabular-nums">{kpi.delivered}</td>
                  <td className="px-3 py-2 tabular-nums">{pct(kpi.delivered, kpi.total)}</td>
                  <td className="px-3 py-2 tabular-nums">{kpi.rts}</td>
                  <td className="px-3 py-2 tabular-nums">{pct(kpi.rts, kpi.total)}</td>
                  <td className="px-3 py-2 tabular-nums">{kpi.recovered}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Agent leaderboard */}
      {!isAgent && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <p className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-1.5">
            <Users className="w-4 h-4 text-blue-500" /> Agent Leaderboard
          </p>
          <div className="overflow-x-auto scrollbar-dark">
            <table className="w-full text-sm border border-slate-200">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left">
                  {["Agent", "Assigned", "Contacted", "Contact %", "Delivered", "Delivery %", "RTS", "RTS %", "Recovered"].map(h => (
                    <th key={h} className="px-3 py-2 text-xs font-bold text-slate-600 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leaderboard.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">No agent data in this range.</td></tr>}
                {leaderboard.map((a, i) => (
                  <tr key={a.name + i} className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50"} hover:bg-blue-50/40`}>
                    <td className="px-3 py-2 font-medium text-slate-700">{a.name}</td>
                    <td className="px-3 py-2 tabular-nums">{a.assigned}</td>
                    <td className="px-3 py-2 tabular-nums">{a.contacted}</td>
                    <td className="px-3 py-2 tabular-nums">{pct(a.contacted, a.assigned)}</td>
                    <td className="px-3 py-2 tabular-nums">{a.delivered}</td>
                    <td className="px-3 py-2 tabular-nums">{pct(a.delivered, a.assigned)}</td>
                    <td className="px-3 py-2 tabular-nums">{a.rts}</td>
                    <td className="px-3 py-2 tabular-nums">{pct(a.rts, a.assigned)}</td>
                    <td className="px-3 py-2 tabular-nums">{a.recovered}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Stat card (h-[78px] idiom, ghost icon) ───────────────────────────────────
function Kpi({ label, value, color, icon: Icon, loading }: {
  label: string; value: string; color: string; icon: LucideIcon; loading?: boolean
}) {
  return (
    <div className={`relative h-[78px] rounded-xl ${color} text-white px-3.5 py-2.5 overflow-hidden`}>
      <Icon className="absolute right-1 bottom-0 w-14 h-14 opacity-[0.12]" />
      <p className="text-[11px] uppercase tracking-wider font-semibold opacity-90">{label}</p>
      <p className="text-2xl font-bold mt-1 tabular-nums">
        {loading ? <RefreshCw className="w-5 h-5 animate-spin opacity-80" /> : value}
      </p>
    </div>
  )
}

function AlertCard({ n, label, sub, href, tone }: { n: number; label: string; sub: string; href: string; tone: "ok" | "warn" | "bad" }) {
  const cls = tone === "bad" ? "border-red-200 bg-red-50" : tone === "warn" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"
  const num = tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : "text-slate-400"
  return (
    <Link href={href} className={`rounded-xl border ${cls} px-3.5 py-3 hover:opacity-90 transition-opacity`}>
      <p className={`text-2xl font-bold tabular-nums ${num}`}>{n}</p>
      <p className="font-semibold text-slate-700 mt-0.5">{label}</p>
      <p className="text-[11px] text-slate-400">{sub}</p>
    </Link>
  )
}
