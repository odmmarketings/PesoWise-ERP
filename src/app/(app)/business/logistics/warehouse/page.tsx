"use client"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Warehouse, RefreshCw, PackageOpen, Package, Clock, Truck, ScanBarcode, Undo2,
  Eye, EyeOff, BarChart3, Users, AlertTriangle, CheckCircle2,
} from "lucide-react"
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import { useActivePages } from "@/lib/pages-store"
import { useShippedOutScans } from "@/lib/shipped-out-store"
import { fetchFulfillmentMeta } from "@/lib/fulfillment-meta-store"

// ──────────────────────────────────────────────────────────────────────────────
// WAREHOUSE DASHBOARD — isang tingin sa buong operasyon ng bodega: ilang order ang
// dapat i-pack, nasaan sila sa pipeline, sino ang nag-pack, ilan ang na-scan
// palabas, at ilan ang pabalik (RTS). Live Pancake orders + fulfillment annotations
// + shipped-out scans — walang inimbentong numero.
// ──────────────────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0")
const dstr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01` }
const num = (n: number) => (isFinite(n) ? n : 0).toLocaleString("en-PH")
const CHARTS_KEY = "pesowise_whdash_charts"
const PALETTE = ["#2563eb", "#0891b2", "#0d9488", "#059669", "#65a30d", "#ca8a04", "#d97706", "#ea580c", "#dc2626", "#db2777", "#9333ea", "#4f46e5"]

async function fetchPageRows(apiKey: string, pageId: string, from: string, to: string, noCache = false): Promise<any[]> {
  const res = await fetch(
    `/api/pancake/orders?api_key=${encodeURIComponent(apiKey)}&page_id=${encodeURIComponent(pageId)}`
    + `&from=${from}&to=${to}&phase=rows&basis=sales_order${noCache ? "&nocache=1" : ""}`,
    { cache: "no-store" }
  )
  const json = await res.json()
  if (!res.ok || !json.success) throw new Error(json.error || "API error")
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
const STATUS_COLOR: Record<string, string> = {
  "New": "#94a3b8", "Restocking": "#f59e0b", "Prioritize Order": "#f43f5e", "Confirmed": "#3b82f6",
  "Packaging": "#a855f7", "Waiting for Pick Up": "#6366f1", "Shipped": "#f97316",
  "Delivered": "#10b981", "Returning": "#f59e0b", "Returned": "#ef4444", "Cancelled": "#dc2626", "Deleted": "#cbd5e1",
}
const TO_FULFILL = new Set(["New", "Confirmed", "Restocking", "Prioritize Order"])

function courierLabel(raw: string): string {
  const s = String(raw || "").toLowerCase()
  if (/j&t|jt/.test(s)) return "J&T"
  if (/spx|shopee/.test(s)) return "SPX"
  if (/flash/.test(s)) return "FLASH"
  if (/ninja/.test(s)) return "NINJAVAN"
  if (/lbc/.test(s)) return "LBC"
  return raw ? raw.toUpperCase().slice(0, 12) : "—"
}

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
    await mapLimit(pagesWithCreds, 3, async p => {
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

  const stats = useMemo(() => {
    let toFulfill = 0, packaging = 0, pickup = 0, shipped = 0, delivered = 0, returning = 0, returned = 0
    for (const r of withStatus) {
      if (TO_FULFILL.has(r._st)) toFulfill++
      else if (r._st === "Packaging") packaging++
      else if (r._st === "Waiting for Pick Up") pickup++
      else if (r._st === "Shipped") shipped++
      else if (r._st === "Delivered") delivered++
      else if (r._st === "Returning") returning++
      else if (r._st === "Returned") returned++
    }
    return { toFulfill, packaging, pickup, shipped, delivered, returning, returned }
  }, [withStatus])

  const today = dstr(new Date())
  const scannedToday = useMemo(() => scanStore.scans.filter(s => s.date === today).length, [scanStore.scans, today])
  const scansInRange = useMemo(() => scanStore.scans.filter(s => s.date >= win.from && s.date <= win.to), [scanStore.scans, win])

  // Scan coverage — ilan sa mga umalis na order (Shipped/Delivered/pabalik) ang dumaan sa scanner.
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

  // Backlog — pinakamatagal nang nakabinbin na hindi pa naipapadala.
  const backlog = useMemo(() => {
    const stuck = withStatus.filter(r => TO_FULFILL.has(r._st) || r._st === "Packaging")
    const now = Date.now()
    return stuck.map(r => {
      const t = new Date(String(r.date_added || "") + "T00:00:00").getTime()
      return { ...r, _age: isNaN(t) ? 0 : Math.floor((now - t) / 86400000) }
    }).sort((a, b) => b._age - a._age)
  }, [withStatus])

  // Charts
  const byStatus = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of withStatus) m.set(r._st, (m.get(r._st) || 0) + 1)
    return STATUS_MATCH.map(s => ({ name: s.l, value: m.get(s.l) || 0 })).filter(x => x.value > 0)
  }, [withStatus])
  const byCourier = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of withStatus) m.set(courierLabel(r.courier), (m.get(courierLabel(r.courier)) || 0) + 1)
    return Array.from(m, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8)
  }, [withStatus])
  const byPage = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of withStatus) m.set(r.page_name || "—", (m.get(r.page_name || "—") || 0) + 1)
    return Array.from(m, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10)
  }, [withStatus])
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

  const cards = [
    { label: "TO FULFILL", value: num(stats.toFulfill), color: "bg-slate-700", icon: PackageOpen },
    { label: "PACKAGING", value: num(stats.packaging), color: "bg-purple-500", icon: Package },
    { label: "WAITING FOR PICKUP", value: num(stats.pickup), color: "bg-indigo-500", icon: Clock },
    { label: "SHIPPED (RANGE)", value: num(stats.shipped), color: "bg-orange-500", icon: Truck },
    { label: "SCANNED OUT TODAY", value: num(scannedToday), color: "bg-blue-600", icon: ScanBarcode },
    { label: "RTS INCOMING / BACK", value: `${num(stats.returning)} / ${num(stats.returned)}`, color: "bg-rose-500", icon: Undo2 },
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

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
        {cards.map(c => (
          <div key={c.label} className={`relative overflow-hidden ${c.color} rounded-xl px-4 py-3 h-[78px] flex items-center justify-between`}>
            <c.icon strokeWidth={1} className="absolute -left-2 w-16 h-16 opacity-[0.12] text-white" />
            <div className="text-right ml-auto z-10 min-w-0">
              <p className="text-xl font-bold text-white leading-none tabular-nums truncate">{c.value}</p>
              <p className="text-[10px] text-white/75 font-semibold mt-1 tracking-wider uppercase leading-tight">{c.label}</p>
            </div>
          </div>
        ))}
      </div>

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
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={byStatus} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                      {byStatus.map(s => <Cell key={s.name} fill={STATUS_COLOR[s.name] || "#94a3b8"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartBox>
            <ChartBox title="Shipped Out Scans (last 14 days)" subtitle="Bilang ng parcels na na-scan palabas kada araw">
              <ResponsiveContainer width="100%" height={260}>
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
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={byCourier} dataKey="value" nameKey="name" outerRadius={90}
                      label={(e: any) => `${e.name} (${e.value})`} labelLine={false} fontSize={10}>
                      {byCourier.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </ChartBox>
            <ChartBox title="Orders per Page" subtitle="Top 10 — saan galing ang volume">
              {byPage.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={byPage} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#0d9488" radius={[0, 6, 6, 0]} />
                  </BarChart>
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
            <span className="text-[11px] text-slate-400">· packages packed sa range (mula sa Fulfillment assignments)</span>
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
            <span className="text-[11px] text-slate-400">· pinakamatagal nang hindi naipapadala</span>
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
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: `${STATUS_COLOR[r._st] || "#94a3b8"}22`, color: STATUS_COLOR[r._st] || "#64748b" }}>{r._st}</span>
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
  <div className="h-[220px] flex items-center justify-center text-sm text-slate-400 italic">{label}</div>
)
