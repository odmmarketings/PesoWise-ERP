"use client"
import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from "react"
import {
  TrendingUp, Skull, Eye, Flame, RefreshCw, Settings,
  ChevronDown, ChevronUp, Pause, Undo2, AlertTriangle, ArrowUp, ArrowDown, Check, Plus, X, LayoutGrid, Layers,
  ExternalLink,
} from "lucide-react"
import { useActivePages } from "@/lib/pages-store"
import { actId, type FBAccount } from "@/lib/fb-store"
import { cachedJson } from "@/lib/pancake-cache"
import { useScalingRegistry, type Registration, type ScaleEvent } from "@/lib/scaling-registry-store"
import { logAds, logAdsMany } from "@/lib/ads-activity-store"
import { playToggle, playError } from "@/lib/ui-feedback"

// ─────────────────────────────────────────────────────────────────────────────
// SCALING TRACKER — nasa loob ng Facebook Ads tab.
//
// MGA DESISYON NG MAY-ARI (Ago 14 2026):
//   • Suggest-only ang default; may auto-pause na maaaring buksan kada rule.
//   • NET ROAS ang batayan: value × (1 − RTS rate ng page) ÷ (spend × 1.12).
//     Ang RTS rate ay kada PAGE sa parehong 31-araw na window (hindi kada ad
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
// `w1` = NGAYONG ARAW. Nauna ito sa lahat: iyon ang unang tinitingnan kapag
// binuksan mo ang tab, at dati ay nasa reason text lang — wala sa hanay ng
// numero, kaya mukhang nagsisimula sa 3 araw ang kasaysayan.
type Windows = Record<"w1" | "w3" | "w7" | "w15" | "w31", { spend: number; value: number; purchases: number; netRoas: number; grossRoas: number; cpp: number }>
type Signal = {
  adset: AdsetModel; windows: Windows
  kind: "scale" | "kill" | "watch"
  rule: string; reason: string; streak: number
  todaySpend: number; todayNet: number
  // Naka-set lang sa mga inirehistro (Scaling tab): ang resulta MULA sa petsa ng
  // rehistro, at ang kasaysayan ng pag-scale.
  reg?: Registration
  sinceReg?: { days: number; spend: number; value: number; netRoas: number; purchases: number }
  // Naka-set lang sa Monitoring: kabuuan mula sa unang araw ng buwan.
  mtd?: { spend: number; value: number; purchases: number; netRoas: number }
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
//
// ⚠ ANG BITAG NA NAG-BALIK NG SPINNER (nahuli Ago 14 2026): ang resulta LANG ang
// nakatabi, kaya ang cache ay pumapalya kung saan ito pinakakailangan — kapag
// nagpalit ka ng tab habang HINDI PA TAPOS ang hila. Nag-uumpisa ang bagong
// mount ng PANGALAWANG buong hila (21 account × 3 request), tapos ang pangatlo
// sa susunod na palit… kaya walang natatapos at 0/21 ang bar habambuhay. Ang
// sagot ay hindi mas mahabang TTL kundi ang IN-FLIGHT na mapa sa ibaba: ang
// pumapasok na mount ay SUMASAKAY sa tumatakbo nang hila, hindi nagsisimula ng
// bago. Isang hila kada cacheKey sa buong app, kahit ilang beses ka magpalit.
type Cached = {
  ts: number; adsets: AdsetModel[]; errors: string[]
  fatigue: FatigueRow[]
  // Hiwalay na timestamp: ang WALANG LAMAN na fatigue ay tamang sagot din
  // ("walang pagod na ad"). Dating `fatigue.length > 0` ang kondisyon ng cache,
  // kaya ang pinakakaraniwang kalagayan ay muling humihila ng 42 request kada
  // pagbukas ng tab — iyon ang kumakain ng koneksyon ng pangunahing hila.
  fatigueTs: number
  // Aling account ang TALAGANG nakarating — kailangan ng orphan check.
  loadedAccounts: string[]
}
const MODEL_CACHE = new Map<string, Cached>()
const MODEL_INFLIGHT = new Map<string, Promise<void>>()
const FATIGUE_INFLIGHT = new Map<string, Promise<void>>()
// Progreso ng tumatakbong hila, kada key — para may makitang gumagalaw na bar
// ang mount na sumakay sa hila ng iba (hindi nito natatanggap ang setState nito).
const MODEL_PROGRESS = new Map<string, { done: number; total: number }>()
// 30 minuto. Hindi ito tungkol sa "gaano kaluma ang pinapakita" — ang luma ay
// ipinapakita agad at tahimik na pinapalitan; ito ay tungkol sa gaano kadalas
// tayo humihila muli. Ang 10 minuto ay nangangahulugang bawat pagbalik mula sa
// ibang pahina ay bagong 21-account na hila para sa datos na hawak na natin.
const MODEL_TTL = 30 * 60_000
// Ang binuksang drill-down (View ad sets / View ads) ay nasa component state
// dati, kaya nawawala kapag lumipat ka ng tab — muling hihila sa susunod mong
// pagbukas ng parehong campaign. Sa module na ito nakatira ngayon.
const DRILL_CACHE = new Map<string, { ts: number; rows: any[] }>()

// ── MGA PAGBABAGONG GALING SA'TIN ────────────────────────────────────────────
// ⚠ Ang pagpatay ay dating nasa component state LANG. Pindutin ang Kill, lumipat
// sa Ads Manager, bumalik — at buhay na naman ang pinatay mo (iniulat ng may-ari,
// Ago 15 2026). Dalawang dahilan, magkasunod: ang remount ay kumukuha sa
// MODEL_CACHE na hawak pa ang LUMANG status, at kahit sariwang hila pa, huli si
// Meta sa sarili niyang sulat (read-after-write). Kaya nasa MODULE ang tala —
// nabubuhay ito sa remount — at ipinapatong sa kahit anong sabihin ng modelo,
// hanggang sumang-ayon si Meta o mag-expire.
const LOCAL_TTL = 15 * 60_000
const LOCAL_STATUS = new Map<string, { to: string; at: number }>()
const LOCAL_BUDGET = new Map<string, { to: number; at: number }>()   // key = budget TARGET id
/** Sumang-ayon na ba si Meta? Kalimutan na ang tala — o kung luma na, bitawan. */
function reconcileLocal(models: AdsetModel[]) {
  const now = Date.now()
  const byId = new Map(models.map(m => [m.id, m]))
  for (const [id, v] of Array.from(LOCAL_STATUS)) {
    if (now - v.at > LOCAL_TTL) { LOCAL_STATUS.delete(id); continue }
    const m = byId.get(id)
    if (m && (/active/i.test(v.to) ? /active/i.test(m.status) : /paus/i.test(m.status))) LOCAL_STATUS.delete(id)
  }
  for (const [id, v] of Array.from(LOCAL_BUDGET)) {
    if (now - v.at > LOCAL_TTL) { LOCAL_BUDGET.delete(id); continue }
    const hit = models.find(m => (m.id === id && m.budget === v.to) || (m.campaignId === id && m.campaignBudget === v.to))
    if (hit) LOCAL_BUDGET.delete(id)
  }
}
const freshCache = (key: string): Cached | null => {
  const hit = MODEL_CACHE.get(key)
  return hit && Date.now() - hit.ts < MODEL_TTL ? hit : null
}

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

// ── TATLONG TAB, ISANG ENGINE ────────────────────────────────────────────────
//   mode="testing"    → AD SET level. Irehistro ang bagong testing ad set; mula
//                       sa petsa ng rehistro, sinusundan ang 3/7/15/31-araw na
//                       resulta hanggang umabot sa scale threshold.
//   mode="scaling"    → CAMPAIGN level. Irehistro ang scaling campaign (1-1-40+
//                       Andromeda). Dito ang Scale 10%/20% dahil sa CAMPAIGN
//                       nakalagay ang CBO budget — hindi sa ad set. May per-ad
//                       na view din para makita kung aling creative ang umaandar.
//   mode="monitoring" → CAMPAIGN level, WALANG rehistro (hiling ng may-ari,
//                       Ago 14 2026: "automatic lahat na naka-select, walang
//                       register something"). Lahat ng campaign na may gastos sa
//                       buwan ay nandito, pang-tingin ng buong buwan. Kill lang
//                       ang aksyon — walang Scale, walang Register. May View ad
//                       sets / View ads pa rin.
// Isang engine para hindi maghiwalay ang net-ROAS math sa tatlong lugar.
export type ManagerFocus = {
  accountId: string; level: "campaign" | "adset" | "ad"; id: string; name: string; campaignId?: string
  owner?: string
  note?: string
}
/** 1st, 2nd, 3rd, 4th… — para mabasa ang "pang-ilang scale na ito". */
const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"][(n % 100 - 20) % 10] ?? ["th", "st", "nd", "rd"][n % 100] ?? "th"
  return `${n}${s}`
}
/** Galing sa Ads Manager: buksan ang tab na ito na SALA na sa ad account na ito. */
export type TrackerFocus = { accountName: string; owner?: string; objectId?: string; objectName?: string }

