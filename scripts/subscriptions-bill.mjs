// PesoWise — SUBSCRIPTIONS daily auto-collect. Headless (service-role Supabase, walang browser),
// kagaya ng fb-charges-import.mjs. Para sa bawat active na subscription na DUE ngayon (PH date),
// nagpo-post ng isang Book Keeping debit sa "Subscriptions" account (exact PHP), tapos ini-stamp
// ang last_billed_period para hindi madoble kada cycle. Ginagamit ng daily scheduled task.
//
// FIXED lang ang kinokolekta nito — ang may alam na cycle (weekly/monthly/quarterly/semiannual/
// yearly), billing day, at eksaktong halaga. Ang VARIABLE (auto top-up, walang fixed na petsa, o
// nag-iibang halaga) ay nilalaktawan at inililista sa output: manu-mano itong nilo-log sa UI
// ("Log charge") dahil walang mahuhulaang petsa o halaga na ligtas ipasok sa ledger.
//
//   node scripts/subscriptions-bill.mjs                 # collect due today
//   node scripts/subscriptions-bill.mjs --dry-run       # list due, WALANG post/write
//   node scripts/subscriptions-bill.mjs --date=2026-08-05  # test a specific PH date
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "fs"

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
const s = createClient(pick("NEXT_PUBLIC_SUPABASE_URL"), pick("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
})

const SUB_TYPE = "Software Subscription"
const argv = process.argv.slice(2)
const DRY = argv.includes("--dry-run")
const dateArg = (argv.find(a => a.startsWith("--date=")) || "").split("=")[1]

const pad = n => String(n).padStart(2, "0")
const daysInMonth = (y, m) => new Date(y, m, 0).getDate()
const peso = n => "₱" + Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// PH (UTC+8) "today" unless overridden with --date.
let y, m, d
if (dateArg && /^\d{4}-\d{2}-\d{2}$/.test(dateArg)) { [y, m, d] = dateArg.split("-").map(Number) }
else { const ph = new Date(Date.now() + 8 * 3600 * 1000); y = ph.getUTCFullYear(); m = ph.getUTCMonth() + 1; d = ph.getUTCDate() }
const dateStr = `${y}-${pad(m)}-${pad(d)}`

