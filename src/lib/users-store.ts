"use client"
import { useCallback, useEffect, useMemo, useState } from "react"
import { currentUserName } from "@/lib/current-user"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"

// User Management (LHIKE manual) — ERP user roster + per-module permissions + company logo.
// Permissions are stored as allowed sidebar HREFs; `mother` = Mother Account (all access).
// New users start PENDING + disabled → they "request access" sa login page → admin enables.
// Source of truth = Supabase `business_users` (one row per business, this deployment serves
// a single company). `pesowise_users` localStorage is now just a same-session READ CACHE,
// refreshed from Supabase on every app load (see syncRosterFromSupabase, called from the app
// layout) — kept so accessFor() can stay synchronous for the Sidebar without an app-wide
// rewrite. Kada mag-refresh/mag-login = up to date na sa lahat ng device.
const KEY = "pesowise_users"
const LOGO_KEY = "pesowise_company_logo"

export const EMPLOYMENT_STATUSES = ["Active", "Inactive", "Resigned", "Terminated"] as const
export type EmploymentStatus = typeof EMPLOYMENT_STATUSES[number]

export interface ErpUser {
  id: string             // display id / Employee No.: U-1, U-2, … (business_users.employee_no)
  username: string
  full_name: string      // derived: First + Last (kept for the table + access matching)
  last_name: string
  first_name: string
  middle_name: string
  birthdate: string      // YYYY-MM-DD
  personal_email: string
  gender: "" | "Male" | "Female"
  employment_date: string // YYYY-MM-DD
  position: string
  email: string          // Company Email — this is what matches the PesoWise login account
  contact: string
  status: EmploymentStatus
  enabled: boolean       // Enabled/Disabled button sa table
  pending: boolean       // bagong add / waiting for access approval
  requested: boolean     // nag-request na ng access mula login page
  mother: boolean        // Mother Account — all access
  allowed: string[]      // sidebar hrefs na pwede (ignored when mother)
  created_at: string
  last_login: string     // "YYYY-MM-DD HH:mm" ("" kung hindi pa nakapag-login)
  deleteAt: string       // ISO timestamp — pag naka-set, i-a-auto-purge ang user na ito once past. "" = hindi naka-schedule for deletion.
}
export type NewUserInput = Omit<ErpUser, "id" | "created_at" | "last_login" | "requested" | "deleteAt">

export const DELETE_GRACE_MS = 3 * 24 * 60 * 60 * 1000 // 3 days — grace period bago ma-permanent delete

function nextEmployeeNo(list: ErpUser[]) {
  const seq = list.reduce((m, u) => Math.max(m, Number(String(u.id).match(/U-(\d+)/)?.[1] || 0)), 0) + 1
  return `U-${seq}`
}

function rowToErpUser(r: any): ErpUser {
  return {
    id: r.employee_no || r.id,
    username: r.username || "",
    full_name: r.full_name || [r.first_name, r.last_name].filter(Boolean).join(" "),
    last_name: r.last_name || "",
    first_name: r.first_name || "",
    middle_name: r.middle_name || "",
    birthdate: r.birthdate || "",
    personal_email: r.personal_email || "",
    gender: r.gender === "Male" || r.gender === "Female" ? r.gender : "",
    employment_date: r.employment_date || "",
    position: r.position || "",
    email: r.company_email || "",
    contact: r.contact || "",
    status: (EMPLOYMENT_STATUSES as readonly string[]).includes(r.status) ? r.status : "Active",
    enabled: r.enabled ?? false,
    pending: r.pending ?? false,
    requested: r.requested ?? false,
    mother: r.mother ?? false,
    allowed: Array.isArray(r.allowed) ? r.allowed.filter(Boolean) : [],
    created_at: r.created_at || new Date().toISOString(),
    last_login: r.last_login || "",
    deleteAt: r.delete_at || "",
  }
}

function readCache(): ErpUser[] {
  if (typeof window === "undefined") return []
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : [] }
  catch { return [] }
}
function writeCache(users: ErpUser[]) {
  try { localStorage.setItem(KEY, JSON.stringify(users)) } catch {}
}