export function ScalingTracker({ accounts, onSignals, mode, onOpenInManager, focus }: {
  accounts: FBAccount[]; onSignals?: (n: number) => void; mode: "testing" | "scaling" | "monitoring"
  /** Pinipindot ang pangalan ng row → bumubukas ang Ads Manager na nakatutok dito. */
  onOpenInManager?: (f: ManagerFocus) => void
  focus?: TrackerFocus | null
}) {
  const allPages = useActivePages()
  const registry = useScalingRegistry()
  const level: "adset" | "campaign" = mode === "testing" ? "adset" : "campaign"
  const isCampaign = level === "campaign"
  const isMonitoring = mode === "monitoring"
  const unitLabel = isCampaign ? "campaign" : "ad set"
  // Ang Testing at Scaling ay nakabatay sa rehistro; ang Monitoring ay hindi —
  // doon nagmumula ang "lahat nakikita" laban sa "ang pinili mo lang".
  const isScaling = !isMonitoring
  const [rules, setRules] = useState<Rules>(() => loadRules())
  const saveRules = (r: Rules) => { setRules(r); try { localStorage.setItem(RULES_KEY, JSON.stringify(r)) } catch {} }

  const live = useMemo(() => accounts.filter(a => !a.archived && a.token && a.ad_account_id), [accounts])

  // ⚠ ANG BITAG NA NAKA-DOKUMENTO SA CLAUDE.md: ang useActivePages() (at ang mga
  // store array sa pangkalahatan) ay nagbabalik ng SARIWANG array bawat render.
  // Nailagay sila sa dependencies ng load callbacks, kaya WALANG KATAPUSANG
  // nagre-refetch ang tab: render → bagong `load` → effect → setState → render…
  // Kaya "nag-blink-blink" ang loading at hindi natatapos — nire-restart ang hila
  // bago pa matapos (nakita Ago 13 2026; ganito rin ang Jul 9 Fulfillment glitch).
  // Ang effect ay nakakabit na sa VALUE STRING (liveKey); ang arrays ay binabasa
  // sa REF sa oras ng takbo, hindi sa closure.
  // ⚠ NAKA-SORT. Ang `fb_accounts` ay hinihila nang `order(inserted_at desc)`, at
  // ang mga account na sabay na naidagdag ay may PAREHONG inserted_at — hindi
  // tinitiyak ng Postgres ang pagkakasunod ng magkakapantay. Iba ang pagkakasunod,
  // ibang liveKey, ibang cacheKey — at buong bagong hila para sa parehong 21
  // account. Ang pagkakasunod ay hindi dapat bahagi ng pagkakakilanlan.
  const liveKey = useMemo(() => live.map(a => a.id).sort().join(","), [live])
  const liveRef = useRef(live);      liveRef.current = live
  const pagesRef = useRef(allPages); pagesRef.current = allPages

  // ── 31-ARAW NA SAKLAW (PHT — lokal na orasan ng user) ──────────────────────
  // 31, hindi 30 (hiling ng may-ari, Ago 14 2026): iyon ang haba ng pinakamahabang
  // buwan, kaya laging sakop ng gulong na ito ang buong kasalukuyang buwan.
  const today = dstr(new Date())
  const monthStart = useMemo(() => { const d = new Date(); return dstr(new Date(d.getFullYear(), d.getMonth(), 1)) }, [])
  const from31 = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 30)   // 30 pabalik + ngayon = 31 araw
    const rolling = dstr(d)
    // Panatag na sa 31 araw ang buong buwan, pero nananatili ang lawak na ito
    // bilang panangga kung sakaling paikliin muli ang gulong balang-araw.
    return isMonitoring && monthStart < rolling ? monthStart : rolling
  }, [isMonitoring, monthStart])
  const last3From = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 2); return dstr(d) }, [])
  const prev7From = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 9); return dstr(d) }, [])
  const prev7To = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 3); return dstr(d) }, [])

  const cacheKey = `${level}|${liveKey}|${from31}|${today}`

  // ── SINISIMULAN MULA SA CACHE, HINDI SA SPINNER ────────────────────────────
  // Dating `useState(true)` ang `loading`, kaya kahit tumatama ang cache ay may
  // isang pinta pa ring "Pulling 31 days…" bago tumakbo ang effect. Ang bumabalik
  // sa tab ay dapat WALANG makitang spinner. Isang beses lang ito binabasa (mount).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const boot = useMemo(() => freshCache(cacheKey), [])
  const [loading, setLoading] = useState(!boot)
  const [progress, setProgress] = useState(() => MODEL_PROGRESS.get(cacheKey) ?? { done: 0, total: 0 })
  const [errors, setErrors] = useState<string[]>(boot?.errors ?? [])
  const [adsets, setAdsets] = useState<AdsetModel[]>(boot?.adsets ?? [])
  const [fatigue, setFatigue] = useState<FatigueRow[]>(boot?.fatigue ?? [])
  const [fatigueLoading, setFatigueLoading] = useState(!boot?.fatigueTs)
  // Pangalan ng account na tunay na nakarating ang datos. Ang orphan check LANG
  // ang gumagamit nito — huwag isipin ang pumalyang account bilang "wala na".
  const [loadedAccounts, setLoadedAccounts] = useState<string[]>(boot?.loadedAccounts ?? [])
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Galing sa jump ng Ads Manager: SALA na agad. Ang tab na ito ay ini-mount lang
  // kapag binuksan (may sariling `key`), kaya sapat ang unang halaga ng state —
  // walang effect, walang kumukurap na "ALL" bago mag-filter.
  const [fOwner, setFOwner] = useState(focus?.owner || "All")
  const [fAccount, setFAccount] = useState(focus?.accountName || "ALL")
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc")

  // Isinasalin ang naka-cache na resulta sa state ng mount na ito.
  const applyCached = useCallback((c: Cached) => {
    setAdsets(c.adsets); setErrors(c.errors); setLoadedAccounts(c.loadedAccounts)
    if (c.fatigueTs) { setFatigue(c.fatigue); setFatigueLoading(false) }
    setLoading(false)
  }, [])

  const load = useCallback(async (force = false) => {
    if (!force) {
      // ⚠ ANG SPINNER AY PARA LANG SA WALANG MAIPAPAKITA. Kapag may naipakita
      // na tayo dati, ang tamang asal ay: ilabas AGAD ang huling alam, at kung
      // luma na ito, tahimik na palitan sa likod. Ang muling pagtatago ng datos
      // sa likod ng "Pulling…" ay pagbawi ng bagay na nasa kamay na — iyon ang
      // nararamdamang "nag-loloading ulit" (iniulat Ago 14 2026).
      const any = MODEL_CACHE.get(cacheKey)
      if (any) {
        applyCached(any)
        if (Date.now() - any.ts < MODEL_TTL) return
        // Luma na — pag-refresh nang WALANG spinner. Papalitan lang ang mga
        // numero kapag dumating; hindi mawawala ang listahan habang naghihintay.
        if (!MODEL_INFLIGHT.has(cacheKey)) {
          const bg = runLoad(false)
          MODEL_INFLIGHT.set(cacheKey, bg)
          bg.catch(() => {}).finally(() => MODEL_INFLIGHT.delete(cacheKey))
        }
        return
      }
      // Tumatakbo na ito ngayon (naiwan ng dating tab, o mabilis kang nagpalit)?
      // SUMAKAY — huwag magsimula ng pangalawang 21-account na hila. Ito mismo
      // ang dahilan kung bakit hindi natatapos ang 0/21 dati.
      const running = MODEL_INFLIGHT.get(cacheKey)
      if (running) {
        setLoading(true)
        // Ang bar ay sinasabayan sa module — hindi natin natatanggap ang
        // setProgress ng mount na nagsimula nito (baka wala na ito).
        const tick = setInterval(() => {
          const p = MODEL_PROGRESS.get(cacheKey)
          if (p) setProgress({ ...p })
        }, 250)
        try { await running } catch { /* naitala na ng nagpatakbo */ }
        finally { clearInterval(tick) }
        const done = MODEL_CACHE.get(cacheKey)
        if (done) applyCached(done)
        else setLoading(false)
        return
      }
    }
    setLoading(true)
    const run = runLoad(force)
    MODEL_INFLIGHT.set(cacheKey, run)
    try { await run }
    catch (e: any) { setErrors(p => [...p, `load failed — ${String(e?.message).slice(0, 90)}`]); setLoading(false) }
    finally { MODEL_INFLIGHT.delete(cacheKey) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, applyCached])

  // Ang TUNAY na hila. Hiwalay para maibahagi ang IISANG promise sa lahat ng
  // mount na humihingi ng parehong cacheKey.
  const runLoad = useCallback(async (force: boolean) => {
    const live = liveRef.current, allPages = pagesRef.current
    MODEL_PROGRESS.set(cacheKey, { done: 0, total: live.length })
    setProgress({ done: 0, total: live.length })
    const errs: string[] = []
    const ok: string[] = []

    // 1. RTS rate kada page (returning+returned ÷ total sales, parehong window).
    const rtsByPage = new Map<string, number>()
    const pageNames = Array.from(new Set(live.map(a => a.page_name).filter(Boolean)))
    await mapLimit(pageNames, 4, async name => {
      const pg = allPages.find(p => p.name === name && p.api_key && (p.pancake_page_id || p.shop_id))
      if (!pg) return   // walang Pancake creds → walang RTS data → gross ang gagamitin (rate 0, hayag sa UI)
      try {
        const j = await cachedJson(
          `/api/pancake/orders?api_key=${encodeURIComponent(pg.api_key)}&page_id=${encodeURIComponent(pg.pancake_page_id || pg.shop_id)}`
          + `&from=${from31}&to=${today}&phase=fast${force ? "&nocache=1" : ""}`)
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
          fetch(`/api/fb/insights?series=1&level=${level}&token=${encodeURIComponent(a.token)}&account_id=${acct}&from=${from31}&to=${today}${force ? "&nocache=1" : ""}`).then(r => r.json()),
          fetch(`/api/fb/insights?rich=1&level=${level}&parent=${acct}&token=${encodeURIComponent(a.token)}&account_id=${acct}&from=${from31}&to=${today}${force ? "&nocache=1" : ""}`).then(r => r.json()),
          // Sa Testing (adset level) kailangan pa rin ang campaign budget: 65% ng
          // ad sets nila ay CBO (nasukat Ago 14 2026). Sa Scaling, ang `meta` na
          // mismo ang campaign — kaya hindi na kailangan ng pangalawang hila.
          isCampaign
            ? Promise.resolve({ success: true, rows: [] })
            : fetch(`/api/fb/insights?rich=1&level=campaign&parent=${acct}&token=${encodeURIComponent(a.token)}&account_id=${acct}&from=${from31}&to=${today}${force ? "&nocache=1" : ""}`).then(r => r.json()),
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
        ok.push(a.name)
      } catch (e: any) { errs.push(`${a.name}: ${String(e?.message).slice(0, 80)}`) }
      finally {
        const p = MODEL_PROGRESS.get(cacheKey) ?? { done: 0, total: live.length }
        const next = { done: p.done + 1, total: p.total }
        MODEL_PROGRESS.set(cacheKey, next)
        setProgress(next)
      }
    })
    reconcileLocal(models)   // bago itabi: alisin ang mga tala na katugma na ni Meta
    setAdsets(models)
    setErrors(errs)
    setLoadedAccounts(ok)
    setLoading(false)
    // Itabi. Ang `fatigue` ay dumarating mamaya (hiwalay na hila) — ini-update ito
    // ng loadFatigue sa parehong entry, kaya hindi nawawala kapag bumalik ka.
    const prev = MODEL_CACHE.get(cacheKey)
    MODEL_CACHE.set(cacheKey, {
      ts: Date.now(), adsets: models, errors: errs, loadedAccounts: ok,
      fatigue: prev?.fatigue ?? [], fatigueTs: prev?.fatigueTs ?? 0,
    })
  }, [from31, today, cacheKey])

  // 3. Fatigue kada AD: huling 3 araw vs naunang 7 (frequency mula kay Meta mismo).
  const loadFatigue = useCallback(async (force = false) => {
    if (!force) {
      const hit = MODEL_CACHE.get(cacheKey)
      // ⚠ `fatigueTs` ang batayan, HINDI ang `fatigue.length`. Ang walang laman
      // ay tamang sagot din ("walang pagod na ad") at iyon ang karaniwan — dating
      // muling humihila ng 42 request kada pagbukas ng tab dahil dito.
      if (hit?.fatigueTs) {
        setFatigue(hit.fatigue); setFatigueLoading(false)
        if (Date.now() - hit.fatigueTs < MODEL_TTL) return
        // Luma na — tahimik na palitan, walang umiikot na spinner.
        if (!FATIGUE_INFLIGHT.has(cacheKey)) {
          const bg = runFatigue(false)
          FATIGUE_INFLIGHT.set(cacheKey, bg)
          bg.catch(() => {}).finally(() => FATIGUE_INFLIGHT.delete(cacheKey))
        }
        return
      }
      const running = FATIGUE_INFLIGHT.get(cacheKey)
      if (running) {
        setFatigueLoading(true)
        try { await running } catch { /* naitala na ng nagpatakbo */ }
        const done = MODEL_CACHE.get(cacheKey)
        if (done?.fatigueTs) setFatigue(done.fatigue)
        setFatigueLoading(false)
        return
      }
    }
    setFatigueLoading(true)
    const run = runFatigue(force)
    FATIGUE_INFLIGHT.set(cacheKey, run)
    try { await run } catch { /* laktawan — dagdag lang ito sa mga signal */ }
    finally { FATIGUE_INFLIGHT.delete(cacheKey); setFatigueLoading(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey])

  const runFatigue = useCallback(async (force: boolean) => {
    const live = liveRef.current
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
    // Isinasama sa UMIIRAL na entry lang. Ang paggawa ng bagong entry dito ay
    // maglalagay ng WALANG LAMAN na adsets sa cache, at ang susunod na mount ay
    // maghihintay ng listahang hindi na darating.
    const prev = MODEL_CACHE.get(cacheKey)
    if (prev) MODEL_CACHE.set(cacheKey, { ...prev, fatigue: out, fatigueTs: Date.now() })
  }, [last3From, prev7From, prev7To, today, cacheKey])

  // Isang hila kada tunay na pagbabago ng account set — HINDI kada render.
  // Ang `load`/`loadFatigue` ay sadyang WALA sa deps: matatag na sila ngayon
  // (walang array sa kanilang closure), at ang paglagay sa kanila ay ibabalik
  // lang ang loop.
  //
  // SUNOD-SUNOD, hindi sabay: ang fatigue ay 2 request kada account (42 sa 21
  // account) at nag-aagawan sila sa 6-connection na limitasyon ng browser sa
  // pangunahing hila — kaya nakaupo ang bar habang ang hindi naman kailangan
  // agad ang unang natatapos. Ang listahan muna; ang fatigue ay dagdag lang.
  useEffect(() => {
    if (!liveKey) return
    load().then(() => loadFatigue()).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey])

  // Ang modelong nakikita mo = ang hinila kay Meta + ang mga pagbabagong tayo
  // mismo ang gumawa at hindi pa niya inuulat pabalik.
  const [localTick, setLocalTick] = useState(0)
  const markLocal = useCallback(() => setLocalTick(t => t + 1), [])
  const effAdsets = useMemo(() => adsets.map(m => {
    const st = LOCAL_STATUS.get(m.id)
    const ab = LOCAL_BUDGET.get(m.id)             // ABO: sariling budget ng ad set
    const cb = LOCAL_BUDGET.get(m.campaignId)     // CBO: budget ng campaign
    if (!st && !ab && !cb) return m
    return {
      ...m,
      ...(st ? { status: st.to } : {}),
      ...(ab ? { budget: ab.to } : {}),
      ...(cb ? { campaignBudget: cb.to } : {}),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [adsets, localTick])

  // ── Signals ────────────────────────────────────────────────────────────────
  const signals = useMemo<Signal[]>(() => {
    const out: Signal[] = []
    const now = new Date()
    const hour = now.getHours()
    const dates: string[] = []
    for (let i = 30; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); dates.push(dstr(d)) }

    // Ang bawat tab ay nakikita LANG ang sariling antas — kung hindi, lalabas ang
    // mga campaign sa Testing at mga ad set sa Scaling.
    // ⚠ Sa Monitoring ay SADYANG WALANG rehistro na ikinakabit, kahit pareho ang
    // antas nito ng Scaling: kung hindi, ang campaign na nakarehistro sa Scaling
    // ay magdadala ng Scale, Undo at unregister na buton dito — samantalang Kill
    // lang ang aksyon sa tab na ito.
    const regByAdset = isMonitoring
      ? new Map<string, Registration>()
      : new Map(registry.regs.filter(r => r.level === level).map(r => [r.adset_id, r]))

    for (const m of effAdsets) {
      const reg = regByAdset.get(m.id)
      // Sa Scaling tab, ang INIREHISTRO LANG — iyon ang buong punto: malinis at
      // pinili mo mismo. Sa Monitoring, lahat.
      if (isScaling && !reg) continue

      const win = (n: number) => {
        let spend = 0, value = 0, purchases = 0
        for (const dt of dates.slice(-n)) { const d = m.dailies.get(dt); if (d) { spend += d.spend; value += d.purchaseValue; purchases += d.purchases } }
        return { spend, value, purchases, netRoas: netOf(value, spend, m.rtsRate), grossRoas: spend > 0 ? value / (spend * VAT) : 0, cpp: purchases > 0 ? spend / purchases : 0 }
      }
      const windows: Windows = { w1: win(1), w3: win(3), w7: win(7), w15: win(15), w31: win(31) }
      // Ang inirehistro ay pinapakita KAHIT walang gastos pa — iyon ang sagot sa
      // "sinimulan kong i-monitor ngayon" (araw 0, wala pang datos).
      if (windows.w31.spend === 0 && !reg) continue

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

      // Buwanang kabuuan (mula unang araw ng buwan) — ito ang hinihinging
      // "results ng buong month" sa Monitoring.
      let mtd: Signal["mtd"]
      if (isMonitoring) {
        let spend = 0, value = 0, purchases = 0
        for (const [dt, d] of m.dailies) {
          if (dt < monthStart) continue
          spend += d.spend; value += d.purchaseValue; purchases += d.purchases
        }
        mtd = { spend, value, purchases, netRoas: netOf(value, spend, m.rtsRate) }
      }
      // Sa Monitoring ang tanong ay "ano ang tumakbo NGAYONG BUWAN" — ang
      // gumastos lang noong nakaraang buwan ay ingay sa listahan ng buwan.
      if (isMonitoring && (!mtd || mtd.spend === 0)) continue

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
      const base = { adset: m, windows, streak, todaySpend, todayNet, reg, sinceReg, mtd }

      // Pagkatapos mag-scale, may 48h na palugit: hindi pa dapat husgahan agad —
      // nagre-relearn ang delivery. Tanda lang ito, hindi kill/scale.
      const lastScale = reg?.scales[reg.scales.length - 1]
      const hoursSinceScale = lastScale
        ? (Date.now() - new Date(`${lastScale.date}T00:00:00`).getTime()) / 3600_000 : Infinity
      // ⚠ ANG PAGDURUGO AY HINDI RELEARNING. Dating sinasakop ng 48h na cooldown
      // ang LAHAT — kaya ang campaign na sinaktan ng scale ay nakatago sa Watch
      // nang dalawang araw habang nasusunog ang pera, at hindi ito lumalabas sa
      // Kill (ni hindi maaabot ng auto-pause). Ang matinding pagdurugo LANG ang
      // dumadaan sa cooldown; ang lahat ng ibang hatol ay naghihintay pa rin.
      if (reg && hoursSinceScale < 48 && isActive
        && windows.w3.netRoas < rules.bleedRoas && windows.w3.spend >= rules.bleedSpend) {
        out.push({ ...base, kind: "kill", rule: "bleeding",
          reason: `Bleeding INSIDE the 48h post-scale window: 3-day net ROAS ${dec(windows.w3.netRoas)} on ${peso(windows.w3.spend)} spent. `
            + `Relearning doesn't explain this much — kill it, don't wait out the cooldown.` })
        continue
      }
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
            + (isMonitoring
              // Walang Scale na buton dito — huwag mangako ng aksyong wala rito.
              ? ` Register it in the Scaling tab if you want to raise its budget from here.`
              : bt.level !== "none"
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
      // Sa Monitoring, LAHAT ay may row: iyon ang buong punto ng tab.
      if (reg) {
        out.push({ ...base, kind: "watch", rule: "monitoring",
          reason: sinceReg && sinceReg.spend > 0
            ? `Day ${sinceReg.days} since registered · net ${dec(sinceReg.netRoas)} on ${peso(sinceReg.spend)}. `
              + `Needs ${rules.scaleRoas}+ for ${rules.scaleDays} straight days to qualify (currently ${streak}).`
            : `Registered ${reg.registered_at} — no spend recorded yet.` })
      } else if (isMonitoring) {
        out.push({ ...base, kind: "watch", rule: "monitoring",
          reason: mtd && mtd.spend > 0
            ? `Month to date: net ${dec(mtd.netRoas)} on ${peso(mtd.spend)} across ${mtd.purchases} purchases. Nothing hits a rule right now.`
            : `No spend this month yet.` })
      }
    }
    return out
  }, [effAdsets, rules, today, registry.regs, level, isMonitoring, monthStart])

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

  // Filter + sort ayon sa 7-day net ROAS (ang default na 31-araw na sukat).
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
  // ⚠ HINDI ULILA ANG GALING SA ACCOUNT NA PUMALYA. Kapag na-timeout o tumanggi
  // si Meta para sa isang ad account, wala ang mga object nito sa `adsets` — at
  // dating lumalabas ang bawat rehistro nito rito na may "Remove" na buton.
  // Isang pindot at mawawala ang totoong monitoring dahil lang sa sandaling
  // pagpalya ng API. Ang account na hindi nakarating ay LAKTAWAN, hindi tanungin.
  const okAccounts = useMemo(() => new Set(loadedAccounts), [loadedAccounts])
  const orphans = useMemo(() => {
    // Walang rehistro sa Monitoring — ang mga ulila ng Scaling ay doon inaayos,
    // parehong `level` man sila.
    if (isMonitoring || !registry.loaded || loading) return []
    const ids = new Set(adsets.map(m => m.id))
    return registry.regs.filter(r =>
      r.level === level && !ids.has(r.adset_id) && okAccounts.has(r.account_name))
  }, [registry.regs, registry.loaded, adsets, level, loading, okAccounts, isMonitoring])

  const scaleRows = view.filter(s => s.kind === "scale")
  const killRows = view.filter(s => s.kind === "kill")
  const watchRows = view.filter(s => s.kind === "watch")
  const fatigueView = useMemo(() => fatigue.filter(f =>
    (fOwner === "All" || f.account.owner === fOwner) && (fAccount === "ALL" || f.account.name === fAccount)),
    [fatigue, fOwner, fAccount])
  // ── ANG BILANG SA TAB ──────────────────────────────────────────────────────
  // Hiling ng may-ari (Ago 14 2026): hindi ito bilang ng signal kundi ang LAMAN
  // ng tab. Testing at Scaling → ilan ang inirehistro mo na BUHAY pa (aktibo);
  // Monitoring → lahat ng nakikita. Dating scale+kill+fatigue ang binibilang,
  // kaya "4" ang Scaling kahit tatlo lang ang nakarehistro doon.
  // Hindi ito naka-filter sa owner/account — ang KABUUAN ang gusto mong makita,
  // hindi ang bahagi ng napiling owner.
  const totalSignals = useMemo(() => isMonitoring
    ? signals.length
    : signals.filter(s => s.reg && /active/i.test(s.adset.status)).length,
    [signals, isMonitoring])
  useEffect(() => { onSignals?.(totalSignals) }, [totalSignals, onSignals])

  // ── Auto-pause (kapag naka-ON ang master + ang rule) ───────────────────────
  type AutoLog = { date: string; items: { id: string; name: string; token: string }[] }
  const [autoLog, setAutoLog] = useState<AutoLog>(() => {
    try { const l = JSON.parse(localStorage.getItem(AUTOLOG_KEY) || "null"); if (l?.date === dstr(new Date())) return l } catch {}
    return { date: dstr(new Date()), items: [] }
  })
  // ⚠ FUNCTIONAL UPDATE — hindi `{ ...autoLog }`. Ang auto-pause ay nagpapatakbo
  // ng ilang pause SABAY sa iisang pass, at lahat sila ay may parehong `autoLog`
  // sa closure: ang huling nakatapos ang nag-iisang naitatala at nabubura ang
  // iba. Kaya kulang ang bilang laban sa daily cap (nakakalusot pa ng higit sa
  // hangganan) at hindi mai-undo ang mga naunang pause. Kapatid ito ng bitag ng
  // patchMeta sa Fulfillment.
  const saveLog = useCallback((fn: (prev: AutoLog) => AutoLog) => {
    setAutoLog(prev => {
      const next = fn(prev)
      try { localStorage.setItem(AUTOLOG_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [])
  // Nakabukas ang tab nang lampas hatinggabi? Bagong araw, bagong cap.
  const rollLog = (prev: AutoLog): AutoLog => prev.date === today ? prev : { date: today, items: [] }
  const [pausing, setPausing] = useState<string>("")
  // ── PATUNAY NA TUMALAB ─────────────────────────────────────────────────────
  // Dating "…" lang ang lumalabas habang naghihintay, at pagkatapos ay walang
  // anuman — kaya hindi mo alam kung tumalab ba o hindi ang pagpindot mo, lalo
  // na't ang status badge ay isang maliit na kulay lang ang pinagkaiba. Ang
  // toast na ito ay ang hayagang sagot: pinatay nga, at kumpirmado ni Facebook.
  const [killToast, setKillToast] = useState<{ name: string; what: string; ok: boolean } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showKillToast = useCallback((name: string, what: string, ok: boolean) => {
    setKillToast({ name, what, ok })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setKillToast(null), 5000)
  }, [])
  // Huwag mag-set ng state pagkatapos mawala ang component.
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  async function pauseAdset(s: Signal, auto: boolean) {
    setPausing(s.adset.id)
    try {
      const j = await fetch("/api/fb/manage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: s.adset.account.token, action: "status", id: s.adset.id, status: "PAUSED" }),
      }).then(r => r.json())
      if (!j.success) throw new Error(j.error || "pause failed")
      logAds({ action: "kill", level, objectId: s.adset.id, objectName: s.adset.name,
        accountName: s.adset.account.name, surface: mode,
        summary: auto ? `Auto-paused (${s.rule})` : "Killed (paused)",
        details: { auto, rule: s.rule, reason: s.reason } })
      saveLog(prev => {
        const cur = rollLog(prev)
        return { ...cur, items: [...cur.items, { id: s.adset.id, name: s.adset.name, token: s.adset.account.token }] }
      })
      // Buhay sa remount — ito ang dahilan kung bakit "nabubuhay" ang pinatay.
      LOCAL_STATUS.set(s.adset.id, { to: "PAUSED", at: Date.now() }); markLocal()
      setAdsets(prev => prev.map(m => m.id === s.adset.id ? { ...m, status: "PAUSED" } : m))
      playToggle(false)
      showKillToast(s.adset.name, auto ? `auto-paused (${s.rule})` : `${unitLabel} is now PAUSED on Facebook`, true)
    } catch (e: any) {
      setErrors(prev => [...prev, `${s.adset.name}: ${auto ? "auto-" : ""}pause failed — ${String(e?.message).slice(0, 80)}`])
      playError()
      showKillToast(s.adset.name, `could NOT be paused — ${String(e?.message).slice(0, 60)}`, false)
    } finally { setPausing("") }
  }
  useEffect(() => {
    // ⚠ WALANG AUTO-PAUSE SA MONITORING. Lahat ng campaign ang nakikita rito at
    // walang pinili ang may-ari — ang pagpapatakbo ng auto-pause dito ay
    // magpapapatay ng buong campaign nang hindi hiningi. Ang Kill ay pindot.
    if (isMonitoring || !rules.autoMaster || loading) return
    // Kahapon pa ang log kung nakabukas ang tab magdamag — huwag itong bilangin
    // laban sa cap ngayong araw (at huwag ding gamiting "na-pause na" na tala).
    const log = autoLog.date === today ? autoLog : { date: today, items: [] }
    const eligible = killRows.filter(s =>
      rules.autoRules[s.rule as keyof Rules["autoRules"]]
      && /active/i.test(s.adset.status)
      && !log.items.some(x => x.id === s.adset.id))
    const room = rules.autoDailyCap - log.items.length
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
    else logAdsMany(items.map(i => ({
      action: "register" as const, level, objectId: i.adset_id, objectName: i.adset_name,
      accountName: i.account_name, surface: mode,
      summary: `Registered to monitor · starting budget ${peso(i.starting_budget)}`,
      details: { registered_at: i.registered_at, starting_budget: i.starting_budget },
    })))
    setPickSel(new Set()); setPickOpen(false); setBusy("")
  }

  // ── Pag-scale: itinataas ang budget sa Meta, saka itinatala ────────────────
  const [scaleFor, setScaleFor] = useState<Signal | null>(null)
  const [bulkScale, setBulkScale] = useState(false)
  const [scaleSel, setScaleSel] = useState<Set<string>>(new Set())
  // Hakbang 2 ng scale modal: napiling % na hinihintay ng kumpirmasyon.
  const [confirmPct, setConfirmPct] = useState<number | null>(null)

  async function applyScale(targets: Signal[], pct: number) {
    setBusy("scale")
    // Ang CBO ay may ISANG budget na hinahati ng maraming ad set. Kung dalawang
    // ad set ng parehong campaign ang napili, ang dobleng pagtaas ng 20% ay
    // magiging 44% — hindi iyon ang hiningi. Isang beses kada campaign.
    const doneCampaigns = new Set<string>()
    // Kapag ISA lang ang target, dinadala ka nito sa mismong campaign sa Ads
    // Manager pagkatapos — doon mo ilalagay ang sarili mong rules. Itinatabi ang
    // pang-ilang scale at ang tunay na galaw ng budget bago pa mag-refresh ang
    // registry, dahil pagkatapos noon ay iba na ang bilang.
    let jump: ManagerFocus | null = null
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
      logAds({ action: "scale", level, objectId: s.adset.id, objectName: s.adset.name,
        accountName: s.adset.account.name, surface: mode,
        summary: applied ? `+${pct}% · ${peso(from)} → ${peso(to)}` : `+${pct}% recorded only (not applied on Facebook)`,
        details: { pct, from, to, applied, scaleNo: (s.reg?.scales.length ?? 0) + 1, budgetLevel: t.level } })
      if (applied) {
        LOCAL_BUDGET.set(t.id, { to, at: Date.now() }); markLocal()
        setAdsets(prev => prev.map(m =>
          t.level === "adset"
            ? (m.id === s.adset.id ? { ...m, budget: to } : m)
            // CBO: bawat ad set ng campaign na iyon ay nakikita ang bagong budget
            : (m.campaignId === t.id ? { ...m, campaignBudget: to } : m)))
      }

      if (targets.length === 1 && applied) {
        const n = (s.reg?.scales.length ?? 0) + 1     // kasama na ang kagagawa lang
        jump = {
          accountId: s.adset.account.id,
          owner: s.adset.account.owner || undefined,
          level: isCampaign ? "campaign" : "adset",
          id: s.adset.id,
          name: s.adset.name,
          campaignId: s.adset.campaignId || undefined,
          note: `${ordinal(n)} scale · +${pct}% · ${peso(from)} → ${peso(to)}`,
        }
      }
    }
    setScaleFor(null); setBulkScale(false); setScaleSel(new Set()); setConfirmPct(null); setBusy("")
    // Huling hakbang: dalhin siya doon. Sa bulk ay hindi — walang iisang
    // campaign na mapupuntahan.
    if (jump) onOpenInManager?.(jump)
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
  // Buhay pa ang nahila kanina kahit nag-tab-switch ka — walang "Pulling ads…"
  // sa pangalawang pagbukas ng parehong campaign.
  const [adRows, setAdRows] = useState<Record<string, AdRow[]>>(
    () => Object.fromEntries(Array.from(DRILL_CACHE, ([k, v]) => [k, v.rows as AdRow[]])))
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
        + `&from=${from31}&to=${today}`).then(r => r.json())
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
      DRILL_CACHE.set(key, { ts: Date.now(), rows })
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
      logAds({ action: "kill", level: "ad", objectId: ad.id, objectName: ad.name,
        accountName: s.adset.account.name, surface: mode, summary: "Ad killed (paused)",
        details: { under: s.adset.name } })
      const key = `${drillParent(s)}|ad`
      const flip = (rows: AdRow[]) => rows.map(r => r.id === ad.id ? { ...r, status: "PAUSED" } : r)
      setAdRows(p => ({ ...p, [key]: flip(p[key] || []) }))
      // Isulat din sa module cache — kung hindi, babalik ang "active" pagkatapos
      // mong lumipat ng tab at buksan muli ang parehong campaign.
      const cached = DRILL_CACHE.get(key)
      if (cached) DRILL_CACHE.set(key, { ...cached, rows: flip(cached.rows) })
      playToggle(false)
      showKillToast(ad.name, "ad is now PAUSED on Facebook", true)
    } catch (e: any) {
      setErrors(p => [...p, `${ad.name}: kill failed — ${String(e?.message).slice(0, 80)}`])
      playError(); showKillToast(ad.name, `could NOT be paused — ${String(e?.message).slice(0, 60)}`, false)
    }
    setAdActBusy("")
  }

  // ── Undo ng HULING scale (aksidenteng pindot) ──────────────────────────────
  // Ibinabalik ang budget sa Meta sa `from` ng step (kung na-apply ito) at
  // tinatanggal ang record — kaya bumabalik din ang "scale #N" na bilang.
  // Huling step LANG: ang pagbunot sa gitna ay sisira sa kasaysayan.
  const [undoBusy, setUndoBusy] = useState("")
  async function undoScale(s: Signal) {
    if (!s.reg || s.reg.scales.length === 0) return
    const last = s.reg.scales[s.reg.scales.length - 1]
    const t = budgetTarget(s.adset)
    // ⚠ HUWAG MAGPADALA NG BUDGET NA HINDI NATIN ALAM. Kung wala nang buhay na
    // budget na matatamaan (naging lifetime budget, o binura ang campaign) o
    // kung `0` ang `from` ng step (lumang record na walang naitalang budget),
    // ang pagpapadala niyon ay magtatakda ng ₱0 o babagsak nang malabo. Ang
    // record LANG ang tatanggalin, at hayagang sasabihin ang natitirang gawain.
    const canRevert = last.applied && t.level !== "none" && last.from > 0
    if (last.applied && !canRevert) {
      if (!confirm(`Undo scale #${s.reg.scales.length} (+${last.pct}%)?\n\n`
        + `The budget CANNOT be reverted automatically — ${t.level === "none" ? "no live daily budget was found on this " + unitLabel : "the original amount wasn't recorded"}. `
        + `This removes the recorded step only; set the budget back in Ads Manager yourself.`)) return
    } else if (!confirm(`Undo scale #${s.reg.scales.length} (+${last.pct}%)?`
      + (canRevert ? ` This sets the ${t.level} budget back to ${peso(last.from)} on Facebook.` : ` This only removes the recorded step.`))) return
    setUndoBusy(s.adset.id)
    try {
      if (canRevert) {
        // Ibalik ang budget sa Meta BAGO tanggalin ang record — kung pumalya ang
        // API, mananatili ang record at walang nagsisinungaling na kasaysayan.
        const j = await fetch("/api/fb/manage", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: s.adset.account.token, action: "update", id: t.id, daily_budget: last.from }),
        }).then(r => r.json())
        if (!j.success) throw new Error(String(j.error || "budget revert failed").slice(0, 90))
      }
      const removed = await registry.undoLastScale(s.reg.adset_id)
      if (!removed) throw new Error("could not remove the step from the registry")
      logAds({ action: "scale_undo", level, objectId: s.adset.id, objectName: s.adset.name,
        accountName: s.adset.account.name, surface: mode,
        summary: canRevert ? `Undone · back to ${peso(last.from)}` : "Record removed only (budget not reverted)",
        details: { pct: last.pct, from: last.to, to: last.from, revertedOnMeta: canRevert } })
      if (canRevert) {
        LOCAL_BUDGET.set(t.id, { to: last.from, at: Date.now() }); markLocal()
        setAdsets(prev => prev.map(m =>
          t.level === "adset"
            ? (m.id === s.adset.id ? { ...m, budget: last.from } : m)
            : (m.campaignId === t.id ? { ...m, campaignBudget: last.from } : m)))
      }
    } catch (e: any) { setErrors(p => [...p, `${s.adset.name}: undo — ${String(e?.message).slice(0, 90)}`]) }
    setUndoBusy("")
  }

  async function markMoved(s: Signal, ad: { id: string; name: string }) {
    setAdActBusy(ad.id)
    const err = await registry.register([{
      adset_id: ad.id, adset_name: ad.name, campaign_name: s.adset.campaignName,
      account_name: s.adset.account.name, owner: s.adset.account.owner || "",
      level: "ad-moved", registered_at: today, starting_budget: 0,
    }])
    if (err) setErrors(p => [...p, `${ad.name}: mark failed — ${err}`])
    else logAds({ action: "ad_moved", level: "ad", objectId: ad.id, objectName: ad.name,
      accountName: s.adset.account.name, surface: mode, summary: "Marked moved to Scaling",
      details: { from: s.adset.name } })
    setAdActBusy("")
  }

  // ── AI: INALIS (Ago 14 2026) ───────────────────────────────────────────────
  // Nawala ang per-row na "AI opinion", ang "Morning brief", at ang "Ask AI" na
  // kahon — pati ang `api/ai/scaling` na route at ang `compactRow` na
  // tagapaghanda ng payload. Desisyon ng may-ari: hindi ikokonekta ang AI dito.
  // Ang mga panuntunan (Rules panel) ang humahatol; walang AI sa daloy na ito.

  // ── UI ─────────────────────────────────────────────────────────────────────
  const Row = ({ s, accent }: { s: Signal; accent: string }) => (
    <div className={`border-l-4 ${accent} bg-white rounded-lg border border-slate-200 p-3 space-y-1.5`}>
      <div className="flex flex-wrap items-center gap-2">
        {/* Checkbox = para sa bulk Scale — campaign level lang iyon */}
        {isCampaign && s.reg && (
          <input type="checkbox" checked={scaleSel.has(s.adset.id)}
            onChange={e => setScaleSel(p => { const n = new Set(p); e.target.checked ? n.add(s.adset.id) : n.delete(s.adset.id); return n })} />
        )}
        {/* Ang pangalan ay ang daan papuntang Ads Manager: nakapili na ang ad
            account, nasa tamang antas, at ito mismo ang nakikita. */}
        {onOpenInManager ? (
          <button
            onClick={() => onOpenInManager({
              accountId: s.adset.account.id,
              level: isCampaign ? "campaign" : "adset",
              id: s.adset.id,
              name: s.adset.name,
              campaignId: s.adset.campaignId || undefined,
            })}
            title={`Open this ${unitLabel} in Ads Manager`}
            className="font-semibold text-slate-800 text-sm text-left flex items-center gap-1 hover:text-blue-600 group">
            <span className="group-hover:underline decoration-dotted underline-offset-2">{s.adset.name}</span>
            <ExternalLink className="w-3 h-3 text-slate-400 group-hover:text-blue-600 shrink-0" />
          </button>
        ) : (
          <span className="font-semibold text-slate-800 text-sm">{s.adset.name}</span>
        )}
        <span className="text-[11px] text-slate-400">
          {!isCampaign && <>{s.adset.campaignName} · </>}{s.adset.account.name}
        </span>
        {/* EDAD — highlighter yellow na may itim na teksto, hatol ng may-ari
            (Ago 17 2026). Berde ito dati at napagkakamalang katulad ng "Active"
            na nakatabi lang; naging neutral saglit, pero ang piniling sagot ay
            ang kulay ng pang-highlight — hindi ito ginagamit saanman sa Ads,
            kaya hindi ito maipagkakamali sa kalagayan.
            ⚠ Sinadyang GANAP na hex, hindi token ng Tailwind. Ang dark layer ay
            pumapalit sa mga token gaya ng `bg-slate-100`; ang ganap na halaga ay
            hindi nito nasasagasaan, kaya iisa ang neon sa dalawang tema — na
            siyang punto. Kailangan ang gilid: 1.06:1 lang ang neon kontra puti,
            kaya sa light mode ay naglalaho ang hugis kung wala ito. */}
        {s.adset.createdTime && (
          <span title={`Created ${s.adset.createdTime.slice(0, 10)}`}
            className="text-[11px] font-bold bg-[#EFFF00] text-black border border-[#b8c400] px-2 py-0.5 rounded-full whitespace-nowrap">
            {daysOld(s.adset.createdTime)}d old
          </span>
        )}
        {(() => { const t = budgetTarget(s.adset); return t.level === "none" ? null : (
          <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
            {t.level === "campaign" ? "CBO budget" : "budget"} {peso(t.amount)}
          </span>
        ) })()}
        {/* Pang-ilang scale na + saan nagsimula — ito ang hinihinging kasaysayan. */}
        {s.reg && s.reg.scales.length > 0 && (() => {
          // Ang kasalukuyang budget ay nasa CAMPAIGN kapag CBO — `s.adset.budget`
          // ay LAGING 0 sa Scaling tab (tingnan ang `budget: isCampaign ? 0`),
          // kaya -100% ang lumalabas dito dati. Sa budgetTarget kunin, hindi doon.
          const now = budgetTarget(s.adset).amount || s.reg!.scales[s.reg!.scales.length - 1].to
          const start = s.reg!.starting_budget || 0
          return (
          <span className="text-[11px] bg-indigo-100 text-indigo-700 font-semibold px-2 py-0.5 rounded-full">
            scale #{s.reg!.scales.length} · {peso(start)} → {peso(now)}
            {start > 0 && <>{" "}(+{Math.round((now / start - 1) * 100)}%)</>}
          </span>
        ) })()}
        {s.reg && s.reg.scales.length === 0 && (
          <span className="text-[11px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">not scaled yet</span>
        )}
        <span className="w-full sm:w-auto sm:ml-auto flex flex-wrap items-center gap-1.5">
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
          {/* Kill — Testing: ang inirehistrong ad set. Monitoring: kahit aling
              aktibong campaign (walang rehistro doon, at iisa lang ang aksyon).
              Scaling: "Pause now" sa ibaba, sa kill rows lang. */}
          {(isMonitoring || (!isCampaign && s.reg)) && /active/i.test(s.adset.status) && (
            <button onClick={() => { if (confirm(`Kill (pause) ${unitLabel} "${s.adset.name}" on Facebook?`)) pauseAdset(s, false) }}
              disabled={pausing === s.adset.id}
              className="text-[11px] flex items-center gap-1 px-2 py-1 rounded-md bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-70 disabled:cursor-wait min-w-[62px] justify-center transition-transform active:scale-95">
              {pausing === s.adset.id
                ? <><RefreshCw className="w-3 h-3 animate-spin" /> Killing…</>
                : <><Pause className="w-3 h-3" /> Kill</>}
            </button>
          )}
          {/* Scaling/Monitoring: ad sets + ads sa ilalim ng campaign. Testing:
              ads lang sa ilalim ng ad set (wala nang mas mababa). */}
          {(s.reg || isMonitoring) && (isCampaign ? (["adset", "ad"] as const) : (["ad"] as const)).map(lvl => {
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
            <button onClick={() => { if (confirm(`Stop monitoring "${s.adset.name}"? History is kept.`)) {
              registry.unregister(s.reg!.adset_id)
              logAds({ action: "unregister", level, objectId: s.adset.id, objectName: s.adset.name,
                accountName: s.adset.account.name, surface: mode, summary: "Stopped monitoring" })
            } }}
              title="Stop monitoring" className="text-[11px] px-1.5 py-1 rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50">
              <X className="w-3 h-3" />
            </button>
          )}
          {/* Sa Testing, ang bagong Kill button sa itaas na ang panpatay — doble
              kung isasama pa ito. Sa Scaling (campaign) lang ang Pause now. */}
          {isCampaign && !isMonitoring && s.kind === "kill" && /active/i.test(s.adset.status) && (
            <button onClick={() => { if (confirm(`Pause campaign "${s.adset.name}" on Facebook?`)) pauseAdset(s, false) }}
              disabled={pausing === s.adset.id}
              className="text-[11px] flex items-center gap-1 px-2 py-1 rounded-md bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-70 disabled:cursor-wait min-w-[86px] justify-center transition-transform active:scale-95">
              {pausing === s.adset.id
                ? <><RefreshCw className="w-3 h-3 animate-spin" /> Pausing…</>
                : <><Pause className="w-3 h-3" /> Pause now</>}
            </button>
          )}
        </span>
      </div>
      <p className="text-[13px] text-slate-600">{s.reason}</p>
      <div className="flex flex-wrap gap-x-2.5 sm:gap-x-4 gap-y-1 text-[11px] text-slate-500 tabular-nums">
        {(() => {
          // ⚠ HUWAG MAGPAKITA NG WINDOW NA HINDI PA NABUBUHAY. Ang 2-araw na ad
          // set ay nagpapakita dati ng magkaparehong bilang sa 3d/7d/15d/31d —
          // apat na hanay na mukhang apat na sukat, gayong iisa lang: wala pang
          // 7 araw na mabibilang. Mas masahol pa sa walang laman ang numerong
          // nagpapanggap na kasaysayan (iniulat ng may-ari, Ago 15 2026).
          const haveDays = s.adset.createdTime ? daysOld(s.adset.createdTime) + 1 : Infinity
          const cols = ["w1", "w3", "w7", "w15", "w31"] as const
          const need = { w1: 1, w3: 3, w7: 7, w15: 15, w31: 31 } as const
          return cols.map((w, i) => {
            const win = s.windows[w]
            const enough = haveDays >= need[w]
            const nextW = cols[i + 1]
            const prev = nextW && haveDays >= need[nextW] ? s.windows[nextW] : null
            const up = prev ? win.netRoas >= prev.netRoas : true
            const label = w === "w1" ? "today" : `${w.slice(1)}d`
            return (
              <span key={w}>
                {label}:{" "}
                {enough ? (
                  <>
                    <b className={win.netRoas >= rules.scaleRoas ? "text-emerald-600" : win.netRoas < rules.killRoas ? "text-rose-600" : "text-slate-700"}>{dec(win.netRoas)}</b>
                    {prev && (up ? <ChevronUp className="inline w-3 h-3 text-emerald-500" /> : <ChevronDown className="inline w-3 h-3 text-rose-500" />)}
                    <span className="text-slate-400"> ({peso(win.spend)})</span>
                  </>
                ) : (
                  // `text-slate-300` ay HINDI nire-remap sa dark layer, kaya sa
                  // madilim na tema ito ay mas MALIWANAG pa kaysa sa tunay na
                  // numero sa tabi nito — baligtad ang diin. Ang placeholder ay
                  // dapat pinakatahimik.
                  <span className="text-slate-400 dark:opacity-60" title={`Only ${haveDays === Infinity ? "?" : haveDays}d of data — this ${unitLabel} isn't ${need[w]} days old yet`}>—</span>
                )}
              </span>
            )
          })
        })()}
        <span className="text-slate-400">gross 7d: {dec(s.windows.w7.grossRoas)} · RTS rate {(s.adset.rtsRate * 100).toFixed(1)}%</span>
      </div>
      {/* Buwanang kabuuan — ito ang tinitingnan sa Monitoring, hindi ang gulong. */}
      {s.mtd && (
        <p className="text-[11px] text-slate-500 bg-slate-50 rounded-md px-2 py-1.5 tabular-nums">
          <b className="text-slate-600">This month ({monthStart.slice(5)} → {today.slice(5)})</b>
          {" · "}spend {peso(s.mtd.spend)}
          {" · "}value {peso(s.mtd.value)}
          {" · "}net <b className={s.mtd.netRoas >= rules.scaleRoas ? "text-emerald-600" : s.mtd.netRoas < rules.killRoas ? "text-rose-600" : "text-slate-700"}>{dec(s.mtd.netRoas)}</b>
          {" · "}{s.mtd.purchases} purchases
          {s.mtd.purchases > 0 && <> · CPP {peso(s.mtd.spend / s.mtd.purchases)}</>}
        </p>
      )}
      {/* Resulta MULA sa rehistro + bawat hakbang ng pag-scale */}
      {s.reg && (
        <div className="text-[11px] text-slate-500 bg-slate-50 rounded-md px-2 py-1.5 space-y-0.5">
          <p>
            <b>Registered {s.reg.registered_at}</b>
            {s.sinceReg && <> · day {s.sinceReg.days} · {peso(s.sinceReg.spend)} spent · net <b className={s.sinceReg.netRoas >= rules.scaleRoas ? "text-emerald-600" : s.sinceReg.netRoas < rules.killRoas ? "text-rose-600" : ""}>{dec(s.sinceReg.netRoas)}</b> · {s.sinceReg.purchases} purchases</>}
          </p>
          {s.reg.scales.map((sc, i) => {
          const isLast = i === s.reg!.scales.length - 1
          // ⚠ HINDI TUGMA ANG TALA SA TOTOO. Kung ang buhay na budget ay iba sa
          // `to` ng huling step, hindi na totoo ang kasaysayan — ibinalik sa Ads
          // Manager, hindi tumalab ang pagtaas, o aksidente ang buong hakbang.
          // Tahimik itong nangyari (₱1,000 sa Meta, ₱1,100 ang tala, at "+0%"
          // ang badge — Ago 14 2026); dapat itong hayagang sabihin.
          const live = budgetTarget(s.adset).amount
          const drifted = isLast && sc.applied && live > 0 && live !== sc.to
          return (
            <p key={i} className={`flex items-center gap-2 flex-wrap ${sc.applied ? "" : "text-amber-600"}`}>
              <span>#{i + 1} · {sc.date} · +{sc.pct}% · {peso(sc.from)} → {peso(sc.to)}{sc.applied ? "" : " (recorded only — CBO, raise on the campaign)"}</span>
              {drifted && (
                <span className="text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                  ⚠ the budget is {peso(live)} on Facebook now, not {peso(sc.to)} — this step no longer matches. Undo it if it wasn&apos;t you.
                </span>
              )}
              {/* Undo sa HULING step lang — aksidenteng pindot ang tinatarget nito */}
              {isScaling && isLast && (
                <button onClick={() => undoScale(s)} disabled={undoBusy === s.adset.id}
                  title={sc.applied ? `Reverts the budget to ${peso(sc.from)} on Facebook and removes this step` : "Removes this recorded step"}
                  className="text-[10px] flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-slate-300 text-slate-500 hover:bg-slate-100 disabled:opacity-50">
                  <Undo2 className="w-2.5 h-2.5" /> {undoBusy === s.adset.id ? "…" : "Undo"}
                </button>
              )}
            </p>
          ) })}
        </div>
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
            <p className="text-[12px] text-slate-400 italic p-3">No {lvl === "adset" ? "ad sets" : "ads"} with data in the last 31 days.</p>
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
                                className="text-[10px] flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-70 disabled:cursor-wait min-w-[52px] justify-center transition-transform active:scale-95">
                                {adActBusy === r.id
                                  ? <><RefreshCw className="w-2.5 h-2.5 animate-spin" /> Killing…</>
                                  : <><Pause className="w-2.5 h-2.5" /> Kill</>}
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

  // ⚠ TINATAWAG, HINDI ISINUSULAT BILANG <Row />. Ang `Row`/`Section` ay
  // ginagawa sa loob ng ScalingTracker, kaya BAGONG uri ng component sila kada
  // render — at itinuturing ng React ang bagong uri bilang ibang component:
  // binubuwag nito at muling binubuo ang BUONG listahan sa bawat render. Habang
  // humihila, 21 beses tumitibok ang progress → 21 buong rebuild ng lahat ng row,
  // kasama ang mga thumbnail na muling nagda-download. Ang pagtawag sa kanila
  // bilang function ay inilalatag ang resulta sa parent — walang bagong uri,
  // walang remount. (Walang hook ang dalawa, kaya ligtas ito.)
  const Section = ({ title, icon: Icon, color, rows, accent, empty }: any) => (
    <div className="space-y-2">
      <p className={`text-sm font-bold ${color} flex items-center gap-1.5`}><Icon className="w-4 h-4" /> {title} ({rows.length})</p>
      {rows.length === 0
        ? <p className="text-[13px] text-slate-400 italic">{empty}</p>
        : rows.map((s: Signal) => <Fragment key={s.adset.id}>{Row({ s, accent })}</Fragment>)}
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
            {isMonitoring
              ? <>Every <b>campaign</b> with spend this month — nothing to register · month-to-date results · <b>Kill</b> is the only action</>
              : isCampaign
                ? <>Registered <b>campaigns</b> · scale 10% / 20% on the campaign budget · open <b>View ads</b> for per-creative results</>
                : <>Registered <b>ad sets</b> · tracked from the day you register at 3 / 7 / 15 / 31 days</>}
          </p>
          <p className="text-[11px] text-slate-400">Net ROAS = value × (1 − page RTS rate) ÷ (spend × 1.12) · {unitLabel} level</p>
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
          <button onClick={() => setSettingsOpen(o => !o)} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-600 flex items-center gap-1.5 hover:bg-slate-50">
            <Settings className="w-4 h-4" /> Rules
          </button>
          <button onClick={() => { load(true).then(() => loadFatigue(true)).catch(() => {}) }} disabled={loading}
            className="h-9 w-9 rounded-lg border border-slate-200 bg-white text-slate-600 flex items-center justify-center hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </span>
      </div>

      {/* Auto-pause status */}
      {rules.autoMaster && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5 text-[13px] text-rose-700 flex flex-wrap items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span><b>Auto-pause is ON</b> ({Object.entries(rules.autoRules).filter(([, v]) => v).map(([k]) => k).join(", ") || "no rules enabled"}) — cap {rules.autoDailyCap}/day, {autoLog.date === today ? autoLog.items.length : 0} paused today. Runs only while this tab is open.</span>
        </div>
      )}
      {/* ⚠ TINALUNAN PERO WALA RITO. Ang Testing/Scaling ay INIREHISTRO lang ang
          nilalaman, kaya ang paglundag mula sa Ads Manager patungo sa hindi pa
          nakarehistrong campaign ay magpapakita ng blangkong listahan — mukhang
          sira. Sabihin nang tahasan, at ituro ang Register. */}
      {focus?.objectId && !loading && !signals.some(s => s.adset.id === focus.objectId) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-[13px] text-amber-800 flex flex-wrap items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            <b className="break-all">{focus.objectName || focus.objectId}</b>{" "}
            {isMonitoring
              ? "has no spend this month, so it isn't in Monitoring."
              : <>isn&apos;t registered in {mode === "testing" ? "Testing" : "Scaling"} yet — only registered {unitLabel}s appear here.</>}
          </span>
          {!isMonitoring && (
            <button onClick={() => setPickOpen(true)}
              className="ml-auto text-[12px] font-semibold px-2.5 py-1 rounded-lg border border-amber-300 hover:bg-amber-100 whitespace-nowrap">
              Register it →
            </button>
          )}
        </div>
      )}

      {/* Patunay na tumalab — nakalutang sa ibaba-kanan, may kusang paglaho. */}
      {killToast && (
        <div className={`fixed bottom-4 right-4 z-[70] rounded-xl shadow-lg px-4 py-3 w-[330px] border flex items-start gap-2.5
          ${killToast.ok ? "bg-white border-emerald-200" : "bg-white border-rose-200"}`}>
          {killToast.ok
            ? <Check className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            : <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />}
          <div className="min-w-0">
            <p className={`text-sm font-bold ${killToast.ok ? "text-emerald-700" : "text-rose-700"}`}>
              {killToast.ok ? "Done — confirmed by Facebook" : "Failed"}
            </p>
            <p className="text-[13px] text-slate-600 break-words"><b>{killToast.name}</b> {killToast.what}</p>
          </div>
          <button onClick={() => setKillToast(null)} className="ml-auto text-slate-400 hover:text-slate-600 shrink-0"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Ang "Paused today" na listahan na may Undo ay INALIS (Ago 15 2026).
          Ang pinatay ay dapat mawala — hindi manatili sa screen bilang listahan
          na maaari mong buhaying muli nang aksidente. Nadoble pa ito kapag
          paulit-ulit ang pagpindot. Ang tala ay nasa Activity Log; ang pagbubukas
          muli ay sinasadya nang gawin sa Ads Manager. Nananatili ang `autoLog`
          para sa daily cap ng auto-pause — bilang lang, hindi na UI. */}

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
                Monitoring starts <b>today ({today})</b> — results are tracked from this date at 3 / 7 / 15 / 31 days.
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
                        <span className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[11px] font-bold bg-[#EFFF00] text-black border border-[#b8c400] px-2 py-0.5 rounded-full whitespace-nowrap">
                            {daysOld(m.createdTime)}d old
                          </span>
                          <span className="text-[11px] text-slate-400">created {m.createdTime.slice(0, 10)}</span>
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
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => { setScaleFor(null); setBulkScale(false); setConfirmPct(null) }}>
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
              {/* DALAWANG HAKBANG: pumili ng % muna, saka kumpirmahin — tunay na
                  pera ito at madaling mapindot nang aksidente. */}
              {confirmPct === null ? (
                <>
                  <div className="flex gap-2 pt-1">
                    {[10, 20].map(pct => (
                      <button key={pct} onClick={() => setConfirmPct(pct)}
                        className="flex-1 h-11 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700">
                        Scale {pct}%<span className="block text-[11px] font-normal opacity-80">{peso(totalNow * (1 + pct / 100))}</span>
                      </button>
                    ))}
                  </div>
                  <button onClick={() => { setScaleFor(null); setBulkScale(false); setConfirmPct(null) }}
                    className="w-full h-9 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50">Cancel</button>
                </>
              ) : (
                <>
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 text-[13px] text-emerald-800">
                    Confirm <b>scale {confirmPct}%</b>: {peso(totalNow)} → <b>{peso(totalNow * (1 + confirmPct / 100))}</b>
                    {targets.length > 1 ? ` across ${targets.length} ad sets` : ""}. This changes the budget on Facebook now.
                    {targets.length === 1 && <> Then it opens this {unitLabel} in <b>Ads Manager</b> so you can add your rules.</>}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => setConfirmPct(null)} disabled={busy === "scale"}
                      className="flex-1 h-11 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50 disabled:opacity-50">Back</button>
                    <button onClick={() => applyScale(targets, confirmPct)} disabled={busy === "scale"}
                      className="flex-1 h-11 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50">
                      {busy === "scale" ? "Applying…" : `Confirm scale ${confirmPct}%`}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )
      })()}

      {loading ? (
        <div className="py-10 space-y-3">
          <p className="text-sm text-slate-400 flex items-center gap-2 justify-center">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Pulling {isMonitoring ? "this month's" : "31 days of"} {isCampaign ? "campaign" : "ad-set"} data — {progress.done}/{progress.total} accounts
          </p>
          <div className="mx-auto w-64 h-1.5 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-[width] duration-300"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
        </div>
      ) : (
        <>
          {view.length === 0 && registry.loaded && !registry.error && !isMonitoring && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-[13px] text-blue-800">
              <b>Nothing registered yet.</b> Click <b>Register {isCampaign ? "campaigns" : "ad sets"}</b> to pick what to follow —
              monitoring starts the day you register.
              {isCampaign
                ? <> Scale 10% or 20% from here (it raises the campaign budget), and open <b>View ads</b> to see which creative is carrying the campaign.</>
                : <> Use this for new tests; once one earns it, register the campaign in the <b>Scaling</b> tab.</>}
            </div>
          )}
          {/* Sa Monitoring ay walang Scale na buton, kaya "Winning" ang tawag —
              hindi "Ready to Scale", na nangangako ng aksyong wala rito. */}
          {Section({ title: isMonitoring ? "Winning" : "Ready to Scale", icon: TrendingUp, color: "text-emerald-600", accent: "border-emerald-500", rows: scaleRows,
            empty: `None yet — needs net ROAS ≥ ${rules.scaleRoas} for ${rules.scaleDays}+ straight days with ≥ ${peso(rules.minDailySpend)}/day.` })}
          {Section({ title: "Kill Suggestions", icon: Skull, color: "text-rose-600", accent: "border-rose-500", rows: killRows,
            empty: "Nothing hits the kill rules right now." })}
          {Section({ title: isMonitoring ? "Everything else" : "Monitoring / Watch", icon: Eye, color: "text-amber-600", accent: "border-amber-400", rows: watchRows,
            empty: isMonitoring ? `No ${unitLabel} spent this month.` : `No registered ${unitLabel} is waiting.` })}

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

        </>
      )}
    </div>
  )
}
