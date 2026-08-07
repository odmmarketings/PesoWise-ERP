"use client"
import { useCallback, useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"
import { currentUserName } from "@/lib/current-user"
import { pushBookkeepingTxn } from "@/lib/bookkeeping-store"

// ──────────────────────────────────────────────────────────────────────────────
// SUBSCRIPTIONS — recurring bills (AI tools / SaaS). Dalawang lane:
//
//   FIXED     — alam ang cycle, ang billing day, at ang exact PHP. Auto-posted sa
//               Book Keeping tuwing billing day (dedup per period via last_billed_period).
//   VARIABLE  — auto top-up na walang fixed na petsa (hal. Botcake AI: nagta-top-up
//               kapag naubos ang funds), o walang fixed na billing day, o nag-iibang
//               halaga. HINDI ito auto-posted — sinusubaybayan lang dito, tapos i-log
//               ang tunay na singil gamit ang "Log charge" (isVariable / logCharge).
//
// Sinasadya ang hati: hindi tayo mag-iimbento ng petsa o halaga sa ledger.
// Pareho ang collect logic ng UI ("Collect due now") at ng headless daily script
// (scripts/subscriptions-bill.mjs) — kapag binago ang isDue/periodOf dito, sabayan doon.
// ──────────────────────────────────────────────────────────────────────────────

export const SUB_ACCOUNT = "Subscriptions"
export const SUB_TYPE = "Software Subscription"   // dapat opex=true sa Finance Settings

export type SubCycle = "weekly" | "monthly" | "quarterly" | "semiannual" | "yearly" | "topup"
export type SubStatus = "active" | "paused"

export const CYCLE_OPTIONS: { value: SubCycle; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly (every 3 months)" },
  { value: "semiannual", label: "Semi-annual (every 6 months)" },
  { value: "yearly", label: "Yearly" },
  { value: "topup", label: "Auto top-up (kapag naubos ang funds)" },
]
export const CYCLE_LABEL: Record<SubCycle, string> = {
  weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly",
  semiannual: "Semi-annual", yearly: "Yearly", topup: "Auto top-up",
}
const CYCLES = CYCLE_OPTIONS.map(o => o.value)

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
// 1-based para ang 0 ay malayang mangahulugang "walang fixed na petsa".
export const DOW_LABEL = ["", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
/** `billing_day` sentinel: hindi fixed ang petsa ng singil (random kada cycle). */
export const DAY_VARIES = 0

export interface Subscription {
  id: string
  name: string
  amount: number             // exact PHP per cycle; 0 = nag-iiba (variable)
  /**
   * Kahulugan ay nakadepende sa cycle:
   *   weekly                              → 1-7 araw ng linggo (1=Sunday … 7=Saturday)
   *   monthly/quarterly/semiannual/yearly → 1-31 araw ng buwan (clamps sa dulo ng buwan)
   *   0 (kahit anong cycle)               → HINDI fixed → hindi kailanman auto-posted
   */
  billing_day: number
  cycle: SubCycle
  billing_month: number | null   // anchor month (1-12) ng quarterly/semiannual/yearly
  account: string
  type_of_expense: string
  department: string
  bank: string
  status: SubStatus
  last_billed_period: string     // dedup guard — tingnan ang periodOf()
  last_charged_at: string        // variable lang: petsa ng huling naka-log na singil
  last_charged_amount: number    // variable lang: halaga ng huling naka-log na singil
  notes: string
  created_by: string
}

export interface NewSubscriptionInput {
  name: string; amount: number; billing_day: number; cycle: SubCycle; billing_month?: number | null
  account: string; type_of_expense: string; department: string; bank: string; notes: string; status?: SubStatus
}

const uid = () => `sub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
const pad = (n: number) => String(n).padStart(2, "0")
const DAY_MS = 86400000
export function daysInMonth(y: number, m: number) { return new Date(y, m, 0).getDate() }
export function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d)
const isoOf = (ts: number) => { const t = new Date(ts); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}` }
/** 1=Sunday … 7=Saturday. */
const dowOf = (y: number, m: number, d: number) => new Date(utc(y, m, d)).getUTCDay() + 1
/** Key = petsa ng Linggo ng nasabing linggo — unique at walang ISO-week edge cases. */
const weekKey = (y: number, m: number, d: number) => "W" + isoOf(utc(y, m, d) - (dowOf(y, m, d) - 1) * DAY_MS)

const cycleMonths = (c: SubCycle) => (c === "quarterly" ? 3 : c === "semiannual" ? 6 : c === "yearly" ? 12 : 1)

/**
 * Unang buwan ng recurring period na kinabibilangan ng (y,m). Naka-anchor sa billing_month
 * ang multi-month cycles — kaya ang quarterly na naka-anchor sa Feb ay Feb/May/Aug/Nov.
 */
function periodStart(sub: Pick<Subscription, "cycle" | "billing_month">, y: number, m: number) {
  const n = cycleMonths(sub.cycle)
  if (n === 1) return { py: y, pm: m }
  const anchor = Math.min(12, Math.max(1, sub.billing_month || 1)) - 1
  const startAbs = anchor + Math.floor((y * 12 + (m - 1) - anchor) / n) * n
  return { py: Math.floor(startAbs / 12), pm: (startAbs % 12) + 1 }
}

/**
 * Walang fixed na petsa o halaga → hindi puwedeng auto-post; kailangang i-log nang manu-mano.
 * Ito ang nag-iisang gate ng auto-collect, kaya ligtas ang bagong flexible na options:
 * kahit kailan hindi hihila ng inimbentong halaga papasok sa ledger.
 */
export function isVariable(sub: Pick<Subscription, "cycle" | "billing_day" | "amount">) {
  return sub.cycle === "topup" || !sub.billing_day || !(sub.amount > 0)
}

/** Bakit variable — para may maipakitang dahilan ang UI. */
export function variableReason(sub: Pick<Subscription, "cycle" | "billing_day" | "amount">) {
  if (sub.cycle === "topup") return "Auto top-up — nagbabago ang petsa"
  const bits: string[] = []
  if (!sub.billing_day) bits.push("walang fixed na billing day")
  if (!(sub.amount > 0)) bits.push("nag-iibang halaga")
  return bits.join(" · ")
}

// The period key used for dedup + "already billed this cycle" checks.
export function periodOf(sub: Pick<Subscription, "cycle" | "billing_month">, dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number)
  if (sub.cycle === "weekly") return weekKey(y, m, d)
  if (sub.cycle === "topup") return dateStr
  const { py, pm } = periodStart(sub, y, m)
  // Nananatiling 'YYYY' ang yearly key para tugma sa mga lumang row.
  return sub.cycle === "yearly" ? String(py) : `${py}-${pad(pm)}`
}

