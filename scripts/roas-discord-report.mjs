// PesoWise — Page ROAS Tracker → Discord auto-report.
// Headless mirror ng "Page Report" + "Yesterday Comparison" na nasa
// /business/ecommerce/roas. Tumatakbo ng WALANG browser: service-role Supabase
// → Pancake POS orders (per page) + FB adspent (refresh + read) → nag-po-post
// sa isang Discord webhook. Ginagaya ang existing daily-sync .mjs pattern.
//
// Usage:
//   node scripts/roas-discord-report.mjs                 # send (window=mtd)
//   node scripts/roas-discord-report.mjs --window today  # today | yesterday | mtd
//   node scripts/roas-discord-report.mjs --dry-run       # read-only: print, WALANG send/write
//   node scripts/roas-discord-report.mjs --no-fb         # skip FB refresh, gamitin stored adspent
//
// Env (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DISCORD_WEBHOOK_URL
import { createClient } from "@supabase/supabase-js"
import { readFileSync, writeFileSync, rmSync, existsSync } from "fs"
import { tmpdir } from "os"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { execFile } from "child_process"
import { promisify } from "util"
import sharp from "sharp"
const execFileP = promisify(execFile)
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))

// ── env.local parse (same convention as scripts/fb-accounts.mjs) ──────────────
// Config: .env.local kapag local; process.env kapag CI/cloud (GitHub Actions secrets).
let env = {}
try {
  env = Object.fromEntries(
    readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)
      .filter(l => l.includes("=") && !l.startsWith("#"))
      .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
  )
} catch { /* walang .env.local (cloud) — process.env ang gagamitin */ }
const pick = (k) => process.env[k] || env[k] || ""
const SUPABASE_URL = pick("NEXT_PUBLIC_SUPABASE_URL")
const SERVICE_KEY = pick("SUPABASE_SERVICE_ROLE_KEY")
const WEBHOOK = pick("DISCORD_WEBHOOK_URL")

// ── CLI flags ─────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const DRY = argv.includes("--dry-run")
const NO_FB = argv.includes("--no-fb")
const TEXT_MODE = argv.includes("--text")   // force the old monospace text embed
const FORCE = argv.includes("--force")      // bypass the dedup guard (manual/test send)
const wi = argv.indexOf("--window")
const WINDOW = wi >= 0 ? (argv[wi + 1] || "mtd") : "mtd"   // today | yesterday | mtd

const VAT_RATE = 0.12
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

// ── ROAS color tiers (same as roas/page.tsx roasColor) → Discord embed color ──
function roasHex(roas) {
  if (roas <= 0) return "#94a3b8"
  if (roas >= 4.9) return "#16a34a"
  if (roas >= 3) return "#d97706"
  if (roas >= 2) return "#ea580c"
  return "#dc2626"
}
const hexInt = (h) => parseInt(h.slice(1), 16)