// ⚠ Salamin ito ng isDue/periodOf/isVariable sa src/lib/subscriptions-store.ts — kapag binago
// ang alinman doon, sabayan dito, kung hindi ay maghihiwalay ang UI at ang daily script.
const DAY_MS = 86400000
const utc = (yy, mm, dd) => Date.UTC(yy, mm - 1, dd)
const isoOf = ts => { const t = new Date(ts); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}` }
const dowOf = (yy, mm, dd) => new Date(utc(yy, mm, dd)).getUTCDay() + 1        // 1=Sunday … 7=Saturday
const weekKey = (yy, mm, dd) => "W" + isoOf(utc(yy, mm, dd) - (dowOf(yy, mm, dd) - 1) * DAY_MS)
const cycleMonths = c => (c === "quarterly" ? 3 : c === "semiannual" ? 6 : c === "yearly" ? 12 : 1)

function periodStart(sub) {
  const n = cycleMonths(sub.cycle)
  if (n === 1) return { py: y, pm: m }
  const anchor = Math.min(12, Math.max(1, sub.billing_month || 1)) - 1
  const startAbs = anchor + Math.floor((y * 12 + (m - 1) - anchor) / n) * n
  return { py: Math.floor(startAbs / 12), pm: (startAbs % 12) + 1 }
}

// Auto top-up (walang mahuhulaang petsa), walang fixed na billing day, o nag-iibang halaga.
// Hindi kailanman auto-posted — sa UI ito manu-manong nilo-log ("Log charge").
function isVariable(sub) {
  return sub.cycle === "topup" || !Number(sub.billing_day) || !(Number(sub.amount) > 0)
}

function periodOf(sub) {
  if (sub.cycle === "weekly") return weekKey(y, m, d)
  if (sub.cycle === "topup") return dateStr
  const { py, pm } = periodStart(sub)
  return sub.cycle === "yearly" ? String(py) : `${py}-${pad(pm)}`   // 'YYYY' pa rin ang yearly (lumang rows)
}

function isDue(sub) {
  if (sub.status !== "active") return false
  if (isVariable(sub)) return false
  if (sub.last_billed_period === periodOf(sub)) return false
  if (sub.cycle === "weekly") return dowOf(y, m, d) >= sub.billing_day
  const { py, pm } = periodStart(sub)
  const bd = Math.min(sub.billing_day, daysInMonth(py, pm))
  const absNow = y * 12 + (m - 1), absStart = py * 12 + (pm - 1)
  return absNow > absStart || (absNow === absStart && d >= bd)
}

async function main() {
  const { data: biz } = await s.from("businesses").select("id").limit(1).maybeSingle()
  const B = biz?.id
  if (!B) throw new Error("Walang business row.")

  // Ensure "Software Subscription" Type of Expense exists (opex=true) so subscriptions count as OPEX.
  const { data: fsRow } = await s.from("finance_settings").select("data").eq("business_id", B).maybeSingle()
  if (fsRow?.data && !DRY) {
    const data = fsRow.data
    const types = Array.isArray(data.types) ? data.types : []
    if (!types.some(t => t.name === SUB_TYPE)) {
      types.push({ id: `toe-sub-${y}${pad(m)}`, name: SUB_TYPE, opex: true, type: "Debit", status: "active" })
      data.types = types
      await s.from("finance_settings").update({ data, updated_at: new Date().toISOString() }).eq("business_id", B)
    }
  }

  const { data: subs, error } = await s.from("finance_subscriptions").select("*").eq("business_id", B)
  if (error) throw error

  const due = (subs || []).filter(isDue)
  // Sinasabi kung ilan ang nilaktawan — hindi tahimik na binabawasan ang saklaw.
  const variable = (subs || []).filter(s => s.status === "active" && isVariable(s))
  console.log(`Subscriptions — ${dateStr} (PH) · ${subs?.length || 0} total · ${due.length} due${DRY ? " · DRY RUN" : ""}`)
  if (variable.length) console.log(`  (${variable.length} variable — manual log sa UI: ${variable.map(s => s.name).join(", ")})`)
  let posted = 0, total = 0
  for (const sub of due) {
    if (DRY) { console.log(`  • DUE ${sub.name} — ${peso(sub.amount)} → ${sub.account} / ${sub.bank || "no bank"}`); continue }
    const nowIso = new Date().toISOString()
    const { error: insErr } = await s.from("bookkeeping_txns").insert({
      business_id: B, voucher: "", posted_date: dateStr, transaction: `Subscription — ${sub.name}`,
      account: sub.account, department: sub.department || "", category: "Expense - Debit",
      type_of_expense: sub.type_of_expense || SUB_TYPE, amount: sub.amount, debit: sub.amount, credit: 0,
      bank: sub.bank || "", receipt_name: "", status: "enabled", disable_reason: "", disable_remarks: "",
      added_by: "Subscriptions Auto", added_date: nowIso,
      history: [{ action: "Recorded from Subscriptions (auto)", by: "Auto-sync", date: nowIso }],
    })
    if (insErr) { console.error(`  FAIL ${sub.name}: ${insErr.message}`); continue }
    await s.from("finance_subscriptions").update({ last_billed_period: periodOf(sub) }).eq("id", sub.id)
    posted++; total += Number(sub.amount)
    console.log(`  ✓ ${sub.name} — ${peso(sub.amount)}`)
  }
  if (!DRY) console.log(`Done. Posted ${posted} subscription(s) = ${peso(total)} sa Book Keeping.`)
}

main().then(() => process.exit(0)).catch(e => { console.error("Subscriptions bill failed:", e.message); process.exit(1) })
