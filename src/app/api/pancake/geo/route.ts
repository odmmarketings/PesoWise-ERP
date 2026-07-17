import { NextRequest, NextResponse } from "next/server"

const BASE = "https://pos.pages.fm/api/v1"

// Pancake's geo reference (provinces → districts → communes) rarely changes, so cache aggressively.
type CacheEntry = { ts: number; data: any }
const CACHE = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 60 * 60_000  // 1 hour

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function fetchPancakeJSON(url: string, retries = 2): Promise<{ ok: boolean; status: number; json: any }> {
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(url, { cache: "no-store" })
    } catch {
      if (attempt < retries) { await sleep(300 * (attempt + 1)); continue }
      return { ok: false, status: 0, json: null }
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(400 * (attempt + 1)); continue
    }
    if (res.status === 403 && attempt < 1) { await sleep(300); continue }
    let json: any = null
    try { json = await res.json() } catch { /* non-JSON */ }
    return { ok: res.ok, status: res.status, json }
  }
}

function classifyConn(status: number, message: string) {
  const msg = (message || "").toLowerCase()
  if (msg.includes("api_key") || msg.includes("api key") || msg.includes("unauthor") || msg.includes("token") || status === 401) {
    return { status: 401, code: "API_KEY_INVALID", error: "API Key Invalid — the API key/token was rejected. Check it in Pages & Store." }
  }
  if (status === 429 || msg.includes("rate") || msg.includes("too many") || msg.includes("limit")) {
    return { status: 503, code: "RATE_LIMITED", error: "Rate limit hit — too many requests to Pancake. Try again in a moment." }
  }
  if (status === 403) {
    return { status: 503, code: "API_REQUEST_FAILED", error: "API Request Failed — Pancake rejected the request (HTTP 403, possibly throttling)." }
  }
  return { status: 502, code: "API_REQUEST_FAILED", error: `Could not load locations — ${message || "unexpected response from Pancake POS"}.` }
}

// Proxy Pancake's geo endpoints used to build the dependent address dropdowns:
//   type=provinces  → GET /geo/provinces?country_code=63
//   type=districts  → GET /geo/districts?province_id=...
//   type=communes   → GET /geo/communes?province_id=...&district_id=...
// Philippine country_code is "63" (same scheme as Vietnam's "84"). api_key is passed through for
// auth, consistent with the rest of the Pancake API.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const api_key = searchParams.get("api_key")
  const type = searchParams.get("type") || "provinces"
  const country_code = searchParams.get("country_code") || "63"  // PH
  const province_id = searchParams.get("province_id") || ""
  const district_id = searchParams.get("district_id") || ""

  if (!api_key) {
    return NextResponse.json(
      { success: false, errorCode: "MISSING_CREDENTIALS", error: "Missing Credentials — connect a Page with a Pancake API key first." },
      { status: 400 }
    )
  }

  let url: URL
  if (type === "districts") {
    if (!province_id) return NextResponse.json({ success: false, error: "province_id required for districts." }, { status: 400 })
    url = new URL(`${BASE}/geo/districts`)
    url.searchParams.set("province_id", province_id)
  } else if (type === "communes") {
    if (!province_id || !district_id) return NextResponse.json({ success: false, error: "province_id and district_id required for communes." }, { status: 400 })
    url = new URL(`${BASE}/geo/communes`)
    url.searchParams.set("province_id", province_id)
    url.searchParams.set("district_id", district_id)
  } else {
    url = new URL(`${BASE}/geo/provinces`)
    url.searchParams.set("country_code", country_code)
  }
  url.searchParams.set("api_key", api_key)

  const cacheKey = url.toString()
  const hit = CACHE.get(cacheKey)
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    return NextResponse.json({ ...hit.data, cached: true })
  }

  try {
    const { ok, status, json } = await fetchPancakeJSON(cacheKey)
    if (!ok || json?.success === false) {
      const e = classifyConn(status, String(json?.message ?? `HTTP ${status || "network error"}`))
      return NextResponse.json({ success: false, errorCode: e.code, error: e.error }, { status: e.status })
    }
    const raw: any[] = Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : [])
    // Slim list for the dropdowns. Prefer English name when present (PH labels). postcode helps
    // auto-fill Zip on commune selection.
    const items = raw.map((g: any) => ({
      id: String(g?.id ?? ""),
      name: String(g?.name_en || g?.name || "").trim(),
      postcode: String(g?.postcode ?? g?.post_code ?? ""),
    })).filter(i => i.id && i.name)
      .sort((a, b) => a.name.localeCompare(b.name))

    const resp = { success: true, type, items, count: items.length }
    CACHE.set(cacheKey, { ts: Date.now(), data: resp })
    return NextResponse.json(resp)
  } catch (err: any) {
    return NextResponse.json(
      { success: false, errorCode: "GEO_FAILED", error: "Could not load locations — " + (err?.message || "unexpected error.") },
      { status: 500 }
    )
  }
}
