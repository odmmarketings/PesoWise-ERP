"use client"
import { useCallback, useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"
import { currentUserEmail, currentUserName } from "@/lib/current-user"
import { notify, rosterEmailByName } from "@/lib/notify"

// ─────────────────────────────────────────────────────────────────────────────
// PARTNER TASKS + MONTHLY TARGETS (migration 0029). Supabase ang source of
// truth — tatlong buyer at ang may-ari ang magbabasa, kaya ang localStorage ay
// magpapakita ng magkakaibang listahan kada makina, gaya ng scaling registry.
//
// ANG DALOY: open → (partner: "Mark as done") → review → (may-ari: Approve) →
// done. Ang premyo ay nagiging "earned" LANG pagkatapos ng approve — kung ang
// partner mismo ang huling salita, sariling-sertipika ang premyo.
// ─────────────────────────────────────────────────────────────────────────────

export type TaskStatus = "open" | "review" | "done"

export interface PartnerTask {
  id: string
  title: string
  details: string
  owner: string
  deadline: string          // YYYY-MM-DD o ""
  reward: string
  status: TaskStatus
  created_at: string
  created_by_name: string
  submitted_at: string
  done_at: string
  approved_by: string
}

export interface PartnerTarget {
  id: string
  owner: string
  month: string             // YYYY-MM
  target_sales: number
  target_roas: number
  reward: string
}

export const monthKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`

export const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/**
 * Ano ang sasabihin ng deadline chip. HINUHUSGAHAN SA PAGBASA — ang "overdue"
 * ay hindi kolum sa database (mangangailangan iyon ng cron sa hatinggabi;
 * ang derived ay laging tama sa mismong sandali ng pagtingin).
 */
export function deadlineInfo(deadline: string, status: TaskStatus, today = todayStr()):
  { label: string; tone: "ok" | "soon" | "late" | "none" } {
  if (!deadline) return { label: "No deadline", tone: "none" }
  if (status === "done") return { label: `Due ${deadline}`, tone: "none" }
  const days = Math.round((Date.parse(deadline) - Date.parse(today)) / 86400_000)
  if (days < 0) return { label: `${-days}d overdue`, tone: "late" }
  if (days === 0) return { label: "Due today", tone: "soon" }
  if (days <= 2) return { label: `${days}d left`, tone: "soon" }
  return { label: `${days}d left`, tone: "ok" }
}

/**
 * Ang bilang sa tab. IBA ANG TANONG KADA TAO: ang may-ari ay "ilan ang
 * naghihintay ng APRUBA ko" (review); ang partner ay "ilan ang HINDI KO PA
 * tapos" (open + review na sa kanya). Iisang numero na may dalawang kahulugan
 * ay lito — kaya ang tumitingin ang batayan.
 */
export function badgeCount(
  tasks: { status: TaskStatus; owner: string }[],
  me: { mother: boolean; name: string; email: string },
  ownerEmailOf: (o: string) => string,
): number {
  if (me.mother) return tasks.filter(t => t.status === "review").length
  return tasks.filter(t => t.status !== "done"
    && (ownerEmailOf(t.owner) === me.email || t.owner.trim().toLowerCase() === me.name)).length
}

const rowToTask = (r: any): PartnerTask => ({
  id: r.id, title: r.title || "", details: r.details || "", owner: r.owner || "",
  deadline: r.deadline || "", reward: r.reward || "",
  status: r.status === "done" ? "done" : r.status === "review" ? "review" : "open",
  created_at: r.created_at, created_by_name: r.created_by_name || "",
  submitted_at: r.submitted_at || "", done_at: r.done_at || "", approved_by: r.approved_by || "",
})

const HREF = "/business/ads/facebook"

export function usePartnerTasks() {
  const [tasks, setTasks] = useState<PartnerTask[]>([])
  const [targets, setTargets] = useState<PartnerTarget[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState("")

  const refresh = useCallback(async () => {
    const businessId = await getBusinessId()
    if (!businessId) { setLoaded(true); return }
    const supabase = createSupabaseBrowserClient()
    const [t, g] = await Promise.all([
      supabase.from("partner_tasks").select("*")
        .eq("business_id", businessId).eq("deleted", false)
        .order("created_at", { ascending: false }).limit(500),
      supabase.from("partner_targets").select("*")
        .eq("business_id", businessId).eq("month", monthKey()),
    ])
    if (t.error || g.error) {
      const msg = t.error?.message || g.error?.message || ""
      setError(/partner_task|partner_target/.test(msg) || t.error?.code === "42P01" || g.error?.code === "42P01"
        ? "The partner tasks tables don't exist yet — run migration 0029_partner_tasks.sql in Supabase first."
        : msg)
      setLoaded(true); return
    }
    setError("")
    setTasks((t.data || []).map(rowToTask))
    setTargets((g.data || []).map((r: any) => ({
      id: r.id, owner: r.owner, month: r.month,
      target_sales: Number(r.target_sales) || 0, target_roas: Number(r.target_roas) || 0,
      reward: r.reward || "",
    })))
    setLoaded(true)
  }, [])
  useEffect(() => { refresh() }, [refresh])

  /** Isang task kada napiling partner — ang parehong utos sa tatlo ay tatlong row. */
  const createTasks = useCallback(async (input: { title: string; details: string; owners: string[]; deadline: string; reward: string }) => {
    const businessId = await getBusinessId()
    if (!businessId || input.owners.length === 0 || !input.title.trim()) return "Missing title or partner"
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("partner_tasks").insert(input.owners.map(o => ({
      business_id: businessId, title: input.title.trim(), details: input.details.trim(),
      owner: o, deadline: input.deadline || null, reward: input.reward.trim(),
      created_by_name: currentUserName() || "", created_by_email: (currentUserEmail() || "").toLowerCase(),
    })))
    if (error) return error.message
    // Abiso sa bawat partner — pangalan ang hawak natin; email mula sa roster.
    // Kapag walang tugma sa roster, WALANG pinadadalhan (hindi "all": ang task
    // ni Eric ay hindi balita para kina Eugene at Larry).
    for (const o of input.owners) {
      const email = rosterEmailByName(o)
      if (!email) continue
      notify({
        audience: "user", toEmail: email, type: "task-assigned", severity: "info",
        title: `New task: "${input.title.trim()}"`,
        body: [input.deadline ? `Deadline ${input.deadline}` : "", input.reward ? `Reward: ${input.reward}` : ""].filter(Boolean).join(" · "),
        href: HREF,
      })
    }
    await refresh()
    return ""
  }, [refresh])

  const updateTask = useCallback(async (id: string, patch: { title?: string; details?: string; owner?: string; deadline?: string; reward?: string }) => {
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    await supabase.from("partner_tasks").update({
      ...(patch.title != null ? { title: patch.title.trim() } : {}),
      ...(patch.details != null ? { details: patch.details.trim() } : {}),
      ...(patch.owner != null ? { owner: patch.owner } : {}),
      ...(patch.deadline !== undefined ? { deadline: patch.deadline || null } : {}),
      ...(patch.reward != null ? { reward: patch.reward.trim() } : {}),
      updated_at: new Date().toISOString(),
    }).eq("business_id", businessId).eq("id", id)
    await refresh()
  }, [refresh])

  const deleteTask = useCallback(async (id: string) => {
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    await supabase.from("partner_tasks").update({ deleted: true, updated_at: new Date().toISOString() })
      .eq("business_id", businessId).eq("id", id)
    await refresh()
  }, [refresh])

  /** Partner: "tapos na ako" — papunta sa review, hindi diretsong done. */
  const submitTask = useCallback(async (t: PartnerTask) => {
    if (t.status !== "open") return
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    await supabase.from("partner_tasks").update({
      status: "review", submitted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("business_id", businessId).eq("id", t.id).eq("status", "open")
    notify({
      audience: "admin", type: "task-review", severity: "info",
      title: `${currentUserName() || t.owner} finished "${t.title}" — review it`,
      body: t.reward ? `Reward on approval: ${t.reward}` : "",
      href: HREF,
    })
    await refresh()
  }, [refresh])

  /** May-ari: aprubado — dito lang nagiging "earned" ang premyo. */
  const approveTask = useCallback(async (t: PartnerTask) => {
    if (t.status === "done") return
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    await supabase.from("partner_tasks").update({
      status: "done", done_at: new Date().toISOString(),
      approved_by: currentUserName() || "", updated_at: new Date().toISOString(),
    }).eq("business_id", businessId).eq("id", t.id)
    const email = rosterEmailByName(t.owner)
    if (email) notify({
      audience: "user", toEmail: email, type: "task-approved", severity: "info",
      title: `Approved: "${t.title}"`,
      body: t.reward ? `🎁 Reward earned: ${t.reward}` : "Marked done.",
      href: HREF,
    })
    await refresh()
  }, [refresh])

  /** May-ari: ibalik — may kulang pa. Bumabalik sa open, hindi nabubura. */
  const returnTask = useCallback(async (t: PartnerTask) => {
    if (t.status !== "review") return
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    await supabase.from("partner_tasks").update({
      status: "open", submitted_at: null, updated_at: new Date().toISOString(),
    }).eq("business_id", businessId).eq("id", t.id).eq("status", "review")
    const email = rosterEmailByName(t.owner)
    if (email) notify({
      audience: "user", toEmail: email, type: "task-returned", severity: "warning",
      title: `Returned: "${t.title}"`,
      body: "Something still needs work — check with the owner, then mark it done again.",
      href: HREF,
    })
    await refresh()
  }, [refresh])

  /** Upsert ng target ng buwang ito para sa isang partner. */
  const setTarget = useCallback(async (owner: string, input: { target_sales: number; target_roas: number; reward: string }) => {
    const businessId = await getBusinessId()
    if (!businessId) return "No business"
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("partner_targets").upsert({
      business_id: businessId, owner, month: monthKey(),
      target_sales: input.target_sales || 0, target_roas: input.target_roas || 0,
      reward: input.reward.trim(), updated_at: new Date().toISOString(),
      updated_by: currentUserName() || "",
    }, { onConflict: "business_id,owner,month" })
    if (error) return error.message
    const email = rosterEmailByName(owner)
    if (email) notify({
      audience: "user", toEmail: email, type: "target-set", severity: "info",
      title: `Your ${monthKey()} target is set`,
      body: [input.target_sales ? `Sales ₱${input.target_sales.toLocaleString()}` : "",
        input.target_roas ? `Net ROAS ${input.target_roas}` : "",
        input.reward ? `Reward: ${input.reward}` : ""].filter(Boolean).join(" · "),
      href: HREF,
    })
    await refresh()
    return ""
  }, [refresh])

  return { tasks, targets, loaded, error, refresh, createTasks, updateTask, deleteTask, submitTask, approveTask, returnTask, setTarget }
}
