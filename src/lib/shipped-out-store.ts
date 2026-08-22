"use client"
import { useCallback, useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"
import { currentUserName } from "@/lib/current-user"

// SHIPPED OUT — ISANG ROW kada parcel (UNIQUE sa business_id + tracking_no), na may
// DALAWANG magkahiwalay na tatak:
//
//   manual_scanned_at   ← na-scan ng warehouse. Talaan lang — HINDI bumabawas.
//   pancake_shipped_at  ← na-detect sa Pancake na umalis na. ITO ang bumabawas.
//
// Ang `deducted` ang nag-iisang pinto papunta sa inventory. Isang beses lang itong
// tumatawid mula false papuntang true, at conditional update ang nagbabantay — kaya
// kahit ilang device o ilang beses tumakbo ang sync, iisa pa rin ang bawas.

export interface ShippedScanItem { item_id: string; sku: string; name: string; deducted: number }
/** Kung saang cost layer galing ang isang pirasong umalis — ito ang binabasa ng RTS restock. */
export interface BatchLine { item_id: string; batch_id: string; batch_no: string; qty: number; cog: number; value: number }
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
  amount: number        // halaga ng order (COD / final price) noong maitala
  scanned_by: string
  date: string          // YYYY-MM-DD
  created_at: string
  manual_scanned_at: string
  manual_scanned_by: string
  pancake_shipped_at: string
  deducted: boolean
  deducted_at: string
  batch_lines: BatchLine[]
  cogs_value: number
  cogs_short: number
  restocked_at: string
  restocked_by: string
  restocked_qty: number
  restock_lines: BatchLine[]
  /** {item_id: batch_id} — ang batch na PISIKAL na pinagkunan ayon sa warehouse
   *  (pinili sa scan screen). Nauuna ito sa FIFO pagdating ng bawas. */
  picked_batches: Record<string, string>
}
/** Ang datos ng parcel, walang kinalaman sa kung saan ito nanggaling. */
export type ParcelInfo = Omit<
  ShippedScan,
  "id" | "scanned_by" | "created_at" | "items" | "deducted_total"
  | "manual_scanned_at" | "manual_scanned_by" | "pancake_shipped_at" | "deducted" | "deducted_at"
  | "batch_lines" | "cogs_value" | "cogs_short"
  | "restocked_at" | "restocked_by" | "restocked_qty" | "restock_lines"
  | "picked_batches"
>

