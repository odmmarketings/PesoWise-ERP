"use client"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Plus, X, Check, Eye, Power, Menu, Search, FileText, Settings as SettingsIcon,
} from "lucide-react"
import {
  useFinanceSettings, MEMBERS,
  type FinanceAccount, type FinanceTypeOfExpense, type ExpenseType,
} from "@/lib/finance-settings-store"

const TABS = ["General", "Accounts", "Banks", "Department", "Type of Expense"] as const
type Tab = typeof TABS[number]

const SEL = "w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white focus:outline-none focus:border-blue-400"

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
  title: string; icon?: any; onClose: () => void; children: React.ReactNode; width?: string
}) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className={`bg-white rounded-2xl w-full ${width} shadow-2xl max-h-[92vh] flex flex-col`}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-bold text-slate-900 text-base flex items-center gap-2">{Icon && <Icon className="w-5 h-5 text-blue-600" />}{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

// Generic name-only add modal (Banks, Departments)
function NameModal({ title, label, onClose, onSave }: { title: string; label: string; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState("")
  return (
    <Modal title={title} icon={Plus} onClose={onClose}>
      <div className="px-6 py-5">
        <label className="text-sm text-slate-600">{label}<span className="text-red-500">*</span></label>
        <Input className="mt-1.5" value={name} autoFocus placeholder={`Enter ${label.toLowerCase()}`} onChange={e => setName(e.target.value)} />
      </div>
      <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex gap-2">
        <Button disabled={!name.trim()} onClick={() => onSave(name.trim())}>Submit</Button>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  )
}

export default function FinanceSettingsPage() {
  const fs = useFinanceSettings()
  const [tab, setTab] = useState<Tab>("General")

  if (!fs.loaded) return <div className="p-8 text-slate-400 text-sm">Loading settings…</div>

  return (
    <div className="space-y-3">
      <span className="text-sm text-slate-500 font-medium">Finance / Settings</span>
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 pb-4 mb-4 border-b border-slate-100">
          <SettingsIcon className="w-5 h-5" /> FINANCE SETTINGS
        </h1>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 border-b border-slate-200 mb-5">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
              {t}
            </button>
          ))}
        </div>

        {tab === "General" && <GeneralTab fs={fs} />}
        {tab === "Accounts" && <AccountsTab fs={fs} />}
        {tab === "Banks" && <BanksTab fs={fs} />}
        {tab === "Department" && <DepartmentsTab fs={fs} />}
        {tab === "Type of Expense" && <TypesTab fs={fs} />}
      </div>
    </div>
  )
}

type FS = ReturnType<typeof useFinanceSettings>

// ── General ───────────────────────────────────────────────────────────────────
function GeneralTab({ fs }: { fs: FS }) {
  const rows = [
    { key: "hide_shared_expense" as const, title: "Hide/Unhide Shared Expense", desc: "Enable users to hide/unhide shared expense in the Reimbursement submodule." },
    { key: "hide_type_request" as const, title: "Hide/Unhide Type Request", desc: "Enable users to hide/unhide type request in the Utility Expense submodule." },
  ]
  return (
    <div className="space-y-3 max-w-2xl">
      <p className="text-sm text-slate-500">
        Enable or disable the ability for users to Hide/Unhide shared expense and type request in the Reimbursement / Utility Expense submodules.
      </p>
      {rows.map(r => (
        <div key={r.key} className="flex items-start justify-between gap-4 border border-slate-200 rounded-xl px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-800">{r.title}</p>
            <p className="text-xs text-slate-500 mt-0.5">{r.desc}</p>
          </div>
          <Switch on={fs.general[r.key]} onClick={() => fs.setGeneral({ [r.key]: !fs.general[r.key] })} />
        </div>
      ))}
    </div>
  )
}

