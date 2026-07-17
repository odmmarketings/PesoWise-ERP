"use client"
import { useState, useMemo, useEffect } from "react"
import {
  Users, X, Check, ChevronLeft, ChevronRight, Plus, Image as ImageIcon, Shield, Trash2,
} from "lucide-react"
import { useErpUsers, EMPLOYMENT_STATUSES, DELETE_GRACE_MS, getCompanyLogo, setCompanyLogo, type ErpUser, type EmploymentStatus } from "@/lib/users-store"
import { businessNav } from "@/components/layout/Sidebar"

// USER MANAGEMENT (LHIKE manual) — user roster table (ID/Username/Full Name/Position/Login
// info/Actions), search + records + pagination, Enabled/Disabled per user, Edit user (click
// the username; employment status Active/Inactive/Resigned/Terminated), CHANGE ROLE screen
// (permission checkboxes per sidebar section + Mother Account = all access), Add New User
// (starts Pending + disabled → request access sa login page → admin enables), and
// Edit/Upload Company Logo (shown sa login page).

const INP = "w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white focus:outline-none focus:border-blue-400"
const fmtDT = (s: string) => s ? `${s.slice(0, 10)} ${s.slice(11, 16)}` : "—"
const daysLeft = (iso: string) => Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000))

// Module-level row wrapper — NEVER define this inside a form component (it remounts the
// inputs on every keystroke and drops focus).
function FormRowU({ l, req = false, children }: { l: string; req?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] items-center gap-3 py-1.5">
      <span className="text-sm text-slate-600 text-right pr-2">{l} {req && <span className="text-red-500">*</span>}</span>
      {children}
    </div>
  )
}
function HalfRow({ l, req = false, children }: { l: string; req?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] items-center gap-3">
      <span className="text-sm text-slate-600 text-right pr-1">{l} {req && <span className="text-red-500">*</span>}</span>
      {children}
    </div>
  )
}

