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

// RTS rate kada page (returning+returned ÷ total) — kapareho ng tracker
async function rtsRates(pages) {
  const out = new Map()
  const fromTs = Math.floor(Date.parse(`${from31}T00:00:00+08:00`) / 1000)
  const toTs = Math.floor(Date.now() / 1000)
  for (const pg of pages) {
    const SHOP = pg.pancake_page_id || pg.shop_id
    if (!pg.api_key || !SHOP) continue
    try {
      // fast aggregates: total + returning(4) + returned(5)
      const agg = async (statuses) => {
        const u = new URL(`https://pos.pages.fm/api/v1/shops/${SHOP}/orders`)
        u.searchParams.set("api_key", pg.api_key)
        u.searchParams.set("page_size", "1")
        u.searchParams.set("startDateTime", String(fromTs))
        u.searchParams.set("endDateTime", String(toTs))
        u.searchParams.set("updateStatus", "inserted_at")
        for (const s of statuses) u.searchParams.append("filter_status[]", String(s))
        const j = await jf(await fetch(u.toString(), { signal: AbortSignal.timeout(12000) }))
        return Number(j?.aggs?.cod?.value ?? 0)
      }
      const [total, returning, returned] = await Promise.all([agg([]), agg([4]), agg([5])])
      if (total > 0) out.set(pg.name, Math.min(0.9, (returning + returned) / total))
    } catch {}
  }
  return out
}

const accounts = (await sbGet("fb_accounts?select=name,ad_account_id,token,page_name,archived"))
  .filter(a => !a.archived && a.token && a.ad_account_id)
const pages = await sbGet("store_pages?select=name,api_key,pancake_page_id,shop_id&archived_at=is.null")
const rts = await rtsRates(pages.filter(p => accounts.some(a => a.page_name === p.name)))

const scale = [], noSales = [], lowRoas = [], bleeding = []
for (const a of accounts) {
  const acct = actId(a.ad_account_id)
  const rate = rts.get(a.page_name) ?? 0
  const net = (v, s) => s > 0 ? (v * (1 - rate)) / (s * VAT) : 0
  const tr = encodeURIComponent(JSON.stringify({ since: from31, until: today }))
  let url = `https://graph.facebook.com/v21.0/${acct}/insights?level=adset&fields=adset_id,adset_name,spend,actions,action_values&time_range=${tr}&time_increment=1&limit=500&access_token=${encodeURIComponent(a.token)}`
  const byId = new Map()
  try {
    while (url) {
      const j = await jf(await fetch(url, { signal: AbortSignal.timeout(12000) }))
      if (j.error) break
      for (const r of j.data || []) {
        const p = parsed(r.actions, r.action_values)
        const m = byId.get(r.adset_id) || { name: r.adset_name, days: new Map() }
        m.days.set(r.date_start, { spend: Number(r.spend || 0), ...p })
        byId.set(r.adset_id, m)
      }
      url = j.paging?.next || ""
    }
  } catch { continue }

  const dates = []
  for (let i = 30; i >= 0; i--) dates.push(dstr(new Date(phNow.getTime() - i * 86400_000)))
  for (const [, m] of byId) {
    const tD = m.days.get(today) || { spend: 0, purchases: 0, purchaseValue: 0 }
    const w3 = dates.slice(-3).reduce((s, d) => { const x = m.days.get(d); if (x) { s.spend += x.spend; s.value += x.purchaseValue } return s }, { spend: 0, value: 0 })
    // streak (laktaw today kung maliit pa ang gastos)
    let streak = 0
    const start = tD.spend >= RULES.minDailySpend ? dates.length - 1 : dates.length - 2
    for (let i = start; i >= 0; i--) {
      const d = m.days.get(dates[i])
      if (!d || d.spend < RULES.minDailySpend || net(d.purchaseValue, d.spend) < RULES.scaleRoas) break
      streak++
    }
    const label = `**${m.name}** (${a.name})`
    if (streak >= RULES.scaleDays) scale.push(`${label} — ${streak} days ≥ ${RULES.scaleRoas} net`)
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
  body: JSON.stringify({ content: `**📊 Scaling Tracker — ${today} ${String(phHour).padStart(2, "0")}:00 PHT**${body}\n_Net ROAS (RTS-adjusted, +12% VAT). Open PesoWise → Facebook Ads → Scaling to act._` }),
})
console.log(`sent: scale=${scale.length} bleeding=${bleeding.length} noSales=${noSales.length} lowRoas=${lowRoas.length}`)
