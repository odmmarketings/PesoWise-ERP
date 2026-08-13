"use client"
import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import {
  TrendingUp, Skull, Eye, Flame, RefreshCw, Settings, Sparkles, Send,
  ChevronDown, ChevronUp, Pause, Undo2, AlertTriangle, ArrowUp, ArrowDown, Check, Plus, X, LayoutGrid, Layers,
} from "lucide-react"
import { useActivePages } from "@/lib/pages-store"
import { actId, type FBAccount } from "@/lib/fb-store"
import { cachedJson } from "@/lib/pancake-cache"
import { useScalingRegistry, type Registration, type ScaleEvent } from "@/lib/scaling-registry-store"

// ─────────────────────────────────────────────────────────────────────────────
// SCALING TRACKER — nasa loob ng Facebook Ads tab.
//
// MGA DESISYON NG MAY-ARI (Ago 14 2026):
//   • Suggest-only ang default; may auto-pause na maaaring buksan kada rule.
//   • NET ROAS ang batayan: value × (1 − RTS rate ng page) ÷ (spend × 1.12).
//     Ang RTS rate ay kada PAGE sa parehong 30-araw na window (hindi kada ad
//     set — walang per-adset RTS ang Pancake; hayagang sinasabi ito sa UI).
//   • AD SET ang antas ng scale/kill; kada AD ang fatigue.
//   • Ready to scale = net ROAS ≥ 3.9 sa 3+ magkakasunod na araw na may spend.
//
// LIMITASYON NA SADYANG HAYAG: ang auto-pause ay tumatakbo lang kapag BUKAS ang
// tab na ito (client-side). Ang naka-schedule na 9AM/11PM na bantay ay ang
// scripts/scaling-alerts.mjs — nag-aabiso sa Discord, hindi nagpa-pause.
// ─────────────────────────────────────────────────────────────────────────────

const VAT = 1.12
const RULES_KEY = "pesowise_scaling_rules"
const AUTOLOG_KEY = "pesowise_scaling_autolog"

type Rules = {
  scaleRoas: number; scaleDays: number; minDailySpend: number
  killRoas: number; noSalesHour: number; evalMinSpend: number
  bleedRoas: number; bleedSpend: number; cppMax: number
  autoMaster: boolean; autoRules: { lowRoas: boolean; noSales: boolean; bleeding: boolean }
  autoDailyCap: number
}
const DEFAULT_RULES: Rules = {
  scaleRoas: 3.9, scaleDays: 3, minDailySpend: 500,
  killRoas: 2.8, noSalesHour: 9, evalMinSpend: 300,
  bleedRoas: 1.5, bleedSpend: 2000, cppMax: 250,
  autoMaster: false, autoRules: { lowRoas: false, noSales: false, bleeding: false },
  autoDailyCap: 5,
}
function loadRules(): Rules {
  try { return { ...DEFAULT_RULES, ...JSON.parse(localStorage.getItem(RULES_KEY) || "{}") } } catch { return DEFAULT_RULES }
}

type Daily = { date: string; spend: number; purchases: number; purchaseValue: number; impressions: number; clicks: number }
type AdsetModel = {
  id: string; name: string; campaignName: string
  campaignId: string
  account: FBAccount
  status: string
  budget: number            // sariling budget ng ad set (ABO). 0 = CBO.
  campaignBudget: number    // budget ng campaign (CBO). Dito ang hawak kapag 0 ang taas.
  createdTime: string       // ISO mula kay Meta — pinakabago ang una sa picker
  rtsRate: number
  dailies: Map<string, Daily>
}
/** Saan itataas ang budget: sa ad set (ABO) o sa campaign (CBO)? */
function budgetTarget(m: AdsetModel): { level: "adset" | "campaign" | "none"; id: string; amount: number } {
  if (m.budget > 0) return { level: "adset", id: m.id, amount: m.budget }
  if (m.campaignBudget > 0) return { level: "campaign", id: m.campaignId, amount: m.campaignBudget }
  return { level: "none", id: "", amount: 0 }
}
type Windows = Record<"w3" | "w7" | "w15" | "w30", { spend: number; value: number; purchases: number; netRoas: number; grossRoas: number; cpp: number }>
type Signal = {
  adset: AdsetModel; windows: Windows
  kind: "scale" | "kill" | "watch"
  rule: string; reason: string; streak: number
  todaySpend: number; todayNet: number
  // Naka-set lang sa mga inirehistro (Scaling tab): ang resulta MULA sa petsa ng
  // rehistro, at ang kasaysayan ng pag-scale.
  reg?: Registration
  sinceReg?: { days: number; spend: number; value: number; netRoas: number; purchases: number }
}
type FatigueRow = {
  adId: string; adName: string; adsetName: string; account: FBAccount
  signals: string[]; freq3: number; ctrDelta: number; cpmDelta: number; cppDelta: number
}

