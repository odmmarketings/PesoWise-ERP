"use client"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Wallet, Boxes, Tag, AlertTriangle, TrendingDown, PackageOpen, Eye, EyeOff,
  BarChart3, RefreshCw, ScanSearch, CheckCircle2, XCircle, Skull,
} from "lucide-react"
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts"
import { itemRemaining, type ProductItem } from "@/lib/product-items-store"
import { useStockReleases } from "@/lib/stock-releases-store"
import { useUnitCodes } from "@/lib/unit-codes-store"
import { useActivePages } from "@/lib/pages-store"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import { cachedJson } from "@/lib/pancake-cache"

// ──────────────────────────────────────────────────────────────────────────────
// INVENTORY DASHBOARD — buod ng buong warehouse: magkano ang nakatali sa stock,
// ilan ang natitira kada produkto, ano ang paubos/patay na stock, at isang
// STOCK-OUT AUDIT na nagkukumpara ng MANUAL releases (Stocks module) laban sa
// AUTOMATED na lumabas via Pancake POS (lahat ng na-shipped-out sa range).
// Lahat ng numero ay galing sa totoong data — walang inimbentong metric.
// ──────────────────────────────────────────────────────────────────────────────

const peso = (n: number) => "₱" + (isFinite(n) ? n : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (n: number) => (isFinite(n) ? n : 0).toLocaleString("en-PH")
const LOW_PCT = 0.2            // "paubos" = natitira ≤ 20% ng pinasok
const TREND_DAYS = 30
const CHARTS_KEY = "pesowise_invdash_charts"   // "1" = ipinapakita ang graphs
const PALETTE = ["#2563eb", "#0891b2", "#0d9488", "#059669", "#65a30d", "#ca8a04", "#d97706", "#ea580c", "#dc2626", "#db2777", "#9333ea", "#4f46e5"]

const pad = (n: number) => String(n).padStart(2, "0")
const dstr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01` }

// Pancake rows sa SHIPPED-OUT basis — ang date window ay ang oras na naipadala sa courier,
// kaya eksaktong "lahat ng lumabas sa warehouse" sa range. (Kapareho ng Fulfillment proxy.)
async function fetchShippedRows(apiKey: string, pageId: string, from: string, to: string): Promise<any[]> {
  const json = await cachedJson(
    `/api/pancake/orders?api_key=${encodeURIComponent(apiKey)}&page_id=${encodeURIComponent(pageId)}`
    + `&from=${from}&to=${to}&phase=rows&basis=shipped_out`
  )
  return Array.isArray(json.rows) ? json.rows : []
}
async function mapLimit<T>(items: T[], limit: number, fn: (i: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) await fn(items[i++]) }))
}

// "2x Lumyra, 1x Iba" → [{qty, name}] — kapareho ng Fulfillment parser.
const parseItems = (orderItem: string) => String(orderItem || "").split(",").map(s => s.trim()).filter(Boolean).map(seg => {
  const m = seg.match(/^(\d+)\s*x\s*(.+)$/i)
  return m ? { qty: Number(m[1]) || 1, name: m[2].trim() } : { qty: 1, name: seg }
})

type AuditRow = { item: ProductItem; expected: number; manual: number }
type AuditResult = {
  rows: AuditRow[]; unmapped: { name: string; qty: number }[]; errors: string[]
  orders: number; from: string; to: string
}

export function InventoryDashboard({ items }: { items: ProductItem[] }) {
  const releases = useStockReleases()
  const unitStore = useUnitCodes()
  const activePages = useActivePages()

  // Graphs — NAKA-HIDE by default; naaalala ang huling pinili.
  const [showCharts, setShowCharts] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    try { return localStorage.getItem(CHARTS_KEY) === "1" } catch { return false }
  })
  const toggleCharts = () => setShowCharts(s => {
    try { localStorage.setItem(CHARTS_KEY, s ? "0" : "1") } catch {}
    return !s
  })

  // Parehong saklaw ng Product Items list: hindi deleted, hindi archived.
  const live = useMemo(() => items.filter(i => !i.deleted && !i.archived), [items])

  // ── Stat cards ──────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let value = 0, qty = 0, writeOff = 0, released = 0, active = 0, low = 0, out = 0
    for (const i of live) {
      const rem = itemRemaining(i)
      value += i.cog * rem
      qty += rem
      writeOff += i.cog * (i.damage + i.loss)
      released += i.released || 0
      if (i.status === "Active") active++
      if (rem <= 0) out++
      else if (i.goods > 0 && rem <= i.goods * LOW_PCT) low++
    }
    return { value, qty, writeOff, released, active, low, out }
  }, [live])

  // ── Manual releases sa huling 30 araw (trend + velocity) ────────────────────
  const recent = useMemo(() => {
    const cutoff = Date.now() - TREND_DAYS * 86400000
    const perDay = new Map<string, number>()
    const perItem = new Map<string, number>()
    for (const r of releases.releases) {
      const t = new Date(r.date).getTime()
      if (isNaN(t) || t < cutoff) continue
      const day = r.date.slice(0, 10)
      for (const it of r.items) {
        perDay.set(day, (perDay.get(day) || 0) + it.deducted)
        perItem.set(it.item_id, (perItem.get(it.item_id) || 0) + it.deducted)
      }
    }
    const trend: { day: string; qty: number }[] = []
    for (let i = TREND_DAYS - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000)
      const key = dstr(d)
      trend.push({ day: key.slice(5), qty: perDay.get(key) || 0 })
    }
    return { trend, perItem }
  }, [releases.releases])

  // ── Action tables ───────────────────────────────────────────────────────────
  const lowStock = useMemo(() =>
    live
      .filter(i => { const rem = itemRemaining(i); return rem <= 0 || (i.goods > 0 && rem <= i.goods * LOW_PCT) })
      .map(i => {
        const rem = itemRemaining(i)
        const avgDaily = (recent.perItem.get(i.id) || 0) / TREND_DAYS
        return { item: i, rem, daysLeft: avgDaily > 0 && rem > 0 ? rem / avgDaily : null }
      })
      .sort((a, b) => (a.rem <= 0 ? -1 : 1) - (b.rem <= 0 ? -1 : 1) || (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9))
  , [live, recent.perItem])

  const deadStock = useMemo(() =>
    live
      .filter(i => itemRemaining(i) > 0 && !(recent.perItem.get(i.id) || 0))
      .map(i => ({ item: i, rem: itemRemaining(i), value: itemRemaining(i) * i.cog }))
      .sort((a, b) => b.value - a.value)
  , [live, recent.perItem])

  const damageRates = useMemo(() =>
    live
      .filter(i => i.goods > 0 && (i.damage + i.loss) > 0)
      .map(i => ({ item: i, rate: (i.damage + i.loss) / i.goods, cost: (i.damage + i.loss) * i.cog }))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 8)
  , [live])

  // ── Chart data ──────────────────────────────────────────────────────────────
  const valueByProduct = useMemo(() =>
    live.map(i => ({ name: i.name || i.sku, value: i.cog * itemRemaining(i) }))
      .filter(x => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 10)
  , [live])
  const qtyByProduct = useMemo(() =>
    live.map(i => ({ name: i.name || i.sku, qty: itemRemaining(i) }))
      .filter(x => x.qty > 0).sort((a, b) => b.qty - a.qty).slice(0, 10)
  , [live])
  const stockHealth = useMemo(() =>
    live.filter(i => i.goods > 0)
      .sort((a, b) => b.goods - a.goods).slice(0, 10)
      .map(i => ({ name: i.name || i.sku, Remaining: itemRemaining(i), Released: i.released || 0, "Damage/Loss": i.damage + i.loss }))
  , [live])
  const valueBySupplier = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of live) {
      const v = i.cog * itemRemaining(i)
      if (v <= 0) continue
      const k = i.supplier || "No supplier"
      m.set(k, (m.get(k) || 0) + v)
    }
    return Array.from(m, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8)
  }, [live])

  // ── STOCK-OUT AUDIT: manual (Stocks releases) vs Pancake shipped-out ────────
  const [audFrom, setAudFrom] = useState(monthStart())
  const [audTo, setAudTo] = useState(dstr(new Date()))
  const [auditing, setAuditing] = useState(false)
  const [audit, setAudit] = useState<AuditResult | null>(null)

  // Order name → mga product item components. Unang plain items (sarili nila, qty 1),
  // tapos unit codes (bundle recipes) — kapareho ng Fulfillment COG mapping.
  const recipeByName = useMemo(() => {
    const alive = items.filter(i => !i.deleted)
    const byName = new Map(alive.map(i => [i.name.toLowerCase(), i]))
    const m = new Map<string, { itemId: string; qty: number }[]>()
    for (const i of alive) if (!m.has(i.name.toLowerCase())) m.set(i.name.toLowerCase(), [{ itemId: i.id, qty: 1 }])
    for (const c of unitStore.codes) {
      if (!c.code) continue
      const comps = c.items
        .map(r => ({ itemId: byName.get(r.name.toLowerCase())?.id || "", qty: r.qty || 1 }))
        .filter(x => x.itemId)
      if (comps.length) m.set(c.code.toLowerCase(), comps)
    }
    return m
  }, [items, unitStore.codes])

  async function runAudit() {
    setAuditing(true)
    const from = audFrom, to = audTo
    const pages = activePages.filter(p => p.api_key && (p.pancake_page_id || p.shop_id))
    const expected = new Map<string, number>()
    const unmapped = new Map<string, number>()
    const errors: string[] = []
    let orders = 0

    await mapLimit(pages, 3, async p => {
      try {
        const rows = await fetchShippedRows(p.api_key, p.pancake_page_id || p.shop_id, from, to)
        for (const r of rows) {
          orders++
          for (const li of parseItems(r.order_item)) {
            const recipe = recipeByName.get(li.name.toLowerCase())
            if (!recipe) { unmapped.set(li.name, (unmapped.get(li.name) || 0) + li.qty); continue }
            for (const c of recipe) expected.set(c.itemId, (expected.get(c.itemId) || 0) + li.qty * c.qty)
          }
        }
      } catch (e: any) { errors.push(`${p.name}: ${e?.message || "fetch failed"}`) }
    })

    // Manual side — Stocks-module releases sa parehong petsa (ISO date → YYYY-MM-DD).
    const manual = new Map<string, number>()
    for (const r of releases.releases) {
      const day = (r.date || "").slice(0, 10)
      if (!day || day < from || day > to) continue
      for (const it of r.items) manual.set(it.item_id, (manual.get(it.item_id) || 0) + it.deducted)
    }

    const ids = new Set([...expected.keys(), ...manual.keys()])
    const rows: AuditRow[] = []
    for (const id of ids) {
      const item = items.find(i => i.id === id)
      if (!item) continue
      rows.push({ item, expected: expected.get(id) || 0, manual: manual.get(id) || 0 })
    }
    rows.sort((a, b) => Math.abs(b.expected - b.manual) - Math.abs(a.expected - a.manual))
    setAudit({
      rows,
      unmapped: Array.from(unmapped, ([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty),
      errors, orders, from, to,
    })
    setAuditing(false)
  }

  const audSummary = useMemo(() => {
    if (!audit) return null
    let matched = 0, expTotal = 0, manTotal = 0, varValue = 0
    for (const r of audit.rows) {
      if (r.expected === r.manual) matched++
      expTotal += r.expected; manTotal += r.manual
      varValue += Math.abs(r.manual - r.expected) * r.item.cog
    }
    return { matched, total: audit.rows.length, expTotal, manTotal, varValue }
  }, [audit])

  const cards = [
    { label: "TOTAL INVENTORY VALUE", value: peso(stats.value), color: "bg-blue-600", icon: Wallet },
    { label: "TOTAL REMAINING QTY", value: num(stats.qty), color: "bg-teal-600", icon: Boxes },
    { label: "ACTIVE PRODUCTS", value: num(stats.active), color: "bg-slate-700", icon: Tag },
    { label: "DAMAGE + LOSS VALUE", value: peso(stats.writeOff), color: "bg-rose-500", icon: TrendingDown },
    { label: "TOTAL RELEASED (UNITS)", value: num(stats.released), color: "bg-indigo-500", icon: PackageOpen },
    { label: "LOW / OUT OF STOCK", value: `${num(stats.low)} / ${num(stats.out)}`, color: "bg-amber-500", icon: AlertTriangle },
  ]

  return (
    <div className="space-y-4">
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
            <ChartBox title="Inventory Value per Product" subtitle="Top 10 — saan nakatali ang pera">
              {valueByProduct.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={valueByProduct} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: any) => peso(Number(v))} />
                    <Bar dataKey="value" fill="#2563eb" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartBox>
            <ChartBox title="Remaining Qty per Product" subtitle="Top 10 — pisikal na piraso sa warehouse">
              {qtyByProduct.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={qtyByProduct} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: any) => num(Number(v))} />
                    <Bar dataKey="qty" fill="#0d9488" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartBox>
            <ChartBox title="Stock Health per Product" subtitle="Natitira vs nailabas vs sira/nawala (top 10 by intake)">
              {stockHealth.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={stockHealth}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-18} textAnchor="end" height={64} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Remaining" stackId="s" fill="#10b981" />
                    <Bar dataKey="Released" stackId="s" fill="#6366f1" />
                    <Bar dataKey="Damage/Loss" stackId="s" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartBox>
            <ChartBox title={`Manual Releases Trend (last ${TREND_DAYS} days)`} subtitle="Units na inilabas via Stocks module kada araw">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={recent.trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} interval={4} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="qty" name="Units released" stroke="#2563eb" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartBox>
            <ChartBox title="Inventory Value by Supplier">
              {valueBySupplier.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={valueBySupplier} dataKey="value" nameKey="name" outerRadius={95}
                      label={(e: any) => `${e.name} (${Math.round(e.percent * 100)}%)`} labelLine={false} fontSize={10}>
                      {valueBySupplier.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => peso(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </ChartBox>
            <ChartBox title="Damage / Loss Rate" subtitle="% ng pinasok na nasira o nawala — pinakamataas muna">
              {damageRates.length === 0 ? <Empty label="Walang naitalang damage/loss. 🎉" /> : (
                <div className="space-y-1.5 pt-1">
                  {damageRates.map(({ item, rate, cost }) => (
                    <div key={item.id} className="flex items-center gap-2 text-sm">
                      <span className="w-40 truncate text-slate-700">{item.name || item.sku}</span>
                      <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, rate * 100)}%`, background: rate > 0.1 ? "#ef4444" : "#f59e0b" }} />
                      </div>
                      <span className="w-14 text-right tabular-nums font-semibold text-slate-800">{(rate * 100).toFixed(1)}%</span>
                      <span className="w-24 text-right tabular-nums text-xs text-slate-400">{peso(cost)}</span>
                    </div>
                  ))}
                </div>
              )}
            </ChartBox>
          </div>
        )}
      </div>

      {/* Low stock + dead stock */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <p className="text-sm font-bold text-slate-800">Low Stock Alert</p>
            <span className="text-[11px] text-slate-400">· ubos na o ≤ {LOW_PCT * 100}% na lang ng pinasok</span>
          </div>
          {lowStock.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-400 italic">Walang paubos na stock. 👍</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {lowStock.slice(0, 8).map(({ item, rem, daysLeft }) => (
                  <tr key={item.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-slate-800 leading-tight">{item.name || item.sku}</p>
                      <p className="text-[11px] text-slate-400 font-mono">{item.sku}</p>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span className={`font-bold ${rem <= 0 ? "text-rose-600" : "text-amber-600"}`}>{num(rem)}</span>
                      <span className="text-[11px] text-slate-400"> / {num(item.goods)}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {rem <= 0
                        ? <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-700">OUT OF STOCK</span>
                        : daysLeft !== null
                          ? <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700">~{Math.ceil(daysLeft)} days left</span>
                          : <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500">low</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-1.5">
            <Skull className="w-4 h-4 text-slate-400" />
            <p className="text-sm font-bold text-slate-800">Dead Stock</p>
            <span className="text-[11px] text-slate-400">· may laman pero walang labas sa huling {TREND_DAYS} araw</span>
          </div>
          {deadStock.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-400 italic">Lahat ng may stock ay gumagalaw. 🎉</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {deadStock.slice(0, 8).map(({ item, rem, value }) => (
                  <tr key={item.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-slate-800 leading-tight">{item.name || item.sku}</p>
                      <p className="text-[11px] text-slate-400 font-mono">{item.sku}</p>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{num(rem)} pcs</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-800 whitespace-nowrap">{peso(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── STOCK-OUT AUDIT ── */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <ScanSearch className="w-4 h-4 text-blue-600" /> Stock-Out Audit — Manual vs Pancake POS
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Kinukumpara ang MANUAL na inilabas (Stocks module) laban sa dapat lumabas ayon sa Pancake
              (lahat ng na-SHIPPED OUT sa range, hinati sa unit-code recipes).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <DateRangePicker a={audFrom} b={audTo} variant="header"
              onApply={(a, b) => { setAudFrom(a || monthStart()); setAudTo(b || dstr(new Date())) }} placeholder="This month" />
            <Button onClick={runAudit} disabled={auditing}>
              <RefreshCw className={`w-4 h-4 ${auditing ? "animate-spin" : ""}`} /> {auditing ? "Auditing…" : "Run Audit"}
            </Button>
          </div>
        </div>

        {!audit && !auditing && (
          <p className="px-4 py-8 text-sm text-slate-400 italic text-center">
            Pindutin ang <strong>Run Audit</strong> para i-pull ang shipped-out orders mula sa Pancake at ikumpara sa manual releases.
          </p>
        )}

        {audit && audSummary && (
          <div className="p-4 space-y-3">
            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              <SummaryTile label="Products Matched" value={`${audSummary.matched} / ${audSummary.total}`}
                tone={audSummary.matched === audSummary.total && audSummary.total > 0 ? "good" : "warn"} />
              <SummaryTile label="Pancake Shipped-Out (units)" value={num(audSummary.expTotal)} tone="plain" />
              <SummaryTile label="Manual Released (units)" value={num(audSummary.manTotal)} tone="plain" />
              <SummaryTile label="Variance Value (COG)" value={peso(audSummary.varValue)}
                tone={audSummary.varValue > 0 ? "bad" : "good"} />
            </div>
            <p className="text-[11px] text-slate-400">
              {num(audit.orders)} shipped-out order{audit.orders === 1 ? "" : "s"} · {audit.from} → {audit.to}
              {audit.errors.length > 0 && <span className="text-rose-500"> · {audit.errors.length} page{audit.errors.length === 1 ? "" : "s"} failed: {audit.errors.join("; ")}</span>}
            </p>

            {/* Per-product comparison */}
            {audit.rows.length === 0 ? (
              <p className="text-sm text-slate-400 italic py-4 text-center">Walang stock-out (manual man o Pancake) sa range na ito.</p>
            ) : (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] text-sm border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 text-[11px] font-semibold uppercase tracking-wide border-b border-slate-200">
                        <th className="px-4 py-2.5 text-left">Product</th>
                        <th className="px-4 py-2.5 text-right">Pancake Shipped-Out</th>
                        <th className="px-4 py-2.5 text-right">Manual Released</th>
                        <th className="px-4 py-2.5 text-right">Variance</th>
                        <th className="px-4 py-2.5 text-left">Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {audit.rows.map(({ item, expected, manual }) => {
                        const v = manual - expected
                        return (
                          <tr key={item.id} className="hover:bg-slate-50/70">
                            <td className="px-4 py-2.5">
                              <p className="font-semibold text-slate-800 leading-tight">{item.name || item.sku}</p>
                              <p className="text-[11px] text-slate-400 font-mono">{item.sku}</p>
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{num(expected)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{num(manual)}</td>
                            <td className={`px-4 py-2.5 text-right tabular-nums font-bold ${v === 0 ? "text-emerald-600" : "text-rose-600"}`}>
                              {v > 0 ? `+${num(v)}` : num(v)}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap">
                              {v === 0
                                ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700"><CheckCircle2 className="w-3 h-3" /> Matched</span>
                                : v < 0
                                  ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700"><XCircle className="w-3 h-3" /> Kulang ang manual ({num(-v)})</span>
                                  : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700"><XCircle className="w-3 h-3" /> Sobra ang manual ({num(v)})</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Unmapped — hindi ma-audit dahil walang katugmang unit code / product item */}
            {audit.unmapped.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" /> {audit.unmapped.length} order item name{audit.unmapped.length === 1 ? "" : "s"} ang WALANG katugmang unit code o product item — hindi kasama sa audit:
                </p>
                <p className="text-[11px] text-amber-700 mt-1">
                  {audit.unmapped.slice(0, 10).map(u => `${u.name} (${num(u.qty)})`).join(" · ")}
                  {audit.unmapped.length > 10 && ` · +${audit.unmapped.length - 10} pa`}
                </p>
              </div>
            )}

            <p className="text-[11px] text-slate-400">
              Paalala: ang “Manual Released” ay galing sa Stocks-module release log — ang mga direktang in-edit sa
              item form (hindi dumaan sa Stocks Update) ay hindi kasama sa bilang.
            </p>
          </div>
        )}
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

function SummaryTile({ label, value, tone }: { label: string; value: string; tone: "good" | "warn" | "bad" | "plain" }) {
  const cls = tone === "good" ? "bg-emerald-50 border-emerald-200 text-emerald-700"
    : tone === "bad" ? "bg-rose-50 border-rose-200 text-rose-700"
    : tone === "warn" ? "bg-amber-50 border-amber-200 text-amber-700"
    : "bg-slate-50 border-slate-200 text-slate-700"
  return (
    <div className={`rounded-xl border px-4 py-3 ${cls}`}>
      <p className="text-xl font-extrabold tabular-nums leading-none">{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-wider mt-1 opacity-80">{label}</p>
    </div>
  )
}
