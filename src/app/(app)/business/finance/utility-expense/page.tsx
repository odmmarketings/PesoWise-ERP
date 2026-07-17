"use client"
import { useState, useMemo, useRef } from "react"
import * as XLSX from "xlsx-js-style"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Search, ChevronLeft, ChevronDown, FileText, Download, Plus, X, Settings, Droplet } from "lucide-react"
import { useUtilityExpenses, UTIL_MOPS, REQUEST_FORMS, TYPE_OF_REQUEST_OPTIONS, peekNextUtilControlNo, utilNowStamp, type UtilityExpense, type NewUtilInput, type UtilStatus } from "@/lib/utility-store"
import { useFinanceSettings, type ExpenseType } from "@/lib/finance-settings-store"
import { pushBookkeepingTxn, type NewTxnInput } from "@/lib/bookkeeping-store"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"

const SEL = "w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white focus:outline-none focus:border-blue-400"
const FSEL = "h-8 w-full rounded border border-slate-300 px-1.5 text-xs bg-white focus:outline-none focus:border-blue-400"
const RO = "bg-slate-100 text-slate-600 cursor-default"

const fmtNum = (n: number) => Number(n || 0).toLocaleString("en-PH")
const fmtMoney = (n: number) => Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const STATUS_TEXT: Record<UtilStatus, string> = { pending: "text-slate-900 font-bold", approved: "text-blue-600 font-semibold", declined: "text-red-600 font-semibold" }
const STATUS_LABEL: Record<UtilStatus, string> = { pending: "Pending", approved: "Approved", declined: "Declined" }

function FormRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-2 border-b border-slate-100 last:border-0">
      <label className="w-40 flex-shrink-0 text-sm text-slate-600 pt-2.5 leading-tight">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <div className="flex-1">{children}</div>
    </div>
  )
}
function VField({ label, value, required, select, tall }: { label: string; value: React.ReactNode; required?: boolean; select?: boolean; tall?: boolean }) {
  const empty = value === "" || value === null || value === undefined
  return (
    <div className="flex items-start gap-4 py-1.5">
      <label className="w-44 text-right text-sm text-slate-600 flex-shrink-0 pt-2">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <div className="flex-1 max-w-xl relative">
        <div className={`rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-600 ${tall ? "min-h-[88px] whitespace-pre-wrap" : "min-h-10 flex items-center whitespace-pre-wrap"}`}>
          {empty ? <span className="text-slate-400">—</span> : value}
        </div>
        {select && <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-3.5 pointer-events-none" />}
      </div>
    </div>
  )
}
function fmtDT(s: string): string {
  if (!s) return ""
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) return s
  const d = new Date(s); if (isNaN(d.getTime())) return s
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
// YYYY-MM-DD → DD/MM/YYYY (matches the reference Due Date format)
function fmtDate(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "")
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (s || "")
}
function HRow({ header, value, valueEl, last }: { header: string; value?: string; valueEl?: React.ReactNode; last?: boolean }) {
  return (
    <>
      <div className="bg-slate-100 px-4 py-2.5 font-bold text-sm text-slate-700">{header}</div>
      <div className={`px-4 py-2.5 text-sm text-slate-600 ${last ? "" : "border-b border-slate-200"}`}>{valueEl ?? (value || "—")}</div>
    </>
  )
}

