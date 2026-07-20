"use client"
import { useCallback, useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"
import { currentUserName } from "@/lib/current-user"
import { pushBookkeepingTxn } from "@/lib/bookkeeping-store"

// ──────────────────────────────────────────────────────────────────────────────
// SUBSCRIPTIONS — recurring bills (AI tools / SaaS) na auto-posted sa Book Keeping
// tuwing billing day. EXACT PHP amount per subscription (walang FX). Posts as a Debit
// sa "Subscriptions" account (operating expense). Dedup per period (last_billed_period)
// para hindi madoble kada buwan. Same collect logic ang UI ("Collect due now") at ang
// headless daily script (scripts/subscriptions-bill.mjs).
// ──────────────────────────────────────────────────────────────────────────────

export const SUB_ACCOUNT = "Subscriptions"
export const SUB_TYPE = "Software Subscription"   // dapat opex=true sa Finance Settings

export type SubCycle = "monthly" | "yearly"
export type SubStatus = "active" | "paused"

export interface Subscription {
  id: string
  name: string
  amount: number             // exact PHP per cycle
  billing_day: number        // 1-31 (clamps sa dulo ng buwan)
  cycle: SubCycle
  billing_month: number | null   // yearly lang (1-12)
  account: string
  type_of_expense: string
  department: string
  bank: string
  status: SubStatus
  last_billed_period: string     // 'YYYY-MM' (monthly) / 'YYYY' (yearly)
  notes: string
  created_by: string
}

export interface NewSubscriptionInput {
  name: string; amount: number; billing_day: number; cycle: SubCycle; billing_month?: number | null
  account: string; type_of_expense: string; department: string; bank: string; notes: string; status?: SubStatus
}

const uid = () => `sub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
const pad = (n: number) => String(n).padStart(2, "0")
export function daysInMonth(y: number, m: number) { return new Date(y, m, 0).getDate() }
export function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// The period key used for dedup + "already billed this cycle" checks.
export function periodOf(sub: Pick<Subscription, "cycle">, dateStr: string) {
  const [y, m] = dateStr.split("-").map(Number)
  return sub.cycle === "yearly" ? String(y) : `${y}-${pad(m)}`
}
function billingDay(sub: Subscription, y: number, m: number) { return Math.min(sub.billing_day, daysInMonth(y, m)) }

// Due today? Catch-up rule: posts once the billing day has ARRIVED or PASSED this period and it
// hasn't been billed yet — so a missed day (app closed) still gets collected on the next run.
export function isDue(sub: Subscription, dateStr = todayStr()): boolean {
  if (sub.status !== "active") return false
  const [y, m, d] = dateStr.split("-").map(Number)
  if (sub.cycle === "yearly") {
    if (sub.last_billed_period === String(y)) return false
    const bm = sub.billing_month || 1
    const bd = Math.min(sub.billing_day, daysInMonth(y, bm))
    return m > bm || (m === bm && d >= bd)
  }
  if (sub.last_billed_period === `${y}-${pad(m)}`) return false
  return d >= billingDay(sub, y, m)
}

// Next billing date (YYYY-MM-DD) for display.
export function nextBillDate(sub: Subscription, dateStr = todayStr()): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  if (sub.cycle === "yearly") {
    const bm = sub.billing_month || 1
    let yy = y
    const bd0 = Math.min(sub.billing_day, daysInMonth(yy, bm))
    if (m > bm || (m === bm && d > bd0) || sub.last_billed_period === String(y)) yy = y + 1
    return `${yy}-${pad(bm)}-${pad(Math.min(sub.billing_day, daysInMonth(yy, bm)))}`
  }
  let yy = y, mm = m
  const bdThis = billingDay(sub, y, m)
  if (d > bdThis || sub.last_billed_period === `${y}-${pad(m)}`) { mm = m + 1; if (mm > 12) { mm = 1; yy++ } }
  return `${yy}-${pad(mm)}-${pad(Math.min(sub.billing_day, daysInMonth(yy, mm)))}`
}

function rowTo(r: any): Subscription {
  return {
    id: r.id, name: r.name || "", amount: Number(r.amount) || 0,
    billing_day: Number(r.billing_day) || 1, cycle: (r.cycle === "yearly" ? "yearly" : "monthly"),
    billing_month: r.billing_month ?? null, account: r.account || SUB_ACCOUNT,
    type_of_expense: r.type_of_expense || SUB_TYPE, department: r.department || "", bank: r.bank || "",
    status: (r.status === "paused" ? "paused" : "active"), last_billed_period: r.last_billed_period || "",
    notes: r.notes || "", created_by: r.created_by || "",
  }
}
function toRow(i: NewSubscriptionInput, businessId: string, id: string) {
  return {
    id, business_id: businessId, name: i.name.trim(), amount: Math.round(Number(i.amount) * 100) / 100,
    billing_day: Math.min(31, Math.max(1, Number(i.billing_day) || 1)), cycle: i.cycle,
    billing_month: i.cycle === "yearly" ? (i.billing_month || 1) : null,
    account: i.account || SUB_ACCOUNT, type_of_expense: i.type_of_expense || SUB_TYPE,
    department: i.department || "", bank: i.bank || "", status: i.status || "active", notes: i.notes || "",
  }
}

export function useSubscriptions() {
  const [subs, setSubs] = useState<Subscription[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const businessId = await getBusinessId()
    if (!businessId) { setLoaded(true); return }
    const supabase = createSupabaseBrowserClient()
    const { data, error } = await supabase.from("subscriptions").select("*").eq("business_id", businessId).order("name", { ascending: true })
    if (!error && data) setSubs(data.map(rowTo))
    setLoaded(true)
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const addSub = useCallback(async (input: NewSubscriptionInput) => {
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    await supabase.from("subscriptions").insert({ ...toRow(input, businessId, uid()), created_by: currentUserName() })
    await refresh()
  }, [refresh])

  const updateSub = useCallback(async (id: string, input: NewSubscriptionInput) => {
    const businessId = await getBusinessId()
    if (!businessId) return
    const { id: _drop, business_id: _b, ...patch } = toRow(input, businessId, id) as any
    const supabase = createSupabaseBrowserClient()
    await supabase.from("subscriptions").update(patch).eq("id", id)
    await refresh()
  }, [refresh])

  const removeSub = useCallback(async (id: string) => {
    const supabase = createSupabaseBrowserClient()
    await supabase.from("subscriptions").delete().eq("id", id)
    await refresh()
  }, [refresh])

  const toggleStatus = useCallback(async (id: string) => {
    const s = subs.find(x => x.id === id); if (!s) return
    const supabase = createSupabaseBrowserClient()
    await supabase.from("subscriptions").update({ status: s.status === "active" ? "paused" : "active" }).eq("id", id)
    await refresh()
  }, [subs, refresh])

  // Collect every subscription due today: post a Book Keeping debit + stamp last_billed_period.
  // Returns { posted, total } — same rule as the headless daily script.
  const collectDue = useCallback(async (dateStr = todayStr()) => {
    const due = subs.filter(s => isDue(s, dateStr))
    let posted = 0, total = 0
    const supabase = createSupabaseBrowserClient()
    for (const s of due) {
      try {
        await pushBookkeepingTxn({
          posted_date: dateStr,
          transaction: `Subscription — ${s.name}`,
          account: s.account, department: s.department, category: "Expense - Debit",
          type_of_expense: s.type_of_expense, expense_type: "Debit", amount: s.amount,
          bank: s.bank, voucher: "", receipt_name: "",
        }, "Recorded from Subscriptions (auto)")
        await supabase.from("subscriptions").update({ last_billed_period: periodOf(s, dateStr) }).eq("id", s.id)
        posted++; total += s.amount
      } catch { /* skip — retry next run */ }
    }
    if (posted > 0) await refresh()
    return { posted, total, due: due.length }
  }, [subs, refresh])

  const dueCount = subs.filter(s => isDue(s)).length
  const monthlyTotal = subs.filter(s => s.status === "active").reduce((sum, s) => sum + (s.cycle === "yearly" ? s.amount / 12 : s.amount), 0)

  return { subs, loaded, refresh, addSub, updateSub, removeSub, toggleStatus, collectDue, dueCount, monthlyTotal }
}
