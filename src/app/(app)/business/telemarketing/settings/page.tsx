"use client"
// Telemarketing Settings — ADMIN ONLY (spec §31). Config for agents (§15), targets (§6),
// hour blocks (§8), report schedule + Discord (§20–21), KPI weights (§24), and general lists.
// Data layer: telemarketing-store (Supabase source of truth, localStorage read cache).
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Settings, Shield, Plus, Pencil, X, Check, Trash2, Power, AlertTriangle,
  Eye, EyeOff, Save, RotateCcw, Clock3,
} from "lucide-react"
import {
  useTmAgents, useTmTargets, useTmSettings, hourLabel, thisMonthStr,
  DEFAULT_KPI_WEIGHTS,
  type TmAgent, type TmTarget, type TmKpiWeights, type TmGeneral,
} from "@/lib/telemarketing-store"
import { isMotherAccount } from "@/lib/users-store"
import { formatCurrency } from "@/lib/utils"

const TABS = ["Agents", "Targets", "Schedule", "Reports & Discord", "KPI Weights", "General"] as const
type Tab = typeof TABS[number]

const INP = "w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white focus:outline-none focus:border-blue-400"
const NUM = "h-9 w-full rounded-lg border border-slate-300 px-2 text-sm bg-white text-right tabular-nums focus:outline-none focus:border-blue-400"
const num = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
const h12 = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h >= 12 ? "PM" : "AM"}`

const KPI_FIELDS: { key: keyof TmKpiWeights; label: string }[] = [
  { key: "sales_achievement", label: "Sales Achievement" },
  { key: "orders_achievement", label: "Orders Achievement" },
  { key: "conversion", label: "Conversion" },
  { key: "contact_rate", label: "Contact Rate" },
  { key: "upsell", label: "Upsell" },
  { key: "cross_sell", label: "Cross-sell" },
  { key: "productivity", label: "Productivity" },
]
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

// ── Small shared bits (module scope — never define these inside a component) ──
function Switch({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${on ? "bg-blue-600" : "bg-slate-300"} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  )
}

function StatusPill({ active }: { active: boolean }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{active ? "Active" : "Inactive"}</span>
}

function Modal({ title, icon: Icon, onClose, children, width = "max-w-lg" }: {
  title: string; icon?: React.ComponentType<{ className?: string }>; onClose: () => void; children: React.ReactNode; width?: string
}) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className={`bg-white rounded-2xl w-full ${width} shadow-2xl max-h-[92vh] flex flex-col overflow-hidden`}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-bold text-slate-900 text-base flex items-center gap-2">{Icon && <Icon className="w-5 h-5 text-blue-600" />}{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function SimpleTable({ cols, rows }: { cols: string[]; rows: React.ReactNode }) {
  return (
    <div className="overflow-x-auto border border-slate-200 rounded-xl">
      <table className="w-full text-sm">
        <thead><tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
          {cols.map(c => <th key={c} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{c}</th>)}
        </tr></thead>
        <tbody className="divide-y divide-slate-100">{rows}</tbody>
      </table>
    </div>
  )
}

function SkeletonRows({ n = 4 }: { n?: number }) {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: n }).map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded-lg" />)}
    </div>
  )
}

function PageHeader() {
  return (
    <div className="flex items-center justify-between pb-4 border-b border-slate-100">
      <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Settings className="w-5 h-5" /> TELEMARKETING SETTINGS</h1>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function TmSettingsPage() {
  // isMotherAccount() reads localStorage — resolve after mount so SSR/CSR markup match.
  const [admin, setAdmin] = useState<boolean | null>(null)
  useEffect(() => { setAdmin(isMotherAccount()) }, [])

  const agentsApi = useTmAgents()
  const targetsApi = useTmTargets()
  const settings = useTmSettings()
  const [tab, setTab] = useState<Tab>("Agents")
  const [toast, setToast] = useState("")
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500) }

  if (admin === null) {
    return (
      <div className="space-y-4">
        <span className="text-sm text-slate-500 font-medium">Telemarketing / Settings</span>
        <div className="bg-white rounded-2xl border border-slate-200 p-5"><PageHeader /><div className="mt-5"><SkeletonRows n={5} /></div></div>
      </div>
    )
  }

  if (!admin) {
    return (
      <div className="space-y-4">
        <span className="text-sm text-slate-500 font-medium">Telemarketing / Settings</span>
        <PageHeader />
        <div className="bg-white rounded-2xl border border-slate-200 py-16 px-6 flex flex-col items-center justify-center text-center">
          <Shield className="w-10 h-10 text-slate-300 mb-3" />
          <p className="text-sm font-semibold text-slate-700">Admin access only. Contact the Mother Account.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 relative">
      {toast && <div className="fixed top-4 right-4 z-50 bg-emerald-600 text-white text-sm rounded-xl px-5 py-3 shadow-lg flex items-center gap-2"><Check className="w-4 h-4" /> {toast}</div>}
      <span className="text-sm text-slate-500 font-medium">Telemarketing / Settings</span>
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <PageHeader />

        {/* Section tabs (chip style) */}
        <div className="flex flex-wrap gap-2 my-4">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${tab === t ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50/70"}`}>
              {t}
            </button>
          ))}
        </div>

        {tab === "Agents" && <AgentsTab api={agentsApi} teams={settings.general.teams} flash={flash} />}
        {tab === "Targets" && <TargetsTab api={targetsApi} agents={agentsApi.agents} loaded={agentsApi.loaded && targetsApi.loaded} flash={flash} />}
        {tab === "Schedule" && <ScheduleTab settings={settings} flash={flash} />}
        {tab === "Reports & Discord" && <ReportsTab settings={settings} flash={flash} />}
        {tab === "KPI Weights" && <KpiTab settings={settings} flash={flash} />}
        {tab === "General" && <GeneralTab settings={settings} flash={flash} />}
      </div>
    </div>
  )
}

