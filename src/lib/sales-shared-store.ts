"use client"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"

// ──────────────────────────────────────────────────────────────────────────────
// Sales Tracker shared maps (previously direct-localStorage in sales/page.tsx):
//   • J&T shipping fees imported from Excel, keyed by tracking number — also read by
//     the Finance Income Statement for the Shipping Fee line.
//   • Per-order pre-upsell baseline snapshots (Pancake keeps no "previous amount", so
//     the tracker captures each order's total before it gets an upsell tag).
// Source of truth = Supabase `jnt_shipping_fees` / `order_baselines` (one row per
// entry); localStorage stays a same-session read cache and is migrated up once on
// first load. Fetches are paged because both maps can exceed PostgREST's 1000-row cap.
// ──────────────────────────────────────────────────────────────────────────────

const JNT_KEY = "pesowise_jnt_shipping_fees"
const BASELINE_KEY = "pesowise_order_baseline"
const PAGE = 1000
const WRITE_CHUNK = 500

function readCacheMap(key: string): Record<string, number> {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : {} } catch { return {} }
}
function writeCacheMap(key: string, map: Record<string, number>) {
  try { localStorage.setItem(key, JSON.stringify(map)) } catch {}
}

async function pagedRows(table: string, cols: string, businessId: string): Promise<any[]> {
  const supabase = createSupabaseBrowserClient()
  const out: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(cols).eq("business_id", businessId).range(from, from + PAGE - 1)
    if (error || !data) break
    out.push(...data)
    if (data.length < PAGE) break
  }
  return out
}

async function upsertMap(table: string, keyCol: string, valCol: string, map: Record<string, number>, cacheKey: string) {
  const entries = Object.entries(map)
  if (entries.length === 0) return
  const businessId = await getBusinessId()
  if (!businessId) return
  const supabase = createSupabaseBrowserClient()
  const now = new Date().toISOString()
  const rows = entries.map(([k, v]) => ({ business_id: businessId, [keyCol]: k, [valCol]: Number(v) || 0, updated_at: now }))
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    await supabase.from(table).upsert(rows.slice(i, i + WRITE_CHUNK))
  }
  writeCacheMap(cacheKey, { ...readCacheMap(cacheKey), ...map })
}

async function fetchMap(table: string, keyCol: string, valCol: string, cacheKey: string): Promise<Record<string, number>> {
  const businessId = await getBusinessId()
  if (!businessId) return readCacheMap(cacheKey)
  const rows = await pagedRows(table, `${keyCol}, ${valCol}`, businessId)
  if (rows.length === 0) {
    // One-time migration: push this browser's existing localStorage map up.
    const cached = readCacheMap(cacheKey)
    if (Object.keys(cached).length > 0) {
      await upsertMap(table, keyCol, valCol, cached, cacheKey)
      return cached
    }
  }
  const map: Record<string, number> = {}
  for (const r of rows) map[r[keyCol]] = Number(r[valCol]) || 0
  writeCacheMap(cacheKey, map)
  return map
}

// ── J&T shipping fees ({ [trackingNo]: fee }) ────────────────────────────────
export function fetchJntFees() { return fetchMap("jnt_shipping_fees", "tracking_no", "fee", JNT_KEY) }
export function upsertJntFees(map: Record<string, number>) { return upsertMap("jnt_shipping_fees", "tracking_no", "fee", map, JNT_KEY) }

// ── Pre-upsell order baselines ({ [`${pageId}-${orderId}`]: amount }) ────────
export function fetchOrderBaselines() { return fetchMap("order_baselines", "order_uid", "amount", BASELINE_KEY) }
export function upsertOrderBaselines(map: Record<string, number>) { return upsertMap("order_baselines", "order_uid", "amount", map, BASELINE_KEY) }
