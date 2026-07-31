"use client"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AlertCircle, ClipboardList } from "lucide-react"
import {
  PRIORITIES, STATUSES, todayStr,
  type Attachment, type NewProblemInput, type Priority, type Problem, type ProblemDepartment, type ProblemStatus,
} from "@/lib/problems-store"
import { type ErpUser } from "@/lib/users-store"
import { currentUserName } from "@/lib/current-user"
import { Modal, Field, AttachmentBox, INPUT, AREA } from "./shared"

// Add / Edit ng pangunahing datos ng problema. Ang Root Cause Analysis, comments at
// timeline ay nasa detail view — dito ang "sino, saan, gaano kahalaga, kailan".

export function ProblemFormModal({ initial, departments, users, onClose, onSave }: {
  initial?: Problem
  departments: ProblemDepartment[]
  users: ErpUser[]
  onClose: () => void
  onSave: (input: NewProblemInput) => Promise<void>
}) {
  const [f, setF] = useState({
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    department: initial?.department ?? (departments[0]?.name || ""),
    owner_email: initial?.owner_email ?? "",
    support_emails: initial?.support_emails ?? ([] as string[]),
    reported_by: initial?.reported_by ?? (currentUserName() || ""),
    date_reported: initial?.date_reported || todayStr(),
    priority: (initial?.priority ?? "Medium") as Priority,
    status: (initial?.status ?? "Open") as ProblemStatus,
    target_date: initial?.target_date ?? "",
    notes: initial?.notes ?? "",
    attachments: (initial?.attachments ?? []) as Attachment[],
  })
  const [err, setErr] = useState("")
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF(p => ({ ...p, [k]: v })); setErr("") }

  const assignable = useMemo(
    () => users.filter(u => u.email && u.status === "Active").sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [users])

  async function submit() {
    if (!f.title.trim()) { setErr("Problem Title is required."); return }
    if (!f.department) { setErr("Select a Department."); return }
    if (!f.owner_email) { setErr("Select an Assigned User (Owner)."); return }
    setSaving(true)
    try {
      const owner = assignable.find(u => u.email === f.owner_email)
      await onSave({
        title: f.title.trim(), description: f.description.trim(), department: f.department,
        owner_email: f.owner_email, owner_name: owner?.full_name || f.owner_email,
        support_emails: f.support_emails, reported_by: f.reported_by.trim(),
        date_reported: f.date_reported, priority: f.priority, status: f.status,
        target_date: f.target_date, notes: f.notes.trim(), attachments: f.attachments,
        // Ang RCA at completion fields ay hindi ginagalaw dito — sa detail view sila.
        cause: initial?.cause ?? "", root_cause: initial?.root_cause ?? "",
        solution: initial?.solution ?? "", action_plan: initial?.action_plan ?? "",
        corrective_action: initial?.corrective_action ?? "", preventive_action: initial?.preventive_action ?? "",
        actual_completion_date: initial?.actual_completion_date ?? "",
        completion_notes: initial?.completion_notes ?? "", evidence: initial?.evidence ?? [],
      })
      onClose()
    } catch (e: any) {
      setErr(e?.message || "Could not save.")
      setSaving(false)
    }
  }

  const toggleSupport = (email: string) =>
    set("support_emails", f.support_emails.includes(email)
      ? f.support_emails.filter(e => e !== email)
      : [...f.support_emails, email])

  return (
    <Modal
      title={initial ? `Edit ${initial.code}` : "Report a Problem"}
      subtitle={initial ? initial.title : "Every problem has an owner, a deadline, and a status."}
      icon={ClipboardList} onClose={onClose}
      footer={
        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : initial ? "Save Changes" : "Create Problem"}</Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      }
    >
      <div className="px-6 py-4 space-y-4">
        {err && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {err}
          </div>
        )}

        <Field label="Problem Title" required>
          <Input value={f.title} placeholder="Short title for the issue" onChange={e => set("title", e.target.value)} />
        </Field>

        <Field label="Detailed Description">
          <textarea rows={4} className={AREA} value={f.description}
            placeholder="What happened? When did it start? Who or what is affected?"
            onChange={e => set("description", e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Department" required>
            <select className={INPUT} value={f.department} onChange={e => set("department", e.target.value)}>
              <option value="">-- SELECT --</option>
              {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Assigned User (Owner)" required>
            <select className={INPUT} value={f.owner_email} onChange={e => set("owner_email", e.target.value)}>
              <option value="">-- SELECT --</option>
              {assignable.map(u => <option key={u.id} value={u.email}>{u.full_name || u.email}{u.position ? ` · ${u.position}` : ""}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Supporting Users" hint="Optional — they can also view and update this problem.">
          <div className="rounded-lg border border-slate-200 max-h-32 overflow-auto divide-y divide-slate-100">
            {assignable.filter(u => u.email !== f.owner_email).map(u => (
              <label key={u.id} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" checked={f.support_emails.includes(u.email)} onChange={() => toggleSupport(u.email)} />
                <span className="text-slate-700">{u.full_name || u.email}</span>
                {u.position && <span className="text-xs text-slate-400">· {u.position}</span>}
              </label>
            ))}
            {assignable.length === 0 && <p className="px-3 py-2 text-xs text-slate-400 italic">No active users in the roster.</p>}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Reported By">
            <Input value={f.reported_by} placeholder="Who reported it" onChange={e => set("reported_by", e.target.value)} />
          </Field>
          <Field label="Date Reported">
            <input type="date" className={INPUT} value={f.date_reported} onChange={e => set("date_reported", e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Priority">
            <select className={INPUT} value={f.priority} onChange={e => set("priority", e.target.value as Priority)}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={INPUT} value={f.status} onChange={e => set("status", e.target.value as ProblemStatus)}>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Target Completion">
            <input type="date" className={INPUT} value={f.target_date} onChange={e => set("target_date", e.target.value)} />
          </Field>
        </div>

        <Field label="Notes / Updates">
          <textarea rows={2} className={AREA} value={f.notes} placeholder="Opsyonal" onChange={e => set("notes", e.target.value)} />
        </Field>

        <AttachmentBox files={f.attachments} folder={initial?.id || "new"}
          onChange={next => set("attachments", next)} />
      </div>
    </Modal>
  )
}
