"use client"
import { useState, useMemo, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Plus, Search, X, Check, ChevronDown, ChevronLeft, Download, FileBarChart, Upload, BookOpen,
  AlertTriangle, Clock, FileText, ShieldCheck, Settings,
} from "lucide-react"
import { PieChart, Pie, Cell, Tooltip as RTooltip, Legend, ResponsiveContainer } from "recharts"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import * as XLSX from "xlsx-js-style"
import {
  useBookkeeping, fmtAmount, exportTxnsCSV, downloadCSV,
  UPLOAD_COLUMNS, splitAmount, type BookTxn, type NewTxnInput,
} from "@/lib/bookkeeping-store"
import {
  useFinanceSettings, type FinanceAccount, type FinanceTypeOfExpense, type ExpenseType,
} from "@/lib/finance-settings-store"

const SEL = "w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white focus:outline-none focus:border-blue-400"

const STATUS_BADGE: Record<string, string> = {
  enabled: "bg-emerald-50 text-emerald-700", pending_disable: "bg-amber-50 text-amber-700", disabled: "bg-red-50 text-red-600",
}
const STATUS_LABEL: Record<string, string> = { enabled: "Enabled", pending_disable: "Pending Disable", disabled: "Disabled" }

// Header view toggle. "For Approval" = transactions whose disable was requested (pending_disable).
type BookView = "enabled" | "disabled" | "for_approval"
const VIEW_OPTIONS: BookView[] = ["enabled", "disabled", "for_approval"]
const VIEW_LABELS: Record<BookView, string> = { enabled: "Enabled", disabled: "Disabled", for_approval: "For Approval" }

function FormRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-2 border-b border-slate-100 last:border-0">
      <label className="w-40 flex-shrink-0 text-sm text-slate-600 pt-2.5 leading-tight">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
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

