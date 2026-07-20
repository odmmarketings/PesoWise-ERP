"use client"
import { useCallback, useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"
import { currentUserName } from "@/lib/current-user"
import { pushBookkeepingTxn } from "@/lib/bookkeeping-store"
import { FB_ADS_ACCOUNT, FB_ADS_TYPE } from "@/lib/fb-billing-store"

// ──────────────────────────────────────────────────────────────────────────────
// FB PAID CHARGES — ang mga aktwal na "Paid" transactions mula sa Facebook Billing
// (eksaktong halagang sinisingil sa card, VAT-inclusive). ITO ang nagpo-post sa Book
// Keeping para tumugma nang 1:1 ang ledger sa bank/card statement. Ang daily-spend
// (fb_billing_records) ay analytics na lang. Dedup: ang INSERT sa unique id ang gate —
// kapag duplicate (same reference/composite key), hindi na magpo-post ulit sa BK.
// ──────────────────────────────────────────────────────────────────────────────

export interface FbPaidCharge {
  id: string
  paid_date: string          // YYYY-MM-DD
  amount: number             // eksaktong Paid amount (VAT-inclusive)
  billing_account: string    // ad account / billing account name sa Facebook
  payment_method: string     // hal. "Visa ···· 7349"
  card_last4: string
  reference_no: string
  matched_card_id: string
  bank: string
  source: string             // manual | screenshot | browser
  notes: string
  recorded_txn_id: string | null
  created_by: string
}

export interface NewPaidChargeInput {
  paid_date: string
  amount: number
  billing_account: string
  card_last4?: string
  payment_method?: string
  reference_no?: string
  matched_card_id?: string
  bank?: string
  source?: string
  notes?: string
  department?: string        // Book Keeping department (default Marketing/first active)
}

// Stable dedup id: reference number kung meron; kung wala, composite key.
export function paidChargeId(i: Pick<NewPaidChargeInput, "reference_no" | "billing_account" | "paid_date" | "amount" | "card_last4">) {
  const ref = (i.reference_no || "").trim()
  if (ref) return `ref:${ref}`
  return `pc:${(i.billing_account || "").trim().toLowerCase()}|${i.paid_date}|${Number(i.amount).toFixed(2)}|${i.card_last4 || ""}`
}

function rowTo(r: any): FbPaidCharge {
  return {
    id: r.id, paid_date: r.paid_date || "", amount: Number(r.amount) || 0,
    billing_account: r.billing_account || "", payment_method: r.payment_method || "",
    card_last4: r.card_last4 || "", reference_no: r.reference_no || "",
    matched_card_id: r.matched_card_id || "", bank: r.bank || "",
    source: r.source || "manual", notes: r.notes || "",
    recorded_txn_id: r.recorded_txn_id || null, created_by: r.created_by || "",
  }
}

export function useFbPaidCharges() {
  const [charges, setCharges] = useState<FbPaidCharge[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const businessId = await getBusinessId()
    if (!businessId) { setLoaded(true); return }
    const supabase = createSupabaseBrowserClient()
    const out: FbPaidCharge[] = []
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from("fb_paid_charges").select("*")
        .eq("business_id", businessId).order("paid_date", { ascending: false }).range(from, from + PAGE - 1)
      if (error || !data) break
      out.push(...data.map(rowTo))
      if (data.length < PAGE) break
    }
    setCharges(out)
    setLoaded(true)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Idagdag ang isang Paid charge: INSERT muna (dedup gate — unique id), saka mag-post
  // sa Book Keeping, tapos i-link. Return: "added" | "duplicate" | error message.
  const addCharge = useCallback(async (input: NewPaidChargeInput): Promise<"added" | "duplicate" | string> => {
    const businessId = await getBusinessId()
    if (!businessId) return "No business configured"
    const supabase = createSupabaseBrowserClient()
    const id = paidChargeId(input)
    const row = {
      id, business_id: businessId,
      paid_date: input.paid_date, amount: Math.round(Number(input.amount) * 100) / 100,
      billing_account: input.billing_account.trim(), payment_method: input.payment_method || "",
      card_last4: input.card_last4 || "", reference_no: (input.reference_no || "").trim(),
      matched_card_id: input.matched_card_id || "", bank: input.bank || "",
      source: input.source || "manual", notes: input.notes || "",
      recorded_txn_id: null, created_by: currentUserName(),
    }
    const { error } = await supabase.from("fb_paid_charges").insert(row)
    if (error) {
      if (error.code === "23505" || /duplicate/i.test(error.message)) return "duplicate"
      return error.message
    }
    try {
      const txn = await pushBookkeepingTxn({
        posted_date: input.paid_date,
        transaction: `FB Billing Paid — ${row.billing_account}${row.payment_method ? ` (${row.payment_method})` : ""}`,
        account: FB_ADS_ACCOUNT, department: input.department || "", category: "Expense - Debit",
        type_of_expense: FB_ADS_TYPE, expense_type: "Debit", amount: row.amount,
        bank: row.bank, voucher: row.reference_no, receipt_name: "",
      }, "Recorded from FB Billing (Paid)")
      await supabase.from("fb_paid_charges").update({ recorded_txn_id: txn.id }).eq("id", id)
    } catch {
      // Naka-save ang charge pero hindi natuloy ang BK post — mare-recover sa susunod na retry.
    }
    await refresh()
    return "added"
  }, [refresh])

  // Recovery: mga charge na walang BK link (naputol na post) — subukang i-post ulit.
  const recoverUnrecorded = useCallback(async (department: string): Promise<number> => {
    const supabase = createSupabaseBrowserClient()
    let n = 0
    for (const c of charges.filter(x => !x.recorded_txn_id)) {
      try {
        const txn = await pushBookkeepingTxn({
          posted_date: c.paid_date,
          transaction: `FB Billing Paid — ${c.billing_account}${c.payment_method ? ` (${c.payment_method})` : ""}`,
          account: FB_ADS_ACCOUNT, department, category: "Expense - Debit",
          type_of_expense: FB_ADS_TYPE, expense_type: "Debit", amount: c.amount,
          bank: c.bank, voucher: c.reference_no, receipt_name: "",
        }, "Recorded from FB Billing (Paid)")
        await supabase.from("fb_paid_charges").update({ recorded_txn_id: txn.id }).eq("id", c.id)
        n++
      } catch {}
    }
    if (n > 0) await refresh()
    return n
  }, [charges, refresh])

  // Admin delete — tinatanggal din ang naka-link na Book Keeping entry.
  const removeCharge = useCallback(async (id: string) => {
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    const c = charges.find(x => x.id === id)
    if (c?.recorded_txn_id) await supabase.from("bookkeeping_txns").delete().eq("business_id", businessId).eq("id", c.recorded_txn_id)
    await supabase.from("fb_paid_charges").delete().eq("business_id", businessId).eq("id", id)
    await refresh()
  }, [charges, refresh])

  return { charges, loaded, refresh, addCharge, recoverUnrecorded, removeCharge }
}