type AgentsApi = ReturnType<typeof useTmAgents>
type TargetsApi = ReturnType<typeof useTmTargets>
type SettingsApi = ReturnType<typeof useTmSettings>

// ── AGENTS ────────────────────────────────────────────────────────────────────
function AgentsTab({ api, teams, flash }: { api: AgentsApi; teams: string[]; flash: (m: string) => void }) {
  const [add, setAdd] = useState(false)
  const [edit, setEdit] = useState<TmAgent | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<TmAgent | null>(null)

  if (!api.loaded) return <SkeletonRows n={5} />

  const toggleStatus = async (a: TmAgent) => {
    const next = a.status === "Active" ? "Inactive" : "Active"
    try {
      await api.updateAgent(a.id, { status: next }, next === "Active" ? "Reactivated" : "Deactivated")
      flash(`${a.agent_name} ${next === "Active" ? "reactivated" : "deactivated"}.`)
    } catch (e: any) { flash(`Error: ${e.message}`) }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm font-semibold text-slate-700">Telemarketing Agents ({api.agents.length})</p>
        <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => setAdd(true)}><Plus className="w-4 h-4" /> Add Agent</Button>
      </div>
      <SimpleTable
        cols={["No", "Name", "Team", "Phone", "Email", "Status", "Added by", "Actions"]}
        rows={api.agents.length === 0 ? (
          <tr><td colSpan={8} className="text-center py-10 text-slate-400">No agents yet. Add your first telemarketer.</td></tr>
        ) : api.agents.map((a, i) => (
          <tr key={a.id} className="hover:bg-slate-50/70">
            <td className="px-3 py-2.5 text-slate-400">{i + 1}</td>
            <td className="px-3 py-2.5 font-medium text-slate-800">{a.agent_name}</td>
            <td className="px-3 py-2.5 text-slate-600">{a.team || "—"}</td>
            <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{a.phone || "—"}</td>
            <td className="px-3 py-2.5 text-slate-600">{a.email || "—"}</td>
            <td className="px-3 py-2.5"><StatusPill active={a.status === "Active"} /></td>
            <td className="px-3 py-2.5 text-slate-500">{a.added_by || "—"}</td>
            <td className="px-3 py-2.5">
              <div className="flex items-center gap-1">
                <button onClick={() => setEdit(a)} title="Edit"
                  className="w-8 h-8 flex items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-100"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => toggleStatus(a)} title={a.status === "Active" ? "Deactivate" : "Reactivate"}
                  className={`w-8 h-8 flex items-center justify-center rounded border transition-colors ${a.status === "Active" ? "border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-600" : "border-slate-200 text-slate-500 hover:bg-emerald-50 hover:text-emerald-600"}`}><Power className="w-4 h-4" /></button>
                <button onClick={() => setConfirmDelete(a)} title="Delete (admin)"
                  className="w-8 h-8 flex items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
              </div>
            </td>
          </tr>
        ))}
      />

      {(add || edit) && (
        <AgentModal agent={edit} teams={teams} onClose={() => { setAdd(false); setEdit(null) }}
          onSave={async f => {
            try {
              if (edit) { await api.updateAgent(edit.id, f); flash("Agent updated.") }
              else { await api.addAgent(f); flash("Agent added.") }
              setAdd(false); setEdit(null)
            } catch (e: any) { flash(`Error: ${e.message}`) }
          }} />
      )}

      {confirmDelete && (
        <Modal title="Delete Agent" icon={AlertTriangle} onClose={() => setConfirmDelete(null)}>
          <div className="px-6 py-5 text-sm text-slate-700">
            Permanently delete <span className="font-semibold">{confirmDelete.agent_name}</span>?
            <p className="text-xs text-slate-500 mt-2">Mawawala ang agent sa lahat ng dropdowns. Hindi nito buburahin ang existing sales/calls records niya — mas ligtas ang Deactivate kung may history na siya.</p>
          </div>
          <div className="px-6 py-4 border-t bg-slate-50 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={async () => {
              try { await api.removeAgent(confirmDelete.id); flash("Agent deleted.") } catch (e: any) { flash(`Error: ${e.message}`) }
              setConfirmDelete(null)
            }}>Delete</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function AgentModal({ agent, teams, onClose, onSave }: {
  agent: TmAgent | null; teams: string[]; onClose: () => void
  onSave: (f: { agent_name: string; team: string; phone: string; email: string }) => void
}) {
  const [f, setF] = useState({ agent_name: agent?.agent_name ?? "", team: agent?.team ?? "", phone: agent?.phone ?? "", email: agent?.email ?? "" })
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }))
  return (
    <Modal title={agent ? "Edit Agent" : "Add Agent"} icon={agent ? Pencil : Plus} onClose={onClose}>
      <div className="px-6 py-5 space-y-4">
        <div>
          <label className="text-sm text-slate-600">Agent Name<span className="text-red-500">*</span></label>
          <Input className="mt-1.5" value={f.agent_name} autoFocus placeholder="Full name" onChange={e => set("agent_name", e.target.value)} />
        </div>
        <div>
          <label className="text-sm text-slate-600">Team</label>
          {teams.length > 0 ? (
            <select className={`${INP} mt-1.5`} value={f.team} onChange={e => set("team", e.target.value)}>
              <option value="">— No team —</option>
              {teams.map(t => <option key={t} value={t}>{t}</option>)}
              {f.team && !teams.includes(f.team) && <option value={f.team}>{f.team}</option>}
            </select>
          ) : (
            <Input className="mt-1.5" value={f.team} placeholder="e.g. Team A (or add teams under General)" onChange={e => set("team", e.target.value)} />
          )}
        </div>
        <div>
          <label className="text-sm text-slate-600">Phone</label>
          <Input className="mt-1.5" value={f.phone} placeholder="09xx xxx xxxx" onChange={e => set("phone", e.target.value)} />
        </div>
        <div>
          <label className="text-sm text-slate-600">Email</label>
          <Input className="mt-1.5" type="email" value={f.email} placeholder="agent@company.com" onChange={e => set("email", e.target.value)} />
        </div>
      </div>
      <div className="px-6 py-4 border-t bg-slate-50 flex gap-2">
        <Button disabled={!f.agent_name.trim()} onClick={() => onSave({ ...f, agent_name: f.agent_name.trim() })}>Submit</Button>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  )
}

