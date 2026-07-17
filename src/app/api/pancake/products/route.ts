import { NextRequest, NextResponse } from "next/server"

const BASE = "https://pos.pages.fm/api/v1"

// Short-TTL in-memory cache so re-opening the Add Order form for the same page doesn't
// re-hit Pancake's product endpoint on every page-select. Keyed by shop+api_key.
type CacheEntry = { ts: number; data: any }
const CACHE = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 120_000  // 2 min — product catalogs change slowly

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Same fetch-with-backoff contract as the orders route: retry transient 429/5xx/network,
// one quick retry for 403 (usually a real bad key, fail fast).
async function fetchPancakeJSON(url: string, retries = 2): Promise<{ ok: boolean; status: number; json: any }> {
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(url, { cache: "no-store" })
    } catch {
      if (attempt < retries) { await sleep(350 * (attempt + 1)); continue }
      return { ok: false, status: 0, json: null }
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(450 * (attempt + 1)); continue
    }
    if (res.status === 403 && attempt < 1) { await sleep(300); continue }
    let json: any = null
    try { json = await res.json() } catch { /* non-JSON body */ }
    return { ok: res.ok, status: res.status, json }
  }
}

// Mirror the orders route's connection-error classification so the form shows precise messages.
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
  return { status: 502, code: "API_REQUEST_FAILED", error: `API Request Failed — ${message || "unexpected response from Pancake POS"}.` }
}

// A single selectable line in the product picker. Pancake sells at the VARIATION level, so we
// flatten every product's variations into their own entries (carrying the variation_id needed to
// create an order). Products with a single variation collapse to one clean entry.
type ProductOption = {
  product_id: string
  variation_id: string
  display_id: string   // human-facing SKU/code if Pancake exposes one
  name: string         // product name (+ variation detail when a product has multiple variations)
  price: number        // retail price (Pancake computes the order total from this)
  image: string
}

// Build a readable variation label from whatever Pancake exposes (schema varies across shops):
// explicit variation name → joined attribute field values → bare product name.
function variationLabel(productName: string, v: any, multiVariation: boolean): string {
  if (!multiVariation) return productName
  const explicit = String(v?.name || v?.variation_name || "").trim()
  if (explicit && explicit.toLowerCase() !== productName.toLowerCase()) return `${productName} — ${explicit}`
  const fields: any[] = Array.isArray(v?.fields) ? v.fields : []
  const attrs = fields.map(f => String(f?.value ?? f?.name ?? "").trim()).filter(Boolean)
  if (attrs.length) return `${productName} — ${attrs.join(" / ")}`
  return productName
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const api_key = searchParams.get("api_key")
  const shop_id = searchParams.get("page_id")  // same page_id→shop convention as the orders route
  const noCache = searchParams.get("nocache") === "1"

  if (!api_key || !shop_id) {
    return NextResponse.json(
      { success: false, errorCode: "MISSING_CREDENTIALS", error: "Missing Credentials — add the API key and Page/Store ID in Pages & Store." },
      { status: 400 }
    )
  }

  const cacheKey = `${shop_id}|${api_key}`
  if (!noCache) {
    const hit = CACHE.get(cacheKey)
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
      return NextResponse.json({ ...hit.data, cached: true })
    }
  }

  const buildUrl = (pageNum: number) => {
    const url = new URL(`${BASE}/shops/${shop_id}/products`)
    url.searchParams.set("api_key", api_key)
    url.searchParams.set("page_number", String(pageNum))
    url.searchParams.set("page_size", "100")
    return url.toString()
  }

  try {
    const MAX_PAGES = 30  // 3000 products — plenty for a picker; avoids runaway pulls
    const first = await fetchPancakeJSON(buildUrl(1))
    if (!first.ok || first.json?.success === false) {
      const e = classifyConn(first.status, String(first.json?.message ?? `HTTP ${first.status || "network error"}`))
      return NextResponse.json({ success: false, errorCode: e.code, error: e.error }, { status: e.status })
    }

    const rawProducts: any[] = Array.isArray(first.json?.data) ? [...first.json.data] : []
    const totalPages = Math.min(Number(first.json?.total_pages ?? 1), MAX_PAGES)

    // Remaining pages in small parallel batches (keep Pancake's rate limit happy).
    const CONCURRENCY = 6
    for (let start = 2; start <= totalPages; start += CONCURRENCY) {
      const batch: number[] = []
      for (let p = start; p < start + CONCURRENCY && p <= totalPages; p++) batch.push(p)
      const results = await Promise.all(batch.map(p => fetchPancakeJSON(buildUrl(p))))
      for (const r of results) if (Array.isArray(r.json?.data)) rawProducts.push(...r.json.data)
    }

    const options: ProductOption[] = []
    for (const p of rawProducts) {
      const productName = String(p?.name || p?.product_name || "").trim() || "Unnamed product"
      const productId = String(p?.id ?? p?.product_id ?? "")
      const variations: any[] = Array.isArray(p?.variations) ? p.variations : []
      const image = String(p?.image_url || p?.images?.[0] || "")
      if (variations.length === 0) {
        // No variation array — treat the product itself as the sellable unit.
        options.push({
          product_id: productId, variation_id: productId, display_id: String(p?.display_id ?? ""),
          name: productName, price: Number(p?.retail_price ?? p?.price ?? 0), image,
        })
        continue
      }
      const multi = variations.length > 1
      for (const v of variations) {
        options.push({
          product_id: productId,
          variation_id: String(v?.id ?? v?.variation_id ?? ""),
          display_id: String(v?.display_id ?? v?.barcode ?? p?.display_id ?? ""),
          name: variationLabel(productName, v, multi),
          price: Number(v?.retail_price ?? v?.price ?? p?.retail_price ?? 0),
          image: String(v?.image_url || image),
        })
      }
    }

    // Drop entries with no variation_id (can't be ordered) and sort by name for a tidy picker.
    const products = options
      .filter(o => o.variation_id)
      .sort((a, b) => a.name.localeCompare(b.name))

    const resp = { success: true, products, count: products.length }
    CACHE.set(cacheKey, { ts: Date.now(), data: resp })
    return NextResponse.json(resp)
  } catch (err: any) {
    return NextResponse.json(
      { success: false, errorCode: "DATA_SYNC_FAILED", error: "Failed to load products — " + (err?.message || "unexpected error.") },
      { status: 500 }
    )
  }
}