const uid = () => `shp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
const isDup = (e: any) => e?.code === "23505" || /duplicate/i.test(e?.message || "")

function rowTo(r: any): ShippedScan {
  return {
    id: r.id, tracking_no: r.tracking_no || "", courier: r.courier || "",
    page_name: r.page_name || "", order_id: r.order_id || "", customer: r.customer || "",
    order_item: r.order_item || "", items: Array.isArray(r.items) ? r.items : [],
    deducted_total: Number(r.deducted_total) || 0, amount: Number(r.amount) || 0,
    scanned_by: r.scanned_by || "",
    date: r.date || "", created_at: r.created_at || "",
    manual_scanned_at: r.manual_scanned_at || "", manual_scanned_by: r.manual_scanned_by || "",
    pancake_shipped_at: r.pancake_shipped_at || "",
    deducted: !!r.deducted, deducted_at: r.deducted_at || "",
    batch_lines: Array.isArray(r.batch_lines) ? r.batch_lines : [],
    cogs_value: Number(r.cogs_value) || 0, cogs_short: Number(r.cogs_short) || 0,
    restocked_at: r.restocked_at || "", restocked_by: r.restocked_by || "",
    restocked_qty: Number(r.restocked_qty) || 0,
    restock_lines: Array.isArray(r.restock_lines) ? r.restock_lines : [],
    picked_batches: (r.picked_batches && typeof r.picked_batches === "object" && !Array.isArray(r.picked_batches)) ? r.picked_batches : {},
  }
}

export function useShippedOutScans() {
  const [scans, setScans] = useState<ShippedScan[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const businessId = await getBusinessId()
    if (!businessId) { setLoaded(true); return }
    const supabase = createSupabaseBrowserClient()
    // ⚠ Map sa id, hindi array: offset pagination ito, at ang insert na dumating
    // sa PAGITAN ng dalawang pahina ay nagtutulak ng mga row pababa — ang dulo ng
    // pahina 1 ay lumilitaw ulit sa umpisa ng pahina 2. Ang dobleng row ay
    // dobleng pera sa kahit anong nagsusuma ng scans (Stock-Out History).
    const byId = new Map<string, ShippedScan>()
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from("shipped_out_scans").select("*")
        .eq("business_id", businessId).order("created_at", { ascending: false }).order("id").range(from, from + PAGE - 1)
      if (error || !data) break
      for (const r of data) { const row = rowTo(r); if (!byId.has(row.id)) byId.set(row.id, row) }
      if (data.length < PAGE) break
    }
    setScans(Array.from(byId.values()))
    setLoaded(true)
  }, [])
  useEffect(() => { refresh() }, [refresh])

  /**
   * MANUAL SCAN ng warehouse. Nagtatala lang — HINDI bumabawas ng inventory.
   *   "added"     — bagong parcel, naitala
   *   "restamped" — may row na (nauna ang Pancake), nadagdagan ng manual na tatak
   *   "already"   — na-scan na dati ng warehouse
   */
  const markManualScan = useCallback(async (
    info: ParcelInfo,
    // {item_id: batch_id} — ang pinili ng warehouse sa scan screen (blangko = FIFO)
    pickedBatches: Record<string, string> = {},
  ): Promise<"added" | "restamped" | "already" | string> => {
    const businessId = await getBusinessId()
    if (!businessId) return "No business configured"
    const supabase = createSupabaseBrowserClient()
    const now = new Date().toISOString()
    const by = currentUserName()

    const { error } = await supabase.from("shipped_out_scans").insert({
      id: uid(), business_id: businessId, ...info,
      items: [], deducted_total: 0, deducted: false,
      scanned_by: by, manual_scanned_by: by, manual_scanned_at: now,
      picked_batches: pickedBatches,
    })
    if (!error) { await refresh(); return "added" }
    if (!isDup(error)) return error.message

    // May row na para sa parcel na ito — nauna ang Pancake sync. Tatakan lang ang
    // manual, at HUWAG bawiin ang naunang manual na tatak (unang scan ang totoo).
    const { data, error: upErr } = await supabase.from("shipped_out_scans")
      .update({ manual_scanned_at: now, manual_scanned_by: by })
      .eq("business_id", businessId).eq("tracking_no", info.tracking_no)
      .is("manual_scanned_at", null)
      .select("id")
    if (upErr) return upErr.message
    // Ang pili ay isinusulat LANG habang hindi pa nababawasan. Kapag nauna na ang
    // FIFO (deducted=true), huli na ang sagot — ang pagtatala nito ngayon ay
    // magpapasinungaling sa row tungkol sa kung ano talaga ang ginamit.
    if (Object.keys(pickedBatches).length) {
      await supabase.from("shipped_out_scans")
        .update({ picked_batches: pickedBatches })
        .eq("business_id", businessId).eq("tracking_no", info.tracking_no)
        .eq("deducted", false)
    }
    await refresh()
    return data && data.length ? "restamped" : "already"
  }, [refresh])

  /**
   * AUTOMATED PANCAKE SHIPPED. Ito lang ang nakakabukas ng bawas.
   *   "claimed" — tayo ang nakakuha ng bawas; ang TUMATAWAG ang dapat magbawas ngayon
   *   "already" — nabawasan na (ibang device/takbo) — huwag nang ulitin
   */
  const claimDeduction = useCallback(async (
    info: ParcelInfo, items: ShippedScanItem[], total: number,
  ): Promise<"claimed" | "already" | string> => {
    const businessId = await getBusinessId()
    if (!businessId) return "No business configured"
    const supabase = createSupabaseBrowserClient()
    const now = new Date().toISOString()

    // 1) Tiyaking may row. Kapag duplicate, ibig sabihin na-scan na ito ng warehouse —
    //    tama lang iyon, sa hakbang 2 pa rin mapupunta ang pagpapasya.
    const { error: insErr } = await supabase.from("shipped_out_scans").insert({
      id: uid(), business_id: businessId, ...info,
      items: [], deducted_total: 0, deducted: false,
      scanned_by: "", pancake_shipped_at: now,
    })
    if (insErr && !isDup(insErr)) return insErr.message
    if (insErr) {
      await supabase.from("shipped_out_scans")
        .update({ pancake_shipped_at: now })
        .eq("business_id", businessId).eq("tracking_no", info.tracking_no)
        .is("pancake_shipped_at", null)
    }

    // 2) ANG PINTO. Ang `.eq("deducted", false)` ang gumagawa nitong conditional —
    //    isa lang ang makakadaan kahit sabay-sabay ang tumawag, at ang natalo ay
    //    walang maibabalik na row. Ito ang pumipigil sa dobleng bawas.
    //
    //    ⚠ Ang pag-claim ay nauuna sa aktwal na pagbabawas. Kapag namatay ang browser
    //    sa pagitan, may parcel na nakamarkang bawas na pero hindi naman nabawasan.
    //    Sinadya ang ganitong pagkakasunod: mas madaling makita ang kulang na bawas
    //    sa Stock-Out Audit kaysa hanapin ang tahimik na dobleng bawas.
    const { data, error: claimErr } = await supabase.from("shipped_out_scans")
      .update({ deducted: true, deducted_at: now, items, deducted_total: total })
      .eq("business_id", businessId).eq("tracking_no", info.tracking_no).eq("deducted", false)
      .select("id")
    if (claimErr) return claimErr.message
    return data && data.length ? "claimed" : "already"
  }, [])

  /**
   * Itinatala kung saang batch kinuha ang labas na ito. Hiwalay ito sa claim dahil
   * alam lang ang sagot PAGKATAPOS tumakbo ang FIFO — at ang claim ang dapat maunang
   * makuha para hindi madoble ang bawas.
   *
   * Ito ang magiging basehan ng RTS restock: hanapin ang tracking, basahin ang linya,
   * ibalik ang dami sa MISMONG batch na pinanggalingan.
   */
  const saveBatchLines = useCallback(async (
    trackingNo: string, lines: BatchLine[], cogsValue: number, cogsShort: number,
  ) => {
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    await supabase.from("shipped_out_scans")
      .update({ batch_lines: lines, cogs_value: cogsValue, cogs_short: cogsShort })
      .eq("business_id", businessId).eq("tracking_no", trackingNo)
  }, [])

  /**
   * Kinukuha ang karapatang ibalik sa inventory ang isang nagbalik na parcel.
   *   "claimed" — tayo ang nakakuha; ang TUMATAWAG ang dapat magbalik ngayon
   *   "already" — naibalik na (ibang device/tab) — huwag nang ulitin
   *
   * Kaparehong pananggalang ng `deducted`: ang `.is("restocked_at", null)` ang gumagawa
   * nitong conditional, kaya isa lang ang makakadaan kahit sabay-sabay pumindot.
   */
  const claimRestock = useCallback(async (
    trackingNo: string, lines: BatchLine[], qty: number,
  ): Promise<"claimed" | "already" | string> => {
    const businessId = await getBusinessId()
    if (!businessId) return "No business configured"
    const supabase = createSupabaseBrowserClient()
    const { data, error } = await supabase.from("shipped_out_scans")
      .update({
        restocked_at: new Date().toISOString(), restocked_by: currentUserName(),
        restocked_qty: qty, restock_lines: lines,
      })
      .eq("business_id", businessId).eq("tracking_no", trackingNo)
      .is("restocked_at", null)
      .select("id")
    if (error) return error.message
    if (!data || data.length === 0) return "already"
    await refresh()
    return "claimed"
  }, [refresh])

  return { scans, loaded, refresh, markManualScan, claimDeduction, saveBatchLines, claimRestock }
}
