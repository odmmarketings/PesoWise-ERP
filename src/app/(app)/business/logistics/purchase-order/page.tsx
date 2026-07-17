"use client"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatCurrency } from "@/lib/utils"
import * as XLSX from "xlsx-js-style"
import {
  ClipboardList, Plus, Search, Pencil, X, Trash2, Copy, ChevronLeft, ChevronRight, Settings, Check, Boxes, FileText, Download, ChevronDown, Flag, Link2,
} from "lucide-react"
import { usePurchaseOrders, usePOSettings, poTotal, poLocked, nextPONumbers, PO_STATUSES, PO_NEXT_STATUS, type PurchaseOrder, type NewPOInput, type POItem, type POStatus, type POSettings, type POFeeConfig } from "@/lib/po-store"
import { useFinanceSettings, MEMBERS } from "@/lib/finance-settings-store"
import { useSuppliers } from "@/lib/supplier-store"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import { useProductItems } from "@/lib/product-items-store"

const INP = "w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white focus:outline-none focus:border-blue-400"
const FINP = "w-full h-8 rounded-lg border border-slate-200 px-2 text-xs bg-white focus:outline-none focus:border-blue-400"

const STATUS_BADGE: Record<POStatus, string> = {
  Draft: "bg-slate-100 text-slate-600",
  "For Approval": "bg-violet-100 text-violet-700",
  Approved: "bg-blue-100 text-blue-700",
  Paid: "bg-teal-100 text-teal-700",
  "Partial Delivery": "bg-amber-100 text-amber-700",
  Delivered: "bg-emerald-100 text-emerald-700",
  Cancelled: "bg-rose-100 text-rose-600",
}

// Export a single PO to Excel (details + order lines + totals).
function exportPO(o: PurchaseOrder) {
  const rows: (string | number)[][] = [
    ["PURCHASE ORDER"], [],
    ["Issue Date", o.issue_date], ["Delivery No.", o.delivery_no], ["Customer PO No.", o.cust_po_no], ["Control No.", o.control_no],
    ["Delivery to", o.delivery_to], ["Delivery Address", o.delivery_address], ["Status", o.status], [],
    ["Supplier", "Item", "Qty", "COG", "Amount"],
    ...o.items.map(i => [i.supplier, i.name, i.qty, i.cost, i.qty * i.cost] as (string | number)[]),
    [], ["", "", "", "Items Total", poTotal(o)], ["", "", "", "Delivery Fee", o.delivery_fee || 0], ["", "", "", "GRAND TOTAL", poTotal(o) + (o.delivery_fee || 0)],
    [], ["Assigned to", o.assigned_to.join(", ")], ["Picked-up Date", o.picked_up_date], ["Remarks", o.remarks],
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws["!cols"] = [{ wch: 18 }, { wch: 30 }, { wch: 8 }, { wch: 12 }, { wch: 12 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "PO")
  XLSX.writeFile(wb, `${o.control_no || "PO"}.xlsx`)
}

function FormRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] items-start gap-3 py-2.5 border-b border-slate-100 last:border-0">
      <label className="text-sm text-slate-600 pt-2 text-right pr-2">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <div>{children}</div>
    </div>
  )
}

const EMPTY_FILTERS = { from: "", to: "", delivery: "", custPo: "", control: "", status: "All" }

