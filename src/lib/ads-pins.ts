"use client"
import { useCallback, useSyncExternalStore } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"
import { currentUserEmail, currentUserName } from "@/lib/current-user"

// ─────────────────────────────────────────────────────────────────────────────
// PIN TO TOP — ang binabantayan ng KOPONAN, nasa itaas.
//
// ⚠ IBINAHAGI NA AT PERMANENTE (migration 0035, hatol ng may-ari Ago 24 2026:
// "lifetime save na sa pesowise, hindi na nawawala… nakikita namin lahat").
// Binabaligtad nito ang dating pasya na pansarili ang pin: iisang listahan na
// ngayon ang buong koponan. Ang localStorage ay CACHE na lang para may laman
// agad ang unang pintura — ang Supabase ang katotohanan.
//
// IISANG MODULE-LEVEL na store (kapareho ng monitor-store): dalawang talahanayan
// sa iisang pahina at ang Ads Manager ay dapat magkasundo agad, at iisa lang ang
// 60s na poll para sa buong app.
//
// ⚠ OPTIMISTIC ang pindot: tumataas agad ang row, saka isinusulat sa server.
// Kapag pumalya ang sulat, ibinabalik ang lokal na estado — hindi nagsisinungaling
// ang talahanayan tungkol sa naitala.
//
// Kapag HINDI PA tumatakbo ang 0035, bumabalik ito sa dating asal: localStorage
// lang, gumagana pa rin, hindi lang nababahagi.
// ─────────────────────────────────────────────────────────────────────────────

const KEY = "pesowise_ads_pins"          // cache ng pagkakasunod (mga id)
const META_KEY = "pesowise_ads_pins_meta" // cache ng "sino ang nag-pin"

export type PinMeta = { by: string; at: string; level: string; name: string }

type PinState = { order: string[]; meta: Record<string, PinMeta>; loaded: boolean; shared: boolean }
let G: PinState = { order: readCache(), meta: readMeta(), loaded: false, shared: true }
const subs = new Set<() => void>()
const publish = (patch: Partial<PinState>) => { G = { ...G, ...patch }; subs.forEach(f => f()) }

function readCache(): string[] {
  if (typeof window === "undefined") return []
  try { const v = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? v.map(String) : [] }
  catch { return [] }
}
function readMeta(): Record<string, PinMeta> {
  if (typeof window === "undefined") return {}
  try { const v = JSON.parse(localStorage.getItem(META_KEY) || "{}"); return v && typeof v === "object" ? v : {} }
  catch { return {} }
}
function writeCache(order: string[], meta: Record<string, PinMeta>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(order))
    localStorage.setItem(META_KEY, JSON.stringify(meta))
  } catch { /* punong storage — nasa memorya pa rin */ }
}

const missingTable = (e: any) => e && (e.code === "42P01" || /ads_pins/.test(String(e?.message || "")))

let inflight: Promise<void> | null = null
async function refreshShared(): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const businessId = await getBusinessId()
      if (!businessId) { publish({ loaded: true }); return }
      const supabase = createSupabaseBrowserClient()
      const { data, error } = await supabase.from("ads_pins")
        .select("object_id,object_level,object_name,pinned_by_name,created_at")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })   // pinakabago sa itaas
      if (error) {
        // Wala pa ang 0035 — panatilihin ang lokal na listahan at huwag mag-ingay.
        if (missingTable(error)) { publish({ loaded: true, shared: false }); return }
        publish({ loaded: true }); return
      }
      const order = (data || []).map((r: any) => String(r.object_id))
      const meta: Record<string, PinMeta> = {}
      for (const r of data || []) meta[String(r.object_id)] = {
        by: r.pinned_by_name || "", at: r.created_at || "",
        level: r.object_level || "campaign", name: r.object_name || "",
      }
      writeCache(order, meta)
      // Kapareho ng monitor-store: kapag walang nagbago, walang publish — ang
      // bawat publish ay re-render ng bawat talahanayang nakikinig sa pins.
      const same = G.loaded && G.shared
        && JSON.stringify([G.order, G.meta]) === JSON.stringify([order, meta])
      if (!same) publish({ order, meta, loaded: true, shared: true })
      else if (!G.loaded) publish({ loaded: true })
    } finally { inflight = null }
  })()
  return inflight
}