// Due today? Catch-up rule: posts once the billing day has ARRIVED or PASSED this period and it
// hasn't been billed yet — so a missed day (app closed) still gets collected on the next run.
export function isDue(sub: Subscription, dateStr = todayStr()): boolean {
  if (sub.status !== "active") return false
  if (isVariable(sub)) return false
  const [y, m, d] = dateStr.split("-").map(Number)
  if (sub.last_billed_period === periodOf(sub, dateStr)) return false
  if (sub.cycle === "weekly") return dowOf(y, m, d) >= sub.billing_day
  const { py, pm } = periodStart(sub, y, m)
  const bd = Math.min(sub.billing_day, daysInMonth(py, pm))
  const absNow = y * 12 + (m - 1), absStart = py * 12 + (pm - 1)
  return absNow > absStart || (absNow === absStart && d >= bd)
}

/** Next billing date (YYYY-MM-DD) for display. Blangko kapag variable — walang mahuhulaan. */
export function nextBillDate(sub: Subscription, dateStr = todayStr()): string {
  if (isVariable(sub)) return ""
  const [y, m, d] = dateStr.split("-").map(Number)
  const billed = sub.last_billed_period === periodOf(sub, dateStr)
  if (sub.cycle === "weekly") {
    const t = utc(y, m, d)
    let target = t - (dowOf(y, m, d) - 1) * DAY_MS + (sub.billing_day - 1) * DAY_MS
    if (billed || target < t) target += 7 * DAY_MS
    return isoOf(target)
  }
  const n = cycleMonths(sub.cycle)
  let { py, pm } = periodStart(sub, y, m)
  const due = Math.min(sub.billing_day, daysInMonth(py, pm))
  const absNow = y * 12 + (m - 1), absStart = py * 12 + (pm - 1)
  if (billed || absNow > absStart || (absNow === absStart && d > due)) {
    const next = absStart + n
    py = Math.floor(next / 12); pm = (next % 12) + 1
  }
  return `${py}-${pad(pm)}-${pad(Math.min(sub.billing_day, daysInMonth(py, pm)))}`
}

/** Maikling paglalarawan ng schedule para sa table. */
export function billingLabel(sub: Subscription): string {
  if (sub.cycle === "topup") return "Auto top-up · walang fixed na petsa"
  if (!sub.billing_day) return `${CYCLE_LABEL[sub.cycle]} · nag-iibang petsa`
  if (sub.cycle === "weekly") return `Every ${DOW_LABEL[sub.billing_day]}`
  if (sub.cycle === "monthly") return `Day ${sub.billing_day} · Monthly`
  return `${MONTHS[(sub.billing_month || 1) - 1]} ${sub.billing_day} · ${CYCLE_LABEL[sub.cycle]}`
}

/** Buwanang katumbas para sa "Est. Monthly". Variable = 0 — hindi tayo manghuhula. */
export function monthlyEquivalent(sub: Subscription): number {
  if (isVariable(sub)) return 0
  switch (sub.cycle) {
    case "weekly": return (sub.amount * 52) / 12
    case "quarterly": return sub.amount / 3
    case "semiannual": return sub.amount / 6
    case "yearly": return sub.amount / 12
    default: return sub.amount
  }
}

