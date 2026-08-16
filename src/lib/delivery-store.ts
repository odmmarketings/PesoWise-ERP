"use client"
import { useCallback, useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"
import { currentUserEmail, currentUserName } from "@/lib/current-user"
import type { DeliveryAgent } from "@/lib/delivery-team-store"

// ──────────────────────────────────────────────────────────────────────────────
// Delivery & Problematic operations — assignment + agent working state, keyed by
// Pancake ORDER id (stable; ang tracking number ay maaaring mapalitan sa RTS
// reshipment). Pancake ang order/delivery truth; dito lang ang operational
// annotations. Source of truth = Supabase `delivery_orders` (isang row kada
// order); `pesowise_delivery_orders` localStorage ay same-session read cache.
// Bawat mahalagang galaw ay naitatala sa `delivery_activity` (audit trail).
// ──────────────────────────────────────────────────────────────────────────────

const KEY = "pesowise_delivery_orders"
const PAGE = 1000
const uid = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
const nowIso = () => new Date().toISOString()

const pad = (x: number) => String(x).padStart(2, "0")
export const todayStr = () => {
  const n = new Date()
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`
}
export const stampNow = () => {
  const n = new Date()
  return `${todayStr()} ${pad(n.getHours())}:${pad(n.getMinutes())}`
}

// ── Queues at agent statuses ──────────────────────────────────────────────────
export type AssignmentType = "delivering" | "problematic"

export const AGENT_STATUSES = [
  "Pending", "Unreachable", "Contacted", "Reminded", "Rescheduled",
  "Resolved", "Recovery", "Delivered", "Canceled", "Returned/RTS", "Other",
] as const
export type AgentStatus = (typeof AGENT_STATUSES)[number]

// Recovery ay para lang sa Problematic queue; Reminded/Resolved ay delivering flow.
export const DELIVERING_STATUSES: AgentStatus[] = [
  "Pending", "Contacted", "Reminded", "Rescheduled", "Unreachable",
  "Resolved", "Delivered", "Canceled", "Returned/RTS", "Other",
]
export const PROBLEMATIC_STATUSES: AgentStatus[] = [
  "Pending", "Contacted", "Unreachable", "Rescheduled", "Recovery",
  "Delivered", "Canceled", "Returned/RTS", "Other",
]

// Tailwind badge classes + hex (chart) — STATUS_COLOR idiom ng warehouse dashboard.
export const AGENT_STATUS_BADGE: Record<AgentStatus, string> = {
  "Pending": "bg-slate-100 text-slate-600",
  "Unreachable": "bg-orange-50 text-orange-700",
  "Contacted": "bg-blue-50 text-blue-700",
  "Reminded": "bg-cyan-50 text-cyan-700",
  "Rescheduled": "bg-amber-50 text-amber-700",
  "Resolved": "bg-teal-50 text-teal-700",
  "Recovery": "bg-purple-50 text-purple-700",
  "Delivered": "bg-emerald-50 text-emerald-700",
  "Canceled": "bg-red-50 text-red-600",
  "Returned/RTS": "bg-rose-50 text-rose-700",
  "Other": "bg-slate-100 text-slate-500",
}
export const AGENT_STATUS_COLOR: Record<AgentStatus, string> = {
  "Pending": "#94a3b8", "Unreachable": "#f97316", "Contacted": "#3b82f6",
  "Reminded": "#06b6d4", "Rescheduled": "#f59e0b", "Resolved": "#14b8a6",
  "Recovery": "#a855f7", "Delivered": "#10b981", "Canceled": "#ef4444",
  "Returned/RTS": "#e11d48", "Other": "#cbd5e1",
}

/** Terminal = tapos na ang trabaho ng agent dito (hindi na kasama sa "open load"). */
export const TERMINAL_STATUSES: AgentStatus[] = ["Delivered", "Canceled", "Returned/RTS", "Resolved"]

// ── RTS Recovery workflow (Problematic queue) ────────────────────────────────
// Ang recovery_outcome ang HATOL sa isang problematic case — hiwalay sa
// agent_status (na araw-araw na galaw). Dito kinukuha ang Recovery Rate, kaya
// hindi na hula mula sa agent_status. '' = bukas pa ang case.
export const RECOVERY_OUTCOMES = [
  "Recovered / Delivered", "Rescheduled", "Still Pending", "Unreachable",
  "Customer Refused", "Canceled", "Returned", "Failed Recovery",
] as const
export type RecoveryOutcome = (typeof RECOVERY_OUTCOMES)[number] | ""

/** Ang mga outcome na BILANG ng nabawi (numerator ng Recovery Rate). */
export const RECOVERED_OUTCOMES: RecoveryOutcome[] = ["Recovered / Delivered"]
/** Sarado na ang case (hindi na kasama sa "still working" na bilang). */
export const CLOSED_RECOVERY_OUTCOMES: RecoveryOutcome[] = [
  "Recovered / Delivered", "Customer Refused", "Canceled", "Returned", "Failed Recovery",
]

export const RECOVERY_BADGE: Record<string, string> = {
  "Recovered / Delivered": "bg-emerald-50 text-emerald-700",
  "Rescheduled": "bg-amber-50 text-amber-700",
  "Still Pending": "bg-slate-100 text-slate-600",
  "Unreachable": "bg-orange-50 text-orange-700",
  "Customer Refused": "bg-rose-50 text-rose-700",
  "Canceled": "bg-red-50 text-red-600",
  "Returned": "bg-rose-100 text-rose-700",
  "Failed Recovery": "bg-red-100 text-red-700",
}

/** Recovery funnel — pinakamalapit sa spec na daloy: RTS → assigned → contact →
 *  contacted → rescheduled → re-delivery → delivered. Hinuhugot sa mga field na
 *  meron na (walang hiwalay na stage column na kailangang panatilihing tapat). */
export function recoveryStage(r: DeliveryOrder): string {
  if (r.recovery_outcome === "Recovered / Delivered" || r.agent_status === "Delivered") return "Recovered"
  if (r.recovery_outcome && CLOSED_RECOVERY_OUTCOMES.includes(r.recovery_outcome)) return "Closed (not recovered)"
  if (r.agent_status === "Rescheduled" || r.recovery_outcome === "Rescheduled") return "Rescheduled"
  if (r.agent_status === "Contacted" || r.agent_status === "Recovery") return "Customer Contacted"
  if (r.call_attempts > 0 || r.agent_status === "Unreachable") return "Contact Attempt"
  return "Assigned for Recovery"
}
export const RECOVERY_STAGES = [
  "Assigned for Recovery", "Contact Attempt", "Customer Contacted",
  "Rescheduled", "Recovered", "Closed (not recovered)",
]

export interface DeliveryHistoryEntry { action: string; detail: string; by: string; at: string }

export interface DeliveryOrder {
  order_id: string
  assignment_type: AssignmentType
  // snapshot sa oras ng assignment (fallback kapag wala sa live Pancake window)
  customer_name: string
  phone: string
  address: string
  province: string
  city: string
  courier: string
  page_name: string
  amount: number
  tracking_no: string
  order_date: string
  parcel_status_snapshot: string
  // assignment
  assigned_to_email: string
  assigned_to_name: string
  assigned_by: string
  assigned_at: string
  assigned_date: string
  // agent working state
  agent_status: AgentStatus
  call_attempts: number
  last_contact_at: string
  next_follow_up: string
  reschedule_date: string
  reschedule_confirmed: boolean
  cancel_reason: string
  status_note: string
  notes: string
  // recovery workflow (Problematic queue)
  recovery_outcome: RecoveryOutcome
  recovery_outcome_at: string
  recovery_notes: string
  history: DeliveryHistoryEntry[]
  updated_by: string
  updated_at: string
}

/** Ang kailangan ng assignment mula sa isang live Pancake row (snapshot columns). */
export interface SnapshotInput {
  order_id: string
  customer_name: string
  phone: string
  address: string
  province: string
  city: string
  courier: string
  page_name: string
  amount: number
  tracking_no: string
  order_date: string
  parcel_status: string
}

function rowToOrder(r: any): DeliveryOrder {
  return {
    order_id: String(r.order_id),
    assignment_type: r.assignment_type === "problematic" ? "problematic" : "delivering",
    customer_name: r.customer_name || "", phone: r.phone || "", address: r.address || "",
    province: r.province || "", city: r.city || "", courier: r.courier || "",
    page_name: r.page_name || "", amount: Number(r.amount) || 0,
    tracking_no: r.tracking_no || "", order_date: r.order_date || "",
    parcel_status_snapshot: r.parcel_status_snapshot || "",
    assigned_to_email: r.assigned_to_email || "", assigned_to_name: r.assigned_to_name || "",
    assigned_by: r.assigned_by || "", assigned_at: r.assigned_at || "", assigned_date: r.assigned_date || "",
    agent_status: (AGENT_STATUSES as readonly string[]).includes(r.agent_status) ? r.agent_status : "Pending",
    call_attempts: Number(r.call_attempts) || 0,
    last_contact_at: r.last_contact_at || "", next_follow_up: r.next_follow_up || "",
    reschedule_date: r.reschedule_date || "", reschedule_confirmed: r.reschedule_confirmed === true,
    cancel_reason: r.cancel_reason || "", status_note: r.status_note || "", notes: r.notes || "",
    recovery_outcome: (RECOVERY_OUTCOMES as readonly string[]).includes(r.recovery_outcome) ? r.recovery_outcome : "",
    recovery_outcome_at: r.recovery_outcome_at || "", recovery_notes: r.recovery_notes || "",
    history: Array.isArray(r.history) ? r.history : [],
    updated_by: r.updated_by || "", updated_at: r.updated_at || "",
  }
}

function readCache(): Record<string, DeliveryOrder> {
  if (typeof window === "undefined") return {}
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") } catch { return {} }
}
function writeCache(map: Record<string, DeliveryOrder>) {
  try { localStorage.setItem(KEY, JSON.stringify(map)) } catch {}
}

const byLine = () => currentUserName() || currentUserEmail() || "System"

/** Isang audit-trail row sa delivery_activity (problem_activity pattern). */
async function insertActivity(rows: { order_id: string; action: string; detail: string }[]) {
  if (!rows.length) return
  const businessId = await getBusinessId()
  if (!businessId) return
  const supabase = createSupabaseBrowserClient()
  const by_name = byLine(), by_email = currentUserEmail()
  for (let i = 0; i < rows.length; i += 200) {
    await supabase.from("delivery_activity").insert(rows.slice(i, i + 200).map(r => ({
      id: uid("dact"), business_id: businessId, order_id: r.order_id,
      action: r.action, detail: r.detail, by_name, by_email, at: nowIso(),
    })))
  }
}

// ── Auto-assign planner (pure — para ma-preview ng modal bago i-commit) ───────
export interface AssignPlan {
  perAgent: { agent: DeliveryAgent; orders: SnapshotInput[] }[]
  leftover: SnapshotInput[]   // hindi naipamahagi dahil puno na ang caps
}

/** Least-loaded round-robin: simulan ang counter ng bawat agent sa kasalukuyang
 *  bilang ng open (non-terminal) assignments nila sa queue na ito, tapos ibigay
 *  ang bawat order sa pinakamababang counter. Respetado ang maxPerAgent (dagdag
 *  na bago, hindi kabuuang load). */
export function planAutoAssign(
  orders: SnapshotInput[], agents: DeliveryAgent[], currentLoads: Record<string, number>,
  maxPerAgent?: number,
): AssignPlan {
  const state = agents.map(agent => ({
    agent, load: currentLoads[agent.email.toLowerCase()] || 0, added: 0, orders: [] as SnapshotInput[],
  }))
  const leftover: SnapshotInput[] = []
  const sorted = [...orders].sort((a, b) => a.order_date.localeCompare(b.order_date))
  for (const o of sorted) {
    const open = state.filter(s => !maxPerAgent || s.added < maxPerAgent)
    if (!open.length) { leftover.push(o); continue }
    const target = open.reduce((m, s) => (s.load + s.added < m.load + m.added ? s : m), open[0])
    target.orders.push(o)
    target.added += 1
  }
  return { perAgent: state.filter(s => s.orders.length > 0).map(({ agent, orders }) => ({ agent, orders })), leftover }
}

// ── Main hook ─────────────────────────────────────────────────────────────────
export function useDeliveryOrders() {
  const [orders, setOrders] = useState<Record<string, DeliveryOrder>>({})
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const businessId = await getBusinessId()
    if (!businessId) { setLoaded(true); return }
    const supabase = createSupabaseBrowserClient()
    const out: Record<string, DeliveryOrder> = {}
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from("delivery_orders").select("*")
        .eq("business_id", businessId).range(from, from + PAGE - 1)
      if (error || !data) { setLoaded(true); return }
      for (const r of data) { const o = rowToOrder(r); out[o.order_id] = o }
      if (data.length < PAGE) break
    }
    writeCache(out)
    setOrders(out)
    setLoaded(true)
  }, [])
  useEffect(() => {
    setOrders(readCache())
    refresh()
  }, [refresh])

  /** I-assign ang mga order sa ISANG agent. Race-safe: upsert ignoreDuplicates —
   *  ang mga order na na-assign na ng ibang tab/user ay laktawan, hindi sapawan. */
  const assignOrders = useCallback(async (
    rows: SnapshotInput[], agent: { email: string; name: string }, type: AssignmentType,
  ): Promise<{ inserted: number; skipped: number }> => {
    const businessId = await getBusinessId()
    if (!businessId || !rows.length) return { inserted: 0, skipped: rows.length }
    const supabase = createSupabaseBrowserClient()
    const by = byLine(), now = nowIso(), today = todayStr()
    const email = agent.email.toLowerCase()
    const toRow = (s: SnapshotInput) => ({
      order_id: s.order_id, business_id: businessId, assignment_type: type,
      customer_name: s.customer_name, phone: s.phone, address: s.address,
      province: s.province, city: s.city, courier: s.courier, page_name: s.page_name,
      amount: s.amount, tracking_no: s.tracking_no, order_date: s.order_date,
      parcel_status_snapshot: s.parcel_status,
      assigned_to_email: email, assigned_to_name: agent.name, assigned_by: by,
      assigned_at: now, assigned_date: today,
      agent_status: "Pending", history: [{ action: "Assigned", detail: `→ ${email}`, by, at: now }],
      updated_by: by, updated_at: now,
    })
    const insertedIds: string[] = []
    for (let i = 0; i < rows.length; i += 200) {
      const { data } = await supabase.from("delivery_orders")
        .upsert(rows.slice(i, i + 200).map(toRow), { onConflict: "order_id", ignoreDuplicates: true })
        .select("order_id")
      for (const r of data || []) insertedIds.push(String(r.order_id))
    }
    await insertActivity(insertedIds.map(order_id => ({ order_id, action: "Assigned", detail: `→ ${email}` })))
    await refresh()
    return { inserted: insertedIds.length, skipped: rows.length - insertedIds.length }
  }, [refresh])

  /** Ilipat sa ibang agent — buo ang working state (attempts/notes), naka-log ang handover. */
  const reassign = useCallback(async (orderIds: string[], agent: { email: string; name: string }) => {
    const businessId = await getBusinessId()
    if (!businessId || !orderIds.length) return
    const supabase = createSupabaseBrowserClient()
    const by = byLine(), now = nowIso()
    const email = agent.email.toLowerCase()
    const acts: { order_id: string; action: string; detail: string }[] = []
    for (const id of orderIds) {
      const cur = orders[id]
      if (!cur || cur.assigned_to_email === email) continue
      const detail = `${cur.assigned_to_email || "unassigned"} → ${email}`
      await supabase.from("delivery_orders").update({
        assigned_to_email: email, assigned_to_name: agent.name, assigned_by: by,
        assigned_at: now, updated_by: by, updated_at: now,
        history: [...cur.history, { action: "Reassigned", detail, by, at: now }],
      }).eq("order_id", id)
      acts.push({ order_id: id, action: "Reassigned", detail })
    }
    await insertActivity(acts)
    await refresh()
  }, [orders, refresh])

  /** Ilipat ang queue (delivering ↔ problematic). Nire-reset sa Pending ang status
   *  dahil ibang playbook ang tatakbo sa bagong queue. */
  const moveToQueue = useCallback(async (orderIds: string[], type: AssignmentType) => {
    const businessId = await getBusinessId()
    if (!businessId || !orderIds.length) return
    const supabase = createSupabaseBrowserClient()
    const by = byLine(), now = nowIso()
    const action = type === "problematic" ? "Moved to Problematic" : "Moved to Delivering"
    const acts: { order_id: string; action: string; detail: string }[] = []
    for (const id of orderIds) {
      const cur = orders[id]
      if (!cur || cur.assignment_type === type) continue
      await supabase.from("delivery_orders").update({
        assignment_type: type, agent_status: "Pending",
        updated_by: by, updated_at: now,
        history: [...cur.history, { action, detail: `${cur.agent_status} → Pending`, by, at: now }],
      }).eq("order_id", id)
      acts.push({ order_id: id, action, detail: `from ${cur.assignment_type}` })
    }
    await insertActivity(acts)
    await refresh()
  }, [orders, refresh])

  /** Tanggalin sa queue (admin lang — hal. maling na-assign). May audit entry. */
  const unassignOrders = useCallback(async (orderIds: string[]) => {
    const businessId = await getBusinessId()
    if (!businessId || !orderIds.length) return
    const supabase = createSupabaseBrowserClient()
    await supabase.from("delivery_orders").delete().in("order_id", orderIds).eq("business_id", businessId)
    await insertActivity(orderIds.map(order_id => ({ order_id, action: "Unassigned", detail: "removed from queue" })))
    await refresh()
  }, [refresh])

  /**
   * I-save ang agent status / working fields nang may optimistic concurrency:
   * ang UPDATE ay tumatama lang kung hindi pa nagbago ang updated_at mula nang
   * buksan ng user ang record. Kapag 0 rows ang tinamaan, ibang user ang nauna —
   * ibinabalik ang sariwang row para makapag-warn ang UI (walang silent overwrite).
   */
  const saveAgentStatus = useCallback(async (
    orderId: string, patch: Partial<DeliveryOrder>, expectedUpdatedAt: string,
  ): Promise<{ ok: true } | { ok: false; conflict: DeliveryOrder | null }> => {
    const businessId = await getBusinessId()
    const cur = orders[orderId]
    if (!businessId || !cur) return { ok: false, conflict: null }
    const supabase = createSupabaseBrowserClient()
    const by = byLine(), now = nowIso()
    const entries: DeliveryHistoryEntry[] = []
    if (patch.agent_status && patch.agent_status !== cur.agent_status)
      entries.push({ action: "Status changed", detail: `${cur.agent_status} → ${patch.agent_status}`, by, at: now })
    if (patch.recovery_outcome !== undefined && patch.recovery_outcome !== cur.recovery_outcome)
      entries.push({ action: "Recovery outcome", detail: `${cur.recovery_outcome || "open"} → ${patch.recovery_outcome || "open"}`, by, at: now })
    if (entries.length === 0) entries.push({ action: "Updated", detail: "", by, at: now })

    const row: Record<string, any> = { updated_by: by, updated_at: now, history: [...cur.history, ...entries] }
    const cols: (keyof DeliveryOrder)[] = [
      "agent_status", "call_attempts", "last_contact_at", "next_follow_up",
      "reschedule_date", "reschedule_confirmed", "cancel_reason", "status_note", "notes",
      "recovery_outcome", "recovery_notes",
    ]
    for (const k of cols) if (patch[k] !== undefined) row[k] = patch[k]
    // Stamp kung kailan naibaba ang hatol — ito ang basehan ng recovery KPIs kada araw.
    if (patch.recovery_outcome !== undefined && patch.recovery_outcome !== cur.recovery_outcome)
      row.recovery_outcome_at = patch.recovery_outcome ? now : null

    const { data, error } = await supabase.from("delivery_orders").update(row)
      .eq("order_id", orderId).eq("updated_at", expectedUpdatedAt).select("order_id")
    if (error || !data || data.length === 0) {
      // Nauna ang ibang user (o nabigo ang write) — kunin ang sariwang row para sa warning.
      const { data: fresh } = await supabase.from("delivery_orders").select("*").eq("order_id", orderId).maybeSingle()
      const conflict = fresh ? rowToOrder(fresh) : null
      if (conflict) setOrders(prev => ({ ...prev, [orderId]: conflict }))
      return { ok: false, conflict }
    }
    const acts = entries
      .filter(e => e.action !== "Updated")
      .map(e => ({ order_id: orderId, action: e.action, detail: e.detail }))
    if (acts.length) await insertActivity(acts)
    // FUNCTIONAL update — huwag bumuo mula sa lumang snapshot.
    setOrders(prev => {
      const next = { ...prev, [orderId]: { ...prev[orderId], ...row, order_id: orderId } as DeliveryOrder }
      writeCache(next)
      return next
    })
    return { ok: true }
  }, [orders])

  /** Batch-level audit row (hal. "Auto-assign batch — 24 orders → 3 agents"). */
  const logBatch = useCallback(async (action: string, detail: string) => {
    await insertActivity([{ order_id: "", action, detail }])
  }, [])

  return { orders, loaded, refresh, assignOrders, reassign, moveToQueue, unassignOrders, saveAgentStatus, logBatch }
}

// ── Activity feed (dashboard + per-order timeline) ────────────────────────────
export interface DeliveryActivity {
  id: string; order_id: string; action: string; detail: string
  by_name: string; by_email: string; at: string
}

export function useDeliveryActivity(limit = 200) {
  const [activity, setActivity] = useState<DeliveryActivity[]>([])
  const refresh = useCallback(async () => {
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    const { data } = await supabase.from("delivery_activity").select("*")
      .eq("business_id", businessId).order("at", { ascending: false }).limit(limit)
    setActivity((data || []).map((r: any) => ({
      id: r.id, order_id: r.order_id || "", action: r.action || "", detail: r.detail || "",
      by_name: r.by_name || "", by_email: r.by_email || "", at: r.at || "",
    })))
  }, [limit])
  useEffect(() => { refresh() }, [refresh])
  return { activity, refresh }
}

// ── KPI scoring (configurable weights) ───────────────────────────────────────
// Isang JSONB blob sa delivery_settings. Ang weights ay porsyento — hindi
// hardcoded ang formula kaya kayang baguhin ng management ang timbang kada
// sukatan nang hindi kinakailangang mag-deploy.
export interface KpiWeights {
  delivery: number      // Delivery Rate
  contact: number       // Contact Rate
  recovery: number      // Recovery Rate (problematic cases lang)
  productivity: number  // Worked / Assigned
  followup: number      // Follow-ups na natapos sa oras
}
export const DEFAULT_KPI_WEIGHTS: KpiWeights = {
  delivery: 35, contact: 25, recovery: 20, productivity: 10, followup: 10,
}
export const KPI_WEIGHT_LABELS: Record<keyof KpiWeights, string> = {
  delivery: "Delivery Rate", contact: "Contact Rate", recovery: "Recovery Rate",
  productivity: "Productivity (worked / assigned)", followup: "Follow-up completion",
}

export function useDeliverySettings() {
  const [weights, setWeights] = useState<KpiWeights>(DEFAULT_KPI_WEIGHTS)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const businessId = await getBusinessId()
    if (!businessId) { setLoaded(true); return }
    const supabase = createSupabaseBrowserClient()
    const { data } = await supabase.from("delivery_settings").select("data").eq("business_id", businessId).maybeSingle()
    const w = (data as any)?.data?.kpi?.weights
    if (w) setWeights({ ...DEFAULT_KPI_WEIGHTS, ...w })
    setLoaded(true)
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const saveWeights = useCallback(async (next: KpiWeights) => {
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    setWeights(next)
    await supabase.from("delivery_settings").upsert(
      { business_id: businessId, data: { kpi: { weights: next } }, updated_at: nowIso() },
      { onConflict: "business_id" })
  }, [])

  return { weights, loaded, refresh, saveWeights }
}

// ── Per-agent KPI computation (iisa lang ang formula sa buong module) ────────
export interface AgentKpi {
  email: string; name: string
  assigned: number; worked: number
  delivered: number; rts: number
  problematic: number; recovered: number
  calls: number; contacted: number; notContacted: number
  pending: number; rescheduled: number; canceled: number; returned: number
  followUpsDue: number; followUpsDone: number
  deliveryRate: number; rtsRate: number; contactRate: number
  recoveryRate: number; productivity: number; followUpRate: number
  score: number
}

const rate = (num: number, den: number) => (den > 0 ? (num / den) * 100 : 0)

/**
 * Buuin ang scorecard ng isang agent mula sa kanyang mga record.
 * `deliveredOf` / `rtsOf` ay ipinapasa ng caller dahil ang totoong delivery
 * status ay galing sa live Pancake join na hawak ng page, hindi ng store.
 */
export function computeAgentKpi(
  email: string, name: string, rows: DeliveryOrder[], weights: KpiWeights,
  deliveredOf: (r: DeliveryOrder) => boolean, rtsOf: (r: DeliveryOrder) => boolean,
  today = todayStr(),
): AgentKpi {
  const assigned = rows.length
  // "Worked" = may ginawa na ang agent (hindi na nakaupo sa Pending nang walang galaw).
  const worked = rows.filter(r => r.agent_status !== "Pending" || r.call_attempts > 0 || r.notes !== "").length
  const delivered = rows.filter(deliveredOf).length
  const rts = rows.filter(rtsOf).length
  const problematic = rows.filter(r => r.assignment_type === "problematic")
  const recovered = problematic.filter(r => RECOVERED_OUTCOMES.includes(r.recovery_outcome)).length
  const contacted = rows.filter(r => r.call_attempts > 0 || r.last_contact_at !== "").length
  const calls = rows.reduce((s, r) => s + (r.call_attempts || 0), 0)
    + rows.filter(r => r.last_contact_at !== "").length   // konektadong tawag na walang attempt counter
  const count = (s: AgentStatus) => rows.filter(r => r.agent_status === s).length
  // Follow-up: due na ba, at nagalaw ba pagkatapos ng petsa?
  const withFollowUp = rows.filter(r => r.next_follow_up && r.next_follow_up <= today)
  const followUpsDone = withFollowUp.filter(r =>
    TERMINAL_STATUSES.includes(r.agent_status) || String(r.updated_at).slice(0, 10) >= r.next_follow_up).length

  const deliveryRate = rate(delivered, assigned)
  const rtsRate = rate(rts, assigned)
  const contactRate = rate(contacted, assigned)
  const recoveryRate = rate(recovered, problematic.length)
  const productivity = rate(worked, assigned)
  const followUpRate = withFollowUp.length > 0 ? rate(followUpsDone, withFollowUp.length) : 100

  // Ang recovery ay hindi kasama sa timbang kapag walang problematic case ang
  // agent — kung hindi, mapaparusahan siya sa trabahong hindi naman sa kanya.
  const parts: [number, number][] = [
    [deliveryRate, weights.delivery],
    [contactRate, weights.contact],
    [productivity, weights.productivity],
    [followUpRate, weights.followup],
  ]
  if (problematic.length > 0) parts.push([recoveryRate, weights.recovery])
  const totalWeight = parts.reduce((s, [, w]) => s + w, 0)
  const score = totalWeight > 0 ? parts.reduce((s, [v, w]) => s + v * w, 0) / totalWeight : 0

  return {
    email, name, assigned, worked, delivered, rts,
    problematic: problematic.length, recovered,
    calls, contacted, notContacted: assigned - contacted,
    pending: count("Pending"), rescheduled: count("Rescheduled"),
    canceled: count("Canceled"), returned: count("Returned/RTS"),
    followUpsDue: withFollowUp.length, followUpsDone,
    deliveryRate, rtsRate, contactRate, recoveryRate, productivity, followUpRate,
    score,
  }
}

/** Activity ng isang order (HISTORY sidebar ng detail screen). */
export async function fetchOrderActivity(orderId: string): Promise<DeliveryActivity[]> {
  const supabase = createSupabaseBrowserClient()
  const { data } = await supabase.from("delivery_activity").select("*")
    .eq("order_id", orderId).order("at", { ascending: false }).limit(100)
  return (data || []).map((r: any) => ({
    id: r.id, order_id: r.order_id || "", action: r.action || "", detail: r.detail || "",
    by_name: r.by_name || "", by_email: r.by_email || "", at: r.at || "",
  }))
}
