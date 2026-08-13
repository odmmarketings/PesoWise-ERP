import { NextRequest, NextResponse } from "next/server"

const BASE = "https://pos.pages.fm/api/v1"

// --- Short-TTL in-memory response cache ---------------------------------------
// Re-selecting a recently-viewed date range / filter returns instantly instead of
// re-hitting Pancake. Keyed by shop+range+basis+phase. The dashboard's Refresh
// button bypasses it (nocache=1) for fresh data. Lives for the server process'
// lifetime (fine for a single instance; swap for Redis if horizontally scaled).
type CacheEntry = { ts: number; data: any }
const CACHE = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 60_000  // 60s

// Convert YYYY-MM-DD to Unix timestamp in Philippine time (UTC+8)
function toUnix(dateStr: string, endOfDay = false): number {
  const [y, m, d] = dateStr.split("-").map(Number)
  const offsetMs = 8 * 60 * 60 * 1000
  const utcMs = Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMs
  return Math.floor(utcMs / 1000) + (endOfDay ? 86399 : 0)
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ── PER-REQUEST TIMEOUT ──────────────────────────────────────────────────────
// Pabago-bago ang Pancake: NASUKAT (Ago 6 2026) na ang PAREHONG request ay
// tumatagal ng 0.3s at 12.0s (Optilux, 27 orders), at 0.8s at 28.6s (CystCare).
// Walang kinalaman ang laki — random stall lang. Walang timeout dati kada
// request, kaya isang naka-stall na sub-page ay kinakain ang BUONG 60s na budget
// ng client at "timeout — hindi sumagot ang Pancake sa loob ng 60s" ang lumalabas
// para sa isang page (Lumyra, nakita sa production). Ang pag-abandona at
// pag-retry ay halos laging mabilis magtagumpay — kaya hindi paghihintay ang
// tamang sagot kundi pagsuko agad at muling pagsubok.
const REQ_TIMEOUT_MS = 12_000

// Fetch JSON from Pancake with retry/backoff on transient failures.
// 429 / 5xx / network / timeout → retry up to `retries` with backoff (genuinely transient).
// 403 → retry only ONCE with a short delay: it's usually a real bad/invalid key (which never
//   recovers), so we fail FAST so dead-key pages don't stall the UI by ~2s; the single quick
//   retry still covers the rarer case where Pancake throttles with a 403.
async function fetchPancakeJSON(url: string, retries = 2): Promise<{ ok: boolean; status: number; json: any }> {
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(REQ_TIMEOUT_MS) })
    } catch {
      // Kasama na rito ang TimeoutError — sinusubukan ulit, hindi hinihintay.
      if (attempt < retries) { await sleep(350 * (attempt + 1)); continue }
      return { ok: false, status: 0, json: null }  // network failure / timeout
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(450 * (attempt + 1)); continue
    }
    if (res.status === 403 && attempt < 1) {
      await sleep(300); continue  // one quick retry only
    }
    let json: any = null
    try { json = await res.json() } catch { /* non-JSON body */ }
    return { ok: res.ok, status: res.status, json }
  }
}

type ConnErr = { status: number; code: string; error: string }

// Classify a failed Pancake response into a precise, user-facing error. Message-first so a 403
// caused by throttling isn't mislabeled "API Key Invalid" — only a genuine key message is.
function classifyConn(status: number, message: string): ConnErr {
  const msg = (message || "").toLowerCase()
  if (msg.includes("api_key") || msg.includes("api key") || msg.includes("unauthor") || msg.includes("token") || status === 401) {
    return { status: 401, code: "API_KEY_INVALID", error: "API Key Invalid — the API key/token was rejected. Check it in Pages & Store." }
  }
  if (status === 404 || msg.includes("not found") || msg.includes("shop")) {
    return { status: 404, code: "STORE_NOT_CONNECTED", error: "Store / Page Not Connected — check the Shop ID / Page ID in Pages & Store." }
  }
  if (status === 429 || msg.includes("rate") || msg.includes("too many") || msg.includes("limit")) {
    return { status: 503, code: "RATE_LIMITED", error: "Rate limit hit — too many requests to Pancake. Click Refresh to retry in a moment." }
  }
  if (status === 403) {
    // 403 WITHOUT a key message is usually throttling/forbidden, not an invalid key
    return { status: 503, code: "API_REQUEST_FAILED", error: "API Request Failed — Pancake rejected the request (HTTP 403, possibly throttling). Click Refresh." }
  }
  return { status: 502, code: "API_REQUEST_FAILED", error: `API Request Failed — ${message || "unexpected response from Pancake POS"}.` }
}