function rowTo(r: any): Subscription {
  const cycle: SubCycle = CYCLES.includes(r.cycle) ? r.cycle : "monthly"
  return {
    id: r.id, name: r.name || "", amount: Number(r.amount) || 0,
    // HUWAG gamitin ang `|| 1` dito — gagawing 1 ang 0, at mawawala ang "walang fixed na petsa".
    billing_day: Math.min(31, Math.max(0, Number(r.billing_day) || 0)), cycle,
    billing_month: r.billing_month ?? null, account: r.account || SUB_ACCOUNT,
    type_of_expense: r.type_of_expense || SUB_TYPE, department: r.department || "", bank: r.bank || "",
    status: (r.status === "paused" ? "paused" : "active"), last_billed_period: r.last_billed_period || "",
    last_charged_at: r.last_charged_at || "", last_charged_amount: Number(r.last_charged_amount) || 0,
    notes: r.notes || "", created_by: r.created_by || "",
  }
}
function toRow(i: NewSubscriptionInput, businessId: string, id: string) {
  const cycle: SubCycle = CYCLES.includes(i.cycle) ? i.cycle : "monthly"
  const maxDay = cycle === "weekly" ? 7 : 31
  // Walang hawak na petsa ang top-up — dumarating ito kung kailan maubos ang funds.
  const billing_day = cycle === "topup" ? DAY_VARIES : Math.min(maxDay, Math.max(0, Number(i.billing_day) || 0))
  return {
    id, business_id: businessId, name: i.name.trim(),
    amount: Math.round((Number(i.amount) || 0) * 100) / 100,
    billing_day, cycle,
    billing_month: cycleMonths(cycle) > 1 ? (i.billing_month || 1) : null,
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
    const { data, error } = await supabase.from("finance_subscriptions").select("*").eq("business_id", businessId).order("name", { ascending: true })
    if (!error && data) setSubs(data.map(rowTo))
    setLoaded(true)
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const addSub = useCallback(async (input: NewSubscriptionInput) => {
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    await supabase.from("finance_subscriptions").insert({ ...toRow(input, businessId, uid()), created_by: currentUserName() })
    await refresh()
  }, [refresh])

  const updateSub = useCallback(async (id: string, input: NewSubscriptionInput) => {
    const businessId = await getBusinessId()
    if (!businessId) return
    const { id: _drop, business_id: _b, ...patch } = toRow(input, businessId, id) as any
    const supabase = createSupabaseBrowserClient()
    await supabase.from("finance_subscriptions").update(patch).eq("id", id)
    await refresh()
  }, [refresh])

  const removeSub = useCallback(async (id: string) => {
    const supabase = createSupabaseBrowserClient()
    await supabase.from("finance_subscriptions").delete().eq("id", id)
    await refresh()
  }, [refresh])

  const toggleStatus = useCallback(async (id: string) => {
    const s = subs.find(x => x.id === id); if (!s) return
    const supabase = createSupabaseBrowserClient()
    await supabase.from("finance_subscriptions").update({ status: s.status === "active" ? "paused" : "active" }).eq("id", id)
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
        await supabase.from("finance_subscriptions").update({ last_billed_period: periodOf(s, dateStr) }).eq("id", s.id)
        posted++; total += s.amount
      } catch { /* skip — retry next run */ }
    }
    if (posted > 0) await refresh()
    return { posted, total, due: due.length }
  }, [subs, refresh])

  /**
   * Manu-manong pag-log ng tunay na singil ng isang VARIABLE na subscription (auto top-up,
   * walang fixed na petsa, o nag-iibang halaga). Dito lang pumapasok sa ledger ang mga ito —
   * hindi sila hinahawakan ng auto-collect. Walang stamp ng last_billed_period: hindi
   * period-based ang mga ito, kaya puwedeng mag-log nang paulit-ulit sa iisang buwan.
   */
  const logCharge = useCallback(async (id: string, amount: number, dateStr = todayStr(), note = "") => {
    const s = subs.find(x => x.id === id)
    if (!s) throw new Error("Wala sa listahan ang subscription na ito.")
    const amt = Math.round((Number(amount) || 0) * 100) / 100
    if (!(amt > 0)) throw new Error("Kailangan ng halaga na mas mataas sa zero.")
    await pushBookkeepingTxn({
      posted_date: dateStr,
      transaction: `Subscription — ${s.name}${note.trim() ? ` (${note.trim()})` : ""}`,
      account: s.account, department: s.department, category: "Expense - Debit",
      type_of_expense: s.type_of_expense, expense_type: "Debit", amount: amt,
      bank: s.bank, voucher: "", receipt_name: "",
    }, "Recorded from Subscriptions (logged top-up)")
    const supabase = createSupabaseBrowserClient()
    await supabase.from("finance_subscriptions").update({ last_charged_at: dateStr, last_charged_amount: amt }).eq("id", id)
    await refresh()
  }, [subs, refresh])

  const dueCount = subs.filter(s => isDue(s)).length
  const activeSubs = subs.filter(s => s.status === "active")
  const monthlyTotal = activeSubs.reduce((sum, s) => sum + monthlyEquivalent(s), 0)
  const variableCount = activeSubs.filter(isVariable).length

  return {
    subs, loaded, refresh, addSub, updateSub, removeSub, toggleStatus,
    collectDue, logCharge, dueCount, monthlyTotal, variableCount,
  }
}
