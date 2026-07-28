"use client"
import { useCallback, useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"
import { currentUserName } from "@/lib/current-user"

// SHIPPED OUT scan log — bawat parcel na na-scan sa paglabas. Source of truth = Supabase
// `shipped_out_scans`. Ang UNIQUE (business_id, tracking_no) sa DB ang dedup gate: kapag
// duplicate ang insert, hindi na dapat ulitin ang inventory deduction.

export interface ShippedScanItem { item_id: string; sku: string; name: string; deducted: number }
export interface ShippedScan {
  id: string
  tracking_no: string
  courier: string
  page_name: string
  order_id: string
  customer: string
  order_item: string
  items: ShippedScanItem[]
  deducted_total: number
  amount: number        // halaga ng order (COD / final price) noong ma-scan
  scanned_by: string
  date: string          // YYYY-MM-DD
  created_at: string
}
export type NewShippedScan = Omit<ShippedScan, "id" | "scanned_by" | "created_at">

const uid = () => `shp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

function rowTo(r: any): ShippedScan {
  return {
    id: r.id, tracking_no: r.tracking_no || "", courier: r.courier || "",
    page_name: r.page_name || "", order_id: r.order_id || "", customer: r.customer || "",
    order_item: r.order_item || "", items: Array.isArray(r.items) ? r.items : [],
    deducted_total: Number(r.deducted_total) || 0, amount: Number(r.amount) || 0,
    scanned_by: r.scanned_by || "",
    date: r.date || "", created_at: r.created_at || "",
  }
}

export function useShippedOutScans() {
  const [scans, setScans] = useState<ShippedScan[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const businessId = await getBusinessId()
    if (!businessId) { setLoaded(true); return }
    const supabase = createSupabaseBrowserClient()
    const out: ShippedScan[] = []
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from("shipped_out_scans").select("*")
        .eq("business_id", businessId).order("created_at", { ascending: false }).range(from, from + PAGE - 1)
      if (error || !data) break
      out.push(...data.map(rowTo))
      if (data.length < PAGE) break
    }
    setScans(out)
    setLoaded(true)
  }, [])
  useEffect(() => { refresh() }, [refresh])

  /** Insert ang scan — "added" kung bago, "duplicate" kung na-scan na (DB unique gate). */
  const addScan = useCallback(async (input: NewShippedScan): Promise<"added" | "duplicate" | string> => {
    const businessId = await getBusinessId()
    if (!businessId) return "No business configured"
    const supabase = createSupabaseBrowserClient()
    const row = { id: uid(), business_id: businessId, ...input, scanned_by: currentUserName() }
    const { error } = await supabase.from("shipped_out_scans").insert(row)
    if (error) {
      if (error.code === "23505" || /duplicate/i.test(error.message)) return "duplicate"
      return error.message
    }
    await refresh()
    return "added"
  }, [refresh])

  return { scans, loaded, refresh, addScan }
}