// Per-page color — same PALETTE + hash as src/lib/page-colors.ts (custom overrides win).
const PALETTE = [
  "#2563eb", "#0891b2", "#0d9488", "#059669", "#65a30d",
  "#ca8a04", "#d97706", "#ea580c", "#dc2626", "#db2777",
  "#9333ea", "#7c3aed", "#4f46e5", "#475569", "#0284c7", "#16a34a",
]
function colorForPage(id, custom) {
  if (custom && custom[id]) return custom[id]
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
// 2-decimal peso (matches the app's fmtPeso) for the Page Report image.
const fmt2 = (n) => Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── PH (UTC+8) date helpers ────────────────────────────────────────────────────
const PH_OFFSET = 8 * 60 * 60 * 1000
function phDateStr(ms) {
  const d = new Date(ms + PH_OFFSET)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
}
const NOW = Date.now()
const PH_TODAY = phDateStr(NOW)
const PH_YEST = phDateStr(NOW - 86400000)
const PH_SOM = (() => { const d = new Date(NOW + PH_OFFSET); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01` })()
// Current PH time-of-day in seconds — cutoff for the "same-time-yesterday" comparison card.
const CUTOFF_SECS = (() => { const d = new Date(NOW + PH_OFFSET); return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds() })()
function phNowLabel() {
  const d = new Date(NOW + PH_OFFSET)
  const p = (n) => String(n).padStart(2, "0")
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}
// Discord caption stamp — "JULY 20, 2026 | 9:00AM" from the actual PH send time.
const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"]
function phReportStamp() {
  const d = new Date(NOW + PH_OFFSET)
  let h = d.getUTCHours()
  const ampm = h >= 12 ? "PM" : "AM"
  h = h % 12 || 12
  const min = String(d.getUTCMinutes()).padStart(2, "0")
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} | ${h}:${min}${ampm}`
}

// Report window → date range + label. Fetch range always covers yesterday+today too
// (needed by the comparison card).
const reportFrom = WINDOW === "mtd" ? PH_SOM : WINDOW === "yesterday" ? PH_YEST : PH_TODAY
const reportTo = WINDOW === "yesterday" ? PH_YEST : PH_TODAY
const windowLabel =
  WINDOW === "mtd" ? `Month-to-date (${PH_SOM} → ${PH_TODAY})`
  : WINDOW === "yesterday" ? `Yesterday (${PH_YEST})`
  : `Today (${PH_TODAY})`
const fetchFrom = [reportFrom, PH_YEST].sort()[0]   // earliest of the two
const fetchTo = PH_TODAY

function dateList(from, to) {
  const out = []
  const [fy, fm, fd] = from.split("-").map(Number)
  const [ty, tm, td] = to.split("-").map(Number)
  let t = Date.UTC(fy, fm - 1, fd), end = Date.UTC(ty, tm - 1, td)
  while (t <= end) { out.push(phDateStr(t - PH_OFFSET)); t += 86400000 }
  return out
}
const reportDates = dateList(reportFrom, reportTo)

// ── Pancake POS: per-page byDate {orders, sales} (replicates api/pancake/orders) ─
const PANCAKE_BASE = "https://pos.pages.fm/api/v1"
function toUnix(dateStr, endOfDay = false) {
  const [y, m, d] = dateStr.split("-").map(Number)
  const utcMs = Date.UTC(y, m - 1, d, 0, 0, 0) - PH_OFFSET
  return Math.floor(utcMs / 1000) + (endOfDay ? 86399 : 0)
}
function toPHDate(raw) {
  if (!raw) return ""
  const utcMs = new Date(raw.includes("Z") ? raw : raw + "Z").getTime()
  if (isNaN(utcMs)) return raw.slice(0, 10)
  return phDateStr(utcMs)
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function fetchJSON(url, retries = 2) {
  for (let a = 0; ; a++) {
    let res
    try { res = await fetch(url, { cache: "no-store" }) }
    catch { if (a < retries) { await sleep(350 * (a + 1)); continue } return { ok: false, status: 0, json: null } }
    if ((res.status === 429 || res.status >= 500) && a < retries) { await sleep(450 * (a + 1)); continue }
    if (res.status === 403 && a < 1) { await sleep(300); continue }
    let json = null
    try { json = await res.json() } catch {}
    return { ok: res.ok, status: res.status, json }
  }
}
async function pancakeByDate(shopId, apiKey, from, to) {
  const startTs = toUnix(from, false), endTs = toUnix(to, true)
  const buildUrl = (pageNum) => {
    const u = new URL(`${PANCAKE_BASE}/shops/${shopId}/orders`)
    u.searchParams.set("api_key", apiKey)
    u.searchParams.set("page_number", String(pageNum))
    u.searchParams.set("page_size", "100")
    u.searchParams.set("startDateTime", String(startTs))
    u.searchParams.set("endDateTime", String(endTs))
    u.searchParams.set("updateStatus", "inserted_at")            // basis = sales_order
    u.searchParams.set("option_sort", "inserted_at_asc")
    for (const f of ["id", "cod", "inserted_at", "created_at"]) u.searchParams.append("fields[]", f)
    return u.toString()
  }
  const fetchPage = async (n) => {
    const { ok, status, json } = await fetchJSON(buildUrl(n))
    if (!ok || json?.success === false) throw new Error(String(json?.message ?? `HTTP ${status || "network"}`))
    return { items: Array.isArray(json?.data) ? json.data : [], totalPages: json?.total_pages ?? 1 }
  }
  const first = await fetchPage(1)
  const orders = [...first.items]
  const lastPage = Math.min(first.totalPages, 200)
  const CONC = 6
  for (let s = 2; s <= lastPage; s += CONC) {
    const batch = []
    for (let p = s; p < s + CONC && p <= lastPage; p++) batch.push(p)
    const rs = await Promise.all(batch.map(fetchPage))
    for (const r of rs) orders.push(...r.items)
  }
  // full = whole-day totals (Page Report). capped = only orders whose PH time-of-day is at or
  // before the current time-of-day — for a fair "same-time-yesterday" comparison card.
  const full = {}, capped = {}
  for (const o of orders) {
    const raw = o.inserted_at || o.created_at || ""
    if (!raw) continue
    const utcMs = new Date(raw.includes("Z") ? raw : raw + "Z").getTime()
    if (isNaN(utcMs)) continue
    const date = phDateStr(utcMs)
    const cod = Number(o.cod ?? 0)
    if (!full[date]) full[date] = { orders: 0, sales: 0 }
    full[date].orders += 1; full[date].sales += cod
    const phd = new Date(utcMs + PH_OFFSET)
    const tod = phd.getUTCHours() * 3600 + phd.getUTCMinutes() * 60 + phd.getUTCSeconds()
    if (tod <= CUTOFF_SECS) {
      if (!capped[date]) capped[date] = { orders: 0, sales: 0 }
      capped[date].orders += 1; capped[date].sales += cod
    }
  }
  return { full, capped }
}

// ── FB (Meta) daily account spend (replicates api/fb/insights default mode) ─────
function actId(raw) {
  const s = String(raw || "").trim()
  return !s ? "" : s.startsWith("act_") ? s : `act_${s.replace(/\D/g, "")}`
}
async function fbInsights(token, account, from, to) {
  const tr = encodeURIComponent(JSON.stringify({ since: from, until: to }))
  let url = `https://graph.facebook.com/v21.0/${account}/insights?fields=spend&level=account&time_increment=1&time_range=${tr}&limit=500&access_token=${encodeURIComponent(token)}`
  const byDate = {}
  while (url) {
    const res = await fetch(url, { cache: "no-store" })
    const j = await res.json().catch(() => ({}))
    if (!res.ok || j.error) throw new Error(j?.error?.message || `Graph API ${res.status}`)
    for (const r of j.data || []) byDate[r.date_start] = (byDate[r.date_start] || 0) + Number(r.spend || 0)
    url = j.paging?.next || ""
  }
  return byDate
}

// ── Bounded-concurrency pool ────────────────────────────────────────────────────
async function pool(items, limit, fn) {
  const out = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx) }
  })
  await Promise.all(workers)
  return out
}

