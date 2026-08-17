"use client"
import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import { Activity, TrendingUp, ShoppingBag, Package, Truck, RotateCcw, AlertCircle, XCircle, ArrowDownUp, Clock, RefreshCw } from "lucide-react"
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns"
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts"
import { useActivePages } from "@/lib/pages-store"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import { cachedJson, PANCAKE_CONCURRENCY } from "@/lib/pancake-cache"
import { StatCard, ChartPanel, Skeleton, LoadingBar } from "@/components/ui/dash"

function defaultDateA() { return format(startOfMonth(new Date()), "yyyy-MM-dd") }
function defaultDateB() { return format(new Date(), "yyyy-MM-dd") }

const PARCEL_FILTERS = ["Parcel Status Date", "Shipped out Date", "Sales Order Date"]

// UI date-basis label → Pancake API `basis` key (resolved server-side to an updateStatus value)
const BASIS_KEY: Record<string, string> = {
  "Sales Order Date": "sales_order",     // inserted_at — sales/marketing performance
  "Shipped out Date": "shipped_out",     // partner_inserted_at — warehouse shipping output
  "Parcel Status Date": "parcel_status", // -1 (last status update) — courier/delivery performance
}

// Hover-tooltip copy explaining what each date basis means
const FILTER_TOOLTIPS: Record<string, { title: string; body: string; example: string }> = {
  "Parcel Status Date": {
    title: "Parcel Status Date",
    body: "Used to check courier movement/status.",
    example: "Example: Even if the order was placed on May 28, if the courier updated the status on June 5 as “On the way” or “Delivered,” it should be included in the June 1–30 report.",
  },
  "Shipped out Date": {
    title: "Shipped Out Date",
    body: "Used to check how many orders were shipped by the warehouse within June 1–30.",
    example: "Example: If the warehouse shipped the order on June 3, it should be included even if the order was created on a different date.",
  },
  "Sales Order Date": {
    title: "Sales Order Date",
    body: "Used to check sales performance based on the order creation date in the Sales Tracker.",
    example: "Example: If the order was created on June 10, it should be included in June sales even if it was delivered in July.",
  },
}

