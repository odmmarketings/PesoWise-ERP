// PesoWise — SUBSCRIPTIONS daily auto-collect. Headless (service-role Supabase, walang browser),
// kagaya ng fb-charges-import.mjs. Para sa bawat active na subscription na DUE ngayon (PH date),
// nagpo-post ng isang Book Keeping debit sa "Subscriptions" account (exact PHP), tapos ini-stamp
// ang last_billed_period para hindi madoble kada cycle. Ginagamit ng daily scheduled task.
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

function periodOf(sub) { return sub.cycle === "yearly" ? String(y) : `${y}-${pad(m)}` }
function isDue(sub) {
  if (sub.status !== "active") return false
  if (sub.cycle === "yearly") {
    if (sub.last_billed_period === String(y)) return false
    const bm = sub.billing_month || 1
    return m > bm || (m === bm && d >= Math.min(sub.billing_day, daysInMonth(y, bm)))
  }
  if (sub.last_billed_period === `${y}-${pad(m)}`) return false
  return d >= Math.min(sub.billing_day, daysInMonth(y, m))
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
  console.log(`Subscriptions — ${dateStr} (PH) · ${subs?.length || 0} total · ${due.length} due${DRY ? " · DRY RUN" : ""}`)
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
