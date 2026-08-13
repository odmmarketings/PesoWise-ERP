"use client"
// Telemarketing Sales & Operations — shared data layer (docs/telemarketing-spec.md).
// Supabase is the source of truth; localStorage is a same-session read cache for
// instant first paint (bookkeeping-store pattern). All KPI math that more than one
// page needs lives here so dashboard / hourly / reports never disagree (spec §34).
import { useState, useEffect, useCallback } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"
import { currentUserName } from "@/lib/current-user"
import { getSettingBlob, setSettingBlob } from "@/lib/supa-rows"

const uid = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
const nowStamp = () => new Date().toISOString()
export const todayStr = () => new Date().toISOString().slice(0, 10)
export const thisMonthStr = () => new Date().toISOString().slice(0, 7)
export const nowTimeStr = () => {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

type HistEntry = { action: string; by: string; date: string; note?: string }
const hist = (action: string, note?: string): HistEntry => ({ action, by: currentUserName(), date: nowStamp(), ...(note ? { note } : {}) })

// ────────────────────────────────────────────────────────────────────────────
// Constants (statuses per spec §14; badges follow the soft bg-*-50 pill convention)
// ────────────────────────────────────────────────────────────────────────────
export const LEAD_STATUSES = [
  "New", "Pending", "Attempted", "Connected", "Unreachable", "Follow-up", "Interested",
  "Upsell Successful", "Cross-sell Successful", "Both Upsell + Cross-sell",
  "Declined", "Do Not Call", "Completed", "Other",
] as const
export type LeadStatus = typeof LEAD_STATUSES[number]

export const LEAD_STATUS_BADGE: Record<string, string> = {
  "New": "bg-teal-50 text-teal-700",
  "Pending": "bg-slate-100 text-slate-600",
  "Attempted": "bg-amber-50 text-amber-700",
  "Connected": "bg-blue-50 text-blue-700",
  "Unreachable": "bg-orange-50 text-orange-700",
  "Follow-up": "bg-violet-50 text-violet-700",
  "Interested": "bg-cyan-50 text-cyan-700",
  "Upsell Successful": "bg-emerald-50 text-emerald-700",
  "Cross-sell Successful": "bg-emerald-50 text-emerald-700",
  "Both Upsell + Cross-sell": "bg-green-50 text-green-700",
  "Declined": "bg-red-50 text-red-700",
  "Do Not Call": "bg-red-100 text-red-800",
  "Completed": "bg-slate-200 text-slate-700",
  "Other": "bg-slate-100 text-slate-600",
}

export const SALES_STATUSES = ["Pending", "Confirmed", "Completed", "Cancelled"] as const
export const SALES_STATUS_BADGE: Record<string, string> = {
  "Pending": "bg-amber-50 text-amber-700",
  "Confirmed": "bg-blue-50 text-blue-700",
  "Completed": "bg-emerald-50 text-emerald-700",
  "Cancelled": "bg-red-50 text-red-700",
}

export const CALL_DISPOSITIONS = [
  "Answered", "No Answer", "Busy", "Wrong Number", "Switched Off",
  "Interested", "Declined", "Call Back Later",
] as const

export const SCRIPT_CATEGORIES = [
  "Opening", "Product Introduction", "Upsell Pitch", "Cross-sell Pitch", "Benefits", "Pricing",
  "Objection Handling", "Closing", "Follow-up", "FAQ", "Other",
] as const

// Successful-sale lead statuses (the funnel's conversion stage, spec §29)
export const WON_LEAD_STATUSES: string[] = ["Upsell Successful", "Cross-sell Successful", "Both Upsell + Cross-sell", "Completed"]

// ────────────────────────────────────────────────────────────────────────────
// Types + normalizers
// ────────────────────────────────────────────────────────────────────────────
export interface TmAgent {
  id: string; agent_name: string; team: string; phone: string; email: string
  status: "Active" | "Inactive"; added_by: string; added_date: string; history: HistEntry[]
}
const rowToAgent = (r: any): TmAgent => ({
  id: r.id, agent_name: r.agent_name ?? "", team: r.team ?? "", phone: r.phone ?? "", email: r.email ?? "",
  status: r.status === "Inactive" ? "Inactive" : "Active",
  added_by: r.added_by ?? "", added_date: r.added_date ?? "", history: Array.isArray(r.history) ? r.history : [],
})

export interface TmLead {
  id: string; customer_name: string; phone: string; address: string; source: string
  original_order_id: string; original_product: string; order_amount: number; order_date: string
  assigned_to: string; status: string; follow_up_date: string; call_attempts: number
  last_call_at: string; notes: string; added_by: string; added_date: string; updated_at: string; history: HistEntry[]
}
const rowToLead = (r: any): TmLead => ({
  id: r.id, customer_name: r.customer_name ?? "", phone: r.phone ?? "", address: r.address ?? "",
  source: r.source ?? "", original_order_id: r.original_order_id ?? "", original_product: r.original_product ?? "",
  order_amount: Number(r.order_amount) || 0, order_date: r.order_date ?? "", assigned_to: r.assigned_to ?? "",
  status: r.status ?? "New", follow_up_date: r.follow_up_date ?? "", call_attempts: Number(r.call_attempts) || 0,
  last_call_at: r.last_call_at ?? "", notes: r.notes ?? "", added_by: r.added_by ?? "", added_date: r.added_date ?? "",
  updated_at: r.updated_at ?? "", history: Array.isArray(r.history) ? r.history : [],
})

export interface TmCall {
  id: string; lead_id: string; agent_id: string; agent_name: string
  call_date: string; call_time: string; connected: boolean; disposition: string
  duration_sec: number; attempt_no: number; source: "manual" | "godial"; notes: string
  added_by: string; added_date: string
}
const rowToCall = (r: any): TmCall => ({
  id: r.id, lead_id: r.lead_id ?? "", agent_id: r.agent_id ?? "", agent_name: r.agent_name ?? "",
  call_date: r.call_date ?? "", call_time: r.call_time ?? "", connected: !!r.connected,
  disposition: r.disposition ?? "", duration_sec: Number(r.duration_sec) || 0, attempt_no: Number(r.attempt_no) || 1,
  source: r.source === "godial" ? "godial" : "manual", notes: r.notes ?? "",
  added_by: r.added_by ?? "", added_date: r.added_date ?? "",
})

export interface TmSale {
  id: string; lead_id: string; sale_date: string; sale_time: string
  customer_name: string; customer_phone: string; original_order_id: string; original_product: string
  agent_id: string; agent_name: string; sale_type: "Upsell" | "Cross-sell" | "Both"
  upsell_product: string; upsell_qty: number; upsell_amount: number
  cross_product: string; cross_qty: number; cross_amount: number
  total_qty: number; total_amount: number
  call_status: string; sales_status: string; notes: string
  added_by: string; added_date: string; updated_at: string; history: HistEntry[]
}
const rowToSale = (r: any): TmSale => ({
  id: r.id, lead_id: r.lead_id ?? "", sale_date: r.sale_date ?? "", sale_time: r.sale_time ?? "",
  customer_name: r.customer_name ?? "", customer_phone: r.customer_phone ?? "",
  original_order_id: r.original_order_id ?? "", original_product: r.original_product ?? "",
  agent_id: r.agent_id ?? "", agent_name: r.agent_name ?? "",
  sale_type: r.sale_type === "Cross-sell" ? "Cross-sell" : r.sale_type === "Both" ? "Both" : "Upsell",
  upsell_product: r.upsell_product ?? "", upsell_qty: Number(r.upsell_qty) || 0, upsell_amount: Number(r.upsell_amount) || 0,
  cross_product: r.cross_product ?? "", cross_qty: Number(r.cross_qty) || 0, cross_amount: Number(r.cross_amount) || 0,
  total_qty: Number(r.total_qty) || 0, total_amount: Number(r.total_amount) || 0,
  call_status: r.call_status ?? "", sales_status: r.sales_status ?? "Pending", notes: r.notes ?? "",
  added_by: r.added_by ?? "", added_date: r.added_date ?? "", updated_at: r.updated_at ?? "",
  history: Array.isArray(r.history) ? r.history : [],
})

export interface TmTarget {
  id: string; month: string; agent_id: string
  sales_target: number; orders_target: number
  daily_sales_target: number; daily_orders_target: number; conversion_target: number
}
const rowToTarget = (r: any): TmTarget => ({
  id: r.id, month: r.month ?? "", agent_id: r.agent_id ?? "",
  sales_target: Number(r.sales_target) || 0, orders_target: Number(r.orders_target) || 0,
  daily_sales_target: Number(r.daily_sales_target) || 0, daily_orders_target: Number(r.daily_orders_target) || 0,
  conversion_target: Number(r.conversion_target) || 0,
})

export interface TmScript {
  id: string; product: string; category: string; title: string; body: string
  active: boolean; sort: number; added_by: string; added_date: string; updated_at: string; history: HistEntry[]
}
const rowToScript = (r: any): TmScript => ({
  id: r.id, product: r.product ?? "", category: r.category ?? "Opening", title: r.title ?? "", body: r.body ?? "",
  active: r.active !== false, sort: Number(r.sort) || 0,
  added_by: r.added_by ?? "", added_date: r.added_date ?? "", updated_at: r.updated_at ?? "",
  history: Array.isArray(r.history) ? r.history : [],
})

// ────────────────────────────────────────────────────────────────────────────
// Cache helpers
// ────────────────────────────────────────────────────────────────────────────
function readCache<T>(key: string): T[] {
  if (typeof window === "undefined") return []
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : [] } catch { return [] }
}
function writeCache<T>(key: string, list: T[]) {
  try { localStorage.setItem(key, JSON.stringify(list)) } catch {}
}

