"use client"
import { useCallback, useEffect, useMemo, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"
import { currentUserName, currentUserEmail } from "@/lib/current-user"
import { isMotherAccount } from "@/lib/users-store"

// ──────────────────────────────────────────────────────────────────────────────
// PROBLEM MANAGEMENT (Root Cause Analysis) — bawat isyu ay masusubaybayan mula sa
// pagkakatuklas hanggang sa resolusyon: may may-ari, root cause, solusyon, deadline,
// at katayuan. Source of truth = Supabase (`problems`, `problem_departments`,
// `problem_comments`, `problem_activity`, `problem_notifications`).
// ──────────────────────────────────────────────────────────────────────────────

export const PRIORITIES = ["Critical", "High", "Medium", "Low"] as const
export type Priority = typeof PRIORITIES[number]

export const STATUSES = [
  "Open", "Investigation", "Root Cause Identified", "In Progress",
  "Waiting for Approval", "Monitoring", "Completed", "Cancelled",
] as const
export type ProblemStatus = typeof STATUSES[number]

/** Tapos na ang buhay ng problema — hindi na kasama sa "open" counters at deadline alerts. */
export const CLOSED_STATUSES: ProblemStatus[] = ["Completed", "Cancelled"]
export const isClosed = (s: string) => CLOSED_STATUSES.includes(s as ProblemStatus)

/** Panimulang listahan lang ito — kayang magdagdag/magbura ang admin sa Settings. */
export const SEED_DEPARTMENTS = [
  "HR", "Telemarketing", "Marketing", "Warehouse", "Operations", "Customer Service",
  "Purchasing", "Finance", "IT", "Creative", "Video Editing", "Sales", "Ecommerce",
  "Logistics", "Administration",
]

export interface Attachment { name: string; type: string; size: number; url: string }

export interface Problem {
  id: string
  code: string                 // PRB-0001
  title: string
  description: string
  department: string
  owner_email: string
  owner_name: string
  support_emails: string[]
  reported_by: string
  date_reported: string        // YYYY-MM-DD
  priority: Priority
  status: ProblemStatus
  // Root Cause Analysis chain
  cause: string
  root_cause: string
  solution: string
  action_plan: string
  corrective_action: string
  preventive_action: string
  // Deadline / completion
  target_date: string
  actual_completion_date: string
  completion_notes: string
  evidence: Attachment[]
  approved_by: string
  approved_at: string
  // Misc
  attachments: Attachment[]
  notes: string
  created_by: string
  created_at: string
  updated_at: string
}

export interface ProblemComment {
  id: string; problem_id: string; parent_id: string
  author: string; author_email: string; body: string
  mentions: string[]; attachments: Attachment[]; created_at: string
}

export interface ProblemActivity {
  id: string; problem_id: string; action: string; detail: string; by: string; at: string
}

export interface ProblemDepartment {
  id: string; name: string; manager_emails: string[]; sort: number; status: "active" | "inactive"
}

export type NewProblemInput = Omit<Problem,
  "id" | "code" | "created_by" | "created_at" | "updated_at" | "approved_by" | "approved_at">

const uid = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
const nowIso = () => new Date().toISOString()

// ── Petsa / deadline ──────────────────────────────────────────────────────────
export function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** Bilang ng araw hanggang sa target (negatibo = lampas na). null kung walang deadline. */
export function daysRemaining(targetDate: string): number | null {
  if (!targetDate) return null
  const [y, m, d] = targetDate.split("-").map(Number)
  if (!y || !m || !d) return null
  const target = new Date(y, m - 1, d).getTime()
  const n = new Date()
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()
  return Math.round((target - today) / 86400000)
}

export type DeadlineTone = "none" | "done" | "ok" | "soon" | "today" | "overdue"

/** Kulay + label ng deadline: 🟢 On Track · 🟡 Due Soon · 🔴 Overdue. */
export function deadlineInfo(p: Pick<Problem, "target_date" | "status">): {
  days: number | null; tone: DeadlineTone; label: string
} {
  const days = daysRemaining(p.target_date)
  if (isClosed(p.status)) return { days, tone: "done", label: p.status }
  if (days === null) return { days: null, tone: "none", label: "No deadline" }
  if (days < 0) return { days, tone: "overdue", label: `Overdue by ${Math.abs(days)}d` }
  if (days === 0) return { days, tone: "today", label: "Due today" }
  if (days === 1) return { days, tone: "soon", label: "Due tomorrow" }
  if (days <= 7) return { days, tone: "soon", label: `${days} days left` }
  return { days, tone: "ok", label: `${days} days left` }
}

export const TONE_CLASS: Record<DeadlineTone, string> = {
  none: "bg-slate-100 text-slate-500",
  done: "bg-emerald-50 text-emerald-700",
  ok: "bg-emerald-50 text-emerald-700",
  soon: "bg-amber-50 text-amber-700",
  today: "bg-amber-100 text-amber-800",
  overdue: "bg-red-50 text-red-700",
}
export const TONE_DOT: Record<DeadlineTone, string> = {
  none: "#cbd5e1", done: "#10b981", ok: "#10b981", soon: "#f59e0b", today: "#f59e0b", overdue: "#ef4444",
}

export const PRIORITY_CLASS: Record<Priority, string> = {
  Critical: "bg-red-600 text-white",
  High: "bg-orange-500 text-white",
  Medium: "bg-amber-400 text-slate-900",
  Low: "bg-slate-200 text-slate-700",
}
export const PRIORITY_COLOR: Record<Priority, string> = {
  Critical: "#dc2626", High: "#f97316", Medium: "#fbbf24", Low: "#cbd5e1",
}
export const STATUS_CLASS: Record<string, string> = {
  "Open": "bg-slate-100 text-slate-700",
  "Investigation": "bg-blue-50 text-blue-700",
  "Root Cause Identified": "bg-indigo-50 text-indigo-700",
  "In Progress": "bg-cyan-50 text-cyan-700",
  "Waiting for Approval": "bg-purple-50 text-purple-700",
  "Monitoring": "bg-teal-50 text-teal-700",
  "Completed": "bg-emerald-50 text-emerald-700",
  "Cancelled": "bg-slate-100 text-slate-400",
}
export const STATUS_COLOR: Record<string, string> = {
  "Open": "#94a3b8", "Investigation": "#3b82f6", "Root Cause Identified": "#6366f1",
  "In Progress": "#06b6d4", "Waiting for Approval": "#a855f7", "Monitoring": "#14b8a6",
  "Completed": "#10b981", "Cancelled": "#cbd5e1",
}

// ── Permissions ───────────────────────────────────────────────────────────────
export type BoardRole = "admin" | "manager" | "employee"

/** Admin = Mother Account · Manager = nakatalaga sa department · Employee = iba pa. */
export function resolveRole(email: string, departments: ProblemDepartment[]): BoardRole {
  if (isMotherAccount()) return "admin"
  const e = (email || "").toLowerCase()
  if (e && departments.some(d => d.manager_emails.some(m => m.toLowerCase() === e))) return "manager"
  return "employee"
}

/** Mga department na pinamamahalaan ng user (Manager lang ang may laman dito). */
export function managedDepartments(email: string, departments: ProblemDepartment[]): string[] {
  const e = (email || "").toLowerCase()
  return departments.filter(d => d.manager_emails.some(m => m.toLowerCase() === e)).map(d => d.name)
}

/** Kayang i-edit ang buong record? Admin lahat; Manager sa department nila; Employee kung sila ang owner. */
export function canEdit(p: Problem, role: BoardRole, email: string, managed: string[]): boolean {
  if (role === "admin") return true
  if (role === "manager" && managed.includes(p.department)) return true
  const e = (email || "").toLowerCase()
  return !!e && (p.owner_email.toLowerCase() === e || p.support_emails.some(s => s.toLowerCase() === e))
}

/** Ang mga kailangan bago maisara ang isang problema (ayon sa Completion Workflow). */
export function completionBlockers(p: Pick<Problem, "root_cause" | "solution" | "completion_notes">): string[] {
  const missing: string[] = []
  if (!p.root_cause.trim()) missing.push("Root Cause")
  if (!p.solution.trim()) missing.push("Proposed Solution")
  if (!p.completion_notes.trim()) missing.push("Completion Notes")
  return missing
}

// ── Row mapping ───────────────────────────────────────────────────────────────
const arr = (v: any): string[] => Array.isArray(v) ? v.filter(Boolean) : []
const files = (v: any): Attachment[] => Array.isArray(v) ? v : []

function rowToProblem(r: any): Problem {
  return {
    id: r.id, code: r.code || "", title: r.title || "", description: r.description || "",
    department: r.department || "", owner_email: r.owner_email || "", owner_name: r.owner_name || "",
    support_emails: arr(r.support_emails), reported_by: r.reported_by || "",
    date_reported: r.date_reported || "", priority: (r.priority || "Medium") as Priority,
    status: (r.status || "Open") as ProblemStatus,
    cause: r.cause || "", root_cause: r.root_cause || "", solution: r.solution || "",
    action_plan: r.action_plan || "", corrective_action: r.corrective_action || "",
    preventive_action: r.preventive_action || "",
    target_date: r.target_date || "", actual_completion_date: r.actual_completion_date || "",
    completion_notes: r.completion_notes || "", evidence: files(r.evidence),
    approved_by: r.approved_by || "", approved_at: r.approved_at || "",
    attachments: files(r.attachments), notes: r.notes || "",
    created_by: r.created_by || "", created_at: r.created_at || "", updated_at: r.updated_at || "",
  }
}

function inputToRow(i: Partial<NewProblemInput>) {
  const row: Record<string, any> = {}
  const keys: (keyof NewProblemInput)[] = [
    "title", "description", "department", "owner_email", "owner_name", "support_emails",
    "reported_by", "date_reported", "priority", "status", "cause", "root_cause", "solution",
    "action_plan", "corrective_action", "preventive_action", "target_date",
    "actual_completion_date", "completion_notes", "evidence", "attachments", "notes",
  ]
  for (const k of keys) if (i[k] !== undefined) row[k] = i[k]
  return row
}

// ── Attachments (Supabase Storage bucket `problem-files`) ─────────────────────
export async function uploadProblemFile(file: File, folder: string): Promise<Attachment> {
  const supabase = createSupabaseBrowserClient()
  const safe = file.name.replace(/[^\w.\-]+/g, "_")
  const path = `${folder}/${Date.now()}_${safe}`
  const { error } = await supabase.storage.from("problem-files").upload(path, file, { upsert: false })
  if (error) throw new Error(error.message)
  const { data } = supabase.storage.from("problem-files").getPublicUrl(path)
  return { name: file.name, type: file.type || "", size: file.size, url: data.publicUrl }
}

// ── Notifications queue ───────────────────────────────────────────────────────
export type NotifyKind = "assigned" | "d7" | "d3" | "d1" | "due_today" | "overdue" | "completed"

/** Ipinipila ang email — ang scripts/problem-notify.mjs ang aktwal na nagpapadala. */
export async function enqueueNotification(input: {
  problemId: string; kind: NotifyKind; to: string[]; subject: string; body: string; dedupeKey?: string
}) {
  const businessId = await getBusinessId()
  if (!businessId) return
  const supabase = createSupabaseBrowserClient()
  const to = Array.from(new Set(input.to.filter(e => e && e.includes("@"))))
  if (!to.length) return
  let rows = to.map(t => ({
    id: uid("ntf"), business_id: businessId, problem_id: input.problemId, kind: input.kind,
    to_email: t, subject: input.subject, body: input.body, status: "pending",
    dedupe_key: input.dedupeKey ? `${input.dedupeKey}|${t}` : "",
  }))
  // Alisin muna ang mga naipadala/naipila na — kung hindi, babagsak ang buong insert
  // dahil sa unique index sa dedupe_key.
  const keys = rows.map(r => r.dedupe_key).filter(Boolean)
  if (keys.length) {
    const { data } = await supabase.from("problem_notifications")
      .select("dedupe_key").eq("business_id", businessId).in("dedupe_key", keys)
    const seen = new Set((data || []).map((r: any) => r.dedupe_key))
    rows = rows.filter(r => !r.dedupe_key || !seen.has(r.dedupe_key))
  }
  if (!rows.length) return
  await supabase.from("problem_notifications").insert(rows)
}

/** Mga email ng Manager ng isang department (ginagamit sa completion notice). */
async function managerEmailsOf(department: string): Promise<string[]> {
  if (!department) return []
  const businessId = await getBusinessId()
  if (!businessId) return []
  const supabase = createSupabaseBrowserClient()
  const { data } = await supabase.from("problem_departments")
    .select("manager_emails").eq("business_id", businessId).eq("name", department).maybeSingle()
  return arr((data as any)?.manager_emails)
}

// ── Departments hook ──────────────────────────────────────────────────────────
export function useProblemDepartments() {
  const [departments, setDepartments] = useState<ProblemDepartment[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const businessId = await getBusinessId()
    if (!businessId) { setLoaded(true); return }
    const supabase = createSupabaseBrowserClient()
    const { data } = await supabase.from("problem_departments").select("*")
      .eq("business_id", businessId).order("sort", { ascending: true })
    let list: ProblemDepartment[] = (data || []).map((r: any) => ({
      id: r.id, name: r.name || "", manager_emails: arr(r.manager_emails),
      sort: r.sort ?? 0, status: r.status === "inactive" ? "inactive" : "active",
    }))
    // Unang bukas: ihasik ang panimulang listahan para may mapagpipilian agad.
    if (list.length === 0) {
      const seed = SEED_DEPARTMENTS.map((name, i) => ({
        id: uid("dep"), business_id: businessId, name, sort: i, status: "active", manager_emails: [],
      }))
      const { error } = await supabase.from("problem_departments").insert(seed)
      if (!error) list = seed.map(s => ({ id: s.id, name: s.name, manager_emails: [], sort: s.sort, status: "active" as const }))
    }
    setDepartments(list)
    setLoaded(true)
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const addDepartment = useCallback(async (name: string) => {
    const businessId = await getBusinessId()
    if (!businessId || !name.trim()) return
    const supabase = createSupabaseBrowserClient()
    await supabase.from("problem_departments").insert({
      id: uid("dep"), business_id: businessId, name: name.trim(), sort: 999, status: "active", manager_emails: [],
    })
    await refresh()
  }, [refresh])

  const updateDepartment = useCallback(async (id: string, patch: Partial<ProblemDepartment>) => {
    const supabase = createSupabaseBrowserClient()
    const row: Record<string, any> = {}
    if (patch.name !== undefined) row.name = patch.name
    if (patch.manager_emails !== undefined) row.manager_emails = patch.manager_emails
    if (patch.status !== undefined) row.status = patch.status
    if (patch.sort !== undefined) row.sort = patch.sort
    await supabase.from("problem_departments").update(row).eq("id", id)
    await refresh()
  }, [refresh])

  const removeDepartment = useCallback(async (id: string) => {
    const supabase = createSupabaseBrowserClient()
    await supabase.from("problem_departments").delete().eq("id", id)
    await refresh()
  }, [refresh])

  const activeDepartments = useMemo(() => departments.filter(d => d.status === "active"), [departments])
  return { departments, activeDepartments, loaded, refresh, addDepartment, updateDepartment, removeDepartment }
}

// ── Problems hook ─────────────────────────────────────────────────────────────
export function useProblems() {
  const [problems, setProblems] = useState<Problem[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const businessId = await getBusinessId()
    if (!businessId) { setLoaded(true); return }
    const supabase = createSupabaseBrowserClient()
    const { data, error } = await supabase.from("problems").select("*")
      .eq("business_id", businessId).order("created_at", { ascending: false })
    if (!error && data) setProblems(data.map(rowToProblem))
    setLoaded(true)
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const logActivity = useCallback(async (problemId: string, action: string, detail = "") => {
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    await supabase.from("problem_activity").insert({
      id: uid("act"), business_id: businessId, problem_id: problemId,
      action, detail, by: currentUserName() || currentUserEmail() || "System", at: nowIso(),
    })
  }, [])

  const codeOf = (seq: number) => `PRB-${String(seq).padStart(4, "0")}`

  /**
   * Susunod na Problem ID — PRB-0001, PRB-0002, …
   * PARA SA UI LANG (preview sa form). Batay sa local state, kaya puwedeng luma.
   * HUWAG itong gamitin sa pag-save — tingnan ang nextSeqFromDb() sa ibaba.
   */
  const nextCode = useCallback(() => {
    const max = problems.reduce((m, p) => {
      const n = Number(String(p.code).match(/PRB-(\d+)/)?.[1] || 0)
      return Math.max(m, n)
    }, 0)
    return codeOf(max + 1)
  }, [problems])

  /**
   * Ang bilang na gagamitin sa PAG-SAVE, hango mismo sa database.
   *
   * BAKIT: dati ay ang local `problems` ang pinagbabatayan ng code. Kapag may
   * ibang user na nakapag-dagdag pagkatapos ng huling refresh mo — o kapag dalawa
   * kayong sabay na nag-submit — pareho kayong makakakuha ng KAPAREHONG code.
   * Ganito nabuo ang dalawang PRB-0002 sa live data.
   */
  const nextSeqFromDb = useCallback(async (businessId: string): Promise<number> => {
    const supabase = createSupabaseBrowserClient()
    const { data } = await supabase.from("problems").select("code").eq("business_id", businessId)
    return (data || []).reduce((m: number, r: { code: string }) => {
      const n = Number(String(r.code).match(/PRB-(\d+)/)?.[1] || 0)
      return Math.max(m, n)
    }, 0) + 1
  }, [])

  const addProblem = useCallback(async (input: NewProblemInput): Promise<Problem | null> => {
    const businessId = await getBusinessId()
    if (!businessId) return null
    const supabase = createSupabaseBrowserClient()
    const id = uid("prb")
    const base = {
      id, business_id: businessId, ...inputToRow(input),
      created_by: currentUserName() || currentUserEmail(), created_at: nowIso(), updated_at: nowIso(),
    }
    // Kunin ang bilang sa DB, at kung sakaling may nakaunang kumuha ng parehong
    // code sa pagitan ng basa at sulat, subukan ang susunod. Limang subok — sapat
    // na iyon kahit ilang tao ang sabay-sabay; kung lagpas pa, may ibang problema.
    let seq = await nextSeqFromDb(businessId)
    let code = ""
    let saved = false
    let lastErr = ""
    for (let attempt = 0; attempt < 5; attempt++, seq++) {
      code = codeOf(seq)
      const { error } = await supabase.from("problems").insert({ ...base, code })
      if (!error) { saved = true; break }
      lastErr = error.message
      // Duplicate lang ang sulit ulitin — ibang error, itapon agad.
      if (!/duplicate|unique|already exists/i.test(error.message)) throw new Error(error.message)
    }
    if (!saved) throw new Error(lastErr || "Hindi na-save ang problema")
    const row = { ...base, code }
    await logActivity(id, "Problem created", `${code} — ${input.title}`)
    if (input.owner_email) {
      await logActivity(id, "Assigned to user", input.owner_name || input.owner_email)
      await enqueueNotification({
        problemId: id, kind: "assigned", to: [input.owner_email, ...input.support_emails],
        subject: `[${code}] New problem assigned: ${input.title}`,
        body: `You have been assigned a new problem.\n\n${code} — ${input.title}\nDepartment: ${input.department}\nPriority: ${input.priority}\nTarget completion: ${input.target_date || "—"}\n\n${input.description}`,
        dedupeKey: `assigned|${id}`,
      })
    }
    await refresh()
    return { ...rowToProblem(row), id, code }
  }, [nextSeqFromDb, logActivity, refresh])

  const updateProblem = useCallback(async (id: string, patch: Partial<NewProblemInput>, before?: Problem) => {
    const supabase = createSupabaseBrowserClient()
    const row = { ...inputToRow(patch), updated_at: nowIso() }
    const { error } = await supabase.from("problems").update(row).eq("id", id)
    if (error) throw new Error(error.message)

    // Timeline — itala ang mga makabuluhang pagbabago.
    if (before) {
      const code = before.code
      if (patch.status && patch.status !== before.status) {
        await logActivity(id, "Status changed", `${before.status} → ${patch.status}`)
        if (patch.status === "Completed") {
          // Ayon sa spec: Manager + Reporter + Assigned users ang aabisuhan.
          const managers = await managerEmailsOf(before.department)
          const to = [before.owner_email, before.reported_by, ...before.support_emails, ...managers]
            .filter(x => x.includes("@"))
          await enqueueNotification({
            problemId: id, kind: "completed", to,
            subject: `[${code}] Problem completed: ${before.title}`,
            body: `The problem has been marked completed.\n\n${code} — ${before.title}\nRoot cause: ${patch.root_cause ?? before.root_cause}\nSolution: ${patch.solution ?? before.solution}`,
            dedupeKey: `completed|${id}`,
          })
        }
      }
      if (patch.owner_email && patch.owner_email !== before.owner_email) {
        await logActivity(id, "Assigned to user", patch.owner_name || patch.owner_email)
        await enqueueNotification({
          problemId: id, kind: "assigned", to: [patch.owner_email],
          subject: `[${code}] Problem assigned to you: ${before.title}`,
          body: `You have been assigned a problem.\n\n${code} — ${before.title}\nTarget completion: ${(patch.target_date ?? before.target_date) || "—"}`,
          dedupeKey: `assigned|${id}|${patch.owner_email}`,
        })
      }
      if (patch.target_date && patch.target_date !== before.target_date)
        await logActivity(id, "Deadline changed", `${before.target_date || "—"} → ${patch.target_date}`)
      if (patch.root_cause && patch.root_cause !== before.root_cause)
        await logActivity(id, "Root cause updated")
      if (patch.solution && patch.solution !== before.solution)
        await logActivity(id, "Solution updated")
    }
    await refresh()
  }, [logActivity, refresh])

  /** Manager approval — itinatala kung sino ang nag-aprub at kailan. */
  const approveProblem = useCallback(async (id: string) => {
    const supabase = createSupabaseBrowserClient()
    const by = currentUserName() || currentUserEmail()
    await supabase.from("problems").update({
      approved_by: by, approved_at: nowIso(), status: "Completed",
      actual_completion_date: todayStr(), updated_at: nowIso(),
    }).eq("id", id)
    await logActivity(id, "Completion approved", by)
    await refresh()
  }, [logActivity, refresh])

  const removeProblem = useCallback(async (id: string) => {
    const supabase = createSupabaseBrowserClient()
    await supabase.from("problems").delete().eq("id", id)
    await refresh()
  }, [refresh])

  return { problems, loaded, refresh, addProblem, updateProblem, approveProblem, removeProblem, logActivity, nextCode }
}

// ── Comments + activity para sa isang problema ────────────────────────────────
export function useProblemThread(problemId: string) {
  const [comments, setComments] = useState<ProblemComment[]>([])
  const [activity, setActivity] = useState<ProblemActivity[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    if (!problemId) { setComments([]); setActivity([]); setLoaded(true); return }
    const supabase = createSupabaseBrowserClient()
    const [c, a] = await Promise.all([
      supabase.from("problem_comments").select("*").eq("problem_id", problemId).order("created_at", { ascending: true }),
      supabase.from("problem_activity").select("*").eq("problem_id", problemId).order("at", { ascending: false }),
    ])
    setComments((c.data || []).map((r: any) => ({
      id: r.id, problem_id: r.problem_id, parent_id: r.parent_id || "",
      author: r.author || "", author_email: r.author_email || "", body: r.body || "",
      mentions: arr(r.mentions), attachments: files(r.attachments), created_at: r.created_at || "",
    })))
    setActivity((a.data || []).map((r: any) => ({
      id: r.id, problem_id: r.problem_id, action: r.action || "", detail: r.detail || "",
      by: r.by || "", at: r.at || "",
    })))
    setLoaded(true)
  }, [problemId])
  useEffect(() => { refresh() }, [refresh])

  const addComment = useCallback(async (body: string, opts?: {
    parentId?: string; mentions?: string[]; attachments?: Attachment[]
  }) => {
    const businessId = await getBusinessId()
    if (!businessId || !body.trim()) return
    const supabase = createSupabaseBrowserClient()
    const id = uid("cmt")
    await supabase.from("problem_comments").insert({
      id, business_id: businessId, problem_id: problemId, parent_id: opts?.parentId || "",
      author: currentUserName() || currentUserEmail(), author_email: currentUserEmail(),
      body: body.trim(), mentions: opts?.mentions || [], attachments: opts?.attachments || [],
      created_at: nowIso(),
    })
    await supabase.from("problem_activity").insert({
      id: uid("act"), business_id: businessId, problem_id: problemId,
      action: opts?.parentId ? "Reply added" : "Comment added", detail: body.trim().slice(0, 120),
      by: currentUserName() || currentUserEmail(), at: nowIso(),
    })
    await refresh()
  }, [problemId, refresh])

  const removeComment = useCallback(async (id: string) => {
    const supabase = createSupabaseBrowserClient()
    await supabase.from("problem_comments").delete().eq("id", id)
    await refresh()
  }, [refresh])

  return { comments, activity, loaded, refresh, addComment, removeComment }
}
