// Prints the Facebook Billing Hub URL for each active ad account, para alam ng daily
// sync task kung anong mga page ang bibisitahin. Usage: node scripts/fb-accounts.mjs [fromEpoch] [toEpoch]
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "fs"

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)
    .filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
)
const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// Default date window = start of current month → today (para "this month" ang kinukuha).
const now = new Date()
const som = Math.floor(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).getTime() / 1000)
const today = Math.floor(now.getTime() / 1000)
const from = process.argv[2] || String(som)
const to = process.argv[3] || String(today)

const { data } = await s.from("fb_accounts").select("name, ad_account_id").eq("archived", false)
for (const a of data || []) {
  const id = String(a.ad_account_id).replace(/\D/g, "")
  const url = `https://business.facebook.com/latest/billing_hub/payment_activity/?asset_id=${id}&payment_account_id=${id}&date=${from}_${to}`
  console.log(`${id}\t${a.name}\t${url}`)
}
process.exit(0)
