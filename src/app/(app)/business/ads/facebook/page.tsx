"use client"
import { useState, useMemo, useEffect, useCallback } from "react"
import {
  Megaphone, RefreshCw, Wallet, TrendingUp, ShoppingCart, Target, MessageSquare,
  LayoutDashboard, CalendarDays, Settings2, ChevronDown, Search, Play, Pause, Link2,
  ArrowUp, ArrowDown, ArrowUpDown, ChevronRight, X, LayoutGrid, Layers, Pencil, Check, Trash2, CheckCircle2, Eye,
  ExternalLink, Send, Wrench, Info, MoreHorizontal,
} from "lucide-react"
import { format } from "date-fns"
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts"
import { useFBAccounts, actId, type FBAccount } from "@/lib/fb-store"
import { useActivePages } from "@/lib/pages-store"
import { useAdspent } from "@/lib/adspent-store"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import { ScalingTracker } from "@/components/business/ads/ScalingTracker"

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
// Show the campaign status capitalised — "Active", "Paused", etc.
const statusLabel = (s: string) => { const t = String(s).replace(/_/g, " ").toLowerCase(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t }
// Ads Manager ROAS colour rule: >4.9 green · 3–4.9 yellow · <3 red.
const roasBg = (v: number) => v <= 0 ? "" : v > 4.9 ? "bg-emerald-100 text-emerald-800" : v < 3 ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"

async function mapLimit<T>(items: T[], limit: number, fn: (i: T) => Promise<void>) {
  let i = 0; await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) await fn(items[i++]) }))
}

type Tab = "dashboard" | "daily" | "manager" | "scaling"
type Obj = "All" | "Conversions" | "Messaging" | "Other"

// Module-level flag: resets on a full page (re)load, but persists across in-app navigation.
// Lets us tell a real refresh apart from leaving the section and coming back.
let fbTabMounted = false

export default function FacebookAdsPage() {
  const fb = useFBAccounts()
  const pages = useActivePages()
  const adspentStore = useAdspent()
  // Keep the active tab on a real REFRESH, but reset to Dashboard when you leave the section and
  // come back. A refresh resets `fbTabMounted` (module re-evaluates) AND reports a "reload"
  // navigation; in-app navigation keeps `fbTabMounted` true, so it falls through to Dashboard.
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "dashboard"
    const firstMount = !fbTabMounted
    fbTabMounted = true
    let isReload = false
    try { isReload = (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type === "reload" } catch {}
    if (firstMount && isReload) {
      try { const t = localStorage.getItem("pesowise_fb_tab"); if (t === "daily" || t === "manager" || t === "scaling") return t } catch {}
    }
    return "dashboard"
  })
  useEffect(() => { try { localStorage.setItem("pesowise_fb_tab", tab) } catch {} }, [tab])
  const [from, setFrom] = useState(defaultDateA())
  const [to, setTo] = useState(defaultDateB())

  const [rows, setRows] = useState<Row[]>([])
  const [scalingCount, setScalingCount] = useState(0)
  const [trend, setTrend] = useState<{ date: string; spend: number; sales: number }[]>([])
  const [daily, setDaily] = useState<{ date: string; accountName: string; owner: string; status: string; budget: number; spend: number }[]>([])
  const [loading, setLoading] = useState(false)

  const pageIdByName = useMemo(() => Object.fromEntries(pages.map(p => [p.name, p.id])), [pages])
  // Pull spend from every registered account that has creds (not only status="Active"), so an
  // account that's spending but marked Paused / In-review isn't dropped from the totals.
  const dataAccounts = useMemo(() => fb.accounts.filter(a => !a.archived && a.ad_account_id && a.token), [fb.accounts])

  const load = useCallback(async () => {
    if (dataAccounts.length === 0) { setRows([]); setTrend([]); setDaily([]); return }
    setLoading(true)
    const allRows: Row[] = [], trendByDate: Record<string, { spend: number; sales: number }> = {}, dailyRows: typeof daily = []
    const sums: Record<string, Record<string, number>> = {}
    await mapLimit(dataAccounts, 4, async (a: FBAccount) => {
      const q = `token=${encodeURIComponent(a.token)}&account_id=${encodeURIComponent(actId(a.ad_account_id))}&from=${from}&to=${to}`
      try {
        const [rc, tr, db] = await Promise.all([
          fetch(`/api/fb/insights?rich=1&${q}`).then(r => r.json()),
          fetch(`/api/fb/insights?trend=1&${q}`).then(r => r.json()),
          fetch(`/api/fb/insights?${q}`).then(r => r.json()),
        ])
        const acctBudget = (rc.campaigns || []).filter((c: any) => /active/i.test(c.status)).reduce((s: number, c: any) => s + (c.budget || 0), 0)
        if (rc.success) for (const c of rc.campaigns) allRows.push(toRow(c, a.id, a.name, a.owner))
        if (tr.success) for (const d of tr.trend) { trendByDate[d.date] = trendByDate[d.date] || { spend: 0, sales: 0 }; trendByDate[d.date].spend += d.spend; trendByDate[d.date].sales += d.sales }
        if (db.success) {
          for (const [d, amt] of Object.entries(db.byDate || {})) {
            dailyRows.push({ date: d, accountName: a.name, owner: a.owner, status: a.status, budget: acctBudget, spend: amt as number })
            const pid = pageIdByName[a.page_name]; if (pid) { sums[pid] = sums[pid] || {}; sums[pid][d] = (sums[pid][d] || 0) + (amt as number) }
          }
        }
      } catch {}
    })
    setRows(allRows)
    setTrend(Object.entries(trendByDate).map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date)))
    setDaily(dailyRows.sort((a, b) => a.date.localeCompare(b.date) || a.accountName.localeCompare(b.accountName)))
    // Auto-sync adspent (summed per page) → ROAS / Income Statement
    const entries: { pageId: string; date: string; value: number }[] = []
    for (const [pid, byDate] of Object.entries(sums)) for (const [d, val] of Object.entries(byDate)) entries.push({ pageId: pid, date: d, value: val })
    adspentStore.setMany(entries)
    setLoading(false)
  }, [dataAccounts, from, to, pageIdByName, adspentStore])

  useEffect(() => { load() /* eslint-disable-next-line */ }, [fb.accounts.length, from, to])

  return (
    <div className="space-y-5">
      {/* Header + tabs */}
      <div className="flex items-center justify-between flex-wrap gap-3 pb-4 mb-1 border-b border-slate-100">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Megaphone className="w-5 h-5" /> FACEBOOK ADS</h1>
        <div className="flex items-center gap-2">
          <DateRangePicker a={from} b={to} variant="header"
            onApply={(a, b) => { setFrom(a || defaultDateA()); setTo(b || defaultDateB()) }} placeholder="Today" />
          <button onClick={load} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto scrollbar-dark">
        {([["dashboard", "Dashboard", LayoutDashboard], ["daily", "Daily Ad Spend", CalendarDays], ["manager", "Ads Manager", Settings2], ["scaling", "Scaling", TrendingUp]] as [Tab, string, any][]).map(([t, label, Icon]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            <Icon className="w-4 h-4" /> {label}
            {/* Bilang ng scale+kill+fatigue signals — lumalabas matapos madalaw ang tab
                (doon lang nagkakarga ang datos; sinadya, mabigat ang 30-araw na hila). */}
            {t === "scaling" && scalingCount > 0 && (
              <span className="text-[10px] bg-rose-100 text-rose-700 font-bold px-1.5 py-0.5 rounded-full">{scalingCount}</span>
            )}
          </button>
        ))}
      </div>

      {dataAccounts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 py-16 text-center">
          <Link2 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No connected ad accounts. Register them in <strong>Ad Accounts</strong> first.</p>
        </div>
      ) : tab === "dashboard" ? <Dashboard rows={rows} trend={trend} loading={loading} accounts={dataAccounts} from={from} to={to} />
        : tab === "daily" ? <DailySpend daily={daily} loading={loading} />
          : tab === "scaling" ? <ScalingTracker accounts={dataAccounts} onSignals={setScalingCount} />
            : <AdsManager fb={fb} from={from} to={to} />}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════════════════════════
