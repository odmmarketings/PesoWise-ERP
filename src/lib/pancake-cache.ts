"use client"

// ──────────────────────────────────────────────────────────────────────────────
// PANCAKE RESPONSE CACHE (client-side, module-level).
//
// ANG PROBLEMA: bawat pagbisita sa isang tab ay muling humihila sa Pancake, kaya
// paulit-ulit ang loading spinner kahit kababalik lang. Mabagal ito at nakakainis.
//
// ANG SOLUSYON: isang Map na nakatira sa module. Sa Next.js App Router, buhay ang
// module habang nag-na-navigate sa loob ng app — kaya ang unang bisita lang ang
// naglo-load, at ang pagbalik ay INSTANT. Nabubura lang ito kapag hard refresh ng
// buong site (o pagpindot ng Refresh button) — eksaktong inaasahang asal.
//
// Ang server route ay may sariling 60s cache; ito ay para sa bawat browser tab.
// ──────────────────────────────────────────────────────────────────────────────

type Entry = { ts: number; data: any }
const CACHE = new Map<string, Entry>()
const INFLIGHT = new Map<string, Promise<any>>()
const DEFAULT_TTL = 15 * 60_000   // 15 minuto

// Ilang page ang sabay na hihilahin. Napatunayan sa live: 40s ang median ng isang
// `phase=rows` na tawag, kaya sa 3 lang ay 13 MINUTO bago matapos ang 22 pages.
// Isa itong lugar para mapalitan — huwag nang magkalat ng magic number sa bawat page.
export const PANCAKE_CONCURRENCY = 8

// Walang timeout dati, kaya kapag hindi sumagot ang Pancake ay HABAMBUHAY na naka-
// spinner ang page (walang error, walang laman — mukhang sira). Ito ang huling
// depensa: pinipilit nitong matapos ang bawat tawag, panalo man o talo.
const DEFAULT_TIMEOUT = 60_000    // 60 segundo

// Ang `nocache=1` ay para lang sa server — hindi dapat ito gumawa ng hiwalay na entry,
// kung hindi mananatiling luma ang normal na susi pagkatapos ng Refresh.
const keyOf = (url: string) => url.replace(/([?&])nocache=1&?/, "$1").replace(/[?&]$/, "")

/**
 * Fetch na may cache. Ibinabalik ang JSON.
 * @param force  laktawan ang cache (Refresh button) at palitan ang laman nito
 */
export async function cachedJson(url: string, opts?: { force?: boolean; ttl?: number; timeout?: number }): Promise<any> {
  const key = keyOf(url)
  const ttl = opts?.ttl ?? DEFAULT_TTL
  const timeout = opts?.timeout ?? DEFAULT_TIMEOUT

  if (!opts?.force) {
    const hit = CACHE.get(key)
    if (hit && Date.now() - hit.ts < ttl) return hit.data
    // Kung may kaparehong request na tumatakbo, sabayan na lang — iwas dobleng hila
    // kapag maraming component ang sabay na humihingi ng parehong datos.
    const flying = INFLIGHT.get(key)
    if (flying) return flying
  }

  const p = (async () => {
    let res: Response
    try {
      res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeout) })
    } catch (e: any) {
      // Sinasalo ang abort para maging malinaw na mensahe imbes na "signal is aborted".
      if (e?.name === "TimeoutError" || e?.name === "AbortError") {
        throw new Error(`timeout — hindi sumagot ang Pancake sa loob ng ${Math.round(timeout / 1000)}s`)
      }
      throw e
    }
    const json = await res.json().catch(() => null)
    if (!res.ok || !json || json.success === false) {
      throw new Error(json?.error || `HTTP ${res.status}`)
    }
    CACHE.set(key, { ts: Date.now(), data: json })
    return json
  })()

  INFLIGHT.set(key, p)
  try { return await p } finally { INFLIGHT.delete(key) }
}

/** Burahin ang buong cache (hal. kapag nagpalit ng business o nag-logout). */
export function clearPancakeCache() { CACHE.clear(); INFLIGHT.clear() }

/** May sariwang kopya ba nito? Pang-decide kung dapat pang magpakita ng spinner. */
export function isCached(url: string, ttl = DEFAULT_TTL): boolean {
  const hit = CACHE.get(keyOf(url))
  return !!hit && Date.now() - hit.ts < ttl
}
