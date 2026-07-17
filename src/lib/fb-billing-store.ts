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

export interface FbBillingRecord {
  ad_account_id: string
  date: string              // YYYY-MM-DD
  ad_account_name: string
  amount: number
  currency: string
  funding_display: string
  card_last4: string
  matched_card_id: string
  bank: string
  recorded_txn_id: string | null
}

function rowTo(r: any): FbBillingRecord {
  return {
    ad_account_id: r.ad_account_id, date: r.date, ad_account_name: r.ad_account_name || "",
    amount: Number(r.amount) || 0, currency: r.currency || "PHP",
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

  const upsertRecords = useCallback(async (rows: FbBillingRecord[]) => {
    if (rows.length === 0) return
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    for (let i = 0; i < rows.length; i += 200) {
      await supabase.from("fb_billing_records").upsert(rows.slice(i, i + 200).map(r => ({ business_id: businessId, ...r })))
    }
    await refresh()
  }, [refresh])

  return { records, loaded, refresh, upsertRecords }
}
