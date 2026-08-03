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
const STATUS_WAITING_PICKUP = 9   // "Waiting for Pick Up" — 8 ang Packaging

// Out-of-delivery-zone at kauri nitong pagtanggi. Iba-iba ang salita ng SPX/J&T
// kaya pattern, hindi eksaktong string, ang hinahanap.
const ODZ_RE = /out\s*of\s*(the\s*)?(delivery\s*)?(zone|range|coverage|service|area)|delivery\s*zone|\bodz\b|not\s*(covered|serviceable|deliverable|supported)|no\s*coverage|unserviceable|outside\s*(the\s*)?(delivery|service|coverage)/i

/** Hinuhukay ang pinakamalapit na error text saanman ito itago ng Pancake/courier. */
function firstMessage(v: any, depth = 0): string {
  if (v == null || depth > 6) return ""
  if (Array.isArray(v)) {
    for (const x of v) { const m = firstMessage(x, depth + 1); if (m) return m }
    return ""
  }
  if (typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === "string" && x.trim() && /error|message|reason|detail/i.test(k)) return x.trim()
    }
    for (const x of Object.values(v)) { const m = firstMessage(x, depth + 1); if (m) return m }
  }
  return ""
}

/** PUT {status:N} — ito ang live-verified na paraan (kapareho ng /orders/update-status). */
async function setStatus(shopId: string, apiKey: string, orderId: string, status: number) {
  const res = await fetch(
    `${BASE}/shops/${encodeURIComponent(shopId)}/orders/${encodeURIComponent(orderId)}?api_key=${encodeURIComponent(apiKey)}`,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }), cache: "no-store" }
  )
  const raw = await res.text().catch(() => "")
  let json: any = null; try { json = JSON.parse(raw) } catch {}
  const ok = res.ok && json?.success !== false
  return { ok, detail: ok ? "" : String(json?.message || raw || `HTTP ${res.status}`).slice(0, 200) }
}

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
  //
  // ⚠ HINDI DITO INIAAKYAT ANG STATUS — SADYA RIN.
  // Dati `status: 9` ("Waiting for Pick Up") ang kasama sa PAREHONG request na
  // nagbo-book. Dumadaan ang status kahit tinanggihan ng SPX ang address (out of
  // delivery zone) — kaya "success" ang lumalabas at nagiging Waiting for Pick Up
  // ang order na wala man lang waybill. Ang isinusulat ngayon ay ang KASALUKUYANG
  // status ng order (para hindi mabura ang field sa replace-style na endpoint),
  // at 9 lang kapag may napatunayang waybill — sa hiwalay nang request sa ibaba.
  const form = new URLSearchParams()
  const keepStatus = typeof before.status === "number" ? before.status : undefined
  flatten({ id: before.id, partner: { partner_id: Number(partner_id) }, status: keepStatus }, "orders[0]", form)
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
    // Kung hindi mabasa ang order pagkatapos, WALANG masasabi — huwag mag-akalang
    // nabura ang datos (dating false alarm) at huwag ding galawin ang status.
    if (!after) {
      return NextResponse.json({
        success: false, booked: false,
        error: `Naipadala ang update pero hindi na-verify — hindi makuha ulit ang order ${order_id} sa Pancake. Tingnan sa POS kung may waybill bago i-resend.`,
      }, { status: 502 })
    }

    const pt = after.partner || {}
    // Waybill LANG ang katibayan ng booking. Dating tinatanggap ang `service_partner`,
    // pero iyon ay ang pangalan ng courier na TAYO mismo ang sumulat sa `partner_id` —
    // kaya "booked" ang ODZ na order kahit walang nabuong waybill.
    const tracking = String(pt.extend_code || pt.tracking_id || "")
    const booked = !!tracking

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

    // ── WALANG WAYBILL = HINDI NA-BOOK. Naiwan ang status kung nasaan ito (Packaging),
    // kaya kitang-kita sa Fulfillment kung alin ang kailangang i-resend sa ibang courier.
    if (!booked) {
      const courierName = Number(partner_id) === SPX ? "SPX" : "J&T"
      const haystack = `${raw} ${JSON.stringify(pt)} ${String(after.status_name || "")}`
      const detail = firstMessage(json) || firstMessage(pt)
      const odz = ODZ_RE.test(haystack) || (!!detail && ODZ_RE.test(detail))
      return NextResponse.json({
        success: false, booked: false, odz, reason: detail || "",
        error: odz
          ? `OUT OF DELIVERY ZONE — hindi kaya ng ${courierName} ang address na ito${detail ? `: ${detail.slice(0, 160)}` : ""}. Naiwang Packaging ang status; i-resend sa J&T.`
          : `Tinanggihan ng ${courierName} — walang nabuong waybill${detail ? `: ${detail.slice(0, 160)}` : " (posibleng out of delivery zone o invalid na address)"}. Naiwang Packaging ang status; tingnan ang order sa POS.`,
      }, { status: 502 })
    }

    // May waybill na — ngayon lang tama ang "Waiting for Pick Up".
    const st = await setStatus(shop_id, api_key, order_id, STATUS_WAITING_PICKUP)
    return NextResponse.json({
      success: true, booked: true, tracking,
      status_updated: st.ok,
      status_name: st.ok ? "Waiting for Pick Up" : String(after.status_name || ""),
      ...(st.ok ? {} : { warning: `Na-book (${tracking}) pero hindi na-update ang status sa Waiting for Pick Up — ${st.detail}` }),
    })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: "Failed to send to courier — " + (err?.message || "network error") }, { status: 500 })
  }
}
