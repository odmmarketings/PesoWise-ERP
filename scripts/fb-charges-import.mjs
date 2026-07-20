// Import Facebook "Paid" charges into PesoWise (dedup + card/bank match + Book Keeping
// post + sync-status update). Ginagamit ng daily auto-sync task.
//
// Import mode:  node scripts/fb-charges-import.mjs <charges.json>
//   charges.json = [{ account, date:"YYYY-MM-DD", amount:Number, last4, paymentMethod, ref, status }]
//   (status: "Paid" | "Failed" | "Funded"; paymentMethod: "Visa ···· 7349" | "Manual payment" | "Prepaid balance")
// Skip mode:    node scripts/fb-charges-import.mjs --skip "reason"   (marks status na na-skip)
//
// RULES:
//   • Card "Paid" (Visa ····) → card charge, i-match sa Cards registry → bank.
//   • "Manual payment"/"Funded" → top-up; bank = "MAYA (Domini)" (user rule).
//   • "Prepaid balance" Paid → SKIP (internal FB spend, hindi bank money-out).
//   • "Failed" → SKIP.
//   • Dedup by ref (transaction id) AT composite (account|date|amount|last4).

import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "fs"

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)
    .filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
)
const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const { data: biz } = await s.from("businesses").select("id").limit(1).maybeSingle()
if (!biz) { console.log("No business configured"); process.exit(1) }
const B = biz.id
const nowIso = new Date().toISOString()
const MANUAL_BANK = "MAYA (Domini)"

async function setStatus({ ok, added = 0, total = 0, note }) {
  await s.from("fb_sync_status").upsert({ business_id: B, last_sync_at: nowIso, ok, added_count: added, total_count: total, note, updated_at: nowIso })
}

// ── Skip mode ──
if (process.argv[2] === "--skip") {
  const reason = process.argv[3] || "Na-skip ang sync"
  const { count } = await s.from("fb_paid_charges").select("*", { count: "exact", head: true }).eq("business_id", B)
  await setStatus({ ok: false, added: 0, total: count || 0, note: `Skipped: ${reason}` })
  console.log("marked skipped:", reason)
  process.exit(0)
}

const file = process.argv[2]
if (!file) { console.log("Usage: fb-charges-import.mjs <charges.json> | --skip <reason>"); process.exit(1) }
let rows
try { rows = JSON.parse(readFileSync(file, "utf8")) } catch (e) { console.log("Cannot read JSON:", e.message); process.exit(1) }
if (!Array.isArray(rows)) { console.log("JSON must be an array"); process.exit(1) }

const num = v => Number(String(v).replace(/[^0-9.]/g, "")) || 0
const digits = v => String(v || "").replace(/\D/g, "")

// ── Reference data ──
const { data: cards } = await s.from("finance_cards").select("id, name, provider, card_number, account_number").eq("business_id", B)
const cardBy4 = l4 => l4 ? cards.find(c => digits(c.card_number).endsWith(l4) || digits(c.account_number).endsWith(l4)) : null
const { data: fsRow } = await s.from("finance_settings").select("data").eq("business_id", B).maybeSingle()
const banks = (fsRow?.data?.banks || []).filter(b => b.status === "active")
const words = t => String(t).toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter(w => w.length >= 4)
function bankOf(card) {
  if (!card) return ""
  const pw = words(card.provider), nw = words(card.name)
  const scored = banks.map(b => { const bw = words(b.name); let sc = 0
    if (pw.some(p => bw.some(x => p.includes(x) || x.includes(p)))) sc += 2
    if (nw.some(n => bw.some(x => n.includes(x) || x.includes(n)))) sc += 3
    return { b, sc } }).filter(x => x.sc >= 2).sort((a, b) => b.sc - a.sc)
  return scored[0] ? scored[0].b.name : ""
}
const depts = (fsRow?.data?.departments || []).filter(d => d.status === "active")
const dept = (depts.find(d => /marketing/i.test(d.name)) || depts[0] || {}).name || ""

const { data: existing } = await s.from("fb_paid_charges").select("id, billing_account, paid_date, amount, card_last4").eq("business_id", B)
const haveId = new Set(existing.map(e => e.id))
const haveComposite = new Set(existing.map(e => `${e.billing_account.toLowerCase()}|${e.paid_date}|${Number(e.amount).toFixed(2)}|${e.card_last4}`))

let added = 0, skipped = 0
const unmatched = new Set()
for (const r of rows) {
  const status = String(r.status || "").toLowerCase()
  const pm = String(r.paymentMethod || "")
  const last4 = digits(r.last4).slice(-4)
  const amount = num(r.amount)
  const date = String(r.date || "").slice(0, 10)
  const acc = String(r.account || "").trim()
  const ref = String(r.ref || "").trim()
  if (!acc || !date || !(amount > 0)) { skipped++; continue }

  const isManual = /manual/i.test(pm)
  const isCard = !isManual && (last4 || /visa|master|card/i.test(pm))
  // Include: card charge na Paid, o manual top-up (Funded/Paid). Skip: prepaid-balance spend, failed.
  const include = (isCard && status === "paid") || (isManual && (status === "funded" || status === "paid"))
  if (!include) { skipped++; continue }

  const id = ref ? `ref:${ref}` : `pc:${acc.toLowerCase()}|${date}|${amount.toFixed(2)}|${last4}`
  const comp = `${acc.toLowerCase()}|${date}|${amount.toFixed(2)}|${isManual ? "" : last4}`
  if (haveId.has(id) || haveComposite.has(comp)) { skipped++; continue }

  const card = isManual ? null : cardBy4(last4)
  const bank = isManual ? MANUAL_BANK : bankOf(card)
  if (isCard && !card) unmatched.add(`${acc} *${last4}`)

  const paymentMethod = isManual ? "Manual payment" : `Visa ···· ${last4}`
  const ins = await s.from("fb_paid_charges").insert({
    id, business_id: B, paid_date: date, amount, billing_account: acc, payment_method: paymentMethod,
    card_last4: isManual ? "" : last4, reference_no: ref, matched_card_id: card ? card.id : "", bank,
    source: "auto-sync", notes: isManual ? "Prepaid top-up (Funded)" : "", recorded_txn_id: null,
    created_by: "Auto-sync",
  })
  if (ins.error) { skipped++; continue }
  const bk = await s.from("bookkeeping_txns").insert({
    business_id: B, voucher: ref, posted_date: date,
    transaction: `FB Billing Paid — ${acc} (${paymentMethod})`,
    account: "Facebook Ads", department: dept, category: "Expense - Debit",
    type_of_expense: "Facebook Ads Billing", amount, debit: amount, credit: 0,
    bank, receipt_name: "", status: "enabled", added_by: "FB Billing (Paid)",
    history: [{ action: "Recorded from FB Billing (Paid)", by: "Auto-sync", date: nowIso }],
  }).select("id").single()
  if (!bk.error) await s.from("fb_paid_charges").update({ recorded_txn_id: bk.data.id }).eq("id", id)
  haveComposite.add(comp); added++
}

const { count: total } = await s.from("fb_paid_charges").select("*", { count: "exact", head: true }).eq("business_id", B)
const um = unmatched.size ? ` Unmatched card(s): ${Array.from(unmatched).join(", ")} — i-register sa Finance → Cards.` : ""
const note = added > 0
  ? `${added} bagong charge(s) na-import, ${skipped} skipped.${um}`
  : `Up to date — walang bagong charge.${um}`
await setStatus({ ok: true, added, total: total || 0, note })
console.log(note, `(total: ${total})`)
process.exit(0)