// Generic hook factory: refresh + CRUD, every mutation ends in await refresh().
function makeUseTable<T extends { id: string }>(table: string, cacheKey: string, normalize: (r: any) => T, orderCol = "added_date") {
  return function useTable() {
    const [items, setItems] = useState<T[]>(() => readCache<T>(cacheKey))
    const [loading, setLoading] = useState(true)

    const refresh = useCallback(async () => {
      const businessId = await getBusinessId()
      if (!businessId) { setLoading(false); return }
      const supabase = createSupabaseBrowserClient()
      const { data, error } = await supabase.from(table).select("*")
        .eq("business_id", businessId).order(orderCol, { ascending: false }).limit(10000)
      if (!error && data) { const list = data.map(normalize); writeCache(cacheKey, list); setItems(list) }
      setLoading(false)
    }, [])
    useEffect(() => { refresh() }, [refresh])

    const insertRow = useCallback(async (row: Record<string, unknown>) => {
      const businessId = await getBusinessId()
      const supabase = createSupabaseBrowserClient()
      const { error } = await supabase.from(table).insert({ business_id: businessId, ...row })
      if (error) throw error
      await refresh()
    }, [refresh])

    const updateRow = useCallback(async (id: string, patch: Record<string, unknown>) => {
      const supabase = createSupabaseBrowserClient()
      const { error } = await supabase.from(table).update(patch).eq("id", id)
      if (error) throw error
      await refresh()
    }, [refresh])

    const removeRow = useCallback(async (id: string) => {
      const supabase = createSupabaseBrowserClient()
      const { error } = await supabase.from(table).delete().eq("id", id)
      if (error) throw error
      await refresh()
    }, [refresh])

    return { items, loaded: !loading, refresh, insertRow, updateRow, removeRow }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Hooks
// ────────────────────────────────────────────────────────────────────────────
const useAgentsBase = makeUseTable<TmAgent>("tm_agents", "pesowise_tm_agents", rowToAgent)
export function useTmAgents() {
  const base = useAgentsBase()
  const addAgent = useCallback(async (input: { agent_name: string; team?: string; phone?: string; email?: string }) => {
    await base.insertRow({
      id: uid("tma"), agent_name: input.agent_name, team: input.team ?? "", phone: input.phone ?? "", email: input.email ?? "",
      status: "Active", added_by: currentUserName(), history: [hist("Created")],
    })
  }, [base.insertRow])
  const updateAgent = useCallback(async (id: string, patch: Partial<TmAgent>, note?: string) => {
    const prev = base.items.find(a => a.id === id)
    await base.updateRow(id, { ...patch, history: [...(prev?.history ?? []), hist("Updated", note)] })
  }, [base.items, base.updateRow])
  return { agents: base.items, loaded: base.loaded, refresh: base.refresh, addAgent, updateAgent, removeAgent: base.removeRow }
}

const useLeadsBase = makeUseTable<TmLead>("tm_leads", "pesowise_tm_leads", rowToLead)
export function useTmLeads() {
  const base = useLeadsBase()

  const addLead = useCallback(async (input: Partial<TmLead>) => {
    await base.insertRow({
      id: uid("tml"),
      customer_name: input.customer_name ?? "", phone: input.phone ?? "", address: input.address ?? "",
      source: input.source ?? "", original_order_id: input.original_order_id ?? "",
      original_product: input.original_product ?? "", order_amount: input.order_amount ?? 0,
      order_date: input.order_date ?? "", assigned_to: input.assigned_to ?? "", status: input.status ?? "New",
      follow_up_date: input.follow_up_date ?? "", notes: input.notes ?? "",
      added_by: currentUserName(), updated_at: nowStamp(), history: [hist("Created")],
    })
  }, [base.insertRow])

  // Optimistic-concurrency update: match id + updated_at; 0 rows → someone else saved first.
  const updateLead = useCallback(async (id: string, patch: Partial<TmLead>, action = "Updated", note?: string) => {
    const prev = base.items.find(l => l.id === id)
    const supabase = createSupabaseBrowserClient()
    const { data, error } = await supabase.from("tm_leads")
      .update({ ...patch, updated_at: nowStamp(), history: [...(prev?.history ?? []), hist(action, note)] })
      .eq("id", id).eq("updated_at", prev?.updated_at ?? "").select("id")
    if (error) throw error
    if (!data || data.length === 0) { await base.refresh(); throw new Error("This lead was just updated by someone else — refreshed, please retry.") }
    await base.refresh()
  }, [base.items, base.refresh])

  const bulkAssign = useCallback(async (ids: string[], agentId: string, agentName: string) => {
    const supabase = createSupabaseBrowserClient()
    for (const id of ids) {
      const prev = base.items.find(l => l.id === id)
      await supabase.from("tm_leads")
        .update({ assigned_to: agentId, updated_at: nowStamp(), history: [...(prev?.history ?? []), hist("Assigned", agentName)] })
        .eq("id", id)
    }
    await base.refresh()
  }, [base.items, base.refresh])

  const importLeads = useCallback(async (rows: Partial<TmLead>[]) => {
    const businessId = await getBusinessId()
    const supabase = createSupabaseBrowserClient()
    const payload = rows.map(input => ({
      business_id: businessId, id: uid("tml"),
      customer_name: input.customer_name ?? "", phone: input.phone ?? "", address: input.address ?? "",
      source: input.source ?? "Import", original_order_id: input.original_order_id ?? "",
      original_product: input.original_product ?? "", order_amount: input.order_amount ?? 0,
      order_date: input.order_date ?? "", assigned_to: input.assigned_to ?? "", status: "New",
      added_by: currentUserName(), updated_at: nowStamp(), history: [hist("Imported")],
    }))
    for (let i = 0; i < payload.length; i += 200) {
      const { error } = await supabase.from("tm_leads").insert(payload.slice(i, i + 200))
      if (error) throw error
    }
    await base.refresh()
  }, [base.refresh])

  return { leads: base.items, loaded: base.loaded, refresh: base.refresh, addLead, updateLead, bulkAssign, importLeads, removeLead: base.removeRow }
}

const useCallsBase = makeUseTable<TmCall>("tm_calls", "pesowise_tm_calls", rowToCall)
export function useTmCalls() {
  const base = useCallsBase()
  // Records the call AND stamps the lead (attempts+1, last_call_at, optional status) in one go,
  // so pages never write the two tables separately (spec §34 single source of truth).
  const recordCall = useCallback(async (input: {
    lead: TmLead | null; agent_id: string; agent_name: string
    connected: boolean; disposition?: string; duration_sec?: number; notes?: string; newLeadStatus?: string
  }) => {
    const businessId = await getBusinessId()
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("tm_calls").insert({
      business_id: businessId, id: uid("tmc"),
      lead_id: input.lead?.id ?? "", agent_id: input.agent_id, agent_name: input.agent_name,
      call_date: todayStr(), call_time: nowTimeStr(), connected: input.connected,
      disposition: input.disposition ?? "", duration_sec: input.duration_sec ?? 0,
      attempt_no: (input.lead?.call_attempts ?? 0) + 1, source: "manual",
      notes: input.notes ?? "", added_by: currentUserName(),
    })
    if (error) throw error
    if (input.lead) {
      await supabase.from("tm_leads").update({
        call_attempts: input.lead.call_attempts + 1,
        last_call_at: `${todayStr()} ${nowTimeStr()}`,
        ...(input.newLeadStatus ? { status: input.newLeadStatus } : {}),
        updated_at: nowStamp(),
        history: [...input.lead.history, hist(input.connected ? "Call: Connected" : "Call: Not Connected", input.disposition)],
      }).eq("id", input.lead.id)
    }
    await base.refresh()
  }, [base.refresh])
  return { calls: base.items, loaded: base.loaded, refresh: base.refresh, recordCall }
}

const useSalesBase = makeUseTable<TmSale>("tm_sales", "pesowise_tm_sales", rowToSale)
export function useTmSales() {
  const base = useSalesBase()

  const addSale = useCallback(async (input: Partial<TmSale>) => {
    const upsellQty = input.upsell_qty ?? 0, crossQty = input.cross_qty ?? 0
    const upsellAmt = input.upsell_amount ?? 0, crossAmt = input.cross_amount ?? 0
    const sale_type: TmSale["sale_type"] = upsellQty > 0 && crossQty > 0 ? "Both" : crossQty > 0 ? "Cross-sell" : "Upsell"
    await base.insertRow({
      id: uid("tms"), lead_id: input.lead_id ?? "",
      sale_date: input.sale_date || todayStr(), sale_time: input.sale_time || nowTimeStr(),
      customer_name: input.customer_name ?? "", customer_phone: input.customer_phone ?? "",
      original_order_id: input.original_order_id ?? "", original_product: input.original_product ?? "",
      agent_id: input.agent_id ?? "", agent_name: input.agent_name ?? "", sale_type,
      upsell_product: input.upsell_product ?? "", upsell_qty: upsellQty, upsell_amount: upsellAmt,
      cross_product: input.cross_product ?? "", cross_qty: crossQty, cross_amount: crossAmt,
      total_qty: upsellQty + crossQty, total_amount: upsellAmt + crossAmt,
      call_status: input.call_status ?? "Connected", sales_status: input.sales_status ?? "Confirmed",
      notes: input.notes ?? "", added_by: currentUserName(), updated_at: nowStamp(), history: [hist("Created")],
    })
  }, [base.insertRow])

  // Amount edits are audited: old → new recorded in history (spec §32); optimistic concurrency.
  const updateSale = useCallback(async (id: string, patch: Partial<TmSale>) => {
    const prev = base.items.find(s => s.id === id)
    if (!prev) throw new Error("Sale not found")
    const upsellQty = patch.upsell_qty ?? prev.upsell_qty, crossQty = patch.cross_qty ?? prev.cross_qty
    const upsellAmt = patch.upsell_amount ?? prev.upsell_amount, crossAmt = patch.cross_amount ?? prev.cross_amount
    const amountChanged = upsellAmt !== prev.upsell_amount || crossAmt !== prev.cross_amount
    const note = amountChanged ? `₱${(prev.upsell_amount + prev.cross_amount).toFixed(2)} → ₱${(upsellAmt + crossAmt).toFixed(2)}` : undefined
    const supabase = createSupabaseBrowserClient()
    const { data, error } = await supabase.from("tm_sales")
      .update({
        ...patch,
        sale_type: upsellQty > 0 && crossQty > 0 ? "Both" : crossQty > 0 ? "Cross-sell" : "Upsell",
        total_qty: upsellQty + crossQty, total_amount: upsellAmt + crossAmt,
        updated_at: nowStamp(),
        history: [...prev.history, hist(amountChanged ? "Amount changed" : "Updated", note)],
      })
      .eq("id", id).eq("updated_at", prev.updated_at).select("id")
    if (error) throw error
    if (!data || data.length === 0) { await base.refresh(); throw new Error("This sale was just updated by someone else — refreshed, please retry.") }
    await base.refresh()
  }, [base.items, base.refresh])

  return { sales: base.items, loaded: base.loaded, refresh: base.refresh, addSale, updateSale, removeSale: base.removeRow }
}

const useTargetsBase = makeUseTable<TmTarget>("tm_targets", "pesowise_tm_targets", rowToTarget)
export function useTmTargets() {
  const base = useTargetsBase()
  // agent_id "" = team-level target; unique per (month, agent).
  const upsertTarget = useCallback(async (input: Omit<TmTarget, "id"> & { id?: string }) => {
    const businessId = await getBusinessId()
    const supabase = createSupabaseBrowserClient()
    const existing = base.items.find(t => t.month === input.month && t.agent_id === input.agent_id)
    const { error } = await supabase.from("tm_targets").upsert({
      business_id: businessId, id: existing?.id ?? uid("tmt"),
      month: input.month, agent_id: input.agent_id,
      sales_target: input.sales_target, orders_target: input.orders_target,
      daily_sales_target: input.daily_sales_target, daily_orders_target: input.daily_orders_target,
      conversion_target: input.conversion_target,
      added_by: currentUserName(), updated_at: nowStamp(),
    }, { onConflict: "business_id,month,agent_id" })
    if (error) throw error
    await base.refresh()
  }, [base.items, base.refresh])
  return { targets: base.items, loaded: base.loaded, refresh: base.refresh, upsertTarget, removeTarget: base.removeRow }
}

const useScriptsBase = makeUseTable<TmScript>("tm_scripts", "pesowise_tm_scripts", rowToScript)
export function useTmScripts() {
  const base = useScriptsBase()
  const addScript = useCallback(async (input: Partial<TmScript>) => {
    await base.insertRow({
      id: uid("tmk"), product: input.product ?? "", category: input.category ?? "Opening",
      title: input.title ?? "", body: input.body ?? "", active: input.active !== false, sort: input.sort ?? 0,
      added_by: currentUserName(), updated_at: nowStamp(), history: [hist("Created")],
    })
  }, [base.insertRow])
  const updateScript = useCallback(async (id: string, patch: Partial<TmScript>) => {
    const prev = base.items.find(s => s.id === id)
    await base.updateRow(id, { ...patch, updated_at: nowStamp(), history: [...(prev?.history ?? []), hist("Updated")] })
  }, [base.items, base.updateRow])
  return { scripts: base.items, loaded: base.loaded, refresh: base.refresh, addScript, updateScript, removeScript: base.removeRow }
}

// ────────────────────────────────────────────────────────────────────────────
// Settings blobs (tm_settings: one row per business, one jsonb column per concern)
// ────────────────────────────────────────────────────────────────────────────
export interface TmHourBlocks { start: number; end: number }           // 24h hours, e.g. 8 → 20
export interface TmReportSchedule { times: string[]; enabled: boolean } // "HH:MM" list
export interface TmDiscordCfg { webhook_url: string; enabled: boolean }
export interface TmKpiWeights { sales_achievement: number; orders_achievement: number; conversion: number; contact_rate: number; upsell: number; cross_sell: number; productivity: number }
export interface TmGeneral { teams: string[]; products: string[]; work_days: number[] } // work_days: 0=Sun … 6=Sat

export const DEFAULT_HOUR_BLOCKS: TmHourBlocks = { start: 8, end: 20 }
export const DEFAULT_REPORT_SCHEDULE: TmReportSchedule = { times: ["09:00", "12:00", "15:00", "18:00", "20:00"], enabled: false }
export const DEFAULT_KPI_WEIGHTS: TmKpiWeights = { sales_achievement: 30, orders_achievement: 15, conversion: 20, contact_rate: 10, upsell: 10, cross_sell: 10, productivity: 5 }
export const DEFAULT_GENERAL: TmGeneral = { teams: [], products: [], work_days: [1, 2, 3, 4, 5, 6] }

export function useTmSettings() {
  const [hourBlocks, setHourBlocks] = useState<TmHourBlocks>(DEFAULT_HOUR_BLOCKS)
  const [reportSchedule, setReportSchedule] = useState<TmReportSchedule>(DEFAULT_REPORT_SCHEDULE)
  const [discord, setDiscord] = useState<TmDiscordCfg>({ webhook_url: "", enabled: false })
  const [kpiWeights, setKpiWeights] = useState<TmKpiWeights>(DEFAULT_KPI_WEIGHTS)
  const [general, setGeneral] = useState<TmGeneral>(DEFAULT_GENERAL)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    (async () => {
      const [hb, rs, dc, kw, gn] = await Promise.all([
        getSettingBlob<TmHourBlocks>("tm_settings", "hour_blocks"),
        getSettingBlob<TmReportSchedule>("tm_settings", "report_schedule"),
        getSettingBlob<TmDiscordCfg>("tm_settings", "discord"),
        getSettingBlob<TmKpiWeights>("tm_settings", "kpi_weights"),
        getSettingBlob<TmGeneral>("tm_settings", "general"),
      ])
      if (hb) setHourBlocks(hb); if (rs) setReportSchedule(rs); if (dc) setDiscord(dc)
      if (kw) setKpiWeights(kw); if (gn) setGeneral({ ...DEFAULT_GENERAL, ...gn })
      setLoaded(true)
    })()
  }, [])

  const saveHourBlocks = useCallback((v: TmHourBlocks) => { setHourBlocks(v); setSettingBlob("tm_settings", "hour_blocks", v) }, [])
  const saveReportSchedule = useCallback((v: TmReportSchedule) => { setReportSchedule(v); setSettingBlob("tm_settings", "report_schedule", v) }, [])
  const saveDiscord = useCallback((v: TmDiscordCfg) => { setDiscord(v); setSettingBlob("tm_settings", "discord", v) }, [])
  const saveKpiWeights = useCallback((v: TmKpiWeights) => { setKpiWeights(v); setSettingBlob("tm_settings", "kpi_weights", v) }, [])
  const saveGeneral = useCallback((v: TmGeneral) => { setGeneral(v); setSettingBlob("tm_settings", "general", v) }, [])

  return { hourBlocks, reportSchedule, discord, kpiWeights, general, loaded, saveHourBlocks, saveReportSchedule, saveDiscord, saveKpiWeights, saveGeneral }
}