// ── Banks ─────────────────────────────────────────────────────────────────────
function BanksTab({ fs }: { fs: FS }) {
  const [add, setAdd] = useState(false)
  const [view, setView] = useState<string | null>(null)
  const bank = fs.banks.find(b => b.id === view)
  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm font-semibold text-slate-700">Banks ({fs.banks.length})</p>
        <Button onClick={() => setAdd(true)}><Plus className="w-4 h-4" /> Add Bank</Button>
      </div>
      <SimpleTable
        cols={["No", "Bank Name", "Status", "Actions"]}
        rows={fs.banks.map((b, i) => (
          <tr key={b.id} className="hover:bg-slate-50">
            <td className="px-3 py-2.5 text-slate-400">{i + 1}</td>
            <td className="px-3 py-2.5 font-medium text-slate-800">{b.name}</td>
            <td className="px-3 py-2.5"><StatusPill active={b.status === "active"} /></td>
            <td className="px-3 py-2.5"><RowActions onView={() => setView(b.id)} active={b.status === "active"} onToggle={() => fs.toggleBank(b.id)} /></td>
          </tr>
        ))}
      />
      {add && <NameModal title="Add Bank" label="Bank Name" onClose={() => setAdd(false)} onSave={n => { fs.addBank(n); setAdd(false) }} />}
      {bank && (
        <Modal title="View Bank" icon={Eye} onClose={() => setView(null)}>
          <div className="px-6 py-5 space-y-2 text-sm">
            <DetailRow k="Bank Name" v={bank.name} />
            <DetailRow k="Status" v={bank.status === "active" ? "Active" : "Inactive"} />
          </div>
          <div className="px-6 py-4 border-t bg-slate-50 flex justify-end"><Button variant="outline" onClick={() => setView(null)}>Close</Button></div>
        </Modal>
      )}
    </div>
  )
}

// ── Departments ───────────────────────────────────────────────────────────────
function DepartmentsTab({ fs }: { fs: FS }) {
  const [add, setAdd] = useState(false)
  const [view, setView] = useState<string | null>(null)
  const dept = fs.departments.find(d => d.id === view)
  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm font-semibold text-slate-700">Departments ({fs.departments.length})</p>
        <Button onClick={() => setAdd(true)}><Plus className="w-4 h-4" /> Add Department</Button>
      </div>
      <SimpleTable
        cols={["No", "Department Name", "Status", "Actions"]}
        rows={fs.departments.map((d, i) => (
          <tr key={d.id} className="hover:bg-slate-50">
            <td className="px-3 py-2.5 text-slate-400">{i + 1}</td>
            <td className="px-3 py-2.5 font-medium text-slate-800">{d.name}</td>
            <td className="px-3 py-2.5"><StatusPill active={d.status === "active"} /></td>
            <td className="px-3 py-2.5"><RowActions onView={() => setView(d.id)} active={d.status === "active"} onToggle={() => fs.toggleDepartment(d.id)} /></td>
          </tr>
        ))}
      />
      {add && <NameModal title="Add Department" label="Department Name" onClose={() => setAdd(false)} onSave={n => { fs.addDepartment(n); setAdd(false) }} />}
      {dept && (
        <Modal title="View Department" icon={Eye} onClose={() => setView(null)}>
          <div className="px-6 py-5 space-y-2 text-sm">
            <DetailRow k="Department Name" v={dept.name} />
            <DetailRow k="Status" v={dept.status === "active" ? "Active" : "Inactive"} />
          </div>
          <div className="px-6 py-4 border-t bg-slate-50 flex justify-end"><Button variant="outline" onClick={() => setView(null)}>Close</Button></div>
        </Modal>
      )}
    </div>
  )
}