let pollIv: ReturnType<typeof setInterval> | null = null
function subscribe(fn: () => void) {
  subs.add(fn)
  if (!pollIv) {
    void refreshShared()
    // Ang pin ng ibang tao ay lilitaw dito nang hindi nagre-refresh — parehong
    // ritmo ng notification feed at ng comment counts.
    pollIv = setInterval(() => { if (G.shared) void refreshShared() }, 60_000)
    if (typeof window !== "undefined") window.addEventListener("focus", onFocus)
  }
  return () => {
    subs.delete(fn)
    if (subs.size === 0 && pollIv) {
      clearInterval(pollIv); pollIv = null
      if (typeof window !== "undefined") window.removeEventListener("focus", onFocus)
    }
  }
}
const onFocus = () => { if (G.shared) void refreshShared() }

export type PinContext = { level?: string; name?: string; accountId?: string; accountName?: string }

async function toggleShared(id: string, ctx: PinContext = {}) {
  const had = G.order.includes(id)
  const prev = { order: G.order, meta: G.meta }
  // ── Optimistic: tumataas agad ang row ───────────────────────────────────────
  const order = had ? G.order.filter(x => x !== id) : [id, ...G.order]
  const meta = { ...G.meta }
  if (had) delete meta[id]
  else meta[id] = { by: currentUserName() || "", at: new Date().toISOString(), level: ctx.level || "campaign", name: ctx.name || "" }
  writeCache(order, meta)
  publish({ order, meta })

  const businessId = await getBusinessId()
  if (!businessId) return
  const supabase = createSupabaseBrowserClient()
  const { error } = had
    ? await supabase.from("ads_pins").delete().eq("business_id", businessId).eq("object_id", id)
    : await supabase.from("ads_pins").upsert({
      business_id: businessId, object_id: id,
      object_level: ctx.level || "campaign", object_name: ctx.name || "",
      account_id: ctx.accountId || "", account_name: ctx.accountName || "",
      pinned_by_name: currentUserName() || "", pinned_by_email: (currentUserEmail() || "").toLowerCase(),
    }, { onConflict: "business_id,object_id" })
  if (error) {
    // Wala pa ang talahanayan → lokal lang, at iyon ang totoo: nananatili ang
    // optimistic na estado. Ibang error → ibalik, para hindi magsinungaling ang
    // talahanayan tungkol sa naitala.
    if (missingTable(error)) { publish({ shared: false }); return }
    writeCache(prev.order, prev.meta)
    publish(prev)
    return
  }
  await refreshShared()
}

async function clearAllShared() {
  const prev = { order: G.order, meta: G.meta }
  writeCache([], {})
  publish({ order: [], meta: {} })
  const businessId = await getBusinessId()
  if (!businessId) return
  const supabase = createSupabaseBrowserClient()
  const { error } = await supabase.from("ads_pins").delete().eq("business_id", businessId)
  if (error && !missingTable(error)) { writeCache(prev.order, prev.meta); publish(prev) }
  else if (!error) await refreshShared()
}

export function useAdsPins() {
  const state = useSyncExternalStore(subscribe, () => G, () => G)
  const pins = new Set(state.order)
  const toggle = useCallback((id: string, ctx?: PinContext) => { void toggleShared(id, ctx) }, [])
  const clearAll = useCallback(() => { void clearAllShared() }, [])
  const rankOf = useCallback((id: string) => {
    const i = G.order.indexOf(id)
    return i < 0 ? Number.MAX_SAFE_INTEGER : i
  }, [])
  return {
    pins, order: state.order, meta: state.meta, shared: state.shared, loaded: state.loaded,
    toggle, clearAll, rankOf,
    has: (id: string) => pins.has(id),
    /** Sino ang nag-pin nito (blangko kung hindi alam). */
    byOf: (id: string) => state.meta[id]?.by || "",
  }
}

/**
 * Inuuna ang naka-pin, pinapanatili ang loob-na-pagkakasunod ng bawat pangkat.
 * ⚠ Ang sort ay dapat MATATAG: kung hindi, magkakagulo ang pagkakasunod ng
 * hindi naka-pin sa tuwing may magpi-pin.
 */
export function pinnedFirst<T>(rows: T[], idOf: (r: T) => string, pins: Set<string>, order: string[]): T[] {
  if (pins.size === 0) return rows
  const rank = new Map(order.map((id, i) => [id, i]))
  const pinned: T[] = [], rest: T[] = []
  for (const r of rows) (pins.has(idOf(r)) ? pinned : rest).push(r)
  pinned.sort((a, b) => (rank.get(idOf(a)) ?? 0) - (rank.get(idOf(b)) ?? 0))
  return [...pinned, ...rest]
}

/** Kasalukuyang pagkakasunod ng pin — para sa `pinnedFirst`. */
export function pinOrder(): string[] { return G.order }