export default function UtilityExpensePage() {
  const ut = useUtilityExpenses()
  const fs = useFinanceSettings()
  const [screen, setScreen] = useState<"list" | "request" | "view">("list")
  const [viewing, setViewing] = useState<UtilityExpense | null>(null)
  const [toast, setToast] = useState("")
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500) }

  async function approve(r: UtilityExpense, remarks: string) {
    const acct = fs.accounts.find(a => /utility/i.test(a.name))
    const bank = acct ? fs.bankName(acct.bank_id) : ""
    const input: NewTxnInput = {
      posted_date: r.date.slice(0, 10), transaction: r.purpose || r.description || `Utility ${r.control_no}`,
      account: acct?.name || "!Utility Expense", department: "", category: "Utility Expense",
      type_of_expense: r.type_of_expense || "Utilities", expense_type: "Debit" as ExpenseType, amount: r.total_amount, bank,
      voucher: r.control_no, receipt_name: r.bills_name, debit: r.total_amount, credit: 0,
    }
    const txn = await pushBookkeepingTxn(input)
    await ut.approve(r.id, remarks, txn.id)
    flash("Approved and recorded to Book Keeping.")
    setScreen("list")
  }
  async function decline(r: UtilityExpense, remarks: string) { await ut.decline(r.id, remarks); flash("Request declined."); setScreen("list") }

  if (screen === "request") return <RequestScreen fs={fs} nextControlNo={peekNextUtilControlNo(ut.items)} onBack={() => setScreen("list")} onSave={async (input) => { await ut.addRequest(input); flash("Utility expense request submitted."); setScreen("list") }} />
  if (screen === "view" && viewing) {
    const current = ut.items.find(r => r.id === viewing.id) || viewing
    return <ViewScreen req={current} onBack={() => setScreen("list")} onApprove={approve} onDecline={decline} />
  }
  return <ListScreen ut={ut} fs={fs} toast={toast} onRequest={() => setScreen("request")} onView={(r) => { setViewing(r); setScreen("view") }} />
}

