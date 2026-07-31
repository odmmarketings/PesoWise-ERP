"use client"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  ClipboardList, Plus, Search, LayoutDashboard, ListChecks, AlertTriangle,
  CheckCircle2, Clock, Activity, Timer, RefreshCw, Trash2,
} from "lucide-react"
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts"
import {
  useProblems, useProblemDepartments, resolveRole, managedDepartments, canEdit,
  deadlineInfo, isClosed, PRIORITIES, STATUSES, PRIORITY_CLASS, PRIORITY_COLOR,
  STATUS_CLASS, STATUS_COLOR, TONE_CLASS, TONE_DOT,
  type Problem, type NewProblemInput,
} from "@/lib/problems-store"
import { useErpUsers } from "@/lib/users-store"
import { currentUserEmail } from "@/lib/current-user"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import { ProblemFormModal } from "@/components/business/problems/ProblemFormModal"
import { ProblemDetailModal } from "@/components/business/problems/ProblemDetailModal"

// ──────────────────────────────────────────────────────────────────────────────
// PROBLEM MANAGEMENT (Root Cause Analysis) — pinapalitan nito ang dating Kanban Board.
// Bawat isyu ay may may-ari, root cause, solusyon, deadline, at katayuan, para madaling
// masubaybayan ng management ang buong negosyo.
// ──────────────────────────────────────────────────────────────────────────────

const SEL = "h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:border-blue-400"
type Scope = "all" | "open" | "closed" | "overdue" | "due_soon"
type Basis = "reported" | "deadline" | "completed"

const startOfWeek = () => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d }
const startOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) }
const dStr = (s: string) => s ? new Date(s + "T00:00:00").getTime() : NaN

