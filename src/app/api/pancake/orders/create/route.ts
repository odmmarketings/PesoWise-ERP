import { NextRequest, NextResponse } from "next/server"

const BASE = "https://pos.pages.fm/api/v1"

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Order creation is NOT idempotent, so we don't auto-retry on ambiguous failures. We only retry
// network errors / 5xx where we're confident the request never reached Pancake's order logic.
async function postPancakeJSON(url: string, body: any, retries = 1): Promise<{ ok: boolean; status: number; json: any }> {
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(body),
      })
    } catch {
      if (attempt < retries) { await sleep(400 * (attempt + 1)); continue }
      return { ok: false, status: 0, json: null }
    }
    if (res.status >= 500 && attempt < retries) { await sleep(400 * (attempt + 1)); continue }
    let json: any = null
    try { json = await res.json() } catch { /* non-JSON body */ }
    return { ok: res.ok, status: res.status, json }
  }
}

function classifyConn(status: number, message: string) {
  const msg = (message || "").toLowerCase()
  if (msg.includes("api_key") || msg.includes("api key") || msg.includes("unauthor") || msg.includes("token") || status === 401) {
    return { status: 401, code: "API_KEY_INVALID", error: "API Key Invalid — the API key/token was rejected. Check it in Pages & Store." }
  }
  if (status === 404 || msg.includes("not found") || msg.includes("shop")) {
    return { status: 404, code: "STORE_NOT_CONNECTED", error: "Store / Page Not Connected — check the Shop ID / Page ID in Pages & Store." }
  }
  if (status === 429 || msg.includes("rate") || msg.includes("too many") || msg.includes("limit")) {
    return { status: 503, code: "RATE_LIMITED", error: "Rate limit hit — too many requests to Pancake. Try again in a moment." }
  }
  if (status === 403) {
    return { status: 503, code: "API_REQUEST_FAILED", error: "API Request Failed — Pancake rejected the request (HTTP 403, possibly throttling)." }
  }
  return { status: 502, code: "API_REQUEST_FAILED", error: `Order Not Created — ${message || "Pancake POS rejected the order."}.` }
}

type IncomingItem = { variation_id: string; product_id?: string; quantity: number; price?: number; name?: string }
type IncomingOrder = {
  customer_name: string
  contact_no: string
  address: string
  province?: string
  city?: string
  barangay?: string
  province_id?: string
  district_id?: string
  commune_id?: string
  zip_code?: string
  mop?: string
  parcel_qty?: number
  note?: string
  items: IncomingItem[]
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const api_key = searchParams.get("api_key")
  const shop_id = searchParams.get("page_id")  // same page_id→shop convention as the orders route

  if (!api_key || !shop_id) {
    return NextResponse.json(
      { success: false, errorCode: "MISSING_CREDENTIALS", error: "Missing Credentials — add the API key and Page/Store ID in Pages & Store." },
      { status: 400 }
    )
  }

  let order: IncomingOrder
  try {
    order = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 })
  }

  // Server-side guard — mirror the form's validation so a malformed client request can't create a
  // half-empty order in Pancake.
  const items = (order.items || []).filter(i => i?.variation_id && Number(i?.quantity) > 0)
  const missing: string[] = []
  if (!order.customer_name?.trim()) missing.push("Customer Full Name")
  if (!order.contact_no?.trim()) missing.push("Contact Number")
  if (!order.address?.trim()) missing.push("Address")
  if (items.length === 0) missing.push("Item / Quantity")
  if (missing.length) {
    return NextResponse.json(
      { success: false, errorCode: "VALIDATION", error: `Missing required fields: ${missing.join(", ")}.` },
      { status: 400 }
    )
  }

  // Compose a single human-readable shipping address. Pancake create-order accepts a free-text
  // full_address (geo IDs province_id/district_id/commune_id are optional for a freshly-encoded
  // order); we don't have a name→geo-ID lookup, so we send the readable address and let warehouse
  // staff confirm the structured location, exactly like a CSR manually encoding the order.
  const addrParts = [order.address, order.barangay, order.city, order.province, order.zip_code]
    .map(s => String(s || "").trim()).filter(Boolean)
  const fullAddress = addrParts.join(", ")

  const noteLines = [
    order.note?.trim(),
    order.mop ? `MOP: ${order.mop}` : "",
    order.parcel_qty ? `Parcel Qty: ${order.parcel_qty}` : "",
    "Encoded via PesoWise ERP",
  ].filter(Boolean)

  // Build the Pancake order payload. We intentionally DON'T send prices/totals — Pancake derives
  // them from each variation's retail_price (variation_info.retail_price is included as a hint only
  // when the client knows it). status 0 = "New", matching a freshly encoded order.
  const payload: any = {
    status: 0,
    bill_full_name: order.customer_name.trim(),
    bill_phone_number: order.contact_no.trim(),
    is_free_shipping: false,
    note: noteLines.join(" | "),
    items: items.map(i => ({
      variation_id: i.variation_id,
      ...(i.product_id ? { product_id: i.product_id } : {}),
      quantity: Number(i.quantity),
      ...(i.price != null ? { variation_info: { retail_price: Number(i.price) } } : {}),
    })),
    shipping_address: {
      full_name: order.customer_name.trim(),
      phone_number: order.contact_no.trim(),
      address: order.address.trim(),
      full_address: fullAddress,
      // Structured location IDs from Pancake's /geo endpoints — required for a properly
      // geo-coded order (province=PH province, district=City/Municipality, commune=Barangay).
      // country_code "63" = Philippines (same scheme as Vietnam's "84").
      country_code: "63",
      ...(order.province_id ? { province_id: String(order.province_id) } : {}),
      ...(order.district_id ? { district_id: String(order.district_id) } : {}),
      ...(order.commune_id ? { commune_id: String(order.commune_id) } : {}),
      ...(order.zip_code?.trim() ? { post_code: order.zip_code.trim() } : {}),
    },
  }

  const url = `${BASE}/shops/${shop_id}/orders?api_key=${encodeURIComponent(api_key)}`

  try {
    const { ok, status, json } = await postPancakeJSON(url, payload)
    if (!ok || json?.success === false) {
      const e = classifyConn(status, String(json?.message ?? json?.error ?? `HTTP ${status || "network error"}`))
      return NextResponse.json({ success: false, errorCode: e.code, error: e.error }, { status: e.status })
    }
    // Pancake returns the created order under data (id / display_id may live at a couple of paths).
    const created = json?.data ?? json?.order ?? json
    const orderId = String(created?.id ?? created?.order_id ?? "")
    return NextResponse.json({ success: true, order_id: orderId, display_id: String(created?.display_id ?? "") })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, errorCode: "ORDER_CREATE_FAILED", error: "Order Not Created — " + (err?.message || "unexpected error.") },
      { status: 500 }
    )
  }
}
