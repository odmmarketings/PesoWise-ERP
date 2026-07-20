"use client"
import { useState, useMemo, useEffect, useRef } from "react"
import { DollarSign, ChevronDown } from "lucide-react"
import {
  format, startOfMonth, eachDayOfInterval,
} from "date-fns"
import { useActivePages } from "@/lib/pages-store"
import { useAdspent } from "@/lib/adspent-store"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"

function defaultDateA() { return format(startOfMonth(new Date()), "yyyy-MM-dd") }
function defaultDateB() { return format(new Date(), "yyyy-MM-dd") }

function fmt2(n: number) {
  return n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Real per-day data (order count + COD amount) from Pancake POS for one page.
// Uses the `full` phase of the shared proxy route — it returns the byDate breakdown.
async function fetchPageByDate(apiKey: string, pageId: string, from: string, to: string) {
  const res = await fetch(
    `/api/pancake/orders?api_key=${encodeURIComponent(apiKey)}&page_id=${encodeURIComponent(pageId)}`
    + `&from=${from}&to=${to}&phase=full`,
    { cache: "no-store" }
  )
  const json = await res.json()
  if (!res.ok || !json.success) {
    const detail = json.detail ? ` — ${json.detail}` : ""
    throw new Error((json.error || "API error") + detail)
  }
  const byDate = (json.byDate ?? {}) as Record<string, { orders: number; sales: number }>
  const out: Record<string, { orders: number; amount: number }> = {}
  for (const [d, v] of Object.entries(byDate)) out[d] = { orders: v.orders, amount: v.sales }
  return out
}

// Run async work with a concurrency cap to avoid bursting Pancake's rate limit (403 throttling).
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++])
  })
  await Promise.all(workers)
}

// Shown wherever ad-spend-derived data isn't available from the API yet
const TO_FOLLOW = <span className="text-gray-400 italic font-normal">To Follow</span>
function roasColor(roas: number) {
  if (roas > 4.9) return "#16a34a"
  if (roas >= 3) return "#d97706"
  return "#dc2626"
}
const VAT_RATE = 0.12   // 12% VAT on Ad Spend

// Module-level cache (survives navigation away/back) keyed by pages+range.
const ADSPENT_CACHE = new Map<string, { ts: number; data: Record<string, { orders: number; amount: number }>; from: Date; to: Date }>()
const ADSPENT_TTL = 5 * 60_000

