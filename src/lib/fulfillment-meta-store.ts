"use client"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"

// ──────────────────────────────────────────────────────────────────────────────
// Fulfillment warehouse annotations, keyed by Pancake ORDER id (packer / shift /
// packed date / RTS tracking / status & tracking overrides / remarks / last-edit
// stamps — Pancake has no packer concept, so these live on our side). Source of
// truth = Supabase `fulfillment_meta` (one row per order id); localStorage stays a
// same-session read cache and is migrated up once on first load.
// ──────────────────────────────────────────────────────────────────────────────

const KEY = "pesowise_fulfillment_meta"
const PAGE = 1000

function readCache<T>(): Record<string, T> {
  if (typeof window === "undefined") return {}
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") } catch { return {} }
}
export function cacheFulfillmentMeta<T>(map: Record<string, T>) {
  try { localStorage.setItem(KEY, JSON.stringify(map)) } catch {}
}

// Background row-level upsert of specific order ids (idempotent).
export function upsertFulfillmentMeta<T>(entries: Record<string, T>) {
  const list = Object.entries(entries)
  if (list.length === 0) return
  void (async () => {
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    const now = new Date().toISOString()
    for (let i = 0; i < list.length; i += 200) {
      await supabase.from("fulfillment_meta").upsert(list.slice(i, i + 200).map(([order_id, meta]) => ({
        business_id: businessId, order_id, meta, updated_at: now,
      })))
    }
  })()
}

export async function fetchFulfillmentMeta<T>(): Promise<Record<string, T> | null> {
  const businessId = await getBusinessId()
  if (!businessId) return null
  const supabase = createSupabaseBrowserClient()
  const out: Record<string, T> = {}
  let total = 0
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from("fulfillment_meta").select("order_id, meta").eq("business_id", businessId).range(from, from + PAGE - 1)
    if (error || !data) return null
    for (const r of data) out[r.order_id] = (r.meta || {}) as T
    total += data.length
    if (data.length < PAGE) break
  }
  if (total === 0) {
    // One-time migration: push this browser's existing localStorage map up.
    const cached = readCache<T>()
    if (Object.keys(cached).length > 0) { upsertFulfillmentMeta(cached); return cached }
  }
  cacheFulfillmentMeta(out)
  return out
}