// A date-basis filter button with a 2s-delay hover tooltip (smooth fade-in, fades out on leave).
// The tooltip is portaled to <body> and uses fixed positioning so it isn't clipped by the
// button group's `overflow-hidden`, and is clamped to stay within the viewport.
function FilterButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  const tip = FILTER_TOOLTIPS[label]
  const btnRef = useRef<HTMLButtonElement>(null)
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [rendered, setRendered] = useState(false)  // mounted in DOM
  const [visible, setVisible] = useState(false)     // opacity (drives the fade)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  function handleEnter() {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    enterTimer.current = setTimeout(() => {
      const r = btnRef.current?.getBoundingClientRect()
      if (r) {
        const tipW = 256, margin = 8, half = tipW / 2
        const left = Math.max(half + margin, Math.min(r.left + r.width / 2, window.innerWidth - half - margin))
        setPos({ left, top: r.bottom + 8 })
      }
      setRendered(true)
      // double rAF so the element paints at opacity-0 first, then transitions in
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
    }, 2000)
  }

  function handleLeave() {
    if (enterTimer.current) clearTimeout(enterTimer.current)
    setVisible(false)
    leaveTimer.current = setTimeout(() => setRendered(false), 200)  // unmount after fade-out
  }

  useEffect(() => () => {
    if (enterTimer.current) clearTimeout(enterTimer.current)
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
  }, [])

  return (
    <button ref={btnRef} onClick={onClick} onMouseEnter={handleEnter} onMouseLeave={handleLeave}
      className={`px-4 py-1.5 font-medium border-r border-slate-200 last:border-r-0 whitespace-nowrap transition-colors ${active ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
      {label}
      {rendered && pos && tip && typeof document !== "undefined" && createPortal(
        <div style={{ position: "fixed", left: pos.left, top: pos.top, transform: "translateX(-50%)" }}
          className={`z-[60] w-64 pointer-events-none transition-opacity duration-200 ease-out ${visible ? "opacity-100" : "opacity-0"}`}>
          <div className="bg-slate-900 text-white rounded-lg shadow-xl p-3 text-left normal-case">
            <p className="text-[11px] font-bold tracking-wide">{tip.title}</p>
            <p className="text-[11px] text-white/85 font-normal mt-1 leading-snug">{tip.body}</p>
            <p className="text-[10px] text-white/60 font-normal mt-1.5 leading-snug">{tip.example}</p>
          </div>
        </div>,
        document.body
      )}
    </button>
  )
}
function fmtPeso(n: number) {
  return "₱ " + n.toLocaleString("en-PH", { minimumFractionDigits: 2 })
}

// Plain amount (no ₱) to match Pancake's Total Sales report table
function fmtAmount(n: number) {
  return n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Fixed row template for the Total Sales breakdown modal.
// "Sales" is computed from real data; the other four are placeholders (0) until
// the reserve / cancellation-reason field mapping is verified against live Pancake data.
const SALES_BREAKDOWN_LABELS = [
  "Sales",
  "Reserved",
  "Cancelled by Warehouse",
  "Cancelled by Customer",
  "Reserved & Cancelled",
] as const

// Per-day Sales totals (Parcel count + COD amount), keyed by YYYY-MM-DD
type DailyData = Record<string, { count: number; amount: number }>

interface DayData {
  orders: number; sales: number; shipped: number; inTransit: number
  onDelivery: number; returning: number; returned: number; delivered: number
}

interface AggData {
  todayOrders: number; todaySales: number
  totalOrders: number; totalSales: number
  shipped: number; inTransit: number; onDelivery: number; delivered: number
  returning: number; returned: number; cancelled: number; fulfilled: number; unfulfilled: number
  // peso sales per status
  shippedSales: number; inTransitSales: number; onDeliverySales: number; deliveredSales: number
  returningSales: number; returnedSales: number; fulfilledSales: number; unfulfilledSales: number
}

function emptyAgg(): AggData {
  return {
    todayOrders: 0, todaySales: 0,
    totalOrders: 0, totalSales: 0,
    shipped: 0, inTransit: 0, onDelivery: 0, delivered: 0,
    returning: 0, returned: 0, cancelled: 0, fulfilled: 0, unfulfilled: 0,
    shippedSales: 0, inTransitSales: 0, onDeliverySales: 0, deliveredSales: 0,
    returningSales: 0, returnedSales: 0, fulfilledSales: 0, unfulfilledSales: 0,
  }
}

interface StatusGroup {
  total: number; shipped: number; inTransit: number; onDelivery: number
  delivered: number; returning: number; returned: number; cancelled: number
  fulfilled: number; unfulfilled: number
}

// Per-status na bilang + halaga na kinuwenta mula sa BAWAT order (phase=full), kaya
// nadaanan ng 100× na SCALE guard at hindi kasama ang kanselado. Ito ang pinagmumulan
// ng lahat ng perang ipinapakita — HINDI ang `statusSales` na galing sa aggregate.
interface ExactTotals {
  totalOrders: number; totalSales: number
  shipped: number; shippedSales: number
  delivered: number; deliveredSales: number
  returning: number; returningSales: number
  returned: number; returnedSales: number
  packaging: number; packagingSales: number
  waiting: number; waitingSales: number
  fulfilled: number; fulfilledSales: number
  unfulfilled: number; unfulfilledSales: number
  cancelled: number; cancelledSales: number
  inTransit: number; inTransitSales: number
  onDelivery: number; onDeliverySales: number
  rescaledOrders: number; rescaledExcess: number
}

interface OrdersResponse {
  byDate?: Record<string, DayData>
  statusCounts?: StatusGroup
  statusSales?: StatusGroup
  totalOrders?: number
  totalSales?: number
  courier?: { inTransitCount: number; inTransitSales: number; onDeliveryCount: number; onDeliverySales: number }
  exact?: ExactTotals
  truncated?: boolean
}

async function fetchOrders(
  apiKey: string, pageId: string, from: string, to: string, basis: string,
  phase: "fast" | "full" | "all" = "all", noCache = false, fields = "", status = ""
): Promise<OrdersResponse> {
  const json = await cachedJson(
    `/api/pancake/orders?api_key=${encodeURIComponent(apiKey)}&page_id=${encodeURIComponent(pageId)}`
    + `&from=${from}&to=${to}&basis=${encodeURIComponent(basis)}&phase=${phase}`
    + `${fields ? `&fields=${fields}` : ""}${status ? `&status=${status}` : ""}${noCache ? "&nocache=1" : ""}`,
    { force: noCache }
  )
  return json as OrdersResponse
}

function addExact(acc: AggData, e: ExactTotals) {
  acc.totalOrders += e.totalOrders; acc.totalSales += e.totalSales
  acc.shipped += e.shipped; acc.shippedSales += e.shippedSales
  acc.delivered += e.delivered; acc.deliveredSales += e.deliveredSales
  acc.returning += e.returning; acc.returningSales += e.returningSales
  acc.returned += e.returned; acc.returnedSales += e.returnedSales
  acc.cancelled += e.cancelled
  acc.fulfilled += e.fulfilled; acc.fulfilledSales += e.fulfilledSales
  acc.unfulfilled += e.unfulfilled; acc.unfulfilledSales += e.unfulfilledSales
  acc.inTransit += e.inTransit; acc.inTransitSales += e.inTransitSales
  acc.onDelivery += e.onDelivery; acc.onDeliverySales += e.onDeliverySales
}

// Run async work over items with a concurrency cap — avoids bursting Pancake's rate limit
// (which returns 403 and made even valid pages look disconnected).
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++])
  })
  await Promise.all(workers)
}


export default function BusinessDashboardPage() {
  const allPages = useActivePages()
  const [dateA, setDateA] = useState(defaultDateA())
  const [dateB, setDateB] = useState(defaultDateB())
  const [parcelFilter, setParcelFilter] = useState("Sales Order Date")
  const [loading, setLoading] = useState(false)              // headline/per-status cards (fast phase)
  const [loadingDetails, setLoadingDetails] = useState(false) // In-Transit/On-Delivery + daily breakdown (full phase)
  const [agg, setAgg] = useState<AggData>(emptyAgg())
  // Unfulfilled (Packaging, status 8) for the PREVIOUS calendar month — independent of the selected range
  const [lastMonthUnfulfilled, setLastMonthUnfulfilled] = useState<{ count: number; amount: number }>({ count: 0, amount: 0 })
  const [dailyData, setDailyData] = useState<DailyData>({})
  // Mga order na may 100×-na-halaga mula sa Pancake at itinuwid sa pagbasa — ipinapakita
  // para hindi tahimik ang pagtutuwid at para mahanap at maayos ang order sa Pancake mismo.
  const [rescaled, setRescaled] = useState<{ orders: number; excess: number }>({ orders: 0, excess: 0 })
  // Lumampas ang saklaw sa pagination cap → kulang ang halaga. Binabalaan, hindi tinatago.
  const [truncated, setTruncated] = useState(false)
  const [salesModalOpen, setSalesModalOpen] = useState(false)
  const [fetchErrors, setFetchErrors] = useState<string[]>([])
  const [lastFetched, setLastFetched] = useState<string | null>(null)

  const from = useMemo(() => new Date(dateA), [dateA])
  const to = useMemo(() => new Date(dateB), [dateB])

  const asOfLabel = useMemo(() => {
    return `As of ${format(from, "MMM.dd")} - ${format(to, "MMM.dd, yyyy")}`
  }, [from, to])

  const pagesWithCreds = useMemo(() =>
    allPages.filter(p => p.api_key && (p.pancake_page_id || p.shop_id)),
    [allPages])

  // Stable primitive deps to avoid infinite loop (objects change reference every render)
  const fromStr = format(from, "yyyy-MM-dd")
  const toStr = format(to, "yyyy-MM-dd")
  // Include the credentials in the key so editing/fixing an API key or Page ID re-triggers the
  // auto-fetch effect below — restoring a corrected key reconnects and reloads automatically.
  const pageIdsKey = pagesWithCreds.map(p => `${p.id}:${p.api_key}:${p.pancake_page_id || p.shop_id}`).join(",")

  const runFetch = useCallback(async (pages: typeof pagesWithCreds, fStr: string, tStr: string, basisKey: string, noCache = false) => {
    if (pages.length === 0) return
    setLoading(true)
    setLoadingDetails(true)
    setFetchErrors([])

    const todayStr = format(new Date(), "yyyy-MM-dd")
    // Previous calendar month — for the "Unfulfilled / Last Month" (Packaging) card.
    // Always sales-order (creation) basis: packaging orders aren't shipped yet, so other
    // bases (e.g. shipped-out) would read ~0.
    const lastMonth = subMonths(new Date(), 1)
    const lmFromStr = format(startOfMonth(lastMonth), "yyyy-MM-dd")
    const lmToStr = format(endOfMonth(lastMonth), "yyyy-MM-dd")
    const errs: string[] = []

    // ── PHASE 1 (FAST): BILANG lamang, mula sa murang aggregate (walang pagination).
    // Awtoritatibo ang bilang (total_entries) at hindi ito naaapektuhan ng 100× na bug,
    // kaya agad itong maipipinta. Ang PERA ay sinasadyang iniiwang hindi pa ipinapakita
    // hanggang dumating ang phase 2 — mas mabuti nang maghintay kaysa magpakita ng
    // halagang mali (hanggang 2.6× ang taas, nasukat Ago 6 2026).
    const fastAgg = emptyAgg()
    await mapLimit(pages, PANCAKE_CONCURRENCY, async page => {
      const pageId = page.pancake_page_id || page.shop_id
      try {
        const { statusCounts } = await fetchOrders(page.api_key, pageId, fStr, tStr, basisKey, "fast", noCache)
        if (statusCounts) {
          // Ang kanselado ay hindi kita — tinatanggal agad sa Total Sales.
          fastAgg.totalOrders += statusCounts.total - statusCounts.cancelled
          fastAgg.shipped += statusCounts.shipped
          fastAgg.delivered += statusCounts.delivered
          fastAgg.returning += statusCounts.returning
          fastAgg.returned += statusCounts.returned
          fastAgg.cancelled += statusCounts.cancelled
          fastAgg.fulfilled += statusCounts.fulfilled
          fastAgg.unfulfilled += statusCounts.unfulfilled
        }
      } catch (e: any) {
        errs.push(`${page.name}: ${e?.message || "Failed"}`)
      }
    })

    setAgg(fastAgg)
    setFetchErrors(errs)
    setLastFetched(format(new Date(), "MMM dd, yyyy h:mm a"))
    setLoading(false)

    // ── PHASE 2 (FULL): lahat ng PERA, kinuwenta mula sa bawat order kaya na-descale.
    // Tatlong saklaw ang hinihila kada page:
    //   • ang piniling saklaw   — lahat ng card + araw-araw na breakdown
    //   • ngayong araw          — "Today's Sales" (laging creation basis)
    //   • nakaraang buwan (st 8)— "Unfulfilled / Last Month"; naka-filter sa status kaya
    //                             ilang page lang ang hinihila, hindi ang buong buwan
    const newDaily: DailyData = {}
    const exactAgg = emptyAgg()
    const lastMonthAgg = { count: 0, amount: 0 }
    let rescaledOrders = 0, rescaledExcess = 0, truncated = false

    await mapLimit(pages, PANCAKE_CONCURRENCY, async page => {
      const pageId = page.pancake_page_id || page.shop_id
      try {
        const [main, today, lm] = await Promise.all([
          fetchOrders(page.api_key, pageId, fStr, tStr, basisKey, "full", noCache),
          fetchOrders(page.api_key, pageId, todayStr, todayStr, "sales_order", "full", noCache).catch(() => null),
          fetchOrders(page.api_key, pageId, lmFromStr, lmToStr, "sales_order", "full", noCache, "", "8").catch(() => null),
        ])

        for (const [date, d] of Object.entries(main.byDate ?? {})) {
          if (!newDaily[date]) newDaily[date] = { count: 0, amount: 0 }
          newDaily[date].count += d.orders
          newDaily[date].amount += d.sales
        }
        if (main.exact) {
          addExact(exactAgg, main.exact)
          rescaledOrders += main.exact.rescaledOrders
          rescaledExcess += main.exact.rescaledExcess
        }
        if (main.truncated) truncated = true

        if (today?.exact) {
          exactAgg.todayOrders += today.exact.totalOrders
          exactAgg.todaySales += today.exact.totalSales
        }
        if (lm?.exact) {
          lastMonthAgg.count += lm.exact.packaging
          lastMonthAgg.amount += lm.exact.packagingSales
        }
      } catch {
        // nakapinta na ang bilang; tahimik na hahayaan ang detalye
      }
    })

    // Ipinapalit ang BUONG agg — dito na galing ang bilang at ang halaga, kaya laging
    // magkatugma ang dalawa (at ang TOTAL SALES card sa sarili nitong breakdown modal).
    setAgg(exactAgg)
    setLastMonthUnfulfilled(lastMonthAgg)
    setDailyData(newDaily)
    setRescaled({ orders: rescaledOrders, excess: rescaledExcess })
    setTruncated(truncated)
    setLoadingDetails(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const basisKey = BASIS_KEY[parcelFilter] ?? "sales_order"

  // Auto-fetch when date range, page list, or date basis changes — use primitive deps only
  useEffect(() => {
    runFetch(pagesWithCreds, fromStr, toStr, basisKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromStr, toStr, pageIdsKey, basisKey])

  // Refresh button bypasses the 60s server cache for guaranteed-fresh data.
  function loadData() { runFetch(pagesWithCreds, fromStr, toStr, basisKey, true) }

  const totalRTS = agg.returning + agg.returned
  const totalRTSSales = agg.returningSales + agg.returnedSales

  // Sorted per-day rows for the Total Sales breakdown modal
  const dailyRows = useMemo(
    () => Object.entries(dailyData)
      .map(([date, d]) => ({ date, count: d.count, amount: d.amount }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    [dailyData]
  )
  const salesTotal = useMemo(
    () => dailyRows.reduce((acc, r) => ({ count: acc.count + r.count, amount: acc.amount + r.amount }), { count: 0, amount: 0 }),
    [dailyRows]
  )
  const deliveredPct = agg.totalOrders > 0 ? ((agg.delivered / agg.totalOrders) * 100).toFixed(2) + "%" : "0%"
  const rtsPct = agg.totalOrders > 0 ? ((totalRTS / agg.totalOrders) * 100).toFixed(2) + "%" : "0%"

  // ── ANG MGA CHART ────────────────────────────────────────────────────────
  // ⚠ WALANG BAGONG HILA. Ang dalawang chart sa ibaba ay binubuo mula sa
  // `dailyData` at `agg` na NASA STATE NA — ang mga numerong pinipinta na ng
  // mga card at ng breakdown modal. Kaya walang dagdag na request kay Pancake,
  // at IMPOSIBLENG hindi tumugma ang chart sa card: iisa ang pinagmulan.
  const trendData = useMemo(() => dailyRows.map(r => ({
    // "08-14" — ang taon ay hindi kailangan sa axis, at kumakain ng lapad sa cellphone.
    day: r.date.slice(5),
    amount: r.amount,
    parcels: r.count,
  })), [dailyRows])

  // Ang bawat hakbang ng parcel, sa PAGKAKASUNOD ng tunay na paglalakbay —
  // hindi ayon sa laki. Ang hugis ng pagbaba ang kuwento: saan nauubos.
  const funnelData = useMemo(() => [
    { name: "Shipped", count: agg.shipped, amount: agg.shippedSales, fill: "#14b8a6" },
    { name: "In-Transit", count: agg.inTransit, amount: agg.inTransitSales, fill: "#0d9488" },
    { name: "On-Delivery", count: agg.onDelivery, amount: agg.onDeliverySales, fill: "#f97316" },
    { name: "Delivered", count: agg.delivered, amount: agg.deliveredSales, fill: "#a855f7" },
    { name: "For Return", count: agg.returning, amount: agg.returningSales, fill: "#fb923c" },
    { name: "Returned", count: agg.returned, amount: agg.returnedSales, fill: "#ef4444" },
  ], [agg])
  const funnelHasData = funnelData.some(d => d.count > 0)

  return (
    <div className="w-full space-y-4">

      {/* Title + Date. Ang gumagapang na guhit sa ilalim ang tanda ng paghila —
          nasa gilid ng pahina, hindi sa gitna ng datos, kaya hindi ito nakakaabala
          habang binabasa mo ang mga numerong dumating na. */}
      <div className="relative flex items-center justify-between flex-wrap gap-2 pb-4 mb-1 border-b border-slate-100">
        <LoadingBar show={loading || loadingDetails} />
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-base sm:text-lg font-bold text-blue-600 flex items-center gap-2 tracking-tight">
            <span className="grid place-items-center w-7 h-7 rounded-lg bg-blue-500/10 text-blue-600 shrink-0">
              <Activity className="w-4 h-4" />
            </span>
            <span className="truncate">SALES WAREHOUSE LOGISTICS</span>
          </h1>
          {(loading || loadingDetails) && (
            <span className="hidden sm:inline text-xs text-blue-600 font-medium">
              {loading ? "Counting orders…" : "Computing amounts…"}
            </span>
          )}
          {!loading && !loadingDetails && lastFetched && (
            <span className="hidden sm:inline text-xs text-slate-400 whitespace-nowrap">Updated {lastFetched}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker a={dateA} b={dateB} variant="header"
            onApply={(a, b) => { setDateA(a || defaultDateA()); setDateB(b || defaultDateB()) }} placeholder="This month" />
          <button onClick={loadData} disabled={loading} title="Refresh"
            className="flex items-center justify-center h-9 w-9 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300 shadow-sm disabled:opacity-50 transition-colors active:scale-95">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Connection error alert */}
      {fetchErrors.length > 0 && (
        <div className="bg-red-50 border border-red-300 rounded-xl p-3 flex items-start gap-2.5">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="text-sm font-bold text-red-700">Connection Issue</p>
            {fetchErrors.map((e, i) => (
              <p key={i} className="text-xs text-red-600">{e}</p>
            ))}
          </div>
        </div>
      )}

      {/* Naitama ang 100×-na-halaga — sinasabi kung ilan at magkano, para mahanap at
          maayos ang order sa Pancake mismo imbes na tahimik na itinatago ang pagkakamali. */}
      {!loadingDetails && rescaled.orders > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 flex items-start gap-2.5">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="text-sm font-bold text-amber-800">
              {rescaled.orders} order{rescaled.orders === 1 ? "" : "s"} na 100× ang halaga sa Pancake — naitama sa pagbasa
            </p>
            <p className="text-xs text-amber-700">
              Kung hindi ito naitama, mas mataas sana ng <strong>{fmtPeso(rescaled.excess)}</strong> ang ipinapakita rito.
              Sira ang naka-imbak sa Pancake, hindi ang presyo — ayusin doon para tumugma ang lahat ng report.
            </p>
          </div>
        </div>
      )}

      {/* Lumampas sa pagination cap — KULANG ang halaga, kaya sinasabi agad. */}
      {!loadingDetails && truncated && (
        <div className="bg-red-50 border border-red-300 rounded-xl p-3 flex items-start gap-2.5">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="text-sm font-bold text-red-700">Sobrang haba ng saklaw — kulang ang halaga</p>
            <p className="text-xs text-red-600">
              Lumampas sa 20,000 order ang napiling saklaw, kaya hindi lahat ay nabasa. Mas <strong>mababa</strong> sa
              totoo ang mga halaga rito. Paikliin ang saklaw para tumpak.
            </p>
          </div>
        </div>
      )}

      {/* No pages with credentials */}
      {pagesWithCreds.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center text-sm text-amber-700">
          No pages with API credentials found. Go to <strong>Pages &amp; Store</strong> and add your Pancake API Key and Page ID.
        </div>
      )}

      {/* TODAY'S SALES — isang card lang ito, kaya buong lapad sa cellphone at
          1/3 lang sa desktop (para tumugma sa hanay sa ilalim). */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <StatCard label="TODAY'S SALES" color="bg-slate-800" icon={ShoppingBag}
          raw={agg.todaySales} format={fmtPeso} value={fmtPeso(agg.todaySales)}
          meta={loadingDetails ? "…" : String(agg.todayOrders)}
          loading={loadingDetails} index={0} />
      </div>

      {/* Divider + As of label */}
      <div>
        <hr className="border-slate-200" />
        <p className="text-xs text-slate-500 font-medium mt-2">{asOfLabel}</p>
      </div>

      {/* Total Sales / Fulfilled / Unfulfilled — 2 kada hanay sa cellphone,
          kapareho ng Warehouse dashboard (hindi 3: hindi kasya ang halaga sa
          ~110px na kolum sa 375px na screen). */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {[
          { label: "TOTAL SALES", count: agg.totalOrders, amount: agg.totalSales, color: "bg-blue-500", icon: TrendingUp },
          { label: "FULFILLED", count: agg.fulfilled, amount: agg.fulfilledSales, color: "bg-emerald-500", icon: Package },
          { label: "UNFULFILLED", count: agg.unfulfilled, amount: agg.unfulfilledSales, color: "bg-amber-400", icon: Clock },
        ].map((card, i) => (
          // Ang bilang ay handa na sa phase 1; ang halaga ay naghihintay sa tumpak
          // na pagkuwenta ng phase 2 imbes na magpakita ng aggregate na mali.
          <StatCard key={card.label} label={card.label} color={card.color} icon={card.icon}
            raw={card.amount} format={fmtPeso} value={fmtPeso(card.amount)}
            meta={String(card.count)} loading={loadingDetails} index={i + 1}
            onClick={card.label === "TOTAL SALES" ? () => setSalesModalOpen(true) : undefined}
            title={card.label === "TOTAL SALES" ? "Open the per-day breakdown" : undefined} />
        ))}
      </div>

      {/* Divider + Parcel filter */}
      <div>
        <hr className="border-slate-200" />
        {/* Sa cellphone, ang hanay ng filter ay pwedeng lumampas sa lapad —
            pinapayagan ang pahalang na scroll sa loob nito imbes na sirain
            ang buong layout. */}
        <div className="flex sm:justify-end mt-3 -mx-1 px-1 overflow-x-auto scrollbar-dark">
          <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden bg-white text-xs shrink-0">
            {PARCEL_FILTERS.map(f => (
              <FilterButton key={f} label={f} active={parcelFilter === f} onClick={() => setParcelFilter(f)} />
            ))}
          </div>
        </div>
      </div>

      {/* Parcel Status — 3×3 sa desktop, 2 kada hanay sa cellphone */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {[
          { label: "SHIPPED OUT", sub: "Shippedout, Pick-Up", count: agg.shipped, amount: agg.shippedSales, color: "bg-teal-500", pct: null, icon: Truck, late: false },
          { label: "ODZ / INCOMPLETE", sub: null, count: 0, amount: 0, color: "bg-slate-500", pct: null, icon: AlertCircle, late: false },
          { label: "UNFULFILLED / LAST MONTH", sub: "Packaging — previous month", count: lastMonthUnfulfilled.count, amount: lastMonthUnfulfilled.amount, color: "bg-blue-400", pct: null, icon: Clock, late: true },
          { label: "IN-TRANSIT", sub: "In-Transit, Problematic", count: agg.inTransit, amount: agg.inTransitSales, color: "bg-teal-600", pct: null, icon: Truck, late: true },
          { label: "ON-DELIVERY", sub: "On-Delivery, Delivering", count: agg.onDelivery, amount: agg.onDeliverySales, color: "bg-orange-500", pct: null, icon: Truck, late: true },
          { label: "DELIVERED", sub: null, count: agg.delivered, amount: agg.deliveredSales, color: "bg-purple-500", pct: deliveredPct, icon: Package, late: false },
          { label: "FOR RETURN", sub: "Returning — pabalik palang", count: agg.returning, amount: agg.returningSales, color: "bg-orange-400", pct: null, icon: RotateCcw, late: false },
          { label: "RETURNED", sub: "Back in the warehouse", count: agg.returned, amount: agg.returnedSales, color: "bg-red-500", pct: null, icon: XCircle, late: false },
          { label: "TOTAL RTS", sub: null, count: totalRTS, amount: totalRTSSales, color: "bg-red-600", pct: rtsPct, icon: ArrowDownUp, late: false },
        ].map((card, i) => {
          // Lahat ng HALAGA ay galing sa phase 2 (doon lang natutuwid ang 100×). Ang BILANG
          // naman ay handa na sa phase 1 maliban sa mga naka-`late` — courier sub-status at
          // ang nakaraang buwan, na pagination lang ang makapagsasabi.
          const pending = loadingDetails
          const countPending = card.late && loadingDetails
          return (
            <StatCard key={card.label} label={card.label} color={card.color} icon={card.icon}
              raw={card.amount} format={fmtPeso} value={fmtPeso(card.amount)}
              meta={countPending ? "…" : String(card.count)} pct={card.pct}
              loading={pending} index={i} title={card.sub || undefined} />
          )
        })}
      </div>

      {/* ── MGA CHART — SARADO SA SIMULA ───────────────────────────────────
          Hiling ng may-ari (Ago 18 2026): idagdag pero itago. Kaya hindi lang
          nakatago — HINDI NAKA-MOUNT hangga't hindi binubuksan, kaya walang
          Recharts na nagtatrabaho para sa bagay na walang nakakakita. Ang
          pinili mo ay naaalala sa browser na ito. */}
      <div className="space-y-2.5">
        <ChartPanel title="Sales per day" storageKey="pw_dash_trend"
          subtitle={`${trendData.length} day${trendData.length === 1 ? "" : "s"} in range · amount and parcel count`}>
          {loadingDetails ? (
            <Skeleton className="h-[220px] w-full text-slate-400" />
          ) : trendData.length === 0 ? (
            <p className="text-sm text-slate-400 italic py-8 text-center">No sales in the selected range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={trendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="pwSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={16} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={56}
                  tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} />
                <Tooltip formatter={(v: any, n: any) => n === "amount" ? fmtPeso(Number(v)) : `${v} parcels`}
                  labelFormatter={(l: any) => `Day ${l}`} />
                <Area type="monotone" dataKey="amount" stroke="#3b82f6" strokeWidth={2}
                  fill="url(#pwSales)" animationDuration={520} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>

        <ChartPanel title="Parcel journey" storageKey="pw_dash_funnel"
          subtitle="Where parcels are, in travel order — the shape of the drop-off is the story">
          {loadingDetails ? (
            <Skeleton className="h-[220px] w-full text-slate-400" />
          ) : !funnelHasData ? (
            <p className="text-sm text-slate-400 italic py-8 text-center">No parcel movement in the selected range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={funnelData} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={84} />
                <Tooltip formatter={(v: any, _n: any, p: any) => [`${v} parcels · ${fmtPeso(p.payload.amount)}`, p.payload.name]} />
                <Bar dataKey="count" radius={[0, 5, 5, 0]} animationDuration={520}>
                  {funnelData.map(d => <Cell key={d.name} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>
      </div>

      {/* Total Sales breakdown modal */}
      {salesModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-3 sm:p-4"
          onClick={() => setSalesModalOpen(false)}>
          <div className="pw-rise bg-white rounded-xl shadow-2xl ring-1 ring-black/5 w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-bold text-blue-600 tracking-wide">TOTAL SALES</h2>
                <p className="text-xs text-red-500 mt-0.5">**Hindi kasama ang reserves at ang mga kanselado.</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{asOfLabel}</p>
              </div>
              <button onClick={() => setSalesModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-xl leading-none -mt-1 px-1">✕</button>
            </div>

            {/* Scrollable table */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              <table className="w-full text-sm border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-blue-500 text-white text-left">
                    <th className="px-4 py-2.5 font-semibold">Date</th>
                    <th className="px-4 py-2.5 font-semibold">Label</th>
                    <th className="px-4 py-2.5 font-semibold">Parcel</th>
                    <th className="px-4 py-2.5 font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyRows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                        {loadingDetails
                          ? <span className="inline-flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Loading daily breakdown…</span>
                          : "No sales data for the selected range."}
                      </td>
                    </tr>
                  )}
                  {dailyRows.map(row => (
                    SALES_BREAKDOWN_LABELS.map((label, i) => {
                      const isSales = label === "Sales"
                      const parcel = isSales ? row.count : 0
                      const amount = isSales ? row.amount : 0
                      return (
                        <tr key={`${row.date}-${label}`} className="border-b border-slate-100">
                          {i === 0 && (
                            <td rowSpan={SALES_BREAKDOWN_LABELS.length}
                              className="px-4 py-2.5 align-top font-medium text-slate-700 border-r border-slate-100 whitespace-nowrap">
                              {row.date}
                            </td>
                          )}
                          <td className="px-4 py-2.5 text-slate-600">{label}</td>
                          <td className="px-4 py-2.5 text-slate-600">{parcel}</td>
                          <td className="px-4 py-2.5 text-slate-600">{fmtAmount(amount)}</td>
                        </tr>
                      )
                    })
                  ))}
                </tbody>
              </table>
            </div>

            {/* Fixed TOTAL footer — shrink-0 so it always shows all rows, no nested scroll.
                ⚠ `bg-yellow-100` ay may dark rule na (badge tint + singsing), kaya
                hindi na ito nagiging nakakasilaw na dilaw na bloke sa madilim. */}
            <div className="shrink-0 border-t-2 border-slate-300 bg-yellow-100">
              <table className="w-full text-sm border-collapse">
                <tbody>
                  {SALES_BREAKDOWN_LABELS.map((label, i) => {
                    const isSales = label === "Sales"
                    const parcel = isSales ? salesTotal.count : 0
                    const amount = isSales ? salesTotal.amount : 0
                    return (
                      <tr key={`total-${label}`} className="border-b border-yellow-200 last:border-b-0">
                        {i === 0 && (
                          <td rowSpan={SALES_BREAKDOWN_LABELS.length}
                            className="px-4 py-2 align-top font-bold text-slate-800 border-r border-yellow-200 whitespace-nowrap">
                            TOTAL
                          </td>
                        )}
                        <td className="px-4 py-2 font-bold text-slate-800">{label}</td>
                        <td className="px-4 py-2 font-bold text-slate-800">{parcel}</td>
                        <td className="px-4 py-2 font-bold text-slate-800">{fmtAmount(amount)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Close button */}
            <div className="flex justify-end px-5 py-3 border-t border-slate-200 bg-white">
              <button onClick={() => setSalesModalOpen(false)}
                className="h-8 px-4 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm font-medium text-slate-700">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="pb-4" />
    </div>
  )
}