// Fields the Sales Tracker actually uses — passed as `fields[]` to shrink the order payload.
const ROW_FIELDS = [
  "id", "items", "shipping_address", "bill_full_name", "bill_phone_number",
  "total_price", "cod", "partner_fee", "shipping_fee", "partner",
  "status", "status_name", "inserted_at", "created_at", "partner_inserted_at", "bank_payments",
  "updated_at", "last_update_status_at",  // for the Parcel Update column (latest status change)
  "time_send_partner",                    // Shipped Out date (time sent to courier)
  "tags", "last_editor", "marketer", "creator",  // Verifier / Upsell By / Retention By / Reserve Date
  "note",                                 // order note → Remarks (Fulfillment View Order)
]

// ─────────────────────────────────────────────────────────────────────────────
// SCALE GUARD — 100× na halaga mula sa Pancake
//
// ANG NAPATUNAYAN (Ago 4 2026, Velora Care shop 1943085268): mula ~8PM Ago 3,
// ang mga order na na-import ay nagbabalik ng `cod`/`total_price`/item
// `retail_price` na 100× ng TOTOONG presyo — habang TAMA ang ipinapakita ng
// Pancake POS UI (₱499). Halimbawa: order 7587616424174 → API 49900, POS ₱499.
// Ang mga order bago ang oras na iyon ay 499 sa API (tugma). Kaya nagbago ang
// paraan ng pag-imbak, HINDI ang presyo — at ang POS ang tama.
//
// BAKIT SA PAGBASA AT HINDI SA PAGSULAT: ang pag-edit ng presyo sa Pancake ay
// mapanganib (mababago ang totoong halagang isinisingil) at binabawi rin ng
// sync. Dito lang sa pagbasa ginagawa ang pagtutuwid — walang isinusulat.
//
// KUNG BAKIT ITEM PRICE ANG BASEHAN, HINDI ANG TOTAL: ang tunay na malaking
// order (30 × ₱499 = ₱14,970) ay may item price na 499 pa rin, kaya hindi ito
// mahahawakan. 100× lang ang UNIT price kapag sira — iyon ang matibay na tanda.
// Ang /100 ay dapat ding makatwirang presyo (₱50–₱5,000) para sa tindahang ito.
// ─────────────────────────────────────────────────────────────────────────────
const SCALE = 100
function unitLooksScaled(unitPrice: number): boolean {
  return unitPrice >= 10000 && unitPrice % SCALE === 0
    && unitPrice / SCALE >= 50 && unitPrice / SCALE <= 5000
}
/** May 100×-na-unit-price ba ang order? Kapag oo, hatiin ang LAHAT ng pera nito. */
function orderIsScaled(o: any): boolean {
  const items: any[] = Array.isArray(o?.items) ? o.items : []
  if (items.length === 0) return false
  const units = items
    .map(it => Number(it?.variation_info?.retail_price ?? it?.retail_price ?? 0))
    .filter(p => p > 0)
  // Lahat ng unit price ay dapat mukhang scaled — kung hali-halo, huwag hulaan.
  return units.length > 0 && units.every(unitLooksScaled)
}
const descale = (v: any, scaled: boolean) => scaled ? Number(v ?? 0) / SCALE : Number(v ?? 0)

// Courier `partner.partner_status` → readable Parcel Status label (verified courier sub-statuses).
const PARTNER_STATUS_LABEL: Record<string, string> = {
  on_the_way: "In-Transit",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  returning: "Returning",
  returned: "Returned",
  undeliverable: "Problematic",
  picked_up: "Picked Up",
}

// Map a raw Pancake order object → the Sales Tracker row shape. Field names verified against the
// Pancake OpenAPI spec. page_name/platform are filled in by the client (it knows which page it
// requested). Uncertain fields use defensive fallbacks: real value if present, else "" (never faked).
// Convert a Pancake UTC timestamp → Philippine (UTC+8) calendar date "YYYY-MM-DD".
// Row dates MUST use the same PH basis as the server's date-window filter (toUnix). Otherwise
// orders created 12am–8am PH (whose UTC date is the previous day) get dropped by the Sales
// Tracker's client-side order_date filter — the cause of "Today" showing fewer orders than Pancake.
function toPHDate(raw: string): string {
  if (!raw) return ""
  const utcMs = new Date(raw.includes("Z") ? raw : raw + "Z").getTime()
  if (isNaN(utcMs)) return raw.slice(0, 10)
  const ph = new Date(utcMs + 8 * 60 * 60 * 1000)
  return `${ph.getUTCFullYear()}-${String(ph.getUTCMonth() + 1).padStart(2, "0")}-${String(ph.getUTCDate()).padStart(2, "0")}`
}

