"use client"
import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import { Activity, TrendingUp, ShoppingBag, Package, Truck, RotateCcw, AlertCircle, XCircle, ArrowDownUp, Clock, RefreshCw } from "lucide-react"
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns"
import { useActivePages } from "@/lib/pages-store"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import { cachedJson, PANCAKE_CONCURRENCY } from "@/lib/pancake-cache"

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
      className={`px-4 py-1.5 font-medium border-r border-slate-200 last:border-r-0 transition-colors ${active ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
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

interface OrdersResponse {
  byDate?: Record<string, DayData>
  statusCounts?: StatusGroup
  statusSales?: StatusGroup
  totalOrders?: number
  totalSales?: number
  courier?: { inTransitCount: number; inTransitSales: number; onDeliveryCount: number; onDeliverySales: number }
}

async function fetchOrders(
  apiKey: string, pageId: string, from: string, to: string, basis: string,
  phase: "fast" | "full" | "all" = "all", noCache = false, fields = ""
): Promise<OrdersResponse> {
  const json = await cachedJson(
    `/api/pancake/orders?api_key=${encodeURIComponent(apiKey)}&page_id=${encodeURIComponent(pageId)}`
    + `&from=${from}&to=${to}&basis=${encodeURIComponent(basis)}&phase=${phase}`
    + `${fields ? `&fields=${fields}` : ""}${noCache ? "&nocache=1" : ""}`,
    { force: noCache }
  )
  return json as OrdersResponse
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

    // ── PHASE 1 (FAST): headline + per-status cards from cheap aggregate calls (no pagination).
    // Paints the main cards in ~1 request's time instead of waiting for the full order pull.
    const fastAgg = emptyAgg()
    const lastMonthAgg = { count: 0, amount: 0 }
    await mapLimit(pages, PANCAKE_CONCURRENCY, async page => {
      const pageId = page.pancake_page_id || page.shop_id
      try {
        // "Today's Sales" = orders placed today (always sales-order/creation basis).
        // fields=total → 1 cheap call instead of the full per-status set.
        const todayData = fStr === todayStr && basisKey === "sales_order"
          ? null // comes from the main fetch below
          : fetchOrders(page.api_key, pageId, todayStr, todayStr, "sales_order", "fast", noCache, "total").catch(() => null)
        // Last-month Packaging (Unfulfilled), fired in parallel — fields=packaging → 1 cheap call.
        const lastMonthData = fetchOrders(page.api_key, pageId, lmFromStr, lmToStr, "sales_order", "fast", noCache, "packaging").catch(() => null)

        const { statusCounts, statusSales, totalOrders = 0, totalSales = 0 } =
          await fetchOrders(page.api_key, pageId, fStr, tStr, basisKey, "fast", noCache)

        if (todayData) {
          const td = await todayData
          if (td) { fastAgg.todayOrders += td.totalOrders ?? 0; fastAgg.todaySales += td.totalSales ?? 0 }
        } else {
          fastAgg.todayOrders += totalOrders
          fastAgg.todaySales += totalSales
        }

        const lm = await lastMonthData
        if (lm?.statusCounts) {
          lastMonthAgg.count += lm.statusCounts.unfulfilled        // unfulfilled == packaging
          lastMonthAgg.amount += lm.statusSales?.unfulfilled ?? 0
        }

        fastAgg.totalOrders += totalOrders
        fastAgg.totalSales += totalSales
        if (statusCounts) {
          fastAgg.shipped += statusCounts.shipped
          fastAgg.delivered += statusCounts.delivered
          fastAgg.returning += statusCounts.returning
          fastAgg.returned += statusCounts.returned
          fastAgg.cancelled += statusCounts.cancelled
          fastAgg.fulfilled += statusCounts.fulfilled
          fastAgg.unfulfilled += statusCounts.unfulfilled
        }
        if (statusSales) {
          fastAgg.shippedSales += statusSales.shipped
          fastAgg.deliveredSales += statusSales.delivered
          fastAgg.returningSales += statusSales.returning
          fastAgg.returnedSales += statusSales.returned
          fastAgg.fulfilledSales += statusSales.fulfilled
          fastAgg.unfulfilledSales += statusSales.unfulfilled
        }
      } catch (e: any) {
        errs.push(`${page.name}: ${e?.message || "Failed"}`)
      }
    })

    setAgg(fastAgg)  // In-Transit/On-Delivery stay 0 until phase 2 patches them
    setLastMonthUnfulfilled(lastMonthAgg)
    setFetchErrors(errs)
    setLastFetched(format(new Date(), "MMM dd, yyyy h:mm a"))
    setLoading(false)

    // ── PHASE 2 (FULL): pagination-derived data — In-Transit/On-Delivery tallies + daily breakdown.
    const newDaily: DailyData = {}
    let inTransit = 0, inTransitSales = 0, onDelivery = 0, onDeliverySales = 0
    await mapLimit(pages, PANCAKE_CONCURRENCY, async page => {
      const pageId = page.pancake_page_id || page.shop_id
      try {
        const { byDate, courier } = await fetchOrders(page.api_key, pageId, fStr, tStr, basisKey, "full", noCache)
        for (const [date, d] of Object.entries(byDate ?? {})) {
          if (!newDaily[date]) newDaily[date] = { count: 0, amount: 0 }
          newDaily[date].count += d.orders
          newDaily[date].amount += d.sales
        }
        if (courier) {
          inTransit += courier.inTransitCount; inTransitSales += courier.inTransitSales
          onDelivery += courier.onDeliveryCount; onDeliverySales += courier.onDeliverySales
        }
      } catch {
        // headline cards already shown; surface detail-phase issues quietly
      }
    })

    setAgg(prev => ({ ...prev, inTransit, inTransitSales, onDelivery, onDeliverySales }))
    setDailyData(newDaily)
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

  return (
    <div className="w-full space-y-4">

      {/* Title + Date */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-4 mb-1 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Activity className="w-5 h-5" /> SALES WAREHOUSE LOGISTICS</h1>
          {loading && (
            <div className="flex items-center gap-1.5 text-xs text-blue-600">
              <RefreshCw className="w-3 h-3 animate-spin" />
              <span>Loading...</span>
            </div>
          )}
          {!loading && lastFetched && (
            <span className="text-xs text-slate-400">Updated {lastFetched}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker a={dateA} b={dateB} variant="header"
            onApply={(a, b) => { setDateA(a || defaultDateA()); setDateB(b || defaultDateB()) }} placeholder="This month" />
          <button onClick={loadData} disabled={loading} title="Refresh"
            className="flex items-center justify-center h-9 w-9 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shadow-sm disabled:opacity-50">
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

      {/* No pages with credentials */}
      {pagesWithCreds.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center text-sm text-amber-700">
          No pages with API credentials found. Go to <strong>Pages &amp; Store</strong> and add your Pancake API Key and Page ID.
        </div>
      )}

      {/* TODAY'S SALES */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="relative overflow-hidden bg-slate-800 rounded-xl px-4 py-3 cursor-pointer hover:opacity-90 transition-opacity flex items-center justify-between h-[78px]">
          <div className="absolute left-0 top-0 bottom-0 flex items-center pointer-events-none select-none">
            <ShoppingBag strokeWidth={1} className="w-16 h-16 opacity-[0.08] text-white -ml-2" />
          </div>
          <div className="text-right ml-auto z-10">
            <p className="text-2xl font-bold text-white leading-none">{fmtPeso(agg.todaySales)}</p>
            <p className="text-[11px] text-white/70 font-semibold mt-1 tracking-wider uppercase leading-tight">TODAY&apos;S SALES ({agg.todayOrders})</p>
          </div>
        </div>
      </div>

      {/* Divider + As of label */}
      <div>
        <hr className="border-slate-200" />
        <p className="text-xs text-slate-500 font-medium mt-2">{asOfLabel}</p>
      </div>

      {/* Total Sales / Fulfilled / Unfulfilled */}
      <div className="grid grid-cols-3 gap-2.5">
        {[
          { label: "TOTAL SALES", count: agg.totalOrders, amount: agg.totalSales, color: "bg-blue-500", icon: TrendingUp },
          { label: "FULFILLED", count: agg.fulfilled, amount: agg.fulfilledSales, color: "bg-emerald-500", icon: Package },
          { label: "UNFULFILLED", count: agg.unfulfilled, amount: agg.unfulfilledSales, color: "bg-amber-400", icon: Clock },
        ].map(card => (
          <div key={card.label}
            onClick={card.label === "TOTAL SALES" ? () => setSalesModalOpen(true) : undefined}
            className={`relative overflow-hidden ${card.color} rounded-xl px-4 py-3 cursor-pointer hover:opacity-90 transition-opacity flex items-center justify-between h-[78px]`}>
            <div className="absolute left-0 top-0 bottom-0 flex items-center pointer-events-none select-none">
              <card.icon strokeWidth={1} className="w-16 h-16 opacity-[0.08] text-white -ml-2" />
            </div>
            <div className="text-right ml-auto z-10">
              <p className="text-2xl font-bold text-white leading-none">{fmtPeso(card.amount)}</p>
              <p className="text-[11px] text-white/70 font-semibold mt-1 tracking-wider uppercase leading-tight">{card.label} ({card.count})</p>
            </div>
          </div>
        ))}
      </div>

      {/* Divider + Parcel filter */}
      <div>
        <hr className="border-slate-200" />
        <div className="flex justify-end mt-3">
          <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden bg-white text-xs">
            {PARCEL_FILTERS.map(f => (
              <FilterButton key={f} label={f} active={parcelFilter === f} onClick={() => setParcelFilter(f)} />
            ))}
          </div>
        </div>
      </div>

      {/* Parcel Status 3x3 */}
      <div className="grid grid-cols-3 gap-2.5">
        {[
          { label: "SHIPPED OUT", sub: "Shippedout, Pick-Up", count: agg.shipped, amount: agg.shippedSales, color: "bg-teal-500", pct: null, icon: Truck },
          { label: "ODZ / INCOMPLETE", sub: null, count: 0, amount: 0, color: "bg-slate-500", pct: null, icon: AlertCircle },
          { label: "UNFULFILLED / LAST MONTH", sub: "Packaging — previous month", count: lastMonthUnfulfilled.count, amount: lastMonthUnfulfilled.amount, color: "bg-blue-400", pct: null, icon: Clock },
          { label: "IN-TRANSIT", sub: "In-Transit, Problematic", count: agg.inTransit, amount: agg.inTransitSales, color: "bg-teal-600", pct: null, icon: Truck },
          { label: "ON-DELIVERY", sub: "On-Delivery, Delivering", count: agg.onDelivery, amount: agg.onDeliverySales, color: "bg-orange-500", pct: null, icon: Truck },
          { label: "DELIVERED", sub: null, count: agg.delivered, amount: agg.deliveredSales, color: "bg-purple-500", pct: deliveredPct, icon: Package },
          { label: "FOR RETURN", sub: "Returning — pabalik palang", count: agg.returning, amount: agg.returningSales, color: "bg-orange-400", pct: null, icon: RotateCcw },
          { label: "RETURNED", sub: "Nakabalik na sa warehouse", count: agg.returned, amount: agg.returnedSales, color: "bg-red-500", pct: null, icon: XCircle },
          { label: "TOTAL RTS", sub: null, count: totalRTS, amount: totalRTSSales, color: "bg-red-600", pct: rtsPct, icon: ArrowDownUp },
        ].map(card => {
          // In-Transit / On-Delivery come from the slower full phase — show a spinner until ready
          const isDetail = card.label === "IN-TRANSIT" || card.label === "ON-DELIVERY"
          const pending = isDetail && loadingDetails
          return (
          <div key={card.label}
            className={`relative overflow-hidden ${card.color} rounded-xl px-4 py-3 cursor-pointer hover:opacity-90 transition-opacity flex items-center justify-between h-[78px]`}>
            <div className="absolute left-0 top-0 bottom-0 flex items-center pointer-events-none select-none">
              <card.icon strokeWidth={1} className="w-16 h-16 opacity-[0.08] text-white -ml-2" />
            </div>
            <div className="text-right ml-auto z-10">
              {pending
                ? <RefreshCw className="w-5 h-5 text-white/80 animate-spin ml-auto" />
                : <p className="text-2xl font-bold text-white leading-none">{fmtPeso(card.amount)}</p>}
              <p className="text-[11px] text-white/70 font-semibold mt-1 tracking-wider uppercase leading-tight">
                {card.label} ({pending ? "…" : card.count}){card.pct ? <span className="ml-1 font-bold">{card.pct}</span> : null}
              </p>
            </div>
          </div>
          )
        })}
      </div>

      {/* Total Sales breakdown modal */}
      {salesModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setSalesModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-bold text-blue-600 tracking-wide">TOTAL SALES</h2>
                <p className="text-xs text-red-500 mt-0.5">**Reserves are excluded, while cancellations are included.</p>
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

            {/* Fixed TOTAL footer — shrink-0 so it always shows all rows, no nested scroll */}
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
