import { NextRequest, NextResponse } from "next/server"

// ─────────────────────────────────────────────────────────────────────────────
// SEND ORDER TO COURIER — kinopya mula sa aktwal na ginagawa ng Pancake POS.
//
// PAANO ITO NALAMAN: nilagyan ng recorder ang XMLHttpRequest ng POS habang
// ginagawa ang "Quick update → SPX/J&T → Update" sa isang totoong order, at
// binasa ang eksaktong request. Huwag itong baguhin base sa hula — kunin ulit
// ang totoong request kung may magbabago sa Pancake.
//
// ANG TATLONG BAGAY NA MALI SA LUMANG BERSYON:
//   1. Maling endpoint. Hindi `PUT /orders/{id}` kundi
//      `POST /orders/update_multiple_orders` — bulk ito.
//   2. Maling format. Hindi JSON kundi FORM-ENCODED na may `orders[0][...]`
//      na mga susi.
//   3. Kulang ang trigger. Ang `partner_id` lang ay pagsulat ng PANGALAN ng
//      courier sa order — hindi booking. Ang totoong switch ay
//      `is_send_to_spx_phi` / `is_send_to_jnt_phi`. Kapag wala iyon, walang
//      waybill na nabubuo kahit "success" ang isinasagot ng API.
//
// BAKIT KAILANGANG BUO ANG ORDER SA PAYLOAD: `update_multiple_orders` ang
// pangalan — pinapalitan nito ang order. Kung kulang ang ipapadala, mabubura
// ang mga field na hindi kasama. Kaya kinukuha muna ang buong order, saka
// idinadagdag ang courier flags.
//
// POST body: { api_key, shop_id, order_id, partner_id, options?, dry_run? }
// ─────────────────────────────────────────────────────────────────────────────

const BASE = "https://pos.pages.fm/api/v1"
const SPX = 125
const JNT = 10

/** Mga field na nagti-trigger ng aktwal na booking, kada courier. */
function courierFields(partnerId: number, o: { is_free_shipping?: boolean; is_dropoff?: boolean; note?: string }) {
  if (partnerId === SPX) {
    // Bukas ng 8AM ang default na pickup — `pickup_time_spx` ay [unix_ts, range_id].
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0)
    return {
      is_send_to_spx_phi: "true",
      is_free_ship_spx: String(!!o.is_free_shipping),
      is_spx_post: String(!!o.is_dropoff),
      note_spx: o.note || "",
      allow_mutual_check_spx: "false",
      allow_try_on_spx: "false",
      "pickup_time_spx[0]": String(Math.floor(d.getTime() / 1000)),
      "pickup_time_spx[1]": "1",
    }
  }
  if (partnerId === JNT) {
    return {
      is_send_to_jnt_phi: "true",
      payment_jnt_phi: "PP_PM",              // shop ang nagbabayad — kapareho ng POS
      is_drop_off_jnt_phi: String(!!o.is_dropoff),
      signpart_jnt_phi: "false",
      insurance_services_jnt_phi: "true",
    }
  }
  return null
}

/** Ginagawang `orders[0][a][b]=v` na form fields ang isang nested object. */
function flatten(value: any, prefix: string, out: URLSearchParams) {
  if (value === null || value === undefined) return
  if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out))
  } else if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) flatten(v, `${prefix}[${k}]`, out)
  } else {
    out.append(prefix, String(value))
  }
}

async function getOrder(shopId: string, apiKey: string, orderId: string) {
  const res = await fetch(
    `${BASE}/shops/${encodeURIComponent(shopId)}/orders/${encodeURIComponent(orderId)}?api_key=${encodeURIComponent(apiKey)}`,
    { cache: "no-store" }
  )
  if (!res.ok) return null
  const j: any = await res.json().catch(() => null)
  return j?.data || j || null
}

