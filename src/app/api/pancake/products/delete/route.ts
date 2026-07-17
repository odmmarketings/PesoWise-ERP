import { NextRequest, NextResponse } from "next/server"

// Delete product(s) on Pancake POS that match a unit code — called when a Unit Code is
// deleted in PesoWise so the pushed product is removed from the POS too.
// POST body: { api_key, page_id (shop id), code }
// Matching: product name OR custom_id === code (case-insensitive). The Pancake product id
// is not stored locally, so we look it up fresh (no cache) before deleting.
const BASE = "https://pos.pages.fm/api/v1"

export async function POST(req: NextRequest) {
  let body: any = {}
  try { body = await req.json() } catch {}
  const { api_key, page_id, code } = body
  if (!api_key || !page_id || !code) {
    return NextResponse.json({ success: false, error: "Missing api_key / page_id / code" }, { status: 400 })
  }
  const k = encodeURIComponent(api_key)
  const shop = encodeURIComponent(page_id)
  const want = String(code).trim().toLowerCase()

  try {
    // 1) fresh product list → find matches by name / custom_id
    const listRes = await fetch(`${BASE}/shops/${shop}/products?api_key=${k}&page_size=200&page_number=1`, { cache: "no-store" })
    const listJson: any = await listRes.json().catch(() => null)
    if (!listRes.ok || listJson?.success === false) {
      return NextResponse.json({ success: false, error: `Lookup failed — HTTP ${listRes.status}` }, { status: 502 })
    }
    const prods: any[] = listJson?.data || listJson?.products || []
    const matches = prods.filter(p =>
      String(p.name || "").trim().toLowerCase() === want ||
      String(p.custom_id || "").trim().toLowerCase() === want
    )
    if (matches.length === 0) return NextResponse.json({ success: true, deleted: 0, note: "No matching product on Pancake." })

    // 2) delete each match — try DELETE, then POST/PUT { is_removed: true } (deployments differ)
    let deleted = 0
    const errs: string[] = []
    for (const p of matches) {
      const id = encodeURIComponent(p.id || p.product_id)
      const attempts: Array<{ m: string; body?: any }> = [
        { m: "DELETE" },
        { m: "POST", body: { is_removed: true } },
        { m: "PUT", body: { is_removed: true } },
        { m: "POST", body: { product: { is_removed: true } } },
      ]
      let ok = false, lastDetail = ""
      for (const a of attempts) {
        const res = await fetch(`${BASE}/shops/${shop}/products/${id}?api_key=${k}`, {
          method: a.m,
          headers: a.body ? { "Content-Type": "application/json" } : undefined,
          body: a.body ? JSON.stringify(a.body) : undefined,
          cache: "no-store",
        })
        const raw = await res.text().catch(() => "")
        let json: any = null; try { json = JSON.parse(raw) } catch {}
        if (res.ok && json?.success !== false) { ok = true; break }
        lastDetail = `${a.m} → ${String(json?.message || json?.reason || raw || res.status).slice(0, 120)}`
        if (res.status === 401 || res.status === 403) break   // auth problem — other methods won't help
      }
      if (ok) deleted++
      else errs.push(`${p.name}: ${lastDetail}`)
    }
    if (deleted === 0 && errs.length) return NextResponse.json({ success: false, error: errs[0] }, { status: 502 })
    return NextResponse.json({ success: true, deleted, ...(errs.length ? { partialErrors: errs } : {}) })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: "Failed to delete product — " + (err?.message || "network error") }, { status: 500 })
  }
}
