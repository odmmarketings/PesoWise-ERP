import { NextRequest, NextResponse } from "next/server"

// Update an order's status on Pancake POS (Fulfillment → Tools → Update Parcel Status).
// POST body: { api_key, shop_id, order_id, status (Pancake status number) }
// Same PUT-with-fallback pattern as send-courier (live-verified: PUT {status: N} works).
const BASE = "https://pos.pages.fm/api/v1"

export async function POST(req: NextRequest) {
  let body: any = {}
  try { body = await req.json() } catch {}
  const { api_key, shop_id, order_id, status } = body
  if (!api_key || !shop_id || !order_id || status == null) {
    return NextResponse.json({ success: false, error: "Missing api_key / shop_id / order_id / status" }, { status: 400 })
  }
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
    let a = await attempt("PUT", { status: Number(status) })
    if ((!a.res.ok || a.json?.success === false) && [400, 404, 405, 422].includes(a.res.status)) {
      const b = await attempt("PUT", { order: { status: Number(status) } })
      if (b.res.ok && b.json?.success !== false) a = b
    }
    if (!a.res.ok || a.json?.success === false) {
      return NextResponse.json({ success: false, error: detailOf(a) }, { status: 502 })
    }
    const d = a.json?.data || a.json || {}
    return NextResponse.json({ success: true, status_name: d?.status_name || "" })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: "Failed to update status — " + (err?.message || "network error") }, { status: 500 })
  }
}
