"use client"
import { useCallback, useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"
import { currentUserName } from "@/lib/current-user"

// ──────────────────────────────────────────────────────────────────────────────
// Finance → Utility Expense (LHIKE ERP "Finance - Utility Expense" manual). Mirror
// of Reimbursement: a request list with approve/decline; on approval it's recorded
// as a Book Keeping transaction. Source of truth = Supabase `utility_expenses`;
// `pesowise_utility_expense` localStorage is now just a same-session read cache.
// ──────────────────────────────────────────────────────────────────────────────

export type UtilStatus = "pending" | "approved" | "declined"

export const UTIL_MOPS = ["COD", "Cash", "Gcash", "Bank Transfer", "Credit Card", "Maya"]
export const REQUEST_FORMS = ["RFP", "HRA"]   // Request Form (HRA/RFP)
export const TYPE_OF_REQUEST_OPTIONS = ["Retail", "Business Dev.", "Shared"]  // gated by General "type request"

export interface UtilHistory { action: string; by: string; date: string; note?: string }

export interface UtilityExpense {
  id: string
  control_no: string        // e.g. "PRF-HRAD-2024-1"
  date: string              // "YYYY-MM-DD HH:mm:ss"
  due_date: string          // YYYY-MM-DD
  request_form: string      // "RFP" | "HRA"
  payee_supplier: string
  requested_by: string
  purpose: string
  description: string       // user can add more items (newline-joined)
  type_of_expense: string
  type_of_request: string   // separate selector (shown in the "Type of Request" column) — gated
  retail: number
  business_dev: number
  quantity: number
  unit_price: number
  total_amount: number      // quantity × unit_price
  mode_of_payment: string
  bills_name: string        // uploaded bill filename
  status: UtilStatus
  remarks: string
  recorded_txn_id: string
  added_by: string
  added_date: string        // ISO
  approved_by: string
  approved_date: string     // "YYYY-MM-DD HH:mm:ss"
  history: UtilHistory[]
}

export const UTIL_ADDED_BY = "Admin User" // fallback only — real records stamp currentUserName()

export interface NewUtilInput {
  due_date: string; request_form: string; payee_supplier: string; requested_by: string; purpose: string
  description: string; type_of_expense: string; quantity: number; unit_price: number; mode_of_payment: string; bills_name: string
  type_of_request?: string; retail?: number; business_dev?: number
  date?: string; control_no?: string
}

const KEY = "pesowise_utility_expense"

function nowStamp(): string {
  const d = new Date(); const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
export function utilNowStamp(): string { return nowStamp() }

// Control No = "PRF-HRAD-{year}-{seq}" (sequence increments per calendar year).
export function peekNextUtilControlNo(list: UtilityExpense[]): string {
  const year = new Date().getFullYear()
  const prefix = `PRF-HRAD-${year}-`
  return `${prefix}${list.filter(r => String(r?.control_no || "").startsWith(prefix)).length + 1}`
}

function rowToUtil(r: any): UtilityExpense {
  return {
    id: r.id, control_no: r.control_no || "", date: r.date || "", due_date: r.due_date || "",
    request_form: r.request_form || "", payee_supplier: r.payee_supplier || "", requested_by: r.requested_by || "",
    purpose: r.purpose || "", description: r.description || "", type_of_expense: r.type_of_expense || "",
    type_of_request: r.type_of_request || "", retail: Number(r.retail) || 0, business_dev: Number(r.business_dev) || 0,
    quantity: Number(r.quantity) || 0, unit_price: Number(r.unit_price) || 0, total_amount: Number(r.total_amount) || 0,
    mode_of_payment: r.mode_of_payment || "", bills_name: r.bills_name || "",
    status: r.status === "approved" || r.status === "declined" ? r.status : "pending",
    remarks: r.remarks || "", recorded_txn_id: r.recorded_txn_id || "",
    added_by: r.added_by || UTIL_ADDED_BY, added_date: r.added_date || r.created_at || new Date().toISOString(),
    approved_by: r.approved_by || "", approved_date: r.approved_date || "",
    history: Array.isArray(r.history) ? r.history : [],
  }
}

function readCache(): UtilityExpense[] {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : [] } catch { return [] }
}
function writeCache(list: UtilityExpense[]) { try { localStorage.setItem(KEY, JSON.stringify(list)) } catch {} }

export function useUtilityExpenses() {
  const [items, setItems] = useState<UtilityExpense[]>(() => readCache())
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const businessId = await getBusinessId()
    if (!businessId) { setLoading(false); return }
    const supabase = createSupabaseBrowserClient()
    const { data, error } = await supabase.from("utility_expenses").select("*").eq("business_id", businessId).order("created_at", { ascending: false })
    if (!error && data) { const list = data.map(rowToUtil); writeCache(list); setItems(list) }
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const addRequest = useCallback(async (input: NewUtilInput) => {
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    const by = currentUserName() || UTIL_ADDED_BY
    const now = new Date().toISOString()
    const row = {
      business_id: businessId,
      control_no: input.control_no || peekNextUtilControlNo(items), date: input.date || nowStamp(),
      due_date: input.due_date, request_form: input.request_form, payee_supplier: input.payee_supplier,
      requested_by: input.requested_by, purpose: input.purpose, description: input.description,
      type_of_expense: input.type_of_expense, type_of_request: input.type_of_request || "",
      retail: Number(input.retail) || 0, business_dev: Number(input.business_dev) || 0,
      quantity: Number(input.quantity) || 0, unit_price: Number(input.unit_price) || 0,
      total_amount: (Number(input.quantity) || 0) * (Number(input.unit_price) || 0),
      mode_of_payment: input.mode_of_payment, bills_name: input.bills_name,
      status: "pending", remarks: "", recorded_txn_id: null,
      added_by: by, added_date: now, approved_by: "", approved_date: "",
      history: [{ action: "Requested", by, date: now }],
    }
    const { error } = await supabase.from("utility_expenses").insert(row)
    if (error) throw error
    await refresh()
  }, [items, refresh])

  const approve = useCallback(async (id: string, remarks: string, recordedTxnId: string) => {
    const current = items.find(r => r.id === id)
    if (!current) return
    const supabase = createSupabaseBrowserClient()
    const by = currentUserName() || UTIL_ADDED_BY
    const now = new Date().toISOString()
    const history = [...current.history, { action: "Approved & recorded to Book Keeping", by, date: now, note: remarks }]
    const { error } = await supabase.from("utility_expenses").update({
      status: "approved", remarks, recorded_txn_id: recordedTxnId, approved_by: by, approved_date: nowStamp(), history,
    }).eq("id", id)
    if (error) throw error
    await refresh()
  }, [items, refresh])

  const decline = useCallback(async (id: string, remarks: string) => {
    const current = items.find(r => r.id === id)
    if (!current) return
    const supabase = createSupabaseBrowserClient()
    const by = currentUserName() || UTIL_ADDED_BY
    const now = new Date().toISOString()
    const history = [...current.history, { action: "Declined", by, date: now, note: remarks }]
    const { error } = await supabase.from("utility_expenses").update({ status: "declined", remarks, history }).eq("id", id)
    if (error) throw error
    await refresh()
  }, [items, refresh])

  return { items, loaded: !loading, addRequest, approve, decline }
}
