"use client"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import * as XLSX from "xlsx-js-style"
import {
  Warehouse, RefreshCw, Package, Clock, Truck, ScanBarcode, Undo2, PackageCheck,
  Eye, EyeOff, BarChart3, Users, AlertTriangle, CheckCircle2, Sparkles, PauseCircle,
  ClipboardList, FileSpreadsheet, XCircle,
} from "lucide-react"
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import { useActivePages } from "@/lib/pages-store"
import { useShippedOutScans } from "@/lib/shipped-out-store"
import { fetchFulfillmentMeta } from "@/lib/fulfillment-meta-store"
import { cachedJson, PANCAKE_CONCURRENCY } from "@/lib/pancake-cache"
import { courierOf, COURIER_COLOR } from "@/lib/courier"
import { StatCardsSkeleton, TableSkeleton } from "@/components/business/Skeleton"

// ──────────────────────────────────────────────────────────────────────────────
// WAREHOUSE DASHBOARD — isang tingin sa buong operasyon ng bodega: nasaan ang mga
// order sa pipeline, ilan ang dapat i-pack, ilan ang na-scan palabas, sino ang
// nag-pack, at ilan ang pabalik (RTS). Live Pancake orders + fulfillment
// annotations + shipped-out scans — walang inimbentong numero.
// ──────────────────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0")
const dstr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01` }
const num = (n: number) => (isFinite(n) ? n : 0).toLocaleString("en-PH")
// Maikling peso para kasya sa card label — walang decimals, may K/M kapag malaki.
const peso = (n: number) => {
  const v = isFinite(n) ? n : 0
  if (Math.abs(v) >= 1_000_000) return "₱" + (v / 1_000_000).toFixed(2) + "M"
  if (Math.abs(v) >= 100_000) return "₱" + Math.round(v / 1_000) + "K"
  return "₱" + Math.round(v).toLocaleString("en-PH")
}
const CHARTS_KEY = "pesowise_whdash_charts"

async function fetchPageRows(apiKey: string, pageId: string, from: string, to: string, noCache = false): Promise<any[]> {
  const json = await cachedJson(
    `/api/pancake/orders?api_key=${encodeURIComponent(apiKey)}&page_id=${encodeURIComponent(pageId)}`
    + `&from=${from}&to=${to}&phase=rows&basis=sales_order${noCache ? "&nocache=1" : ""}`,
    { force: noCache }
  )
  return Array.isArray(json.rows) ? json.rows : []
}
async function mapLimit<T>(items: T[], limit: number, fn: (i: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) await fn(items[i++]) }))
}

// Pancake status_name → readable label (same matchers as the Fulfillment page).
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

// Mga kulay ng Pancake POS mismo — pareho ang gamit sa cards, charts, at summary
// para iisa ang ibig sabihin ng bawat kulay saanman sa dashboard.
const STATUS_COLOR: Record<string, string> = {
  "New": "#06b6d4",                  // cyan
  "Restocking": "#eab308",           // gold — on hold
  "Prioritize Order": "#f43f5e",     // rose
  "Confirmed": "#3b82f6",            // blue
  "Packaging": "#a855f7",            // purple
  "Waiting for Pick Up": "#d946ef",  // magenta
  "Shipped": "#f97316",              // orange
  "Delivered": "#10b981",
  "Returning": "#f59e0b",
  "Returned": "#ef4444",
  "Cancelled": "#dc2626",
  "Deleted": "#cbd5e1",
}
const DISPLAY: Record<string, string> = { "Restocking": "Restocking (on hold)" }
const disp = (s: string) => DISPLAY[s] || s

// Ang pipeline = mga order na nasa loob pa ng operasyon (hindi pa tapos/kanselado).
const PIPELINE = ["New", "Confirmed", "Restocking", "Prioritize Order", "Packaging", "Waiting for Pick Up", "Shipped"]
// Hindi pa nakakalabas ng bodega — ito ang bumubuo ng backlog.
const PENDING = new Set(["New", "Confirmed", "Restocking", "Prioritize Order", "Packaging"])
// Nakaalis na o hindi na dapat bilangin bilang naiwan — ginagamit sa PPW.
const GONE = new Set(["Shipped", "Delivered", "Returning", "Returned", "Cancelled", "Deleted"])

// Ginagamit ang shared resolver — may tracking fallback kapag blangko ang partner_name.
const courierLabel = (raw: string, tracking = "") => courierOf(raw, tracking)

type FfMeta = { packer?: string; shift?: string; packed_date?: string }

export default function WarehouseDashboardPage() {
  const activePages = useActivePages()
  const scanStore = useShippedOutScans()
  const pagesWithCreds = useMemo(() => activePages.filter(p => p.api_key && (p.pancake_page_id || p.shop_id)), [activePages])

  const [dateA, setDateA] = useState("")
  const [dateB, setDateB] = useState("")
  const win = useMemo(() => ({ from: dateA || monthStart(), to: dateB || dstr(new Date()) }), [dateA, dateB])

  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [loadErr, setLoadErr] = useState("")
  const [meta, setMeta] = useState<Record<string, FfMeta>>({})
  const pagesKey = pagesWithCreds.map(p => `${p.api_key}~${p.pancake_page_id || p.shop_id}~${p.name}`).join("|")

  async function load(noCache = false) {
    if (pagesWithCreds.length === 0) { setRows([]); return }
    setLoading(true); setLoadErr("")
    const out: any[] = []
    const errs: string[] = []
    await mapLimit(pagesWithCreds, PANCAKE_CONCURRENCY, async p => {
      try {
        const rs = await fetchPageRows(p.api_key, p.pancake_page_id || p.shop_id, win.from, win.to, noCache)
        for (const r of rs) out.push({ ...r, page_name: p.name })
      } catch (e: any) { errs.push(`${p.name}: ${e?.message || "failed"}`) }
    })
    setRows(out); setLoading(false)
    if (errs.length) setLoadErr(errs.join(" · "))
  }
  useEffect(() => { load() }, [pagesKey, win.from, win.to])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fetchFulfillmentMeta<FfMeta>().then(m => { if (m) setMeta(m) }) }, [])

  const [showCharts, setShowCharts] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    try { return localStorage.getItem(CHARTS_KEY) === "1" } catch { return false }
  })
  const toggleCharts = () => setShowCharts(s => {
    try { localStorage.setItem(CHARTS_KEY, s ? "0" : "1") } catch {}
    return !s
  })

  // ── Derived ─────────────────────────────────────────────────────────────────
  const withStatus = useMemo(() => rows.map(r => ({ ...r, _st: statusLabel(r.order_status) })), [rows])

  // Bilang AT halaga (COD / final price) kada status — parehong ipinapakita sa cards.
  const count = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of withStatus) m[r._st] = (m[r._st] || 0) + 1
    return m
  }, [withStatus])
  const amount = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of withStatus) m[r._st] = (m[r._st] || 0) + Number(r.final_price || 0)
    return m
  }, [withStatus])
  const totalAmount = useMemo(() => withStatus.reduce((s, r) => s + Number(r.final_price || 0), 0), [withStatus])

  // PPW — may nakadikit nang waybill (tracking) pero hindi pa nakukuha ng courier.
  // Parehong kahulugan ng PPW page; nakasakop lang ito sa napiling range dito.
  const ppw = useMemo(() => {
    let count = 0, amt = 0
    for (const r of withStatus) {
      if (!String(r.tracking_no || "").trim() || GONE.has(r._st)) continue
      count++; amt += Number(r.final_price || 0)
    }
    return { count, amt }
  }, [withStatus])

  const today = dstr(new Date())
  const todayScans = useMemo(() => scanStore.scans.filter(s => s.date === today), [scanStore.scans, today])
  const scannedToday = todayScans.length
  const scannedTodayAmount = useMemo(() => todayScans.reduce((s, r) => s + (r.amount || 0), 0), [todayScans])
  const scansInRange = useMemo(() => scanStore.scans.filter(s => s.date >= win.from && s.date <= win.to), [scanStore.scans, win])

  // Scan coverage — ilan sa mga umalis na order ang dumaan sa scanner.
  const coverage = useMemo(() => {
    const outbound = withStatus.filter(r => ["Shipped", "Delivered", "Returning", "Returned", "Waiting for Pick Up"].includes(r._st) && r.tracking_no)
    const scanned = new Set(scanStore.scans.map(s => s.tracking_no.toLowerCase()))
    const hit = outbound.filter(r => scanned.has(String(r.tracking_no).toLowerCase())).length
    return { total: outbound.length, hit, pct: outbound.length ? (hit / outbound.length) * 100 : 0 }
  }, [withStatus, scanStore.scans])

  // Packer leaderboard — fulfillment annotations na may packed_date sa range.
  const packers = useMemo(() => {
    const m = new Map<string, { packed: number; last: string }>()
    for (const fm of Object.values(meta)) {
      if (!fm.packer || !fm.packed_date) continue
      const d = fm.packed_date.slice(0, 10)
      if (d < win.from || d > win.to) continue
      const cur = m.get(fm.packer) || { packed: 0, last: "" }
      cur.packed++
      if (d > cur.last) cur.last = d
      m.set(fm.packer, cur)
    }
    return Array.from(m, ([name, v]) => ({ name, ...v })).sort((a, b) => b.packed - a.packed)
  }, [meta, win])

  // Backlog — pinakamatagal nang hindi nakakalabas ng bodega.
  const backlog = useMemo(() => {
    const stuck = withStatus.filter(r => PENDING.has(r._st))
    const now = Date.now()
    return stuck.map(r => {
      const t = new Date(String(r.date_added || "") + "T00:00:00").getTime()
      return { ...r, _age: isNaN(t) ? 0 : Math.floor((now - t) / 86400000) }
    }).sort((a, b) => b._age - a._age)
  }, [withStatus])

  // ── SUMMARY: bawat page × bawat status ng pipeline ──────────────────────────
  // Tinatago ang kolum na puro sero para hindi magulo, pero hinding-hindi
  // itinatago ang may laman (walang nawawalang datos).
  const summary = useMemo(() => {
    const perPage = new Map<string, Record<string, number>>()
    for (const p of activePages) perPage.set(p.name, {})
    for (const r of withStatus) {
      const k = r.page_name || "—"
      const cur = perPage.get(k) || {}
      cur[r._st] = (cur[r._st] || 0) + 1
      perPage.set(k, cur)
    }
    const cols = PIPELINE.filter(s => Array.from(perPage.values()).some(c => (c[s] || 0) > 0))
    const list = Array.from(perPage, ([name, counts]) => {
      const total = cols.reduce((s, c) => s + (counts[c] || 0), 0)
      return { name, counts, total }
    }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    const totals: Record<string, number> = {}
    for (const c of cols) totals[c] = list.reduce((s, r) => s + (r.counts[c] || 0), 0)
    const grand = cols.reduce((s, c) => s + totals[c], 0)
    return { cols, list, totals, grand }
  }, [withStatus, activePages])

  function exportSummary() {
    const headers = ["Page name", ...summary.cols.map(disp), "TOTAL"]
    const body = summary.list.map(r => [r.name, ...summary.cols.map(c => r.counts[c] || 0), r.total])
    const foot = ["TOTAL", ...summary.cols.map(c => summary.totals[c]), summary.grand]
    const ws = XLSX.utils.aoa_to_sheet([headers, ...body, foot])
    for (let c = 0; c < headers.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c })
      if (ws[addr]) (ws[addr] as any).s = { fill: { patternType: "solid", fgColor: { rgb: "FF1E293B" } }, font: { bold: true, color: { rgb: "FFFFFFFF" } } }
      const f = XLSX.utils.encode_cell({ r: body.length + 1, c })
      if (ws[f]) (ws[f] as any).s = { fill: { patternType: "solid", fgColor: { rgb: "FFF1F5F9" } }, font: { bold: true } }
    }
    ws["!cols"] = headers.map((h, i) => ({ wch: i === 0 ? 30 : Math.max(12, h.length + 2) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Warehouse Summary")
    XLSX.writeFile(wb, `Warehouse-Summary_${win.from}_to_${win.to}.xlsx`)
  }

  // ── Charts ──────────────────────────────────────────────────────────────────
  const byStatus = useMemo(() =>
    STATUS_MATCH.map(s => ({ name: disp(s.l), key: s.l, value: count[s.l] || 0 })).filter(x => x.value > 0)
  , [count])
  const byCourier = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of withStatus) {
      const k = courierLabel(r.courier, r.tracking_no)
      m.set(k, (m.get(k) || 0) + 1)
    }
    return Array.from(m, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [withStatus])
  // Stacked pipeline per page — ang bisuwal na katumbas ng summary table.
  const pipelineByPage = useMemo(() =>
    summary.list.filter(r => r.total > 0).slice(0, 8).map(r => {
      const o: Record<string, any> = { name: r.name.length > 18 ? r.name.slice(0, 17) + "…" : r.name }
      for (const c of summary.cols) o[disp(c)] = r.counts[c] || 0
      return o
    })
  , [summary])
  const scanTrend = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of scanStore.scans) m.set(s.date, (m.get(s.date) || 0) + 1)
    const out: { day: string; scans: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const d = dstr(new Date(Date.now() - i * 86400000))
      out.push({ day: d.slice(5), scans: m.get(d) || 0 })
    }
    return out
  }, [scanStore.scans])

  // ── Cards ───────────────────────────────────────────────────────────────────
  // Pipeline strip: eksaktong kulay ng Pancake status. "Packaging" ang tunay na
  // to-fulfill (may laman na, hinihintay lang mabalot).
  const pipelineCards: { key: string; label: string; icon: any }[] = [
    { key: "New", label: "New", icon: Sparkles },
    { key: "Confirmed", label: "Confirmed", icon: CheckCircle2 },
    { key: "Restocking", label: "Restocking (on hold)", icon: PauseCircle },
    { key: "Packaging", label: "Packaging · To Fulfill", icon: Package },
    { key: "Waiting for Pick Up", label: "Waiting for Pick Up", icon: Clock },
    { key: "Shipped", label: "Shipped", icon: Truck },
  ]
  const opsCards = [
    { label: "TOTAL ORDERS", value: num(rows.length), amt: totalAmount, color: "bg-slate-700", icon: ClipboardList },
    { label: "PPW · PENDING WAYBILL", value: num(ppw.count), amt: ppw.amt, color: "bg-amber-600", icon: ScanBarcode },
    { label: "DELIVERED", value: num(count["Delivered"] || 0), amt: amount["Delivered"] || 0, color: "bg-emerald-600", icon: PackageCheck },
    { label: "SCANNED OUT TODAY", value: num(scannedToday), amt: scannedTodayAmount, color: "bg-blue-600", icon: ScanBarcode },
    {
      label: "RTS RETURNING / RETURNED", value: `${num(count["Returning"] || 0)} / ${num(count["Returned"] || 0)}`,
      amt: (amount["Returning"] || 0) + (amount["Returned"] || 0), color: "bg-rose-500", icon: Undo2,
    },
    { label: "CANCELLED", value: num(count["Cancelled"] || 0), amt: amount["Cancelled"] || 0, color: "bg-red-700", icon: XCircle },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2 pb-4 border-b border-slate-100">
        <div>
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Warehouse className="w-5 h-5" /> WAREHOUSE DASHBOARD</h1>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {loading ? "Loading orders…" : `${num(rows.length)} order${rows.length === 1 ? "" : "s"} · ${win.from} → ${win.to} · ${pagesWithCreds.length} page${pagesWithCreds.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker a={dateA} b={dateB} variant="header"
            onApply={(a, b) => { setDateA(a || ""); setDateB(b || "") }} placeholder="This month" />
          <button onClick={() => load(true)} title="Refresh"
            className="h-9 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {loadErr && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{loadErr}</div>}

      {/* Pipeline — kulay ng Pancake status */}
      <div>
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Order Pipeline · sa loob ng napiling range</p>
        {loading && rows.length === 0 ? (
          <StatCardsSkeleton count={6} className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5" />
        ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
          {pipelineCards.map(c => (
            <div key={c.key} className="relative overflow-hidden rounded-xl px-4 py-3 h-[78px] flex items-center justify-between"
              style={{ background: STATUS_COLOR[c.key] }}>
              <c.icon strokeWidth={1} className="absolute -left-2 w-16 h-16 opacity-[0.18] text-white" />
              <div className="text-right ml-auto z-10 min-w-0">
                <p className="text-2xl font-bold text-white leading-none tabular-nums">{num(count[c.key] || 0)}</p>
                <p className="text-[10px] text-white/85 font-semibold mt-1 tracking-wider uppercase leading-tight">
                  {c.label} <span className="text-white/70 normal-case tracking-normal">({peso(amount[c.key] || 0)})</span>
                </p>
              </div>
            </div>
          ))}
        </div>
        )}
      </div>

      {/* Ops */}
      {loading && rows.length === 0 ? (
        <StatCardsSkeleton count={6} className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5" />
      ) : (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
        {opsCards.map(c => (
          <div key={c.label} className={`relative overflow-hidden ${c.color} rounded-xl px-4 py-3 h-[78px] flex items-center justify-between`}>
            <c.icon strokeWidth={1} className="absolute -left-2 w-16 h-16 opacity-[0.12] text-white" />
            <div className="text-right ml-auto z-10 min-w-0">
              <p className="text-xl font-bold text-white leading-none tabular-nums truncate">{c.value}</p>
              <p className="text-[10px] text-white/75 font-semibold mt-1 tracking-wider uppercase leading-tight">
                {c.label} <span className="text-white/60 normal-case tracking-normal">({peso(c.amt)})</span>
              </p>
            </div>
          </div>
        ))}
      </div>
      )}

      {/* Scan coverage strip */}
      <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 flex items-center gap-3 flex-wrap">
        <ScanBarcode className="w-4 h-4 text-blue-600 flex-shrink-0" />
        <p className="text-sm text-slate-700">
          <strong>Scan coverage:</strong> {num(coverage.hit)} sa {num(coverage.total)} na umalis na parcel ang dumaan sa Shipped Out scanner
        </p>
        <div className="flex-1 min-w-[140px] h-2.5 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, coverage.pct)}%`, background: coverage.pct >= 90 ? "#10b981" : coverage.pct >= 50 ? "#f59e0b" : "#ef4444" }} />
        </div>
        <span className={`text-sm font-bold tabular-nums ${coverage.pct >= 90 ? "text-emerald-600" : coverage.pct >= 50 ? "text-amber-600" : "text-rose-600"}`}>{coverage.pct.toFixed(0)}%</span>
        <span className="text-[11px] text-slate-400">· {num(scansInRange.length)} scan{scansInRange.length === 1 ? "" : "s"} sa range</span>
      </div>

      {/* ── SUMMARY MATRIX ── */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><ClipboardList className="w-4 h-4 text-blue-600" /> Pipeline Summary per Page</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Bilang ng order kada status · {win.from} → {win.to} · hindi kasama ang Delivered / Cancelled (labas na sa pipeline)</p>
          </div>
          <Button variant="outline" onClick={exportSummary} disabled={summary.grand === 0} className="h-8 text-xs">
            <FileSpreadsheet className="w-3.5 h-3.5" /> Export
          </Button>
        </div>
        {loading && rows.length === 0 ? (
          <TableSkeleton rows={6} cols={7} />
        ) : summary.cols.length === 0 ? (
          <p className="px-4 py-8 text-sm text-slate-400 italic text-center">Walang order sa pipeline para sa range na ito.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider sticky left-0 bg-slate-800 z-10">Page name</th>
                  {summary.cols.map(c => (
                    <th key={c} className="px-3 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLOR[c] }} />
                        {disp(c)}
                      </span>
                    </th>
                  ))}
                  <th className="px-4 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider bg-slate-900">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summary.list.map((r, i) => (
                  <tr key={r.name} className={`${i % 2 ? "bg-slate-50/60" : "bg-white"} hover:bg-blue-50/40 ${r.total === 0 ? "opacity-45" : ""}`}>
                    <td className={`px-4 py-2.5 font-semibold text-slate-800 whitespace-nowrap sticky left-0 z-10 ${i % 2 ? "bg-slate-50/60" : "bg-white"}`}>{r.name}</td>
                    {summary.cols.map(c => {
                      const v = r.counts[c] || 0
                      return (
                        <td key={c} className="px-3 py-2.5 text-center tabular-nums">
                          {v === 0 ? <span className="text-slate-300">0</span>
                            : <span className="font-bold" style={{ color: STATUS_COLOR[c] }}>{num(v)}</span>}
                        </td>
                      )
                    })}
                    <td className="px-4 py-2.5 text-center tabular-nums font-extrabold text-slate-900 bg-slate-50">{num(r.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100 border-t-2 border-slate-300">
                  <td className="px-4 py-2.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-700 sticky left-0 bg-slate-100 z-10">Total</td>
                  {summary.cols.map(c => (
                    <td key={c} className="px-3 py-2.5 text-center tabular-nums font-extrabold" style={{ color: STATUS_COLOR[c] }}>{num(summary.totals[c])}</td>
                  ))}
                  <td className="px-4 py-2.5 text-center tabular-nums font-extrabold text-white bg-slate-800">{num(summary.grand)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Graphs — naka-hide by default */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><BarChart3 className="w-4 h-4 text-blue-600" /> Graphs</p>
          <Button variant="outline" onClick={toggleCharts} className="h-8 text-xs">
            {showCharts ? <><EyeOff className="w-3.5 h-3.5" /> Hide Graphs</> : <><Eye className="w-3.5 h-3.5" /> Show Graphs</>}
          </Button>
        </div>
        {showCharts && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3">
            <ChartBox title="Orders by Status" subtitle="Saan nakabara ang pipeline">
              {byStatus.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={270}>
                  <BarChart data={byStatus} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="value" name="Orders" radius={[0, 6, 6, 0]}>
                      {byStatus.map(s => <Cell key={s.key} fill={STATUS_COLOR[s.key] || "#94a3b8"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartBox>

            <ChartBox title="Pipeline per Page" subtitle="Top 8 — bisuwal na bersyon ng summary sa itaas">
              {pipelineByPage.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={270}>
                  <BarChart data={pipelineByPage}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-18} textAnchor="end" height={70} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    {summary.cols.map((c, i) => (
                      <Bar key={c} dataKey={disp(c)} stackId="p" fill={STATUS_COLOR[c]}
                        radius={i === summary.cols.length - 1 ? [4, 4, 0, 0] : undefined} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartBox>

            <ChartBox title="Shipped Out Scans (last 14 days)" subtitle="Bilang ng parcels na na-scan palabas kada araw">
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={scanTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} interval={1} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="scans" name="Parcels scanned" stroke="#2563eb" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartBox>

            <ChartBox title="Orders by Courier">
              {byCourier.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={byCourier} dataKey="value" nameKey="name" outerRadius={90}
                      label={(e: any) => `${e.name} (${e.value})`} labelLine={false} fontSize={10}>
                      {byCourier.map(c => <Cell key={c.name} fill={COURIER_COLOR[c.name] || "#94a3b8"} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </ChartBox>
          </div>
        )}
      </div>

      {/* Packer leaderboard + backlog */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-1.5">
            <Users className="w-4 h-4 text-blue-600" />
            <p className="text-sm font-bold text-slate-800">Packer Leaderboard</p>
            <span className="text-[11px] text-slate-400">· packages packed sa range</span>
          </div>
          {packers.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-400 italic">Walang packed-date annotations sa range — i-assign ang packer + packed date sa Fulfillment.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {packers.slice(0, 8).map((p, i) => (
                  <tr key={p.name} className="hover:bg-slate-50/70">
                    <td className="px-4 py-2.5 w-10 text-center">
                      {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : <span className="text-slate-400 text-xs">{i + 1}</span>}
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-slate-800">{p.name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-bold text-slate-800">{num(p.packed)} <span className="text-[11px] font-normal text-slate-400">packed</span></td>
                    <td className="px-4 py-2.5 text-right text-xs text-slate-400 whitespace-nowrap">last: {p.last}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <p className="text-sm font-bold text-slate-800">Fulfillment Backlog</p>
            <span className="text-[11px] text-slate-400">· hindi pa nakakalabas ng bodega, pinakamatanda muna</span>
          </div>
          {backlog.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-400 italic flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Walang backlog — lahat ng orders ay gumagalaw. 🎉</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {backlog.slice(0, 8).map(r => (
                  <tr key={r.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-slate-800 leading-tight truncate max-w-[180px]">{r.customer_name || "—"}</p>
                      <p className="text-[11px] text-slate-400 truncate max-w-[180px]">{r.page_name} · {r.date_added}</p>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 max-w-[160px] truncate" title={r.order_item}>{r.order_item || "—"}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold"
                        style={{ background: `${STATUS_COLOR[r._st] || "#94a3b8"}22`, color: STATUS_COLOR[r._st] || "#64748b" }}>{disp(r._st)}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${r._age >= 3 ? "bg-rose-100 text-rose-700" : r._age >= 1 ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
                        {r._age === 0 ? "today" : `${num(r._age)}d old`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

function ChartBox({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <p className="text-sm font-bold text-slate-800">{title}</p>
      {subtitle && <p className="text-[11px] text-slate-400 mb-1">{subtitle}</p>}
      {children}
    </div>
  )
}
const Empty = ({ label = "Wala pang datos." }: { label?: string }) => (
  <div className="h-[230px] flex items-center justify-center text-sm text-slate-400 italic">{label}</div>
)
