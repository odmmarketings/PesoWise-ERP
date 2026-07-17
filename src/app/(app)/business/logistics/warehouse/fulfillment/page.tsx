"use client"
import { useState, useMemo, useEffect } from "react"
import * as XLSX from "xlsx-js-style"
import {
  PackageCheck, RefreshCw, Search, X, Check, ChevronDown, ChevronLeft, ChevronRight,
  FileSpreadsheet, Wrench, User, Settings, Flag, Truck, ScanLine, Copy, Download, CheckCircle2, XCircle,
} from "lucide-react"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import { useActivePages } from "@/lib/pages-store"
import { useUnitCodes } from "@/lib/unit-codes-store"
import { useProductItems } from "@/lib/product-items-store"
import { currentUserName } from "@/lib/current-user"
import { MEMBERS } from "@/lib/finance-settings-store"
import { fetchFulfillmentMeta, upsertFulfillmentMeta, cacheFulfillmentMeta } from "@/lib/fulfillment-meta-store"

// FULFILLMENT (LHIKE Warehouse manual) — warehouse-facing view of live Pancake orders:
// toggleable columns, per-column filters, Group (page), packer assignment (person icon),
// order info (search icon), Export, Update Tracking Details, Tools → Update Parcel Status /
// View COG Sold (order items × unit-code recipes × item COG).
// Orders come from the shared proxy (phase=rows, same shape as the Sales Tracker).
// Warehouse-only fields (packer/shift/packed date/RTS tracking/overrides) are LOCAL
// annotations (pesowise_fulfillment_meta) — Pancake has no packer concept.

const peso = (n: number) => "₱" + (isFinite(n) ? n : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const INP = "w-full h-8 rounded border border-slate-300 px-2 text-xs bg-white focus:outline-none focus:border-blue-400"

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
  let i = 0; await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) await fn(items[i++]) }))
}

// ── Warehouse annotations, keyed by Pancake order id — shared via Supabase
// `fulfillment_meta` (see fulfillment-meta-store); localStorage = read cache ──
const META_KEY = "pesowise_fulfillment_meta"
type FfMeta = { packer?: string; shift?: string; packed_date?: string; rts_tracking?: string; status_override?: string; tracking_override?: string; error_message?: string; work_status?: string; remarks?: string; last_edit_by?: string; last_edit_at?: string }
function loadMeta(): Record<string, FfMeta> {
  if (typeof window === "undefined") return {}
  try { return JSON.parse(localStorage.getItem(META_KEY) || "{}") } catch { return {} }
}

type FfRow = Record<string, any> & { id: string; page_name: string }

// Status badge colors — same palette as the Sales Tracker's ORDER_STATUS_BADGE.
const STATUS_BADGE: Record<string, string> = {
  "New": "bg-teal-50 text-teal-700",
  "Confirmed": "bg-blue-50 text-blue-700",
  "Restocking": "bg-amber-50 text-amber-700",
  "Prioritize Order": "bg-rose-50 text-rose-700",
  "Packaging": "bg-purple-50 text-purple-700",
  "Waiting for Pick Up": "bg-indigo-50 text-indigo-700",
  "Shipped": "bg-orange-50 text-orange-700",
  "Delivered": "bg-emerald-50 text-emerald-700",
  "Returning": "bg-amber-50 text-amber-700",
  "Returned": "bg-rose-50 text-rose-700",
  "Cancelled": "bg-red-50 text-red-700",
  "Deleted": "bg-slate-100 text-slate-500",
}

// ── Pancake ORDER STATUS (same list as the POS dropdown). status_name matchers verified
// against live data: 0|new, 1|submitted, 8|packing, 11|waitting, 2|shipped, 6|canceled,
// 3|delivered, 5|returned. Parcel Status column shows THESE labels (mapped from Pancake).
// `code` = Pancake status number (only where verified) — statuses WITH a code can be SET
// from Update Parcel Status; the rest are filter-only labels.
const ORDER_STATUSES: { l: string; match: string[]; code?: number }[] = [
  { l: "New", match: ["new"], code: 0 },
  // ⚠ Pancake's 11|"waitting" = waiting for GOODS = the POS UI's "Restocking" (user-confirmed:
  // sending status 11 showed "Restocking" in Pancake). Waiting for Pick Up is status 9.
  { l: "Restocking", match: ["waitting", "restock"], code: 11 },
  { l: "Prioritize Order", match: ["priorit"] },
  { l: "Confirmed", match: ["submitted", "confirm"], code: 1 },
  { l: "Packaging", match: ["packing", "packag"], code: 8 },
  { l: "Waiting for Pick Up", match: ["pending", "wait"], code: 9 },   // 9|"pending" (live-verified)
  { l: "Shipped", match: ["shipped"], code: 2 },
  { l: "Delivered", match: ["delivered"], code: 3 },
  { l: "Returning", match: ["returning"], code: 4 },
  { l: "Returned", match: ["returned"], code: 5 },
  { l: "Cancelled", match: ["cancel"], code: 6 },
  { l: "Deleted", match: ["delete", "remove"] },
]
const orderStatusLabel = (raw: string): string => {
  const s = String(raw || "").toLowerCase()
  if (!s) return ""
  for (const o of ORDER_STATUSES) if (o.match.some(m => s.includes(m))) return o.l
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}
// Couriers for "Send orders to courier" — partner ids from GET /shops/{id}/partners (SPX first).
const COURIERS = [
  { key: "SPX", label: "SPX Phi", partner_id: 125, badge: "bg-red-700" },
  { key: "JNT", label: "J&T Phi", partner_id: 10, badge: "bg-red-600" },
] as const
type CourierKey = typeof COURIERS[number]["key"]

// Column registry — key, chip label, how to read it, and which filter widget it gets.
type ColDef = { k: string; l: string; kind: "date" | "text" | "select" | "money"; get: (r: FfRow, m: FfMeta) => string | number }
const COLS: ColDef[] = [
  { k: "order_date", l: "Order Date", kind: "date", get: r => r.date_added || "" },
  { k: "page", l: "Page", kind: "text", get: r => r.page_name || "" },
  { k: "customer", l: "Customer Name", kind: "text", get: r => r.customer_name || "" },
  { k: "province", l: "Province", kind: "text", get: r => r.province || "" },
  { k: "city", l: "City", kind: "text", get: r => r.city || "" },
  { k: "brgy", l: "Brgy", kind: "text", get: r => r.barangay || "" },
  { k: "address", l: "Address", kind: "text", get: r => r.address || "" },
  { k: "contact", l: "Contact", kind: "text", get: r => r.contact_no || "" },
  { k: "order", l: "Order", kind: "text", get: r => r.order_item || "" },
  { k: "price", l: "Price", kind: "money", get: r => Number(r.final_price || 0) },
  { k: "mop", l: "MOP", kind: "text", get: r => r.mop || "" },
  { k: "tracking", l: "Tracking Number", kind: "text", get: (r, m) => m.tracking_override || r.tracking_no || "" },
  { k: "rts_tracking", l: "RTS Tracking Number", kind: "text", get: (_r, m) => m.rts_tracking || "" },
  { k: "courier", l: "Courier", kind: "select", get: r => r.courier || "" },
  { k: "packer", l: "Assigned Packer", kind: "text", get: (_r, m) => m.packer || "" },
  { k: "parcel_status", l: "Parcel Status", kind: "select", get: (r, m) => m.status_override || orderStatusLabel(r.order_status) || r.parcel_status || "" },
  { k: "encoded_date", l: "Encoded Date", kind: "date", get: r => r.encoded_date || "" },
  { k: "packed_date", l: "Packed Date", kind: "date", get: (_r, m) => m.packed_date || "" },
  { k: "shipped_out", l: "Shipped Out Date", kind: "date", get: r => r.shipped_out_date || "" },
  { k: "shift", l: "Shift", kind: "text", get: (_r, m) => m.shift || "" },
  { k: "date_added", l: "Date Added", kind: "date", get: r => r.date_added || "" },
  { k: "order_status", l: "Order Status", kind: "select", get: r => r.order_status || "" },
  { k: "error_message", l: "Error Message", kind: "text", get: (_r, m) => m.error_message || "" },
]
const DEFAULT_ON = ["order_date", "page", "customer", "courier", "packer", "parcel_status", "encoded_date"]

