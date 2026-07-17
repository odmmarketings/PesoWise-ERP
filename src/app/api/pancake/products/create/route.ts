import { NextRequest, NextResponse } from "next/server"

// Create a product on Pancake POS — called when a Unit Code is submitted, so the code
// automatically appears as a product on the selected Pancake page(s)/shop(s).
// POST body: { api_key, page_id (shop id), name, custom_id, barcode, retail_price, original_price }
const BASE = "https://pos.pages.fm/api/v1"

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
  return { status: 502, code: "API_REQUEST_FAILED", error: `API Request Failed — ${message || "unexpected response from Pancake POS"}.` }
}

export async function POST(req: NextRequest) {
  let body: any = {}
  try { body = await req.json() } catch {}
  const { api_key, page_id, name, custom_id, barcode, retail_price, original_price } = body
  if (!api_key || !page_id || !name) {
    return NextResponse.json({ success: false, error: "Missing api_key / page_id / name" }, { status: 400 })
  }

  const payload = {
    name: String(name),
    custom_id: custom_id ? String(custom_id) : undefined,
    variations: [{
      custom_id: custom_id ? String(custom_id) : undefined,
      barcode: barcode ? String(barcode) : undefined,
      retail_price: Number(retail_price) || 0,
      original_price: Number(original_price) || undefined,
    }],
  }

  const url = `${BASE}/shops/${encodeURIComponent(page_id)}/products?api_key=${encodeURIComponent(api_key)}`
  const attempt = async (body: any) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" })
    const raw = await res.text().catch(() => "")
    let json: any = null; try { json = JSON.parse(raw) } catch {}
    return { res, raw, json }
  }
  // Pull the most specific reason Pancake gives — a bare "HTTP 400" hides the actual field error.
  const detailOf = (a: { res: Response; raw: string; json: any }) =>
    String(a.json?.message || a.json?.error_message || a.json?.reason || (a.json?.errors ? JSON.stringify(a.json.errors) : "") || a.raw || `HTTP ${a.res.status}`).slice(0, 300)

  try {
    let a = await attempt(payload)
    // Some Pancake deployments expect the body wrapped in {product: …} — retry once on a 4xx validation reject.
    if ((!a.res.ok || a.json?.success === false) && (a.res.status === 400 || a.res.status === 422)) {
      const b = await attempt({ product: payload })
      if (b.res.ok && b.json?.success !== false) return NextResponse.json({ success: true, product: b.json?.data ?? null })
      if (detailOf(b) !== `HTTP ${b.res.status}`) a = b   // keep whichever reply actually explains the reject
    }
    if (!a.res.ok || a.json?.success === false) {
      const e = classifyConn(a.res.status, detailOf(a))
      return NextResponse.json({ success: false, errorCode: e.code, error: e.error }, { status: e.status })
    }
    return NextResponse.json({ success: true, product: a.json?.data ?? null })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: "Failed to create product — " + (err?.message || "network error") }, { status: 500 })
  }
}
