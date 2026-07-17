"use client"
import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import * as XLSX from "xlsx-js-style"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatCurrency } from "@/lib/utils"
import { Plus, RefreshCw, FileText, ChevronDown, X, Check, Search, Download, ScanLine, Upload, Trash2, User, FileSpreadsheet, Truck, Edit, ChevronLeft, ShoppingCart } from "lucide-react"
import { useActivePages } from "@/lib/pages-store"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import { useUnitCodes } from "@/lib/unit-codes-store"
import { useProductItems, itemRemaining } from "@/lib/product-items-store"
import { fetchJntFees, upsertJntFees, fetchOrderBaselines, upsertOrderBaselines } from "@/lib/sales-shared-store"

const PARCEL_STATUSES = ["New","Encoded","Packed","Parcel for Fulfillment","Pending Printed Waybill","Shipped Out","In-Transit","On-Delivery","Out of Delivery Zone","Delivering","Delivered","For Return","Returning","Returned","Remitted","Closed","Cancelled by Customer","Cancelled by Warehouse","Owned","Problematic/Damage","No-Record"]
const MOPS = ["COD", "Gcash", "Bank Transfer", "Credit Card", "Maya"]
// Province / City / Barangay are loaded LIVE from Pancake's /geo endpoints (see /api/pancake/geo)
// as dependent dropdowns, so the selected location carries Pancake's own province_id/district_id/
// commune_id needed for a successful, properly geo-coded order.

interface Order {
  id: string
  order_date: string
  csr_name: string
  csr_id?: string
  verifier_name: string
  upsell_by: string
  retention_by: string
  customer_name: string
  address: string
  province: string
  city: string
  barangay: string
  zip_code: string
  contact_no: string
  order_item: string
  quantity: number
  parcel_qty: number
  price_initial: number
  price_upsell: number
  final_price: number
  shipping_fee: number
  page_name: string
  platform: string
  tracking_no: string
  courier: string
  parcel_status: string
  encoded_date: string
  parcel_update: string
  mop: string
  reserve_date: string
  order_status: string
  shipped_out_date: string
  shift: string
  date_added: string
  remarks: string
}


// All columns definition
const ALL_COLUMNS = [
  "order_date","csr_name","verifier_name","upsell_by","retention_by",
  "customer_name","address","province","city","barangay","zip_code","contact_no",
  "order_item","quantity","parcel_qty","price_initial","price_upsell","final_price","shipping_fee",
  "page_name","platform","tracking_no","courier",
  "parcel_status","encoded_date","parcel_update","mop","reserve_date","order_status","shipped_out_date",
  "shift","date_added"
]

const COLUMN_LABELS: Record<string, string> = {
  order_date: "Order Date", csr_name: "CSR", verifier_name: "Verifier", upsell_by: "Upsell By",
  retention_by: "Retention By", customer_name: "Customer Name", address: "Address",
  province: "Province", city: "City", barangay: "Brgy", zip_code: "Zip Code",
  contact_no: "Contact", order_item: "Order", quantity: "Total Qty", parcel_qty: "Parcel Qty",
  price_initial: "Price (Initial)", price_upsell: "Price (Upsell)", final_price: "Price (Final)",
  shipping_fee: "Shipping Fee", page_name: "Page", platform: "Platform",
  tracking_no: "Tracking No.", courier: "Courier", parcel_status: "Parcel Status",
  encoded_date: "Encoded Date", parcel_update: "Parcel Update", mop: "MoP",
  reserve_date: "Reserve Date", order_status: "Order Status", shipped_out_date: "Shipped Out",
  shift: "Shift", date_added: "Date Added",
}

// Short hover tooltips shown on specific column headers
const COLUMN_TOOLTIPS: Record<string, string> = {
  parcel_update: "Shows the latest date/time when the courier or parcel status was updated.",
  parcel_status: "Shows the current shipping/courier status of the parcel, such as Shipped Out, In Transit, On Delivery, Delivered, or Returned.",
  reserve_date: "Shows the date when the order was marked or encoded as reserved, not the shipping date.",
}

// Default hidden columns — toggle to show
const DEFAULT_HIDDEN = ["verifier_name","upsell_by","retention_by","province","city","barangay","zip_code","parcel_update","reserve_date","price_initial","price_upsell","parcel_qty","shift","date_added"]

// Per-column in-table filter config: which columns use a date-range picker vs a dropdown
// (everything else is a free-text "contains" search).
const COL_DATE_RANGE = new Set(["order_date","encoded_date","shipped_out_date","reserve_date","parcel_update","date_added"])
const COL_DROPDOWN = new Set(["page_name","platform","courier","mop","parcel_status","order_status","shift"])

// Canonical Pancake POS order statuses (fixed dropdown list).
const ORDER_STATUS_OPTIONS = ["New", "Restocking", "Prioritize Order", "Confirmed", "Packaging", "Waiting for Pick Up", "Shipped", "Cancelled", "Deleted"]
// Pancake `status_name` (lowercase) → canonical label above.
const ORDER_STATUS_ALIAS: Record<string, string> = {
  "new": "New", "restocking": "Restocking", "purchased": "Prioritize Order", "prioritize order": "Prioritize Order",
  "confirmed": "Confirmed", "submitted": "Confirmed",
  "packaging": "Packaging", "packing": "Packaging",
  "waiting for pick up": "Waiting for Pick Up", "waiting for pickup": "Waiting for Pick Up",
  "shipped": "Shipped", "canceled": "Cancelled", "cancelled": "Cancelled",
  "deleted recently": "Deleted", "deleted": "Deleted",
}
function normalizeOrderStatus(raw: string): string {
  const s = String(raw || "").trim()
  if (!s) return ""
  return ORDER_STATUS_ALIAS[s.toLowerCase()] || s.replace(/\b\w/g, c => c.toUpperCase())  // Title Case fallback
}
// Clean badge classes (soft bg + colored text) per order status — table view only. Mirrors
// Pancake's color cues; intentionally NOT a full-cell box and NOT applied to the dropdown.
const ORDER_STATUS_BADGE: Record<string, string> = {
  "New": "bg-teal-50 text-teal-700",
  "Confirmed": "bg-blue-50 text-blue-700",
  "Restocking": "bg-amber-50 text-amber-700",
  "Prioritize Order": "bg-rose-50 text-rose-700",
  "Packaging": "bg-purple-50 text-purple-700",
  "Waiting for Pick Up": "bg-indigo-50 text-indigo-700",
  "Shipped": "bg-orange-50 text-orange-700",
  "Cancelled": "bg-red-50 text-red-700",
  "Deleted": "bg-slate-100 text-slate-500",
}

// Export filtered data as CSV (opens in Excel)
function exportToExcel(data: Order[], visibleCols: string[]) {
  const headers = ["No.", ...visibleCols.map(c => COLUMN_LABELS[c] || c)]
  const rows = data.map((o, i) => [
    i + 1,
    ...visibleCols.map(c => {
      const v = (o as any)[c]
      return v === null || v === undefined || v === "" ? "" : v
    })
  ])

  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n")

  const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `sales-tracker-${new Date().toISOString().split("T")[0]}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// Fields not yet wired to Pancake POS — shown as a placeholder until mapped.
const DEFERRED = "Not Yet Mapped"

// Shared maps (Supabase-backed, localStorage-cached — see sales-shared-store):
// per-order pre-upsell total snapshots (Pancake has no "previous amount" field, so we
// capture it ourselves to compute Price (Upsell) = current total − pre-upsell total)
// and the J&T shipping fees imported from Excel ({ [trackingNo]: shippingFee }).

// Fetch mapped order rows for one page from the shared Pancake proxy route (phase=rows).
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

// Run async work with a concurrency cap to avoid bursting Pancake's rate limit.
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++])
  })
  await Promise.all(workers)
}

// Reusable 2-second-delay hover tooltip (fade-in). Portaled to <body> with fixed positioning so
// sticky/overflow containers don't clip it; clamped to the viewport. Returns props for the trigger
// element + the tooltip node to render inside it.
function useHoverTip(tip?: string) {
  const ref = useRef<any>(null)
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [rendered, setRendered] = useState(false)
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  const onMouseEnter = () => {
    if (!tip) return
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    enterTimer.current = setTimeout(() => {
      const r = ref.current?.getBoundingClientRect()
      if (r) {
        const tipW = 256, margin = 8, half = tipW / 2
        const left = Math.max(half + margin, Math.min(r.left + r.width / 2, window.innerWidth - half - margin))
        setPos({ left, top: r.bottom + 6 })
      }
      setRendered(true)
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
    }, 2000)
  }
  const onMouseLeave = () => {
    if (enterTimer.current) clearTimeout(enterTimer.current)
    setVisible(false)
    leaveTimer.current = setTimeout(() => setRendered(false), 200)
  }
  useEffect(() => () => {
    if (enterTimer.current) clearTimeout(enterTimer.current)
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
  }, [])

  const tooltip = rendered && pos && tip && typeof document !== "undefined"
    ? createPortal(
        <div style={{ position: "fixed", left: pos.left, top: pos.top, transform: "translateX(-50%)" }}
          className={`z-[60] w-64 pointer-events-none transition-opacity duration-200 ease-out ${visible ? "opacity-100" : "opacity-0"}`}>
          <div className="bg-slate-900 text-white rounded-lg shadow-xl px-3 py-2 text-left normal-case">
            <p className="text-[11px] font-normal leading-snug">{tip}</p>
          </div>
        </div>,
        document.body)
    : null

  return { ref, onMouseEnter, onMouseLeave, tooltip }
}

// Toggle-column chip with the 2s hover tooltip
function ToggleChip({ label, hidden, tip, onToggle }: { label: string; hidden: boolean; tip?: string; onToggle: () => void }) {
  const { ref, onMouseEnter, onMouseLeave, tooltip } = useHoverTip(tip)
  return (
    <button ref={ref} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onClick={onToggle}
      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${hidden ? "bg-slate-100 text-slate-400 border-slate-200" : "bg-slate-900 text-white border-slate-900"}`}>
      {label}{tooltip}
    </button>
  )
}

