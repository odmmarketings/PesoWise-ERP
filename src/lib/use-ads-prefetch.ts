"use client"
import { useEffect } from "react"
import { useFBAccounts } from "@/lib/fb-store"
import { prefetchMgrLevel, prefetchDashboard, warmTrackerServerCache } from "@/lib/ads-cache"

// ─────────────────────────────────────────────────────────────────────────────
// PREFETCH NG FACEBOOK ADS — nagsisimula sa PAGBUKAS NG APP, kahit nasa ibang
// pahina ka. Pagpindot mo sa tab, puno na ang cache: walang spinner.
//
// ⚠ ANG PANGANIB DITO AY ANG RATE LIMIT (FB error #17). Ang buong prefetch ay
// ~150 request sa 21 account. Kaya:
//   • ISANG BESES kada page-load (module flag) — hindi kada navigation.
//   • MAY PAGKAKASUNOD: ang unang pipindutin ang unang hinihila.
//   • MABABANG concurrency (2) at may hinto sa pagitan ng bawat yugto, kaya
//     hindi ito nakikipag-agawan sa pahinang binubuksan mo ngayon.
//   • Naghihintay ng `requestIdleCallback` — pagkatapos munang matapos ang
//     tunay na trabaho ng kasalukuyang pahina.
// Ang bawat yugto ay lumalaktaw sa account na sariwa na ang cache, kaya ang
// pangalawang page-load sa loob ng 30 minuto ay halos walang hinihila.
// ─────────────────────────────────────────────────────────────────────────────

let started = false   // buhay habang buhay ang tab — reset lang sa tunay na reload

const idle = (fn: () => void, timeout = 3000) => {
  if (typeof window === "undefined") return
  const ric = (window as any).requestIdleCallback
  if (ric) ric(fn, { timeout }); else setTimeout(fn, 1200)
}
const pause = (ms: number) => new Promise(res => setTimeout(res, ms))
const dstr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

/** Ang `toRow` ng Dashboard ay nasa page module; sapat ang hilaw na hugis dito. */
const passthroughRow = (c: any, accountId: string, accountName: string, accountOwner: string) =>
  ({ ...c, accountId, accountName, accountOwner })

/**
 * Walang isinusulat sa screen — nakakabit lang sa app layout para may tumakbong
 * prefetch mula sa PAGBUKAS ng app. Component ito (hindi tawag sa layout mismo)
 * para maging kondisyonal ang pag-mount: pagkatapos lang ng auth.
 */
export function AdsPrefetcher(): null {
  useAdsPrefetch()
  return null
}

export function useAdsPrefetch() {
  const fb = useFBAccounts()
  const ready = fb.accounts.filter(a => !a.archived && a.ad_account_id && a.token)
  const key = ready.map(a => a.id).sort().join(",")

  useEffect(() => {
    if (started || !key) return
    started = true

    idle(() => {
      void (async () => {
        const today = dstr(new Date())
        const d31 = new Date(); d31.setDate(d31.getDate() - 30)
        const from31 = dstr(d31)

        // Ang pagkakasunod ay pagkakasunod ng malamang na pindutin.
        // 1. Ads Manager campaigns — ito ang unang laman ng tab na iyon.
        await prefetchMgrLevel(ready, today, today, "campaign"); await pause(400)
        // 2. Dashboard — ito ang unang tab, pero madalas ay puno na ito ng
        //    sarili niyang hila kapag doon ka nag-land; ang skip ay mura.
        await prefetchDashboard(ready, today, today, passthroughRow); await pause(400)
        // 3. Scaling + Monitoring — IISANG cache entry sila (parehong campaign
        //    level at parehong petsa), kaya isang yugto lang ang dalawa.
        await warmTrackerServerCache(ready, from31, today, "campaign"); await pause(600)
        // 4. Ads Manager ad sets, saka ang Testing (ad-set level din).
        await prefetchMgrLevel(ready, today, today, "adset"); await pause(400)
        await warmTrackerServerCache(ready, from31, today, "adset"); await pause(600)
        // 5. Ads — pinakamalaki at pinakabihirang buksan, kaya huli.
        await prefetchMgrLevel(ready, today, today, "ad")
      })()
    })
  }, [key, ready])
}