// ── Monospace table renderer — shared column widths across header/body/total ────
function tableLines(headers, rows, aligns) {
  const widths = headers.map((h, c) => Math.max(h.length, ...rows.map(r => String(r[c]).length)))
  const fmt = (cells) => cells.map((v, c) => aligns[c] === "r" ? String(v).padStart(widths[c]) : String(v).padEnd(widths[c])).join("  ")
  const width = widths.reduce((a, b) => a + b, 0) + 2 * (widths.length - 1)
  return { header: fmt(headers), body: rows.map(fmt), width }
}
const peso = (n) => Math.round(n).toLocaleString("en-PH")
const roasTxt = (r) => r > 0 ? r.toFixed(2) : "—"
const trunc = (s, n) => s.length > n ? s.slice(0, n - 1) + "…" : s

// ── HTML replica of the Page Report + Yesterday Comparison (matches the app UI) ─
function renderHtml(m) {
  const rows = m.report.map((r, i) => {
    const clr = colorForPage(r.id, m.pageColors)
    return `<tr class="${i % 2 ? "z1" : "z0"}">
      <td class="pg" style="border-left-color:${clr}"><span class="dot" style="background:${clr}"></span><span class="nm">${esc(r.name)}</span></td>
      <td class="r o">${r.orders.toLocaleString("en-PH")}</td>
      <td class="r sp">${fmt2(r.adspent)}</td>
      <td class="r vt">${fmt2(r.vat)}</td>
      <td class="r tc">${fmt2(r.adspent + r.vat)}</td>
      <td class="r sl">${fmt2(r.sales)}</td>
      <td class="r"><span class="badge" style="background:${roasHex(r.roas)}">${r.roas > 0 ? r.roas.toFixed(2) : "—"}</span></td>
    </tr>`
  }).join("")
  const t = m.totals
  const cmpRow = (label, tv, yv, badge) => `<tr>
    <td class="lbl">${label}</td>
    <td class="cv td">${badge ? `<span class="badge" style="background:${roasHex(m.today.roas)}">${tv}</span>` : tv}</td>
    <td class="cv yd">${badge ? `<span class="badge" style="background:${roasHex(m.yest.roas)}">${yv}</span>` : yv}</td>
  </tr>`
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#eef2f7;font-family:"Segoe UI Variable","Segoe UI",system-ui,-apple-system,Arial,sans-serif;padding:26px;-webkit-font-smoothing:antialiased}
.wrap{display:flex;gap:18px;align-items:flex-start;width:max-content}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.06)}
table{border-collapse:collapse}
.pr th{background:#1e293b;color:#fff;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:14px 20px;text-align:right;white-space:nowrap}
.pr th.l{text-align:left}
.pr td{padding:14px 20px;font-size:15px;white-space:nowrap;font-variant-numeric:tabular-nums;color:#334155}
.pr td.r{text-align:right}
.pr tr.z0{background:#fff}.pr tr.z1{background:#f8fafc}
.pg{border-left:4px solid}
.dot{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:11px;vertical-align:middle;box-shadow:0 0 0 1px rgba(0,0,0,.1)}
.nm{font-weight:600;color:#1e293b;vertical-align:middle}
.o{color:#475569}.vt{color:#94a3b8}.tc{color:#64748b}.sl{font-weight:600;color:#1e293b}
.badge{display:inline-block;min-width:54px;text-align:center;padding:6px 11px;border-radius:8px;color:#fff;font-weight:700;font-size:15px;font-variant-numeric:tabular-nums}
.pr tfoot td{background:#f1f5f9;font-weight:700;color:#0f172a;border-top:2px solid #cbd5e1;padding:14px 20px;font-size:14px}
.pr tfoot td.lead{text-transform:uppercase;letter-spacing:.03em;font-size:12px}
.note{padding:9px 20px;font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9;background:#fff}
.yc th{padding:14px 14px;font-size:12px;font-weight:700;text-transform:uppercase;color:#fff;letter-spacing:.03em}
.yc th.title{background:#1e293b;text-align:left;line-height:1.35}
.yc th.today{background:#0d9488;text-align:center;width:92px}
.yc th.yest{background:#94a3b8;text-align:center;width:92px}
.yc td{padding:12px 13px;font-size:14px;border:1px solid #e2e8f0;font-variant-numeric:tabular-nums}
.yc td.lbl{background:#0f766e;color:#fff;font-weight:600;text-transform:uppercase;font-size:12px;letter-spacing:.02em;white-space:nowrap}
.yc td.cv{text-align:center}
.yc td.td{color:#1e293b;font-weight:600}.yc td.yd{color:#64748b}
</style></head><body><div class="wrap">
  <div class="card pr"><table>
    <thead><tr><th class="l">Page</th><th>Orders</th><th>Ad Spend</th><th>VAT 12%</th><th>Total Cost</th><th>Sales</th><th>ROAS</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr>
      <td class="lead">TOTAL · ${m.report.length} page${m.report.length === 1 ? "" : "s"}</td>
      <td class="r">${t.orders.toLocaleString("en-PH")}</td>
      <td class="r">${fmt2(t.adspent)}</td>
      <td class="r" style="color:#64748b">${fmt2(t.vat)}</td>
      <td class="r" style="color:#475569">${fmt2(t.adspent + t.vat)}</td>
      <td class="r">${fmt2(t.sales)}</td>
      <td class="r"><span class="badge" style="background:${roasHex(m.totalRoas)}">${m.totalRoas > 0 ? m.totalRoas.toFixed(2) : "—"}</span></td>
    </tr></tfoot>
  </table><div class="note">ROAS = Sales ÷ Ad Spend · ${esc(m.windowLabel)} · PesoWise • ${m.nowLabel} PHT</div></div>
  <div class="card yc"><table>
    <thead><tr><th class="title">Yesterday<br>Comparison</th><th class="today">Today</th><th class="yest">Yesterday</th></tr></thead>
    <tbody>
      ${cmpRow("Generate Orders", m.today.orders.toLocaleString("en-PH"), m.yest.orders.toLocaleString("en-PH"))}
      ${cmpRow("Adspent", peso(m.today.adspent), peso(m.yest.adspent))}
      ${cmpRow("Conversion Value", peso(m.today.sales), peso(m.yest.sales))}
      ${cmpRow("ROAS (w/ VAT)", roasTxt(m.today.roas), roasTxt(m.yest.roas), true)}
    </tbody>
  </table></div>
</div></body></html>`
}

function findChrome() {
  // CHROME_PATH wins (set ito ng GitHub Actions workflow sa Linux runner).
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH
  const pf = process.env["ProgramFiles"] || "C:\\Program Files"
  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)"
  const local = process.env["LOCALAPPDATA"] || ""
  const cands = [
    // Windows (local)
    `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
    `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
    `${local}\\Google\\Chrome\\Application\\chrome.exe`,
    `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`,
    // Linux (GitHub Actions / servers)
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser", "/usr/bin/chromium",
  ]
  return cands.find(p => p && existsSync(p)) || null
}

// Render the HTML with headless Chrome → tight-cropped PNG buffer (via sharp trim).
async function htmlToPng(html) {
  const chrome = findChrome()
  if (!chrome) throw new Error("Walang Chrome/Edge na nahanap para sa screenshot.")
  const stamp = `roas_${process.pid}_${Date.now()}`
  const htmlPath = join(tmpdir(), `${stamp}.html`)
  const pngPath = join(tmpdir(), `${stamp}.png`)
  writeFileSync(htmlPath, html, "utf8")
  try {
    await execFileP(chrome, [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-sandbox",
      "--default-background-color=eef2f7ff", "--force-device-scale-factor=2",
      `--screenshot=${pngPath}`, "--window-size=1600,1300",
      `file:///${htmlPath.replace(/\\/g, "/")}`,
    ], { timeout: 60000 })
    let buf = readFileSync(pngPath)
    // Trim the uniform page background, then re-pad for breathing room.
    try {
      buf = await sharp(buf).trim({ threshold: 12 }).extend({ top: 26, bottom: 26, left: 26, right: 26, background: "#eef2f7" }).png().toBuffer()
    } catch {}
    return buf
  } finally {
    rmSync(htmlPath, { force: true }); rmSync(pngPath, { force: true })
  }
}

// Upload a PNG to the Discord webhook (multipart), with a short caption line.
async function sendImage(buf, caption) {
  const form = new FormData()
  form.append("payload_json", JSON.stringify({ username: "AI Agent Report", content: caption }))
  form.append("files[0]", new Blob([buf], { type: "image/png" }), "roas-report.png")
  const res = await fetch(WEBHOOK, { method: "POST", body: form })
  if (!res.ok) throw new Error(`Discord webhook failed: HTTP ${res.status} ${await res.text().catch(() => "")}`)
}

async function main() {
  // 1. Business id (single-business deployment)
  const { data: biz } = await supabase.from("businesses").select("id").limit(1).maybeSingle()
  const businessId = biz?.id
  if (!businessId) throw new Error("Walang business row sa Supabase.")

  // 2. Active pages (archived_at IS NULL)
  const { data: pageRows, error: pErr } = await supabase
    .from("store_pages").select("id, name, api_key, pancake_page_id, shop_id, status")
    .eq("business_id", businessId).is("archived_at", null)
  if (pErr) throw pErr
  const pages = pageRows || []

  // 2b. Custom per-page colors (ecommerce_settings.page_colors) for the report dots
  const { data: settingsRow } = await supabase
    .from("ecommerce_settings").select("page_colors").eq("business_id", businessId).maybeSingle()
  const pageColors = settingsRow?.page_colors || {}

  // 3. Stored adspent_entries (the app's current values, incl. manual overrides)
  const { data: adRows } = await supabase
    .from("adspent_entries").select("page_id, date, amount")
    .eq("business_id", businessId).gte("date", fetchFrom).lte("date", fetchTo)
  const adspentMap = {}
  for (const r of adRows || []) adspentMap[`${r.page_id}|${r.date}`] = Number(r.amount) || 0

  // 4. FB refresh (best-effort): overlay fresh Meta spend on the adspent map, mirroring
  //    the browser's syncAdspentFromFB. On a real run we also upsert it back so the app UI
  //    reflects the same fresh numbers. Skipped entirely on --dry-run and --no-fb.
  let fbEntries = [], fbErrors = 0, fbPages = 0
  if (!NO_FB) {
    const { data: fbRows } = await supabase
      .from("fb_accounts").select("page_name, ad_account_id, token, archived")
      .eq("business_id", businessId).eq("archived", false)
    const fbAll = fbRows || []
    for (const page of pages) {
      const accts = fbAll.filter(a => a.page_name === page.name && a.token && a.ad_account_id)
      if (!accts.length) continue
      const byDate = {}
      for (const a of accts) {
        try {
          const bd = await fbInsights(a.token, actId(a.ad_account_id), fetchFrom, fetchTo)
          for (const [d, v] of Object.entries(bd)) byDate[d] = (byDate[d] || 0) + v
        } catch { fbErrors++ }
      }
      const dates = Object.keys(byDate)
      if (dates.length) fbPages++
      for (const d of dates) {
        adspentMap[`${page.id}|${d}`] = byDate[d]                    // overlay fresh
        fbEntries.push({ business_id: businessId, page_id: page.id, date: d, amount: byDate[d], updated_at: new Date().toISOString() })
      }
    }
    if (fbEntries.length && !DRY) {
      // Mirror the browser: upsert one row per (business_id, page_id, date).
      const { error: upErr } = await supabase.from("adspent_entries").upsert(fbEntries, { onConflict: "business_id,page_id,date" })
      if (upErr) fbErrors++   // non-fatal: report still sends with in-memory values
    }
  }

  // 5. Pancake orders per page (only pages with creds), over the fetch range
  const credPages = pages.filter(p => (p.pancake_page_id || p.shop_id) && p.api_key)
  const pageByDate = {}
  const pancakeErrors = []
  await pool(credPages, 4, async (page) => {
    const shopId = page.pancake_page_id || page.shop_id
    try { pageByDate[page.id] = await pancakeByDate(shopId, page.api_key, fetchFrom, fetchTo) }
    catch (e) { pancakeErrors.push(`${page.name}: ${e.message}`) }
  })

  // 6. Page Report — per page, summed over the report window. ROAS = Sales ÷ Ad Spend (NO VAT).
  const report = pages.map(page => {
    let orders = 0, sales = 0, adspent = 0
    for (const d of reportDates) {
      const bd = pageByDate[page.id]?.full?.[d]
      orders += bd?.orders ?? 0
      sales += bd?.sales ?? 0
      adspent += adspentMap[`${page.id}|${d}`] ?? 0
    }
    return { id: page.id, name: page.name, orders, adspent, vat: adspent * VAT_RATE, sales, roas: adspent > 0 ? sales / adspent : 0 }
  }).filter(r => r.adspent > 0 || r.sales > 0)
    .sort((a, b) => b.roas - a.roas)

  const totals = report.reduce((t, r) => ({ orders: t.orders + r.orders, adspent: t.adspent + r.adspent, vat: t.vat + r.vat, sales: t.sales + r.sales }), { orders: 0, adspent: 0, vat: 0, sales: 0 })
  const totalRoas = totals.adspent > 0 ? totals.sales / totals.adspent : 0

  // 7. Today vs Yesterday — SAME time-of-day comparison para patas. Orders/Sales ay hanggang sa
  //    kasalukuyang PH time-of-day lang, kaya "Yesterday" = kahapon HANGGANG SA PAREHONG ORAS
  //    (hindi buong araw). Adspent: today as-is (up-to-now na ang FB); yesterday prorated sa
  //    parehong fraction ng araw (daily-granular ang FB spend). ROAS = Sales ÷ (Adspent × 1.12).
  const dayFrac = CUTOFF_SECS / 86400
  const aggDay = (dateStr, prorateAdspent) => {
    let orders = 0, sales = 0, adspent = 0
    for (const page of pages) {
      const bd = pageByDate[page.id]?.capped?.[dateStr]
      orders += bd?.orders ?? 0
      sales += bd?.sales ?? 0
      const ad = adspentMap[`${page.id}|${dateStr}`] ?? 0
      adspent += prorateAdspent ? ad * dayFrac : ad
    }
    return { orders, sales, adspent, roas: adspent > 0 ? sales / (adspent + adspent * VAT_RATE) : 0 }
  }
  const today = aggDay(PH_TODAY, false), yest = aggDay(PH_YEST, true)

  // 8. Build the visual report
  const nowLabel = phNowLabel()
  const caption = `📊 **${phReportStamp()} SALES REPORT**`
  const model = { report, totals, totalRoas, today, yest, pageColors, windowLabel, nowLabel }
  const diag = `pages=${pages.length} listed=${report.length} pancakeErr=${pancakeErrors.length} fbPages=${fbPages} fbErr=${fbErrors} window=${WINDOW}`

  // Text embed — used as fallback if image rendering fails, or when --text is passed.
  const buildTextEmbed = () => {
    const rt = tableLines(
      ["PAGE", "ORD", "SPEND", "SALES", "ROAS"],
      [...report.map(r => [trunc(r.name, 22), r.orders, peso(r.adspent), peso(r.sales), roasTxt(r.roas)]),
       [`TOTAL · ${report.length} page${report.length === 1 ? "" : "s"}`, totals.orders, peso(totals.adspent), peso(totals.sales), roasTxt(totalRoas)]],
      ["l", "r", "r", "r", "r"]
    )
    const reportTbl = [rt.header, ...rt.body.slice(0, -1), "─".repeat(rt.width), rt.body[rt.body.length - 1]].join("\n")
    const ct = tableLines(["", "TODAY", "YESTERDAY"], [
      ["Generate Orders", today.orders.toLocaleString("en-PH"), yest.orders.toLocaleString("en-PH")],
      ["Adspent", peso(today.adspent), peso(yest.adspent)],
      ["Conversion Value", peso(today.sales), peso(yest.sales)],
      ["ROAS (w/ VAT)", roasTxt(today.roas), roasTxt(yest.roas)],
    ], ["l", "r", "r"])
    return {
      username: "AI Agent Report",
      embeds: [{
        title: "📊 Page ROAS Report",
        description: `**Page Report — ${windowLabel}**\n\`\`\`\n${reportTbl}\n\`\`\`\n**Today vs Yesterday**\n\`\`\`\n${[ct.header, ...ct.body].join("\n")}\n\`\`\``,
        color: hexInt(roasHex(totalRoas)),
        footer: { text: `PesoWise • ${nowLabel} PHT` },
      }],
    }
  }
  const postJson = async (payload) => {
    const res = await fetch(WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
    if (!res.ok) throw new Error(`Discord webhook failed: HTTP ${res.status} ${await res.text().catch(() => "")}`)
  }

  // 9. Dry run — save a local PNG preview, no send/write
  if (DRY) {
    console.log("── DRY RUN (walang send/write) ──")
    console.log(diag)
    if (pancakeErrors.length) console.log("Pancake errors:\n  " + pancakeErrors.join("\n  "))
    if (!TEXT_MODE) {
      const buf = await htmlToPng(renderHtml(model))
      const out = join(SCRIPT_DIR, "_roas-report-preview.png")
      writeFileSync(out, buf)
      console.log(`PNG preview saved: ${out} (${Math.round(buf.length / 1024)} KB)`)
    } else {
      console.log("\n" + buildTextEmbed().embeds[0].description.replace(/```/g, "").replace(/\*\*/g, ""))
    }
    return
  }

  // 10. Send — image by default, text on --text, text fallback if rendering fails
  if (!WEBHOOK) throw new Error("Walang DISCORD_WEBHOOK_URL sa .env.local — idagdag muna.")

  // Dedup guard — kapag sarado ang app at nagbukas, sabay-sabay pumuputok ang mga na-miss na slot.
  // I-skip kung may na-send nang report sa loob ng DEDUP_MIN minuto (≥170 min ang pagitan ng tunay
  // na slots, kaya hindi nito hinaharangan ang lehitimong report). Gamitin --force para i-bypass.
  const SENT_FILE = join(SCRIPT_DIR, "_roas-last-sent")
  const DEDUP_MIN = 90
  if (!FORCE) {
    try {
      const last = Number(readFileSync(SENT_FILE, "utf8").trim())
      if (last && NOW - last < DEDUP_MIN * 60000) {
        console.log(`Skipped — may na-send nang report ${Math.round((NOW - last) / 60000)} min ago (dedup ${DEDUP_MIN}m).  ${diag}`)
        return
      }
    } catch {}
  }
  // --force sends (manual/test) don't record the timestamp, so they never suppress a scheduled run.
  const markSent = () => { if (FORCE) return; try { writeFileSync(SENT_FILE, String(NOW)) } catch {} }

  if (TEXT_MODE) {
    await postJson(buildTextEmbed())
    markSent()
    console.log(`Sent (text) ✓  ${diag}`)
    return
  }
  try {
    const buf = await htmlToPng(renderHtml(model))
    await sendImage(buf, caption)
    markSent()
    console.log(`Sent (image) ✓  ${diag}`)
  } catch (e) {
    console.error("Image render failed, falling back to text:", e.message)
    await postJson(buildTextEmbed())
    markSent()
    console.log(`Sent (text-fallback) ✓  ${diag}`)
  }
}

main().then(() => process.exit(0)).catch(e => { console.error("ROAS report failed:", e.message); process.exit(1) })
