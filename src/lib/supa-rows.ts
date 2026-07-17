"use client"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"

// ──────────────────────────────────────────────────────────────────────────────
// Generic row-list backing for the Logistics stores: Supabase table = source of
// truth, localStorage = same-session read cache for instant paint. When the table
// is still empty, this browser's existing cache rows are uploaded once (ids
// preserved). Mutations commit locally first (all the logistics call sites are
// synchronous / fire-and-forget) and write to Supabase in the background.
// ──────────────────────────────────────────────────────────────────────────────

export async function fetchRows<T extends { id: string }>(
  table: string,
  normalize: (r: any) => T,
  readCache: () => T[],
  writeCache: (l: T[]) => void,
): Promise<T[] | null> {
  const businessId = await getBusinessId()
  if (!businessId) return null
  const supabase = createSupabaseBrowserClient()
  const { data, error } = await supabase.from(table).select("*").eq("business_id", businessId).order("inserted_at", { ascending: false })
  if (error || !data) return null
  if (data.length === 0) {
    // One-time migration: push this browser's existing localStorage rows up.
    const cached = readCache()
    if (cached.length > 0) {
      await supabase.from(table).insert(cached.map(r => ({ business_id: businessId, ...r })))
      return cached
    }
  }
  const list = data.map(normalize)
  writeCache(list)
  return list
}

export function writeRow(table: string, row: { id: string }) {
  void (async () => {
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    await supabase.from(table).upsert({ business_id: businessId, ...row })
  })()
}

export function writeManyRows(table: string, rows: { id: string }[]) {
  if (rows.length === 0) return
  void (async () => {
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    for (let i = 0; i < rows.length; i += 200) {
      await supabase.from(table).upsert(rows.slice(i, i + 200).map(r => ({ business_id: businessId, ...r })))
    }
  })()
}

export function deleteRowById(table: string, id: string) {
  void (async () => {
    const supabase = createSupabaseBrowserClient()
    await supabase.from(table).delete().eq("id", id)
  })()
}

export function deleteRowsByIds(table: string, ids: string[]) {
  if (ids.length === 0) return
  void (async () => {
    const supabase = createSupabaseBrowserClient()
    await supabase.from(table).delete().in("id", ids)
  })()
}

// One settings row per business with a JSONB column per concern (same idea as
// ecommerce_settings) — column-targeted upserts never clobber the other columns.
export async function getSettingBlob<T>(table: string, column: string): Promise<T | null> {
  const businessId = await getBusinessId()
  if (!businessId) return null
  const supabase = createSupabaseBrowserClient()
  const { data, error } = await supabase.from(table).select(column).eq("business_id", businessId).maybeSingle()
  if (error || !data) return null
  return ((data as unknown as Record<string, unknown>)[column] as T) ?? null
}

export function setSettingBlob(table: string, column: string, value: unknown) {
  void (async () => {
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    await supabase.from(table).upsert(
      { business_id: businessId, [column]: value, updated_at: new Date().toISOString() },
      { onConflict: "business_id" }
    )
  })()
}