const COLORS = ["#2563eb", "#7c3aed", "#0891b2", "#16a34a", "#ea580c", "#db2777", "#ca8a04", "#475569"]

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl p-4 text-white bg-gradient-to-br ${accent} shadow-sm`}>
      <div className="text-[11px] uppercase tracking-wider opacity-90">{label}</div>
      <div className="text-2xl font-bold mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-xs opacity-90 mt-0.5">{sub}</div>}
    </div>
  )
}

function Dashboard({ rows, trend, loading, accounts: fbAccounts, from, to }: { rows: Row[]; trend: { date: string; spend: number; sales: number }[]; loading: boolean; accounts: FBAccount[]; from: string; to: string }) {
  const [objective, setObjective] = useState<Obj>("All")
  const [fAccount, setFAccount] = useState("All")
  const [fOwner, setFOwner] = useState("All")
  const [fStatus, setFStatus] = useState("With spend")   // default: campaigns that spent in the period (active or paused)
  const [qCampaign, setQCampaign] = useState("")
  // Persist the charts toggle so it survives refresh.
  const [showCharts, setShowCharts] = useState(() => { try { return localStorage.getItem("pesowise_fb_showcharts") !== "0" } catch { return true } })
  useEffect(() => { try { localStorage.setItem("pesowise_fb_showcharts", showCharts ? "1" : "0") } catch {} }, [showCharts])

  // Ang mga pagpipilian ay galing sa REGISTRY ng ad accounts, pinagsama sa nakita
  // sa rows. Kung `rows` lang ang pinagbatayan, ang account/owner na walang
  // campaign sa panahong ito ay hindi mapipili — kaya mukhang nawawala ang tao
  // gayong may account naman siya.
  const accounts = useMemo(() => Array.from(new Set([
    ...fbAccounts.filter(a => !a.archived).map(a => a.name),
    ...rows.map(r => r.accountName),
  ].filter(Boolean))).sort(), [fbAccounts, rows])
  const owners = useMemo(() => Array.from(new Set([
    ...fbAccounts.filter(a => !a.archived).map(a => a.owner),
    ...rows.map(r => r.accountOwner),
  ].filter(Boolean))).sort(), [fbAccounts, rows])

  // ── STATUS FILTER ───────────────────────────────────────────────────────────
  // DATING BUG (nasukat Ago 6 2026): ang "Paused" ay nangangailangan ng
  // `spend > 0`, kaya sa 145 na PAUSED campaigns ay 45 lang ang lumalabas —
  // 100 ang nakatago. Iyon ang "hindi accurate" na filter. Ang status ay
  // STATUS; hindi ito dapat maghalo ng kondisyon sa spend. Ang "With spend"
  // ang para doon.
  //   All         → lahat
  //   Active      → effective_status ACTIVE
  //   Paused      → LAHAT ng paused (kasama ang zero-spend)
  //   With spend  → anumang may gastos sa panahon (hindi status, kaya hiwalay)
  const passStatus = (r: Row) => fStatus === "Active" ? /active/i.test(r.status)
    : fStatus === "Paused" ? /paus/i.test(r.status)
      : fStatus === "With spend" ? r.spend > 0 : true

  // Ang bawat filter — KASAMA ang Status — ay umaapekto sa cards AT sa table.
  // Dati ay laktaw ang cards sa Status, kaya "Active" ang napili pero buong-buwan
  // pa rin ang spend sa itaas (₱818,974 sa cards vs ₱176,247 sa table). Mukhang
  // sira ang report; ang filter ay dapat mag-filter.
  const cardRows = useMemo(() => rows.filter(r => {
    if (objective !== "All" && objBucket(r.objective) !== objective) return false
    if (fAccount !== "All" && r.accountName !== fAccount) return false
    if (fOwner !== "All" && r.accountOwner !== fOwner) return false
    if (qCampaign && !r.name.toLowerCase().includes(qCampaign.toLowerCase())) return false
    return passStatus(r)
  }), [rows, objective, fAccount, fOwner, qCampaign, fStatus])
  const filtered = cardRows

  // ── View-only level tabs (Campaigns / Ad Sets / Ads). Ad-set and ad metrics are lazy-loaded
  // once per date range (server cache handles freshness) — no toggles here, viewing only. ──
  const [perfLevel, setPerfLevel] = useState<"campaign" | "adset" | "ad">("campaign")
  const [lvlData, setLvlData] = useState<Record<string, Row[]>>({})
  const [lvlLoading, setLvlLoading] = useState(false)
  // Meta-style selection (view-only): selecting campaigns filters the Ad Sets/Ads tabs, selecting
  // ad sets filters Ads. Clearing cascades downward.
  const [selCampaigns, setSelCampaigns] = useState<Set<string>>(new Set())
  const [selAdsets, setSelAdsets] = useState<Set<string>>(new Set())
  const [selAds, setSelAds] = useState<Set<string>>(new Set())
  const perfSel = perfLevel === "campaign" ? selCampaigns : perfLevel === "adset" ? selAdsets : selAds
  const setPerfSel = perfLevel === "campaign" ? setSelCampaigns : perfLevel === "adset" ? setSelAdsets : setSelAds
  const togglePerfSel = (id: string) => setPerfSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const togglePerfAll = (ids: string[] | null) => setPerfSel(ids ? new Set(ids) : new Set())
  const clearPerfSel = (lvl: "campaign" | "adset" | "ad") => {
    if (lvl === "campaign") { setSelCampaigns(new Set()); setSelAdsets(new Set()); setSelAds(new Set()) }
    else if (lvl === "adset") { setSelAdsets(new Set()); setSelAds(new Set()) }
    else setSelAds(new Set())
  }
  const drillPerf = (r: Row) => {
    if (perfLevel === "campaign") { setSelCampaigns(new Set([r.id])); setSelAdsets(new Set()); setSelAds(new Set()); setPerfLevel("adset") }
    else if (perfLevel === "adset") { setSelAdsets(new Set([r.id])); setSelAds(new Set()); setPerfLevel("ad") }
  }
  useEffect(() => { setLvlData({}); setPerfLevel("campaign"); clearPerfSel("campaign") }, [from, to])   // range change → refetch levels
  useEffect(() => {
    if (perfLevel === "campaign" || lvlData[perfLevel]) return
    let alive = true
    ;(async () => {
      setLvlLoading(true)
      const out: Row[] = []
      await mapLimit(fbAccounts, 3, async (a: FBAccount) => {
        try {
          const j = await fetch(`/api/fb/insights?rich=1&level=${perfLevel}&parent=${encodeURIComponent(actId(a.ad_account_id))}&token=${encodeURIComponent(a.token)}&account_id=${encodeURIComponent(actId(a.ad_account_id))}&from=${from}&to=${to}`).then(r => r.json())
          if (j.success) for (const r of j.rows) out.push(toRow(r, a.id, a.name, a.owner))
        } catch {}
      })
      if (alive) { setLvlData(d => ({ ...d, [perfLevel]: out })); setLvlLoading(false) }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfLevel, fbAccounts, from, to])

  // Rows for the table at the current level, honoring the same filters (Objective is campaign-only)
  // plus the upstream selection (selected campaigns filter ad sets/ads; selected ad sets filter ads).
  const tableRows = useMemo(() => {
    if (perfLevel === "campaign") return filtered
    return (lvlData[perfLevel] || []).filter(r => {
      if (fAccount !== "All" && r.accountName !== fAccount) return false
      if (fOwner !== "All" && r.accountOwner !== fOwner) return false
      if (qCampaign && !r.name.toLowerCase().includes(qCampaign.toLowerCase())) return false
      if (perfLevel === "adset" && selCampaigns.size > 0 && !selCampaigns.has(r.campaignId || "")) return false
      if (perfLevel === "ad") {
        if (selAdsets.size > 0) { if (!selAdsets.has(r.adsetId || "")) return false }
        else if (selCampaigns.size > 0 && !selCampaigns.has(r.campaignId || "")) return false
      }
      return passStatus(r)
    })
  }, [perfLevel, filtered, lvlData, fAccount, fOwner, qCampaign, fStatus, selCampaigns, selAdsets])
  const agg = useMemo(() => cardRows.reduce((s, r) => ({
    spend: s.spend + r.spend, spendVat: s.spendVat + r.spendVat, sales: s.sales + r.purchaseValue, budget: s.budget + r.budget,
    purchases: s.purchases + r.purchases, clicks: s.clicks + r.clicks, linkClicks: s.linkClicks + r.linkClicks,
    impressions: s.impressions + r.impressions, messaging: s.messaging + r.messaging,
  }), { spend: 0, spendVat: 0, sales: 0, budget: 0, purchases: 0, clicks: 0, linkClicks: 0, impressions: 0, messaging: 0 }), [cardRows])

  // Ad Budget = budget of campaigns currently running OR that already spent in the period
  // (a turned-off campaign that still spent had its budget in play, so it counts).
  const activeBudget = useMemo(() => cardRows.filter(r => /active/i.test(r.status) || r.spend > 0).reduce((s, r) => s + r.budget, 0), [cardRows])
  const overallRoas = agg.spend > 0 ? agg.sales / agg.spend : 0
  // Dalawang bagay na hindi kayang gawin ng filter — dating tahimik lang:
  //  1. Ang Objective ay galing sa Meta sa CAMPAIGN level lang; walang objective
  //     ang ad set/ad rows, kaya hindi ito maisasalang doon.
  //  2. Kapag na-rate-limit ang meta edge call ng Graph API, "—" ang status ng
  //     rows. Ang Active/Paused ay walang maipapakita — at walang paliwanag dati.
  const filterNotes = useMemo(() => {
    const notes: string[] = []
    if (perfLevel !== "campaign" && objective !== "All") {
      notes.push(`Objective “${objective}” applies to campaigns only — Meta doesn’t report an objective per ad set or ad, so the table below is not filtered by it.`)
    }
    const unknown = (perfLevel === "campaign" ? filtered : (lvlData[perfLevel] || [])).filter(r => !r.status || r.status === "—").length
    if (unknown > 0 && (fStatus === "Active" || fStatus === "Paused")) {
      notes.push(`${unknown} row${unknown === 1 ? "" : "s"} came back without a status from Meta (usually rate limiting), so the “${fStatus}” filter can’t place them. Refresh to try again.`)
    }
    return notes
  }, [perfLevel, objective, fStatus, filtered, lvlData])

  const cpa = agg.purchases > 0 ? agg.spend / agg.purchases : 0
  const convRate = agg.clicks > 0 ? (agg.purchases / agg.clicks) * 100 : 0
  const ctr = agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0
  const cpc = agg.clicks > 0 ? agg.spend / agg.clicks : 0
  const costPerMsg = agg.messaging > 0 ? agg.spend / agg.messaging : 0

  // Charts data
  const trendData = trend.map(d => ({ date: d.date.slice(5), roas: d.spend > 0 ? +(d.sales / (d.spend * VAT)).toFixed(2) : 0, spend: +d.spend.toFixed(0), sales: +d.sales.toFixed(0) }))
  const byAccount = useMemo(() => {
    const m: Record<string, { sales: number; budget: number; spend: number }> = {}
    for (const r of rows) { m[r.accountName] = m[r.accountName] || { sales: 0, budget: 0, spend: 0 }; m[r.accountName].sales += r.purchaseValue; m[r.accountName].budget += r.budget; m[r.accountName].spend += r.spend }
    return Object.entries(m).map(([name, v]) => ({ name, ...v }))
  }, [rows])

  // Card sets per objective
  const cards = objective === "Messaging" ? [
    { label: "Ad Budget", value: peso(activeBudget), accent: "from-slate-700 to-slate-800" },
    { label: "Ad Spend", value: peso(agg.spend), accent: "from-blue-600 to-blue-700" },
    { label: "Msg Conversations", value: num(agg.messaging), accent: "from-violet-500 to-violet-600" },
    { label: "Cost / Msg", value: peso(costPerMsg), accent: "from-fuchsia-500 to-pink-600" },
    { label: "CTR", value: pct(ctr), accent: "from-cyan-500 to-cyan-600" },
    { label: "Link Clicks", value: num(agg.linkClicks), accent: "from-emerald-500 to-emerald-600" },
    { label: "CPC", value: peso(cpc), accent: "from-amber-500 to-orange-600" },
    { label: "Conversion Rate", value: pct(convRate), accent: "from-teal-500 to-teal-600" },
  ] : objective === "Conversions" ? [
    { label: "Ad Budget", value: peso(activeBudget), accent: "from-slate-700 to-slate-800" },
    { label: "Amount Spent", value: peso(agg.spend), accent: "from-blue-600 to-blue-700" },
    { label: "ROAS", value: dec(overallRoas) + "x", accent: "from-emerald-500 to-emerald-600" },
    { label: "Purchase Value", value: peso(agg.sales), accent: "from-violet-500 to-violet-600" },
    { label: "Purchases", value: num(agg.purchases), accent: "from-fuchsia-500 to-pink-600" },
    { label: "CPP", value: peso(cpa), accent: "from-amber-500 to-orange-600" },
    { label: "CVR", value: pct(convRate), accent: "from-teal-500 to-teal-600" },
  ] : [
    { label: "Total Sales", value: peso(agg.sales), accent: "from-violet-500 to-violet-600" },
    { label: "Overall ROAS", value: dec(overallRoas) + "x", accent: "from-emerald-500 to-emerald-600" },
    { label: "Total Ad Spend", value: peso(agg.spend), accent: "from-blue-600 to-blue-700" },
    { label: "Total Ad Budget", value: peso(activeBudget), accent: "from-slate-700 to-slate-800" },
    { label: "Total Purchases", value: num(agg.purchases), accent: "from-fuchsia-500 to-pink-600" },
    { label: "Cost / Purchase", value: peso(cpa), accent: "from-amber-500 to-orange-600" },
  ]

  return (
    <div className="space-y-5">
      {/* Filters — at the top */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap gap-3 items-end">
        <Sel value={fAccount} onChange={setFAccount} opts={["All", ...accounts]} label="Account" />
        <Sel value={fOwner} onChange={setFOwner} opts={["All", ...owners]} label="Owner" />
        <Sel value={objective} onChange={(v) => setObjective(v as Obj)} opts={["All", "Conversions", "Messaging", "Other"]} label="Objective" />
        <Sel value={fStatus} onChange={setFStatus} opts={["All", "Active", "Paused", "With spend"]} label="Status" />
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input className="w-full h-10 rounded-lg border border-slate-200 pl-9 pr-3 text-sm" placeholder="Search campaign…" value={qCampaign} onChange={e => setQCampaign(e.target.value)} />
        </div>
        <button onClick={() => setShowCharts(s => !s)} className="h-10 px-3.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-600 hover:bg-slate-50 whitespace-nowrap">
          {showCharts ? "Hide charts" : "Show charts"}
        </button>
      </div>

      {/* Kung saan hindi kayang gawin ng filter ang inaasahan, SABIHIN — huwag
          hayaang mag-isip ang user na mali ang datos. */}
      {(filterNotes.length > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-[13px] text-amber-800 space-y-1">
          {filterNotes.map((n, i) => <p key={i}>{n}</p>)}
        </div>
      )}

      {/* Overview cards — sumusunod sa LAHAT ng filter, kasama ang Status */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map((c, i) => <Kpi key={i} {...c} />)}
      </div>

      {/* Charts */}
      {showCharts && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="ROAS Trend">
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
        <ChartCard title="Sales by Ad Account">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byAccount} layout="vertical" margin={{ left: 20, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis type="number" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
              <Tooltip /><Bar dataKey="sales" fill="#7c3aed" name="Sales" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Budget Allocation by Ad Account">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={byAccount.filter(a => a.budget > 0)} dataKey="budget" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(e: any) => e.name}>
                {byAccount.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: any) => peso(Number(v))} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
      )}

      {/* Performance table */}
      <PerfTable rows={tableRows} objective={objective} loading={loading || lvlLoading} level={perfLevel} onLevel={setPerfLevel}
        sel={perfSel} onToggle={togglePerfSel} onToggleAll={togglePerfAll} onDrill={drillPerf}
        badges={{ campaign: selCampaigns.size, adset: selAdsets.size, ad: selAds.size }} onClear={clearPerfSel} />
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
  { l: "Content Views", f: r => num(r.contentViews), v: r => r.contentViews }, { l: "CVR", f: r => pct(r.convRate), v: r => r.convRate },
  { l: "CTR (link)", f: r => pct(r.linkCtr), v: r => r.linkCtr }, { l: "CPC", f: r => peso(r.cpc), v: r => r.cpc }, { l: "CPM", f: r => peso(r.cpm), v: r => r.cpm },
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
                              className={`flex items-center gap-1 text-left max-w-[220px] ${level !== "ad" ? "text-blue-600 hover:underline" : "text-slate-800"}`}>
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
            <thead className="sticky top-0"><tr className="bg-slate-50 border-b border-slate-200 text-left">
              {["Date", "Ad Account", "Owner", "Daily Budget", "Amount Spent", "Status"].map(h => <th key={h} className="px-4 py-2.5 font-semibold text-slate-600 whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={6} className="text-center py-10 text-slate-400"><RefreshCw className="w-4 h-4 animate-spin inline mr-2" /> Loading…</td></tr>
                : filtered.length === 0 ? <tr><td colSpan={6} className="text-center py-10 text-slate-400 text-sm">No spend in range.</td></tr>
                  : filtered.map((d, i) => (
                    <tr key={i} className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50"} hover:bg-blue-50/40`}>
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
type MgrRow = Row & { createdTime: string; updatedTime: string; bidStrategy: string; campaignId: string; adsetId: string; ownBudget: number; budgetKind: string; thumbnail: string; configuredStatus: string }
const fmtD = (s: string) => s ? s.slice(0, 10) : "—"
// Ad-preview placement formats (mirrors Meta's preview switcher).
const PREVIEW_FORMATS = [
  { key: "MOBILE_FEED_STANDARD", label: "Mobile feed" },
  { key: "DESKTOP_FEED_STANDARD", label: "Desktop feed" },
  { key: "INSTAGRAM_STANDARD", label: "Instagram" },
  { key: "RIGHT_COLUMN_STANDARD", label: "Right column" },
] as const

