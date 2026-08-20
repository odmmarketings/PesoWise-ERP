import { NextRequest, NextResponse } from "next/server"

// UPSERT a product on Pancake POS from a Unit Code — called on BOTH Add and Edit.
//
// Why this exists separately from products/create: `custom_id` must be unique account-wide
// on Pancake, so re-pushing an existing code answers "Custom Product ID already existes in
// the system" and the edit silently does nothing. This route looks the product up FIRST and
// updates it in place; it only creates when there is genuinely nothing there.
//
// POST body: { api_key, page_id (shop id), code, prev_code?, retail_price?, original_price? }
//   prev_code — the code BEFORE the edit. A rename must be found under its OLD name,
//               otherwise the rename creates a second product instead of moving the first.
// Reply: { success, action: "created" | "updated", product }
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

type Attempt = { res: Response; raw: string; json: any }
async function call(url: string, method: string, body?: any): Promise<Attempt> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  })
  const raw = await res.text().catch(() => "")
  let json: any = null; try { json = JSON.parse(raw) } catch { /* non-JSON body */ }
  return { res, raw, json }
}
// Pull the most specific reason Pancake gives — a bare "HTTP 400" hides the actual field error.
const detailOf = (a: Attempt) =>
  String(a.json?.message || a.json?.error_message || a.json?.reason || (a.json?.errors ? JSON.stringify(a.json.errors) : "") || a.raw || `HTTP ${a.res.status}`).slice(0, 300)
const accepted = (a: Attempt) => a.res.ok && a.json?.success !== false

// Fresh catalog lookup, paginated. Page 1 alone is NOT enough: a shop past its first page
// would report "not found" for a product that exists, and the create fallback would then be
// rejected as a duplicate custom_id — the exact failure this route is here to prevent.
async function findProduct(shop: string, k: string, wanted: string[]): Promise<any | null> {
  const want = wanted.map(w => String(w || "").trim().toLowerCase()).filter(Boolean)
  if (!want.length) return null
  const MAX_PAGES = 30   // 3,000 products, same ceiling as the picker route
  for (let page = 1; page <= MAX_PAGES; page++) {
    const a = await call(`${BASE}/shops/${shop}/products?api_key=${k}&page_size=100&page_number=${page}`, "GET")
    if (!accepted(a)) throw new Error(detailOf(a))
    const prods: any[] = Array.isArray(a.json?.data) ? a.json.data : []
    const hit = prods.find(p =>
      want.includes(String(p?.name || "").trim().toLowerCase()) ||
      want.includes(String(p?.custom_id || "").trim().toLowerCase())
    )
    if (hit) return hit
    const totalPages = Number(a.json?.total_pages ?? 1)
    if (prods.length < 100 || page >= totalPages) break
  }
  return null
}