// ────────────────────────────────────────────────────────────────────────────
// Shared KPI math (spec §3, §7, §30) — pure functions over filtered rows so the
// dashboard, agent scorecard, hourly view and reports all agree.
// ────────────────────────────────────────────────────────────────────────────
export interface TmKpis {
  upsellOrders: number; upsellAmount: number; crossOrders: number; crossAmount: number
  totalOrders: number; totalSales: number
  callsMade: number; connectedCalls: number; notConnectedCalls: number
  contactRate: number; conversionRate: number; avgOrderValue: number
  salesPerConnectedCall: number; ordersPerConnectedCall: number
}

// Cancelled sales are excluded from every KPI.
export function activeSales(sales: TmSale[]): TmSale[] {
  return sales.filter(s => s.sales_status !== "Cancelled")
}

export function computeTmKpis(salesIn: TmSale[], calls: TmCall[]): TmKpis {
  const sales = activeSales(salesIn)
  const upsellOrders = sales.reduce((n, s) => n + s.upsell_qty, 0)
  const upsellAmount = sales.reduce((n, s) => n + s.upsell_amount, 0)
  const crossOrders = sales.reduce((n, s) => n + s.cross_qty, 0)
  const crossAmount = sales.reduce((n, s) => n + s.cross_amount, 0)
  const totalOrders = upsellOrders + crossOrders
  const totalSales = upsellAmount + crossAmount
  const callsMade = calls.length
  const connectedCalls = calls.filter(c => c.connected).length
  const notConnectedCalls = callsMade - connectedCalls
  // Conversion = customers with a successful sale ÷ unique connected customers (spec §3).
  const connectedLeads = new Set(calls.filter(c => c.connected && c.lead_id).map(c => c.lead_id))
  const soldLeads = new Set(sales.filter(s => s.lead_id).map(s => s.lead_id))
  const convBase = connectedLeads.size || connectedCalls
  const convHits = soldLeads.size || sales.length
  return {
    upsellOrders, upsellAmount, crossOrders, crossAmount, totalOrders, totalSales,
    callsMade, connectedCalls, notConnectedCalls,
    contactRate: callsMade > 0 ? (connectedCalls / callsMade) * 100 : 0,
    conversionRate: convBase > 0 ? Math.min(100, (convHits / convBase) * 100) : 0,
    avgOrderValue: totalOrders > 0 ? totalSales / totalOrders : 0,
    salesPerConnectedCall: connectedCalls > 0 ? totalSales / connectedCalls : 0,
    ordersPerConnectedCall: connectedCalls > 0 ? totalOrders / connectedCalls : 0,
  }
}

