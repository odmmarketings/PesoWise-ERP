// SCALING ALERTS — Discord notifications para sa Scaling Tracker rules.
//
// Tumatakbo nang naka-schedule (Task Scheduler): 9:00 AM at 11:00 PM PHT.
//   9AM  → "no sales" check: may gastos na ngayong araw pero 0 purchase
//   11PM → "low ROAS" check: net ROAS ng araw < killRoas
//   pareho → bleeding (3d net < 1.5 sa ≥₱2,000) at ready-to-scale (streak ≥ 3 @ ≥3.9)
//
// NAG-AABISO LANG ITO — hindi ito nagpa-pause. Ang auto-pause ay nasa Scaling tab
// (may cap at undo doon). Ang mga threshold dito ay ang DEFAULTS ng tracker;
// ang mga in-browser na pagbabago sa Rules ay localStorage at hindi ito naaabot.
//
// Env (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DISCORD_WEBHOOK_URL
// Patakbo: node --use-system-ca scripts/scaling-alerts.mjs
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const HERE = dirname(fileURLToPath(import.meta.url))
const env = {}
for (const line of readFileSync(join(HERE, "..", ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const WEBHOOK = env.DISCORD_WEBHOOK_URL
if (!WEBHOOK) { console.log("DISCORD_WEBHOOK_URL missing — wala akong mapagpapadalhan."); process.exit(1) }

const RULES = { scaleRoas: 3.9, scaleDays: 3, minDailySpend: 500, killRoas: 2.8, evalMinSpend: 300, bleedRoas: 1.5, bleedSpend: 2000 }
const VAT = 1.12
const PH_OFFSET = 8 * 3600_000
const phNow = new Date(Date.now() + PH_OFFSET)
const phHour = phNow.getUTCHours()
const dstr = (d) => d.toISOString().slice(0, 10)
const today = dstr(phNow)
// 31 araw, katulad ng tracker sa UI (Ago 14 2026) — para pareho ang haba ng
// streak na nakikita mo sa Discord at sa Testing/Scaling na tab.
const from31 = dstr(new Date(phNow.getTime() - 30 * 86400_000))
const peso = (n) => "₱" + Math.round(n).toLocaleString("en-PH")
const dec = (n) => (isFinite(n) ? n : 0).toFixed(2)

const sbGet = async (p) => (await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${p}`, {
  headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
})).json()
const jf = async (r) => { const t = await r.text(); try { return JSON.parse(t) } catch { return {} } }
const actId = (raw) => { const s = String(raw || "").trim(); return s.startsWith("act_") ? s : `act_${s}` }

// parseActions — kapareho ng api/fb/insights (omni purchases)
function parsed(actions = [], values = []) {
  const get = (arr, ...keys) => { for (const k of keys) { const f = (arr || []).find(a => a.action_type === k); if (f) return Number(f.value || 0) } return 0 }
  return {
    purchases: get(actions, "omni_purchase", "purchase"),
    purchaseValue: get(values, "omni_purchase", "purchase"),
  }
}


const accounts = (await sbGet("fb_accounts?select=name,ad_account_id,token,page_name,archived"))
  .filter(a => !a.archived && a.token && a.ad_account_id)

// ── 48h cooldown mula sa registry — ang tab ay nagsasabing "hold", kaya ang
// Discord ay hindi dapat mag-utos ng kill sa parehong campaign (Ago 31 2026).
// Huling TUNAY na scale (applied) lang ang bumubuka ng cooldown; ang `at` ang
// oras, ang lumang tala na petsa lang ay hatinggabi ang alam.
const inCooldown = new Set()
try {
  const regs = await sbGet("scaling_registry?select=adset_id,scales,active&active=eq.true")
  for (const r of regs) {
    const last = [...(r.scales || [])].reverse().find(sc => sc && sc.applied !== false)
    if (!last) continue
    const t = last.at ? Date.parse(last.at) : Date.parse(`${last.date}T00:00:00+08:00`)
    if (isFinite(t) && Date.now() - t < 48 * 3600_000) inCooldown.add(String(r.adset_id))
  }
} catch { /* walang registry — walang cooldown na malalaman */ }

const scale = [], noSales = [], lowRoas = [], bleeding = []
for (const a of accounts) {
  const acct = actId(a.ad_account_id)
  // ⚠ Meta metrics — walang RTS (hatol ng may-ari, Ago 25 2026).
  const net = (v, s) => s > 0 ? v / (s * VAT) : 0
  const tr = encodeURIComponent(JSON.stringify({ since: from31, until: today }))
  // ⚠ CAMPAIGN level (Ago 31 2026): ang footer ay nagtuturo sa Scaling tab na
  // CAMPAIGN ang antas — ang dating ad-set na ping ay itinuturo sa tab na
  // hindi ito maipapakita.
  let url = `https://graph.facebook.com/v21.0/${acct}/insights?level=campaign&fields=campaign_id,campaign_name,spend,actions,action_values&time_range=${tr}&time_increment=1&limit=500&access_token=${encodeURIComponent(a.token)}`
  const byId = new Map()
  try {
    while (url) {
      const j = await jf(await fetch(url, { signal: AbortSignal.timeout(12000) }))
      if (j.error) break
      for (const r of j.data || []) {
        const p = parsed(r.actions, r.action_values)
        const m = byId.get(r.campaign_id) || { id: r.campaign_id, name: r.campaign_name, days: new Map() }
        m.days.set(r.date_start, { spend: Number(r.spend || 0), ...p })
        byId.set(r.campaign_id, m)
      }
      url = j.paging?.next || ""
    }
  } catch { continue }

  // ⚠ STATUS — ang insights ay bulag sa on/off: ang pinatay kahapon ay may
  // gastos pa rin sa series, kaya ang "BLEEDING — kill now" ay dating
  // pumupunta sa kampanyang PATAY NA (Ago 31 2026). Pumalyang status pull =
  // laktawan ang account: mas mabuting walang ping kaysa maling ping.
  const statusById = new Map()
  try {
    let su = `https://graph.facebook.com/v21.0/${acct}/campaigns?fields=id,effective_status&limit=500&access_token=${encodeURIComponent(a.token)}`
    for (let sp = 0; su && sp < 6; sp++) {
      const j = await jf(await fetch(su, { signal: AbortSignal.timeout(12000) }))
      if (j.error) break
      for (const c of j.data || []) statusById.set(String(c.id), String(c.effective_status || ""))
      su = j.paging?.next || ""
    }
  } catch { continue }
  if (statusById.size === 0) continue

  const dates = []
  for (let i = 30; i >= 0; i--) dates.push(dstr(new Date(phNow.getTime() - i * 86400_000)))
  for (const [, m] of byId) {
    if (!/^ACTIVE$/i.test(statusById.get(String(m.id)) || "")) continue
    if (inCooldown.has(String(m.id))) continue
    const tD = m.days.get(today) || { spend: 0, purchases: 0, purchaseValue: 0 }
    const w3 = dates.slice(-3).reduce((s, d) => { const x = m.days.get(d); if (x) { s.spend += x.spend; s.value += x.purchaseValue } return s }, { spend: 0, value: 0 })
    const label = `**${m.name}** (${a.name})`
    // 3-araw na AVERAGE mula ika-3 araw ng takbo (hatol Ago 25 2026) — ang
    // edad dito ay mula sa unang araw na may datos (walang start_time ang
    // insights pull na ito; ang unang gastos ang pinakamabuting alam).
    const first = [...m.days.keys()].sort()[0] || today
    const fIdx = dates.indexOf(first)
    const ageDays = fIdx < 0 ? dates.length : dates.length - fIdx
    // EKSAKTONG kapareho ng Scaling tab (Ago 25 2026): hindi hinuhusgahan ang
    // umagang hindi pa tapos; floor = ₱500/day sa mga TAPOS na araw, cap 3 —
    // ang 9AM na ping ay hindi dapat magturo ng hindi kikilalanin ng tab.
    const todayMature = tD.spend >= RULES.minDailySpend
    const jw = todayMature ? w3 : dates.slice(-4, -1).reduce((s, d) => { const x = m.days.get(d); if (x) { s.spend += x.spend; s.value += x.purchaseValue } return s }, { spend: 0, value: 0 })
    const completeDays = Math.max(1, Math.min(Math.min(3, RULES.scaleDays), ageDays - (todayMature ? 0 : 1)))
    const jAvg = net(jw.value, jw.spend)
    if (ageDays >= RULES.scaleDays && jAvg >= RULES.scaleRoas && jw.spend >= RULES.minDailySpend * completeDays)
      scale.push(`${label} — 3d avg ROAS ${dec(jAvg)} on ${peso(jw.spend)} (day ${ageDays})`)
    else if (net(w3.value, w3.spend) < RULES.bleedRoas && w3.spend >= RULES.bleedSpend) bleeding.push(`${label} — 3d net ${dec(net(w3.value, w3.spend))} on ${peso(w3.spend)}`)
    else if (phHour >= 9 && phHour < 12 && tD.spend >= RULES.evalMinSpend && tD.purchases === 0) noSales.push(`${label} — ${peso(tD.spend)} spent, 0 sales`)
    else if (phHour >= 21 && tD.spend >= RULES.evalMinSpend && net(tD.purchaseValue, tD.spend) < RULES.killRoas) lowRoas.push(`${label} — today net ${dec(net(tD.purchaseValue, tD.spend))}`)
  }
}

const sec = (title, list, emoji) => list.length ? `\n${emoji} **${title} (${list.length})**\n${list.slice(0, 10).map(x => `• ${x}`).join("\n")}${list.length > 10 ? `\n… +${list.length - 10} more` : ""}` : ""
const body = sec("READY TO SCALE", scale, "🚀") + sec("BLEEDING — kill now", bleeding, "🩸")
  + sec("NO SALES YET TODAY", noSales, "⚠️") + sec("LOW ROAS TODAY — kill before midnight", lowRoas, "🔻")

if (!body) { console.log("walang signal — walang ipapadala (hindi nag-i-spam)"); process.exit(0) }
await fetch(WEBHOOK, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ content: `**📊 Scaling Tracker — ${today} ${String(phHour).padStart(2, "0")}:00 PHT**${body}\n_ROAS (Meta purchase value ÷ spend +12% VAT). Open PesoWise → Facebook Ads → Scaling to act._` }),
})
console.log(`sent: scale=${scale.length} bleeding=${bleeding.length} noSales=${noSales.length} lowRoas=${lowRoas.length}`)
