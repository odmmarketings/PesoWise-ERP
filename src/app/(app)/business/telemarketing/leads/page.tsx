"use client"
// Customers / Leads — the telemarketer's daily working list (docs/telemarketing-spec.md §14–16, §29, §31).
// Single-file page: table + filter thead + quick chips + stat strip, Add Lead / Record Call /
// Bulk Assign modals, and a full-page View Lead screen (early-return, bookkeeping pattern).
// All data goes through telemarketing-store hooks — no direct Supabase calls here.
import { useState, useEffect, useMemo, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Users, Plus, RefreshCw, X, Check, Eye, Trash2, ChevronLeft, PhoneCall, Clock, UserCheck,
  PhoneOff, ClipboardList, ShoppingCart,
} from "lucide-react"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import { StatCardsSkeleton, TableSkeleton } from "@/components/business/Skeleton"
import {
  useTmLeads, useTmAgents, useTmCalls, useTmSales,
  LEAD_STATUSES, LEAD_STATUS_BADGE, CALL_DISPOSITIONS, WON_LEAD_STATUSES, SALES_STATUS_BADGE, todayStr,
  type TmLead, type TmAgent, type TmCall, type TmSale,
} from "@/lib/telemarketing-store"
import { isMotherAccount } from "@/lib/users-store"
import { currentUserName, currentUserEmail } from "@/lib/current-user"

const SEL = "w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white focus:outline-none focus:border-blue-400"
const FILTER_SEL = "h-8 w-full rounded border border-slate-300 px-1.5 text-xs bg-white focus:outline-none focus:border-blue-400"
const FILTER_INPUT = "h-8 w-full rounded border border-slate-300 px-2 text-xs focus:outline-none focus:border-blue-400"

const MAX_ROWS = 200

