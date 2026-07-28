// PesoWise — PROBLEM MANAGEMENT notifications. Headless (service-role Supabase, walang browser).
// Dalawa ang trabaho nito bawat takbo:
//   1) BUMUO ng deadline reminders para sa bukas na problema — 7 araw, 3 araw, 1 araw bago,
//      "due today", at ARAW-ARAW habang overdue. May dedupe key kaya hindi umuulit.
//   2) IPADALA ang lahat ng nakapilang email (kasama ang "assigned" at "completed" na
//      ipinila ng app mismo).
//
//   node scripts/problem-notify.mjs             # bumuo + magpadala
//   node scripts/problem-notify.mjs --dry-run   # tingnan lang, walang isusulat o ipapadala
//   node scripts/problem-notify.mjs --queue-only  # bumuo lang, huwag munang magpadala
//
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, MAIL_FROM
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "fs"

// Config: .env.local kapag local; process.env kapag CI/cloud.
let env = {}
try {
  env = Object.fromEntries(
    readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)
      .filter(l => l.includes("=") && !l.startsWith("#"))
      .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
  )
} catch { /* walang .env.local (cloud) */ }
const pick = k => process.env[k] || env[k] || ""

const s = createClient(pick("NEXT_PUBLIC_SUPABASE_URL"), pick("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
})
const RESEND_KEY = pick("RESEND_API_KEY")
const MAIL_FROM = pick("MAIL_FROM") || "PesoWise <onboarding@resend.dev>"

const argv = process.argv.slice(2)
const DRY = argv.includes("--dry-run")
const QUEUE_ONLY = argv.includes("--queue-only")

const pad = n => String(n).padStart(2, "0")
const PH_OFFSET = 8 * 3600 * 1000
const phToday = (() => {
  const d = new Date(Date.now() + PH_OFFSET)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
})()
const dayDiff = (target, from) => {
  const [ty, tm, td] = target.split("-").map(Number)
  const [fy, fm, fd] = from.split("-").map(Number)
  if (!ty || !fy) return null
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000)
}
const CLOSED = ["Completed", "Cancelled"]
const uid = () => `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

/** Anong yugto ng paalala ang nararapat ngayon para sa isang deadline. */
function stageFor(days) {
  if (days === null) return null
  if (days < 0) return { kind: "overdue", daily: true, label: `OVERDUE by ${Math.abs(days)} day(s)` }
  if (days === 0) return { kind: "due_today", daily: false, label: "DUE TODAY" }
  if (days === 1) return { kind: "d1", daily: false, label: "Due TOMORROW" }
  if (days === 3) return { kind: "d3", daily: false, label: "Due in 3 days" }
  if (days === 7) return { kind: "d7", daily: false, label: "Due in 7 days" }
  return null
}

async function sendEmail(to, subject, text) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, text }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300))
}

async function main() {
  const { data: biz } = await s.from("businesses").select("id").limit(1).maybeSingle()
  const B = biz?.id
  if (!B) throw new Error("Walang business row.")

  // ── 1) Bumuo ng deadline reminders ──────────────────────────────────────────
  const { data: problems, error } = await s.from("problems").select("*").eq("business_id", B)
  if (error) throw error

  const { data: deps } = await s.from("problem_departments").select("name, manager_emails").eq("business_id", B)
  const managersOf = name => (deps || []).find(d => d.name === name)?.manager_emails || []

  const candidates = []
  for (const p of problems || []) {
    if (CLOSED.includes(p.status) || !p.target_date) continue
    const stage = stageFor(dayDiff(p.target_date, phToday))
    if (!stage) continue
    // Ang overdue ay ARAW-ARAW, kaya kasama ang petsa sa dedupe key. Ang ibang yugto
    // ay minsanan lang kada problema.
    const base = stage.daily ? `${stage.kind}|${p.id}|${phToday}` : `${stage.kind}|${p.id}`
    const to = [p.owner_email, ...(p.support_emails || []), ...managersOf(p.department)]
      .filter(e => e && e.includes("@"))
    const subject = `[${p.code}] ${stage.label}: ${p.title}`
    const body = [
      stage.kind === "overdue"
        ? "This problem is past its target completion date and is still open."
        : "Reminder: the target completion date for this problem is approaching.",
      "",
      `${p.code} — ${p.title}`,
      `Department: ${p.department || "—"}`,
      `Priority: ${p.priority}`,
      `Status: ${p.status}`,
      `Target completion: ${p.target_date}`,
      p.root_cause ? `Root cause: ${p.root_cause}` : "Root cause: (not yet identified)",
      "",
      "Open PesoWise → Problem Management to update this record.",
    ].join("\n")
    for (const t of Array.from(new Set(to))) candidates.push({ dedupe_key: `${base}|${t}`, to_email: t, kind: stage.kind, problem_id: p.id, subject, body })
  }

  // Alisin ang mga naipila/naipadala na.
  let fresh = candidates
  if (candidates.length) {
    const { data: seen } = await s.from("problem_notifications")
      .select("dedupe_key").eq("business_id", B).in("dedupe_key", candidates.map(c => c.dedupe_key))
    const set = new Set((seen || []).map(r => r.dedupe_key))
    fresh = candidates.filter(c => !set.has(c.dedupe_key))
  }

  console.log(`Deadline scan — ${phToday} (PH) · ${(problems || []).length} problems · ${fresh.length} bagong paalala${DRY ? " · DRY RUN" : ""}`)
  for (const c of fresh) console.log(`  • ${c.kind.padEnd(10)} → ${c.to_email}  ${c.subject}`)

  if (fresh.length && !DRY) {
    const { error: insErr } = await s.from("problem_notifications").insert(
      fresh.map(c => ({ id: uid(), business_id: B, status: "pending", ...c }))
    )
    if (insErr) console.error("Queue insert failed:", insErr.message)
  }

  if (QUEUE_ONLY) { console.log("Queue-only — hindi nagpapadala."); return }

  // ── 2) Ipadala ang mga naka-pending ─────────────────────────────────────────
  const { data: pending } = await s.from("problem_notifications")
    .select("*").eq("business_id", B).eq("status", "pending").limit(200)
  const queue = pending || []

  if (!queue.length) { console.log("Walang pending na email."); return }
  if (DRY) { console.log(`${queue.length} pending — DRY RUN, hindi ipinadala.`); return }
  if (!RESEND_KEY) {
    console.log(`${queue.length} pending na email PERO walang RESEND_API_KEY — nananatili silang naka-queue.`)
    console.log("Idagdag ang RESEND_API_KEY (at MAIL_FROM) sa .env.local / GitHub secrets para magpadala.")
    return
  }

  let sent = 0, failed = 0
  for (const n of queue) {
    try {
      await sendEmail(n.to_email, n.subject, n.body)
      await s.from("problem_notifications").update({ status: "sent", sent_at: new Date().toISOString(), error: "" }).eq("id", n.id)
      sent++
    } catch (e) {
      await s.from("problem_notifications").update({ status: "failed", error: String(e.message || e).slice(0, 300) }).eq("id", n.id)
      failed++
      console.error(`  FAIL ${n.to_email}: ${e.message}`)
    }
  }
  console.log(`Emails — sent ${sent}, failed ${failed}.`)
}

main().then(() => process.exit(0)).catch(e => { console.error("Problem notify failed:", e.message); process.exit(1) })