export default function ProblemManagementPage() {
  const store = useProblems()
  const deps = useProblemDepartments()
  const { users } = useErpUsers()

  const [tab, setTab] = useState<"dashboard" | "list">("dashboard")
  const [showAdd, setShowAdd] = useState(false)
  const [edit, setEdit] = useState<Problem | null>(null)
  const [detail, setDetail] = useState<Problem | null>(null)
  // Delete = admin lang, at laging may kumpirmasyon. Tinatanggal nito ang problema
  // KASAMA ang buong RCA thread nito — walang undo, kaya hindi puwedeng one-click.
  const [confirmDel, setConfirmDel] = useState<Problem | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Filters
  const [q, setQ] = useState("")
  const [fDept, setFDept] = useState("All")
  const [fUser, setFUser] = useState("All")
  const [fStatus, setFStatus] = useState("All")
  const [fPriority, setFPriority] = useState("All")
  const [scope, setScope] = useState<Scope>("all")
  const [basis, setBasis] = useState<Basis>("reported")
  const [dateA, setDateA] = useState("")
  const [dateB, setDateB] = useState("")

  const email = currentUserEmail()
  const role = useMemo(() => resolveRole(email, deps.departments), [email, deps.departments])
  const managed = useMemo(() => managedDepartments(email, deps.departments), [email, deps.departments])

  // ── Visibility per role: Admin = lahat · Manager = department nila · Employee = naka-assign sa kanila.
  const visible = useMemo(() => {
    if (role === "admin") return store.problems
    const e = email.toLowerCase()
    return store.problems.filter(p => {
      if (role === "manager" && managed.includes(p.department)) return true
      return p.owner_email.toLowerCase() === e || p.support_emails.some(s => s.toLowerCase() === e)
    })
  }, [store.problems, role, managed, email])

  // ── Applied filters
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return visible.filter(p => {
      if (needle && !`${p.code} ${p.title} ${p.description} ${p.root_cause} ${p.solution} ${p.notes}`.toLowerCase().includes(needle)) return false
      if (fDept !== "All" && p.department !== fDept) return false
      if (fUser !== "All" && p.owner_email !== fUser) return false
      if (fStatus !== "All" && p.status !== fStatus) return false
      if (fPriority !== "All" && p.priority !== fPriority) return false

      const dl = deadlineInfo(p)
      if (scope === "open" && isClosed(p.status)) return false
      if (scope === "closed" && !isClosed(p.status)) return false
      if (scope === "overdue" && dl.tone !== "overdue") return false
      if (scope === "due_soon" && !(dl.tone === "soon" || dl.tone === "today")) return false

      if (dateA || dateB) {
        const v = basis === "reported" ? p.date_reported : basis === "deadline" ? p.target_date : p.actual_completion_date
        if (!v) return false
        const t = dStr(v)
        if (dateA && t < dStr(dateA)) return false
        if (dateB && t > dStr(dateB)) return false
      }
      return true
    })
  }, [visible, q, fDept, fUser, fStatus, fPriority, scope, basis, dateA, dateB])

  // ── Dashboard stats
  const stats = useMemo(() => {
    const wk = startOfWeek().getTime(), mo = startOfMonth().getTime()
    const today = new Date(); today.setHours(0, 0, 0, 0)
    let open = 0, inProgress = 0, overdue = 0, cToday = 0, cWeek = 0, cMonth = 0
    let resolvedDays = 0, resolvedCount = 0
    for (const p of visible) {
      const closed = isClosed(p.status)
      if (!closed) open++
      if (p.status === "In Progress") inProgress++
      if (!closed && deadlineInfo(p).tone === "overdue") overdue++
      if (p.status === "Completed" && p.actual_completion_date) {
        const t = dStr(p.actual_completion_date)
        if (t >= today.getTime()) cToday++
        if (t >= wk) cWeek++
        if (t >= mo) cMonth++
        const r = dStr(p.date_reported)
        if (!isNaN(r) && !isNaN(t)) { resolvedDays += Math.max(0, Math.round((t - r) / 86400000)); resolvedCount++ }
      }
    }
    return {
      total: visible.length, open, inProgress, overdue, cToday, cWeek, cMonth,
      avgResolution: resolvedCount ? resolvedDays / resolvedCount : 0, resolvedCount,
    }
  }, [visible])

  const byDept = useMemo(() => {
    const m: Record<string, number> = {}
    for (const p of visible) m[p.department || "—"] = (m[p.department || "—"] || 0) + 1
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10)
  }, [visible])

  const byStatus = useMemo(() =>
    STATUSES.map(s => ({ name: s, value: visible.filter(p => p.status === s).length })).filter(x => x.value > 0)
  , [visible])

  const byPriority = useMemo(() =>
    PRIORITIES.map(p => ({ name: p, value: visible.filter(x => x.priority === p).length })).filter(x => x.value > 0)
  , [visible])

  const trend = useMemo(() => {
    const months: { key: string; name: string; reported: number; completed: number }[] = []
    const now = new Date()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        name: d.toLocaleString("en-PH", { month: "short" }), reported: 0, completed: 0,
      })
    }
    const idx = Object.fromEntries(months.map((m, i) => [m.key, i]))
    for (const p of visible) {
      const r = (p.date_reported || "").slice(0, 7)
      if (idx[r] !== undefined) months[idx[r]].reported++
      const c = (p.actual_completion_date || "").slice(0, 7)
      if (p.status === "Completed" && idx[c] !== undefined) months[idx[c]].completed++
    }
    return months
  }, [visible])

  const topResolvers = useMemo(() => {
    const m: Record<string, number> = {}
    for (const p of visible) {
      if (p.status !== "Completed") continue
      const k = p.owner_name || p.owner_email || "—"
      m[k] = (m[k] || 0) + 1
    }
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8)
  }, [visible])

  const cards = [
    { label: "TOTAL PROBLEMS", value: stats.total, color: "bg-slate-700", icon: ClipboardList },
    { label: "OPEN", value: stats.open, color: "bg-blue-500", icon: Activity },
    { label: "IN PROGRESS", value: stats.inProgress, color: "bg-cyan-500", icon: Clock },
    { label: "OVERDUE", value: stats.overdue, color: "bg-red-500", icon: AlertTriangle },
    { label: "COMPLETED TODAY", value: stats.cToday, color: "bg-emerald-500", icon: CheckCircle2 },
    { label: "COMPLETED THIS WEEK", value: stats.cWeek, color: "bg-emerald-600", icon: CheckCircle2 },
    { label: "COMPLETED THIS MONTH", value: stats.cMonth, color: "bg-teal-600", icon: CheckCircle2 },
  ]

  async function handleCreate(input: NewProblemInput) { await store.addProblem(input) }
  async function handleEdit(input: NewProblemInput) { if (edit) await store.updateProblem(edit.id, input, edit) }

  const assignable = users.filter(u => u.email && u.status === "Active")

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2 pb-4 border-b border-slate-100">
        <div>
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2">
            <ClipboardList className="w-5 h-5" /> PROBLEM MANAGEMENT
          </h1>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Root Cause Analysis · {role === "admin" ? "Administrator" : role === "manager" ? `Manager · ${managed.join(", ") || "no department"}` : "Employee"} view
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={store.refresh} title="Refresh"
            className="h-9 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
            <RefreshCw className="w-4 h-4" />
          </button>
          <Button onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Report a Problem</Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1">
        {([["dashboard", "Dashboard", LayoutDashboard], ["list", `Problems (${rows.length})`, ListChecks]] as const).map(([k, label, Ico]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 ${tab === k ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100 border border-slate-200"}`}>
            <Ico className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "dashboard" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2.5">
            {cards.map(c => (
              <div key={c.label} className={`relative overflow-hidden ${c.color} rounded-xl px-4 py-3 h-[78px] flex items-center justify-between`}>
                <c.icon strokeWidth={1} className="absolute -left-2 w-16 h-16 opacity-[0.12] text-white" />
                <div className="text-right ml-auto z-10">
                  <p className="text-2xl font-bold text-white leading-none tabular-nums">{c.value}</p>
                  <p className="text-[10px] text-white/75 font-semibold mt-1 tracking-wider uppercase leading-tight">{c.label}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Problems by Department" subtitle="Most at the top">
              {byDept.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={byDept} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#2563eb" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Problems by Status">
              {byStatus.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={byStatus} dataKey="value" nameKey="name" outerRadius={95} label={(e: any) => `${e.name} (${e.value})`} labelLine={false} fontSize={10}>
                      {byStatus.map(s => <Cell key={s.name} fill={STATUS_COLOR[s.name] || "#94a3b8"} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Problems by Priority">
              {byPriority.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={byPriority}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                      {byPriority.map(p => <Cell key={p.name} fill={PRIORITY_COLOR[p.name as keyof typeof PRIORITY_COLOR]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Monthly Trend" subtitle="Reported vs completed, last 6 months">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="reported" name="Reported" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="completed" name="Completed" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Top Employees Resolving Problems">
              {topResolvers.length === 0 ? <Empty label="No problems completed yet." /> : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={topResolvers} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#10b981" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Average Resolution Time">
              <div className="h-[240px] flex flex-col items-center justify-center gap-2">
                <Timer className="w-10 h-10 text-slate-300" />
                <p className="text-4xl font-extrabold text-slate-800 tabular-nums">
                  {stats.avgResolution.toFixed(1)}<span className="text-lg font-semibold text-slate-400 ml-1">days</span>
                </p>
                <p className="text-xs text-slate-400">from {stats.resolvedCount} completed problems</p>
              </div>
            </ChartCard>
          </div>
        </div>
      )}

      {tab === "list" && (
        <div className="space-y-3">
          {/* Filters */}
          <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input className="pl-8" value={q} placeholder="Search title, Problem ID, or keywords…"
                  onChange={e => setQ(e.target.value)} />
              </div>
              <select className={SEL} value={fDept} onChange={e => setFDept(e.target.value)}>
                <option value="All">All Departments</option>
                {deps.departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
              <select className={SEL} value={fUser} onChange={e => setFUser(e.target.value)}>
                <option value="All">All Users</option>
                {assignable.map(u => <option key={u.id} value={u.email}>{u.full_name || u.email}</option>)}
              </select>
              <select className={SEL} value={fStatus} onChange={e => setFStatus(e.target.value)}>
                <option value="All">All Status</option>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select className={SEL} value={fPriority} onChange={e => setFPriority(e.target.value)}>
                <option value="All">All Priority</option>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2 flex-wrap border-t border-slate-100 pt-2.5">
              {([["all", "All"], ["open", "Open"], ["closed", "Closed"], ["overdue", "Overdue"], ["due_soon", "Due Soon"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setScope(k)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold border ${scope === k ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                  {label}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-2">
                <select className={SEL} value={basis} onChange={e => setBasis(e.target.value as Basis)}>
                  <option value="reported">Date Reported</option>
                  <option value="deadline">Deadline</option>
                  <option value="completed">Completed Date</option>
                </select>
                {/* Isang Pancake-style na range picker imbes na dalawang native
                    <input type="date">. Ang native ay iba-iba ang itsura kada
                    browser/OS at may sariling Clear/Today na hindi tugma sa app. */}
                <DateRangePicker a={dateA} b={dateB} placeholder="All dates"
                  onApply={(a, b) => { setDateA(a); setDateB(b) }} />
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-[11px] font-semibold uppercase tracking-wide border-b border-slate-200">
                    <th className="px-4 py-3 text-left">Problem</th>
                    <th className="px-4 py-3 text-left">Department</th>
                    <th className="px-4 py-3 text-left">Owner</th>
                    <th className="px-4 py-3 text-left">Priority</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Target</th>
                    <th className="px-4 py-3 text-left">Days Left</th>
                    <th className="px-4 py-3 text-left">Last Updated</th>
                    {role === "admin" && <th className="px-4 py-3 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {!store.loaded && (
                    <tr><td colSpan={role === "admin" ? 9 : 8} className="px-4 py-10 text-center text-sm text-slate-400 italic">Loading&hellip;</td></tr>
                  )}
                  {store.loaded && rows.length === 0 && (
                    <tr><td colSpan={role === "admin" ? 9 : 8} className="px-4 py-10 text-center text-sm text-slate-400 italic">
                      No problems match the filter. Click “Report a Problem” to add one.
                    </td></tr>
                  )}
                  {rows.map(p => {
                    const dl = deadlineInfo(p)
                    return (
                      <tr key={p.id} onClick={() => setDetail(p)}
                        className="hover:bg-blue-50/40 cursor-pointer transition-colors">
                        <td className="px-4 py-3 min-w-[260px]">
                          <div className="flex items-start gap-2">
                            <span className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: TONE_DOT[dl.tone] }} />
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-800 leading-tight truncate">{p.title}</p>
                              <p className="text-[11px] text-slate-400 font-mono">{p.code}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-600">{p.department || "—"}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-600">{p.owner_name || p.owner_email || "—"}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${PRIORITY_CLASS[p.priority]}`}>{p.priority}</span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_CLASS[p.status] || "bg-slate-100 text-slate-600"}`}>{p.status}</span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-slate-600">{p.target_date || "—"}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${TONE_CLASS[dl.tone]}`}>{dl.label}</span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-400">
                          {p.updated_at ? new Date(p.updated_at).toLocaleDateString("en-PH", { month: "short", day: "numeric" }) : "—"}
                        </td>
                        {role === "admin" && (
                          <td className="px-4 py-3 whitespace-nowrap text-right">
                            {/* stopPropagation — kung hindi, bubuksan din ang detail modal. */}
                            <button onClick={e => { e.stopPropagation(); setConfirmDel(p) }}
                              title={`Delete ${p.code}`} aria-label={`Delete ${p.code}`}
                              className="p-1.5 rounded-lg text-slate-300 hover:text-rose-600 hover:bg-rose-50 transition-colors">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[11px] text-slate-400">
            🟢 On Track · 🟡 Due Soon · 🔴 Overdue — click a row for Root Cause Analysis, comments, and timeline.
          </p>
        </div>
      )}

      {showAdd && (
        <ProblemFormModal departments={deps.activeDepartments} users={users}
          onClose={() => setShowAdd(false)} onSave={handleCreate} />
      )}
      {edit && (
        <ProblemFormModal initial={edit} departments={deps.activeDepartments} users={users}
          onClose={() => setEdit(null)} onSave={handleEdit} />
      )}
      {detail && (
        <ProblemDetailModal
          problem={detail} users={users} role={role}
          editable={canEdit(detail, role, email, managed)}
          onClose={() => setDetail(null)}
          onSave={async patch => {
            await store.updateProblem(detail.id, patch, detail)
            setDetail({ ...detail, ...patch } as Problem)
          }}
          onApprove={async () => { await store.approveProblem(detail.id); setDetail(null) }}
        />
      )}

      {/* ── Kumpirmasyon bago mag-delete (admin lang) ────────────────────────────
          Ipinapakita ang code at pamagat para may makitang totoong pagkakakilanlan
          ang admin bago pumindot — hindi sapat ang "Sigurado ka ba?". */}
      {confirmDel && role === "admin" && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => !deleting && setConfirmDel(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-rose-600" />
              <h2 className="text-base font-bold text-slate-800">Delete this problem?</h2>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                <p className="font-semibold text-slate-800 text-sm leading-tight">{confirmDel.title}</p>
                <p className="text-[11px] text-slate-400 font-mono mt-0.5">{confirmDel.code} · {confirmDel.department || "—"}</p>
              </div>
              <p className="text-sm text-slate-600">
                This deletes the problem along with its <strong>root cause, solution, comments, and full timeline</strong>.
                <strong className="text-rose-600"> This cannot be undone.</strong>
              </p>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
              <button onClick={() => setConfirmDel(null)} disabled={deleting}
                className="h-9 px-4 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
              <button disabled={deleting}
                onClick={async () => {
                  setDeleting(true)
                  try {
                    await store.removeProblem(confirmDel.id)
                    // Kung bukas ang detail ng kaparehong problema, isara — wala na ito.
                    if (detail?.id === confirmDel.id) setDetail(null)
                    setConfirmDel(null)
                  } finally { setDeleting(false) }
                }}
                className="h-9 px-4 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold disabled:opacity-50">
                {deleting ? "Binubura…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="mb-2">
        <p className="text-sm font-bold text-slate-800">{title}</p>
        {subtitle && <p className="text-[11px] text-slate-400">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}
const Empty = ({ label = "No data yet." }: { label?: string }) => (
  <div className="h-[240px] flex items-center justify-center text-sm text-slate-400 italic">{label}</div>
)
