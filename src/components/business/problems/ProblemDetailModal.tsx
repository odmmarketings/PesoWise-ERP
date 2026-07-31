"use client"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Search, MessageSquare, History, CheckCircle2, AlertTriangle, ShieldCheck,
  CornerDownRight, AtSign, Send, Trash2, Clock,
} from "lucide-react"
import {
  STATUSES, PRIORITY_CLASS, STATUS_CLASS, TONE_CLASS, deadlineInfo, completionBlockers, isClosed, todayStr,
  useProblemThread, type Attachment, type BoardRole, type NewProblemInput, type Problem, type ProblemStatus,
} from "@/lib/problems-store"
import { type ErpUser } from "@/lib/users-store"
import { currentUserEmail } from "@/lib/current-user"
import { Modal, AttachmentBox, INPUT, AREA } from "./shared"

// Detail view ng isang problema: ang RCA chain (Problem → Cause → Root Cause → Solution →
// Corrective → Preventive), ang usapan, at ang buong kasaysayan ng mga galaw.

const fmtDT = (iso: string) => {
  if (!iso) return ""
  const d = new Date(iso)
  return isNaN(d.getTime()) ? "" : d.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })
}

/** Isang hakbang sa RCA chain — may kulay na gilid para makita ang daloy. */
function RcaStep({ step, label, hint, value, color, disabled, onChange }: {
  step: number; label: string; hint: string; value: string; color: string
  disabled: boolean; onChange: (v: string) => void
}) {
  return (
    <div className="relative pl-6">
      <span className="absolute left-0 top-1 w-4 h-4 rounded-full text-[10px] font-bold text-white flex items-center justify-center"
        style={{ background: color }}>{step}</span>
      <div className="absolute left-[7px] top-6 bottom-0 w-px bg-slate-200" />
      <div className="pb-4">
        <p className="text-sm font-semibold text-slate-800">{label}</p>
        <p className="text-[11px] text-slate-400 mb-1.5">{hint}</p>
        <textarea rows={2} className={AREA} value={value} disabled={disabled}
          placeholder={disabled ? "—" : hint} onChange={e => onChange(e.target.value)} />
      </div>
    </div>
  )
}