// Shared label-left / input-right row used in the Add Order form
function FormRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-2.5 border-b border-slate-100 last:border-0">
      <label className="w-44 flex-shrink-0 text-sm text-slate-600 pt-2.5 leading-tight">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className="flex-1 max-w-xl">{children}</div>
    </div>
  )
}

const SEL = "w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white focus:outline-none focus:border-blue-400"

// One option in a Pancake geo dropdown (province / district=City / commune=Barangay).
type GeoItem = { id: string; name: string; postcode: string }

// A selectable product line returned by /api/pancake/products (one entry per sellable variation).
type ProductOption = {
  product_id: string
  variation_id: string
  display_id: string
  name: string
  price: number
  image: string
}

// Searchable product combobox — type to filter the Pancake catalog, click to select.
function ProductPicker({ products, loading, error, value, onSelect, disabled }: {
  products: ProductOption[]
  loading: boolean
  error: string
  value: ProductOption | null
  onSelect: (p: ProductOption | null) => void
  disabled: boolean
}) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? products.filter(p => p.name.toLowerCase().includes(q) || p.display_id.toLowerCase().includes(q)) : products
    return list.slice(0, 50)  // cap the rendered list for performance
  }, [products, query])

  const placeholder = disabled ? "Select a Page first" : loading ? "Loading products…" : "Search product name…"

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          className={`${SEL} pl-9`}
          disabled={disabled || loading}
          placeholder={placeholder}
          value={open ? query : (value?.name || "")}
          onFocus={() => { if (!disabled && !loading) { setOpen(true); setQuery("") } }}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
        />
        {value && !open && (
          <button type="button" onClick={() => onSelect(null)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {open && !disabled && !loading && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-20 max-h-64 overflow-auto">
            {error ? (
              <p className="px-3 py-3 text-sm text-red-600">{error}</p>
            ) : matches.length === 0 ? (
              <p className="px-3 py-3 text-sm text-slate-400">{products.length === 0 ? "No products found for this Page." : "No match."}</p>
            ) : matches.map(p => (
              <button key={p.variation_id} type="button"
                onClick={() => { onSelect(p); setOpen(false); setQuery("") }}
                className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 border-b border-slate-50 last:border-0">
                <span className="text-slate-700 truncate">{p.name}</span>
                <span className="text-slate-500 font-medium whitespace-nowrap">{p.price ? formatCurrency(p.price) : ""}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function AddOrderScreen({ onBack, onCreated, knownCsrs }: {
  onBack: () => void
  onCreated: (info: { count: number; page: string }) => void
  knownCsrs: string[]
}) {
  const activePages = useActivePages()
  // Only Pages with valid Pancake creds can load products / create orders.
  const connectedPages = useMemo(
    () => activePages.filter(p => p.api_key && (p.pancake_page_id || p.shop_id)),
    [activePages])

  const now = new Date()
  const [form, setForm] = useState<Partial<Order>>({
    order_date: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")} ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}`,
    quantity: 1, parcel_qty: 1, mop: "COD",
  })
  const [pageId, setPageId] = useState("")           // selected Page (PageStore.id)
  const [product, setProduct] = useState<ProductOption | null>(null)
  const [products, setProducts] = useState<ProductOption[]>([])
  const [productsLoading, setProductsLoading] = useState(false)
  const [productsError, setProductsError] = useState("")

  // Cascading Pancake location selection (province → district=City → commune=Barangay). We track
  // the selected ID for each level + the loaded option lists; children reset when a parent changes,
  // so an invalid combination can never be submitted.
  const [provinces, setProvinces] = useState<GeoItem[]>([])
  const [districts, setDistricts] = useState<GeoItem[]>([])
  const [communes, setCommunes] = useState<GeoItem[]>([])
  const [provinceId, setProvinceId] = useState("")
  const [districtId, setDistrictId] = useState("")
  const [communeId, setCommuneId] = useState("")
  const [geoLoading, setGeoLoading] = useState({ p: false, d: false, c: false })
  const [geoError, setGeoError] = useState("")

  const [validated, setValidated] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [customerRequest, setCustomerRequest] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState("")

  const selectedPage = connectedPages.find(p => p.id === pageId)

  // Load products whenever the selected Page changes (products only exist per connected Page/Store).
  useEffect(() => {
    setProduct(null); setProducts([]); setProductsError("")
    if (!selectedPage) return
    const shopId = selectedPage.pancake_page_id || selectedPage.shop_id
    let cancelled = false
    setProductsLoading(true)
    fetch(`/api/pancake/products?api_key=${encodeURIComponent(selectedPage.api_key)}&page_id=${encodeURIComponent(shopId)}`, { cache: "no-store" })
      .then(r => r.json())
      .then(json => {
        if (cancelled) return
        if (json.success) setProducts(Array.isArray(json.products) ? json.products : [])
        else setProductsError(json.error || "Failed to load products.")
      })
      .catch(() => { if (!cancelled) setProductsError("Failed to load products. Check your connection.") })
      .finally(() => { if (!cancelled) setProductsLoading(false) })
    return () => { cancelled = true }
  }, [pageId])  // eslint-disable-line react-hooks/exhaustive-deps

  // Load Philippine provinces when a Page is selected (needs the page's api_key). Reset the whole
  // address chain on page change.
  useEffect(() => {
    setProvinces([]); setDistricts([]); setCommunes([])
    setProvinceId(""); setDistrictId(""); setCommuneId(""); setGeoError("")
    if (!selectedPage) return
    let cancelled = false
    setGeoLoading(g => ({ ...g, p: true }))
    fetch(`/api/pancake/geo?type=provinces&api_key=${encodeURIComponent(selectedPage.api_key)}`, { cache: "no-store" })
      .then(r => r.json())
      .then(json => { if (cancelled) return; if (json.success) setProvinces(json.items || []); else setGeoError(json.error || "Could not load provinces.") })
      .catch(() => { if (!cancelled) setGeoError("Could not load locations. Check your connection.") })
      .finally(() => { if (!cancelled) setGeoLoading(g => ({ ...g, p: false })) })
    return () => { cancelled = true }
  }, [pageId])  // eslint-disable-line react-hooks/exhaustive-deps

  // Load districts (Cities/Municipalities) for the chosen province; reset City + Barangay.
  useEffect(() => {
    setDistricts([]); setCommunes([]); setDistrictId(""); setCommuneId("")
    if (!selectedPage || !provinceId) return
    let cancelled = false
    setGeoLoading(g => ({ ...g, d: true }))
    fetch(`/api/pancake/geo?type=districts&api_key=${encodeURIComponent(selectedPage.api_key)}&province_id=${encodeURIComponent(provinceId)}`, { cache: "no-store" })
      .then(r => r.json())
      .then(json => { if (cancelled) return; if (json.success) setDistricts(json.items || []); else setGeoError(json.error || "Could not load cities.") })
      .catch(() => { if (!cancelled) setGeoError("Could not load cities. Check your connection.") })
      .finally(() => { if (!cancelled) setGeoLoading(g => ({ ...g, d: false })) })
    return () => { cancelled = true }
  }, [provinceId])  // eslint-disable-line react-hooks/exhaustive-deps

  // Load communes (Barangays) for the chosen city; reset Barangay.
  useEffect(() => {
    setCommunes([]); setCommuneId("")
    if (!selectedPage || !provinceId || !districtId) return
    let cancelled = false
    setGeoLoading(g => ({ ...g, c: true }))
    fetch(`/api/pancake/geo?type=communes&api_key=${encodeURIComponent(selectedPage.api_key)}&province_id=${encodeURIComponent(provinceId)}&district_id=${encodeURIComponent(districtId)}`, { cache: "no-store" })
      .then(r => r.json())
      .then(json => { if (cancelled) return; if (json.success) setCommunes(json.items || []); else setGeoError(json.error || "Could not load barangays.") })
      .catch(() => { if (!cancelled) setGeoError("Could not load barangays. Check your connection.") })
      .finally(() => { if (!cancelled) setGeoLoading(g => ({ ...g, c: false })) })
    return () => { cancelled = true }
  }, [districtId])  // eslint-disable-line react-hooks/exhaustive-deps

  const provinceName = provinces.find(p => p.id === provinceId)?.name || ""
  const cityName = districts.find(d => d.id === districtId)?.name || ""
  const barangayName = communes.find(c => c.id === communeId)?.name || ""

  function pickProvince(id: string) { setProvinceId(id); setValidated(false); setSubmitError("") }
  function pickCity(id: string) { setDistrictId(id); setValidated(false); setSubmitError("") }
  function pickBarangay(id: string) {
    setCommuneId(id); setValidated(false); setSubmitError("")
    const c = communes.find(x => x.id === id)
    if (c?.postcode) setForm(f => ({ ...f, zip_code: c.postcode }))  // auto-fill Zip from the barangay
  }

  function set(key: string, value: any) { setForm(f => ({ ...f, [key]: value })); setValidated(false); setSubmitError("") }

  // Required-field validation. Address fields (Province/City/Barangay) are required; Zip is optional.
  function validate(): string[] {
    const missing: string[] = []
    if (!form.customer_name?.toString().trim()) missing.push("Customer Full Name")
    if (!form.address?.toString().trim()) missing.push("Address")
    if (!provinceId) missing.push("Province")
    if (!districtId) missing.push("City / Municipality")
    if (!communeId) missing.push("Barangay")
    if (!form.contact_no?.toString().trim()) missing.push("Contact Number")
    if (!(Number(form.quantity) > 0)) missing.push("Order Quantity")
    if (!(Number(form.parcel_qty) > 0)) missing.push("Parcel Quantity")
    if (!form.mop?.toString().trim()) missing.push("Mode of Payment")
    if (!pageId) missing.push("Page")
    if (!product) missing.push("Item / Product")
    return missing
  }

  function handleValidate() {
    const missing = validate()
    setErrors(missing)
    setValidated(missing.length === 0)
  }

  async function handleSubmit() {
    const missing = validate()
    if (missing.length > 0 || !selectedPage || !product) { setErrors(missing); setValidated(false); return }
    setSubmitting(true); setSubmitError("")
    const shopId = selectedPage.pancake_page_id || selectedPage.shop_id
    const noteParts = [
      form.csr_name ? `Encoder: ${form.csr_name}` : "",
      customerRequest ? "Customer Request" : "",
      form.remarks?.toString().trim() || "",
    ].filter(Boolean)
    try {
      const res = await fetch(`/api/pancake/orders/create?api_key=${encodeURIComponent(selectedPage.api_key)}&page_id=${encodeURIComponent(shopId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: form.customer_name,
          contact_no: form.contact_no,
          address: form.address,
          province: provinceName,
          city: cityName,
          barangay: barangayName,
          province_id: provinceId,
          district_id: districtId,
          commune_id: communeId,
          zip_code: form.zip_code,
          mop: form.mop,
          parcel_qty: Number(form.parcel_qty),
          note: noteParts.join(" | "),
          items: [{
            variation_id: product.variation_id,
            product_id: product.product_id,
            quantity: Number(form.quantity),
            price: product.price,
            name: product.name,
          }],
        }),
      })
      const json = await res.json()
      if (json.success) {
        onCreated({ count: 1, page: selectedPage.name })
      } else {
        setSubmitError(json.error || "Order Not Created — Pancake POS rejected the request.")
      }
    } catch {
      setSubmitError("Order Not Created — network error reaching Pancake POS.")
    } finally {
      setSubmitting(false)
    }
  }

  const estTotal = product ? product.price * (Number(form.quantity) || 0) : 0

  return (
    <div className="w-full space-y-4 relative">
      {submitting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/60">
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
            <p className="text-sm text-slate-500 font-medium">Creating order in Pancake POS…</p>
          </div>
        </div>
      )}

      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
        <ChevronLeft className="w-4 h-4" /> Back to Sales Tracker
      </button>
      <h1 className="page-title">Add New Order</h1>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {errors.length > 0 && (
          <div className="mx-6 mt-5 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
            <p className="font-medium mb-1">Please fix the following required fields:</p>
            <ul className="list-disc pl-4 space-y-0.5">{errors.map(e => <li key={e}>{e}</li>)}</ul>
          </div>
        )}
        {validated && errors.length === 0 && !submitError && (
          <div className="mx-6 mt-5 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 flex items-center gap-2">
            <Check className="w-4 h-4 flex-shrink-0" /> Validation successful — all required fields are valid. You can now Submit to create this order in Pancake POS.
          </div>
        )}
        {submitError && (
          <div className="mx-6 mt-5 p-3 bg-red-50 border border-red-300 rounded-lg text-sm text-red-700 flex items-start gap-2">
            <X className="w-4 h-4 flex-shrink-0 mt-0.5" /> <span><strong>Order failed.</strong> {submitError}</span>
          </div>
        )}

        <div className="px-6 pt-4 pb-2">
          <FormRow label="Order Date" required>
            <Input value={form.order_date || ""} readOnly className="bg-slate-50 text-slate-500 cursor-default" />
          </FormRow>

          <FormRow label="Page" required>
            <select className={SEL} value={pageId} onChange={e => { setPageId(e.target.value); setValidated(false); setSubmitError("") }}>
              <option value="">-- SELECT PAGE --</option>
              {connectedPages.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {connectedPages.length === 0 && (
              <p className="text-xs text-amber-600 mt-1.5">No connected Page with Pancake API access. Add credentials in Pages &amp; Store first.</p>
            )}
          </FormRow>

          <FormRow label="User">
            <div>
              <input list="csr-datalist" className={SEL} placeholder="Type CSR / encoder name (optional)"
                value={form.csr_name || ""} onChange={e => set("csr_name", e.target.value)} />
              <datalist id="csr-datalist">
                {knownCsrs.map(n => <option key={n} value={n} />)}
              </datalist>
            </div>
          </FormRow>

          <FormRow label="Customer Fullname" required>
            <Input value={form.customer_name || ""} onChange={e => set("customer_name", e.target.value)} />
          </FormRow>

          <FormRow label="Address" required>
            <Input value={form.address || ""} placeholder="House/Unit No., Street, Subdivision"
              onChange={e => set("address", e.target.value)} />
          </FormRow>

          <FormRow label="Province" required>
            <select className={SEL} value={provinceId} disabled={!pageId || geoLoading.p}
              onChange={e => pickProvince(e.target.value)}>
              <option value="">{!pageId ? "Select a Page first" : geoLoading.p ? "Loading provinces…" : "-- SELECT PROVINCE --"}</option>
              {provinces.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {geoError && <p className="text-xs text-red-600 mt-1.5">{geoError}</p>}
          </FormRow>

          <FormRow label="City / Municipality" required>
            <select className={SEL} value={districtId} disabled={!provinceId || geoLoading.d}
              onChange={e => pickCity(e.target.value)}>
              <option value="">{!provinceId ? "Select a Province first" : geoLoading.d ? "Loading cities…" : "-- SELECT CITY / MUNICIPALITY --"}</option>
              {districts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </FormRow>

          <FormRow label="Barangay" required>
            <select className={SEL} value={communeId} disabled={!districtId || geoLoading.c}
              onChange={e => pickBarangay(e.target.value)}>
              <option value="">{!districtId ? "Select a City first" : geoLoading.c ? "Loading barangays…" : "-- SELECT BARANGAY --"}</option>
              {communes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </FormRow>

          <FormRow label="Zip Code">
            <Input className="max-w-[220px]" value={form.zip_code || ""} onChange={e => set("zip_code", e.target.value)} />
          </FormRow>

          <FormRow label="Contact No." required>
            <Input value={form.contact_no || ""} placeholder="09XXXXXXXXX"
              onChange={e => set("contact_no", e.target.value)} />
          </FormRow>

          <FormRow label="Item / Product" required>
            <ProductPicker
              products={products}
              loading={productsLoading}
              error={productsError}
              value={product}
              disabled={!pageId}
              onSelect={p => { setProduct(p); setValidated(false); setSubmitError("") }}
            />
            {product && (
              <p className="text-xs text-slate-500 mt-1.5">
                Unit price: <span className="font-medium text-slate-700">{formatCurrency(product.price)}</span>
                {" · "}Pricing & totals are computed by Pancake POS from the product.
              </p>
            )}
          </FormRow>

          <FormRow label="Order Quantity" required>
            <Input type="number" className="w-36" min={1} value={form.quantity ?? 1}
              onChange={e => set("quantity", parseInt(e.target.value) || 0)} />
          </FormRow>

          <FormRow label="Parcel Qty" required>
            <Input type="number" className="w-36" min={1} value={form.parcel_qty ?? 1}
              onChange={e => set("parcel_qty", parseInt(e.target.value) || 1)} />
          </FormRow>

          {product && (
            <FormRow label="Estimated Total">
              <div className="h-10 flex items-center text-sm font-semibold text-slate-900">
                {formatCurrency(estTotal)}
                <span className="ml-2 text-xs font-normal text-slate-400">(estimate — final amount set by Pancake POS)</span>
              </div>
            </FormRow>
          )}

          <FormRow label="Mode of Payment" required>
            <select className={`${SEL} max-w-[280px]`} value={form.mop || ""} onChange={e => set("mop", e.target.value)}>
              {MOPS.map(m => <option key={m}>{m}</option>)}
            </select>
          </FormRow>

          <FormRow label="Remarks">
            <textarea rows={4} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-400 resize-none"
              value={form.remarks || ""} onChange={e => set("remarks", e.target.value)} />
          </FormRow>

          <FormRow label="">
            <div className="space-y-2.5 pt-1">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" className="w-4 h-4" checked={customerRequest} onChange={e => setCustomerRequest(e.target.checked)} />
                <span className="text-slate-700">Customer Request</span>
              </label>
            </div>
          </FormRow>
        </div>

        <div className="flex items-center gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
          <Button disabled={!validated || submitting} onClick={handleSubmit}>
            {submitting ? "Submitting…" : "Submit"}
          </Button>
          <Button className="bg-blue-500 hover:bg-blue-600 text-white" onClick={handleValidate} disabled={submitting}>
            Validate
          </Button>
          <Button variant="outline" onClick={onBack} disabled={submitting}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}

const DOWNLOAD_ORDER_STATUSES = [
  "CANNOT BE REACHED","CANCELLED BY CSR","NO ANSWER","ORDER CONFIRMED",
  "VERIFIER REMARKS","NO TO UPSELL","INCORRECT NUMBER","UNVERIFIED",
]

function DownloadSalesScreen({ onBack, onSuccess, knownCsrs }: { onBack: () => void; onSuccess: (count: number, page: string) => void; knownCsrs: string[] }) {
  const activePages = useActivePages()
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const defaultDT = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
  const defaultDate = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`

  const [form, setForm] = useState({
    date_from: defaultDT,
    date_to: defaultDT,
    order_date_set: defaultDate,
    status: "Confirmed",
    app: "Pancake-POS",
    pages: "",
    csr: "",
    order_status: "ORDER CONFIRMED",
  })
  const [loading, setLoading] = useState(false)

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })) }

  function handleUpdate() {
    setLoading(true)
    // Simulate API call — replace with real Pancake POS fetch later
    setTimeout(() => {
      setLoading(false)
      onSuccess(1, form.pages)
    }, 2200)
  }

  return (
    <div className="w-full space-y-4 relative">
      {/* Loading overlay with spinner */}
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/60">
          <div className="flex flex-col items-center gap-4">
            <div className="relative w-16 h-16">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="absolute w-3 h-3 rounded-full bg-blue-500"
                  style={{
                    top: `${50 - 38 * Math.cos((i * Math.PI * 2) / 8)}%`,
                    left: `${50 + 38 * Math.sin((i * Math.PI * 2) / 8)}%`,
                    transform: "translate(-50%,-50%)",
                    opacity: (i + 1) / 8,
                    animation: `spin-dot 0.8s linear infinite`,
                    animationDelay: `${(i * 0.8) / 8}s`,
                  }}
                />
              ))}
            </div>
            <p className="text-sm text-slate-500 font-medium">Downloading from Pancake POS...</p>
          </div>
        </div>
      )}

      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
        <ChevronLeft className="w-4 h-4" /> Back to Sales Tracker
      </button>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-6 pt-5 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Download className="w-5 h-5 text-slate-700" />
            <h2 className="font-bold text-slate-900 text-base uppercase tracking-wide">Download Sales Monitoring from 3P Apps</h2>
          </div>
        </div>

        <div className="px-6 pt-4 pb-2">
          <p className="text-sm text-blue-600 mb-5">
            This event will only process &ldquo;confirmed orders&rdquo; from your Pancake POS
          </p>

          <FormRow label="Pancake Order Date From" required>
            <input type="datetime-local" value={form.date_from} onChange={e => set("date_from", e.target.value)}
              className="h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white focus:outline-none focus:border-blue-400 w-full max-w-sm" />
          </FormRow>

          <FormRow label="Pancake Order Date To" required>
            <input type="datetime-local" value={form.date_to} onChange={e => set("date_to", e.target.value)}
              className="h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white focus:outline-none focus:border-blue-400 w-full max-w-sm" />
          </FormRow>

          <FormRow label="Order Date Set">
            <input type="date" value={form.order_date_set} onChange={e => set("order_date_set", e.target.value)}
              className="h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white focus:outline-none focus:border-blue-400 w-full max-w-sm" />
          </FormRow>

          <FormRow label="Status" required>
            <select className={`${SEL} max-w-sm`} value={form.status} onChange={e => set("status", e.target.value)}>
              <option>Confirmed</option>
              <option>Pending</option>
              <option>Cancelled</option>
            </select>
          </FormRow>

          <FormRow label="App" required>
            <select className={`${SEL} max-w-sm`} value={form.app} onChange={e => set("app", e.target.value)}>
              <option>Pancake-POS</option>
            </select>
          </FormRow>

          <FormRow label="Pages">
            <select className={`${SEL} max-w-sm`} value={form.pages} onChange={e => set("pages", e.target.value)}>
              <option value="">-- SELECT PAGE --</option>
              {activePages.filter(p => p.api_key && (p.pancake_page_id || p.shop_id)).map(p => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          </FormRow>

          <FormRow label="CSR">
            <div className="max-w-sm">
              <input list="dl-csr-datalist" className={`${SEL} max-w-sm`} placeholder="Type CSR name"
                value={form.csr} onChange={e => set("csr", e.target.value)} />
              <datalist id="dl-csr-datalist">
                {knownCsrs.map(n => <option key={n} value={n} />)}
              </datalist>
            </div>
          </FormRow>

          <FormRow label="Order Status">
            <select className={`${SEL} max-w-sm`} value={form.order_status} onChange={e => set("order_status", e.target.value)}>
              {DOWNLOAD_ORDER_STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          </FormRow>
        </div>

        <div className="flex items-center gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50 mt-2">
          <Button className="bg-blue-500 hover:bg-blue-600 text-white px-8" onClick={handleUpdate} disabled={loading}>
            Update
          </Button>
          <Button variant="outline" onClick={onBack} disabled={loading}>Return to Sales Tracker</Button>
        </div>
      </div>
    </div>
  )
}

function ReportModal({ orders, onClose }: { orders: Order[]; onClose: () => void }) {
  const [search, setSearch] = useState("")
  const { csrMap, reportStatuses } = useMemo(() => {
    const statusSet = new Set<string>()
    const map: Record<string, Record<string, number>> = {}
    orders.forEach(o => {
      const csr = o.csr_name || "(Unknown)"
      const status = o.parcel_status || "Not Available"
      if (!map[csr]) map[csr] = {}
      map[csr][status] = (map[csr][status] || 0) + 1
      statusSet.add(status)
    })
    return { csrMap: map, reportStatuses: Array.from(statusSet).sort() }
  }, [orders])

  const csrs = Object.keys(csrMap).filter(c => c.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full shadow-2xl max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-bold text-slate-900 text-lg">Sales Report by CSR</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="p-4 border-b border-slate-100">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search CSR..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50">
                <th className="text-left px-3 py-2 border border-slate-200 font-semibold text-slate-600 whitespace-nowrap">CSR Full Name</th>
                {reportStatuses.map(s => <th key={s} className="text-center px-2 py-2 border border-slate-200 font-semibold text-slate-600 whitespace-nowrap">{s}</th>)}
              </tr>
            </thead>
            <tbody>
              {csrs.map(csr => (
                <tr key={csr} className="hover:bg-slate-50">
                  <td className="px-3 py-2 border border-slate-200 font-medium text-slate-900 whitespace-nowrap">{csr}</td>
                  {reportStatuses.map(s => (
                    <td key={s} className="text-center px-2 py-2 border border-slate-200 text-slate-600">{csrMap[csr][s] || 0}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// Stock-level highlight for the Order column: "out" → red, "low" → orange, "" → normal.
// LIVE since the Stocks module: the order's item text is matched against unit codes, and a
// code's sellable bundles = min over its recipe of floor(item Remaining ÷ qty per bundle).
const LOW_STOCK_BUNDLES = 10

export default function SalesTrackerPage() {
  const activePages = useActivePages()
  // Live stock per unit code (fed by Product Items' Remaining, deducted via the Stocks module).
  const unitCodeStore = useUnitCodes()
  const productItemsStore = useProductItems()
  const stockByCode = useMemo(() => {
    const items = productItemsStore.items.filter(i => !i.deleted)
    const remOf = (name: string) => { const it = items.find(i => i.name.toLowerCase() === name.toLowerCase()); return it ? itemRemaining(it) : null }
    return unitCodeStore.codes
      .filter(c => !c.archived && c.code)
      .map(c => {
        const perItem = c.items.map(r => { const rem = remOf(r.name); return rem == null || !(r.qty > 0) ? null : Math.floor(rem / r.qty) })
        const known = perItem.filter((x): x is number => x != null)
        return { code: c.code.toLowerCase(), bundles: known.length ? Math.min(...known) : null }
      })
      .filter((x): x is { code: string; bundles: number } => x.bundles != null)
  }, [unitCodeStore.codes, productItemsStore.items])
  const stockStatusOf = useCallback((order: Order): "" | "out" | "low" => {
    const txt = (order.order_item || "").toLowerCase()
    if (!txt) return ""
    let worst: "" | "out" | "low" = ""
    for (const s of stockByCode) {
      if (!txt.includes(s.code)) continue
      if (s.bundles <= 0) return "out"
      if (s.bundles <= LOW_STOCK_BUNDLES) worst = "low"
    }
    return worst
  }, [stockByCode])
  const [orders, setOrders] = useState<Order[]>([])
  const [loadingOrders, setLoadingOrders] = useState(false)
  const [fetchErrors, setFetchErrors] = useState<string[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [showDownload, setShowDownload] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [successInfo, setSuccessInfo] = useState<{ count: number; page: string } | null>(null)
  const [showToast, setShowToast] = useState(false)
  const [showTools, setShowTools] = useState(false)
  const [showJntUpdate, setShowJntUpdate] = useState(false)
  // J&T shipping fees imported from Excel, keyed by tracking number (overrides the order's shipping_fee).
  const [jntFees, setJntFees] = useState<Record<string, number>>({})
  useEffect(() => { fetchJntFees().then(setJntFees).catch(() => {}) }, [])
  const applyJntFees = useCallback((map: Record<string, number>) => {
    setJntFees(prev => ({ ...prev, ...map }))
    upsertJntFees(map).catch(() => {})
  }, [])
  const [search, setSearch] = useState("")
  const [orderStatus, setOrderStatus] = useState("All")
  const [fOrdersPage, setFOrdersPage] = useState("All")   // "Orders" dropdown — view one page's orders only
  const [perPage, setPerPage] = useState(30)
  const [page, setPage] = useState(1)
  const [hiddenCols, setHiddenCols] = useState<string[]>(DEFAULT_HIDDEN)
  // Date range filter on Order Date
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  // Per-column filters (keyed by column; date ranges use `${col}__from` / `${col}__to`)
  const [colFilters, setColFilters] = useState<Record<string, string>>({})
  const setColFilter = (key: string, val: string) => { setColFilters(f => ({ ...f, [key]: val })); setPage(1) }

  // Dropdown filter options derived from the ACTUAL loaded data, so every option matches a real
  // Pancake value exactly (Order Status uses Pancake's own status_name: new, confirmed, shipped,
  // received, canceled, restocking, packaging, waiting for pick up, …). Shift stays fixed (deferred).
  const colOptions = useMemo(() => {
    const uniq = (k: string) => Array.from(new Set(orders.map(o => String((o as any)[k] ?? "")).filter(Boolean))).sort()
    return {
      page_name: uniq("page_name"),
      platform: uniq("platform"),
      courier: uniq("courier"),
      parcel_status: uniq("parcel_status"),
      order_status: ORDER_STATUS_OPTIONS,
      mop: uniq("mop"),
      shift: ["AM", "PM"],
    } as Record<string, string[]>
  }, [orders])

  const hasColFilters = Object.values(colFilters).some(v => v) || !!search || !!dateFrom || !!dateTo || orderStatus !== "All" || fOrdersPage !== "All"
  function clearFilters() {
    setColFilters({}); setSearch(""); setDateFrom(""); setDateTo(""); setOrderStatus("All"); setFOrdersPage("All"); setPage(1)
  }

  // Connected pages (valid Pancake creds). Cred-aware key so adding/fixing a page re-fetches.
  const pagesWithCreds = useMemo(
    () => activePages.filter(p => p.api_key && (p.pancake_page_id || p.shop_id)),
    [activePages])
  const pagesKey = pagesWithCreds.map(p => `${p.id}:${p.api_key}:${p.pancake_page_id || p.shop_id}`).join(",")

  // Fetch window: the Order Date COLUMN filter (From/To) if set, else the current month (bounds
  // the volume). Changing the Order Date column filter re-fetches that period from Pancake.
  const today = new Date()
  const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
  const fetchFrom = colFilters["order_date__from"] || monthStart
  const fetchTo = colFilters["order_date__to"] || todayStr

  const loadOrders = useCallback(async (pages: typeof pagesWithCreds, from: string, to: string, noCache = false) => {
    if (pages.length === 0) { setOrders([]); setFetchErrors([]); return }
    setLoadingOrders(true)
    const errs: string[] = []
    const all: Order[] = []
    // Pre-upsell baseline per order (Pancake doesn't store the previous amount). We snapshot each
    // order's total while it has NO upsell tag, then compute the upsell delta once it gets tagged.
    let baseline: Record<string, number> = {}
    try { baseline = await fetchOrderBaselines() } catch {}
    const baselineDirty: Record<string, number> = {}   // only new/changed snapshots get written back

    await mapLimit(pages, 3, async page => {
      const pageId = page.pancake_page_id || page.shop_id
      try {
        const rows = await fetchPageRows(page.api_key, pageId, from, to, noCache)
        for (const r of rows) {
          const uid = `${page.id}-${r.id}`
          const currentTotal = Number(r.price_initial || 0)  // route price_initial = current total (New Amount)
          // Split the total into Initial (original/previous) + Upsell (delta). Final = current total.
          let priceUpsell: number | "" = ""
          let priceInitial = currentTotal  // default (no upsell): Initial = the whole amount
          if (r.is_upsell) {
            const prev = baseline[uid]
            if (prev != null && currentTotal > prev) {
              priceUpsell = currentTotal - prev   // upsell amount only
              priceInitial = prev                  // original amount (before upsell)
            }
            // upsell-tagged but no captured baseline → can't separate; Initial stays = currentTotal, Upsell blank
          } else if (currentTotal > 0 && baseline[uid] !== currentTotal) {
            baseline[uid] = currentTotal  // keep the latest pre-upsell total as the baseline
            baselineDirty[uid] = currentTotal
          }
          all.push({
            ...r,
            id: uid,
            order_date: r.date_added || r.encoded_date || "",
            order_status: normalizeOrderStatus(r.order_status),
            page_name: page.name,
            platform: page.platform,
            price_initial: priceInitial,   // original amount (excludes upsell)
            price_upsell: priceUpsell,     // upsell amount only (New − Previous), blank if N/A
            final_price: currentTotal,     // Final = Initial + Upsell (current/new total)
            // verifier_name / upsell_by / reserve_date / parcel_update come from the API (keep r.*).
            // Verifier & Upsell By stay BLANK when empty, so a name stands out once a tag is added.
            verifier_name: r.verifier_name || "",
            upsell_by: r.upsell_by || "",
            reserve_date: r.reserve_date || "Not Available",
            // Shift: Pancake has no staff shift data in the API — not derivable.
            shift: "Not Available",
            // Retention By: staff who created a retention-tagged order (blank if no Retention tag).
            retention_by: r.retention_by || "",
          } as Order)
        }
      } catch (e: any) {
        errs.push(`${page.name}: ${e?.message || "Failed to fetch"}`)
      }
    })
    upsertOrderBaselines(baselineDirty).catch(() => {})
    setOrders(all)
    setFetchErrors(errs)
    setLoadingOrders(false)
  }, [])

  // Auto-load real data on mount, and re-load when the connected pages or date window change.
  useEffect(() => {
    loadOrders(pagesWithCreds, fetchFrom, fetchTo)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagesKey, fetchFrom, fetchTo])

  // Overlay imported J&T shipping fees (by tracking number) onto the live orders.
  const ordersDisplay = useMemo(
    () => orders.map(o => { const f = jntFees[o.tracking_no]; return f != null && o.tracking_no ? { ...o, shipping_fee: f } : o }),
    [orders, jntFees])

  const filtered = useMemo(() => ordersDisplay.filter(o => {
    const matchSearch = search === "" || Object.values(o).some(v => String(v).toLowerCase().includes(search.toLowerCase()))
    const matchStatus = orderStatus === "All" || o.order_status === orderStatus
    const matchPage = fOrdersPage === "All" || o.page_name === fOrdersPage
    const matchFrom = !dateFrom || o.order_date >= dateFrom
    const matchTo = !dateTo || o.order_date <= dateTo
    if (!(matchSearch && matchStatus && matchPage && matchFrom && matchTo)) return false

    // Per-column filters (all must pass — AND)
    for (const col of ALL_COLUMNS) {
      const raw = String((o as any)[col] ?? "")
      if (COL_DATE_RANGE.has(col)) {
        const d = raw.slice(0, 10)  // handle "YYYY-MM-DD HH:mm:ss" values
        const from = colFilters[`${col}__from`], to = colFilters[`${col}__to`]
        if (from && (!d || d < from)) return false
        if (to && (!d || d > to)) return false
      } else if (COL_DROPDOWN.has(col)) {
        const f = colFilters[col]
        if (f && raw !== f) return false
      } else {
        const f = colFilters[col]
        if (f && !raw.toLowerCase().includes(f.toLowerCase())) return false
      }
    }
    return true
  }), [ordersDisplay, search, orderStatus, fOrdersPage, dateFrom, dateTo, colFilters])

  // Totals for filtered data
  const totalPrice = useMemo(() => filtered.reduce((s, o) => s + (o.final_price || 0), 0), [filtered])
  const totalShipping = useMemo(() => filtered.reduce((s, o) => s + (o.shipping_fee || 0), 0), [filtered])

  // CSR suggestions derived from real loaded order data — unique non-empty csr_name values.
  const knownCsrs = useMemo(() =>
    Array.from(new Set(orders.map(o => o.csr_name).filter(Boolean))).sort()
  , [orders])

  const paginated = filtered.slice((page - 1) * perPage, page * perPage)
  const totalPages = Math.ceil(filtered.length / perPage)
  const visibleCols = ALL_COLUMNS.filter(c => !hiddenCols.includes(c))

  function toggleCol(col: string) { setHiddenCols(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]) }

  function deleteOrder(id: string) { setOrders(prev => prev.filter(o => o.id !== id)) }

  function updateParcelStatus(id: string, status: string) {
    setOrders(prev => prev.map(o => o.id === id ? { ...o, parcel_status: status } : o))
  }

  const TOOLS_ITEMS = [
    { icon: Download, label: "Download Sales from 3P Apps", action: () => setShowDownload(true) },
    { icon: FileText, label: "RTS Report Per Item", action: () => {} },
    { icon: ScanLine, label: "Scan Order (Barcode)", action: () => {} },
    { icon: Upload, label: "Upload Sales Monitoring", action: () => {} },
    { icon: Trash2, label: "Delete Uploaded Sales Monitoring", action: () => {} },
    { icon: User, label: "USER ID", action: () => {} },
    { icon: FileSpreadsheet, label: "Export to Excel", action: () => exportToExcel(filtered, visibleCols) },
    { icon: Truck, label: "Update J&T Shipping Fee", action: () => setShowJntUpdate(true) },
    { icon: RefreshCw, label: "Update Parcel", action: () => {} },
  ]

  if (showAdd) {
    return <AddOrderScreen
      onBack={() => setShowAdd(false)}
      knownCsrs={knownCsrs}
      onCreated={(info) => {
        setShowAdd(false)
        setSuccessInfo(info)
        setShowToast(true)
        setTimeout(() => setShowToast(false), 6000)
        // Re-pull fresh rows so the newly created Pancake order shows up in the tracker.
        loadOrders(pagesWithCreds, fetchFrom, fetchTo, true)
      }}
    />
  }

  if (showJntUpdate) {
    return <JntShippingFeeScreen
      orders={orders}
      onBack={() => setShowJntUpdate(false)}
      onApply={applyJntFees}
    />
  }

  if (showDownload) {
    return <DownloadSalesScreen
      onBack={() => setShowDownload(false)}
      knownCsrs={knownCsrs}
      onSuccess={(count, page) => {
        setSuccessInfo({ count, page })
        setShowToast(true)
        setShowDownload(false)
        setTimeout(() => setShowToast(false), 6000)
      }}
    />
  }

  return (
    <div className="space-y-4 max-w-full">
      {showReport && <ReportModal orders={filtered} onClose={() => setShowReport(false)} />}

      {/* Toast notification (top-right) */}
      {showToast && successInfo && (
        <div className="fixed top-5 right-5 z-50 w-80 bg-teal-500 text-white rounded-xl shadow-2xl p-4 animate-in slide-in-from-right-5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-3">
              <Check className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <div className="text-sm space-y-0.5">
                <p className="font-bold">Success</p>
                <p>{successInfo.count} new orders added successfully</p>
                <p>0 skipped.</p>
                <p>Unconfirmed 0</p>
                <p>pages with unconfirmed : []</p>
                <p className="font-bold text-yellow-300 text-xs mt-1 uppercase leading-snug">
                  Always remember to check the total entries and the total amount of your data both ERP &amp; POS
                </p>
              </div>
            </div>
            <button onClick={() => setShowToast(false)} className="flex-shrink-0 opacity-80 hover:opacity-100">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Success banner (inline, below header) */}
      {successInfo && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 relative">
          <button onClick={() => setSuccessInfo(null)} className="absolute top-3 right-3 text-green-400 hover:text-green-600">
            <X className="w-4 h-4" />
          </button>
          <p className="text-green-700 font-bold text-base mb-1">Success!</p>
          <p className="text-green-700 text-sm">{successInfo.count} new orders added successfully</p>
          <p className="text-green-700 text-sm">0 skipped.</p>
          <p className="text-green-700 text-sm">Unconfirmed 0</p>
          <p className="text-green-700 text-sm">pages with unconfirmed : []</p>
          <p className="text-red-600 font-bold text-sm mt-2 uppercase">
            Always remember to check the total entries and the total amount of your data both ERP &amp; POS
          </p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 pb-4 mb-1 border-b border-slate-100">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2">
          <ShoppingCart className="w-5 h-5" /> SALES TRACKER
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Add New Order</Button>
          <Button variant="outline" size="icon" title="Refresh" onClick={() => loadOrders(pagesWithCreds, fetchFrom, fetchTo, true)}><RefreshCw className="w-4 h-4" /></Button>
          <Button variant="outline" onClick={() => setShowReport(true)}><FileText className="w-4 h-4" /> Report</Button>
          <div className="relative">
            <Button variant="outline" onClick={() => setShowTools(s => !s)}>
              Tools <ChevronDown className="w-3.5 h-3.5" />
            </Button>
            {showTools && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowTools(false)} />
                <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 w-64 py-1">
                  {TOOLS_ITEMS.map(({ icon: Icon, label, action }) => (
                    <button key={label} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 text-slate-700 text-left"
                      onClick={() => { action(); setShowTools(false) }}>
                      <Icon className="w-4 h-4 text-slate-500 flex-shrink-0" /> {label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Loading overlay while fetching real orders from Pancake */}
      {loadingOrders && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/60">
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

      {/* No connected page */}
      {pagesWithCreds.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
          No connected Page / Store with API access. Add Pancake credentials in <strong>Pages &amp; Store</strong> to see real orders here.
        </div>
      )}

      {/* Per-page connection errors */}
      {fetchErrors.length > 0 && (
        <div className="bg-red-50 border border-red-300 rounded-xl p-3 flex items-start gap-2.5">
          <X className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="text-sm font-bold text-red-700">Connection Issue</p>
            {fetchErrors.map((e, i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
          </div>
        </div>
      )}

      {/* Toggle Column buttons */}
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Toggle column:</p>
        <div className="flex flex-wrap gap-1.5">
          {ALL_COLUMNS.map(col => (
            <ToggleChip key={col} label={COLUMN_LABELS[col]} hidden={hiddenCols.includes(col)}
              tip={COLUMN_TOOLTIPS[col]} onToggle={() => toggleCol(col)} />
          ))}
        </div>
      </div>

      {/* Stock legend (colors go live with the Warehouse module) · Orders page filter · per-page */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-xs text-slate-600"><span className="w-3 h-3 rounded-sm bg-red-500 inline-block" /> Out of stock</span>
          <span className="flex items-center gap-1.5 text-xs text-slate-600"><span className="w-3 h-3 rounded-sm bg-amber-400 inline-block" /> Low on stock</span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-500">
            Orders
            <select className="h-9 rounded-lg border border-slate-300 px-3 text-sm bg-white text-slate-700 min-w-[140px]"
              value={fOrdersPage} onChange={e => { setFOrdersPage(e.target.value); setPage(1) }}>
              <option value="All">ALL</option>
              {(colOptions.page_name || []).map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <span className="text-sm text-slate-500">{filtered.length} records</span>
          <select className="h-9 rounded-lg border border-slate-300 px-3 text-sm bg-white"
            value={perPage} onChange={e => setPerPage(parseInt(e.target.value))}>
            {[30, 50, 100, 150, 200, 500, 1000].map(n => <option key={n} value={n}>{n} / page</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 sticky top-0 z-20">
              <tr className="border-b border-slate-200">
                <th className="px-3 py-3 text-left font-semibold text-slate-500 uppercase sticky left-0 bg-slate-50 z-10">No</th>
                {visibleCols.map(col => (
                  <th key={col} className="px-3 py-3 text-left font-semibold text-slate-500 uppercase whitespace-nowrap">{COLUMN_LABELS[col]}</th>
                ))}
                <th className="px-3 py-3 text-left font-semibold text-slate-500 uppercase whitespace-nowrap">Actions</th>
              </tr>
              {/* Per-column filter row */}
              <tr className="border-b border-slate-200 bg-white">
                <th className="px-2 py-1.5 sticky left-0 bg-white z-10"></th>
                {visibleCols.map(col => (
                  <th key={col} className="px-2 py-1.5 align-top font-normal">
                    {COL_DATE_RANGE.has(col) ? (
                      <div className="min-w-[124px]">
                        <DateRangePicker a={colFilters[`${col}__from`] || ""} b={colFilters[`${col}__to`] || ""}
                          onApply={(a, b) => { setColFilters(f => ({ ...f, [`${col}__from`]: a, [`${col}__to`]: b })); setPage(1) }} />
                      </div>
                    ) : COL_DROPDOWN.has(col) ? (
                      <select value={colFilters[col] || ""} onChange={e => setColFilter(col, e.target.value)}
                        className="h-7 rounded border border-slate-300 px-1.5 text-[11px] bg-white focus:outline-none focus:border-blue-400 min-w-[110px] max-w-[150px]">
                        <option value="">All</option>
                        {(colOptions[col] || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    ) : (
                      <input type="text" value={colFilters[col] || ""} onChange={e => setColFilter(col, e.target.value)}
                        placeholder="Search" className="h-7 w-full min-w-[100px] max-w-[150px] rounded border border-slate-300 px-1.5 text-[11px] bg-white focus:outline-none focus:border-blue-400" />
                    )}
                  </th>
                ))}
                <th className="px-2 py-1.5 align-top">
                  <button onClick={clearFilters} disabled={!hasColFilters}
                    className="h-7 px-2.5 rounded border border-slate-300 text-[11px] font-medium text-slate-600 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
                    Clear Filters
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginated.length === 0 ? (
                <tr><td colSpan={visibleCols.length + 2} className="text-center py-12 text-slate-400">No orders found</td></tr>
              ) : paginated.map((order, i) => (
                <tr key={order.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2.5 text-slate-400 sticky left-0 bg-white">{(page - 1) * perPage + i + 1}</td>
                  {visibleCols.map(col => {
                    const val = (order as any)[col]
                    if (col === "final_price" || col === "price_initial" || col === "price_upsell" || col === "shipping_fee") {
                      return <td key={col} className="px-3 py-2.5 font-semibold text-slate-900 whitespace-nowrap">{val ? formatCurrency(val) : "-"}</td>
                    }
                    if (col === "parcel_status") return (
                      <td key={col} className="px-3 py-2.5">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${val === "Delivered" ? "bg-green-100 text-green-700" : val === "Returned" || val === "Cancelled by Customer" || val === "Cancelled by Warehouse" ? "bg-red-100 text-red-700" : val === "Shipped Out" ? "bg-blue-100 text-blue-700" : val === "In-Transit" ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-600"}`}>{val}</span>
                      </td>
                    )
                    // Order Status: clean colored badge (table view only) — not a full-cell box
                    if (col === "order_status") return (
                      <td key={col} className="px-3 py-2.5">
                        {val
                          ? <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${ORDER_STATUS_BADGE[val] || "bg-slate-100 text-slate-600"}`}>{val}</span>
                          : <span className="text-slate-400">-</span>}
                      </td>
                    )
                    // Verifier & Upsell By: truly blank when empty (no "-"), so a tagged name stands out
                    if (col === "verifier_name" || col === "upsell_by") {
                      return <td key={col} className="px-3 py-2.5 text-slate-700 whitespace-nowrap max-w-[160px] truncate font-medium">{val || ""}</td>
                    }
                    // Order: colored by the item's live stock level (red = out, orange = low bundles).
                    if (col === "order_item") {
                      const stock = stockStatusOf(order)
                      return <td key={col} className={`px-3 py-2.5 whitespace-nowrap max-w-[160px] truncate ${stock === "out" ? "text-red-600 font-semibold" : stock === "low" ? "text-amber-600 font-semibold" : "text-slate-700"}`}>{val || "-"}</td>
                    }
                    return <td key={col} className="px-3 py-2.5 text-slate-700 whitespace-nowrap max-w-[160px] truncate">{val || "-"}</td>
                  })}
                  {/* Actions: search (parcel status update), delete */}
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <select
                        value={order.parcel_status}
                        onChange={e => updateParcelStatus(order.id, e.target.value)}
                        className="h-7 rounded border border-slate-200 px-1.5 text-xs bg-white focus:outline-none focus:border-blue-400 max-w-[130px]"
                      >
                        {PARCEL_STATUSES.map(s => <option key={s}>{s}</option>)}
                      </select>
                      <button
                        onClick={() => deleteOrder(order.id)}
                        className="w-6 h-6 flex items-center justify-center rounded bg-red-100 text-red-500 hover:bg-red-200 transition-colors"
                        title="Delete order"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Total Price + Total Shipping Fee — sticky at the bottom so it stays visible while
        scrolling a tall (e.g. 100-per-page) table, same pattern as Fulfillment's totals. */}
        {filtered.length > 0 && (
          <div className="sticky bottom-0 z-20 border-t border-slate-200 px-4 py-3 bg-slate-50 flex flex-wrap gap-6 text-sm shadow-[0_-2px_6px_rgba(0,0,0,0.04)]">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-600">Total Price:</span>
              <span className="font-bold text-slate-900">{formatCurrency(totalPrice)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-600">Total Shipping Fee:</span>
              <span className="font-bold text-slate-900">{formatCurrency(totalShipping)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-600">Total Records:</span>
              <span className="font-bold text-slate-900">{filtered.length}</span>
            </div>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
            <p className="text-sm text-slate-500">Page {page} of {totalPages}</p>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
              <Button size="sm" variant="outline" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// Update J&T Shipping Fee — download a template, fill it with Tracking Number +
// Shipping Fee, re-upload, and the ERP matches each row's tracking number against the
// loaded J&T orders and writes the shipping fee onto every match. Animated progress
// shows matched vs failed counts, then the final totals + matched list.
// ════════════════════════════════════════════════════════════════════════════════
const norm = (s: any) => String(s ?? "").trim().toUpperCase()

function JntShippingFeeScreen({ orders, onBack, onApply }: {
  orders: Order[]
  onBack: () => void
  onApply: (map: Record<string, number>) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [phase, setPhase] = useState<"idle" | "matching" | "done">("idle")
  const [parseError, setParseError] = useState("")
  const [results, setResults] = useState<{ tracking: string; fee: number; matched: boolean; customer: string; status: string }[]>([])
  const [shown, setShown] = useState(0)

  // tracking number → order (only orders that have a tracking number)
  const orderByTracking = useMemo(() => {
    const m = new Map<string, Order>()
    for (const o of orders) { if (o.tracking_no) m.set(norm(o.tracking_no), o) }
    return m
  }, [orders])

  function downloadTemplate() {
    const headerStyle = {
      fill: { patternType: "solid", fgColor: { rgb: "C8102E" } }, // J&T red
      font: { color: { rgb: "FFFFFF" }, bold: true },
      alignment: { horizontal: "center", vertical: "center" },
    }
    const cols = ["Tracking Number", "Shipping Fee"]
    const ws = XLSX.utils.aoa_to_sheet([cols, ["JT0000000001", 0]])
    cols.forEach((_, i) => { const ref = XLSX.utils.encode_cell({ r: 0, c: i }); if ((ws as any)[ref]) (ws as any)[ref].s = headerStyle })
    ;(ws as any)["!cols"] = [{ wch: 24 }, { wch: 16 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "J&T Shipping Fee")
    XLSX.writeFile(wb, "JT_Shipping_Fee_Template.xlsx")
  }

  function startMatch() {
    if (!file) return
    setParseError("")
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: "array" })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" })
        if (rows.length < 2) { setParseError("The file has no data rows."); return }
        const header = rows[0].map((h: any) => String(h).trim().toLowerCase())
        const tCol = header.findIndex((h: string) => h.includes("tracking"))
        const fCol = header.findIndex((h: string) => h.includes("fee") || h.includes("amount") || h.includes("shipping"))
        if (tCol < 0 || fCol < 0) { setParseError("Couldn't find 'Tracking Number' and 'Shipping Fee' columns."); return }
        const res: { tracking: string; fee: number; matched: boolean; customer: string; status: string }[] = []
        for (let r = 1; r < rows.length; r++) {
          const tracking = String(rows[r][tCol] ?? "").trim()
          if (!tracking || tracking === "JT0000000001") continue
          const fee = parseFloat(String(rows[r][fCol] ?? "").replace(/[^0-9.-]/g, "")) || 0
          const o = orderByTracking.get(norm(tracking))
          res.push({ tracking, fee, matched: !!o, customer: o?.customer_name || "", status: o?.order_status || "" })
        }
        if (res.length === 0) { setParseError("No valid rows found in the file."); return }
        setResults(res)
        setShown(0)
        setPhase("matching")
      } catch {
        setParseError("Could not read the file — make sure it's a valid .xlsx file.")
      }
    }
    reader.readAsArrayBuffer(file)
  }

  // Animate the progress bar revealing matches one batch at a time.
  useEffect(() => {
    if (phase !== "matching") return
    const total = results.length
    const stepMs = Math.max(12, Math.min(40, 1800 / total))
    const batch = Math.max(1, Math.round(total / 120))
    const id = setInterval(() => {
      setShown(s => {
        const next = Math.min(total, s + batch)
        if (next >= total) {
          clearInterval(id)
          const map: Record<string, number> = {}
          for (const x of results) if (x.matched) map[x.tracking] = x.fee
          onApply(map)
          setPhase("done")
        }
        return next
      })
    }, stepMs)
    return () => clearInterval(id)
  }, [phase, results, onApply])

  const slice = results.slice(0, shown)
  const matchedCount = slice.filter(r => r.matched).length
  const failedCount = slice.length - matchedCount
  const total = results.length
  const pctDone = total ? Math.round((shown / total) * 100) : 0
  const matchedList = results.filter(r => r.matched)

  return (
    <div className="space-y-4 max-w-3xl">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
        <ChevronLeft className="w-4 h-4" /> Back to Sales Tracker
      </button>

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h1 className="text-lg font-bold text-red-600 flex items-center gap-2 mb-1">
          <Truck className="w-5 h-5" /> UPDATE J&T SHIPPING FEE
        </h1>
        <p className="text-sm text-slate-500 mb-5">
          Download the template, fill in each parcel's <strong>Tracking Number</strong> and <strong>Shipping Fee</strong>, then upload it.
          The ERP matches every tracking number to your J&amp;T orders and writes the fee into the Sales Tracker.
        </p>

        {phase === "idle" && (
          <div className="space-y-4">
            <div className="grid grid-cols-[150px_1fr] items-center gap-3">
              <span className="text-sm text-slate-600 text-right">Template</span>
              <button onClick={downloadTemplate} className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
                <Download className="w-4 h-4" /> Click to Download Template
              </button>
            </div>
            <div className="grid grid-cols-[150px_1fr] items-center gap-3">
              <span className="text-sm text-slate-600 text-right">Upload Excel <span className="text-red-500">*</span></span>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 flex-1 h-10 border border-slate-300 rounded-lg px-3 text-sm bg-white">
                  {file ? <span className="truncate text-slate-700">{file.name}</span> : <span className="text-slate-400 italic">No file selected</span>}
                </div>
                <button onClick={() => fileRef.current?.click()} className="px-3 h-10 rounded-lg bg-slate-100 border border-slate-300 text-sm text-slate-600 hover:bg-slate-200">Select file</button>
                <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { setFile(f); setParseError("") } }} />
              </div>
            </div>
            {parseError && <p className="text-sm text-rose-600">{parseError}</p>}
            <div className="flex gap-2 pt-1">
              <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={startMatch} disabled={!file}>Match &amp; Update</Button>
              <Button variant="outline" onClick={onBack}>Cancel</Button>
            </div>
            <p className="text-xs text-slate-400">{orderByTracking.size} loaded orders have tracking numbers to match against.</p>
          </div>
        )}

        {(phase === "matching" || phase === "done") && (
          <div className="space-y-4">
            {/* Progress bar */}
            <div>
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                <span className="flex items-center gap-1.5">
                  {phase === "matching" ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-red-500" /> : <Check className="w-3.5 h-3.5 text-emerald-500" />}
                  {phase === "matching" ? `Matching… ${shown} / ${total}` : "Matching complete"}
                </span>
                <span className="tabular-nums">{pctDone}%</span>
              </div>
              <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-red-500 to-red-600 transition-all duration-100" style={{ width: `${pctDone}%` }} />
              </div>
            </div>

            {/* Live counters */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-center">
                <div className="text-2xl font-bold text-emerald-700 tabular-nums">{matchedCount}</div>
                <div className="text-[11px] uppercase tracking-wider text-emerald-600">Updated</div>
              </div>
              <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-center">
                <div className="text-2xl font-bold text-rose-700 tabular-nums">{failedCount}</div>
                <div className="text-[11px] uppercase tracking-wider text-rose-600">Failed</div>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-center">
                <div className="text-2xl font-bold text-slate-700 tabular-nums">{total}</div>
                <div className="text-[11px] uppercase tracking-wider text-slate-500">Total Rows</div>
              </div>
            </div>

            {phase === "done" && (
              <>
                <div className="rounded-xl bg-emerald-600 text-white px-4 py-3 text-sm font-semibold flex items-center gap-2">
                  <Check className="w-4 h-4" /> {matchedCount} updated, {failedCount} failed — shipping fees applied to the Sales Tracker.
                </div>
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="grid grid-cols-[1fr_130px_140px_110px] gap-px bg-slate-100 text-[11px] font-semibold text-slate-500">
                    <span className="bg-slate-50 px-3 py-2">Customer</span>
                    <span className="bg-slate-50 px-3 py-2">Status</span>
                    <span className="bg-slate-50 px-3 py-2">Tracking No.</span>
                    <span className="bg-slate-50 px-3 py-2 text-right">Shipping Fee</span>
                  </div>
                  <div className="max-h-72 overflow-auto scrollbar-dark">
                    {matchedList.length === 0 ? (
                      <div className="px-3 py-4 text-sm text-slate-400 text-center">No tracking numbers matched any loaded order.</div>
                    ) : matchedList.map((r, i) => {
                      const isReturn = /return/i.test(r.status)
                      return (
                        <div key={i} className="grid grid-cols-[1fr_130px_140px_110px] gap-px border-t border-slate-100 text-sm">
                          <span className="px-3 py-2 text-slate-700 truncate">{r.customer || "—"}</span>
                          <span className="px-3 py-2">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${isReturn ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{r.status || "—"}</span>
                          </span>
                          <span className="px-3 py-2 text-slate-500 font-mono text-xs">{r.tracking}</span>
                          <span className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-600">{formatCurrency(r.fee)}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={onBack}>Done</Button>
                  <Button variant="outline" onClick={() => { setFile(null); setResults([]); setShown(0); setPhase("idle") }}>Import Another</Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