// ── Ad-account picker ───────────────────────────────────────────────────────
// Kaparehong hugis ng GroupPicker sa Fulfillment (purple na badge ng kabuuan),
// pero may TATLONG bilang kada ad account: berde = scale, pula = kill,
// dilaw = watch. Kaya makikita agad kung saang account nakatago ang trabaho
// nang hindi kailangang pumili isa-isa.
function AccountPicker({ value, onChange, items, totals }: {
  value: string
  onChange: (v: string) => void
  items: { name: string; scale: number; kill: number; watch: number }[]
  totals: { scale: number; kill: number; watch: number }
}) {
  const [open, setOpen] = useState(false)
  const sorted = useMemo(() =>
    [...items].sort((a, b) =>
      (b.kill + b.scale + b.watch) - (a.kill + a.scale + a.watch) || a.name.localeCompare(b.name)),
    [items])
  const cur = value === "ALL" ? totals : (items.find(i => i.name === value) ?? { scale: 0, kill: 0, watch: 0 })
  const sum = (x: { scale: number; kill: number; watch: number }) => x.scale + x.kill + x.watch
  const withWork = sorted.filter(i => sum(i) > 0).length

  // Ang zero ay pinapatahimik (kulay-abo) para ang mata ay dumapo sa may laman.
  const N = ({ n, tone }: { n: number; tone: "scale" | "kill" | "watch" }) => (
    <span className={`inline-flex items-center justify-center min-w-[22px] h-5 px-1 rounded-md text-[11px] font-bold tabular-nums ${
      n === 0 ? "bg-slate-100 text-slate-300"
        : tone === "scale" ? "bg-emerald-100 text-emerald-700"
          : tone === "kill" ? "bg-rose-100 text-rose-700"
            : "bg-amber-100 text-amber-700"}`}>{n}</span>
  )
  const Trio = ({ x }: { x: { scale: number; kill: number; watch: number } }) => (
    <span className="flex items-center gap-1 shrink-0">
      <N n={x.scale} tone="scale" /><N n={x.kill} tone="kill" /><N n={x.watch} tone="watch" />
    </span>
  )

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="h-9 pl-2 pr-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 flex items-center gap-2 text-sm min-w-[240px] max-w-[330px]">
        <Trio x={cur} />
        <span className="flex-1 text-left truncate text-slate-700">{value === "ALL" ? "All ad accounts" : value}</span>
        <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[45]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-[46] w-[380px] bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Scale · Kill · Watch</span>
              <span className="text-[11px] text-slate-400">{withWork} of {sorted.length} need attention</span>
            </div>
            <div className="max-h-[360px] overflow-y-auto py-1">
              <button onClick={() => { onChange("ALL"); setOpen(false) }}
                className={`w-full px-3 py-2 flex items-center gap-2.5 text-sm hover:bg-slate-50 ${value === "ALL" ? "bg-blue-50" : ""}`}>
                <Trio x={totals} />
                <span className="flex-1 text-left font-semibold text-slate-800 truncate">All ad accounts</span>
                {value === "ALL" && <Check className="w-4 h-4 text-blue-600 shrink-0" />}
              </button>
              <div className="my-1 border-t border-slate-100" />
              {sorted.map(it => (
                <button key={it.name} onClick={() => { onChange(it.name); setOpen(false) }}
                  className={`w-full px-3 py-2 flex items-center gap-2.5 text-sm hover:bg-slate-50 ${value === it.name ? "bg-blue-50" : ""}`}>
                  <Trio x={it} />
                  <span className={`flex-1 text-left truncate ${sum(it) > 0 ? "text-slate-700" : "text-slate-400"}`}>{it.name}</span>
                  {value === it.name && <Check className="w-4 h-4 text-blue-600 shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const peso = (n: number) => "₱" + Math.round(n).toLocaleString("en-PH")
const dec = (n: number) => (isFinite(n) ? n : 0).toFixed(2)
const dstr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const netOf = (value: number, spend: number, rts: number) => spend > 0 ? (value * (1 - rts)) / (spend * VAT) : 0

// ── MODULE-LEVEL CACHE ───────────────────────────────────────────────────────
// Ang bawat tab ay may sariling `key` (kailangan — hindi dapat maghalo ang state),
// pero ang remount ay nangangahulugang bagong hila. Sa 21 account at 30 araw,
// mabigat iyon at nakakainis kapag nagpapalipat-lipat lang. Buhay ang module
// habang nasa app, kaya ang pagbalik sa tab ay INSTANT; ang Refresh button
// (force) ang tanging nagbabasag nito.
type Cached = { ts: number; adsets: AdsetModel[]; errors: string[]; fatigue: FatigueRow[] }
const MODEL_CACHE = new Map<string, Cached>()
const MODEL_TTL = 10 * 60_000

/** Ilang araw nang umiiral — pinapakita sa picker at sa registered rows. */
function daysOld(iso: string): number {
  const t = new Date(iso).getTime()
  if (!isFinite(t)) return 0
  return Math.max(0, Math.floor((Date.now() - t) / 86400_000))
}

async function mapLimit<T>(items: T[], limit: number, fn: (i: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) await fn(items[i++]) }))
}

// ── DALAWANG TAB, ISANG ENGINE ───────────────────────────────────────────────
//   mode="testing"  → AD SET level. Irehistro ang bagong testing ad set; mula sa
//                     petsa ng rehistro, sinusundan ang 3/7/15/30-araw na resulta
//                     hanggang umabot sa scale threshold.
//   mode="scaling"  → CAMPAIGN level. Irehistro ang scaling campaign (1-1-40+
//                     Andromeda). Dito ang Scale 10%/20% dahil sa CAMPAIGN
//                     nakalagay ang CBO budget — hindi sa ad set. May per-ad na
//                     view din para makita kung aling creative ang umaandar.
// Isang engine para hindi maghiwalay ang net-ROAS math sa dalawang lugar.
export function ScalingTracker({ accounts, onSignals, mode }: {
  accounts: FBAccount[]; onSignals?: (n: number) => void; mode: "testing" | "scaling"
}) {
  const allPages = useActivePages()
  const registry = useScalingRegistry()
  const level: "adset" | "campaign" = mode === "scaling" ? "campaign" : "adset"
  const isCampaign = level === "campaign"
  const unitLabel = isCampaign ? "campaign" : "ad set"
  // Pareho silang nakabatay sa rehistro — ang antas lang ang pinagkaiba.
  const isScaling = true
  const [rules, setRules] = useState<Rules>(() => loadRules())
  const saveRules = (r: Rules) => { setRules(r); try { localStorage.setItem(RULES_KEY, JSON.stringify(r)) } catch {} }

  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [errors, setErrors] = useState<string[]>([])
  const [adsets, setAdsets] = useState<AdsetModel[]>([])
  const [fatigue, setFatigue] = useState<FatigueRow[]>([])
  const [fatigueLoading, setFatigueLoading] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [fOwner, setFOwner] = useState("All")
  const [fAccount, setFAccount] = useState("ALL")
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc")

  const live = useMemo(() => accounts.filter(a => !a.archived && a.token && a.ad_account_id), [accounts])

  // ⚠ ANG BITAG NA NAKA-DOKUMENTO SA CLAUDE.md: ang useActivePages() (at ang mga
  // store array sa pangkalahatan) ay nagbabalik ng SARIWANG array bawat render.
  // Nailagay sila sa dependencies ng load callbacks, kaya WALANG KATAPUSANG
  // nagre-refetch ang tab: render → bagong `load` → effect → setState → render…
  // Kaya "nag-blink-blink" ang loading at hindi natatapos — nire-restart ang hila
  // bago pa matapos (nakita Ago 13 2026; ganito rin ang Jul 9 Fulfillment glitch).
  // Ang effect ay nakakabit na sa VALUE STRING (liveKey); ang arrays ay binabasa
  // sa REF sa oras ng takbo, hindi sa closure.
  const liveKey = useMemo(() => live.map(a => a.id).join(","), [live])
  const liveRef = useRef(live);      liveRef.current = live
  const pagesRef = useRef(allPages); pagesRef.current = allPages

  // ── 30-araw na saklaw (PHT — lokal na orasan ng user) ──────────────────────
  const today = dstr(new Date())
  const from30 = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 29); return dstr(d) }, [])
  const last3From = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 2); return dstr(d) }, [])
  const prev7From = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 9); return dstr(d) }, [])
  const prev7To = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 3); return dstr(d) }, [])

  const cacheKey = `${level}|${liveKey}|${from30}|${today}`

  const load = useCallback(async (force = false) => {
    const live = liveRef.current, allPages = pagesRef.current
    // Sariwa pa ang cache? Ibalik agad — walang spinner, walang hila.
    if (!force) {
      const hit = MODEL_CACHE.get(cacheKey)
      if (hit && Date.now() - hit.ts < MODEL_TTL) {
        setAdsets(hit.adsets); setErrors(hit.errors); setFatigue(hit.fatigue)
        setLoading(false); setFatigueLoading(false)
        return
      }
    }
    setLoading(true)
    setProgress({ done: 0, total: live.length })
    const errs: string[] = []

    // 1. RTS rate kada page (returning+returned ÷ total sales, parehong window).
    const rtsByPage = new Map<string, number>()
    const pageNames = Array.from(new Set(live.map(a => a.page_name).filter(Boolean)))
    await mapLimit(pageNames, 4, async name => {
      const pg = allPages.find(p => p.name === name && p.api_key && (p.pancake_page_id || p.shop_id))
      if (!pg) return   // walang Pancake creds → walang RTS data → gross ang gagamitin (rate 0, hayag sa UI)
      try {
        const j = await cachedJson(
          `/api/pancake/orders?api_key=${encodeURIComponent(pg.api_key)}&page_id=${encodeURIComponent(pg.pancake_page_id || pg.shop_id)}`
          + `&from=${from30}&to=${today}&phase=fast${force ? "&nocache=1" : ""}`)
        const s = j.statusSales || {}
        const total = Number(s.total || 0)
        if (total > 0) rtsByPage.set(name, Math.min(0.9, (Number(s.returning || 0) + Number(s.returned || 0)) / total))
      } catch (e: any) { errs.push(`${name}: RTS rate — ${String(e?.message).slice(0, 60)}`) }
    })

    // 2. Daily series + adset meta kada account.
    const models: AdsetModel[] = []
    await mapLimit(live, 3, async a => {
      try {
        const acct = actId(a.ad_account_id)
        const [series, meta, camp] = await Promise.all([
          // Ang daily series ay sa ANTAS ng tab: adset para sa Testing, campaign
          // para sa Scaling.
          fetch(`/api/fb/insights?series=1&level=${level}&token=${encodeURIComponent(a.token)}&account_id=${acct}&from=${from30}&to=${today}${force ? "&nocache=1" : ""}`).then(r => r.json()),
          fetch(`/api/fb/insights?rich=1&level=${level}&parent=${acct}&token=${encodeURIComponent(a.token)}&account_id=${acct}&from=${from30}&to=${today}${force ? "&nocache=1" : ""}`).then(r => r.json()),
          // Sa Testing (adset level) kailangan pa rin ang campaign budget: 65% ng
          // ad sets nila ay CBO (nasukat Ago 14 2026). Sa Scaling, ang `meta` na
          // mismo ang campaign — kaya hindi na kailangan ng pangalawang hila.
          isCampaign
            ? Promise.resolve({ success: true, rows: [] })
            : fetch(`/api/fb/insights?rich=1&level=campaign&parent=${acct}&token=${encodeURIComponent(a.token)}&account_id=${acct}&from=${from30}&to=${today}${force ? "&nocache=1" : ""}`).then(r => r.json()),
        ])
        if (!series.success) { errs.push(`${a.name}: ${String(series.error || "series failed").slice(0, 80)}`); return }
        const metaById = new Map<string, any>((meta.rows || []).map((r: any) => [r.id, r]))
        const campById = new Map<string, any>((camp.rows || []).map((r: any) => [r.id, r]))
        const byId = new Map<string, AdsetModel>()
        const rts = rtsByPage.get(a.page_name) ?? 0
        const mk = (id: string, name: string, campaignId: string, campaignName: string): AdsetModel => {
          const mm = metaById.get(id) || {}
          const cm = campById.get(campaignId) || {}
          return {
            id, name: name || mm.name || id,
            // Ang rich meta rows ay walang campaign_name — kaya kinukuha sa
            // campaign lookup. Kung hindi, blangko ang pangalan ng campaign para
            // sa mga ad set na walang gastos (galing lang sa meta edge).
            campaignName: isCampaign ? (name || mm.name || "") : (campaignName || cm.name || ""),
            campaignId: isCampaign ? id : campaignId,
            account: a, status: mm.status || "—",
            // `ownBudget` LANG — ang `budget` ng rich mode ay maaaring minana o
            // inipon mula sa ad sets, at hindi iyon ang maitataas nang direkta.
            // Sa campaign level, ang sarili niyang budget ANG budget.
            budget: isCampaign ? 0 : (mm.ownBudget || 0),
            campaignBudget: isCampaign ? (mm.ownBudget || 0) : (cm.ownBudget || 0),
            createdTime: mm.createdTime || "",
            rtsRate: rts,
            dailies: new Map(),
          }
        }

        // ⚠ MULA SA META EDGE ANG LISTAHAN, HINDI SA INSIGHTS.
        // Ang insights (series) ay nagbabalik LANG ng object na may GASTOS sa
        // window. Kaya ang bagong gawa ngayong araw — ang eksaktong bagay na
        // irerehistro sa Testing — ay wala sa listahan. Ganoon din ang naka-pause
        // na walang gastos nitong 30 araw. Ang `meta.rows` ay may LAHAT (may
        // zero-fill sa API), kaya doon nagsisimula; ang series ay pandagdag lang
        // ng araw-araw na numero.
        for (const r of meta.rows || []) {
          byId.set(r.id, mk(r.id, r.name || "", isCampaign ? r.id : (r.campaignId || ""), r.campaignName || ""))
        }
        for (const r of series.rows || []) {
          let m = byId.get(r.id)
          if (!m) { m = mk(r.id, r.name, r.campaignId || "", r.campaignName || ""); byId.set(r.id, m) }
          m.dailies.set(r.date, { date: r.date, spend: r.spend, purchases: r.purchases, purchaseValue: r.purchaseValue, impressions: r.impressions, clicks: r.clicks })
        }
        models.push(...byId.values())
      } catch (e: any) { errs.push(`${a.name}: ${String(e?.message).slice(0, 80)}`) }
      finally { setProgress(p => ({ ...p, done: p.done + 1 })) }
    })
    setAdsets(models)
    setErrors(errs)
    setLoading(false)
    // Itabi. Ang `fatigue` ay dumarating mamaya (hiwalay na hila) — ini-update ito
    // ng loadFatigue sa parehong entry, kaya hindi nawawala kapag bumalik ka.
    MODEL_CACHE.set(cacheKey, { ts: Date.now(), adsets: models, errors: errs, fatigue: MODEL_CACHE.get(cacheKey)?.fatigue ?? [] })
  }, [from30, today, cacheKey])

  // 3. Fatigue kada AD: huling 3 araw vs naunang 7 (frequency mula kay Meta mismo).
  const loadFatigue = useCallback(async (force = false) => {
    const live = liveRef.current
    if (!force) {
      const hit = MODEL_CACHE.get(cacheKey)
      if (hit && Date.now() - hit.ts < MODEL_TTL && hit.fatigue.length > 0) { setFatigue(hit.fatigue); setFatigueLoading(false); return }
    }
    setFatigueLoading(true)
    const out: FatigueRow[] = []
    await mapLimit(live, 3, async a => {
      try {
        const acct = actId(a.ad_account_id)
        const q = (f: string, t: string) =>
          fetch(`/api/fb/insights?rich=1&level=ad&parent=${acct}&token=${encodeURIComponent(a.token)}&account_id=${acct}&from=${f}&to=${t}${force ? "&nocache=1" : ""}`).then(r => r.json())
        const [cur, prev] = await Promise.all([q(last3From, today), q(prev7From, prev7To)])
        if (!cur.success || !prev.success) return
        const prevById = new Map<string, any>((prev.rows || []).map((r: any) => [r.id, r]))
        for (const r of cur.rows || []) {
          if (r.spend < 100) continue                    // walang saysay ang kaunting datos
          const p = prevById.get(r.id)
          if (!p || p.spend < 100) continue
          const ctrDelta = p.linkCtr > 0 ? (r.linkCtr - p.linkCtr) / p.linkCtr : 0
          const cpmDelta = p.cpm > 0 ? (r.cpm - p.cpm) / p.cpm : 0
          const cppCur = r.purchases > 0 ? r.spend / r.purchases : 0
          const cppPrev = p.purchases > 0 ? p.spend / p.purchases : 0
          const cppDelta = cppPrev > 0 && cppCur > 0 ? (cppCur - cppPrev) / cppPrev : 0
          const signals: string[] = []
          if (r.frequency >= 2.5) signals.push(`frequency ${dec(r.frequency)}`)
          if (ctrDelta <= -0.25) signals.push(`CTR ${Math.round(ctrDelta * 100)}%`)
          if (cpmDelta >= 0.20) signals.push(`CPM +${Math.round(cpmDelta * 100)}%`)
          if (cppDelta >= 0.30) signals.push(`CPP +${Math.round(cppDelta * 100)}%`)
          if (signals.length >= 2) out.push({
            adId: r.id, adName: r.name, adsetName: r.adsetId || "", account: a,
            signals, freq3: r.frequency, ctrDelta, cpmDelta, cppDelta,
          })
        }
      } catch { /* laktawan ang account na bumigo — nasa errors na ng main load kung ganoon */ }
    })
    setFatigue(out)
    setFatigueLoading(false)
    const prev = MODEL_CACHE.get(cacheKey)
    if (prev) MODEL_CACHE.set(cacheKey, { ...prev, fatigue: out })
  }, [last3From, prev7From, prev7To, today, cacheKey])

  // Isang hila kada tunay na pagbabago ng account set — HINDI kada render.
  // Ang `load`/`loadFatigue` ay sadyang WALA sa deps: matatag na sila ngayon
  // (walang array sa kanilang closure), at ang paglagay sa kanila ay ibabalik
  // lang ang loop.
  useEffect(() => {
    if (!liveKey) return
    load(); loadFatigue()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey])

  // ── Signals ────────────────────────────────────────────────────────────────
  const signals = useMemo<Signal[]>(() => {
    const out: Signal[] = []
    const now = new Date()
    const hour = now.getHours()
    const dates: string[] = []
    for (let i = 29; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); dates.push(dstr(d)) }

    // Ang bawat tab ay nakikita LANG ang sariling antas — kung hindi, lalabas ang
    // mga campaign sa Testing at mga ad set sa Scaling.
    const regByAdset = new Map(registry.regs.filter(r => r.level === level).map(r => [r.adset_id, r]))

    for (const m of adsets) {
      const reg = regByAdset.get(m.id)
      // Sa Scaling tab, ang INIREHISTRO LANG — iyon ang buong punto: malinis at
      // pinili mo mismo. Sa Monitoring, lahat.
      if (isScaling && !reg) continue

      const win = (n: number) => {
        let spend = 0, value = 0, purchases = 0
        for (const dt of dates.slice(-n)) { const d = m.dailies.get(dt); if (d) { spend += d.spend; value += d.purchaseValue; purchases += d.purchases } }
        return { spend, value, purchases, netRoas: netOf(value, spend, m.rtsRate), grossRoas: spend > 0 ? value / (spend * VAT) : 0, cpp: purchases > 0 ? spend / purchases : 0 }
      }
      const windows: Windows = { w3: win(3), w7: win(7), w15: win(15), w30: win(30) }
      // Ang inirehistro ay pinapakita KAHIT walang gastos pa — iyon ang sagot sa
      // "sinimulan kong i-monitor ngayon" (araw 0, wala pang datos).
      if (windows.w30.spend === 0 && !reg) continue

      // Resulta MULA sa petsa ng rehistro (hindi rolling window) — ito ang
      // sinusukat mo kapag "sinimulan ko itong i-monitor ngayong araw".
      let sinceReg: Signal["sinceReg"]
      if (reg) {
        let spend = 0, value = 0, purchases = 0, days = 0
        for (const dt of dates) {
          if (dt < reg.registered_at) continue
          days++
          const d = m.dailies.get(dt)
          if (d) { spend += d.spend; value += d.purchaseValue; purchases += d.purchases }
        }
        sinceReg = { days, spend, value, purchases, netRoas: netOf(value, spend, m.rtsRate) }
      }

      const tD = m.dailies.get(today)
      const todaySpend = tD?.spend || 0
      const todayNet = tD ? netOf(tD.purchaseValue, tD.spend, m.rtsRate) : 0

      // streak: magkakasunod na araw (pinakabago pababa, laktaw ang today kung
      // maliit pa ang gastos nito — hindi pa tapos ang araw)
      let streak = 0
      const startIdx = todaySpend >= rules.minDailySpend ? dates.length - 1 : dates.length - 2
      for (let i = startIdx; i >= 0; i--) {
        const d = m.dailies.get(dates[i])
        if (!d || d.spend < rules.minDailySpend) break
        if (netOf(d.purchaseValue, d.spend, m.rtsRate) < rules.scaleRoas) break
        streak++
      }

      const isActive = /active/i.test(m.status)
      const base = { adset: m, windows, streak, todaySpend, todayNet, reg, sinceReg }

      // Pagkatapos mag-scale, may 48h na palugit: hindi pa dapat husgahan agad —
      // nagre-relearn ang delivery. Tanda lang ito, hindi kill/scale.
      const lastScale = reg?.scales[reg.scales.length - 1]
      const hoursSinceScale = lastScale
        ? (Date.now() - new Date(`${lastScale.date}T00:00:00`).getTime()) / 3600_000 : Infinity
      if (reg && hoursSinceScale < 48) {
        out.push({ ...base, kind: "watch", rule: "cooldown",
          reason: `Scaled ${lastScale!.pct}% on ${lastScale!.date} (${peso(lastScale!.from)} → ${peso(lastScale!.to)}). `
            + `Hold ${Math.max(1, Math.round(48 - hoursSinceScale))}h more before judging — delivery is relearning.` })
        continue
      }

      if (isActive && streak >= rules.scaleDays) {
        const bt = budgetTarget(m)
        const n = (reg?.scales.length || 0) + 1
        out.push({ ...base, kind: "scale", rule: "ready_to_scale",
          reason: `Net ROAS ≥ ${rules.scaleRoas} for ${streak} straight days (7d: ${dec(windows.w7.netRoas)}).`
            + (reg ? ` This would be scale #${n}.` : "")
            + (bt.level !== "none"
              ? ` Raise 20% → ${peso(bt.amount * 1.2)}, or 10% → ${peso(bt.amount * 1.1)}${bt.level === "campaign" ? " (campaign budget — CBO)" : ""}.`
              : ` No budget found on the ad set or campaign — raise it in Ads Manager.`) })
        continue
      }
      if (!isActive) continue   // paused na — walang iki-kill o iba-bantay

      if (windows.w3.netRoas < rules.bleedRoas && windows.w3.spend >= rules.bleedSpend) {
        out.push({ ...base, kind: "kill", rule: "bleeding",
          reason: `Bleeding: 3-day net ROAS ${dec(windows.w3.netRoas)} on ${peso(windows.w3.spend)} spent. Kill now.` })
        continue
      }
      if (hour >= rules.noSalesHour && todaySpend >= rules.evalMinSpend && (tD?.purchases || 0) === 0) {
        out.push({ ...base, kind: "kill", rule: "noSales",
          reason: `No sales by ${rules.noSalesHour}:00 with ${peso(todaySpend)} already spent today.` })
        continue
      }
      if (todaySpend >= rules.evalMinSpend && todayNet < rules.killRoas) {
        out.push({ ...base, kind: "kill", rule: "lowRoas",
          reason: `Today's net ROAS ${dec(todayNet)} < ${rules.killRoas} on ${peso(todaySpend)}. Kill before midnight if it doesn't recover.` })
        continue
      }
      if (windows.w3.purchases > 0 && windows.w3.cpp > rules.cppMax) {
        out.push({ ...base, kind: "kill", rule: "cpp",
          reason: `3-day CPP ${peso(windows.w3.cpp)} > ${peso(rules.cppMax)} ceiling.` })
        continue
      }
      // watch: nasa loob ng 10% ng kill o ng scale
      if ((todaySpend >= rules.evalMinSpend && todayNet < rules.killRoas * 1.1)
        || (streak >= 1 && streak < rules.scaleDays && windows.w3.netRoas >= rules.scaleRoas * 0.9)) {
        out.push({ ...base, kind: "watch", rule: "near",
          reason: streak >= 1
            ? `${streak}/${rules.scaleDays} days toward scale (needs ${rules.scaleDays - streak} more ≥ ${rules.scaleRoas}).`
            : `Today's net ${dec(todayNet)} is within 10% of the ${rules.killRoas} kill line.` })
        continue
      }
      // Ang inirehistro ay LAGING may row kahit walang signal — kung hindi,
      // mawawala ito sa Scaling tab at aakalain mong hindi na-monitor.
      if (reg) {
        out.push({ ...base, kind: "watch", rule: "monitoring",
          reason: sinceReg && sinceReg.spend > 0
            ? `Day ${sinceReg.days} since registered · net ${dec(sinceReg.netRoas)} on ${peso(sinceReg.spend)}. `
              + `Needs ${rules.scaleRoas}+ for ${rules.scaleDays} straight days to qualify (currently ${streak}).`
            : `Registered ${reg.registered_at} — no spend recorded yet.` })
      }
    }
    return out
  }, [adsets, rules, today, registry.regs, level])

  // Owner options galing sa REGISTRY (hindi sa loaded rows) para mapipili pa rin
  // ang owner na walang gastos sa buwan.
  const owners = useMemo(() => Array.from(new Set(live.map(a => a.owner).filter(Boolean))).sort(), [live])

  // Ang bilang kada ad account ay sinusukat sa OWNER-filtered set (hindi sa
  // account-filtered) — kung hindi, magiging zero ang lahat ng ibang account
  // pagkapili mo ng isa, at hindi mo na makikita kung saan pa may trabaho.
  const ownerScoped = useMemo(() =>
    fOwner === "All" ? signals : signals.filter(s => s.adset.account.owner === fOwner),
    [signals, fOwner])
  const accountItems = useMemo(() => {
    const m = new Map<string, { name: string; scale: number; kill: number; watch: number }>()
    // Isama ang LAHAT ng account na nasa saklaw ng owner, kahit walang signal —
    // para malaman mong tahimik ito, hindi nawawala.
    for (const a of live) if (fOwner === "All" || a.owner === fOwner) m.set(a.name, { name: a.name, scale: 0, kill: 0, watch: 0 })
    for (const s of ownerScoped) {
      const e = m.get(s.adset.account.name) ?? { name: s.adset.account.name, scale: 0, kill: 0, watch: 0 }
      if (s.kind === "scale") e.scale++; else if (s.kind === "kill") e.kill++; else e.watch++
      m.set(e.name, e)
    }
    return [...m.values()]
  }, [live, fOwner, ownerScoped])
  const accountTotals = useMemo(() => accountItems.reduce(
    (t, i) => ({ scale: t.scale + i.scale, kill: t.kill + i.kill, watch: t.watch + i.watch }),
    { scale: 0, kill: 0, watch: 0 }), [accountItems])

  // Filter + sort ayon sa 7-day net ROAS (ang default na 30-araw na sukat).
  const view = useMemo(() => {
    const f = fAccount === "ALL" ? ownerScoped : ownerScoped.filter(s => s.adset.account.name === fAccount)
    return [...f].sort((a, b) => sortDir === "desc"
      ? b.windows.w7.netRoas - a.windows.w7.netRoas
      : a.windows.w7.netRoas - b.windows.w7.netRoas)
  }, [ownerScoped, fAccount, sortDir])

  // Ang pagpili ng owner ay maaaring mag-alis sa napiling account — ibalik sa ALL
  // para hindi mapagkamalang walang datos.
  useEffect(() => {
    if (fAccount !== "ALL" && !accountItems.some(i => i.name === fAccount)) setFAccount("ALL")
  }, [accountItems, fAccount])

  // ── ULILANG REHISTRO ────────────────────────────────────────────────────────
  // Ang rehistro para sa antas na ito na WALANG katugmang object sa nahilang
  // datos. Dating tahimik na nawawala — mukhang "hindi accurate ang laman".
  // Napatunayan (Ago 14 2026): may campaign na naitala bilang level='adset' ng
  // lumang build, kaya hindi ito lumalabas sa Testing (hindi ad set) at hindi rin
  // sa Scaling (mali ang level). Ipinapakita na ngayon para maalis o maitama.
  const orphans = useMemo(() => {
    if (!registry.loaded || loading) return []
    const ids = new Set(adsets.map(m => m.id))
    return registry.regs.filter(r => r.level === level && !ids.has(r.adset_id))
  }, [registry.regs, registry.loaded, adsets, level, loading])

  const scaleRows = view.filter(s => s.kind === "scale")
  const killRows = view.filter(s => s.kind === "kill")
  const watchRows = view.filter(s => s.kind === "watch")
  const fatigueView = useMemo(() => fatigue.filter(f =>
    (fOwner === "All" || f.account.owner === fOwner) && (fAccount === "ALL" || f.account.name === fAccount)),
    [fatigue, fOwner, fAccount])
  // Ang badge sa tab ay hindi naka-filter — ang KABUUAN ang gusto mong makita,
  // hindi ang bahagi ng napiling owner.
  const totalSignals = signals.filter(s => s.kind !== "watch").length + fatigue.length
  useEffect(() => { onSignals?.(totalSignals) }, [totalSignals, onSignals])

  // ── Auto-pause (kapag naka-ON ang master + ang rule) ───────────────────────
  const [autoLog, setAutoLog] = useState<{ date: string; items: { id: string; name: string; token: string }[] }>(() => {
    try { const l = JSON.parse(localStorage.getItem(AUTOLOG_KEY) || "null"); if (l?.date === dstr(new Date())) return l } catch {}
    return { date: dstr(new Date()), items: [] }
  })
  const saveLog = (l: typeof autoLog) => { setAutoLog(l); try { localStorage.setItem(AUTOLOG_KEY, JSON.stringify(l)) } catch {} }
  const [pausing, setPausing] = useState<string>("")

  async function pauseAdset(s: Signal, auto: boolean) {
    setPausing(s.adset.id)
    try {
      const j = await fetch("/api/fb/manage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: s.adset.account.token, action: "status", id: s.adset.id, status: "PAUSED" }),
      }).then(r => r.json())
      if (!j.success) throw new Error(j.error || "pause failed")
      saveLog({ ...autoLog, items: [...autoLog.items, { id: s.adset.id, name: s.adset.name, token: s.adset.account.token }] })
      setAdsets(prev => prev.map(m => m.id === s.adset.id ? { ...m, status: "PAUSED" } : m))
    } catch (e: any) {
      setErrors(prev => [...prev, `${s.adset.name}: ${auto ? "auto-" : ""}pause failed — ${String(e?.message).slice(0, 80)}`])
    } finally { setPausing("") }
  }
  async function undoPause(item: { id: string; name: string; token: string }) {
    try {
      const j = await fetch("/api/fb/manage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: item.token, action: "status", id: item.id, status: "ACTIVE" }),
      }).then(r => r.json())
      if (!j.success) throw new Error(j.error || "undo failed")
      saveLog({ ...autoLog, items: autoLog.items.filter(x => x.id !== item.id) })
      setAdsets(prev => prev.map(m => m.id === item.id ? { ...m, status: "ACTIVE" } : m))
    } catch (e: any) { setErrors(prev => [...prev, `${item.name}: undo failed — ${String(e?.message).slice(0, 80)}`]) }
  }
  useEffect(() => {
    if (!rules.autoMaster || loading) return
    const eligible = killRows.filter(s =>
      rules.autoRules[s.rule as keyof Rules["autoRules"]]
      && /active/i.test(s.adset.status)
      && !autoLog.items.some(x => x.id === s.adset.id))
    const room = rules.autoDailyCap - autoLog.items.length
    for (const s of eligible.slice(0, Math.max(0, room))) pauseAdset(s, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules.autoMaster, loading, killRows.length])

  // ── Rehistro: pumili ng ad set na susundan (Scaling tab lang) ──────────────
  const [pickOpen, setPickOpen] = useState(false)
  const [pickSel, setPickSel] = useState<Set<string>>(new Set())
  const [pickQ, setPickQ] = useState("")
  // Sariling filter ang modal — hindi nakasabit sa header. Ang pagrehistro ay
  // hiwalay na gawain sa pagtingin ng resulta, at 100+ ad set ang pagpipilian.
  const [pickOwner, setPickOwner] = useState("All")
  const [pickAcct, setPickAcct] = useState("All")
  // Naka-check by default: ang irerehistro ay ang tumatakbo, hindi ang libo-libong
  // paused na luma. Pwede pa ring alisin kung hinahanap ang naka-pause.
  const [pickActiveOnly, setPickActiveOnly] = useState(true)
  const [busy, setBusy] = useState("")
  const regIds = useMemo(() => new Set(registry.regs.filter(r => r.level === level).map(r => r.adset_id)), [registry.regs, level])

  // Ang mga pagpipilian sa modal ay galing sa mga ad set na TALAGANG mapipili,
  // hindi sa buong registry — kaya walang opsyon na zero ang kinalalabasan.
  const pickBase = useMemo(() => adsets.filter(m => !regIds.has(m.id)), [adsets, regIds])
  const pickOwners = useMemo(() => Array.from(new Set(pickBase.map(m => m.account.owner).filter(Boolean))).sort(), [pickBase])
  const pickAccounts = useMemo(() => Array.from(new Set(
    pickBase.filter(m => pickOwner === "All" || m.account.owner === pickOwner).map(m => m.account.name)
  )).sort(), [pickBase, pickOwner])

  const pickable = useMemo(() => pickBase
    .filter(m => pickOwner === "All" || m.account.owner === pickOwner)
    .filter(m => pickAcct === "All" || m.account.name === pickAcct)
    .filter(m => !pickActiveOnly || /active/i.test(m.status))
    .filter(m => !pickQ || `${m.name} ${m.campaignName} ${m.account.name}`.toLowerCase().includes(pickQ.toLowerCase()))
    // PINAKABAGO ANG UNA. Ang bagong ginawang ad set ang irerehistro — hindi ang
    // "Adset 10" na alphabetically nauuna. Dating naka-sort sa pangalan, kaya
    // nahahalo ang bago at luma. Ang walang created_time ay huli (hindi nagtatago
    // sa itaas na parang bago).
    .sort((a, b) => (b.createdTime || "").localeCompare(a.createdTime || "")
      || a.account.name.localeCompare(b.account.name)
      || a.name.localeCompare(b.name)),
    [pickBase, pickOwner, pickAcct, pickActiveOnly, pickQ])

  // Ang pagpalit ng owner ay maaaring mag-alis sa napiling account — ibalik sa All.
  useEffect(() => {
    if (pickAcct !== "All" && !pickAccounts.includes(pickAcct)) setPickAcct("All")
  }, [pickAccounts, pickAcct])

  async function doRegister() {
    setBusy("register")
    const items = pickable.filter(m => pickSel.has(m.id)).map(m => ({
      adset_id: m.id, adset_name: m.name, campaign_name: m.campaignName,
      account_name: m.account.name, owner: m.account.owner || "", level,
      registered_at: today, starting_budget: budgetTarget(m).amount,
    }))
    const err = await registry.register(items)
    if (err) setErrors(p => [...p, `Register failed — ${err}`])
    setPickSel(new Set()); setPickOpen(false); setBusy("")
  }

  // ── Pag-scale: itinataas ang budget sa Meta, saka itinatala ────────────────
  const [scaleFor, setScaleFor] = useState<Signal | null>(null)
  const [bulkScale, setBulkScale] = useState(false)
  const [scaleSel, setScaleSel] = useState<Set<string>>(new Set())

  async function applyScale(targets: Signal[], pct: number) {
    setBusy("scale")
    // Ang CBO ay may ISANG budget na hinahati ng maraming ad set. Kung dalawang
    // ad set ng parehong campaign ang napili, ang dobleng pagtaas ng 20% ay
    // magiging 44% — hindi iyon ang hiningi. Isang beses kada campaign.
    const doneCampaigns = new Set<string>()
    for (const s of targets) {
      const t = budgetTarget(s.adset)
      let applied = false
      let from = t.amount, to = Math.round(t.amount * (1 + pct / 100))

      if (t.level === "none") {
        setErrors(p => [...p, `${s.adset.name}: no budget found on the ad set or its campaign — raise it in Ads Manager.`])
      } else if (t.level === "campaign" && doneCampaigns.has(t.id)) {
        setErrors(p => [...p, `${s.adset.name}: shares campaign "${s.adset.campaignName}" with another selected ad set — the campaign budget was raised once, not twice.`])
        from = t.amount; to = t.amount   // naitala pero hindi muling itinaas
      } else {
        try {
          const j = await fetch("/api/fb/manage", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: s.adset.account.token, action: "update", id: t.id, daily_budget: to }),
          }).then(r => r.json())
          applied = !!j.success
          if (!j.success) setErrors(p => [...p, `${s.adset.name}: ${t.level} budget update failed — ${String(j.error).slice(0, 90)}`])
          else if (t.level === "campaign") doneCampaigns.add(t.id)
        } catch (e: any) { setErrors(p => [...p, `${s.adset.name}: ${String(e?.message).slice(0, 80)}`]) }
      }

      const ev: ScaleEvent = { date: today, pct, from, to: applied ? to : from, applied }
      if (s.reg) await registry.addScale(s.reg.adset_id, ev)
      if (applied) setAdsets(prev => prev.map(m =>
        t.level === "adset"
          ? (m.id === s.adset.id ? { ...m, budget: to } : m)
          // CBO: bawat ad set ng campaign na iyon ay nakikita ang bagong budget
          : (m.campaignId === t.id ? { ...m, campaignBudget: to } : m)))
    }
    setScaleFor(null); setBulkScale(false); setScaleSel(new Set()); setBusy("")
  }

  // ── Per-ad view (Scaling tab) ──────────────────────────────────────────────
  // Sa 1-1-40+ na setup, ang campaign ay isang bloke lang — ang tunay na sagot
  // ay nasa ANTAS NG AD: alin sa 40 creative ang umaandar. Hinihila kada
  // campaign lang kapag binuksan (mabigat kung lahat sabay).
  type AdRow = {
    id: string; name: string; thumbnail: string; status: string
    spend: number; purchases: number; purchaseValue: number; netRoas: number
    cpp: number; ctr: number; frequency: number; impressions: number
  }
  // Aling antas ang bukas kada campaign: "" (sarado) / "adset" / "ad".
  const [drillOpen, setDrillOpen] = useState<Record<string, "adset" | "ad" | "">>({})
  const [adRows, setAdRows] = useState<Record<string, AdRow[]>>({})
  const [adsBusy, setAdsBusy] = useState("")

  // Ang parent ng drill-down: campaign sa Scaling, ang AD SET mismo sa Testing.
  // Kaya may "View ads" din sa Testing — {adset}/insights?level=ad.
  const drillParent = (s: Signal) => isCampaign ? s.adset.campaignId : s.adset.id

  async function loadDrill(s: Signal, lvl: "adset" | "ad") {
    const cid = drillParent(s)
    if (!cid) return
    const key = `${cid}|${lvl}`
    if (drillOpen[cid] === lvl) { setDrillOpen(p => ({ ...p, [cid]: "" })); return }
    setDrillOpen(p => ({ ...p, [cid]: lvl }))
    if (adRows[key]) return
    setAdsBusy(key)
    try {
      const j = await fetch(`/api/fb/insights?rich=1&level=${lvl}&parent=${encodeURIComponent(cid)}`
        + `&token=${encodeURIComponent(s.adset.account.token)}&account_id=${encodeURIComponent(actId(s.adset.account.ad_account_id))}`
        + `&from=${from30}&to=${today}`).then(r => r.json())
      if (!j.success) { setErrors(p => [...p, `${s.adset.name}: ${lvl}s — ${String(j.error).slice(0, 80)}`]); setAdsBusy(""); return }
      const rts = s.adset.rtsRate
      // Sapat na hugis para sa table na ito — hindi buong RawCampaign.
      type MetaAd = {
        id: string; name?: string; thumbnail?: string; status?: string
        spend?: number; purchases?: number; purchaseValue?: number
        linkCtr?: number; frequency?: number; impressions?: number
      }
      const rows: AdRow[] = ((j.rows || []) as MetaAd[]).map(r => {
        const spend = r.spend || 0, purchases = r.purchases || 0
        return {
          id: r.id, name: r.name || "", thumbnail: r.thumbnail || "", status: r.status || "—",
          spend, purchases, purchaseValue: r.purchaseValue || 0,
          netRoas: netOf(r.purchaseValue || 0, spend, rts),
          cpp: purchases > 0 ? spend / purchases : 0,
          ctr: r.linkCtr || 0, frequency: r.frequency || 0, impressions: r.impressions || 0,
        }
      }).sort((x, y) => y.netRoas - x.netRoas || y.spend - x.spend)
      setAdRows(p => ({ ...p, [key]: rows }))
    } catch (e: any) { setErrors(p => [...p, `${s.adset.name}: ${String(e?.message).slice(0, 80)}`]) }
    setAdsBusy("")
  }

  // ── Per-ad actions sa drill table ──────────────────────────────────────────
  // Kill = tunay na pause sa Meta. "Move to Scaling" = MARKER LANG (✅ Moved):
  // mano-mano ang paglipat sa Ads Manager, itinatala lang dito para makita ng
  // tatlong buyer kung alin na ang nailipat. Nakatago sa registry bilang
  // level='ad-moved' (may level column na; walang bagong migration) — hindi ito
  // lumalabas sa mga tab dahil naka-filter sila sa sariling level.
  const movedAds = useMemo(() => new Set(
    registry.regs.filter(r => r.level === "ad-moved").map(r => r.adset_id)
  ), [registry.regs])
  const [adActBusy, setAdActBusy] = useState("")

  async function killAd(s: Signal, ad: { id: string; name: string }) {
    if (!confirm(`Kill (pause) ad "${ad.name}" on Facebook?`)) return
    setAdActBusy(ad.id)
    try {
      const j = await fetch("/api/fb/manage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: s.adset.account.token, action: "status", id: ad.id, status: "PAUSED" }),
      }).then(r => r.json())
      if (!j.success) throw new Error(j.error || "pause failed")
      const key = `${drillParent(s)}|ad`
      setAdRows(p => ({ ...p, [key]: (p[key] || []).map(r => r.id === ad.id ? { ...r, status: "PAUSED" } : r) }))
    } catch (e: any) { setErrors(p => [...p, `${ad.name}: kill failed — ${String(e?.message).slice(0, 80)}`]) }
    setAdActBusy("")
  }

  async function markMoved(s: Signal, ad: { id: string; name: string }) {
    setAdActBusy(ad.id)
    const err = await registry.register([{
      adset_id: ad.id, adset_name: ad.name, campaign_name: s.adset.campaignName,
      account_name: s.adset.account.name, owner: s.adset.account.owner || "",
      level: "ad-moved", registered_at: today, starting_budget: 0,
    }])
    if (err) setErrors(p => [...p, `${ad.name}: mark failed — ${err}`])
    setAdActBusy("")
  }

  // ── AI ─────────────────────────────────────────────────────────────────────
  const [aiOpen, setAiOpen] = useState<string>("")     // adset id na may bukas na opinion
  const [aiText, setAiText] = useState<Record<string, string>>({})
  const [aiBusy, setAiBusy] = useState<string>("")
  const [askQ, setAskQ] = useState("")
  const [askA, setAskA] = useState("")

  const compactRow = (s: Signal) => ({
    adset: s.adset.name, campaign: s.adset.campaignName, account: s.adset.account.name,
    signal: s.kind, rule: s.rule, streak: s.streak, status: s.adset.status,
    budget: s.adset.budget, rtsRate: +s.adset.rtsRate.toFixed(3),
    today: { spend: Math.round(s.todaySpend), netRoas: +dec(s.todayNet) },
    d3: { spend: Math.round(s.windows.w3.spend), netRoas: +dec(s.windows.w3.netRoas), cpp: Math.round(s.windows.w3.cpp) },
    d7: { spend: Math.round(s.windows.w7.spend), netRoas: +dec(s.windows.w7.netRoas) },
    d15: { spend: Math.round(s.windows.w15.spend), netRoas: +dec(s.windows.w15.netRoas) },
    d30: { spend: Math.round(s.windows.w30.spend), netRoas: +dec(s.windows.w30.netRoas) },
  })
  async function askAi(mode: "row" | "brief" | "ask", s?: Signal) {
    const key = mode === "row" && s ? s.adset.id : mode
    setAiBusy(key)
    try {
      const rows = mode === "row" && s ? [compactRow(s)] : view.map(compactRow)
      const j = await fetch("/api/ai/scaling", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, rows, question: mode === "ask" ? askQ : undefined }),
      }).then(r => r.json())
      const text = j.success ? j.text : `⚠ ${j.error}`
      if (mode === "row" && s) { setAiText(p => ({ ...p, [s.adset.id]: text })); setAiOpen(s.adset.id) }
      else setAskA(text)
    } finally { setAiBusy("") }
  }

  // ── UI ─────────────────────────────────────────────────────────────────────
  const Row = ({ s, accent }: { s: Signal; accent: string }) => (
    <div className={`border-l-4 ${accent} bg-white rounded-lg border border-slate-200 p-3 space-y-1.5`}>
      <div className="flex flex-wrap items-center gap-2">
        {/* Checkbox = para sa bulk Scale — campaign level lang iyon */}
        {isCampaign && s.reg && (
          <input type="checkbox" checked={scaleSel.has(s.adset.id)}
            onChange={e => setScaleSel(p => { const n = new Set(p); e.target.checked ? n.add(s.adset.id) : n.delete(s.adset.id); return n })} />
        )}
        <span className="font-semibold text-slate-800 text-sm">{s.adset.name}</span>
        <span className="text-[11px] text-slate-400">
          {!isCampaign && <>{s.adset.campaignName} · </>}{s.adset.account.name}
          {s.adset.createdTime && <> · {daysOld(s.adset.createdTime)}d old</>}
        </span>
        {(() => { const t = budgetTarget(s.adset); return t.level === "none" ? null : (
          <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
            {t.level === "campaign" ? "CBO budget" : "budget"} {peso(t.amount)}
          </span>
        ) })()}
        {/* Pang-ilang scale na + saan nagsimula — ito ang hinihinging kasaysayan. */}
        {s.reg && s.reg.scales.length > 0 && (
          <span className="text-[11px] bg-indigo-100 text-indigo-700 font-semibold px-2 py-0.5 rounded-full">
            scale #{s.reg.scales.length} · {peso(s.reg.starting_budget)} → {peso(s.adset.budget || s.reg.scales[s.reg.scales.length - 1].to)}
            {" "}(+{Math.round(((s.adset.budget || 0) / (s.reg.starting_budget || 1) - 1) * 100)}%)
          </span>
        )}
        {s.reg && s.reg.scales.length === 0 && (
          <span className="text-[11px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">not scaled yet</span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {/* Scaling tab: Scale (itinataas ang campaign budget). Testing tab:
              KILL — ang testing na pumalya ay pinapatay, hindi ini-scale; ang
              nanalo ay inililipat sa scaling campaign sa Ads Manager. */}
          {isCampaign && s.reg && budgetTarget(s.adset).level !== "none" && (
            <button onClick={() => setScaleFor(s)} disabled={busy === "scale"}
              title="Raises the CAMPAIGN budget (CBO)"
              className="text-[11px] flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
              <TrendingUp className="w-3 h-3" /> Scale
            </button>
          )}
          {!isCampaign && s.reg && /active/i.test(s.adset.status) && (
            <button onClick={() => { if (confirm(`Kill (pause) ad set "${s.adset.name}" on Facebook?`)) pauseAdset(s, false) }}
              disabled={pausing === s.adset.id}
              className="text-[11px] flex items-center gap-1 px-2 py-1 rounded-md bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">
              <Pause className="w-3 h-3" /> {pausing === s.adset.id ? "…" : "Kill"}
            </button>
          )}
          {/* Scaling: ad sets + ads sa ilalim ng campaign. Testing: ads lang sa
              ilalim ng ad set (wala nang mas mababa). */}
          {s.reg && (isCampaign ? (["adset", "ad"] as const) : (["ad"] as const)).map(lvl => {
            const open = drillOpen[drillParent(s)] === lvl
            const busyHere = adsBusy === `${drillParent(s)}|${lvl}`
            return (
              <button key={lvl} onClick={() => loadDrill(s, lvl)} disabled={busyHere}
                className={`text-[11px] flex items-center gap-1 px-2 py-1 rounded-md border disabled:opacity-50 ${
                  open ? "border-violet-400 bg-violet-50 text-violet-700" : "border-violet-200 text-violet-600 hover:bg-violet-50"}`}>
                {lvl === "adset" ? <Layers className="w-3 h-3" /> : <LayoutGrid className="w-3 h-3" />}
                {busyHere ? "…" : open ? `Hide ${lvl === "adset" ? "ad sets" : "ads"}` : `View ${lvl === "adset" ? "ad sets" : "ads"}`}
              </button>
            )
          })}
          {s.reg && (
            <button onClick={() => { if (confirm(`Stop monitoring "${s.adset.name}"? History is kept.`)) registry.unregister(s.reg!.adset_id) }}
              title="Stop monitoring" className="text-[11px] px-1.5 py-1 rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50">
              <X className="w-3 h-3" />
            </button>
          )}
          <button onClick={() => askAi("row", s)} disabled={aiBusy === s.adset.id}
            className="text-[11px] flex items-center gap-1 px-2 py-1 rounded-md border border-violet-200 text-violet-600 hover:bg-violet-50 disabled:opacity-50">
            <Sparkles className="w-3 h-3" /> {aiBusy === s.adset.id ? "…" : "AI opinion"}
          </button>
          {/* Sa Testing, ang bagong Kill button sa itaas na ang panpatay — doble
              kung isasama pa ito. Sa Scaling (campaign) lang ang Pause now. */}
          {isCampaign && s.kind === "kill" && /active/i.test(s.adset.status) && (
            <button onClick={() => { if (confirm(`Pause campaign "${s.adset.name}" on Facebook?`)) pauseAdset(s, false) }}
              disabled={pausing === s.adset.id}
              className="text-[11px] flex items-center gap-1 px-2 py-1 rounded-md bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">
              <Pause className="w-3 h-3" /> {pausing === s.adset.id ? "…" : "Pause now"}
            </button>
          )}
        </span>
      </div>
      <p className="text-[13px] text-slate-600">{s.reason}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 tabular-nums">
        {(["w3", "w7", "w15", "w30"] as const).map((w, i) => {
          const win = s.windows[w]
          const prev = i < 3 ? s.windows[(["w7", "w15", "w30"] as const)[i]] : null
          const up = prev ? win.netRoas >= prev.netRoas : true
          return (
            <span key={w}>
              {w.slice(1)}d: <b className={win.netRoas >= rules.scaleRoas ? "text-emerald-600" : win.netRoas < rules.killRoas ? "text-rose-600" : "text-slate-700"}>{dec(win.netRoas)}</b>
              {prev && (up ? <ChevronUp className="inline w-3 h-3 text-emerald-500" /> : <ChevronDown className="inline w-3 h-3 text-rose-500" />)}
              <span className="text-slate-400"> ({peso(win.spend)})</span>
            </span>
          )
        })}
        <span className="text-slate-400">gross 7d: {dec(s.windows.w7.grossRoas)} · RTS rate {(s.adset.rtsRate * 100).toFixed(1)}%</span>
      </div>
      {/* Resulta MULA sa rehistro + bawat hakbang ng pag-scale */}
      {s.reg && (
        <div className="text-[11px] text-slate-500 bg-slate-50 rounded-md px-2 py-1.5 space-y-0.5">
          <p>
            <b>Registered {s.reg.registered_at}</b>
            {s.sinceReg && <> · day {s.sinceReg.days} · {peso(s.sinceReg.spend)} spent · net <b className={s.sinceReg.netRoas >= rules.scaleRoas ? "text-emerald-600" : s.sinceReg.netRoas < rules.killRoas ? "text-rose-600" : ""}>{dec(s.sinceReg.netRoas)}</b> · {s.sinceReg.purchases} purchases</>}
          </p>
          {s.reg.scales.map((sc, i) => (
            <p key={i} className={sc.applied ? "" : "text-amber-600"}>
              #{i + 1} · {sc.date} · +{sc.pct}% · {peso(sc.from)} → {peso(sc.to)}{sc.applied ? "" : " (recorded only — CBO, raise on the campaign)"}
            </p>
          ))}
        </div>
      )}
      {aiOpen === s.adset.id && aiText[s.adset.id] && (
        <div className="text-[13px] bg-violet-50 border border-violet-200 rounded-md p-2.5 text-slate-700 whitespace-pre-wrap">{aiText[s.adset.id]}</div>
      )}
      {/* Drill-down: ad sets/ads sa campaign (Scaling) o ads sa ad set (Testing) */}
      {drillOpen[drillParent(s)] && (() => {
        const lvl = drillOpen[drillParent(s)] as "adset" | "ad"
        const key = `${drillParent(s)}|${lvl}`
        const rows = adRows[key] || []
        return (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          {adsBusy === key ? (
            <p className="text-[12px] text-slate-400 p-3 flex items-center gap-2"><RefreshCw className="w-3 h-3 animate-spin" /> Pulling {lvl === "adset" ? "ad sets" : "ads"}…</p>
          ) : rows.length === 0 ? (
            <p className="text-[12px] text-slate-400 italic p-3">No {lvl === "adset" ? "ad sets" : "ads"} with data in the last 30 days.</p>
          ) : (
            <div className="overflow-x-auto scrollbar-dark">
              <table className="w-full text-[11px] min-w-[620px]">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-left">
                    {["", lvl === "adset" ? "AD SET" : "AD", "STATUS", "SPEND", "NET ROAS", "PURCH", "CPP", "CTR", "FREQ", ...(lvl === "ad" ? ["ACTIONS"] : [])].map(h => (
                      <th key={h} className="px-2 py-1.5 font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="px-2 py-1.5 text-slate-400 tabular-nums">
                        {/* Ang top 3 ay tinatatakan — iyon ang hinahanap sa 40+ creative */}
                        {i < 3 && r.netRoas > 0 ? ["🥇", "🥈", "🥉"][i] : i + 1}
                      </td>
                      <td className="px-2 py-1.5 max-w-[220px]">
                        <span className="flex items-center gap-1.5">
                          {r.thumbnail && <img src={r.thumbnail} alt="" className="w-6 h-6 rounded object-cover shrink-0" />}
                          <span className="truncate text-slate-700">{r.name}</span>
                        </span>
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        <span className={`px-1.5 py-0.5 rounded-full ${/active/i.test(r.status) ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                          {r.status.toLowerCase().replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 tabular-nums whitespace-nowrap">{peso(r.spend)}</td>
                      <td className={`px-2 py-1.5 tabular-nums font-bold ${r.netRoas >= rules.scaleRoas ? "text-emerald-600" : r.netRoas < rules.killRoas ? "text-rose-600" : "text-amber-600"}`}>{dec(r.netRoas)}</td>
                      <td className="px-2 py-1.5 tabular-nums">{r.purchases}</td>
                      <td className="px-2 py-1.5 tabular-nums whitespace-nowrap">{r.purchases > 0 ? peso(r.cpp) : "—"}</td>
                      <td className="px-2 py-1.5 tabular-nums">{r.ctr.toFixed(2)}%</td>
                      <td className={`px-2 py-1.5 tabular-nums ${r.frequency >= 2.5 ? "text-amber-600 font-semibold" : ""}`}>{dec(r.frequency)}</td>
                      {lvl === "ad" && (
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <span className="flex items-center gap-1">
                            {/active/i.test(r.status) && (
                              <button onClick={() => killAd(s, r)} disabled={adActBusy === r.id}
                                className="text-[10px] flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">
                                <Pause className="w-2.5 h-2.5" /> {adActBusy === r.id ? "…" : "Kill"}
                              </button>
                            )}
                            {/* Testing lang: ang panalong ad ay inililipat sa scaling
                                campaign — mano-mano sa Ads Manager, marker lang ito. */}
                            {!isCampaign && (movedAds.has(r.id)
                              ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">✅ Moved</span>
                              : <button onClick={() => markMoved(s, r)} disabled={adActBusy === r.id}
                                  title="Mark as moved — you move it yourself in Ads Manager"
                                  className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                                  {adActBusy === r.id ? "…" : "Move to Scaling"}
                                </button>)}
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        ) })()}
    </div>
  )

  const Section = ({ title, icon: Icon, color, rows, accent, empty }: any) => (
    <div className="space-y-2">
      <p className={`text-sm font-bold ${color} flex items-center gap-1.5`}><Icon className="w-4 h-4" /> {title} ({rows.length})</p>
      {rows.length === 0
        ? <p className="text-[13px] text-slate-400 italic">{empty}</p>
        : rows.map((s: Signal) => <Row key={s.adset.id} s={s} accent={accent} />)}
    </div>
  )

  const num = (v: number, set: (n: number) => void) => (
    <input type="number" step="0.1" value={v} onChange={e => set(Number(e.target.value))}
      className="w-20 h-8 rounded border border-slate-300 px-2 text-sm text-right" />
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="space-y-1">
          <p className="text-sm text-slate-500">
            {isCampaign
              ? <>Registered <b>campaigns</b> · scale 10% / 20% on the campaign budget · open <b>View ads</b> for per-creative results</>
              : <>Registered <b>ad sets</b> · tracked from the day you register at 3 / 7 / 15 / 30 days</>}
          </p>
          <p className="text-[11px] text-slate-400">Net ROAS = value × (1 − page RTS rate) ÷ (spend × 1.12) · ad-set level</p>
          {/* Legend — ang tatlong bilang sa account picker ay nasa ganitong pagkakasunod */}
          <p className="text-[11px] text-slate-400 flex items-center gap-2.5">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> scale</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500" /> kill</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> watch</span>
          </p>
        </div>
        <span className="ml-auto flex items-center gap-2">
          <select value={fOwner} onChange={e => setFOwner(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 min-w-[130px]">
            <option value="All">All Owners</option>
            {owners.map(o => <option key={o}>{o}</option>)}
          </select>
          <AccountPicker value={fAccount} onChange={setFAccount} items={accountItems} totals={accountTotals} />
          <button onClick={() => setSortDir(d => d === "desc" ? "asc" : "desc")}
            title={sortDir === "desc" ? "Highest net ROAS first" : "Lowest net ROAS first"}
            className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-600 flex items-center gap-1.5 hover:bg-slate-50 whitespace-nowrap">
            ROAS {sortDir === "desc" ? <ArrowDown className="w-3.5 h-3.5" /> : <ArrowUp className="w-3.5 h-3.5" />}
          </button>
          {isScaling && (
            <>
              <button onClick={() => setPickOpen(true)} disabled={loading}
                className="h-9 px-3 rounded-lg bg-blue-600 text-white text-sm flex items-center gap-1.5 hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap">
                <Plus className="w-4 h-4" /> Register {isCampaign ? "campaigns" : "ad sets"}
              </button>
              {scaleSel.size > 0 && (
                <button onClick={() => setBulkScale(true)}
                  className="h-9 px-3 rounded-lg bg-emerald-600 text-white text-sm flex items-center gap-1.5 hover:bg-emerald-700 whitespace-nowrap">
                  <TrendingUp className="w-4 h-4" /> Scale {scaleSel.size} selected
                </button>
              )}
            </>
          )}
          <button onClick={() => askAi("brief")} disabled={aiBusy === "brief" || loading}
            className="h-9 px-3 rounded-lg bg-violet-600 text-white text-sm flex items-center gap-1.5 hover:bg-violet-700 disabled:opacity-50">
            <Sparkles className="w-4 h-4" /> {aiBusy === "brief" ? "Thinking…" : "Morning brief"}
          </button>
          <button onClick={() => setSettingsOpen(o => !o)} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-600 flex items-center gap-1.5 hover:bg-slate-50">
            <Settings className="w-4 h-4" /> Rules
          </button>
          <button onClick={() => { load(true); loadFatigue(true) }} disabled={loading}
            className="h-9 w-9 rounded-lg border border-slate-200 bg-white text-slate-600 flex items-center justify-center hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </span>
      </div>

      {/* Auto-pause status */}
      {rules.autoMaster && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5 text-[13px] text-rose-700 flex flex-wrap items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span><b>Auto-pause is ON</b> ({Object.entries(rules.autoRules).filter(([, v]) => v).map(([k]) => k).join(", ") || "no rules enabled"}) — cap {rules.autoDailyCap}/day, {autoLog.items.length} paused today. Runs only while this tab is open.</span>
        </div>
      )}
      {autoLog.items.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-[13px] text-slate-600 space-y-1">
          <p className="font-semibold text-slate-700">Paused today (undo re-activates on Facebook):</p>
          {autoLog.items.map(it => (
            <p key={it.id} className="flex items-center gap-2">{it.name}
              <button onClick={() => undoPause(it)} className="text-[11px] flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-300 hover:bg-slate-50"><Undo2 className="w-3 h-3" /> Undo</button>
            </p>
          ))}
        </div>
      )}

      {/* Settings */}
      {settingsOpen && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 text-sm">
          <p className="font-bold text-slate-800">Rules — saved on this browser</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-slate-600">
            <label className="flex items-center justify-between gap-2">Scale: net ROAS ≥ {num(rules.scaleRoas, n => saveRules({ ...rules, scaleRoas: n }))}</label>
            <label className="flex items-center justify-between gap-2">…for days {num(rules.scaleDays, n => saveRules({ ...rules, scaleDays: n }))}</label>
            <label className="flex items-center justify-between gap-2">Min daily spend {num(rules.minDailySpend, n => saveRules({ ...rules, minDailySpend: n }))}</label>
            <label className="flex items-center justify-between gap-2">Kill: day net ROAS &lt; {num(rules.killRoas, n => saveRules({ ...rules, killRoas: n }))}</label>
            <label className="flex items-center justify-between gap-2">No-sales check hour {num(rules.noSalesHour, n => saveRules({ ...rules, noSalesHour: n }))}</label>
            <label className="flex items-center justify-between gap-2">Eval min spend {num(rules.evalMinSpend, n => saveRules({ ...rules, evalMinSpend: n }))}</label>
            <label className="flex items-center justify-between gap-2">Bleeding: 3d net &lt; {num(rules.bleedRoas, n => saveRules({ ...rules, bleedRoas: n }))}</label>
            <label className="flex items-center justify-between gap-2">…at 3d spend ≥ {num(rules.bleedSpend, n => saveRules({ ...rules, bleedSpend: n }))}</label>
            <label className="flex items-center justify-between gap-2">CPP ceiling (3d) {num(rules.cppMax, n => saveRules({ ...rules, cppMax: n }))}</label>
          </div>
          <hr className="border-slate-100" />
          <p className="font-bold text-slate-800">Auto-pause <span className="font-normal text-slate-400">(acts on real Facebook ad sets — start with suggest-only)</span></p>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-slate-600">
            <label className="flex items-center gap-2"><input type="checkbox" checked={rules.autoMaster} onChange={e => saveRules({ ...rules, autoMaster: e.target.checked })} /> Master switch</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={rules.autoRules.bleeding} onChange={e => saveRules({ ...rules, autoRules: { ...rules.autoRules, bleeding: e.target.checked } })} /> Bleeding</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={rules.autoRules.lowRoas} onChange={e => saveRules({ ...rules, autoRules: { ...rules.autoRules, lowRoas: e.target.checked } })} /> Low ROAS</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={rules.autoRules.noSales} onChange={e => saveRules({ ...rules, autoRules: { ...rules.autoRules, noSales: e.target.checked } })} /> No sales</label>
            <label className="flex items-center justify-between gap-2">Daily cap {num(rules.autoDailyCap, n => saveRules({ ...rules, autoDailyCap: n }))}</label>
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-[13px] text-amber-800 space-y-0.5">
          <p className="font-semibold">Some data didn&apos;t load — the lists below may be incomplete:</p>
          {errors.slice(0, 6).map((e, i) => <p key={i}>{e}</p>)}
        </div>
      )}
      {registry.error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5 text-[13px] text-rose-700">{registry.error}</div>
      )}
      {orphans.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-[13px] text-amber-800 space-y-1">
          <p className="font-semibold">
            {orphans.length} registration{orphans.length === 1 ? "" : "s"} can&apos;t be matched to a live {unitLabel}
          </p>
          <p className="text-[12px]">
            Usually the object was deleted, or it was registered at the wrong level by an older build
            (a campaign saved as an ad set). Re-register it from the correct tab, or remove it here.
          </p>
          {orphans.map(o => (
            <p key={o.adset_id} className="flex items-center gap-2 flex-wrap">
              <span className="truncate">{o.adset_name || o.adset_id}</span>
              <span className="text-[11px] text-amber-600">registered {o.registered_at}</span>
              <button onClick={() => registry.unregister(o.adset_id)}
                className="text-[11px] px-1.5 py-0.5 rounded border border-amber-300 hover:bg-amber-100">Remove</button>
            </p>
          ))}
        </div>
      )}

      {/* ── Register picker ── */}
      {pickOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setPickOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3.5 border-b border-slate-200">
              <p className="font-bold text-slate-800">Register {isCampaign ? "campaigns" : "ad sets"} to monitor</p>
              <p className="text-[12px] text-slate-500">
                Monitoring starts <b>today ({today})</b> — results are tracked from this date at 3 / 7 / 15 / 30 days.
                {isCampaign ? " Only registered campaigns appear in Scaling." : " Only registered ad sets appear in Testing."}
              </p>
            </div>
            <div className="px-5 py-2 border-b border-slate-100 space-y-2">
              <div className="flex flex-wrap gap-2">
                <select value={pickOwner} onChange={e => setPickOwner(e.target.value)}
                  className="h-9 rounded-lg border border-slate-200 px-2 text-sm text-slate-700 min-w-[130px]">
                  <option value="All">All Owners</option>
                  {pickOwners.map(o => <option key={o}>{o}</option>)}
                </select>
                <select value={pickAcct} onChange={e => setPickAcct(e.target.value)}
                  className="h-9 rounded-lg border border-slate-200 px-2 text-sm text-slate-700 flex-1 min-w-[170px]">
                  <option value="All">All ad accounts ({pickAccounts.length})</option>
                  {pickAccounts.map(a => <option key={a}>{a}</option>)}
                </select>
                <label className="h-9 flex items-center gap-1.5 text-[12px] text-slate-600 whitespace-nowrap">
                  <input type="checkbox" checked={pickActiveOnly} onChange={e => setPickActiveOnly(e.target.checked)} />
                  Active only
                </label>
              </div>
              <input value={pickQ} onChange={e => setPickQ(e.target.value)} placeholder="Search ad set / campaign / account…"
                className="w-full h-9 rounded-lg border border-slate-200 px-3 text-sm" />
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-1 min-h-[200px]">
              {pickable.length === 0
                ? <p className="text-sm text-slate-400 italic p-4">
                    {adsets.length === 0 ? "Still loading ad sets…"
                      : pickBase.length === 0 ? "Nothing left to register — every ad set is already registered."
                        : "No ad set matches these filters."}
                  </p>
                : pickable.map(m => (
                  <label key={m.id} className="flex items-start gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-50 cursor-pointer">
                    <input type="checkbox" className="mt-0.5" checked={pickSel.has(m.id)}
                      onChange={e => setPickSel(p => { const n = new Set(p); e.target.checked ? n.add(m.id) : n.delete(m.id); return n })} />
                    <span className="min-w-0">
                      <span className="block text-sm text-slate-800 truncate">{m.name}</span>
                      <span className="block text-[11px] text-slate-400 truncate">
                        {!isCampaign && <>{m.campaignName} · </>}{m.account.name} · {/active/i.test(m.status) ? "active" : m.status.toLowerCase()}
                        {(() => { const t = budgetTarget(m); return t.level === "adset" ? ` · budget ${peso(t.amount)}`
                          : t.level === "campaign" ? ` · CBO ${peso(t.amount)}` : " · no budget" })()}
                      </span>
                      {/* Ilang araw na — mahalaga ito kapag pumipili: bago ba o
                          matagal nang tumatakbo? */}
                      {m.createdTime && (
                        <span className={`block text-[11px] font-semibold ${daysOld(m.createdTime) <= 7 ? "text-emerald-600" : daysOld(m.createdTime) <= 30 ? "text-slate-500" : "text-slate-400"}`}>
                          {daysOld(m.createdTime)}d old · created {m.createdTime.slice(0, 10)}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex items-center gap-2 flex-wrap">
              <span className="text-[12px] text-slate-500">
                {pickSel.size} selected · {pickable.length} shown
                {pickable.length > 0 && (
                  <>
                    {" · "}
                    <button onClick={() => setPickSel(p => { const n = new Set(p); pickable.forEach(m => n.add(m.id)); return n })}
                      className="text-blue-600 hover:underline">select all shown</button>
                    {pickSel.size > 0 && <> · <button onClick={() => setPickSel(new Set())} className="text-slate-500 hover:underline">clear</button></>}
                  </>
                )}
              </span>
              <span className="ml-auto flex gap-2">
                <button onClick={() => setPickOpen(false)} className="h-9 px-3 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50">Cancel</button>
                <button onClick={doRegister} disabled={pickSel.size === 0 || busy === "register"}
                  className="h-9 px-4 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50">
                  {busy === "register" ? "Registering…" : `Start monitoring ${pickSel.size}`}
                </button>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Scale prompt: 10% o 20% ── */}
      {(scaleFor || bulkScale) && (() => {
        const targets = bulkScale ? view.filter(s => scaleSel.has(s.adset.id)) : (scaleFor ? [scaleFor] : [])
        // Ang CBO campaign na hinahati ng dalawang napiling ad set ay BINIBILANG
        // NANG ISA — kung hindi, doble ang ipapakitang kabuuan.
        const seen = new Set<string>()
        const totalNow = targets.reduce((t, s) => {
          const bt = budgetTarget(s.adset)
          if (bt.level === "none") return t
          const key = `${bt.level}:${bt.id}`
          if (seen.has(key)) return t
          seen.add(key)
          return t + bt.amount
        }, 0)
        const cboShared = targets.filter(s => budgetTarget(s.adset).level === "campaign").length > seen.size
          ? targets.length - seen.size : 0
        return (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => { setScaleFor(null); setBulkScale(false) }}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5 space-y-3" onClick={e => e.stopPropagation()}>
              <p className="font-bold text-slate-800">Scale {targets.length === 1 ? "this ad set" : `${targets.length} ad sets`}?</p>
              <p className="text-[13px] text-slate-500">
                This raises the <b>daily budget on Facebook</b> and records the step so the scale count stays accurate.
                Current total: <b>{peso(totalNow)}</b>.
              </p>
              {cboShared > 0 && (
                <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
                  {cboShared} of these share a CBO campaign budget with another selected ad set —
                  that campaign is raised <b>once</b>, not per ad set.
                </p>
              )}
              <div className="max-h-32 overflow-y-auto text-[11px] text-slate-500 bg-slate-50 rounded-md p-2 space-y-0.5">
                {targets.map(s => { const bt = budgetTarget(s.adset); return (
                  <p key={s.adset.id} className="truncate">
                    {s.adset.name} — {bt.level === "none" ? "no budget anywhere"
                      : bt.level === "campaign" ? `CBO ${peso(bt.amount)} → ${peso(Math.round(bt.amount * 1.2))} (campaign)`
                        : `${peso(bt.amount)} (ad set)`}
                    {s.reg && s.reg.scales.length > 0 ? ` · scale #${s.reg.scales.length + 1}` : " · first scale"}
                  </p>
                ) })}
              </div>
              <div className="flex gap-2 pt-1">
                {[10, 20].map(pct => (
                  <button key={pct} onClick={() => applyScale(targets, pct)} disabled={busy === "scale"}
                    className="flex-1 h-11 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50">
                    {busy === "scale" ? "…" : <>Scale {pct}%<span className="block text-[11px] font-normal opacity-80">{peso(totalNow * (1 + pct / 100))}</span></>}
                  </button>
                ))}
              </div>
              <button onClick={() => { setScaleFor(null); setBulkScale(false) }}
                className="w-full h-9 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50">Cancel</button>
            </div>
          </div>
        )
      })()}

      {loading ? (
        <div className="py-10 space-y-3">
          <p className="text-sm text-slate-400 flex items-center gap-2 justify-center">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Pulling 30 days of ad-set data — {progress.done}/{progress.total} accounts
          </p>
          <div className="mx-auto w-64 h-1.5 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-[width] duration-300"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
        </div>
      ) : (
        <>
          {view.length === 0 && registry.loaded && !registry.error && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-[13px] text-blue-800">
              <b>Nothing registered yet.</b> Click <b>Register {isCampaign ? "campaigns" : "ad sets"}</b> to pick what to follow —
              monitoring starts the day you register.
              {isCampaign
                ? <> Scale 10% or 20% from here (it raises the campaign budget), and open <b>View ads</b> to see which creative is carrying the campaign.</>
                : <> Use this for new tests; once one earns it, register the campaign in the <b>Scaling</b> tab.</>}
            </div>
          )}
          <Section title="Ready to Scale" icon={TrendingUp} color="text-emerald-600" accent="border-emerald-500" rows={scaleRows}
            empty={`None yet — needs net ROAS ≥ ${rules.scaleRoas} for ${rules.scaleDays}+ straight days with ≥ ${peso(rules.minDailySpend)}/day.`} />
          <Section title="Kill Suggestions" icon={Skull} color="text-rose-600" accent="border-rose-500" rows={killRows}
            empty="Nothing hits the kill rules right now." />
          <Section title="Monitoring / Watch" icon={Eye} color="text-amber-600" accent="border-amber-400" rows={watchRows}
            empty={`No registered ${unitLabel} is waiting.`} />

          {/* Fatigue — kada AD */}
          <div className="space-y-2">
            <p className="text-sm font-bold text-violet-600 flex items-center gap-1.5">
              <Flame className="w-4 h-4" /> Creative Fatigue — per ad ({fatigueView.length})
              {fatigueLoading && <RefreshCw className="w-3 h-3 animate-spin text-slate-400" />}
            </p>
            {fatigueView.length === 0
              ? <p className="text-[13px] text-slate-400 italic">{fatigueLoading ? "Comparing last 3 days vs the 7 before…" : "No ad shows 2+ fatigue signals."}</p>
              : fatigueView.map(f => (
                <div key={f.adId} className="border-l-4 border-violet-400 bg-white rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-800 text-sm">{f.adName}</span>
                    <span className="text-[11px] text-slate-400">{f.account.name}</span>
                    <span className="ml-auto text-[11px] bg-violet-50 text-violet-600 px-2 py-0.5 rounded-full">refresh creative — don&apos;t kill</span>
                  </div>
                  <p className="text-[13px] text-slate-600 mt-1">Signals (last 3d vs prior 7d): {f.signals.join(" · ")}</p>
                </div>
              ))}
          </div>

          {/* Ask AI */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
            <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-violet-600" /> Ask AI <span className="font-normal text-slate-400">— context: the {view.length} signal rows shown{fOwner !== "All" ? ` (${fOwner})` : ""}</span></p>
            <div className="flex gap-2">
              <input value={askQ} onChange={e => setAskQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && askQ.trim()) askAi("ask") }}
                placeholder="e.g. why did Lumyra Katarata drop the last 3 days?"
                className="flex-1 h-10 rounded-lg border border-slate-200 px-3 text-sm" />
              <button onClick={() => askAi("ask")} disabled={!askQ.trim() || aiBusy === "ask"}
                className="h-10 px-4 rounded-lg bg-violet-600 text-white text-sm flex items-center gap-1.5 hover:bg-violet-700 disabled:opacity-50">
                <Send className="w-4 h-4" /> {aiBusy === "ask" ? "…" : "Ask"}
              </button>
            </div>
            {askA && <div className="text-[13px] bg-violet-50 border border-violet-200 rounded-md p-3 text-slate-700 whitespace-pre-wrap">{askA}</div>}
          </div>
        </>
      )}
    </div>
  )
}
