"use client"
import { useCallback, useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"
import { currentUserEmail, currentUserName } from "@/lib/current-user"
import { notify } from "@/lib/notify"

// ─────────────────────────────────────────────────────────────────────────────
// ADS ACTIVITY LOG (migration 0026). Sino ang gumalaw ng ano sa Ads.
//
// ⚠ ANG PAGTATALA AY HINDI DAPAT MAKASIRA NG AKSYON. Kung bumagsak ang Supabase
// o hindi pa naitatakbo ang migration, TULOY pa rin ang pag-pause/pag-scale —
// ang tala lang ang nawawala. Kaya `void` at may sariling try/catch ang `logAds`:
// walang throw na makakarating sa tumatawag, at hindi ito hinihintay.
// ─────────────────────────────────────────────────────────────────────────────

export type AdsAction =
  | "status" | "budget" | "scale" | "scale_undo" | "kill" | "rename"
  | "register" | "unregister" | "ad_moved"
  | "rule_create" | "rule_update" | "rule_delete" | "rule_status" | "rule_scope"

export type AdsSurface = "ads-manager" | "testing" | "scaling" | "monitoring" | "rules"

export interface AdsActivity {
  id: string
  at: string
  user_name: string
  user_email: string
  action: AdsAction | string
  level: string
  object_id: string
  object_name: string
  account_name: string
  summary: string
  surface: string
  details: Record<string, any>
}

export type AdsLogInput = {
  action: AdsAction
  level?: "campaign" | "adset" | "ad" | "rule" | ""
  objectId?: string
  objectName?: string
  accountName?: string
  summary?: string
  surface?: AdsSurface
  details?: Record<string, any>
}

// ── TULAY PAPUNTANG NOTIFICATIONS ────────────────────────────────────────────
// Ang bawat mahalagang galaw sa Ads ay dumadaan na rito, kaya dito rin
// nagmumula ang abiso — walang pangalawang call site na makakalimutan.
// Ang makakakita: mga ADMIN (hindi ang gumawa mismo — tinatanggal ng feed ang
// sariling actor_email). Hindi lahat ay inaabisuhan: ang status/register ay
// karaniwang ingay; ang pera at pagpatay ang mahalaga.
const NOTIFY_MAP: Record<string, { sev: "info" | "warning" | "critical"; label: string } | undefined> = {
  kill: { sev: "critical", label: "killed" },
  scale: { sev: "warning", label: "scaled" },
  scale_undo: { sev: "warning", label: "undid a scale on" },
  budget: { sev: "warning", label: "changed the budget of" },
  rename: { sev: "info", label: "renamed" },
  rule_create: { sev: "info", label: "created rule" },
  rule_update: { sev: "info", label: "edited rule" },
  rule_delete: { sev: "warning", label: "deleted rule" },
  rule_scope: { sev: "info", label: "re-scoped rule" },
}
const SURFACE_TAB: Record<string, string> = {
  testing: "/business/ads/facebook", scaling: "/business/ads/facebook",
  monitoring: "/business/ads/facebook", "ads-manager": "/business/ads/facebook",
  rules: "/business/ads/facebook",
}

/** Isinusulat ang tala. Hindi kailanman nagta-throw at hindi kailangang i-await. */
export function logAds(entry: AdsLogInput): void {
  const nm = NOTIFY_MAP[entry.action]
  if (nm) notify({
    audience: "admin", type: `ads-${entry.action}`, severity: nm.sev,
    title: `${currentUserName() || "Someone"} ${nm.label} "${entry.objectName || entry.objectId || "?"}"`,
    body: [entry.summary, entry.accountName].filter(Boolean).join(" · "),
    href: SURFACE_TAB[entry.surface || ""] || "/business/ads/activity",
    details: { action: entry.action, level: entry.level, objectId: entry.objectId },
  })
  void (async () => {
    try {
      const businessId = await getBusinessId()
      if (!businessId) return
      const supabase = createSupabaseBrowserClient()
      await supabase.from("ads_activity_log").insert({
        business_id: businessId,
        user_name: currentUserName() || "Unknown user",
        user_email: currentUserEmail() || "",
        action: entry.action,
        level: entry.level || "",
        object_id: entry.objectId || "",
        object_name: entry.objectName || "",
        account_name: entry.accountName || "",
        summary: entry.summary || "",
        surface: entry.surface || "",
        details: entry.details || {},
      })
    } catch { /* ang tala ay hindi dapat makasira ng aksyon */ }
  })()
}

/** Maramihan — isang insert para sa bulk na aksyon (Turn on/off ng 20 rows). */
export function logAdsMany(entries: AdsLogInput[]): void {
  if (entries.length === 0) return
  // ISANG abiso para sa buong bulk — hindi 20. Ang unang notifiable na action
  // ang uri; ang bilang ang kuwento.
  const notifiable = entries.filter(e => NOTIFY_MAP[e.action])
  if (notifiable.length > 0) {
    const nm = NOTIFY_MAP[notifiable[0].action]!
    notify({
      audience: "admin", type: `ads-${notifiable[0].action}-bulk`, severity: nm.sev,
      title: `${currentUserName() || "Someone"} ${nm.label} ${notifiable.length} item${notifiable.length === 1 ? "" : "s"}`,
      body: notifiable.slice(0, 3).map(e => e.objectName).filter(Boolean).join(", ") + (notifiable.length > 3 ? "…" : ""),
      href: SURFACE_TAB[notifiable[0].surface || ""] || "/business/ads/activity",
      details: { count: notifiable.length, action: notifiable[0].action },
    })
  }
  void (async () => {
    try {
      const businessId = await getBusinessId()
      if (!businessId) return
      const name = currentUserName() || "Unknown user"
      const email = currentUserEmail() || ""
      const supabase = createSupabaseBrowserClient()
      await supabase.from("ads_activity_log").insert(entries.map(e => ({
        business_id: businessId, user_name: name, user_email: email,
        action: e.action, level: e.level || "", object_id: e.objectId || "",
        object_name: e.objectName || "", account_name: e.accountName || "",
        summary: e.summary || "", surface: e.surface || "", details: e.details || {},
      })))
    } catch { /* pareho */ }
  })()
}

export function useAdsActivity(limit = 500) {
  const [rows, setRows] = useState<AdsActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const refresh = useCallback(async () => {
    setLoading(true)
    const businessId = await getBusinessId()
    if (!businessId) { setRows([]); setLoading(false); return }
    const supabase = createSupabaseBrowserClient()
    const { data, error } = await supabase
      .from("ads_activity_log").select("*")
      .eq("business_id", businessId)
      .order("at", { ascending: false })
      .limit(limit)
    if (error) {
      // Ang pinakakaraniwang sanhi: hindi pa naitatakbo ang migration 0026.
      setError(/ads_activity_log/.test(error.message) || error.code === "42P01"
        ? "The ads_activity_log table doesn't exist yet — run migration 0026_ads_activity_log.sql in Supabase first."
        : error.message)
      setRows([]); setLoading(false); return
    }
    setError("")
    setRows((data || []).map((r: any) => ({
      id: r.id, at: r.at, user_name: r.user_name || "", user_email: r.user_email || "",
      action: r.action, level: r.level || "", object_id: r.object_id || "",
      object_name: r.object_name || "", account_name: r.account_name || "",
      summary: r.summary || "", surface: r.surface || "",
      details: r.details && typeof r.details === "object" ? r.details : {},
    })))
    setLoading(false)
  }, [limit])

  useEffect(() => { refresh() }, [refresh])
  return { rows, loading, error, refresh }
}

/**
 * Sinong PESOWISE user ang huling gumalaw sa bawat rule.
 *
 * ⚠ Hindi ito ang `created_by` ni Meta. Iisang Facebook token ang hawak ng
 * tatlong buyer, kaya IISANG pangalan lang ang alam ni Meta — ang may-ari ng
 * token. Walang saysay iyon sa tanong na "sino sa atin ang gumawa nito".
 */
export function useRuleEditors() {
  const [byRule, setByRule] = useState<Record<string, { user: string; action: string; at: string }>>({})

  const refresh = useCallback(async () => {
    try {
      const businessId = await getBusinessId()
      if (!businessId) return
      const supabase = createSupabaseBrowserClient()
      const { data, error } = await supabase
        .from("ads_activity_log").select("object_id,user_name,action,at")
        .eq("business_id", businessId).eq("level", "rule")
        .order("at", { ascending: false }).limit(1000)
      if (error || !data) return
      // Naka-sort na pababa, kaya ang UNA kada rule ang pinakahuli.
      const m: Record<string, { user: string; action: string; at: string }> = {}
      for (const r of data as any[]) {
        if (!r.object_id || m[r.object_id]) continue
        m[r.object_id] = { user: r.user_name || "", action: r.action || "", at: r.at }
      }
      setByRule(m)
    } catch { /* walang log = walang ipapakita, hindi error */ }
  }, [])

  useEffect(() => { refresh() }, [refresh])
  return { byRule, refresh }
}

/** Salitang nababasa ng tao para sa bawat aksyon. */
export const ACTION_LABEL: Record<string, string> = {
  status: "Turned on / off",
  budget: "Budget changed",
  rename: "Renamed",
  scale: "Scaled",
  scale_undo: "Scale undone",
  kill: "Killed (paused)",
  register: "Registered to monitor",
  unregister: "Stopped monitoring",
  ad_moved: "Marked moved to Scaling",
  rule_create: "Rule created",
  rule_update: "Rule edited",
  rule_delete: "Rule deleted",
  rule_status: "Rule enabled / disabled",
  rule_scope: "Rule scope changed",
}
