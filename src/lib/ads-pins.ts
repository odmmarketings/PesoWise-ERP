"use client"
import { useCallback, useEffect, useState } from "react"

// ─────────────────────────────────────────────────────────────────────────────
// PIN TO TOP — ang mga binabantayan mo ngayon, nasa itaas.
//
// ⚠ SADYANG LOCAL, hindi Supabase. Ang pin ay PANSARILING kaayusan ng
// talahanayan — kung ano ang binabantayan MO ngayong linggo. Kung ibinahagi
// ito, magkakagulo ang tatlong buyer sa iisang listahan: iaangat ng isa,
// ibababa ng isa. Local din ang ibig sabihin ay walang bagong migration na
// kailangang patakbuhin at walang round trip kapag pinindot — kapag na-pin,
// tumataas agad.
//
// Ang id ng Meta object ang susi, kaya gumagana ito sa campaign, ad set at ad
// nang walang hiwalay na listahan bawat antas.
// ─────────────────────────────────────────────────────────────────────────────

const KEY = "pesowise_ads_pins"

function read(): string[] {
  if (typeof window === "undefined") return []
  try { const v = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? v.map(String) : [] }
  catch { return [] }
}
function write(ids: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(ids)) } catch {}
  // Ang parehong tab ay maaaring may dalawang talahanayan (hal. drill-down),
  // kaya nag-aabiso tayo sa loob ng tab na ito — hindi lang sa ibang tab.
  try { window.dispatchEvent(new CustomEvent("pesowise-pins")) } catch {}
}

export function useAdsPins() {
  const [pins, setPins] = useState<Set<string>>(() => new Set(read()))

  useEffect(() => {
    const sync = () => setPins(new Set(read()))
    window.addEventListener("pesowise-pins", sync)
    window.addEventListener("storage", sync)   // ibang tab
    return () => {
      window.removeEventListener("pesowise-pins", sync)
      window.removeEventListener("storage", sync)
    }
  }, [])

  const toggle = useCallback((id: string) => {
    const next = read()
    const i = next.indexOf(id)
    // Ang BAGONG pin ay napupunta sa UNAHAN — ang huling pinili mo ang
    // pinakamataas, gaya ng inaasahan kapag nag-pin ka habang nagtatrabaho.
    if (i >= 0) next.splice(i, 1); else next.unshift(id)
    write(next)
    setPins(new Set(next))
  }, [])

  const clearAll = useCallback(() => { write([]); setPins(new Set()) }, [])

  /** Ang pagkakasunod ng pin — mas maaga sa listahan = mas mataas. */
  const rankOf = useCallback((id: string) => {
    const arr = Array.from(pins)
    const i = read().indexOf(id)
    return i < 0 ? Number.MAX_SAFE_INTEGER : i
  }, [pins])

  return { pins, toggle, clearAll, rankOf, has: (id: string) => pins.has(id) }
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
export function pinOrder(): string[] { return read() }
