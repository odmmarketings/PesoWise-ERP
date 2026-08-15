"use client"
import { useEffect, useState } from "react"
import { cachedJson } from "@/lib/pancake-cache"
import { useActivePages } from "@/lib/pages-store"
import type { FBAccount } from "@/lib/fb-store"

// ─────────────────────────────────────────────────────────────────────────────
// HOUSE MATH ng Facebook Ads — hinugot mula sa ScalingTracker para magamit din
// ng Dashboard nang HINDI minomount ang tracker. Iisa ang pormula sa lahat ng
// tab; kapag dito mo binago, sabay-sabay silang magbabago.
// ─────────────────────────────────────────────────────────────────────────────

export const VAT = 1.12
/** Net ROAS = value × (1 − RTS ng page) ÷ (spend × 1.12). Ito ang batayan ng kill/scale. */
export const netOf = (value: number, spend: number, rts: number) =>
  spend > 0 ? (value * (1 - rts)) / (spend * VAT) : 0

// Parehong localStorage key at defaults ng Rules panel sa tracker — ang
// binago ng user doon ay dapat makita rin ng Dashboard.
export type HouseRules = {
  scaleRoas: number; scaleDays: number; minDailySpend: number
  killRoas: number; noSalesHour: number; evalMinSpend: number
  bleedRoas: number; bleedSpend: number; cppMax: number
}
const DEFAULT_HOUSE: HouseRules = {
  scaleRoas: 3.9, scaleDays: 3, minDailySpend: 500,
  killRoas: 2.8, noSalesHour: 9, evalMinSpend: 300,
  bleedRoas: 1.5, bleedSpend: 2000, cppMax: 250,
}
export function loadHouseRules(): HouseRules {
  if (typeof window === "undefined") return DEFAULT_HOUSE
  try { return { ...DEFAULT_HOUSE, ...JSON.parse(localStorage.getItem("pesowise_scaling_rules") || "{}") } }
  catch { return DEFAULT_HOUSE }
}

const dstr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

async function mapLimit<T>(items: T[], limit: number, fn: (i: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) await fn(items[i++]) }))
}

/**
 * RTS rate kada PAGE (returning+returned ÷ total, huling 31 araw) — ang input
 * ng net ROAS. ⚠ SADYANG KAPAREHO ang URL ng hila sa ScalingTracker, para ang
 * `cachedJson` ay IISANG cache entry lang: ang pagbukas ng Dashboard ay hindi
 * na humihila kung nadaanan na ang Testing/Scaling (at vice versa).
 */
export function usePageRts(accounts: FBAccount[]) {
  const allPages = useActivePages()
  const [map, setMap] = useState<Map<string, number>>(new Map())
  const namesKey = Array.from(new Set(accounts.map(a => a.page_name).filter(Boolean))).sort().join(",")

  useEffect(() => {
    if (!namesKey) return
    let alive = true
    ;(async () => {
      const today = dstr(new Date())
      const d = new Date(); d.setDate(d.getDate() - 30)
      const from31 = dstr(d)
      const out = new Map<string, number>()
      await mapLimit(namesKey.split(","), 4, async name => {
        const pg = allPages.find(p => p.name === name && p.api_key && (p.pancake_page_id || p.shop_id))
        if (!pg) return   // walang Pancake creds → gross ang gagamitin (rate 0)
        try {
          const j = await cachedJson(
            `/api/pancake/orders?api_key=${encodeURIComponent(pg.api_key)}&page_id=${encodeURIComponent(pg.pancake_page_id || pg.shop_id)}`
            + `&from=${from31}&to=${today}&phase=fast`)
          const s = j.statusSales || {}
          const total = Number(s.total || 0)
          if (total > 0) out.set(name, Math.min(0.9, (Number(s.returning || 0) + Number(s.returned || 0)) / total))
        } catch { /* walang RTS → 0; hayag sa UI na gross ang fallback */ }
      })
      if (alive) setMap(out)
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey, allPages.length])

  return map
}
