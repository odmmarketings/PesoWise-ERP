"use client"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Settings, Plus, Pencil, Trash2, Check, X, ShieldCheck, Users, AlertTriangle } from "lucide-react"
import { useProblemDepartments, useProblems, type ProblemDepartment } from "@/lib/problems-store"
import { useErpUsers, isMotherAccount } from "@/lib/users-store"
import { Modal } from "@/components/business/problems/shared"

// Problem Management → Settings: walang-limitasyong departments, at kung sino ang Manager
// ng bawat isa. Ang Manager ang nakakakita ng buong department, nakakapag-assign, at
// nakakapag-aprub ng completion.

export default function BoardSettingsPage() {
  const deps = useProblemDepartments()
  const { problems } = useProblems()
  const { users } = useErpUsers()
  const admin = isMotherAccount()

  const [newName, setNewName] = useState("")
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [managerFor, setManagerFor] = useState<ProblemDepartment | null>(null)
  const [confirmDel, setConfirmDel] = useState<ProblemDepartment | null>(null)

  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const p of problems) m[p.department] = (m[p.department] || 0) + 1
    return m
  }, [problems])

  const active = users.filter(u => u.email && u.status === "Active")
  const nameOf = (email: string) => active.find(u => u.email === email)?.full_name || email

  async function add() {
    const n = newName.trim()
    if (!n) return
    if (deps.departments.some(d => d.name.toLowerCase() === n.toLowerCase())) return
    await deps.addDepartment(n)
    setNewName("")
  }

  return (
    <div className="space-y-4">
      <span className="text-sm text-slate-500 font-medium">Problem Management / Settings</span>

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4 pb-4 border-b border-slate-100">
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2">
            <Settings className="w-5 h-5" /> DEPARTMENTS &amp; MANAGERS
          </h1>
          {!admin && (
            <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> Administrator lang ang makakapagbago dito
            </span>
          )}
        </div>

        {admin && (
          <div className="flex items-center gap-2 mb-4">
            <Input value={newName} placeholder="Magdagdag ng department (hal. Quality Assurance)"
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") add() }} className="max-w-md" />
            <Button onClick={add} disabled={!newName.trim()}><Plus className="w-4 h-4" /> Add</Button>
          </div>
        )}

        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-[11px] font-semibold uppercase tracking-wide border-b border-slate-200">
                  <th className="px-4 py-3 text-left">Department</th>
                  <th className="px-4 py-3 text-left">Managers</th>
                  <th className="px-4 py-3 text-right">Problems</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!deps.loaded && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400 italic">Loading…</td></tr>}
                {deps.loaded && deps.departments.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400 italic">Wala pang department.</td></tr>
                )}
                {deps.departments.map(d => (
                  <tr key={d.id} className={`hover:bg-slate-50/70 ${d.status === "inactive" ? "opacity-55" : ""}`}>
                    <td className="px-4 py-3">
                      {editing === d.id ? (
                        <div className="flex items-center gap-1.5">
                          <Input value={draft} onChange={e => setDraft(e.target.value)} className="h-8 max-w-[220px]"
                            onKeyDown={e => { if (e.key === "Enter") { deps.updateDepartment(d.id, { name: draft.trim() }); setEditing(null) } }} />
                          <button onClick={() => { deps.updateDepartment(d.id, { name: draft.trim() }); setEditing(null) }}
                            className="w-7 h-7 rounded-lg text-emerald-600 hover:bg-emerald-50 flex items-center justify-center"><Check className="w-4 h-4" /></button>
                          <button onClick={() => setEditing(null)}
                            className="w-7 h-7 rounded-lg text-slate-400 hover:bg-slate-100 flex items-center justify-center"><X className="w-4 h-4" /></button>
                        </div>
                      ) : (
                        <span className="font-semibold text-slate-800">{d.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {d.manager_emails.length === 0 ? (
                        <span className="text-xs text-slate-400 italic">Walang naka-assign</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {d.manager_emails.map(m => (
                            <span key={m} className="inline-flex items-center gap-1 rounded-full bg-purple-50 text-purple-700 px-2 py-0.5 text-[11px] font-semibold">
                              <ShieldCheck className="w-3 h-3" /> {nameOf(m)}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">{counts[d.name] || 0}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${d.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                        {d.status === "active" ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-0.5">
                        <button title="Assign managers" onClick={() => setManagerFor(d)} disabled={!admin}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-purple-600 disabled:opacity-30">
                          <Users className="w-4 h-4" />
                        </button>
                        <button title="Rename" onClick={() => { setEditing(d.id); setDraft(d.name) }} disabled={!admin}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button title={d.status === "active" ? "Set inactive" : "Set active"} disabled={!admin}
                          onClick={() => deps.updateDepartment(d.id, { status: d.status === "active" ? "inactive" : "active" })}
                          className="px-2 h-8 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-30">
                          {d.status === "active" ? "Disable" : "Enable"}
                        </button>
                        <button title="Delete" onClick={() => setConfirmDel(d)} disabled={!admin}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500 space-y-1">
          <p className="font-semibold text-slate-700 text-sm mb-1">Mga tungkulin</p>
          <p><strong>Administrator</strong> (Mother Account) — buong akses: lahat ng problema, department, at approval.</p>
          <p><strong>Manager</strong> — nakikita ang buong department na hawak niya, nakakapag-assign, nakakapag-edit, at nakakapag-aprub ng completion.</p>
          <p><strong>Employee</strong> — nakikita ang mga problemang naka-assign sa kanya, nakakapag-update ng progreso, nakakapag-upload ng evidence, at nakakapag-comment.</p>
        </div>
      </div>

      {managerFor && (
        <Modal title={`Managers — ${managerFor.name}`} icon={ShieldCheck} width="max-w-md"
          onClose={() => setManagerFor(null)}
          footer={<Button variant="outline" onClick={() => setManagerFor(null)}>Done</Button>}>
          <div className="px-6 py-4">
            <p className="text-xs text-slate-500 mb-2">Ang mga napiling user ay magiging Manager ng department na ito.</p>
            <div className="rounded-lg border border-slate-200 max-h-72 overflow-auto divide-y divide-slate-100">
              {active.map(u => {
                const on = managerFor.manager_emails.includes(u.email)
                return (
                  <label key={u.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer">
                    <input type="checkbox" checked={on} onChange={() => {
                      const next = on
                        ? managerFor.manager_emails.filter(e => e !== u.email)
                        : [...managerFor.manager_emails, u.email]
                      setManagerFor({ ...managerFor, manager_emails: next })
                      deps.updateDepartment(managerFor.id, { manager_emails: next })
                    }} />
                    <span className="text-slate-700">{u.full_name || u.email}</span>
                    {u.position && <span className="text-xs text-slate-400">· {u.position}</span>}
                  </label>
                )
              })}
              {active.length === 0 && <p className="px-3 py-3 text-xs text-slate-400 italic">Walang aktibong user sa roster.</p>}
            </div>
          </div>
        </Modal>
      )}

      {confirmDel && (
        <Modal title="Delete Department" icon={AlertTriangle} width="max-w-md" onClose={() => setConfirmDel(null)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmDel(null)}>Cancel</Button>
              <Button className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => { deps.removeDepartment(confirmDel.id); setConfirmDel(null) }}>Delete</Button>
            </div>
          }>
          <div className="px-6 py-5 text-sm text-slate-700">
            Buburahin ang <strong>{confirmDel.name}</strong>.
            {(counts[confirmDel.name] || 0) > 0 && (
              <p className="text-xs text-amber-700 mt-2 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                May {counts[confirmDel.name]} problemang naka-tag dito — mananatili sila pero mawawalan ng department sa mga filter.
                Mas ligtas ang “Disable” kung gusto mo lang itago.
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