export function ProblemDetailModal({ problem, users, role, editable, onClose, onSave, onApprove }: {
  problem: Problem
  users: ErpUser[]
  role: BoardRole
  editable: boolean
  onClose: () => void
  onSave: (patch: Partial<NewProblemInput>) => Promise<void>
  onApprove: () => Promise<void>
}) {
  const [tab, setTab] = useState<"rca" | "comments" | "timeline">("rca")
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState("")
  const thread = useProblemThread(problem.id)

  const [d, setD] = useState({
    status: problem.status as ProblemStatus,
    cause: problem.cause, root_cause: problem.root_cause, solution: problem.solution,
    action_plan: problem.action_plan, corrective_action: problem.corrective_action,
    preventive_action: problem.preventive_action,
    completion_notes: problem.completion_notes,
    target_date: problem.target_date,
    evidence: problem.evidence as Attachment[],
    attachments: problem.attachments as Attachment[],
    notes: problem.notes,
  })
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => { setD(p => ({ ...p, [k]: v })); setErr("") }
  const ro = !editable

  const dl = deadlineInfo({ target_date: d.target_date, status: d.status })
  const blockers = completionBlockers(d)
  const canApprove = role === "admin" || role === "manager"

  async function save(extra: Partial<NewProblemInput> = {}) {
    setSaving(true); setErr("")
    try { await onSave({ ...d, ...extra }) } catch (e: any) { setErr(e?.message || "Could not save.") }
    setSaving(false)
  }

  /** Employee → isinusumite para sa approval. Manager/Admin → diretsong isinasara. */
  async function complete() {
    if (blockers.length) { setErr(`Required first: ${blockers.join(", ")}.`); return }
    if (canApprove) {
      setSaving(true)
      try { await onSave({ ...d, actual_completion_date: todayStr() }); await onApprove() }
      catch (e: any) { setErr(e?.message || "Could not complete.") }
      setSaving(false)
    } else {
      set("status", "Waiting for Approval")
      await save({ status: "Waiting for Approval" })
    }
  }

  return (
    <Modal
      width="max-w-4xl"
      title={`${problem.code} — ${problem.title}`}
      subtitle={`${problem.department || "No department"} · Owner: ${problem.owner_name || problem.owner_email || "—"} · Reported ${problem.date_reported || "—"} by ${problem.reported_by || "—"}`}
      icon={Search} onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Button onClick={() => save()} disabled={ro || saving}>{saving ? "Saving…" : "Save Changes"}</Button>
            <Button variant="outline" onClick={onClose}>Close</Button>
          </div>
          {!isClosed(d.status) && (
            <Button onClick={complete} disabled={ro || saving || blockers.length > 0}
              className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {canApprove ? <><ShieldCheck className="w-4 h-4" /> Approve &amp; Complete</> : <><CheckCircle2 className="w-4 h-4" /> Submit for Approval</>}
            </Button>
          )}
        </div>
      }
    >
      {/* Buod — status, priority, deadline */}
      <div className="px-6 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap bg-slate-50">
        <select className={`${INPUT} w-auto`} value={d.status} disabled={ro}
          onChange={e => set("status", e.target.value as ProblemStatus)}>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${PRIORITY_CLASS[problem.priority]}`}>{problem.priority}</span>
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${TONE_CLASS[dl.tone]}`}>{dl.label}</span>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-xs text-slate-500">Target</label>
          <input type="date" className={`${INPUT} w-auto`} value={d.target_date} disabled={ro}
            onChange={e => set("target_date", e.target.value)} />
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6 pt-3 flex items-center gap-1 border-b border-slate-100">
        {([["rca", "Root Cause Analysis", Search], ["comments", `Comments (${thread.comments.length})`, MessageSquare], ["timeline", "Timeline", History]] as const).map(([k, label, Ico]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-2 text-sm font-semibold flex items-center gap-1.5 border-b-2 -mb-px ${tab === k ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            <Ico className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      <div className="px-6 py-4">
        {err && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{err}</div>}

        {tab === "rca" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">
              <p className="text-sm font-semibold text-slate-800 mb-1">Problem</p>
              <p className="text-sm text-slate-600 whitespace-pre-wrap">{problem.description || "—"}</p>
            </div>

            <RcaStep step={1} label="Cause" color="#f97316" disabled={ro} value={d.cause}
              hint="What was the immediate cause?" onChange={v => set("cause", v)} />
            <RcaStep step={2} label="Root Cause" color="#dc2626" disabled={ro} value={d.root_cause}
              hint="Why it happened — the true root, not just the symptom." onChange={v => set("root_cause", v)} />
            <RcaStep step={3} label="Proposed Solution" color="#2563eb" disabled={ro} value={d.solution}
              hint="What will be done to fix it?" onChange={v => set("solution", v)} />
            <RcaStep step={4} label="Action Plan" color="#0891b2" disabled={ro} value={d.action_plan}
              hint="Steps, who does them, and when." onChange={v => set("action_plan", v)} />
            <RcaStep step={5} label="Corrective Action" color="#7c3aed" disabled={ro} value={d.corrective_action}
              hint="What was done to correct the current issue." onChange={v => set("corrective_action", v)} />
            <RcaStep step={6} label="Preventive Action" color="#059669" disabled={ro} value={d.preventive_action}
              hint="So it does not happen again." onChange={v => set("preventive_action", v)} />

            {/* Completion */}
            <div className="rounded-xl border border-slate-200 p-4 space-y-3">
              <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Completion
              </p>
              {blockers.length > 0 && !isClosed(d.status) && (
                <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>Before closing, these are required: <strong>{blockers.join(", ")}</strong>. (Evidence is optional but recommended.)</span>
                </div>
              )}
              <div>
                <label className="text-sm text-slate-600">Completion Notes</label>
                <textarea rows={2} className={`${AREA} mt-1`} value={d.completion_notes} disabled={ro}
                  placeholder="What was the outcome?" onChange={e => set("completion_notes", e.target.value)} />
              </div>
              <AttachmentBox label="Completion Evidence" files={d.evidence} folder={`${problem.id}/evidence`}
                disabled={ro} onChange={next => set("evidence", next)} />
              {problem.approved_by && (
                <p className="text-xs text-emerald-700 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" /> Inaprubahan ni {problem.approved_by} · {fmtDT(problem.approved_at)}
                </p>
              )}
            </div>

            <AttachmentBox files={d.attachments} folder={problem.id} disabled={ro}
              onChange={next => set("attachments", next)} />

            <div>
              <label className="text-sm text-slate-600">Notes / Updates</label>
              <textarea rows={2} className={`${AREA} mt-1`} value={d.notes} disabled={ro}
                onChange={e => set("notes", e.target.value)} />
            </div>
          </div>
        )}

        {tab === "comments" && <Comments thread={thread} users={users} problemId={problem.id} />}

        {tab === "timeline" && (
          <ul className="space-y-2">
            {thread.activity.length === 0 && <li className="text-sm text-slate-400 italic">No activity recorded yet.</li>}
            {thread.activity.map(a => (
              <li key={a.id} className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2">
                <Clock className="w-4 h-4 text-slate-300 mt-0.5 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-800">{a.action}</p>
                  {a.detail && <p className="text-xs text-slate-500 break-words">{a.detail}</p>}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-slate-600">{a.by || "—"}</p>
                  <p className="text-[11px] text-slate-400">{fmtDT(a.at)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

// ── Comments (may replies, @mentions, attachments) ───────────────────────────
function Comments({ thread, users, problemId }: {
  thread: ReturnType<typeof useProblemThread>; users: ErpUser[]; problemId: string
}) {
  const [body, setBody] = useState("")
  const [replyTo, setReplyTo] = useState<{ id: string; author: string } | null>(null)
  const [mentions, setMentions] = useState<string[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [showMention, setShowMention] = useState(false)
  const [busy, setBusy] = useState(false)
  const me = currentUserEmail().toLowerCase()

  const roots = useMemo(() => thread.comments.filter(c => !c.parent_id), [thread.comments])
  const repliesOf = (id: string) => thread.comments.filter(c => c.parent_id === id)
  const mentionable = users.filter(u => u.email && u.status === "Active")

  function mention(u: ErpUser) {
    const name = u.full_name || u.email
    setBody(b => `${b}${b && !b.endsWith(" ") ? " " : ""}@${name} `)
    setMentions(m => m.includes(u.email) ? m : [...m, u.email])
    setShowMention(false)
  }

  async function send() {
    if (!body.trim()) return
    setBusy(true)
    await thread.addComment(body, { parentId: replyTo?.id, mentions, attachments })
    setBody(""); setReplyTo(null); setMentions([]); setAttachments([])
    setBusy(false)
  }

  const Bubble = ({ c, reply }: { c: typeof thread.comments[number]; reply?: boolean }) => (
    <div className={`rounded-xl border border-slate-200 px-3 py-2 ${reply ? "bg-slate-50" : "bg-white"}`}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-800">{c.author || "—"}</span>
        <span className="text-[11px] text-slate-400">{fmtDT(c.created_at)}</span>
        <div className="ml-auto flex items-center gap-1">
          {!reply && (
            <button onClick={() => setReplyTo({ id: c.id, author: c.author })}
              className="text-[11px] text-blue-600 hover:underline flex items-center gap-0.5">
              <CornerDownRight className="w-3 h-3" /> Reply
            </button>
          )}
          {c.author_email.toLowerCase() === me && (
            <button onClick={() => thread.removeComment(c.id)} className="text-slate-300 hover:text-red-600">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      <p className="text-sm text-slate-700 whitespace-pre-wrap mt-0.5">{c.body}</p>
      {c.attachments.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-2">
          {c.attachments.map((f, i) => (
            <a key={i} href={f.url} target="_blank" rel="noreferrer"
              className="text-xs text-blue-600 hover:underline border border-slate-200 rounded px-2 py-0.5 bg-white">{f.name}</a>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-3">
      {roots.length === 0 && <p className="text-sm text-slate-400 italic">No discussion here yet.</p>}
      {roots.map(c => (
        <div key={c.id} className="space-y-2">
          <Bubble c={c} />
          {repliesOf(c.id).length > 0 && (
            <div className="ml-6 space-y-2">{repliesOf(c.id).map(r => <Bubble key={r.id} c={r} reply />)}</div>
          )}
        </div>
      ))}

      {/* Composer */}
      <div className="rounded-xl border border-slate-200 p-3 space-y-2">
        {replyTo && (
          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            <CornerDownRight className="w-3.5 h-3.5" /> Sumasagot kay <strong>{replyTo.author}</strong>
            <button onClick={() => setReplyTo(null)} className="text-blue-600 hover:underline ml-1">cancel</button>
          </p>
        )}
        <textarea rows={3} className={AREA} value={body} placeholder="Add a comment…"
          onChange={e => setBody(e.target.value)} />
        <div className="relative flex items-center gap-2 flex-wrap">
          <button onClick={() => setShowMention(s => !s)}
            className="text-xs font-semibold text-slate-600 hover:text-slate-800 flex items-center gap-1 border border-slate-200 rounded-lg px-2 py-1">
            <AtSign className="w-3.5 h-3.5" /> Mention
          </button>
          {showMention && (
            <div className="absolute bottom-9 left-0 z-10 w-64 max-h-48 overflow-auto bg-white border border-slate-200 rounded-xl shadow-xl">
              {mentionable.map(u => (
                <button key={u.id} onClick={() => mention(u)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 text-slate-700">
                  {u.full_name || u.email}
                </button>
              ))}
              {mentionable.length === 0 && <p className="px-3 py-2 text-xs text-slate-400 italic">No active users.</p>}
            </div>
          )}
          {mentions.length > 0 && <span className="text-[11px] text-slate-400">{mentions.length} mention(s)</span>}
          <div className="ml-auto">
            <Button onClick={send} disabled={busy || !body.trim()}>
              <Send className="w-4 h-4" /> {busy ? "Posting…" : "Post"}
            </Button>
          </div>
        </div>
        <AttachmentBox label="Attach to comment" files={attachments} folder={`${problemId}/comments`}
          onChange={setAttachments} />
      </div>
    </div>
  )
}