export default function AdspentROASSummaryPage() {
  const allPages = useActivePages()
  const adspentStore = useAdspent()
  const [dateA, setDateA] = useState(defaultDateA())
  const [dateB, setDateB] = useState(defaultDateB())
  const [filterOwner, setFilterOwner] = useState("All")
  const [loading, setLoading] = useState(false)
  const [realData, setRealData] = useState<Record<string, { orders: number; amount: number }>>({})
  const [errors, setErrors] = useState<string[]>([])
  // The range whose data is currently displayed = the LAST range fetched (via Summary or the
  // initial auto-load). Decoupled from the live date picker, so changing the picker doesn't
  // alter the table until the user clicks Summary again. null = nothing loaded yet.
  const [appliedRange, setAppliedRange] = useState<{ from: Date; to: Date } | null>(null)

  const from = useMemo(() => new Date(dateA), [dateA])
  const to = useMemo(() => new Date(dateB), [dateB])

  const owners = useMemo(() => Array.from(new Set(allPages.map(p => p.owner).filter(Boolean))).sort(), [allPages])

  // Only pages with working API access (api_key + a Pancake/shop id), narrowed by Owner filter
  const pagesWithCreds = useMemo(() =>
    allPages.filter(p => p.api_key && (p.pancake_page_id || p.shop_id) && (filterOwner === "All" || p.owner === filterOwner)),
    [allPages, filterOwner])
  const pageIdsKey = pagesWithCreds.map(p => p.id).join(",")

  async function handleSummary(force = false) {
    if (pagesWithCreds.length === 0) return

    const rangeFrom = from, rangeTo = to
    const fromStr = format(rangeFrom, "yyyy-MM-dd")
    const toStr = format(rangeTo, "yyyy-MM-dd")
    const cacheKey = `${pageIdsKey}|${fromStr}|${toStr}`

    // Serve from cache instantly if fresh.
    const cached = ADSPENT_CACHE.get(cacheKey)
    if (!force && cached && Date.now() - cached.ts < ADSPENT_TTL) {
      setRealData(cached.data); setErrors([]); setAppliedRange({ from: cached.from, to: cached.to }); setLoading(false)
      return
    }

    setLoading(true)
    setErrors([])
    const merged: Record<string, { orders: number; amount: number }> = {}
    const errs: string[] = []

    await mapLimit(pagesWithCreds, 3, async page => {
      const pageId = page.pancake_page_id || page.shop_id
      try {
        const data = await fetchPageByDate(page.api_key, pageId, fromStr, toStr)
        for (const [d, v] of Object.entries(data)) {
          if (!merged[d]) merged[d] = { orders: 0, amount: 0 }
          merged[d].orders += v.orders
          merged[d].amount += v.amount
        }
      } catch (e: any) {
        errs.push(`${page.name}: ${e?.message || "Failed to fetch"}`)
      }
    })

    setRealData(merged)
    setErrors(errs)
    setAppliedRange({ from: rangeFrom, to: rangeTo })
    ADSPENT_CACHE.set(cacheKey, { ts: Date.now(), data: merged, from: rangeFrom, to: rangeTo })
    setLoading(false)
  }

  // Auto-load once when a connected page is available — uses the cache, so returning to the
  // tab is instant (no re-fetch) while the cache is fresh.
  const didAutoLoad = useRef(false)
  useEffect(() => {
    if (didAutoLoad.current || pagesWithCreds.length === 0) return
    didAutoLoad.current = true
    handleSummary()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIdsKey])

  // Real rows for the APPLIED (last-fetched) range — one row per day, real order count + COD amount only.
  const pageIds = useMemo(() => pagesWithCreds.map(p => p.id), [pagesWithCreds])

  const rows = useMemo(() => {
    if (!appliedRange) return []
    return eachDayOfInterval({ start: appliedRange.from, end: appliedRange.to }).map(date => {
      const key = format(date, "yyyy-MM-dd")
      const d = realData[key]
      const orders = d?.orders ?? 0, amount = d?.amount ?? 0
      // Total Ad Spent for the day = sum of every connected page's per-page ad spend (entered in the ROAS Tracker).
      const adspent = adspentStore.totalForDate(pageIds, key)
      const vat = adspent * VAT_RATE
      // ROAS computed against Ad Spent + VAT.
      const roas = amount > 0 && adspent > 0 ? amount / (adspent + vat) : 0
      return { date, orders, amount, adspent, vat, roas }
    })
  }, [appliedRange, realData, adspentStore.map, pageIds])

  const totals = useMemo(() => rows.reduce((acc, r) => ({
    orders: acc.orders + r.orders,
    amount: acc.amount + r.amount,
    adspent: acc.adspent + r.adspent,
    vat: acc.vat + r.vat,
  }), { orders: 0, amount: 0, adspent: 0, vat: 0 }), [rows])
  const totalRoas = totals.amount > 0 && totals.adspent > 0 ? totals.amount / (totals.adspent + totals.vat) : 0

  const n = rows.length || 1

  const TH = "px-4 py-2.5 text-xs font-bold text-white uppercase tracking-wide text-left border-r border-[#5b8fc7] last:border-r-0"
  const TD = "px-4 py-2 text-sm border-r border-gray-100 last:border-r-0"

  return (
    <div className="w-full space-y-5">
      {/* Header */}
      <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 pb-4 mb-4 border-b border-slate-100">
        <DollarSign className="w-5 h-5" /> ADSPENT ROAS SUMMARY
      </h1>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap items-end gap-4">
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
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Date Range</label>
            <DateRangePicker a={dateA} b={dateB} variant="header"
              onApply={(a, b) => { setDateA(a || defaultDateA()); setDateB(b || defaultDateB()) }} placeholder="This month" />
          </div>
          <button
            onClick={() => handleSummary(true)}
            disabled={loading || pagesWithCreds.length === 0}
            className="h-10 px-8 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2">
            {loading && (
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            )}
            {loading ? "Loading..." : "Summary"}
          </button>
        </div>
      </div>

      {/* Loading overlay (same effect as the ROAS Tracker) */}
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

      {/* API errors */}
      {errors.length > 0 && (
        <div className="space-y-2">
          {errors.map((msg, i) => (
            <div key={i} className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
              {msg}
            </div>
          ))}
        </div>
      )}

      {/* No connected page */}
      {pagesWithCreds.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
          <p className="text-gray-400 text-sm font-medium">No connected page with API access. Add credentials in Pages &amp; Store first.</p>
        </div>
      )}

      {/* Prompt: nothing loaded yet (e.g. initial auto-load still pending) */}
      {pagesWithCreds.length > 0 && !appliedRange && !loading && (
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
          <p className="text-gray-400 text-sm font-medium">Click <strong>Summary</strong> to load the report.</p>
        </div>
      )}

      {/* Table */}
      {appliedRange && !loading && rows.length > 0 && (
        <div className="rounded-xl border border-gray-200 overflow-auto max-h-[78vh] inline-block max-w-full align-top">
          <table className="w-auto border-collapse text-sm">
            <thead className="sticky top-0 z-20">
              {/* Span header */}
              <tr>
                <th className="bg-[#4a7eb5] text-white text-xs font-bold uppercase tracking-wide px-4 py-2.5 text-left border-r border-[#5b8fc7] w-36">
                  {/* empty — date column */}
                </th>
                <th colSpan={5} className="bg-[#4a7eb5] text-white text-sm font-bold text-center py-2.5 border-b border-[#5b8fc7]">
                  TOTAL
                </th>
              </tr>
              <tr className="bg-[#5b8fc7]">
                <th className={TH}>Date</th>
                <th className={TH}>Total Orders</th>
                <th className={TH}>Total Orders Amount</th>
                <th className={TH}>Total Ad Spent</th>
                <th className={TH}>VAT 12%</th>
                <th className="px-4 py-2.5 text-xs font-bold text-white uppercase tracking-wide text-left">ROAS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row, i) => (
                <tr key={row.date.toISOString()} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                  <td className={`${TD} font-medium text-gray-700`}>{format(row.date, "yyyy-MM-dd")}</td>
                  <td className={`${TD} text-gray-700`}>{row.orders > 0 ? row.orders : ""}</td>
                  <td className={`${TD} text-gray-700`}>{fmt2(row.amount)}</td>
                  <td className={`${TD} text-blue-600 font-medium`}>{row.adspent > 0 ? fmt2(row.adspent) : ""}</td>
                  <td className={`${TD} text-gray-500`}>{row.vat > 0 ? fmt2(row.vat) : ""}</td>
                  <td className="px-4 py-2 text-sm font-semibold" style={{ color: roasColor(row.roas) }}>{row.roas > 0 ? row.roas.toFixed(2) : ""}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 z-20">
              {/* Total Amount row */}
              <tr style={{ background: "#f5c842" }}>
                <td className="px-4 py-2.5 text-xs font-bold text-gray-800 uppercase border-r border-[#e0b030]">Total Amount</td>
                <td className="px-4 py-2.5 text-sm font-bold text-gray-800 border-r border-[#e0b030]">{totals.orders}</td>
                <td className="px-4 py-2.5 text-sm font-bold text-gray-800 border-r border-[#e0b030]">{fmt2(totals.amount)}</td>
                <td className="px-4 py-2.5 text-sm font-bold text-gray-800 border-r border-[#e0b030]">{totals.adspent > 0 ? fmt2(totals.adspent) : TO_FOLLOW}</td>
                <td className="px-4 py-2.5 text-sm font-bold text-gray-700 border-r border-[#e0b030]">{totals.vat > 0 ? fmt2(totals.vat) : TO_FOLLOW}</td>
                <td className="px-4 py-2.5 text-sm font-bold" style={{ color: totalRoas > 0 ? roasColor(totalRoas) : undefined }}>{totalRoas > 0 ? totalRoas.toFixed(2) : TO_FOLLOW}</td>
              </tr>
              {/* Average row */}
              <tr style={{ background: "#1e293b" }}>
                <td className="px-4 py-2.5 text-xs font-bold text-white uppercase border-r border-slate-600">Average</td>
                <td className="px-4 py-2.5 text-sm font-bold text-white border-r border-slate-600">{fmt2(totals.orders / n)}</td>
                <td className="px-4 py-2.5 text-sm font-bold text-white border-r border-slate-600">{fmt2(totals.amount / n)}</td>
                <td className="px-4 py-2.5 text-sm font-bold text-white border-r border-slate-600">{totals.adspent > 0 ? fmt2(totals.adspent / n) : TO_FOLLOW}</td>
                <td className="px-4 py-2.5 text-sm font-bold text-white border-r border-slate-600">{totals.vat > 0 ? fmt2(totals.vat / n) : TO_FOLLOW}</td>
                <td className="px-4 py-2.5 text-sm font-bold text-white">{totalRoas > 0 ? totalRoas.toFixed(2) : TO_FOLLOW}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="pb-4" />
    </div>
  )
}
