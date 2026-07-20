"use client"
import { useState, useMemo, useRef, useEffect, Fragment } from "react"
import { ChevronDown, Check, Search, X, RefreshCw, Activity, ArrowDownUp, BarChart3, CalendarDays } from "lucide-react"
import { format, startOfMonth, eachDayOfInterval } from "date-fns"
import { useActivePages } from "@/lib/pages-store"
import { useAdspent } from "@/lib/adspent-store"
import { useFBAccounts, actId } from "@/lib/fb-store"
import { usePageColors, colorForPage, tint } from "@/lib/page-colors"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"

const PLATFORMS = ["Facebook Ecom", "Instagram", "TikTok", "Shopee", "Lazada"]
const PAGE_STATUSES = ["All", "Active", "Inactive", "In-Review", "Restricted"]

const VIEW_TOGGLES = [
  { key: "shippedOut", label: "View Shipped Out" },
  { key: "inTransit", label: "View In Transit" },
  { key: "onDelivery", label: "View On Delivery" },
  { key: "returned", label: "View Returned" },
  { key: "delivered", label: "View Delivered" },
  { key: "cpp", label: "CPP" },
] as const

type ToggleKey = typeof VIEW_TOGGLES[number]["key"]

function defaultDateA() { return format(startOfMonth(new Date()), "yyyy-MM-dd") }
function defaultDateB() { return format(new Date(), "yyyy-MM-dd") }