// Full PH (UTC+8) timestamp "YYYY-MM-DD HH:mm:ss" — for the Fulfillment View Order history card.
function toPHDateTime(raw: string): string {
  if (!raw) return ""
  const utcMs = new Date(raw.includes("Z") ? raw : raw + "Z").getTime()
  if (isNaN(utcMs)) return raw.slice(0, 19).replace("T", " ")
  return new Date(utcMs + 8 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ")
}

function mapOrderRow(o: any) {
  const items: any[] = Array.isArray(o?.items) ? o.items : []
  const totalQty = items.reduce((s, it) => s + Number(it?.quantity || 0), 0)
  const orderItem = items
    .map(it => `${it?.quantity || 0}x ${it?.variation_info?.name ?? it?.product_name ?? "item"}`)
    .join(", ")
  // Parcel Qty = number of DIFFERENT products in the order (distinct product names), not total units.
  const distinctProducts = new Set(
    items.map(it => String(it?.variation_info?.name ?? it?.product_name ?? "").trim().toLowerCase()).filter(Boolean)
  ).size
  const ship = o?.shipping_address || {}
  const partner = o?.partner || {}
  const inserted = String(o?.inserted_at || o?.created_at || "")
  // Shipped Out = time the order was sent to the courier. `time_send_partner` is the authoritative
  // response field (verified in spec); fall back to courier pickup / partner timestamps.
  const shippedOut = String(o?.time_send_partner || partner?.picked_up_at || o?.partner_inserted_at || partner?.inserted_at || "")
  // 100×-na-halaga mula sa Pancake → itutuwid sa pagbasa (tingnan ang SCALE guard).
  const scaled = orderIsScaled(o)
  const cod = descale(o?.cod, scaled)

  // Parcel Update = most recent parcel/courier status-change timestamp. Take the latest of the
  // dedicated `last_update_status_at`, any courier `partner.extend_update[].update_at`, falling
  // back to `updated_at`. Shown as "YYYY-MM-DD HH:mm"; "Not Available" if none.
  let lastStatusAt = String(o?.last_update_status_at || "")
  const extUpdates: any[] = Array.isArray(partner?.extend_update) ? partner.extend_update : []
  for (const e of extUpdates) {
    const t = String(e?.update_at || e?.updated_at || "")
    if (t > lastStatusAt) lastStatusAt = t
  }
  if (!lastStatusAt) lastStatusAt = String(o?.updated_at || partner?.updated_at || "")
  const parcelUpdate = lastStatusAt ? lastStatusAt.slice(0, 16).replace("T", " ") : "Not Available"

  // Parcel Status = courier/shipping status (separate from the order process status). Prefer the
  // proven `partner.partner_status`, then the latest courier `extend_update[].status`, then fall
  // back to "Shipped Out" if the order is shipped (status 2) but the courier hasn't reported yet.
  const partnerStatus = String(partner?.partner_status || "")
  let parcelStatus = PARTNER_STATUS_LABEL[partnerStatus] || ""
  if (!parcelStatus && extUpdates.length) {
    let latestAt = "", latestStatus = ""
    for (const e of extUpdates) {
      const t = String(e?.update_at || e?.updated_at || "")
      if (t >= latestAt) { latestAt = t; latestStatus = String(e?.status || "") }
    }
    if (latestStatus) parcelStatus = PARTNER_STATUS_LABEL[latestStatus] || latestStatus
  }
  if (!parcelStatus) parcelStatus = Number(o?.status) === 2 ? "Shipped Out" : "Not Available"

  // Tag-driven fields (Verifier / Upsell By / Reserve Date). Pancake tags officially expose only
  // {id, name}; we DEFENSIVELY read per-tag editor/timestamp if the live response includes them
  // (the documented schema is incomplete). When absent we fall back to the order's last_editor for
  // the name, and leave the reserve date blank rather than inventing one.
  const tags: any[] = Array.isArray(o?.tags) ? o.tags : []
  const findTag = (kw: string) => tags.find(t => String(t?.name || "").toLowerCase().includes(kw))
  const lastEditor = String(o?.last_editor?.name || "")
  const tagEditor = (t: any) => String(t?.editor?.name || t?.created_by?.name || t?.creator?.name || "")
  const tagDate = (t: any) => String(t?.inserted_at || t?.created_at || t?.updated_at || "").slice(0, 10)

  const verifiedTag  = findTag("verif")     // "Verified"
  const upsellTag    = findTag("upsell")    // "Upsell"
  const reserveTag   = findTag("reserv")    // "Reserve" / "Reserved"
  const retentionTag = findTag("retention") // "Retention"

  const verifierName = verifiedTag ? (tagEditor(verifiedTag) || lastEditor) : ""
  // Upsell By = the staff who updated the order (tag editor if exposed, else last_editor)
  const upsellByName = upsellTag ? (tagEditor(upsellTag) || lastEditor) : ""
  // Retention By = creator of the order when it has a Retention tag (the encoding staff).
  // Fall back to tag editor / last_editor if creator name is absent.
  const creator = String(o?.creator?.name || "")
  const retentionByName = retentionTag ? (creator || tagEditor(retentionTag) || lastEditor) : ""
  const reserveDate = reserveTag ? tagDate(reserveTag) : ""

  return {
    id: String(o?.id ?? ""),
    customer_name: ship.full_name || o?.bill_full_name || "",
    address: ship.full_address || ship.address || "",
    // province/city/barangay come back as IDs; readable names need a geo lookup (follow-up).
    // The readable location is already inside `address` (full_address).
    province: ship.province_name || "",
    city: ship.district_name || "",
    barangay: ship.commune_name || "",
    zip_code: ship.post_code || ship.postcode || ship.zip_code || "",
    contact_no: ship.phone_number || o?.bill_phone_number || "",
    order_item: orderItem,
    quantity: totalQty,
    parcel_qty: distinctProducts || "",   // # of different products in the order
    price_initial: descale(o?.total_price, scaled),
    shipping_fee: descale(o?.partner_fee ?? o?.shipping_fee, scaled),
    final_price: cod || descale(o?.total_price, scaled),
    // Nakikita sa Sales Tracker kung aling row ang itinuwid (para hindi tahimik).
    amount_rescaled: scaled,
    tracking_no: partner?.extend_code || partner?.tracking_id || "",
    // Courier name only (trimmed) — never a raw numeric partner_id, so the filter dropdown stays
    // clean and its options match the table values exactly.
    courier: String(partner?.partner_name || partner?.name || "").trim(),
    parcel_status: parcelStatus,            // courier/shipping status
    order_status: o?.status_name || "",     // order process status (New, Confirmed, Shipped, …)
    encoded_date: toPHDate(inserted),
    shipped_out_date: toPHDate(shippedOut),
    date_added: toPHDate(inserted),
    parcel_update: parcelUpdate,
    mop: cod > 0 ? "COD" : (Array.isArray(o?.bank_payments) && o.bank_payments.length ? "Bank Transfer" : ""),
    // CSR = the staff who CREATED/encoded the order in Pancake (fallback: last editor). When no
    // user is detected (e.g. storefront/API-created orders with no staff encoder) → "System".
    // The user ID is tracked too (csr_id) for resolving names / the User ID tool.
    csr_name: creator || lastEditor || "System",
    csr_id: String(o?.creator?.id ?? o?.creator_id ?? o?.last_editor?.id ?? ""),
    // View Order history card (Fulfillment): who/when created + last edited, PH time.
    inserted_time: toPHDateTime(inserted),
    last_editor_name: lastEditor || creator || "",
    last_edit_time: toPHDateTime(String(o?.updated_at || "")),
    remarks: String(o?.note || "").trim(),   // Pancake order note → Remarks
    verifier_name: verifierName,    // staff who verified (when a Verified tag is present)
    upsell_by: upsellByName,        // staff who upsold (when an Upsell tag is present)
    retention_by: retentionByName,  // staff who encoded a retention order (when Retention tag present)
    reserve_date: reserveDate,      // date the Reserve tag was added (blank if not exposed)
    is_upsell: !!upsellTag,         // order has an Upsell tag → eligible for the upsell-delta calc
    // Courier timeline (Delivery Ops detail screen) — bawat status change ng courier na may
    // PH timestamp, pinakabago muna. `partner` ay nasa ROW_FIELDS na, kaya walang dagdag na cost.
    status_history: extUpdates
      .map(e => ({
        status: PARTNER_STATUS_LABEL[String(e?.status || "")] || String(e?.status || ""),
        at: toPHDateTime(String(e?.update_at || e?.updated_at || "")),
      }))
      .filter(h => h.status)
      .sort((a, b) => b.at.localeCompare(a.at)),
  }
}

// Fetch count + total COD value for a specific set of statuses (1 page — we only need totals/aggs).
// On failure returns zeros + an `error` so the caller can surface a precise connection error.
async function fetchStatusAgg(
  shop_id: string, api_key: string,
  statuses: number[], startTs: number | null, endTs: number | null,
  updateStatus: string
): Promise<{ count: number; sales: number; error?: { status: number; message: string } }> {
  const url = new URL(`${BASE}/shops/${shop_id}/orders`)
  url.searchParams.set("api_key", api_key)
  url.searchParams.set("page_size", "1")
  url.searchParams.set("page_number", "1")
  for (const s of statuses) url.searchParams.append("filter_status[]", String(s))
  if (startTs) url.searchParams.set("startDateTime", String(startTs))
  if (endTs) url.searchParams.set("endDateTime", String(endTs))
  if (startTs || endTs) url.searchParams.set("updateStatus", updateStatus)

  const { ok, status, json } = await fetchPancakeJSON(url.toString())
  if (!ok || json?.success === false) {
    return { count: 0, sales: 0, error: { status, message: String(json?.message ?? `HTTP ${status || "network error"}`) } }
  }
  return {
    // TAMA at awtoritatibo ang bilang: total_entries ito ng Pancake, hindi limitado ng pagination.
    count: Number(json?.total_entries ?? 0),
    // ⚠⚠ HUWAG IPAKITANG PERA ANG FIELD NA ITO. Server-side na buong-suma ito ng Pancake,
    // kaya HINDI kayang ituwid ng SCALE guard (kailangan ng per-order na item price para
    // malaman kung 100×). Kapag may kahit isang sirang order sa saklaw, sobrang taas nito —
    // NASUKAT (Ago 6 2026): ₱146,512 dito kumpara sa totoong ₱47,710 sa parehong 83 parcels,
    // dahil sa isang order na ₱998 na naka-imbak bilang ₱99,800.
    // Para sa halaga, gamitin ang `exact` ng phase=full — doon hawak ang bawat order.
    sales: Number(json?.aggs?.cod?.value ?? 0),
  }
}

/** Per-status na bilang + halaga, na-descale — galing sa pinaginate na order (hindi aggregate). */
function emptyExact() {
  return {
    totalOrders: 0, totalSales: 0,
    shipped: 0, shippedSales: 0,
    delivered: 0, deliveredSales: 0,
    returning: 0, returningSales: 0,
    returned: 0, returnedSales: 0,
    packaging: 0, packagingSales: 0,
    waiting: 0, waitingSales: 0,
    fulfilled: 0, fulfilledSales: 0,
    unfulfilled: 0, unfulfilledSales: 0,
    cancelled: 0, cancelledSales: 0,
    inTransit: 0, inTransitSales: 0,
    onDelivery: 0, onDeliverySales: 0,
    // Ipinapakita sa UI para hindi tahimik ang pagtutuwid ng 100× na halaga.
    rescaledOrders: 0, rescaledExcess: 0,
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const api_key = searchParams.get("api_key")
  const shop_id = searchParams.get("page_id")
  const from = searchParams.get("from")  // YYYY-MM-DD
  const to = searchParams.get("to")      // YYYY-MM-DD
  const basis = searchParams.get("basis") || "sales_order"  // which date the window applies to
  // phase: "fast" = cheap per-status aggregates only (headline cards, no pagination);
  //        "full" = pagination-derived data only (byDate + courier In-Transit/On-Delivery);
  //        "all"  = both in one response (default — used by ROAS tracker).
  const phase = searchParams.get("phase") || "all"
  // fields: limits the fast phase to a single cheap aggregate to cut request volume —
  //   "total" = only the all-orders count (for Today's Sales); "packaging" = only status 8
  //   (for Unfulfilled / Last Month). Empty = the full per-status set (default).
  const fields = searchParams.get("fields") || ""
  // status: nililimitahan ang FULL-phase pagination sa mga tiyak na order status (comma-separated).
  // Dahil dito, makukuha ang TAMANG (na-descale) na halaga ng isang status sa mahabang saklaw nang
  // hindi pinaginate ang lahat ng order — hal. status=8 para sa Packaging ng buong nakaraang buwan.
  const statusFilter = (searchParams.get("status") || "").split(",").map(s => s.trim()).filter(Boolean)
  const noCache = searchParams.get("nocache") === "1"
  const wantFast = phase === "fast" || phase === "all"
  const wantFull = phase === "full" || phase === "all"
  const wantRows = phase === "rows"  // return mapped individual order records (Sales Tracker)

  if (!api_key || !shop_id) {
    return NextResponse.json(
      { success: false, errorCode: "MISSING_CREDENTIALS", error: "Missing Credentials — add the API key and Page/Store ID in Pages & Store." },
      { status: 400 }
    )
  }

  // Cache key MUST include api_key — otherwise a changed/corrected key would be served another
  // key's cached data (the bug where fixing a bad key didn't reload). Only successful responses
  // are cached (failures return before the cache.set below), so a bad key never poisons the cache.
  const cacheKey = `${shop_id}|${api_key}|${from}|${to}|${basis}|${phase}|${fields}|${statusFilter.join("+")}`
  if (!noCache) {
    const hit = CACHE.get(cacheKey)
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
      return NextResponse.json({ ...hit.data, cached: true })
    }
  }

  // === Date basis → Pancake `updateStatus` value (verified against the Pancake POS OpenAPI spec) ===
  //   sales_order   → "inserted_at"        ("Order creation time")  — sales/marketing performance
  //   shipped_out   → "partner_inserted_at" ("Time sent to courier") — warehouse shipping output
  //   parcel_status → "-1"                  ("Last status update")   — courier/delivery performance
  // `updateStatus` is the param that selects which timestamp startDateTime/endDateTime filter on.
  const UPDATE_STATUS_BY_BASIS: Record<string, string> = {
    sales_order: "inserted_at",
    shipped_out: "partner_inserted_at",
    parcel_status: "-1",
  }
  const updateStatus = UPDATE_STATUS_BY_BASIS[basis] ?? "inserted_at"

  const startTs = from ? toUnix(from, false) : null
  const endTs = to ? toUnix(to, true) : null

  try {
    // === Pancake POS status mapping (verified against live shop UI, June 2026) ===
    // Primary `status` codes:
    //   0=new, 1=confirmed, 2=shipped, 3=delivered, 4=returning(For Return),
    //   5=returned, 6=canceled(Unfulfilled), 7=removed(excluded), 8=packaging, 11=restocking
    // Courier `partner.partner_status` (sub-status of shipped orders):
    //   on_the_way (In Transit), out_for_delivery (On Delivery), undeliverable, delivered, returning, returned
    // FAST: cheap per-status aggregates (headline + per-status cards). No pagination.
    // Which per-status aggregates to fetch. `fields` trims this to one call to cut request volume.
    const aggStatuses: number[][] =
      fields === "total" ? [[]] :
      fields === "packaging" ? [[8]] :
      [[2], [3], [4], [5], [6], [9], [8], []]  // shipped, delivered, returning, returned, cancelled, waiting, packaging, total
    const aggsPromise: Promise<Array<{ count: number; sales: number; error?: { status: number; message: string } }> | null> = wantFast
      ? Promise.all(aggStatuses.map(s => fetchStatusAgg(shop_id, api_key, s, startTs, endTs, updateStatus)))
      : Promise.resolve(null)

    // FULL: paginate all orders — needed for byDate breakdown AND courier sub-status tallies.
    // Fetch page 1 first to learn total_pages, then fetch the rest in PARALLEL (bounded
    // concurrency) instead of one-at-a-time — turns ~N sequential round-trips into ~1 + a
    // few parallel batches, the single biggest speed-up for date/filter changes.
    const ordersPromise: Promise<{ orders: any[]; truncated?: boolean; error?: ConnErr }> = (wantFull || wantRows)
      ? (async () => {
          const MAX_PAGES = 200
          const CONCURRENCY = wantRows ? 12 : 8  // more parallelism for the row pull (single page, lighter payload)

          const buildUrl = (pageNum: number) => {
            const url = new URL(`${BASE}/shops/${shop_id}/orders`)
            url.searchParams.set("api_key", api_key)
            url.searchParams.set("page_number", String(pageNum))
            url.searchParams.set("page_size", "100")
            if (startTs) url.searchParams.set("startDateTime", String(startTs))
            if (endTs) url.searchParams.set("endDateTime", String(endTs))
            if (startTs || endTs) url.searchParams.set("updateStatus", updateStatus)
            for (const s of statusFilter) url.searchParams.append("filter_status[]", s)
            url.searchParams.set("option_sort", "inserted_at_asc")
            // Sales Tracker only needs a subset of fields — request just those so Pancake returns
            // small order objects instead of the full (huge) record. Big transfer/parse savings.
            if (wantRows) {
              for (const f of ROW_FIELDS) url.searchParams.append("fields[]", f)
            }
            return url.toString()
          }

          const fetchPage = async (pageNum: number): Promise<{ items: any[]; totalPages: number; error?: ConnErr }> => {
            const { ok, status, json } = await fetchPancakeJSON(buildUrl(pageNum))
            if (!ok || json?.success === false) {
              return { items: [], totalPages: 1, error: classifyConn(status, String(json?.message ?? `HTTP ${status || "network error"}`)) }
            }
            return {
              items: Array.isArray(json?.data) ? json.data : [],
              totalPages: json?.total_pages ?? 1,
            }
          }

          // Page 1 tells us how many pages there are (and validates the connection)
          const first = await fetchPage(1)
          if (first.error) return { orders: [], error: first.error }

          const orders: any[] = [...first.items]
          const lastPage = Math.min(first.totalPages, MAX_PAGES)

          // Remaining pages in bounded-concurrency batches (later-page blips are tolerated)
          for (let start = 2; start <= lastPage; start += CONCURRENCY) {
            const batch: number[] = []
            for (let p = start; p < start + CONCURRENCY && p <= lastPage; p++) batch.push(p)
            const results = await Promise.all(batch.map(fetchPage))
            for (const r of results) orders.push(...r.items)
          }

          // Kapag lumampas sa MAX_PAGES, KULANG ang nakuha — kaya kulang din ang anumang
          // halagang kukwentahin dito. Ipinapaalam ito para may babala ang UI imbes na
          // tahimik na magpakita ng mas mababang benta.
          return { orders, truncated: first.totalPages > MAX_PAGES }
        })()
      : Promise.resolve({ orders: [] })

    const [aggs, ordersResult] = await Promise.all([aggsPromise, ordersPromise])

    // Surface a precise connection error from the authoritative calls instead of caching empty
    // data. (The all-status agg validates the fast phase; page 1 validates the full phase.)
    if (wantFast && aggs) {
      const totalAgg = aggs[aggs.length - 1]  // the all-status [] call
      if (totalAgg?.error) {
        const e = classifyConn(totalAgg.error.status, totalAgg.error.message)
        return NextResponse.json({ success: false, errorCode: e.code, error: e.error }, { status: e.status })
      }
    }
    if ((wantFull || wantRows) && ordersResult.error) {
      const e = ordersResult.error
      return NextResponse.json({ success: false, errorCode: e.code, error: e.error }, { status: e.status })
    }
    const allOrders = ordersResult.orders

    // Sales Tracker: return mapped individual order records (no aggregates needed).
    if (wantRows) {
      const resp = { success: true, phase, rows: allOrders.map(mapOrderRow) }
      CACHE.set(cacheKey, { ts: Date.now(), data: resp })
      return NextResponse.json(resp)
    }

    const response: any = { success: true, phase }

    if (wantFast && aggs) {
      const zeroCounts = {
        total: 0, shipped: 0, inTransit: 0, onDelivery: 0, delivered: 0,
        returning: 0, returned: 0, cancelled: 0, packaging: 0, fulfilled: 0, unfulfilled: 0,
      }
      if (fields === "total") {
        const totalAgg = aggs[0]
        response.statusCounts = { ...zeroCounts, total: totalAgg.count }
        response.statusSales = { ...zeroCounts, total: totalAgg.sales }
        response.totalOrders = totalAgg.count
        response.totalSales = totalAgg.sales
      } else if (fields === "packaging") {
        const pkg = aggs[0]
        response.statusCounts = { ...zeroCounts, packaging: pkg.count, unfulfilled: pkg.count }
        response.statusSales = { ...zeroCounts, packaging: pkg.sales, unfulfilled: pkg.sales }
      } else {
        const [shipped, delivered, returning, returned, cancelled, waitingPickup, packaging, totalAgg] = aggs
        // Unfulfilled = Packaging orders (status 8). Fulfilled = Delivered + Shipped + Waiting for Pickup.
        const unfulfilledCount = packaging.count
        const unfulfilledSales = packaging.sales
        const fulfilledCount = delivered.count + shipped.count + waitingPickup.count
        const fulfilledSales = delivered.sales + shipped.sales + waitingPickup.sales

        // inTransit/onDelivery are filled by the FULL phase below (0 in fast-only responses).
        response.statusCounts = {
          total: totalAgg.count, shipped: shipped.count, inTransit: 0, onDelivery: 0,
          delivered: delivered.count, returning: returning.count, returned: returned.count,
          cancelled: cancelled.count, packaging: packaging.count, fulfilled: fulfilledCount, unfulfilled: unfulfilledCount,
        }
        response.statusSales = {
          total: totalAgg.sales, shipped: shipped.sales, inTransit: 0, onDelivery: 0,
          delivered: delivered.sales, returning: returning.sales, returned: returned.sales,
          cancelled: cancelled.sales, packaging: packaging.sales, fulfilled: fulfilledSales, unfulfilled: unfulfilledSales,
        }
        response.totalOrders = totalAgg.count
        response.totalSales = totalAgg.sales
      }
    }

    if (wantFull) {
      // --- Courier sub-status tallies + EXACT per-status money -------------------------
      // Isang pagdaan lang: mahal ang orderIsScaled() (dinadaanan ang bawat item), kaya
      // minsan lang ito tinatawag kada order at pinagsasaluhan ng dalawang tally.
      //
      // BAKIT DITO KINUKUWENTA ANG PERA: ang mga aggregate ng Pancake (fetchStatusAgg) ay
      // suma nang server-side, kaya hindi maabot ng 100× na SCALE guard. Dito lang, kung
      // saan hawak natin ang bawat order, nagiging tama ang halaga.
      let inTransitCount = 0, inTransitSales = 0
      let onDeliveryCount = 0, onDeliverySales = 0
      const exact = emptyExact()
      for (const o of allOrders) {
        const isScaled = orderIsScaled(o)
        const cod = descale(o.cod, isScaled)
        if (isScaled) {
          exact.rescaledOrders++
          exact.rescaledExcess += Number(o?.cod ?? 0) - cod
        }

        const ps = o.partner?.partner_status
        if (ps === "on_the_way") { inTransitCount++; inTransitSales += cod }
        else if (ps === "out_for_delivery") { onDeliveryCount++; onDeliverySales += cod }

        // Ang kanselado ay HINDI kita — itinatabi, hindi ibinibilang sa Total Sales.
        // Kaparehong tuntunin ng byDate sa ibaba, kaya laging magkatugma ang card at ang
        // breakdown modal nito.
        const st = typeof o.status === "number" ? o.status : -1
        if (st === 6) { exact.cancelled++; exact.cancelledSales += cod; continue }

        exact.totalOrders++; exact.totalSales += cod
        if (st === 2) { exact.shipped++; exact.shippedSales += cod }
        else if (st === 3) { exact.delivered++; exact.deliveredSales += cod }
        else if (st === 4) { exact.returning++; exact.returningSales += cod }
        else if (st === 5) { exact.returned++; exact.returnedSales += cod }
        else if (st === 8) { exact.packaging++; exact.packagingSales += cod }
        else if (st === 9) { exact.waiting++; exact.waitingSales += cod }
      }
      // Fulfilled = Delivered + Shipped + Waiting for Pickup; Unfulfilled = Packaging (status 8).
      exact.fulfilled = exact.delivered + exact.shipped + exact.waiting
      exact.fulfilledSales = exact.deliveredSales + exact.shippedSales + exact.waitingSales
      exact.unfulfilled = exact.packaging
      exact.unfulfilledSales = exact.packagingSales

      // --- byDate aggregation for per-day ROAS breakdown ---
      const byDate: Record<string, {
        orders: number; sales: number; shipped: number
        inTransit: number; onDelivery: number; onDeliveryAmount: number
        returning: number; returned: number; delivered: number
        // Ang kanselado ay itinatabi, hindi binubura — para makita pa rin kung
        // gaano karami ang nawawala, at para may pagpipilian sa hinaharap.
        canceled: number; canceledSales: number; grossSales: number; grossOrders: number
      }> = {}

      // Pick the order timestamp matching the selected basis so the per-day breakdown
      // is grouped by the same date the server filtered on (with a safe fallback).
      function basisRaw(order: any): string {
        if (basis === "shipped_out") {
          return order.time_send_partner || order.partner?.picked_up_at || order.partner_inserted_at
            || order.partner?.inserted_at || order.inserted_at || order.created_at || ""
        }
        if (basis === "parcel_status") {
          return order.last_update_status_at || order.updated_at
            || order.inserted_at || order.created_at || ""
        }
        return order.inserted_at || order.created_at || ""
      }

      for (const order of allOrders) {
        const raw = basisRaw(order)
        if (!raw) continue

        const utcMs = new Date(raw.includes("Z") ? raw : raw + "Z").getTime()
        const phtMs = utcMs + 8 * 60 * 60 * 1000
        const phtDate = new Date(phtMs)
        const date = `${phtDate.getUTCFullYear()}-${String(phtDate.getUTCMonth() + 1).padStart(2, "0")}-${String(phtDate.getUTCDate()).padStart(2, "0")}`

        if (!byDate[date]) {
          byDate[date] = {
            orders: 0, sales: 0, shipped: 0, inTransit: 0, onDelivery: 0, onDeliveryAmount: 0,
            returning: 0, returned: 0, delivered: 0,
            canceled: 0, canceledSales: 0, grossSales: 0, grossOrders: 0,
          }
        }

        const statusNum = typeof order.status === "number" ? order.status : -1
        // Parehong scale guard ng mapOrderRow — kung hindi, magkaiba ang table at report.
        const cod = descale(order.cod, orderIsScaled(order))
        const isCanceled = statusNum === 6

        // ── BAKIT HINDI KASAMA ANG KANSELADO SA `sales` ──────────────────────
        // Dating ang LAHAT ng order ay binibilang, para tumugma sa `aggs.cod.value`
        // ng Pancake dashboard. Pero ang kanselado ay HINDI kita — wala nang
        // kinokolekta doon. Sa buong Ene–Ago 2026, ₱2.15M (11.4%) ng "sales" ay
        // kanselado, kaya palaging mataas nang mali ang ROAS. Isang kanseladong
        // order lang na may maling presyo (₱49,900) ang nagpalabas ng ROAS 59
        // sa Velora Care nitong Ago 4 2026 — doon ito nahuli.
        // Nananatili ang `grossSales`/`canceledSales` para hindi mawala ang datos
        // at para may maihambing pa rin sa Pancake dashboard.
        byDate[date].grossOrders += 1
        byDate[date].grossSales += cod
        if (isCanceled) {
          byDate[date].canceled += 1
          byDate[date].canceledSales += cod
        } else {
          byDate[date].orders += 1
          byDate[date].sales += cod
        }

        const ps = order.partner?.partner_status
        if (statusNum === 2) byDate[date].shipped += 1
        else if (statusNum === 3) byDate[date].delivered += 1
        else if (statusNum === 4) byDate[date].returning += 1
        else if (statusNum === 5) byDate[date].returned += 1
        if (ps === "on_the_way") byDate[date].inTransit += 1
        else if (ps === "out_for_delivery") { byDate[date].onDelivery += 1; byDate[date].onDeliveryAmount += cod }
      }

      response.byDate = byDate
      response.courier = { inTransitCount, inTransitSales, onDeliveryCount, onDeliverySales }
      exact.inTransit = inTransitCount; exact.inTransitSales = inTransitSales
      exact.onDelivery = onDeliveryCount; exact.onDeliverySales = onDeliverySales
      response.exact = exact
      response.truncated = !!ordersResult.truncated

      // When phase=all, merge courier tallies into statusCounts/Sales so the response
      // keeps its original full shape (the ROAS tracker relies on this).
      if (response.statusCounts) {
        response.statusCounts.inTransit = inTransitCount
        response.statusCounts.onDelivery = onDeliveryCount
        response.statusSales.inTransit = inTransitSales
        response.statusSales.onDelivery = onDeliverySales
      }
    }

    CACHE.set(cacheKey, { ts: Date.now(), data: response })
    return NextResponse.json(response)

  } catch (err: any) {
    return NextResponse.json(
      { success: false, errorCode: "DATA_SYNC_FAILED", error: "Data Sync Failed — " + (err?.message || "unexpected error while syncing orders.") },
      { status: 500 }
    )
  }
}
