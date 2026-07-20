"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Repeat, Plus, X, Pencil, Trash2, Pause, Play, AlertTriangle, DownloadCloud, CalendarClock } from "lucide-react"
import {
  useSubscriptions, isDue, nextBillDate, SUB_ACCOUNT, SUB_TYPE,
  type Subscription, type NewSubscriptionInput,
} from "@/lib/subscriptions-store"
import { useFinanceSettings } from "@/lib/finance-settings-store"
import { isMotherAccount } from "@/lib/users-store"

const SEL = "w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white focus:outline-none focus:border-blue-400"
const peso = (n: number) => "₱" + Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function Modal({ title, icon: Icon, onClose, children }: { title: string; icon?: any; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-bold text-slate-900 text-base flex items-center gap-2">{Icon && <Icon className="w-5 h-5 text-blue-600" />} {title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-auto">{children}</div>
      </div>
    </div>
  )
}

type FormState = {
  name: string; amount: string; billing_day: string; cycle: "monthly" | "yearly"; billing_month: string
  account: string; type_of_expense: string; department: string; bank: string; notes: string
}

function SubFormModal({ initial, defaultAccount, onClose, onSave }: {
  initial?: Subscription; defaultAccount: string; onClose: () => void; onSave: (input: NewSubscriptionInput) => void
}) {
  const fs = useFinanceSettings()
  const [f, setF] = useState<FormState>(initial ? {
    name: initial.name, amount: String(initial.amount), billing_day: String(initial.billing_day),
    cycle: initial.cycle, billing_month: String(initial.billing_month || 1), account: initial.account,
    type_of_expense: initial.type_of_expense, department: initial.department, bank: initial.bank, notes: initial.notes,
  } : {
    name: "", amount: "", billing_day: "1", cycle: "monthly", billing_month: "1",
    account: defaultAccount, type_of_expense: SUB_TYPE, department: fs.activeDepartments[0]?.name || "", bank: "", notes: "",
  })
  const [err, setErr] = useState("")
  const set = (k: keyof FormState, v: string) => { setF(p => ({ ...p, [k]: v })); setErr("") }

  function submit() {
    const amount = Number(f.amount)
    if (!f.name.trim() || !amount || amount <= 0 || !f.account) { setErr("Kailangan ang Name, Amount (PHP), at Account."); return }
    onSave({
      name: f.name, amount, billing_day: Number(f.billing_day) || 1, cycle: f.cycle,
      billing_month: f.cycle === "yearly" ? Number(f.billing_month) || 1 : null,
      account: f.account, type_of_expense: f.type_of_expense || SUB_TYPE,
      department: f.department, bank: f.bank, notes: f.notes,
    })
  }

  return (
    <Modal title={initial ? "Edit Subscription" : "Add Subscription"} icon={Repeat} onClose={onClose}>
      <div className="px-6 py-4 space-y-3">
        {err && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{err}</div>}
        <div>
          <label className="text-sm text-slate-600">Subscription Name <span className="text-red-500">*</span></label>
          <Input className="mt-1" value={f.name} placeholder="e.g. ChatGPT Plus, Cursor, Claude Pro" onChange={e => set("name", e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-slate-600">Amount (PHP) <span className="text-red-500">*</span></label>
            <Input className="mt-1" type="number" value={f.amount} placeholder="Eksaktong PHP na sinisingil" onChange={e => set("amount", e.target.value)} />
          </div>
          <div>
            <label className="text-sm text-slate-600">Cycle</label>
            <select className={`${SEL} mt-1`} value={f.cycle} onChange={e => set("cycle", e.target.value)}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {f.cycle === "yearly" && (
            <div>
              <label className="text-sm text-slate-600">Billing Month</label>
              <select className={`${SEL} mt-1`} value={f.billing_month} onChange={e => set("billing_month", e.target.value)}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-sm text-slate-600">Billing Day (of month)</label>
            <select className={`${SEL} mt-1`} value={f.billing_day} onChange={e => set("billing_day", e.target.value)}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-slate-600">Account <span className="text-red-500">*</span></label>
            <select className={`${SEL} mt-1`} value={f.account} onChange={e => set("account", e.target.value)}>
              <option value="">-- SELECT --</option>
              {fs.accounts.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm text-slate-600">Card / Bank charged</label>
            <select className={`${SEL} mt-1`} value={f.bank} onChange={e => set("bank", e.target.value)}>
              <option value="">-- SELECT --</option>
              {fs.activeBanks.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-slate-600">Department</label>
            <select className={`${SEL} mt-1`} value={f.department} onChange={e => set("department", e.target.value)}>
              <option value="">-- SELECT --</option>
              {fs.activeDepartments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm text-slate-600">Type of Expense</label>
            <select className={`${SEL} mt-1`} value={f.type_of_expense} onChange={e => set("type_of_expense", e.target.value)}>
              {!fs.activeTypes.some(t => t.name === SUB_TYPE) && <option value={SUB_TYPE}>{SUB_TYPE}</option>}
              {fs.activeTypes.map(t => <option key={t.id} value={t.name}>{t.name}{t.opex ? "" : " (non-OPEX)"}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="text-sm text-slate-600">Notes</label>
          <Input className="mt-1" value={f.notes} placeholder="Optional (hal. plan, seats)" onChange={e => set("notes", e.target.value)} />
        </div>
      </div>
      <div className="flex items-center gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
        <Button onClick={submit}>{initial ? "Save Changes" : "Add Subscription"}</Button>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  )
}

export default function SubscriptionsPage() {
  const store = useSubscriptions()
  const fs = useFinanceSettings()
  const admin = isMotherAccount()

  const [showAdd, setShowAdd] = useState(false)
  const [edit, setEdit] = useState<Subscription | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Subscription | null>(null)
  const [collecting, setCollecting] = useState(false)
  const [toast, setToast] = useState("")

  // Ensure a "Software Subscription" Type of Expense exists (opex=true) so subscriptions
  // count as OPEX in the Income Statement. Runs once when settings are loaded.
  const ensured = useRef(false)
  useEffect(() => {
    if (ensured.current || !fs.loaded) return
    ensured.current = true
    if (!fs.types.some(t => t.name === SUB_TYPE)) fs.addType({ name: SUB_TYPE, opex: true, type: "Debit" })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fs.loaded])

  // Default account = ang existing "subscriptions" account (case-insensitive), else "Subscriptions".
  const defaultAccount = useMemo(
    () => fs.accounts.find(a => /subscription/i.test(a.name))?.name || SUB_ACCOUNT,
    [fs.accounts])

  async function collectNow() {
    setCollecting(true)
    const r = await store.collectDue()
    setCollecting(false)
    setToast(r.posted > 0 ? `Posted ${r.posted} subscription${r.posted === 1 ? "" : "s"} (${peso(r.total)}) sa Book Keeping.` : "Walang due na subscription ngayon.")
    setTimeout(() => setToast(""), 4000)
  }

  return (
    <div className="space-y-4">
      <span className="text-sm text-slate-500 font-medium">Finance / Subscriptions</span>

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4 pb-4 border-b border-slate-100">
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Repeat className="w-5 h-5" /> SUBSCRIPTIONS</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={collectNow} disabled={collecting || store.dueCount === 0}>
              <DownloadCloud className={`w-4 h-4 ${collecting ? "animate-pulse" : ""}`} /> Collect due{store.dueCount > 0 ? ` (${store.dueCount})` : ""}
            </Button>
            <Button onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Add Subscription</Button>
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Est. Monthly</p>
            <p className="text-xl font-extrabold text-slate-800 tabular-nums">{peso(store.monthlyTotal)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Active</p>
            <p className="text-xl font-extrabold text-emerald-600 tabular-nums">{store.subs.filter(s => s.status === "active").length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Due now</p>
            <p className="text-xl font-extrabold text-amber-600 tabular-nums">{store.dueCount}</p>
          </div>
        </div>

        {toast && <div className="mb-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-700">{toast}</div>}

        {!store.loaded ? (
          <p className="text-sm text-slate-400 italic py-10 text-center">Loading…</p>
        ) : store.subs.length === 0 ? (
          <p className="text-sm text-slate-400 italic py-10 text-center">Wala pang subscriptions — i-click ang “Add Subscription” para magdagdag ng AI tools / SaaS mo.</p>
        ) : (
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-[11px] font-semibold uppercase tracking-wide border-b border-slate-200">
                    <th className="px-4 py-3 text-left">Subscription</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-left">Billing</th>
                    <th className="px-4 py-3 text-left">Card / Bank</th>
                    <th className="px-4 py-3 text-left">Account</th>
                    <th className="px-4 py-3 text-left">Next Bill</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {store.subs.map(s => {
                    const due = isDue(s)
                    return (
                      <tr key={s.id} className={`hover:bg-slate-50/70 transition-colors ${s.status === "paused" ? "opacity-60" : ""}`}>
                        <td className="px-4 py-3 min-w-[180px]">
                          <p className="font-semibold text-slate-800 leading-tight">{s.name}</p>
                          {s.notes && <p className="text-xs text-slate-400 leading-tight mt-0.5 max-w-[220px] truncate" title={s.notes}>{s.notes}</p>}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-800 whitespace-nowrap">{peso(s.amount)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                          {s.cycle === "yearly" ? `${MONTHS[(s.billing_month || 1) - 1]} ${s.billing_day} · Yearly` : `Day ${s.billing_day} · Monthly`}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-600">{s.bank || <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-600">{s.account}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 text-slate-600 font-mono text-xs"><CalendarClock className="w-3.5 h-3.5 text-slate-400" /> {nextBillDate(s)}</span>
                          {due && <span className="ml-2 inline-block rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-[10px] font-bold uppercase">Due</span>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {s.status === "active"
                            ? <span className="inline-block rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1 text-xs font-semibold">Active</span>
                            : <span className="inline-block rounded-full bg-slate-100 text-slate-500 px-2.5 py-1 text-xs font-semibold">Paused</span>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center justify-end gap-0.5">
                            <button title={s.status === "active" ? "Pause" : "Resume"} onClick={() => store.toggleStatus(s.id)}
                              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700">
                              {s.status === "active" ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                            </button>
                            <button title="Edit" onClick={() => setEdit(s)}
                              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"><Pencil className="w-4 h-4" /></button>
                            {admin && (
                              <button title="Delete (admin)" onClick={() => setConfirmDelete(s)}
                                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="text-[11px] text-slate-400 mt-3 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          Auto-posted sa Book Keeping ({defaultAccount}) tuwing billing day via daily scheduled task — exact PHP amount, dedup per cycle (isang beses kada buwan/taon). Mananatiling OPEX sa Income Statement.
        </p>
      </div>

      {showAdd && <SubFormModal defaultAccount={defaultAccount} onClose={() => setShowAdd(false)} onSave={input => { store.addSub(input); setShowAdd(false) }} />}
      {edit && <SubFormModal initial={edit} defaultAccount={defaultAccount} onClose={() => setEdit(null)} onSave={input => { store.updateSub(edit.id, input); setEdit(null) }} />}

      {confirmDelete && (
        <Modal title="Delete Subscription" icon={AlertTriangle} onClose={() => setConfirmDelete(null)}>
          <div className="px-6 py-5 text-sm text-slate-700">
            Sigurado ka bang buburahin ang <span className="font-semibold">{confirmDelete.name}</span>? Hindi na ito mako-collect sa susunod na billing. (Ang naunang na-post na Book Keeping entries ay mananatili.)
          </div>
          <div className="px-6 py-4 border-t bg-slate-50 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={() => { store.removeSub(confirmDelete.id); setConfirmDelete(null) }}>Delete</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