export default function UserManagementPage() {
  const store = useErpUsers()
  const [screen, setScreen] = useState<"list" | "add" | "edit" | "role" | "logo">("list")
  const [activeId, setActiveId] = useState("")
  const [q, setQ] = useState("")
  const [perPage, setPerPage] = useState(10)
  const [page, setPage] = useState(1)
  const [toast, setToast] = useState("")
  const [confirmDel, setConfirmDel] = useState<ErpUser | null>(null)
  const [confirmEnable, setConfirmEnable] = useState<ErpUser | null>(null)
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500) }
  const active = store.users.find(u => u.id === activeId) || null

  const [sort, setSort] = useState<{ key: "id" | "username" | "full_name" | "position" | "last_login"; dir: "asc" | "desc" }>({ key: "id", dir: "asc" })
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    const base = !s ? store.users : store.users.filter(u => [u.id, u.username, u.full_name, u.position, u.email].some(v => String(v).toLowerCase().includes(s)))
    const dir = sort.dir === "asc" ? 1 : -1
    return [...base].sort((a, b) => String(a[sort.key] || "").localeCompare(String(b[sort.key] || ""), undefined, { numeric: true }) * dir)
  }, [store.users, q, sort])
  const pages = Math.max(1, Math.ceil(filtered.length / perPage))
  const pageSafe = Math.min(page, pages)
  const paginated = filtered.slice((pageSafe - 1) * perPage, pageSafe * perPage)
  const showFrom = filtered.length === 0 ? 0 : (pageSafe - 1) * perPage + 1
  const showTo = Math.min(pageSafe * perPage, filtered.length)

  const toastEl = toast ? (
    <div className="fixed top-4 right-4 z-[70] bg-emerald-600 text-white text-sm rounded-xl px-5 py-3 shadow-lg flex items-center gap-2">
      <Check className="w-4 h-4" /> <div><p className="font-semibold">Success</p><p className="text-emerald-100">{toast}</p></div>
    </div>
  ) : null

  if (screen === "add" || (screen === "edit" && active))
    return <>{toastEl}<UserFormScreen mode={screen} initial={screen === "edit" ? active! : undefined}
      onBack={() => setScreen("list")}
      onRemove={screen === "edit" && active ? () => { setScreen("list"); setConfirmDel(active) } : undefined}
      onSave={input => {
        if (screen === "edit" && active) { store.updateUser(active.id, input); flash("User updated successfully.") }
        else { store.addUser({ ...input, username: "", enabled: false, pending: true, mother: false, allowed: [] }); flash("User added — PENDING pa ito; kailangan niyang mag-request ng access sa login page bago i-enable.") }
        setScreen("list")
      }} /></>

  if (screen === "role" && active)
    return <>{toastEl}<ChangeRoleScreen user={active}
      onBack={() => setScreen("list")}
      onSave={(mother, allowed) => { store.updateUser(active.id, { mother, allowed }); flash(`Role updated for ${active.full_name || active.username}.`); setScreen("list") }} /></>

  if (screen === "logo")
    return <>{toastEl}<LogoScreen onBack={() => setScreen("list")} onSaved={() => { flash("Company logo updated — makikita na ito sa login page."); setScreen("list") }} /></>

  return (
    <div className="space-y-4 relative">
      {toastEl}

      {/* Enable confirm */}
      {confirmEnable && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setConfirmEnable(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0"><Check className="w-5 h-5 text-blue-600" /></div>
              <h2 className="text-lg font-bold text-slate-900">Enable access?</h2>
            </div>
            <p className="text-sm text-slate-600">Bibigyan si <strong>{confirmEnable.full_name || confirmEnable.username}</strong> ng access sa PesoWise ERP gamit ang username na <strong>{confirmEnable.username}</strong>.</p>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setConfirmEnable(null)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50">Cancel</button>
              <button onClick={() => { store.updateUser(confirmEnable.id, { enabled: true, pending: false }); flash(`${confirmEnable.username} enabled — pwede na siyang gumamit ng ERP.`); setConfirmEnable(null) }} className="px-5 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700">Enable</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setConfirmDel(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0"><Trash2 className="w-5 h-5 text-red-600" /></div>
              <h2 className="text-lg font-bold text-slate-900">Remove user?</h2>
            </div>
            <p className="text-sm text-slate-600">Ilalagay si <strong>{confirmDel.full_name || confirmDel.username}</strong> sa pending deletion. Permanente na siyang mababawi sa roster pagkalipas ng <strong>3 araw</strong> — pwede pa ring i-undo bago iyon.</p>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDel(null)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50">Cancel</button>
              <button onClick={() => { store.updateUser(confirmDel.id, { deleteAt: new Date(Date.now() + DELETE_GRACE_MS).toISOString() }); flash(`${confirmDel.full_name || confirmDel.username} ay ide-delete pagkalipas ng 3 araw — pwede pang i-undo.`); setConfirmDel(null) }} className="px-5 py-2 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700">Remove</button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2 pb-4 border-b border-slate-100">
          <h1 className="flex items-center gap-2 text-xl font-extrabold text-blue-600 tracking-wide"><Users className="w-6 h-6" /> USER MANAGEMENT</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => { setActiveId(""); setScreen("add") }} className="h-9 px-3.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center gap-1.5"><Plus className="w-4 h-4" /> Add User</button>
            <button onClick={() => setScreen("logo")} className="h-9 px-3.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center gap-1.5"><ImageIcon className="w-4 h-4" /> Add Company Logo</button>
          </div>
        </div>

        {/* Toolbar bar — records left, Search right (LHIKE) */}
        <div className="flex items-center justify-between flex-wrap gap-2 mt-4 border border-slate-200 rounded-lg px-3 py-2">
          <label className="flex items-center gap-2 text-sm text-slate-500">
            <select className="h-8 rounded border border-slate-300 px-2 text-sm bg-white" value={perPage} onChange={e => { setPerPage(parseInt(e.target.value)); setPage(1) }}>
              {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select> records
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Search:
            <input value={q} onChange={e => { setQ(e.target.value); setPage(1) }}
              className="h-8 w-56 rounded border border-slate-300 px-2 text-sm focus:outline-none focus:border-blue-400" />
          </label>
        </div>

        {/* Table — LHIKE columns: ID / Username / Full Name / Position / Last Login / Action */}
        <div className="overflow-x-auto scrollbar-dark mt-3">
          <table className="w-full text-sm border border-slate-200">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left">
                {([["id", "ID"], ["username", "Username"], ["full_name", "Full Name"], ["position", "Position"], ["last_login", "Last Login"]] as const).map(([k, l]) => (
                  <th key={k} className="px-4 py-2.5 font-bold text-slate-700 whitespace-nowrap border-r border-slate-200">
                    <button onClick={() => setSort(s => s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "asc" })}
                      className="flex items-center gap-1 hover:text-blue-600">
                      {l} <span className="text-slate-300 text-[10px]">{sort.key === k ? (sort.dir === "asc" ? "▲" : "▼") : "⇅"}</span>
                    </button>
                  </th>
                ))}
                <th className="px-4 py-2.5 font-bold text-slate-700 whitespace-nowrap">Action</th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-slate-400 text-sm">
                  {store.users.length === 0 ? <>Walang users pa. I-click ang <strong>Add User</strong> para magdagdag.</> : "No users match the search."}
                </td></tr>
              ) : paginated.map((u, i) => (
                <tr key={u.id} className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50"} hover:bg-blue-50/40 ${u.deleteAt ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap border-r border-slate-100">{u.id}</td>
                  <td className="px-4 py-3 border-r border-slate-100 whitespace-nowrap">
                    <button onClick={() => { setActiveId(u.id); setScreen("edit") }} className="text-blue-600 underline hover:text-blue-800 font-medium">{u.username || "—"}</button>
                    {u.pending && !u.deleteAt && <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">{u.requested ? "REQUESTED" : "PENDING"}</span>}
                    {u.mother && <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700">MOTHER</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-800 border-r border-slate-100">{u.full_name || "—"}</td>
                  <td className="px-4 py-3 text-slate-600 border-r border-slate-100">{u.position || ""}</td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap border-r border-slate-100">{u.last_login || ""}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {u.deleteAt ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-red-500">Deleting in {daysLeft(u.deleteAt)}d</span>
                        <button onClick={() => { store.updateUser(u.id, { deleteAt: "" }); flash(`Na-undo ang deletion ni ${u.full_name || u.username}.`) }}
                          className="h-7 px-2.5 rounded-md border border-slate-300 text-slate-600 text-xs font-semibold hover:bg-slate-50">Undo</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        {!u.username ? (
                          <span className="inline-flex h-8 items-center px-4 rounded-md border border-dashed border-slate-300 text-slate-400 text-xs font-bold tracking-wide">NO REQUEST ACCESS</span>
                        ) : (
                          <>
                            <button onClick={() => { setActiveId(u.id); setScreen("role") }}
                              className="h-8 px-3 rounded-md bg-teal-500 hover:bg-teal-600 text-white text-xs font-semibold">Change Role</button>
                            <button onClick={() => { if (u.enabled) { store.updateUser(u.id, { enabled: false }); flash(`${u.username} disabled.`) } else { setConfirmEnable(u) } }}
                              type="button" role="switch" aria-checked={u.enabled}
                              title={u.enabled ? "I-click para i-disable" : "I-click para i-enable"}
                              className="flex items-center gap-2">
                              <span className={`text-xs font-semibold w-14 ${u.enabled ? "text-blue-600" : "text-slate-400"}`}>{u.enabled ? "Enabled" : "Disabled"}</span>
                              <span className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${u.enabled ? "bg-blue-600" : "bg-slate-300"}`}>
                                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${u.enabled ? "translate-x-5" : "translate-x-0.5"}`} />
                              </span>
                            </button>
                          </>
                        )}
                        <button onClick={() => setConfirmDel(u)} title="Remove user"
                          className="text-slate-300 hover:text-red-500 transition-colors shrink-0 ml-1">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between flex-wrap gap-2 mt-3 text-sm text-slate-600">
          <span>Showing {showFrom} to {showTo} of {filtered.length} entries</span>
          <div className="flex items-center gap-1">
            <button disabled={pageSafe <= 1} onClick={() => setPage(p => p - 1)} className="w-8 h-8 rounded border border-slate-300 flex items-center justify-center disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
            <span className="w-8 h-8 rounded bg-blue-600 text-white flex items-center justify-center text-sm">{pageSafe}</span>
            <button disabled={pageSafe >= pages} onClick={() => setPage(p => p + 1)} className="w-8 h-8 rounded border border-slate-300 flex items-center justify-center disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>

        <p className="text-[11px] text-slate-400 mt-3">Ang username / full name / email dito ay dapat tumugma sa PesoWise account ng empleyado — iyon ang basehan ng sidebar permissions pag naka-login sila. Walang record sa roster (o Mother Account) = full access.</p>
      </div>
    </div>
  )
}

// ── Add / Edit user — LHIKE "Edit user information" layout: Employee No. (readonly) +
// Last/First/Middle Name full-width, then two-column (Birthdate|Contact, Personal|Company
// Email, Gender|Position, Employment Date|Status), ✓Save + Cancel right-aligned. ──
function UserFormScreen({ mode, initial, onBack, onSave, onRemove }: {
  mode: "add" | "edit"; initial?: ErpUser
  onBack: () => void
  onSave: (input: { full_name: string; last_name: string; first_name: string; middle_name: string; birthdate: string; personal_email: string; gender: "" | "Male" | "Female"; employment_date: string; position: string; email: string; contact: string; status: EmploymentStatus }) => void
  onRemove?: () => void
}) {
  const [f, setF] = useState({
    last_name: initial?.last_name || (initial?.full_name ? initial.full_name.split(" ").slice(-1)[0] : ""),
    first_name: initial?.first_name || (initial?.full_name ? initial.full_name.split(" ").slice(0, -1).join(" ") : ""),
    middle_name: initial?.middle_name || "",
    birthdate: initial?.birthdate || "",
    contact: initial?.contact || "",
    personal_email: initial?.personal_email || "",
    email: initial?.email || "",
    gender: (initial?.gender || "") as "" | "Male" | "Female",
    position: initial?.position || "",
    employment_date: initial?.employment_date || "",
    status: (initial?.status || "Active") as EmploymentStatus,
  })
  const [err, setErr] = useState("")
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }))
  const F = FormRowU
  const HALF = HalfRow   // module-level (inline definition = focus loss per keystroke)
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft className="w-4 h-4" /> Back to User Management</button>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-4xl">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 pb-4 mb-4 border-b border-slate-100"><Users className="w-5 h-5" /> {mode === "add" ? "ADD NEW USER" : "EDIT USER INFORMATION"}</h1>
        {/* Full-width rows (LHIKE top block) */}
        <F l="Employee No." req><div className={`${INP} bg-slate-100 text-slate-500 flex items-center max-w-md`}>{initial?.id || "Auto (U-n)"}</div></F>
        {mode === "edit" && (
          <F l="Username">
            <div className={`${INP} max-w-md flex items-center ${initial?.username ? "text-slate-700" : "text-slate-400 italic"}`}>
              {initial?.username || "Not yet requested — hihintayin ang Request Access ng employee"}
            </div>
          </F>
        )}
        <F l="Last Name" req><input className={INP} value={f.last_name} onChange={e => set("last_name", e.target.value)} /></F>
        <F l="First Name" req><input className={INP} value={f.first_name} onChange={e => set("first_name", e.target.value)} /></F>
        <F l="Middle Name"><input className={INP} value={f.middle_name} onChange={e => set("middle_name", e.target.value)} /></F>
        {/* Two-column block */}
        <div className="grid md:grid-cols-2 gap-x-6 gap-y-3 mt-3">
          <HALF l="Birthdate"><input type="date" className={INP} value={f.birthdate} onChange={e => set("birthdate", e.target.value)} /></HALF>
          <HALF l="Contact Number"><input className={INP} value={f.contact} onChange={e => set("contact", e.target.value)} /></HALF>
          <HALF l="Personal Email"><input className={INP} value={f.personal_email} onChange={e => set("personal_email", e.target.value)} /></HALF>
          <HALF l="Company Email"><input className={INP} value={f.email} onChange={e => set("email", e.target.value)} placeholder="ang email ng PesoWise account" /></HALF>
          <HALF l="Gender">
            <div className="flex items-center gap-4 h-10">
              {(["Male", "Female"] as const).map(g => (
                <label key={g} className="flex items-center gap-1.5 text-sm text-slate-700 cursor-pointer">
                  <input type="radio" checked={f.gender === g} onChange={() => set("gender", g)} className="accent-blue-600" /> {g}
                </label>
              ))}
            </div>
          </HALF>
          <HALF l="Position"><input className={INP} value={f.position} onChange={e => set("position", e.target.value)} /></HALF>
          <HALF l="Employment Date" req><input type="date" className={INP} value={f.employment_date} onChange={e => set("employment_date", e.target.value)} /></HALF>
          <HALF l="Employment Status" req>
            <select className={INP} value={f.status} onChange={e => set("status", e.target.value)}>
              {EMPLOYMENT_STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          </HALF>
        </div>
        {mode === "add" && (
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-4">Ang bagong user ay magsisimulang <strong>PENDING at DISABLED</strong> — magre-request siya ng access mula sa login page, tapos ikaw ang mag-e-ENABLE dito.</p>
        )}
        {err && <p className="text-sm text-rose-600 mt-3">{err}</p>}
        {/* Save + Cancel — right-aligned (LHIKE 2.2) */}
        <div className="flex items-center gap-2 mt-5 pt-4 border-t border-slate-100">
          {onRemove && (
            <button onClick={onRemove} className="px-4 py-2 rounded-lg border border-red-200 text-red-600 font-semibold hover:bg-red-50 flex items-center gap-1.5"><Trash2 className="w-4 h-4" /> Remove user</button>
          )}
          <div className="ml-auto flex gap-2">
            <button onClick={() => {
              if (!f.last_name.trim()) return setErr("Last Name is required.")
              if (!f.first_name.trim()) return setErr("First Name is required.")
              onSave({
                ...f,
                last_name: f.last_name.trim(), first_name: f.first_name.trim(),
                middle_name: f.middle_name.trim(), personal_email: f.personal_email.trim(), email: f.email.trim(),
                contact: f.contact.trim(), position: f.position.trim(),
                full_name: `${f.first_name.trim()} ${f.last_name.trim()}`.trim(),
              })
            }} className="px-5 py-2 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700 flex items-center gap-1.5"><Check className="w-4 h-4" /> Save</button>
            <button onClick={onBack} className="px-4 py-2 rounded-md border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Change Role — LHIKE "USER ROLE" layout: profile lines, bordered panel per section
// (teal title), bold module checkboxes w/ indented sub-checkboxes, Mother Account panel,
// Submit/Cancel bottom-left. Catalog = the REAL sidebar (businessNav) — kaya kasama ang
// mga module natin na wala sa LHIKE (Ads, Sales Channels, Affiliates, Reports, atbp.). ──
const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s|&\s?)([a-z])/g, m => m.toUpperCase()).replace("E-commerce", "E-commerce")
function ChangeRoleScreen({ user, onBack, onSave }: {
  user: ErpUser; onBack: () => void
  onSave: (mother: boolean, allowed: string[]) => void
}) {
  const [mother, setMother] = useState(user.mother)
  const [allowed, setAllowed] = useState<Set<string>>(new Set(user.allowed))
  const toggle = (href: string) => setAllowed(s => { const n = new Set(s); n.has(href) ? n.delete(href) : n.add(href); return n })
  const toggleMany = (hrefs: string[], on: boolean) => setAllowed(s => { const n = new Set(s); hrefs.forEach(h => on ? n.add(h) : n.delete(h)); return n })
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft className="w-4 h-4" /> Back to User Management</button>
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 pb-4 mb-4 border-b border-slate-100"><Shield className="w-5 h-5" /> USER ROLE</h1>
        {/* Profile lines (LHIKE) */}
        <div className="text-sm text-slate-600 space-y-0.5 mb-5">
          <p>Name : <strong className="text-slate-900">{user.full_name || user.username}</strong></p>
          <p>Employee No : <strong className="text-slate-900">{user.id}</strong></p>
          <p>Position : <strong className="text-slate-900">{user.position || "—"}</strong></p>
          <p>Status : <strong className={user.status === "Active" ? "text-emerald-600" : "text-slate-500"}>{user.status}</strong></p>
        </div>
        {/* Section panels */}
        <div className={`space-y-4 ${mother ? "opacity-40 pointer-events-none" : ""}`}>
          {businessNav.map(sec => (
            <div key={sec.section} className="rounded-lg border border-slate-200 p-5">
              <p className="text-sm font-semibold text-teal-500 mb-4">{titleCase(sec.section)}</p>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-5">
                {sec.items.map(item => {
                  const childHrefs = item.children?.map(c => c.href) || []
                  const groupHrefs = [item.href, ...childHrefs]
                  const parentOn = groupHrefs.some(h => allowed.has(h))
                  return (
                    <div key={item.href}>
                      <label className="flex items-center gap-2 text-sm font-bold text-slate-800 cursor-pointer">
                        <input type="checkbox" checked={parentOn} onChange={e => toggleMany(groupHrefs, e.target.checked)} className="accent-blue-600" />
                        {item.label}
                      </label>
                      <div className="pl-6 mt-1.5 space-y-1">
                        {item.children?.length ? item.children.map(c => (
                          <label key={c.href} className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                            <input type="checkbox" checked={allowed.has(c.href)} onChange={() => toggle(c.href)} className="accent-blue-600" />
                            {c.label}
                          </label>
                        )) : (
                          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                            <input type="checkbox" checked={allowed.has(item.href)} onChange={() => toggle(item.href)} className="accent-blue-600" />
                            View / Access
                          </label>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        {/* Mother Account panel (LHIKE 4.7) */}
        <div className="rounded-lg border border-slate-200 p-5 mt-4">
          <p className="text-sm font-semibold text-teal-500 mb-4">Mother Account</p>
          <label className="flex items-center gap-2 text-sm font-bold text-slate-800 cursor-pointer">
            <input type="checkbox" checked={mother} onChange={e => setMother(e.target.checked)} className="accent-blue-600" />
            Mother Account
          </label>
          <div className="pl-6 mt-1.5">
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input type="checkbox" checked={mother} onChange={e => setMother(e.target.checked)} className="accent-blue-600" />
              Access for Mother Account <span className="text-slate-400">(lahat ng sections at pages)</span>
            </label>
          </div>
        </div>
        {/* Submit + Cancel — bottom-left (LHIKE 4.8) */}
        <div className="flex gap-2 mt-5">
          <button onClick={() => onSave(mother, Array.from(allowed))} className="px-5 py-2 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700">Submit</button>
          <button onClick={onBack} className="px-4 py-2 rounded-md border border-slate-300 bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── Edit / Upload Company Logo (shown sa login page; jpg/png/jpeg) ──
function LogoScreen({ onBack, onSaved }: { onBack: () => void; onSaved: () => void }) {
  const [current, setCurrent] = useState("")
  const [preview, setPreview] = useState("")
  const [err, setErr] = useState("")
  useEffect(() => { setCurrent(getCompanyLogo()) }, [])
  function pick(f: File | null) {
    setErr("")
    if (!f) return
    if (!/image\/(png|jpe?g)/.test(f.type)) { setErr("JPG / PNG / JPEG lang ang tinatanggap."); return }
    const img = new Image()
    const url = URL.createObjectURL(f)
    img.onload = () => {
      const max = 480
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement("canvas")
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale)
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      setPreview(c.toDataURL("image/png"))
    }
    img.onerror = () => { URL.revokeObjectURL(url); setErr("Hindi mabasa ang image file.") }
    img.src = url
  }
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft className="w-4 h-4" /> Back to User Management</button>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-2xl">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 pb-4 mb-4 border-b border-slate-100"><ImageIcon className="w-5 h-5" /> EDIT / UPLOAD COMPANY LOGO</h1>
        <p className="text-sm text-slate-500 mb-4">Ang logo na ito ay makikita sa <strong>login page</strong> ng ERP. Tinatanggap: jpg, png, jpeg.</p>
        <div className="grid sm:grid-cols-2 gap-4 mb-5">
          <div className="rounded-xl border border-slate-200 p-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-2">Current Logo</p>
            {current ? <img src={current} alt="Current logo" className="max-h-28 mx-auto object-contain" /> : <p className="text-sm text-slate-300 py-8">Wala pang logo</p>}
          </div>
          <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-blue-500 mb-2">New Logo Preview</p>
            {preview ? <img src={preview} alt="New logo preview" className="max-h-28 mx-auto object-contain" /> : <p className="text-sm text-slate-300 py-8">Pumili ng file</p>}
          </div>
        </div>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <span className="h-10 px-4 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold flex items-center">Select file</span>
          <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={e => { pick(e.target.files?.[0] || null); e.currentTarget.value = "" }} />
        </label>
        {err && <p className="text-sm text-rose-600 mt-3">{err}</p>}
        <div className="flex gap-2 mt-6 pt-4 border-t border-slate-100">
          <button disabled={!preview} onClick={() => { setCompanyLogo(preview); onSaved() }} className="px-5 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-40">Upload</button>
          {current && <button onClick={() => { setCompanyLogo(""); setCurrent(""); }} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50">Remove current logo</button>}
          <button onClick={onBack} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50">Cancel</button>
        </div>
      </div>
    </div>
  )
}
