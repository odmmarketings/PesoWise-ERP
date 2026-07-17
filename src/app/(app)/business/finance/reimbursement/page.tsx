"use client"
import { useState, useMemo, useRef } from "react"
import * as XLSX from "xlsx-js-style"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Search, ChevronLeft, ChevronDown, FileText, Download, Banknote, Plus, X, Settings } from "lucide-react"
import { useReimbursements, REIMB_MOPS, SHARED_EXPENSE_OPTIONS, peekNextControlNo, nowStampPublic, type Reimbursement, type NewReimbInput, type ReimbStatus } from "@/lib/reimbursement-store"
import { useFinanceSettings, type ExpenseType } from "@/lib/finance-settings-store"
import { pushBookkeepingTxn, type NewTxnInput } from "@/lib/bookkeeping-store"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"

const SEL = "w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white focus:outline-none focus:border-blue-400"
const FSEL = "h-8 w-full rounded border border-slate-300 px-1.5 text-xs bg-white focus:outline-none focus:border-blue-400"

const fmtNum = (n: number) => Number(n || 0).toLocaleString("en-PH")
const STATUS_TEXT: Record<ReimbStatus, string> = { pending: "text-slate-900 font-bold", approved: "text-blue-600 font-semibold", declined: "text-red-600 font-semibold" }
const STATUS_LABEL: Record<ReimbStatus, string> = { pending: "Pending", approved: "Approved", declined: "Declined" }

function FormRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-2 border-b border-slate-100 last:border-0">
      <label className="w-40 flex-shrink-0 text-sm text-slate-600 pt-2.5 leading-tight">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <div className="flex-1">{children}</div>
    </div>
  )
}

export default function ReimbursementPage() {
  const rb = useReimbursements()
  const fs = useFinanceSettings()
  const [screen, setScreen] = useState<"list" | "request" | "view">("list")
  const [viewing, setViewing] = useState<Reimbursement | null>(null)
  const [toast, setToast] = useState("")
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500) }

  function openView(r: Reimbursement) { setViewing(r); setScreen("view") }

  // Approve → create the Book Keeping entry, then mark approved with the link.
  async function approve(r: Reimbursement, remarks: string) {
    const reimbAcct = fs.accounts.find(a => /reimburs/i.test(a.name))
    const bank = reimbAcct ? fs.bankName(reimbAcct.bank_id) : ""
    const input: NewTxnInput = {
      posted_date: r.date.slice(0, 10), transaction: r.purpose || r.particulars || `Reimbursement ${r.control_no}`,
      account: reimbAcct?.name || "!Reimbursement", department: r.department, category: "Reimbursement",
      type_of_expense: r.type_of_expense, expense_type: "Debit" as ExpenseType, amount: r.total_payment, bank,
      voucher: r.control_no, receipt_name: r.receipt_name, debit: r.total_payment, credit: 0,
    }
    const txn = await pushBookkeepingTxn(input)
    await rb.approve(r.id, remarks, txn.id)
    flash("Approved and recorded to Book Keeping.")
    setScreen("list")
  }
  async function decline(r: Reimbursement, remarks: string) { await rb.decline(r.id, remarks); flash("Request declined."); setScreen("list") }

  if (screen === "request") return <RequestScreen fs={fs} nextControlNo={peekNextControlNo(rb.items)} onBack={() => setScreen("list")} onSave={async (input) => { await rb.addRequest(input); flash("Reimbursement request submitted."); setScreen("list") }} />
  if (screen === "view" && viewing) {
    const current = rb.items.find(r => r.id === viewing.id) || viewing
    return <ViewScreen req={current} onBack={() => setScreen("list")} onApprove={approve} onDecline={decline} />
  }

  return <ListScreen rb={rb} fs={fs} toast={toast} onRequest={() => setScreen("request")} onView={openView} />
}

