import { NextRequest, NextResponse } from "next/server"

// Send an order to a courier on Pancake POS (the "Send orders to courier" action).
//
// ANO ANG NANGYAYARI SA LOOB — mahalagang maintindihan bago baguhin ito:
//
// Ang pag-set lang ng `partner_id` sa order ay HINDI pagbo-book sa courier. Iyon
// ang dahilan ng lumang bug: nagpapalit ng status at lumalabas ang pangalan ng
// courier, pero walang waybill. Ang totoong senyales ng na-book na order ay ang
// `partner.service_partner` object (naglalaman ng deliver_info, parcel_info,
// fulfillment_info) at ang `partner.extend_code` (= tracking number). Kapag null
// ang dalawang iyon, hindi umabot sa SPX/J&T ang order.
//
// Dalawang bagay ang ginagawa nito na wala sa luma:
//   1. Ipinapasa ang PARTNER ACCOUNT ID. Ang bawat courier sa /shops/{id}/partners
//      ay may `accounts[]`; ang naka-connect lang ang may laman (SPX at J&T sa
//      account na ito). Kung walang account na tinukoy, hindi alam ng Pancake kung
//      saang courier account ibo-book. Hinahanap ito kada shop — magkaiba ang
//      account id kada page, kaya HUWAG i-hardcode.
//   2. Bine-verify pagkatapos. Muling kinukuha ang order at tinitingnan kung
//      totoong may service_partner/extend_code na. Kung wala, `booked: false` ang
//      isinasagot — hindi na nagsisinungaling ng tagumpay ang UI.
//
// POST body: { api_key, shop_id, order_id, partner_id, options?: { is_free_shipping?, is_dropoff?, note? } }
const BASE = "https://pos.pages.fm/api/v1"

/** Ang account id ng courier na ito sa shop na ito (null kung hindi konektado). */
async function partnerAccountId(shopId: string, apiKey: string, partnerId: number): Promise<number | null> {
  try {
    const res = await fetch(`${BASE}/shops/${encodeURIComponent(shopId)}/partners?api_key=${encodeURIComponent(apiKey)}`, { cache: "no-store" })
    if (!res.ok) return null
    const json: any = await res.json()
    const list: any[] = json?.data || []
    const p = list.find(x => Number(x?.id) === Number(partnerId))
    const acc = p?.accounts?.[0]?.id
    return acc != null ? Number(acc) : null
  } catch { return null }
}

/** Na-book na ba talaga? Ibinabalik ang tracking kung meron. */
async function readBooking(shopId: string, apiKey: string, orderId: string) {
  try {
    const res = await fetch(
      `${BASE}/shops/${encodeURIComponent(shopId)}/orders/${encodeURIComponent(orderId)}?api_key=${encodeURIComponent(apiKey)}`,
      { cache: "no-store" }
    )
    if (!res.ok) return null
    const json: any = await res.json()
    const o = json?.data || json || {}
    const pt = o?.partner || {}
    return {
      tracking: String(pt.extend_code || pt.tracking_id || ""),
      booked: !!pt.service_partner || !!pt.extend_code,
      status_name: String(o.status_name || ""),
      partner_status: String(pt.partner_status || ""),
    }
  } catch { return null }
}

export async function POST(req: NextRequest) {
  let body: any = {}
  try { body = await req.json() } catch {}
  const { api_key, shop_id, order_id, partner_id, options } = body
  if (!api_key || !shop_id || !order_id || !partner_id) {
    return NextResponse.json({ success: false, error: "Missing api_key / shop_id / order_id / partner_id" }, { status: 400 })
  }

  const accountId = await partnerAccountId(shop_id, api_key, Number(partner_id))
  if (accountId == null) {
    return NextResponse.json({
      success: false,
      error: `Walang naka-connect na account ang courier na ito sa page na ito (partner ${partner_id}). I-connect muna sa Pancake POS → Settings → Shipping bago magpadala.`,
    }, { status: 400 })
  }

  const partner: Record<string, any> = { partner_id: Number(partner_id), partner_account_id: accountId }
  if (options?.is_free_shipping != null) partner.is_free_shipping = !!options.is_free_shipping
  if (options?.is_dropoff) partner.is_dropoff = true
  if (options?.note) partner.note = String(options.note).slice(0, 500)

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
    // status 9 = Waiting for Pick Up (⚠ HINDI 11 — 11|"waitting" ang Pancake's "Restocking").
    const WAITING_PICKUP = 9
    let a = await attempt("PUT", { partner, status: WAITING_PICKUP })
    if ((!a.res.ok || a.json?.success === false) && [400, 404, 405, 422].includes(a.res.status)) {
      const b = await attempt("PUT", { order: { partner, status: WAITING_PICKUP } })
      if (b.res.ok && b.json?.success !== false) a = b
      else {
        const c = await attempt("POST", { partner, status: WAITING_PICKUP })
        if (c.res.ok && c.json?.success !== false) a = c
        else if (detailOf(b) !== `HTTP ${b.res.status}`) a = b
        else if (detailOf(c) !== `HTTP ${c.res.status}`) a = c
      }
    }
    // Huling fallback: kung ang `partner_account_id` mismo ang tinatanggihan (bago
    // itong field, hindi dokumentado), ulitin nang wala ito. Ganito ang dating asal
    // ng route — hindi na-book, pero nakatakda ang courier. Mas mabuti nang ganoon
    // kaysa tuluyang hindi makapagpadala.
    if (!a.res.ok || a.json?.success === false) {
      const { partner_account_id, ...noAcc } = partner
      const d = await attempt("PUT", { partner: noAcc, status: WAITING_PICKUP })
      if (d.res.ok && d.json?.success !== false) a = d
    }
    if (!a.res.ok || a.json?.success === false) {
      return NextResponse.json({ success: false, error: detailOf(a) }, { status: 502 })
    }

    // ── I-verify. Tinanggap man ng Pancake ang PUT, hindi ibig sabihin na-book na. ──
    const check = await readBooking(shop_id, api_key, order_id)
    if (check && !check.booked) {
      return NextResponse.json({
        success: false,
        booked: false,
        error: `Tinanggap ng Pancake ang update (courier at status nakatakda na) PERO hindi pa naibi-book sa ${partner_id === 125 ? "SPX" : "J&T"} — walang waybill na nabuo. I-check ang order sa POS at gamitin muna ang Quick Update doon.`,
        status_name: check.status_name,
      }, { status: 502 })
    }

    return NextResponse.json({
      success: true,
      booked: check?.booked ?? true,
      tracking: check?.tracking || a.json?.data?.partner?.extend_code || "",
      status_name: check?.status_name || a.json?.data?.status_name || "",
    })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: "Failed to send to courier — " + (err?.message || "network error") }, { status: 500 })
  }
}
