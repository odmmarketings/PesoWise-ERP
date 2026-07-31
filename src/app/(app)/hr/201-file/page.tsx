"use client"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Users, RefreshCw, Search, X, Pencil, ChevronLeft, ChevronRight, Settings, Trash2, AlertTriangle,
} from "lucide-react"
import {
  useHrEmployees, type HrEmployee, type EmployeeStatus, EMPLOYEE_STATUSES, uid, fullNameOf,
} from "@/lib/hr-store"
import { isMotherAccount } from "@/lib/users-store"

// ──────────────────────────────────────────────────────────────────────────────
// 201 FILE — replica ng LHIKE HRIS employee master: table na may per-column
// filter row (Employee No / Name / Position / Status dropdown / BIO ID / DTR
// Username), status na may kulay (Active teal · Resigned red · atbp.), at
// view/edit actions. Ito ang pinagkukunan ng HR Dashboard stats at ng ODM DTR
// profile matching (company_email ↔ PesoWise login).
// ──────────────────────────────────────────────────────────────────────────────

const STATUS_CLASS: Record<string, string> = {
  Active: "text-teal-600", Inactive: "text-slate-500", Resigned: "text-rose-600", Terminated: "text-rose-700",
}

const EMPTY: Omit<HrEmployee, "id" | "created_at" | "updated_at"> = {
  employee_no: "", first_name: "", middle_name: "", last_name: "", position: "", department: "", branch: "",
  status: "Active", gender: "", birthdate: "", date_hired: "", date_separated: "",
  company_email: "", personal_email: "", contact_no: "", bio_id: "", dtr_username: "", notes: "",
}

const INP = "w-full h-9 rounded-lg border border-slate-300 px-2 text-sm bg-white focus:outline-none focus:border-blue-400"

