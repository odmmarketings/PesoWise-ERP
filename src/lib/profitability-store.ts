"use client"
import { useEffect, useRef, useState } from "react"
import { getEcomSetting, setEcomSetting, type EcomSettingColumn } from "@/lib/ecom-settings"

// ──────────────────────────────────────────────────────────────────────────────
// Profitability Formula calculator inputs — shared across the team via the
// `ecommerce_settings` row (one JSONB column per input set). localStorage stays as a
// same-session read cache for instant paint; Supabase writes are debounced because the
// calculator persists live on every keystroke. Existing localStorage inputs are
// migrated up once on first load.
// ──────────────────────────────────────────────────────────────────────────────

export function usePersistedInputs<T extends object>(storageKey: string, column: EcomSettingColumn, defaults: T) {
  const [value, setValue] = useState<T>(defaults)
  const [loaded, setLoaded] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cached: Partial<T> | null = null
    try { const raw = localStorage.getItem(storageKey); if (raw) cached = JSON.parse(raw) } catch {}
    if (cached) setValue({ ...defaults, ...cached })
    setLoaded(true)
    ;(async () => {
      const remote = await getEcomSetting<Partial<T>>(column)
      if (remote && Object.keys(remote).length > 0) {
        setValue({ ...defaults, ...remote })
        try { localStorage.setItem(storageKey, JSON.stringify(remote)) } catch {}
      } else if (cached && Object.keys(cached).length > 0) {
        await setEcomSetting(column, cached)   // one-time migration of this browser's inputs
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist on change: cache immediately, Supabase debounced.
  useEffect(() => {
    if (!loaded) return
    try { localStorage.setItem(storageKey, JSON.stringify(value)) } catch {}
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { setEcomSetting(column, value) }, 800)
    return () => { if (timer.current) clearTimeout(timer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, loaded])

  return [value, setValue, loaded] as const
}
