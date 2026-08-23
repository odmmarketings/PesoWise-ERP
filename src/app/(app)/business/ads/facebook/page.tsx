"use client"
import { useState, useMemo, useEffect, useCallback, useRef, Fragment } from "react"
import {
  Megaphone, RefreshCw, Wallet, TrendingUp, ShoppingCart, Target, MessageSquare, ClipboardList,
  LayoutDashboard, CalendarDays, Settings2, ChevronDown, Search, Play, Pause, Link2,
  ArrowUp, ArrowDown, ArrowUpDown, ChevronRight, X, LayoutGrid, Layers, Pencil, Check, Trash2, CheckCircle2, Eye,
  ExternalLink, Send, Wrench, Info, MoreHorizontal, Activity, FlaskConical, Volume2, VolumeX,
  Skull, AlertTriangle, Pin,
} from "lucide-react"
import Link from "next/link"
import { format } from "date-fns"
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts"
import { useFBAccounts, actId, type FBAccount } from "@/lib/fb-store"
import { useActivePages } from "@/lib/pages-store"
import { useAdspent } from "@/lib/adspent-store"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import { ScalingTracker, type TrackerFocus } from "@/components/business/ads/ScalingTracker"
import { PartnerTasks } from "@/components/business/ads/PartnerTasks"
import { MonitorCheckButton } from "@/components/business/ads/MonitorCheckButton"
import { useMonitorRounds, windowFor } from "@/lib/monitor-store"
import { slotStateAt } from "@/lib/manila"
import { CommentsModal } from "@/components/business/ads/CommentsModal"
import { useCommentCounts } from "@/lib/ads-comments-store"
import { useAdsPins, pinnedFirst, pinOrder } from "@/lib/ads-pins"
import {
  MGR_CACHE, MGR_INFLIGHT, MGR_TTL, DASH_CACHE, DASH_INFLIGHT, DASH_TTL,
  LVL_CACHE, LVL_INFLIGHT, type DashPart,
} from "@/lib/ads-cache"
import { logAds, logAdsMany, useRuleEditors, useAdsActivity, ACTION_LABEL } from "@/lib/ads-activity-store"
import { playToggle, playError, sfxOn, setSfxOn } from "@/lib/ui-feedback"
import { loadHouseRules, netOf, usePageRts, runAge } from "@/lib/scaling-signals"
import { useScalingRegistry } from "@/lib/scaling-registry-store"

const VAT = 1.12
// Default range = NGAYONG ARAW lang (hindi buong buwan). Iisang state lang ito kaya
// sabay nitong sakop ang Dashboard, Ads Manager, at Daily Ad Spend na tabs.
function defaultDateA() { return format(new Date(), "yyyy-MM-dd") }
function defaultDateB() { return format(new Date(), "yyyy-MM-dd") }
const peso = (n: number) => "₱" + (isFinite(n) ? n : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (n: number) => (isFinite(n) ? n : 0).toLocaleString("en-PH")
const pct = (n: number) => (isFinite(n) ? n : 0).toFixed(2) + "%"
const dec = (n: number) => (isFinite(n) ? n : 0).toFixed(2)

interface RawCampaign {
  id: string; name: string; status: string; objective: string; budget: number
  ownBudget?: number; budgetKind?: string; thumbnail?: string; campaignId?: string; adsetId?: string
  videoP100?: number; qualityRanking?: string; engagementRanking?: string
  spend: number; impressions: number; reach: number; clicks: number; ctr: number; cpc: number; cpm: number
  inlineLinkClicks: number; linkCtr: number; frequency: number; videoAvgPlay: number; video3s: number
  purchases: number; websitePurchases: number; metaPurchases: number
  purchaseValue: number; addToCart: number; initiateCheckout: number; contentViews: number; linkClicks: number; messaging: number; purchaseRoas: number
}
interface Row extends RawCampaign { accountId: string; accountName: string; accountOwner: string; spendVat: number; roas: number; cpa: number; avgValue: number; costPerCheckout: number; convRate: number; costPerMsg: number }

function toRow(c: RawCampaign, accountId: string, accountName: string, accountOwner: string): Row {
  // Match Ads Manager: Purchase ROAS from the native field (falls back to value÷spend); omni purchases/value.
  return {
    ...c, accountId, accountName, accountOwner, spendVat: c.spend * VAT,
    roas: c.purchaseRoas > 0 ? c.purchaseRoas : (c.spend > 0 ? c.purchaseValue / c.spend : 0),
    cpa: c.purchases > 0 ? c.spend / c.purchases : 0,
    avgValue: c.purchases > 0 ? c.purchaseValue / c.purchases : 0,
    costPerCheckout: c.initiateCheckout > 0 ? c.spend / c.initiateCheckout : 0,
    convRate: c.clicks > 0 ? (c.purchases / c.clicks) * 100 : 0,
    costPerMsg: c.messaging > 0 ? c.spend / c.messaging : 0,
  }
}
// ── PAG-URI NG OBJECTIVE ──────────────────────────────────────────────────────
// Dati ay binary ito: `Messaging` = tugma sa isMsg, at ang `Conversions` ay ang
// LAHAT ng iba pa. Kaya ang OUTCOME_APP_PROMOTION, OUTCOME_TRAFFIC,
// OUTCOME_AWARENESS at OUTCOME_VIDEO_VIEWS ay naipapasok sa "Conversions" —
// mali, at nagpapalabo sa CPP/CVR/ROAS na para lang sa sales campaigns.
// NASUKAT (Ago 6 2026): 158 OUTCOME_SALES at 2 OUTCOME_APP_PROMOTION; ang huli
// ay nakabilang sa Conversions.
// Ngayon ay tahasan na ang pag-uri, at may "Other" na pagpipilian para walang
// campaign na nagtatago sa labas ng lahat ng bucket.
// `lead` hindi `leads`: ang bago ng Meta ay OUTCOME_LEADS pero ang luma ay
// LEAD_GENERATION — isahan. Sa `leads`, ang mga lumang campaign ay hindi
// napupunta sa Messaging (dati nang bug, nahuli ng test Ago 6 2026).
const isMsg = (o: string) => /messag|engagement|lead/i.test(o)
const isConv = (o: string) => /sales|conversion|purchase|catalog/i.test(o)
/** Aling bucket ng dropdown ang kinabibilangan ng objective na ito? */
function objBucket(o: string): Exclude<Obj, "All"> {
  if (isMsg(o)) return "Messaging"
  if (isConv(o)) return "Conversions"
  return "Other"
}
const statusColor = (s: string) => /active/i.test(s) ? "text-emerald-600 bg-emerald-50" : /paus/i.test(s) ? "text-amber-600 bg-amber-50" : "text-slate-500 bg-slate-100"

// ─────────────────────────────────────────────────────────────────────────────
// DELIVERY — ang hanay na "Status" ni Meta, gaya ng Ads Manager.
//
// ⚠ ANG `effective_status` NG CAMPAIGN AY HINDI TUMITINGIN PABABA. Nananatili
// itong ACTIVE kahit patay na ang lahat ng ad set nito, kaya "Active" ang
// nakikita mo sa campaign na wala nang naipapadala. Binibilang ng Ads Manager
// ang mga anak para dito — ganoon din tayo (`kidsOn`/`kidsTotal` mula sa API).
//
// Ang mga anak naman ay SINASABI ni Meta kung sino ang may sala sa itaas:
// CAMPAIGN_PAUSED at ADSET_PAUSED — ginagamit natin nang deretso.
const DELIVERY_MAP: Record<string, string> = {
  CAMPAIGN_PAUSED: "Campaign off",
  ADSET_PAUSED: "Ad set off",
  PENDING_REVIEW: "In review",
  PENDING_BILLING_INFO: "Needs billing info",
  DISAPPROVED: "Rejected",
  PREAPPROVED: "Scheduled",
  WITH_ISSUES: "Not delivering",
  IN_PROCESS: "Processing",
  ARCHIVED: "Archived",
  DELETED: "Deleted",
}
// LEARNING — sa AD SET nangyayari (ang ad ay nagmamana). Ang `status` ni Meta:
//   LEARNING  → nag-aaral pa, hindi pa matatag ang delivery
//   FAIL      → "Learning limited": lumabas sa learning nang KULANG ang events
//               (~50 kada 7 araw ang kailangan), kaya mahina ang optimization
//   SUCCESS   → tapos na; normal na "Active" ang ipapakita
const LEARN_TARGET = 50
type Learning = { status: string; conversions: number } | null
type DeliveryRow = { status: string; configuredStatus: string; kidsOn?: number; kidsTotal?: number; kidsLive?: number; kidsStart?: string; learning?: Learning; startTime?: string; stopTime?: string }
export function deliveryOf(r: DeliveryRow, level: "campaign" | "adset" | "ad", now = Date.now()): { label: string; tone: "on" | "off" | "warn" | "bad" } {
  const eff = String(r.status || "").toUpperCase()
  const own = String(r.configuredStatus || r.status || "").toUpperCase()

  // 1. Ang sarili mong switch ang unang sagot — kung patay ka, "Off" ka.
  if (/PAUSED/.test(own) && own !== "CAMPAIGN_PAUSED" && own !== "ADSET_PAUSED") return { label: "Off", tone: "off" }
  // 2. May sinasabi ba si Meta na natatangi?
  if (eff === "DISAPPROVED") return { label: "Rejected", tone: "bad" }
  if (eff === "WITH_ISSUES") return { label: "Not delivering", tone: "bad" }
  if (DELIVERY_MAP[eff] && eff !== "ACTIVE") {
    const bad = eff === "PENDING_BILLING_INFO"
    return { label: DELIVERY_MAP[eff], tone: bad ? "bad" : eff === "CAMPAIGN_PAUSED" || eff === "ADSET_PAUSED" || eff === "ARCHIVED" || eff === "DELETED" ? "off" : "warn" }
  }
  // 3. Buhay ang switch — pero dumating na ba ang oras? Ang `effective_status`
  //    ay HINDI tumitingin sa orasan: ACTIVE na agad ang isinasagot ni Meta sa
  //    isang bagong gawang campaign na sa Lunes pa magsisimula, kaya "Active"
  //    ang lumalabas sa hindi pa umaandar (iniulat ng may-ari, Ago 17 2026).
  //    Nauuna ang pause at ang tanggi rito — kapag hinintuan mo ang naka-schedule
  //    ay "Off" ang sabi ng Ads Manager, hindi "Scheduled".
  //    BERDE ang Scheduled, kapareho ng Active — hatol ng may-ari (Ago 17 2026).
  //    Malusog ito: nakabukas, tama ang pagkakatakda, wala lang gagawin hangga't
  //    hindi sumasapit ang oras. Ang kulay-abo ay para sa hindi na tatakbo, at
  //    hindi iyon ang kalagayan nito. (Kulay-abo ito sa Ads Manager ni Meta —
  //    sinadya nating lumihis.) Ang COMPLETED ay kulay-abo pa rin: tapos na iyon.
  const start = r.startTime ? Date.parse(r.startTime) : NaN
  const stop = r.stopTime ? Date.parse(r.stopTime) : NaN
  if (!Number.isNaN(start) && start > now) return { label: "Scheduled", tone: "on" }
  if (!Number.isNaN(stop) && stop <= now) return { label: "Completed", tone: "off" }
  //    ⚠ SA AD SET ITINATAKDA ANG ORAS, HINDI SA CAMPAIGN. Ang campaign ay
  //    maaaring may lumipas nang `start_time` (o wala) habang ang lahat ng
  //    BUKAS na ad set nito ay bukas pa magsisimula — kaya "Scheduled" ang
  //    mababasa mo sa ad set pero "Active" sa campaign sa itaas niya
  //    (iniulat ng may-ari, Ago 21 2026). `kidsStart` ang PINAKAMAAGANG simula
  //    sa mga bukas na ad set: kapag ang pinakamaaga ay wala pa, wala pang
  //    kahit isa — naka-schedule ang buong campaign. Blangko = hindi alam.
  //    Nauuna ito sa bilang ng anak: ang "Ad set off"/"Ads off" sa isang hindi
  //    pa nagsisimula ay maling babala, kapareho ng dahilan sa taas.
  const kidStart = r.kidsStart ? Date.parse(r.kidsStart) : NaN
  if (level === "campaign" && (r.kidsOn ?? -1) > 0 && !Number.isNaN(kidStart) && kidStart > now) {
    return { label: "Scheduled", tone: "on" }
  }
  // 4. Buhay ako — pero may naipapadala ba talaga? Tanungin ang mga anak.
  //    -1 = walang datos ng anak; huwag manghula.
  const on = r.kidsOn ?? -1, total = r.kidsTotal ?? -1
  if (level !== "ad" && total > 0 && on === 0) {
    return { label: level === "campaign" ? "Ad set off" : "Ads off", tone: "warn" }
  }
  //    ⚠ DALAWANG HAKBANG PABABA ANG CAMPAIGN. Hindi sapat na may bukas na ad
  //    set: kung ang bukas na ad set na iyon ay walang kahit isang bukas na ad,
  //    wala pa ring lumalabas — pero "Active" ang mababasa (iniulat ng may-ari,
  //    Ago 21 2026: 1/3 ang bukas na ad set, at ang isang iyon ay 0/3 ang ad).
  //    `kidsLive` = bukas na ad set na may bukas na ad. Kapag wala ni isa, ang
  //    ADS ang dahilan, hindi ang ad set — kaya "Ads off" ang sinasabi natin,
  //    tulad ng hiling: ad set ang patay → "Ad set off"; ads ang patay → "Ads off".
  //    -1 = hindi alam (pumalya ang hila) — huwag manghula.
  const live = r.kidsLive ?? -1
  if (level === "campaign" && total > 0 && on > 0 && live === 0) {
    return { label: "Ads off", tone: "warn" }
  }
  // 5. Buhay at may naipapadala — pero nag-aaral pa ba? Ang learning ay
  //    pumapalit sa "Active" sa Ads Manager, hindi dinadagdag sa tabi nito.
  //    Campaign lang ang walang ganito (walang learning sa antas na iyon).
  const L = r.learning
  if (level !== "campaign" && L) {
    if (L.status === "LEARNING") {
      // ⚠ ANG BILANG AY SA AD SET LANG. Ang mga event ay naiipon sa AD SET, kaya
      // ang paglalagay ng "12/50" sa bawat ad sa ilalim nito ay pag-uulit ng
      // iisang numero — at mukhang sariling progreso ng ad, gayong hindi.
      // Sa ad, "Learning" lang: totoo, at hindi nagsisinungaling kung kanino
      // ang bilang.
      if (level !== "adset") return { label: "Learning", tone: "warn" }
      return { label: `Learning ${Math.max(0, L.conversions)}/${LEARN_TARGET}`, tone: "warn" }
    }
    // FAIL = "Learning limited" sa wika ng Ads Manager. Hindi ito error kaya
    // hindi pula — pero babala: hindi na mag-o-optimize nang maayos hangga't
    // hindi tumaas ang events (dagdagan ang budget, palawakin ang audience,
    // o pagsamahin ang mga ad set).
    if (L.status === "FAIL") return { label: "Learning limited", tone: "warn" }
  }
  if (/ACTIVE/.test(own) || /ACTIVE/.test(eff)) return { label: "Active", tone: "on" }
  return { label: eff ? eff.replace(/_/g, " ").toLowerCase() : "—", tone: "off" }
}
const DELIVERY_TONE: Record<string, string> = {
  on: "text-emerald-600 bg-emerald-50",
  off: "text-slate-500 bg-slate-100",
  warn: "text-amber-600 bg-amber-50",
  bad: "text-rose-600 bg-rose-50",
}
// Show the campaign status capitalised — "Active", "Paused", etc.
const statusLabel = (s: string) => { const t = String(s).replace(/_/g, " ").toLowerCase(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t }
// Ads Manager ROAS colour rule: >4.9 green · 3–4.9 yellow · <3 red.
const roasBg = (v: number) => v <= 0 ? "" : v > 4.9 ? "bg-emerald-100 text-emerald-800" : v < 3 ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"

async function mapLimit<T>(items: T[], limit: number, fn: (i: T) => Promise<void>) {
  let i = 0; await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) await fn(items[i++]) }))
}

type Tab = "dashboard" | "daily" | "manager" | "testing" | "scaling" | "monitoring" | "tasks"
type Obj = "All" | "Conversions" | "Messaging" | "Other"

// Module-level flag: resets on a full page (re)load, but persists across in-app navigation.
// Lets us tell a real refresh apart from leaving the section and coming back.
let fbTabMounted = false

// ── CACHE NG DASHBOARD / DAILY AD SPEND ─────────────────────────────────────
// Tatlong request kada ad account (rich + trend + byDate) — 63 sa 21 account.
// Tumatakbo ito sa BAWAT pagpasok sa pahina, kaya ang paglabas at pagbalik sa
// Facebook Ads ay laging bagong 63-request na hila. Kada ACCOUNT ang yunit
// (tulad ng Ads Manager) kaya ang bahaging nahila na ay hindi na inuulit,
// at pinagdurugtong lang sa pagpapakita. Ang Refresh ang pumipilit.
// ⚠ NASA `@/lib/ads-cache` NA ANG MGA CACHE. Kailangan silang maabot ng
// prefetcher sa app layout — habang nasa Finance ka pa lang, pinupuno na niya
// ang mga ito, kaya walang hihintayin pagpindot mo sa tab.
// 30 minuto, hindi 5. Ligtas ang mahabang TTL dahil sa stale-while-revalidate:
// LAGI kang may nakikitang laman agad, at kung luma na ito ay tahimik itong
// pinapalitan. Ang maikling TTL ay hindi nagpapasariwa nang mas mabilis —
// nagpapadalas lang ito ng hila para sa datos na nasa kamay na.

// Ang Ad Sets / Ads na antas SA LOOB ng Dashboard tab ay nasa component state
// dati (`lvlData`), kaya namamatay sa bawat pagpalit ng tab — 21 request ulit
// sa tuwing babalik ka at pipindutin muli ang Ad Sets. Kada account din ang
// yunit dito, para ang pag-filter ng account/owner ay hindi na humihila.