// ── Pull the full roster from Supabase and refresh the local read-cache. Call this after
// login (app layout) and after every mutation so every open tab/device converges on load. ──
export async function syncRosterFromSupabase(): Promise<ErpUser[]> {
  if (typeof window === "undefined") return []
  const businessId = await getBusinessId()
  if (!businessId) return readCache()
  const supabase = createSupabaseBrowserClient()
  const { data, error } = await supabase.from("business_users").select("*").eq("business_id", businessId)
  if (error || !data) return readCache()

  const now = Date.now()
  const live: any[] = [], expired: any[] = []
  for (const r of data) (r.delete_at && new Date(r.delete_at).getTime() <= now ? expired : live).push(r)
  if (expired.length) {
    // Best-effort permanent purge — don't block the read on it.
    supabase.from("business_users").delete().in("id", expired.map(r => r.id)).then(() => {})
  }
  const users = live.map(rowToErpUser)
  writeCache(users)
  return users
}

function patchToRow(patch: Partial<ErpUser>): Record<string, any> {
  const map: Record<string, string> = {
    username: "username", full_name: "full_name", last_name: "last_name", first_name: "first_name",
    middle_name: "middle_name", birthdate: "birthdate", personal_email: "personal_email", gender: "gender",
    employment_date: "employment_date", position: "position", email: "company_email", contact: "contact",
    status: "status", enabled: "enabled", pending: "pending", requested: "requested", mother: "mother",
    allowed: "allowed", last_login: "last_login", deleteAt: "delete_at",
  }
  const row: Record<string, any> = {}
  for (const [k, v] of Object.entries(patch)) {
    const col = map[k]
    if (!col) continue
    row[col] = v === "" && (col === "birthdate" || col === "employment_date" || col === "delete_at") ? null : v
  }
  return row
}

export function useErpUsers() {
  const [users, setUsers] = useState<ErpUser[]>(() => readCache())
  const [loading, setLoading] = useState(true)
  useEffect(() => { syncRosterFromSupabase().then(u => { setUsers(u); setLoading(false) }) }, [])

  const refresh = useCallback(async () => { setUsers(await syncRosterFromSupabase()) }, [])

  async function addUser(input: NewUserInput) {
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    const employeeNo = nextEmployeeNo(users)
    const row = { business_id: businessId, employee_no: employeeNo, ...patchToRow(input), enabled: false, pending: true, requested: false, mother: false, allowed: [] }
    const { error } = await supabase.from("business_users").insert(row)
    if (!error) await refresh()
  }
  async function updateUser(id: string, patch: Partial<ErpUser>) {
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("business_users").update(patchToRow(patch)).eq("business_id", businessId).eq("employee_no", id)
    if (!error) await refresh()
  }
  async function removeUser(id: string) {
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("business_users").delete().eq("business_id", businessId).eq("employee_no", id)
    if (!error) await refresh()
  }
  return { users, loading, addUser, updateUser, removeUser, refresh }
}

// ── Warehouse staff — sino ang pwedeng maging packer (Fulfillment → Assign Packer) ──
// FREE TEXT ang Position field sa Users, kaya pattern ang tugma at hindi eksaktong
// string: "Warehouse Staff", "warehouse staff", "Warehouse Supervisor", "Staff
// (Warehouse)" — warehouse tao pa rin lahat, at hindi mahuhuli ng exact match ang
// dobleng espasyo o ibang casing. Hindi kasama ang Resigned/Inactive/Terminated at
// ang naka-schedule na burahin — hindi na sila dapat mapagkakatiwalaan ng parcel.
export const WAREHOUSE_POSITION_RE = /warehouse/i
export function isWarehouseStaff(u: ErpUser): boolean {
  return WAREHOUSE_POSITION_RE.test(u.position || "") && u.status === "Active" && !u.deleteAt
}
/** Mga pangalan ng warehouse staff, sorted — pinagkukunan ng Assign Packer dropdown. */
export function useWarehouseStaff(): { names: string[]; loading: boolean } {
  const { users, loading } = useErpUsers()
  const names = useMemo(() => Array.from(new Set(
    users.filter(isWarehouseStaff).map(u => (u.full_name || "").trim() || (u.username || "").trim()).filter(Boolean)
  )).sort((a, b) => a.localeCompare(b)), [users])
  return { names, loading }
}

