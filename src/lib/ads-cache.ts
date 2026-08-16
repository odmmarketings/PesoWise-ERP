"use client"
import { actId, type FBAccount } from "@/lib/fb-store"

// ─────────────────────────────────────────────────────────────────────────────
// MGA CACHE NG FACEBOOK ADS — dating nasa loob ng `ads/facebook/page.tsx`.
// Inilipat dito para may MAKAKAABOT sa kanila bago pa mabuksan ang pahina:
// ang prefetcher sa app layout ay nagpupuno na ng mga ito habang nasa ibang
// pahina ka, kaya ang unang pindot sa tab ay walang hihintayin.
//
// TTL = kailan HIHILA ULIT, hindi kung ano ang IPAPAKITA. Ang pagpapakita ay
// laging kumukuha sa cache anuman ang edad (stale-while-revalidate).
// ─────────────────────────────────────────────────────────────────────────────

export const MGR_TTL = 30 * 60_000
export const DASH_TTL = 30 * 60_000

export type MgrCached = { ts: number; rows: any[] }
export const MGR_CACHE = new Map<string, MgrCached>()
export const MGR_INFLIGHT = new Map<string, Promise<any[]>>()

export type DashPart = {
  rows: any[]
  trend: { date: string; spend: number; sales: number }[]
  daily: { date: string; accountName: string; owner: string; status: string; budget: number; spend: number }[]
  spendByDate: Record<string, number>
}
export const DASH_CACHE = new Map<string, { ts: number; part: DashPart }>()
export const DASH_INFLIGHT = new Map<string, Promise<DashPart>>()

export const LVL_CACHE = new Map<string, { ts: number; rows: any[] }>()
export const LVL_INFLIGHT = new Map<string, Promise<any[]>>()

export const mgrKey = (level: string, from: string, to: string, accountId: string) => `${level}|${from}|${to}|${accountId}`
export const dashKey = (accountId: string, from: string, to: string) => `${accountId}|${from}|${to}`

/** May sariwang laman ba? Para sa prefetcher — huwag nang ulitin ang alam na. */
const fresh = (ts: number, ttl: number) => Date.now() - ts < ttl

async function mapLimit<T>(items: T[], limit: number, fn: (i: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) await fn(items[i++]) }))
}

/**
 * Hinihila ang isang antas ng Ads Manager para sa mga account na kulang.
 * Kaparehong-kapareho ng hila ng pahina, at ISANG cache ang pinupuno — kaya
 * kapag binuksan mo ang tab, wala nang gagawin.
 */
export async function prefetchMgrLevel(accounts: FBAccount[], from: string, to: string, level: "campaign" | "adset" | "ad", concurrency = 2) {
  const missing = accounts.filter(a => {
    const h = MGR_CACHE.get(mgrKey(level, from, to, a.id))
    return !(h && fresh(h.ts, MGR_TTL))
  })
  await mapLimit(missing, concurrency, async a => {
    const k = mgrKey(level, from, to, a.id)
    if (MGR_INFLIGHT.has(k)) { await MGR_INFLIGHT.get(k)!.catch(() => null); return }
    const acct = actId(a.ad_account_id)
    const run = (async () => {
      const j = await fetch(`/api/fb/insights?rich=1&level=${level}&parent=${encodeURIComponent(acct)}`
        + `&token=${encodeURIComponent(a.token)}&account_id=${encodeURIComponent(acct)}&from=${from}&to=${to}`).then(r => r.json())
      const rows = j.success ? (j.rows || []).map((r: any) => ({ ...r, __accId: a.id })) : []
      MGR_CACHE.set(k, { ts: Date.now(), rows })
      return rows
    })()
    MGR_INFLIGHT.set(k, run)
    try { await run } catch { /* laktawan ang pumalyang account */ }
    finally { MGR_INFLIGHT.delete(k) }
  })
}

/** Ang tatlong hila ng Dashboard / Daily Ad Spend kada account. */
export async function prefetchDashboard(accounts: FBAccount[], from: string, to: string, toRow: (c: any, id: string, name: string, owner: string) => any, concurrency = 2) {
  const missing = accounts.filter(a => {
    const h = DASH_CACHE.get(dashKey(a.id, from, to))
    return !(h && fresh(h.ts, DASH_TTL))
  })
  await mapLimit(missing, concurrency, async a => {
    const k = dashKey(a.id, from, to)
    if (DASH_INFLIGHT.has(k)) { await DASH_INFLIGHT.get(k)!.catch(() => null); return }
    const run = (async (): Promise<DashPart> => {
      const q = `token=${encodeURIComponent(a.token)}&account_id=${encodeURIComponent(actId(a.ad_account_id))}&from=${from}&to=${to}`
      const [rc, tr, db] = await Promise.all([
        fetch(`/api/fb/insights?rich=1&${q}`).then(r => r.json()),
        fetch(`/api/fb/insights?trend=1&${q}`).then(r => r.json()),
        fetch(`/api/fb/insights?${q}`).then(r => r.json()),
      ])
      const acctBudget = (rc.campaigns || []).filter((c: any) => /active/i.test(c.status)).reduce((s: number, c: any) => s + (c.budget || 0), 0)
      const part: DashPart = { rows: [], trend: [], daily: [], spendByDate: {} }
      if (rc.success) for (const c of rc.campaigns) part.rows.push(toRow(c, a.id, a.name, a.owner))
      if (tr.success) for (const d of tr.trend) part.trend.push({ date: d.date, spend: d.spend, sales: d.sales })
      if (db.success) for (const [d, amt] of Object.entries(db.byDate || {})) {
        part.daily.push({ date: d, accountName: a.name, owner: a.owner, status: a.status, budget: acctBudget, spend: amt as number })
        part.spendByDate[d] = amt as number
      }
      DASH_CACHE.set(k, { ts: Date.now(), part })
      return part
    })()
    DASH_INFLIGHT.set(k, run)
    try { await run } catch { /* pareho */ }
    finally { DASH_INFLIGHT.delete(k) }
  })
}

/**
 * Ang mabibigat na hila ng Testing/Scaling/Monitoring. Ang cache ng mga ito ay
 * nasa loob ng ScalingTracker (may sariling hugis ng modelo), kaya HINDI natin
 * pinupuno ang client cache dito — pinapainit natin ang SERVER cache ng
 * `/api/fb/insights` sa parehong URL. Ang totoong hila mamaya ay babalik agad.
 */
export async function warmTrackerServerCache(accounts: FBAccount[], from31: string, today: string, level: "campaign" | "adset", concurrency = 2) {
  await mapLimit(accounts, concurrency, async a => {
    const acct = actId(a.ad_account_id)
    const base = `token=${encodeURIComponent(a.token)}&account_id=${acct}&from=${from31}&to=${today}`
    try {
      await Promise.all([
        fetch(`/api/fb/insights?series=1&level=${level}&${base}`).then(r => r.json()),
        fetch(`/api/fb/insights?rich=1&level=${level}&parent=${acct}&${base}`).then(r => r.json()),
      ])
    } catch { /* pampainit lang — hindi mahalaga kung pumalya */ }
  })
}
