import { createClient } from "@supabase/supabase-js"
import fs from "node:fs"
const env = {}
for (const line of fs.readFileSync("D:/Claude Files/pesowise/.env.local","utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g,"").trim()
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{autoRefreshToken:false,persistSession:false} })
const { data, error } = await sb.from("problems").select("code, title, department, status, created_at, id").order("created_at")
if (error) { console.log("error:", error.message); process.exit(1) }
console.log("Kabuuang problems:", data.length, "\n")
for (const p of data) console.log(`${p.code}  |  ${p.title}  |  ${p.department}  |  ${p.status}`)
const counts = {}
for (const p of data) counts[p.code] = (counts[p.code]||0)+1
const dupes = Object.entries(counts).filter(([,n]) => n > 1)
console.log("\n-- DUPLICATE CODES --")
console.log(dupes.length ? dupes.map(([c,n]) => `${c} - ${n} beses`).join("\n") : "wala, malinis")
