import { NextRequest, NextResponse } from "next/server"

// PUSH SCHEDULER ng Monitoring Rounds — ang server-side na kalahati ng "dapat
// tumunog kahit sarado ang app". Ang device na nanalo sa freeze ang tumatawag:
//
//   schedule → ISANG BAGSAKAN: naka-iskedyul kay OneSignal ang buong serye ng
//              paalala (ngayon, tapos kada 5 min habang on time, kada 10 kapag
//              late) — kaya kahit WALANG PesoWise na nakabukas kahit saan,
//              tuloy-tuloy ang tunog sa phone hanggang tapusin o lumipas.
//   cancel   → kapag TAPOS na ang round (o lumipas na), binubura ang mga hindi
//              pa naipapadala — walang paalala para sa gawang tapos na.
//
// Ang pagtarget ay sa EXTERNAL ID = email (itinatali ng push.ts sa pag-login).
// Kapag walang ONESIGNAL keys sa env, tahimik na ok:false — hindi kailanman
// hinaharang ang freeze/check dahil lang walang push.
const APP_ID = process.env.ONESIGNAL_APP_ID || ""
const API_KEY = process.env.ONESIGNAL_API_KEY || ""
const BASE = "https://api.onesignal.com"

async function os(path: string, method: string, body?: any) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // ⚠ Dalawang henerasyon ng OneSignal key: ang mga bago (os_v2_…) ay
      // "Key" ang scheme; ang legacy ay "Basic". Ang maling scheme ay tahimik
      // na 401 at walang push na aabot kailanman.
      Authorization: API_KEY.startsWith("os_v2") ? `Key ${API_KEY}` : `Basic ${API_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, json }
}

export async function POST(req: NextRequest) {
  if (!APP_ID || !API_KEY) return NextResponse.json({ ok: false, error: "push not configured" })
  let body: any = {}
  try { body = await req.json() } catch { /* walang laman */ }

  // ── CANCEL: burahin ang mga hindi pa naipapadala ───────────────────────────
  if (body.action === "cancel") {
    const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: any) => typeof x === "string") : []
    for (const id of ids.slice(0, 20)) {
      // Ang naipadala na ay hindi na mabubura — 4xx ang sagot doon, at ayos
      // lang: ang layunin ay patahimikin ang HINAHARAP, hindi baguhin ang nakaraan.
      await os(`/notifications/${encodeURIComponent(id)}?app_id=${encodeURIComponent(APP_ID)}`, "DELETE").catch(() => null)
    }
    return NextResponse.json({ ok: true })
  }

  // ── SCHEDULE: ang buong serye ng paalala, isang bagsakan ───────────────────
  const email = String(body.email || "").toLowerCase().slice(0, 200)
  const title = String(body.title || "Monitoring round").slice(0, 80)
  const message = String(body.message || "Open PesoWise and check your ads.").slice(0, 160)
  // ⚠ PATH lang ang tinatanggap, hindi buong URL — ang URL na galing sa body ay
  // kayang ituro kahit saan; ang path ay laging pabalik sa PesoWise mismo.
  const path = String(body.path || "/business/ads/facebook")
  const url = path.startsWith("/") ? `${req.nextUrl.origin}${path}` : req.nextUrl.origin
  const times: string[] = Array.isArray(body.times) ? body.times.slice(0, 12) : []
  if (!email || times.length === 0) return NextResponse.json({ ok: false, error: "missing email/times" })
  // Miyembro lang ng business ang puwedeng padalhan — hindi kahit sinong email.
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL, sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (sbUrl && sbKey) {
    try {
      const r = await fetch(`${sbUrl}/rest/v1/business_users?select=id&company_email=eq.${encodeURIComponent(email)}&limit=1`, {
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }, cache: "no-store",
      })
      const rows = await r.json().catch(() => [])
      if (!Array.isArray(rows) || rows.length === 0) return NextResponse.json({ ok: false, error: "not a member" })
    } catch { /* hindi masuri — magpatuloy; ang session gate ng middleware ang unang pinto */ }
  }

  const ids: string[] = []
  for (const [i, t] of times.entries()) {
    const { ok, json } = await os("/notifications?c=push", "POST", {
      app_id: APP_ID,
      target_channel: "push",
      include_aliases: { external_id: [email] },
      headings: { en: title },
      contents: { en: i === 0 ? message : `Still unchecked — ${message}` },
      url: url || undefined,
      // Ang unang padala ay NGAYON NA (walang send_after); ang mga sumunod ay
      // nakatakda — si OneSignal ang bahala, kahit patay na ang bawat browser.
      ...(i === 0 ? {} : { send_after: t }),
      ios_sound: "default",
      android_sound: "default",
      priority: 10,
    }).catch(() => ({ ok: false, json: {} as any }))
    if (ok && json?.id) ids.push(String(json.id))
  }
  return NextResponse.json({ ok: ids.length > 0, ids })
}
