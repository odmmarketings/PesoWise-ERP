"use client"

// ──────────────────────────────────────────────────────────────────────────────
// Live Pancake courier aggregation — shared by the Income Statement and the
// Finance Overview. Pulls order rows from the shared /api/pancake/orders proxy
// (same shape as the Sales Tracker) and rolls up per-courier shipping fees,
// in-transit / on-delivery amounts, actual RTS %, and PAR (= amount × (1 − RTS%)).
// J&T fees prefer the Excel-imported figure (jnt_shipping_fees, via the Sales
// Tracker) over Pancake's own shipping_fee.
// ──────────────────────────────────────────────────────────────────────────────

export const normTracking = (s: any) => String(s ?? "").trim().toUpperCase()

export async function fetchPageRows(apiKey: string, pageId: string, from: string, to: string): Promise<any[]> {
  const res = await fetch(
    `/api/pancake/orders?api_key=${encodeURIComponent(apiKey)}&page_id=${encodeURIComponent(pageId)}`
    + `&from=${from}&to=${to}&phase=rows&basis=sales_order`, { cache: "no-store" })
  const json = await res.json()
  if (!res.ok || !json.success) throw new Error(json.error || "API error")
  return Array.isArray(json.rows) ? json.rows : []
}

export async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) await fn(items[i++]) }))
}

export function courierOf(c: string): "jnt" | "spx" | "other" {
  const s = (c || "").toLowerCase()
  if (/j\s*&?\s*t|jt\s*express|jtexpress/.test(s)) return "jnt"
  if (/spx|shopee/.test(s)) return "spx"
  return "other"
}

// Parcel journey bucket from the courier status (+ order status as fallback).
export function bucketOf(parcel: string, order: string): "intransit" | "ondelivery" | "delivered" | "returned" | "other" {
  const p = (parcel || "").toLowerCase(), o = (order || "").toLowerCase()
  if (/return/.test(p) || /return/.test(o)) return "returned"
  if (/delivered/.test(p) || /delivered/.test(o)) return "delivered"
  if (/transit/.test(p)) return "intransit"
  if (/(out for delivery|on-delivery|on delivery|delivering)/.test(p)) return "ondelivery"
  return "other"
}

export interface CourierAgg {
  shippingFee: number
  inTransitAmt: number; onDeliveryAmt: number
  rtsPct: number
  inTransitPar: number; onDeliveryPar: number; totalPar: number
}
export const EMPTY_AGG: CourierAgg = { shippingFee: 0, inTransitAmt: 0, onDeliveryAmt: 0, rtsPct: 0, inTransitPar: 0, onDeliveryPar: 0, totalPar: 0 }

export function aggregateCourier(rows: any[], which: "jnt" | "spx", jntFees: Record<string, number>): CourierAgg {
  let shippingFee = 0, inTransitAmt = 0, onDeliveryAmt = 0, delivered = 0, returned = 0
  for (const r of rows) {
    if (courierOf(r.courier) !== which) continue
    const amount = Number(r.final_price || 0)
    const fee = which === "jnt" ? (jntFees[normTracking(r.tracking_no)] ?? Number(r.shipping_fee || 0)) : Number(r.shipping_fee || 0)
    shippingFee += fee
    const b = bucketOf(r.parcel_status, r.order_status)
    if (b === "intransit") inTransitAmt += amount
    else if (b === "ondelivery") onDeliveryAmt += amount
    else if (b === "delivered") delivered++
    else if (b === "returned") returned++
  }
  const rtsPct = delivered + returned > 0 ? returned / (delivered + returned) : 0
  const inTransitPar = inTransitAmt * (1 - rtsPct)
  const onDeliveryPar = onDeliveryAmt * (1 - rtsPct)
  return { shippingFee, inTransitAmt, onDeliveryAmt, rtsPct, inTransitPar, onDeliveryPar, totalPar: inTransitPar + onDeliveryPar }
}
