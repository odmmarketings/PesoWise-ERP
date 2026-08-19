// PesoWise — PAALALA SA DEADLINE NG PARTNER TASKS. Headless (service-role
// Supabase, walang browser). Kaparehong-kapareho ng scripts/problem-notify.mjs:
//   1) BUMUO ng reminder para sa hindi pa tapos na task — 3 araw, 1 araw bago,
//      "due today", at ARAW-ARAW habang overdue. May dedupe key kaya hindi umuulit.
//   2) IPADALA ang lahat ng naka-pila.
//
//   node scripts/task-reminders.mjs             # bumuo + magpadala
//   node scripts/task-reminders.mjs --dry-run   # tingnan lang
//   node scripts/task-reminders.mjs --queue-only
//
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, MAIL_FROM
//
// ⚠ ANG "DONE" AY HINDI PINAPAALALAHANAN. Ang `review` ay pinapaalalahanan pa
// rin — hindi pa iyon tapos hangga't hindi inaaprubahan ng may-ari — pero ang
// email ay iba ang sinasabi: "naghihintay ng review", hindi "gawin mo na".
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "fs"

let env = {}
let envError = ""
try {
  env = Object.fromEntries(
    readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)
      .filter(l => l.includes("=") && !l.startsWith("#"))
      // Ang halaga ay maaaring naka-quote sa .env — tanggalin, kung hindi ay
      // magiging bahagi ng key/token ang panipi at tatanggihan ng Supabase.
      .map(l => [l.slice(0, l.indexOf("=")).trim(),
                 l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")])
  )
} catch (e) { envError = String(e.message || e) }   // cloud: walang .env.local, at tama iyon
const pick = k => process.env[k] || env[k] || ""

const s = createClient(pick("NEXT_PUBLIC_SUPABASE_URL"), pick("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
})
const RESEND_KEY = pick("RESEND_API_KEY")
const MAIL_FROM = pick("MAIL_FROM") || "PesoWise <onboarding@resend.dev>"
const APP_URL = pick("NEXT_PUBLIC_APP_URL") || "https://pesowise.vercel.app"

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
  const [ty, tm, td] = String(target).split("-").map(Number)
  const [fy, fm, fd] = String(from).split("-").map(Number)
  if (!ty || !fy) return null
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000)
}
const uid = () => `tsk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

/** Aling yugto — at umuulit ba ito araw-araw? */
function stageFor(days) {
  if (days === null) return null
  if (days < 0) return { kind: "overdue", daily: true, label: `OVERDUE by ${Math.abs(days)} day(s)` }
  if (days === 0) return { kind: "due_today", daily: false, label: "DUE TODAY" }
  if (days === 1) return { kind: "d1", daily: false, label: "Due TOMORROW" }
  if (days === 3) return { kind: "d3", daily: false, label: "Due in 3 days" }
  return null
}

/**
 * Email ng isang pangalan, mula sa roster.
 *
 * ⚠ PAREHONG TUNTUNIN NG APP (`rosterEmailByName` sa src/lib/notify.ts): eksakto
 * muna, tapos unang+huling pangalan kapag IISA lang ang tumutugma. Ang may-ari
 * ng ad account ay "Eugene Andaya" habang "Eugene Noval Andaya" ang nasa roster
 * — kung eksakto lang, walang aabot sa kanya kahit isang email.
 */
function emailForName(name, roster) {
  const t = String(name || "").trim().toLowerCase()
  if (!t) return ""
  const hit = roster.find(u =>
    String(u.full_name || "").trim().toLowerCase() === t ||
    String(u.username || "").trim().toLowerCase() === t)
  if (hit?.company_email) return String(hit.company_email).toLowerCase()
  const parts = t.split(/\s+/).filter(Boolean)
  if (parts.length < 2) return ""
  const first = parts[0], last = parts[parts.length - 1]
  const near = roster.filter(u => {
    const p = String(u.full_name || "").trim().toLowerCase().split(/\s+/).filter(Boolean)
    return p.length >= 2 && p[0] === first && p[p.length - 1] === last
  })
  return near.length === 1 && near[0]?.company_email ? String(near[0].company_email).toLowerCase() : ""
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
  // ⚠ SABIHIN ANG TUNAY NA DAHILAN. Dating `if (!B) throw "Walang business row"`
  // ito — at iyon ang lumalabas KAHIT ANO ang pumalya: hindi mabasang
  // .env.local, maling key, patay na network. Isang mensahe para sa tatlong
  // magkaibang sira, at ang isinasagot nito ay ang tanging sira na malamang ay
  // HINDI ang totoo (may business row naman talaga). Iniulat ng may-ari,
  // Ago 19 2026: "Walang business row" sa makinang may tamang datos.
  if (!pick("NEXT_PUBLIC_SUPABASE_URL") || !pick("SUPABASE_SERVICE_ROLE_KEY")) {
    throw new Error(
      "Walang Supabase credentials. "
      + (envError ? `Hindi mabasa ang .env.local — ${envError}` : "Nabasa ang .env.local pero walang NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY doon.")
      + " Patakbuhin ito mula sa loob ng pesowise folder, o itakda ang dalawa bilang environment variables.")
  }
  const { data: biz, error: bizErr } = await s.from("businesses").select("id").limit(1).maybeSingle()
  if (bizErr) throw new Error(`Hindi maabot ang Supabase — ${bizErr.message}`)
  const B = biz?.id
  if (!B) throw new Error("Nakausap ang Supabase pero walang business row sa `businesses`.")

  const { data: tasks, error } = await s.from("partner_tasks")
    .select("*").eq("business_id", B).eq("deleted", false).neq("status", "done")
  if (error) throw error

  const { data: roster } = await s.from("business_users")
    .select("full_name, username, company_email").eq("business_id", B)

  const candidates = []
  let noEmail = 0
  for (const t of tasks || []) {
    if (!t.deadline) continue                       // walang deadline = walang paalala
    const stage = stageFor(dayDiff(t.deadline, phToday))
    if (!stage) continue
    const to = emailForName(t.owner, roster || [])
    if (!to || !to.includes("@")) { noEmail++; continue }

    // Ang overdue ay araw-araw, kaya kasama ang petsa sa susi. Ang ibang yugto
    // ay minsanan lang kada task.
    const base = stage.daily ? `${stage.kind}|${t.id}|${phToday}` : `${stage.kind}|${t.id}`
    const waiting = t.status === "review"
    const subject = `[Task] ${stage.label}: ${t.title}`
    const body = [
      waiting
        ? "You marked this done and it is waiting for the owner's review — no action needed unless it comes back."
        : stage.kind === "overdue"
          ? "This task is past its deadline and is still not finished."
          : "Reminder: this task's deadline is coming up.",
      "",
      t.title,
      t.details ? `Details: ${t.details}` : "",
      `Assigned to: ${t.owner}`,
      `Deadline: ${t.deadline}`,
      `Status: ${waiting ? "For review" : "To do"}`,
      t.reward ? `Reward on approval: ${t.reward}` : "",
      "",
      `Open PesoWise → Facebook Ads → Tasks: ${APP_URL}/business/ads/facebook`,
    ].filter(l => l !== "").join("\n")

    candidates.push({ dedupe_key: `${base}|${to}`, to_email: to, kind: stage.kind, task_id: t.id, subject, body })
  }

  // Alisin ang mga naipila/naipadala na.
  let fresh = candidates
  if (candidates.length) {
    const { data: seen } = await s.from("partner_task_notifications")
      .select("dedupe_key").eq("business_id", B).in("dedupe_key", candidates.map(c => c.dedupe_key))
    const set = new Set((seen || []).map(r => r.dedupe_key))
    fresh = candidates.filter(c => !set.has(c.dedupe_key))
  }

  console.log(`Task deadline scan — ${phToday} (PH) · ${(tasks || []).length} open/review · ${fresh.length} bagong paalala${DRY ? " · DRY RUN" : ""}`)
  if (noEmail) console.log(`  ⚠ ${noEmail} task ang walang matagpuang email sa roster — hindi sila napaalalahanan.`)
  for (const c of fresh) console.log(`  • ${c.kind.padEnd(10)} → ${c.to_email}  ${c.subject}`)

  if (fresh.length && !DRY) {
    const { error: insErr } = await s.from("partner_task_notifications").insert(
      fresh.map(c => ({ id: uid(), business_id: B, status: "pending", ...c }))
    )
    if (insErr) console.error("Queue insert failed:", insErr.message)
  }

  if (QUEUE_ONLY) { console.log("Queue-only — hindi nagpapadala."); return }

  const { data: pending } = await s.from("partner_task_notifications")
    .select("*").eq("business_id", B).eq("status", "pending").limit(200)
  const queue = pending || []
  if (!queue.length) { console.log("Walang pending na email."); return }
  if (DRY) { console.log(`${queue.length} pending — DRY RUN, hindi ipinadala.`); return }
  if (!RESEND_KEY) {
    console.log(`${queue.length} pending na email PERO walang RESEND_API_KEY — nananatili silang naka-queue.`)
    console.log("Idagdag ang RESEND_API_KEY (at MAIL_FROM) sa .env.local para magpadala.")
    return
  }

  let sent = 0, failed = 0
  for (const n of queue) {
    try {
      await sendEmail(n.to_email, n.subject, n.body)
      await s.from("partner_task_notifications")
        .update({ status: "sent", sent_at: new Date().toISOString(), error: "" }).eq("id", n.id)
      sent++
    } catch (e) {
      await s.from("partner_task_notifications")
        .update({ status: "failed", error: String(e.message || e).slice(0, 300) }).eq("id", n.id)
      failed++
      console.error(`  FAIL ${n.to_email}: ${e.message}`)
    }
  }
  console.log(`Emails — sent ${sent}, failed ${failed}.`)
}

main().then(() => process.exit(0)).catch(e => { console.error("Task reminders failed:", e.message); process.exit(1) })
