import { NextRequest, NextResponse } from "next/server"

// Send an order to a courier on Pancake POS (the "Send orders to courier" action) —
// assigns the shipping partner on the order, which triggers Pancake's courier booking.
// POST body: { api_key, shop_id, order_id, partner_id, options?: { is_free_shipping?, is_dropoff?, note? } }
// Partner ids come from GET /shops/{id}/partners (SPX Phi = 125, J&T Philippines = 10 for this account).
// The exact accepted body shape is undocumented, so we try the plausible variants and surface
// Pancake's raw error so a reject tells us exactly what to fix.
const BASE = "https://pos.pages.fm/api/v1"

export async function POST(req: NextRequest) {
  let body: any = {}
  try { body = await req.json() } catch {}
  const { api_key, shop_id, order_id, partner_id, options } = body
  if (!api_key || !shop_id || !order_id || !partner_id) {
    return NextResponse.json({ success: false, error: "Missing api_key / shop_id / order_id / partner_id" }, { status: 400 })
  }

  const partner: Record<string, any> = { partner_id: Number(partner_id) }
  if (options?.is_free_shipping != null) partner.is_free_shipping = !!options.is_free_shipping
  if (options?.is_dropoff) partner.is_dropoff = true
  if (options?.note) partner.note = String(options.note).slice(0, 500)

  const url = `${BASE}/shops/${encodeURIComponent(shop_id)}/orders/${encodeURIComponent(order_id)}?api_key=${encodeURIComponent(api_key)}`
  const attempt = async (method: "PUT" | "POST", payload: any) => {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store" })
    const raw = await res.text().catch(() => "")
    let json: any = null; try { json = JSON.parse(raw) } catch {}
    return { res, raw, json }
  }
  const detailOf = (a: { res: Response; raw: string; json: any }) =>
    String(a.json?.message || a.json?.error_message || a.json?.reason || (a.json?.errors ? JSON.stringify(a.json.errors) : "") || a.raw || `HTTP ${a.res.status}`).slice(0, 300)

  try {
    // Variant 1: flat { partner } — Pancake's documented order-update body style.
    // status 9 = Waiting for Pick Up (⚠ NOT 11 — 11|"waitting" is Pancake's "Restocking",
    // user-confirmed in the POS UI). Sending to courier must move the order out of Packaging.
    const WAITING_PICKUP = 9
    let a = await attempt("PUT", { partner, status: WAITING_PICKUP })
    if ((!a.res.ok || a.json?.success === false) && [400, 404, 405, 422].includes(a.res.status)) {
      // Variant 2: wrapped { order: { partner } }
      const b = await attempt("PUT", { order: { partner, status: WAITING_PICKUP } })
      if (b.res.ok && b.json?.success !== false) a = b
      else {
        // Variant 3: POST instead of PUT (some deployments)
        const c = await attempt("POST", { partner, status: WAITING_PICKUP })
        if (c.res.ok && c.json?.success !== false) a = c
        else if (detailOf(b) !== `HTTP ${b.res.status}`) a = b   // keep the most explanatory reject
        else if (detailOf(c) !== `HTTP ${c.res.status}`) a = c
      }
    }
    if (!a.res.ok || a.json?.success === false) {
      return NextResponse.json({ success: false, error: detailOf(a) }, { status: 502 })
    }
    let d = a.json?.data || a.json || {}
    // Safety net: if Pancake accepted the partner but kept the old status (e.g. still "packing"),
    // push the status change on its own.
    if (d?.status != null && Number(d.status) !== WAITING_PICKUP) {
      const s = await attempt("PUT", { status: WAITING_PICKUP })
      if (s.res.ok && s.json?.success !== false) d = s.json?.data || d
    }
    return NextResponse.json({
      success: true,
      tracking: d?.partner?.extend_code || d?.partner?.tracking_id || "",
      status_name: d?.status_name || "",
    })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: "Failed to send to courier — " + (err?.message || "network error") }, { status: 500 })
  }
}
