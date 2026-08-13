import { NextRequest, NextResponse } from "next/server"

// Server-side proxy for the Meta (Facebook) Marketing API — keeps the token off the client.
// Modes (all need ?token=…):
//   list=1                                   → ad accounts on the token
//   meta=1&account_id                        → account_status (status auto-sync)
//   account_id&from&to                       → { byDate, total } daily account spend (adspent sync)
//   rich=1&account_id&from&to                → per-campaign rich metrics (cards/charts/table/ads-mgr)
//   trend=1&account_id&from&to               → daily { date, spend, sales } (ROAS trend)
//   tree=adsets&parent=<campaign_id>&from&to → ad sets of a campaign
//   tree=ads&parent=<adset_id>&from&to       → ads of an ad set
const V = "v21.0"
const BASE = `https://graph.facebook.com/${V}`

type CacheEntry = { ts: number; data: any }
const CACHE = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60_000

// Kaparehong dahilan ng timeout sa Pancake route: kapag walang hangganan ang isang
// request, ang isang naka-stall na tawag ay kinakain ang buong budget ng client at
// nagiging "timeout" ang buong page. Sumusuko agad at sumusubok muli.
const REQ_TIMEOUT_MS = 12_000
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function fbGet(path: string, retries = 2): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(`${BASE}/${path}`, { cache: "no-store", signal: AbortSignal.timeout(REQ_TIMEOUT_MS) })
    } catch (e: any) {
      if (attempt < retries) { await sleep(350 * (attempt + 1)); continue }
      throw new Error(e?.name === "TimeoutError" ? `Graph API timeout after ${REQ_TIMEOUT_MS / 1000}s` : "Graph API network error")
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(450 * (attempt + 1)); continue
    }
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json.error) throw new Error(json?.error?.message || `Graph API error (${res.status})`)
    return json
  }
}