// ── List ──────────────────────────────────────────────────────────────────────
function ListScreen({ ut, fs, toast, onRequest, onView }: {
  ut: ReturnType<typeof useUtilityExpenses>; fs: ReturnType<typeof useFinanceSettings>
  toast: string; onRequest: () => void; onView: (r: UtilityExpense) => void
}) {
  const [perPage, setPerPage] = useState(10)
  const [page, setPage] = useState(1)
  const empty = { dateFrom: "", dateTo: "", form: "All", control: "", payee: "", requestedBy: "", type: "All", status: "All", qty: "", unit: "", total: "", dueFrom: "", dueTo: "" }
  const [draft, setDraft] = useState({ ...empty })
  const [applied, setApplied] = useState({ ...empty })
  const setD = (k: keyof typeof empty, v: string) => setDraft(p => ({ ...p, [k]: v }))

  const filtered = useMemo(() => ut.items.filter(r => {
    const a = applied, d = r.date.slice(0, 10)
    if (a.dateFrom && d < a.dateFrom) return false
    if (a.dateTo && d > a.dateTo) return false
    if (a.form !== "All" && r.request_form !== a.form) return false
    if (a.control && !r.control_no.toLowerCase().includes(a.control.toLowerCase())) return false
    if (a.payee && !r.payee_supplier.toLowerCase().includes(a.payee.toLowerCase())) return false
    if (a.requestedBy && !r.requested_by.toLowerCase().includes(a.requestedBy.toLowerCase())) return false
    if (a.type !== "All" && r.type_of_request !== a.type) return false
    if (a.status !== "All" && r.status !== a.status.toLowerCase()) return false
    if (a.qty && !String(r.quantity).includes(a.qty)) return false
    if (a.unit && !String(r.unit_price).includes(a.unit)) return false
    if (a.total && !String(r.total_amount).includes(a.total.replace(/,/g, ""))) return false
    if (a.dueFrom && (!r.due_date || r.due_date.slice(0, 10) < a.dueFrom)) return false
    if (a.dueTo && (!r.due_date || r.due_date.slice(0, 10) > a.dueTo)) return false
    return true
  }).sort((x, y) => y.date.localeCompare(x.date)), [ut.items, applied])

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage))
  const curPage = Math.min(page, totalPages)
  const rows = filtered.slice((curPage - 1) * perPage, curPage * perPage)
  const grandTotal = filtered.reduce((s, r) => s + r.total_amount, 0)

  return (
    <div className="space-y-3">
      <span className="text-sm text-slate-500 font-medium">Finance / Utility Expense</span>
      {toast && <div className="fixed top-5 right-5 z-50 bg-emerald-500 text-white rounded-xl shadow-2xl px-4 py-3 text-sm">{toast}</div>}

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-start justify-between flex-wrap gap-3 mb-4 pb-4 border-b border-slate-100">
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Droplet className="w-5 h-5" /> UTILITY EXPENSE</h1>
          <Button onClick={onRequest}><FileText className="w-4 h-4" /> Request Utility Expense</Button>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <select value={perPage} onChange={e => { setPerPage(parseInt(e.target.value)); setPage(1) }} className="h-9 rounded-lg border border-slate-300 px-2 text-sm bg-white">
            {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="text-sm text-slate-500">records</span>
        </div>

        <div className="overflow-auto border border-slate-200 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                {["No", "Date", "Request Form", "Control No.", "Payee/Supplier", "Requested By", "Type of Request", "Status", "Quantity", "Unit Price", "Total Amount", "Due Date", "Action"].map(c =>
                  <th key={c} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{c}</th>)}
              </tr>
              <tr className="border-b border-slate-200 bg-white align-top">
                <th className="px-2 py-2"></th>
                <th className="px-2 py-2">
                  <div className="min-w-[124px]">
                    <DateRangePicker a={applied.dateFrom} b={applied.dateTo}
                      onApply={(a, b) => { setDraft(p => ({ ...p, dateFrom: a, dateTo: b })); setApplied(p => ({ ...p, dateFrom: a, dateTo: b })); setPage(1) }} />
                  </div>
                </th>
                <th className="px-2 py-2">
                  <select value={draft.form} onChange={e => setD("form", e.target.value)} className={FSEL}>
                    <option>All</option>{REQUEST_FORMS.map(f => <option key={f}>{f}</option>)}
                  </select>
                </th>
                <th className="px-2 py-2"><input value={draft.control} onChange={e => setD("control", e.target.value)} className={`${FSEL} min-w-[120px]`} /></th>
                <th className="px-2 py-2"><input value={draft.payee} onChange={e => setD("payee", e.target.value)} className={`${FSEL} min-w-[110px]`} /></th>
                <th className="px-2 py-2"><input value={draft.requestedBy} onChange={e => setD("requestedBy", e.target.value)} className={`${FSEL} min-w-[110px]`} /></th>
                <th className="px-2 py-2">
                  <select value={draft.type} onChange={e => setD("type", e.target.value)} className={`${FSEL} min-w-[110px]`}>
                    <option>All</option>{TYPE_OF_REQUEST_OPTIONS.map(t => <option key={t}>{t}</option>)}
                  </select>
                </th>
                <th className="px-2 py-2">
                  <select value={draft.status} onChange={e => setD("status", e.target.value)} className={FSEL}>
                    <option>All</option><option>Pending</option><option>Approved</option><option>Declined</option>
                  </select>
                </th>
                <th className="px-2 py-2"><input value={draft.qty} onChange={e => setD("qty", e.target.value)} className={`${FSEL} min-w-[70px]`} /></th>
                <th className="px-2 py-2"><input value={draft.unit} onChange={e => setD("unit", e.target.value)} className={`${FSEL} min-w-[70px]`} /></th>
                <th className="px-2 py-2"><input value={draft.total} onChange={e => setD("total", e.target.value)} className={`${FSEL} min-w-[80px]`} /></th>
                <th className="px-2 py-2">
                  <div className="min-w-[124px]">
                    <DateRangePicker a={applied.dueFrom} b={applied.dueTo}
                      onApply={(a, b) => { setDraft(p => ({ ...p, dueFrom: a, dueTo: b })); setApplied(p => ({ ...p, dueFrom: a, dueTo: b })); setPage(1) }} />
                  </div>
                </th>
                <th className="px-2 py-2">
                  <div className="flex gap-1">
                    <Button size="sm" onClick={() => { setApplied({ ...draft }); setPage(1) }}><Search className="w-3.5 h-3.5" /> Search</Button>
                    {JSON.stringify(applied) !== JSON.stringify(empty) && <Button size="sm" variant="outline" onClick={() => { setDraft({ ...empty }); setApplied({ ...empty }) }}>Clear</Button>}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!ut.loaded ? <tr><td colSpan={13} className="text-center py-12 text-slate-400">Loading…</td></tr>
                : rows.length === 0 ? <tr><td colSpan={13} className="text-center py-12 text-slate-400">No requests found</td></tr>
                  : rows.map(r => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 text-slate-400">{filtered.indexOf(r) + 1}</td>
                      <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{r.date}</td>
                      <td className="px-3 py-2.5 text-slate-800 font-bold whitespace-nowrap">{r.request_form}</td>
                      <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{r.control_no}</td>
                      <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{r.payee_supplier}</td>
                      <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{r.requested_by}</td>
                      <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{r.type_of_request}</td>
                      <td className={`px-3 py-2.5 whitespace-nowrap ${STATUS_TEXT[r.status]}`}>{STATUS_LABEL[r.status]}</td>
                      <td className="px-3 py-2.5 text-slate-700">{fmtNum(r.quantity)}</td>
                      <td className="px-3 py-2.5 text-slate-700">{fmtNum(r.unit_price)}</td>
                      <td className="px-3 py-2.5 text-slate-700 font-medium">{fmtNum(r.total_amount)}</td>
                      <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{r.due_date}</td>
                      <td className="px-3 py-2.5">
                        <button onClick={() => onView(r)} title="View" className="w-8 h-8 flex items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-100"><Search className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-3 text-sm text-slate-500">
          <span>Showing {filtered.length === 0 ? 0 : (curPage - 1) * perPage + 1} to {Math.min(curPage * perPage, filtered.length)} of {filtered.length} entries</span>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={curPage === 1} onClick={() => setPage(curPage - 1)}>Prev</Button>
              <span>Page {curPage} of {totalPages}</span>
              <Button size="sm" variant="outline" disabled={curPage === totalPages} onClick={() => setPage(curPage + 1)}>Next</Button>
            </div>
          )}
        </div>
        <p className="mt-2 text-sm font-bold text-slate-800">Total Amount : {fmtMoney(grandTotal)}</p>
      </div>
    </div>
  )
}