function AdsManager({ fb, from, to }: { fb: ReturnType<typeof useFBAccounts>; from: string; to: string }) {
  const [accId, setAccId] = useState("all")   // default: All ad accounts
  const [fOwner, setFOwner] = useState("All")
  const [objMgr, setObjMgr] = useState<Obj>("All")
  const [fStatus, setFStatus] = useState("All")
  // Manageable accounts = any registered, credentialed, non-archived account.
  const mgrAccounts = useMemo(() => fb.accounts.filter(a => !a.archived && a.ad_account_id && a.token), [fb.accounts])
  const owners = useMemo(() => Array.from(new Set(mgrAccounts.map(a => a.owner).filter(Boolean))).sort(), [mgrAccounts])
  const visibleAccounts = useMemo(() => mgrAccounts.filter(a => fOwner === "All" || a.owner === fOwner), [mgrAccounts, fOwner])
  const accById = (id: string) => mgrAccounts.find(a => a.id === id) || null
  const isAll = accId === "all"
  const account = accById(accId)

  const [level, setLevel] = useState<MgrLevel>("campaign")
  // Meta-style multi-select: selecting upstream rows filters the downstream panels.
  const [selCampaigns, setSelCampaigns] = useState<Set<string>>(new Set())
  const [selAdsets, setSelAdsets] = useState<Set<string>>(new Set())
  const [selAds, setSelAds] = useState<Set<string>>(new Set())

  const [rows, setRows] = useState<any[]>([])   // raw rows for the CURRENT level only (lazy-loaded)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState("")
  const [toast, setToast] = useState("")
  const [editId, setEditId] = useState("")   // row whose budget is being edited inline
  const [editVal, setEditVal] = useState("")
  // Pending edits (drafts): BUDGET changes only — queued locally, published together (Meta-style).
  // Status toggles are NOT drafted: they publish to Facebook immediately (see setStatusNow).
  const [drafts, setDrafts] = useState<Record<string, { id: string; name: string; accountId: string; budget?: number }>>({})
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())   // rows whose on/off is being applied on FB right now
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
  const load = useCallback(async (fresh = false) => {
    const accts = isAll ? visibleAccounts : (account ? [account] : [])
    if (accts.length === 0) { setRows([]); return }
    setLoading(true)
    const out: any[] = []
    await mapLimit(accts, 3, async (a: FBAccount) => {
      try {
        const j = await fetch(`/api/fb/insights?rich=1${fresh ? "&nocache=1" : ""}&level=${level}&parent=${encodeURIComponent(actId(a.ad_account_id))}&token=${encodeURIComponent(a.token)}&account_id=${encodeURIComponent(actId(a.ad_account_id))}&from=${from}&to=${to}`).then(r => r.json())
        if (j.success) for (const r of j.rows) out.push({ ...r, __accId: a.id })
      } catch {}
    })
    setRows(out)
    setLoading(false)
  }, [isAll, account, visibleAccounts, level, from, to])
  useEffect(() => { load() }, [load])
  // Account change resets the view + all selections.
  useEffect(() => { setLevel("campaign"); setSelCampaigns(new Set()); setSelAdsets(new Set()); setSelAds(new Set()) }, [accId])

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
  const upsertDraft = (r: MgrRow, patch: { budget?: number }) => setDrafts(d => {
    const base = d[r.id] || { id: r.id, name: r.name, accountId: r.accountId }
    const next = { ...base, ...patch }
    if (next.budget != null && next.budget === Math.round(r.ownBudget)) delete next.budget   // back to original → not a change
    const nd = { ...d }
    if (next.budget == null) delete nd[r.id]; else nd[r.id] = next
    return nd
  })
  const queueBudget = (r: MgrRow, v: number) => { setEditId(""); if (isFinite(v) && v > 0) upsertDraft(r, { budget: Math.round(v) }) }
  const discardDrafts = () => { setDrafts({}); setDraftErrors({}); setReviewOpen(false) }
  // Human-readable summary of a draft's change (shown in the review modal).
  const draftChange = (dr: { budget?: number }) => dr.budget != null ? `Budget → ${peso(dr.budget)}` : "—"

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
      setTogglingIds(s => { const n = new Set(s); n.delete(r.id); return n })
      await load(true)   // fresh pull so effective status/cache match FB
      setLastPublished([{ name: r.name, change: status === "ACTIVE" ? "Turned on" : "Turned off" }])
      setPublishToast({ count: 1, label: nameHdr })
      setTimeout(() => setPublishToast(null), 6000)
    } catch (e: any) {
      setRows(rs => rs.map(x => x.id === r.id ? { ...x, ...prev } : x))   // revert the optimistic flip
      setTogglingIds(s => { const n = new Set(s); n.delete(r.id); return n })
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
    let failed = 0
    for (let i = 0; i < targets.length; i++) {
      const r = targets[i]
      const token = accById(r.accountId)?.token || ""
      try {
        if (!token) throw new Error("No token for this account")
        const j = await fetch(`/api/fb/manage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, action: "status", id: r.id, status }) }).then(rr => rr.json())
        if (!j.success) throw new Error(j.error || "Failed")
        ok.push({ name: r.name, change: status === "ACTIVE" ? "Turned on" : "Turned off" })
      } catch { failed++ }
      setPubProgress({ done: i + 1, total: targets.length })
    }
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
    for (let i = 0; i < list.length; i++) {
      const dr = list[i]
      const token = accById(dr.accountId)?.token || ""
      const post = (body: any) => fetch(`/api/fb/manage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...body }) }).then(r => r.json())
      try {
        if (!token) throw new Error("No token for this account")
        if (dr.budget != null) { const j = await post({ action: "update", id: dr.id, daily_budget: dr.budget }); if (!j.success) throw new Error(j.error || "Failed") }
      } catch (e: any) { errs[dr.id] = e?.message || "Failed" }
      setPubProgress({ done: i + 1, total: list.length })   // fill the bar as each item completes
    }
    await new Promise(res => setTimeout(res, 450))          // hold the final fill so it's visible
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
    return { ...toRow(r, a?.id || "", a?.name || "", a?.owner || ""), createdTime: r.createdTime || "", updatedTime: r.updatedTime || "", bidStrategy: r.bidStrategy || "", campaignId: r.campaignId || "", adsetId: r.adsetId || "", ownBudget: r.ownBudget || 0, budgetKind: r.budgetKind || "", thumbnail: r.thumbnail || "", configuredStatus: r.configuredStatus || r.status || "" }
  }
  const passStatus = (r: MgrRow) => fStatus === "All" || (fStatus === "Active" ? /active/i.test(r.status) : fStatus === "Paused" ? (/paus/i.test(r.status) && r.spend > 0) : r.spend > 0)
  const levelRows = useMemo(() => rows.map(toMgr).filter(r => {
    if (!passStatus(r)) return false
    if (level === "campaign") return objMgr === "All" || (objMgr === "Messaging" ? isMsg(r.objective) : !isMsg(r.objective))
    if (level === "adset") return selCampaigns.size === 0 || selCampaigns.has(r.campaignId)
    return selAdsets.size > 0 ? selAdsets.has(r.adsetId) : (selCampaigns.size === 0 || selCampaigns.has(r.campaignId))   // ads
  }), [rows, account, mgrAccounts, level, objMgr, fStatus, selCampaigns, selAdsets])

  const curSel = level === "campaign" ? selCampaigns : level === "adset" ? selAdsets : selAds
  const setCurSel = level === "campaign" ? setSelCampaigns : level === "adset" ? setSelAdsets : setSelAds

  const [sort, setSort] = useState<SortState | null>({ key: "Amount Spent", dir: "desc" })
  const sortedRows = useMemo(() => sortRows(levelRows, sort, (r, k) =>
    k === "On" ? (/active/i.test(r.status) ? 1 : 0)
      : k === "Name" ? r.name.toLowerCase()
        : k === "Status" ? r.status
          : k === "Created" ? r.createdTime
            : k === "Last edited" ? r.updatedTime
              : (cols.find(c => c.l === k)?.v(r) ?? 0)
  ), [levelRows, sort, cols])
  const mgrTotal = computeTotal(levelRows)

  // ── selection: toggle a row, clear a level (with cascade), quick-drill via name ──
  const toggleRow = (id: string) => setCurSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
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
            {visibleAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <Sel value={fOwner} onChange={setFOwner} opts={["All", ...owners]} label="Owner" />
        <Sel value={objMgr} onChange={v => setObjMgr(v as Obj)} opts={["All", "Conversions", "Messaging"]} label="Objective" />
        <Sel value={fStatus} onChange={setFStatus} opts={["All", "Active", "Paused", "With spend"]} label="Status" />
      </div>

      {mgrAccounts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 py-16 text-center">
          <Settings2 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No connected ad accounts. Register them in <strong>Ad Accounts</strong> first.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          {/* Connected panels: Campaigns · Ad Sets · Ads (selecting upstream filters downstream) */}
          <div className="flex items-center gap-1 px-3 pt-2 border-b border-slate-200 bg-slate-50/50 overflow-x-auto">
            <PanelTab lvl="campaign" Icon={Megaphone} title="Campaigns" count={selCampaigns.size} onClear={clearCampaigns} />
            <PanelTab lvl="adset" Icon={LayoutGrid} title={selCampaigns.size ? `Ad Sets for ${selCampaigns.size} Campaign${selCampaigns.size > 1 ? "s" : ""}` : "Ad Sets"} count={selAdsets.size} onClear={clearAdsets} />
            <PanelTab lvl="ad" Icon={Layers} title={selAdsets.size ? `Ads for ${selAdsets.size} Ad Set${selAdsets.size > 1 ? "s" : ""}` : selCampaigns.size ? `Ads for ${selCampaigns.size} Campaign${selCampaigns.size > 1 ? "s" : ""}` : "Ads"} count={selAds.size} onClear={clearAds} />
            <span className="ml-auto pr-2 text-[11px] text-amber-600 whitespace-nowrap">On/Off applies instantly — budget edits save as drafts until Publish</span>
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
                    <th className="px-3 py-2.5 sticky left-0 z-40 bg-slate-100 w-[44px] min-w-[44px] max-w-[44px]"><input type="checkbox" checked={allChecked} onChange={e => setCurSel(e.target.checked ? new Set(levelRows.map(r => r.id)) : new Set())} className="accent-blue-600" /></th>
                    <th className="px-2 py-2.5 font-semibold text-slate-600 sticky left-[43px] z-20 bg-slate-100 border-l border-slate-200 w-[52px] min-w-[52px] max-w-[52px]">
                      <button onClick={() => setSort(s => nextSort(s, "On"))} className="flex items-center gap-1 hover:text-blue-600">On <SortArrow active={sort?.key === "On"} dir={sort?.dir || "desc"} /></button>
                    </th>
                    <th className="px-3 py-2.5 font-semibold text-slate-600 sticky left-[94px] z-20 bg-slate-100 min-w-[240px] border-l border-r border-slate-200">
                      <button onClick={() => setSort(s => nextSort(s, "Name"))} className="flex items-center gap-1 hover:text-blue-600">{nameHdr} <SortArrow active={sort?.key === "Name"} dir={sort?.dir || "desc"} /></button>
                    </th>
                    <th className="px-4 py-2.5 font-semibold text-slate-600 border-r border-slate-200">
                      <button onClick={() => setSort(s => nextSort(s, "Status"))} className="flex items-center gap-1 hover:text-blue-600">Status <SortArrow active={sort?.key === "Status"} dir={sort?.dir || "desc"} /></button>
                    </th>
                    {cols.map(c => (
                      <th key={c.l} className="px-4 py-2.5 font-semibold text-slate-600 whitespace-nowrap text-right min-w-[110px] border-r border-slate-200">
                        <button onClick={() => setSort(s => nextSort(s, c.l))} className="flex items-center gap-1 justify-end w-full hover:text-blue-600">{c.l} <SortArrow active={sort?.key === c.l} dir={sort?.dir || "desc"} /></button>
                      </th>
                    ))}
                    {["Created", "Last edited"].map(h => (
                      <th key={h} className="px-4 py-2.5 font-semibold text-slate-600 whitespace-nowrap text-right border-r border-slate-200 last:border-r-0">
                        <button onClick={() => setSort(s => nextSort(s, h))} className="flex items-center gap-1 justify-end w-full hover:text-blue-600">{h} <SortArrow active={sort?.key === h} dir={sort?.dir || "desc"} /></button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r, i) => {
                    const active = origActive(r)
                    const selected = curSel.has(r.id)
                    const rowBg = selected ? "bg-blue-50" : (i % 2 === 0 ? "bg-white" : "bg-slate-50")
                    return (
                      <tr key={r.id} className={`border-b border-slate-100 ${rowBg} hover:bg-blue-50/40`}>
                        <td className={`px-3 py-3 sticky left-0 z-10 ${rowBg} w-[44px] min-w-[44px] max-w-[44px]`}><input type="checkbox" checked={selected} onChange={() => toggleRow(r.id)} className="accent-blue-600" /></td>
                        <td className={`px-2 py-3 sticky left-[43px] z-10 ${rowBg} border-l border-slate-100 w-[52px] min-w-[52px] max-w-[52px]`}>
                          <button onClick={() => setStatusNow(r, active ? "PAUSED" : "ACTIVE")} disabled={togglingIds.has(r.id)} title={active ? "Turn off" : "Turn on"}
                            className={`relative w-9 h-5 rounded-full transition-colors ${active ? "bg-emerald-500" : "bg-slate-300"} ${togglingIds.has(r.id) ? "opacity-70" : ""}`}>
                            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all flex items-center justify-center ${active ? "left-[18px]" : "left-0.5"}`}>
                              {togglingIds.has(r.id) && <RefreshCw className="w-3 h-3 animate-spin text-slate-500" />}
                            </span>
                          </button>
                        </td>
                        <td className={`px-3 py-3 sticky left-[94px] z-10 ${rowBg} min-w-[260px] border-l border-r border-slate-100`}>
                          <div className="flex items-center gap-2">
                            {level === "ad" && (r.thumbnail
                              ? <img src={r.thumbnail} alt="" loading="lazy" className="w-9 h-9 rounded object-cover border border-slate-200 shrink-0" />
                              : <div className="w-9 h-9 rounded bg-slate-100 border border-slate-200 shrink-0" />)}
                            <div className="min-w-0">
                              <button onClick={() => level !== "ad" && drillInto(r)} disabled={level === "ad"} title={level === "campaign" ? "View ad sets" : level === "adset" ? "View ads" : r.name}
                                className={`flex items-center gap-1 font-medium text-left max-w-[220px] ${level !== "ad" ? "text-blue-600 hover:underline" : "text-slate-800"}`}>
                                {level !== "ad" && <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
                                <span className="truncate">{r.name}</span>
                              </button>
                              {(isAll || r.bidStrategy) && <div className="text-[10px] text-slate-400 truncate max-w-[220px]">{isAll ? r.accountName : r.bidStrategy.replace(/_/g, " ").toLowerCase()}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 border-r border-slate-100"><span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusColor(r.status)}`}>{statusLabel(r.status)}</span></td>
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
                            ) : c.l === "ROAS" ? <span className={`inline-block px-2 py-0.5 rounded-md font-semibold ${roasBg(r.roas)}`}>{c.f(r)}</span> : c.f(r)}
                          </td>
                        ))}
                        <td className="px-4 py-3 text-right text-slate-500 whitespace-nowrap border-r border-slate-100">{fmtD(r.createdTime)}</td>
                        <td className="px-4 py-3 text-right text-slate-500 whitespace-nowrap">{fmtD(r.updatedTime)}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="sticky bottom-0 z-10">
                  <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold text-slate-800">
                    <td className="px-3 py-3 sticky left-0 z-10 bg-slate-100 w-[44px] min-w-[44px] max-w-[44px]" />
                    <td className="px-2 py-3 sticky left-[43px] z-10 bg-slate-100 border-l border-slate-200 w-[52px] min-w-[52px] max-w-[52px]" />
                    <td className="px-3 py-3 sticky left-[94px] z-10 bg-slate-100 min-w-[240px] border-l border-r border-slate-200">TOTAL <span className="font-normal text-slate-400">· {sortedRows.length} {nameHdr.toLowerCase()}{sortedRows.length === 1 ? "" : "s"}</span></td>
                    <td className="px-4 py-3 border-r border-slate-200" />
                    {cols.map(c => (
                      <td key={c.l} className="px-4 py-3 text-right tabular-nums whitespace-nowrap border-r border-slate-200">
                        {c.l === "ROAS" ? <span className={`inline-block px-2 py-0.5 rounded-md ${roasBg(mgrTotal.roas)}`}>{c.f(mgrTotal)}</span> : c.f(mgrTotal)}
                      </td>
                    ))}
                    <td className="px-4 py-3 border-r border-slate-200" />
                    <td className="px-4 py-3" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      <AutomatedRules accounts={mgrAccounts} currentAccountId={isAll ? "" : accId} level={level}
        selectedRows={levelRows.filter(r => curSel.has(r.id)).map(r => ({ id: r.id, accId: r.accountId }))}
        view={rulesView} setView={setRulesView} notify={flash} />
    </div>
  )
}