// Local peso helper (per-page convention — formatCurrency stays for other modules).
const fmtPeso = (n: number) => `₱${(Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function fmtDateTime(iso: string) {
  const d = new Date(iso); if (isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const fmtDur = (sec: number) => sec > 0 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : "—"

// Case-insensitive match of the logged-in user against the agent roster (spec §31 scoping).
function findMyAgent(agents: TmAgent[]): TmAgent | null {
  const name = currentUserName().trim().toLowerCase()
  const email = currentUserEmail().trim().toLowerCase()
  if (!name && !email) return null
  return agents.find(a => {
    const an = a.agent_name.trim().toLowerCase(), ae = a.email.trim().toLowerCase()
    return (an && (an === name || (email && an === email))) || (ae && ((email && ae === email) || (name && ae === name)))
  }) ?? null
}

// ── Module-scope shared UI (never inline in a component — focus-loss bug) ─────
function FormRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-2 border-b border-slate-100 last:border-0">
      <label className="w-36 flex-shrink-0 text-sm text-slate-600 pt-2.5 leading-tight">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <div className="flex-1">{children}</div>
    </div>
  )
}

function Modal({ title, icon: Icon, onClose, children, width = "max-w-2xl" }: {
  title: string; icon?: any; onClose: () => void; children: React.ReactNode; width?: string
}) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className={`bg-white rounded-2xl w-full ${width} shadow-2xl max-h-[92vh] flex flex-col`}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-bold text-slate-900 text-base flex items-center gap-2">{Icon && <Icon className="w-5 h-5 text-blue-600" />} {title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${LEAD_STATUS_BADGE[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status || "—"}
    </span>
  )
}

function StatCard({ label, value, gradient }: { label: string; value: React.ReactNode; gradient: string }) {
  return (
    <div className={`rounded-xl h-[70px] sm:h-[78px] px-4 flex flex-col justify-center text-white bg-gradient-to-br ${gradient}`}>
      <p className="text-2xl font-bold leading-tight tabular-nums">{value}</p>
      <p className="text-[11px] uppercase tracking-wider opacity-90">{label}</p>
    </div>
  )
}

// Read-only labeled field for the View Lead screen (bookkeeping ViewField pattern).
function ViewField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 py-1.5">
      <label className="w-32 text-right text-sm text-slate-600 flex-shrink-0">{label}</label>
      <div className="flex-1 min-h-9 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 flex items-center text-sm text-slate-700">
        {value === "" || value === null || value === undefined ? <span className="text-slate-300">—</span> : value}
      </div>
    </div>
  )
}

// ── Add Lead modal ────────────────────────────────────────────────────────────
function AddLeadModal({ agents, onClose, onSave }: {
  agents: TmAgent[]; onClose: () => void; onSave: (input: Partial<TmLead>) => Promise<void>
}) {
  const [f, setF] = useState({
    customer_name: "", phone: "", address: "", source: "", original_order_id: "",
    original_product: "", order_amount: "", order_date: "", assigned_to: "", notes: "",
  })
  const [err, setErr] = useState("")
  const [saving, setSaving] = useState(false)
  const set = (k: keyof typeof f, v: string) => { setF(p => ({ ...p, [k]: v })); setErr("") }

  async function submit() {
    if (!f.customer_name.trim()) { setErr("Customer name is required."); return }
    setSaving(true)
    try {
      await onSave({
        customer_name: f.customer_name.trim(), phone: f.phone.trim(), address: f.address.trim(),
        source: f.source.trim(), original_order_id: f.original_order_id.trim(),
        original_product: f.original_product.trim(), order_amount: parseFloat(f.order_amount) || 0,
        order_date: f.order_date, assigned_to: f.assigned_to, notes: f.notes.trim(),
      })
    } catch (e: any) { setErr(e?.message || "Could not save the lead."); setSaving(false) }
  }

  return (
    <Modal title="ADD LEAD" icon={Plus} onClose={onClose}>
      <div className="px-6 py-4 overflow-y-auto">
        {err && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{err}</div>}
        <FormRow label="Customer Name" required><Input value={f.customer_name} placeholder="Full name" onChange={e => set("customer_name", e.target.value)} /></FormRow>
        <FormRow label="Phone"><Input value={f.phone} placeholder="09XXXXXXXXX" onChange={e => set("phone", e.target.value)} /></FormRow>
        <FormRow label="Address"><Input value={f.address} placeholder="Address" onChange={e => set("address", e.target.value)} /></FormRow>
        <FormRow label="Source"><Input value={f.source} placeholder="e.g. Pancake / Manual / Import" onChange={e => set("source", e.target.value)} /></FormRow>
        <FormRow label="Original Order ID"><Input value={f.original_order_id} placeholder="Order ID" onChange={e => set("original_order_id", e.target.value)} /></FormRow>
        <FormRow label="Original Product"><Input value={f.original_product} placeholder="Product name" onChange={e => set("original_product", e.target.value)} /></FormRow>
        <FormRow label="Order Amount"><Input type="number" step="0.01" min={0} value={f.order_amount} placeholder="0.00" onChange={e => set("order_amount", e.target.value)} className="max-w-[200px]" /></FormRow>
        <FormRow label="Order Date"><Input type="date" value={f.order_date} onChange={e => set("order_date", e.target.value)} className="max-w-[200px]" /></FormRow>
        <FormRow label="Assigned Agent">
          <select className={SEL} value={f.assigned_to} onChange={e => set("assigned_to", e.target.value)}>
            <option value="">-- Unassigned --</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.agent_name}</option>)}
          </select>
        </FormRow>
        <FormRow label="Notes">
          <textarea rows={2} value={f.notes} onChange={e => set("notes", e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-400 resize-none" placeholder="Notes…" />
        </FormRow>
      </div>
      <div className="px-6 py-4 border-t border-slate-100 flex gap-3">
        <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save Lead"}</Button>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  )
}

// ── Record Call modal (the main daily action) ─────────────────────────────────
function RecordCallModal({ lead, agents, myAgent, agentName, onClose, onSave }: {
  lead: TmLead; agents: TmAgent[]; myAgent: TmAgent | null; agentName: (id: string) => string
  onClose: () => void
  onSave: (v: { agent: TmAgent; connected: boolean; disposition: string; duration_sec: number; notes: string; newLeadStatus: string; followUp: string }) => Promise<void>
}) {
  const [connected, setConnected] = useState(true)
  const [disposition, setDisposition] = useState("")
  const [minutes, setMinutes] = useState("")
  const [notes, setNotes] = useState("")
  const [status, setStatus] = useState<string>("Connected")
  const [followUp, setFollowUp] = useState("")
  const [agentId, setAgentId] = useState(myAgent?.id ?? "")
  const [err, setErr] = useState("")
  const [saving, setSaving] = useState(false)

  const pickConnected = (v: boolean) => { setConnected(v); setStatus(v ? "Connected" : "Attempted") }

  async function submit() {
    const agent = myAgent ?? agents.find(a => a.id === agentId) ?? null
    if (!agent) { setErr("Select the agent who made this call."); return }
    setSaving(true)
    try {
      await onSave({
        agent, connected, disposition, duration_sec: Math.max(0, Math.round((parseFloat(minutes) || 0) * 60)),
        notes: notes.trim(), newLeadStatus: status, followUp,
      })
    } catch (e: any) { setErr(e?.message || "Could not record the call."); setSaving(false) }
  }

  return (
    <Modal title="RECORD CALL" icon={PhoneCall} onClose={onClose}>
      <div className="px-6 py-4 overflow-y-auto">
        {/* Lead info */}
        <div className="mb-4 p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="font-bold text-slate-800">{lead.customer_name}</p>
            <StatusPill status={lead.status} />
          </div>
          <p className="text-slate-600 mt-0.5">{lead.phone || "No phone"} {lead.original_product && <>· {lead.original_product}</>} {lead.order_amount > 0 && <>· <span className="tabular-nums">{fmtPeso(lead.order_amount)}</span></>}</p>
          <p className="text-xs text-slate-500 mt-0.5">Attempts: {lead.call_attempts} · Last call: {lead.last_call_at || "never"} · Assigned: {agentName(lead.assigned_to) || "Unassigned"}</p>
        </div>

        {err && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{err}</div>}

        {/* Connected? — two big toggle buttons */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <button type="button" onClick={() => pickConnected(true)}
            className={`h-16 rounded-xl border-2 flex flex-col items-center justify-center gap-0.5 font-bold text-sm transition-colors ${connected ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-400 hover:border-slate-300"}`}>
            <PhoneCall className="w-5 h-5" /> Connected
          </button>
          <button type="button" onClick={() => pickConnected(false)}
            className={`h-16 rounded-xl border-2 flex flex-col items-center justify-center gap-0.5 font-bold text-sm transition-colors ${!connected ? "border-red-500 bg-red-50 text-red-600" : "border-slate-200 bg-white text-slate-400 hover:border-slate-300"}`}>
            <PhoneOff className="w-5 h-5" /> Not Connected
          </button>
        </div>

        {!myAgent && (
          <FormRow label="Calling Agent" required>
            <select className={SEL} value={agentId} onChange={e => { setAgentId(e.target.value); setErr("") }}>
              <option value="">-- Select agent --</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.agent_name}</option>)}
            </select>
          </FormRow>
        )}
        <FormRow label="Disposition">
          <select className={SEL} value={disposition} onChange={e => setDisposition(e.target.value)}>
            <option value="">-- Select --</option>
            {CALL_DISPOSITIONS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </FormRow>
        <FormRow label="Duration (min)">
          <Input type="number" step="0.5" min={0} value={minutes} placeholder="e.g. 2.5" onChange={e => setMinutes(e.target.value)} className="max-w-[160px]" />
        </FormRow>
        <FormRow label="Set Lead Status">
          <select className={SEL} value={status} onChange={e => setStatus(e.target.value)}>
            {LEAD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </FormRow>
        <FormRow label="Follow-up Date">
          <Input type="date" value={followUp} onChange={e => setFollowUp(e.target.value)} className="max-w-[200px]" />
        </FormRow>
        <FormRow label="Notes">
          <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-400 resize-none" placeholder="Call notes…" />
        </FormRow>
      </div>
      <div className="px-6 py-4 border-t border-slate-100 flex gap-3">
        <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save Call"}</Button>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  )
}

// ── Bulk assign modal (mother account only) ───────────────────────────────────
function BulkAssignModal({ count, agents, onClose, onAssign }: {
  count: number; agents: TmAgent[]; onClose: () => void
  onAssign: (agentId: string, agentName: string) => Promise<void>
}) {
  const [agentId, setAgentId] = useState("")
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState("")
  const agent = agents.find(a => a.id === agentId)
  async function submit() {
    if (!agent) { setErr("Select an agent."); return }
    setSaving(true)
    try { await onAssign(agent.id, agent.agent_name) }
    catch (e: any) { setErr(e?.message || "Could not assign the leads."); setSaving(false) }
  }
  return (
    <Modal title="ASSIGN LEADS TO AGENT" icon={UserCheck} onClose={onClose} width="max-w-md">
      <div className="px-6 py-4">
        <p className="text-sm text-slate-600 mb-3">Assign <span className="font-bold text-slate-800">{count}</span> selected lead{count === 1 ? "" : "s"} to:</p>
        {err && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{err}</div>}
        <select className={SEL} value={agentId} onChange={e => { setAgentId(e.target.value); setErr("") }}>
          <option value="">-- Select agent --</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.agent_name}{a.team ? ` (${a.team})` : ""}</option>)}
        </select>
      </div>
      <div className="px-6 py-4 border-t border-slate-100 flex gap-3">
        <Button onClick={submit} disabled={saving || !agentId}>{saving ? "Assigning…" : "Assign"}</Button>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  )
}

