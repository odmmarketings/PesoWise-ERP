"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"
import { currentUserEmail, currentUserName } from "@/lib/current-user"

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS (migration 0027) — in-app na abiso: admin / department / user.
//
// ⚠ ANG ABISO AY HINDI DAPAT MAKASIRA NG AKSYON. Tulad ng logAds: ang `notify`
// ay fire-and-forget na may sariling lunok ng error — kung wala pa ang table o
// patay ang Supabase, tuloy pa rin ang pag-assign/pag-kill, abiso lang ang wala.
//
// SINO ANG NAKAKAKITA (feed filter, client-side — pare-parehong miyembro
// ang RLS, gaya ng ads_activity_log):
//   all        → lahat
//   admin      → mga Mother Account (roster `mother`)
//   department → user na TUGMA ang roster `position` sa department na salita
//   user       → eksaktong company_email
// Hindi ipinapakita sa may-gawa ang sarili niyang abiso — alam na niya.
// ─────────────────────────────────────────────────────────────────────────────

export type NotifAudience = "admin" | "department" | "user" | "all"
export type NotifSeverity = "info" | "warning" | "critical"

export interface Notif {
  id: string
  created_at: string
  audience: NotifAudience | string
  department: string
  recipient_email: string
  actor_name: string
  actor_email: string
  type: string
  title: string
  body: string
  href: string
  severity: NotifSeverity | string
  read: boolean
}

export type NotifyInput = {
  audience: NotifAudience
  department?: string        // kailangan kapag audience="department"
  toEmail?: string           // kailangan kapag audience="user"
  type: string
  title: string
  body?: string
  href?: string
  severity?: NotifSeverity
  details?: Record<string, any>
}

/** Nagpapadala ng abiso. Hindi kailanman nagta-throw; hindi kailangang i-await. */
export function notify(n: NotifyInput): void {
  void (async () => {
    try {
      const businessId = await getBusinessId()
      if (!businessId) return
      const supabase = createSupabaseBrowserClient()
      await supabase.from("notifications").insert({
        business_id: businessId,
        audience: n.audience,
        department: n.department || "",
        recipient_email: (n.toEmail || "").toLowerCase(),
        actor_name: currentUserName() || "",
        actor_email: (currentUserEmail() || "").toLowerCase(),
        type: n.type, title: n.title, body: n.body || "", href: n.href || "",
        severity: n.severity || "info", details: n.details || {},
      })
    } catch { /* abiso lang ang nawala, hindi ang aksyon */ }
  })()
}

export function notifyMany(items: NotifyInput[]): void {
  for (const n of items) notify(n)
}

/**
 * Email ng isang tao mula sa roster, hinahanap sa pangalan (packer picker at
 * telemarketing assign ay PANGALAN ang hawak, hindi email). Blangko kung hindi
 * matagpuan — ang tumatawag ay dapat bumagsak sa department o admin na abiso.
 */
export function rosterEmailByName(name: string): string {
  if (!name || typeof window === "undefined") return ""
  try {
    const roster: any[] = JSON.parse(localStorage.getItem("pesowise_users") || "[]")
    const t = name.trim().toLowerCase()
    const u = roster.find(x =>
      (x.full_name && String(x.full_name).trim().toLowerCase() === t) ||
      (x.username && String(x.username).trim().toLowerCase() === t))
    return u?.email ? String(u.email).toLowerCase() : ""
  } catch { return "" }
}

// ── Sino ako sa roster — para malaman kung aling abiso ang para sa akin ──────
export type Me = { email: string; name: string; mother: boolean; position: string }
export function whoAmI(): Me {
  const email = (currentUserEmail() || "").toLowerCase()
  const name = (currentUserName() || "").toLowerCase()
  let mother = false, position = ""
  try {
    const roster: any[] = JSON.parse(localStorage.getItem("pesowise_users") || "[]")
    const u = roster.find(x =>
      (x.username && String(x.username).toLowerCase() === name) ||
      (x.full_name && String(x.full_name).toLowerCase() === name) ||
      (x.email && email && String(x.email).toLowerCase() === email))
    if (u) { mother = !!u.mother; position = String(u.position || "") }
  } catch { /* walang roster cache → hindi admin, walang department */ }
  return { email, name, mother, position }
}