export default function FulfillmentPage() {
  const activePages = useActivePages()
  const unitStore = useUnitCodes()
  const products = useProductItems()
  const pagesWithCreds = useMemo(() => activePages.filter(p => p.api_key && (p.pancake_page_id || p.shop_id)), [activePages])

  const [rows, setRows] = useState<FfRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loadErr, setLoadErr] = useState("")
  const [meta, setMeta] = useState<Record<string, FfMeta>>({})
  useEffect(() => {
    setMeta(loadMeta())
    fetchFulfillmentMeta<FfMeta>().then(m => { if (m) setMeta(m) })
  }, [])
  const saveMeta = (next: Record<string, FfMeta>) => { setMeta(next); cacheFulfillmentMeta(next) }
  // Every local edit is stamped with the logged-in PesoWise user + time → View Order "Last Edit By".
  const stamp = (): FfMeta => {
    const d = new Date(), p = (n: number) => String(n).padStart(2, "0")
    return { last_edit_by: currentUserName() || "PesoWise user", last_edit_at: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` }
  }
  const patchMeta = (id: string, patch: FfMeta) => {
    const entry = { ...(meta[id] || {}), ...patch, ...stamp() }
    saveMeta({ ...meta, [id]: entry })
    upsertFulfillmentMeta({ [id]: entry })
  }

  const [visible, setVisible] = useState<Set<string>>(new Set(DEFAULT_ON))
  const [draft, setDraft] = useState<Record<string, { a: string; b: string }>>({})   // filter row inputs (a = value/from, b = to)
  const [applied, setApplied] = useState<Record<string, { a: string; b: string }>>({})
  const [group, setGroup] = useState("ALL")
  const [perPage, setPerPage] = useState(10)
  const [page, setPage] = useState(1)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState("")
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500) }

  const [toolsOpen, setToolsOpen] = useState(false)
  const [viewRow, setViewRow] = useState<FfRow | null>(null)
  const [assignRow, setAssignRow] = useState<FfRow | null>(null)
  const [statusOpen, setStatusOpen] = useState(false)
  const [cogOpen, setCogOpen] = useState(false)
  // Send orders to courier (Pancake-style): menu → settings modal → progress screen.
  const [sendMenuOpen, setSendMenuOpen] = useState(false)
  const [sendTo, setSendTo] = useState<CourierKey | null>(null)
  const [sendProg, setSendProg] = useState<{ total: number; done: number; running: boolean; results: { id: string; ok: boolean; msg: string }[] } | null>(null)

  // useActivePages() returns a FRESH array every render, so effects must key off VALUES,
  // not array identity — otherwise fetch → setState → render → "new" pages → fetch again (infinite loop).
  const pagesKey = pagesWithCreds.map(p => `${p.api_key}~${p.pancake_page_id || p.shop_id}~${p.name}`).join("|")
  // The Order Date column filter drives the FETCH window (presets fill + apply the from/to
  // inputs instantly; manual dates apply on Search). Blank = current month (PH).
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  const fetchWindow = (() => {
    const now = new Date()
    const monthStart = fmt(new Date(now.getFullYear(), now.getMonth(), 1))
    const today = fmt(now)
    const f = applied.order_date || { a: "", b: "" }
    if (!f.a && !f.b) return { from: monthStart, to: today }
    return { from: f.a || f.b, to: f.b || today }
  })()
  const rangeKey = `${fetchWindow.from}|${fetchWindow.to}`
  // Date-column picker apply — sets + applies agad (order_date also refetches via rangeKey).
  const applyDateCol = (k: string) => (a: string, b: string) => {
    setDraft(d => ({ ...d, [k]: { a, b } }))
    setApplied(ap => ({ ...ap, [k]: { a, b } }))
    setPage(1)
  }
  async function load(noCache = false) {
    if (pagesWithCreds.length === 0) { setRows([]); return }
    setLoading(true); setLoadErr("")
    const { from, to } = fetchWindow
    const out: FfRow[] = []
    const errs: string[] = []
    await mapLimit(pagesWithCreds, 3, async p => {
      try {
        const rs = await fetchPageRows(p.api_key, p.pancake_page_id || p.shop_id, from, to, noCache)
        for (const r of rs) out.push({ ...r, page_name: p.name })
      } catch (e: any) { errs.push(`${p.name}: ${e?.message || "failed"}`) }
    })
    out.sort((a, b) => String(b.date_added).localeCompare(String(a.date_added)))
    setRows(out); setLoading(false)
    if (errs.length) setLoadErr(errs.join(" · "))
  }
  useEffect(() => { load() }, [pagesKey, rangeKey])   // eslint-disable-line react-hooks/exhaustive-deps

  const metaOf = (r: FfRow) => meta[r.id] || {}
  const colBy = (k: string) => COLS.find(c => c.k === k)!
  const cellVal = (r: FfRow, k: string) => colBy(k).get(r, metaOf(r))

  // Distinct options for select-type filters, from the live data.
  // Parcel Status uses the fixed Pancake ORDER STATUS list; other selects use live values.
  const optsFor = (k: string) => k === "parcel_status"
    ? ORDER_STATUSES.map(o => o.l)
    : Array.from(new Set(rows.map(r => String(cellVal(r, k))).filter(Boolean))).sort()
  const pageNames = useMemo(() => Array.from(new Set(rows.map(r => r.page_name))).sort(), [rows])

  const filtered = useMemo(() => rows.filter(r => {
    if (group !== "ALL" && r.page_name !== group) return false
    for (const [k, f] of Object.entries(applied)) {
      if (!f.a && !f.b) continue
      const col = colBy(k)
      const v = String(col.get(r, metaOf(r)))
      if (col.kind === "date") {
        if (f.a && v < f.a) return false
        if (f.b && v > f.b) return false
      } else if (col.kind === "select") {
        if (f.a && f.a !== "All" && v !== f.a) return false
      } else if (f.a && !v.toLowerCase().includes(f.a.toLowerCase())) return false
    }
    return true
  }), [rows, group, applied, meta])   // eslint-disable-line react-hooks/exhaustive-deps

  const totalPrice = useMemo(() => filtered.reduce((s, r) => s + Number(r.final_price || 0), 0), [filtered])
  const pages = Math.max(1, Math.ceil(filtered.length / perPage))
  const pageSafe = Math.min(page, pages)
  const paginated = filtered.slice((pageSafe - 1) * perPage, pageSafe * perPage)
  const showFrom = filtered.length === 0 ? 0 : (pageSafe - 1) * perPage + 1
  const showTo = Math.min(pageSafe * perPage, filtered.length)
  const visCols = COLS.filter(c => visible.has(c.k))
  const selRows = filtered.filter(r => sel.has(r.id))

  const setF = (k: string, part: "a" | "b", v: string) => setDraft(d => ({ ...d, [k]: { a: part === "a" ? v : (d[k]?.a || ""), b: part === "b" ? v : (d[k]?.b || "") } }))
  const applyFilters = () => { setApplied(draft); setPage(1) }

  // ── COG per product name: unit code (recipe Σ qty×cog) or a direct product item ──
  const cogByName = useMemo(() => {
    const m = new Map<string, number>()
    const items = products.items.filter(i => !i.deleted)
    for (const i of items) if (!m.has(i.name.toLowerCase())) m.set(i.name.toLowerCase(), i.cog)
    for (const c of unitStore.codes) {
      if (!c.code) continue
      const cog = c.items.reduce((s, r) => {
        const it = items.find(i => i.name.toLowerCase() === r.name.toLowerCase())
        return s + (it ? it.cog * (r.qty || 1) : 0)
      }, 0)
      m.set(c.code.toLowerCase(), cog)
    }
    return m
  }, [unitStore.codes, products.items])

  // Parse "2x Lumyrax2, 1x Other" → [{qty, name}] (the waybill line items).
  const parseItems = (orderItem: string) => String(orderItem || "").split(",").map(s => s.trim()).filter(Boolean).map(seg => {
    const m = seg.match(/^(\d+)\s*x\s*(.+)$/i)
    return m ? { qty: Number(m[1]) || 1, name: m[2].trim() } : { qty: 1, name: seg }
  })

  // ── Unit-code recipes for the pick list: product name → component items to pull off the shelf ──
  const recipeByName = useMemo(() => {
    const items = products.items.filter(i => !i.deleted)
    const m = new Map<string, { sku: string; name: string; qty: number }[]>()
    // plain product items pick as themselves
    for (const i of items) if (!m.has(i.name.toLowerCase())) m.set(i.name.toLowerCase(), [{ sku: i.sku, name: i.name, qty: 1 }])
    // unit codes explode into their bundle recipe
    for (const c of unitStore.codes) {
      if (!c.code) continue
      m.set(c.code.toLowerCase(), c.items.map(r => {
        const it = items.find(i => i.name.toLowerCase() === r.name.toLowerCase())
        return { sku: it?.sku || "", name: r.name, qty: r.qty || 1 }
      }))
    }
    return m
  }, [unitStore.codes, products.items])

  // ── Export Pick List: checked rows if any, else ALL records currently shown. Unit codes are
  // exploded into component items (recipe) so the picker pulls actual shelf stock.
  function exportPickList() {
    const target = selRows.length ? selRows : filtered
    if (target.length === 0) { flash("⚠ No orders to export."); return }
    type Comp = { sku: string; name: string; qty: number; mapped: boolean }
    const explode = (r: FfRow): Comp[] => parseItems(r.order_item).flatMap((seg): Comp[] => {
      const comps = recipeByName.get(seg.name.toLowerCase())
      return comps
        ? comps.map(c => ({ sku: c.sku, name: c.name, qty: c.qty * seg.qty, mapped: true }))
        : [{ sku: "", name: seg.name, qty: seg.qty, mapped: false }]
    })
    // Section 1 — consolidated shelf-walk summary
    const agg = new Map<string, Comp>()
    for (const r of target) for (const c of explode(r)) {
      const k = `${c.sku}|${c.name.toLowerCase()}`
      const prev = agg.get(k)
      if (prev) prev.qty += c.qty; else agg.set(k, { ...c })
    }
    const summary = Array.from(agg.values()).sort((a, b) => a.name.localeCompare(b.name))
    const now = new Date(), pd = (n: number) => String(n).padStart(2, "0")
    const stampStr = `${now.getFullYear()}-${pd(now.getMonth() + 1)}-${pd(now.getDate())} ${pd(now.getHours())}:${pd(now.getMinutes())}`
    const aoa: any[][] = [
      ["PICK LIST — FULFILLMENT"],
      [`Generated: ${stampStr}`, "", `Prepared by: ${currentUserName() || "—"}`, "", `Orders: ${target.length}`, selRows.length ? "Scope: Selected orders" : "Scope: All records shown"],
      [],
      ["PICK SUMMARY (consolidated — what to pull from the shelves)"],
      ["NO.", "ITEM CODE", "ITEM NAME", "TOTAL QTY", "PICKED ✓"],
      ...summary.map((c, i) => [i + 1, c.sku || (c.mapped ? "" : "⚠ no matching unit code / item"), c.name, c.qty, ""]),
      [],
      ["ORDER BREAKDOWN (per parcel — for packing & checking)"],
      ["NO.", "ORDER DATE", "CUSTOMER", "PAGE", "ORDER", "ITEMS TO PICK", "COURIER", "TRACKING NO.", "PACKED ✓"],
      ...target.map((r, i) => [
        i + 1, r.date_added || "", r.customer_name || "", r.page_name || "", r.order_item || "",
        explode(r).map(c => `${c.qty} × ${c.name}${c.sku ? ` (${c.sku})` : ""}`).join(" | "),
        r.courier || "", metaOf(r).tracking_override || r.tracking_no || "", "",
      ]),
      [],
      ["Picked By: ____________________", "", "Checked By: ____________________", "", "Date: ____________"],
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const teal = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "14B8A6" } } }
    const bold = { font: { bold: true } }
    const sumHdr = 4, ordHdr = 7 + summary.length
    for (const rIdx of [sumHdr, ordHdr]) for (let c = 0; c < 9; c++) { const cell = ws[XLSX.utils.encode_cell({ r: rIdx, c })]; if (cell) cell.s = teal }
    if (ws.A1) ws.A1.s = { font: { bold: true, sz: 16 } }
    for (const rIdx of [3, 6 + summary.length]) { const cell = ws[XLSX.utils.encode_cell({ r: rIdx, c: 0 })]; if (cell) cell.s = bold }
    ws["!cols"] = [{ wch: 6 }, { wch: 18 }, { wch: 32 }, { wch: 12 }, { wch: 30 }, { wch: 46 }, { wch: 16 }, { wch: 20 }, { wch: 10 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Pick List")
    XLSX.writeFile(wb, `PickList_${now.getFullYear()}-${pd(now.getMonth() + 1)}-${pd(now.getDate())}_${pd(now.getHours())}${pd(now.getMinutes())}.xlsx`)
    flash(`Pick list exported — ${target.length} order${target.length === 1 ? "" : "s"}, ${summary.length} item${summary.length === 1 ? "" : "s"} to pick.`)
  }

  // ── Send orders to courier: pushes each checked order to the partner on Pancake, one by one,
  // so the progress bar fills per order (Pancake-style). Results feed the Success/Error screen.
  async function runSendToCourier(courierKey: CourierKey, opts: { is_free_shipping?: boolean; is_dropoff?: boolean; note?: string }) {
    const courier = COURIERS.find(c => c.key === courierKey)!
    const target = selRows
    setSendProg({ total: target.length, done: 0, running: true, results: [] })
    const results: { id: string; ok: boolean; msg: string }[] = []
    for (let i = 0; i < target.length; i++) {
      const r = target[i]
      const pg = pagesWithCreds.find(p => p.name === r.page_name)
      try {
        if (!pg) throw new Error("No Pancake credentials for this page")
        const j = await fetch("/api/pancake/orders/send-courier", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: pg.api_key, shop_id: pg.pancake_page_id || pg.shop_id, order_id: r.id, partner_id: courier.partner_id, options: opts }),
        }).then(rr => rr.json())
        if (!j.success) throw new Error(j.error || "Failed")
        results.push({ id: r.id, ok: true, msg: "Success" })
      } catch (e: any) { results.push({ id: r.id, ok: false, msg: e?.message || "Failed" }) }
      setSendProg({ total: target.length, done: i + 1, running: i + 1 < target.length, results: [...results] })
    }
  }

  // Tools → Update Parcel Status: real status change on Pancake for every checked order.
  async function runUpdateStatus(label: string, code: number) {
    const target = selRows
    let ok = 0
    const errs: string[] = []
    for (const r of target) {
      const pg = pagesWithCreds.find(p => p.name === r.page_name)
      try {
        if (!pg) throw new Error("No Pancake credentials for this page")
        const j = await fetch("/api/pancake/orders/update-status", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: pg.api_key, shop_id: pg.pancake_page_id || pg.shop_id, order_id: r.id, status: code }),
        }).then(rr => rr.json())
        if (!j.success) throw new Error(j.error || "Failed")
        ok++
      } catch (e: any) { errs.push(`${r.id}: ${e?.message || "failed"}`) }
    }
    if (errs.length) flash(`⚠ Status update — ${ok} ok, ${errs.length} failed: ${errs[0]}`)
    else flash(`${ok} order${ok === 1 ? "" : "s"} set to "${label}" on Pancake POS.`)
    setSel(new Set())
    await load(true)
  }

  const Btn = ({ children, className = "", ...p }: any) => <button {...p} className={`h-10 px-4 rounded-lg text-sm font-semibold flex items-center gap-1.5 ${className}`}>{children}</button>

  const toastEl = toast ? (
    <div className="fixed top-4 right-4 z-[80] bg-emerald-600 text-white text-sm rounded-xl px-5 py-3 shadow-lg flex items-center gap-2">
      <Check className="w-4 h-4" /> <div><p className="font-semibold">Success</p><p className="text-emerald-100">{toast}</p></div>
    </div>
  ) : null

  // 🔍 opens the LHIKE-style full View Order screen (live Pancake data + local warehouse fields).
  if (viewRow) return (
    <>
      {toastEl}
      <ViewOrderScreen row={viewRow} meta={metaOf(viewRow)}
        onBack={() => setViewRow(null)}
        onStatus={s => { patchMeta(viewRow.id, { work_status: s }); flash(`Marked as ${s}.`) }}
        onSave={p => { patchMeta(viewRow.id, p); flash("Tracking details updated.") }} />
    </>
  )

  return (
    <div className="space-y-4 relative">
      {toastEl}

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        {/* Header row — title + action buttons (LHIKE order) */}
        <div className="flex items-center justify-between flex-wrap gap-2 pb-4 border-b border-slate-100">
          <h1 className="flex items-center gap-2 text-xl font-extrabold text-blue-600 tracking-wide"><PackageCheck className="w-6 h-6" /> FULFILLMENT</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => load(true)} title="Refresh from Pancake"
              className="h-10 w-10 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 flex items-center justify-center shrink-0">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <Btn onClick={exportPickList} className="bg-teal-500 hover:bg-teal-600 text-white" title={selRows.length ? `Pick list for the ${selRows.length} checked order(s)` : "Pick list for ALL records shown"}>
              <FileSpreadsheet className="w-4 h-4" /> Export Pick List{selRows.length ? ` (${selRows.length})` : ""}
            </Btn>
            {/* Send orders to courier — Pancake-style: pick the courier, tune settings, Update */}
            <div className="relative">
              <Btn onClick={() => { if (selRows.length === 0) { flash("⚠ Select orders first (checkboxes)."); return } setSendMenuOpen(o => !o) }} className="bg-slate-900 hover:bg-slate-800 text-white" title="Send orders to courier">
                <Truck className="w-4 h-4" /> Send orders to courier{selRows.length ? ` (${selRows.length})` : ""} <ChevronDown className="w-4 h-4" />
              </Btn>
              {sendMenuOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setSendMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-30 w-44 bg-white border border-slate-200 rounded-lg shadow-xl py-1">
                    {COURIERS.map(c => (
                      <button key={c.key} onClick={() => { setSendMenuOpen(false); setSendTo(c.key) }}
                        className="w-full flex items-center gap-2 text-left px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50">
                        To <span className={`${c.badge} text-white text-[11px] font-bold px-2 py-0.5 rounded`}>{c.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="relative">
              <Btn onClick={() => setToolsOpen(o => !o)} className="bg-red-600 hover:bg-red-700 text-white"><Wrench className="w-4 h-4" /> Tools <ChevronDown className="w-4 h-4" /></Btn>
              {toolsOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setToolsOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-30 w-56 bg-white border border-slate-200 rounded-lg shadow-xl py-1">
                    <button onClick={() => { setToolsOpen(false); if (selRows.length === 0) { flash("⚠ Select orders first (checkboxes)."); return } setStatusOpen(true) }} className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Update Parcel Status</button>
                    <button onClick={() => { setToolsOpen(false); setCogOpen(true) }} className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">View COG Sold</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Toggle columns */}
        <div className="pt-4">
          <p className="text-sm text-slate-700 mb-2"><strong>Toggle column:</strong> <span className="text-slate-400 italic text-xs">Click to hide or show column</span></p>
          <div className="flex flex-wrap gap-1.5">
            {COLS.map(c => (
              <button key={c.k} onClick={() => setVisible(v => { const n = new Set(v); n.has(c.k) ? n.delete(c.k) : n.add(c.k); return n })}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium border ${visible.has(c.k) ? "bg-teal-500 border-teal-500 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
                {c.l}
              </button>
            ))}
          </div>
        </div>

        {/* records selector + Group */}
        <div className="flex items-center justify-between flex-wrap gap-2 mt-4">
          <label className="flex items-center gap-2 text-sm text-slate-500">
            <select className="h-9 rounded-lg border border-slate-300 px-2 text-sm bg-white" value={perPage} onChange={e => { setPerPage(parseInt(e.target.value)); setPage(1) }}>
              {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select> records
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Group
            <select className="h-9 rounded-lg border border-slate-300 px-2 text-sm bg-white min-w-[140px]" value={group} onChange={e => { setGroup(e.target.value); setPage(1) }}>
              <option value="ALL">ALL</option>
              {pageNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>

        {loadErr && <p className="text-xs text-rose-500 mt-2">⚠ {loadErr}</p>}
        {pagesWithCreds.length === 0 && <p className="text-sm text-slate-400 mt-3">No connected Pancake pages — add API keys in Pages &amp; Store first.</p>}

        {/* Table — header (titles + filter row) sticks on vertical scroll; checkbox + No stick on horizontal */}
        <div className="overflow-auto scrollbar-dark mt-3 max-h-[68vh]">
          <table className="w-full text-sm border border-slate-200">
            <thead className="sticky top-0 z-40">
              <tr className="bg-slate-50 border-b border-slate-200 text-left">
                <th className="px-2 py-2.5 sticky left-0 z-30 bg-slate-50 w-[36px] min-w-[36px] max-w-[36px] border-r border-slate-200"><input type="checkbox" checked={paginated.length > 0 && paginated.every(r => sel.has(r.id))} onChange={e => setSel(e.target.checked ? new Set([...sel, ...paginated.map(r => r.id)]) : new Set([...sel].filter(id => !paginated.some(r => r.id === id))))} className="accent-blue-600" /></th>
                <th className="px-3 py-2.5 sticky left-[36px] z-30 bg-slate-50 w-[48px] min-w-[48px] max-w-[48px] text-xs font-bold text-slate-600 border-r border-slate-200">No</th>
                {visCols.map(c => <th key={c.k} className="px-3 py-2.5 text-xs font-bold text-slate-600 whitespace-nowrap border-r border-slate-200 bg-slate-50">{c.l}</th>)}
                <th className="px-3 py-2.5 text-xs font-bold text-slate-600 bg-slate-50">Actions</th>
              </tr>
              {/* Filter row */}
              <tr className="border-b border-slate-200 bg-white">
                <th className="px-2 py-2 sticky left-0 z-30 bg-white w-[36px] min-w-[36px] max-w-[36px] border-r border-slate-100" />
                <th className="px-2 py-2 sticky left-[36px] z-30 bg-white w-[48px] min-w-[48px] max-w-[48px] border-r border-slate-100" />
                {visCols.map(c => (
                  <th key={c.k} className="px-2 py-2 border-r border-slate-100 min-w-[130px] bg-white">
                    {c.kind === "date" ? (
                      <DateRangePicker a={applied[c.k]?.a || ""} b={applied[c.k]?.b || ""} onApply={applyDateCol(c.k)} placeholder={c.k === "order_date" ? "This month" : "All"} />
                    ) : c.kind === "select" ? (
                      <select className={INP} value={draft[c.k]?.a || "All"} onChange={e => setF(c.k, "a", e.target.value)}>
                        <option>All</option>
                        {optsFor(c.k).map(o => <option key={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input className={INP} value={draft[c.k]?.a || ""} onChange={e => setF(c.k, "a", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} />
                    )}
                  </th>
                ))}
                <th className="px-2 py-2 bg-white"><button onClick={applyFilters} className="h-9 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white"><Search className="w-4 h-4" /></button></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={visCols.length + 3} className="py-14 text-center text-slate-400 text-sm"><RefreshCw className="w-5 h-5 animate-spin inline mr-2" /> Loading orders…</td></tr>
              ) : paginated.length === 0 ? (
                <tr><td colSpan={visCols.length + 3} className="py-12 text-center text-slate-400 text-sm">No orders match.</td></tr>
              ) : paginated.map((r, i) => {
                const rowBg = sel.has(r.id) ? "bg-blue-50" : i % 2 === 0 ? "bg-white" : "bg-slate-50"
                return (
                <tr key={r.id} className={`border-b border-slate-100 ${rowBg} hover:bg-blue-50/40`}>
                  <td className={`px-2 py-2.5 sticky left-0 z-10 ${rowBg} w-[36px] min-w-[36px] max-w-[36px] border-r border-slate-100`}><input type="checkbox" checked={sel.has(r.id)} onChange={() => setSel(s => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n })} className="accent-blue-600" /></td>
                  <td className={`px-3 py-2.5 sticky left-[36px] z-10 ${rowBg} w-[48px] min-w-[48px] max-w-[48px] text-slate-400 border-r border-slate-100`}>{showFrom + i}</td>
                  {visCols.map(c => {
                    const v = cellVal(r, c.k)
                    return (
                      <td key={c.k} className={`px-3 py-2.5 border-r border-slate-100 whitespace-nowrap max-w-[220px] truncate ${c.kind === "money" ? "tabular-nums text-right" : ""} text-slate-700`} title={String(v)}>
                        {c.k === "parcel_status" || c.k === "order_status"
                          ? (v ? <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${STATUS_BADGE[String(v)] || "bg-slate-100 text-slate-600"}`}>{v}</span> : "")
                          : c.kind === "money" ? peso(Number(v)) : (v || "")}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setViewRow(r)} className="w-8 h-8 rounded border border-slate-300 flex items-center justify-center text-slate-500 hover:text-blue-600 hover:border-blue-400" title="View order info"><Search className="w-4 h-4" /></button>
                      <button onClick={() => setAssignRow(r)} className="w-8 h-8 rounded border border-slate-300 flex items-center justify-center text-slate-500 hover:text-emerald-600 hover:border-emerald-400" title="Assign packer"><User className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>

        {/* Footer — entries, pagination, total price */}
        <div className="flex items-center justify-between flex-wrap gap-2 mt-3 text-sm text-slate-600">
          <span>Showing {showFrom} to {showTo} of {filtered.length} entries</span>
          <div className="flex items-center gap-1">
            <button disabled={pageSafe <= 1} onClick={() => setPage(p => p - 1)} className="w-8 h-8 rounded border border-slate-300 flex items-center justify-center disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
            {Array.from({ length: Math.min(pages, 7) }, (_, x) => x + Math.max(1, Math.min(pageSafe - 3, pages - 6))).map(n => (
              <button key={n} onClick={() => setPage(n)} className={`w-8 h-8 rounded border text-sm ${n === pageSafe ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300 hover:bg-slate-50"}`}>{n}</button>
            ))}
            <button disabled={pageSafe >= pages} onClick={() => setPage(p => p + 1)} className="w-8 h-8 rounded border border-slate-300 flex items-center justify-center disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
        <p className="mt-2 text-sm"><strong className="text-slate-800">Total Price</strong> : {totalPrice.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</p>
      </div>

      {/* ── Assign packer ── */}
      {assignRow && (
        <AssignModal row={assignRow} meta={metaOf(assignRow)} onClose={() => setAssignRow(null)}
          onSave={m => { patchMeta(assignRow.id, m); setAssignRow(null); flash("Packer assignment saved.") }} />
      )}

      {/* ── Send orders to courier: Pancake-style settings modal → animated progress screen ── */}
      {sendTo && !sendProg && (
        <SendCourierModal courier={COURIERS.find(c => c.key === sendTo)!} rows={selRows}
          onCancel={() => setSendTo(null)} onUpdate={opts => runSendToCourier(sendTo, opts)} />
      )}
      {sendProg && sendTo && (
        <SendProgressModal courier={COURIERS.find(c => c.key === sendTo)!} prog={sendProg}
          onBack={() => { setSendProg(null); setSendTo(null); setSel(new Set()); load(true) }} />
      )}

      {/* ── Tools → Update Parcel Status (selected rows) ── */}
      {statusOpen && (
        <StatusModal rows={selRows} onClose={() => setStatusOpen(false)}
          onSave={(label, code) => { setStatusOpen(false); runUpdateStatus(label, code) }} />
      )}

      {/* ── Tools → View COG Sold ── */}
      {cogOpen && <CogSoldModal rows={rows} cogByName={cogByName} parseItems={parseItems} onClose={() => setCogOpen(false)} />}
    </div>
  )
}

