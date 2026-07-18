"use client"
import { useCallback, useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"

// ──────────────────────────────────────────────────────────────────────────────
// Facebook Billing History — daily per-ad-account FB spend, recorded automatically
// into Book Keeping. Meta removed the per-charge `transactions` API, kaya daily spend
// (na siya ring tina-total ng Meta sa mga singil) ang billing source of truth. Ang
// funding-source last-4 (hal. "VISA *9850") ang ipinantutugma sa CARDS registry para
// malaman kung GoTyme/PayMaya/atbp. ang nagbayad — at kung saang bank ledger ibabawas.
// ──────────────────────────────────────────────────────────────────────────────

// Book Keeping labels used by the automated sync. The type is non-OPEX and the account
// carries NO revolving flag — live na ang FB adspent sa Finance Overview/Income Statement
// (adspent_entries), kaya ledger/bank deduction lang ang papel ng entries na ito para
// hindi madoble ang ADSPENT computations.
export const FB_ADS_ACCOUNT = "Facebook Ads"
export const FB_ADS_TYPE = "Facebook Ads Billing"
export const FB_VAT_RATE = 0.12   // PH VAT sa Meta ads (12%) — Meta `spend` = media cost lang

export interface FbBillingRecord {
  ad_account_id: string
  date: string              // YYYY-MM-DD
  ad_account_name: string
  amount: number            // media cost (Meta insights `spend`, walang VAT)
  vat: number               // 12% VAT sa media cost
  currency: string
  funding_display: string
  card_last4: string
  matched_card_id: string
  bank: string
  recorded_txn_id: string | null
}

// Totoong sinisingil ng Facebook sa card = media cost + VAT.
export const billedTotal = (r: Pick<FbBillingRecord, "amount" | "vat">) => r.amount + r.vat

function rowTo(r: any): FbBillingRecord {
  return {
    ad_account_id: r.ad_account_id, date: r.date, ad_account_name: r.ad_account_name || "",
    amount: Number(r.amount) || 0, vat: Number(r.vat) || 0, currency: r.currency || "PHP",
    funding_display: r.funding_display || "", card_last4: r.card_last4 || "",
    matched_card_id: r.matched_card_id || "", bank: r.bank || "",
    recorded_txn_id: r.recorded_txn_id || null,
  }
}

export function useFbBilling() {
  const [records, setRecords] = useState<FbBillingRecord[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const businessId = await getBusinessId()
    if (!businessId) { setLoaded(true); return }
    const supabase = createSupabaseBrowserClient()
    const out: FbBillingRecord[] = []
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from("fb_billing_records").select("*")
        .eq("business_id", businessId).order("date", { ascending: false }).range(from, from + PAGE - 1)
      if (error || !data) break
      out.push(...data.map(rowTo))
      if (data.length < PAGE) break
    }
    setRecords(out)
    setLoaded(true)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Isang record, sine-save BAGO mag-post sa Book Keeping — kapag nag-fail ito (hal.
  // wala pa ang table), HINDI magpo-post ang sync, para imposible ang double-posting.
  const saveRecord = useCallback(async (row: FbBillingRecord): Promise<string | null> => {
    const businessId = await getBusinessId()
    if (!businessId) return "No business configured"
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("fb_billing_records").upsert({ business_id: businessId, ...row })
    return error ? error.message : null
  }, [])

  const setRecordTxn = useCallback(async (ad_account_id: string, date: string, txnId: string) => {
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    await supabase.from("fb_billing_records").update({ recorded_txn_id: txnId })
      .eq("business_id", businessId).eq("ad_account_id", ad_account_id).eq("date", date)
  }, [])

  // Correct an existing record's media/vat + its Book Keeping entry (pag na-settle ang
  // spend ng Facebook after ng unang sync — para laging tumugma sa totoong billing).
  const updateRecordAmount = useCallback(async (r: FbBillingRecord, billed: number) => {
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    await supabase.from("fb_billing_records").update({ amount: r.amount, vat: r.vat })
      .eq("business_id", businessId).eq("ad_account_id", r.ad_account_id).eq("date", r.date)
    if (r.recorded_txn_id) {
      await supabase.from("bookkeeping_txns").update({ amount: billed, debit: billed })
        .eq("business_id", businessId).eq("id", r.recorded_txn_id)
    }
  }, [])

  return { records, loaded, refresh, saveRecord, setRecordTxn, updateRecordAmount }
}