export default function Hr201FilePage() {
  const store = useHrEmployees()
  const [screen, setScreen] = useState<"list" | "form" | "view">("list")
  const [editing, setEditing] = useState<HrEmployee | null>(null)
  const [confirmDel, setConfirmDel] = useState<HrEmployee | null>(null)
  const [toast, setToast] = useState("")
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500) }

  // Filters — kapareho ng LHIKE: isang input kada column
  const [f, setF] = useState({ no: "", name: "", position: "", status: "All", bio: "", dtr: "" })
  const [perPage, setPerPage] = useState(10)
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => store.rows.filter(e => {
    if (f.no && !e.employee_no.toLowerCase().includes(f.no.toLowerCase())) return false
    if (f.name && !fullNameOf(e).toLowerCase().includes(f.name.toLowerCase())) return false
    if (f.position && !e.position.toLowerCase().includes(f.position.toLowerCase())) return false
    if (f.status !== "All" && e.status !== f.status) return false
    if (f.bio && !e.bio_id.toLowerCase().includes(f.bio.toLowerCase())) return false
    if (f.dtr && !e.dtr_username.toLowerCase().includes(f.dtr.toLowerCase())) return false
    return true
  }), [store.rows, f])

  const pages = Math.max(1, Math.ceil(filtered.length / perPage))
  const pageSafe = Math.min(page, pages)
  const paginated = filtered.slice((pageSafe - 1) * perPage, pageSafe * perPage)

  if (!isMotherAccount()) {
    return <p className="text-sm text-slate-500 py-10 text-center">HR Mode is for the Mother Account only.</p>
  }

  if (screen !== "list") {
    return <EmployeeForm mode={screen} initial={editing}
      onBack={() => { setScreen("list"); setEditing(null) }}
      onSave={async input => {
        const now = new Date().toISOString()
        if (editing) { await store.update(editing.id, { ...input, updated_at: now }); flash("Employee updated.") }
        else { await store.add({ ...input, id: uid("emp"), created_at: now, updated_at: now }); flash("Employee added to 201 File.") }
        setScreen("list"); setEditing(null)
      }} />
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      {toast && <div className="fixed top-20 right-6 z-50 bg-slate-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-xl">{toast}</div>}

      <div className="flex items-center justify-between flex-wrap gap-2 pb-4 border-b border-slate-100">
        <h1 className="flex items-center gap-2 text-lg font-bold text-blue-600"><Users className="w-5 h-5" /> 201 FILE</h1>
        <div className="flex items-center gap-2">
          <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => { setEditing(null); setScreen("form") }}>
            <Settings className="w-4 h-4" /> Add Employee
          </Button>
          <button onClick={() => store.refresh()} title="Refresh"
            className="h-10 w-10 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50 flex items-center justify-center">
            <RefreshCw className={`w-4 h-4 ${!store.loaded ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-500 mt-4">
        <select className="h-9 rounded-lg border border-slate-300 px-2 text-sm bg-white" value={perPage}
          onChange={e => { setPerPage(parseInt(e.target.value)); setPage(1) }}>
          {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
        </select> records
      </label>

      <div className="overflow-x-auto mt-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              {["No", "Employee No", "Name", "Position", "Status", "BIO ID", "DTR Username", "Actions"].map(h => (
                <th key={h} className="px-3 py-3 whitespace-nowrap">{h}</th>
              ))}
            </tr>
            <tr className="border-b border-slate-200 bg-white">
              <th className="px-2 py-2" />
              <th className="px-2 py-2"><input className={INP} value={f.no} onChange={e => { setF(p => ({ ...p, no: e.target.value })); setPage(1) }} /></th>
              <th className="px-2 py-2 min-w-[160px]"><input className={INP} value={f.name} onChange={e => { setF(p => ({ ...p, name: e.target.value })); setPage(1) }} /></th>
              <th className="px-2 py-2"><input className={INP} value={f.position} onChange={e => { setF(p => ({ ...p, position: e.target.value })); setPage(1) }} /></th>
              <th className="px-2 py-2">
                <select className={INP} value={f.status} onChange={e => { setF(p => ({ ...p, status: e.target.value })); setPage(1) }}>
                  {["All", ...EMPLOYEE_STATUSES].map(s => <option key={s}>{s}</option>)}
                </select>
              </th>
              <th className="px-2 py-2"><input className={INP} value={f.bio} onChange={e => { setF(p => ({ ...p, bio: e.target.value })); setPage(1) }} /></th>
              <th className="px-2 py-2"><input className={INP} value={f.dtr} onChange={e => { setF(p => ({ ...p, dtr: e.target.value })); setPage(1) }} /></th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {!store.loaded && <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400 italic">Loading&hellip;</td></tr>}
            {store.loaded && paginated.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400 italic">
                {store.rows.length === 0 ? <>No employees yet — click <strong>Add Employee</strong> to start the 201 File.</> : "No employees match the filters."}
              </td></tr>
            )}
            {paginated.map((e, i) => (
              <tr key={e.id} className={`border-b border-slate-100 ${i % 2 ? "bg-slate-50" : "bg-white"} hover:bg-blue-50/40`}>
                <td className="px-3 py-3 text-slate-400">{(pageSafe - 1) * perPage + i + 1}</td>
                <td className="px-3 py-3 font-semibold text-slate-700 whitespace-nowrap">{e.employee_no || "—"}</td>
                <td className="px-3 py-3 text-slate-800 whitespace-nowrap">{fullNameOf(e) || "—"}</td>
                <td className="px-3 py-3 text-slate-600 whitespace-nowrap">{e.position || "—"}</td>
                <td className={`px-3 py-3 font-semibold whitespace-nowrap ${STATUS_CLASS[e.status] || "text-slate-600"}`}>{e.status}</td>
                <td className="px-3 py-3 text-slate-600">{e.bio_id || "—"}</td>
                <td className="px-3 py-3">{e.dtr_username ? <span className="text-slate-700">{e.dtr_username}</span> : <span className="text-amber-500">Not Registered</span>}</td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => { setEditing(e); setScreen("view") }} title="View"
                      className="h-8 w-8 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center"><Search className="w-3.5 h-3.5" /></button>
                    <button onClick={() => { setEditing(e); setScreen("form") }} title="Edit"
                      className="h-8 w-8 rounded-lg bg-teal-500 hover:bg-teal-600 text-white flex items-center justify-center"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setConfirmDel(e)} title="Delete"
                      className="h-8 w-8 rounded-lg text-slate-300 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2 mt-3 text-sm text-slate-600">
        <span>Showing {filtered.length === 0 ? 0 : (pageSafe - 1) * perPage + 1} to {Math.min(pageSafe * perPage, filtered.length)} of {filtered.length} entries</span>
        <div className="flex items-center gap-1">
          <button disabled={pageSafe <= 1} onClick={() => setPage(p => p - 1)} className="w-8 h-8 rounded border border-slate-300 flex items-center justify-center disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
          <span className="w-8 h-8 rounded border bg-blue-600 border-blue-600 text-white flex items-center justify-center">{pageSafe}</span>
          <button disabled={pageSafe >= pages} onClick={() => setPage(p => p + 1)} className="w-8 h-8 rounded border border-slate-300 flex items-center justify-center disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      {confirmDel && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setConfirmDel(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-rose-600" />
              <h2 className="text-base font-bold text-slate-800">Delete this employee record?</h2>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-slate-600">This removes <strong>{fullNameOf(confirmDel)}</strong> from the 201 File. For someone who left the company, set the status to <strong>Resigned</strong> or <strong>Terminated</strong> instead — deleting erases the record entirely.</p>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
              <button onClick={() => setConfirmDel(null)} className="h-9 px-4 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={async () => { await store.remove(confirmDel.id); setConfirmDel(null); flash("Employee record deleted.") }}
                className="h-9 px-4 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Add/Edit/View — full-page form gaya ng LHIKE (hindi maliit na modal) ──────
function EmployeeForm({ mode, initial, onBack, onSave }: {
  mode: "form" | "view"
  initial: HrEmployee | null
  onBack: () => void
  onSave: (input: Omit<HrEmployee, "id" | "created_at" | "updated_at">) => Promise<void>
}) {
  const [d, setD] = useState({ ...EMPTY, ...(initial || {}) })
  const [err, setErr] = useState("")
  const [saving, setSaving] = useState(false)
  const view = mode === "view"
  const set = (k: keyof typeof EMPTY, v: string) => setD(p => ({ ...p, [k]: v }))

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="grid grid-cols-[150px_1fr] items-center gap-3">
      <span className="text-sm text-slate-600 text-right pr-2">{label}</span>
      {children}
    </div>
  )
  const V = ({ v }: { v: string }) => <span className="text-sm text-slate-800 py-2">{v || "—"}</span>

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft className="w-4 h-4" /> Back to 201 File</button>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-4xl">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 pb-4 mb-5 border-b border-slate-100">
          <Users className="w-5 h-5" /> {view ? "VIEW EMPLOYEE" : initial ? "EDIT EMPLOYEE" : "ADD EMPLOYEE"}
        </h1>
        {err && <p className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 flex items-center gap-2"><X className="w-4 h-4" /> {err}</p>}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-3">
          <Row label="Employee No.">{view ? <V v={d.employee_no} /> : <Input value={d.employee_no} placeholder="e.g. U-3" onChange={e => set("employee_no", e.target.value)} />}</Row>
          <Row label="Status">{view ? <V v={d.status} /> : (
            <select className={INP} value={d.status} onChange={e => set("status", e.target.value as EmployeeStatus)}>
              {EMPLOYEE_STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          )}</Row>
          <Row label="First Name">{view ? <V v={d.first_name} /> : <Input value={d.first_name} onChange={e => set("first_name", e.target.value)} />}</Row>
          <Row label="Middle Name">{view ? <V v={d.middle_name} /> : <Input value={d.middle_name} onChange={e => set("middle_name", e.target.value)} />}</Row>
          <Row label="Last Name">{view ? <V v={d.last_name} /> : <Input value={d.last_name} onChange={e => set("last_name", e.target.value)} />}</Row>
          <Row label="Gender">{view ? <V v={d.gender} /> : (
            <select className={INP} value={d.gender} onChange={e => set("gender", e.target.value)}>
              <option value="">—</option><option>Male</option><option>Female</option>
            </select>
          )}</Row>
          <Row label="Birthdate">{view ? <V v={d.birthdate} /> : <input type="date" className={INP} value={d.birthdate} onChange={e => set("birthdate", e.target.value)} />}</Row>
          <Row label="Position">{view ? <V v={d.position} /> : <Input value={d.position} onChange={e => set("position", e.target.value)} />}</Row>
          <Row label="Department">{view ? <V v={d.department} /> : <Input value={d.department} onChange={e => set("department", e.target.value)} />}</Row>
          <Row label="Branch">{view ? <V v={d.branch} /> : <Input value={d.branch} onChange={e => set("branch", e.target.value)} />}</Row>
          <Row label="Date Hired">{view ? <V v={d.date_hired} /> : <input type="date" className={INP} value={d.date_hired} onChange={e => set("date_hired", e.target.value)} />}</Row>
          <Row label="Date Separated">{view ? <V v={d.date_separated} /> : <input type="date" className={INP} value={d.date_separated} onChange={e => set("date_separated", e.target.value)} />}</Row>
          <Row label="Company Email">{view ? <V v={d.company_email} /> : <Input value={d.company_email} placeholder="PesoWise login — ODM DTR matching" onChange={e => set("company_email", e.target.value)} />}</Row>
          <Row label="Personal Email">{view ? <V v={d.personal_email} /> : <Input value={d.personal_email} onChange={e => set("personal_email", e.target.value)} />}</Row>
          <Row label="Contact No.">{view ? <V v={d.contact_no} /> : <Input value={d.contact_no} onChange={e => set("contact_no", e.target.value)} />}</Row>
          <Row label="BIO ID">{view ? <V v={d.bio_id} /> : <Input value={d.bio_id} onChange={e => set("bio_id", e.target.value)} />}</Row>
          <Row label="DTR Username">{view ? <V v={d.dtr_username} /> : <Input value={d.dtr_username} onChange={e => set("dtr_username", e.target.value)} />}</Row>
          <Row label="Notes">{view ? <V v={d.notes} /> : <Input value={d.notes} onChange={e => set("notes", e.target.value)} />}</Row>
        </div>

        {!view && (
          <div className="flex justify-center gap-2 pt-6">
            <Button disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white" onClick={async () => {
              if (!d.first_name.trim() && !d.last_name.trim()) { setErr("Name is required."); return }
              setSaving(true)
              try { await onSave(d) } catch (e: any) { setErr(e?.message || "Could not save.") } finally { setSaving(false) }
            }}>{saving ? "Saving…" : "Save"}</Button>
            <Button variant="outline" onClick={onBack}>Cancel</Button>
          </div>
        )}
      </div>
    </div>
  )
}