export async function POST(req: NextRequest) {
  let body: any = {}
  try { body = await req.json() } catch {}
  const { api_key, shop_id, order_id, partner_id, options = {}, dry_run } = body
  if (!api_key || !shop_id || !order_id || !partner_id) {
    return NextResponse.json({ success: false, error: "Missing api_key / shop_id / order_id / partner_id" }, { status: 400 })
  }

  const flags = courierFields(Number(partner_id), options)
  if (!flags) {
    return NextResponse.json({
      success: false,
      error: `Hindi pa suportado ang courier na ito (partner ${partner_id}). SPX (125) at J&T (10) lang ang alam ng booking flow.`,
    }, { status: 400 })
  }

  const before = await getOrder(shop_id, api_key, order_id)
  if (!before) {
    return NextResponse.json({ success: false, error: `Hindi makuha ang order ${order_id} sa Pancake.` }, { status: 502 })
  }

  // ⚠ MINIMAL ANG PAYLOAD, SADYA.
  // Ang POS ay nagpapadala ng 294 fields dahil hawak niya ang buong order sa
  // sarili niyang state. Ang public API ay nagbabalik lang ng ~106 — at may
  // ilang blangko (hal. shipping_address). Kung ang endpoint ay PUMAPALIT at
  // hindi nagme-merge, ang pagpapadala ng kulang na kopya ay MAGBUBURA ng datos.
  // Kaya id + partner + status + courier flags lang ang ipinapadala. Kung
  // merge pala ito, gagana; kung palit, agad nating makikita sa diff sa ibaba
  // bago pa madamay ang iba.
  const form = new URLSearchParams()
  flatten({ id: before.id, partner: { partner_id: Number(partner_id) }, status: 9 }, "orders[0]", form)
  for (const [k, v] of Object.entries(flags)) form.append(`orders[0][${k}]`, v)

  if (dry_run) {
    const preview: Record<string, string> = {}
    for (const [k, v] of form.entries()) if (/partner|_spx|_jnt|status|\[id\]/.test(k)) preview[k] = v
    return NextResponse.json({
      success: true, dry_run: true, order_id,
      endpoint: `POST ${BASE}/shops/${shop_id}/orders/update_multiple_orders`,
      totalFields: [...form.keys()].length, courierFields: preview,
    })
  }

  try {
    const res = await fetch(
      `${BASE}/shops/${encodeURIComponent(shop_id)}/orders/update_multiple_orders?api_key=${encodeURIComponent(api_key)}`,
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString(), cache: "no-store" }
    )
    const raw = await res.text().catch(() => "")
    let json: any = null; try { json = JSON.parse(raw) } catch {}
    if (!res.ok || json?.success === false) {
      return NextResponse.json({ success: false, error: String(json?.message || raw || `HTTP ${res.status}`).slice(0, 300) }, { status: 502 })
    }

    const after = await getOrder(shop_id, api_key, order_id)
    const pt = after?.partner || {}
    const tracking = String(pt.extend_code || pt.tracking_id || "")
    const booked = !!pt.service_partner || !!tracking

    // ── May nabura ba? Mahalagang malaman AGAD, hindi sa warehouse pa. ──
    const wiped: string[] = []
    for (const k of ["customer_name", "shipping_address", "order_item", "final_price", "contact_no", "items"]) {
      const b = (before as any)[k], a = (after as any)?.[k]
      const filled = (v: any) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0)
      if (filled(b) && !filled(a)) wiped.push(k)
    }
    if (wiped.length) {
      return NextResponse.json({
        success: false, booked, tracking, dataLoss: wiped,
        error: `⚠ NAKABURA NG DATOS: ${wiped.join(", ")}. Pumapalit pala ang endpoint, hindi nagme-merge. HUWAG NANG ITULOY — ayusin muna ang order na ito sa POS at sabihan si Claude.`,
      }, { status: 500 })
    }

    if (!booked) {
      return NextResponse.json({
        success: false, booked: false,
        error: `Tinanggap ng Pancake ang update pero walang waybill na nabuo. Tingnan ang order sa POS.`,
      }, { status: 502 })
    }
    return NextResponse.json({ success: true, booked: true, tracking, status_name: String(after?.status_name || "") })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: "Failed to send to courier — " + (err?.message || "network error") }, { status: 500 })
  }
}