// LHIKE-style Assigned Packer modal: "Assigned To" = a searchable dropdown of ERP accounts
// (Finance Settings MEMBERS + the logged-in user, until the full Users module exists).
function AssignModal({ row, meta, onClose, onSave }: { row: FfRow; meta: FfMeta; onClose: () => void; onSave: (m: FfMeta) => void }) {
  const [packer, setPacker] = useState(meta.packer || "")
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const me = currentUserName()
  const accounts = useMemo(() => Array.from(new Set([...(me ? [me] : []), ...MEMBERS])).sort(), [me])
  const filteredAccts = accounts.filter(a => a.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-5 overflow-visible" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-200">
          <h2 className="text-lg font-bold text-slate-900">Assigned Packer</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-slate-400 mb-3 truncate">{row.customer_name} · {row.order_item}</p>
        <div className="grid grid-cols-[110px_1fr] items-center gap-3">
          <span className="text-sm text-slate-600 text-right">Assigned To:</span>
          <div className="relative">
            <button type="button" onClick={() => { setOpen(o => !o); setQ("") }}
              className="w-full h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-left flex items-center justify-between hover:border-slate-400">
              <span className={packer ? "text-slate-800" : "text-slate-400"}>{packer || "--"}</span>
              <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open && (
              <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-xl p-2">
                <input autoFocus value={q} onChange={e => setQ(e.target.value)}
                  className="w-full h-9 rounded border border-blue-400 px-2 text-sm mb-1 focus:outline-none" />
                <div className="max-h-44 overflow-auto scrollbar-dark">
                  {packer && <button type="button" className="w-full text-left px-3 py-2 text-sm text-slate-500 hover:bg-slate-100" onMouseDown={() => { setPacker(""); setOpen(false) }}>-- (unassign)</button>}
                  {filteredAccts.map(a => (
                    <button key={a} type="button" onMouseDown={() => { setPacker(a); setOpen(false) }}
                      className={`w-full text-left px-3 py-2 text-sm ${a === packer ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-blue-50"}`}>{a}</button>
                  ))}
                  {filteredAccts.length === 0 && <div className="px-3 py-2 text-sm text-slate-400">No match</div>}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50">Cancel</button>
          <button onClick={() => onSave({ packer })} className="px-5 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700">Save</button>
        </div>
      </div>
    </div>
  )
}

// ── "Send orders to courier" settings modal — Pancake POS replica. Left: the selected
// orders (searchable, status badges). Right: courier-specific Settings. Only the flags the
// public API is known to accept are transmitted (shop-pays / drop-off / note); the rest are
// shown Pancake-style and applied on Pancake's side defaults.
function SendCourierModal({ courier, rows, onCancel, onUpdate }: {
  courier: typeof COURIERS[number]; rows: FfRow[]; onCancel: () => void
  onUpdate: (opts: { is_free_shipping?: boolean; is_dropoff?: boolean; note?: string }) => void
}) {
  const [q, setQ] = useState("")
  // SPX settings
  const [shopPays, setShopPays] = useState(true)
  const [postOffice, setPostOffice] = useState(false)
  const [pickupShift, setPickupShift] = useState("08:00-12:00")
  const [voucher, setVoucher] = useState("")
  const [itemType, setItemType] = useState("Fragile")
  const [dims, setDims] = useState(["0", "0", "0"])
  const [printNote, setPrintNote] = useState("")
  // J&T settings
  const [dropOff, setDropOff] = useState(false)
  const [partial, setPartial] = useState(false)
  const [priceDecl, setPriceDecl] = useState(true)
  const [payMethod, setPayMethod] = useState("Sender will pay at the end of the month")
  const [maxWeight, setMaxWeight] = useState("0")
  const [extraNote, setExtraNote] = useState("")
  const [pickStart, setPickStart] = useState("")
  const [pickEnd, setPickEnd] = useState("")
  const [addrOpts, setAddrOpts] = useState(false)

  const isSPX = courier.key === "SPX"
  const shown = rows.filter(r => !q || String(r.id).includes(q) || String(r.customer_name || "").toLowerCase().includes(q.toLowerCase()))
  const tomorrow = (() => { const d = new Date(Date.now() + 86400000); return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}` })()
  const badgeFor = (r: FfRow) => {
    const l = orderStatusLabel(r.order_status)
    const cls = l === "Packaging" ? "bg-purple-600" : l === "Waiting for Pick Up" ? "bg-amber-500" : l === "Confirmed" ? "bg-blue-500" : "bg-slate-400"
    return <span className={`${cls} text-white text-[10px] font-semibold px-2 py-0.5 rounded`}>{l || "—"}</span>
  }
  const CB = ({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) => (
    <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="accent-blue-600 w-4 h-4" /> {label}
    </label>
  )
  const SEL = "w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white focus:outline-none"
  const LBL = "text-sm text-slate-500 mb-1.5"

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <div className="flex items-center gap-2 text-sm text-slate-700">To <span className={`${courier.badge} text-white text-[11px] font-bold px-2 py-0.5 rounded`}>{courier.label}</span></div>
          <button onClick={onCancel} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 flex min-h-0">
          {/* Left — selected orders */}
          <div className="w-[330px] shrink-0 border-r border-slate-200 flex flex-col">
            <div className="p-3 space-y-2">
              <div className="relative">
                <input className="w-full h-10 rounded-lg border border-slate-300 pl-3 pr-9 text-sm focus:outline-none focus:border-blue-400" placeholder="Find order - Enter" value={q} onChange={e => setQ(e.target.value)} />
                <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              </div>
              <p className="flex items-center gap-1.5 text-[11px] text-slate-400 italic"><ScanLine className="w-3.5 h-3.5" /> Scan Barcode (order form, bill of lading) to add orders</p>
              <p className="text-sm font-semibold text-slate-800">{rows.length} selected</p>
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5">
              {shown.map(r => (
                <div key={r.id} className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2">
                  <ScanLine className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span className="text-[13px] font-semibold text-slate-800 truncate">{r.id}</span>
                  <span className="text-[11px] text-slate-400 whitespace-nowrap">{r.date_added}</span>
                  <span className="ml-auto shrink-0">{badgeFor(r)}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Right — Settings */}
          <div className="flex-1 overflow-y-auto p-5">
            <h3 className="font-bold text-slate-900 mb-4 pb-3 border-b border-slate-100">Settings</h3>
            <p className="text-sm text-slate-500 mb-2">Options</p>
            <div className="space-y-2 mb-5">
              {isSPX ? (
                <>
                  <CB checked={shopPays} onChange={setShopPays} label="Shop pays shipping fees to SPX Express" />
                  <CB checked={postOffice} onChange={setPostOffice} label="Delivery at the post office" />
                </>
              ) : (
                <>
                  <CB checked={dropOff} onChange={setDropOff} label="Drop off at the post office" />
                  <CB checked={partial} onChange={setPartial} label="Partial delivery" />
                  <CB checked={priceDecl} onChange={setPriceDecl} label="Price declaration service" />
                </>
              )}
            </div>
            <hr className="border-slate-100 mb-5" />
            {isSPX ? (
              <>
                <div className="grid grid-cols-2 gap-4 mb-5">
                  <div><p className={LBL}>Pick-up shift</p>
                    <select className={SEL} value={pickupShift} onChange={e => setPickupShift(e.target.value)}>
                      {["08:00-12:00", "12:00-16:00", "16:00-20:00"].map(s => <option key={s} value={s}>{tomorrow} / {s}</option>)}
                    </select></div>
                  <div><p className={LBL}>Voucher</p><input className={SEL} value={voucher} onChange={e => setVoucher(e.target.value)} /></div>
                </div>
                <div className="mb-5"><p className={LBL}>Parcel Item Type</p>
                  <select className={`${SEL} max-w-[300px]`} value={itemType} onChange={e => setItemType(e.target.value)}>
                    {["Fragile", "Normal", "Electronics", "Liquid", "Food"].map(t => <option key={t}>{t}</option>)}
                  </select></div>
                <div className="grid grid-cols-2 gap-4 mb-5">
                  <div><p className={LBL}>Package dimensions</p>
                    <div className="flex items-center gap-1.5">
                      {dims.map((d, i) => (
                        <span key={i} className="flex items-center gap-1.5">
                          <input className="w-16 h-10 rounded-lg border border-slate-300 px-2 text-sm text-right" value={d} onChange={e => setDims(ds => ds.map((x, xi) => xi === i ? e.target.value.replace(/[^\d.]/g, "") : x))} />
                          {i < 2 && <span className="text-slate-400">x</span>}
                        </span>
                      ))}
                      <span className="text-sm text-slate-500 ml-1">(cm)</span>
                    </div></div>
                  <div><p className={LBL}>Printing note</p><textarea className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm min-h-[70px] focus:outline-none" placeholder="Printing note" value={printNote} onChange={e => setPrintNote(e.target.value)} /></div>
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4 mb-5">
                  <div><p className={LBL}>Payment methods</p>
                    <select className={SEL} value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                      {["Sender will pay at the end of the month", "Sender pays on pickup", "Receiver pays (COD)"].map(m => <option key={m}>{m}</option>)}
                    </select></div>
                  <div><p className={LBL}>Maximum order weight</p><input className={`${SEL} text-right`} value={maxWeight} onChange={e => setMaxWeight(e.target.value.replace(/[^\d.]/g, ""))} /></div>
                </div>
                <div className="grid grid-cols-2 gap-4 mb-5">
                  <div><p className={LBL}>Extra note</p><input className={SEL} placeholder="Enter note" value={extraNote} onChange={e => setExtraNote(e.target.value)} /></div>
                  <div><p className={LBL}>Pick up time</p>
                    <div className="flex items-center gap-1.5">
                      <input type="date" className={`${SEL} px-2`} value={pickStart} onChange={e => setPickStart(e.target.value)} />
                      <span className="text-slate-400">→</span>
                      <input type="date" className={`${SEL} px-2`} value={pickEnd} onChange={e => setPickEnd(e.target.value)} />
                    </div></div>
                </div>
              </>
            )}
            <hr className="border-slate-100 mb-4" />
            <label className="flex items-center gap-2.5 mb-4 cursor-pointer">
              <button type="button" onClick={() => setAddrOpts(o => !o)} className={`relative w-9 h-5 rounded-full transition-colors ${addrOpts ? "bg-blue-600" : "bg-slate-300"}`}>
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${addrOpts ? "left-[18px]" : "left-0.5"}`} />
              </button>
              <span className="text-sm text-slate-700">Address options</span>
            </label>
            <button type="button" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"><Settings className="w-4 h-4" /> Add action</button>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-200">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50">Cancel</button>
          <button onClick={() => onUpdate(isSPX
            ? { is_free_shipping: shopPays, is_dropoff: postOffice, note: printNote.trim() || undefined }
            : { is_dropoff: dropOff, note: extraNote.trim() || undefined })}
            className="px-6 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700">Update</button>
        </div>
      </div>
    </div>
  )
}