/** Para ba sa aking ang abisong ito? (hindi kasama ang pagiging may-gawa) */
export function isForMe(n: { audience: string; department: string; recipient_email: string }, me: Me): boolean {
  if (n.audience === "all") return true
  if (n.audience === "admin") return me.mother
  if (n.audience === "department")
    return !!n.department && !!me.position && me.position.toLowerCase().includes(n.department.toLowerCase())
  if (n.audience === "user") return !!n.recipient_email && n.recipient_email === me.email
  return false
}

// ─────────────────────────────────────────────────────────────────────────────
// Feed ng kasalukuyang user. Poll kada 60s + refetch sa focus — walang realtime
// channel (nangangailangan ng replication config sa Supabase; ang poll ay
// siguradong gumagana at sapat ang bilis para sa panloob na ERP).
// ─────────────────────────────────────────────────────────────────────────────
export function useNotifications(limit = 200) {
  const [items, setItems] = useState<Notif[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const meRef = useRef<Me>({ email: "", name: "", mother: false, position: "" })

  const refresh = useCallback(async () => {
    try {
      const businessId = await getBusinessId()
      if (!businessId) { setLoading(false); return }
      const me = whoAmI()
      meRef.current = me
      const supabase = createSupabaseBrowserClient()
      const { data, error } = await supabase
        .from("notifications").select("*, notification_reads(user_email)")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(limit * 3)   // bago pa ang audience filter — kumuha nang may palugit
      if (error) {
        setError(/notifications/.test(error.message) || error.code === "42P01"
          ? "The notifications table doesn't exist yet — run migration 0027_notifications.sql in Supabase first."
          : error.message)
        setLoading(false); return
      }
      setError("")
      const mine: Notif[] = (data || [])
        .filter((r: any) => isForMe(r, me))
        // Ang sarili mong ginawa ay hindi mo na kailangang ibalita sa sarili mo.
        .filter((r: any) => !(r.actor_email && r.actor_email === me.email))
        .slice(0, limit)
        .map((r: any) => ({
          id: r.id, created_at: r.created_at, audience: r.audience, department: r.department || "",
          recipient_email: r.recipient_email || "", actor_name: r.actor_name || "", actor_email: r.actor_email || "",
          type: r.type, title: r.title, body: r.body || "", href: r.href || "", severity: r.severity || "info",
          read: Array.isArray(r.notification_reads) && r.notification_reads.some((x: any) => (x.user_email || "").toLowerCase() === me.email),
        }))
      setItems(mine)
      setLoading(false)
    } catch { setLoading(false) }
  }, [limit])

  useEffect(() => {
    refresh()
    const iv = setInterval(refresh, 60_000)
    const onFocus = () => refresh()
    window.addEventListener("focus", onFocus)
    return () => { clearInterval(iv); window.removeEventListener("focus", onFocus) }
  }, [refresh])

  const markRead = useCallback(async (id: string) => {
    const email = meRef.current.email
    if (!email) return
    setItems(prev => prev.map(x => x.id === id ? { ...x, read: true } : x))
    try {
      const supabase = createSupabaseBrowserClient()
      // upsert — ang dobleng pindot ay hindi dapat mag-error sa PK.
      await supabase.from("notification_reads").upsert(
        { notification_id: id, user_email: email }, { onConflict: "notification_id,user_email" })
    } catch { /* optimistic na ang UI; sa susunod na refresh magtutugma */ }
  }, [])

  const markAllRead = useCallback(async () => {
    const email = meRef.current.email
    if (!email) return
    const unread = items.filter(x => !x.read)
    if (unread.length === 0) return
    setItems(prev => prev.map(x => ({ ...x, read: true })))
    try {
      const supabase = createSupabaseBrowserClient()
      await supabase.from("notification_reads").upsert(
        unread.map(x => ({ notification_id: x.id, user_email: email })),
        { onConflict: "notification_id,user_email" })
    } catch { /* pareho */ }
  }, [items])

  const unread = items.filter(x => !x.read).length
  return { items, unread, loading, error, refresh, markRead, markAllRead }
}

/** Mababasang oras: "2m ago", "3h ago", "Aug 14". */
export function agoLabel(iso: string): string {
  const t = new Date(iso).getTime()
  if (!isFinite(t)) return ""
  const mins = Math.floor((Date.now() - t) / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const d = new Date(iso)
  return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]} ${d.getDate()}`
}
