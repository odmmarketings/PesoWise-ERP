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
  // ⚠ TINANGGAL ANG CACHE→DB NA BACKFILL (Ago 20 2026). Dati: kapag walang
  // laman ang talahanayan, ina-upload pabalik ang laman ng localStorage ng
  // browser na ito — one-time na daan noong paglipat sa Supabase. Pero ginagawa
  // nitong IMPOSIBLENG burahin ang isang talahanayan: ang inventory reset ng
  // may-ari ay bubuhaying muli ng UNANG makinang may lumang cache na magbubukas
  // ng pahina, at mukhang hindi tumalab ang pagbura. Tapos na ang paglipat —
  // buwan nang nagsi-sync ang lahat ng makina. Ang walang laman na talahanayan
  // ay SAGOT na ngayon, hindi pagkakamaling itatama. (Ang `readCache` na param
  // ay iniwan sa lagda para hindi magalaw ang walong tumatawag.)
  void readCache
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

/**
 * DELTA sa isang numerong hanay — HINDI absolute na upsert. Ang absolute na
 * sulat mula sa kliyente ay nagpapatungan sa pagitan ng mga device (parehong
 * nagbasa ng 100, nagsulat ng 101 at 102 — nawala ang isang bawas) at kayang
 * i-urong ng lumang cache ang server. Dito ang SERVER ang nagdadagdag:
 *   1. RPC (migration 0033) — atomic, ito ang tunay na ayos.
 *   2. Kapag wala pa ang function: basahin ang kasalukuyang halaga sa server
 *      at isulat LANG ang hanay na iyon — makitid ang bintana (isang round
 *      trip) at hindi na nadadala ang buong lumang row.
 * Hindi bumababa sa zero — kapareho ng dating asal ng restock.
 */
export async function applyCounterDeltas(
  table: string, column: string, rpcName: string,
  deltas: { id: string; delta: number }[],
): Promise<void> {
  const real = deltas.filter(d => d.delta !== 0)
  if (real.length === 0) return
  const supabase = createSupabaseBrowserClient()
  const { error } = await supabase.rpc(rpcName, { deltas: real })
  if (!error) return
  for (const d of real) {
    const { data } = await supabase.from(table).select(column).eq("id", d.id).maybeSingle()
    if (!data) continue
    const cur = Number((data as unknown as Record<string, unknown>)[column]) || 0
    await supabase.from(table).update({ [column]: Math.max(0, cur + d.delta) }).eq("id", d.id)
  }
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
