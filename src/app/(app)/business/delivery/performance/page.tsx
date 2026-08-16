"use client"
import { useEffect, useMemo, useState } from "react"
import {
  Award, RefreshCw, ChevronLeft, History, Users, PhoneCall, PackageCheck, Undo2,
  TrendingUp, ClipboardList,
} from "lucide-react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import { useActivePages } from "@/lib/pages-store"
import { cachedJson, PANCAKE_CONCURRENCY } from "@/lib/pancake-cache"
import { currentUserEmail } from "@/lib/current-user"
import { useDeliveryTeam, resolveDeliveryRole } from "@/lib/delivery-team-store"
import {
  useDeliveryOrders, useDeliveryActivity, useDeliverySettings, computeAgentKpi,
  recoveryStage, RECOVERY_STAGES, RECOVERED_OUTCOMES,
  AGENT_STATUS_BADGE, RECOVERY_BADGE,
  type DeliveryOrder, type AgentKpi, type AgentStatus,
} from "@/lib/delivery-store"

// ──────────────────────────────────────────────────────────────────────────────
// AGENT PERFORMANCE (Phase 2) — KPI scorecard kada agent, drill-down sa isang
// agent, recovery funnel, at ang audit trail (Activity Log). Iisa lang ang
// pinagkukunan ng formula: computeAgentKpi() sa delivery-store, kaya laging
// tugma ang leaderboard sa dashboard. Ang timbang ng score ay configurable sa
// Delivery Settings → KPI Scoring.
// ──────────────────────────────────────────────────────────────────────────────

const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const nfmt = (n: number) => n.toLocaleString("en-PH")
const pctStr = (n: number) => `${n.toFixed(1)}%`

async function fetchPageRows(apiKey: string, pageId: string, from: string, to: string, noCache = false): Promise<any[]> {
  const json = await cachedJson(
    `/api/pancake/orders?api_key=${encodeURIComponent(apiKey)}&page_id=${encodeURIComponent(pageId)}`
    + `&from=${from}&to=${to}&phase=rows&basis=sales_order${noCache ? "&nocache=1" : ""}`,
    { force: noCache })
  return Array.isArray(json.rows) ? json.rows : []
}
async function mapLimit<T>(items: T[], limit: number, fn: (i: T) => Promise<void>) {
  let i = 0; await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) await fn(items[i++]) }))
}

const scoreTone = (s: number) =>
  s >= 80 ? "bg-emerald-50 text-emerald-700" : s >= 60 ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"
const scoreBar = (s: number) => (s >= 80 ? "#10b981" : s >= 60 ? "#f59e0b" : "#ef4444")

const TABS = ["Scorecards", "Recovery Funnel", "Activity Log"] as const
type Tab = typeof TABS[number]