export default function FacebookAdsPage() {
  const fb = useFBAccounts()
  const pages = useActivePages()
  const adspentStore = useAdspent()
  // Keep the active tab on a real REFRESH, but reset to Dashboard when you leave the section and
  // come back. A refresh resets `fbTabMounted` (module re-evaluates) AND reports a "reload"
  // navigation; in-app navigation keeps `fbTabMounted` true, so it falls through to Dashboard.
  // ── DEEP LINK MULA SA ABISO ───────────────────────────────────────────────
  // ⚠ MULA SA UNANG PINTA, HINDI SA EFFECT. Kung effect ang maglilipat ng tab,
  // kumukurap muna ang Dashboard bago ka mapunta sa Ads Manager — at ang
  // AdsManager ay tumatanggap ng `focus` bilang UNANG halaga ng state lang
  // (walang effect na sumusunod), kaya kung huli ang pagdating ng focus ay
  // hindi na ito papansinin. Kaya binabasa rito mismo, sabay ng `tab`.
  //
  // Binabasa nang isang beses at ito rin ang laman ng unang `mgrFocus`.
  const deepLink = useMemo(() => {
    if (typeof window === "undefined") return null
    const q = new URLSearchParams(window.location.search)
    const id = q.get("focus")
    if (!id) return null
    const lvl = q.get("level")
    return {
      level: (lvl === "adset" || lvl === "ad" ? lvl : "campaign") as MgrLevel,
      id,
      name: q.get("name") || "",
      accountId: q.get("acc") || "",
      campaignId: q.get("camp") || undefined,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Iisang instance ng Monitoring Rounds sa buong pahina — ang parehong datos
  // ang binabasa ng check button sa Ads Manager at ng dashboard sa Tasks.
  const monitorRounds = useMonitorRounds()
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "dashboard"
    const firstMount = !fbTabMounted
    fbTabMounted = true
    // Ang link mula sa abiso ang nananaig sa naaalalang tab — sinadya mong
    // pindutin iyon, at ang pinag-usapan ang gusto mong makita.
    try {
      const q = new URLSearchParams(window.location.search)
      if (q.get("focus")) return "manager"
      // Galing sa abiso/kandado ng Monitoring Rounds — diretso sa Ads Manager.
      if (q.get("round")) return "manager"
    } catch {}
    let isReload = false
    try { isReload = (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type === "reload" } catch {}
    if (firstMount && isReload) {
      try { const t = localStorage.getItem("pesowise_fb_tab"); if (t === "daily" || t === "manager" || t === "testing" || t === "scaling" || t === "monitoring" || t === "tasks") return t } catch {}
    }
    return "dashboard"
  })
  useEffect(() => { try { localStorage.setItem("pesowise_fb_tab", tab) } catch {} }, [tab])
  const [from, setFrom] = useState(defaultDateA())
  const [to, setTo] = useState(defaultDateB())

  // Sariwa pa ba ang huling hila? Ilagay agad — kung hindi, isang pintang
  // blangkong dashboard (puro zero) ang makikita bago tumakbo ang effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dashBoot = useMemo(() => {
    // ⚠ WALANG TTL DITO. Ang luma ay ipinapakita pa rin — mas mainam ang numerong
    // 20 minuto na kaysa sa blangkong dashboard habang naghihintay. Ang effect sa
    // ibaba ang tahimik na magpapalit. Ang TTL ay pumipili KUNG KAILAN hihila
    // muli, hindi kung ano ang ipapakita (umalis papuntang Finance, bumalik —
    // dapat nandoon pa rin ang lahat; iniulat ng may-ari, Ago 15 2026).
    const parts = fb.accounts
      .filter(a => !a.archived && a.ad_account_id && a.token)
      .map(a => DASH_CACHE.get(`${a.id}|${from}|${to}`))
      .filter(h => !!h)
      .map(h => h!.part)
    const trendByDate: Record<string, { spend: number; sales: number }> = {}
    for (const p of parts) for (const d of p.trend) {
      trendByDate[d.date] = trendByDate[d.date] || { spend: 0, sales: 0 }
      trendByDate[d.date].spend += d.spend; trendByDate[d.date].sales += d.sales
    }
    return {
      rows: parts.flatMap(p => p.rows),
      trend: Object.entries(trendByDate).map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date)),
      daily: parts.flatMap(p => p.daily).sort((a, b) => a.date.localeCompare(b.date) || a.accountName.localeCompare(b.accountName)),
    }
  }, [])

  const [rows, setRows] = useState<Row[]>(dashBoot.rows)
  const [scalingCount, setScalingCount] = useState(0)
  const [testingCount, setTestingCount] = useState(0)
  const [monitorCount, setMonitorCount] = useState(0)
  const [tasksCount, setTasksCount] = useState(0)
  // "Dalhin mo ako doon": pinipindot ang pangalan sa Testing/Scaling/Monitoring,
  // bumubukas ang Ads Manager na nakatutok na sa mismong object na iyon.
  // Ang deep link mula sa abiso ang unang focus — kaya bukas na ang tamang
  // object bago pa may mapindot, at walang kumukurap na "All ad accounts".
  const [mgrFocus, setMgrFocus] = useState<MgrFocus | null>(deepLink
    ? { accountId: deepLink.accountId, level: deepLink.level, id: deepLink.id,
        name: deepLink.name, campaignId: deepLink.campaignId }
    : null)
  const openInManager = useCallback((f: MgrFocus) => { setMgrFocus(f); setTab("manager") }, [])
  // "Start round" habang NASA pahinang ito: walang remount sa soft navigation,
  // kaya event ang pinapakinggan — lipat sa manager; ang AdsManager ang bahala
  // sa pagpili ng account.
  useEffect(() => {
    const onRound = () => { setMgrFocus(null); setTrackerFocus(null); setTab("manager") }
    window.addEventListener("pesowise:round", onRound)
    return () => window.removeEventListener("pesowise:round", onRound)
  }, [])
  // Kabaligtarang direksyon: Ads Manager → Testing/Scaling/Monitoring, sala na.
  const [trackerFocus, setTrackerFocus] = useState<TrackerFocus | null>(null)
  const jumpToTracker = useCallback((t: Tab, f: TrackerFocus) => { setTrackerFocus(f); setTab(t) }, [])
  const [trend, setTrend] = useState<{ date: string; spend: number; sales: number }[]>(dashBoot.trend)
  const [daily, setDaily] = useState<{ date: string; accountName: string; owner: string; status: string; budget: number; spend: number }[]>(dashBoot.daily)
  const [loading, setLoading] = useState(false)

  const pageIdByName = useMemo(() => Object.fromEntries(pages.map(p => [p.name, p.id])), [pages])
  // Pull spend from every registered account that has creds (not only status="Active"), so an
  // account that's spending but marked Paused / In-review isn't dropped from the totals.
  const dataAccounts = useMemo(() => fb.accounts.filter(a => !a.archived && a.ad_account_id && a.token), [fb.accounts])

  // Pinagdurugtong ang bawat naka-cache na account tungo sa apat na hugis na
  // ginagamit ng Dashboard at Daily Ad Spend.
  const applyDash = useCallback((accts: FBAccount[]) => {
    const allRows: Row[] = [], trendByDate: Record<string, { spend: number; sales: number }> = {}, dailyRows: DashPart["daily"] = []
    for (const a of accts) {
      const part = DASH_CACHE.get(`${a.id}|${from}|${to}`)?.part
      if (!part) continue
      allRows.push(...part.rows)
      for (const d of part.trend) { trendByDate[d.date] = trendByDate[d.date] || { spend: 0, sales: 0 }; trendByDate[d.date].spend += d.spend; trendByDate[d.date].sales += d.sales }
      dailyRows.push(...part.daily)
    }
    setRows(allRows)
    setTrend(Object.entries(trendByDate).map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date)))
    setDaily(dailyRows.sort((a, b) => a.date.localeCompare(b.date) || a.accountName.localeCompare(b.accountName)))
  }, [from, to])

  const load = useCallback(async (fresh = false) => {
    if (dataAccounts.length === 0) { setRows([]); setTrend([]); setDaily([]); return }
    const now = Date.now()
    const key = (a: FBAccount) => `${a.id}|${from}|${to}`
    const absent = dataAccounts.filter(a => !DASH_CACHE.has(key(a)))
    const stale = dataAccounts.filter(a => { const h = DASH_CACHE.get(key(a)); return !!h && now - h.ts >= DASH_TTL })
    const toPull = fresh ? dataAccounts : [...absent, ...stale]

    applyDash(dataAccounts)      // ipakita agad ang alam na natin
    if (toPull.length === 0) { setLoading(false); return }
    // ⚠ SPINNER PARA LANG SA WALANG MAIPAPAKITA — ang luma ay tahimik na
    // pinapalitan. Ang Refresh ay hindi nagpapakita ng skeleton: nakatayo ang
    // dashboard habang pumapasok ang bagong numero.
    if (absent.length > 0 && !fresh) setLoading(true)
    const sums: Record<string, Record<string, number>> = {}
    await mapLimit(toPull, 4, async (a: FBAccount) => {
      const k = key(a)
      if (!fresh) {
        const running = DASH_INFLIGHT.get(k)
        if (running) { await running.catch(() => null); applyDash(dataAccounts); return }
      }
      const run = (async (): Promise<DashPart> => {
        const q = `token=${encodeURIComponent(a.token)}&account_id=${encodeURIComponent(actId(a.ad_account_id))}&from=${from}&to=${to}`
        const [rc, tr, db] = await Promise.all([
          fetch(`/api/fb/insights?rich=1&${q}${fresh ? "&nocache=1" : ""}`).then(r => r.json()),
          fetch(`/api/fb/insights?trend=1&${q}${fresh ? "&nocache=1" : ""}`).then(r => r.json()),
          fetch(`/api/fb/insights?${q}${fresh ? "&nocache=1" : ""}`).then(r => r.json()),
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
      try {
        const part = await run
        // Ang adspent sync ay para lang sa BAGONG hinilang account — ang muling
        // pagsusulat ng parehong halaga kada pagbukas ng pahina ay basura.
        const pid = pageIdByName[a.page_name]
        if (pid) for (const [d, amt] of Object.entries(part.spendByDate)) { sums[pid] = sums[pid] || {}; sums[pid][d] = (sums[pid][d] || 0) + amt }
      } catch { /* laktawan ang account na bumigo */ }
      finally { DASH_INFLIGHT.delete(k); applyDash(dataAccounts) }
    })
    applyDash(dataAccounts)
    // Auto-sync adspent (summed per page) → ROAS / Income Statement
    const entries: { pageId: string; date: string; value: number }[] = []
    for (const [pid, byDate] of Object.entries(sums)) for (const [d, val] of Object.entries(byDate)) entries.push({ pageId: pid, date: d, value: val })
    if (entries.length > 0) adspentStore.setMany(entries)
    setLoading(false)
  }, [dataAccounts, from, to, pageIdByName, adspentStore, applyDash])

  useEffect(() => { load() /* eslint-disable-next-line */ }, [fb.accounts.length, from, to])

  return (
    <div className="space-y-5">
      {/* Header + tabs */}
      <div className="flex items-center justify-between flex-wrap gap-3 pb-4 mb-1 border-b border-slate-100">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Megaphone className="w-5 h-5" /> FACEBOOK ADS</h1>
        <div className="flex items-center gap-2">
          <DateRangePicker a={from} b={to} variant="header" withMax
            onApply={(a, b) => { setFrom(a || defaultDateA()); setTo(b || defaultDateB()) }} placeholder="Today" />
          <button onClick={() => load(true)} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-dark">
        {([["dashboard", "Dashboard", LayoutDashboard], ["daily", "Daily Ad Spend", CalendarDays], ["manager", "Ads Manager", Settings2], ["testing", "Testing", FlaskConical], ["scaling", "Scaling", TrendingUp], ["monitoring", "Monitoring", Eye], ["tasks", "Tasks", ClipboardList]] as [Tab, string, any][]).map(([t, label, Icon]) => (
          // Ang pagpindot mismo sa tab ay normal na pagbukas — hindi dala ng
          // lumang focus mula sa nakaraang "dalhin mo ako doon".
          <button key={t} onClick={() => { setMgrFocus(null); setTrackerFocus(null); setTab(t) }}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            <Icon className="w-4 h-4" /> {label}
            {/* Ang bilang ay ang LAMAN ng tab, hindi bilang ng signal: ilang
                inirehistro ang aktibo (Testing/Scaling), at lahat ng nakikita
                (Monitoring). Lumalabas matapos madalaw ang tab — doon lang
                nagkakarga ang datos (sinadya, mabigat ang 30-araw na hila). */}
            {t === "testing" && testingCount > 0 && (
              <span title="Active registered ad sets" className="text-[10px] bg-blue-100 text-blue-700 font-bold px-1.5 py-0.5 rounded-full">{testingCount}</span>
            )}
            {t === "scaling" && scalingCount > 0 && (
              <span title="Active registered campaigns" className="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-1.5 py-0.5 rounded-full">{scalingCount}</span>
            )}
            {t === "tasks" && tasksCount > 0 && (
              <span title="Tasks waiting on you" className="text-[10px] bg-rose-100 text-rose-700 font-bold px-1.5 py-0.5 rounded-full">{tasksCount}</span>
            )}
            {t === "monitoring" && monitorCount > 0 && (
              <span title="Campaigns with spend this month" className="text-[10px] bg-amber-100 text-amber-700 font-bold px-1.5 py-0.5 rounded-full">{monitorCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* ⚠ Ang `key` sa dalawang ScalingTracker ay KAILANGAN. Parehong component
          sila sa parehong posisyon ng tree, kaya ini-reuse ng React ang instance
          kapag nagpalit ng tab — dala-dala ang `adsets` state ng dating tab, at
          hindi tumatakbo muli ang load effect (hindi nagbabago ang liveKey). Kaya
          ad sets ang lumalabas sa Scaling at mukhang "naka-sync" ang dalawang
          picker (nahuli Ago 14 2026). Ang `key` ang pumipilit ng remount. */}
      {dataAccounts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 py-16 text-center">
          <Link2 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No connected ad accounts. Register them in <strong>Ad Accounts</strong> first.</p>
        </div>
      ) : tab === "dashboard" ? <Dashboard rows={rows} trend={trend} loading={loading} accounts={dataAccounts} from={from} to={to} onOpen={openInManager} goTab={setTab} />
        : tab === "daily" ? <DailySpend daily={daily} loading={loading} />
          : tab === "testing" ? <ScalingTracker key="testing" mode="testing" accounts={dataAccounts} onSignals={setTestingCount} onOpenInManager={openInManager} focus={trackerFocus} />
            : tab === "scaling" ? <ScalingTracker key="scaling" mode="scaling" accounts={dataAccounts} onSignals={setScalingCount} onOpenInManager={openInManager} focus={trackerFocus} />
              : tab === "monitoring" ? <ScalingTracker key="monitoring" mode="monitoring" accounts={dataAccounts} onSignals={setMonitorCount} onOpenInManager={openInManager} focus={trackerFocus} />
              : tab === "tasks" ? <PartnerTasks accounts={dataAccounts} onSignals={setTasksCount} rounds={monitorRounds} />
              : <AdsManager fb={fb} from={from} to={to} focus={mgrFocus} onJump={jumpToTracker} rounds={monitorRounds} />}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════════════════════════
const COLORS = ["#2563eb", "#7c3aed", "#0891b2", "#16a34a", "#ea580c", "#db2777", "#ca8a04", "#475569"]

// Mobile: mas maliit na teksto at padding (konbensyon ng lahat ng dashboard —
// sa 375px ay umaapaw ang halagang piso kapag `text-2xl` at 3 hanay).
function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
  return (
    <div className={`relative overflow-hidden rounded-xl sm:rounded-2xl p-3 sm:p-4 text-white bg-gradient-to-br ${accent} shadow-sm`}>
      <div className="text-[10px] sm:text-[11px] uppercase tracking-wider opacity-90 leading-tight">{label}</div>
      <div className="text-lg sm:text-2xl font-bold mt-0.5 sm:mt-1 tabular-nums leading-tight break-words">{value}</div>
      {sub && <div className="text-[10px] sm:text-xs opacity-90 mt-0.5 leading-tight">{sub}</div>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD (muling dinisenyo, Ago 15 2026, desisyon ng may-ari): ang dating
// laman ay campaign table — kaparehong-kapareho ng Ads Manager, walang aksyon,
// at GROSS ang ROAS gayong NET ang batayan ng bawat kill/scale. Ngayon, apat na
// tanong ang sinasagot nito, walang campaign table:
//   1. Kumusta tayo ngayon?     → hero tiles, NET-first
//   2. May aksyon ba?           → Action Queue (galing sa house rules)
//   3. Aling brand ang buhay?   → brand cards kada ad account
//   4. Kumusta ang tatlong buyer? → scoreboard kada owner
// Ang buong listahan ng campaigns ay nasa Ads Manager / Monitoring — hindi na
// inuulit dito. Top 3 / Worst 3 lang ayon sa perang epekto.
// ─────────────────────────────────────────────────────────────────────────────
function Dashboard({ rows, trend, loading, accounts: fbAccounts, from, to, onOpen, goTab }: {
  rows: Row[]; trend: { date: string; spend: number; sales: number }[]; loading: boolean
  accounts: FBAccount[]; from: string; to: string
  onOpen: (f: MgrFocus) => void; goTab: (t: Tab) => void
}) {
  const [fOwner, setFOwner] = useState("All")
  const rules = useMemo(() => loadHouseRules(), [])
  const rtsMap = usePageRts(fbAccounts)
  const registry = useScalingRegistry()
  const activity = useAdsActivity(30)

  const owners = useMemo(() => Array.from(new Set(
    fbAccounts.filter(a => !a.archived).map(a => a.owner).filter(Boolean))).sort(), [fbAccounts])
  const accById = useMemo(() => new Map(fbAccounts.map(a => [a.id, a])), [fbAccounts])
  const rtsOf = useCallback((r: Row) => rtsMap.get(accById.get(r.accountId)?.page_name || "") ?? 0,
    [rtsMap, accById])

  const todayStr = useMemo(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` }, [])
  const isToday = from === to && to === todayStr
  const rangeLabel = isToday ? "today" : from === to ? from : `${from.slice(5)} → ${to.slice(5)}`

  // Kada campaign na may gastos: net ROAS at tubo-proxy. Ang `profit` ay
  // value×(1−RTS) − spend×VAT — ang perang epekto, hindi lang ratio; ito ang
  // batayan ng Top/Worst 3 para ang ₱10k @ 2.5 ay hindi matalo ng ₱200 @ 8.0.
  const scoped = useMemo(() => rows.filter(r => fOwner === "All" || r.accountOwner === fOwner), [rows, fOwner])
  const withNet = useMemo(() => scoped.filter(r => r.spend > 0).map(r => {
    const rts = rtsOf(r)
    return { r, rts, net: netOf(r.purchaseValue, r.spend, rts), profit: r.purchaseValue * (1 - rts) - r.spend * VAT }
  }), [scoped, rtsOf])

  const agg = useMemo(() => withNet.reduce((s, x) => ({
    spend: s.spend + x.r.spend, purchases: s.purchases + x.r.purchases,
    netValue: s.netValue + x.r.purchaseValue * (1 - x.rts),
  }), { spend: 0, purchases: 0, netValue: 0 }), [withNet])
  const netAll = agg.spend > 0 ? agg.netValue / (agg.spend * VAT) : 0
  const grossAll = agg.spend > 0 ? withNet.reduce((s, x) => s + x.r.purchaseValue, 0) / agg.spend : 0
  const totalValue = withNet.reduce((s, x) => s + x.r.purchaseValue, 0)
  const cpp = agg.purchases > 0 ? agg.spend / agg.purchases : 0
  const budgetInPlay = useMemo(() => scoped.filter(r => /active/i.test(r.status)).reduce((s, r) => s + r.budget, 0), [scoped])
  const activeCount = scoped.filter(r => /active/i.test(r.status)).length

  // ── ACTION QUEUE — house rules, hindi opinyon ──────────────────────────────
  const losers = useMemo(() => withNet.filter(x => x.r.spend >= rules.evalMinSpend && x.net < rules.killRoas), [withNet, rules])
  const winners = useMemo(() => withNet.filter(x => x.r.spend >= rules.evalMinSpend && x.net >= rules.scaleRoas), [withNet, rules])
  const hourNow = new Date().getHours()
  const noSales = useMemo(() => (isToday && hourNow >= rules.noSalesHour)
    ? withNet.filter(x => x.r.spend >= rules.evalMinSpend && x.r.purchases === 0) : [],
    [withNet, isToday, hourNow, rules])
  const sumSpend = (xs: { r: Row }[]) => xs.reduce((s, x) => s + x.r.spend, 0)

  // ── BRAND CARDS — kada ad account, hindi kada campaign ─────────────────────
  const brands = useMemo(() => {
    const m = new Map<string, { name: string; accountId: string; owner: string; spend: number; value: number; netValue: number; purchases: number; active: number; total: number; rts: number }>()
    for (const x of withNet) {
      const b = m.get(x.r.accountName) ?? { name: x.r.accountName, accountId: x.r.accountId, owner: x.r.accountOwner, spend: 0, value: 0, netValue: 0, purchases: 0, active: 0, total: 0, rts: x.rts }
      b.spend += x.r.spend; b.value += x.r.purchaseValue; b.netValue += x.r.purchaseValue * (1 - x.rts); b.purchases += x.r.purchases
      b.total++
      if (/active/i.test(x.r.status)) b.active++
      m.set(b.name, b)
    }
    return [...m.values()].sort((a, b) => b.spend - a.spend)
  }, [withNet])

  // ── TOP MOVERS — 3 pinakamalaki ang tubo, 3 pinakamalaki ang lugi ──────────
  const qualified = useMemo(() => withNet.filter(x => x.r.spend >= rules.evalMinSpend), [withNet, rules])
  const best3 = useMemo(() => [...qualified].sort((a, b) => b.profit - a.profit).slice(0, 3).filter(x => x.profit > 0), [qualified])
  const worst3 = useMemo(() => [...qualified].sort((a, b) => a.profit - b.profit).slice(0, 3).filter(x => x.profit < 0), [qualified])

  // ── BUYER SCOREBOARD — laging LAHAT ng owner (ito mismo ang paghahambing) ──
  const scoreboard = useMemo(() => {
    // ⚠ `r.spend > 0` LANG ang sinasala rito para sa performance, pero ang
    // BUDGET ay dapat mabilang kahit hindi pa gumagastos ngayong araw — kaya
    // hiwalay ang pass sa ibaba. Kung hindi, ang bagong buksan na campaign na
    // wala pang gastos ay parang walang budget.
    const m = new Map<string, { owner: string; spend: number; netValue: number; value: number; purchases: number; budget: number; brands: Set<string>; win: number; lose: number }>()
    for (const r of rows.filter(r => r.spend > 0)) {
      const o = r.accountOwner || "—"
      const rts = rtsOf(r)
      const e = m.get(o) ?? { owner: o, spend: 0, netValue: 0, value: 0, purchases: 0, budget: 0, brands: new Set<string>(), win: 0, lose: 0 }
      const net = netOf(r.purchaseValue, r.spend, rts)
      e.spend += r.spend; e.netValue += r.purchaseValue * (1 - rts); e.value += r.purchaseValue; e.purchases += r.purchases
      if (/active/i.test(r.status)) e.budget += r.budget
      e.brands.add(r.accountName)
      if (r.spend >= rules.evalMinSpend && net >= rules.scaleRoas) e.win++
      if (r.spend >= rules.evalMinSpend && net < rules.killRoas) e.lose++
      m.set(o, e)
    }
    // Pangalawang pass: budget ng mga AKTIBO, kasama ang wala pang gastos.
    for (const r of rows) {
      if (!/active/i.test(r.status) || r.spend > 0) continue
      const o = r.accountOwner || "—"
      const e = m.get(o) ?? { owner: o, spend: 0, netValue: 0, value: 0, purchases: 0, budget: 0, brands: new Set<string>(), win: 0, lose: 0 }
      e.budget += r.budget; e.brands.add(r.accountName)
      m.set(o, e)
    }
    return [...m.values()].sort((a, b) => b.spend - a.spend)
  }, [rows, rtsOf, rules])

  // ── FUNNEL — Testing → Moved → Scaling (galing sa registry, all-time) ──────
  const funnel = useMemo(() => ({
    testing: registry.regs.filter(r => r.level === "adset" && r.active).length,
    moved: registry.regs.filter(r => r.level === "ad-moved").length,
    scaling: registry.regs.filter(r => r.level === "campaign" && r.active).length,
  }), [registry.regs])

  // Trend (gross — walang kada-araw na RTS breakdown, kaya tapat ang label)
  const trendData = trend.map(d => ({ date: d.date.slice(5), roas: d.spend > 0 ? +(d.sales / (d.spend * VAT)).toFixed(2) : 0, spend: +d.spend.toFixed(0), sales: +d.sales.toFixed(0) }))

  const netBadge = (net: number) =>
    net >= rules.scaleRoas ? "bg-emerald-100 text-emerald-800" : net < rules.killRoas ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"
  const focusOf = (r: Row): MgrFocus => ({ accountId: r.accountId, level: "campaign", id: r.id, name: r.name, owner: r.accountOwner || undefined })

  return (
    <div className="space-y-5">
      {/* Owner chips — ang tanging filter dito. Ang malalim na paghahanap ay
          trabaho ng Ads Manager, hindi ng Dashboard. */}
      <div className="flex flex-wrap items-center gap-2">
        {["All", ...owners].map(o => (
          <button key={o} onClick={() => setFOwner(o)}
            className={`px-3 py-1.5 rounded-full text-sm border ${fOwner === o ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>
            {o}
          </button>
        ))}
        <span className="ml-auto text-[12px] text-slate-400">
          {rangeLabel} · {activeCount} active campaigns
          {rtsMap.size === 0 && <> · <span className="text-amber-600">RTS loading — gross muna ang net</span></>}
        </span>
      </div>

      {loading && rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 py-14 text-center text-slate-400 text-sm">
          <RefreshCw className="w-4 h-4 animate-spin inline mr-2" /> Pulling {rangeLabel}…
        </div>
      ) : withNet.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 py-14 text-center text-slate-400 text-sm">No spend {rangeLabel}.</div>
      ) : (
        <>
          {/* ── HERO — net muna, dahil net ang batayan ng bawat desisyon ──
              Ang AD BUDGET ay ang naka-set na daily budget ng mga AKTIBO ngayon:
              ang itatakbo bukas kung walang gagalawin — magkaibang tanong sa
              "magkano ang nagastos". Ang pares na Budget/Spend ang nagsasabi
              kung gaano kabilis ubusin ng araw ang nakalaan (pacing). */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <Kpi label={`Net ROAS ${rangeLabel}`} value={dec(netAll) + "x"} sub={`gross ${dec(grossAll)}x`}
              accent={netAll >= rules.scaleRoas ? "from-emerald-500 to-emerald-600" : netAll < rules.killRoas ? "from-rose-500 to-rose-600" : "from-amber-500 to-orange-600"} />
            <Kpi label="Ad Budget / day" value={peso(budgetInPlay)}
              sub={budgetInPlay > 0 ? `${Math.round((agg.spend / budgetInPlay) * 100)}% spent · ${activeCount} active` : `${activeCount} active`}
              accent="from-slate-700 to-slate-800" />
            <Kpi label="Ad Spend" value={peso(agg.spend)} sub={`incl. VAT ${peso(agg.spend * VAT)}`} accent="from-blue-600 to-blue-700" />
            <Kpi label="Sales" value={peso(totalValue)} sub={`net ${peso(agg.netValue)} after RTS`} accent="from-violet-500 to-violet-600" />
            <Kpi label="Total Purchases" value={num(agg.purchases)}
              sub={agg.purchases > 0 ? `avg value ${peso(totalValue / agg.purchases)}` : undefined} accent="from-fuchsia-500 to-pink-600" />
            <Kpi label="Cost / Purchase" value={peso(cpp)} sub={`ceiling ${peso(rules.cppMax)}`}
              accent={cpp > 0 && cpp > rules.cppMax ? "from-rose-500 to-rose-600" : "from-cyan-500 to-cyan-600"} />
            <Kpi label="🔥 Burning" value={peso(sumSpend(losers))} sub={`${losers.length} below ${rules.killRoas} net`} accent="from-rose-500 to-rose-600" />
            <Kpi label="🏆 Winning" value={peso(sumSpend(winners))} sub={`${winners.length} at ${rules.scaleRoas}+ net`} accent="from-emerald-500 to-emerald-600" />
          </div>

          {/* ── ACTION QUEUE — listahan ng desisyon, hindi ng campaigns ── */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
            <p className="text-sm font-bold text-slate-800">What needs you {rangeLabel}</p>
            {losers.length === 0 && winners.length === 0 && noSales.length === 0 ? (
              <p className="text-[13px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                All clear — walang tumatama sa kill o scale rules ngayon.
              </p>
            ) : (
              <div className="space-y-1.5">
                {losers.length > 0 && (
                  <button onClick={() => goTab("monitoring")}
                    className="w-full flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-1 sm:gap-2 text-left px-3 py-2.5 rounded-lg bg-rose-50 border border-rose-200 hover:bg-rose-100">
                    <Skull className="w-4 h-4 text-rose-600 shrink-0" />
                    <span className="text-[13px] text-rose-800"><b>{losers.length}</b> below the kill line (net &lt; {rules.killRoas}) — <b>{peso(sumSpend(losers))}</b> spent {rangeLabel}</span>
                    <span className="sm:ml-auto text-[12px] font-semibold text-rose-600 whitespace-nowrap">Review in Monitoring →</span>
                  </button>
                )}
                {noSales.length > 0 && (
                  <button onClick={() => goTab("testing")}
                    className="w-full flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-1 sm:gap-2 text-left px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200 hover:bg-amber-100">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span className="text-[13px] text-amber-800"><b>{noSales.length}</b> spent {peso(sumSpend(noSales))} with <b>zero sales</b> past {rules.noSalesHour}:00</span>
                    <span className="sm:ml-auto text-[12px] font-semibold text-amber-600 whitespace-nowrap">Check in Testing →</span>
                  </button>
                )}
                {winners.length > 0 && (
                  <button onClick={() => goTab("scaling")}
                    className="w-full flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-1 sm:gap-2 text-left px-3 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 hover:bg-emerald-100">
                    <TrendingUp className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="text-[13px] text-emerald-800"><b>{winners.length}</b> at scale threshold (net ≥ {rules.scaleRoas}) on {peso(sumSpend(winners))}</span>
                    <span className="sm:ml-auto text-[12px] font-semibold text-emerald-600 whitespace-nowrap">Open Scaling →</span>
                  </button>
                )}
              </div>
            )}
            <p className="text-[11px] text-slate-400">House rules ang batayan (kill &lt; {rules.killRoas} · scale ≥ {rules.scaleRoas} · min spend {peso(rules.evalMinSpend)}) — palitan sa Rules panel ng Testing/Scaling.</p>
          </div>

          {/* ── BRAND CARDS — kada ad account ── */}
          <div>
            <p className="text-sm font-bold text-slate-800 mb-2">Brands {rangeLabel}</p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {brands.map(b => (
                // Shortcut: bumubukas ang Ads Manager na naka-filter na sa ad
                // account na ito (blangkong `id` = buong account, walang pin).
                <button key={b.name} onClick={() => onOpen({ accountId: b.accountId, level: "campaign", id: "", name: b.name, owner: b.owner || undefined })}
                  title={`Open ${b.name} in Ads Manager`}
                  className="text-left bg-white rounded-xl border border-slate-200 p-3 space-y-1 hover:border-blue-300 hover:shadow-sm transition group">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] font-semibold text-slate-800 leading-tight group-hover:text-blue-600 flex items-center gap-1">
                      {b.name}
                      <ExternalLink className="w-3 h-3 text-slate-300 group-hover:text-blue-500 shrink-0" />
                    </span>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 ${netBadge(netOf(b.value, b.spend, b.rts))}`}>
                      {dec(netOf(b.value, b.spend, b.rts))}x
                    </span>
                  </div>
                  <p className="text-base sm:text-lg font-bold text-slate-900 tabular-nums">{peso(b.spend)}</p>
                  <p className="text-[11px] text-slate-500">
                    {b.purchases} purchases{b.purchases > 0 && <> · CPP {peso(b.spend / b.purchases)}</>}
                  </p>
                  {/* Kulay ayon sa Meta: BERDE = may naipapadala. Ang patay ay
                      HINDI pula — hindi iyon error, kaya amber lang: "may
                      gastos ngayon pero wala nang tumatakbo" ay dapat mapansin,
                      hindi ipagulat. Ang pula ay nakalaan sa tunay na sira. */}
                  <p className="text-[11px] text-slate-400">
                    {b.owner || "—"} ·{" "}
                    <span className={`font-semibold ${b.active > 0 ? "text-emerald-600" : "text-amber-600"}`}>
                      {b.active} active
                    </span>
                    {b.total > b.active && <span className="text-slate-400"> · {b.total - b.active} off</span>}
                    {" "}· RTS {(b.rts * 100).toFixed(1)}%
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* ── TOP MOVERS — kapalit ng buong campaign table ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[{ title: "Top 3 — kumikita", list: best3, tone: "emerald" }, { title: "Worst 3 — nalulugi", list: worst3, tone: "rose" }].map(sec => (
              <div key={sec.title} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
                <p className={`text-sm font-bold ${sec.tone === "emerald" ? "text-emerald-700" : "text-rose-700"}`}>{sec.title}</p>
                {sec.list.length === 0
                  ? <p className="text-[13px] text-slate-400 italic">Wala — {sec.tone === "emerald" ? `walang lumampas sa gastos ${rangeLabel}` : "walang nalulugi sa saklaw na ito"}.</p>
                  : sec.list.map(x => (
                    <button key={x.r.id} onClick={() => onOpen(focusOf(x.r))}
                      title="Open in Ads Manager"
                      className="w-full flex flex-wrap items-center gap-2 text-left px-3 py-2 rounded-lg border border-slate-100 hover:border-blue-200 hover:bg-blue-50/40">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium text-slate-800 truncate">{x.r.name}</span>
                        <span className="block text-[11px] text-slate-400">{x.r.accountName} · spend {peso(x.r.spend)}</span>
                      </span>
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${netBadge(x.net)}`}>{dec(x.net)}x</span>
                      <span className={`text-[13px] font-bold tabular-nums ${x.profit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {x.profit >= 0 ? "+" : "−"}{peso(Math.abs(x.profit))}
                      </span>
                    </button>
                  ))}
              </div>
            ))}
          </div>

          {/* ── BUYER SCOREBOARD + FUNNEL ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <p className="text-sm font-bold text-slate-800 px-4 py-3 border-b border-slate-100">Buyers {rangeLabel}</p>
              <div className="overflow-x-auto scrollbar-dark">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-50 border-b border-slate-200 text-left text-[11px] text-slate-500">
                    {["Buyer", "Brands", "Budget / day", "Spend", "Purchases", "CPP", "Net ROAS", "Win", "Lose"].map(h => <th key={h} className="px-4 py-2 font-semibold whitespace-nowrap">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {scoreboard.map(s => (
                      <tr key={s.owner} className="border-b border-slate-100">
                        <td className="px-4 py-2.5 font-semibold text-slate-800 whitespace-nowrap">{s.owner}</td>
                        <td className="px-4 py-2.5 text-slate-600">{s.brands.size}</td>
                        <td className="px-4 py-2.5 tabular-nums text-slate-700">{peso(s.budget)}</td>
                        <td className="px-4 py-2.5 tabular-nums text-slate-700">
                          {peso(s.spend)}
                          {s.budget > 0 && <span className="block text-[10px] text-slate-400">{Math.round((s.spend / s.budget) * 100)}% of budget</span>}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-slate-700">{num(s.purchases)}</td>
                        <td className="px-4 py-2.5 tabular-nums text-slate-700">{s.purchases > 0 ? peso(s.spend / s.purchases) : "—"}</td>
                        <td className="px-4 py-2.5">
                          <span className={`text-[12px] font-bold px-2 py-0.5 rounded-full ${netBadge(s.spend > 0 ? s.netValue / (s.spend * VAT) : 0)}`}>
                            {dec(s.spend > 0 ? s.netValue / (s.spend * VAT) : 0)}x
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-emerald-600 font-semibold">{s.win}</td>
                        <td className="px-4 py-2.5 text-rose-600 font-semibold">{s.lose}</td>
                      </tr>
                    ))}
                    {scoreboard.length > 1 && (() => {
                      const t = scoreboard.reduce((a, s) => ({ budget: a.budget + s.budget, spend: a.spend + s.spend, purchases: a.purchases + s.purchases, netValue: a.netValue + s.netValue, win: a.win + s.win, lose: a.lose + s.lose }), { budget: 0, spend: 0, purchases: 0, netValue: 0, win: 0, lose: 0 })
                      return (
                        <tr className="bg-slate-50 font-bold text-slate-800">
                          <td className="px-4 py-2.5">ALL</td>
                          <td className="px-4 py-2.5">{new Set(rows.map(r => r.accountName)).size}</td>
                          <td className="px-4 py-2.5 tabular-nums">{peso(t.budget)}</td>
                          <td className="px-4 py-2.5 tabular-nums">{peso(t.spend)}</td>
                          <td className="px-4 py-2.5 tabular-nums">{num(t.purchases)}</td>
                          <td className="px-4 py-2.5 tabular-nums">{t.purchases > 0 ? peso(t.spend / t.purchases) : "—"}</td>
                          <td className="px-4 py-2.5">
                            <span className={`text-[12px] font-bold px-2 py-0.5 rounded-full ${netBadge(t.spend > 0 ? t.netValue / (t.spend * VAT) : 0)}`}>
                              {dec(t.spend > 0 ? t.netValue / (t.spend * VAT) : 0)}x
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-emerald-600">{t.win}</td>
                          <td className="px-4 py-2.5 text-rose-600">{t.lose}</td>
                        </tr>
                      )
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
              <p className="text-sm font-bold text-slate-800">Testing → Scaling</p>
              <div className="space-y-2 text-[13px]">
                <p className="flex items-center justify-between"><span className="text-slate-600">Tests running</span><b className="text-blue-600">{funnel.testing}</b></p>
                <p className="flex items-center justify-between"><span className="text-slate-600">Ads moved to Scaling <span className="text-slate-400">(all-time)</span></span><b className="text-emerald-600">{funnel.moved}</b></p>
                <p className="flex items-center justify-between"><span className="text-slate-600">Scaling campaigns</span><b className="text-violet-600">{funnel.scaling}</b></p>
              </div>
              {/* Huling galaw — sino ang gumalaw ng ano */}
              {activity.rows.length > 0 && (
                <div className="pt-2 border-t border-slate-100 space-y-1">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Recent activity</p>
                  {activity.rows.slice(0, 5).map(a => (
                    <p key={a.id} className="text-[11px] text-slate-500 truncate">
                      <b className="text-slate-700">{a.user_name}</b> · {ACTION_LABEL[a.action] || a.action} · {a.object_name}
                    </p>
                  ))}
                  <Link href="/business/ads/activity" className="text-[11px] text-blue-600 hover:underline">View all →</Link>
                </div>
              )}
            </div>
          </div>

          {/* ── TREND — makabuluhan lang kapag higit sa isang araw ang saklaw ── */}
          {trendData.length > 1 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ChartCard title="ROAS Trend (gross)">
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={trendData} margin={{ left: -10, right: 10, top: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} />
                    <Tooltip /><Line type="monotone" dataKey="roas" stroke="#16a34a" strokeWidth={2} dot={false} name="ROAS" />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title="Ad Spend vs Sales">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={trendData} margin={{ left: -10, right: 10, top: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} />
                    <Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="spend" fill="#2563eb" name="Ad Spend" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="sales" fill="#16a34a" name="Sales" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          ) : (
            <p className="text-[12px] text-slate-400">Pumili ng mas mahabang saklaw (hal. Last 7 days) sa date picker para makita ang trend.</p>
          )}
        </>
      )}
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="bg-white rounded-2xl border border-slate-200 p-4"><div className="text-sm font-semibold text-slate-700 mb-2">{title}</div>{children}</div>
}
function Sel({ value, onChange, opts, label }: { value: string; onChange: (v: string) => void; opts: string[]; label: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-slate-400">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className="h-10 rounded-lg border border-slate-200 px-3 text-sm bg-white max-w-[200px]">
        {opts.map(o => <option key={o} value={o}>{o.length > 28 ? o.slice(0, 28) + "…" : o}</option>)}
      </select>
    </div>
  )
}

// Shared column set (mirrors Meta Ads Manager) — used by the dashboard Campaign Performance
// table AND the in-app Ads Manager so both show identical metrics. `v` = sortable numeric value.
type Col = { l: string; f: (r: Row) => string; v: (r: Row) => number }
const CONV_COLS: Col[] = [
  { l: "Budget", f: r => peso(r.budget), v: r => r.budget }, { l: "Amount Spent", f: r => peso(r.spend), v: r => r.spend },
  { l: "ROAS", f: r => dec(r.roas) + "x", v: r => r.roas }, { l: "Purchase Value", f: r => peso(r.purchaseValue), v: r => r.purchaseValue },
  { l: "Purchases", f: r => num(r.purchases), v: r => r.purchases }, { l: "Website Purch.", f: r => num(r.websitePurchases), v: r => r.websitePurchases },
  { l: "Meta Purch.", f: r => num(r.metaPurchases), v: r => r.metaPurchases }, { l: "CPP", f: r => peso(r.cpa), v: r => r.cpa },
  { l: "Avg Value", f: r => peso(r.avgValue), v: r => r.avgValue }, { l: "ATC", f: r => num(r.addToCart), v: r => r.addToCart },
  { l: "IC", f: r => num(r.initiateCheckout), v: r => r.initiateCheckout }, { l: "Cost/IC", f: r => peso(r.costPerCheckout), v: r => r.costPerCheckout },
  // Tinanggal ang "Content Views" (hiling ng may-ari, Ago 20 2026) at pinalitan
  // ng "Link Clicks" sa pagitan ng CPC at CPM: ilan ang PUMINDOT ng Shop Now —
  // ilan ang nakarating sa Shopify website.
  { l: "CVR", f: r => pct(r.convRate), v: r => r.convRate },
  { l: "CTR (link)", f: r => pct(r.linkCtr), v: r => r.linkCtr }, { l: "CPC", f: r => peso(r.cpc), v: r => r.cpc },
  // ⚠ `inlineLinkClicks`, HINDI `linkClicks`. Ito ang "Link clicks" mismo ng
  // Ads Manager (inline_link_clicks) — at ito rin ang pambilang ng CTR (link)
  // sa kaliwa nito, kaya laging magkatugma ang dalawang kolum. Ang `linkClicks`
  // (action na link_click) ay ibang bilang na kasama pati profile clicks.
  { l: "Link Clicks", f: r => num(r.inlineLinkClicks), v: r => r.inlineLinkClicks },
  { l: "CPM", f: r => peso(r.cpm), v: r => r.cpm },
  { l: "Frequency", f: r => dec(r.frequency), v: r => r.frequency }, { l: "Avg Video Play", f: r => dec(r.videoAvgPlay) + "s", v: r => r.videoAvgPlay },
  { l: "3s Video Plays", f: r => num(r.video3s), v: r => r.video3s },
  { l: "Reach", f: r => num(r.reach), v: r => r.reach }, { l: "Impressions", f: r => num(r.impressions), v: r => r.impressions },
]
const MSG_COLS: Col[] = [
  { l: "Budget", f: r => peso(r.budget), v: r => r.budget }, { l: "Amount Spent", f: r => peso(r.spend), v: r => r.spend },
  { l: "Msg Started", f: r => num(r.messaging), v: r => r.messaging }, { l: "Cost / Msg", f: r => peso(r.costPerMsg), v: r => r.costPerMsg },
  { l: "CTR", f: r => pct(r.ctr), v: r => r.ctr }, { l: "Link Clicks", f: r => num(r.linkClicks), v: r => r.linkClicks },
  { l: "CPC", f: r => peso(r.cpc), v: r => r.cpc }, { l: "CPM", f: r => peso(r.cpm), v: r => r.cpm },
  { l: "CVR", f: r => pct(r.convRate), v: r => r.convRate }, { l: "Reach", f: r => num(r.reach), v: r => r.reach }, { l: "Impressions", f: r => num(r.impressions), v: r => r.impressions },
]

// Meta's ranking enums → readable label / sortable score (Above average > Average > Below average).
const rankLabel = (s?: string) => !s || s === "UNKNOWN" ? "—" : (t => t.charAt(0).toUpperCase() + t.slice(1))(s.replace(/_/g, " ").toLowerCase())
const rankScore = (s?: string) => /above/i.test(s || "") ? 3 : /^average/i.test(s || "") ? 2 : /below/i.test(s || "") ? 1 : 0
// Ad-only extra columns (appended at the end of the Ads tab, mirroring Ads Manager).
const AD_EXTRA_COLS: Col[] = [
  { l: "Link Clicks", f: r => num(r.linkClicks), v: r => r.linkClicks },
  { l: "CTR (all)", f: r => pct(r.ctr), v: r => r.ctr },
  { l: "Video Plays 100%", f: r => num(r.videoP100 ?? 0), v: r => r.videoP100 ?? 0 },
  { l: "Quality Ranking", f: r => rankLabel(r.qualityRanking), v: r => rankScore(r.qualityRanking) },
  { l: "Engagement Ranking", f: r => rankLabel(r.engagementRanking), v: r => rankScore(r.engagementRanking) },
]

// ── Shared sorting helpers (click a column header to sort high→low, click again to flip) ──
type SortState = { key: string; dir: "asc" | "desc" }
const nextSort = (s: SortState | null, key: string): SortState => s && s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }
function SortArrow({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <ArrowUpDown className="w-3 h-3 inline-block opacity-30 shrink-0" />
  return dir === "desc" ? <ArrowDown className="w-3 h-3 inline-block text-blue-600 shrink-0" /> : <ArrowUp className="w-3 h-3 inline-block text-blue-600 shrink-0" />
}
// Generic comparator: numbers descend/ascend, strings localeCompare.
function sortRows<T>(rows: T[], sort: SortState | null, val: (r: T, key: string) => number | string): T[] {
  if (!sort) return rows
  return [...rows].sort((a, b) => {
    const va = val(a, sort.key), vb = val(b, sort.key)
    const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb))
    return sort.dir === "asc" ? c : -c
  })
}

// Synthetic "TOTAL" row — sums for counts/spend, recomputed ratios for ROAS/CPP/CTR/etc.
// Shared by the dashboard Campaign Performance table AND the Ads Manager footer.
function computeTotal(rows: Row[]): Row {
  const S = rows.reduce((s, r) => ({
    budget: s.budget + r.budget, spend: s.spend + r.spend, purchaseValue: s.purchaseValue + r.purchaseValue,
    purchases: s.purchases + r.purchases, websitePurchases: s.websitePurchases + r.websitePurchases, metaPurchases: s.metaPurchases + r.metaPurchases,
    addToCart: s.addToCart + r.addToCart, initiateCheckout: s.initiateCheckout + r.initiateCheckout, contentViews: s.contentViews + r.contentViews,
    clicks: s.clicks + r.clicks, linkClicks: s.linkClicks + r.linkClicks, messaging: s.messaging + r.messaging, reach: s.reach + r.reach, impressions: s.impressions + r.impressions,
    inlineLinkClicks: s.inlineLinkClicks + r.inlineLinkClicks, video3s: s.video3s + r.video3s, videoP100: s.videoP100 + (r.videoP100 || 0),
  }), { budget: 0, spend: 0, purchaseValue: 0, purchases: 0, websitePurchases: 0, metaPurchases: 0, addToCart: 0, initiateCheckout: 0, contentViews: 0, clicks: 0, linkClicks: 0, messaging: 0, reach: 0, impressions: 0, inlineLinkClicks: 0, video3s: 0, videoP100: 0 })
  const vWeighted = rows.reduce((s, r) => s + r.videoAvgPlay * r.video3s, 0)  // weighted avg video play
  return {
    id: "TOTAL", name: "TOTAL", status: "", objective: "", accountId: "", accountName: "", accountOwner: "", spendVat: 0, purchaseRoas: 0,
    ...S,
    roas: S.spend > 0 ? S.purchaseValue / S.spend : 0,
    cpa: S.purchases > 0 ? S.spend / S.purchases : 0,
    avgValue: S.purchases > 0 ? S.purchaseValue / S.purchases : 0,
    costPerCheckout: S.initiateCheckout > 0 ? S.spend / S.initiateCheckout : 0,
    convRate: S.clicks > 0 ? (S.purchases / S.clicks) * 100 : 0,
    costPerMsg: S.messaging > 0 ? S.spend / S.messaging : 0,
    ctr: S.impressions > 0 ? (S.clicks / S.impressions) * 100 : 0,
    linkCtr: S.impressions > 0 ? (S.inlineLinkClicks / S.impressions) * 100 : 0,
    frequency: S.reach > 0 ? S.impressions / S.reach : 0,
    videoAvgPlay: S.video3s > 0 ? vWeighted / S.video3s : 0,
    cpc: S.clicks > 0 ? S.spend / S.clicks : 0,
    cpm: S.impressions > 0 ? (S.spend / S.impressions) * 1000 : 0,
  }
}

type PerfLevel = "campaign" | "adset" | "ad"

function PerfTable({ rows, objective, loading, level, onLevel, sel, onToggle, onToggleAll, onDrill, badges, onClear }: {
  rows: Row[]; objective: Obj; loading: boolean; level: PerfLevel; onLevel: (l: PerfLevel) => void
  sel: Set<string>; onToggle: (id: string) => void; onToggleAll: (ids: string[] | null) => void; onDrill: (r: Row) => void
  badges: Record<PerfLevel, number>; onClear: (l: PerfLevel) => void
}) {
  const baseCols = objective === "Messaging" ? MSG_COLS : CONV_COLS
  const cols = level === "ad" ? [...baseCols, ...AD_EXTRA_COLS] : baseCols   // ad-only extras at the end
  const nameLbl = level === "campaign" ? "Campaign" : level === "adset" ? "Ad Set" : "Ad"
  const [sort, setSort] = useState<SortState | null>({ key: "Amount Spent", dir: "desc" })
  const sorted = useMemo(() => sortRows(rows, sort, (r, k) =>
    k === "Campaign" ? r.name.toLowerCase() : k === "Status" ? r.status : (cols.find(c => c.l === k)?.v(r) ?? 0)
  ), [rows, sort, cols])

  const totalRow = computeTotal(rows)
  const allChecked = rows.length > 0 && rows.every(r => sel.has(r.id))

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
        {/* View-only level tabs with "N selected ✕" badges — selecting upstream filters downstream */}
        <div className="flex items-center gap-1">
          {([["campaign", "Campaigns", Megaphone], ["adset", "Ad Sets", LayoutGrid], ["ad", "Ads", Layers]] as [PerfLevel, string, any][]).map(([lvl, label, Icon]) => (
            <button key={lvl} onClick={() => onLevel(lvl)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${level === lvl ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
              <Icon className="w-3.5 h-3.5" /> {label}
              {badges[lvl] > 0 && (
                <span className={`flex items-center gap-0.5 text-[10px] font-semibold pl-1.5 pr-0.5 py-0.5 rounded-full ${level === lvl ? "bg-white/25 text-white" : "bg-blue-600 text-white"}`}>
                  {badges[lvl]} selected
                  <span role="button" tabIndex={0} title="Clear selection" onClick={e => { e.stopPropagation(); onClear(lvl) }}
                    className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full hover:bg-black/20"><X className="w-2.5 h-2.5" /></span>
                </span>
              )}
            </button>
          ))}
        </div>
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Campaign Performance {objective !== "All" && `· ${objective}`}</span>
      </div>
      <div className="overflow-x-auto scrollbar-dark max-h-[60vh] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-20">
            <tr className="bg-slate-100 border-b border-slate-200 text-left">
              <th className="px-3 py-3 sticky left-0 z-20 bg-slate-100 w-[44px] min-w-[44px] max-w-[44px]"><input type="checkbox" checked={allChecked} onChange={e => onToggleAll(e.target.checked ? rows.map(r => r.id) : null)} className="accent-blue-600" /></th>
              <th className="px-5 py-3 font-semibold text-slate-600 whitespace-nowrap sticky left-[43px] z-20 bg-slate-100 min-w-[240px] border-l border-r border-slate-200">
                <button onClick={() => setSort(s => nextSort(s, "Campaign"))} className="flex items-center gap-1 hover:text-blue-600">{nameLbl} <SortArrow active={sort?.key === "Campaign"} dir={sort?.dir || "desc"} /></button>
              </th>
              <th className="px-5 py-3 font-semibold text-slate-600 border-r border-slate-200">
                <button onClick={() => setSort(s => nextSort(s, "Status"))} className="flex items-center gap-1 hover:text-blue-600">Status <SortArrow active={sort?.key === "Status"} dir={sort?.dir || "desc"} /></button>
              </th>
              {cols.map(c => (
                <th key={c.l} className="px-5 py-3 font-semibold text-slate-600 whitespace-nowrap text-right min-w-[110px] border-r border-slate-200 last:border-r-0">
                  <button onClick={() => setSort(s => nextSort(s, c.l))} className="flex items-center gap-1 justify-end w-full hover:text-blue-600">{c.l} <SortArrow active={sort?.key === c.l} dir={sort?.dir || "desc"} /></button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={cols.length + 3} className="text-center py-10 text-slate-400"><RefreshCw className="w-4 h-4 animate-spin inline mr-2" /> Loading…</td></tr>
              : sorted.length === 0 ? <tr><td colSpan={cols.length + 3} className="text-center py-10 text-slate-400 text-sm">No {nameLbl.toLowerCase()}s.</td></tr>
                : sorted.map((r, i) => {
                  const selected = sel.has(r.id)
                  const rowBg = selected ? "bg-blue-50" : (i % 2 === 0 ? "bg-white" : "bg-slate-50")
                  return (
                    <tr key={r.id} className={`border-b border-slate-100 ${rowBg} hover:bg-blue-50/40`}>
                      <td className={`px-3 py-3.5 sticky left-0 z-10 ${rowBg} w-[44px] min-w-[44px] max-w-[44px]`}><input type="checkbox" checked={selected} onChange={() => onToggle(r.id)} className="accent-blue-600" /></td>
                      <td className={`px-5 py-3.5 font-medium sticky left-[43px] z-10 ${rowBg} min-w-[240px] border-l border-r border-slate-100`} title={r.name}>
                        <div className="flex items-center gap-2">
                          {level === "ad" && (r.thumbnail
                            ? <img src={r.thumbnail} alt="" loading="lazy" className="w-9 h-9 rounded object-cover border border-slate-200 shrink-0" />
                            : <div className="w-9 h-9 rounded bg-slate-100 border border-slate-200 shrink-0" />)}
                          <div className="min-w-0 max-w-[240px]">
                            <button onClick={() => level !== "ad" && onDrill(r)} disabled={level === "ad"} title={level === "campaign" ? "View ad sets" : level === "adset" ? "View ads" : r.name}
                              className={`flex items-center gap-1 text-left max-w-[130px] sm:max-w-[220px] ${level !== "ad" ? "text-blue-600 hover:underline" : "text-slate-800"}`}>
                              {level !== "ad" && <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
                              <span className="truncate">{r.name}</span>
                            </button>
                            <div className="text-[10px] text-slate-400 font-normal truncate">{r.accountName}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 border-r border-slate-100"><span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusColor(r.status)}`}>{statusLabel(r.status)}</span></td>
                      {cols.map(c => (
                        <td key={c.l} className="px-5 py-3.5 text-right tabular-nums whitespace-nowrap text-slate-700 border-r border-slate-100 last:border-r-0">
                          {c.l === "Budget" ? (
                            level === "ad" ? <span className="text-slate-400">—</span>
                              : r.budget > 0 ? (
                                <span className="inline-flex flex-col items-end">
                                  <span>{peso(r.budget)}</span>
                                  <span className="text-[10px] text-slate-400 font-normal">{(r.ownBudget ?? 0) > 0 ? (r.budgetKind === "lifetime" ? "Lifetime" : "Daily") : "Ad set budgets"}</span>
                                </span>
                              ) : <span className="text-slate-400 text-xs font-normal">{level === "adset" ? "Using campaign budget" : "—"}</span>
                          ) : c.l === "ROAS"
                            ? <span className={`inline-block px-2 py-0.5 rounded-md font-semibold ${roasBg(r.roas)}`}>{c.f(r)}</span>
                            : c.f(r)}
                        </td>
                      ))}
                    </tr>
                  )
                })}
          </tbody>
          {rows.length > 0 && !loading && (
            <tfoot className="sticky bottom-0 z-10">
              <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold text-slate-800">
                <td className="px-3 py-3 sticky left-0 z-10 bg-slate-100 w-[44px] min-w-[44px] max-w-[44px]" />
                <td className="px-5 py-3 sticky left-[43px] z-10 bg-slate-100 min-w-[240px] border-l border-r border-slate-200">TOTAL <span className="font-normal text-slate-400">· {rows.length} {nameLbl.toLowerCase()}{rows.length === 1 ? "" : "s"}</span></td>
                <td className="px-5 py-3 border-r border-slate-200" />
                {cols.map(c => (
                  <td key={c.l} className="px-5 py-3 text-right tabular-nums whitespace-nowrap border-r border-slate-200 last:border-r-0">
                    {c.l === "ROAS"
                      ? <span className={`inline-block px-2 py-0.5 rounded-md ${roasBg(totalRow.roas)}`}>{c.f(totalRow)}</span>
                      : c.f(totalRow)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// DAILY AD SPEND
// ════════════════════════════════════════════════════════════════════════════════
function DailySpend({ daily, loading }: { daily: { date: string; accountName: string; owner: string; status: string; budget: number; spend: number }[]; loading: boolean }) {
  const [fAccount, setFAccount] = useState("All")
  const [fOwner, setFOwner] = useState("All")
  const [fStatus, setFStatus] = useState("All")

  const accounts = useMemo(() => Array.from(new Set(daily.map(d => d.accountName))).sort(), [daily])
  const owners = useMemo(() => Array.from(new Set(daily.map(d => d.owner).filter(Boolean))).sort(), [daily])
  const statuses = useMemo(() => Array.from(new Set(daily.map(d => d.status).filter(Boolean))).sort(), [daily])

  const filtered = useMemo(() => daily.filter(d => {
    if (fAccount !== "All" && d.accountName !== fAccount) return false
    if (fOwner !== "All" && d.owner !== fOwner) return false
    if (fStatus !== "All" && d.status !== fStatus) return false
    return true
  }), [daily, fAccount, fOwner, fStatus])

  const total = filtered.reduce((s, d) => s + d.spend, 0)
  return (
    <div className="space-y-4">
      {/* Filters — match the Dashboard tab */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap gap-3 items-end">
        <Sel value={fAccount} onChange={setFAccount} opts={["All", ...accounts]} label="Account" />
        <Sel value={fOwner} onChange={setFOwner} opts={["All", ...owners]} label="Owner" />
        <Sel value={fStatus} onChange={setFStatus} opts={["All", ...statuses]} label="Status" />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-700">Daily Ad Spend per Ad Account</span>
          <span className="text-sm text-slate-500">Total: <strong className="text-blue-600">{peso(total)}</strong></span>
        </div>
        <div className="overflow-x-auto scrollbar-dark max-h-[70vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-20"><tr className="bg-slate-50 border-b border-slate-200 text-left">
              {["Date", "Ad Account", "Owner", "Daily Budget", "Amount Spent", "Status"].map(h => <th key={h} className="px-4 py-2.5 font-semibold text-slate-600 whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={6} className="text-center py-10 text-slate-400"><RefreshCw className="w-4 h-4 animate-spin inline mr-2" /> Loading…</td></tr>
                : filtered.length === 0 ? <tr><td colSpan={6} className="text-center py-10 text-slate-400 text-sm">No spend in range.</td></tr>
                  // key sa DATOS, hindi sa index — kapag index ang key, ini-reuse
                  // ni React ang maling row pagkatapos mag-filter.
                  : filtered.map((d, i) => (
                    <tr key={`${d.date}|${d.accountName}`} className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50"} hover:bg-blue-50/40`}>
                      <td className="px-4 py-2.5 whitespace-nowrap">{d.date}</td>
                      <td className="px-4 py-2.5 font-medium">{d.accountName}</td>
                      <td className="px-4 py-2.5 text-slate-600">{d.owner || "—"}</td>
                      <td className="px-4 py-2.5 tabular-nums text-slate-500">{d.budget > 0 ? peso(d.budget) : "—"}</td>
                      <td className="px-4 py-2.5 tabular-nums font-semibold text-blue-600">{peso(d.spend)}</td>
                      <td className="px-4 py-2.5"><span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusColor(d.status)}`}>{d.status.toLowerCase()}</span></td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// ADS MANAGER — full in-app manager (Campaigns → Ad Sets → Ads), like Meta Ads Manager
// ════════════════════════════════════════════════════════════════════════════════
type MgrLevel = "campaign" | "adset" | "ad"
// Ang hinihinging "dalhin mo ako doon": galing sa isang row ng Testing /
// Scaling / Monitoring papunta sa Ads Manager, nakapili na ang ad account,
// nasa tamang antas, at ang mismong object ang nakikita.
type MgrFocus = {
  accountId: string; level: MgrLevel
  /** Aling object ang ipipinto. BLANGKO = buong ad account (galing sa brand card). */
  id: string
  name: string; campaignId?: string
  /** Isinasabay ang Owner dropdown — "yung owner + ad account na yun lang ang naka-select". */
  owner?: string
  /** Bakit ka dinala rito, hal. "2nd scale · ₱1,000 → ₱1,100". Nasa banner. */
  note?: string
}
type MgrRow = Row & { createdTime: string; updatedTime: string; startTime: string; stopTime: string; bidStrategy: string; campaignId: string; adsetId: string; ownBudget: number; budgetKind: string; thumbnail: string; configuredStatus: string; kidsOn: number; kidsTotal: number; kidsLive: number; kidsStart: string; learning: { status: string; conversions: number } | null }
const fmtD = (s: string) => s ? s.slice(0, 10) : "—"
/** Ilang araw nang umiiral ang object — 0 kung walang petsa mula kay Meta. */
const daysOldOf = (iso: string) => {
  const t = new Date(iso).getTime()
  if (!isFinite(t)) return 0
  return Math.max(0, Math.floor((Date.now() - t) / 86400_000))
}
/** "today" / "3d ago" / "2mo ago" — pang-scan, hindi pang-eksaktong petsa. */
const agoOf = (iso: string) => {
  const d = daysOldOf(iso)
  if (!iso) return ""
  return d === 0 ? "today" : d === 1 ? "yesterday" : d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`
}
// Ad-preview placement formats (mirrors Meta's preview switcher).
const PREVIEW_FORMATS = [
  { key: "MOBILE_FEED_STANDARD", label: "Mobile feed" },
  { key: "DESKTOP_FEED_STANDARD", label: "Desktop feed" },
  { key: "INSTAGRAM_STANDARD", label: "Instagram" },
  { key: "RIGHT_COLUMN_STANDARD", label: "Right column" },
] as const

// ── CACHE NG ADS MANAGER ────────────────────────────────────────────────────
// Ang tab na ito ay ini-UNMOUNT kapag lumipat ka (ternary sa itaas), kaya ang
// pagbalik ay dating bagong hila ng bawat ad account — "Loading…" kahit kanina
// mo lang binuksan (iniulat Ago 14 2026).
//
// ANG YUNIT AY ISANG AD ACCOUNT, hindi ang napiling hanay. Ito ang buong punto:
// ang mga row ng isang account ay SUBSET ng "All ad accounts", kaya kapag
// nahila na ang All, LIBRE na ang pagpili ng kahit aling account at ang
// pag-filter ng owner — pinagdurugtong lang natin ang mga entry na hawak na.
// Kung naka-key ito sa buong hanay (unang bersyon), bawat pagpindot sa dropdown
// ay bagong key at bagong 21-account na hila para sa datos na nasa kamay na.
// `MGR_INFLIGHT` = sumasakay ang pangalawang humihingi sa tumatakbo nang hila,
// kaya hindi naaabot ang FB #17 rate limit. `load(true)` (pagkatapos ng tunay
// na pagbabago sa Meta) ang naglilinis ng LAHAT.

function AdsManager({ fb, from, to, focus, onJump, rounds }: {
  fb: ReturnType<typeof useFBAccounts>; from: string; to: string; focus?: MgrFocus | null
  /** Paglundag papuntang Testing/Scaling/Monitoring, sala na sa ad account. */
  onJump: (tab: Tab, f: TrackerFocus) => void
  rounds: ReturnType<typeof useMonitorRounds>
}) {
  const [accId, setAccId] = useState(focus?.accountId || "all")   // default: All ad accounts
  // Sinasabay ang Owner sa focus: kung ang ad account lang ang itatakda, ang
  // dropdown ng Owner ay "All" pa rin at mukhang hindi naka-filter — samantalang
  // ang hinihiling ay "yun lang ang naka-select".
  const [fOwner, setFOwner] = useState(focus?.owner || "All")
  const [objMgr, setObjMgr] = useState<Obj>("All")
  const [fStatus, setFStatus] = useState("All")
  // Manageable accounts = any registered, credentialed, non-archived account.
  const mgrAccounts = useMemo(() => fb.accounts.filter(a => !a.archived && a.ad_account_id && a.token), [fb.accounts])
  const owners = useMemo(() => Array.from(new Set(mgrAccounts.map(a => a.owner).filter(Boolean))).sort(), [mgrAccounts])
  const visibleAccounts = useMemo(() => mgrAccounts.filter(a => fOwner === "All" || a.owner === fOwner), [mgrAccounts, fOwner])
  const accById = (id: string) => mgrAccounts.find(a => a.id === id) || null
  const isAll = accId === "all"
  const account = accById(accId)

  // ── "Buksan sa Ads Manager" mula sa Testing / Scaling / Monitoring ─────────
  // Ang tab na ito ay ini-mount lang kapag binuksan (ternary), kaya ang `focus`
  // ay basta ipinapasok sa unang halaga ng state — walang effect na kailangan,
  // walang kumukurap na "All ad accounts" muna bago mag-filter.
  const [focusOn, setFocusOn] = useState<MgrFocus | null>(focus ?? null)

  // ── MONITORING ROUNDS sa loob ng manager ───────────────────────────────────
  // Ang mga account na HINDI PA na-check sa kasalukuyang bukas/late na bintana,
  // pinakamalaking gastos muna — ito ang landas ng round.
  const dueAccountIds = useMemo(() => {
    const ids: { id: string; spend: number }[] = []
    for (const c of rounds.checks) {
      if (c.checked_at) continue
      const setting = rounds.settings.find(s => s.owner === c.owner)
      const w = windowFor(setting, c)
      if (!w) continue
      const st = slotStateAt(w)
      if (st !== "open" && st !== "late") continue
      if (!mgrAccounts.some(a => a.id === c.account_id)) continue
      ids.push({ id: c.account_id, spend: c.spend_at_freeze })
    }
    return ids.sort((a, b) => b.spend - a.spend).map(x => x.id)
  }, [rounds.checks, rounds.settings, mgrAccounts])
  // ?round=HH:MM → simulan sa unang hindi pa na-check na account.
  const roundBoot = useRef(false)
  useEffect(() => {
    if (!rounds.loaded || roundBoot.current) return
    try {
      const q = new URLSearchParams(window.location.search)
      if (!q.get("round")) { roundBoot.current = true; return }
      // ⚠ Huwag sunugin ang boot habang wala pang laman ang listahan — ang
      // cold-cache na pagbukas mula sa abiso ay nauunahan ng loaded bago pa
      // dumating ang mga account; maghihintay ito sa unang may-lamang render.
      if (dueAccountIds.length) { roundBoot.current = true; setAccId(dueAccountIds[0]) }
    } catch { roundBoot.current = true }
  }, [rounds.loaded, dueAccountIds])
  // Ang event mula sa popup/kandado habang bukas ang pahina.
  useEffect(() => {
    const onRound = () => { if (dueAccountIds.length) setAccId(dueAccountIds[0]) }
    window.addEventListener("pesowise:round", onRound)
    return () => window.removeEventListener("pesowise:round", onRound)
  }, [dueAccountIds])
  // Pagkatapos ng bawat matagumpay na check — diretso sa susunod na account.
  const advanceRound = useCallback(() => {
    const next = dueAccountIds.find(id => id !== accId)
    if (next) setAccId(next)
  }, [dueAccountIds, accId])
  const [level, setLevel] = useState<MgrLevel>(focus?.level ?? "campaign")
  // Meta-style multi-select: selecting upstream rows filters the downstream panels.
  // Kapag may focus, naka-tsek na agad ang pinanggalingan: kaya kung pipindutin
  // mo ang Ad Sets, ang mga ad set NG CAMPAIGN NA IYON agad ang lalabas.
  //
  // ⚠ ANG BLANGKONG `id` AY HINDI PAGPILI. Ang brand card ng Dashboard ay
  // nagpapadala ng `{ level: "campaign", id: "" }` — ibig sabihin "buong ad
  // account", walang itinuturong campaign. Pero ang `new Set([""])` ay may
  // SUKAT NA ISA, kaya: nagsasabi ang tab ng "1 selected" gayong walang row na
  // naka-tsek, at — mas masama — sa antas ng Ad Sets ay `selCampaigns.has(
  // r.campaignId)` ang salaan, at walang ad set na may magulang na "", kaya
  // NAWAWALAN NG LAMAN ang buong listahan (iniulat ng may-ari, Ago 18 2026).
  // Ang blangko ay sinasala bago pa maging pagpili.
  const seed = (v?: string) => new Set<string>(v ? [v] : [])
  const [selCampaigns, setSelCampaigns] = useState<Set<string>>(() =>
    seed(focus?.level === "campaign" ? focus.id : focus?.campaignId))
  const [selAdsets, setSelAdsets] = useState<Set<string>>(() =>
    seed(focus?.level === "adset" ? focus.id : undefined))
  const [selAds, setSelAds] = useState<Set<string>>(new Set())

  // raw rows for the CURRENT level only (lazy-loaded). Naka-cache pa ba mula sa
  // huling pagbukas? Ilagay agad — walang "Loading…" sa pagbalik sa tab.
  // (Sa mount, "campaign" palagi ang `level`.)
  const [rows, setRows] = useState<any[]>(() => {
    // Walang TTL sa PAGPAPAKITA — tingnan ang paliwanag sa `dashBoot`.
    const accts = isAll ? visibleAccounts : (account ? [account] : [])
    return accts.flatMap(a => MGR_CACHE.get(`${level}|${from}|${to}|${a.id}`)?.rows ?? [])
  })
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState("")
  const [toast, setToast] = useState("")
  const [editId, setEditId] = useState("")   // row whose budget is being edited inline
  const [editVal, setEditVal] = useState("")
  // Pending edits (drafts): BUDGET changes only — queued locally, published together (Meta-style).
  // Status toggles are NOT drafted: they publish to Facebook immediately (see setStatusNow).
  // `name` = ang pangalan NOONG ni-draft (pang-tawag sa review at sa log).
  // `rename` = ang HINIHILING na bagong pangalan — iyon ang pagbabago.
  const [drafts, setDrafts] = useState<Record<string, { id: string; name: string; accountId: string; budget?: number; rename?: string }>>({})
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())   // rows whose on/off is being applied on FB right now
  // ⚠ ANG BASA PAGKATAPOS NG SULAT AY HULI SA META. Tinatanggap ni Meta ang
  // pagbukas, pero ang kasunod na `load(true)` ay ibinabalik pa rin ang LUMANG
  // configured_status — kaya nabubura ang optimistic flip at mukhang OFF pa rin
  // ang kabubukas mo lang (iniulat ng may-ari, Ago 14 2026). Ang tinanggap na
  // halaga ay hawak dito at ipinapatong sa anumang isinasagot ni Meta, hanggang
  // sumang-ayon si Meta — o hanggang mag-expire (baka tinanggihan pala).
  const [pendingStatus, setPendingStatus] = useState<Record<string, { to: "ACTIVE" | "PAUSED"; at: number }>>({})
  const PENDING_TTL = 5 * 60_000
  // Maikling kislap pagkatapos ng matagumpay na pagpalit — para may makita kang
  // nangyari, hindi lang basta lumipat ang kulay.
  const [flashOn, setFlashOn] = useState<Record<string, "ACTIVE" | "PAUSED">>({})
  const [sfx, setSfx] = useState(true)
  useEffect(() => { setSfx(sfxOn()) }, [])
  // Usapan sa isang row (ang paglundag ay walang state — diretso na).
  const [commentFor, setCommentFor] = useState<MgrRow | null>(null)
  // Pagpapalit ng pangalan sa mismong hilera.
  const [renameId, setRenameId] = useState("")
  const [renameVal, setRenameVal] = useState("")

  // Automated rules (Meta adrules_library): More ▾ → Create a new rule / Manage rules
  const [moreOpen, setMoreOpen] = useState(false)
  const [rulesView, setRulesView] = useState<RulesView>("")
  const [reviewOpen, setReviewOpen] = useState(false)                                   // "Review draft items" modal
  const [discardOpen, setDiscardOpen] = useState(false)                                 // "Discard drafts" confirm
  const [pubProgress, setPubProgress] = useState<{ done: number; total: number } | null>(null)   // publish progress bar
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({})            // per-draft publish error
  const [publishToast, setPublishToast] = useState<{ count: number; label: string } | null>(null)   // success notification
  const [lastPublished, setLastPublished] = useState<{ name: string; change: string }[]>([])
  const [detailsOpen, setDetailsOpen] = useState(false)
  // Ad preview modal: which selected ads, which one is showing, which placement format.
  const [previewAds, setPreviewAds] = useState<{ id: string; name: string; accountId: string }[]>([])
  const [previewIdx, setPreviewIdx] = useState(0)
  const [previewFmt, setPreviewFmt] = useState("MOBILE_FEED_STANDARD")
  const [previewHtml, setPreviewHtml] = useState("")
  const [previewLoading, setPreviewLoading] = useState(false)
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000) }

  // Lazy-load ONLY the level being viewed (keeps API calls low → avoids FB #17 rate limits).
  // Cross-level filtering uses each row's own campaignId / adsetId, so other levels needn't load.
  // Uses the 5-min server cache by default; pass fresh=true after an edit to force a refetch.
  // ⚠ KADA AD ACCOUNT ANG CACHE, HINDI KADA HANAY NG ACCOUNT. Ang unang bersyon
  // ay naka-key sa buong set (`level|from|to|LAHAT ng id`), kaya bawat pagpili ng
  // ibang account — at bawat pagpalit ng Owner filter — ay BAGONG key at buong
  // bagong hila, kahit nahila na ang datos na iyon kanina bilang bahagi ng "All
  // ad accounts". Ang mga row ng isang account ay SUBSET lang naman ng "All".
  // Kaya kada account ang entry ngayon at pinagdurugtong sa pagpapakita: ang
  // pagpili ng account, pag-filter ng owner, at pagbalik sa All ay ZERO request.
  const accKey = useCallback((a: FBAccount) => `${level}|${from}|${to}|${a.id}`, [level, from, to])
  // Aling view ang pinapakita ngayon — para hindi maisulat ng natapos na hila
  // ang resulta nito sa ibang account na pinili mo na habang naghihintay.
  const viewSigRef = useRef("")

  const load = useCallback(async (fresh = false) => {
    const accts = isAll ? visibleAccounts : (account ? [account] : [])
    if (accts.length === 0) { setRows([]); setLoading(false); return }
    const sig = `${level}|${from}|${to}|${accts.map(a => a.id).join(",")}`
    viewSigRef.current = sig
    const assemble = () => accts.flatMap(a => MGR_CACHE.get(accKey(a))?.rows ?? [])
    const show = () => { if (viewSigRef.current === sig) setRows(assemble()) }

    if (fresh) {
      // Binago natin ang Meta — wala nang mapagkakatiwalaan ANG KAHIT ALING
      // antas (ang pag-pause ng campaign ay nagpapabago sa ad sets nito).
      // MARKAHANG LUMA, huwag burahin: ipapakita pa rin ang huling alam habang
      // dumarating ang bago, kaya hindi nagbubukas ng butas ang talahanayan.
      MGR_CACHE.forEach(v => { v.ts = 0 })
    }
    const now = Date.now()
    const absent = accts.filter(a => !MGR_CACHE.has(accKey(a)))
    const stale = accts.filter(a => { const h = MGR_CACHE.get(accKey(a)); return !!h && now - h.ts >= MGR_TTL })
    const toPull = fresh ? accts : [...absent, ...stale]

    // May naka-cache nang bahagi? Ipakita agad — huwag itago ang alam na natin
    // sa likod ng spinner habang hinihintay ang natitira.
    show()
    if (toPull.length === 0) { setLoading(false); return }
    // ⚠ SPINNER PARA LANG SA WALANG MAIPAPAKITA. Ang luma ay tahimik na
    // pinapalitan — kapag nakita mo na ang Ad Sets minsan, hindi ka na dapat
    // makakita ng "Loading…" doon kailanman, kahit lumipas na ang TTL.
    if (absent.length > 0 && !fresh) setLoading(true)
    await mapLimit(toPull, 3, async (a: FBAccount) => {
      const key = accKey(a)
      if (!fresh) {
        const running = MGR_INFLIGHT.get(key)
        if (running) { await running.catch(() => null); show(); return }
      }
      const run = (async () => {
        const j = await fetch(`/api/fb/insights?rich=1${fresh ? "&nocache=1" : ""}&level=${level}&parent=${encodeURIComponent(actId(a.ad_account_id))}&token=${encodeURIComponent(a.token)}&account_id=${encodeURIComponent(actId(a.ad_account_id))}&from=${from}&to=${to}`).then(r => r.json())
        const rows = j.success ? (j.rows || []).map((r: any) => ({ ...r, __accId: a.id })) : []
        MGR_CACHE.set(key, { ts: Date.now(), rows })
        return rows
      })()
      MGR_INFLIGHT.set(key, run)
      try { await run } catch { /* laktawan ang account na bumigo */ }
      finally { MGR_INFLIGHT.delete(key); show() }   // dumadagdag ang row habang dumarating
    })
    show()
    if (viewSigRef.current === sig) setLoading(false)
  }, [isAll, account, visibleAccounts, level, from, to, accKey])
  useEffect(() => { load() }, [load])
  // Account change resets the view + all selections.
  // ⚠ Tumatakbo rin ito sa MOUNT, at buburahin nito ang buong `focus` bago mo
  // pa ito makita ("bakit All ad accounts pa rin?"). Nilalaktawan ang unang
  // takbo; ang tunay na pagpalit ng account ay nagpapawalang-bisa sa focus.
  const accIdFirstRun = useRef(true)
  useEffect(() => {
    if (accIdFirstRun.current) { accIdFirstRun.current = false; return }
    setLevel("campaign"); setSelCampaigns(new Set()); setSelAdsets(new Set()); setSelAds(new Set()); setFocusOn(null)
  }, [accId])

  async function manage(token: string, action: string, extra: any = {}, silent = false) {
    if (!token) return
    setBusy(extra.id || action)
    try {
      const j = await fetch(`/api/fb/manage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, action, ...extra }) }).then(r => r.json())
      if (!j.success) throw new Error(j.error || "Failed")
      if (!silent) { flash("Done."); await load(true) }
    } catch (e: any) { flash("⚠ " + (e?.message || "Failed")) }
    setBusy("")
  }
  // ── Draft edits: BUDGET changes queue locally, then publish together (Meta-style) ──
  const draftCount = Object.keys(drafts).length
  const origActive = (r: MgrRow) => /active/i.test(r.configuredStatus)
  const effBudget = (r: MgrRow) => drafts[r.id]?.budget ?? r.ownBudget   // budget incl. pending draft
  const hasBudgetDraft = (r: MgrRow) => drafts[r.id]?.budget != null
  // ── PANGALAN, KASAMA NA ANG DRAFT ────────────────────────────────────────
  // ⚠ ANG DRAFT ANG IPINAPAKITA, HINDI ANG NAKA-IMBAK. Kung ang talahanayan ay
  // magpapakita pa rin ng lumang pangalan habang may nakabinbing pagpapalit, ang
  // tanging tanda ay ang chip sa gilid — at maghihintay ka ng pagbabagong nasa
  // harap mo na pala.
  const effName = (r: MgrRow) => drafts[r.id]?.rename ?? r.name
  const hasNameDraft = (r: MgrRow) => drafts[r.id]?.rename != null
  const upsertDraft = (r: MgrRow, patch: { budget?: number; rename?: string }) => setDrafts(d => {
    const base = d[r.id] || { id: r.id, name: r.name, accountId: r.accountId }
    const next = { ...base, ...patch }
    if (next.budget != null && next.budget === Math.round(r.ownBudget)) delete next.budget   // back to original → not a change
    // Pareho ng dati? Hindi na iyon pagbabago — para hindi lumobo ang bilang ng
    // draft sa pag-click papasok at palabas ng pangalan.
    if (next.rename != null && next.rename.trim() === r.name.trim()) delete next.rename
    const nd = { ...d }
    // Ang row ay nananatiling draft habang may KAHIT ISANG pagbabago.
    if (next.budget == null && next.rename == null) delete nd[r.id]; else nd[r.id] = next
    return nd
  })
  const queueBudget = (r: MgrRow, v: number) => { setEditId(""); if (isFinite(v) && v > 0) upsertDraft(r, { budget: Math.round(v) }) }
  const queueRename = (r: MgrRow, v: string) => {
    setRenameId("")
    const name = v.trim()
    if (!name) return                       // ang blangko ay hindi pangalan
    upsertDraft(r, { rename: name })
  }
  const discardDrafts = () => { setDrafts({}); setDraftErrors({}); setReviewOpen(false) }
  // Human-readable summary of a draft's change (shown in the review modal).
  // Maaaring dalawa ang laman ng isang row — kaya listahan, hindi isang linya.
  const draftChange = (dr: { budget?: number; rename?: string }) =>
    [dr.rename != null ? `Name → "${dr.rename}"` : "", dr.budget != null ? `Budget → ${peso(dr.budget)}` : ""]
      .filter(Boolean).join(" · ") || "—"

  // ── Status toggles publish IMMEDIATELY (no draft): flip agad → spinner on the toggle → fresh reload → "updated" toast ──
  async function setStatusNow(r: MgrRow, status: "ACTIVE" | "PAUSED") {
    const token = accById(r.accountId)?.token || ""
    if (!token) { flash("⚠ No token for this account"); return }
    const prev = { status: r.status, configuredStatus: r.configuredStatus }
    setRows(rs => rs.map(x => x.id === r.id ? { ...x, status, configuredStatus: status } : x))   // optimistic flip
    setTogglingIds(s => new Set(s).add(r.id))
    try {
      const j = await fetch(`/api/fb/manage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, action: "status", id: r.id, status }) }).then(rr => rr.json())
      if (!j.success) throw new Error(j.error || "Failed")
      // Tinanggap ni Meta. Hawakan ang halagang ito kahit ano pa ang isagot ng
      // susunod na hila — huli siya sa sarili niyang sulat.
      setPendingStatus(p => ({ ...p, [r.id]: { to: status, at: Date.now() } }))
      playToggle(status === "ACTIVE")
      setFlashOn(f => ({ ...f, [r.id]: status }))
      setTimeout(() => setFlashOn(f => { const n = { ...f }; delete n[r.id]; return n }), 700)
      setTogglingIds(s => { const n = new Set(s); n.delete(r.id); return n })
      logAds({ action: "status", level, objectId: r.id, objectName: r.name, accountName: r.accountName,
        summary: status === "ACTIVE" ? "Turned ON" : "Turned OFF", surface: "ads-manager",
        details: { from: prev.status, to: status } })
      await load(true)   // fresh pull so effective status/cache match FB
      setLastPublished([{ name: r.name, change: status === "ACTIVE" ? "Turned on" : "Turned off" }])
      setPublishToast({ count: 1, label: nameHdr })
      setTimeout(() => setPublishToast(null), 6000)
    } catch (e: any) {
      setRows(rs => rs.map(x => x.id === r.id ? { ...x, ...prev } : x))   // revert the optimistic flip
      setPendingStatus(p => { const n = { ...p }; delete n[r.id]; return n })
      setTogglingIds(s => { const n = new Set(s); n.delete(r.id); return n })
      playError()
      flash("⚠ " + (e?.message || "Failed"))
    }
  }
  // Bulk Turn on / Turn off: applies to all selected rows immediately, with the action-bar progress bar.
  async function bulkSetStatus(status: "ACTIVE" | "PAUSED") {
    const targets = levelRows.filter(r => curSel.has(r.id))
    if (targets.length === 0) return
    setBusy("publish"); setPubProgress({ done: 0, total: targets.length })
    await new Promise(res => setTimeout(res, 30))           // let the empty bar paint first so it can animate
    const ok: { name: string; change: string }[] = []
    const logged: Parameters<typeof logAdsMany>[0] = []
    let failed = 0
    for (let i = 0; i < targets.length; i++) {
      const r = targets[i]
      const token = accById(r.accountId)?.token || ""
      try {
        if (!token) throw new Error("No token for this account")
        const j = await fetch(`/api/fb/manage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, action: "status", id: r.id, status }) }).then(rr => rr.json())
        if (!j.success) throw new Error(j.error || "Failed")
        ok.push({ name: r.name, change: status === "ACTIVE" ? "Turned on" : "Turned off" })
        setPendingStatus(p => ({ ...p, [r.id]: { to: status, at: Date.now() } }))
        logged.push({ action: "status", level, objectId: r.id, objectName: r.name, accountName: r.accountName,
          summary: status === "ACTIVE" ? "Turned ON (bulk)" : "Turned OFF (bulk)", surface: "ads-manager",
          details: { from: r.status, to: status, bulkOf: targets.length } })
      } catch { failed++ }
      setPubProgress({ done: i + 1, total: targets.length })
    }
    // Isang insert para sa buong bulk — hindi 20 magkakahiwalay na round-trip.
    logAdsMany(logged)
    if (ok.length) playToggle(status === "ACTIVE"); else if (failed) playError()
    await new Promise(res => setTimeout(res, 450))          // hold the final fill so it's visible
    setBusy(""); setPubProgress(null)
    await load(true)
    if (ok.length) {
      setLastPublished(ok)
      setPublishToast({ count: ok.length, label: nameHdr })
      setTimeout(() => setPublishToast(null), 6000)
    }
    if (failed) flash(`⚠ ${failed} of ${targets.length} failed to update.`)
  }
  async function publishDrafts() {
    const list = Object.values(drafts); if (list.length === 0) return
    setReviewOpen(false)                                    // close review — progress shows in the action bar
    setBusy("publish"); setPubProgress({ done: 0, total: list.length })
    await new Promise(res => setTimeout(res, 30))           // let the empty bar paint first so it can animate
    const errs: Record<string, string> = {}
    const budgetLogs: Parameters<typeof logAdsMany>[0] = []
    for (let i = 0; i < list.length; i++) {
      const dr = list[i]
      const token = accById(dr.accountId)?.token || ""
      const post = (body: any) => fetch(`/api/fb/manage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...body }) }).then(r => r.json())
      try {
        if (!token) throw new Error("No token for this account")
        // ⚠ ISANG TAWAG PARA SA DALAWA. Ang pangalan at ang budget ay parehong
        // `action: "update"` — kapag hiniwalay, dalawang request ang isang row
        // at maaaring tumama ang isa habang pumapalya ang isa, kaya kalahating
        // naipublish ang isang draft. Sabay silang ipinapadala o sabay palya.
        if (dr.budget != null || dr.rename != null) {
          const j = await post({
            action: "update", id: dr.id,
            ...(dr.budget != null ? { daily_budget: dr.budget } : {}),
            ...(dr.rename != null ? { name: dr.rename } : {}),
          })
          if (!j.success) throw new Error(j.error || "Failed")
          const row = levelRows.find(x => x.id === dr.id)
          if (dr.budget != null) {
            const before = row?.ownBudget ?? 0
            budgetLogs.push({ action: "budget", level, objectId: dr.id, objectName: dr.rename || dr.name,
              accountName: accById(dr.accountId)?.name || "",
              summary: `${before > 0 ? peso(before) : "—"} → ${peso(dr.budget)}`,
              surface: "ads-manager", details: { from: before, to: dr.budget, via: "published draft" } })
          }
          if (dr.rename != null) {
            const before = row?.name ?? dr.name
            budgetLogs.push({ action: "rename", level, objectId: dr.id, objectName: dr.rename,
              accountName: accById(dr.accountId)?.name || "",
              summary: `"${before}" → "${dr.rename}"`,
              surface: "ads-manager", details: { from: before, to: dr.rename, via: "published draft" } })
            // Isulat sa CACHE ng BAWAT antas ng account na ito — kung hindi,
            // babalik ang lumang pangalan pagkatapos mong lumipat ng tab
            // (parehong bitag ng kill na nabuhay muli).
            const patch = (rows: any[]) => rows.map(x => x.id === dr.id ? { ...x, name: dr.rename } : x)
            setRows(patch)
            for (const [k, v] of MGR_CACHE) if (k.endsWith(`|${dr.accountId}`)) MGR_CACHE.set(k, { ...v, rows: patch(v.rows) })
          }
        }
      } catch (e: any) { errs[dr.id] = e?.message || "Failed" }
      setPubProgress({ done: i + 1, total: list.length })   // fill the bar as each item completes
    }
    await new Promise(res => setTimeout(res, 450))          // hold the final fill so it's visible
    logAdsMany(budgetLogs)
    setBusy(""); setPubProgress(null); setDraftErrors(errs)
    const failed = Object.keys(errs)
    if (failed.length === 0) {
      setLastPublished(list.map(dr => ({ name: dr.name, change: draftChange(dr) })))
      setPublishToast({ count: list.length, label: nameHdr })
      setTimeout(() => setPublishToast(null), 6000)
      setDrafts({}); setReviewOpen(false)
    } else {
      setDrafts(d => { const nd: typeof d = {}; for (const id of failed) if (d[id]) nd[id] = d[id]; return nd })   // keep only the failed ones to retry
      setReviewOpen(true)   // reopen so the failed rows + errors are visible
      flash(`⚠ ${failed.length} change${failed.length === 1 ? "" : "s"} failed — see the review dialog.`)
    }
    await load(true)
  }

  // Budget edit: seed with the current (drafted) value; publish-now applies just this one immediately.
  const startEditBudget = (r: MgrRow) => { setEditId(r.id); setEditVal(String(Math.round(effBudget(r)))) }
  // Publish just THIS one row's budget (per-ad-account), with the same progress + success toast.
  async function publishBudgetNow(r: MgrRow, v: number) {
    setEditId("")
    if (!isFinite(v) || v <= 0) return
    const token = accById(r.accountId)?.token || ""
    if (!token) { flash("⚠ No token for this account"); return }
    setDrafts(d => { if (!d[r.id]) return d; const nd = { ...d }; delete nd[r.id]; return nd })   // publishing now supersedes any queued draft for this row
    setBusy("publish"); setPubProgress({ done: 0, total: 1 })
    await new Promise(res => setTimeout(res, 30))   // let the empty bar paint first so it can animate
    try {
      const j = await fetch(`/api/fb/manage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, action: "update", id: r.id, daily_budget: Math.round(v) }) }).then(rr => rr.json())
      if (!j.success) throw new Error(j.error || "Failed")
      logAds({ action: "budget", level, objectId: r.id, objectName: r.name, accountName: r.accountName,
        summary: `${r.ownBudget > 0 ? peso(r.ownBudget) : "—"} → ${peso(Math.round(v))}`,
        surface: "ads-manager", details: { from: r.ownBudget, to: Math.round(v), via: "publish now" } })
      setLastPublished([{ name: r.name, change: `Budget → ${peso(Math.round(v))}` }])
      setPublishToast({ count: 1, label: nameHdr })
      setTimeout(() => setPublishToast(null), 6000)
    } catch (e: any) { flash("⚠ " + (e?.message || "Failed")) }
    setPubProgress({ done: 1, total: 1 })
    await new Promise(res => setTimeout(res, 450))   // hold at 100% so the fill is visible
    setBusy(""); setPubProgress(null); await load(true)
  }

  // ── Ad preview: open with the selected ads; fetch the rendered iframe per ad + format ──
  const openPreview = () => {
    const ads = levelRows.filter(r => curSel.has(r.id)).map(r => ({ id: r.id, name: r.name, accountId: r.accountId }))
    if (ads.length === 0) return
    setPreviewAds(ads); setPreviewIdx(0); setPreviewHtml("")
  }
  const closePreview = () => { setPreviewAds([]); setPreviewHtml("") }
  useEffect(() => {
    const ad = previewAds[previewIdx]
    if (!ad) return
    const token = accById(ad.accountId)?.token || ""
    if (!token) { setPreviewHtml(""); return }
    let alive = true
    setPreviewLoading(true)
    fetch(`/api/fb/insights?preview=1&ad_id=${encodeURIComponent(ad.id)}&format=${encodeURIComponent(previewFmt)}&token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(j => { if (alive) setPreviewHtml(j.success ? j.body : "") })
      .catch(() => { if (alive) setPreviewHtml("") })
      .finally(() => { if (alive) setPreviewLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewAds, previewIdx, previewFmt])

  // ── derive current-level rows, filtered by upstream selection ──
  const baseCols = objMgr === "Messaging" ? MSG_COLS : CONV_COLS
  const cols = level === "ad" ? [...baseCols, ...AD_EXTRA_COLS] : baseCols   // ad-only extras at the end
  const toMgr = (r: any): MgrRow => {
    const a = accById(r.__accId) || account
    return { ...toRow(r, a?.id || "", a?.name || "", a?.owner || ""), createdTime: r.createdTime || "", updatedTime: r.updatedTime || "", startTime: r.startTime || "", stopTime: r.stopTime || "", bidStrategy: r.bidStrategy || "", campaignId: r.campaignId || "", adsetId: r.adsetId || "", ownBudget: r.ownBudget || 0, budgetKind: r.budgetKind || "", thumbnail: r.thumbnail || "", configuredStatus: r.configuredStatus || r.status || "",
      kidsOn: typeof r.kidsOn === "number" ? r.kidsOn : -1, kidsTotal: typeof r.kidsTotal === "number" ? r.kidsTotal : -1,
      kidsLive: typeof r.kidsLive === "number" ? r.kidsLive : -1, kidsStart: r.kidsStart || "",
      learning: r.learning && r.learning.status ? { status: String(r.learning.status), conversions: Number(r.learning.conversions || 0) } : null }
  }
  // ⚠ PAREHONG BITAG NA INAYOS SA DASHBOARD (Ago 6 2026), naiwan dito: ang
  // "Paused" ay humihingi rin ng `spend > 0`, kaya sa 145 na paused campaign ay
  // 45 lang ang lumalabas — 100 ang nakatago. Ang STATUS ay status; ang "With
  // spend" ang para sa gastos. Huwag paghaluin muli.
  const passStatus = (r: MgrRow) => fStatus === "All" || (fStatus === "Active" ? /active/i.test(r.status) : fStatus === "Paused" ? /paus/i.test(r.status) : r.spend > 0)
  // Ipinapatong ang tinanggap-na-pero-hindi-pa-iniuulat na status.
  const applyPending = (r: MgrRow): MgrRow => {
    const p = pendingStatus[r.id]
    if (!p) return r
    return { ...r, status: p.to, configuredStatus: p.to }
  }
  // Sumang-ayon na ba si Meta? Alisin na. Nag-e-expire din para hindi
  // magsinungaling nang habambuhay kung tinanggihan pala ang pagbabago.
  useEffect(() => {
    const ids = Object.keys(pendingStatus)
    if (ids.length === 0) return
    const raw = new Map(rows.map((r: any) => [String(r.id), String(r.configuredStatus || r.status || "")]))
    const now = Date.now()
    let changed = false
    const next = { ...pendingStatus }
    for (const id of ids) {
      const cur = raw.get(id)
      const agrees = cur != null && (pendingStatus[id].to === "ACTIVE" ? /active/i.test(cur) : /paus/i.test(cur))
      if (agrees || now - pendingStatus[id].at > PENDING_TTL) { delete next[id]; changed = true }
    }
    if (changed) setPendingStatus(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])

  const levelRows = useMemo(() => rows.map(toMgr).map(applyPending).filter(r => {
    if (!passStatus(r)) return false
    // Galing sa Testing/Scaling/Monitoring: ang hinahanap mo lang muna ang
    // ipinapakita. May "Show all" na buton sa banner sa itaas.
    // ⚠ Ang BLANGKONG `id` ay ibig sabihin "buong ad account" (galing sa brand
    // card ng Dashboard) — hindi ito pinipinto sa isang campaign; ang pagpili
    // ng account na lang ang ginagawa nito.
    if (focusOn?.id && level === focusOn.level && r.id !== focusOn.id) return false
    if (level === "campaign") return objMgr === "All" || (objMgr === "Messaging" ? isMsg(r.objective) : !isMsg(r.objective))
    if (level === "adset") return selCampaigns.size === 0 || selCampaigns.has(r.campaignId)
    return selAdsets.size > 0 ? selAdsets.has(r.adsetId) : (selCampaigns.size === 0 || selCampaigns.has(r.campaignId))   // ads
  }), [rows, account, mgrAccounts, level, objMgr, fStatus, selCampaigns, selAdsets, focusOn])

  const curSel = level === "campaign" ? selCampaigns : level === "adset" ? selAdsets : selAds
  const setCurSel = level === "campaign" ? setSelCampaigns : level === "adset" ? setSelAdsets : setSelAds
  // Isang hila para sa bilang ng komento ng LAHAT ng nakikitang row — hindi isa
  // kada row (22 campaign = 22 request kung ganoon).
  const { counts: commentCounts, refresh: refreshCounts } = useCommentCounts(useMemo(() => levelRows.map(r => r.id), [levelRows]))
  // Walang "N pinned · clear" na chip — tinanggal ito ng may-ari (Ago 17 2026).
  // Ang pag-alis ng pin ay per-row pa rin sa pamamagitan ng pindutang pin mismo,
  // kaya walang nawawalang kakayahan; ang toolbar lang ang mas tahimik.
  const { pins, toggle: togglePin, has: isPinned } = useAdsPins()

  const [sort, setSort] = useState<SortState | null>({ key: "Amount Spent", dir: "desc" })
  const sortedRows = useMemo(() => sortRows(levelRows, sort, (r, k) =>
    k === "On" ? (/active/i.test(r.status) ? 1 : 0)
      : k === "Name" ? r.name.toLowerCase()
        : k === "Status" ? r.status
          // Ang Age ay BILANG, hindi teksto: ang pag-sort sa "79d old" bilang
          // string ay maglalagay ng 100d bago ang 79d.
          : k === "Age" ? (() => { const a = runAge(r.startTime, r.createdTime); return a.started ? a.day : -1 })()
            : k === "Started" ? (r.startTime || r.createdTime)
              : k === "Last edited" ? r.updatedTime
                : (cols.find(c => c.l === k)?.v(r) ?? 0)
  ), [levelRows, sort, cols])
  // ⚠ ANG PIN AY NASA IBABAW NG SORT, hindi kapalit nito. Nag-uuri ka pa rin ayon
  // sa spend o ROAS — ang naka-pin lang ang nauuna, at sa loob ng dalawang
  // pangkat ay nananatili ang piniling pagkakasunod mo.
  const displayRows = useMemo(
    () => pinnedFirst(sortedRows, r => r.id, pins, pinOrder()),
    [sortedRows, pins])
  const mgrTotal = computeTotal(levelRows)

  // ── selection: toggle a row, clear a level (with cascade), quick-drill via name ──

  // ANAK → MAGULANG. Ang `rows` ay laman ng KASALUKUYANG ANTAS lang, kaya kapag
  // nasa campaign ka ay wala kang paraan para malaman kung kaninong campaign ang
  // isang napiling ad set. Itinatala natin ang pagkakamag-anak habang dumadaan
  // ang mga hilera, kaya alam pa rin ito pagkabalik sa itaas.
  const parentOf = useRef<Map<string, string>>(new Map())
  useEffect(() => {
    if (level === "campaign") return
    for (const raw of rows) {
      const r = toMgr(raw)
      const p = level === "adset" ? r.campaignId : r.adsetId
      if (p) parentOf.current.set(r.id, p)
    }
  }, [rows, level])

  /**
   * Inaalis ang mga piling ULILA — ang mga anak na ang magulang ay wala na sa
   * pinili. Ito ang asal ng totoong Ads Manager: ang pinili sa itaas ang
   * nagtatakda ng nasa ibaba, kaya pagbitaw sa campaign ay bitaw din sa mga ad
   * set nito (at sa mga ad ng mga ad set na iyon).
   *
   * ⚠ HINDI ITO KAGANDAHAN LANG NG BILANG. Sa antas ng Ads, si `selAdsets` ang
   * sumasala (tingnan ang `levelRows`), kaya ang naiwang ulilang ad set ay
   * nagpapakita ng mga ad ng LUMANG campaign habang iba na ang naka-tsek —
   * mukhang tama, mali naman (iniulat ng may-ari, Ago 17 2026).
   *
   * Tinatanggal ang hindi kilalang magulang. Ibig sabihin ng hindi kilala ay
   * hindi pa naipapakita ang hilerang iyon, kaya hindi ito kayang piliin ng
   * kamay — hulaan ang tanging ibubunga ng pagpapanatili.
   */
  const pruneOrphans = (camps: Set<string>, sets: Set<string>) => {
    const keptSets = new Set([...sets].filter(id => {
      const p = parentOf.current.get(id)
      return p ? camps.has(p) : false
    }))
    const keptAds = new Set([...selAds].filter(id => {
      const p = parentOf.current.get(id)
      return p ? keptSets.has(p) : false
    }))
    if (keptSets.size !== sets.size) setSelAdsets(keptSets)
    if (keptAds.size !== selAds.size) setSelAds(keptAds)
  }

  const toggleRow = (id: string) => {
    const next = new Set(curSel); next.has(id) ? next.delete(id) : next.add(id)
    setCurSel(next)
    if (level === "campaign") pruneOrphans(next, selAdsets)
    else if (level === "adset") pruneOrphans(selCampaigns, next)
  }
  /** Ang tsek sa ulo ng talahanayan — kapareho ng cascade ng isa-isang tsek. */
  const toggleAll = (on: boolean) => {
    const next = on ? new Set(levelRows.map(r => r.id)) : new Set<string>()
    setCurSel(next)
    if (level === "campaign") pruneOrphans(next, selAdsets)
    else if (level === "adset") pruneOrphans(selCampaigns, next)
  }
  const clearCampaigns = () => { setSelCampaigns(new Set()); setSelAdsets(new Set()); setSelAds(new Set()) }
  const clearAdsets = () => { setSelAdsets(new Set()); setSelAds(new Set()) }
  const clearAds = () => setSelAds(new Set())
  const drillInto = (r: MgrRow) => {
    if (level === "campaign") { setSelCampaigns(new Set([r.id])); setSelAdsets(new Set()); setSelAds(new Set()); setLevel("adset") }
    else if (level === "adset") { setSelAdsets(new Set([r.id])); setSelAds(new Set()); setLevel("ad") }
  }
  const allChecked = levelRows.length > 0 && levelRows.every(r => curSel.has(r.id))
  const nameHdr = level === "campaign" ? "Campaign" : level === "adset" ? "Ad Set" : "Ad"

  // Connected panel tab. The "N selected ✕" badge slot is always reserved (invisible when
  // nothing is selected) so the tab keeps a constant width and the row never shifts/stretches.
  // Tinatawag bilang function sa ibaba, HINDI isinusulat bilang <PanelTab />:
  // ang component na ginagawa sa loob ng render ay bagong uri kada render, kaya
  // binubuwag at muling binubuo ni React ang tatlong tab sa bawat pagpindot.
  const PanelTab = ({ lvl, Icon, title, count, onClear }: { lvl: MgrLevel; Icon: any; title: string; count: number; onClear: () => void }) => (
    <button onClick={() => setLevel(lvl)}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg border-b-2 -mb-px text-sm font-medium whitespace-nowrap ${level === lvl ? "border-blue-600 text-blue-700 bg-white" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
      <Icon className="w-4 h-4 shrink-0" />
      <span>{title}</span>
      <span aria-hidden={count === 0}
        className={`flex items-center gap-1 text-[11px] font-semibold pl-2 pr-1 py-0.5 rounded-full ${count > 0 ? "bg-blue-600 text-white" : "invisible"}`}>
        {count > 0 ? count : 1} selected
        <span role="button" tabIndex={0} title="Clear selection" onClick={e => { e.stopPropagation(); onClear() }}
          className="inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-blue-700"><X className="w-3 h-3" /></span>
      </span>
    </button>
  )

  return (
    <div className="space-y-4 relative">
      {toast && <div className="fixed top-4 right-4 z-50 bg-slate-800 text-white text-sm rounded-xl px-5 py-3 shadow-lg">{toast}</div>}

      {/* Success notification after publishing — shows how many were updated (like Ads Manager) */}
      {publishToast && (
        <div className="fixed bottom-4 right-4 z-[60] bg-emerald-50 border border-emerald-200 rounded-xl shadow-lg px-4 py-3 w-[300px]">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-slate-800 text-sm">{publishToast.label} updated</div>
              <div className="text-sm text-slate-600">{publishToast.count} {publishToast.label.toLowerCase()}{publishToast.count === 1 ? "" : "s"} {publishToast.count === 1 ? "was" : "were"} updated.</div>
              <button onClick={() => setDetailsOpen(true)} className="mt-2 px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-white">View details</button>
            </div>
            <button onClick={() => setPublishToast(null)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {/* View details — recap of the last published changes */}
      {detailsOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setDetailsOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[560px] max-w-[94vw] p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">Publish details</h2>
              <button onClick={() => setDetailsOpen(false)} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"><X className="w-4 h-4" /></button>
            </div>
            <div className="border border-slate-200 rounded-xl overflow-hidden max-h-[50vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50"><tr className="text-left text-slate-500 text-xs"><th className="px-4 py-2 font-semibold">Name</th><th className="px-4 py-2 font-semibold">Change</th></tr></thead>
                <tbody>
                  {lastPublished.map((p, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-4 py-2.5 font-medium text-slate-700 max-w-[280px] truncate" title={p.name}>{p.name}</td>
                      <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{p.change}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end"><button onClick={() => setDetailsOpen(false)} className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50">Close</button></div>
          </div>
        </div>
      )}

      {/* Ad preview — rendered ad (creative/video/caption/headline) per placement, like Ads Manager */}
      {previewAds.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closePreview}>
          <div className="bg-white rounded-2xl shadow-2xl w-[680px] max-w-[94vw] max-h-[92vh] flex flex-col p-6 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">Ad preview</h2>
              <button onClick={closePreview} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Which ad */}
              <select value={previewIdx} onChange={e => setPreviewIdx(Number(e.target.value))} className="h-9 rounded-lg border border-slate-300 px-2.5 text-sm bg-white max-w-[300px]">
                {previewAds.map((a, i) => <option key={a.id} value={i}>{i + 1} of {previewAds.length} ads — {a.name.length > 28 ? a.name.slice(0, 28) + "…" : a.name}</option>)}
              </select>
              {/* Placement format */}
              <div className="flex items-center gap-1">
                {PREVIEW_FORMATS.map(f => (
                  <button key={f.key} onClick={() => setPreviewFmt(f.key)} title={f.label}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border ${previewFmt === f.key ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 min-h-[380px] overflow-auto rounded-xl border border-slate-200 bg-slate-50 flex items-start justify-center p-4">
              {previewLoading ? (
                <div className="self-center text-slate-400 text-sm flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Loading preview…</div>
              ) : previewHtml ? (
                <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
              ) : (
                <div className="self-center text-slate-400 text-sm">Preview not available for this ad/format.</div>
              )}
            </div>
            <p className="text-[11px] text-slate-400">Ad rendering and interaction may vary based on device, format and other factors.</p>
            <div className="flex justify-end"><button onClick={closePreview} className="px-5 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700">OK</button></div>
          </div>
        </div>
      )}

      {/* Discard drafts confirm */}
      {discardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDiscardOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[460px] max-w-[94vw] p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">Discard drafts</h2>
              <button onClick={() => setDiscardOpen(false)} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-sm text-slate-600">{draftCount} queued change{draftCount === 1 ? "" : "s"} that {draftCount === 1 ? "hasn't" : "haven't"} yet been published will be discarded.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDiscardOpen(false)} className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={() => { discardDrafts(); setDiscardOpen(false) }} className="px-5 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700">Discard</button>
            </div>
          </div>
        </div>
      )}

      {/* Review draft items modal — confirm the queued changes, then publish with a progress bar */}
      {reviewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!pubProgress) setReviewOpen(false) }}>
          <div className="bg-white rounded-2xl shadow-2xl w-[600px] max-w-[94vw] p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">Review draft items</h2>
              <button onClick={() => { if (!pubProgress) setReviewOpen(false) }} disabled={!!pubProgress} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40"><X className="w-4 h-4" /></button>
            </div>
            <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 text-sm font-medium px-3 py-1.5 rounded-lg">
              <Layers className="w-4 h-4" /> Draft items <span className="bg-white text-slate-600 text-xs px-1.5 py-0.5 rounded-full">{draftCount}</span>
            </div>
            <div className="border border-slate-200 rounded-xl overflow-hidden max-h-[45vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50"><tr className="text-left text-slate-500 text-xs">
                  <th className="px-4 py-2 font-semibold">Name</th>
                  <th className="px-4 py-2 font-semibold">Change</th>
                  <th className="px-4 py-2 font-semibold">Errors</th>
                </tr></thead>
                <tbody>
                  {Object.values(drafts).map(dr => (
                    <tr key={dr.id} className="border-t border-slate-100">
                      <td className="px-4 py-2.5 font-medium text-slate-700 max-w-[240px] truncate" title={dr.name}>{dr.name}</td>
                      <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{draftChange(dr)}</td>
                      <td className="px-4 py-2.5 text-xs">{draftErrors[dr.id] ? <span className="text-rose-600">{draftErrors[dr.id]}</span> : <span className="text-slate-400">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400">By clicking <strong>Publish</strong>, these changes are applied to your Facebook ad accounts.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setReviewOpen(false)} className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={publishDrafts} className="px-5 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700">Publish</button>
            </div>
          </div>
        </div>
      )}

      {/* Filters — Owner narrows the account list; Account picks which to manage; Objective + Status filter the rows. */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wider text-slate-400">Manage Ad Account</span>
          <select value={accId} onChange={e => setAccId(e.target.value)} className="h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white min-w-[220px]">
            <option value="all">All ad accounts</option>
            {/* Ang ● sa option = kasama sa kasalukuyang round at hindi pa na-check. */}
            {visibleAccounts.map(a => <option key={a.id} value={a.id}>{dueAccountIds.includes(a.id) ? "● " : ""}{a.name}</option>)}
          </select>
        </div>
        <Sel value={fOwner} onChange={setFOwner} opts={["All", ...owners]} label="Owner" />
        <Sel value={objMgr} onChange={v => setObjMgr(v as Obj)} opts={["All", "Conversions", "Messaging"]} label="Objective" />
        <Sel value={fStatus} onChange={setFStatus} opts={["All", "Active", "Paused", "With spend"]} label="Status" />
        {/* MONITORING ROUNDS: ang chip/pindutan ay LILITAW LANG sa iisang
            account na bahagi ng isang round — dito mismo pinapatunayan ng
            partner na binantayan niya ang account na nakabukas sa screen. */}
        {account && (
          <div className="ml-auto flex items-center gap-2 flex-wrap min-w-0">
            {dueAccountIds.length > 0 && (
              <span className="text-[11px] font-semibold text-slate-400 whitespace-nowrap">
                Round: {dueAccountIds.length} left
              </span>
            )}
            <MonitorCheckButton account={account} rounds={rounds} onDone={advanceRound} />
          </div>
        )}
      </div>

      {/* Saan ka galing at ano ang tinitingnan — at paano bumalik sa lahat. */}
      {focusOn && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-[13px] text-blue-800 flex flex-wrap items-center gap-2">
          <Search className="w-4 h-4 shrink-0" />
          <span>
            {focusOn.id
              ? <>Showing one {focusOn.level === "campaign" ? "campaign" : focusOn.level === "adset" ? "ad set" : "ad"}: </>
              : <>Filtered to </>}
            <b className="break-all">{focusOn.name}</b>
            {/* Galing sa Scale: ito ang pang-ilang scale at ang tunay na galaw ng
                budget — kailangan mo iyon habang binubuo ang rule dito. */}
            {focusOn.note && <> — <b className="text-emerald-700">{focusOn.note}</b>. Add your rules on it below.</>}
            {!focusOn.note && focusOn.level === "campaign" && <> — open <b>Ad Sets</b> above to see what&apos;s inside it.</>}
          </span>
          <button onClick={() => setFocusOn(null)}
            className="ml-auto text-[12px] px-2 py-1 rounded-lg border border-blue-300 hover:bg-blue-100 whitespace-nowrap">
            Show all
          </button>
        </div>
      )}

      {mgrAccounts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 py-16 text-center">
          <Settings2 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No connected ad accounts. Register them in <strong>Ad Accounts</strong> first.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          {/* Connected panels: Campaigns · Ad Sets · Ads (selecting upstream filters downstream) */}
          <div className="flex items-center gap-1 px-3 pt-2 border-b border-slate-200 bg-slate-50/50 overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-dark">
            {PanelTab({ lvl: "campaign", Icon: Megaphone, title: "Campaigns", count: selCampaigns.size, onClear: clearCampaigns })}
            {PanelTab({ lvl: "adset", Icon: LayoutGrid, title: selCampaigns.size ? `Ad Sets for ${selCampaigns.size} Campaign${selCampaigns.size > 1 ? "s" : ""}` : "Ad Sets", count: selAdsets.size, onClear: clearAdsets })}
            {PanelTab({ lvl: "ad", Icon: Layers, title: selAdsets.size ? `Ads for ${selAdsets.size} Ad Set${selAdsets.size > 1 ? "s" : ""}` : selCampaigns.size ? `Ads for ${selCampaigns.size} Campaign${selCampaigns.size > 1 ? "s" : ""}` : "Ads", count: selAds.size, onClear: clearAds })}
            <span className="ml-auto pr-2 text-[11px] text-amber-600 whitespace-nowrap">On/Off applies instantly — name and budget edits save as drafts until Publish</span>
          </div>

          {/* Persistent action bar — Turn on/off queue drafts for the selected rows; Publish applies all together */}
          <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200 text-sm">
            <button disabled={curSel.size === 0 || busy === "publish"} onClick={() => bulkSetStatus("ACTIVE")} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-emerald-700 hover:bg-white disabled:opacity-40 disabled:hover:bg-transparent"><Play className="w-3.5 h-3.5" /> Turn on</button>
            <button disabled={curSel.size === 0 || busy === "publish"} onClick={() => bulkSetStatus("PAUSED")} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-amber-700 hover:bg-white disabled:opacity-40 disabled:hover:bg-transparent"><Pause className="w-3.5 h-3.5" /> Turn off</button>
            {level === "ad" && (
              <button disabled={curSel.size === 0} onClick={openPreview} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-blue-700 hover:bg-white disabled:opacity-40 disabled:hover:bg-transparent"><Eye className="w-3.5 h-3.5" /> Preview</button>
            )}
            {/* More ▾ — Automated rules (create / manage), Meta-style dropdown */}
            <div className="relative">
              <button onClick={() => setMoreOpen(o => !o)} className={`flex items-center gap-1 px-2.5 py-1 rounded-md border text-slate-700 ${moreOpen ? "bg-white border-slate-300" : "border-transparent hover:bg-white hover:border-slate-200"}`}>
                More <ChevronDown className="w-3.5 h-3.5" />
              </button>
              {moreOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
                  <div className="absolute left-0 top-full mt-1 z-50 w-60 bg-white border border-slate-200 rounded-lg shadow-xl py-1.5">
                    <div className="px-3.5 py-1.5 text-[13px] font-bold text-slate-900">Automated rules</div>
                    <button onClick={() => { setMoreOpen(false); setRulesView("choose") }} className="w-full text-left px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-100">Create a new rule</button>
                    <button onClick={() => { setMoreOpen(false); setRulesView("apply") }} className="w-full text-left px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-100">Apply an existing rule</button>
                    <button onClick={() => { setMoreOpen(false); setRulesView("manage") }} className="w-full text-left px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center justify-between">Manage rules <ExternalLink className="w-3.5 h-3.5 text-slate-500" /></button>
                  </div>
                </>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              {pubProgress && (
                <div className="flex items-center gap-2 mr-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 whitespace-nowrap">Publishing {Math.min(pubProgress.done + 1, pubProgress.total)} of {pubProgress.total}</span>
                  <div className="w-24 h-1.5 rounded-full bg-slate-200 overflow-hidden"><div className="h-full bg-blue-600 transition-[width] duration-300 ease-out" style={{ width: `${Math.round((pubProgress.done / pubProgress.total) * 100)}%` }} /></div>
                </div>
              )}
              {/* Tunog ng on/off — nakabukas bilang default, pero hindi lahat ay
                  nasa tahimik na kuwarto. Naaalala sa browser na ito. */}
              <button onClick={() => { const n = !sfx; setSfx(n); setSfxOn(n); if (n) playToggle(true) }}
                title={sfx ? "Click sounds are on" : "Click sounds are off"}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-slate-500 hover:bg-white">
                {sfx ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              </button>
              <button disabled={draftCount === 0 || busy === "publish"} onClick={() => setDiscardOpen(true)} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-slate-600 hover:bg-white disabled:opacity-40 disabled:hover:bg-transparent"><Trash2 className="w-3.5 h-3.5" /> Discard drafts</button>
              <button disabled={draftCount === 0 || busy === "publish"} onClick={() => { setDraftErrors({}); setReviewOpen(true) }} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-40"><Check className="w-4 h-4" /> Review and publish{draftCount ? ` (${draftCount})` : ""}</button>
            </div>
          </div>

          {loading ? (
            <div className="py-16 text-center text-slate-400 text-sm"><RefreshCw className="w-5 h-5 animate-spin inline mr-2" /> Loading…</div>
          ) : levelRows.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm">No {nameHdr.toLowerCase()}s match.</div>
          ) : (
            <div className="overflow-x-auto scrollbar-dark max-h-[64vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-30">
                  <tr className="bg-slate-100 border-b border-slate-200 text-left">
                    <th className="px-3 py-2.5 sticky left-0 z-40 bg-slate-100 w-[44px] min-w-[44px] max-w-[44px]"><input type="checkbox" checked={allChecked} onChange={e => toggleAll(e.target.checked)} className="accent-blue-600" /></th>
                    <th className="px-2 py-2.5 font-semibold text-slate-600 sticky left-[43px] z-20 bg-slate-100 border-l border-slate-200 w-[52px] min-w-[52px] max-w-[52px]">
                      <button onClick={() => setSort(s => nextSort(s, "On"))} className="flex items-center gap-1 hover:text-blue-600">On <SortArrow active={sort?.key === "On"} dir={sort?.dir || "desc"} /></button>
                    </th>
                    <th className="px-3 py-2.5 font-semibold text-slate-600 sticky left-[94px] z-20 bg-slate-100 min-w-[168px] sm:min-w-[240px] border-l border-r border-slate-200">
                      <button onClick={() => setSort(s => nextSort(s, "Name"))} className="flex items-center gap-1 hover:text-blue-600">{nameHdr} <SortArrow active={sort?.key === "Name"} dir={sort?.dir || "desc"} /></button>
                    </th>
                    <th className="px-4 py-2.5 font-semibold text-slate-600 border-r border-slate-200">
                      <button onClick={() => setSort(s => nextSort(s, "Status"))} className="flex items-center gap-1 hover:text-blue-600">Status <SortArrow active={sort?.key === "Status"} dir={sort?.dir || "desc"} /></button>
                    </th>
                    {/* Ang buhay ng object — edad, kailan nagsimula, kailan huling
                        ginalaw. Dating nasa DULO ng talahanayan, pagkatapos ng
                        15 metric column: kailangan mong mag-scroll pahalang bago
                        mo pa makita, kaya para na ring wala. Dito, katabi ng
                        pangalan at status, kung saan mo naman talaga sila
                        tinitingnan (hiling ng may-ari, Ago 14 2026). */}
                    {["Age", "Started", "Last edited"].map(h => (
                      <th key={h} className="px-4 py-2.5 font-semibold text-slate-600 whitespace-nowrap border-r border-slate-200">
                        <button onClick={() => setSort(s => nextSort(s, h))} className="flex items-center gap-1 hover:text-blue-600">{h} <SortArrow active={sort?.key === h} dir={sort?.dir || "desc"} /></button>
                      </th>
                    ))}
                    {cols.map(c => (
                      <th key={c.l} className="px-4 py-2.5 font-semibold text-slate-600 whitespace-nowrap text-right min-w-[110px] border-r border-slate-200 last:border-r-0">
                        <button onClick={() => setSort(s => nextSort(s, c.l))} className="flex items-center gap-1 justify-end w-full hover:text-blue-600">{c.l} <SortArrow active={sort?.key === c.l} dir={sort?.dir || "desc"} /></button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((r, i) => {
                    const active = origActive(r)
                    const selected = curSel.has(r.id)
                    const rowBg = selected ? "bg-blue-50" : (i % 2 === 0 ? "bg-white" : "bg-slate-50")
                    // ⚠ WALANG `ring` SA <tr>. Ang table ay `border-collapse`, kaya
                    // ang singsing ay hindi gumuguhit ng kahon sa paligid ng hilera
                    // — ang itaas at ibabang gilid nito ay lumalabas bilang gintong
                    // guhit sa PAGITAN ng mga hilera, at ang kaliwa't kanan ay
                    // natatakpan ng mga sticky na cell (iniulat Ago 17 2026). Ang
                    // marka ay isang gilid sa UNANG CELL — isang kahon lang ang
                    // tinatamaan, kaya walang dumudugo, at pareho ang itsura sa
                    // dalawang tema dahil ang HANGGANAN ang kulay, hindi ang tint.
                    return (
                      <tr key={r.id} className={`group/row border-b border-slate-100 ${rowBg} hover:bg-blue-50/40`}>
                        <td className={`py-3 sticky left-0 z-10 ${rowBg} w-[44px] min-w-[44px] max-w-[44px] ${isPinned(r.id) ? "border-l-[3px] border-l-amber-400 pl-[9px] pr-3" : "px-3"}`}><input type="checkbox" checked={selected} onChange={() => toggleRow(r.id)} className="accent-blue-600" /></td>
                        <td className={`px-2 py-3 sticky left-[43px] z-10 ${rowBg} border-l border-slate-100 w-[52px] min-w-[52px] max-w-[52px]`}>
                          {/* Ang knob ay gumagalaw nang may kaunting lampas (spring
                              curve) at may kislap na singsing pagkatapos ng
                              matagumpay na palit — dating basta nagpapalit lang ng
                              kulay, kaya hindi mo alam kung tumalab ba. */}
                          <button onClick={() => setStatusNow(r, active ? "PAUSED" : "ACTIVE")} disabled={togglingIds.has(r.id)} title={active ? "Turn off" : "Turn on"}
                            className={`relative w-10 h-[22px] rounded-full transition-colors duration-300 active:scale-90 transition-transform
                              ${active ? "bg-emerald-500" : "bg-slate-300"}
                              ${togglingIds.has(r.id) ? "opacity-80 cursor-wait" : ""}
                              ${flashOn[r.id] === "ACTIVE" ? "ring-4 ring-emerald-300/70" : flashOn[r.id] === "PAUSED" ? "ring-4 ring-slate-300/70" : "ring-0 ring-transparent"}
                              ring-offset-0 transition-[box-shadow,background-color,transform] duration-300`}>
                            <span className={`absolute top-[3px] w-4 h-4 bg-white rounded-full shadow-sm flex items-center justify-center
                              transition-[left] duration-300 ease-[cubic-bezier(.34,1.56,.64,1)] ${active ? "left-[21px]" : "left-[3px]"}`}>
                              {togglingIds.has(r.id) && <RefreshCw className="w-3 h-3 animate-spin text-slate-500" />}
                            </span>
                          </button>
                        </td>
                        <td className={`px-3 py-3 sticky left-[94px] z-10 ${rowBg} min-w-[168px] sm:min-w-[260px] border-l border-r border-slate-100`}>
                          <div className="flex items-center gap-2">
                            {level === "ad" && (r.thumbnail
                              ? <img src={r.thumbnail} alt="" loading="lazy" className="w-9 h-9 rounded object-cover border border-slate-200 shrink-0" />
                              : <div className="w-9 h-9 rounded bg-slate-100 border border-slate-200 shrink-0" />)}
                            <div className="min-w-0">
                              {renameId === r.id ? (
                                // Palitan ang pangalan sa mismong hilera. Enter
                                // = ipila bilang draft (hindi agad ipinapadala —
                                // gaya ng budget); Escape = bumalik. Walang modal
                                // para sa isang linyang teksto.
                                <input autoFocus value={renameVal}
                                  onChange={e => setRenameVal(e.target.value)}
                                  onBlur={() => queueRename(r, renameVal)}
                                  onKeyDown={e => {
                                    if (e.key === "Enter") { e.preventDefault(); queueRename(r, renameVal) }
                                    if (e.key === "Escape") { e.preventDefault(); setRenameId("") }
                                  }}
                                  className="w-[130px] sm:w-[220px] h-7 rounded border border-blue-400 px-1.5 text-sm" />
                              ) : (
                                <span className="flex items-center gap-1 min-w-0">
                                  <button onClick={() => level !== "ad" && drillInto(r)} disabled={level === "ad"} title={level === "campaign" ? "View ad sets" : level === "adset" ? "View ads" : effName(r)}
                                    className={`flex items-center gap-1 font-medium text-left max-w-[112px] sm:max-w-[200px] ${level !== "ad" ? "text-blue-600 hover:underline" : "text-slate-800"}`}>
                                    {level !== "ad" && <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
                                    {/* Ang NAKABINBIN ang ipinapakita — kung ang luma
                                        pa rin ang nakikita mo habang may draft, wala
                                        kang makikitang nangyari. */}
                                    <span className={`truncate ${hasNameDraft(r) ? "italic text-amber-700" : ""}`}>{effName(r)}</span>
                                  </button>
                                  {/* Chip na "draft" — kapareho ng ginagawa ng budget:
                                      nakikita mong hindi pa ito totoo sa Facebook. */}
                                  {hasNameDraft(r) && (
                                    <span title={`Draft — was "${r.name}". Publish to apply on Facebook.`}
                                      className="shrink-0 text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded bg-amber-100 text-amber-700">draft</span>
                                  )}
                                  <button onClick={() => { setRenameId(r.id); setRenameVal(effName(r)) }}
                                    title={`Rename this ${level === "campaign" ? "campaign" : level === "adset" ? "ad set" : "ad"} — saves as a draft until Publish`}
                                    className="shrink-0 p-0.5 rounded text-slate-300 hover:text-blue-600 opacity-0 group-hover/row:opacity-100 focus:opacity-100">
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                </span>
                              )}
                              {(isAll || r.bidStrategy) && <div className="text-[10px] text-slate-400 truncate max-w-[130px] sm:max-w-[220px]">{isAll ? r.accountName : r.bidStrategy.replace(/_/g, " ").toLowerCase()}</div>}
                            </div>
                            {/* Usapan ng team sa object na ito — may bilang kapag
                                may laman, para makita agad kung may sinabi na. */}
                            <span className="ml-auto shrink-0 flex items-center">
                              <button onClick={() => setCommentFor(r)} title="Comments — tag a teammate with @"
                                className="flex items-center gap-0.5 px-1.5 py-1 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50">
                                <MessageSquare className="w-3.5 h-3.5" />
                                {(commentCounts[r.id] || 0) > 0 && (
                                  <span className="text-[10px] font-bold text-blue-600">{commentCounts[r.id]}</span>
                                )}
                              </button>
                              {/* Pin — laging nasa itaas ang naka-pin, anuman ang
                                  sort. Lumalabas lang ang buton kapag naka-hover
                                  o naka-pin na, para hindi magkalat ng icon ang
                                  bawat hilera. */}
                              <button onClick={() => togglePin(r.id)}
                                title={isPinned(r.id) ? "Unpin — babalik sa normal na pagkakasunod" : "Pin to top"}
                                className={`px-1.5 py-1 rounded-md ${isPinned(r.id)
                                  ? "text-amber-500 hover:text-amber-600"
                                  : "text-slate-300 hover:text-amber-500 opacity-0 group-hover/row:opacity-100 focus:opacity-100"}`}>
                                <Pin className={`w-3.5 h-3.5 ${isPinned(r.id) ? "fill-current" : ""}`} />
                              </button>
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 border-r border-slate-100">
                          {(() => {
                            const d = deliveryOf(r, level)
                            return (
                              <span title={`Meta status: ${r.status}`
                                + (r.kidsTotal >= 0 ? ` · ${r.kidsOn}/${r.kidsTotal} ${level === "campaign" ? "ad sets" : "ads"} on` : "")
                                + (level === "campaign" && r.kidsLive >= 0 && r.kidsOn > 0 ? ` · ${r.kidsLive} of those ${r.kidsLive === 1 ? "has" : "have"} an ad on` : "")
                                + (r.learning?.status === "LEARNING"
                                  ? (level === "adset"
                                    ? ` · learning: ${r.learning.conversions} of ~50 optimisation events`
                                    : ` · its ad set has ${r.learning.conversions} of ~50 optimisation events`)
                                  : "")
                                + (r.learning?.status === "FAIL" ? " · left learning without enough events — widen the audience, raise the budget, or merge ad sets" : "")
                                + (level === "ad" && r.learning ? " (from its ad set)" : "")
                                // Ang "Scheduled" ay walang saysay kung hindi mo alam kung kailan.
                                + (d.label === "Scheduled" ? ` · starts ${fmtD(r.startTime)}` : "")
                                + (d.label === "Completed" ? ` · ended ${fmtD(r.stopTime)}` : "")
                                + (level === "ad" && (d.label === "Scheduled" || d.label === "Completed") ? " (from its ad set)" : "")}
                                className={`text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${DELIVERY_TONE[d.tone]}`}>
                                {d.label}
                              </span>
                            )
                          })()}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap border-r border-slate-100">
                          {/* ⚠ EDAD NG PAGTAKBO, hindi ng paglikha (hiling ng
                              may-ari, Ago 20 2026): ang ginawa sa ika-20 na
                              naka-schedule sa ika-21 ay Day 1 sa IKA-21. Ang
                              hindi pa nagsisimula ay walang edad — "Not
                              started", hindi "0d old". */}
                          {(() => {
                            const a = runAge(r.startTime, r.createdTime)
                            const tip = `Created ${fmtD(r.createdTime)}` + (r.startTime ? ` · runs from ${fmtD(r.startTime)}` : ` · no schedule — counted from creation`)
                            if (a.anchor === "none") return <span className="text-slate-400 text-xs">—</span>
                            if (!a.started) return <span title={tip} className="text-[11px] font-semibold text-slate-400">Not started</span>
                            return (
                              <span title={tip}
                                className="text-[11px] font-bold bg-[#1B2536] text-[#EFFF00] px-2 py-0.5 rounded-full">
                                Day {a.day}
                              </span>
                            )
                          })()}
                        </td>
                        {/* "Started" = tunay na simula ng takbo; kapag walang
                            schedule, ang paglikha ang pinakamabuting alam. */}
                        <td className="px-4 py-3 whitespace-nowrap text-slate-600 border-r border-slate-100" title={`Created ${fmtD(r.createdTime)}`}>{fmtD(r.startTime || r.createdTime)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-600 border-r border-slate-100">
                          {r.updatedTime
                            ? <span className="inline-flex flex-col">
                                <span>{fmtD(r.updatedTime)}</span>
                                {/* Ang "ilang araw na" ang tunay na tanong dito: kagagalaw
                                    lang ba nito, o hindi na ginagalaw? */}
                                <span className="text-[10px] text-slate-400">{agoOf(r.updatedTime)}</span>
                              </span>
                            : "—"}
                        </td>
                        {cols.map(c => (
                          <td key={c.l} className="px-4 py-3 text-right tabular-nums whitespace-nowrap text-slate-700 border-r border-slate-100">
                            {c.l === "Budget" && level !== "ad" ? (
                              editId === r.id ? (
                                <span className="inline-flex items-center gap-1 justify-end">
                                  <input autoFocus type="text" inputMode="decimal" value={editVal} onChange={e => setEditVal(e.target.value.replace(/[^\d.]/g, ""))}
                                    onKeyDown={e => { if (e.key === "Enter") queueBudget(r, Number(editVal)); if (e.key === "Escape") setEditId("") }}
                                    className="w-20 h-7 text-right border border-blue-400 rounded px-1.5 text-sm tabular-nums" />
                                  <button onClick={() => queueBudget(r, Number(editVal))} className="text-[11px] font-medium text-blue-600 hover:underline" title="Save to draft">Draft</button>
                                  <button onClick={() => publishBudgetNow(r, Number(editVal))} disabled={busy === r.id} className="text-[11px] font-medium text-emerald-600 hover:underline" title="Publish now">Publish</button>
                                  <button onClick={() => setEditId("")} className="text-slate-400 hover:text-slate-600" title="Cancel"><X className="w-4 h-4" /></button>
                                </span>
                              ) : r.ownBudget > 0 || hasBudgetDraft(r) ? (
                                <button onClick={() => startEditBudget(r)} className="inline-flex flex-col items-end hover:text-blue-600 group" title="Click to edit budget (scale)">
                                  <span className={`inline-flex items-center gap-1 ${hasBudgetDraft(r) ? "text-amber-600 font-semibold" : ""}`}>{peso(effBudget(r))} <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-70 shrink-0" /></span>
                                  <span className="text-[10px] text-slate-400 font-normal">{hasBudgetDraft(r) ? "Draft · unpublished" : (r.budgetKind === "lifetime" ? "Lifetime" : "Daily")}</span>
                                </button>
                              ) : (
                                <span className="text-slate-400 text-xs font-normal">{level === "campaign" ? "Using ad set budget" : "Using campaign budget"}</span>
                              )
                            ) : c.l === "ROAS" ? (
                              // ⚠ ANG ROAS ANG PINTUAN — at IISA ang patutunguhan
                              // kada antas, kaya walang tanong: ang campaign ay
                              // dumederetso sa Scaling, ang ad set sa Testing.
                              // Ang dating chooser ay isang pindot na dagdag para
                              // sa sagot na alam na (desisyon ng may-ari, Ago 15).
                              // Ang antas ng AD ay walang tracker, kaya numero
                              // lang ito roon — hindi buton na walang gagawin.
                              level === "ad" ? (
                                <span className={`inline-block px-2 py-0.5 rounded-md font-semibold ${roasBg(r.roas)}`}>{c.f(r)}</span>
                              ) : (
                                <button
                                  onClick={() => onJump(level === "campaign" ? "scaling" : "testing", {
                                    accountName: r.accountName, owner: r.accountOwner || undefined,
                                    objectId: r.id, objectName: r.name,
                                  })}
                                  title={`View in ${level === "campaign" ? "Scaling" : "Testing"} — filtered to ${r.accountName}`}
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold ${roasBg(r.roas)} hover:ring-2 hover:ring-blue-400 transition`}>
                                  {c.f(r)}
                                  <ChevronRight className="w-3 h-3 opacity-50" />
                                </button>
                              )
                            ) : c.f(r)}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="sticky bottom-0 z-10">
                  <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold text-slate-800">
                    <td className="px-3 py-3 sticky left-0 z-10 bg-slate-100 w-[44px] min-w-[44px] max-w-[44px]" />
                    <td className="px-2 py-3 sticky left-[43px] z-10 bg-slate-100 border-l border-slate-200 w-[52px] min-w-[52px] max-w-[52px]" />
                    <td className="px-3 py-3 sticky left-[94px] z-10 bg-slate-100 min-w-[240px] border-l border-r border-slate-200">TOTAL <span className="font-normal text-slate-400">· {displayRows.length} {nameHdr.toLowerCase()}{sortedRows.length === 1 ? "" : "s"}</span></td>
                    <td className="px-4 py-3 border-r border-slate-200" />
                    {/* Status + Age + Started + Last edited — walang kabuuan ang mga ito */}
                    <td className="px-4 py-3 border-r border-slate-200" />
                    <td className="px-4 py-3 border-r border-slate-200" />
                    <td className="px-4 py-3 border-r border-slate-200" />
                    {cols.map(c => (
                      <td key={c.l} className="px-4 py-3 text-right tabular-nums whitespace-nowrap border-r border-slate-200 last:border-r-0">
                        {c.l === "ROAS" ? <span className={`inline-block px-2 py-0.5 rounded-md ${roasBg(mgrTotal.roas)}`}>{c.f(mgrTotal)}</span> : c.f(mgrTotal)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Usapan sa isang object */}
      {commentFor && (
        <CommentsModal objectId={commentFor.id} level={level} name={commentFor.name}
          account={commentFor.accountName} href="/business/ads/facebook"
          accountId={commentFor.accountId} campaignId={commentFor.campaignId || undefined}
          // Nasa Ads Manager ka na kapag bukas ang modal na ito, kaya ang
          // paglundag ay HINDI pag-navigate palabas: isinasara nito ang modal at
          // pinipinto ang tanawin sa mismong object — ad account at hilera —
          // kaya pagsara mo, ito lang ang nakaharap sa iyo.
          onJump={() => {
            setCommentFor(null)
            setAccId(commentFor.accountId || "all")
            setFocusOn({ accountId: commentFor.accountId, level, id: commentFor.id,
              name: commentFor.name, campaignId: commentFor.campaignId || undefined })
          }}
          onClose={() => setCommentFor(null)} onPosted={refreshCounts} />
      )}

      <AutomatedRules accounts={mgrAccounts} currentAccountId={isAll ? "" : accId} level={level}
        selectedRows={levelRows.filter(r => curSel.has(r.id)).map(r => ({ id: r.id, accId: r.accountId }))}
        view={rulesView} setView={setRulesView} notify={flash} from={from} to={to} />
    </div>
  )
}

// ═════════════════ Automated rules — Meta adrules_library, mirrors Ads Manager's "More ▾ → Automated rules" ═════════════════
type RulesView = "" | "choose" | "create" | "apply" | "manage"
type FBRule = { id: string; name: string; status: string; created_time?: string; created_by?: { id?: string; name?: string }; evaluation_spec?: any; execution_spec?: any; schedule_spec?: any; __accId: string; __accName: string }

// Metric filter fields supported by the ad-rules engine. Currency thresholds are sent in centavos (like budgets).
const RULE_METRICS = [
  { l: "Cost per result", f: "cost_per", money: true },
  { l: "Amount spent", f: "spent", money: true },
  { l: "Cost per purchase (CPA)", f: "cpa", money: true },
  { l: "CPM (cost per 1,000 impressions)", f: "cpm", money: true },
  { l: "CPC (cost per link click)", f: "cpc", money: true },
  { l: "CTR (all)", f: "ctr", money: false },
  { l: "Website purchase ROAS", f: "website_purchase_roas", money: false },
  { l: "Frequency", f: "frequency", money: false },
  { l: "Impressions", f: "impressions", money: false },
  { l: "Reach", f: "reach", money: false },
  { l: "Clicks", f: "clicks", money: false },
  { l: "Results", f: "results", money: false },
]
const RULE_OPS = [
  { l: "is greater than", v: "GREATER_THAN" },
  { l: "is smaller than", v: "LESS_THAN" },
  { l: "is between", v: "IN_RANGE" },
  { l: "is not between", v: "NOT_IN_RANGE" },
]
const RULE_TIMES = [
  { l: "37 months (Maximum)", v: "LIFETIME" },
  { l: "Today", v: "TODAY" },
  { l: "Yesterday", v: "YESTERDAY" },
  { l: "Last 3 days", v: "LAST_3_DAYS" },
  { l: "Last 7 days", v: "LAST_7_DAYS" },
  { l: "Last 14 days", v: "LAST_14_DAYS" },
  { l: "Last 30 days", v: "LAST_30_DAYS" },
  { l: "This month", v: "THIS_MONTH" },
]
const ENTITY_WORD: Record<string, [string, string]> = { CAMPAIGN: ["campaign", "campaigns"], ADSET: ["ad set", "ad sets"], AD: ["ad", "ads"] }
const LEVEL_ENTITY: Record<MgrLevel, string> = { campaign: "CAMPAIGN", adset: "ADSET", ad: "AD" }
// Budget actions don't exist at Ad level; campaign budgets use CHANGE_CAMPAIGN_BUDGET.
const ruleActionsFor = (entity: string) => {
  const w = ENTITY_WORD[entity]?.[1] || "campaigns"
  const acts = [
    { v: "PAUSE", l: `Turn off ${w}` },
    { v: "UNPAUSE", l: `Turn on ${w}` },
    { v: "NOTIFY", l: "Send notification only" },
  ]
  if (entity !== "AD") acts.push({ v: "BUDGET_INC", l: "Increase daily budget by" }, { v: "BUDGET_DEC", l: "Decrease daily budget by" })
  return acts
}
const MINS = Array.from({ length: 48 }, (_, i) => i * 30)
const minLabel = (m: number) => {
  const h24 = Math.floor(m / 60), mm = m % 60, h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${String(h12).padStart(2, "0")}:${String(mm).padStart(2, "0")}${h24 < 12 ? "AM" : "PM"}`
}
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"]   // FB days: 0 = Sunday … 6 = Saturday

type RuleCond = { metric: string; op: string; v1: string; v2: string }
const blankCond = (): RuleCond => ({ metric: "cost_per", op: "GREATER_THAN", v1: "", v2: "" })

// Mga object na mapipili sa scope panel ng isang rule (campaign/adset/ad kada
// ad account). Module-level tulad ng iba — ang pagbukas-sara ng listahan ng
// rules ay hindi dapat maghila ulit.
type ScopeObj = { id: string; name: string; status: string }
const RULE_OBJ_CACHE = new Map<string, { ts: number; rows: ScopeObj[] }>()
const RULE_OBJ_TTL = 5 * 60_000

function AutomatedRules({ accounts, currentAccountId, level, selectedRows, view, setView, notify, from, to }: {
  accounts: FBAccount[]; currentAccountId: string; level: MgrLevel; selectedRows: { id: string; accId: string }[]
  view: RulesView; setView: (v: RulesView) => void; notify: (m: string) => void
  from: string; to: string
}) {
  const selectedIds = selectedRows.map(r => r.id)
  // ── Create-form state ──
  const [acctId, setAcctId] = useState("")
  const [ruleName, setRuleName] = useState("")
  const [applyTo, setApplyTo] = useState("CAMPAIGN")   // CAMPAIGN | ADSET | AD | SELECTED (current level's checked rows)
  const [action, setAction] = useState("")
  const [budgetAmt, setBudgetAmt] = useState("")
  const [budgetUnit, setBudgetUnit] = useState<"PERCENTAGE" | "ACCOUNT_CURRENCY">("PERCENTAGE")
  const [budgetCap, setBudgetCap] = useState("")
  const [conds, setConds] = useState<RuleCond[]>([blankCond()])
  const [timeRange, setTimeRange] = useState("LIFETIME")
  const [sched, setSched] = useState<"SEMI_HOURLY" | "DAILY" | "CUSTOM">("SEMI_HOURLY")
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6])
  const [startMin, setStartMin] = useState(0)
  const [endMin, setEndMin] = useState(0)
  const [subscriber, setSubscriber] = useState("")
  const [subInput, setSubInput] = useState("")
  const [attrOpen, setAttrOpen] = useState(-1)         // condition row whose "…" popover is open
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState("")
  // ── Edit: ang parehong form, pero binubuksan nang may laman ────────────────
  // Ang SAKLAW ay HINDI nagbabago sa pag-edit: iniingatan nang buo ang
  // entity_type at ang id filter ng rule. Kung mababago ang "Apply rule to",
  // ang rule na nakatutok sa tatlong napiling campaign ay tahimik na
  // magiging "lahat ng aktibong campaign" — iyon ay pagpapalit ng ibang bagay
  // kaysa sa ini-edit mo. Ang pagpapalit ng saklaw ay Apply-existing o bago.
  const [editing, setEditing] = useState<FBRule | null>(null)
  const [editEntity, setEditEntity] = useState("")          // entity_type ng ini-edit
  const [editIdFilter, setEditIdFilter] = useState<any>(null)   // buong id filter, kopya
  // ── Manage-list state ──
  const [rules, setRules] = useState<FBRule[]>([])
  const [rulesLoading, setRulesLoading] = useState(false)
  const [ruleBusy, setRuleBusy] = useState("")
  const [confirmDel, setConfirmDel] = useState("")
  // ── Apply-existing state ──
  const [applySel, setApplySel] = useState("")
  const [applying, setApplying] = useState(false)
  // Sinong PesoWise user ang huling gumalaw kada rule (galing sa activity log).
  const { byRule: ruleEditors, refresh: refreshRuleEditors } = useRuleEditors()
  // ── Scope panel: alin ang nakatakda sa rule na ito (tulad ng Ads Manager) ──
  const [scopeOpen, setScopeOpen] = useState("")            // rule id na bukas
  const [scopeRows, setScopeRows] = useState<ScopeObj[]>([])
  const [scopeSel, setScopeSel] = useState<Set<string>>(new Set())
  const [scopeQ, setScopeQ] = useState("")
  const [scopeBusy, setScopeBusy] = useState(false)
  const [scopeSaving, setScopeSaving] = useState(false)
  const [scopeErr, setScopeErr] = useState("")

  const acct = accounts.find(a => a.id === acctId) || accounts.find(a => a.id === currentAccountId) || accounts[0] || null
  const entity = editing ? (editEntity || "CAMPAIGN") : (applyTo === "SELECTED" ? LEVEL_ENTITY[level] : applyTo)
  const words = ENTITY_WORD[entity] || ENTITY_WORD.CAMPAIGN
  const post = (body: any) => fetch(`/api/fb/manage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json())

  // Binubuksan ang form na may laman ng umiiral na rule. Ang mga halagang pera
  // ay nasa sentimo sa Meta (tulad ng budget), kaya hinahati sa 100 pabalik.
  function prefillFrom(r: FBRule) {
    const fs: any[] = r.evaluation_spec?.filters || []
    const ent = String(fs.find(f => f.field === "entity_type")?.value || "CAMPAIGN")
    const idF = fs.find(f => /\.id$|^id$/.test(f.field)) || null
    setEditEntity(ent); setEditIdFilter(idF)
    setAcctId(r.__accId)
    setRuleName(r.name || "")
    setApplyTo(ent)
    setTimeRange(String(fs.find(f => f.field === "time_preset")?.value || "LIFETIME"))

    const ex = String(r.execution_spec?.execution_type || "")
    const spec = (r.execution_spec?.execution_options || []).find((o: any) => o.field === "change_spec")?.value
    if (ex === "PAUSE") setAction("PAUSE")
    else if (ex === "UNPAUSE") setAction("UNPAUSE")
    else if (ex === "NOTIFICATION") setAction("NOTIFY")
    else if (/BUDGET/.test(ex)) {
      const amt = Number(spec?.amount ?? 0)
      const unit = spec?.unit === "ACCOUNT_CURRENCY" ? "ACCOUNT_CURRENCY" : "PERCENTAGE"
      setAction(amt < 0 ? "BUDGET_DEC" : "BUDGET_INC")
      setBudgetUnit(unit)
      setBudgetAmt(String(unit === "PERCENTAGE" ? Math.abs(amt) : Math.abs(amt) / 100))
      setBudgetCap(Number(spec?.limit) > 0 ? String(Number(spec.limit) / 100) : "")
    } else setAction("")

    const money = (f: string) => !!RULE_METRICS.find(m => m.f === f)?.money
    const back = (f: string, v: any) => money(f) ? String(Number(v) / 100) : String(v)
    const cs: RuleCond[] = fs
      .filter(f => !["entity_type", "time_preset", "attribution_window"].includes(f.field) && !/\.id$|^id$/.test(f.field))
      .map(f => ({
        metric: f.field, op: f.operator,
        v1: Array.isArray(f.value) ? back(f.field, f.value[0]) : back(f.field, f.value),
        v2: Array.isArray(f.value) ? back(f.field, f.value[1]) : "",
      }))
    setConds(cs.length ? cs : [blankCond()])

    const st = String(r.schedule_spec?.schedule_type || "SEMI_HOURLY")
    setSched(st === "DAILY" ? "DAILY" : st === "CUSTOM" ? "CUSTOM" : "SEMI_HOURLY")
    const win = r.schedule_spec?.schedule?.[0]
    setDays(Array.isArray(win?.days) && win.days.length ? win.days : [0, 1, 2, 3, 4, 5, 6])
    setStartMin(Number(win?.start_minute) || 0)
    setEndMin(Number(win?.end_minute) || 0)
    setErr(""); setAttrOpen(-1); setSubInput("")
  }

  // Fresh form on every open; preselect the checked rows when there are any (like Meta).
  // ⚠ Kapag EDIT ang pagbukas, ang laman ang inilalagay — hindi blangko. Ang
  // `editing` ay naitakda na sa parehong batch ng `setView("create")`, kaya
  // nakikita ito ng effect na ito.
  useEffect(() => {
    if (view !== "create") return
    if (editing) { prefillFrom(editing); return }
    setEditEntity(""); setEditIdFilter(null)
    setAcctId(currentAccountId || accounts[0]?.id || "")
    setRuleName(""); setApplyTo(selectedIds.length ? "SELECTED" : LEVEL_ENTITY[level]); setAction("")
    setBudgetAmt(""); setBudgetUnit("PERCENTAGE"); setBudgetCap("")
    setConds([blankCond()]); setTimeRange("LIFETIME"); setSched("SEMI_HOURLY")
    setDays([0, 1, 2, 3, 4, 5, 6]); setStartMin(0); setEndMin(0)
    setErr(""); setAttrOpen(-1); setSubInput("")
  }, [view])   // eslint-disable-line react-hooks/exhaustive-deps
  // ⚠ Ang pag-alis sa form ay nagtatapos ng pag-edit. Kung hindi, ang susunod
  // na "Create a new rule" ay bubukas na may laman ng huling ini-edit — at ang
  // Save ay ita-target pa rin ang LUMANG rule id. Bagong gawa iyon na papatong
  // sa iba.
  useEffect(() => { if (view !== "create") setEditing(null) }, [view])
  // Subscriber = token owner's user id (who gets the Facebook notification).
  useEffect(() => {
    if (view !== "create" || !acct?.token) return
    let alive = true
    post({ token: acct.token, action: "me" }).then(j => { if (alive && j.success) setSubscriber(j.id) }).catch(() => {})
    return () => { alive = false }
  }, [view, acct?.token])   // eslint-disable-line react-hooks/exhaustive-deps

  const loadRules = useCallback(async () => {
    const accts = currentAccountId ? accounts.filter(a => a.id === currentAccountId) : accounts
    setRulesLoading(true)
    const out: FBRule[] = []
    await mapLimit(accts, 3, async (a: FBAccount) => {
      try {
        const j = await post({ token: a.token, action: "rules_list", account_id: actId(a.ad_account_id) })
        if (j.success) for (const r of j.rules) out.push({ ...r, __accId: a.id, __accName: a.name })
      } catch {}
    })
    out.sort((a, b) => (b.created_time || "").localeCompare(a.created_time || ""))
    setRules(out); setRulesLoading(false)
  }, [accounts, currentAccountId])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (view === "manage" || view === "apply") { setConfirmDel(""); setApplySel(""); setErr(""); loadRules(); refreshRuleEditors() } }, [view, loadRules, refreshRuleEditors])

  const setCond = (i: number, patch: Partial<RuleCond>) => setConds(cs => cs.map((c, x) => x === i ? { ...c, ...patch } : c))
  const condComplete = (c: RuleCond) => c.v1 !== "" && (!/RANGE/.test(c.op) || c.v2 !== "")
  const needsBudget = action === "BUDGET_INC" || action === "BUDGET_DEC"
  // Hindi na humaharang ang blangkong condition sa Create — sinasala na lang sila sa
  // payload sa ibaba, kaya pwedeng gumawa ng rule kahit walang nakalagay na metric value.
  const canCreate = !!acct && ruleName.trim() !== "" && action !== "" && (!needsBudget || Number(budgetAmt) > 0) && !saving

  async function createRule() {
    if (!canCreate || !acct) return
    setSaving(true); setErr("")
    const condVal = (c: RuleCond) => {
      const mult = RULE_METRICS.find(m => m.f === c.metric)?.money ? 100 : 1
      return /RANGE/.test(c.op) ? [Number(c.v1) * mult, Number(c.v2) * mult] : Number(c.v1) * mult
    }
    const filters: any[] = [
      { field: "entity_type", value: entity, operator: "EQUAL" },
      { field: "time_preset", value: timeRange, operator: "EQUAL" },
      // Sa pag-edit ay ang ORIHINAL na id filter ang ibinabalik nang buo — hindi
      // ang kasalukuyang naka-tsek sa manager. Ang rule na nakatutok sa tatlong
      // campaign ay dapat manatiling nakatutok sa parehong tatlo pagkatapos
      // mong palitan ang pangalan nito.
      ...(editing
        ? (editIdFilter ? [editIdFilter] : [])
        : applyTo === "SELECTED" ? [{ field: `${entity.toLowerCase()}.id`, value: selectedIds, operator: "IN" }] : []),
      // Ang mga blangko ay ITINATAPON, hindi ipinapadala bilang "> 0" — kung wala kang
      // nilagay na value, walang metric condition na isasama sa rule.
      ...conds.filter(condComplete).map(c => ({ field: c.metric, value: condVal(c), operator: c.op })),
    ]
    const sign = action === "BUDGET_INC" ? 1 : -1
    const execution_spec: any =
      action === "PAUSE" ? { execution_type: "PAUSE" } :
      action === "UNPAUSE" ? { execution_type: "UNPAUSE" } :
      action === "NOTIFY" ? { execution_type: "NOTIFICATION", ...(subscriber ? { execution_options: [{ field: "user_ids", value: [subscriber], operator: "IN" }] } : {}) } :
      {
        execution_type: entity === "CAMPAIGN" ? "CHANGE_CAMPAIGN_BUDGET" : "CHANGE_BUDGET",
        execution_options: [{
          field: "change_spec",
          value: {
            amount: budgetUnit === "PERCENTAGE" ? sign * Number(budgetAmt) : sign * Math.round(Number(budgetAmt) * 100),
            unit: budgetUnit,
            ...(Number(budgetCap) > 0 ? { limit: Math.round(Number(budgetCap) * 100) } : {}),
          },
          operator: "EQUAL",
        }],
      }
    const schedule_spec = sched === "CUSTOM"
      ? { schedule_type: "CUSTOM", schedule: [{ start_minute: startMin, end_minute: endMin, days }] }
      : { schedule_type: sched }
    const rule = { name: ruleName.trim(), evaluation_spec: { evaluation_type: "SCHEDULE", filters }, execution_spec, schedule_spec }
    // ⚠ Ang token ng SARILING ad account ng rule ang ginagamit sa pag-update,
    // hindi ang napili sa dropdown: ang `acct` ay bumabagsak sa accounts[0]
    // kapag hindi nahanap, at ang pag-post gamit ang maling token ay tatanggihan
    // ni Meta o — mas masahol — tatama sa ibang account.
    const editToken = editing ? (accounts.find(a => a.id === editing.__accId)?.token || "") : ""
    if (editing && !editToken) {
      setErr("No token for the ad account that owns this rule — open it from that account.")
      setSaving(false); return
    }
    try {
      const j = editing
        ? await post({ token: editToken, action: "rule_update", id: editing.id, rule })
        : await post({ token: acct.token, action: "rule_create", account_id: actId(acct.ad_account_id), rule: { ...rule, status: "ENABLED" } })
      if (!j.success) throw new Error(j.error || "Failed")
      logAds({ action: editing ? "rule_update" : "rule_create", level: "rule",
        objectId: editing ? editing.id : String(j.id || ""), objectName: ruleName.trim(),
        accountName: editing ? editing.__accName : (acct?.name || ""), surface: "rules",
        summary: `${ruleActionsFor(entity).find(a => a.v === action)?.l || action}${needsBudget ? ` ${budgetAmt}${budgetUnit === "PERCENTAGE" ? "%" : ""}` : ""} · ${sched.toLowerCase()}`,
        details: { action, budgetAmt, budgetUnit, budgetCap, timeRange, sched, conditions: conds.filter(condComplete) } })
      if (editing) {
        // Balik sa listahan at hilahin muli — ang ipinapakita ay ang sagot ni
        // Meta, hindi ang inakala nating naipadala.
        const name = ruleName.trim()
        setEditing(null); setView("manage")
        notify(`Rule "${name}" updated.`)
      } else {
        setView(""); notify(`Rule "${ruleName.trim()}" created — it now runs on Facebook.`)
      }
    } catch (e: any) { setErr(e?.message || `Failed to ${editing ? "update" : "create"} the rule`) }
    setSaving(false)
  }

  async function mutateRule(r: FBRule, act: "rule_status" | "rule_delete", status?: string) {
    const token = accounts.find(a => a.id === r.__accId)?.token || ""
    if (!token) return
    setRuleBusy(r.id)
    try {
      const j = await post({ token, action: act, id: r.id, status })
      if (!j.success) throw new Error(j.error || "Failed")
      logAds({ action: act === "rule_delete" ? "rule_delete" : "rule_status", level: "rule",
        objectId: r.id, objectName: r.name, accountName: r.__accName, surface: "rules",
        summary: act === "rule_delete" ? "Deleted" : status === "ENABLED" ? "Enabled" : "Disabled" })
      if (act === "rule_delete") { setRules(rs => rs.filter(x => x.id !== r.id)); notify("Rule deleted.") }
      else setRules(rs => rs.map(x => x.id === r.id ? { ...x, status: status! } : x))
    } catch (e: any) { notify("⚠ " + (e?.message || "Failed")) }
    setRuleBusy(""); setConfirmDel("")
  }

  // Apply an existing rule to the checked rows: merge their ids into the rule's <entity>.id scope filter.
  // Only ids from the rule's OWN ad account can be added (FB rules are per-account).
  const entityOfRule = (r: FBRule) => String((r.evaluation_spec?.filters || []).find((f: any) => f.field === "entity_type")?.value || "")
  /** Ang mga id na SAKOP ng rule ngayon. Blangko = buong ad account. */
  const scopedIdsOf = (r: FBRule): string[] => {
    const f = (r.evaluation_spec?.filters || []).find((x: any) => x.field === "id" || /\.id$/.test(x.field))
    if (!f) return []
    return (Array.isArray(f.value) ? f.value : [f.value]).map(String)
  }
  const applicableIds = (r: FBRule) => selectedRows.filter(sr => sr.accId === r.__accId).map(sr => sr.id)
  const ruleHasIdScope = (r: FBRule) => (r.evaluation_spec?.filters || []).some((f: any) => f.field === "id" || /\.id$/.test(f.field))
  async function applyRule() {
    const r = rules.find(x => x.id === applySel)
    if (!r || applying) return
    const token = accounts.find(a => a.id === r.__accId)?.token || ""
    const ids = applicableIds(r)
    if (!token || ids.length === 0) return
    setApplying(true); setErr("")
    const ent = LEVEL_ENTITY[level]
    const idField = `${ent.toLowerCase()}.id`
    const fs: any[] = JSON.parse(JSON.stringify(r.evaluation_spec?.filters || []))
    const idF = fs.find(f => f.field === idField || f.field === "id")
    if (idF) { idF.value = Array.from(new Set([...(Array.isArray(idF.value) ? idF.value : [idF.value]).map(String), ...ids])); idF.operator = "IN" }
    else fs.push({ field: idField, value: ids, operator: "IN" })
    try {
      const j = await post({ token, action: "rule_update", id: r.id, rule: { evaluation_spec: { ...(r.evaluation_spec || {}), evaluation_type: r.evaluation_spec?.evaluation_type || "SCHEDULE", filters: fs } } })
      if (!j.success) throw new Error(j.error || "Failed")
      logAds({ action: "rule_scope", level: "rule", objectId: r.id, objectName: r.name,
        accountName: r.__accName, surface: "rules",
        summary: `Applied to ${ids.length} more ${ENTITY_WORD[ent][ids.length === 1 ? 0 : 1]}`,
        details: { added: ids } })
      setView("")
      notify(`Rule "${r.name}" applied to ${ids.length} ${ENTITY_WORD[ent][ids.length === 1 ? 0 : 1]}.`)
    } catch (e: any) { setErr(e?.message || "Failed to apply the rule") }
    setApplying(false)
  }

  // ── Scope panel ────────────────────────────────────────────────────────────
  // Ang hinihiling: pindutin ang rule, makita kung ANO ang naka-set dito — naka-
  // check — at mabago iyon. Ang mga naka-check ay ang id filter ng rule; ang mga
  // hindi ay ang natitirang object ng parehong antas sa parehong ad account.
  async function toggleScope(r: FBRule) {
    if (scopeOpen === r.id) { setScopeOpen(""); return }
    const ent = entityOfRule(r) || "CAMPAIGN"
    const lvl = ent === "ADSET" ? "adset" : ent === "AD" ? "ad" : "campaign"
    const a = accounts.find(x => x.id === r.__accId)
    setScopeOpen(r.id); setScopeQ(""); setScopeErr("")
    setScopeSel(new Set(scopedIdsOf(r)))
    if (!a) { setScopeRows([]); setScopeErr("This rule's ad account isn't connected here."); return }

    const key = `${a.id}|${lvl}`
    const hit = RULE_OBJ_CACHE.get(key)
    if (hit && Date.now() - hit.ts < RULE_OBJ_TTL) { setScopeRows(hit.rows); return }
    setScopeRows([]); setScopeBusy(true)
    try {
      const acct = actId(a.ad_account_id)
      const j = await fetch(`/api/fb/insights?rich=1&level=${lvl}&parent=${encodeURIComponent(acct)}`
        + `&token=${encodeURIComponent(a.token)}&account_id=${encodeURIComponent(acct)}&from=${from}&to=${to}`).then(x => x.json())
      if (!j.success) throw new Error(j.error || "Failed to load")
      const rows: ScopeObj[] = (j.rows || []).map((x: any) => ({ id: String(x.id), name: x.name || x.id, status: x.status || "—" }))
        .sort((x: ScopeObj, y: ScopeObj) => x.name.localeCompare(y.name))
      RULE_OBJ_CACHE.set(key, { ts: Date.now(), rows })
      setScopeRows(rows)
    } catch (e: any) { setScopeErr(e?.message || "Failed to load") }
    setScopeBusy(false)
  }

  /** Isinusulat ang bagong saklaw sa rule. `null` = alisin ang id filter (buong account). */
  async function saveScope(r: FBRule, ids: string[] | null) {
    const token = accounts.find(a => a.id === r.__accId)?.token || ""
    if (!token) { setScopeErr("No token for this rule's ad account."); return }
    const ent = entityOfRule(r) || "CAMPAIGN"
    const idField = `${ent.toLowerCase()}.id`
    // Kopya — huwag baguhin ang nasa listahan bago pa sumagot si Meta.
    const fs: any[] = JSON.parse(JSON.stringify(r.evaluation_spec?.filters || []))
    const rest = fs.filter(f => f.field !== "id" && !/\.id$/.test(f.field))
    const next = ids === null ? rest : [...rest, { field: idField, value: ids, operator: "IN" }]
    setScopeSaving(true); setScopeErr("")
    try {
      const j = await post({
        token, action: "rule_update", id: r.id,
        rule: { evaluation_spec: { ...(r.evaluation_spec || {}), evaluation_type: r.evaluation_spec?.evaluation_type || "SCHEDULE", filters: next } },
      })
      if (!j.success) throw new Error(j.error || "Failed")
      // Sa listahan din isinusulat para hindi na kailangang mag-refresh nang buo.
      setRules(rs => rs.map(x => x.id === r.id
        ? { ...x, evaluation_spec: { ...(x.evaluation_spec || {}), filters: next } } : x))
      const w = ENTITY_WORD[ent] || ENTITY_WORD.CAMPAIGN
      logAds({ action: "rule_scope", level: "rule", objectId: r.id, objectName: r.name,
        accountName: r.__accName, surface: "rules",
        summary: ids === null ? `Now runs on all active ${w[1]}` : `Set on ${ids.length} ${w[ids.length === 1 ? 0 : 1]}`,
        details: { from: scopedIdsOf(r), to: ids } })
      notify(ids === null
        ? `"${r.name}" now applies to all active ${w[1]}.`
        : `"${r.name}" is now set on ${ids.length} ${w[ids.length === 1 ? 0 : 1]}.`)
      setScopeOpen("")
    } catch (e: any) { setScopeErr(e?.message || "Failed to save") }
    setScopeSaving(false)
  }

  // Human-readable summary of a fetched rule (manage list).
  const humanRule = (r: FBRule) => {
    const fs: any[] = r.evaluation_spec?.filters || []
    const fmtVal = (f: string, v: any) => {
      const money = RULE_METRICS.find(x => x.f === f)?.money
      const one = (n: any) => money ? peso(Number(n) / 100) : String(n)
      return Array.isArray(v) ? v.map(one).join(" – ") : one(v)
    }
    const ent = String(fs.find(f => f.field === "entity_type")?.value || "")
    const time = RULE_TIMES.find(t => t.v === fs.find(f => f.field === "time_preset")?.value)?.l || ""
    const condL = fs.filter(f => !["entity_type", "time_preset", "attribution_window"].includes(f.field) && !/\.id$|^id$/.test(f.field))
      .map(f => `${RULE_METRICS.find(m => m.f === f.field)?.l || f.field} ${(RULE_OPS.find(o => o.v === f.operator)?.l || f.operator).replace(/^is /, "")} ${fmtVal(f.field, f.value)}`)
    const ex = String(r.execution_spec?.execution_type || "")
    const actionL = ex === "PAUSE" ? "Turn off" : ex === "UNPAUSE" ? "Turn on" : ex === "NOTIFICATION" ? "Notification only" : /BUDGET/.test(ex) ? "Adjust budget" : ex
    const st = String(r.schedule_spec?.schedule_type || "")
    const schedL = st === "SEMI_HOURLY" ? "Continuously" : st === "DAILY" ? "Daily" : st === "CUSTOM" ? "Custom" : st
    return { ent, time, condL, actionL, schedL }
  }

  const inputCls = "h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm w-full"
  const lbl = (t: string, info = true) => (
    <div className="flex items-center gap-1 text-[13px] font-bold text-slate-900 mb-1.5">{t} {info && <Info className="w-3.5 h-3.5 text-slate-400" />}</div>
  )

  return (
    <>
      {/* ── Step 1: Create rule chooser (auto-apply card + Custom rule) ── */}
      {view === "choose" && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setView("")}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Create rule</h2>
              <button onClick={() => setView("")} className="p-1.5 rounded-lg border border-slate-300 hover:bg-slate-50"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="rounded-xl border border-slate-200 p-4 flex gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center shrink-0"><Send className="w-5 h-5 text-white" /></div>
                <div>
                  <div className="font-bold text-slate-900 text-[15px]">Rules for recommendations are now auto-apply</div>
                  <div className="text-sm text-slate-600 mt-0.5">Manage auto-apply selections you've already set up or create new ones.</div>
                  <button onClick={() => window.open("https://adsmanager.facebook.com/adsmanager/manage/rules", "_blank")} className="mt-3 px-3.5 py-1.5 rounded-lg border border-slate-300 text-sm font-semibold text-slate-800 hover:bg-slate-50">Manage auto-apply</button>
                </div>
              </div>
              <button onClick={() => setView("create")} className="w-full rounded-xl border-2 border-blue-500 ring-2 ring-blue-100 p-4 flex items-center gap-3 text-left hover:bg-blue-50/30">
                <div className="w-10 h-10 rounded bg-slate-100 flex items-center justify-center shrink-0"><Wrench className="w-5 h-5 text-slate-600" /></div>
                <div className="flex-1">
                  <div className="font-bold text-slate-900 text-[15px]">Custom rule</div>
                  <div className="text-sm text-slate-600">Create your own rule by choosing its conditions.</div>
                </div>
                <span className="w-5 h-5 rounded-full border-[6px] border-blue-600 bg-white shrink-0" />
              </button>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-200">
              <button onClick={() => setView("")} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-800 font-semibold hover:bg-slate-50">Close</button>
              <button onClick={() => setView("create")} className="px-5 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700">Next</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 2: Create a custom rule (full Meta-style form) ── */}
      {view === "create" && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">{editing ? "Edit rule" : "Create a custom rule"}</h2>
              <button onClick={() => { setEditing(null); setView(editing ? "manage" : "") }} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              <p className="text-sm text-slate-600">
                {editing
                  ? <>Changing this rule updates it on Facebook — it keeps running under the same name and schedule you set here.</>
                  : <>Automatically update the settings of selected campaigns, ad sets or ads by creating a rule.</>}{" "}
                <a href="https://www.facebook.com/business/help/1029841767742843" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Learn more</a>
              </p>
              {editing && (
                <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <b>What this rule applies to can&apos;t be changed here</b> — it stays on{" "}
                  {editIdFilter
                    ? <>the {Array.isArray(editIdFilter.value) ? editIdFilter.value.length : 1} {ENTITY_WORD[entity]?.[Array.isArray(editIdFilter.value) && editIdFilter.value.length === 1 ? 0 : 1] || "objects"} it was built for</>
                    : <>all active {ENTITY_WORD[entity]?.[1] || "campaigns"}</>}.
                  To point a rule at something else, use <b>Apply existing rule</b> or make a new one.
                </p>
              )}

              {accounts.length > 1 && (
                <div>
                  {lbl("Ad account", false)}
                  <select value={acct?.id || ""} onChange={e => setAcctId(e.target.value)} className={inputCls}>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}

              <div>
                {lbl("Rule name", false)}
                <input value={ruleName} onChange={e => setRuleName(e.target.value)} placeholder="Rule name" className={inputCls} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  {lbl("Apply rule to", false)}
                  <select value={applyTo} disabled={!!editing}
                    onChange={e => { const v = e.target.value; setApplyTo(v); const ent = v === "SELECTED" ? LEVEL_ENTITY[level] : v; setAction(a => ruleActionsFor(ent).some(x => x.v === a) ? a : "") }}
                    className={`${inputCls} disabled:bg-slate-100 disabled:text-slate-500`}>
                    {selectedIds.length > 0 && !editing && <option value="SELECTED">{selectedIds.length} selected {ENTITY_WORD[LEVEL_ENTITY[level]][selectedIds.length === 1 ? 0 : 1]}</option>}
                    <option value="CAMPAIGN">All active campaigns</option>
                    <option value="ADSET">All active ad sets</option>
                    <option value="AD">All active ads</option>
                  </select>
                </div>
                <div>
                  {lbl("Action", false)}
                  <select value={action} onChange={e => setAction(e.target.value)} className={inputCls}>
                    <option value="">Select an option</option>
                    {ruleActionsFor(entity).map(a => <option key={a.v} value={a.v}>{a.l}</option>)}
                  </select>
                </div>
              </div>

              {needsBudget && (
                <div className="grid grid-cols-3 gap-3 -mt-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-600 mb-1">{action === "BUDGET_INC" ? "Increase" : "Decrease"} by</div>
                    <div className="relative">
                      {budgetUnit === "ACCOUNT_CURRENCY" && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>}
                      <input value={budgetAmt} onChange={e => setBudgetAmt(e.target.value.replace(/[^\d.]/g, ""))} className={`${inputCls} ${budgetUnit === "ACCOUNT_CURRENCY" ? "pl-7" : ""}`} />
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-600 mb-1">Unit</div>
                    <select value={budgetUnit} onChange={e => setBudgetUnit(e.target.value as any)} className={inputCls}>
                      <option value="PERCENTAGE">Percent (%)</option>
                      <option value="ACCOUNT_CURRENCY">Amount (₱)</option>
                    </select>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-600 mb-1">{action === "BUDGET_INC" ? "Maximum" : "Minimum"} budget cap (₱, optional)</div>
                    <input value={budgetCap} onChange={e => setBudgetCap(e.target.value.replace(/[^\d.]/g, ""))} className={inputCls} />
                  </div>
                </div>
              )}

              <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700">
                <Info className="w-4 h-4 mt-0.5 shrink-0 text-slate-500" />
                {applyTo === "SELECTED"
                  ? <span>Your rule will apply to the {selectedIds.length} selected {ENTITY_WORD[LEVEL_ENTITY[level]][selectedIds.length === 1 ? 0 : 1]}.</span>
                  : <span>Your rule will apply to {words[1]} that are active at the time the rule runs.</span>}
              </div>

              <div>
                {lbl("Conditions")}
                <p className="text-xs text-slate-500 -mt-1 mb-2">All of the following match. Note that some Ad Metrics can be delayed and would fluctuate for hours. Consider adding some buffers to your metric-based conditions to help avoid false positives.</p>
                <div className="space-y-2">
                  {conds.map((c, i) => {
                    const m = RULE_METRICS.find(x => x.f === c.metric)
                    const range = /RANGE/.test(c.op)
                    return (
                      <div key={i} className="bg-slate-100 rounded-lg p-2 flex items-center gap-2 flex-wrap">
                        <select value={c.metric} onChange={e => setCond(i, { metric: e.target.value })} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm flex-1 min-w-[150px]">
                          {RULE_METRICS.map(mm => <option key={mm.f} value={mm.f}>{mm.l}</option>)}
                        </select>
                        <select value={c.op} onChange={e => setCond(i, { op: e.target.value })} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm w-[136px]">
                          {RULE_OPS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                        </select>
                        <div className="relative">
                          {m?.money && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>}
                          <input value={c.v1} onChange={e => setCond(i, { v1: e.target.value.replace(/[^\d.]/g, "") })} className={`h-9 w-[88px] rounded-lg border border-slate-300 bg-white text-sm ${m?.money ? "pl-6 pr-2" : "px-2"}`} />
                        </div>
                        {range && (
                          <>
                            <span className="text-slate-500 text-sm">and</span>
                            <div className="relative">
                              {m?.money && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>}
                              <input value={c.v2} onChange={e => setCond(i, { v2: e.target.value.replace(/[^\d.]/g, "") })} className={`h-9 w-[88px] rounded-lg border border-slate-300 bg-white text-sm ${m?.money ? "pl-6 pr-2" : "px-2"}`} />
                            </div>
                          </>
                        )}
                        <div className="relative">
                          <button onClick={() => setAttrOpen(attrOpen === i ? -1 : i)} className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50" title="More options"><MoreHorizontal className="w-4 h-4 text-slate-600" /></button>
                          {attrOpen === i && (
                            <div className="absolute right-0 top-full mt-1 z-10 w-64 bg-white border border-slate-200 rounded-lg shadow-xl p-3 text-xs text-slate-600">
                              <div className="font-semibold text-slate-800 mb-1">Attribution window</div>
                              Account default (7-day click / 1-day view) is used when this condition is evaluated.
                            </div>
                          )}
                        </div>
                        <button onClick={() => setConds(cs => [...cs, blankCond()])} disabled={!condComplete(c)} className="h-9 px-3.5 rounded-lg bg-emerald-100 text-emerald-700 text-sm font-semibold hover:bg-emerald-200 disabled:opacity-50">Add</button>
                        <button onClick={() => setConds(cs => cs.length > 1 ? cs.filter((_, x) => x !== i) : cs.map((cc, x) => x === i ? blankCond() : cc))} className="h-9 px-2 rounded-lg text-slate-500 hover:bg-slate-200" title="Remove condition"><X className="w-4 h-4" /></button>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div>
                {lbl("Time range")}
                <select value={timeRange} onChange={e => setTimeRange(e.target.value)} className={inputCls}>
                  {RULE_TIMES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
                </select>
              </div>

              <div>
                {lbl("Schedule")}
                <div className="space-y-2.5">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input type="radio" checked={sched === "SEMI_HOURLY"} onChange={() => setSched("SEMI_HOURLY")} className="mt-1 accent-blue-600" />
                    <span className="text-sm"><span className="font-semibold text-slate-900">Continuously</span><br />
                      <span className="text-slate-500 text-[13px]">Rule runs as often as possible (usually every 30-60 minutes). Note: When using the "Current time" condition, the system handles time variations by allowing execution slightly before or after the specified time window.</span></span>
                  </label>
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input type="radio" checked={sched === "DAILY"} onChange={() => setSched("DAILY")} className="mt-1 accent-blue-600" />
                    <span className="text-sm"><span className="font-semibold text-slate-900">Daily</span><br />
                      <span className="text-slate-500 text-[13px]">between 12:00AM and 01:00AM Manila Time</span></span>
                  </label>
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input type="radio" checked={sched === "CUSTOM"} onChange={() => setSched("CUSTOM")} className="mt-1 accent-blue-600" />
                    <span className="text-sm"><span className="font-semibold text-slate-900">Custom</span><br />
                      <span className="text-slate-500 text-[13px]">Adjust rule schedule to run on specific days and specific times of the day. If start and end time are the same then the rule will run once per day within 30-60 minutes after the set time. All times are in <strong>Manila Time</strong></span></span>
                  </label>
                  {sched === "CUSTOM" && (
                    <div className="ml-6 mt-1 space-y-3">
                      <div className="flex gap-1.5">
                        {DAY_LETTERS.map((d, i) => (
                          <button key={i} onClick={() => setDays(ds => ds.includes(i) ? ds.filter(x => x !== i) : [...ds, i].sort())}
                            className={`w-8 h-8 rounded-full text-xs font-bold ${days.includes(i) ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>{d}</button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <select value={startMin} onChange={e => setStartMin(Number(e.target.value))} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm">
                          {MINS.map(mn => <option key={mn} value={mn}>{minLabel(mn)}</option>)}
                        </select>
                        <span className="text-slate-500">to</span>
                        <select value={endMin} onChange={e => setEndMin(Number(e.target.value))} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm">
                          {MINS.map(mn => <option key={mn} value={mn}>{minLabel(mn)}</option>)}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div>
                {lbl("Notification")}
                <label className="flex items-start gap-2.5">
                  <input type="checkbox" checked disabled className="mt-1 accent-slate-400" />
                  <span className="text-sm"><span className="font-semibold text-slate-700">On Facebook</span><br />
                    <span className="text-slate-500 text-[13px]">You'll receive a notification when conditions for this rule have been met.</span></span>
                </label>
              </div>

              <div>
                {lbl("Subscriber")}
                <div className="flex items-center gap-2 min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 flex-wrap">
                  <Search className="w-4 h-4 text-slate-400 shrink-0" />
                  {subscriber ? (
                    <span className="inline-flex items-center gap-1.5 bg-slate-100 rounded-md px-2 py-1 text-sm text-slate-700">
                      {subscriber}
                      <button onClick={() => setSubscriber("")} className="text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>
                    </span>
                  ) : (
                    <input value={subInput} onChange={e => setSubInput(e.target.value.replace(/\D/g, ""))}
                      onKeyDown={e => { if (e.key === "Enter" && subInput) { setSubscriber(subInput); setSubInput("") } }}
                      onBlur={() => { if (subInput) { setSubscriber(subInput); setSubInput("") } }}
                      placeholder="Facebook user ID" className="flex-1 text-sm outline-none min-w-[120px]" />
                  )}
                </div>
              </div>

              {err && <p className="text-sm text-rose-600">⚠ {err}</p>}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-200">
              <button onClick={() => { setEditing(null); setView(editing ? "manage" : "") }} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-800 font-semibold hover:bg-slate-50">Cancel</button>
              <button onClick={createRule} disabled={!canCreate} className="px-5 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-40">
                {saving ? (editing ? "Saving…" : "Creating…") : (editing ? "Save changes" : "Create")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Apply an existing rule to the checked rows (adds them to the rule's scope) ── */}
      {view === "apply" && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Apply an existing rule</h2>
              <button onClick={() => setView("")} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {selectedRows.length === 0 ? (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
                  <Info className="w-4 h-4 mt-0.5 shrink-0" />
                  Select at least one {ENTITY_WORD[LEVEL_ENTITY[level]][0]} in the table first, then apply a rule to it.
                </div>
              ) : (
                <p className="text-sm text-slate-600">Apply a rule to the <strong>{selectedRows.length} selected {ENTITY_WORD[LEVEL_ENTITY[level]][selectedRows.length === 1 ? 0 : 1]}</strong>. They'll be added to the rule's scope on Facebook.</p>
              )}
              {rulesLoading ? (
                <div className="py-10 text-center text-slate-400 text-sm"><RefreshCw className="w-5 h-5 animate-spin inline mr-2" /> Loading rules…</div>
              ) : rules.length === 0 ? (
                <div className="py-10 text-center text-slate-400 text-sm">No automated rules yet. Create one first from More → Create a new rule.</div>
              ) : (
                <div className="space-y-2">
                  {rules.map(r => {
                    const h = humanRule(r)
                    const entOk = h.ent === LEVEL_ENTITY[level]
                    const ids = applicableIds(r)
                    const eligible = selectedRows.length > 0 && entOk && ids.length > 0
                    const reason = !entOk ? `For ${ENTITY_WORD[h.ent]?.[1] || h.ent.toLowerCase()}` : ids.length === 0 ? "Different ad account" : ""
                    const sel = applySel === r.id
                    return (
                      <button key={r.id} disabled={!eligible} onClick={() => setApplySel(r.id)}
                        className={`w-full text-left rounded-xl border p-3.5 flex items-center gap-3 ${sel ? "border-blue-500 ring-2 ring-blue-100" : "border-slate-200"} ${eligible ? "hover:border-blue-300" : "opacity-50 cursor-not-allowed"}`}>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-slate-900 text-sm truncate">{r.name}</div>
                          <div className="text-xs text-slate-500 truncate">{[h.actionL, h.condL.join(" · "), h.time, h.schedL].filter(Boolean).join(" — ")}</div>
                          <div className="text-[11px] text-slate-400 mt-0.5">{r.__accName}{reason ? ` · ${reason}` : ""}{r.status !== "ENABLED" ? " · Disabled" : ""}</div>
                          {sel && !ruleHasIdScope(r) && (
                            <div className="text-[11px] text-amber-600 mt-1">This rule currently runs on all active {ENTITY_WORD[h.ent]?.[1]} — applying will limit it to the selected items{ids.length < selectedRows.length ? ` from ${r.__accName} only` : ""}.</div>
                          )}
                          {sel && ruleHasIdScope(r) && ids.length < selectedRows.length && (
                            <div className="text-[11px] text-amber-600 mt-1">Only the {ids.length} selected from {r.__accName} will be added (rules are per ad account).</div>
                          )}
                        </div>
                        <span className={`w-5 h-5 rounded-full shrink-0 ${sel ? "border-[6px] border-blue-600 bg-white" : "border-2 border-slate-300"}`} />
                      </button>
                    )
                  })}
                </div>
              )}
              {err && <p className="text-sm text-rose-600">⚠ {err}</p>}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-200">
              <button onClick={() => setView("")} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-800 font-semibold hover:bg-slate-50">Cancel</button>
              <button onClick={applyRule} disabled={!applySel || applying || selectedRows.length === 0} className="px-5 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-40">{applying ? "Applying…" : "Apply rule"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Manage rules: live list from adrules_library, enable/disable + delete ── */}
      {view === "manage" && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Automated rules</h2>
              <div className="flex items-center gap-2">
                <button onClick={loadRules} disabled={rulesLoading} className="p-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-50" title="Refresh"><RefreshCw className={`w-4 h-4 ${rulesLoading ? "animate-spin" : ""}`} /></button>
                <button onClick={() => setView("")} className="p-1.5 rounded-lg border border-slate-300 hover:bg-slate-50"><X className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {rulesLoading ? (
                <div className="py-16 text-center text-slate-400 text-sm"><RefreshCw className="w-5 h-5 animate-spin inline mr-2" /> Loading rules…</div>
              ) : rules.length === 0 ? (
                <div className="py-16 text-center text-slate-400 text-sm">No automated rules yet. Create one from More → Create a new rule.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-20">
                    <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs text-slate-500">
                      <th className="px-4 py-2.5 font-semibold">RULE NAME</th>
                      <th className="px-4 py-2.5 font-semibold" title="The PesoWise user who last created or edited this rule">LAST TOUCHED BY</th>
                      {!currentAccountId && <th className="px-4 py-2.5 font-semibold">AD ACCOUNT</th>}
                      <th className="px-4 py-2.5 font-semibold">APPLIED TO</th>
                      <th className="px-4 py-2.5 font-semibold">ACTION</th>
                      <th className="px-4 py-2.5 font-semibold">CONDITIONS</th>
                      <th className="px-4 py-2.5 font-semibold">SCHEDULE</th>
                      <th className="px-4 py-2.5 font-semibold">STATUS</th>
                      <th className="px-4 py-2.5 font-semibold text-right">ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map(r => {
                      const h = humanRule(r)
                      const on = r.status === "ENABLED"
                      const scoped = scopedIdsOf(r)
                      const open = scopeOpen === r.id
                      const entW = ENTITY_WORD[h.ent] || ENTITY_WORD.CAMPAIGN
                      return (
                        <Fragment key={r.id}>
                        <tr onClick={() => toggleScope(r)}
                          title={`Show what this rule is set on`}
                          className={`border-b border-slate-100 cursor-pointer ${open ? "bg-blue-50/60" : "hover:bg-slate-50/60"}`}>
                          <td className="px-4 py-3 font-medium text-slate-800 max-w-[200px]">
                            <span className="flex items-center gap-1.5">
                              <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
                              <span className="block truncate" title={r.name}>{r.name}</span>
                            </span>
                            {r.created_time && <span className="text-[10px] text-slate-400 pl-5">{fmtD(r.created_time)}</span>}</td>
                          {/* ⚠ SINONG PESOWISE USER, hindi ang `created_by` ni Meta.
                              Iisang Facebook token ang hawak ng tatlong buyer, kaya
                              iisang pangalan lang ang alam ni Meta (ang may-ari ng
                              token) — wala iyong saysay sa "sino sa atin". */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            {ruleEditors[r.id]
                              ? <span className="inline-flex flex-col">
                                  <span className="text-[12px] font-semibold text-slate-700">{ruleEditors[r.id].user || "Unknown user"}</span>
                                  <span className="text-[10px] text-slate-400">{ACTION_LABEL[ruleEditors[r.id].action] || ruleEditors[r.id].action} · {fmtD(ruleEditors[r.id].at)}</span>
                                </span>
                              : <span className="text-[12px] text-slate-400" title="Nothing recorded in PesoWise — made straight in Ads Manager, or before the activity log existed">—</span>}
                          </td>
                          {!currentAccountId && <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{r.__accName}</td>}
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                            {/* Ang bilang ang unang tanong: "ilan ba ang naka-set dito?" */}
                            {scoped.length > 0
                              ? <span className="text-blue-700 font-semibold">{scoped.length} {entW[scoped.length === 1 ? 0 : 1]}</span>
                              : <span className="capitalize">All active {entW[1]}</span>}
                          </td>
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{h.actionL || "—"}</td>
                          <td className="px-4 py-3 text-slate-600 max-w-[260px]">
                            <span className="block truncate" title={h.condL.join(" · ")}>{h.condL.join(" · ") || "—"}</span>
                            {h.time && <span className="text-[10px] text-slate-400">{h.time}</span>}
                          </td>
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{h.schedL || "—"}</td>
                          <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                            <button onClick={() => mutateRule(r, "rule_status", on ? "DISABLED" : "ENABLED")} disabled={ruleBusy === r.id} title={on ? "Disable rule" : "Enable rule"}
                              className={`relative w-9 h-5 rounded-full transition-colors ${on ? "bg-emerald-500" : "bg-slate-300"} ${ruleBusy === r.id ? "opacity-60" : ""}`}>
                              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
                            </button>
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                            {confirmDel === r.id ? (
                              <span className="inline-flex items-center gap-1.5 text-xs">
                                <button onClick={() => mutateRule(r, "rule_delete")} disabled={ruleBusy === r.id} className="px-2 py-1 rounded bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-50">Delete</button>
                                <button onClick={() => setConfirmDel("")} className="px-2 py-1 rounded border border-slate-300 text-slate-600 hover:bg-slate-50">Cancel</button>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-0.5">
                                <button onClick={() => { setEditing(r); setView("create") }}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50" title="Edit rule"><Pencil className="w-4 h-4" /></button>
                                <button onClick={() => setConfirmDel(r.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50" title="Delete rule"><Trash2 className="w-4 h-4" /></button>
                              </span>
                            )}
                          </td>
                        </tr>
                        {open && (() => {
                          const shown = scopeRows.filter(o => !scopeQ || o.name.toLowerCase().includes(scopeQ.toLowerCase()))
                          // Ang naka-set na hindi na mahanap sa account (binura na
                          // ang object) ay ipinapakita pa rin — kung hindi, tahimik
                          // itong mabubura sa unang Save.
                          const missing = Array.from(scopeSel).filter(id => !scopeRows.some(o => o.id === id))
                          const dirty = scopeSel.size !== scoped.length || scoped.some(id => !scopeSel.has(id))
                          return (
                          <tr className="border-b border-slate-200 bg-blue-50/40">
                            <td colSpan={currentAccountId ? 8 : 9} className="px-4 py-3">
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-[13px] font-bold text-slate-800">What this rule is set on</span>
                                  <span className="text-[12px] text-slate-500">
                                    {scoped.length > 0
                                      ? <>{scoped.length} {entW[scoped.length === 1 ? 0 : 1]} checked</>
                                      : <>nothing specific — it runs on <b>all active {entW[1]}</b> in {r.__accName}</>}
                                  </span>
                                  <input value={scopeQ} onChange={e => setScopeQ(e.target.value)} placeholder={`Search ${entW[1]}…`}
                                    className="ml-auto h-8 rounded-lg border border-slate-300 bg-white px-2.5 text-[13px] min-w-[180px]" />
                                </div>

                                {scopeBusy ? (
                                  <p className="text-[12px] text-slate-400 py-3 flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading {entW[1]}…</p>
                                ) : (
                                  <div className="max-h-56 overflow-y-auto scrollbar-dark rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
                                    {missing.map(id => (
                                      <label key={id} className="flex items-center gap-2 px-3 py-1.5 text-[13px]">
                                        <input type="checkbox" checked onChange={() => setScopeSel(p => { const n = new Set(p); n.delete(id); return n })} />
                                        <span className="text-amber-700">{id} — not in this account any more</span>
                                      </label>
                                    ))}
                                    {shown.length === 0 && missing.length === 0 ? (
                                      <p className="px-3 py-3 text-[12px] text-slate-400 italic">
                                        {scopeErr ? scopeErr : scopeQ ? "Nothing matches that search." : `No ${entW[1]} with data in this range.`}
                                      </p>
                                    ) : shown.map(o => (
                                      <label key={o.id} className="flex items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-slate-50 cursor-pointer">
                                        <input type="checkbox" checked={scopeSel.has(o.id)}
                                          onChange={e => setScopeSel(p => { const n = new Set(p); e.target.checked ? n.add(o.id) : n.delete(o.id); return n })} />
                                        <span className="truncate text-slate-700">{o.name}</span>
                                        <span className={`ml-auto text-[11px] px-1.5 py-0.5 rounded-full shrink-0 ${statusColor(o.status)}`}>{statusLabel(o.status)}</span>
                                      </label>
                                    ))}
                                  </div>
                                )}

                                {scopeErr && <p className="text-[12px] text-rose-600">⚠ {scopeErr}</p>}
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-[12px] text-slate-500">{scopeSel.size} checked</span>
                                  {shown.length > 0 && (
                                    <>
                                      <button onClick={() => setScopeSel(p => { const n = new Set(p); shown.forEach(o => n.add(o.id)); return n })}
                                        className="text-[12px] text-blue-600 hover:underline">select all shown</button>
                                      <button onClick={() => setScopeSel(new Set())} className="text-[12px] text-slate-500 hover:underline">clear</button>
                                    </>
                                  )}
                                  {/* Ang walang laman ay HINDI "buong account" — magkaibang bagay
                                      iyon, at hayagang pipiliin. */}
                                  <button onClick={() => saveScope(r, null)} disabled={scopeSaving || scoped.length === 0}
                                    title={scoped.length === 0 ? "It already runs on everything active" : `Drop the list and run on all active ${entW[1]}`}
                                    className="text-[12px] px-2 py-1 rounded-lg border border-slate-300 hover:bg-white disabled:opacity-40">
                                    Run on all active {entW[1]}
                                  </button>
                                  <span className="ml-auto flex items-center gap-2">
                                    <button onClick={() => setScopeOpen("")} className="text-[12px] px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-white">Close</button>
                                    <button onClick={() => saveScope(r, Array.from(scopeSel))} disabled={scopeSaving || !dirty || scopeSel.size === 0}
                                      title={scopeSel.size === 0 ? "Pick at least one, or use “Run on all active”" : ""}
                                      className="text-[12px] px-3 py-1.5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-40">
                                      {scopeSaving ? "Saving…" : `Save (${scopeSel.size})`}
                                    </button>
                                  </span>
                                </div>
                              </div>
                            </td>
                          </tr>
                          )
                        })()}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex items-center justify-between px-5 py-4 border-t border-slate-200">
              <span className="text-xs text-slate-400">Rules run on Facebook's side every 30–60 minutes, even when PesoWise is closed.</span>
              <div className="flex gap-2">
                <button onClick={() => setView("choose")} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-800 font-semibold hover:bg-slate-50">Create a new rule</button>
                <button onClick={() => setView("")} className="px-5 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