// ═════════════════ Automated rules — Meta adrules_library, mirrors Ads Manager's "More ▾ → Automated rules" ═════════════════
type RulesView = "" | "choose" | "create" | "apply" | "manage"
type FBRule = { id: string; name: string; status: string; created_time?: string; evaluation_spec?: any; execution_spec?: any; schedule_spec?: any; __accId: string; __accName: string }

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

function AutomatedRules({ accounts, currentAccountId, level, selectedRows, view, setView, notify }: {
  accounts: FBAccount[]; currentAccountId: string; level: MgrLevel; selectedRows: { id: string; accId: string }[]
  view: RulesView; setView: (v: RulesView) => void; notify: (m: string) => void
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
  // ── Manage-list state ──
  const [rules, setRules] = useState<FBRule[]>([])
  const [rulesLoading, setRulesLoading] = useState(false)
  const [ruleBusy, setRuleBusy] = useState("")
  const [confirmDel, setConfirmDel] = useState("")
  // ── Apply-existing state ──
  const [applySel, setApplySel] = useState("")
  const [applying, setApplying] = useState(false)

  const acct = accounts.find(a => a.id === acctId) || accounts.find(a => a.id === currentAccountId) || accounts[0] || null
  const entity = applyTo === "SELECTED" ? LEVEL_ENTITY[level] : applyTo
  const words = ENTITY_WORD[entity] || ENTITY_WORD.CAMPAIGN
  const post = (body: any) => fetch(`/api/fb/manage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json())

  // Fresh form on every open; preselect the checked rows when there are any (like Meta).
  useEffect(() => {
    if (view !== "create") return
    setAcctId(currentAccountId || accounts[0]?.id || "")
    setRuleName(""); setApplyTo(selectedIds.length ? "SELECTED" : LEVEL_ENTITY[level]); setAction("")
    setBudgetAmt(""); setBudgetUnit("PERCENTAGE"); setBudgetCap("")
    setConds([blankCond()]); setTimeRange("LIFETIME"); setSched("SEMI_HOURLY")
    setDays([0, 1, 2, 3, 4, 5, 6]); setStartMin(0); setEndMin(0)
    setErr(""); setAttrOpen(-1); setSubInput("")
  }, [view])   // eslint-disable-line react-hooks/exhaustive-deps
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
  useEffect(() => { if (view === "manage" || view === "apply") { setConfirmDel(""); setApplySel(""); setErr(""); loadRules() } }, [view, loadRules])

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
      ...(applyTo === "SELECTED" ? [{ field: `${entity.toLowerCase()}.id`, value: selectedIds, operator: "IN" }] : []),
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
    try {
      const j = await post({
        token: acct.token, action: "rule_create", account_id: actId(acct.ad_account_id),
        rule: { name: ruleName.trim(), evaluation_spec: { evaluation_type: "SCHEDULE", filters }, execution_spec, schedule_spec, status: "ENABLED" },
      })
      if (!j.success) throw new Error(j.error || "Failed")
      setView(""); notify(`Rule "${ruleName.trim()}" created — it now runs on Facebook.`)
    } catch (e: any) { setErr(e?.message || "Failed to create the rule") }
    setSaving(false)
  }

  async function mutateRule(r: FBRule, act: "rule_status" | "rule_delete", status?: string) {
    const token = accounts.find(a => a.id === r.__accId)?.token || ""
    if (!token) return
    setRuleBusy(r.id)
    try {
      const j = await post({ token, action: act, id: r.id, status })
      if (!j.success) throw new Error(j.error || "Failed")
      if (act === "rule_delete") { setRules(rs => rs.filter(x => x.id !== r.id)); notify("Rule deleted.") }
      else setRules(rs => rs.map(x => x.id === r.id ? { ...x, status: status! } : x))
    } catch (e: any) { notify("⚠ " + (e?.message || "Failed")) }
    setRuleBusy(""); setConfirmDel("")
  }

  // Apply an existing rule to the checked rows: merge their ids into the rule's <entity>.id scope filter.
  // Only ids from the rule's OWN ad account can be added (FB rules are per-account).
  const entityOfRule = (r: FBRule) => String((r.evaluation_spec?.filters || []).find((f: any) => f.field === "entity_type")?.value || "")
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
      setView("")
      notify(`Rule "${r.name}" applied to ${ids.length} ${ENTITY_WORD[ent][ids.length === 1 ? 0 : 1]}.`)
    } catch (e: any) { setErr(e?.message || "Failed to apply the rule") }
    setApplying(false)
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
              <h2 className="text-lg font-bold text-slate-900">Create a custom rule</h2>
              <button onClick={() => setView("")} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              <p className="text-sm text-slate-600">
                Automatically update the settings of selected campaigns, ad sets or ads by creating a rule.{" "}
                <a href="https://www.facebook.com/business/help/1029841767742843" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Learn more</a>
              </p>

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
                  <select value={applyTo} onChange={e => { const v = e.target.value; setApplyTo(v); const ent = v === "SELECTED" ? LEVEL_ENTITY[level] : v; setAction(a => ruleActionsFor(ent).some(x => x.v === a) ? a : "") }} className={inputCls}>
                    {selectedIds.length > 0 && <option value="SELECTED">{selectedIds.length} selected {ENTITY_WORD[LEVEL_ENTITY[level]][selectedIds.length === 1 ? 0 : 1]}</option>}
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
              <button onClick={() => setView("")} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-800 font-semibold hover:bg-slate-50">Cancel</button>
              <button onClick={createRule} disabled={!canCreate} className="px-5 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-40">{saving ? "Creating…" : "Create"}</button>
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
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                    <tr className="text-left text-xs text-slate-500">
                      <th className="px-4 py-2.5 font-semibold">RULE NAME</th>
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
                      return (
                        <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                          <td className="px-4 py-3 font-medium text-slate-800 max-w-[200px]"><span className="block truncate" title={r.name}>{r.name}</span>
                            {r.created_time && <span className="text-[10px] text-slate-400">{fmtD(r.created_time)}</span>}</td>
                          {!currentAccountId && <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{r.__accName}</td>}
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap capitalize">{ENTITY_WORD[h.ent]?.[1] || h.ent.toLowerCase() || "—"}</td>
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{h.actionL || "—"}</td>
                          <td className="px-4 py-3 text-slate-600 max-w-[260px]">
                            <span className="block truncate" title={h.condL.join(" · ")}>{h.condL.join(" · ") || "—"}</span>
                            {h.time && <span className="text-[10px] text-slate-400">{h.time}</span>}
                          </td>
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{h.schedL || "—"}</td>
                          <td className="px-4 py-3">
                            <button onClick={() => mutateRule(r, "rule_status", on ? "DISABLED" : "ENABLED")} disabled={ruleBusy === r.id} title={on ? "Disable rule" : "Enable rule"}
                              className={`relative w-9 h-5 rounded-full transition-colors ${on ? "bg-emerald-500" : "bg-slate-300"} ${ruleBusy === r.id ? "opacity-60" : ""}`}>
                              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
                            </button>
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            {confirmDel === r.id ? (
                              <span className="inline-flex items-center gap-1.5 text-xs">
                                <button onClick={() => mutateRule(r, "rule_delete")} disabled={ruleBusy === r.id} className="px-2 py-1 rounded bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-50">Delete</button>
                                <button onClick={() => setConfirmDel("")} className="px-2 py-1 rounded border border-slate-300 text-slate-600 hover:bg-slate-50">Cancel</button>
                              </span>
                            ) : (
                              <button onClick={() => setConfirmDel(r.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50" title="Delete rule"><Trash2 className="w-4 h-4" /></button>
                            )}
                          </td>
                        </tr>
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