// ── Access check (sidebar enforcement) — matched by username / full name / email vs the
// logged-in PesoWise account. Walang match o Mother Account → full access (never locks out
// the owner). Disabled / non-Active employment → business nav hidden except dashboard.
// Reads the same-session Supabase-synced cache — stays synchronous so Sidebar doesn't need
// an async rewrite (the cache is refreshed on every app load by the layout). ──
export function accessFor(navHrefs: string[]): { full: boolean; allowed: Set<string> } {
  if (typeof window === "undefined") return { full: true, allowed: new Set() }
  try {
    const me = currentUserName().toLowerCase()
    let email = ""
    try { email = String(JSON.parse(localStorage.getItem("pesowise_current_user") || "{}").email || "").toLowerCase() } catch {}
    if (!me && !email) return { full: true, allowed: new Set() }
    const users = readCache()
    const u = users.find(x =>
      (x.username && x.username.toLowerCase() === me) ||
      (x.full_name && x.full_name.toLowerCase() === me) ||
      (x.email && email && x.email.toLowerCase() === email)
    )
    if (!u || u.mother) return { full: true, allowed: new Set() }
    // Lockout: hindi ito dapat maabot — 403 na ang disabled sa login API. Nandito
    // bilang panangga kung sakaling nakalusot, at ang dashboard ang tanging silid.
    if (!u.enabled || u.status !== "Active") return { full: false, allowed: new Set(["/business/dashboard"]) }
    // ⚠ HUWAG IPILIT ANG DASHBOARD SA PINILI MO. Dating `[...u.allowed,
    // "/business/dashboard"]` ito — laging isinasama, kaya ang pag-alis ng tsek
    // sa Sales Warehouse Logistics ay WALANG epekto: kita pa rin ito ng bagong
    // user gaano man kadalas mo alisin (iniulat ng may-ari, Ago 18 2026). Ang
    // checkbox ay dapat totoo; kung hindi, hindi iyon permission kundi palamuti.
    //
    // Ang layunin noon ay hindi maiwang blangko ang app. Nananatili iyon, pero
    // bilang HULING TANGKA lang: dashboard kapag WALA kang ibang naibigay na
    // pahina (doon din dinadala ng login). Kapag may naibigay ka, iyon lang ang
    // makikita niya — kasama o hindi ang dashboard, ikaw ang nagpasya.
    if (u.allowed.length === 0) return { full: false, allowed: new Set(["/business/dashboard"]) }
    return { full: false, allowed: new Set(u.allowed) }
  } catch { return { full: true, allowed: new Set() } }
}

// True ONLY when the logged-in user matches a roster row flagged as the Mother Account —
// used to gate admin-only actions (e.g. deleting Finance Settings reference data).
// Stricter than accessFor(): an unknown/unmatched user is NOT treated as admin here.
export function isMotherAccount(): boolean {
  if (typeof window === "undefined") return false
  try {
    const me = currentUserName().toLowerCase()
    let email = ""
    try { email = String(JSON.parse(localStorage.getItem("pesowise_current_user") || "{}").email || "").toLowerCase() } catch {}
    const u = readCache().find(x =>
      (x.username && x.username.toLowerCase() === me) ||
      (x.full_name && x.full_name.toLowerCase() === me) ||
      (x.email && email && x.email.toLowerCase() === email)
    )
    return !!u?.mother
  } catch { return false }
}

// ── Company logo (shown on the login page) — still local-only for now; not part of the
// shared-roster scope. Can move to Supabase Storage in a later pass if needed. ──
export function getCompanyLogo(): string {
  if (typeof window === "undefined") return ""
  try { return localStorage.getItem(LOGO_KEY) || "" } catch { return "" }
}
export function setCompanyLogo(dataUrl: string) {
  try { dataUrl ? localStorage.setItem(LOGO_KEY, dataUrl) : localStorage.removeItem(LOGO_KEY) } catch {}
}