// Hour bucketing: "10:37" → 10 (spec §9). Returns -1 for unparseable times.
export function hourOfTime(t: string): number {
  const h = parseInt(String(t).slice(0, 2), 10)
  return Number.isFinite(h) && h >= 0 && h <= 23 ? h : -1
}
export function hourLabel(h: number): string {
  const fmt = (x: number) => {
    const ampm = x >= 12 ? "PM" : "AM"
    const v = x % 12 === 0 ? 12 : x % 12
    return `${v}:00 ${ampm}`
  }
  return `${fmt(h)} – ${fmt((h + 1) % 24)}`
}

// Remaining working days in a month, counting today (spec §7). workDays: 0=Sun…6=Sat.
export function remainingWorkingDays(month: string, workDays: number[] = DEFAULT_GENERAL.work_days, from?: string): number {
  const start = from && from.slice(0, 7) === month ? new Date(`${from}T00:00:00`) : new Date(`${month}-01T00:00:00`)
  const [y, m] = month.split("-").map(Number)
  const last = new Date(y, m, 0).getDate()
  let count = 0
  for (let d = start.getDate(); d <= last; d++) {
    if (workDays.includes(new Date(y, m - 1, d).getDay())) count++
  }
  return count
}
export function requiredDailyPace(target: number, actual: number, remainingDays: number): number {
  const remaining = Math.max(0, target - actual)
  return remainingDays > 0 ? remaining / remainingDays : remaining
}