export default function PurchaseOrderPage() {
  const po = usePurchaseOrders()
  const [screen, setScreen] = useState<"list" | "add" | "edit" | "view" | "settings" | "copy">("list")
  const [active, setActive] = useState<PurchaseOrder | null>(null)
  const [confirmDel, setConfirmDel] = useState<PurchaseOrder | null>(null)
  const [stockOutOpen, setStockOutOpen] = useState(false)
  const [toast, setToast] = useState("")
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500) }

  // Copy-link deep link: opening ?view=<id> jumps straight to that order's view screen.
  const deepLinked = useState({ done: false })[0]
  useEffect(() => {
    if (deepLinked.done || po.orders.length === 0) return
    deepLinked.done = true
    try {
      const id = new URLSearchParams(window.location.search).get("view")
      const target = id && po.orders.find(o => o.id === id)
      if (target) { setActive(target); setScreen("view") }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [po.orders.length])

  // Copy Link (blue icon) — copies a URL that opens this order's info directly.
  function copyLink(o: PurchaseOrder) {
    const url = `${window.location.origin}${window.location.pathname}?view=${encodeURIComponent(o.id)}`
    navigator.clipboard?.writeText(url).then(() => flash("Order link copied."), () => flash("Couldn't copy link."))
  }

  // Delivered toggle: unchecked = active POs, checked = delivered POs only (archive-style view).
  const [showDelivered, setShowDelivered] = useState(false)
  const [perPage, setPerPage] = useState(10)
  const [page, setPage] = useState(1)
  // Filter inputs apply on Search (matching the reference's explicit Search button).
  const [f, setF] = useState(EMPTY_FILTERS)
  const [applied, setApplied] = useState(EMPTY_FILTERS)
  const setFilter = (k: keyof typeof EMPTY_FILTERS, v: string) => setF(p => ({ ...p, [k]: v }))
  const applyFilters = () => { setApplied(f); setPage(1) }

  const filtered = useMemo(() => po.orders.filter(o => {
    if (showDelivered ? o.status !== "Delivered" : o.status === "Delivered") return false
    if (applied.from && (!o.issue_date || o.issue_date < applied.from)) return false
    if (applied.to && (!o.issue_date || o.issue_date > applied.to)) return false
    if (applied.delivery && !o.delivery_no.toLowerCase().includes(applied.delivery.toLowerCase())) return false
    if (applied.custPo && !o.cust_po_no.toLowerCase().includes(applied.custPo.toLowerCase())) return false
    if (applied.control && !o.control_no.toLowerCase().includes(applied.control.toLowerCase())) return false
    if (applied.status !== "All" && o.status !== applied.status) return false
    return true
  }), [po.orders, showDelivered, applied])

  // Supplier picker = registered Suppliers (Supplier module) + names used in previous POs.
  const supStore = useSuppliers()
  const supplierOptions = useMemo(() => Array.from(new Set([
    ...supStore.activeSuppliers.map(s => s.store_name || s.name),
    ...po.orders.flatMap(o => [o.supplier, ...o.items.map(i => i.supplier)]),
  ].filter(Boolean))).sort(), [po.orders, supStore.activeSuppliers])
  const itemStore = useProductItems()
  const itemOptions = useMemo(() => Array.from(new Set([
    ...itemStore.activeItems.map(i => i.name),
    ...supStore.activeSuppliers.flatMap(s => s.items),
    ...po.orders.flatMap(o => o.items.map(i => i.name)),
  ].filter(Boolean))).sort(), [po.orders, supStore.activeSuppliers, itemStore.activeItems])

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage))
  const pageSafe = Math.min(page, totalPages)
  const paginated = filtered.slice((pageSafe - 1) * perPage, pageSafe * perPage)
  const showFrom = filtered.length === 0 ? 0 : (pageSafe - 1) * perPage + 1
  const showTo = Math.min(pageSafe * perPage, filtered.length)

  // Success toast — rendered on every screen (create/status flows land outside the list).
  const toastEl = toast ? (
    <div className="fixed top-4 right-4 z-[70] bg-emerald-600 text-white text-sm rounded-xl px-5 py-3 shadow-lg flex items-center gap-2">
      <Check className="w-4 h-4" /> <div><p className="font-semibold">Success</p><p className="text-emerald-100">{toast}</p></div>
    </div>
  ) : null

  if (screen === "add" || (screen === "copy" && active) || (screen === "edit" && active))
    return <>{toastEl}<FormScreen mode={screen === "edit" ? "edit" : "add"}
      initial={screen === "edit" ? active!
        : screen === "copy" && active
          ? { ...active, delivery_no: "", cust_po_no: "", control_no: "", issue_date: "", status: "Draft" as POStatus, picked_up_date: "" }
          : undefined}
      numbers={nextPONumbers(po.orders)} supplierOptions={supplierOptions} itemOptions={itemOptions}
      onBack={() => setScreen("list")}
      onSave={(input) => {
        if (screen === "edit" && active) { po.updateOrder(active.id, input); flash("PO updated successfully"); setScreen("list") }
        else { const created = po.addOrder(input); setActive(created); flash("PO created successfully"); setScreen("view") }
      }} /></>

  if (screen === "view" && active)
    return <>{toastEl}<ViewScreen order={po.orders.find(o => o.id === active.id) || active} onBack={() => setScreen("list")} onEdit={() => setScreen("edit")}
      onStatus={(target, remarks, by) => { po.changeStatus(active.id, target, remarks, by); flash("PO status updated successfully") }} /></>

  if (screen === "settings")
    return <>{toastEl}<POSettingsScreen onBack={() => setScreen("list")} onSaved={() => { flash("PO settings saved."); setScreen("list") }} /></>

  return (
    <div className="space-y-4 relative">
      {toastEl}

      {/* Header — Create PO · Stock-Out Items · Settings */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-4 mb-1 border-b border-slate-100">
        <div>
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><ClipboardList className="w-5 h-5" /> PURCHASE ORDER</h1>
          <p className="text-xs text-slate-400 mt-0.5">{filtered.length} record{filtered.length === 1 ? "" : "s"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => { setActive(null); setScreen("add") }}><Plus className="w-4 h-4" /> Create PO</Button>
          <Button className="bg-slate-900 hover:bg-slate-800 text-white" onClick={() => setStockOutOpen(true)}><Boxes className="w-4 h-4" /> Stock-Out Items</Button>
          <Button variant="outline" onClick={() => setScreen("settings")}><Settings className="w-4 h-4" /> Settings</Button>
        </div>
      </div>

      {/* Records selector · Delivered toggle */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-500">
          <select className="h-9 rounded-lg border border-slate-300 px-3 text-sm bg-white" value={perPage} onChange={e => { setPerPage(parseInt(e.target.value)); setPage(1) }}>
            {[10, 30, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          records
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
          <input type="checkbox" checked={showDelivered} onChange={e => { setShowDelivered(e.target.checked); setPage(1) }} className="w-4 h-4 rounded border-slate-300 accent-blue-600" />
          Delivered
        </label>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto scrollbar-dark">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left bg-slate-50">
                {["NO.", "ISSUE DATE", "DELIVERY NO.", "CUST. PO NO.", "CONTROL NO.", "SUPPLIER", "TOTAL", "STATUS", "ACTIONS"].map(h => (
                  <th key={h} className="px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
              {/* Filter row — applies on Search */}
              <tr className="border-b border-slate-200 bg-white">
                <th className="px-4 py-2" />
                <th className="px-4 py-2">
                  <div className="min-w-[124px]">
                    <DateRangePicker a={applied.from} b={applied.to}
                      onApply={(a, b) => { setF(p => ({ ...p, from: a, to: b })); setApplied(p => ({ ...p, from: a, to: b })); setPage(1) }} />
                  </div>
                </th>
                <th className="px-4 py-2"><input className={FINP} value={f.delivery} onChange={e => setFilter("delivery", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} /></th>
                <th className="px-4 py-2"><input className={FINP} value={f.custPo} onChange={e => setFilter("custPo", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} /></th>
                <th className="px-4 py-2"><input className={FINP} value={f.control} onChange={e => setFilter("control", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} /></th>
                <th className="px-4 py-2" />
                <th className="px-4 py-2" />
                <th className="px-4 py-2">
                  <select className={FINP} value={f.status} onChange={e => setFilter("status", e.target.value)}>
                    <option value="All">All</option>
                    {PO_STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </th>
                <th className="px-4 py-2">
                  <Button className="h-8 px-3 bg-blue-600 hover:bg-blue-700 text-white text-xs" onClick={applyFilters}><Search className="w-3.5 h-3.5" /> Search</Button>
                </th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-slate-400 text-sm">
                  {po.orders.length === 0 ? <>No purchase orders yet. Click <strong>Create PO</strong> to add one.</> : "No purchase orders match the filters."}
                </td></tr>
              ) : paginated.map((o, i) => (
                <tr key={o.id} className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50"} hover:bg-blue-50/40`}>
                  <td className="px-4 py-3 text-slate-400">{showFrom + i}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-700">{o.issue_date || "—"}</td>
                  <td className="px-4 py-3 text-slate-700">{o.delivery_no || "—"}</td>
                  <td className="px-4 py-3 text-slate-700">{o.cust_po_no || "—"}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{o.control_no || "—"}</td>
                  <td className="px-4 py-3 text-slate-600 max-w-[160px] truncate">{(() => {
                    const sup = Array.from(new Set(o.items.map(it => it.supplier).filter(Boolean)))
                    if (sup.length === 0) return o.supplier || "—"
                    return sup.length > 1 ? `${sup[0]} +${sup.length - 1}` : sup[0]
                  })()}</td>
                  <td className="px-4 py-3 tabular-nums font-semibold text-slate-800 whitespace-nowrap">{formatCurrency(poTotal(o) + (o.delivery_fee || 0))}</td>
                  <td className="px-4 py-3"><span className={`text-xs px-2.5 py-0.5 rounded-full font-medium whitespace-nowrap ${STATUS_BADGE[o.status]}`}>{o.status}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 text-slate-400">
                      <button onClick={() => { setActive(o); setScreen("view") }} className="hover:text-blue-600" title="View"><Search className="w-4 h-4" /></button>
                      <button onClick={() => { setActive(o); setScreen("edit") }} disabled={poLocked(o.status)} className="hover:text-teal-600 disabled:opacity-30 disabled:hover:text-slate-400"
                        title={poLocked(o.status) ? "Items beyond Paid status cannot be edited" : "Edit"}><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => setConfirmDel(o)} disabled={poLocked(o.status)} className="hover:text-rose-600 disabled:opacity-30 disabled:hover:text-slate-400"
                        title={poLocked(o.status) ? "Items beyond Paid status cannot be deleted" : "Delete"}><X className="w-4 h-4" /></button>
                      <button onClick={() => { setActive(o); setScreen("copy") }} className="text-slate-700 hover:text-slate-900" title="Copy order"><Copy className="w-4 h-4" /></button>
                      <button onClick={() => copyLink(o)} className="text-blue-500 hover:text-blue-700" title="Copy order link"><Link2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Footer — entries + pagination */}
        <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm text-slate-500">Showing {showFrom} to {showTo} of {filtered.length} entr{filtered.length === 1 ? "y" : "ies"}</span>
          <div className="flex items-center gap-1">
            <button disabled={pageSafe <= 1} onClick={() => setPage(p => p - 1)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
            <span className="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-600 text-white text-sm font-medium">{pageSafe}</span>
            <button disabled={pageSafe >= totalPages} onClick={() => setPage(p => p + 1)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      {/* Stock-Out Items — activates with the Inventory module */}
      {stockOutOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setStockOutOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[420px] p-6 space-y-3" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2"><Boxes className="w-4 h-4 text-slate-500" /> Stock-Out Items</h2>
            <p className="text-sm text-slate-600">Lists items that are out of stock so you can raise POs straight from them. This activates once the <strong>Inventory</strong> module is built — stock levels live there.</p>
            <div className="flex justify-end"><Button variant="outline" onClick={() => setStockOutOpen(false)}>Close</Button></div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setConfirmDel(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[400px] p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-800">Delete purchase order?</h2>
            <p className="text-sm text-slate-600">This permanently removes PO <strong>{confirmDel.control_no || confirmDel.delivery_no || confirmDel.id}</strong>. This cannot be undone.</p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setConfirmDel(null)}>Cancel</Button>
              <Button className="bg-rose-600 hover:bg-rose-700 text-white" onClick={() => { po.deleteOrder(confirmDel.id); flash("Purchase order deleted."); setConfirmDel(null) }}>Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Create / Edit (LHIKE "Create Request Order" layout) ──────────────────────
const emptyItem = (): POItem => ({ supplier: "", name: "", qty: 0, unit: "pcs", cost: 0 })
const RO = `${INP} bg-slate-100 text-slate-500`   // auto-generated, read-only numbers

// Searchable dropdown that also accepts free text — Supplier / Item pickers.
// Swaps to the Supplier & Inventory stores once those modules are built.
function ComboInput({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: string[]; placeholder: string }) {
  const [open, setOpen] = useState(false)
  const filtered = options.filter(o => o.toLowerCase().includes(value.toLowerCase()) && o !== value)
  return (
    <div className="relative">
      <input className={FINP} value={value} placeholder={placeholder} spellCheck={false}
        onFocus={() => setOpen(true)}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && filtered.length > 0 && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-auto scrollbar-dark">
          {filtered.map(o => (
            <button key={o} type="button" className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50"
              onMouseDown={() => { onChange(o); setOpen(false) }}>{o}</button>
          ))}
        </div>
      )}
    </div>
  )
}

function FormScreen({ mode, initial, numbers, supplierOptions, itemOptions, onBack, onSave }: {
  mode: "add" | "edit"; initial?: PurchaseOrder
  numbers: { delivery_no: string; cust_po_no: string; control_no: string }
  supplierOptions: string[]; itemOptions: string[]
  onBack: () => void; onSave: (input: NewPOInput) => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [f, setF] = useState<NewPOInput>({
    issue_date: initial?.issue_date || today,
    // Numbers are auto-generated (DN-n / CPO-n / CN-n) and locked, like the reference.
    delivery_no: initial?.delivery_no || numbers.delivery_no,
    cust_po_no: initial?.cust_po_no || numbers.cust_po_no,
    control_no: initial?.control_no || numbers.control_no,
    supplier: initial?.supplier || "",
    delivery_to: initial?.delivery_to || "",
    delivery_address: initial?.delivery_address || "",
    delivery_fee: initial?.delivery_fee || 0,
    assigned_to: initial?.assigned_to || [],
    picked_up_date: initial?.picked_up_date || "",
    status: initial?.status || "Draft",
    items: initial?.items?.length ? initial.items.map(i => ({ ...i })) : [emptyItem()],
    remarks: initial?.remarks || "",
  })
  const [assigned, setAssigned] = useState((initial?.assigned_to || []).join(", "))
  const [err, setErr] = useState("")
  const set = (k: keyof NewPOInput, v: any) => setF(p => ({ ...p, [k]: v }))
  const setItem = (idx: number, k: keyof POItem, v: string) =>
    setF(p => ({ ...p, items: p.items.map((it, i) => i === idx ? { ...it, [k]: k === "qty" || k === "cost" ? Number(v.replace(/[^\d.]/g, "")) || 0 : v } : it) }))
  const addItem = () => setF(p => ({ ...p, items: [...p.items, emptyItem()] }))
  const removeItem = (idx: number) => setF(p => ({ ...p, items: p.items.length > 1 ? p.items.filter((_, i) => i !== idx) : p.items }))
  const total = poTotal(f)
  const assignedList = assigned.split(",").map(s => s.trim()).filter(Boolean)

  function submit() {
    if (!f.issue_date) return setErr("Issue Date is required.")
    if (!f.delivery_to.trim()) return setErr("Delivery to is required.")
    if (!f.delivery_address.trim()) return setErr("Delivery Address is required.")
    if (!f.items.some(i => i.name.trim() && i.qty > 0)) return setErr("Add at least one order line (supplier, qty & item).")
    if (assignedList.length === 0) return setErr("Assigned to is required.")
    if (assignedList.length > 4) return setErr("You can assign up to 4 employees only.")
    setErr("")
    onSave({
      ...f, delivery_to: f.delivery_to.trim(), delivery_address: f.delivery_address.trim(),
      delivery_fee: Number(f.delivery_fee) || 0, assigned_to: assignedList,
      items: f.items.filter(i => i.name.trim()),
    })
  }

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft className="w-4 h-4" /> Back to Purchase Orders</button>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-3xl">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 pb-4 mb-2 border-b border-slate-100"><Settings className="w-5 h-5" /> {mode === "add" ? "CREATE REQUEST ORDER" : "EDIT REQUEST ORDER"}</h1>
        <div className="space-y-0.5">
          <FormRow label="Issue Date" required><Input type="date" className={INP} value={f.issue_date} onChange={e => set("issue_date", e.target.value)} /></FormRow>
          <FormRow label="Delivery No."><input className={RO} value={f.delivery_no} readOnly /></FormRow>
          <FormRow label="Customer PO No." required><input className={RO} value={f.cust_po_no} readOnly /></FormRow>
          <FormRow label="Control No." required><input className={RO} value={f.control_no} readOnly /></FormRow>
          <FormRow label="Delivery to" required><Input className={INP} value={f.delivery_to} onChange={e => set("delivery_to", e.target.value)} /></FormRow>
          <FormRow label="Delivery Address" required><textarea className={`${INP} h-20 py-2 resize-y`} value={f.delivery_address} onChange={e => set("delivery_address", e.target.value)} /></FormRow>
          <FormRow label="Order" required>
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_70px_1fr_100px_28px_36px] gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider px-1">
                <span>Supplier</span><span>Qty</span><span>Item</span><span>Unit Cost</span><span /><span />
              </div>
              {f.items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_70px_1fr_100px_28px_36px] gap-1.5 items-center">
                  <ComboInput value={it.supplier} onChange={v => setItem(idx, "supplier", v)} options={supplierOptions} placeholder="-- SELECT SUPPLIER --" />
                  <input className={`${FINP} text-right`} inputMode="decimal" value={it.qty || ""} onChange={e => setItem(idx, "qty", e.target.value)} placeholder="0" />
                  <ComboInput value={it.name} onChange={v => setItem(idx, "name", v)} options={itemOptions} placeholder="-- SELECT ITEM --" />
                  <input className={`${FINP} text-right`} inputMode="decimal" value={it.cost || ""} onChange={e => setItem(idx, "cost", e.target.value)} placeholder="Cost" />
                  <button type="button" onClick={() => removeItem(idx)} disabled={f.items.length <= 1} title="Remove line"
                    className="w-7 h-7 flex items-center justify-center rounded text-slate-300 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30"><Trash2 className="w-3.5 h-3.5" /></button>
                  {idx === f.items.length - 1
                    ? <button type="button" onClick={addItem} title="Add line"
                        className="w-8 h-8 rounded-full bg-slate-900 hover:bg-slate-800 text-white flex items-center justify-center"><Plus className="w-4 h-4" /></button>
                    : <span />}
                </div>
              ))}
              <div className="flex justify-end pt-1">
                <span className="text-sm font-semibold text-slate-800 tabular-nums">Total: {formatCurrency(total)}</span>
              </div>
            </div>
          </FormRow>
          <FormRow label="Delivery Fee">
            <input className={`${INP} max-w-xs text-right`} inputMode="decimal" value={f.delivery_fee || ""} placeholder="0.00"
              onChange={e => set("delivery_fee", Number(e.target.value.replace(/[^\d.]/g, "")) || 0)} />
          </FormRow>
          <FormRow label="Assigned to" required>
            <div className="space-y-1">
              <Input className={`${INP} max-w-md`} value={assigned} onChange={e => setAssigned(e.target.value)} placeholder="Names, separated by comma" />
              <p className={`text-[11px] ${assignedList.length > 4 ? "text-rose-600 font-medium" : "text-rose-400"}`}>You can assign up to 4 employees only.</p>
            </div>
          </FormRow>
          <FormRow label="Picked-up Date"><Input type="date" className={`${INP} max-w-xs`} value={f.picked_up_date} onChange={e => set("picked_up_date", e.target.value)} /></FormRow>
          {mode === "edit" && (
            <FormRow label="Status">
              <select className={INP} value={f.status} onChange={e => set("status", e.target.value as POStatus)}>
                {PO_STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </FormRow>
          )}
          <FormRow label="Remarks"><textarea className={`${INP} h-20 py-2 resize-none`} value={f.remarks} onChange={e => set("remarks", e.target.value)} /></FormRow>
        </div>
        {err && <p className="text-sm text-rose-600 mt-3">{err}</p>}
        <div className="flex gap-2 mt-5 pt-4 border-t border-slate-100">
          <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={submit}>Submit</Button>
          <Button variant="outline" onClick={onBack}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}

// ── PO Account & Bank Settings ───────────────────────────────────────────────
// Maps Delivery Fee / COG Fee to Finance Settings reference data (Account · Bank ·
// Type of Expense · Department). Read-only until "Edit PO Settings" is clicked.
function POSettingsScreen({ onBack, onSaved }: { onBack: () => void; onSaved: () => void }) {
  const fin = useFinanceSettings()
  const { settings, save } = usePOSettings()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<POSettings>(settings)
  useEffect(() => { if (!editing) setDraft(settings) }, [settings, editing])

  const s = fin.settings
  const accounts = (s?.accounts || []).filter(a => a.status === "active")
  const banks = (s?.banks || []).filter(b => b.status === "active")
  const types = (s?.types || []).filter(t => t.status === "active")
  const departments = (s?.departments || []).filter(d => d.status === "active")

  const set = (fee: "delivery" | "cog", k: keyof POFeeConfig, v: string) =>
    setDraft(d => ({ ...d, [fee]: { ...d[fee], [k]: v } }))

  const Sel = ({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { id: string; name: string }[] }) => (
    <div className="grid grid-cols-[150px_1fr] items-center gap-3">
      <label className="text-sm text-slate-600 text-right">{label}</label>
      <select className={`${INP} disabled:bg-slate-50 disabled:text-slate-500`} value={value} disabled={!editing} onChange={e => onChange(e.target.value)}>
        <option value="">— select —</option>
        {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  )

  const FeeBlock = ({ title, fee, accountLabel }: { title: string; fee: "delivery" | "cog"; accountLabel: string }) => (
    <div className="py-5 border-b border-slate-100">
      <p className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-4 pl-[26px]">{title}</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-3">
        <Sel label={accountLabel} value={draft[fee].account_id} onChange={v => set(fee, "account_id", v)} options={accounts} />
        <Sel label="Type of Expense" value={draft[fee].type_id} onChange={v => set(fee, "type_id", v)} options={types} />
        <Sel label="Bank" value={draft[fee].bank_id} onChange={v => set(fee, "bank_id", v)} options={banks} />
        <Sel label="Department" value={draft[fee].department_id} onChange={v => set(fee, "department_id", v)} options={departments} />
      </div>
    </div>
  )

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft className="w-4 h-4" /> Back to Purchase Orders</button>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-4xl">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 pb-4 border-b border-slate-100"><Settings className="w-5 h-5" /> PURCHASE ORDER ACCOUNT &amp; BANK SETTINGS</h1>
        <FeeBlock title="Delivery Fee" fee="delivery" accountLabel="Delivery Fee Account" />
        <FeeBlock title="COG Fee" fee="cog" accountLabel="COG Fee Account" />
        <div className="flex justify-center gap-2 pt-5">
          {editing ? (
            <>
              <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => { save(draft); setEditing(false); onSaved() }}>Save</Button>
              <Button variant="outline" onClick={() => { setDraft(settings); setEditing(false) }}>Cancel</Button>
            </>
          ) : (
            <>
              <Button className="bg-teal-500 hover:bg-teal-600 text-white" onClick={() => setEditing(true)}><Pencil className="w-3.5 h-3.5" /> Edit PO Settings</Button>
              <Button variant="outline" onClick={onBack}>Cancel</Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── View ─────────────────────────────────────────────────────────────────────
function ViewScreen({ order, onBack, onEdit, onStatus }: { order: PurchaseOrder; onBack: () => void; onEdit: () => void; onStatus: (target: POStatus, remarks: string, by: string) => void }) {
  // Status workflow: dropdown shows the allowed next statuses; picking one opens Change Status.
  const [menuOpen, setMenuOpen] = useState(false)
  const [statusModal, setStatusModal] = useState<POStatus | null>(null)
  const [remarks, setRemarks] = useState("")
  const [assignee, setAssignee] = useState("")
  const [modalErr, setModalErr] = useState("")
  const nextOptions = PO_NEXT_STATUS[order.status]
  const optionLabel = (s: POStatus) => s === "Cancelled" ? "Cancel" : s === "Draft" ? "Back to Draft" : s
  const fmtDT = (iso: string) => { try { return new Date(iso).toLocaleString("en-PH", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) } catch { return iso } }
  function confirmStatus() {
    if (!remarks.trim()) return setModalErr("Remarks is required.")
    if (!assignee) return setModalErr("Assigned to is required.")
    onStatus(statusModal!, remarks.trim(), assignee)
    setStatusModal(null); setRemarks(""); setAssignee(""); setModalErr("")
  }
  const F = ({ l, v }: { l: string; v: React.ReactNode }) => (
    <div className="grid grid-cols-[160px_1fr] gap-3 py-2.5 border-b border-slate-100">
      <span className="text-sm text-slate-500 text-right pr-2">{l}</span><span className="text-sm text-slate-800">{v || "—"}</span>
    </div>
  )
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft className="w-4 h-4" /> Back to Purchase Orders</button>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 items-start">
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-center justify-between flex-wrap gap-2 pb-4 mb-2 border-b border-slate-100">
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Settings className="w-5 h-5" /> ORDER</h1>
          <div className="flex items-center gap-2">
            <Button className="bg-teal-500 hover:bg-teal-600 text-white" onClick={() => exportPO(order)}><Download className="w-4 h-4" /> Export</Button>
            <div className="relative">
              <Button variant="outline" onClick={() => setMenuOpen(o => !o)} disabled={nextOptions.length === 0}>
                {order.status} <ChevronDown className="w-3.5 h-3.5" />
              </Button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-30 w-44 py-1">
                    {nextOptions.map(s => (
                      <button key={s} onClick={() => { setMenuOpen(false); setStatusModal(s); setModalErr(""); setRemarks(""); setAssignee("") }}
                        className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">{optionLabel(s)}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <F l="Issue Date" v={order.issue_date} /><F l="Delivery No." v={order.delivery_no} /><F l="Customer PO No." v={order.cust_po_no} />
        <F l="Control No." v={order.control_no} />
        <F l="Delivery to" v={order.delivery_to} /><F l="Delivery Address" v={order.delivery_address} />
        <F l="Status" v={<span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${STATUS_BADGE[order.status]}`}>{order.status}</span>} />
        <div className="py-3">
          <p className="text-sm text-slate-500 mb-2">Order</p>
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr className="text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="px-3 py-2">Supplier</th><th className="px-3 py-2">Item</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">COG</th><th className="px-3 py-2 text-right">Amount</th>
              </tr></thead>
              <tbody>
                {order.items.map((it, i) => (
                  <tr key={i} className={`border-t border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
                    <td className="px-3 py-2 text-slate-600">{it.supplier || "—"}</td>
                    <td className="px-3 py-2 text-slate-700">{it.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{it.qty}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(it.cost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCurrency(it.qty * it.cost)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 text-slate-700">
                  <td className="px-3 py-2" colSpan={4}>Items Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(poTotal(order))}</td>
                </tr>
                <tr className="border-t border-slate-100 bg-slate-50 text-slate-700">
                  <td className="px-3 py-2" colSpan={4}>Delivery Fee</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(order.delivery_fee || 0)}</td>
                </tr>
                <tr className="border-t border-slate-200 bg-slate-100 font-bold text-slate-800">
                  <td className="px-3 py-2" colSpan={4}>GRAND TOTAL</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(poTotal(order) + (order.delivery_fee || 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        <F l="Assigned to" v={order.assigned_to.join(", ")} />
        <F l="Picked-up Date" v={order.picked_up_date} />
        <F l="Remarks" v={order.remarks} />
        <div className="flex gap-2 mt-4">
          <Button className="bg-teal-500 hover:bg-teal-600 text-white disabled:opacity-40" disabled={poLocked(order.status)}
            title={poLocked(order.status) ? "Items beyond Paid status cannot be edited" : undefined} onClick={onEdit}><Pencil className="w-3.5 h-3.5" /> Edit</Button>
          <Button variant="outline" onClick={onBack}>Close</Button>
        </div>
      </div>

      {/* HISTORY — created by/date + every status change with remarks */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="text-base font-bold text-blue-600 flex items-center gap-2 mb-3"><Flag className="w-4 h-4" /> HISTORY</h2>
        <div className="border border-slate-200 rounded-xl overflow-hidden text-sm">
          <div className="bg-slate-50 px-3 py-2 font-semibold text-slate-700 border-b border-slate-100">Created by</div>
          <div className="px-3 py-2 text-slate-700 border-b border-slate-100">{order.created_by}</div>
          <div className="bg-slate-50 px-3 py-2 font-semibold text-slate-700 border-b border-slate-100">Created Date</div>
          <div className="px-3 py-2 text-slate-700">{fmtDT(order.created_at)}</div>
        </div>
        {order.history.filter(h => h.action !== "Created").length > 0 && (
          <div className="mt-3 space-y-2">
            {order.history.filter(h => h.action !== "Created").slice().reverse().map((h, i) => (
              <div key={i} className="border border-slate-100 rounded-lg px-3 py-2 text-xs">
                <p className="font-medium text-slate-700">{h.action}</p>
                <p className="text-slate-400">{fmtDT(h.date)} · {h.by}</p>
                {h.remarks && <p className="text-slate-500 mt-0.5">&ldquo;{h.remarks}&rdquo;</p>}
              </div>
            ))}
          </div>
        )}
      </div>
      </div>

      {/* Change Status confirmation */}
      {statusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setStatusModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[480px] max-w-[94vw] p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-800">Change Status</h2>
              <button onClick={() => setStatusModal(null)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-sm text-slate-600">You are about to change the status of this PO to <strong>{optionLabel(statusModal)}</strong>. Click <strong>Ok</strong> to continue.</p>
            <div className="grid grid-cols-[110px_1fr] items-start gap-3">
              <label className="text-sm text-slate-600 pt-2 text-right">Remarks <span className="text-red-500">*</span></label>
              <textarea className={`${INP} h-20 py-2 resize-none`} value={remarks} onChange={e => setRemarks(e.target.value)} />
              <label className="text-sm text-slate-600 pt-2 text-right">Assigned to <span className="text-red-500">*</span></label>
              <select className={INP} value={assignee} onChange={e => setAssignee(e.target.value)}>
                <option value="">-- SELECT USER --</option>
                {MEMBERS.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
            {modalErr && <p className="text-sm text-rose-600">{modalErr}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStatusModal(null)}>Cancel</Button>
              <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={confirmStatus}>Ok</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
