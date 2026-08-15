"use client"
import { useCallback, useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"
import { currentUserEmail, currentUserName } from "@/lib/current-user"
import { notify } from "@/lib/notify"

// ─────────────────────────────────────────────────────────────────────────────
// ADS COMMENTS (migration 0028) — usapan sa tabi ng numero.
// Ang @mention ay nagpapadala ng abiso sa na-tag; ang teksto ay iniimbak nang
// buo, at ang mga email ng na-tag ay hiwalay na nakatabi sa `mentions`.
// ─────────────────────────────────────────────────────────────────────────────

export interface AdsComment {
  id: string
  created_at: string
  object_id: string
  object_level: string
  object_name: string
  account_name: string
  author_name: string
  author_email: string
  body: string
  mentions: string[]
  resolved: boolean
  resolved_at: string
  resolved_by: string
}

export type RosterPick = { name: string; email: string }

/** Ang mga taong pwedeng i-tag — galing sa roster cache (walang bagong hila). */
export function rosterPeople(): RosterPick[] {
  if (typeof window === "undefined") return []
  try {
    const roster: any[] = JSON.parse(localStorage.getItem("pesowise_users") || "[]")
    return roster
      .filter(u => u?.email && (u.full_name || u.username))
      .map(u => ({ name: String(u.full_name || u.username), email: String(u.email).toLowerCase() }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch { return [] }
}

/**
 * Hinahanap ang "@Pangalan" sa teksto at ibinabalik ang tumutugmang email.
 * ⚠ Ang mahabang pangalan muna ang tinitingnan: kung "Larry" at "Larry Lobitana"
 * ay parehong nasa roster, ang "@Larry Lobitana" ay dapat tumugma sa mahaba —
 * kung maikli muna, matatalo ang tama at maiiwang literal ang " Lobitana".
 */
export function extractMentions(body: string, people: RosterPick[]): string[] {
  const t = body.toLowerCase()
  const byLongest = [...people].sort((a, b) => b.name.length - a.name.length)
  const hit = new Set<string>()
  for (const p of byLongest) {
    if (t.includes(`@${p.name.toLowerCase()}`)) hit.add(p.email)
  }
  return [...hit]
}

export function useAdsComments(objectId: string) {
  const [items, setItems] = useState<AdsComment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const refresh = useCallback(async () => {
    if (!objectId) { setItems([]); return }
    setLoading(true)
    try {
      const businessId = await getBusinessId()
      if (!businessId) { setLoading(false); return }
      const supabase = createSupabaseBrowserClient()
      const { data, error } = await supabase
        .from("ads_comments").select("*")
        .eq("business_id", businessId).eq("object_id", objectId).eq("deleted", false)
        .order("created_at", { ascending: true })
      if (error) {
        setError(/ads_comments/.test(error.message) || error.code === "42P01"
          ? "The ads_comments table doesn't exist yet — run migration 0028_ads_comments.sql in Supabase first."
          : error.message)
        setLoading(false); return
      }
      setError("")
      setItems((data || []).map((r: any) => ({
        id: r.id, created_at: r.created_at, object_id: r.object_id, object_level: r.object_level || "campaign",
        object_name: r.object_name || "", account_name: r.account_name || "",
        author_name: r.author_name || "", author_email: r.author_email || "",
        body: r.body || "", mentions: Array.isArray(r.mentions) ? r.mentions : [],
        resolved: !!r.resolved, resolved_at: r.resolved_at || "", resolved_by: r.resolved_by || "",
      })))
    } catch { /* walang usapan na maipapakita */ }
    setLoading(false)
  }, [objectId])

  useEffect(() => { refresh() }, [refresh])

  const add = useCallback(async (body: string, ctx: { level: string; name: string; account: string; href: string }) => {
    const text = body.trim()
    if (!text) return
    const businessId = await getBusinessId()
    if (!businessId) return
    const people = rosterPeople()
    const mentions = extractMentions(text, people)
    const me = (currentUserEmail() || "").toLowerCase()
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("ads_comments").insert({
      business_id: businessId, object_id: objectId, object_level: ctx.level,
      object_name: ctx.name, account_name: ctx.account,
      author_name: currentUserName() || "", author_email: me,
      body: text, mentions,
    })
    if (error) { setError(error.message); return }
    // Abiso sa bawat na-tag — maliban sa sarili mo (walang saysay i-tag ang sarili).
    for (const email of mentions) {
      if (email === me) continue
      notify({
        audience: "user", toEmail: email, type: "ads-comment-mention", severity: "info",
        title: `${currentUserName() || "Someone"} tagged you on "${ctx.name}"`,
        body: text.length > 120 ? text.slice(0, 120) + "…" : text,
        href: ctx.href,
        details: { objectId, level: ctx.level },
      })
    }
    await refresh()
  }, [objectId, refresh])

  // ── Acknowledge / resolve ──────────────────────────────────────────────────
  // Nawawala sa tanawin, hindi nabubura: nananatili ang kung SINO ang
  // nag-acknowledge at KAILAN, kaya masasagot pa rin ang "sino'ng nakabasa nito?"
  const setResolved = useCallback(async (ids: string[], resolved: boolean) => {
    if (ids.length === 0) return
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("ads_comments").update({
      resolved,
      resolved_at: resolved ? new Date().toISOString() : null,
      resolved_by: resolved ? (currentUserName() || currentUserEmail() || "") : "",
    }).in("id", ids)
    if (error) { setError(error.message); return }
    await refresh()
  }, [refresh])

  const resolve = useCallback((id: string) => setResolved([id], true), [setResolved])
  const unresolve = useCallback((id: string) => setResolved([id], false), [setResolved])
  const resolveAll = useCallback(() => setResolved(items.filter(c => !c.resolved).map(c => c.id), true), [items, setResolved])

  const open = items.filter(c => !c.resolved)
  const done = items.filter(c => c.resolved)
  return { items, open, done, loading, error, refresh, add, resolve, unresolve, resolveAll }
}

/**
 * Bilang ng komento kada object para sa buong nakikitang talahanayan — isang
 * hila, hindi isa kada row (22 campaign = 22 request kung hindi).
 */
export function useCommentCounts(objectIds: string[]) {
  const [counts, setCounts] = useState<Record<string, number>>({})
  const key = objectIds.slice().sort().join(",")

  const refresh = useCallback(async () => {
    if (!key) { setCounts({}); return }
    try {
      const businessId = await getBusinessId()
      if (!businessId) return
      const supabase = createSupabaseBrowserClient()
      // BUKAS lang ang binibilang — ang na-acknowledge ay wala na sa tabi ng
      // numero, kaya wala rin itong badge.
      const { data, error } = await supabase
        .from("ads_comments").select("object_id")
        .eq("business_id", businessId).eq("deleted", false).eq("resolved", false)
        .in("object_id", key.split(","))
      if (error || !data) return
      const m: Record<string, number> = {}
      for (const r of data as any[]) m[r.object_id] = (m[r.object_id] || 0) + 1
      setCounts(m)
    } catch { /* walang bilang = walang badge */ }
  }, [key])

  useEffect(() => { refresh() }, [refresh])
  return { counts, refresh }
}
