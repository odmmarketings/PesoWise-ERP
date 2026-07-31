"use client"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import * as XLSX from "xlsx-js-style"
import {
  ScanBarcode, RefreshCw, FileSpreadsheet, PackageCheck, Truck, AlertTriangle,
  ClipboardList, CalendarDays, CheckCircle2, Search,
} from "lucide-react"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import { useActivePages } from "@/lib/pages-store"
import { useShippedOutScans } from "@/lib/shipped-out-store"
import { cachedJson, PANCAKE_CONCURRENCY } from "@/lib/pancake-cache"
import { courierOf, COURIERS, COURIER_COLOR } from "@/lib/courier"
import { StatCardsSkeleton, TableSkeleton } from "@/components/business/Skeleton"

// ──────────────────────────────────────────────────────────────────────────────
// PPW — PENDING PRINTED WAYBILL. Ang tanong na sinasagot nito: ILAN ANG NAIWANG
// PARCEL NA MAY NAKADIKIT NANG WAYBILL PERO HINDI PA NAKUKUHA NG COURIER?
//
// Batay sa manual na PPW sheet ng warehouse:
//   • IN  = na-print/nadikit na ang waybill  → sa Pancake: may tracking_no na ang order
//   • OUT = nakuha na ng courier             → sa Pancake: umabot na sa Shipped/Delivered
//   • PPW = IN − OUT                          → may tracking PERO hindi pa nakakaalis
// Kaya hindi na kailangang mag-encode araw-araw — kusang lumalabas ang balanse.
//
// Pangalawang tab = FULFILLED PARCEL REPORT (FP): ilan talaga ang naipadala kada
// courier, may cross-check laban sa aktwal na Shipped Out scans.
// ──────────────────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0")
const dstr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01` }
const num = (n: number) => (isFinite(n) ? n : 0).toLocaleString("en-PH")
const peso = (n: number) => "₱" + (isFinite(n) ? n : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// Gaano kalayo ang hahanapin ng PPW. DATI 90 — pero 22 pages × 90 araw ay ~13 MINUTO
// bago matapos (40s median kada tawag sa Pancake), kaya hindi na natatapos mag-load ang
// page. 30 araw ang sapat: ang PPW ay parcel na HINDI PA nakukuha, at kung 30+ araw na
// nakabinbin ang isang waybill, hindi na iyon "pending" — problema na iyon at lalabas
// pa rin sa 3+ araw (stale) na aging bucket.
const PPW_LOOKBACK_DAYS = 30

async function fetchPageRows(apiKey: string, pageId: string, from: string, to: string, basis: string, noCache = false): Promise<any[]> {
  const json = await cachedJson(
    `/api/pancake/orders?api_key=${encodeURIComponent(apiKey)}&page_id=${encodeURIComponent(pageId)}`
    + `&from=${from}&to=${to}&phase=rows&basis=${basis}${noCache ? "&nocache=1" : ""}`,
    { force: noCache }
  )
  return Array.isArray(json.rows) ? json.rows : []
}
async function mapLimit<T>(items: T[], limit: number, fn: (i: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) await fn(items[i++]) }))
}

const STATUS_MATCH: { l: string; match: string[] }[] = [
  { l: "New", match: ["new"] },
  { l: "Restocking", match: ["waitting", "restock"] },
  { l: "Prioritize Order", match: ["priorit"] },
  { l: "Confirmed", match: ["submitted", "confirm"] },
  { l: "Packaging", match: ["packing", "packag"] },
  { l: "Waiting for Pick Up", match: ["pending", "wait"] },
  { l: "Shipped", match: ["shipped"] },
  { l: "Delivered", match: ["delivered"] },
  { l: "Returning", match: ["returning"] },
  { l: "Returned", match: ["returned"] },
  { l: "Cancelled", match: ["cancel"] },
  { l: "Deleted", match: ["delete", "remove"] },
]
const statusLabel = (raw: string): string => {
  const s = String(raw || "").toLowerCase()
  if (!s) return "—"
  for (const o of STATUS_MATCH) if (o.match.some(m => s.includes(m))) return o.l
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}
// Nakaalis na o hindi na dapat bilangin bilang naiwan.
const GONE = new Set(["Shipped", "Delivered", "Returning", "Returned", "Cancelled", "Deleted"])

function CourierBadge({ courier, tracking }: { courier: string; tracking?: string }) {
  const l = courierOf(courier, tracking)
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold"
      style={{ background: `${COURIER_COLOR[l]}1a`, color: COURIER_COLOR[l] }} title={courier || "from tracking prefix"}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: COURIER_COLOR[l] }} /> {l}
    </span>
  )
}

type Row = Record<string, any> & { _st: string; _courier: string; _amt: number }
type DayRow = { date: string; total: { count: number; amount: number } } & Record<string, any>

export default function PpwPage() {
  const activePages = useActivePages()
  const scanStore = useShippedOutScans()
  const pagesWithCreds = useMemo(() => activePages.filter(p => p.api_key && (p.pancake_page_id || p.shop_id)), [activePages])
  const pagesKey = pagesWithCreds.map(p => `${p.api_key}~${p.pancake_page_id || p.shop_id}~${p.name}`).join("|")

  const [tab, setTab] = useState<"ppw" | "fp">("ppw")
  const [loading, setLoading] = useState(false)
  const [loadErr, setLoadErr] = useState("")

  // PPW = snapshot ng NGAYON, kaya laging malawak ang hinihila (hindi date-filtered).
  const [ppwRows, setPpwRows] = useState<Row[]>([])
  // FP = naipadala sa loob ng napiling range (shipped-out basis).
  const [fpFrom, setFpFrom] = useState(monthStart())
  const [fpTo, setFpTo] = useState(dstr(new Date()))
  const [fpRows, setFpRows] = useState<Row[]>([])

  const decorate = (r: any, pageName: string): Row => ({
    ...r, page_name: pageName, _st: statusLabel(r.order_status),
    // Tracking bilang fallback — madalas blangko ang partner_name sa PPW parcels.
    _courier: courierOf(r.courier, r.tracking_no), _amt: Number(r.final_price || 0),
  })

  async function load(noCache = false) {
    if (pagesWithCreds.length === 0) { setPpwRows([]); setFpRows([]); return }
    setLoading(true); setLoadErr("")
    const ppwOut: Row[] = [], fpOut: Row[] = []
    const errs: string[] = []
    const ppwFrom = dstr(new Date(Date.now() - PPW_LOOKBACK_DAYS * 86400000))
    const today = dstr(new Date())
    await mapLimit(pagesWithCreds, PANCAKE_CONCURRENCY, async p => {
      const id = p.pancake_page_id || p.shop_id
      try {
        const [a, b] = await Promise.all([
          fetchPageRows(p.api_key, id, ppwFrom, today, "sales_order", noCache),
          fetchPageRows(p.api_key, id, fpFrom, fpTo, "shipped_out", noCache),
        ])
        for (const r of a) ppwOut.push(decorate(r, p.name))
        for (const r of b) fpOut.push(decorate(r, p.name))
      } catch (e: any) { errs.push(`${p.name}: ${e?.message || "failed"}`) }
    })
    setPpwRows(ppwOut); setFpRows(fpOut); setLoading(false)
    if (errs.length) setLoadErr(errs.join(" · "))
  }
  useEffect(() => { load() }, [pagesKey, fpFrom, fpTo])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── PPW: may waybill na (tracking) PERO hindi pa nakakaalis ─────────────────
  const ppw = useMemo(() => {
    const now = Date.now()
    const list = ppwRows
      .filter(r => String(r.tracking_no || "").trim() && !GONE.has(r._st))
      .map((r): Row & { _age: number } => {
        const t = new Date(String(r.date_added || "") + "T00:00:00").getTime()
        return { ...r, _age: isNaN(t) ? 0 : Math.max(0, Math.floor((now - t) / 86400000)) }
      })
      .sort((a, b) => b._age - a._age)
    const per: Record<string, { count: number; amount: number }> = {}
    for (const c of [...COURIERS, "OTHER"]) per[c] = { count: 0, amount: 0 }
    let count = 0, amount = 0
    for (const r of list) {
      const k = per[r._courier] ? r._courier : "OTHER"
      per[k].count++; per[k].amount += r._amt
      count++; amount += r._amt
    }
    const aging = { fresh: 0, mid: 0, stale: 0 }
    for (const r of list) {
      if (r._age <= 0) aging.fresh++
      else if (r._age <= 2) aging.mid++
      else aging.stale++
    }
    return { list, per, count, amount, aging }
  }, [ppwRows])

  // ── FP: naipadala sa range, per courier + araw-araw ────────────────────────
  const fp = useMemo(() => {
    const list = fpRows.filter(r => ["Shipped", "Delivered", "Returning", "Returned"].includes(r._st))
    const per: Record<string, { count: number; amount: number }> = {}
    for (const c of [...COURIERS, "OTHER"]) per[c] = { count: 0, amount: 0 }
    let count = 0, amount = 0
    const daily = new Map<string, Record<string, { count: number; amount: number }>>()
    for (const r of list) {
      const k = per[r._courier] ? r._courier : "OTHER"
      per[k].count++; per[k].amount += r._amt
      count++; amount += r._amt
      const day = String(r.shipped_out_date || r.date_added || "").slice(0, 10)
      if (!day) continue
      if (!daily.has(day)) daily.set(day, Object.fromEntries([...COURIERS, "OTHER"].map(c => [c, { count: 0, amount: 0 }])))
      const d = daily.get(day)!
      d[k].count++; d[k].amount += r._amt
    }
    const days: DayRow[] = Array.from(daily, ([date, v]) => ({
      date, ...v,
      total: {
        count: Object.values(v).reduce((s, x) => s + x.count, 0),
        amount: Object.values(v).reduce((s, x) => s + x.amount, 0),
      },
    })).sort((a, b) => b.date.localeCompare(a.date))
    return { list, per, count, amount, days }
  }, [fpRows])

  // Cross-check: ilan sa mga naipadala ang aktwal na na-scan sa Shipped Out.
  const scanCheck = useMemo(() => {
    const scanned = new Set(scanStore.scans.map(s => s.tracking_no.toLowerCase()))
    const withTracking = fp.list.filter(r => String(r.tracking_no || "").trim())
    const hit = withTracking.filter(r => scanned.has(String(r.tracking_no).toLowerCase())).length
    return { total: withTracking.length, hit, pct: withTracking.length ? (hit / withTracking.length) * 100 : 0 }
  }, [fp.list, scanStore.scans])

  const hasOther = ppw.per.OTHER.count > 0 || fp.per.OTHER.count > 0
  const shownCouriers: string[] = hasOther ? [...COURIERS, "OTHER"] : [...COURIERS]

  function writeSheet(data: any[][], sheet: string, file: string) {
    const ws = XLSX.utils.aoa_to_sheet(data)
    for (let c = 0; c < data[0].length; c++) {
      const a = XLSX.utils.encode_cell({ r: 0, c })
      if (ws[a]) (ws[a] as any).s = { fill: { patternType: "solid", fgColor: { rgb: "FF1E293B" } }, font: { bold: true, color: { rgb: "FFFFFFFF" } } }
      const f = XLSX.utils.encode_cell({ r: data.length - 1, c })
      if (ws[f]) (ws[f] as any).s = { fill: { patternType: "solid", fgColor: { rgb: "FFF1F5F9" } }, font: { bold: true } }
    }
    ws["!cols"] = data[0].map((h: any) => ({ wch: Math.max(13, String(h).length + 2) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, sheet)
    XLSX.writeFile(wb, file)
  }
  function exportPpw() {
    const headers = ["Tracking No", "Courier", "Page", "Customer", "Order", "Status", "Amount", "Age (days)", "Order Date"]
    writeSheet([headers, ...ppw.list.map(r => [
      r.tracking_no, r._courier, r.page_name, r.customer_name, r.order_item, r._st, r._amt, r._age, r.date_added,
    ]), ["TOTAL", "", "", "", "", "", ppw.amount, "", ""]], "PPW", `PPW_${dstr(new Date())}.xlsx`)
  }
  function exportFp() {
    const headers = ["Date Shipped", ...shownCouriers.flatMap(c => [`${c} Parcels`, `${c} Amount`]), "Total Parcels", "Total Amount"]
    const body = fp.days.map(d => [d.date, ...shownCouriers.flatMap(c => [d[c].count, d[c].amount]), d.total.count, d.total.amount])
    const foot = ["TOTAL", ...shownCouriers.flatMap(c => [fp.per[c].count, fp.per[c].amount]), fp.count, fp.amount]
    writeSheet([headers, ...body, foot], "Fulfilled Parcels", `Fulfilled-Parcel-Report_${fpFrom}_to_${fpTo}.xlsx`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2 pb-4 border-b border-slate-100">
        <div>
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2">
            <ScanBarcode className="w-5 h-5" /> PENDING PRINTED WAYBILL (PPW)
          </h1>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Parcels with a printed waybill that the courier has not collected yet · {pagesWithCreds.length} page{pagesWithCreds.length === 1 ? "" : "s"}
          </p>
        </div>
        <button onClick={() => load(true)} title="Refresh"
          className="h-9 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex items-center gap-1">
        <button onClick={() => setTab("ppw")}
          className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 ${tab === "ppw" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100 border border-slate-200"}`}>
          <ClipboardList className="w-4 h-4" /> PPW Monitor ({num(ppw.count)})
        </button>
        <button onClick={() => setTab("fp")}
          className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 ${tab === "fp" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100 border border-slate-200"}`}>
          <PackageCheck className="w-4 h-4" /> Fulfilled Parcel Report (FP)
        </button>
      </div>

      {loadErr && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{loadErr}</div>}

      {/* ── PPW MONITOR ── */}
      {tab === "ppw" && (
        <div className="space-y-4">
          {loading && ppwRows.length === 0 ? (
            <StatCardsSkeleton count={3} height="h-[86px]" className="grid grid-cols-1 md:grid-cols-3 gap-2.5" />
          ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            <div className="relative overflow-hidden rounded-xl px-4 py-3 h-[86px] flex items-center justify-between bg-slate-800">
              <ScanBarcode strokeWidth={1} className="absolute -left-2 w-16 h-16 opacity-[0.14] text-white" />
              <div className="text-right ml-auto z-10">
                <p className="text-3xl font-bold text-white leading-none tabular-nums">{num(ppw.count)}</p>
                <p className="text-[10px] text-white/80 font-semibold mt-1 tracking-wider uppercase">Total PPW <span className="normal-case tracking-normal text-white/60">({peso(ppw.amount)})</span></p>
              </div>
            </div>
            {shownCouriers.map(c => (
              <div key={c} className="relative overflow-hidden rounded-xl px-4 py-3 h-[86px] flex items-center justify-between"
                style={{ background: COURIER_COLOR[c] }}>
                <Truck strokeWidth={1} className="absolute -left-2 w-16 h-16 opacity-[0.18] text-white" />
                <div className="text-right ml-auto z-10">
                  <p className="text-3xl font-bold text-white leading-none tabular-nums">{num(ppw.per[c].count)}</p>
                  <p className="text-[10px] text-white/85 font-semibold mt-1 tracking-wider uppercase">{c} PPW <span className="normal-case tracking-normal text-white/70">({peso(ppw.per[c].amount)})</span></p>
                </div>
              </div>
            ))}
          </div>
          )}

          {/* Aging — ito ang nagsasabi kung may nabubulok na parcel sa bodega */}
          <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 flex items-center gap-4 flex-wrap">
            <span className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><CalendarDays className="w-4 h-4 text-slate-400" /> Aging</span>
            {[
              { l: "Today only", v: ppw.aging.fresh, c: "bg-emerald-50 text-emerald-700" },
              { l: "1–2 days", v: ppw.aging.mid, c: "bg-amber-50 text-amber-700" },
              { l: "3+ days (stale)", v: ppw.aging.stale, c: "bg-rose-50 text-rose-700" },
            ].map(x => (
              <span key={x.l} className={`px-3 py-1 rounded-full text-xs font-bold ${x.c}`}>{x.l}: {num(x.v)}</span>
            ))}
            {ppw.aging.stale > 0 && (
              <span className="text-[11px] text-rose-600 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> {num(ppw.aging.stale)} parcels have carried a waybill for 3+ days and are still uncollected.
              </span>
            )}
            <div className="ml-auto">
              <Button variant="outline" onClick={exportPpw} disabled={ppw.count === 0} className="h-8 text-xs">
                <FileSpreadsheet className="w-3.5 h-3.5" /> Export
              </Button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-[11px] font-semibold uppercase tracking-wide border-b border-slate-200">
                    <th className="px-4 py-3 text-left">Tracking No</th>
                    <th className="px-4 py-3 text-left">Courier</th>
                    <th className="px-4 py-3 text-left">Page</th>
                    <th className="px-4 py-3 text-left">Customer</th>
                    <th className="px-4 py-3 text-left">Order</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-right">Age</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading && <tr><td colSpan={8} className="p-0"><TableSkeleton rows={5} cols={6} /></td></tr>}
                  {!loading && ppw.count === 0 && (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400 italic">
                      <CheckCircle2 className="w-5 h-5 text-emerald-500 inline mr-1.5" />
                      No PPW left — the courier collected everything. 🎉
                    </td></tr>
                  )}
                  {ppw.list.map(r => (
                    <tr key={r.id} className="hover:bg-blue-50/40">
                      <td className="px-4 py-2.5 font-mono text-slate-800 whitespace-nowrap">{r.tracking_no}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap"><CourierBadge courier={r.courier} tracking={r.tracking_no} /></td>
                      <td className="px-4 py-2.5 text-slate-600 max-w-[140px] truncate">{r.page_name}</td>
                      <td className="px-4 py-2.5 text-slate-600 max-w-[160px] truncate">{r.customer_name || "—"}</td>
                      <td className="px-4 py-2.5 text-slate-600 max-w-[200px] truncate" title={r.order_item}>{r.order_item || "—"}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap"><span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600">{r._st}</span></td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-800 whitespace-nowrap">{peso(r._amt)}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${r._age >= 3 ? "bg-rose-100 text-rose-700" : r._age >= 1 ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
                          {r._age === 0 ? "today" : `${num(r._age)}d`}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {ppw.count > 0 && (
                  <tfoot>
                    <tr className="bg-slate-100 border-t-2 border-slate-300 font-extrabold text-slate-900">
                      <td className="px-4 py-2.5 text-[11px] uppercase tracking-wider" colSpan={6}>Total · {num(ppw.count)} PPW</td>
                      <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{peso(ppw.amount)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
          <p className="text-[11px] text-slate-400">
            PPW = has a tracking/waybill BUT has not reached Shipped. This is a snapshot of RIGHT NOW
            (pulls the last {PPW_LOOKBACK_DAYS} days), so the FP tab date filter does not affect it.
          </p>
        </div>
      )}

      {/* ── FULFILLED PARCEL REPORT ── */}
      {tab === "fp" && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-3 flex items-center gap-2 flex-wrap">
            <DateRangePicker a={fpFrom} b={fpTo} variant="header"
              onApply={(a, b) => { setFpFrom(a || monthStart()); setFpTo(b || dstr(new Date())) }} placeholder="This month" />
            <span className="text-xs text-slate-400">{fpFrom} → {fpTo} · based on the date handed to the courier</span>
            <div className="ml-auto">
              <Button variant="outline" onClick={exportFp} disabled={fp.count === 0}>
                <FileSpreadsheet className="w-4 h-4" /> Export
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {shownCouriers.map(c => (
              <div key={c} className="relative overflow-hidden rounded-xl px-4 py-3 h-[86px] flex items-center justify-between"
                style={{ background: COURIER_COLOR[c] }}>
                <Truck strokeWidth={1} className="absolute -left-2 w-16 h-16 opacity-[0.18] text-white" />
                <div className="text-right ml-auto z-10">
                  <p className="text-3xl font-bold text-white leading-none tabular-nums">{num(fp.per[c].count)}</p>
                  <p className="text-[10px] text-white/85 font-semibold mt-1 tracking-wider uppercase">{c} fulfilled <span className="normal-case tracking-normal text-white/70">({peso(fp.per[c].amount)})</span></p>
                </div>
              </div>
            ))}
            <div className="relative overflow-hidden rounded-xl px-4 py-3 h-[86px] flex items-center justify-between bg-emerald-600">
              <PackageCheck strokeWidth={1} className="absolute -left-2 w-16 h-16 opacity-[0.16] text-white" />
              <div className="text-right ml-auto z-10">
                <p className="text-3xl font-bold text-white leading-none tabular-nums">{num(fp.count)}</p>
                <p className="text-[10px] text-white/85 font-semibold mt-1 tracking-wider uppercase">Total fulfilled <span className="normal-case tracking-normal text-white/70">({peso(fp.amount)})</span></p>
              </div>
            </div>
          </div>

          {/* Cross-check laban sa aktwal na Shipped Out scans */}
          <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 flex items-center gap-3 flex-wrap">
            <Search className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <p className="text-sm text-slate-700">
              <strong>Scan cross-check:</strong> {num(scanCheck.hit)} of {num(scanCheck.total)} fulfilled parcels have a matching Shipped Out scan
            </p>
            <div className="flex-1 min-w-[140px] h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, scanCheck.pct)}%`, background: scanCheck.pct >= 90 ? "#10b981" : scanCheck.pct >= 50 ? "#f59e0b" : "#ef4444" }} />
            </div>
            <span className={`text-sm font-bold tabular-nums ${scanCheck.pct >= 90 ? "text-emerald-600" : scanCheck.pct >= 50 ? "text-amber-600" : "text-rose-600"}`}>{scanCheck.pct.toFixed(0)}%</span>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-sm font-bold text-slate-800">Daily Fulfilled Parcels</p>
              <p className="text-[11px] text-slate-400">How many were dispatched per courier each day</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider">Date</th>
                    {shownCouriers.map(c => (
                      <th key={c} className="px-3 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider" colSpan={2}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ background: COURIER_COLOR[c] }} /> {c}
                        </span>
                      </th>
                    ))}
                    <th className="px-4 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider bg-slate-900" colSpan={2}>Total</th>
                  </tr>
                  <tr className="bg-slate-700 text-white/70 text-[10px] uppercase">
                    <th className="px-4 py-1.5 text-left">—</th>
                    {shownCouriers.flatMap(c => [
                      <th key={`${c}-p`} className="px-3 py-1.5 text-right">Parcels</th>,
                      <th key={`${c}-a`} className="px-3 py-1.5 text-right">Amount</th>,
                    ])}
                    <th className="px-3 py-1.5 text-right bg-slate-800">Parcels</th>
                    <th className="px-3 py-1.5 text-right bg-slate-800">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading && <tr><td colSpan={3 + shownCouriers.length * 2} className="p-0"><TableSkeleton rows={5} cols={5} /></td></tr>}
                  {!loading && fp.days.length === 0 && (
                    <tr><td colSpan={3 + shownCouriers.length * 2} className="px-4 py-10 text-center text-sm text-slate-400 italic">No parcels dispatched in this range.</td></tr>
                  )}
                  {fp.days.map((d, i) => (
                    <tr key={d.date} className={`${i % 2 ? "bg-slate-50/60" : "bg-white"} hover:bg-blue-50/40`}>
                      <td className="px-4 py-2.5 font-semibold text-slate-800 whitespace-nowrap">{d.date}</td>
                      {shownCouriers.flatMap(c => [
                        <td key={`${c}-p`} className="px-3 py-2.5 text-right tabular-nums">
                          {d[c].count === 0 ? <span className="text-slate-300">0</span>
                            : <span className="font-bold" style={{ color: COURIER_COLOR[c] }}>{num(d[c].count)}</span>}
                        </td>,
                        <td key={`${c}-a`} className="px-3 py-2.5 text-right tabular-nums text-slate-500 text-xs">{peso(d[c].amount)}</td>,
                      ])}
                      <td className="px-3 py-2.5 text-right tabular-nums font-extrabold text-slate-900 bg-slate-50">{num(d.total.count)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-700 bg-slate-50 text-xs">{peso(d.total.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                {fp.count > 0 && (
                  <tfoot>
                    <tr className="bg-slate-100 border-t-2 border-slate-300">
                      <td className="px-4 py-2.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-700">Total</td>
                      {shownCouriers.flatMap(c => [
                        <td key={`${c}-p`} className="px-3 py-2.5 text-right tabular-nums font-extrabold" style={{ color: COURIER_COLOR[c] }}>{num(fp.per[c].count)}</td>,
                        <td key={`${c}-a`} className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-600 text-xs">{peso(fp.per[c].amount)}</td>,
                      ])}
                      <td className="px-3 py-2.5 text-right tabular-nums font-extrabold text-white bg-slate-800">{num(fp.count)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-bold text-white bg-slate-800 text-xs">{peso(fp.amount)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
