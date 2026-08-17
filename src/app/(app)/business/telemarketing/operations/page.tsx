"use client"
// Telemarketing — Sales Operations workspace (docs/telemarketing-spec.md §12–13).
// Daily upsell/cross-sell entry for telemarketers: KPI strip + filterable table +
// full-page Add/Edit/View screens (bookkeeping conventions). All data flows through
// useTmSales/useTmAgents/useTmLeads in src/lib/telemarketing-store.ts — the store
// derives sale_type/totals and handles audit history + optimistic concurrency.
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  PhoneOutgoing, Plus, RefreshCw, ChevronLeft, X, Check, Eye, Pencil, Ban, Clock,
  TrendingUp, Coins, Repeat, Wallet, ShoppingCart, Sigma, AlertTriangle,
} from "lucide-react"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import { StatCardsSkeleton, TableSkeleton } from "@/components/business/Skeleton"
import {
  useTmSales, useTmAgents, useTmLeads, activeSales, todayStr, nowTimeStr,
  SALES_STATUSES, SALES_STATUS_BADGE, type TmSale, type TmLead, type TmAgent,
} from "@/lib/telemarketing-store"

const peso = (n: number) => "₱" + (isFinite(n) ? n : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (n: number) => (isFinite(n) ? n : 0).toLocaleString("en-PH")
const SEL = "w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white focus:outline-none focus:border-blue-400"
const CALL_STATUSES = ["Connected", "Not Connected"] as const
const SALE_TYPE_FILTERS = ["Upsell", "Cross-sell", "Both"] as const

function fmtDateTime(iso: string) {
  const d = new Date(iso); if (isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// ── Module-scope form primitives (NEVER nest these inside a component — focus drops) ──
function FormRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-2 border-b border-slate-100 last:border-0">
      <label className="w-40 flex-shrink-0 text-sm text-slate-600 pt-2.5 leading-tight">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <div className="flex-1">{children}</div>
    </div>
  )
}

function ViewField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 py-1.5">
      <label className="w-40 text-right text-sm text-slate-600 flex-shrink-0">{label}</label>
      <div className="flex-1 min-h-10 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 flex items-center text-sm text-slate-600">
        {value === "" || value === null || value === undefined ? <span className="text-slate-300">—</span> : value}
      </div>
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-bold text-slate-900 text-base flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-red-500" /> {title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ── Add / Edit — full-page early-return screen (bookkeeping AddTransactionScreen pattern) ──
interface SaleFormValues {
  sale_date: string; sale_time: string
  lead_id: string; customer_name: string; customer_phone: string
  original_order_id: string; original_product: string
  agent_id: string; agent_name: string
  upsell_product: string; upsell_qty: number; upsell_amount: number
  cross_product: string; cross_qty: number; cross_amount: number
  call_status: string; sales_status: string; notes: string
}

function SaleFormScreen({ sale, agents, leads, onBack, onSave }: {
  sale: TmSale | null; agents: TmAgent[]; leads: TmLead[]
  onBack: () => void; onSave: (v: SaleFormValues) => Promise<void>
}) {
  const [f, setF] = useState<SaleFormValues>(() => sale ? {
    sale_date: sale.sale_date, sale_time: sale.sale_time,
    lead_id: sale.lead_id, customer_name: sale.customer_name, customer_phone: sale.customer_phone,
    original_order_id: sale.original_order_id, original_product: sale.original_product,
    agent_id: sale.agent_id, agent_name: sale.agent_name,
    upsell_product: sale.upsell_product, upsell_qty: sale.upsell_qty, upsell_amount: sale.upsell_amount,
    cross_product: sale.cross_product, cross_qty: sale.cross_qty, cross_amount: sale.cross_amount,
    call_status: sale.call_status || "Connected", sales_status: sale.sales_status || "Confirmed", notes: sale.notes,
  } : {
    sale_date: todayStr(), sale_time: nowTimeStr(),
    lead_id: "", customer_name: "", customer_phone: "", original_order_id: "", original_product: "",
    agent_id: "", agent_name: "",
    upsell_product: "", upsell_qty: 0, upsell_amount: 0,
    cross_product: "", cross_qty: 0, cross_amount: 0,
    call_status: "Connected", sales_status: "Confirmed", notes: "",
  })
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [showDrop, setShowDrop] = useState(false)
  const set = (k: keyof SaleFormValues, v: any) => { setF(p => ({ ...p, [k]: v })); setErrors([]) }

  // Live customer search over leads by name/phone; picking one autofills order info (spec §13
  // "pull customer/order info from existing data instead of re-encoding"). Manual entry stays allowed.
  const q = f.customer_name.trim().toLowerCase()
  const matches = useMemo(() => {
    if (q.length < 2) return []
    return leads.filter(l =>
      l.customer_name.toLowerCase().includes(q) || l.phone.toLowerCase().includes(q)
    ).slice(0, 8)
  }, [leads, q])

  function pickLead(l: TmLead) {
    setF(p => ({
      ...p, lead_id: l.id, customer_name: l.customer_name, customer_phone: l.phone,
      original_order_id: l.original_order_id, original_product: l.original_product,
    }))
    setShowDrop(false); setErrors([])
  }
  function pickAgent(id: string) {
    const a = agents.find(x => x.id === id)
    setF(p => ({ ...p, agent_id: id, agent_name: a?.agent_name ?? "" })); setErrors([])
  }

  const totalQty = (Number(f.upsell_qty) || 0) + (Number(f.cross_qty) || 0)
  const totalAmt = (Number(f.upsell_amount) || 0) + (Number(f.cross_amount) || 0)
  const upsellOk = (Number(f.upsell_qty) || 0) > 0 && (Number(f.upsell_amount) || 0) > 0
  const crossOk = (Number(f.cross_qty) || 0) > 0 && (Number(f.cross_amount) || 0) > 0
  const saleType = upsellOk && crossOk ? "Both" : crossOk ? "Cross-sell" : upsellOk ? "Upsell" : "—"

  function validate(): string[] {
    const m: string[] = []
    if (!f.sale_date) m.push("Date")
    if (!f.customer_name.trim()) m.push("Customer name")
    if (!f.agent_id) m.push("Agent")
    if (!upsellOk && !crossOk) m.push("At least one of Upsell or Cross-sell needs qty > 0 and amount > 0")
    return m
  }
  async function submit() {
    const m = validate()
    if (m.length) { setErrors(m); return }
    setSaving(true)
    try {
      await onSave({ ...f, upsell_qty: Number(f.upsell_qty) || 0, upsell_amount: Number(f.upsell_amount) || 0, cross_qty: Number(f.cross_qty) || 0, cross_amount: Number(f.cross_amount) || 0 })
    } catch (e: any) {
      setErrors([e?.message || "Save failed — please retry."])
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <span className="text-sm text-slate-500 font-medium">Sales Operations / {sale ? "Edit Sale" : "Add Sale"}</span>
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-100">
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><PhoneOutgoing className="w-5 h-5" /> {sale ? "EDIT SALE" : "ADD SALE"}</h1>
          <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
        </div>

        {errors.length > 0 && (
          <div className="mb-3 max-w-3xl p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
            <p className="font-medium mb-1">Cannot save yet:</p>
            <ul className="list-disc pl-4 space-y-0.5">{errors.map(e => <li key={e}>{e}</li>)}</ul>
          </div>
        )}

        <div className="max-w-3xl">
          <FormRow label="Date" required>
            <Input type="date" value={f.sale_date} onChange={e => set("sale_date", e.target.value)} className="max-w-[220px]" />
          </FormRow>
          <FormRow label="Time" required>
            <Input type="time" value={f.sale_time} onChange={e => set("sale_time", e.target.value)} className="max-w-[220px]" />
          </FormRow>
          <FormRow label="Customer" required>
            <div className="relative">
              <Input value={f.customer_name} placeholder="Type to search leads by name/phone — or enter manually"
                onChange={e => { set("customer_name", e.target.value); setShowDrop(true) }}
                onFocus={() => setShowDrop(true)} onBlur={() => setTimeout(() => setShowDrop(false), 150)} />
              {showDrop && matches.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-white border border-slate-200 rounded-lg shadow-xl max-h-60 overflow-auto">
                  {matches.map(l => (
                    <button key={l.id} type="button" onMouseDown={() => pickLead(l)}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-slate-50 last:border-0">
                      <p className="text-sm font-medium text-slate-800">{l.customer_name} <span className="text-slate-400 font-normal">{l.phone}</span></p>
                      <p className="text-xs text-slate-500">{l.original_product || "—"}{l.original_order_id ? ` · Order ${l.original_order_id}` : ""}</p>
                    </button>
                  ))}
                </div>
              )}
              {f.lead_id && <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Linked to lead — order info autofilled</p>}
            </div>
          </FormRow>
          <FormRow label="Phone">
            <Input value={f.customer_phone} placeholder="Customer phone" onChange={e => set("customer_phone", e.target.value)} className="max-w-[280px]" />
          </FormRow>
          <FormRow label="Original Order ID">
            <Input value={f.original_order_id} placeholder="Original order ID" onChange={e => set("original_order_id", e.target.value)} className="max-w-[280px]" />
          </FormRow>
          <FormRow label="Original Product">
            <Input value={f.original_product} placeholder="Product on the original order" onChange={e => set("original_product", e.target.value)} />
          </FormRow>
          <FormRow label="Agent" required>
            <select className={SEL + " max-w-[320px]"} value={f.agent_id} onChange={e => pickAgent(e.target.value)}>
              <option value="">-- SELECT AGENT --</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.agent_name}{a.team ? ` (${a.team})` : ""}</option>)}
            </select>
          </FormRow>

          {/* UPSELL */}
          <div className="mt-4 mb-1 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-sky-600" />
            <p className="text-xs font-bold text-sky-700 uppercase tracking-wider">Upsell</p>
          </div>
          <FormRow label="Upsell Product">
            <Input value={f.upsell_product} placeholder="Product upsold" onChange={e => set("upsell_product", e.target.value)} />
          </FormRow>
          <FormRow label="Upsell Qty / Amount">
            <div className="flex gap-3">
              <Input type="number" min={0} step={1} value={f.upsell_qty || ""} placeholder="Qty"
                onChange={e => set("upsell_qty", parseInt(e.target.value) || 0)} className="max-w-[120px]" />
              <Input type="number" min={0} step="0.01" value={f.upsell_amount || ""} placeholder="Amount (₱)"
                onChange={e => set("upsell_amount", parseFloat(e.target.value) || 0)} className="max-w-[180px]" />
            </div>
          </FormRow>

          {/* CROSS-SELL */}
          <div className="mt-4 mb-1 flex items-center gap-2">
            <Repeat className="w-4 h-4 text-violet-600" />
            <p className="text-xs font-bold text-violet-700 uppercase tracking-wider">Cross-sell</p>
          </div>
          <FormRow label="Cross-sell Product">
            <Input value={f.cross_product} placeholder="Product cross-sold" onChange={e => set("cross_product", e.target.value)} />
          </FormRow>
          <FormRow label="Cross Qty / Amount">
            <div className="flex gap-3">
              <Input type="number" min={0} step={1} value={f.cross_qty || ""} placeholder="Qty"
                onChange={e => set("cross_qty", parseInt(e.target.value) || 0)} className="max-w-[120px]" />
              <Input type="number" min={0} step="0.01" value={f.cross_amount || ""} placeholder="Amount (₱)"
                onChange={e => set("cross_amount", parseFloat(e.target.value) || 0)} className="max-w-[180px]" />
            </div>
          </FormRow>

          {/* Auto-computed totals — live as they type; the store recomputes on save */}
          <div className="my-3 max-w-md rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Sale Type</p>
              <p className="text-sm font-bold text-slate-800">{saleType}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Total Qty</p>
              <p className="text-sm font-bold text-slate-800 tabular-nums">{num(totalQty)}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Total Amount</p>
              <p className="text-sm font-bold text-emerald-700 tabular-nums">{peso(totalAmt)}</p>
            </div>
          </div>

          <FormRow label="Call Status">
            <select className={SEL + " max-w-[220px]"} value={f.call_status} onChange={e => set("call_status", e.target.value)}>
              {CALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </FormRow>
          <FormRow label="Sales Status">
            <select className={SEL + " max-w-[220px]"} value={f.sales_status} onChange={e => set("sales_status", e.target.value)}>
              {SALES_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </FormRow>
          <FormRow label="Notes">
            <textarea rows={3} value={f.notes} onChange={e => set("notes", e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-400 resize-none"
              placeholder="Optional notes about this sale…" />
          </FormRow>
        </div>

        <div className="flex items-center gap-3 pt-5 mt-2 border-t border-slate-100 max-w-3xl">
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : sale ? "Save Changes" : "Save Sale"}</Button>
          <Button variant="outline" onClick={onBack} disabled={saving}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}

// ── View — full-page screen: all fields + history (spec §32 audit trail) ──────
function ViewSaleScreen({ sale, onBack }: { sale: TmSale; onBack: () => void }) {
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
        <ChevronLeft className="w-4 h-4" /> Back to Sales Operations
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* LEFT — sale details */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><PhoneOutgoing className="w-5 h-5" /> VIEW SALE</h1>
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${SALES_STATUS_BADGE[sale.sales_status] ?? "bg-slate-100 text-slate-600"}`}>{sale.sales_status}</span>
          </div>
          <hr className="border-slate-200 mb-4" />

          <div className="space-y-0.5 max-w-2xl">
            <ViewField label="Date / Time" value={`${sale.sale_date} ${sale.sale_time}`} />
            <ViewField label="Customer" value={sale.customer_name} />
            <ViewField label="Phone" value={sale.customer_phone} />
            <ViewField label="Original Order ID" value={sale.original_order_id} />
            <ViewField label="Original Product" value={sale.original_product} />
            <ViewField label="Agent" value={sale.agent_name} />
            <ViewField label="Sale Type" value={sale.sale_type} />
            <ViewField label="Upsell Product" value={sale.upsell_product} />
            <ViewField label="Upsell Qty" value={sale.upsell_qty > 0 ? num(sale.upsell_qty) : ""} />
            <ViewField label="Upsell Amount" value={sale.upsell_amount > 0 ? peso(sale.upsell_amount) : ""} />
            <ViewField label="Cross-sell Product" value={sale.cross_product} />
            <ViewField label="Cross Qty" value={sale.cross_qty > 0 ? num(sale.cross_qty) : ""} />
            <ViewField label="Cross Amount" value={sale.cross_amount > 0 ? peso(sale.cross_amount) : ""} />
            <ViewField label="Total Qty" value={num(sale.total_qty)} />
            <ViewField label="Total Amount" value={<span className="font-semibold text-emerald-700">{peso(sale.total_amount)}</span>} />
            <ViewField label="Call Status" value={sale.call_status} />
            <ViewField label="Notes" value={sale.notes} />
          </div>

          <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-200">
            <Button variant="outline" onClick={onBack}>Back</Button>
          </div>
        </div>

        {/* RIGHT — HISTORY */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="text-lg font-bold text-blue-600 flex items-center gap-2 mb-1"><Clock className="w-5 h-5" /> HISTORY</h2>
          <hr className="border-slate-200 mb-4" />
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="bg-slate-100 px-4 py-2.5 font-bold text-sm text-slate-700">Added By</div>
            <div className="px-4 py-2.5 text-sm text-slate-600 border-b border-slate-200">{sale.added_by || "—"}</div>
            <div className="bg-slate-100 px-4 py-2.5 font-bold text-sm text-slate-700">Date Created</div>
            <div className="px-4 py-2.5 text-sm text-slate-600">{sale.added_date ? fmtDateTime(sale.added_date) : "—"}</div>
          </div>
          {sale.history.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Activity Log</p>
              <div className="space-y-2">
                {sale.history.map((h, i) => (
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
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TmOperationsPage() {
  const salesHook = useTmSales()
  const agentsHook = useTmAgents()
  const leadsHook = useTmLeads()

  const activeAgents = useMemo(() => agentsHook.agents.filter(a => a.status === "Active"), [agentsHook.agents])

  // Filters — default date range is TODAY.
  const [dateFrom, setDateFrom] = useState(todayStr())
  const [dateTo, setDateTo] = useState(todayStr())
  const [search, setSearch] = useState("")
  const [fAgent, setFAgent] = useState("")
  const [fType, setFType] = useState("")
  const [fStatus, setFStatus] = useState("")
  const hasFilters = !!(dateFrom || dateTo || search || fAgent || fType || fStatus)

  const [screen, setScreen] = useState<"" | "add">("")
  const [editSale, setEditSale] = useState<TmSale | null>(null)
  const [viewSale, setViewSale] = useState<TmSale | null>(null)
  const [cancelTarget, setCancelTarget] = useState<TmSale | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null)
  function flash(msg: string, err = false) { setToast({ msg, err }); setTimeout(() => setToast(null), 4000) }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return salesHook.sales.filter(s => {
      if (dateFrom && s.sale_date < dateFrom) return false
      if (dateTo && s.sale_date > dateTo) return false
      if (q && !(s.customer_name.toLowerCase().includes(q) || s.customer_phone.toLowerCase().includes(q) || s.original_order_id.toLowerCase().includes(q))) return false
      if (fAgent && s.agent_id !== fAgent) return false
      if (fType && s.sale_type !== fType) return false
      if (fStatus && s.sales_status !== fStatus) return false
      return true
    }).sort((a, b) => (b.sale_date + b.sale_time).localeCompare(a.sale_date + a.sale_time))
  }, [salesHook.sales, dateFrom, dateTo, search, fAgent, fType, fStatus])

  // KPI strip — from the CURRENTLY FILTERED rows, Cancelled excluded (activeSales).
  const kpi = useMemo(() => {
    const rows = activeSales(filtered)
    const upsellOrders = rows.reduce((n, s) => n + s.upsell_qty, 0)
    const upsellAmount = rows.reduce((n, s) => n + s.upsell_amount, 0)
    const crossOrders = rows.reduce((n, s) => n + s.cross_qty, 0)
    const crossAmount = rows.reduce((n, s) => n + s.cross_amount, 0)
    return { upsellOrders, upsellAmount, crossOrders, crossAmount, totalOrders: upsellOrders + crossOrders, grandTotal: upsellAmount + crossAmount }
  }, [filtered])

  // TOTAL row — sums the VISIBLE filtered rows (matches what the table shows).
  const totals = useMemo(() => ({
    uq: filtered.reduce((n, s) => n + s.upsell_qty, 0), ua: filtered.reduce((n, s) => n + s.upsell_amount, 0),
    cq: filtered.reduce((n, s) => n + s.cross_qty, 0), ca: filtered.reduce((n, s) => n + s.cross_amount, 0),
    tq: filtered.reduce((n, s) => n + s.total_qty, 0), ta: filtered.reduce((n, s) => n + s.total_amount, 0),
  }), [filtered])

  const loaded = salesHook.loaded && agentsHook.loaded

  async function handleSave(v: SaleFormValues) {
    if (editSale) {
      await salesHook.updateSale(editSale.id, v)
      setEditSale(null); flash("Sale updated.")
    } else {
      await salesHook.addSale(v)
      setScreen(""); flash("Sale recorded.")
    }
  }

  async function confirmCancel() {
    if (!cancelTarget) return
    setCancelling(true)
    try {
      await salesHook.updateSale(cancelTarget.id, { sales_status: "Cancelled" })
      flash("Sale cancelled.")
    } catch (e: any) {
      flash(e?.message || "Cancel failed — please retry.", true)
    }
    setCancelling(false); setCancelTarget(null)
  }

  // Full-page early-return screens (bookkeeping pattern)
  if (screen === "add" || editSale) {
    return <SaleFormScreen sale={editSale} agents={activeAgents} leads={leadsHook.leads}
      onBack={() => { setScreen(""); setEditSale(null) }} onSave={handleSave} />
  }
  if (viewSale) {
    const current = salesHook.sales.find(s => s.id === viewSale.id) || viewSale
    return <ViewSaleScreen sale={current} onBack={() => setViewSale(null)} />
  }

  const kpiCards = [
    { label: "Upsell Orders", value: num(kpi.upsellOrders), color: "bg-sky-600", icon: TrendingUp },
    { label: "Upsell Amount", value: peso(kpi.upsellAmount), color: "bg-blue-600", icon: Coins },
    { label: "Cross-sell Orders", value: num(kpi.crossOrders), color: "bg-violet-600", icon: Repeat },
    { label: "Cross-sell Amount", value: peso(kpi.crossAmount), color: "bg-purple-600", icon: Wallet },
    { label: "Total Orders", value: num(kpi.totalOrders), color: "bg-slate-800", icon: ShoppingCart },
    { label: "Grand Total Sales", value: peso(kpi.grandTotal), color: "bg-emerald-600", icon: Sigma },
  ]

  const HEADERS = ["Date", "Time", "Customer", "Phone", "Orig. Order ID", "Agent", "Sale Type", "Upsell Product", "Upsell Qty", "Upsell Amt", "Cross Product", "Cross Qty", "Cross Amt", "Total Qty", "Total Amt", "Call Status", "Status", "Notes", "Actions"]
  const MONEY_TD = "px-3 py-2.5 text-slate-700 whitespace-nowrap tabular-nums text-right"

  return (
    <div className="space-y-3">
      <span className="text-sm text-slate-500 font-medium">Telemarketing / Sales Operations</span>
      {toast && (
        <div className={`fixed top-4 right-4 z-50 ${toast.err ? "bg-red-600" : "bg-emerald-600"} text-white rounded-xl shadow-2xl px-4 py-3 text-sm flex items-center gap-2`}>
          {toast.err ? <AlertTriangle className="w-4 h-4" /> : <Check className="w-4 h-4" />} {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><PhoneOutgoing className="w-5 h-5" /> SALES OPERATIONS</h1>
          <div className="flex items-center gap-2">
            <Button onClick={() => setScreen("add")}><Plus className="w-4 h-4" /> Add Sale</Button>
            <button onClick={() => { salesHook.refresh(); leadsHook.refresh() }} title="Refresh"
              className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50/70 hover:text-slate-700 transition-colors">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* KPI strip — filtered rows, Cancelled excluded */}
      {!loaded ? (
        <StatCardsSkeleton count={6} height="h-[70px] sm:h-[78px]" className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5" />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
          {kpiCards.map(c => (
            <div key={c.label} className={`relative overflow-hidden ${c.color} rounded-xl px-3 py-2.5 sm:px-4 sm:py-3 h-[70px] sm:h-[78px] flex items-center justify-between`}>
              <c.icon strokeWidth={1} className="absolute -left-2 w-16 h-16 opacity-[0.15] text-white" />
              <div className="text-right ml-auto z-10 min-w-0">
                <p className="text-lg sm:text-2xl font-bold text-white leading-none tabular-nums truncate">{c.value}</p>
                <p className="text-[10px] text-white/80 font-semibold mt-1 tracking-wider uppercase leading-tight">{c.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {!loaded ? (
          <TableSkeleton rows={8} cols={8} />
        ) : (
          <div className="overflow-x-auto max-h-[65vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-40 bg-white">
                <tr className="border-b border-slate-200 text-slate-600">
                  {HEADERS.map(h => <th key={h} className="px-3 py-3 text-left font-semibold whitespace-nowrap bg-white">{h}</th>)}
                </tr>
                {/* Filter row */}
                <tr className="border-b border-slate-200 align-top">
                  <th className="px-2 py-2" colSpan={2}>
                    <div className="min-w-[130px]">
                      <DateRangePicker a={dateFrom} b={dateTo} onApply={(a, b) => { setDateFrom(a); setDateTo(b) }} />
                    </div>
                  </th>
                  <th className="px-2 py-2" colSpan={3}>
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Customer / phone / order ID"
                      className="h-8 w-full min-w-[180px] rounded border border-slate-300 px-2 text-xs font-normal" />
                  </th>
                  <th className="px-2 py-2">
                    <select value={fAgent} onChange={e => setFAgent(e.target.value)} className="h-8 w-full min-w-[120px] rounded border border-slate-300 px-1.5 text-xs bg-white font-normal">
                      <option value="">All</option>
                      {activeAgents.map(a => <option key={a.id} value={a.id}>{a.agent_name}</option>)}
                    </select>
                  </th>
                  <th className="px-2 py-2">
                    <select value={fType} onChange={e => setFType(e.target.value)} className="h-8 w-full min-w-[100px] rounded border border-slate-300 px-1.5 text-xs bg-white font-normal">
                      <option value="">All</option>
                      {SALE_TYPE_FILTERS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </th>
                  <th className="px-2 py-2" colSpan={9}></th>
                  <th className="px-2 py-2">
                    <select value={fStatus} onChange={e => setFStatus(e.target.value)} className="h-8 w-full min-w-[100px] rounded border border-slate-300 px-1.5 text-xs bg-white font-normal">
                      <option value="">All</option>
                      {SALES_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </th>
                  <th className="px-2 py-2"></th>
                  <th className="px-2 py-2">
                    {hasFilters && (
                      <Button size="sm" variant="outline"
                        onClick={() => { setDateFrom(""); setDateTo(""); setSearch(""); setFAgent(""); setFType(""); setFStatus("") }}>
                        Clear
                      </Button>
                    )}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr><td colSpan={19} className="text-center py-12 text-slate-400">No sales found for the selected filters</td></tr>
                ) : filtered.map(s => (
                  <tr key={s.id} className={`hover:bg-slate-50/70 ${s.sales_status === "Cancelled" ? "opacity-60" : ""}`}>
                    <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{s.sale_date}</td>
                    <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{s.sale_time}</td>
                    <td className="px-3 py-2.5 text-slate-800 font-medium whitespace-nowrap">{s.customer_name}</td>
                    <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{s.customer_phone}</td>
                    <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{s.original_order_id}</td>
                    <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{s.agent_name}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className={s.sale_type === "Both" ? "text-emerald-700 font-medium" : s.sale_type === "Cross-sell" ? "text-violet-700 font-medium" : "text-sky-700 font-medium"}>{s.sale_type}</span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-700 max-w-[160px] truncate" title={s.upsell_product}>{s.upsell_product}</td>
                    <td className={MONEY_TD}>{s.upsell_qty > 0 ? num(s.upsell_qty) : ""}</td>
                    <td className={MONEY_TD}>{s.upsell_amount > 0 ? peso(s.upsell_amount) : ""}</td>
                    <td className="px-3 py-2.5 text-slate-700 max-w-[160px] truncate" title={s.cross_product}>{s.cross_product}</td>
                    <td className={MONEY_TD}>{s.cross_qty > 0 ? num(s.cross_qty) : ""}</td>
                    <td className={MONEY_TD}>{s.cross_amount > 0 ? peso(s.cross_amount) : ""}</td>
                    <td className={MONEY_TD + " font-semibold"}>{num(s.total_qty)}</td>
                    <td className={MONEY_TD + " font-semibold"}>{peso(s.total_amount)}</td>
                    <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{s.call_status}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${SALES_STATUS_BADGE[s.sales_status] ?? "bg-slate-100 text-slate-600"}`}>{s.sales_status}</span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 max-w-[180px] truncate" title={s.notes}>{s.notes}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1">
                        <button onClick={() => setViewSale(s)} title="View sale" className="w-8 h-8 flex items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-100"><Eye className="w-4 h-4" /></button>
                        <button onClick={() => setEditSale(s)} title="Edit sale" className="w-8 h-8 flex items-center justify-center rounded border border-slate-200 text-blue-500 hover:bg-blue-50"><Pencil className="w-4 h-4" /></button>
                        {s.sales_status !== "Cancelled" && (
                          <button onClick={() => setCancelTarget(s)} title="Cancel sale" className="w-8 h-8 flex items-center justify-center rounded border border-slate-200 text-red-500 hover:bg-red-50"><Ban className="w-4 h-4" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              {filtered.length > 0 && (
                <tfoot>
                  <tr className="font-bold text-slate-800">
                    <td colSpan={8} className="px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300">TOTAL ({filtered.length})</td>
                    <td className="px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300 tabular-nums text-right whitespace-nowrap">{num(totals.uq)}</td>
                    <td className="px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300 tabular-nums text-right whitespace-nowrap">{peso(totals.ua)}</td>
                    <td className="sticky bottom-0 bg-slate-50 border-t-2 border-slate-300"></td>
                    <td className="px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300 tabular-nums text-right whitespace-nowrap">{num(totals.cq)}</td>
                    <td className="px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300 tabular-nums text-right whitespace-nowrap">{peso(totals.ca)}</td>
                    <td className="px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300 tabular-nums text-right whitespace-nowrap">{num(totals.tq)}</td>
                    <td className="px-3 py-2.5 sticky bottom-0 bg-slate-50 border-t-2 border-slate-300 tabular-nums text-right whitespace-nowrap">{peso(totals.ta)}</td>
                    <td colSpan={4} className="sticky bottom-0 bg-slate-50 border-t-2 border-slate-300"></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {/* Cancel confirmation */}
      {cancelTarget && (
        <Modal title="Cancel this sale?" onClose={() => setCancelTarget(null)}>
          <div className="p-6">
            <p className="text-sm text-slate-600">
              Cancel the {cancelTarget.sale_type.toLowerCase()} sale for{" "}
              <span className="font-semibold text-slate-800">{cancelTarget.customer_name || "this customer"}</span>{" "}
              worth <span className="font-semibold text-slate-800">{peso(cancelTarget.total_amount)}</span>?
              Cancelled sales are excluded from all KPIs but stay in the record with full history.
            </p>
            <div className="flex items-center gap-3 mt-5">
              <Button className="bg-red-500 hover:bg-red-600 text-white" onClick={confirmCancel} disabled={cancelling}>
                {cancelling ? "Cancelling…" : "Yes, cancel sale"}
              </Button>
              <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={cancelling}>Keep it</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