// ── Add Transaction — full-page screen (LHIKE reference) ─────────────────────
function AddTransactionScreen({ accounts, departments, types, banks, onBack, onSave }: {
  accounts: FinanceAccount[]; departments: { name: string }[]; types: FinanceTypeOfExpense[]; banks: { name: string }[]
  onBack: () => void; onSave: (t: NewTxnInput) => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [f, setF] = useState<NewTxnInput>({
    posted_date: today, transaction: "", account: "", department: "", category: "",
    type_of_expense: "", expense_type: "Debit", amount: 0, bank: "", voucher: "", receipt_name: "",
  })
  const [errors, setErrors] = useState<string[]>([])
  const set = (k: keyof NewTxnInput, v: any) => { setF(p => ({ ...p, [k]: v })); setErrors([]) }

  const selectedAccount = accounts.find(a => a.name === f.account)
  const { debit, credit } = splitAmount(f.expense_type, Number(f.amount) || 0)

  // Category (LHIKE): picks the posting side, then filters the Type of Expense list.
  const CATEGORY_OPTIONS: { label: string; type: ExpenseType }[] = [
    { label: "Expense - Debit", type: "Debit" },
    { label: "Income - Credit", type: "Credit" },
    { label: "Others - Not Debit/Credit", type: "Not Applicable" },
  ]
  const categoryType = CATEGORY_OPTIONS.find(c => c.label === f.category)?.type
  const filteredTypes = categoryType ? types.filter(t => t.type === categoryType) : types

  function pickCategory(label: string) {
    const c = CATEGORY_OPTIONS.find(x => x.label === label)
    // Reset the Type of Expense when it no longer matches the chosen category.
    setF(p => {
      const keep = c && types.find(t => t.name === p.type_of_expense)?.type === c.type
      return { ...p, category: label, type_of_expense: keep ? p.type_of_expense : "", expense_type: (c?.type ?? "Debit") as ExpenseType }
    })
    setErrors([])
  }
  function pickType(name: string) {
    const t = types.find(x => x.name === name)
    setF(p => ({ ...p, type_of_expense: name, expense_type: (t?.type ?? "Debit") as ExpenseType }))
    setErrors([])
  }

  function validate(): string[] {
    const m: string[] = []
    if (!f.account) m.push("Account")
    if (!f.posted_date) m.push("Posted Date")
    if (!f.transaction.trim()) m.push("Transaction")
    if (!f.department) m.push("Department")
    if (!f.category) m.push("Category")
    if (!f.type_of_expense) m.push("Type of Expense")
    if (!(Number(f.amount) > 0)) m.push("Amount")
    if (!f.bank) m.push("Bank")
    if (selectedAccount?.with_voucher && !f.voucher.trim()) m.push("Voucher (account requires a voucher)")
    return m
  }
  function submit() {
    const m = validate()
    if (m.length) { setErrors(m); return }
    onSave({ ...f, amount: Number(f.amount) })
  }

  return (
    <div className="space-y-3">
      <span className="text-sm text-slate-500 font-medium">Book Keeping / Add Transaction</span>
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-100">
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Settings className="w-5 h-5" /> ADD TRANSACTION</h1>
          <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
        </div>

        {errors.length > 0 && (
          <div className="mb-3 max-w-3xl p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
            <p className="font-medium mb-1">Please fill in required fields:</p>
            <ul className="list-disc pl-4 space-y-0.5">{errors.map(e => <li key={e}>{e}</li>)}</ul>
          </div>
        )}
        <div className="max-w-3xl">

        <FormRow label="Account" required>
          <select className={SEL} value={f.account} onChange={e => set("account", e.target.value)}>
            <option value="">-- SELECT ACCOUNT --</option>
            {accounts.map(a => <option key={a.id} value={a.name}>{a.name}{a.with_voucher ? " (with voucher)" : ""}</option>)}
          </select>
        </FormRow>
        <FormRow label="Posted Date" required>
          <Input type="date" value={f.posted_date} onChange={e => set("posted_date", e.target.value)} className="max-w-[220px]" />
        </FormRow>
        <FormRow label="Transaction" required>
          <Input value={f.transaction} placeholder="Transaction description" onChange={e => set("transaction", e.target.value)} />
        </FormRow>
        <FormRow label="Department" required>
          <select className={SEL} value={f.department} onChange={e => set("department", e.target.value)}>
            <option value="">-- SELECT DEPARTMENT --</option>
            {departments.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
          </select>
        </FormRow>
        <FormRow label="Category" required>
          <select className={SEL} value={f.category} onChange={e => pickCategory(e.target.value)}>
            <option value="">-- SELECT TYPE --</option>
            {CATEGORY_OPTIONS.map(c => <option key={c.label} value={c.label}>{c.label}</option>)}
          </select>
        </FormRow>
        <FormRow label="Type of Expense" required>
          <select className={SEL} value={f.type_of_expense} onChange={e => pickType(e.target.value)}>
            <option value="">-- SELECT TYPE --</option>
            {filteredTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
        </FormRow>
        <FormRow label="Amount" required>
          <Input type="number" step="0.01" min={0} value={f.amount || ""} placeholder="0.00"
            onChange={e => set("amount", parseFloat(e.target.value) || 0)} className="max-w-[220px]" />
          <p className="text-xs text-slate-500 mt-1.5">
            Posts to <span className="font-semibold text-slate-700">{f.expense_type === "Credit" ? "Credit" : "Debit"}</span>:
            {" "}<span className="font-semibold text-slate-700">{fmtAmount(credit > 0 ? credit : debit)}</span> (by Type of Expense)
          </p>
        </FormRow>
        <FormRow label="Bank" required>
          <select className={SEL} value={f.bank} onChange={e => set("bank", e.target.value)}>
            <option value="">-- SELECT BANK --</option>
            {banks.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
          </select>
        </FormRow>
        <FormRow label="Voucher" required={!!selectedAccount?.with_voucher}>
          <Input value={f.voucher} placeholder={selectedAccount?.with_voucher ? "Required for this account" : "Voucher no. (optional)"}
            onChange={e => set("voucher", e.target.value)} className="max-w-[280px]" />
        </FormRow>
        <FormRow label="Upload Receipt">
          <input type="file" accept="image/*,.pdf" onChange={e => set("receipt_name", e.target.files?.[0]?.name || "")}
            className="block w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-slate-100 file:text-slate-700 file:text-sm hover:file:bg-slate-200" />
          {f.receipt_name && <p className="text-xs text-slate-500 mt-1">Attached: {f.receipt_name}</p>}
        </FormRow>
        </div>

        <div className="flex items-center gap-3 pt-5 mt-2 border-t border-slate-100 max-w-3xl">
          <Button onClick={submit}>Submit</Button>
          <Button variant="outline" onClick={onBack}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}

// ── View Transaction (+ disable workflow) ─────────────────────────────────────
// Read-only labeled field used in the View Transaction screen (mimics a disabled form input).
function ViewField({ label, value, required, select }: { label: string; value: React.ReactNode; required?: boolean; select?: boolean }) {
  return (
    <div className="flex items-center gap-4 py-1.5">
      <label className="w-36 text-right text-sm text-slate-600 flex-shrink-0">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <div className="flex-1 relative">
        <div className="min-h-10 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 flex items-center text-sm text-slate-600">
          {value === "" || value === null || value === undefined ? <span className="text-slate-300">—</span> : value}
        </div>
        {select && <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />}
      </div>
    </div>
  )
}
function fmtPosted(d: string) { const [y, m, day] = d.split("-"); return y && m && day ? `${m}/${day}/${y}` : d }
function fmtDateTime(iso: string) {
  const d = new Date(iso); if (isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// Full-page View Transaction: form (left) + history (right), per the reference design.
function ViewTransactionScreen({ txn, onBack, onRequestDisable, onApprove, onDecline }: {
  txn: BookTxn; onBack: () => void
  onRequestDisable: (id: string, reason: string) => void
  onApprove: (id: string, remarks: string) => void
  onDecline: (id: string, remarks: string) => void
}) {
  const [mode, setMode] = useState<"" | "request" | "approve" | "decline">("")
  const [text, setText] = useState("")
  function confirm() {
    if (mode === "request") onRequestDisable(txn.id, text.trim())
    else if (mode === "approve") onApprove(txn.id, text.trim())
    else if (mode === "decline") onDecline(txn.id, text.trim())
    onBack()
  }
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
        <ChevronLeft className="w-4 h-4" /> Back to Book Keeping
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* LEFT — VIEW TRANSACTION */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Settings className="w-5 h-5" /> VIEW TRANSACTION</h1>
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_BADGE[txn.status]}`}>{STATUS_LABEL[txn.status]}</span>
          </div>
          <hr className="border-slate-200 mb-4" />

          <div className="space-y-0.5 max-w-2xl">
            <ViewField label="Account" required select value={txn.account} />
            <ViewField label="Posted Date" required value={fmtPosted(txn.posted_date)} />
            <ViewField label="Transaction" required value={txn.transaction} />
            <ViewField label="Department" required select value={txn.department} />
            <ViewField label="Category" required select value={txn.category} />
            <ViewField label="Type of Expense" required select value={txn.type_of_expense} />
            <ViewField label="Amount" required value={txn.amount} />
            <ViewField label="Bank" required select value={txn.bank} />
            <ViewField label="Voucher" value={txn.voucher} />
            <div className="flex items-start gap-4 py-1.5">
              <label className="w-36 text-right text-sm text-slate-600 flex-shrink-0 pt-1.5">Receipt</label>
              <div className="flex-1">
                {txn.receipt_name
                  ? <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"><FileText className="w-4 h-4 text-slate-400" /> {txn.receipt_name}</div>
                  : <span className="text-sm text-slate-400">No receipt attached</span>}
              </div>
            </div>
          </div>

          {txn.disable_reason && <div className="mt-4 max-w-2xl p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm"><p className="font-medium text-amber-800">Disable reason</p><p className="text-amber-700">{txn.disable_reason}</p></div>}
          {txn.disable_remarks && <div className="mt-2 max-w-2xl p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm"><p className="font-medium text-slate-700">Admin remarks</p><p className="text-slate-600">{txn.disable_remarks}</p></div>}

          {mode && (
            <div className="mt-4 max-w-2xl p-3 border border-slate-200 rounded-lg bg-slate-50">
              <p className="text-sm font-medium text-slate-700 mb-2">{mode === "request" ? "Reason for disabling this transaction" : mode === "approve" ? "Approve disable — remarks" : "Decline disable — remarks"}</p>
              <textarea rows={3} value={text} onChange={e => setText(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-400 resize-none" placeholder="State the reason/remarks…" />
              <div className="flex gap-2 mt-2">
                <Button size="sm" disabled={!text.trim()} onClick={confirm}>Yes, continue</Button>
                <Button size="sm" variant="outline" onClick={() => { setMode(""); setText("") }}>Cancel</Button>
              </div>
            </div>
          )}

          {!mode && (
            <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-200">
              {txn.status === "enabled" && <Button className="bg-red-500 hover:bg-red-600 text-white" onClick={() => setMode("request")}><AlertTriangle className="w-4 h-4" /> Request Disable</Button>}
              {txn.status === "pending_disable" && (
                <>
                  <span className="text-sm text-amber-700 font-medium flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" /> Admin approval</span>
                  <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setMode("approve")}>Approve</Button>
                  <Button variant="outline" onClick={() => setMode("decline")}>Decline</Button>
                </>
              )}
              <Button variant="outline" onClick={onBack}>Cancel</Button>
            </div>
          )}
        </div>

        {/* RIGHT — HISTORY */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="text-lg font-bold text-blue-600 flex items-center gap-2 mb-1"><Settings className="w-5 h-5" /> HISTORY</h2>
          <hr className="border-slate-200 mb-4" />
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="bg-slate-100 px-4 py-2.5 font-bold text-sm text-slate-700">Added By</div>
            <div className="px-4 py-2.5 text-sm text-slate-600 border-b border-slate-200">{txn.added_by}</div>
            <div className="bg-slate-100 px-4 py-2.5 font-bold text-sm text-slate-700">Date Created</div>
            <div className="px-4 py-2.5 text-sm text-slate-600">{fmtDateTime(txn.added_date)}</div>
          </div>
          {txn.history.length > 1 && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Activity Log</p>
              <div className="space-y-2">
                {txn.history.map((h, i) => (
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

// ── View Summary (full-page) ──────────────────────────────────────────────────
type BKHook = ReturnType<typeof useBookkeeping>
type FSHook = ReturnType<typeof useFinanceSettings>
const PIE_COLORS = ["#10b981", "#3b82f6", "#ef4444", "#f97316", "#8b5cf6", "#6366f1", "#14b8a6", "#ec4899", "#f59e0b", "#64748b"]

interface SumGroup { name: string; debit: number; credit: number; balance: number; sub: { name: string; debit: number; credit: number; balance: number }[] }

// Collapsible group card — shows a Running Balance (red when negative) + an expandable
// breakdown by the secondary dimension (banks within a type, or types within a bank).
function SummaryGroupCard({ g, subLabel }: { g: SumGroup; subLabel: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-start justify-between px-5 py-4 hover:bg-slate-50 text-left transition-colors">
        <div>
          <p className="text-sm font-bold text-slate-800 uppercase tracking-wide">{g.name}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Running Balance:{" "}
            <span className={`font-semibold underline underline-offset-2 ${g.balance < 0 ? "text-red-500" : "text-slate-700"}`}>{fmtAmount(g.balance)}</span>
          </p>
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-400 mt-1 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-slate-100 px-5 pb-4 pt-1">
          <table className="w-full text-xs">
            <thead><tr className="text-slate-500">
              <th className="text-left py-1.5 font-semibold">{subLabel}</th>
              <th className="text-right font-semibold">Debit</th>
              <th className="text-right font-semibold">Credit</th>
              <th className="text-right font-semibold">Balance</th>
            </tr></thead>
            <tbody>
              {g.sub.map(s => (
                <tr key={s.name} className="border-t border-slate-50">
                  <td className="py-1.5 text-slate-700">{s.name}</td>
                  <td className="text-right text-slate-600">{fmtAmount(s.debit)}</td>
                  <td className="text-right text-slate-600">{fmtAmount(s.credit)}</td>
                  <td className={`text-right font-medium ${s.balance < 0 ? "text-red-500" : "text-slate-700"}`}>{fmtAmount(s.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SummaryScreen({ bk, fs, onBack }: { bk: BKHook; fs: FSHook; onBack: () => void }) {
  const todayStr = new Date().toISOString().slice(0, 10)
  const earliest = bk.txns.map(t => t.posted_date).filter(Boolean).sort()[0]
  const [draftFrom, setDraftFrom] = useState(earliest || `${todayStr.slice(0, 7)}-01`)
  const [draftTo, setDraftTo] = useState(todayStr)
  const [from, setFrom] = useState(draftFrom)
  const [to, setTo] = useState(draftTo)
  const [tab, setTab] = useState<"type" | "banks">("type")
  const [showPie, setShowPie] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [toast, setToast] = useState("")
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500) }

  const txns = useMemo(
    () => bk.txns.filter(t => t.status !== "disabled" && t.posted_date >= from && t.posted_date <= to),
    [bk.txns, from, to])

  const subLabel = tab === "type" ? "Bank" : "Type of Expense"
  // Group by the active tab's dimension; running balance = credit − debit (inflow − outflow).
  const groups = useMemo<SumGroup[]>(() => {
    const keyFn = (t: BookTxn) => (tab === "type" ? t.type_of_expense : t.bank) || "—"
    const subFn = (t: BookTxn) => (tab === "type" ? t.bank : t.type_of_expense) || "—"
    const map: Record<string, { debit: number; credit: number; sub: Record<string, { debit: number; credit: number }> }> = {}
    for (const t of txns) {
      const k = keyFn(t)
      if (!map[k]) map[k] = { debit: 0, credit: 0, sub: {} }
      map[k].debit += t.debit; map[k].credit += t.credit
      const sk = subFn(t)
      if (!map[k].sub[sk]) map[k].sub[sk] = { debit: 0, credit: 0 }
      map[k].sub[sk].debit += t.debit; map[k].sub[sk].credit += t.credit
    }
    return Object.entries(map).map(([name, v]) => ({
      name, debit: v.debit, credit: v.credit, balance: v.credit - v.debit,
      sub: Object.entries(v.sub).map(([sn, sv]) => ({ name: sn, debit: sv.debit, credit: sv.credit, balance: sv.credit - sv.debit })),
    })).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
  }, [txns, tab])

  const totalFund = groups.reduce((s, g) => s + g.balance, 0)
  const pieData = groups.map(g => ({ name: g.name, value: Math.abs(g.balance) })).filter(d => d.value > 0)

  // Add Transaction opens as a full-page screen (LHIKE reference).
  if (showAdd) return <AddTransactionScreen accounts={fs.activeAccounts} departments={fs.activeDepartments} types={fs.activeTypes} banks={fs.activeBanks}
    onBack={() => setShowAdd(false)}
    onSave={async (input) => { await bk.addTxn(input); setShowAdd(false); flash("Transaction added successfully.") }} />

  return (
    <div className="space-y-3">
      {toast && <div className="fixed top-5 right-5 z-50 bg-emerald-500 text-white rounded-xl shadow-2xl px-4 py-3 text-sm flex items-center gap-2"><Check className="w-4 h-4" /> {toast}</div>}

      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
        <ChevronLeft className="w-4 h-4" /> Back to Book Keeping
      </button>

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-xl font-bold text-blue-600 flex items-center gap-2"><FileBarChart className="w-5 h-5" /> BOOK KEEPING SUMMARY</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-slate-500 font-medium">Date range</span>
            <input type="date" value={draftFrom} onChange={e => setDraftFrom(e.target.value)} className="h-9 rounded-lg border border-slate-300 px-2 text-sm bg-white" />
            <input type="date" value={draftTo} onChange={e => setDraftTo(e.target.value)} className="h-9 rounded-lg border border-slate-300 px-2 text-sm bg-white" />
            <Button onClick={() => { setFrom(draftFrom); setTo(draftTo) }}><Search className="w-4 h-4" /></Button>
            <Button onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Add Book Keeping Transaction</Button>
          </div>
        </div>
        <p className="text-xs text-slate-500 italic mt-1 mb-4">For date range: {from} 00:00:00 - {to} 23:59:59</p>
        <hr className="border-slate-200 mb-4" />

        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex gap-1 border-b border-slate-200">
            {([["type", "Type of Expense"], ["banks", "Banks"]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${tab === k ? "border-teal-500 text-teal-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>{label}</button>
            ))}
          </div>
          <Button variant="outline" onClick={() => setShowPie(p => !p)} className="border-teal-400 text-teal-600 hover:bg-teal-50">
            View Pie Graph <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showPie ? "rotate-180" : ""}`} />
          </Button>
        </div>

        {showPie && (
          <div className="border border-slate-200 rounded-xl p-4 mb-4">
            {pieData.length === 0 ? <p className="text-sm text-slate-400 text-center py-8">No data to chart in this range.</p> : (
              <div style={{ width: "100%", height: 300 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={110} label={(e: any) => e.name}>
                      {pieData.map((d, i) => <Cell key={d.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <RTooltip formatter={(v: any) => fmtAmount(Number(v))} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {groups.length === 0 ? (
          <p className="text-sm text-slate-400 italic py-8 text-center">No transactions in this date range.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {groups.map(g => <SummaryGroupCard key={g.name} g={g} subLabel={subLabel} />)}
          </div>
        )}

        <div className="flex justify-center mt-6">
          <div className="flex items-stretch border border-slate-200 rounded-lg overflow-hidden shadow-sm">
            <div className="bg-slate-50 px-6 py-3 text-sm font-bold text-slate-700">Total Company Fund</div>
            <div className={`px-6 py-3 text-sm font-bold ${totalFund < 0 ? "text-red-500" : "text-slate-800"}`}>{fmtAmount(totalFund)}</div>
          </div>
        </div>
      </div>

    </div>
  )
}

// ── Upload (bulk CSV) ─────────────────────────────────────────────────────────
// Normalize an Excel cell into a YYYY-MM-DD string (handles JS Date cells + common text formats).
function normalizeDate(v: any): string {
  if (v instanceof Date && !isNaN(v.getTime())) {
    const p = (n: number) => String(n).padStart(2, "0")
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`
  }
  const s = String(v ?? "").trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const d = new Date(s)
  if (!isNaN(d.getTime()) && /\d/.test(s)) {
    const p = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }
  return s
}
function numCell(v: any): number { return Number(String(v ?? "").replace(/,/g, "").trim()) || 0 }

// Full-page bulk upload. Downloads a styled .xlsx template and parses an uploaded .xlsx with
// explicit DEBIT/CREDIT columns — matching the Finance bulk-upload spreadsheet.
function UploadScreen({ onBack, onImport }: { onBack: () => void; onImport: (rows: NewTxnInput[]) => Promise<number> }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<{ added: number; skipped: number; errors: string[] } | null>(null)

  function downloadTemplate() {
    const headerStyle = {
      fill: { patternType: "solid", fgColor: { rgb: "1F3864" } },
      font: { color: { rgb: "FFFFFF" }, bold: true },
      alignment: { horizontal: "center", vertical: "center" },
    }
    const ws = XLSX.utils.aoa_to_sheet([UPLOAD_COLUMNS, ["YYYY-MM-DD", "", "", "", "", "", "", "", ""]])
    UPLOAD_COLUMNS.forEach((_, i) => {
      const ref = XLSX.utils.encode_cell({ r: 0, c: i })
      if ((ws as any)[ref]) (ws as any)[ref].s = headerStyle
    })
    ;(ws as any)["!cols"] = UPLOAD_COLUMNS.map(h => ({ wch: Math.max(14, h.length + 2) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Book Keeping")
    XLSX.writeFile(wb, "bookkeeping-template.xlsx")
  }

  function handleUpload() {
    if (!file) return
    setProcessing(true)
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: "array", cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" })
        if (rows.length < 2) { setResult({ added: 0, skipped: 0, errors: ["The file has no data rows."] }); setProcessing(false); return }
        const header = rows[0].map((h: any) => String(h).trim().toLowerCase())
        const idx = (n: string) => header.indexOf(n.toLowerCase())
        const col = {
          date: idx("POSTED DATE"), acct: idx("ACCOUNTS"), txn: idx("TRANSACTION"), dept: idx("DEPARTMENT"),
          type: idx("TYPE OF EXPENSE"), debit: idx("DEBIT"), credit: idx("CREDIT"), bank: idx("BANK"), voucher: idx("VOUCHER"),
        }
        const valid: NewTxnInput[] = []
        const errors: string[] = []
        let skipped = 0
        for (let r = 1; r < rows.length; r++) {
          const c = rows[r]
          const cell = (i: number) => (i >= 0 && i < c.length ? c[i] : "")
          const str = (i: number) => String(cell(i) ?? "").trim()
          const date = normalizeDate(cell(col.date)), txn = str(col.txn), acct = str(col.acct)
          const debit = numCell(cell(col.debit)), credit = numCell(cell(col.credit))
          if (!txn && debit === 0 && credit === 0 && !acct) continue  // blank / template hint row
          if (!date || date === "YYYY-MM-DD" || !txn || (debit <= 0 && credit <= 0)) {
            skipped++; errors.push(`Row ${r + 1}: needs Posted Date, Transaction, and a Debit or Credit amount.`); continue
          }
          valid.push({
            posted_date: date, transaction: txn, account: acct, department: str(col.dept), category: "",
            type_of_expense: str(col.type) || "Miscellaneous", expense_type: (debit > 0 ? "Debit" : "Credit") as ExpenseType,
            amount: debit > 0 ? debit : credit, bank: str(col.bank), voucher: str(col.voucher), receipt_name: "",
            debit, credit,
          })
        }
        const added = valid.length ? await onImport(valid) : 0
        setResult({ added, skipped, errors: errors.slice(0, 8) })
      } catch {
        setResult({ added: 0, skipped: 0, errors: ["Could not read the file — make sure it's a valid Excel (.xlsx) file."] })
      }
      setProcessing(false)
    }
    reader.readAsArrayBuffer(file)
  }

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
        <ChevronLeft className="w-4 h-4" /> Back to Book Keeping
      </button>

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 mb-1"><Settings className="w-5 h-5" /> UPLOAD BOOK KEEPING</h1>
        <hr className="border-slate-200 mb-6" />

        <div className="space-y-5 max-w-2xl">
          <div className="flex items-center gap-4">
            <label className="w-44 text-right text-sm text-slate-600 flex-shrink-0">Template</label>
            <button onClick={downloadTemplate} className="text-sm text-blue-600 underline underline-offset-2 hover:text-blue-700">Click to Download Sample File</button>
          </div>

          <div className="flex items-start gap-4">
            <label className="w-44 text-right text-sm text-slate-600 flex-shrink-0 pt-2">Upload Excel File <span className="text-red-500">*</span></label>
            <div className="flex-1 max-w-sm">
              <div className="flex items-center h-10 border border-slate-300 rounded-t-md px-3 gap-2 text-sm bg-white">
                <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
                {file ? <span className="text-slate-700 truncate">{file.name}</span> : <span className="text-slate-400">No file selected</span>}
              </div>
              <button onClick={() => fileRef.current?.click()}
                className="w-full bg-slate-100 hover:bg-slate-200 border border-t-0 border-slate-300 rounded-b-md py-1.5 text-sm text-slate-600 transition-colors">
                Select file
              </button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={e => { const fl = e.target.files?.[0]; if (fl) { setFile(fl); setResult(null) } e.target.value = "" }} />
            </div>
          </div>

          {result && (
            <div className={`ml-44 p-3 rounded-lg border text-sm ${result.added > 0 ? "bg-green-50 border-green-200 text-green-700" : "bg-amber-50 border-amber-200 text-amber-700"}`}>
              <p className="font-bold">{result.added} transaction(s) added{result.skipped ? `, ${result.skipped} skipped` : ""}.</p>
              {result.errors.length > 0 && <ul className="list-disc pl-4 mt-1 space-y-0.5 text-xs">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
            </div>
          )}
        </div>

        <hr className="border-slate-200 my-6" />
        <div className="flex items-center gap-3 pl-44">
          <Button onClick={handleUpload} disabled={!file || processing}>{processing ? "Uploading…" : "Upload"}</Button>
          <Button variant="outline" onClick={onBack}>Back</Button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function BookkeepingPage() {
  const bk = useBookkeeping()
  const fs = useFinanceSettings()
  const [view, setView] = useState<BookView>("enabled")
  const [viewMenu, setViewMenu] = useState(false)
  const [activeAccount, setActiveAccount] = useState("ALL")
  const [sortAsc, setSortAsc] = useState(true)

  const emptyFilters = { dateFrom: "", dateTo: "", voucher: "", transaction: "", department: "", typeOfExpense: "", debit: "", credit: "", bank: "" }
  const [draft, setDraft] = useState({ ...emptyFilters })
  const [applied, setApplied] = useState({ ...emptyFilters })
  const setD = (k: keyof typeof emptyFilters, v: string) => setDraft(p => ({ ...p, [k]: v }))

  const [showAdd, setShowAdd] = useState(false)
  const [showSummary, setShowSummary] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [viewTxn, setViewTxn] = useState<BookTxn | null>(null)
  const [toast, setToast] = useState("")
  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(""), 4000) }

  const accountTabs = fs.activeAccounts.map(a => a.name)

  const filtered = useMemo(() => {
    const inView = (t: BookTxn) =>
      view === "disabled" ? t.status === "disabled"
        : view === "for_approval" ? t.status === "pending_disable"
          : t.status === "enabled"
    let list = bk.txns.filter(inView)
    if (activeAccount !== "ALL") list = list.filter(t => t.account === activeAccount)
    const a = applied
    list = list.filter(t => {
      if (a.dateFrom && t.posted_date < a.dateFrom) return false
      if (a.dateTo && t.posted_date > a.dateTo) return false
      if (a.voucher && !t.voucher.toLowerCase().includes(a.voucher.toLowerCase())) return false
      if (a.transaction && !t.transaction.toLowerCase().includes(a.transaction.toLowerCase())) return false
      if (a.department && t.department !== a.department) return false
      if (a.typeOfExpense && t.type_of_expense !== a.typeOfExpense) return false
      if (a.debit && !String(t.debit).includes(a.debit.replace(/,/g, ""))) return false
      if (a.credit && !String(t.credit).includes(a.credit.replace(/,/g, ""))) return false
      if (a.bank && t.bank !== a.bank) return false
      return true
    })
    return list.sort((x, y) => sortAsc ? x.posted_date.localeCompare(y.posted_date) : y.posted_date.localeCompare(x.posted_date))
  }, [bk.txns, view, activeAccount, applied, sortAsc])

  async function handleAdd(input: NewTxnInput) {
    await bk.addTxn(input); setShowAdd(false); setView("enabled"); flash("Transaction added successfully.")
  }

  const loading = !bk.loaded || !fs.loaded

  // View Summary opens as a full-page screen (not a modal), per the reference design.
  if (showSummary) return <SummaryScreen bk={bk} fs={fs} onBack={() => setShowSummary(false)} />

  // Upload Book Keeping opens as a full-page screen (Excel template + upload), per reference.
  if (showUpload) return <UploadScreen onBack={() => setShowUpload(false)}
    onImport={async rows => { const n = await bk.importTxns(rows); if (n) flash(`${n} transaction(s) uploaded.`); return n }} />

  // Add Transaction opens as a full-page screen (LHIKE reference).
  if (showAdd) return <AddTransactionScreen accounts={fs.activeAccounts} departments={fs.activeDepartments} types={fs.activeTypes} banks={fs.activeBanks}
    onBack={() => setShowAdd(false)} onSave={handleAdd} />

  // Viewing a transaction opens a full-page View Transaction screen (form + history), per reference.
  if (viewTxn) {
    const current = bk.txns.find(t => t.id === viewTxn.id) || viewTxn
    return <ViewTransactionScreen txn={current} onBack={() => setViewTxn(null)}
      onRequestDisable={async (id, reason) => { await bk.requestDisable(id, reason); flash("Disable requested — awaiting admin approval.") }}
      onApprove={async (id, remarks) => { await bk.approveDisable(id, remarks); flash("Transaction disabled.") }}
      onDecline={async (id, remarks) => { await bk.declineDisable(id, remarks); flash("Disable request declined.") }} />
  }

  return (
    <div className="space-y-3">
      <span className="text-sm text-slate-500 font-medium">Book Keeping</span>
      {toast && <div className="fixed top-5 right-5 z-50 bg-emerald-500 text-white rounded-xl shadow-2xl px-4 py-3 text-sm flex items-center gap-2"><Check className="w-4 h-4" /> {toast}</div>}

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-3 mb-4 pb-4 border-b border-slate-100">
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><BookOpen className="w-5 h-5" /> BOOK KEEPING</h1>
          <div className="flex items-center gap-2">
            <Button onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Add Transaction</Button>
            <div className="relative">
              <Button variant="outline" onClick={() => setViewMenu(m => !m)}>{VIEW_LABELS[view]} <ChevronDown className="w-3.5 h-3.5" /></Button>
              {viewMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setViewMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-20 w-40 py-1">
                    {VIEW_OPTIONS.map(v => (
                      <button key={v} onClick={() => { setView(v); setViewMenu(false) }}
                        className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-slate-50 ${view === v ? "text-blue-700 font-semibold" : "text-slate-700"}`}>{VIEW_LABELS[v]} {view === v && <Check className="w-3.5 h-3.5" />}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Account tabs */}
        <div className="flex flex-wrap gap-2 mb-4">
          {["ALL", ...accountTabs].map(d => (
            <button key={d} onClick={() => setActiveAccount(d)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${activeAccount === d ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>{d}</button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 mb-3">
          <button onClick={() => downloadCSV(`bookkeeping-${new Date().toISOString().slice(0, 10)}.csv`, exportTxnsCSV(filtered))}
            className="px-4 py-2 rounded-md bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold uppercase tracking-wide flex items-center gap-1.5"><Download className="w-4 h-4" /> Export</button>
          <button onClick={() => setShowSummary(true)} className="px-4 py-2 rounded-md bg-cyan-400 hover:bg-cyan-500 text-white text-xs font-bold uppercase tracking-wide flex items-center gap-1.5"><FileBarChart className="w-4 h-4" /> View Summary</button>
          <button onClick={() => setShowUpload(true)} className="px-4 py-2 rounded-md bg-slate-900 hover:bg-slate-700 text-white text-xs font-bold uppercase tracking-wide flex items-center gap-1.5"><Upload className="w-4 h-4" /> Upload Book Keeping</button>
        </div>

        <button onClick={() => setSortAsc(s => !s)} className="text-sm text-blue-600 hover:text-blue-700 mb-2">Arrange Posted Date <span className="font-semibold">{sortAsc ? "Ascending" : "Descending"}</span></button>

        {/* Table */}
        <div className="overflow-auto border-t border-slate-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                {["No", "Posted Date", "Voucher", "Transaction", "Department", "Type of Expense", "Debit", "Credit", "Bank", "Actions"].map(h => <th key={h} className="px-3 py-3 text-left font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
              <tr className="border-b border-slate-200 align-top">
                <th className="px-2 py-2"></th>
                <th className="px-2 py-2">
                  <div className="min-w-[130px]">
                    <DateRangePicker a={applied.dateFrom} b={applied.dateTo}
                      onApply={(a, b) => { setDraft(p => ({ ...p, dateFrom: a, dateTo: b })); setApplied(p => ({ ...p, dateFrom: a, dateTo: b })) }} />
                  </div>
                </th>
                <th className="px-2 py-2"><input value={draft.voucher} onChange={e => setD("voucher", e.target.value)} className="h-8 w-full min-w-[90px] rounded border border-slate-300 px-2 text-xs" /></th>
                <th className="px-2 py-2"><input value={draft.transaction} onChange={e => setD("transaction", e.target.value)} className="h-8 w-full min-w-[110px] rounded border border-slate-300 px-2 text-xs" /></th>
                <th className="px-2 py-2">
                  <select value={draft.department} onChange={e => setD("department", e.target.value)} className="h-8 w-full min-w-[110px] rounded border border-slate-300 px-1.5 text-xs bg-white">
                    <option value="">All</option>
                    {fs.activeDepartments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                  </select>
                </th>
                <th className="px-2 py-2">
                  <select value={draft.typeOfExpense} onChange={e => setD("typeOfExpense", e.target.value)} className="h-8 w-full min-w-[110px] rounded border border-slate-300 px-1.5 text-xs bg-white">
                    <option value="">All</option>
                    {fs.activeTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                  </select>
                </th>
                <th className="px-2 py-2"><input value={draft.debit} onChange={e => setD("debit", e.target.value)} className="h-8 w-full min-w-[80px] rounded border border-slate-300 px-2 text-xs" /></th>
                <th className="px-2 py-2"><input value={draft.credit} onChange={e => setD("credit", e.target.value)} className="h-8 w-full min-w-[80px] rounded border border-slate-300 px-2 text-xs" /></th>
                <th className="px-2 py-2">
                  <select value={draft.bank} onChange={e => setD("bank", e.target.value)} className="h-8 w-full min-w-[100px] rounded border border-slate-300 px-1.5 text-xs bg-white">
                    <option value="">All</option>
                    {fs.activeBanks.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                  </select>
                </th>
                <th className="px-2 py-2">
                  <div className="flex gap-1">
                    <Button size="sm" onClick={() => setApplied({ ...draft })}><Search className="w-3.5 h-3.5" /> Search</Button>
                    {JSON.stringify(applied) !== JSON.stringify(emptyFilters) && <Button size="sm" variant="outline" onClick={() => { setDraft({ ...emptyFilters }); setApplied({ ...emptyFilters }) }}>Clear</Button>}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? <tr><td colSpan={10} className="text-center py-12 text-slate-400">Loading…</td></tr>
                : filtered.length === 0 ? <tr><td colSpan={10} className="text-center py-12 text-slate-400">No transactions found</td></tr>
                : filtered.map((t, i) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="px-3 py-3 text-slate-400">{i + 1}</td>
                    <td className="px-3 py-3 text-slate-700 whitespace-nowrap">{t.posted_date}</td>
                    <td className="px-3 py-3 text-slate-700">{t.voucher || ""}</td>
                    <td className="px-3 py-3 text-slate-700">{t.transaction}{t.status === "pending_disable" && <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700">Pending Disable</span>}</td>
                    <td className="px-3 py-3 text-slate-700 whitespace-nowrap">{t.department}</td>
                    <td className="px-3 py-3 text-slate-700 whitespace-nowrap">{t.type_of_expense}</td>
                    <td className="px-3 py-3 text-slate-700 whitespace-nowrap">{fmtAmount(t.debit)}</td>
                    <td className="px-3 py-3 text-slate-700 whitespace-nowrap">{fmtAmount(t.credit)}</td>
                    <td className="px-3 py-3 text-slate-700 whitespace-nowrap">{t.bank}</td>
                    <td className="px-3 py-3">
                      <button onClick={() => setViewTxn(t)} title="View transaction" className="w-8 h-8 flex items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-100"><Search className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-800">
                  <td className="px-3 py-2.5" colSpan={6}>TOTAL ({filtered.length})</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{fmtAmount(filtered.reduce((s, t) => s + t.debit, 0))}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{fmtAmount(filtered.reduce((s, t) => s + t.credit, 0))}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

    </div>
  )
}