// ── TARGETS ───────────────────────────────────────────────────────────────────
function TargetsTab({ api, agents, loaded, flash }: {
  api: TargetsApi; agents: TmAgent[]; loaded: boolean; flash: (m: string) => void
}) {
  const [month, setMonth] = useState(thisMonthStr())
  if (!loaded) return <SkeletonRows n={5} />

  const activeAgents = agents.filter(a => a.status === "Active")
  const teamTgt = api.targets.find(t => t.month === month && t.agent_id === "") ?? null

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <label className="text-sm font-semibold text-slate-700">Target Month</label>
        <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)}
          className="h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white focus:outline-none focus:border-blue-400" />
      </div>

      <TeamTargetCard month={month} tgt={teamTgt} onSave={async d => {
        try {
          await api.upsertTarget({ month, agent_id: "", ...d, conversion_target: teamTgt?.conversion_target ?? 0 })
          flash(`Team target for ${month} saved.`)
        } catch (e: any) { flash(`Error: ${e.message}`) }
      }} />

      <div>
        <p className="text-sm font-semibold text-slate-700 mb-2">Per-Agent Targets ({activeAgents.length} active agents)</p>
        {activeAgents.length === 0 ? (
          <p className="text-sm text-slate-400 border border-dashed border-slate-200 rounded-xl py-8 text-center">No active agents. Add agents under the Agents tab first.</p>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                {["Agent", "Monthly Sales Target", "Monthly Orders", "Daily Sales Target", "Daily Orders", "Conversion %", ""].map((c, i) =>
                  <th key={i} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{c}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {activeAgents.map(a => (
                  <AgentTargetRow key={`${month}:${a.id}`} agent={a} month={month}
                    tgt={api.targets.find(t => t.month === month && t.agent_id === a.id) ?? null}
                    onSave={async d => {
                      try { await api.upsertTarget({ month, agent_id: a.id, ...d }); flash(`Target saved for ${a.agent_name}.`) }
                      catch (e: any) { flash(`Error: ${e.message}`) }
                    }} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

type TeamTargetDraft = { sales_target: number; orders_target: number; daily_sales_target: number; daily_orders_target: number }

function TeamTargetCard({ month, tgt, onSave }: { month: string; tgt: TmTarget | null; onSave: (d: TeamTargetDraft) => void }) {
  const seed = `${month}|${tgt?.id ?? ""}|${tgt?.sales_target}|${tgt?.orders_target}|${tgt?.daily_sales_target}|${tgt?.daily_orders_target}`
  const [d, setD] = useState<TeamTargetDraft>({
    sales_target: tgt?.sales_target ?? 0, orders_target: tgt?.orders_target ?? 0,
    daily_sales_target: tgt?.daily_sales_target ?? 0, daily_orders_target: tgt?.daily_orders_target ?? 0,
  })
  useEffect(() => {
    setD({
      sales_target: tgt?.sales_target ?? 0, orders_target: tgt?.orders_target ?? 0,
      daily_sales_target: tgt?.daily_sales_target ?? 0, daily_orders_target: tgt?.daily_orders_target ?? 0,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed])
  const set = (k: keyof TeamTargetDraft, v: number) => setD(p => ({ ...p, [k]: v }))

  const fields: { key: keyof TeamTargetDraft; label: string; money: boolean }[] = [
    { key: "sales_target", label: "Monthly Sales Target", money: true },
    { key: "orders_target", label: "Monthly Orders Target", money: false },
    { key: "daily_sales_target", label: "Daily Sales Target", money: true },
    { key: "daily_orders_target", label: "Daily Orders Target", money: false },
  ]
  return (
    <div className="border border-slate-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-slate-700">Team Target — {month}</p>
        <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => onSave(d)}><Save className="w-4 h-4" /> Save Team Target</Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {fields.map(f => (
          <div key={f.key}>
            <label className="text-xs text-slate-500 font-medium">{f.label}</label>
            <input type="number" min={0} className={`${NUM} mt-1`} value={d[f.key] === 0 ? "" : d[f.key]}
              placeholder="0" onChange={e => set(f.key, num(e.target.value))} />
            {f.money && <p className="text-[11px] text-slate-400 mt-0.5 text-right tabular-nums">{formatCurrency(d[f.key])}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

type AgentTargetDraft = TeamTargetDraft & { conversion_target: number }

function AgentTargetRow({ agent, month, tgt, onSave }: {
  agent: TmAgent; month: string; tgt: TmTarget | null; onSave: (d: AgentTargetDraft) => void
}) {
  const seed = `${month}|${tgt?.id ?? ""}|${tgt?.sales_target}|${tgt?.orders_target}|${tgt?.daily_sales_target}|${tgt?.daily_orders_target}|${tgt?.conversion_target}`
  const init = (): AgentTargetDraft => ({
    sales_target: tgt?.sales_target ?? 0, orders_target: tgt?.orders_target ?? 0,
    daily_sales_target: tgt?.daily_sales_target ?? 0, daily_orders_target: tgt?.daily_orders_target ?? 0,
    conversion_target: tgt?.conversion_target ?? 0,
  })
  const [d, setD] = useState<AgentTargetDraft>(init)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setD(init()) }, [seed])
  const set = (k: keyof AgentTargetDraft, v: number) => setD(p => ({ ...p, [k]: v }))

  return (
    <tr className="hover:bg-slate-50/70 align-top">
      <td className="px-3 py-2.5 font-medium text-slate-800 whitespace-nowrap">
        {agent.agent_name}
        {agent.team && <span className="block text-[11px] text-slate-400 font-normal">{agent.team}</span>}
      </td>
      <td className="px-3 py-2.5 min-w-[130px]">
        <input type="number" min={0} className={NUM} value={d.sales_target === 0 ? "" : d.sales_target} placeholder="0" onChange={e => set("sales_target", num(e.target.value))} />
        <p className="text-[11px] text-slate-400 mt-0.5 text-right tabular-nums">{formatCurrency(d.sales_target)}</p>
      </td>
      <td className="px-3 py-2.5 min-w-[90px]">
        <input type="number" min={0} className={NUM} value={d.orders_target === 0 ? "" : d.orders_target} placeholder="0" onChange={e => set("orders_target", num(e.target.value))} />
      </td>
      <td className="px-3 py-2.5 min-w-[130px]">
        <input type="number" min={0} className={NUM} value={d.daily_sales_target === 0 ? "" : d.daily_sales_target} placeholder="0" onChange={e => set("daily_sales_target", num(e.target.value))} />
        <p className="text-[11px] text-slate-400 mt-0.5 text-right tabular-nums">{formatCurrency(d.daily_sales_target)}</p>
      </td>
      <td className="px-3 py-2.5 min-w-[90px]">
        <input type="number" min={0} className={NUM} value={d.daily_orders_target === 0 ? "" : d.daily_orders_target} placeholder="0" onChange={e => set("daily_orders_target", num(e.target.value))} />
      </td>
      <td className="px-3 py-2.5 min-w-[90px]">
        <div className="relative">
          <input type="number" min={0} max={100} className={`${NUM} pr-6`} value={d.conversion_target === 0 ? "" : d.conversion_target} placeholder="0" onChange={e => set("conversion_target", num(e.target.value))} />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <Button size="sm" variant="outline" onClick={() => onSave(d)}><Save className="w-3.5 h-3.5" /> Save</Button>
      </td>
    </tr>
  )
}

// ── SCHEDULE (hour blocks, spec §8) ───────────────────────────────────────────
function ScheduleTab({ settings, flash }: { settings: SettingsApi; flash: (m: string) => void }) {
  const [start, setStart] = useState(settings.hourBlocks.start)
  const [end, setEnd] = useState(settings.hourBlocks.end)
  useEffect(() => { setStart(settings.hourBlocks.start); setEnd(settings.hourBlocks.end) }, [settings.hourBlocks.start, settings.hourBlocks.end])

  if (!settings.loaded) return <SkeletonRows n={4} />
  const valid = end > start
  const blocks: number[] = valid ? Array.from({ length: end - start }, (_, i) => start + i) : []

  return (
    <div className="space-y-5 max-w-2xl">
      <p className="text-sm text-slate-500">
        Hour blocks para sa Hourly Sales view (default 8AM–8PM). Auto-bucketed ang sales/calls sa mga oras na ito — walang manual hourly encoding.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-slate-500 font-medium">Start hour</label>
          <select className={`${INP} mt-1 w-40`} value={start} onChange={e => setStart(parseInt(e.target.value))}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h12(h)}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500 font-medium">End hour</label>
          <select className={`${INP} mt-1 w-40`} value={end} onChange={e => setEnd(parseInt(e.target.value))}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h12(h)}</option>)}
          </select>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700 text-white" disabled={!valid}
          onClick={() => { settings.saveHourBlocks({ start, end }); flash("Hour blocks saved.") }}>
          <Save className="w-4 h-4" /> Save
        </Button>
      </div>
      {!valid && <p className="text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> End hour must be after start hour.</p>}

      {valid && (
        <div className="border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5"><Clock3 className="w-3.5 h-3.5" /> Preview — {blocks.length} hour blocks</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {blocks.map(h => (
              <span key={h} className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-center tabular-nums">{hourLabel(h)}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── REPORTS & DISCORD (spec §20–21) ───────────────────────────────────────────
function ReportsTab({ settings, flash }: { settings: SettingsApi; flash: (m: string) => void }) {
  const [times, setTimes] = useState<string[]>(settings.reportSchedule.times)
  const [enabled, setEnabled] = useState(settings.reportSchedule.enabled)
  const [webhook, setWebhook] = useState(settings.discord.webhook_url)
  const [dcEnabled, setDcEnabled] = useState(settings.discord.enabled)
  const [showHook, setShowHook] = useState(false)
  useEffect(() => {
    setTimes(settings.reportSchedule.times); setEnabled(settings.reportSchedule.enabled)
    setWebhook(settings.discord.webhook_url); setDcEnabled(settings.discord.enabled)
  }, [settings.reportSchedule, settings.discord])

  if (!settings.loaded) return <SkeletonRows n={5} />

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-semibold text-slate-700">Report Schedule</p>
            <p className="text-xs text-slate-500 mt-0.5">Mga oras kung kailan ipapadala ang team report (default 9AM / 12PM / 3PM / 6PM / 8PM).</p>
          </div>
          <Switch on={enabled} onClick={() => setEnabled(v => !v)} />
        </div>
        <div className="space-y-2">
          {times.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="time" value={t}
                onChange={e => setTimes(p => p.map((x, j) => j === i ? e.target.value : x))}
                className="h-9 rounded-lg border border-slate-300 px-2 text-sm bg-white tabular-nums focus:outline-none focus:border-blue-400" />
              <button onClick={() => setTimes(p => p.filter((_, j) => j !== i))} title="Remove"
                className="w-8 h-8 flex items-center justify-center rounded border border-slate-200 text-slate-400 hover:bg-red-50 hover:text-red-600"><X className="w-4 h-4" /></button>
            </div>
          ))}
          {times.length === 0 && <p className="text-xs text-slate-400">No report times — add one below.</p>}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <Button size="sm" variant="outline" onClick={() => setTimes(p => [...p, "09:00"])}><Plus className="w-3.5 h-3.5" /> Add time</Button>
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white"
            onClick={() => {
              const clean = Array.from(new Set(times.filter(t => /^\d{2}:\d{2}$/.test(t)))).sort()
              setTimes(clean)
              settings.saveReportSchedule({ times: clean, enabled })
              flash("Report schedule saved.")
            }}>
            <Save className="w-4 h-4" /> Save Schedule
          </Button>
        </div>
      </div>

      <div className="border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-semibold text-slate-700">Discord Delivery</p>
            <p className="text-xs text-slate-500 mt-0.5">Webhook URL ng channel kung saan ipo-post ang scheduled reports.</p>
          </div>
          <Switch on={dcEnabled} onClick={() => setDcEnabled(v => !v)} />
        </div>
        <label className="text-xs text-slate-500 font-medium">Webhook URL</label>
        <div className="relative mt-1">
          <input type={showHook ? "text" : "password"} value={webhook} placeholder="https://discord.com/api/webhooks/…"
            onChange={e => setWebhook(e.target.value)} autoComplete="off"
            className={`${INP} pr-10`} />
          <button type="button" onClick={() => setShowHook(v => !v)} title={showHook ? "Hide" : "Show"}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
            {showHook ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {webhook && !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(webhook) && (
          <p className="text-xs text-amber-600 mt-1.5 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Hindi mukhang Discord webhook URL ito — i-double check.</p>
        )}
        <div className="mt-3">
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white"
            onClick={() => { settings.saveDiscord({ webhook_url: webhook.trim(), enabled: dcEnabled }); flash("Discord config saved.") }}>
            <Save className="w-4 h-4" /> Save Discord Config
          </Button>
        </div>
      </div>

      <p className="text-xs text-slate-500">Ang actual scheduled sending ay Phase 3 (GitHub Actions cron) — config lang muna ito.</p>
    </div>
  )
}

// ── KPI WEIGHTS (spec §24) ────────────────────────────────────────────────────
function KpiTab({ settings, flash }: { settings: SettingsApi; flash: (m: string) => void }) {
  const [w, setW] = useState<TmKpiWeights>(settings.kpiWeights)
  useEffect(() => { setW(settings.kpiWeights) }, [settings.kpiWeights])

  if (!settings.loaded) return <SkeletonRows n={7} />
  const sum = KPI_FIELDS.reduce((n, f) => n + (Number(w[f.key]) || 0), 0)
  const ok = sum === 100

  return (
    <div className="space-y-4 max-w-xl">
      <p className="text-sm text-slate-500">
        Composite KPI score 0–100 sa Leaderboard. Ang bawat weight ay % contribution — dapat eksaktong 100 ang total.
      </p>
      <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
        {KPI_FIELDS.map(f => (
          <div key={f.key} className="flex items-center justify-between gap-4 px-4 py-2.5">
            <span className="text-sm text-slate-700">{f.label}</span>
            <div className="relative w-28">
              <input type="number" min={0} max={100} className={`${NUM} pr-6`} value={w[f.key] === 0 ? "" : w[f.key]} placeholder="0"
                onChange={e => setW(p => ({ ...p, [f.key]: num(e.target.value) }))} />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
            </div>
          </div>
        ))}
        <div className={`flex items-center justify-between gap-4 px-4 py-3 ${ok ? "bg-emerald-50" : "bg-red-50"}`}>
          <span className={`text-sm font-bold ${ok ? "text-emerald-700" : "text-red-700"}`}>TOTAL</span>
          <span className={`text-sm font-bold tabular-nums ${ok ? "text-emerald-700" : "text-red-700"}`}>
            {sum}%{!ok && <span className="font-normal text-xs ml-2">(must be 100)</span>}
          </span>
        </div>
      </div>
      <div className="flex gap-2">
        <Button className="bg-blue-600 hover:bg-blue-700 text-white" disabled={!ok}
          onClick={() => { settings.saveKpiWeights(w); flash("KPI weights saved.") }}>
          <Save className="w-4 h-4" /> Save Weights
        </Button>
        <Button variant="outline" onClick={() => setW(DEFAULT_KPI_WEIGHTS)}><RotateCcw className="w-4 h-4" /> Reset to defaults</Button>
      </div>
    </div>
  )
}

// ── GENERAL (teams / products / working days) ─────────────────────────────────
function GeneralTab({ settings, flash }: { settings: SettingsApi; flash: (m: string) => void }) {
  if (!settings.loaded) return <SkeletonRows n={4} />
  const g = settings.general
  const save = (patch: Partial<TmGeneral>, msg: string) => { settings.saveGeneral({ ...g, ...patch }); flash(msg) }

  return (
    <div className="space-y-6 max-w-2xl">
      <ChipListEditor label="Teams" placeholder="e.g. Team Alpha" items={g.teams}
        note="Ginagamit sa agent roster at sa dashboard/report filters."
        onChange={teams => save({ teams }, "Teams updated.")} />
      <ChipListEditor label="Products" placeholder="e.g. Glutalipo Juice" items={g.products}
        note="Product dropdown para sa sales entry, scripts, at product performance."
        onChange={products => save({ products }, "Products updated.")} />

      <div className="border border-slate-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-slate-700">Working Days</p>
        <p className="text-xs text-slate-500 mt-0.5 mb-3">Ginagamit sa Required Daily Pace (remaining target ÷ remaining working days).</p>
        <div className="flex flex-wrap gap-2">
          {DAY_NAMES.map((name, day) => {
            const on = g.work_days.includes(day)
            return (
              <button key={day} type="button"
                onClick={() => {
                  const next = on ? g.work_days.filter(d => d !== day) : [...g.work_days, day].sort((a, b) => a - b)
                  if (next.length === 0) { flash("At least one working day is required."); return }
                  save({ work_days: next }, "Working days updated.")
                }}
                className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${on ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50/70"}`}>
                {name}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ChipListEditor({ label, placeholder, note, items, onChange }: {
  label: string; placeholder: string; note: string; items: string[]; onChange: (next: string[]) => void
}) {
  const [draft, setDraft] = useState("")
  const add = () => {
    const v = draft.trim()
    if (!v) return
    if (items.some(x => x.toLowerCase() === v.toLowerCase())) { setDraft(""); return }
    onChange([...items, v]); setDraft("")
  }
  return (
    <div className="border border-slate-200 rounded-xl p-4">
      <p className="text-sm font-semibold text-slate-700">{label}</p>
      <p className="text-xs text-slate-500 mt-0.5 mb-3">{note}</p>
      <div className="flex flex-wrap gap-2 mb-3">
        {items.length === 0 && <span className="text-xs text-slate-400">None yet.</span>}
        {items.map(item => (
          <span key={item} className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-full pl-3 pr-1.5 py-1 text-sm text-slate-700">
            {item}
            <button type="button" title={`Remove ${item}`} onClick={() => onChange(items.filter(x => x !== item))}
              className="w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input value={draft} placeholder={placeholder} className="max-w-xs h-9"
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add() } }} />
        <Button size="sm" variant="outline" onClick={add} disabled={!draft.trim()}><Plus className="w-3.5 h-3.5" /> Add</Button>
      </div>
    </div>
  )
}