export async function POST(req: NextRequest) {
  let body: any = {}
  try { body = await req.json() } catch { /* empty body → validation below */ }
  const { api_key, page_id, code, prev_code, retail_price, original_price } = body
  if (!api_key || !page_id || !code) {
    return NextResponse.json({ success: false, error: "Missing api_key / page_id / code" }, { status: 400 })
  }
  const k = encodeURIComponent(api_key)
  const shop = encodeURIComponent(page_id)
  const name = String(code).trim()

  // A zero here means "not filled in", not "free". Sending it would wipe a price that was
  // set on Pancake itself, so an unknown value is left alone rather than guessed at.
  const retail = Number(retail_price) > 0 ? Number(retail_price) : undefined
  const original = Number(original_price) > 0 ? Number(original_price) : undefined

  try {
    const existing = await findProduct(shop, k, [prev_code, code])

    // ── UPDATE ────────────────────────────────────────────────────────────────
    if (existing) {
      const id = encodeURIComponent(existing.id || existing.product_id)
      const url = `${BASE}/shops/${shop}/products/${id}?api_key=${k}`
      // Price lives on the VARIATION, so the existing variation id has to ride along —
      // without it Pancake treats the array as a replacement and the product loses its
      // sellable variation (which is what an order line points at).
      const vars: any[] = Array.isArray(existing.variations) ? existing.variations : []
      const first = vars[0]
      const variation: any = {
        ...(first?.id ? { id: first.id } : {}),
        custom_id: name, barcode: name,
        // Pinapanatiling OFF kahit sa EDIT — kung hindi, ang unang pag-edit ay
        // tahimik na magbubukas muli ng negatibong benta.
        is_sell_negative_variation: false,
        ...(retail !== undefined ? { retail_price: retail } : {}),
        ...(original !== undefined ? { original_price: original } : {}),
      }
      const payload: any = { name, custom_id: name, is_sell_negative: false, variations: [variation] }

      // Deployments differ on method and envelope; try the plain shape first and keep
      // whichever reply actually explains a rejection.
      const shapes: Array<{ m: string; b: any }> = [
        { m: "PUT", b: payload },
        { m: "PUT", b: { product: payload } },
        { m: "POST", b: payload },
      ]
      let last: Attempt | null = null
      for (const s of shapes) {
        const a = await call(url, s.m, s.b)
        if (accepted(a)) return NextResponse.json({ success: true, action: "updated", product: a.json?.data ?? null })
        last = a
        if (a.res.status === 401 || a.res.status === 403) break   // auth problem — other shapes won't help
      }
      const e = classifyConn(last!.res.status, detailOf(last!))
      return NextResponse.json({ success: false, action: "updated", errorCode: e.code, error: e.error }, { status: e.status })
    }

    // ── CREATE ────────────────────────────────────────────────────────────────
    const payload = {
      name, custom_id: name,
      // ⚠ NAKA-OFF ANG "Allow sale of negative inventory" SA PAGLIKHA — hiling
      // ng may-ari (Ago 21 2026, may screenshot ng toggle). Ang unit code ay
      // BUNDLE: ang tunay na stock ay nasa mga bahagi nito sa PesoWise, kaya
      // ang pagpayag ng negatibong benta sa POS ay pagbebenta ng wala.
      //
      // ⚠ NASA VARIATION ang switch (`is_sell_negative_variation`); ang
      // `is_sell_negative` ng produkto ay itinatakda rin para magkasundo.
      // Napatunayan sa buhay na account, Ago 21 2026.
      //
      // HINDI ito `is_hidden`. Naunang binasa kong "naka-off" iyon at MALI:
      // itinatago niyon ang buong produkto sa POS. Ang hiningi ay ang toggle
      // sa loob ng produkto, hindi ang pagtatago nito.
      is_sell_negative: false,
      variations: [{ custom_id: name, barcode: name, retail_price: retail ?? 0, original_price: original, is_sell_negative_variation: false }],
    }
    const url = `${BASE}/shops/${shop}/products?api_key=${k}`
    let a = await call(url, "POST", payload)
    if (!accepted(a) && (a.res.status === 400 || a.res.status === 422)) {
      const b = await call(url, "POST", { product: payload })
      if (accepted(b)) return NextResponse.json({ success: true, action: "created", product: b.json?.data ?? null })
      if (detailOf(b) !== `HTTP ${b.res.status}`) a = b
    }
    // ⚠ ANG custom_id/barcode NI PANCAKE AY UNIQUE SA BUONG ACCOUNT, HINDI KADA
    // PAGE. Kaya ang "Variation … already exists in the system" ay lumalabas
    // kahit WALA ang produkto sa page na pinupuntahan — hawak ng ibang page (o
    // ng buradong produkto) ang pangalan bilang barcode, at hindi natin iyon
    // maaabot mula rito. Napatunayan Ago 20 2026: ang "Lumyra x2" ay wala sa
    // KAHIT ANONG konektadong page pero tinanggihan pa rin, kaya hindi kailanman
    // lumitaw ang unit code sa POS (iniulat ng may-ari).
    //
    // Ang PANGALAN ang binabasa ng POS staff at ang batayan ng aming update/
    // delete matching (name O custom_id) — kaya kapag ang custom_id ang balakid,
    // muling sinusubukan NANG WALA ITO. Hindi ito pagtanggal ng katangian:
    // pagpili ito ng makakalusot na kalahati kaysa sa walang produkto.
    if (!accepted(a) && /already exist/i.test(detailOf(a))) {
      const bare = { name, is_sell_negative: false, variations: [{ retail_price: retail ?? 0, original_price: original, is_sell_negative_variation: false }] }
      let c = await call(url, "POST", bare)
      if (!accepted(c) && (c.res.status === 400 || c.res.status === 422)) {
        const d = await call(url, "POST", { product: bare })
        if (accepted(d)) c = d
      }
      if (accepted(c)) {
        return NextResponse.json({
          success: true, action: "created",
          // Sinasabi nang tahasan — kung balang-araw ay kailangan ng barcode sa
          // POS, ang produktong ito ay walang dala niyon at doon ito hahanapin.
          note: "custom_id taken account-wide (another page or a deleted product holds it) — created by name only",
          product: c.json?.data ?? null,
        })
      }
    }
    if (!accepted(a)) {
      const e = classifyConn(a.res.status, detailOf(a))
      return NextResponse.json({ success: false, action: "created", errorCode: e.code, error: e.error }, { status: e.status })
    }
    return NextResponse.json({ success: true, action: "created", product: a.json?.data ?? null })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: "Failed to sync product — " + (err?.message || "network error") }, { status: 500 })
  }
}