// ── View Lead — full-page screen (early-return, bookkeeping pattern) ──────────
function ViewLeadScreen({ lead, agents, calls, sales, isMother, agentName, onBack, onSave, onDelete, onRecordCall }: {
  lead: TmLead; agents: TmAgent[]; calls: TmCall[]; sales: TmSale[]; isMother: boolean
  agentName: (id: string) => string
  onBack: () => void
  onSave: (patch: Partial<TmLead>) => Promise<void>
  onDelete: () => Promise<void>
  onRecordCall: () => void
}) {
  const [status, setStatus] = useState(lead.status)
  const [assignedTo, setAssignedTo] = useState(lead.assigned_to)
  const [followUp, setFollowUp] = useState(lead.follow_up_date)
  const [notes, setNotes] = useState(lead.notes)
  const [saving, setSaving] = useState(false)
  // Re-sync the edit form kapag na-refresh ang lead (e.g. after a concurrent-edit retry).
  useEffect(() => { setStatus(lead.status); setAssignedTo(lead.assigned_to); setFollowUp(lead.follow_up_date); setNotes(lead.notes) },
    [lead.status, lead.assigned_to, lead.follow_up_date, lead.notes, lead.updated_at])

  const dirty = status !== lead.status || assignedTo !== lead.assigned_to || followUp !== lead.follow_up_date || notes !== lead.notes

  async function save() {
    setSaving(true)
    try { await onSave({ status, assigned_to: assignedTo, follow_up_date: followUp, notes }) }
    finally { setSaving(false) }
  }

  const leadCalls = calls.filter(c => c.lead_id === lead.id)
    .sort((a, b) => `${b.call_date} ${b.call_time}`.localeCompare(`${a.call_date} ${a.call_time}`))
  const leadSales = sales.filter(s => s.lead_id === lead.id)
    .sort((a, b) => `${b.sale_date} ${b.sale_time}`.localeCompare(`${a.sale_date} ${a.sale_time}`))
  const history = [...lead.history].reverse()

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
        <ChevronLeft className="w-4 h-4" /> Back to Customers / Leads
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* LEFT — lead details + editable fields */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
            <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Users className="w-5 h-5" /> VIEW LEAD</h1>
            <div className="flex items-center gap-2">
              <StatusPill status={lead.status} />
              <Button size="sm" onClick={onRecordCall}><PhoneCall className="w-3.5 h-3.5" /> Record Call</Button>
            </div>
          </div>
          <hr className="border-slate-200 mb-4" />

          <div className="space-y-0.5 max-w-2xl">
            <ViewField label="Customer" value={lead.customer_name} />
            <ViewField label="Phone" value={lead.phone} />
            <ViewField label="Address" value={lead.address} />
            <ViewField label="Source" value={lead.source} />
            <ViewField label="Orig. Order" value={lead.original_order_id} />
            <ViewField label="Orig. Product" value={lead.original_product} />
            <ViewField label="Order Amount" value={lead.order_amount > 0 ? <span className="tabular-nums">{fmtPeso(lead.order_amount)}</span> : ""} />
            <ViewField label="Order Date" value={lead.order_date} />
            <ViewField label="Attempts" value={String(lead.call_attempts)} />
            <ViewField label="Last Call" value={lead.last_call_at} />
          </div>

          {/* Editable */}
          <div className="mt-5 pt-4 border-t border-slate-200 max-w-2xl">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Update Lead</p>
            <FormRow label="Status">
              <select className={SEL} value={status} onChange={e => setStatus(e.target.value)}>
                {LEAD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </FormRow>
            <FormRow label="Assigned Agent">
              <select className={SEL} value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
                <option value="">-- Unassigned --</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.agent_name}</option>)}
                {assignedTo && !agents.some(a => a.id === assignedTo) && <option value={assignedTo}>{agentName(assignedTo) || assignedTo}</option>}
              </select>
            </FormRow>
            <FormRow label="Follow-up Date">
              <Input type="date" value={followUp} onChange={e => setFollowUp(e.target.value)} className="max-w-[200px]" />
            </FormRow>
            <FormRow label="Notes">
              <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-400 resize-none" />
            </FormRow>
            <div className="flex items-center gap-3 mt-4">
              <Button onClick={save} disabled={!dirty || saving}>{saving ? "Saving…" : "Save Changes"}</Button>
              {isMother && (
                <Button variant="destructive" onClick={async () => {
                  if (window.confirm(`Delete lead "${lead.customer_name}"? This cannot be undone.`)) await onDelete()
                }}><Trash2 className="w-4 h-4" /> Delete Lead</Button>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT — interaction history */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="text-lg font-bold text-blue-600 flex items-center gap-2 mb-1"><ClipboardList className="w-5 h-5" /> HISTORY</h2>
          <hr className="border-slate-200 mb-4" />
          <div className="border border-slate-200 rounded-lg overflow-hidden mb-4">
            <div className="bg-slate-100 px-4 py-2.5 font-bold text-sm text-slate-700">Added By</div>
            <div className="px-4 py-2.5 text-sm text-slate-600 border-b border-slate-200">{lead.added_by || "—"}</div>
            <div className="bg-slate-100 px-4 py-2.5 font-bold text-sm text-slate-700">Date Created</div>
            <div className="px-4 py-2.5 text-sm text-slate-600">{lead.added_date ? fmtDateTime(lead.added_date) : "—"}</div>
          </div>
          {history.length === 0 ? <p className="text-sm text-slate-400 italic">No activity yet.</p> : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {history.map((h, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <Clock className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="font-medium text-slate-700">{h.action}</span>
                    <span className="text-slate-400"> · {h.by} · {fmtDateTime(h.date)}</span>
                    {h.note && <p className="text-slate-500 italic">“{h.note}”</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Calls for this lead */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 className="text-base font-bold text-blue-600 flex items-center gap-2 mb-3"><PhoneCall className="w-4 h-4" /> CALLS ({leadCalls.length})</h2>
        {leadCalls.length === 0 ? <p className="text-sm text-slate-400 italic">No calls recorded for this lead yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  {["Date", "Time", "Agent", "Result", "Disposition", "Duration", "Attempt #", "Notes"].map(h =>
                    <th key={h} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {leadCalls.map(c => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 whitespace-nowrap text-slate-700">{c.call_date}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-700">{c.call_time}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-700">{c.agent_name}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${c.connected ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                        {c.connected ? "Connected" : "Not Connected"}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-700">{c.disposition || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-700">{fmtDur(c.duration_sec)}</td>
                    <td className="px-3 py-2 text-slate-700 tabular-nums">{c.attempt_no}</td>
                    <td className="px-3 py-2 text-slate-600 max-w-[280px] truncate" title={c.notes}>{c.notes || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Sales for this lead */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 className="text-base font-bold text-blue-600 flex items-center gap-2 mb-3"><ShoppingCart className="w-4 h-4" /> SALES ({leadSales.length})</h2>
        {leadSales.length === 0 ? <p className="text-sm text-slate-400 italic">No upsell / cross-sell sales recorded for this lead yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  {["Date", "Agent", "Type", "Upsell Product", "Upsell Amt", "Cross-sell Product", "Cross Amt", "Total Qty", "Total Amount", "Status"].map(h =>
                    <th key={h} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {leadSales.map(s => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 whitespace-nowrap text-slate-700">{s.sale_date} {s.sale_time}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-700">{s.agent_name}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-700">{s.sale_type}</td>
                    <td className="px-3 py-2 text-slate-700">{s.upsell_product || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-700 tabular-nums">{s.upsell_amount > 0 ? fmtPeso(s.upsell_amount) : "—"}</td>
                    <td className="px-3 py-2 text-slate-700">{s.cross_product || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-700 tabular-nums">{s.cross_amount > 0 ? fmtPeso(s.cross_amount) : "—"}</td>
                    <td className="px-3 py-2 text-slate-700 tabular-nums">{s.total_qty}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-semibold text-slate-800 tabular-nums">{fmtPeso(s.total_amount)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${SALES_STATUS_BADGE[s.sales_status] ?? "bg-slate-100 text-slate-600"}`}>{s.sales_status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
type QuickChip = "all" | "mine" | "uncalled" | "due" | "interested"

export default function TmLeadsPage() {
  const { leads, loaded: leadsLoaded, refresh: refreshLeads, addLead, updateLead, bulkAssign, removeLead } = useTmLeads()
  const { agents, loaded: agentsLoaded, refresh: refreshAgents } = useTmAgents()
  const { calls, refresh: refreshCalls, recordCall } = useTmCalls()
  const { sales, refresh: refreshSales } = useTmSales()

  const activeAgents = useMemo(() => agents.filter(a => a.status === "Active"), [agents])
  const agentName = useCallback((id: string) => agents.find(a => a.id === id)?.agent_name ?? "", [agents])

  // Current-user scoping (spec §31) — computed in an effect (localStorage is client-only).
  const [isMother, setIsMother] = useState(false)
  const [myAgent, setMyAgent] = useState<TmAgent | null>(null)
  const [scopeApplied, setScopeApplied] = useState(false)

  // Filters
  const [chip, setChip] = useState<QuickChip>("all")
  const [q, setQ] = useState("")
  const [agentFilter, setAgentFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [sourceFilter, setSourceFilter] = useState("")
  const [fuFrom, setFuFrom] = useState("")
  const [fuTo, setFuTo] = useState("")

  // Selection + modals
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showAdd, setShowAdd] = useState(false)
  const [showAssign, setShowAssign] = useState(false)
  const [callLead, setCallLead] = useState<TmLead | null>(null)
  const [viewLeadId, setViewLeadId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const [toast, setToast] = useState("")
  const [toastKind, setToastKind] = useState<"ok" | "err">("ok")
  const flash = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    setToast(msg); setToastKind(kind); setTimeout(() => setToast(""), 4500)
  }, [])

  // Match the logged-in user to the roster; default the Agent filter for non-mother accounts.
  useEffect(() => {
    if (!agentsLoaded) return
    const mother = isMotherAccount()
    const me = findMyAgent(agents)
    setIsMother(mother); setMyAgent(me)
    if (!scopeApplied) {
      if (me && !mother) setAgentFilter(me.id)
      setScopeApplied(true)
    }
  }, [agents, agentsLoaded, scopeApplied])

  const today = todayStr()
  const dueToday = useCallback((l: TmLead) =>
    l.follow_up_date === today && l.status !== "Completed" && l.status !== "Do Not Call", [today])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return leads.filter(l => {
      if (needle && !(
        l.customer_name.toLowerCase().includes(needle) ||
        l.phone.toLowerCase().includes(needle) ||
        l.original_order_id.toLowerCase().includes(needle))) return false
      if (agentFilter === "__none" ? l.assigned_to !== "" : agentFilter && l.assigned_to !== agentFilter) return false
      if (statusFilter && l.status !== statusFilter) return false
      if (sourceFilter && !l.source.toLowerCase().includes(sourceFilter.trim().toLowerCase())) return false
      if (fuFrom && (!l.follow_up_date || l.follow_up_date < fuFrom)) return false
      if (fuTo && (!l.follow_up_date || l.follow_up_date > fuTo)) return false
      // Quick chips layer on top of the thead filters.
      if (chip === "mine" && (!myAgent || l.assigned_to !== myAgent.id)) return false
      if (chip === "uncalled" && l.call_attempts !== 0) return false
      if (chip === "due" && !dueToday(l)) return false
      if (chip === "interested" && l.status !== "Interested") return false
      return true
    })
  }, [leads, q, agentFilter, statusFilter, sourceFilter, fuFrom, fuTo, chip, myAgent, dueToday])

  // Stat strip over the CURRENTLY FILTERED rows.
  const stats = useMemo(() => ({
    total: filtered.length,
    uncalled: filtered.filter(l => l.call_attempts === 0).length,
    due: filtered.filter(dueToday).length,
    connected: filtered.filter(l => l.status === "Connected").length,
    won: filtered.filter(l => WON_LEAD_STATUSES.includes(l.status)).length,
  }), [filtered, dueToday])

  const visible = filtered.slice(0, MAX_ROWS)
  const allVisibleSelected = visible.length > 0 && visible.every(l => selected.has(l.id))

  const hasFilters = q !== "" || agentFilter !== "" || statusFilter !== "" || sourceFilter !== "" || fuFrom !== "" || fuTo !== "" || chip !== "all"
  function clearFilters() {
    setQ(""); setAgentFilter(""); setStatusFilter(""); setSourceFilter(""); setFuFrom(""); setFuTo(""); setChip("all")
  }

  function toggleAll() {
    setSelected(prev => {
      const next = new Set(prev)
      if (allVisibleSelected) visible.forEach(l => next.delete(l.id))
      else visible.forEach(l => next.add(l.id))
      return next
    })
  }
  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function doRefresh() {
    setRefreshing(true)
    await Promise.all([refreshLeads(), refreshAgents(), refreshCalls(), refreshSales()])
    setRefreshing(false)
    flash("Data refreshed.")
  }

  // Record Call submit: follow-up (if any) first via updateLead (concurrency-checked), then recordCall.
  async function handleRecordCall(lead: TmLead, v: {
    agent: TmAgent; connected: boolean; disposition: string; duration_sec: number; notes: string; newLeadStatus: string; followUp: string
  }) {
    let leadForCall = lead
    if (v.followUp && v.followUp !== lead.follow_up_date) {
      await updateLead(lead.id, { follow_up_date: v.followUp }, "Follow-up scheduled", v.followUp)
      leadForCall = {
        ...lead, follow_up_date: v.followUp,
        history: [...lead.history, { action: "Follow-up scheduled", by: currentUserName(), date: new Date().toISOString(), note: v.followUp }],
      }
    }
    await recordCall({
      lead: leadForCall, agent_id: v.agent.id, agent_name: v.agent.agent_name,
      connected: v.connected, disposition: v.disposition, duration_sec: v.duration_sec,
      notes: v.notes, newLeadStatus: v.newLeadStatus,
    })
    await refreshLeads()
    setCallLead(null)
    flash(`Call recorded for ${lead.customer_name}.`)
  }

  async function handleDelete(lead: TmLead) {
    try { await removeLead(lead.id); setSelected(prev => { const n = new Set(prev); n.delete(lead.id); return n }); flash("Lead deleted.") }
    catch (e: any) { flash(e?.message || "Could not delete the lead.", "err") }
  }

  const loading = !leadsLoaded || !agentsLoaded

  const toastEl = toast && (
    <div className={`fixed top-5 right-5 z-[60] text-white rounded-xl shadow-2xl px-4 py-3 text-sm flex items-center gap-2 ${toastKind === "ok" ? "bg-emerald-500" : "bg-red-500"}`}>
      {toastKind === "ok" ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />} {toast}
    </div>
  )

  // ── View Lead full-page screen (early return) ──────────────────────────────
  if (viewLeadId) {
    const lead = leads.find(l => l.id === viewLeadId)
    if (!lead) { setViewLeadId(null); return null }
    return (
      <>
        {toastEl}
        {callLead && callLead.id === lead.id && (
          <RecordCallModal lead={lead} agents={activeAgents} myAgent={myAgent} agentName={agentName}
            onClose={() => setCallLead(null)} onSave={v => handleRecordCall(lead, v)} />
        )}
        <ViewLeadScreen lead={lead} agents={activeAgents} calls={calls} sales={sales} isMother={isMother} agentName={agentName}
          onBack={() => setViewLeadId(null)}
          onSave={async patch => {
            try { await updateLead(lead.id, patch); flash("Lead updated.") }
            catch (e: any) { flash(e?.message || "Could not update the lead.", "err") }
          }}
          onDelete={async () => { await handleDelete(lead); setViewLeadId(null) }}
          onRecordCall={() => setCallLead(lead)} />
      </>
    )
  }

  const CHIPS: { key: QuickChip; label: string; disabled?: boolean }[] = [
    { key: "all", label: "All" },
    { key: "mine", label: "My Leads", disabled: !myAgent },
    { key: "uncalled", label: "Uncalled" },
    { key: "due", label: "Due Today" },
    { key: "interested", label: "Interested" },
  ]

  return (
    <div className="space-y-3">
      <span className="text-sm text-slate-500 font-medium">Telemarketing / Customers &amp; Leads</span>
      {toastEl}

      {showAdd && (
        <AddLeadModal agents={activeAgents} onClose={() => setShowAdd(false)}
          onSave={async input => { await addLead(input); setShowAdd(false); flash("Lead added.") }} />
      )}
      {showAssign && (
        <BulkAssignModal count={selected.size} agents={activeAgents} onClose={() => setShowAssign(false)}
          onAssign={async (agentId, name) => {
            await bulkAssign(Array.from(selected), agentId, name)
            setShowAssign(false); setSelected(new Set())
            flash(`${selected.size} lead(s) assigned to ${name}.`)
          }} />
      )}
      {callLead && (
        <RecordCallModal lead={callLead} agents={activeAgents} myAgent={myAgent} agentName={agentName}
          onClose={() => setCallLead(null)} onSave={v => handleRecordCall(callLead, v)} />
      )}

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-3 mb-4 pb-4 border-b border-slate-100">
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Users className="w-5 h-5" /> CUSTOMERS / LEADS</h1>
          <div className="flex items-center gap-2">
            {isMother && selected.size > 0 && (
              <Button variant="outline" onClick={() => setShowAssign(true)}>
                <UserCheck className="w-4 h-4" /> Assign to agent ({selected.size})
              </Button>
            )}
            <Button onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Add Lead</Button>
            <button onClick={doRefresh} title="Refresh" disabled={refreshing}
              className="w-10 h-10 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Stat strip — over the CURRENTLY FILTERED rows */}
        {loading ? (
          <StatCardsSkeleton count={5} height="h-[70px] sm:h-[78px]" className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2.5 mb-4" />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2.5 mb-4">
            <StatCard label="Total Leads" value={stats.total} gradient="from-blue-500 to-blue-600" />
            <StatCard label="Uncalled" value={stats.uncalled} gradient="from-slate-500 to-slate-600" />
            <StatCard label="Follow-ups Due Today" value={stats.due} gradient="from-violet-500 to-violet-600" />
            <StatCard label="Connected" value={stats.connected} gradient="from-cyan-500 to-cyan-600" />
            <StatCard label="Successful" value={stats.won} gradient="from-emerald-500 to-emerald-600" />
          </div>
        )}

        {/* Quick-filter chips */}
        <div className="flex items-center flex-wrap gap-2 mb-3">
          {CHIPS.map(c => (
            <button key={c.key} disabled={c.disabled} onClick={() => setChip(c.key)}
              title={c.disabled ? "Your account is not matched to a telemarketing agent" : undefined}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                chip === c.key ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>
              {c.label}
            </button>
          ))}
          {hasFilters && (
            <button onClick={clearFilters} className="text-xs text-blue-600 hover:text-blue-700 underline underline-offset-2 ml-1">Clear filters</button>
          )}
        </div>

        {/* Table */}
        <div className="overflow-auto border-t border-slate-100 max-h-[65vh]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className="px-2 py-3">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} className="accent-blue-600 w-4 h-4 align-middle" />
                </th>
                {["Customer", "Phone", "Source", "Orig. Order", "Orig. Product", "Order Amt", "Assigned Agent", "Status", "Attempts", "Last Call", "Follow-up", "Notes", "Actions"].map(h =>
                  <th key={h} className="px-3 py-3 text-left font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
              {/* Filter row */}
              <tr className="border-b border-slate-200 align-top">
                <th className="px-2 py-2"></th>
                <th className="px-2 py-2" colSpan={2}>
                  <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name / phone / order…"
                    className={`${FILTER_INPUT} min-w-[170px]`} />
                </th>
                <th className="px-2 py-2">
                  <input value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} placeholder="Source"
                    className={`${FILTER_INPUT} min-w-[80px]`} />
                </th>
                <th className="px-2 py-2" colSpan={3}></th>
                <th className="px-2 py-2">
                  <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)} className={`${FILTER_SEL} min-w-[120px]`}>
                    <option value="">All agents</option>
                    <option value="__none">Unassigned</option>
                    {activeAgents.map(a => <option key={a.id} value={a.id}>{a.agent_name}</option>)}
                  </select>
                </th>
                <th className="px-2 py-2">
                  <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={`${FILTER_SEL} min-w-[110px]`}>
                    <option value="">All</option>
                    {LEAD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </th>
                <th className="px-2 py-2" colSpan={2}></th>
                <th className="px-2 py-2">
                  <div className="min-w-[130px]">
                    <DateRangePicker a={fuFrom} b={fuTo} onApply={(a, b) => { setFuFrom(a); setFuTo(b) }} />
                  </div>
                </th>
                <th className="px-2 py-2" colSpan={2}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={14} className="p-0"><TableSkeleton rows={6} cols={8} /></td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={14} className="text-center py-12 text-slate-400">No leads found{hasFilters ? " for the current filters" : ""}.</td></tr>
              ) : visible.map(l => (
                <tr key={l.id} className={`hover:bg-slate-50 ${selected.has(l.id) ? "bg-blue-50/50" : ""}`}>
                  <td className="px-2 py-2.5 text-center">
                    <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggleOne(l.id)} className="accent-blue-600 w-4 h-4 align-middle" />
                  </td>
                  <td className="px-3 py-2.5 font-medium text-slate-800 whitespace-nowrap">
                    <button onClick={() => setViewLeadId(l.id)} className="hover:text-blue-600 hover:underline underline-offset-2 text-left">{l.customer_name || "—"}</button>
                  </td>
                  <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{l.phone || ""}</td>
                  <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{l.source || ""}</td>
                  <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{l.original_order_id || ""}</td>
                  <td className="px-3 py-2.5 text-slate-700 max-w-[180px] truncate" title={l.original_product}>{l.original_product || ""}</td>
                  <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap tabular-nums">{l.order_amount > 0 ? fmtPeso(l.order_amount) : ""}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {l.assigned_to
                      ? <span className="text-slate-700">{agentName(l.assigned_to) || l.assigned_to}</span>
                      : <span className="text-slate-400 italic">Unassigned</span>}
                  </td>
                  <td className="px-3 py-2.5"><StatusPill status={l.status} /></td>
                  <td className="px-3 py-2.5 text-slate-700 tabular-nums text-center">{l.call_attempts}</td>
                  <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap text-xs">{l.last_call_at || ""}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-xs">
                    {l.follow_up_date
                      ? <span className={dueToday(l) ? "text-violet-700 font-semibold" : l.follow_up_date < today ? "text-red-500 font-medium" : "text-slate-600"}>{l.follow_up_date}</span>
                      : ""}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600 max-w-[160px] truncate" title={l.notes}>{l.notes || ""}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      <button onClick={() => setCallLead(l)} title="Record call"
                        className="h-8 px-2.5 flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold">
                        <PhoneCall className="w-3.5 h-3.5" /> Call
                      </button>
                      <button onClick={() => setViewLeadId(l.id)} title="View lead"
                        className="w-8 h-8 flex items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-100">
                        <Eye className="w-4 h-4" />
                      </button>
                      {isMother && (
                        <button title="Delete lead"
                          onClick={() => { if (window.confirm(`Delete lead "${l.customer_name}"? This cannot be undone.`)) handleDelete(l) }}
                          className="w-8 h-8 flex items-center justify-center rounded border border-slate-200 text-red-400 hover:bg-red-50 hover:text-red-600">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && filtered.length > MAX_ROWS && (
          <p className="text-xs text-slate-500 mt-2">Showing {MAX_ROWS} of {filtered.length} leads — refine the filters to narrow the list.</p>
        )}
        {!loading && filtered.length > 0 && filtered.length <= MAX_ROWS && (
          <p className="text-xs text-slate-400 mt-2">Showing {filtered.length} lead{filtered.length === 1 ? "" : "s"}.</p>
        )}
      </div>
    </div>
  )
}