// ── Request Utility Expense ───────────────────────────────────────────────────
function RequestScreen({ fs, nextControlNo, onBack, onSave }: {
  fs: ReturnType<typeof useFinanceSettings>; nextControlNo: string; onBack: () => void; onSave: (input: NewUtilInput) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [stamp] = useState(() => utilNowStamp())
  const [f, setF] = useState<NewUtilInput>({
    due_date: new Date().toISOString().slice(0, 10), request_form: "", payee_supplier: "", requested_by: "", purpose: "",
    description: "", type_of_expense: "", type_of_request: "", retail: 0, business_dev: 0,
    quantity: 0, unit_price: 0, mode_of_payment: "", bills_name: "",
  })
  const showTR = fs.general.hide_type_request  // General toggle enables Type of Request + shares
  const [descInput, setDescInput] = useState("")
  const [descList, setDescList] = useState<string[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const set = (k: keyof NewUtilInput, v: any) => { setF(p => ({ ...p, [k]: v })); setErrors([]) }
  const total = (Number(f.quantity) || 0) * (Number(f.unit_price) || 0)
  function addDesc() { const v = descInput.trim(); if (v) { setDescList(l => [...l, v]); setDescInput(""); setErrors([]) } }
  const allDesc = [...descList, descInput.trim()].filter(Boolean)

  function submit() {
    const m: string[] = []
    if (!f.due_date) m.push("Due Date")
    if (!f.request_form) m.push("Request Form")
    if (!f.payee_supplier.trim()) m.push("Payee/Supplier")
    if (!f.requested_by.trim()) m.push("Requested by")
    if (!f.purpose.trim()) m.push("Purpose")
    if (allDesc.length === 0) m.push("Description")
    if (!f.type_of_expense) m.push("Type of Expense")
    if (showTR && !f.type_of_request) m.push("Type of Request")
    if (!(Number(f.quantity) > 0)) m.push("Quantity")
    if (!(Number(f.unit_price) > 0)) m.push("Unit Price")
    if (!f.mode_of_payment) m.push("Mode of Payment")
    if (!f.bills_name) m.push("Upload Bills")
    if (m.length) { setErrors(m); return }
    onSave({ ...f, description: allDesc.join("\n"), quantity: Number(f.quantity), unit_price: Number(f.unit_price), date: stamp, control_no: nextControlNo })
  }

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"><ChevronLeft className="w-4 h-4" /> Back to Utility Expense</button>
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 mb-1"><Settings className="w-5 h-5" /> REQUEST UTILITY EXPENSE</h1>
        <hr className="border-slate-200 mb-4" />
        {errors.length > 0 && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 max-w-2xl">
            <p className="font-medium mb-1">Please fill in required fields:</p>
            <ul className="list-disc pl-4 space-y-0.5">{errors.map(e => <li key={e}>{e}</li>)}</ul>
          </div>
        )}
        <div className="max-w-3xl">
          <FormRow label="Date" required><Input value={stamp} readOnly className={`max-w-sm ${RO}`} /></FormRow>
          <FormRow label="Due Date" required><Input type="date" value={f.due_date} onChange={e => set("due_date", e.target.value)} className="max-w-[220px]" /></FormRow>
          <FormRow label="Request Form" required>
            <select className={`${SEL} max-w-[220px]`} value={f.request_form} onChange={e => set("request_form", e.target.value)}>
              <option value="">-- SELECT FORM --</option>{REQUEST_FORMS.map(o => <option key={o}>{o}</option>)}
            </select>
          </FormRow>
          <FormRow label="Control No" required><Input value={nextControlNo} readOnly className={`max-w-sm ${RO}`} /></FormRow>
          <FormRow label="Payee/Supplier" required><Input value={f.payee_supplier} onChange={e => set("payee_supplier", e.target.value)} /></FormRow>
          <FormRow label="Requested by" required><Input value={f.requested_by} onChange={e => set("requested_by", e.target.value)} /></FormRow>
          <FormRow label="Purpose" required>
            <textarea rows={4} value={f.purpose} onChange={e => set("purpose", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-400 resize-none" />
          </FormRow>
          <FormRow label="Description" required>
            <div className="flex items-center gap-2">
              <input className={SEL} value={descInput} placeholder="Add an item and press +"
                onChange={e => { setDescInput(e.target.value); setErrors([]) }}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addDesc() } }} />
              <button type="button" onClick={addDesc} className="w-9 h-9 rounded-full bg-slate-900 text-white flex items-center justify-center hover:bg-slate-700 flex-shrink-0 transition-colors"><Plus className="w-4 h-4" /></button>
            </div>
            {descList.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {descList.map((p, i) => (
                  <span key={i} className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 text-xs rounded-full pl-2.5 pr-1 py-1">
                    {p}<button type="button" onClick={() => setDescList(l => l.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
                  </span>
                ))}
              </div>
            )}
          </FormRow>
          <FormRow label="Type of Expense" required>
            <select className={SEL} value={f.type_of_expense} onChange={e => set("type_of_expense", e.target.value)}>
              <option value="">-- SELECT TYPE --</option>{fs.activeTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
          </FormRow>
          {showTR && (
            <>
              <FormRow label="Type of Request" required>
                <select className={SEL} value={f.type_of_request || ""} onChange={e => set("type_of_request", e.target.value)}>
                  <option value="">-- SELECT TYPE OF REQUEST --</option>{TYPE_OF_REQUEST_OPTIONS.map(o => <option key={o}>{o}</option>)}
                </select>
              </FormRow>
              <FormRow label="Retail" required><Input type="number" min={0} value={f.retail || ""} onChange={e => set("retail", parseFloat(e.target.value) || 0)} className="max-w-[200px]" /></FormRow>
              <FormRow label="Business Dev." required><Input type="number" min={0} value={f.business_dev || ""} onChange={e => set("business_dev", parseFloat(e.target.value) || 0)} className="max-w-[200px]" /></FormRow>
            </>
          )}
          <FormRow label="Quantity" required><Input type="number" min={0} value={f.quantity || ""} onChange={e => set("quantity", parseFloat(e.target.value) || 0)} className="max-w-[200px]" /></FormRow>
          <FormRow label="Unit Price" required><Input type="number" min={0} step="0.01" value={f.unit_price || ""} placeholder="0.00" onChange={e => set("unit_price", parseFloat(e.target.value) || 0)} className="max-w-[200px]" /></FormRow>
          <FormRow label="Mode of Payment" required>
            <select className={`${SEL} max-w-[280px]`} value={f.mode_of_payment} onChange={e => set("mode_of_payment", e.target.value)}>
              <option value="">-- SELECT MODE OF PAYMENT --</option>{UTIL_MOPS.map(m => <option key={m}>{m}</option>)}
            </select>
          </FormRow>
          <FormRow label="Total Amount" required><Input value={fmtNum(total)} readOnly className={`max-w-[200px] font-semibold ${RO}`} /></FormRow>
          <FormRow label="Upload Bills" required>
            <div className="flex max-w-md">
              <div className="flex items-center h-10 flex-1 min-w-0 border border-r-0 border-slate-300 rounded-l-md px-3 gap-2 text-sm bg-white">
                <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
                {f.bills_name ? <span className="text-slate-700 truncate">{f.bills_name}</span> : <span className="text-slate-400">No file selected</span>}
              </div>
              <button type="button" onClick={() => fileRef.current?.click()} className="h-10 px-4 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-r-md text-sm text-slate-600 transition-colors flex-shrink-0">Select file</button>
              <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={e => { set("bills_name", e.target.files?.[0]?.name || ""); e.target.value = "" }} />
            </div>
          </FormRow>
        </div>
        <hr className="border-slate-200 my-5" />
        <div className="flex items-center gap-3">
          <Button onClick={submit}>Request</Button>
          <Button variant="outline" onClick={onBack}>Back</Button>
        </div>
      </div>
    </div>
  )
}

// ── View / Approve / Export ───────────────────────────────────────────────────
function ViewScreen({ req, onBack, onApprove, onDecline }: {
  req: UtilityExpense; onBack: () => void
  onApprove: (r: UtilityExpense, remarks: string) => void; onDecline: (r: UtilityExpense, remarks: string) => void
}) {
  const [mode, setMode] = useState<"" | "approve" | "decline">("")
  const [text, setText] = useState("")

  function exportXlsx() {
    const rows: any[][] = [
      ["UTILITY EXPENSE REQUEST FORM"], [],
      ["Control No.", req.control_no], ["Date", req.date], ["Due Date", req.due_date], ["Status", STATUS_LABEL[req.status]], [],
      ["Request Form", req.request_form], ["Payee/Supplier", req.payee_supplier], ["Requested by", req.requested_by],
      ["Purpose", req.purpose], ["Description", req.description], ["Type of Expense", req.type_of_expense],
      ["Type of Request", req.type_of_request || "—"], ["Retail", req.retail], ["Business Dev.", req.business_dev],
      ["Quantity", req.quantity], ["Unit Price", req.unit_price], ["Total Amount", req.total_amount],
      ["Mode of Payment", req.mode_of_payment], ["Bills", req.bills_name || "—"], [],
      ["Added By", req.added_by], ["Added Date", fmtDT(req.added_date)],
      ["Approved By", req.approved_by || "—"], ["Approved Date", req.approved_date || "—"], ["Remarks", req.remarks || "—"],
    ]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    if ((ws as any)["A1"]) (ws as any)["A1"].s = { font: { bold: true, sz: 14, color: { rgb: "1F3864" } } }
    rows.forEach((r, i) => { if (r.length === 2) { const ref = XLSX.utils.encode_cell({ r: i, c: 0 }); if ((ws as any)[ref]) (ws as any)[ref].s = { font: { bold: true } } } })
    ;(ws as any)["!cols"] = [{ wch: 20 }, { wch: 42 }]
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Utility Expense")
    XLSX.writeFile(wb, `utility-${req.control_no}.xlsx`)
  }

  const banner = req.status === "approved" ? { cls: "bg-teal-100 border-teal-400 text-teal-900", text: "Request Approved!" }
    : req.status === "declined" ? { cls: "bg-red-50 border-red-400 text-red-700", text: "Request Declined" }
      : { cls: "bg-amber-50 border-amber-400 text-amber-800", text: "Pending Approval" }

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"><ChevronLeft className="w-4 h-4" /> Back to Utility Expense</button>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Settings className="w-5 h-5" /> UTILITY EXPENSE REQUEST</h1>
            <Button onClick={exportXlsx} className="bg-teal-500 hover:bg-teal-600 text-white"><Download className="w-4 h-4" /> Export</Button>
          </div>
          <hr className="border-slate-200 mb-4" />
          <div className={`mb-5 rounded-lg border-l-4 px-4 py-3 text-base font-semibold ${banner.cls}`}>{banner.text}</div>

          <div className="max-w-3xl">
            <VField label="Date" required value={req.date} />
            <VField label="Due Date" required value={fmtDate(req.due_date)} />
            <VField label="Request Form" required select value={req.request_form} />
            <VField label="Control No" required value={req.control_no} />
            <VField label="Payee/Supplier" required value={req.payee_supplier} />
            <VField label="Requested By" required value={req.requested_by} />
            <VField label="Purpose" required tall value={req.purpose} />
            <VField label="Description" required value={req.description} />
            <VField label="Type of Expense" required select value={req.type_of_expense} />
            <VField label="Type of Request" required select value={req.type_of_request || "-- SELECT TYPE OF REQUEST --"} />
            <VField label="Retail" required value={fmtNum(req.retail)} />
            <VField label="Business Dev." required value={fmtNum(req.business_dev)} />
            <VField label="Quantity" required value={fmtNum(req.quantity)} />
            <VField label="Unit Price" required value={fmtNum(req.unit_price)} />
            <VField label="Mode of Payment" required select value={req.mode_of_payment} />
            <VField label="Total Amount" required value={fmtNum(req.total_amount)} />
            <VField label="Bills" required value={req.bills_name
              ? <span className="inline-flex items-center gap-2"><FileText className="w-4 h-4 text-slate-400" />{req.bills_name}</span>
              : <span className="text-slate-400">No Bills Uploaded</span>} />
          </div>

          {mode && (
            <div className="mt-4 p-3 border border-slate-200 rounded-lg bg-slate-50 max-w-2xl">
              <p className="text-sm font-medium text-slate-700 mb-2">{mode === "approve" ? "Approve — remarks (optional)" : "Decline — reason"}</p>
              <textarea rows={3} value={text} onChange={e => setText(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-400 resize-none" placeholder="Remarks…" />
              <div className="flex gap-2 mt-2">
                <Button size="sm" disabled={mode === "decline" && !text.trim()} onClick={() => { if (mode === "approve") onApprove(req, text.trim()); else onDecline(req, text.trim()) }}>Confirm</Button>
                <Button size="sm" variant="outline" onClick={() => { setMode(""); setText("") }}>Cancel</Button>
              </div>
            </div>
          )}

          {!mode && (
            <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-200">
              {req.status === "pending" && (
                <>
                  <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setMode("approve")}>Approve</Button>
                  <Button className="bg-red-500 hover:bg-red-600 text-white" onClick={() => setMode("decline")}>Decline</Button>
                </>
              )}
              <Button variant="outline" onClick={onBack}>Back</Button>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="text-lg font-bold text-blue-600 flex items-center gap-2 mb-1"><Settings className="w-5 h-5" /> HISTORY</h2>
          <hr className="border-slate-200 mb-4" />
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <HRow header="Added By" value={req.added_by} />
            <HRow header="Added Date" value={fmtDT(req.added_date)} />
            {req.status === "approved" && <>
              <HRow header="Approved By" value={req.approved_by} />
              <HRow header="Approved Date" value={req.approved_date} />
            </>}
            <HRow header="Remarks" value={req.remarks} />
            <HRow header="Status" valueEl={<span className={STATUS_TEXT[req.status]}>{STATUS_LABEL[req.status]}</span>} last />
          </div>
          {req.recorded_txn_id && <p className="mt-3 text-xs text-emerald-600">✓ Recorded to Book Keeping</p>}
        </div>
      </div>
    </div>
  )
}