// ── Types of Expense ──────────────────────────────────────────────────────────
function TypesTab({ fs }: { fs: FS }) {
  const [add, setAdd] = useState(false)
  const [view, setView] = useState<string | null>(null)
  const t = fs.types.find(x => x.id === view)
  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm font-semibold text-slate-700">Type of Expense ({fs.types.length})</p>
        <Button onClick={() => setAdd(true)}><Plus className="w-4 h-4" /> Add Type of Expense</Button>
      </div>
      <SimpleTable
        cols={["No", "Name", "OPEX", "Type", "Status", "Actions"]}
        rows={fs.types.map((x, i) => (
          <tr key={x.id} className="hover:bg-slate-50">
            <td className="px-3 py-2.5 text-slate-400">{i + 1}</td>
            <td className="px-3 py-2.5 font-medium text-slate-800">{x.name}</td>
            <td className="px-3 py-2.5">{x.opex ? <Check className="w-4 h-4 text-emerald-600" /> : <span className="text-slate-300">—</span>}</td>
            <td className="px-3 py-2.5"><TypePill type={x.type} /></td>
            <td className="px-3 py-2.5"><StatusPill active={x.status === "active"} /></td>
            <td className="px-3 py-2.5"><RowActions onView={() => setView(x.id)} active={x.status === "active"} onToggle={() => fs.toggleType(x.id)} /></td>
          </tr>
        ))}
      />
      {add && <TypeModal onClose={() => setAdd(false)} onSave={v => { fs.addType(v); setAdd(false) }} />}
      {t && (
        <Modal title="View Type of Expense" icon={Eye} onClose={() => setView(null)}>
          <div className="px-6 py-5 space-y-2 text-sm">
            <DetailRow k="Name" v={t.name} />
            <DetailRow k="OPEX (Operating Expense)" v={t.opex ? "Yes" : "No"} />
            <DetailRow k="Type" v={t.type} />
            <DetailRow k="Status" v={t.status === "active" ? "Active" : "Inactive"} />
          </div>
          <div className="px-6 py-4 border-t bg-slate-50 flex justify-end"><Button variant="outline" onClick={() => setView(null)}>Close</Button></div>
        </Modal>
      )}
    </div>
  )
}
function TypePill({ type }: { type: ExpenseType }) {
  const c = type === "Debit" ? "bg-blue-50 text-blue-700" : type === "Credit" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${c}`}>{type}</span>
}
function TypeModal({ onClose, onSave }: { onClose: () => void; onSave: (t: Omit<FinanceTypeOfExpense, "id" | "status">) => void }) {
  const [name, setName] = useState("")
  const [opex, setOpex] = useState(true)
  const [type, setType] = useState<ExpenseType>("Debit")
  return (
    <Modal title="Add Type of Expense" icon={Plus} onClose={onClose}>
      <div className="px-6 py-5 space-y-4">
        <label className="flex items-center justify-between gap-4">
          <span className="text-sm text-slate-700 font-medium">OPEX (Operating Expense)</span>
          <Switch on={opex} onClick={() => setOpex(o => !o)} />
        </label>
        <div>
          <label className="text-sm text-slate-600">Name<span className="text-red-500">*</span></label>
          <Input className="mt-1.5" value={name} autoFocus onChange={e => setName(e.target.value)} placeholder="e.g. Office Rent" />
        </div>
        <div>
          <label className="text-sm text-slate-600">Type<span className="text-red-500">*</span></label>
          <select className={`${SEL} mt-1.5`} value={type} onChange={e => setType(e.target.value as ExpenseType)}>
            {(["Debit", "Credit", "Not Applicable"] as ExpenseType[]).map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div className="px-6 py-4 border-t bg-slate-50 flex gap-2">
        <Button disabled={!name.trim()} onClick={() => onSave({ name: name.trim(), opex, type })}>Submit</Button>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  )
}

// ── Accounts ──────────────────────────────────────────────────────────────────
// "COG" / "Adspent" / "Shipping Fee" label for an account's revolving-fund flags.
function revolvingLabel(a: FinanceAccount): string {
  return [a.is_cog_purchase && "COG", a.is_adspent && "Adspent", a.is_shipping_fee && "Shipping Fee"].filter(Boolean).join(", ")
}
// Hardcoded system accounts show "Default"; others Active/Inactive.
function accountStatus(a: FinanceAccount): "Default" | "Active" | "Inactive" {
  return a.hardcoded ? "Default" : (a.status === "active" ? "Active" : "Inactive")
}

const FILTER_SEL = "h-8 w-full rounded border border-slate-300 px-1.5 text-xs bg-white focus:outline-none focus:border-blue-400"

function AccountsTab({ fs }: { fs: FS }) {
  const [add, setAdd] = useState(false)
  const [editAcct, setEditAcct] = useState<FinanceAccount | null>(null)
  const [bankAcct, setBankAcct] = useState<FinanceAccount | null>(null)
  const [view, setView] = useState<FinanceAccount | null>(null)

  const [perPage, setPerPage] = useState(10)
  const [page, setPage] = useState(1)
  const [f, setF] = useState({ name: "", voucher: "All", revolving: "All", exclude: "All", status: "All", bank: "All" })
  const setFilter = (k: keyof typeof f, v: string) => { setF(p => ({ ...p, [k]: v })); setPage(1) }

  const filtered = fs.accounts.filter(a => {
    if (f.name && !a.name.toLowerCase().includes(f.name.toLowerCase())) return false
    if (f.voucher !== "All" && (f.voucher === "With Voucher ID") !== a.with_voucher) return false
    if (f.revolving !== "All") {
      if (f.revolving === "None") { if (a.is_cog_purchase || a.is_adspent || a.is_shipping_fee) return false }
      else if (f.revolving === "COG" && !a.is_cog_purchase) return false
      else if (f.revolving === "Adspent" && !a.is_adspent) return false
      else if (f.revolving === "Shipping Fee" && !a.is_shipping_fee) return false
    }
    if (f.exclude !== "All" && (f.exclude === "Yes") !== a.excluded_in_gross_revenue) return false
    if (f.status !== "All" && accountStatus(a) !== f.status) return false
    if (f.bank !== "All" && fs.bankName(a.bank_id) !== f.bank) return false
    return true
  })
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage))
  const curPage = Math.min(page, totalPages)
  const rows = filtered.slice((curPage - 1) * perPage, curPage * perPage)

  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button onClick={() => setAdd(true)}><Plus className="w-4 h-4" /> Add Account</Button>
      </div>

      {/* Records-per-page selector */}
      <div className="flex items-center gap-2 mb-3">
        <select value={perPage} onChange={e => { setPerPage(parseInt(e.target.value)); setPage(1) }}
          className="h-9 rounded-lg border border-slate-300 px-2 text-sm bg-white">
          {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <span className="text-sm text-slate-500">records</span>
      </div>

      <div className="overflow-auto border border-slate-200 rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
              {["No", "Name", "Voucher", "Revolving Fund", "Exclude in Gross Revenue", "Status", "Bank", "Actions"].map(c =>
                <th key={c} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{c}</th>)}
            </tr>
            {/* Filter row */}
            <tr className="border-b border-slate-200 bg-white">
              <th className="px-2 py-2"></th>
              <th className="px-2 py-2"><input value={f.name} onChange={e => setFilter("name", e.target.value)} placeholder="Search" className={FILTER_SEL} /></th>
              <th className="px-2 py-2">
                <select value={f.voucher} onChange={e => setFilter("voucher", e.target.value)} className={FILTER_SEL}>
                  <option>All</option><option>With Voucher ID</option><option>No Voucher ID</option>
                </select>
              </th>
              <th className="px-2 py-2">
                <select value={f.revolving} onChange={e => setFilter("revolving", e.target.value)} className={FILTER_SEL}>
                  <option>All</option><option>COG</option><option>Adspent</option><option>Shipping Fee</option><option>None</option>
                </select>
              </th>
              <th className="px-2 py-2">
                <select value={f.exclude} onChange={e => setFilter("exclude", e.target.value)} className={FILTER_SEL}>
                  <option>All</option><option>Yes</option><option>No</option>
                </select>
              </th>
              <th className="px-2 py-2">
                <select value={f.status} onChange={e => setFilter("status", e.target.value)} className={FILTER_SEL}>
                  <option>All</option><option>Default</option><option>Active</option><option>Inactive</option>
                </select>
              </th>
              <th className="px-2 py-2">
                <select value={f.bank} onChange={e => setFilter("bank", e.target.value)} className={FILTER_SEL}>
                  <option>All</option>
                  {fs.banks.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                </select>
              </th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-10 text-slate-400">No accounts found</td></tr>
            ) : rows.map(a => {
              const st = accountStatus(a)
              return (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2.5 text-slate-400">{filtered.indexOf(a) + 1}</td>
                  <td className="px-3 py-2.5 font-semibold text-slate-800">{a.name}</td>
                  <td className="px-3 py-2.5 text-slate-600">{a.with_voucher ? "With Voucher ID" : "No Voucher ID"}</td>
                  <td className="px-3 py-2.5 text-slate-600">{revolvingLabel(a)}</td>
                  <td className="px-3 py-2.5 text-slate-600">{a.excluded_in_gross_revenue ? "Yes" : "No"}</td>
                  <td className="px-3 py-2.5">
                    <span className={`px-2.5 py-0.5 rounded text-xs font-semibold text-white ${st === "Default" ? "bg-amber-400" : st === "Active" ? "bg-blue-500" : "bg-slate-400"}`}>{st}</span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{fs.bankName(a.bank_id) || "—"}</td>
                  <td className="px-3 py-2.5">
                    {a.hardcoded ? (
                      <button onClick={() => setBankAcct(a)} title="Bank assignation"
                        className="w-8 h-8 flex items-center justify-center rounded bg-amber-500 hover:bg-amber-600 text-white"><Menu className="w-4 h-4" /></button>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button onClick={() => setView(a)} title="View"
                          className="w-8 h-8 flex items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-100"><Search className="w-4 h-4" /></button>
                        <button onClick={() => fs.toggleAccount(a.id)} title={a.status === "active" ? "Deactivate" : "Activate"}
                          className={`w-8 h-8 flex items-center justify-center rounded text-white ${a.status === "active" ? "bg-teal-400 hover:bg-teal-500" : "bg-slate-300 hover:bg-slate-400"}`}><Check className="w-4 h-4" /></button>
                        <button onClick={() => fs.toggleAccountVoucher(a.id)} title="With/No Voucher"
                          className="w-8 h-8 flex items-center justify-center rounded bg-slate-200 hover:bg-slate-300 text-slate-600"><FileText className="w-4 h-4" /></button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-3 text-sm text-slate-500">
        <span>Showing {filtered.length === 0 ? 0 : (curPage - 1) * perPage + 1}–{Math.min(curPage * perPage, filtered.length)} of {filtered.length}</span>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={curPage === 1} onClick={() => setPage(curPage - 1)}>Prev</Button>
            <span>Page {curPage} of {totalPages}</span>
            <Button size="sm" variant="outline" disabled={curPage === totalPages} onClick={() => setPage(curPage + 1)}>Next</Button>
          </div>
        )}
      </div>

      {(add || editAcct) && (
        <AccountModal account={editAcct} banks={fs.activeBanks} onClose={() => { setAdd(false); setEditAcct(null) }}
          onSave={(data) => {
            if (editAcct) fs.updateAccount(editAcct.id, data)
            else fs.addAccount(data as Omit<FinanceAccount, "id" | "hardcoded" | "status">)
            setAdd(false); setEditAcct(null)
          }} />
      )}
      {bankAcct && (
        <BankAssignModal account={bankAcct} banks={fs.banks} onClose={() => setBankAcct(null)}
          onSave={(bank_id) => { fs.updateAccount(bankAcct.id, { bank_id }); setBankAcct(null) }} />
      )}
      {view && (
        <Modal title="View Account" icon={Search} onClose={() => setView(null)}>
          <div className="px-6 py-5 space-y-2 text-sm">
            <DetailRow k="Name" v={view.name} />
            <DetailRow k="Bank" v={fs.bankName(view.bank_id) || "—"} />
            <DetailRow k="Voucher" v={view.with_voucher ? "With Voucher ID" : "No Voucher ID"} />
            <DetailRow k="Revolving Fund" v={revolvingLabel(view) || "—"} />
            <DetailRow k="Exclude in Gross Revenue" v={view.excluded_in_gross_revenue ? "Yes" : "No"} />
            <DetailRow k="Members" v={view.members.join(", ") || "—"} />
            <DetailRow k="Status" v={accountStatus(view)} />
          </div>
          <div className="px-6 py-4 border-t bg-slate-50 flex justify-end gap-2">
            {!view.hardcoded && <Button onClick={() => { setEditAcct(view); setView(null) }}>Edit</Button>}
            <Button variant="outline" onClick={() => setView(null)}>Close</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function AccountModal({ account, banks, onClose, onSave }: {
  account: FinanceAccount | null
  banks: { id: string; name: string }[]
  onClose: () => void
  onSave: (data: Omit<FinanceAccount, "id" | "hardcoded" | "status">) => void
}) {
  const [f, setF] = useState<Omit<FinanceAccount, "id" | "hardcoded" | "status">>({
    name: account?.name ?? "", with_voucher: account?.with_voucher ?? true,
    bank_id: account?.bank_id ?? (banks[0]?.id ?? ""),
    is_adspent: account?.is_adspent ?? false, is_cog_purchase: account?.is_cog_purchase ?? false,
    is_shipping_fee: account?.is_shipping_fee ?? false,
    excluded_in_gross_revenue: account?.excluded_in_gross_revenue ?? false,
    members: account?.members ?? [],
  })
  const [err, setErr] = useState("")
  const set = (k: keyof typeof f, v: any) => { setF(p => ({ ...p, [k]: v })); setErr("") }
  const toggleMember = (m: string) => setF(p => ({ ...p, members: p.members.includes(m) ? p.members.filter(x => x !== m) : [...p.members, m] }))

  function submit() {
    if (!f.name.trim()) { setErr("Account name is required."); return }
    onSave({ ...f, name: f.name.trim() })
  }

  return (
    <Modal title={account ? "Edit Account" : "Add Account"} icon={Plus} onClose={onClose}>
      <div className="overflow-auto px-6 py-4 space-y-4">
        {err && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">{err}</p>}
        <div>
          <label className="text-sm text-slate-600">Name<span className="text-red-500">*</span></label>
          <Input className="mt-1.5" value={f.name} onChange={e => set("name", e.target.value)} placeholder="Account name" />
        </div>
        <label className="flex items-center justify-between gap-4">
          <span className="text-sm text-slate-700 font-medium">Is account With Voucher?</span>
          <Switch on={f.with_voucher} onClick={() => set("with_voucher", !f.with_voucher)} />
        </label>
        <div className="border border-slate-200 rounded-lg p-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Revolving Fund Account Settings</p>
          <div className="space-y-2">
            {([["is_adspent", "Adspent Account"], ["is_cog_purchase", "COG Purchase Account"], ["is_shipping_fee", "Shipping Fee Account"]] as const).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="w-4 h-4" checked={(f as any)[k]} onChange={e => set(k, e.target.checked)} /> {label}
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-center justify-between gap-4">
          <span className="text-sm text-slate-700 font-medium">Is excluded in Gross Revenue?</span>
          <Switch on={f.excluded_in_gross_revenue} onClick={() => set("excluded_in_gross_revenue", !f.excluded_in_gross_revenue)} />
        </label>
        <div>
          <label className="text-sm text-slate-600">Bank Assignation</label>
          <select className={`${SEL} mt-1.5`} value={f.bank_id} onChange={e => set("bank_id", e.target.value)}>
            <option value="">-- SELECT BANK --</option>
            {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm text-slate-600">Members</label>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5 border border-slate-200 rounded-lg p-2 max-h-40 overflow-auto">
            {MEMBERS.map(m => (
              <label key={m} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="w-4 h-4" checked={f.members.includes(m)} onChange={() => toggleMember(m)} /> {m}
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="px-6 py-4 border-t bg-slate-50 flex gap-2">
        <Button onClick={submit}>Submit</Button>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  )
}

function BankAssignModal({ account, banks, onClose, onSave }: {
  account: FinanceAccount; banks: { id: string; name: string }[]; onClose: () => void; onSave: (bankId: string) => void
}) {
  const [bankId, setBankId] = useState(account.bank_id)
  return (
    <Modal title="Edit Bank Assignation" icon={Menu} onClose={onClose}>
      <div className="px-6 py-5">
        <p className="text-sm text-slate-500 mb-3">Account: <span className="font-semibold text-slate-800">{account.name}</span></p>
        <label className="text-sm text-slate-600">Bank of assignation</label>
        <select className={`${SEL} mt-1.5`} value={bankId} onChange={e => setBankId(e.target.value)}>
          <option value="">-- SELECT BANK --</option>
          {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
      <div className="px-6 py-4 border-t bg-slate-50 flex gap-2">
        <Button onClick={() => onSave(bankId)}>Update</Button>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  )
}

// ── Small shared bits ─────────────────────────────────────────────────────────
function SimpleTable({ cols, rows }: { cols: string[]; rows: React.ReactNode }) {
  return (
    <div className="overflow-auto border border-slate-200 rounded-xl">
      <table className="w-full text-sm">
        <thead><tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
          {cols.map(c => <th key={c} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{c}</th>)}
        </tr></thead>
        <tbody className="divide-y divide-slate-100">{rows}</tbody>
      </table>
    </div>
  )
}
function DetailRow({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-4 border-b border-slate-100 py-1.5 last:border-0"><span className="text-slate-500">{k}</span><span className="font-medium text-slate-800 text-right">{v}</span></div>
}
function IconBtn({ children, onClick, title, disabled, danger }: { children: React.ReactNode; onClick: () => void; title: string; disabled?: boolean; danger?: boolean }) {
  return (
    <button onClick={onClick} title={title} disabled={disabled}
      className={`w-8 h-8 flex items-center justify-center rounded border transition-colors ${disabled ? "opacity-30 cursor-not-allowed border-slate-200 text-slate-400" : danger ? "border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-600" : "border-slate-200 text-slate-500 hover:bg-slate-100"}`}>
      {children}
    </button>
  )
}
function RowActions({ onView, active, onToggle }: { onView: () => void; active: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center gap-1">
      <IconBtn title="View" onClick={onView}><Eye className="w-4 h-4" /></IconBtn>
      <IconBtn title={active ? "Deactivate" : "Activate"} onClick={onToggle} danger={active}><Power className="w-4 h-4" /></IconBtn>
    </div>
  )
}