// Pull metrics from the actions / action_values / purchase_roas arrays. We use the OMNI
// totals (website + Meta) so the numbers match Ads Manager's headline columns, plus the
// website/Meta breakdowns and the native purchase_roas field.
function parseActions(actions: any[], values: any[], roasArr: any[] = []) {
  const get = (arr: any[], ...types: string[]) => { for (const t of types) { const v = (arr || []).find((a: any) => a.action_type === t); if (v) return Number(v.value || 0) } return 0 }
  return {
    purchases: get(actions, "omni_purchase", "purchase"),
    websitePurchases: get(actions, "offsite_conversion.fb_pixel_purchase", "web_purchase"),
    metaPurchases: get(actions, "onsite_conversion.purchase", "onsite_web_purchase"),
    purchaseValue: get(values, "omni_purchase", "purchase"),
    addToCart: get(actions, "omni_add_to_cart", "add_to_cart"),
    initiateCheckout: get(actions, "omni_initiated_checkout", "initiate_checkout"),
    contentViews: get(actions, "omni_view_content", "view_content"),
    linkClicks: get(actions, "link_click"),
    messaging: get(actions, "onsite_conversion.messaging_conversation_started_7d", "onsite_conversion.total_messaging_connection"),
    video3s: get(actions, "video_view"),   // "3-second video plays"
    purchaseRoas: get(roasArr, "omni_purchase", "purchase"),
  }
}
const cents = (v: any) => Number(v || 0) / 100

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const token = sp.get("token") || ""
  if (!token) return NextResponse.json({ success: false, error: "Missing token" }, { status: 400 })
  const enc = encodeURIComponent(token)
  const accountId = sp.get("account_id") || ""

  try {
    if (sp.get("list")) {
      const json = await fbGet(`me/adaccounts?fields=name,account_id,account_status,currency,amount_spent&limit=200&access_token=${enc}`)
      const accounts = (json.data || []).map((a: any) => ({ id: a.id, account_id: a.account_id, name: a.name, status: a.account_status, currency: a.currency, amount_spent: cents(a.amount_spent) }))
      return NextResponse.json({ success: true, accounts })
    }

    if (sp.get("meta")) {
      if (!accountId) return NextResponse.json({ success: false, error: "Missing account_id" }, { status: 400 })
      const j = await fbGet(`${accountId}?fields=account_status,name,currency&access_token=${enc}`)
      return NextResponse.json({ success: true, account_status: j.account_status, name: j.name, currency: j.currency })
    }

    // ── Funding source (payment method) — display_string tulad ng "VISA *9850" (FB Billing) ─
    if (sp.get("funding")) {
      if (!accountId) return NextResponse.json({ success: false, error: "Missing account_id" }, { status: 400 })
      const j = await fbGet(`${accountId}?fields=name,funding_source_details&access_token=${enc}`)
      const d = j.funding_source_details || {}
      const display = String(d.display_string || "")
      const last4 = (display.match(/(\d{4})\s*$/) || [])[1] || ""
      return NextResponse.json({ success: true, display, last4, type: d.type ?? null })
    }

    // ── Ad preview: rendered ad iframe (video/creative/caption/headline) per placement format ─
    if (sp.get("preview")) {
      const adId = sp.get("ad_id") || ""
      const fmt = sp.get("format") || "MOBILE_FEED_STANDARD"
      if (!adId) return NextResponse.json({ success: false, error: "Missing ad_id" }, { status: 400 })
      const j = await fbGet(`${adId}/previews?ad_format=${encodeURIComponent(fmt)}&access_token=${enc}`)
      return NextResponse.json({ success: true, body: j.data?.[0]?.body || "" })
    }

    const from = sp.get("from") || "", to = sp.get("to") || ""
    if (!accountId || !from || !to) return NextResponse.json({ success: false, error: "Missing account_id / from / to" }, { status: 400 })
    const tr = encodeURIComponent(JSON.stringify({ since: from, until: to }))
    // Match Ads Manager's default attribution (7-day click + 1-day view) so numbers line up.
    const attr = `&action_attribution_windows=${encodeURIComponent(JSON.stringify(["7d_click", "1d_view"]))}`
    const tokenKey = token.slice(-12)
    const cached = (k: string) => { const h = CACHE.get(k); return h && Date.now() - h.ts < CACHE_TTL_MS && !sp.get("nocache") ? h.data : null }

    // ── Daily series per ad set — pinagbabatayan ng Scaling Tracker ──────────
    // Isang tawag = 30 araw × bawat ad set, para makwenta ang streak ("3-5 araw
    // na ≥3.9"), ang mga window (3/7/15/30), at ang kill rules nang hindi
    // tumatawag kada window. Hindi kasama ang frequency/reach — hindi iyon
    // ma-a-aggregate mula sa daily rows (dedup ng reach); sa fatigue check
    // (rich level=ad) iyon nakukuha nang tama mula kay Meta mismo.
    if (sp.get("series")) {
      const ck = `series|adset|${accountId}|${from}|${to}|${tokenKey}`
      const c = cached(ck); if (c) return NextResponse.json({ success: true, rows: c, cached: true })
      const fields = `adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,actions,action_values`
      let url = `${accountId}/insights?level=adset&fields=${fields}&time_range=${tr}&time_increment=1${attr}&limit=500&access_token=${enc}`
      const rows: any[] = []
      while (url) {
        const j = await fbGet(url)
        for (const r of j.data || []) {
          const a = parseActions(r.actions, r.action_values, undefined)
          rows.push({
            id: r.adset_id, name: r.adset_name, campaignId: r.campaign_id, campaignName: r.campaign_name,
            date: r.date_start, spend: Number(r.spend || 0),
            impressions: Number(r.impressions || 0), clicks: Number(r.clicks || 0),
            purchases: a.purchases, purchaseValue: a.purchaseValue,
          })
        }
        url = j.paging?.next ? j.paging.next.replace(`${BASE}/`, "") : ""
      }
      CACHE.set(ck, { ts: Date.now(), data: rows })
      return NextResponse.json({ success: true, rows })
    }

    // ── Rich metrics at any level (campaign / adset / ad) for dashboard + Ads Manager ─
    if (sp.get("rich")) {
      const level = (sp.get("level") || "campaign") as "campaign" | "adset" | "ad"
      const parent = sp.get("parent") || accountId // accountId for campaign, campaign_id for adset, adset_id for ad
      const idF = level === "ad" ? "ad_id" : level === "adset" ? "adset_id" : "campaign_id"
      const nameF = level === "ad" ? "ad_name" : level === "adset" ? "adset_name" : "campaign_name"
      const edge = level === "ad" ? "ads" : level === "adset" ? "adsets" : "campaigns"
      const insightsHost = level === "campaign" ? accountId : parent
      const metaHost = level === "campaign" ? accountId : parent
      const ck = `rich|${level}|${parent}|${from}|${to}|${tokenKey}`
      const c = cached(ck); if (c) return NextResponse.json({ success: true, rows: c, campaigns: c, cached: true })

      // Pull parent ids from insights too — so cross-level filtering survives even if the
      // meta edge call gets rate-limited (#17).
      const parentF = level === "ad" ? ",campaign_id,adset_id" : level === "adset" ? ",campaign_id" : ""
      // Ad-only extras: 100% video plays + Meta's quality / engagement rankings (ad-level fields).
      const adF = level === "ad" ? ",video_p100_watched_actions,quality_ranking,engagement_rate_ranking" : ""
      const fields = `${idF},${nameF}${parentF}${adF},spend,impressions,reach,clicks,ctr,cpc,cpm,inline_link_clicks,inline_link_click_ctr,frequency,video_avg_time_watched_actions,actions,action_values,purchase_roas`
      let url = `${insightsHost}/insights?level=${level}&fields=${fields}&time_range=${tr}${attr}&limit=500&access_token=${enc}`
      const byId: Record<string, any> = {}
      while (url) { const j = await fbGet(url); for (const r of j.data || []) byId[r[idF]] = r; url = j.paging?.next ? j.paging.next.replace(`${BASE}/`, "") : "" }

      const metaFields = level === "ad" ? "id,name,status,effective_status,created_time,updated_time,adset_id,campaign_id,creative{thumbnail_url}"
        : level === "adset" ? "id,name,status,effective_status,daily_budget,lifetime_budget,bid_strategy,optimization_goal,created_time,updated_time,campaign_id"
          : "id,name,status,effective_status,objective,daily_budget,lifetime_budget,bid_strategy,created_time,updated_time"
      const meta: Record<string, any> = {}
      try { const m = await fbGet(`${metaHost}/${edge}?fields=${metaFields}&limit=500&access_token=${enc}`); for (const x of m.data || []) meta[x.id] = x } catch {}

      // ABO campaigns hold budget on the ad sets — sum so campaign budget isn't 0.
      const adsetActive: Record<string, number> = {}, adsetAll: Record<string, number> = {}
      if (level === "campaign") {
        try {
          const as = await fbGet(`${accountId}/adsets?fields=campaign_id,daily_budget,lifetime_budget,effective_status&limit=500&access_token=${enc}`)
          for (const s of as.data || []) { const b = cents(s.daily_budget) || cents(s.lifetime_budget); if (!b) continue; adsetAll[s.campaign_id] = (adsetAll[s.campaign_id] || 0) + b; if (/active/i.test(s.effective_status)) adsetActive[s.campaign_id] = (adsetActive[s.campaign_id] || 0) + b }
        } catch {}
      }
      // Include objects that exist but had no spend in range.
      for (const id of Object.keys(meta)) if (!byId[id]) byId[id] = { [idF]: id, [nameF]: meta[id].name }

      const rows = Object.values(byId).map((r: any) => {
        const id = r[idF]; const m = meta[id] || {}
        const a = parseActions(r.actions, r.action_values, r.purchase_roas)
        const spend = Number(r.spend || 0)
        const ownDaily = cents(m.daily_budget), ownLife = cents(m.lifetime_budget)
        const ownBudget = ownDaily || ownLife
        return {
          id, name: r[nameF] || m.name, status: m.effective_status || "—", configuredStatus: m.status || m.effective_status || "", objective: m.objective || "",
          budget: level === "campaign" ? (ownBudget || adsetActive[id] || adsetAll[id] || 0) : (level === "adset" ? ownBudget : 0),
          // ownBudget = this object's own budget (0 → inherits from campaign/ad sets). budgetKind = daily|lifetime.
          ownBudget, budgetKind: ownDaily ? "daily" : ownLife ? "lifetime" : "",
          bidStrategy: m.bid_strategy || "", optimizationGoal: m.optimization_goal || "",
          createdTime: m.created_time || "", updatedTime: m.updated_time || "",
          campaignId: m.campaign_id || r.campaign_id || "", adsetId: m.adset_id || r.adset_id || "",
          thumbnail: m.creative?.thumbnail_url || "",
          spend, impressions: Number(r.impressions || 0), reach: Number(r.reach || 0), clicks: Number(r.clicks || 0),
          ctr: Number(r.ctr || 0), cpc: Number(r.cpc || 0), cpm: Number(r.cpm || 0), inlineLinkClicks: Number(r.inline_link_clicks || 0),
          linkCtr: Number(r.inline_link_click_ctr || 0), frequency: Number(r.frequency || 0),
          videoAvgPlay: Number((r.video_avg_time_watched_actions || [])[0]?.value || 0),
          videoP100: Number((r.video_p100_watched_actions || [])[0]?.value || 0),
          qualityRanking: r.quality_ranking || "", engagementRanking: r.engagement_rate_ranking || "",
          ...a,
        }
      }).sort((x: any, y: any) => y.spend - x.spend)
      CACHE.set(ck, { ts: Date.now(), data: rows })
      return NextResponse.json({ success: true, rows, campaigns: rows })
    }

    // ── Daily trend (spend + sales) ─────────────────────────────────────────────
    if (sp.get("trend")) {
      const ck = `trend|${accountId}|${from}|${to}|${tokenKey}`
      const c = cached(ck); if (c) return NextResponse.json({ success: true, trend: c, cached: true })
      let url = `${accountId}/insights?fields=spend,action_values&level=account&time_increment=1&time_range=${tr}${attr}&limit=500&access_token=${enc}`
      const trend: { date: string; spend: number; sales: number }[] = []
      while (url) { const j = await fbGet(url); for (const r of j.data || []) { const a = parseActions([], r.action_values); trend.push({ date: r.date_start, spend: Number(r.spend || 0), sales: a.purchaseValue }) } url = j.paging?.next ? j.paging.next.replace(`${BASE}/`, "") : "" }
      CACHE.set(ck, { ts: Date.now(), data: trend })
      return NextResponse.json({ success: true, trend })
    }

    // ── Ad-set / Ad tree for the Ads Manager ────────────────────────────────────
    if (sp.get("tree")) {
      const parent = sp.get("parent") || ""
      const kind = sp.get("tree") // "adsets" | "ads"
      if (!parent) return NextResponse.json({ success: false, error: "Missing parent" }, { status: 400 })
      const edge = kind === "ads" ? "ads" : "adsets"
      const fields = kind === "ads" ? "id,name,effective_status" : "id,name,effective_status,daily_budget"
      const list = await fbGet(`${parent}/${edge}?fields=${fields}&limit=200&access_token=${enc}`)
      // spend per node
      const spendById: Record<string, number> = {}
      try {
        const ins = await fbGet(`${parent}/insights?level=${kind === "ads" ? "ad" : "adset"}&fields=${kind === "ads" ? "ad_id" : "adset_id"},spend&time_range=${tr}&limit=500&access_token=${enc}`)
        for (const r of ins.data || []) spendById[kind === "ads" ? r.ad_id : r.adset_id] = Number(r.spend || 0)
      } catch {}
      const nodes = (list.data || []).map((n: any) => ({ id: n.id, name: n.name, status: n.effective_status, budget: cents(n.daily_budget), spend: spendById[n.id] || 0 }))
      return NextResponse.json({ success: true, nodes })
    }

    // ── Default: daily account spend (adspent sync) ─────────────────────────────
    const ck = `${accountId}|${from}|${to}|${tokenKey}`
    const c = cached(ck); if (c) return NextResponse.json({ success: true, ...c, cached: true })
    let url = `${accountId}/insights?fields=spend&level=account&time_increment=1&time_range=${tr}&limit=500&access_token=${enc}`
    const byDate: Record<string, number> = {}; let total = 0
    while (url) { const j = await fbGet(url); for (const r of j.data || []) { byDate[r.date_start] = (byDate[r.date_start] || 0) + Number(r.spend || 0); total += Number(r.spend || 0) } url = j.paging?.next ? j.paging.next.replace(`${BASE}/`, "") : "" }
    const data = { byDate, total }
    CACHE.set(ck, { ts: Date.now(), data })
    return NextResponse.json({ success: true, ...data })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || "FB API error" }, { status: 502 })
  }
}