// ── Progress screen — Pancake replica: animated green bar per order, Success/Failed cards,
// Export orders error + Copy success order ID, All/Success/Error tabs, per-order result lines.
function SendProgressModal({ courier, prog, onBack }: {
  courier: typeof COURIERS[number]
  prog: { total: number; done: number; running: boolean; results: { id: string; ok: boolean; msg: string }[] }
  onBack: () => void
}) {
  const [tab, setTab] = useState<"all" | "ok" | "err">("all")
  const okList = prog.results.filter(r => r.ok)
  const errList = prog.results.filter(r => !r.ok)
  const pctDone = prog.total ? Math.round((prog.done / prog.total) * 100) : 0
  const list = tab === "ok" ? okList : tab === "err" ? errList : prog.results
  const copyOk = () => { try { navigator.clipboard.writeText(okList.map(r => r.id).join("\n")); } catch {} }
  const exportErr = () => {
    const aoa = [["ORDER ID", "ERROR"], ...errList.map(r => [r.id, r.msg])]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws["!cols"] = [{ wch: 22 }, { wch: 60 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Errors")
    XLSX.writeFile(wb, `SendCourier_Errors_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <div className="flex items-center gap-2 text-sm text-slate-700">To <span className={`${courier.badge} text-white text-[11px] font-bold px-2 py-0.5 rounded`}>{courier.label}</span></div>
          <button onClick={onBack} disabled={prog.running} className="p-1 rounded hover:bg-slate-100 disabled:opacity-40"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="font-bold text-slate-900">Total data {prog.total}</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 rounded-full bg-slate-200 overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-[width] duration-500 ease-out" style={{ width: `${pctDone}%` }} />
            </div>
            {pctDone >= 100
              ? <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
              : <span className="text-xs font-semibold text-slate-500 shrink-0 w-9 text-right">{pctDone}%</span>}
          </div>
          <p className="text-xs text-slate-400">Information about the update process will be displayed below</p>
          <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
            <span className="flex items-center gap-2 text-sm text-slate-700"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Success</span>
            <span className="font-semibold text-slate-800">{okList.length}</span>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
            <span className="flex items-center gap-2 text-sm text-slate-700"><XCircle className="w-4 h-4 text-red-500" /> Failed</span>
            <span className="font-semibold text-slate-800">{errList.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportErr} disabled={errList.length === 0} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"><Download className="w-3.5 h-3.5" /> Export orders error</button>
            <button onClick={copyOk} disabled={okList.length === 0} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"><Copy className="w-3.5 h-3.5" /> Copy success order ID</button>
          </div>
          <div className="flex items-center gap-4 border-b border-slate-200 text-sm">
            {([["all", `All`], ["ok", `Success`], ["err", `Error`]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={`pb-2 -mb-px flex items-center gap-1.5 ${tab === k ? "border-b-2 border-blue-600 text-blue-600 font-semibold" : "text-slate-500"}`}>
                {l} <span className="text-[11px] bg-slate-100 rounded-full px-1.5">{k === "all" ? prog.results.length : k === "ok" ? okList.length : errList.length}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-3 min-h-[120px]">
          {list.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">{prog.running ? "Sending…" : "No entries."}</p>
          ) : list.map(r => (
            <p key={r.id} className={`text-sm py-0.5 ${r.ok ? "text-emerald-600" : "text-red-600"}`}># {r.id} : {r.ok ? "Success" : r.msg}</p>
          ))}
        </div>
        <div className="px-5 py-4 border-t border-slate-200">
          <button onClick={onBack} disabled={prog.running} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50 disabled:opacity-40">Back</button>
        </div>
      </div>
    </div>
  )
}

// Update Parcel Status — REAL Pancake update (PUT status, live-verified pattern). Options are
// the Pancake statuses with verified status numbers; badge preview matches the table colors.
function StatusModal({ rows, onClose, onSave }: { rows: FfRow[]; onClose: () => void; onSave: (label: string, code: number) => void }) {
  const [label, setLabel] = useState("")
  const opts = ORDER_STATUSES.filter(s => s.code != null)
  const picked = opts.find(o => o.l === label)
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-slate-900 mb-1">Update Parcel Status</h2>
        <p className="text-xs text-slate-400 mb-4">{rows.length} selected order{rows.length === 1 ? "" : "s"} — the status is updated on <strong>Pancake POS</strong> itself (same as a quick update there).</p>
        <select className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white" value={label} onChange={e => setLabel(e.target.value)}>
          <option value="">Select status…</option>
          {opts.map(s => <option key={s.l}>{s.l}</option>)}
        </select>
        {picked && <p className="mt-3 text-sm text-slate-500">Set to: <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[picked.l] || "bg-slate-100 text-slate-600"}`}>{picked.l}</span></p>}
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50">Cancel</button>
          <button disabled={!picked} onClick={() => picked && onSave(picked.l, picked.code!)} className="px-5 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-40">Submit</button>
        </div>
      </div>
    </div>
  )
}

// COG Sold — order items × unit-code recipes × Product Items COG, filterable like the manual
// (Order date, Order/product, Delivery status). Products without a known COG show "—".
function CogSoldModal({ rows, cogByName, parseItems, onClose }: {
  rows: FfRow[]; cogByName: Map<string, number>
  parseItems: (s: string) => { qty: number; name: string }[]
  onClose: () => void
}) {
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [product, setProduct] = useState("All")
  const [status, setStatus] = useState("All")

  const lines = useMemo(() => {
    const out: { date: string; customer: string; product: string; qty: number; cogEach: number | null; total: number | null; status: string }[] = []
    for (const r of rows) {
      const date = String(r.date_added || "")
      if (from && date < from) continue
      if (to && date > to) continue
      const st = String(r.parcel_status || "")
      if (status !== "All" && st !== status) continue
      for (const it of parseItems(r.order_item)) {
        if (product !== "All" && it.name !== product) continue
        const cog = cogByName.get(it.name.toLowerCase())
        out.push({ date, customer: r.customer_name || "", product: it.name, qty: it.qty, cogEach: cog ?? null, total: cog != null ? cog * it.qty : null, status: st })
      }
    }
    return out
  }, [rows, from, to, product, status, cogByName, parseItems])

  const productOpts = useMemo(() => Array.from(new Set(rows.flatMap(r => parseItems(r.order_item).map(i => i.name)))).sort(), [rows, parseItems])
  const statusOpts = useMemo(() => Array.from(new Set(rows.map(r => String(r.parcel_status || "")).filter(Boolean))).sort(), [rows])
  const totalQty = lines.reduce((s, l) => s + l.qty, 0)
  const totalCog = lines.reduce((s, l) => s + (l.total || 0), 0)
  const F = "h-9 rounded-lg border border-slate-300 px-2 text-sm bg-white"

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-lg font-bold text-slate-900">COG Sold</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-3 flex flex-wrap items-end gap-3 border-b border-slate-100">
          <div><p className="text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">Order date from</p><input type="date" className={F} value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div><p className="text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">To</p><input type="date" className={F} value={to} onChange={e => setTo(e.target.value)} /></div>
          <div><p className="text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">Product</p>
            <select className={`${F} max-w-[220px]`} value={product} onChange={e => setProduct(e.target.value)}><option>All</option>{productOpts.map(p => <option key={p}>{p}</option>)}</select></div>
          <div><p className="text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">Delivery status</p>
            <select className={F} value={status} onChange={e => setStatus(e.target.value)}><option>All</option>{statusOpts.map(s => <option key={s}>{s}</option>)}</select></div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {lines.length === 0 ? (
            <p className="py-12 text-center text-slate-400 text-sm">No matching order items.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                <tr className="text-left text-xs text-slate-500">
                  {["Order Date", "Customer", "Product", "Qty", "COG Each", "COG Total", "Delivery Status"].map(h => <th key={h} className="px-4 py-2.5 font-semibold whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className={`border-b border-slate-100 ${i % 2 ? "bg-slate-50" : ""}`}>
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{l.date}</td>
                    <td className="px-4 py-2.5 max-w-[160px] truncate text-slate-700">{l.customer}</td>
                    <td className="px-4 py-2.5 max-w-[220px] truncate text-slate-800 font-medium">{l.product}</td>
                    <td className="px-4 py-2.5 tabular-nums">{l.qty}</td>
                    <td className="px-4 py-2.5 tabular-nums">{l.cogEach != null ? peso(l.cogEach) : <span className="text-slate-300" title="No matching unit code / product item">—</span>}</td>
                    <td className="px-4 py-2.5 tabular-nums font-semibold">{l.total != null ? peso(l.total) : <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{l.status || "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0">
                <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold text-slate-800">
                  <td className="px-4 py-2.5" colSpan={3}>TOTAL · {lines.length} line{lines.length === 1 ? "" : "s"}</td>
                  <td className="px-4 py-2.5 tabular-nums">{totalQty}</td>
                  <td className="px-4 py-2.5" />
                  <td className="px-4 py-2.5 tabular-nums">{peso(totalCog)}</td>
                  <td className="px-4 py-2.5" />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
        <p className="px-5 py-3 text-[11px] text-slate-400 border-t border-slate-100">COG per product = its unit-code recipe (Σ item COG × qty) from Logistics → Inventory; "—" = the product has no matching unit code or product item yet.</p>
      </div>
    </div>
  )
}

// ── VIEW ORDER (LHIKE) — full-page order view: live Pancake fields + HISTORY sidebar.
// Owned / In progress / Done = warehouse work status (local). Tracking No. + Remarks are
// editable and saved locally via "Update Tracking Details" (Pancake data itself is untouched).
const WORK_STATUSES = ["Owned", "In progress", "Done"]
function ViewOrderRow({ l, children, req = false }: { l: string; children: any; req?: boolean }) {
  return (
    <div className="grid grid-cols-[150px_1fr] items-start gap-3">
      <span className="text-sm text-slate-600 text-right pt-2.5">{l} {req && <span className="text-red-500">*</span>}</span>
      {children}
    </div>
  )
}
function ViewOrderScreen({ row, meta, onBack, onStatus, onSave }: {
  row: FfRow; meta: FfMeta; onBack: () => void
  onStatus: (s: string) => void; onSave: (patch: FfMeta) => void
}) {
  const [tracking, setTracking] = useState(meta.tracking_override || row.tracking_no || "")
  const [rts, setRts] = useState(meta.rts_tracking || "")
  const [remarks, setRemarks] = useState(meta.remarks ?? (row.remarks || ""))
  const RO = "w-full min-h-[42px] rounded-lg border border-slate-200 bg-slate-100 px-3 py-2.5 text-sm text-slate-700"
  const ED = "w-full h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:outline-none focus:border-blue-400"
  const F = ViewOrderRow   // module-level (inline definition remounts inputs per keystroke = focus loss)
  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start">
      {/* Main card */}
      <div className="flex-1 w-full bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-center justify-between flex-wrap gap-2 pb-4 mb-5 border-b border-slate-100">
          <h1 className="flex items-center gap-2 text-xl font-extrabold text-blue-600 tracking-wide"><Settings className="w-6 h-6" /> VIEW ORDER</h1>
          <div className="flex items-center gap-2">
            {WORK_STATUSES.map(s => (
              <button key={s} onClick={() => onStatus(s)}
                className={`h-10 px-4 rounded-lg border text-sm font-semibold ${meta.work_status === s ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}>{s}</button>
            ))}
          </div>
        </div>

        <div className="space-y-4 max-w-3xl">
          <F l="Order Date" req><div className={`${RO} max-w-[240px]`}>{row.date_added || "—"}</div></F>
          <F l="User" req><div className={RO}>{row.csr_name || "—"}</div></F>
          <F l="Customer Fullname" req><div className={RO}>{row.customer_name || "—"}</div></F>
          <F l="Address"><div className={RO}>{row.address || "—"}</div></F>
          <F l="Province" req><div className={RO}>{row.province || "—"}</div></F>
          <F l="City" req><div className={RO}>{row.city || "—"}</div></F>
          <F l="Brgy" req><div className={RO}>{row.barangay || "—"}</div></F>
          <F l="Contact No." req><div className={RO}>{row.contact_no || "—"}</div></F>
          <F l="Order" req>
            <div className="flex items-start gap-3">
              <div className="w-24 shrink-0"><p className="text-[10px] text-slate-400 mb-0.5 text-center">Qty</p><div className={`${RO} text-center`}>{row.quantity ?? "—"}</div></div>
              <div className="flex-1"><p className="text-[10px] text-slate-400 mb-0.5">Item</p><div className={RO}>{row.order_item || "—"}</div></div>
            </div>
          </F>
          <F l="Parcel Qty" req><div className={`${RO} max-w-[240px]`}>{row.parcel_qty ?? "—"}</div></F>
          <F l="Price" req><div className={`${RO} max-w-[240px]`}>{peso(Number(row.final_price || 0))}</div></F>
          <F l="Page" req><div className={RO}>{row.page_name || "—"}</div></F>
          <F l="Remarks"><textarea className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm min-h-[90px] focus:outline-none focus:border-blue-400" value={remarks} onChange={e => setRemarks(e.target.value)} /></F>
          <F l="Tracking No."><input className={ED} value={tracking} onChange={e => setTracking(e.target.value)} /></F>
          <F l="RTS Tracking No."><input className={ED} value={rts} onChange={e => setRts(e.target.value)} /></F>
          <F l="Shipping Fee"><div className={`${RO} max-w-[240px]`}>{Number(row.shipping_fee) > 0 ? peso(Number(row.shipping_fee)) : ""}</div></F>
          <F l="Courier"><div className={RO}>{row.courier || "—"}</div></F>
        </div>

        <div className="flex items-center gap-2 mt-6 pt-5 border-t border-slate-100">
          <button onClick={() => onSave({ tracking_override: tracking.trim(), rts_tracking: rts.trim(), remarks })}
            className="h-11 px-5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold flex items-center gap-2"><Truck className="w-4 h-4" /> Update Tracking Details</button>
          <button onClick={onBack} className="h-11 px-5 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50">Return to List</button>
        </div>
      </div>

      {/* HISTORY sidebar */}
      <div className="w-full lg:w-80 shrink-0 bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="flex items-center gap-2 text-lg font-extrabold text-blue-600 tracking-wide mb-3"><Flag className="w-5 h-5" /> HISTORY</h2>
        <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 text-sm">
          <div className="px-4 py-2.5 bg-slate-50 font-bold text-slate-800">Created By</div>
          <div className="px-4 py-2.5 text-slate-700">{row.csr_name || "—"}</div>
          <div className="px-4 py-2.5 bg-slate-50 font-bold text-slate-800">Created Date</div>
          <div className="px-4 py-2.5 text-slate-700">{row.inserted_time || row.date_added || "—"}</div>
          <div className="px-4 py-2.5 bg-slate-50 font-bold text-slate-800">Last Edit By</div>
          <div className="px-4 py-2.5 text-slate-700">{meta.last_edit_by || row.last_editor_name || "—"}{meta.last_edit_by && <span className="block text-[10px] text-slate-400">via PesoWise</span>}</div>
          <div className="px-4 py-2.5 bg-slate-50 font-bold text-slate-800">Last Edit Date</div>
          <div className="px-4 py-2.5 text-slate-700">{meta.last_edit_at || row.last_edit_time || "—"}</div>
          <div className="px-4 py-2.5 bg-slate-50 font-bold text-slate-800">ENCODED</div>
          <div className="px-4 py-2.5 text-slate-700">{row.csr_name || "—"}<br /><span className="italic text-slate-500 text-xs">{row.inserted_time || "—"}</span></div>
          {meta.work_status && (<>
            <div className="px-4 py-2.5 bg-slate-50 font-bold text-slate-800">WAREHOUSE STATUS</div>
            <div className="px-4 py-2.5 text-slate-700">{meta.work_status}{meta.packer ? <><br /><span className="italic text-slate-500 text-xs">Packer: {meta.packer}{meta.shift ? ` · ${meta.shift}` : ""}</span></> : null}</div>
          </>)}
        </div>
      </div>
    </div>
  )
}
