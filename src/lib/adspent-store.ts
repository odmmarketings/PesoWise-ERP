"use client"
import { useCallback, useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"

// Per-page, per-day ad spend entered in the ROAS Tracker and consumed by both the
// ROAS Tracker (ROAS = Sales ÷ Ad Spent) and the Adspent ROAS Summary (which sums it
// across the connected pages per day). Keyed by `${pageId}|${YYYY-MM-DD}`.
// Source of truth = Supabase `adspent_entries` (one row per page+day); localStorage is
// now just a same-session read cache (and is migrated up once on first load).
const KEY = "pesowise_adspent"

function readCache(): Record<string, number> {
  try { const r = localStorage.getItem(KEY); return r ? JSON.parse(r) : {} } catch { return {} }
}
function writeCache(map: Record<string, number>) {
  try { localStorage.setItem(KEY, JSON.stringify(map)) } catch {}
}

export function useAdspent() {
  const [map, setMap] = useState<Record<string, number>>({})

  useEffect(() => {
    setMap(readCache())
    ;(async () => {
      const businessId = await getBusinessId()
      if (!businessId) return
      const supabase = createSupabaseBrowserClient()
      const { data, error } = await supabase.from("adspent_entries").select("page_id, date, amount").eq("business_id", businessId)
      if (error) return
      if (data.length === 0) {
        // One-time migration: push this browser's existing localStorage map up.
        const cached = readCache()
        const entries = Object.entries(cached).filter(([k, v]) => k.includes("|") && Number(v) > 0)
        if (entries.length > 0) {
          await supabase.from("adspent_entries").upsert(entries.map(([k, v]) => {
            const [pageId, date] = k.split("|")
            return { business_id: businessId, page_id: pageId, date, amount: Number(v) || 0 }
          }))
          setMap(cached)
          return
        }
      }
      const next: Record<string, number> = {}
      for (const r of data) next[`${r.page_id}|${r.date}`] = Number(r.amount) || 0
      writeCache(next); setMap(next)
    })()
  }, [])

  const get = useCallback((pageId: string, date: string) => map[`${pageId}|${date}`] ?? 0, [map])

  // Optimistic local update + row upsert (fire-and-forget safe: state is already correct).
  const set = useCallback(async (pageId: string, date: string, v: number) => {
    setMap(prev => { const next = { ...prev, [`${pageId}|${date}`]: v }; writeCache(next); return next })
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    await supabase.from("adspent_entries").upsert({ business_id: businessId, page_id: pageId, date, amount: v, updated_at: new Date().toISOString() })
  }, [])

  // Batch-write many page+date entries in one update (used to sync summed FB ad-account spend).
  const setMany = useCallback(async (entries: { pageId: string; date: string; value: number }[]) => {
    if (entries.length === 0) return
    setMap(prev => {
      const next = { ...prev }
      for (const e of entries) next[`${e.pageId}|${e.date}`] = e.value
      writeCache(next)
      return next
    })
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    await supabase.from("adspent_entries").upsert(entries.map(e => ({
      business_id: businessId, page_id: e.pageId, date: e.date, amount: e.value, updated_at: new Date().toISOString(),
    })))
  }, [])

  const totalForDate = useCallback(
    (pageIds: string[], date: string) => pageIds.reduce((s, pid) => s + (map[`${pid}|${date}`] ?? 0), 0),
    [map])

  return { map, get, set, setMany, totalForDate }
}