export default function AgentPerformancePage() {
  const activePages = useActivePages()
  const pagesWithCreds = useMemo(() => activePages.filter(p => p.api_key && (p.pancake_page_id || p.shop_id)), [activePages])
  const store = useDeliveryOrders()
  const teamStore = useDeliveryTeam()
  const settings = useDeliverySettings()
  const me = currentUserEmail().toLowerCase()
  const role = resolveDeliveryRole(currentUserEmail(), teamStore.team)
  const isAgent = role === "agent"

  const [tab, setTab] = useState<Tab>("Scorecards")
  const now = new Date()
  const [dateA, setDateA] = useState(fmt(new Date(now.getFullYear(), now.getMonth(), 1)))
  const [dateB, setDateB] = useState(fmt(now))
  const [drill, setDrill] = useState<string | null>(null)   // agent email

  // ── Live Pancake join (para totoo ang Delivered/RTS) ────────────────────────
  const [liveRows, setLiveRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const pagesKey = pagesWithCreds.map(p => `${p.api_key}~${p.pancake_page_id || p.shop_id}~${p.name}`).join("|")
  const fetchFrom = useMemo(() => {
    const oldest = Object.values(store.orders).reduce((m, r) => (r.order_date && r.order_date < m ? r.order_date : m), dateA)
    const clamp = fmt(new Date(Date.now() - 60 * 86400_000))
    return oldest < clamp ? clamp : oldest
  }, [store.orders, dateA])
  async function load(noCache = false) {
    if (pagesWithCreds.length === 0) { setLiveRows([]); return }
    setLoading(true)
    const out: any[] = []
    await mapLimit(pagesWithCreds, PANCAKE_CONCURRENCY, async p => {
      try {
        const rs = await fetchPageRows(p.api_key, p.pancake_page_id || p.shop_id, fetchFrom, fmt(new Date()), noCache)
        for (const r of rs) out.push(r)
      } catch { /* per-page errors ay hindi dapat magpabagsak ng page */ }
    })
    setLiveRows(out); setLoading(false)
  }
  useEffect(() => { load() }, [pagesKey, `${fetchFrom}|${dateB}`])   // eslint-disable-line react-hooks/exhaustive-deps
  const liveById = useMemo(() => {
    const m = new Map<string, any>()
    for (const r of liveRows) m.set(String(r.id), r)
    return m
  }, [liveRows])

  const statusOf = (r: DeliveryOrder) => liveById.get(r.order_id)?.parcel_status || r.parcel_status_snapshot || ""
  const deliveredOf = (r: DeliveryOrder) => statusOf(r) === "Delivered" || r.agent_status === "Delivered"
  const rtsOf = (r: DeliveryOrder) => {
    const s = statusOf(r)
    return s === "Returned" || s === "Returning" || r.agent_status === "Returned/RTS"
  }

  // ── Scope + per-agent scorecards ────────────────────────────────────────────
  const scoped = useMemo(() => {
    let list = Object.values(store.orders).filter(r => r.assigned_date >= dateA && r.assigned_date <= dateB)
    if (isAgent) list = list.filter(r => r.assigned_to_email === me)
    return list
  }, [store.orders, dateA, dateB, isAgent, me])

  const scorecards = useMemo<AgentKpi[]>(() => {
    const byAgent = new Map<string, DeliveryOrder[]>()
    for (const r of scoped) {
      const key = r.assigned_to_email || "—"
      byAgent.set(key, [...(byAgent.get(key) || []), r])
    }
    return Array.from(byAgent.entries())
      .map(([email, rows]) => computeAgentKpi(
        email, rows[0]?.assigned_to_name || email, rows, settings.weights, deliveredOf, rtsOf))
      .sort((a, b) => b.score - a.score)
  }, [scoped, settings.weights, liveById])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Recovery funnel ─────────────────────────────────────────────────────────
  const funnel = useMemo(() => {
    const problematic = scoped.filter(r => r.assignment_type === "problematic")
    const counts = new Map<string, number>()
    for (const r of problematic) {
      const s = recoveryStage(r)
      counts.set(s, (counts.get(s) || 0) + 1)
    }
    return {
      total: problematic.length,
      recovered: problematic.filter(r => RECOVERED_OUTCOMES.includes(r.recovery_outcome)).length,
      stages: RECOVERY_STAGES.map(s => ({ name: s, value: counts.get(s) || 0 })),
      byOutcome: Array.from(problematic.reduce((m, r) => {
        const k = r.recovery_outcome || "Open (no verdict)"
        return m.set(k, (m.get(k) || 0) + 1)
      }, new Map<string, number>()).entries()).sort((a, b) => b[1] - a[1]),
    }
  }, [scoped])

  const drillKpi = drill ? scorecards.find(s => s.email === drill) : null
  const drillRows = useMemo(
    () => (drill ? scoped.filter(r => r.assigned_to_email === drill) : []),
    [scoped, drill])

  const SEL = "h-9 rounded-lg border border-slate-300 px-2 text-sm bg-white focus:outline-none focus:border-blue-400"

  // ── Agent drill-down (full-page, early return) ──────────────────────────────
  if (drill && drillKpi) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3 pb-4 border-b border-slate-100">
          <div>
            <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2">
              <Award className="w-5 h-5" /> {(drillKpi.name || drillKpi.email).toUpperCase()}
            </h1>
            <p className="text-[11px] text-slate-400 mt-0.5">{drillKpi.email} · {dateA} → {dateB}</p>
          </div>
          <button onClick={() => setDrill(null)} className="h-10 px-4 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5">
            <ChevronLeft className="w-4 h-4" /> Back to scorecards
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
          <Stat label="KPI Score" value={pctStr(drillKpi.score)} color="bg-blue-600" icon={Award} />
          <Stat label="Assigned" value={nfmt(drillKpi.assigned)} color="bg-slate-600" icon={ClipboardList} />
          <Stat label="Worked" value={nfmt(drillKpi.worked)} color="bg-indigo-500" icon={TrendingUp} />
          <Stat label="Delivered" value={nfmt(drillKpi.delivered)} color="bg-emerald-600" icon={PackageCheck} />
          <Stat label="RTS" value={nfmt(drillKpi.rts)} color="bg-rose-600" icon={Undo2} />
          <Stat label="Calls Made" value={nfmt(drillKpi.calls)} color="bg-violet-600" icon={PhoneCall} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <p className="text-sm font-bold text-slate-800 mb-3">KPI Breakdown</p>
            <div className="space-y-2.5">
              <MetricBar label="Delivery Rate" value={drillKpi.deliveryRate} weight={settings.weights.delivery} />
              <MetricBar label="Contact Rate" value={drillKpi.contactRate} weight={settings.weights.contact} />
              <MetricBar label="Recovery Rate" value={drillKpi.recoveryRate} weight={settings.weights.recovery}
                note={drillKpi.problematic === 0 ? "walang problematic case — hindi kasama sa score" : undefined} />
              <MetricBar label="Productivity" value={drillKpi.productivity} weight={settings.weights.productivity} />
              <MetricBar label="Follow-up completion" value={drillKpi.followUpRate} weight={settings.weights.followup} />
            </div>
            <p className="text-[11px] text-slate-400 mt-3">RTS Rate: {pctStr(drillKpi.rtsRate)} (hindi kasama sa score — resulta ito ng courier/customer, hindi lang ng agent)</p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <p className="text-sm font-bold text-slate-800 mb-3">Counts</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
              {([
                ["Contacted", drillKpi.contacted], ["Not contacted", drillKpi.notContacted],
                ["Pending", drillKpi.pending], ["Rescheduled", drillKpi.rescheduled],
                ["Canceled", drillKpi.canceled], ["Returned / RTS", drillKpi.returned],
                ["Problematic assigned", drillKpi.problematic], ["Recovered", drillKpi.recovered],
                ["Follow-ups due", drillKpi.followUpsDue], ["Follow-ups done", drillKpi.followUpsDone],
              ] as const).map(([l, v]) => (
                <div key={l} className="flex items-center justify-between border-b border-slate-100 py-1">
                  <span className="text-slate-500">{l}</span>
                  <span className="font-semibold text-slate-800 tabular-nums">{nfmt(v)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <p className="text-sm font-bold text-slate-800 mb-3">Assigned Orders ({drillRows.length})</p>
          <div className="overflow-x-auto scrollbar-dark max-h-[50vh]">
            <table className="w-full text-sm border border-slate-200">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-50 border-b border-slate-200 text-left">
                  {["Order ID", "Customer", "Queue", "Delivery Status", "Agent Status", "Recovery", "Attempts", "Last Updated"].map(h => (
                    <th key={h} className="px-3 py-2 text-xs font-bold text-slate-600 whitespace-nowrap bg-slate-50">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {drillRows.map((r, i) => (
                  <tr key={r.order_id} className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.order_id}</td>
                    <td className="px-3 py-2 text-slate-700 max-w-[180px] truncate">{r.customer_name}</td>
                    <td className="px-3 py-2 text-slate-500 capitalize">{r.assignment_type}</td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{statusOf(r) || "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${AGENT_STATUS_BADGE[r.agent_status as AgentStatus] || "bg-slate-100 text-slate-600"}`}>{r.agent_status}</span>
                    </td>
                    <td className="px-3 py-2">
                      {r.recovery_outcome
                        ? <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${RECOVERY_BADGE[r.recovery_outcome] || "bg-slate-100 text-slate-600"}`}>{r.recovery_outcome}</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{r.call_attempts}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{String(r.updated_at).slice(0, 16).replace("T", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 pb-4 mb-1 border-b border-slate-100">
        <div>
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2">
            <Award className="w-5 h-5" /> AGENT PERFORMANCE
          </h1>
          <p className="text-[11px] text-slate-400 mt-0.5">
            KPI scorecards, recovery funnel at audit trail · your role: <span className="font-semibold uppercase">{role}</span>
            {isAgent && " · sariling numbers mo lang"}
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
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200">
        {TABS.filter(t => t !== "Activity Log" || !isAgent).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Scorecards" && (
        <>
          {scorecards.length === 0 ? (
            <p className="text-sm text-slate-400 py-6">Walang assigned orders sa range na ito.</p>
          ) : (
            <>
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <p className="text-sm font-bold text-slate-800">KPI Score per Agent</p>
                <p className="text-[11px] text-slate-400 mb-3">
                  Weights: {Object.entries(settings.weights).map(([k, v]) => `${k} ${v}%`).join(" · ")} — baguhin sa Delivery Ops → Settings → KPI Scoring
                </p>
                <ResponsiveContainer width="100%" height={Math.max(160, scorecards.length * 38)}>
                  <BarChart data={scorecards.map(s => ({ name: s.name || s.email, value: Number(s.score.toFixed(1)) }))}
                    layout="vertical" margin={{ left: 8, right: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: any) => [`${v}%`, "KPI Score"]} />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                      {scorecards.map(s => <Cell key={s.email} fill={scoreBar(s.score)} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <p className="text-sm font-bold text-slate-800 mb-3">Scorecard — pindutin ang agent para sa detalye</p>
                <div className="overflow-x-auto scrollbar-dark">
                  <table className="w-full text-sm border border-slate-200">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-left">
                        {["Agent", "Assigned", "Worked", "Delivered", "Delivery %", "RTS", "RTS %",
                          "Problematic", "Recovered", "Recovery %", "Calls", "Connected", "Not Conn.",
                          "Contact %", "Pending", "Resched.", "Canceled", "Returned", "KPI Score"].map(h => (
                          <th key={h} className="px-2.5 py-2 text-xs font-bold text-slate-600 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {scorecards.map((s, i) => (
                        <tr key={s.email} onClick={() => setDrill(s.email)}
                          className={`border-b border-slate-100 cursor-pointer ${i % 2 === 0 ? "bg-white" : "bg-slate-50"} hover:bg-blue-50/60`}>
                          <td className="px-2.5 py-2 font-medium text-slate-700 whitespace-nowrap max-w-[160px] truncate">{s.name || s.email}</td>
                          <td className="px-2.5 py-2 tabular-nums">{s.assigned}</td>
                          <td className="px-2.5 py-2 tabular-nums">{s.worked}</td>
                          <td className="px-2.5 py-2 tabular-nums">{s.delivered}</td>
                          <td className="px-2.5 py-2 tabular-nums">{pctStr(s.deliveryRate)}</td>
                          <td className="px-2.5 py-2 tabular-nums">{s.rts}</td>
                          <td className="px-2.5 py-2 tabular-nums">{pctStr(s.rtsRate)}</td>
                          <td className="px-2.5 py-2 tabular-nums">{s.problematic}</td>
                          <td className="px-2.5 py-2 tabular-nums">{s.recovered}</td>
                          <td className="px-2.5 py-2 tabular-nums">{s.problematic > 0 ? pctStr(s.recoveryRate) : "—"}</td>
                          <td className="px-2.5 py-2 tabular-nums">{s.calls}</td>
                          <td className="px-2.5 py-2 tabular-nums">{s.contacted}</td>
                          <td className="px-2.5 py-2 tabular-nums">{s.notContacted}</td>
                          <td className="px-2.5 py-2 tabular-nums">{pctStr(s.contactRate)}</td>
                          <td className="px-2.5 py-2 tabular-nums">{s.pending}</td>
                          <td className="px-2.5 py-2 tabular-nums">{s.rescheduled}</td>
                          <td className="px-2.5 py-2 tabular-nums">{s.canceled}</td>
                          <td className="px-2.5 py-2 tabular-nums">{s.returned}</td>
                          <td className="px-2.5 py-2">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold tabular-nums ${scoreTone(s.score)}`}>{pctStr(s.score)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {tab === "Recovery Funnel" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <p className="text-sm font-bold text-slate-800">Recovery Pipeline</p>
            <p className="text-[11px] text-slate-400 mb-3">
              {funnel.total} problematic case{funnel.total === 1 ? "" : "s"} · {funnel.recovered} recovered
              {funnel.total > 0 && ` (${((funnel.recovered / funnel.total) * 100).toFixed(1)}%)`}
            </p>
            {funnel.total === 0 ? (
              <p className="text-sm text-slate-400 py-6">Walang problematic case sa range na ito.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={funnel.stages} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#a855f7" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <p className="text-sm font-bold text-slate-800 mb-3">Outcomes</p>
            {funnel.byOutcome.length === 0 ? (
              <p className="text-sm text-slate-400">—</p>
            ) : (
              <div className="space-y-1.5">
                {funnel.byOutcome.map(([name, n]) => (
                  <div key={name} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${RECOVERY_BADGE[name] || "bg-slate-100 text-slate-500"}`}>{name}</span>
                    <span className="font-semibold text-slate-800 tabular-nums">
                      {n} <span className="text-slate-400 font-normal">({((n / funnel.total) * 100).toFixed(1)}%)</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "Activity Log" && !isAgent && <ActivityLog />}
    </div>
  )
}

// ── Audit trail viewer (spec §22 — Admin/Supervisor) ─────────────────────────
function ActivityLog() {
  const { activity, refresh } = useDeliveryActivity(500)
  const [q, setQ] = useState("")
  const [action, setAction] = useState("All")
  const actions = useMemo(() => Array.from(new Set(activity.map(a => a.action).filter(Boolean))).sort(), [activity])
  const rows = useMemo(() => activity.filter(a => {
    if (action !== "All" && a.action !== action) return false
    if (!q.trim()) return true
    const s = q.toLowerCase()
    return [a.order_id, a.action, a.detail, a.by_name, a.by_email].some(v => String(v).toLowerCase().includes(s))
  }), [activity, action, q])

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
          <History className="w-4 h-4 text-slate-500" /> Activity & Audit Trail
          <span className="text-[11px] font-normal text-slate-400">(latest 500)</span>
        </p>
        <div className="flex items-center gap-2">
          <select className="h-9 rounded-lg border border-slate-300 px-2 text-sm bg-white" value={action} onChange={e => setAction(e.target.value)}>
            <option>All</option>{actions.map(a => <option key={a}>{a}</option>)}
          </select>
          <input className="h-9 w-56 rounded-lg border border-slate-300 px-2.5 text-sm bg-white focus:outline-none focus:border-blue-400"
            placeholder="Search order, user, detail…" value={q} onChange={e => setQ(e.target.value)} />
          <button onClick={refresh} className="h-9 w-9 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 flex items-center justify-center">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="overflow-x-auto scrollbar-dark max-h-[62vh]">
        <table className="w-full text-sm border border-slate-200">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-50 border-b border-slate-200 text-left">
              {["When", "Action", "Detail", "Order ID", "By"].map(h => (
                <th key={h} className="px-3 py-2 text-xs font-bold text-slate-600 whitespace-nowrap bg-slate-50">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">Walang activity na tumutugma.</td></tr>}
            {rows.map((a, i) => (
              <tr key={a.id} className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
                <td className="px-3 py-2 text-slate-500 whitespace-nowrap tabular-nums">{String(a.at).slice(0, 16).replace("T", " ")}</td>
                <td className="px-3 py-2 font-medium text-slate-700 whitespace-nowrap">{a.action}</td>
                <td className="px-3 py-2 text-slate-600 max-w-[380px] truncate" title={a.detail}>{a.detail || "—"}</td>
                <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{a.order_id || <span className="italic">batch</span>}</td>
                <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{a.by_name || a.by_email || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ label, value, color, icon: Icon }: { label: string; value: string; color: string; icon: any }) {
  return (
    <div className={`relative h-[78px] rounded-xl ${color} text-white px-3.5 py-2.5 overflow-hidden`}>
      <Icon className="absolute right-1 bottom-0 w-14 h-14 opacity-[0.12]" />
      <p className="text-[11px] uppercase tracking-wider font-semibold opacity-90">{label}</p>
      <p className="text-2xl font-bold mt-1 tabular-nums">{value}</p>
    </div>
  )
}

function MetricBar({ label, value, weight, note }: { label: string; value: number; weight: number; note?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-slate-600">{label} <span className="text-[11px] text-slate-400">· weight {weight}%</span></span>
        <span className="font-semibold text-slate-800 tabular-nums">{pctStr(value)}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, value)}%`, background: scoreBar(value) }} />
      </div>
      {note && <p className="text-[11px] text-amber-600 mt-0.5">{note}</p>}
    </div>
  )
}
