"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import * as XLSX from "xlsx-js-style"
import {
  ScanBarcode, ScanLine, Camera, X, RefreshCw, RotateCcw, FileSpreadsheet,
  ClipboardList, CheckCircle2, Truck, CalendarDays,
} from "lucide-react"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import { useActivePages } from "@/lib/pages-store"
import { useUnitCodes } from "@/lib/unit-codes-store"
import { useProductItems } from "@/lib/product-items-store"
import { useStockReleases } from "@/lib/stock-releases-store"
import { useShippedOutScans, type ShippedScanItem } from "@/lib/shipped-out-store"

// ──────────────────────────────────────────────────────────────────────────────
// SHIPPED OUT (Barcode) — i-scan ang waybill tracking (camera / hardware scanner /
// type) sa paglabas ng parcel: hahanapin ang order sa Pancake, hahatiin sa unit-code
// recipes, at AWTOMATIKONG BABAWASAN ang inventory (product_items.released) na naka-log
// din sa stock_releases (kaya kita sa Transaction History at sa Stock-Out Audit bilang
// "manual" na labas). Dedup sa DB: isang beses lang mababawas ang isang tracking no.
// Pangalawang tab = SHIPPED OUT REPORT ng lahat ng na-scan, may date filter + courier tally.
// ──────────────────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0")
const dstr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01` }
const prettyDate = (s: string) => {
  if (!s) return "—"
  const d = new Date(s + "T00:00:00")
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })
}
const fmtDT = (iso: string) => {
  if (!iso) return ""
  const d = new Date(iso)
  return isNaN(d.getTime()) ? "" : d.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}
const num = (n: number) => (isFinite(n) ? n : 0).toLocaleString("en-PH")

// Scanner feedback (WebAudio) — kapareho ng RTS scanner para pamilyar sa staff.
function beep(kind: "ok" | "warn" | "error") {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    const ctx: AudioContext = ((beep as any)._ctx = (beep as any)._ctx || new Ctx())
    if (ctx.state === "suspended") ctx.resume()
    const play = (freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.3) => {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.type = type; o.frequency.value = freq
      g.gain.setValueAtTime(gain, ctx.currentTime + start)
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur)
      o.connect(g); g.connect(ctx.destination)
      o.start(ctx.currentTime + start); o.stop(ctx.currentTime + start + dur + 0.02)
    }
    if (kind === "ok") { play(1200, 0, 0.1); play(1700, 0.11, 0.16) }
    else if (kind === "warn") { play(900, 0, 0.09); play(650, 0.1, 0.09); play(1100, 0.2, 0.18) }
    else { play(170, 0, 0.4, "square", 0.4); play(140, 0.18, 0.3, "square", 0.35) }
  } catch {}
}

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

// "2x Lumyra, 1x Iba" → [{qty, name}] — kapareho ng Fulfillment/Inventory Dashboard parser.
const parseItems = (orderItem: string) => String(orderItem || "").split(",").map(s => s.trim()).filter(Boolean).map(seg => {
  const m = seg.match(/^(\d+)\s*x\s*(.+)$/i)
  return m ? { qty: Number(m[1]) || 1, name: m[2].trim() } : { qty: 1, name: seg }
})

// Pang-grupo ng courier para sa tally tiles (dynamic pero nililinis ang label).
function courierLabel(raw: string): string {
  const s = String(raw || "").toLowerCase()
  if (/j&t|jt/.test(s)) return "J&T"
  if (/spx|shopee/.test(s)) return "SPX"
  if (/flash/.test(s)) return "FLASH"
  if (/ninja/.test(s)) return "NINJAVAN"
  if (/lbc/.test(s)) return "LBC"
  return (raw || "OTHER").toUpperCase().slice(0, 12)
}

type Banner = { kind: "ok" | "warn" | "err"; title: string; sub: string }

export default function ShippedOutPage() {
  const activePages = useActivePages()
  const unitStore = useUnitCodes()
  const products = useProductItems()
  const releases = useStockReleases()
  const store = useShippedOutScans()

  const [tab, setTab] = useState<"scan" | "report">("scan")
  const pagesWithCreds = useMemo(() => activePages.filter(p => p.api_key && (p.pancake_page_id || p.shop_id)), [activePages])

  // ── Order lookup window (Pancake) — default: this month ──────────────────────
  const [winA, setWinA] = useState("")
  const [winB, setWinB] = useState("")
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [loadErr, setLoadErr] = useState("")
  const win = useMemo(() => ({
    from: winA || monthStart(),
    to: winB || dstr(new Date()),
  }), [winA, winB])
  const pagesKey = pagesWithCreds.map(p => `${p.api_key}~${p.pancake_page_id || p.shop_id}~${p.name}`).join("|")

  async function loadOrders(noCache = false) {
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
  useEffect(() => { loadOrders() }, [pagesKey, win.from, win.to])   // eslint-disable-line react-hooks/exhaustive-deps

  const byTracking = useMemo(() => {
    const m = new Map<string, any>()
    for (const r of rows) {
      const t = String(r.tracking_no || "").trim().toLowerCase()
      if (t && !m.has(t)) m.set(t, r)
    }
    return m
  }, [rows])

  // Order name → product item components (unit-code recipes; plain items = sarili nila).
  const recipeByName = useMemo(() => {
    const alive = products.items.filter(i => !i.deleted)
    const byName = new Map(alive.map(i => [i.name.toLowerCase(), i]))
    const m = new Map<string, { itemId: string; sku: string; name: string; qty: number }[]>()
    for (const i of alive) if (!m.has(i.name.toLowerCase())) m.set(i.name.toLowerCase(), [{ itemId: i.id, sku: i.sku, name: i.name, qty: 1 }])
    for (const c of unitStore.codes) {
      if (!c.code) continue
      const comps = c.items.map(r => {
        const it = byName.get(r.name.toLowerCase())
        return it ? { itemId: it.id, sku: it.sku, name: it.name, qty: r.qty || 1 } : null
      }).filter(Boolean) as { itemId: string; sku: string; name: string; qty: number }[]
      if (comps.length) m.set(c.code.toLowerCase(), comps)
    }
    return m
  }, [products.items, unitStore.codes])

  // ── Scan handling ────────────────────────────────────────────────────────────
  const [manual, setManual] = useState("")
  const [banner, setBanner] = useState<Banner | null>(null)
  const [camOpen, setCamOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastRef = useRef({ code: "", at: 0 })

  function showBanner(b: Banner) {
    if (bannerTimer.current) clearTimeout(bannerTimer.current)
    setBanner(b)
    bannerTimer.current = setTimeout(() => setBanner(null), b.kind === "ok" ? 2500 : 4000)
  }

  async function handleScan(codeRaw: string, fromCamera = false) {
    const code = codeRaw.trim()
    if (!code || busy) return
    // Camera frames repeat habang nasa view ang barcode — 1.5s cooldown per same code.
    const now = Date.now()
    if (fromCamera && lastRef.current.code === code && now - lastRef.current.at < 1500) return
    lastRef.current = { code, at: now }

    const key = code.toLowerCase()
    const existing = store.scans.find(s => s.tracking_no.toLowerCase() === key)
    if (existing) {
      beep("error")
      showBanner({ kind: "err", title: "ALREADY SCANNED", sub: `${code} — na-scan na noong ${fmtDT(existing.created_at)}${existing.scanned_by ? ` · ${existing.scanned_by}` : ""}` })
      return
    }
    const row = byTracking.get(key)
    if (!row) {
      beep("error")
      showBanner({ kind: "err", title: "NOT FOUND", sub: `${code} — wala sa loaded orders (i-check ang Order Date range sa taas)` })
      return
    }

    // I-explode ang waybill lines → product item deductions.
    const perItem = new Map<string, ShippedScanItem>()
    const unmapped: string[] = []
    for (const li of parseItems(row.order_item)) {
      const recipe = recipeByName.get(li.name.toLowerCase())
      if (!recipe) { unmapped.push(li.name); continue }
      for (const c of recipe) {
        const prev = perItem.get(c.itemId)
        const add = li.qty * c.qty
        if (prev) prev.deducted += add
        else perItem.set(c.itemId, { item_id: c.itemId, sku: c.sku, name: c.name, deducted: add })
      }
    }
    const items = Array.from(perItem.values())
    const total = items.reduce((s, i) => s + i.deducted, 0)

    setBusy(true)
    // 1) Itala MUNA ang scan — ito ang dedup gate (DB unique). Kapag duplicate, WALANG deduction.
    const res = await store.addScan({
      tracking_no: code, courier: String(row.courier || ""), page_name: String(row.page_name || ""),
      order_id: String(row.id || ""), customer: String(row.customer_name || ""),
      order_item: String(row.order_item || ""), items, deducted_total: total, date: dstr(new Date()),
    })
    if (res === "duplicate") {
      setBusy(false); beep("error")
      showBanner({ kind: "err", title: "ALREADY SCANNED", sub: `${code} — naitala na (ibang device/tab).` })
      return
    }
    if (res !== "added") {
      setBusy(false); beep("error")
      showBanner({ kind: "err", title: "SAVE FAILED", sub: res })
      return
    }
    // 2) Saka ibawas sa inventory + i-log sa release history.
    if (items.length) {
      products.releaseStock(items.map(i => ({ id: i.item_id, qty: i.deducted })))
      releases.addRelease({
        category: "Shipped Out", ref: code,
        items: items.map(i => ({ item_id: i.item_id, sku: i.sku, name: i.name, required: 1, release: i.deducted, deducted: i.deducted })),
      })
    }
    setBusy(false)
    setManual("")
    if (items.length === 0) {
      beep("warn")
      showBanner({ kind: "warn", title: "SCANNED — WALANG NA-LESS", sub: `${code} — walang unit code/product na tumugma sa "${row.order_item}". Naitala pa rin ang scan.` })
    } else {
      beep("ok")
      showBanner({ kind: "ok", title: "SHIPPED OUT ✓", sub: `${code} · ${row.customer_name || ""} — nabawas: ${items.map(i => `${num(i.deducted)}× ${i.name}`).join(", ")}${unmapped.length ? ` · walang match: ${unmapped.join(", ")}` : ""}` })
    }
    inputRef.current?.focus()
  }

  // ── Today panel (kanan, kagaya ng reference) ─────────────────────────────────
  const today = dstr(new Date())
  const todayScans = useMemo(() => store.scans.filter(s => s.date === today), [store.scans, today])
  const todayCouriers = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of todayScans) m.set(courierLabel(s.courier), (m.get(courierLabel(s.courier)) || 0) + 1)
    return Array.from(m, ([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
  }, [todayScans])

  // ── Report tab ───────────────────────────────────────────────────────────────
  const [repA, setRepA] = useState(monthStart())
  const [repB, setRepB] = useState(dstr(new Date()))
  const repScans = useMemo(() =>
    store.scans.filter(s => s.date >= repA && s.date <= repB)
  , [store.scans, repA, repB])
  const repCouriers = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of repScans) m.set(courierLabel(s.courier), (m.get(courierLabel(s.courier)) || 0) + 1)
    return Array.from(m, ([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
  }, [repScans])

  function exportReport() {
    const headers = ["Date/Time", "Tracking No", "Courier", "Page", "Customer", "Order", "Deducted (units)", "Deducted Detail", "Scanned By"]
    const data = [headers, ...repScans.map(s => [
      fmtDT(s.created_at), s.tracking_no, s.courier, s.page_name, s.customer, s.order_item,
      s.deducted_total, s.items.map(i => `${i.deducted}x ${i.name}`).join(", "), s.scanned_by,
    ])]
    const ws = XLSX.utils.aoa_to_sheet(data)
    for (let c = 0; c < headers.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c })
      if (ws[addr]) (ws[addr] as any).s = { fill: { patternType: "solid", fgColor: { rgb: "FF17858C" } }, font: { bold: true, color: { rgb: "FFFFFFFF" } } }
    }
    ws["!cols"] = headers.map(h => ({ wch: Math.max(14, h.length + 2) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Shipped Out")
    XLSX.writeFile(wb, `Shipped-Out_${repA}_to_${repB}.xlsx`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2 pb-4 border-b border-slate-100">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><ScanBarcode className="w-5 h-5" /> SHIPPED OUT</h1>
        <div className="flex items-center gap-2">
          <DateRangePicker a={winA} b={winB} variant="header"
            onApply={(a, b) => { setWinA(a || ""); setWinB(b || "") }} placeholder="Order window: This month" />
          <button onClick={() => loadOrders(true)} title="Refresh orders"
            className="h-9 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1">
        <button onClick={() => setTab("scan")}
          className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 ${tab === "scan" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100 border border-slate-200"}`}>
          <ScanLine className="w-4 h-4" /> Scan
        </button>
        <button onClick={() => setTab("report")}
          className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 ${tab === "report" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100 border border-slate-200"}`}>
          <ClipboardList className="w-4 h-4" /> Shipped Out Report ({num(store.scans.length)})
        </button>
      </div>

      {loadErr && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{loadErr}</div>}

      {tab === "scan" && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 items-start">
          {/* Left — tracking input (reference layout) */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            {banner && (
              <div className={`mb-4 rounded-xl px-4 py-3 text-white ${banner.kind === "ok" ? "bg-emerald-600" : banner.kind === "warn" ? "bg-amber-500" : "bg-red-600"}`}>
                <p className="font-extrabold text-sm">{banner.title}</p>
                <p className="text-xs opacity-90 break-words">{banner.sub}</p>
              </div>
            )}
            <div className="grid grid-cols-[130px_1fr] items-center gap-3 py-4 border-b border-slate-100">
              <label className="text-sm font-semibold text-slate-600 text-right">TRACKING NO <span className="text-red-500">*</span></label>
              <input ref={inputRef} autoFocus value={manual} spellCheck={false}
                onChange={e => setManual(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && manual.trim()) handleScan(manual) }}
                placeholder="I-type, i-hardware-scan, o buksan ang camera"
                className="h-11 rounded-lg border border-slate-300 px-3 text-sm font-mono focus:outline-none focus:border-blue-500" />
            </div>
            <div className="flex items-center gap-2 pt-4 flex-wrap">
              <Button onClick={() => manual.trim() && handleScan(manual)} disabled={busy || !manual.trim()}>
                {busy ? "Saving…" : "Submit"}
              </Button>
              <Button variant="outline" onClick={() => { setManual(""); inputRef.current?.focus() }}>Cancel</Button>
              <Button className="ml-auto bg-slate-900 hover:bg-slate-800 text-white" onClick={() => setCamOpen(true)}>
                <Camera className="w-4 h-4" /> SCAN BARCODE
              </Button>
            </div>
            <p className="text-[11px] text-slate-400 mt-4">
              {loading ? "Loading orders mula sa Pancake…" : `${num(rows.length)} order${rows.length === 1 ? "" : "s"} ang naka-load (${win.from} → ${win.to}) mula sa ${pagesWithCreds.length} page${pagesWithCreds.length === 1 ? "" : "s"}.`}
              {" "}Kapag na-scan, awtomatikong mababawas ang inventory via unit-code recipe at maitatala sa release history.
            </p>
          </div>

          {/* Right — today panel (reference: As of + list + courier tally) */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between">
              <div>
                <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><ScanBarcode className="w-4 h-4 text-blue-600" /> SHIPPED OUT</p>
                <p className="text-[11px] text-slate-400 flex items-center gap-1"><CalendarDays className="w-3 h-3" /> As of {prettyDate(today)}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-extrabold text-blue-600 tabular-nums">{num(todayScans.length)}</span>
                <button onClick={() => store.refresh()} title="Reset / reload"
                  className="text-xs text-slate-400 hover:text-slate-700 flex items-center gap-1"><RotateCcw className="w-3.5 h-3.5" /> Reset</button>
              </div>
            </div>
            <div className="max-h-[380px] overflow-auto divide-y divide-slate-100">
              {todayScans.length === 0 && <p className="px-4 py-6 text-sm text-slate-400 italic text-center">Wala pang na-scan ngayong araw.</p>}
              {todayScans.map(s => (
                <div key={s.id} className="px-4 py-2 flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-mono text-slate-800 truncate">{s.tracking_no}</p>
                    <p className="text-[11px] text-slate-400 truncate">{s.courier || "—"} · {num(s.deducted_total)} unit{s.deducted_total === 1 ? "" : "s"} less · {fmtDT(s.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-slate-200">
              <div className="grid grid-cols-3 divide-x divide-slate-100 text-center">
                {(todayCouriers.length ? todayCouriers.slice(0, 3) : [{ label: "—", count: 0 }]).map(c => (
                  <div key={c.label} className="px-2 py-2">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase">{c.label}</p>
                    <p className="text-sm font-extrabold text-slate-800 tabular-nums">{num(c.count)}</p>
                  </div>
                ))}
              </div>
              <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">Total Shipped Out</span>
                <span className="text-base font-extrabold text-slate-900 tabular-nums">{num(todayScans.length)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "report" && (
        <div className="space-y-3">
          <div className="bg-white rounded-xl border border-slate-200 p-3 flex items-center gap-2 flex-wrap">
            <DateRangePicker a={repA} b={repB} variant="header"
              onApply={(a, b) => { setRepA(a || monthStart()); setRepB(b || dstr(new Date())) }} placeholder="This month" />
            <span className="text-xs text-slate-400">{repA} → {repB}</span>
            <div className="ml-auto">
              <Button variant="outline" onClick={exportReport} disabled={repScans.length === 0}>
                <FileSpreadsheet className="w-4 h-4" /> Export to Excel
              </Button>
            </div>
          </div>

          {/* Courier tally (reference footer style) */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
            {repCouriers.slice(0, 4).map(c => (
              <div key={c.label} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1"><Truck className="w-3 h-3" /> {c.label}</p>
                <p className="text-xl font-extrabold text-slate-800 tabular-nums">{num(c.count)}</p>
              </div>
            ))}
            <div className="bg-slate-800 rounded-xl px-4 py-3">
              <p className="text-[10px] font-semibold text-slate-300 uppercase tracking-wider">Total Shipped Out</p>
              <p className="text-xl font-extrabold text-white tabular-nums">{num(repScans.length)}</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-[11px] font-semibold uppercase tracking-wide border-b border-slate-200">
                    <th className="px-4 py-3 text-left">Date/Time</th>
                    <th className="px-4 py-3 text-left">Tracking No</th>
                    <th className="px-4 py-3 text-left">Courier</th>
                    <th className="px-4 py-3 text-left">Page</th>
                    <th className="px-4 py-3 text-left">Customer</th>
                    <th className="px-4 py-3 text-left">Order</th>
                    <th className="px-4 py-3 text-right">Less sa Inventory</th>
                    <th className="px-4 py-3 text-left">Scanned By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {!store.loaded && <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400 italic">Loading…</td></tr>}
                  {store.loaded && repScans.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400 italic">Walang na-scan sa range na ito.</td></tr>
                  )}
                  {repScans.map(s => (
                    <tr key={s.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-2.5 whitespace-nowrap text-xs text-slate-500">{fmtDT(s.created_at)}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap font-mono text-slate-800">{s.tracking_no}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{s.courier || "—"}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600 max-w-[140px] truncate">{s.page_name || "—"}</td>
                      <td className="px-4 py-2.5 text-slate-600 max-w-[160px] truncate">{s.customer || "—"}</td>
                      <td className="px-4 py-2.5 text-slate-600 max-w-[220px] truncate" title={s.order_item}>{s.order_item || "—"}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {s.deducted_total > 0
                          ? <span className="font-semibold text-slate-800 tabular-nums" title={s.items.map(i => `${i.deducted}× ${i.name}`).join(", ")}>{num(s.deducted_total)} unit{s.deducted_total === 1 ? "" : "s"}</span>
                          : <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700">walang match</span>}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-xs text-slate-500">{s.scanned_by || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {camOpen && <CameraScanOverlay onDecode={code => handleScan(code, true)} onClose={() => setCamOpen(false)} />}
    </div>
  )
}

// ── Camera scanner — same approach as the RTS scanner (native BarcodeDetector sa
// Android Chrome, high-res, buong frame; ZXing fallback sa iOS/lumang browser). ──
function CameraScanOverlay({ onDecode, onClose }: { onDecode: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<{ stop: () => void } | null>(null)
  const [state, setState] = useState<"idle" | "starting" | "on" | "error">("idle")
  const [err, setErr] = useState("")
  useEffect(() => () => { controlsRef.current?.stop() }, [])

  async function start() {
    controlsRef.current?.stop()
    setState("starting"); setErr("")
    const constraints: MediaStreamConstraints = {
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    }
    try {
      const BD = (window as any).BarcodeDetector
      if (BD) {
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        const video = videoRef.current!
        video.srcObject = stream
        await video.play().catch(() => {})
        setState("on")
        let detector: any
        try {
          const supported: string[] | undefined = await BD.getSupportedFormats?.()
          const want = ["code_128", "code_39", "codabar", "ean_13", "ean_8", "itf", "upc_a", "upc_e", "qr_code", "data_matrix"]
          const formats = supported ? want.filter(f => supported.includes(f)) : want
          detector = new BD(formats.length ? { formats } : undefined)
        } catch { detector = new BD() }
        let stopped = false
        let timer: ReturnType<typeof setTimeout> | null = null
        const tick = async () => {
          if (stopped) return
          try { const codes = await detector.detect(video); if (codes?.length) onDecode(codes[0].rawValue) } catch {}
          if (!stopped) timer = setTimeout(tick, 120)
        }
        tick()
        controlsRef.current = { stop: () => { stopped = true; if (timer) clearTimeout(timer); stream.getTracks().forEach(t => t.stop()) } }
      } else {
        const { BrowserMultiFormatReader } = await import("@zxing/browser")
        const reader = new BrowserMultiFormatReader()
        const controls = await reader.decodeFromConstraints(constraints, videoRef.current!, result => { if (result) onDecode(result.getText()) })
        controlsRef.current = controls
        setState("on")
      }
    } catch (e: any) {
      setState("error")
      setErr(e?.message || "Camera unavailable")
    }
  }

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <span className="text-white font-bold flex items-center gap-2"><Camera className="w-5 h-5" /> Shipped Out Scanner</span>
        <button onClick={() => { controlsRef.current?.stop(); onClose() }}
          className="w-9 h-9 rounded-full bg-white/10 text-white flex items-center justify-center"><X className="w-5 h-5" /></button>
      </div>
      <div className="relative flex-1 min-h-0 bg-black">
        <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
        {state !== "on" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            {state === "error" ? (
              <>
                <p className="text-red-400 text-sm font-semibold">Hindi ma-access ang camera</p>
                <p className="text-white/50 text-xs">{err}. Kailangan ng HTTPS + camera permission. Pwede pa ring mag-type / hardware scanner.</p>
                <button onClick={start} className="mt-1 h-11 px-5 rounded-xl bg-white/10 text-white text-sm font-bold">Try Again</button>
              </>
            ) : (
              <button onClick={start} disabled={state === "starting"}
                className="h-14 px-8 rounded-2xl bg-blue-600 text-white text-base font-extrabold flex items-center gap-2 disabled:opacity-60">
                <Camera className="w-5 h-5" /> {state === "starting" ? "Starting…" : "START CAMERA"}
              </button>
            )}
          </div>
        )}
      </div>
      <p className="text-center text-white/40 text-xs py-3 shrink-0">Itutok lang sa waybill barcode — awtomatikong mag-be-beep at magbabawas sa inventory.</p>
    </div>
  )
}
