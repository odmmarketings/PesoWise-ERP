import { NextRequest, NextResponse } from "next/server"

function toUnix(dateStr: string, endOfDay = false): number {
  const [y, m, d] = dateStr.split("-").map(Number)
  const offsetMs = 8 * 60 * 60 * 1000
  const utcMs = Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMs
  return Math.floor(utcMs / 1000) + (endOfDay ? 86399 : 0)
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const api_key = searchParams.get("api_key") || ""
  const shop_id = searchParams.get("shop_id") || ""
  const from = searchParams.get("from") || new Date().toISOString().split("T")[0]
  const to = searchParams.get("to") || from
  const probe = searchParams.get("probe") || ""

  // ── Probes for the send-to-courier integration ──
  if (probe === "partners") {
    // Which couriers are connected to this shop, and under what endpoint shape?
    const out: Record<string, any> = {}
    for (const path of [`shops/${shop_id}/partners`, `shops/${shop_id}/shipping_partners`, `partners`]) {
      try {
        const res = await fetch(`https://pos.pages.fm/api/v1/${path}?api_key=${encodeURIComponent(api_key)}`, { cache: "no-store" })
        const text = await res.text()
        out[path] = { status: res.status, body: text.slice(0, 2500) }
      } catch (e: any) { out[path] = { error: e?.message } }
    }
    return NextResponse.json(out)
  }
  if (probe === "raw_order") {
    // Shape of a real courier-booked order's `partner` object (drives the send payload design).
    const courier = (searchParams.get("courier") || "").toLowerCase()
    try {
      const res = await fetch(`https://pos.pages.fm/api/v1/shops/${shop_id}/orders?api_key=${encodeURIComponent(api_key)}&page_size=60&page_number=1`, { cache: "no-store" })
      const json: any = await res.json()
      const orders: any[] = json?.data || []
      const match = orders.find(o => String(o?.partner?.partner_name || "").toLowerCase().includes(courier))
      if (!match) return NextResponse.json({ found: false, couriers: orders.map(o => o?.partner?.partner_name).filter(Boolean).slice(0, 10) })
      return NextResponse.json({ found: true, id: match.id, status: match.status, status_name: match.status_name, partner: match.partner })
    } catch (e: any) { return NextResponse.json({ error: e?.message }) }
  }
  if (probe === "statuses") {
    // Distinct status/status_name pairs in recent orders (for the ORDER STATUS dropdown mapping).
    try {
      const res = await fetch(`https://pos.pages.fm/api/v1/shops/${shop_id}/orders?api_key=${encodeURIComponent(api_key)}&page_size=200&page_number=1`, { cache: "no-store" })
      const json: any = await res.json()
      const seen: Record<string, number> = {}
      for (const o of (json?.data || [])) seen[`${o?.status}|${o?.status_name}`] = (seen[`${o?.status}|${o?.status_name}`] || 0) + 1
      return NextResponse.json({ statuses: seen })
    } catch (e: any) { return NextResponse.json({ error: e?.message }) }
  }

  const results: Record<string, any> = {}

  async function tryUrl(label: string, url: string) {
    try {
      const res = await fetch(url, { cache: "no-store" })
      const text = await res.text()
      let json: any
      try { json = JSON.parse(text) } catch { json = null }
      results[label] = {
        status: res.status,
        total_entries: json?.total_entries,
        total_pages: json?.total_pages,
        page_size: json?.page_size,
        agg_cod: json?.aggs?.cod?.value,
        first_order_date: json?.data?.[0]?.inserted_at,
        json_sample: json ? { success: json.success, total_entries: json.total_entries, total_pages: json.total_pages, page_size: json.page_size } : "(HTML)",
      }
    } catch (e: any) {
      results[label] = { error: e?.message }
    }
  }

  const k = encodeURIComponent(api_key)
  const startTs = toUnix(from, false)
  const endTs = toUnix(to, true)

  await tryUrl(
    `GET /shops/${shop_id}/orders (no filter, page_size=100)`,
    `https://pos.pages.fm/api/v1/shops/${shop_id}/orders?api_key=${k}&page_size=100&page_number=1`
  )

  await tryUrl(
    `GET /shops/${shop_id}/orders (date=${from} to ${to}, unix ${startTs}-${endTs})`,
    `https://pos.pages.fm/api/v1/shops/${shop_id}/orders?api_key=${k}&page_size=100&page_number=1&startDateTime=${startTs}&endDateTime=${endTs}&updateStatus=inserted_at`
  )

  return NextResponse.json({ from, to, startTs, endTs, results })
}