// ── List ──────────────────────────────────────────────────────────────────────
function ListScreen({ rb, fs, toast, onRequest, onView }: {
  rb: ReturnType<typeof useReimbursements>; fs: ReturnType<typeof useFinanceSettings>
  toast: string; onRequest: () => void; onView: (r: Reimbursement) => void
}) {
  const [perPage, setPerPage] = useState(10)
  const [page, setPage] = useState(1)
  const empty = { dateFrom: "", dateTo: "", control: "", payee: "", department: "All", name: "", type: "All", status: "All", qty: "", unit: "", amount: "" }
  const [draft, setDraft] = useState({ ...empty })
  const [applied, setApplied] = useState({ ...empty })
  const setD = (k: keyof typeof empty, v: string) => setDraft(p => ({ ...p, [k]: v }))

  const filtered = useMemo(() => rb.items.filter(r => {
    const a = applied, d = r.date.slice(0, 10)
    if (a.dateFrom && d < a.dateFrom) return false
    if (a.dateTo && d > a.dateTo) return false
    if (a.control && !r.control_no.toLowerCase().includes(a.control.toLowerCase())) return false
    if (a.payee && !r.payee_supplier.toLowerCase().includes(a.payee.toLowerCase())) return false
    if (a.department !== "All" && r.department !== a.department) return false
    if (a.name && !r.name.toLowerCase().includes(a.name.toLowerCase())) return false
    if (a.type !== "All" && r.type_of_expense !== a.type) return false
    if (a.status !== "All" && r.status !== a.status.toLowerCase()) return false
    if (a.qty && !String(r.quantity).includes(a.qty)) return false
    if (a.unit && !String(r.unit_price).includes(a.unit)) return false
    if (a.amount && !String(r.total_payment).includes(a.amount.replace(/,/g, ""))) return false
    return true
  }).sort((x, y) => y.date.localeCompare(x.date)), [rb.items, applied])

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage))
  const curPage = Math.min(page, totalPages)
  const rows = filtered.slice((curPage - 1) * perPage, curPage * perPage)

  return (
    <div className="space-y-3">
      <span className="text-sm text-slate-500 font-medium">Finance / Reimbursement</span>
      {toast && <div className="fixed top-5 right-5 z-50 bg-emerald-500 text-white rounded-xl shadow-2xl px-4 py-3 text-sm">{toast}</div>}

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-start justify-between flex-wrap gap-3 mb-4 pb-4 border-b border-slate-100">
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Banknote className="w-5 h-5" /> REIMBURSEMENT</h1>
          <Button onClick={onRequest}><FileText className="w-4 h-4" /> Request Reimbursement</Button>
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
                {["No", "Date", "Control No.", "Payee/Supplier", "Department", "Name", "Type of Expense", "Status", "Quantity", "Unit Price", "Amount", "Action"].map(c =>
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
                <th className="px-2 py-2"><input value={draft.control} onChange={e => setD("control", e.target.value)} className={FSEL} /></th>
                <th className="px-2 py-2"><input value={draft.payee} onChange={e => setD("payee", e.target.value)} className={`${FSEL} min-w-[120px]`} /></th>
                <th className="px-2 py-2">
                  <select value={draft.department} onChange={e => setD("department", e.target.value)} className={`${FSEL} min-w-[110px]`}>
                    <option>All</option>{fs.activeDepartments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                  </select>
                </th>
                <th className="px-2 py-2"><input value={draft.name} onChange={e => setD("name", e.target.value)} className={FSEL} /></th>
                <th className="px-2 py-2">
                  <select value={draft.type} onChange={e => setD("type", e.target.value)} className={`${FSEL} min-w-[110px]`}>
                    <option>All</option>{fs.activeTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                  </select>
                </th>
                <th className="px-2 py-2">
                  <select value={draft.status} onChange={e => setD("status", e.target.value)} className={FSEL}>
                    <option>All</option><option>Pending</option><option>Approved</option><option>Declined</option>
                  </select>
                </th>
                <th className="px-2 py-2"><input value={draft.qty} onChange={e => setD("qty", e.target.value)} className={`${FSEL} min-w-[70px]`} /></th>
                <th className="px-2 py-2"><input value={draft.unit} onChange={e => setD("unit", e.target.value)} className={`${FSEL} min-w-[70px]`} /></th>
                <th className="px-2 py-2"><input value={draft.amount} onChange={e => setD("amount", e.target.value)} className={`${FSEL} min-w-[80px]`} /></th>
                <th className="px-2 py-2">
                  <div className="flex gap-1">
                    <Button size="sm" onClick={() => { setApplied({ ...draft }); setPage(1) }}><Search className="w-3.5 h-3.5" /> Search</Button>
                    {JSON.stringify(applied) !== JSON.stringify(empty) && <Button size="sm" variant="outline" onClick={() => { setDraft({ ...empty }); setApplied({ ...empty }) }}>Clear</Button>}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!rb.loaded ? <tr><td colSpan={12} className="text-center py-12 text-slate-400">Loading…</td></tr>
                : rows.length === 0 ? <tr><td colSpan={12} className="text-center py-12 text-slate-400">No requests found</td></tr>
                  : rows.map(r => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 text-slate-400">{filtered.indexOf(r) + 1}</td>
                      <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{r.date}</td>
                      <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{r.control_no}</td>
                      <td className="px-3 py-2.5 text-slate-700 max-w-[160px]">{r.payee_supplier}</td>
                      <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{r.department}</td>
                      <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{r.name}</td>
                      <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{r.type_of_expense}</td>
                      <td className={`px-3 py-2.5 whitespace-nowrap ${STATUS_TEXT[r.status]}`}>{STATUS_LABEL[r.status]}</td>
                      <td className="px-3 py-2.5 text-slate-700">{fmtNum(r.quantity)}</td>
                      <td className="px-3 py-2.5 text-slate-700">{fmtNum(r.unit_price)}</td>
                      <td className="px-3 py-2.5 text-slate-700 font-medium">{fmtNum(r.total_payment)}</td>
                      <td className="px-3 py-2.5">
                        <button onClick={() => onView(r)} title="View" className="w-8 h-8 flex items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-100"><Search className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-800">
                  <td className="px-3 py-2.5 whitespace-nowrap" colSpan={8}>TOTAL ({filtered.length})</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{fmtNum(filtered.reduce((s, r) => s + r.quantity, 0))}</td>
                  <td className="px-3 py-2.5"></td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{fmtNum(filtered.reduce((s, r) => s + r.total_payment, 0))}</td>
                  <td className="px-3 py-2.5"></td>
                </tr>
              </tfoot>
            )}
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
      </div>
    </div>
  )
}

// ── Request Reimbursement ─────────────────────────────────────────────────────
function RequestScreen({ fs, nextControlNo, onBack, onSave }: {
  fs: ReturnType<typeof useFinanceSettings>; nextControlNo: string; onBack: () => void; onSave: (input: NewReimbInput) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  // Date + Control No are generated once when the form opens (read-only) and saved verbatim.
  const [stamp] = useState(() => nowStampPublic())
  const [f, setF] = useState<NewReimbInput>({
    payee_supplier: "", department: "", name: "", purpose: "", particulars: "", type_of_expense: "",
    shared_expense: "", retail_share: 0, business_dev_share: 0,
    quantity: 0, unit_price: 0, mode_of_payment: "", receipt_name: "",
  })
  const showShared = fs.general.hide_shared_expense  // General toggle enables the shared-expense split
  // Particular supports multiple entries via the "+" button.
  const [partInput, setPartInput] = useState("")
  const [partList, setPartList] = useState<string[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const set = (k: keyof NewReimbInput, v: any) => { setF(p => ({ ...p, [k]: v })); setErrors([]) }
  const total = (Number(f.quantity) || 0) * (Number(f.unit_price) || 0)

  function addParticular() { const v = partInput.trim(); if (v) { setPartList(l => [...l, v]); setPartInput(""); setErrors([]) } }
  const allParticulars = [...partList, partInput.trim()].filter(Boolean)

  function submit() {
    const m: string[] = []
    if (!f.payee_supplier.trim()) m.push("Payee/Supplier")
    if (!f.department) m.push("Department")
    if (!f.name.trim()) m.push("Name")
    if (!f.purpose.trim()) m.push("Purpose")
    if (allParticulars.length === 0) m.push("Particular")
    if (!f.type_of_expense) m.push("Type of Expense")
    if (showShared && !f.shared_expense) m.push("Shared Expense")
    if (!(Number(f.quantity) > 0)) m.push("Quantity")
    if (!(Number(f.unit_price) > 0)) m.push("Unit Price")
    if (!f.mode_of_payment) m.push("Mode of Payment")
    if (!f.receipt_name) m.push("Upload Receipt")
    if (m.length) { setErrors(m); return }
    onSave({ ...f, particulars: allParticulars.join("\n"), quantity: Number(f.quantity), unit_price: Number(f.unit_price), date: stamp, control_no: nextControlNo })
  }

  const RO = "bg-slate-100 text-slate-600 cursor-default"
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"><ChevronLeft className="w-4 h-4" /> Back to Reimbursement</button>
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 mb-1"><Settings className="w-5 h-5" /> REQUEST REIMBURSEMENT</h1>
        <hr className="border-slate-200 mb-4" />
        {errors.length > 0 && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 max-w-2xl">
            <p className="font-medium mb-1">Please fill in required fields:</p>
            <ul className="list-disc pl-4 space-y-0.5">{errors.map(e => <li key={e}>{e}</li>)}</ul>
          </div>
        )}
        <div className="max-w-3xl">
          <FormRow label="Date" required><Input value={stamp} readOnly className={`max-w-sm ${RO}`} /></FormRow>
          <FormRow label="Control No" required><Input value={nextControlNo} readOnly className={`max-w-sm ${RO}`} /></FormRow>
          <FormRow label="Payee/Supplier" required><Input value={f.payee_supplier} onChange={e => set("payee_supplier", e.target.value)} /></FormRow>
          <FormRow label="Department" required>
            <select className={SEL} value={f.department} onChange={e => set("department", e.target.value)}>
              <option value="">-- SELECT DEPARTMENT --</option>{fs.activeDepartments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
          </FormRow>
          <FormRow label="Name" required><Input value={f.name} placeholder="Requesting person" onChange={e => set("name", e.target.value)} /></FormRow>
          <FormRow label="Purpose" required>
            <textarea rows={4} value={f.purpose} onChange={e => set("purpose", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-400 resize-none" />
          </FormRow>
          <FormRow label="Particular" required>
            <div className="flex items-center gap-2">
              <input className={SEL} value={partInput} placeholder="Add a particular and press +"
                onChange={e => { setPartInput(e.target.value); setErrors([]) }}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addParticular() } }} />
              <button type="button" onClick={addParticular} className="w-9 h-9 rounded-full bg-slate-900 text-white flex items-center justify-center hover:bg-slate-700 flex-shrink-0 transition-colors"><Plus className="w-4 h-4" /></button>
            </div>
            {partList.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {partList.map((p, i) => (
                  <span key={i} className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 text-xs rounded-full pl-2.5 pr-1 py-1">
                    {p}<button type="button" onClick={() => setPartList(l => l.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
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
          {showShared && (
            <>
              <FormRow label="Shared Expense" required>
                <select className={SEL} value={f.shared_expense || ""} onChange={e => set("shared_expense", e.target.value)}>
                  <option value="">-- SELECT SHARED EXPENSE --</option>{SHARED_EXPENSE_OPTIONS.map(o => <option key={o}>{o}</option>)}
                </select>
              </FormRow>
              <FormRow label="Retail Share" required><Input type="number" min={0} value={f.retail_share || ""} onChange={e => set("retail_share", parseFloat(e.target.value) || 0)} className="max-w-[200px]" /></FormRow>
              <FormRow label="Business Dev. Share" required><Input type="number" min={0} value={f.business_dev_share || ""} onChange={e => set("business_dev_share", parseFloat(e.target.value) || 0)} className="max-w-[200px]" /></FormRow>
            </>
          )}
          <FormRow label="Quantity" required><Input type="number" min={0} value={f.quantity || ""} onChange={e => set("quantity", parseFloat(e.target.value) || 0)} className="max-w-[200px]" /></FormRow>
          <FormRow label="Unit Price" required><Input type="number" min={0} step="0.01" value={f.unit_price || ""} placeholder="0.00" onChange={e => set("unit_price", parseFloat(e.target.value) || 0)} className="max-w-[200px]" /></FormRow>
          <FormRow label="Mode of Payment" required>
            <select className={`${SEL} max-w-[280px]`} value={f.mode_of_payment} onChange={e => set("mode_of_payment", e.target.value)}>
              <option value="">-- SELECT MODE OF PAYMENT --</option>{REIMB_MOPS.map(m => <option key={m}>{m}</option>)}
            </select>
          </FormRow>
          <FormRow label="Total Amount" required>
            <Input value={fmtNum(total)} readOnly className={`max-w-[200px] font-semibold ${RO}`} />
          </FormRow>
          <FormRow label="Upload Receipt" required>
            <div className="flex max-w-md">
              <div className="flex items-center h-10 flex-1 min-w-0 border border-r-0 border-slate-300 rounded-l-md px-3 gap-2 text-sm bg-white">
                <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
                {f.receipt_name ? <span className="text-slate-700 truncate">{f.receipt_name}</span> : <span className="text-slate-400">No file selected</span>}
              </div>
              <button type="button" onClick={() => fileRef.current?.click()} className="h-10 px-4 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-r-md text-sm text-slate-600 transition-colors flex-shrink-0">Select file</button>
              <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={e => { set("receipt_name", e.target.files?.[0]?.name || ""); e.target.value = "" }} />
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
// Read-only labeled field (disabled-input look) matching the request form.
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
function HRow({ header, value, valueEl, last }: { header: string; value?: string; valueEl?: React.ReactNode; last?: boolean }) {
  return (
    <>
      <div className="bg-slate-100 px-4 py-2.5 font-bold text-sm text-slate-700">{header}</div>
      <div className={`px-4 py-2.5 text-sm text-slate-600 ${last ? "" : "border-b border-slate-200"}`}>{valueEl ?? (value || "—")}</div>
    </>
  )
}

function ViewScreen({ req, onBack, onApprove, onDecline }: {
  req: Reimbursement; onBack: () => void
  onApprove: (r: Reimbursement, remarks: string) => void; onDecline: (r: Reimbursement, remarks: string) => void
}) {
  const [mode, setMode] = useState<"" | "approve" | "decline">("")
  const [text, setText] = useState("")

  function exportXlsx() {
    const rows: any[][] = [
      ["REIMBURSEMENT REQUEST FORM"], [],
      ["Control No.", req.control_no], ["Date", req.date], ["Status", STATUS_LABEL[req.status]], [],
      ["Payee/Supplier", req.payee_supplier], ["Department", req.department], ["Name", req.name],
      ["Purpose", req.purpose], ["Particular/s", req.particulars], ["Type of Expense", req.type_of_expense],
      ["Shared Expense", req.shared_expense || "—"], ["Retail Share", req.retail_share], ["Business Dev. Share", req.business_dev_share],
      ["Quantity", req.quantity], ["Unit Price", req.unit_price], ["Total Amount", req.total_payment],
      ["Mode of Payment", req.mode_of_payment], ["Receipt", req.receipt_name || "—"], [],
      ["Added By", req.added_by], ["Added Date", fmtDT(req.added_date)],
      ["Approved By", req.approved_by || "—"], ["Approved Date", req.approved_date || "—"], ["Remarks", req.remarks || "—"],
    ]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    if ((ws as any)["A1"]) (ws as any)["A1"].s = { font: { bold: true, sz: 14, color: { rgb: "1F3864" } } }
    rows.forEach((r, i) => { if (r.length === 2) { const ref = XLSX.utils.encode_cell({ r: i, c: 0 }); if ((ws as any)[ref]) (ws as any)[ref].s = { font: { bold: true } } } })
    ;(ws as any)["!cols"] = [{ wch: 20 }, { wch: 42 }]
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Reimbursement")
    XLSX.writeFile(wb, `reimbursement-${req.control_no}.xlsx`)
  }

  const banner = req.status === "approved" ? { cls: "bg-teal-100 border-teal-400 text-teal-900", text: "Request Approved!" }
    : req.status === "declined" ? { cls: "bg-red-50 border-red-400 text-red-700", text: "Request Declined" }
      : { cls: "bg-amber-50 border-amber-400 text-amber-800", text: "Pending Approval" }

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"><ChevronLeft className="w-4 h-4" /> Back to Reimbursement</button>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* LEFT — REIMBURSEMENT REQUEST */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Settings className="w-5 h-5" /> REIMBURSEMENT REQUEST</h1>
            <Button onClick={exportXlsx} className="bg-teal-500 hover:bg-teal-600 text-white"><Download className="w-4 h-4" /> Export</Button>
          </div>
          <hr className="border-slate-200 mb-4" />

          <div className={`mb-5 rounded-lg border-l-4 px-4 py-3 text-base font-semibold ${banner.cls}`}>{banner.text}</div>

          <div className="max-w-3xl">
            <VField label="Date" required value={req.date} />
            <VField label="Control No" required value={req.control_no} />
            <VField label="Payee/Supplier" required value={req.payee_supplier} />
            <VField label="Department" required select value={req.department} />
            <VField label="Name" required value={req.name} />
            <VField label="Purpose" required tall value={req.purpose} />
            <VField label="Particular" required value={req.particulars} />
            <VField label="Type of Expense" required select value={req.type_of_expense} />
            <VField label="Shared Expense" required select value={req.shared_expense || "-- SELECT SHARED EXPENSE --"} />
            <VField label="Retail Share" required value={fmtNum(req.retail_share)} />
            <VField label="Business Dev. Share" required value={fmtNum(req.business_dev_share)} />
            <VField label="Quantity" required value={fmtNum(req.quantity)} />
            <VField label="Unit Price" required value={fmtNum(req.unit_price)} />
            <VField label="Mode of Payment" required select value={req.mode_of_payment} />
            <VField label="Total Amount" required value={fmtNum(req.total_payment)} />
            <VField label="Receipt" required value={req.receipt_name
              ? <span className="inline-flex items-center gap-2"><FileText className="w-4 h-4 text-slate-400" />{req.receipt_name}</span>
              : <span className="text-slate-400">No receipt attached</span>} />
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

        {/* RIGHT — HISTORY */}
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