function fmtPeso(n: number) {
  return n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ROAS color tiers (Ads-Manager style): green pag mataas, pababa hanggang pula.
//   ≥ 4.9 green · 3.0–4.89 amber · 2.0–2.99 orange · >0 <2 red · 0/none gray
function roasColor(roas: number) {
  if (roas <= 0) return "#94a3b8"
  if (roas >= 4.9) return "#16a34a"
  if (roas >= 3) return "#d97706"
  if (roas >= 2) return "#ea580c"
  return "#dc2626"
}

// Searchable Filter Page — tag/chip style like the reference
function FilterPageDropdown({ options, selected, onChange }: {
  options: { id: string; name: string; status: string; platform: string }[]; selected: string[]; onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  const filtered = useMemo(() =>
    options.filter(p => p.name.toLowerCase().includes(search.toLowerCase())),
    [options, search])

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id])
  }
  function remove(id: string) {
    onChange(selected.filter(s => s !== id))
  }

  const selectedPages = options.filter(p => selected.includes(p.id))

  return (
    <div className="relative flex-1 min-w-[280px]" ref={containerRef}>
      <div
        onClick={() => setOpen(true)}
        className="min-h-[40px] px-3 py-1.5 rounded-lg border border-gray-300 bg-white flex flex-wrap gap-1.5 items-center cursor-text"
      >
        {selectedPages.map(page => (
          <span key={page.id} className="flex items-center gap-1 bg-blue-100 text-blue-800 text-xs font-medium px-2 py-0.5 rounded-md">
            {page.name} ({page.status.charAt(0).toUpperCase() + page.status.slice(1)})
            <button onClick={e => { e.stopPropagation(); remove(page.id) }} className="hover:text-blue-600 ml-0.5">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        {selectedPages.length === 0 && (
          <span className="text-sm text-gray-400">Select pages...</span>
        )}
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-30 w-full min-w-[320px]">
            <div className="p-2 border-b border-gray-100">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input ref={inputRef} type="text" placeholder="Search pages..." value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full h-8 pl-8 pr-3 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400" />
              </div>
            </div>
            <div className="max-h-56 overflow-y-auto">
              {filtered.length === 0 && (
                <p className="px-4 py-3 text-xs text-gray-400 italic">No pages found</p>
              )}
              {filtered.map(page => {
                const isSel = selected.includes(page.id)
                return (
                  <button key={page.id} onClick={() => toggle(page.id)}
                    className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${isSel ? "bg-blue-600 text-white" : "hover:bg-gray-50 text-gray-700"}`}>
                    <span className="text-sm font-medium truncate">
                      {page.name}{" "}
                      <span className={`text-xs font-normal ${isSel ? "text-blue-200" : "text-gray-400"}`}>
                        ({page.status.charAt(0).toUpperCase() + page.status.slice(1)})
                      </span>
                    </span>
                    {isSel && <Check className="w-3.5 h-3.5 flex-shrink-0 ml-2" />}
                  </button>
                )
              })}
            </div>
            <div className="p-2 border-t border-gray-100 flex gap-2">
              <button onClick={() => onChange(filtered.map(p => p.id))}
                className="flex-1 h-7 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                Select all{search ? " (filtered)" : ""} ({filtered.length})
              </button>
              {selected.length > 0 && (
                <button onClick={() => onChange([])} className="flex-1 h-7 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                  Clear all
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const VAT_RATE = 0.12   // 12% VAT on Ad Spend

type DayData = { orders: number; sales: number; adspent: number; vat: number; roas: number; shipped: number; inTransit: number; onDelivery: number; onDeliveryAmount: number; returned: number; delivered: number; cpp: number }
type PageData = Record<string, DayData> // keyed by YYYY-MM-DD

function emptyDay(): DayData {
  return { orders: 0, sales: 0, adspent: 0, vat: 0, roas: 0, shipped: 0, inTransit: 0, onDelivery: 0, onDeliveryAmount: 0, returned: 0, delivered: 0, cpp: 0 }
}

async function fetchPageOrders(apiKey: string, pancakePageId: string, from: string, to: string): Promise<PageData> {
  const res = await fetch(
    `/api/pancake/orders?api_key=${encodeURIComponent(apiKey)}&page_id=${encodeURIComponent(pancakePageId)}&from=${from}&to=${to}`,
    { cache: "no-store" }
  )
  const json = await res.json()
  if (!res.ok || !json.success) {
    const detail = json.detail ? ` — ${json.detail}` : ""
    throw new Error((json.error || "API error") + detail)
  }
  return json.byDate as PageData
}

// Run async work with a concurrency cap to avoid bursting Pancake's rate limit (403 throttling).
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++])
  })
  await Promise.all(workers)
}

// Shared column header color
const TH_CLS = "px-3 py-2 text-center text-xs font-bold text-white uppercase tracking-wide border-r border-[#5b8fc7] last:border-r-0"
const TD_CLS = "px-3 py-2 text-center text-sm border-r border-gray-200 last:border-r-0"

// Module-level cache (survives navigation away/back). Per page+range fetched data + the
// last view (selection/range/submitted) so returning to the tab restores instantly.
const ROAS_CACHE = new Map<string, { ts: number; data: PageData }>()
const ROAS_TTL = 5 * 60_000  // 5 min
type AppliedRange = { from: Date; to: Date }
let roasView: { selectedPageIds: string[]; appliedPageIds: string[]; dateA: string; dateB: string; submitted: boolean; applied: AppliedRange | null; tab: "report" | "daily" } | null = null

export default function ROASTrackerPage() {
  const allPages = useActivePages()
  const adspentStore = useAdspent()
  const fb = useFBAccounts()
  const { colors, setColor } = usePageColors()
  // Report vs Daily-breakdown tab, at ang sort ng report table (default: highest ROAS muna).
  const [tab, setTab] = useState<"report" | "daily">(roasView?.tab ?? "report")
  const [roasSort, setRoasSort] = useState<"desc" | "asc">("desc")
  const [dateA, setDateA] = useState(roasView?.dateA ?? defaultDateA())
  const [dateB, setDateB] = useState(roasView?.dateB ?? defaultDateB())
  const [filterPlatform, setFilterPlatform] = useState("All")
  const [filterStatus, setFilterStatus] = useState("All")
  const [filterOwner, setFilterOwner] = useState("All")
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>(roasView?.selectedPageIds ?? [])
  // The pages the TABLE actually renders — a SNAPSHOT taken on Submit. Ang picker (selectedPageIds)
  // ay live, pero hindi lalabas sa table ang binagong selection hangga't hindi pinindot ang Submit.
  const [appliedPageIds, setAppliedPageIds] = useState<string[]>(roasView?.appliedPageIds ?? [])
  const [views, setViews] = useState<Record<ToggleKey, boolean>>({
    shippedOut: false, inTransit: false, onDelivery: false, returned: false, delivered: false, cpp: false,
  })
  // Real data state: pageId → { date → DayData }
  const [realData, setRealData] = useState<Record<string, PageData>>({})
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({}) // pageId → error msg
  const [submitted, setSubmitted] = useState(roasView?.submitted ?? false)
  // The date range the TABLE renders — only updated on Submit, so changing the picker doesn't
  // live-update the table (which would show mismatched 0-rows before you submit).
  const [applied, setApplied] = useState<AppliedRange | null>(roasView?.applied ?? null)

  const from = useMemo(() => new Date(dateA), [dateA])
  const to = useMemo(() => new Date(dateB), [dateB])

  // Table renders the APPLIED (submitted) range, not the live picker range.
  const dateRange = useMemo(() => applied ? eachDayOfInterval({ start: applied.from, end: applied.to }) : [], [applied])

  const owners = useMemo(() => Array.from(new Set(allPages.map(p => p.owner).filter(Boolean))).sort(), [allPages])

  const availablePages = useMemo(() => allPages.filter(p => {
    if (filterPlatform !== "All" && p.platform !== filterPlatform) return false
    if (filterStatus !== "All" && p.status.toLowerCase() !== filterStatus.toLowerCase()) return false
    if (filterOwner !== "All" && p.owner !== filterOwner) return false
    return true
  }), [allPages, filterPlatform, filterStatus, filterOwner])

  // Live selection (+ filters) — kung ano ang pinili sa picker NGAYON; ginagamit sa Submit fetch.
  const selectedPages = useMemo(() =>
    allPages.filter(p => {
      if (!selectedPageIds.includes(p.id)) return false
      if (filterPlatform !== "All" && p.platform !== filterPlatform) return false
      if (filterStatus !== "All" && p.status.toLowerCase() !== filterStatus.toLowerCase()) return false
      if (filterOwner !== "All" && p.owner !== filterOwner) return false
      return true
    }),
    [allPages, selectedPageIds, filterPlatform, filterStatus, filterOwner])

  // Snapshot na pinag-render ng table (from Submit) — hindi apektado ng live picker/filter changes.
  const renderedPages = useMemo(() =>
    appliedPageIds.map(id => allPages.find(p => p.id === id)).filter(Boolean) as typeof allPages,
    [allPages, appliedPageIds])

  // Pull FB ad spend for the submitted range → adspent store (per mapped page). Makes Ad Spent
  // visible for ANY date range straight from this page — no need to open the FB Ads dashboard.
  // Runs in the background; the table re-renders when the store updates.
  async function syncAdspentFromFB(pages: typeof selectedPages, fromStr: string, toStr: string) {
    try {
      const entries: { pageId: string; date: string; value: number }[] = []
      await mapLimit(pages, 3, async pg => {
        const accts = fb.accounts.filter(a => !a.archived && a.token && a.ad_account_id && a.page_name === pg.name)
        if (accts.length === 0) return
        const byDate: Record<string, number> = {}
        for (const a of accts) {
          try {
            const j = await fetch(`/api/fb/insights?token=${encodeURIComponent(a.token)}&account_id=${encodeURIComponent(actId(a.ad_account_id))}&from=${fromStr}&to=${toStr}`).then(r => r.json())
            if (j.success) for (const [d, v] of Object.entries(j.byDate || {})) byDate[d] = (byDate[d] || 0) + Number(v)
          } catch {}
        }
        for (const [d, v] of Object.entries(byDate)) entries.push({ pageId: pg.id, date: d, value: v })
      })
      if (entries.length) adspentStore.setMany(entries)
    } catch {}
  }

  async function handleSubmit(force = false, pages: typeof selectedPages = selectedPages) {
    if (pages.length === 0) return
    setSubmitted(true)
    setApplied({ from, to })   // lock the table to the range at submit time
    setAppliedPageIds(pages.map(p => p.id))   // snapshot pages — table shows these lang
    setErrors({})

    const fromStr = format(from, "yyyy-MM-dd")
    const toStr = format(to, "yyyy-MM-dd")
    syncAdspentFromFB(pages, fromStr, toStr)   // background — fills Ad Spent for the range

    // Serve fresh-cached pages instantly; only network-fetch the stale/missing ones.
    const cachedData: Record<string, PageData> = {}
    const toFetch = pages.filter(page => {
      const pageId = page.pancake_page_id || page.shop_id
      const c = ROAS_CACHE.get(`${pageId}|${fromStr}|${toStr}`)
      if (!force && c && Date.now() - c.ts < ROAS_TTL) { cachedData[page.id] = c.data; return false }
      return true
    })
    if (Object.keys(cachedData).length) setRealData(prev => ({ ...prev, ...cachedData }))
    if (toFetch.length === 0) { setLoading(false); return }  // fully cached → no spinner

    setLoading(true)
    const newData: Record<string, PageData> = {}
    const newErrors: Record<string, string> = {}
    await mapLimit(toFetch, 3, async page => {
      const pageId = page.pancake_page_id || page.shop_id
      if (!page.api_key || !pageId) {
        newErrors[page.id] = "Missing API Key or Pancake Page ID — go to Pages & Store to add them."
        newData[page.id] = {}
        return
      }
      try {
        const data = await fetchPageOrders(page.api_key, pageId, fromStr, toStr)
        newData[page.id] = data
        ROAS_CACHE.set(`${pageId}|${fromStr}|${toStr}`, { ts: Date.now(), data })
      } catch (e: any) {
        newErrors[page.id] = e?.message || "Failed to fetch data"
        newData[page.id] = {}
      }
    })

    setRealData(prev => ({ ...prev, ...newData }))
    setErrors(prev => ({ ...prev, ...newErrors }))
    setLoading(false)
  }

  // Persist the view so returning to the tab restores the selection + range + submitted state.
  useEffect(() => { roasView = { selectedPageIds, appliedPageIds, dateA, dateB, submitted, applied, tab } }, [selectedPageIds, appliedPageIds, dateA, dateB, submitted, applied, tab])

  // Page Report ay AGAD nakalabas: sa unang bisita, auto-load ang LAHAT ng active pages
  // (parang alt-tab — nandun na agad). Kung may naka-submit nang view, i-restore yun.
  const didRestore = useRef(false)
  useEffect(() => {
    if (didRestore.current || allPages.length === 0) return
    didRestore.current = true
    if (roasView?.submitted && (roasView.appliedPageIds?.length ?? 0) > 0) {
      const restored = allPages.filter(p => roasView!.appliedPageIds.includes(p.id))
      handleSubmit(false, restored)
      return
    }
    setSelectedPageIds(allPages.map(p => p.id))
    handleSubmit(false, allPages)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPages.length])


  function getRow(pageId: string, date: Date): DayData {
    const dateStr = format(date, "yyyy-MM-dd")
    const data = realData[pageId]?.[dateStr]
    const base = { ...emptyDay(), ...(data || {}) }
    // Ad Spent is entered per page+day (localStorage); ROAS = Sales ÷ Ad Spent.
    base.adspent = adspentStore.get(pageId, dateStr)
    base.vat = base.adspent * VAT_RATE
    // ROAS is computed against Ad Spent + VAT (the true ad cost).
    base.roas = base.sales > 0 && base.adspent > 0 ? base.sales / (base.adspent + base.vat) : 0
    base.cpp = base.orders > 0 ? base.adspent / base.orders : 0
    return base
  }

  // Per-page row data — real data only, no mocks. Rendered from the SUBMIT snapshot.
  const pageTableData = useMemo(() =>
    renderedPages.map(page => ({
      page,
      rows: dateRange.map(date => ({ date, ...getRow(page.id, date) })),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [renderedPages, dateRange, realData, adspentStore.map])

  // ── Per-page REPORT summary (one row per page, totals over the range) ──
  // ROAS = Sales ÷ Ad Spend (matches the reference sheet); VAT shown as its own column.
  const pageReport = useMemo(() => {
    const rows = pageTableData.map(({ page, rows }) => {
      const parcels = rows.reduce((s, r) => s + r.orders, 0)
      const adspent = rows.reduce((s, r) => s + r.adspent, 0)
      const vat = adspent * VAT_RATE
      const sales = rows.reduce((s, r) => s + r.sales, 0)
      const roas = adspent > 0 ? sales / adspent : 0
      return { page, parcels, adspent, vat, sales, roas }
    })
    // Mga may spent O sales lang ang lumalabas ng kusa (itago ang 0/0 na pages).
    .filter(r => r.adspent > 0 || r.sales > 0)
    rows.sort((a, b) => roasSort === "desc" ? b.roas - a.roas : a.roas - b.roas)
    return rows
  }, [pageTableData, roasSort])

  const reportTotal = useMemo(() => pageReport.reduce((a, r) => ({
    parcels: a.parcels + r.parcels, adspent: a.adspent + r.adspent, vat: a.vat + r.vat, sales: a.sales + r.sales,
  }), { parcels: 0, adspent: 0, vat: 0, sales: 0 }), [pageReport])
  const reportTotalRoas = reportTotal.adspent > 0 ? reportTotal.sales / reportTotal.adspent : 0

  // Aggregate totals across all selected pages per date
  const totalRows = useMemo(() =>
    dateRange.map(date => {
      const combined = pageTableData.map(pt => pt.rows.find(r => r.date.toDateString() === date.toDateString())!)
      return {
        date,
        orders: combined.reduce((s, r) => s + (r?.orders ?? 0), 0),
        sales: combined.reduce((s, r) => s + (r?.sales ?? 0), 0),
        adspent: combined.reduce((s, r) => s + (r?.adspent ?? 0), 0),
        vat: combined.reduce((s, r) => s + (r?.vat ?? 0), 0),
        shipped: combined.reduce((s, r) => s + (r?.shipped ?? 0), 0),
        inTransit: combined.reduce((s, r) => s + (r?.inTransit ?? 0), 0),
        onDelivery: combined.reduce((s, r) => s + (r?.onDelivery ?? 0), 0),
        onDeliveryAmount: combined.reduce((s, r) => s + (r?.onDeliveryAmount ?? 0), 0),
        returned: combined.reduce((s, r) => s + (r?.returned ?? 0), 0),
        delivered: combined.reduce((s, r) => s + (r?.delivered ?? 0), 0),
      }
    }),
    [pageTableData, dateRange])

  const grandTotal = useMemo(() => totalRows.reduce((acc, r) => ({
    orders: acc.orders + r.orders, sales: acc.sales + r.sales, adspent: acc.adspent + r.adspent, vat: acc.vat + r.vat,
    shipped: acc.shipped + r.shipped, inTransit: acc.inTransit + r.inTransit,
    onDelivery: acc.onDelivery + r.onDelivery, onDeliveryAmount: acc.onDeliveryAmount + r.onDeliveryAmount,
    returned: acc.returned + r.returned, delivered: acc.delivered + r.delivered,
  }), { orders: 0, sales: 0, adspent: 0, vat: 0, shipped: 0, inTransit: 0, onDelivery: 0, onDeliveryAmount: 0, returned: 0, delivered: 0 }), [totalRows])

  const grandRoas = grandTotal.adspent > 0 ? grandTotal.sales / (grandTotal.adspent + grandTotal.vat) : 0
  const n = dateRange.length || 1

  function toggleView(key: ToggleKey) {
    setViews(v => ({ ...v, [key]: !v[key] }))
  }

  const extraCols = [
    { key: "shippedOut" as ToggleKey, label: "Shipped Out" },
    { key: "inTransit" as ToggleKey, label: "In Transit" },
    { key: "onDelivery" as ToggleKey, label: "On Delivery" },
    { key: "returned" as ToggleKey, label: "Returned" },
    { key: "delivered" as ToggleKey, label: "Delivered" },
    { key: "cpp" as ToggleKey, label: "CPP" },
  ].filter(c => views[c.key])
  // On Delivery adds a paired "On Delivery Amt" column, so it counts as 2 columns for colSpan
  const extraColCount = extraCols.length + (views.onDelivery ? 1 : 0)
  const rnd = (x: number) => Math.round(x).toLocaleString("en-PH")  // whole-number display for count averages

  return (
    <div className="w-full space-y-4">
      <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 pb-4 mb-4 border-b border-slate-100">
        <Activity className="w-5 h-5" /> PAGE ROAS TRACKER
      </h1>

      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap gap-4 items-start">
          {/* Platform */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Platforms</label>
            <div className="relative">
              <select className="h-10 rounded-lg border border-gray-300 px-3 pr-8 text-sm text-gray-700 bg-white appearance-none min-w-[160px]"
                value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)}>
                <option value="All">All Platforms</option>
                {PLATFORMS.map(p => <option key={p}>{p}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {/* Page Status */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Page Status</label>
            <div className="relative">
              <select className="h-10 rounded-lg border border-gray-300 px-3 pr-8 text-sm text-gray-700 bg-white appearance-none min-w-[140px]"
                value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                {PAGE_STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {/* Owner */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Owner</label>
            <div className="relative">
              <select className="h-10 rounded-lg border border-gray-300 px-3 pr-8 text-sm text-gray-700 bg-white appearance-none min-w-[160px]"
                value={filterOwner} onChange={e => setFilterOwner(e.target.value)}>
                <option value="All">All Owners</option>
                {owners.map(o => <option key={o}>{o}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {/* Filter Page — searchable chip style */}
          <div className="flex flex-col gap-1 flex-1 min-w-[280px]">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Filter Page</label>
            <FilterPageDropdown options={availablePages} selected={selectedPageIds} onChange={setSelectedPageIds} />
          </div>

          {/* Date Range */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Date Range</label>
            <DateRangePicker a={dateA} b={dateB} variant="header"
              onApply={(a, b) => { setDateA(a || defaultDateA()); setDateB(b || defaultDateB()) }} placeholder="This month" />
          </div>

          {/* Submit */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide opacity-0 select-none">.</label>
            <div className="flex gap-2">
              <button
                onClick={() => handleSubmit()}
                disabled={loading || selectedPageIds.length === 0}
                className="h-10 px-6 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2">
                {loading && (
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                )}
                {loading ? "Fetching..." : "Submit"}
              </button>
              {submitted && (
                <button onClick={() => handleSubmit(true)} disabled={loading || selectedPageIds.length === 0} title="Refresh (bypass cache)"
                  className="h-10 px-3 rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                  <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* View toggles */}
        <div className="flex flex-wrap gap-5 pt-3 mt-3 border-t border-gray-100">
          {VIEW_TOGGLES.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={views[key]} onChange={() => toggleView(key)}
                className="w-4 h-4 rounded border-gray-300 accent-blue-600" />
              <span className="text-sm text-gray-600 font-medium">{label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Loading overlay */}
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/70">
          <div className="flex flex-col items-center gap-4">
            <div className="relative w-16 h-16">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="absolute w-3 h-3 rounded-full bg-blue-500"
                  style={{
                    top: `${50 - 38 * Math.cos((i * Math.PI * 2) / 8)}%`,
                    left: `${50 + 38 * Math.sin((i * Math.PI * 2) / 8)}%`,
                    transform: "translate(-50%,-50%)",
                    opacity: (i + 1) / 8,
                    animation: "spin-dot 0.8s linear infinite",
                    animationDelay: `${(i * 0.8) / 8}s`,
                  }}
                />
              ))}
            </div>
            <p className="text-sm text-slate-500 font-medium">Fetching orders from Pancake POS...</p>
          </div>
        </div>
      )}

      {/* API errors per page */}
      {Object.keys(errors).length > 0 && (
        <div className="space-y-2">
          {Object.entries(errors).map(([pageId, msg]) => {
            const pg = allPages.find(p => p.id === pageId)
            return (
              <div key={pageId} className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-start gap-2">
                <span className="font-semibold">{pg?.name ?? pageId}:</span> {msg}
              </div>
            )
          })}
        </div>
      )}

      {/* Empty state — walang naka-render (hindi pa nag-submit o walang pinili) */}
      {renderedPages.length === 0 && !loading && (
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
          <p className="text-gray-400 text-sm font-medium">
            {selectedPageIds.length === 0
              ? "Pumili ng pages (o Select all) at pindutin ang Submit para makita ang ROAS."
              : <>Pindutin ang <strong>Submit</strong> para i-load ang data mula sa Pancake POS.</>}
          </p>
        </div>
      )}

      {/* Results — Report tab (per-page summary) at Daily Breakdown tab */}
      {renderedPages.length > 0 && submitted && !loading && (
        <div className="space-y-4">
          {/* Tab switcher */}
          <div className="flex items-center gap-1">
            <button onClick={() => setTab("report")}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 ${tab === "report" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100 border border-slate-200"}`}>
              <BarChart3 className="w-4 h-4" /> Page Report
            </button>
            <button onClick={() => setTab("daily")}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 ${tab === "daily" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100 border border-slate-200"}`}>
              <CalendarDays className="w-4 h-4" /> Daily Breakdown
            </button>
          </div>

          {/* ── PAGE REPORT: one row per page, sortable by ROAS, with totals ── */}
          {tab === "report" && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden inline-block max-w-full align-top">
              <div className="overflow-auto max-h-[74vh]">
                <table className="w-auto text-sm border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-slate-800 text-white text-xs font-semibold uppercase tracking-wide">
                      <th className="px-4 py-2.5 text-left">Page</th>
                      <th className="px-4 py-2.5 text-right">Parcels</th>
                      <th className="px-4 py-2.5 text-right">Ad Spend</th>
                      <th className="px-4 py-2.5 text-right">VAT 12%</th>
                      <th className="px-4 py-2.5 text-right">Total Cost</th>
                      <th className="px-4 py-2.5 text-right">Sales</th>
                      <th className="px-4 py-2.5 text-right cursor-pointer select-none hover:bg-slate-700"
                        onClick={() => setRoasSort(s => s === "desc" ? "asc" : "desc")}
                        title="I-click para i-sort (highest ↔ lowest)">
                        <span className="inline-flex items-center gap-1">
                          ROAS <ArrowDownUp className="w-3.5 h-3.5 opacity-80" />
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pageReport.map(({ page, parcels, adspent, vat, sales, roas }) => {
                      const clr = colorForPage(page.id, colors)
                      return (
                        <tr key={page.id} className="hover:bg-slate-50" style={{ background: tint(clr, "0f") }}>
                          <td className="px-4 py-2.5 border-l-[3px] whitespace-nowrap" style={{ borderColor: clr }}>
                            <div className="flex items-center gap-2.5">
                              <label className="relative w-3 h-3 rounded-full flex-shrink-0 cursor-pointer ring-1 ring-black/10" style={{ background: clr }} title="Palitan ang kulay">
                                <input type="color" value={clr} onChange={e => setColor(page.id, e.target.value)}
                                  className="absolute inset-0 opacity-0 cursor-pointer" />
                              </label>
                              <span className="font-semibold text-slate-800">{page.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{parcels.toLocaleString("en-PH")}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{fmtPeso(adspent)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">{fmtPeso(vat)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{fmtPeso(adspent + vat)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-800">{fmtPeso(sales)}</td>
                          <td className="px-4 py-2.5 text-right">
                            <span className="inline-block rounded-md px-2.5 py-1 text-sm font-bold text-white tabular-nums min-w-[52px]" style={{ background: roasColor(roas) }}>
                              {roas > 0 ? roas.toFixed(2) : "—"}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot className="sticky bottom-0 z-10">
                    <tr className="bg-slate-100 font-bold text-slate-900 border-t-2 border-slate-300">
                      <td className="px-4 py-2.5 text-xs uppercase tracking-wide whitespace-nowrap">Total · {pageReport.length} page{pageReport.length === 1 ? "" : "s"}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{reportTotal.parcels.toLocaleString("en-PH")}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmtPeso(reportTotal.adspent)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{fmtPeso(reportTotal.vat)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{fmtPeso(reportTotal.adspent + reportTotal.vat)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmtPeso(reportTotal.sales)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="inline-block rounded-md px-2.5 py-1 text-sm font-bold text-white tabular-nums min-w-[52px]" style={{ background: roasColor(reportTotalRoas) }}>
                          {reportTotalRoas > 0 ? reportTotalRoas.toFixed(2) : "—"}
                        </span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="px-4 py-2 text-[11px] text-slate-400 border-t border-slate-100">
                ROAS = Sales ÷ Ad Spend · ⬤ swatch para palitan ang kulay · click ROAS header para i-sort · mga may spent/sales lang ang nakalista.
              </p>
            </div>
          )}

          {tab === "daily" && (
        <div className="overflow-auto rounded-xl max-h-[78vh]">
          <div className="flex gap-0 min-w-max border border-gray-200 rounded-xl overflow-hidden">

            {/* Per-page tables */}
            {pageTableData.map(({ page, rows }) => {
              const tot = rows.reduce((acc, r) => ({
                orders: acc.orders + r.orders, sales: acc.sales + r.sales, adspent: acc.adspent + r.adspent, vat: acc.vat + r.vat,
                shipped: acc.shipped + r.shipped, inTransit: acc.inTransit + r.inTransit,
                onDelivery: acc.onDelivery + r.onDelivery, onDeliveryAmount: acc.onDeliveryAmount + r.onDeliveryAmount,
                returned: acc.returned + r.returned, delivered: acc.delivered + r.delivered,
              }), { orders: 0, sales: 0, adspent: 0, vat: 0, shipped: 0, inTransit: 0, onDelivery: 0, onDeliveryAmount: 0, returned: 0, delivered: 0 })
              const totalRoas = tot.adspent > 0 ? tot.sales / (tot.adspent + tot.vat) : 0
              const avgOrders = tot.orders / n
              const avgSales = tot.sales / n
              const avgAdspent = tot.adspent / n
              const avgRoas = totalRoas

              return (
                <table key={page.id} className="border-r-2 border-gray-300 border-collapse flex-shrink-0">
                  {/* Page header */}
                  <thead className="sticky top-0 z-20">
                    <tr>
                      <th colSpan={6 + extraColCount}
                        className="bg-[#4a7eb5] text-white text-sm font-bold text-center py-2.5 px-4 border-b border-[#5b8fc7]">
                        {page.name}
                        {errors[page.id] && <span className="ml-2 text-yellow-300 text-xs font-normal">(⚠ {errors[page.id]})</span>}
                      </th>
                    </tr>
                    <tr className="bg-[#5b8fc7]">
                      <th className={TH_CLS}>Date</th>
                      <th className={TH_CLS}>Orders</th>
                      <th className={TH_CLS}>Sales</th>
                      <th className={TH_CLS}>Ad Spent</th>
                      <th className={TH_CLS}>VAT 12%</th>
                      <th className={TH_CLS}>ROAS</th>
                      {extraCols.map(c => c.key === "onDelivery"
                        ? <Fragment key={c.key}><th className={TH_CLS}>On Delivery Amt</th><th className={TH_CLS}>On Delivery</th></Fragment>
                        : <th key={c.key} className={TH_CLS}>{c.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={row.date.toISOString()} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                        <td className={`${TD_CLS} text-left whitespace-nowrap text-gray-700`}>{format(row.date, "yyyy-MM-dd")}</td>
                        <td className={`${TD_CLS} text-gray-700`}>{row.orders}</td>
                        <td className={`${TD_CLS} text-gray-700 whitespace-nowrap`}>{fmtPeso(row.sales)}</td>
                        <td className={`${TD_CLS} whitespace-nowrap tabular-nums`} style={{ color: "#2563eb" }}>{fmtPeso(row.adspent)}</td>
                        <td className={`${TD_CLS} text-gray-500 whitespace-nowrap`}>{row.vat > 0 ? fmtPeso(row.vat) : "0.00"}</td>
                        <td className={`${TD_CLS} font-semibold`} style={{ color: roasColor(row.roas) }}>{row.roas > 0 ? row.roas.toFixed(2) : "0"}</td>
                        {views.shippedOut && <td className={TD_CLS}>{row.shipped}</td>}
                        {views.inTransit && <td className={TD_CLS}>{row.inTransit}</td>}
                        {views.onDelivery && <td className={`${TD_CLS} text-gray-700 whitespace-nowrap`}>{fmtPeso(row.onDeliveryAmount)}</td>}
                        {views.onDelivery && <td className={TD_CLS}>{row.onDelivery}</td>}
                        {views.returned && <td className={TD_CLS}>{row.returned}</td>}
                        {views.delivered && <td className={TD_CLS}>{row.delivered}</td>}
                        {views.cpp && <td className={TD_CLS}>{fmtPeso(row.cpp)}</td>}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="sticky bottom-0 z-20">
                    <tr style={{ background: "#f5c842" }}>
                      <td className="px-3 py-2.5 text-xs font-bold text-gray-800 uppercase border-r border-[#e0b030]">Total Amount</td>
                      <td className="px-3 py-2.5 text-center text-sm font-bold text-gray-800 border-r border-[#e0b030]">{tot.orders}</td>
                      <td className="px-3 py-2.5 text-center text-sm font-bold text-gray-800 whitespace-nowrap border-r border-[#e0b030]">{fmtPeso(tot.sales)}</td>
                      <td className="px-3 py-2.5 text-center text-sm font-bold text-gray-800 whitespace-nowrap border-r border-[#e0b030]">{fmtPeso(tot.adspent)}</td>
                      <td className="px-3 py-2.5 text-center text-sm font-bold text-gray-700 whitespace-nowrap border-r border-[#e0b030]">{fmtPeso(tot.vat)}</td>
                      <td className="px-3 py-2.5 text-center text-sm font-bold border-r border-[#e0b030]" style={{ color: roasColor(totalRoas) }}>{totalRoas.toFixed(2)}</td>
                      {views.shippedOut && <td className="px-3 py-2.5 text-center text-sm font-bold text-gray-800 border-r border-[#e0b030]">{tot.shipped}</td>}
                      {views.inTransit && <td className="px-3 py-2.5 text-center text-sm font-bold text-gray-800 border-r border-[#e0b030]">{tot.inTransit}</td>}
                      {views.onDelivery && <td className="px-3 py-2.5 text-center text-sm font-bold text-gray-800 whitespace-nowrap border-r border-[#e0b030]">{fmtPeso(tot.onDeliveryAmount)}</td>}
                      {views.onDelivery && <td className="px-3 py-2.5 text-center text-sm font-bold text-gray-800 border-r border-[#e0b030]">{tot.onDelivery}</td>}
                      {views.returned && <td className="px-3 py-2.5 text-center text-sm font-bold text-gray-800 border-r border-[#e0b030]">{tot.returned}</td>}
                      {views.delivered && <td className="px-3 py-2.5 text-center text-sm font-bold text-gray-800 border-r border-[#e0b030]">{tot.delivered}</td>}
                      {views.cpp && <td className="px-3 py-2.5 text-center text-sm font-bold text-gray-800">{tot.orders > 0 ? fmtPeso(tot.adspent / tot.orders) : "0.00"}</td>}
                    </tr>
                    <tr style={{ background: "#1e293b" }}>
                      <td className="px-3 py-2.5 text-xs font-bold text-white uppercase border-r border-slate-600">Average</td>
                      <td className="px-3 py-2.5 text-center text-sm font-bold text-white border-r border-slate-600">{rnd(avgOrders)}</td>
                      <td className="px-3 py-2.5 text-center text-sm font-bold text-white whitespace-nowrap border-r border-slate-600">{fmtPeso(avgSales)}</td>
                      <td className="px-3 py-2.5 text-center text-sm font-bold text-white whitespace-nowrap border-r border-slate-600">{fmtPeso(avgAdspent)}</td>
                      <td className="px-3 py-2.5 text-center text-sm font-bold text-white whitespace-nowrap border-r border-slate-600">{fmtPeso(tot.vat / n)}</td>
                      <td className="px-3 py-2.5 text-center text-sm font-bold border-r border-slate-600" style={{ color: roasColor(avgRoas) }}>{avgRoas.toFixed(2)}</td>
                      {views.shippedOut && <td className="px-3 py-2.5 text-center text-sm font-bold text-white border-r border-slate-600">{rnd(tot.shipped / n)}</td>}
                      {views.inTransit && <td className="px-3 py-2.5 text-center text-sm font-bold text-white border-r border-slate-600">{rnd(tot.inTransit / n)}</td>}
                      {views.onDelivery && <td className="px-3 py-2.5 text-center text-sm font-bold text-white whitespace-nowrap border-r border-slate-600">{fmtPeso(tot.onDeliveryAmount / n)}</td>}
                      {views.onDelivery && <td className="px-3 py-2.5 text-center text-sm font-bold text-white border-r border-slate-600">{rnd(tot.onDelivery / n)}</td>}
                      {views.returned && <td className="px-3 py-2.5 text-center text-sm font-bold text-white border-r border-slate-600">{rnd(tot.returned / n)}</td>}
                      {views.delivered && <td className="px-3 py-2.5 text-center text-sm font-bold text-white border-r border-slate-600">{rnd(tot.delivered / n)}</td>}
                      {views.cpp && <td className="px-3 py-2.5 text-center text-sm font-bold text-white">{avgOrders > 0 ? fmtPeso(avgAdspent / avgOrders) : "0.00"}</td>}
                    </tr>
                  </tfoot>
                </table>
              )
            })}

            {/* TOTAL aggregate table — always shown when pages are selected */}
            <table className="border-collapse flex-shrink-0">
              <thead className="sticky top-0 z-20">
                <tr>
                  <th colSpan={5 + extraColCount}
                    className="bg-[#4a7eb5] text-white text-sm font-bold text-center py-2.5 px-4 border-b border-[#5b8fc7]">
                    TOTAL
                  </th>
                </tr>
                <tr className="bg-[#5b8fc7]">
                  <th className={TH_CLS}>Total Orders</th>
                  <th className={TH_CLS}>Total Orders Amount</th>
                  <th className={TH_CLS}>Total Ad Spent</th>
                  <th className={TH_CLS}>VAT 12%</th>
                  <th className={TH_CLS}>ROAS</th>
                  {extraCols.map(c => c.key === "onDelivery"
                    ? <Fragment key={c.key}><th className={TH_CLS}>On Delivery Amt</th><th className={TH_CLS}>On Delivery</th></Fragment>
                    : <th key={c.key} className={TH_CLS}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {totalRows.map((row, i) => {
                  const roas = row.adspent > 0 ? row.sales / (row.adspent + row.vat) : 0
                  return (
                    <tr key={row.date.toISOString()} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                      <td className={`${TD_CLS} text-gray-700`}>{row.orders}</td>
                      <td className={`${TD_CLS} text-gray-700 whitespace-nowrap`}>{fmtPeso(row.sales)}</td>
                      <td className={`${TD_CLS} whitespace-nowrap`} style={{ color: "#2563eb" }}>{fmtPeso(row.adspent)}</td>
                      <td className={`${TD_CLS} text-gray-500 whitespace-nowrap`}>{row.vat > 0 ? fmtPeso(row.vat) : "0.00"}</td>
                      <td className={`${TD_CLS} font-semibold`} style={{ color: roasColor(roas) }}>{roas > 0 ? roas.toFixed(2) : "0.00"}</td>
                      {views.shippedOut && <td className={TD_CLS}>{row.shipped}</td>}
                      {views.inTransit && <td className={TD_CLS}>{row.inTransit}</td>}
                      {views.onDelivery && <td className={`${TD_CLS} text-gray-700 whitespace-nowrap`}>{fmtPeso(row.onDeliveryAmount)}</td>}
                      {views.onDelivery && <td className={TD_CLS}>{row.onDelivery}</td>}
                      {views.returned && <td className={TD_CLS}>{row.returned}</td>}
                      {views.delivered && <td className={TD_CLS}>{row.delivered}</td>}
                      {views.cpp && <td className={TD_CLS}>{row.orders > 0 ? fmtPeso(row.adspent / row.orders) : "0.00"}</td>}
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="sticky bottom-0 z-20">
                <tr style={{ background: "#f5c842" }}>
                  <td className="px-3 py-2.5 text-center text-sm font-bold text-gray-800 border-r border-[#e0b030]">{grandTotal.orders}</td>
                  <td className="px-3 py-2.5 text-center text-sm font-bold text-gray-800 whitespace-nowrap border-r border-[#e0b030]">{fmtPeso(grandTotal.sales)}</td>
                  <td className="px-3 py-2.5 text-center text-sm font-bold text-gray-800 whitespace-nowrap border-r border-[#e0b030]">{fmtPeso(grandTotal.adspent)}</td>
                  <td className="px-3 py-2.5 text-center text-sm font-bold text-gray-700 whitespace-nowrap border-r border-[#e0b030]">{fmtPeso(grandTotal.vat)}</td>
                  <td className="px-3 py-2.5 text-center text-sm font-bold border-r border-[#e0b030]" style={{ color: roasColor(grandRoas) }}>{grandRoas.toFixed(2)}</td>
                  {views.shippedOut && <td className="px-3 py-2.5 text-center text-sm font-bold text-gray-800 border-r border-[#e0b030]">{grandTotal.shipped}</td>}
                  {views.inTransit && <td className="px-3 py-2.5 text-center text-sm font-bold text-gray-800 border-r border-[#e0b030]">{grandTotal.inTransit}</td>}
                  {views.onDelivery && <td className="px-3 py-2.5 text-center text-sm font-bold text-gray-800 whitespace-nowrap border-r border-[#e0b030]">{fmtPeso(grandTotal.onDeliveryAmount)}</td>}
                  {views.onDelivery && <td className="px-3 py-2.5 text-center text-sm font-bold text-gray-800 border-r border-[#e0b030]">{grandTotal.onDelivery}</td>}
                  {views.returned && <td className="px-3 py-2.5 text-center text-sm font-bold text-gray-800 border-r border-[#e0b030]">{grandTotal.returned}</td>}
                  {views.delivered && <td className="px-3 py-2.5 text-center text-sm font-bold text-gray-800 border-r border-[#e0b030]">{grandTotal.delivered}</td>}
                  {views.cpp && <td className="px-3 py-2.5 text-center text-sm font-bold text-gray-800">{grandTotal.orders > 0 ? fmtPeso(grandTotal.adspent / grandTotal.orders) : "0.00"}</td>}
                </tr>
                <tr style={{ background: "#1e293b" }}>
                  <td className="px-3 py-2.5 text-center text-sm font-bold text-white border-r border-slate-600">{rnd(grandTotal.orders / n)}</td>
                  <td className="px-3 py-2.5 text-center text-sm font-bold text-white whitespace-nowrap border-r border-slate-600">{fmtPeso(grandTotal.sales / n)}</td>
                  <td className="px-3 py-2.5 text-center text-sm font-bold text-white whitespace-nowrap border-r border-slate-600">{fmtPeso(grandTotal.adspent / n)}</td>
                  <td className="px-3 py-2.5 text-center text-sm font-bold text-white whitespace-nowrap border-r border-slate-600">{fmtPeso(grandTotal.vat / n)}</td>
                  <td className="px-3 py-2.5 text-center text-sm font-bold border-r border-slate-600" style={{ color: roasColor(grandRoas) }}>{grandRoas.toFixed(2)}</td>
                  {views.shippedOut && <td className="px-3 py-2.5 text-center text-sm font-bold text-white border-r border-slate-600">{rnd(grandTotal.shipped / n)}</td>}
                  {views.inTransit && <td className="px-3 py-2.5 text-center text-sm font-bold text-white border-r border-slate-600">{rnd(grandTotal.inTransit / n)}</td>}
                  {views.onDelivery && <td className="px-3 py-2.5 text-center text-sm font-bold text-white whitespace-nowrap border-r border-slate-600">{fmtPeso(grandTotal.onDeliveryAmount / n)}</td>}
                  {views.onDelivery && <td className="px-3 py-2.5 text-center text-sm font-bold text-white border-r border-slate-600">{rnd(grandTotal.onDelivery / n)}</td>}
                  {views.returned && <td className="px-3 py-2.5 text-center text-sm font-bold text-white border-r border-slate-600">{rnd(grandTotal.returned / n)}</td>}
                  {views.delivered && <td className="px-3 py-2.5 text-center text-sm font-bold text-white border-r border-slate-600">{rnd(grandTotal.delivered / n)}</td>}
                  {views.cpp && <td className="px-3 py-2.5 text-center text-sm font-bold text-white">{grandTotal.orders > 0 ? fmtPeso(grandTotal.adspent / grandTotal.orders) : "0.00"}</td>}
                </tr>
              </tfoot>
            </table>

          </div>
        </div>
          )}
        </div>
      )}

      <div className="pb-4" />
    </div>
  )
}
