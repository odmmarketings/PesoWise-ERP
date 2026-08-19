"use client"
import { useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import * as XLSX from "xlsx-js-style"
import {
  Tag, Plus, Search, Pencil, X, ChevronLeft, ChevronRight, Check, Settings, Archive, ArchiveRestore,
  FolderOpen, List, Wrench, Upload, FileSpreadsheet, RotateCcw, Trash2, LayoutDashboard, PackagePlus,
} from "lucide-react"
import { useProductItems, itemRemaining, ITEM_STATUSES, type ProductItem, type NewItemInput, type ItemStatus } from "@/lib/product-items-store"
import { useSuppliers } from "@/lib/supplier-store"
import { Confidential, ConfidentialToggle } from "@/components/business/Confidential"
import { HelpButton, type HelpSection } from "@/components/business/HelpButton"
import { useProductBatches, valueOf, batchRemaining, fifoOrder, type ProductBatch } from "@/lib/product-batches-store"
import { isMotherAccount } from "@/lib/users-store"
import { InventoryDashboard } from "@/components/business/inventory/InventoryDashboard"

const INP = "w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white focus:outline-none focus:border-blue-400"
const FINP = "w-full h-8 rounded-lg border border-slate-200 px-2 text-xs bg-white focus:outline-none focus:border-blue-400"
const fmtNum = (n: number) => n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function FormRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[170px_1fr] items-start gap-3 py-2.5 border-b border-slate-100 last:border-0">
      <label className="text-sm text-slate-600 pt-2 text-right pr-2">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <div>{children}</div>
    </div>
  )
}

// Searchable dropdown that also accepts typed values (Supplier picker).
function ComboInput({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: string[]; placeholder: string }) {
  const [open, setOpen] = useState(false)
  const filtered = options.filter(o => o.toLowerCase().includes(value.toLowerCase()) && o !== value)
  return (
    <div className="relative">
      <input className={INP} value={value} placeholder={placeholder} spellCheck={false}
        onFocus={() => setOpen(true)}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && filtered.length > 0 && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-auto scrollbar-dark">
          {filtered.map(o => (
            <button key={o} type="button" className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50"
              onMouseDown={() => { onChange(o); setOpen(false) }}>{o}</button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Excel helpers (template + export share the same teal header styling) ────
const TPL_HEADERS = ["Item Code *", "Name *", "Description", "COG *", "Color", "Size", "Type", "Qty *", "Damage"]
const HEADER_STYLE = {
  fill: { patternType: "solid", fgColor: { rgb: "FF17858C" } },   // teal band like the reference
  font: { bold: true, color: { rgb: "FFFFFFFF" } },
  alignment: { vertical: "center" },
}
function styleHeaderRow(ws: XLSX.WorkSheet, count: number) {
  for (let c = 0; c < count; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c })
    if (ws[addr]) (ws[addr] as any).s = HEADER_STYLE
  }
}

// Template: headers only (teal, bold white; * marks required) — named Add_Product_template.
function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([TPL_HEADERS])
  styleHeaderRow(ws, TPL_HEADERS.length)
  ws["!cols"] = [{ wch: 16 }, { wch: 18 }, { wch: 26 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 8 }, { wch: 10 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Products")
  XLSX.writeFile(wb, "Add_Product_template.xlsx")
}

// Export: same columns/order/colors as the template (+ extra stock columns at the end).
function exportItems(items: ProductItem[], withSupplier: boolean) {
  // ⚠ TINATANGGAL ANG KOLUM, HINDI BINABLANGKO. Ang blangkong "Supplier Store
  // Name" ay nagpapahiwatig pa ring may itinatago, at isang edit lang ang layo
  // sa pagkakamali. Kapag walang pahintulot, wala talagang kolum sa file
  // (hiling ng may-ari, Ago 19 2026: "kahit pag export").
  const headers = ["Item Code", "Name", "Description", "COG", "Color", "Size", "Type", "Qty", "Damage", "Loss",
    ...(withSupplier ? ["Supplier Store Name"] : []), "Status", "Remaining"]
  const rows = [headers, ...items.map(i => [i.sku, i.name, i.description, i.cog, i.color, i.size, i.type, i.goods, i.damage, i.loss,
    ...(withSupplier ? [i.supplier] : []), i.status, itemRemaining(i)])]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  styleHeaderRow(ws, headers.length)
  ws["!cols"] = headers.map(h => ({ wch: Math.max(12, h.length + 2) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Product Items")
  XLSX.writeFile(wb, "Product-Items.xlsx")
}

// Parse an uploaded sheet into item inputs (tolerant header matching).
function parseUpload(data: ArrayBuffer): { items: NewItemInput[]; skipped: number } {
  const wb = XLSX.read(data, { type: "array" })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" })
  const key = (k: string) => k.toLowerCase().replace(/[^a-z]/g, "")
  const items: NewItemInput[] = []
  let skipped = 0
  for (const row of raw) {
    const get = (...names: string[]) => {
      for (const [k, v] of Object.entries(row)) if (names.includes(key(k))) return v
      return ""
    }
    const sku = String(get("itemcode", "skucode", "sku")).trim()
    const name = String(get("name", "itemname")).trim()
    if (!sku && !name) { skipped++; continue }
    items.push({
      sku, name,
      description: String(get("description")).trim(),
      picture: "",
      cog: Number(get("cog", "cost", "unitcost")) || 0,
      color: String(get("color")).trim(),
      size: String(get("size")).trim(),
      type: String(get("type")).trim(),
      goods: Number(get("qty", "quantity", "goods")) || 0,
      damage: Number(get("damage")) || 0,
      loss: Number(get("loss")) || 0,
      supplier: String(get("supplierstorename", "supplier")).trim(),
      status: String(get("status")).trim().toLowerCase() === "inactive" ? "Inactive" : "Active",
    })
  }
  return { items, skipped }
}

const HELP: HelpSection[] = [
  {
    title: "Ano ang Product Item?",
    body: [
      "Ito ang TOTOONG stock sa bodega — isang tumpok kada produkto. Halimbawa: Lumyra, 150 pcs.",
      "ISANG Product Item lang kada produkto, kahit ilan ang presyo o variation nito. Huwag gagawa ng 'Lumyra 30' at 'Lumyra 35' — mahahati ang bilang mo at hindi mo na malalaman ang totoong stock.",
    ],
  },
  {
    title: "Receive Stock — kada may dumating",
    body: [
      "Pindutin ang berdeng buton sa row ng produkto tuwing may bagong dating. Ilagay ang dami, ang COG kada piraso, at ang petsa.",
      "Bawat dating ay sariling BATCH na may sariling presyo. Kaya kung 100 pcs @ ₱35 ang luma at dumating ang 50 @ ₱30, hindi sila naghahalo — magkahiwalay silang layer.",
      "⚠ Huwag i-edit ang Goods nang diretso para magdagdag ng stock. Kapag ginawa mo iyon, may bilang na walang katumbas na presyo — lalabas ang amber na babala at magiging mali ang Total COG Amount.",
    ],
  },
  {
    title: "FIFO — sino ang unang nababawasan",
    body: [
      "Kapag may umalis na parcel, sa PINAKALUMANG batch muna kumukuha. Kaya ang COGS ng bawat labas ay ang presyong TOTOONG binayaran para sa mismong mga pirasong iyon — hindi average.",
      "Halimbawa: 20 pcs ang umalis mula sa 100 @ ₱35 → COGS ₱700. Hindi nadadamay ang bagong ₱30.",
      "Ang Total COG Amount sa ibaba ay mula sa mga batch — kaya tama ito kahit dalawa o tatlo ang presyo ng natitira mong stock.",
    ],
  },
  {
    title: "Remaining — saan ito galing",
    body: [
      "Remaining = Goods − Damage − Loss − Released.",
      "Ang 'Released' ay awtomatikong tumataas kapag may parcel na na-Shipped sa Pancake. Hindi mo ito kailangang i-type.",
    ],
  },
]

const EMPTY_FILTERS = { sku: "", name: "", cog: "", color: "", size: "", type: "", supplier: "", status: "All", goods: "", damage: "", loss: "", remaining: "" }

export default function ProductItemsPage() {
  const store = useProductItems()
  const sup = useSuppliers()
  const [tab, setTab] = useState<"dashboard" | "list">("list")
  const [screen, setScreen] = useState<"list" | "add" | "edit" | "view" | "upload">("list")
  const [view, setView] = useState<"list" | "archived" | "deleted">("list")
  const [active, setActive] = useState<ProductItem | null>(null)
  const [confirmDel, setConfirmDel] = useState<ProductItem | null>(null)      // soft delete
  const [confirmPurge, setConfirmPurge] = useState<ProductItem | null>(null)  // permanent delete (deleted view)
  const batchStore = useProductBatches()
  const [receiving, setReceiving] = useState<ProductItem | null>(null)   // Receive Stock modal
  // Hindi kusang nawawala ang pagkakaiba ng batch at ng bilang — ipinapakita, hindi itinatago.
  const drift = useMemo(() => batchStore.reconcile(store.items.filter(i => !i.deleted)),
    [batchStore, store.items])
  const [toolsOpen, setToolsOpen] = useState(false)
  // ── SINO ANG PWEDENG MAKAKITA NG SUPPLIER ────────────────────────────────
  // ⚠ ADMIN LANG — hatol ng may-ari, Ago 19 2026. Ang dating pagtatago ay isang
  // matang mapipindot ng kahit sino: abala iyon sa may hangad, hindi harang.
  // Kapag hindi Mother Account: walang laman ang kolum, walang toggle, walang
  // field sa porma, walang filter, at WALANG kolum sa export.
  //
  // Minsan lang binabasa (`useState(() => …)`) — nasa localStorage cache ang
  // roster at hindi ito nagbabago habang bukas ang pahina.
  const [canSeeSupplier] = useState(() => isMotherAccount())
  const [showSuppliers, setShowSuppliers] = useState(false)
  const [toast, setToast] = useState("")
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500) }

  const [perPage, setPerPage] = useState(10)
  const [page, setPage] = useState(1)
  const [f, setF] = useState(EMPTY_FILTERS)
  const [applied, setApplied] = useState(EMPTY_FILTERS)
  const setFilter = (k: keyof typeof EMPTY_FILTERS, v: string) => setF(p => ({ ...p, [k]: v }))
  const applyFilters = () => { setApplied(f); setPage(1) }

  const inc = (v: string, q: string) => !q || v.toLowerCase().includes(q.toLowerCase())
  // Numeric columns: match against the raw value (commas in the query are ignored).
  const incNum = (v: number, q: string) => { const qq = q.replace(/,/g, "").trim(); return !qq || String(v).includes(qq) }
  const filtered = useMemo(() => store.items.filter(i => {
    if (view === "deleted") { if (!i.deleted) return false }
    else if (i.deleted) return false
    else if (!!i.archived !== (view === "archived")) return false
    return inc(i.sku, applied.sku) && inc(i.name, applied.name) && inc(i.color, applied.color)
      && inc(i.size, applied.size) && inc(i.type, applied.type) && inc(i.supplier, applied.supplier)
      && incNum(i.cog, applied.cog) && incNum(i.goods, applied.goods) && incNum(i.damage, applied.damage)
      && incNum(i.loss, applied.loss) && incNum(itemRemaining(i), applied.remaining)
      && (applied.status === "All" || i.status === applied.status)
  }), [store.items, view, applied])

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage))
  const pageSafe = Math.min(page, totalPages)
  const paginated = filtered.slice((pageSafe - 1) * perPage, pageSafe * perPage)
  const showFrom = filtered.length === 0 ? 0 : (pageSafe - 1) * perPage + 1
  const showTo = Math.min(pageSafe * perPage, filtered.length)

  const supplierOptions = useMemo(() => Array.from(new Set(sup.suppliers.filter(s => !s.archived).map(s => s.store_name || s.name).filter(Boolean))).sort(), [sup.suppliers])

  const toastEl = toast ? (
    <div className="fixed top-4 right-4 z-[70] bg-emerald-600 text-white text-sm rounded-xl px-5 py-3 shadow-lg flex items-center gap-2">
      <Check className="w-4 h-4" /> <div><p className="font-semibold">Success</p><p className="text-emerald-100">{toast}</p></div>
    </div>
  ) : null

  if (screen === "add" || (screen === "edit" && active))
    return <>{toastEl}<FormScreen mode={screen === "edit" ? "edit" : "add"} initial={screen === "edit" ? active! : undefined} canSee={canSeeSupplier}
      supplierOptions={supplierOptions}
      onBack={() => setScreen("list")}
      onSave={(input) => {
        if (screen === "edit" && active) { store.updateItem(active.id, input); flash("Item updated successfully") }
        else { store.addItem(input); flash("Item added successfully") }
        setScreen("list")
      }} /></>

  if (screen === "view" && active)
    return <>{toastEl}<ViewScreen item={store.items.find(i => i.id === active.id) || active} onBack={() => setScreen("list")} onEdit={() => setScreen("edit")} canSee={canSeeSupplier} /></>

  if (screen === "upload")
    return <>{toastEl}<UploadScreen onBack={() => setScreen("list")}
      onUpload={(items, skipped) => {
        if (items.length) store.addMany(items)
        flash(`${items.length} item${items.length === 1 ? "" : "s"} uploaded${skipped ? ` · ${skipped} skipped` : ""}.`)
        setScreen("list")
      }} /></>

  return (
    <div className="space-y-4 relative">
      {toastEl}

      {/* Header — Tools ▾ (Add New / Upload / Export / Deleted) · Archives toggle */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-4 mb-1 border-b border-slate-100">
        <div>
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Tag className="w-5 h-5" /> PRODUCT ITEMS
            {view === "archived" && <span className="text-sm font-semibold text-amber-600">· ARCHIVES</span>}
            {view === "deleted" && <span className="text-sm font-semibold text-rose-600">· DELETED ITEMS</span>}
            <HelpButton title="Paano gumagana ang Product Items" sections={HELP} />
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">{filtered.length} record{filtered.length === 1 ? "" : "s"}</p>
        </div>
        {tab === "list" && (
        <div className="flex items-center gap-2">
          {canSeeSupplier && <ConfidentialToggle shown={showSuppliers} onToggle={() => setShowSuppliers(v => !v)} label="suppliers" />}
          <div className="relative">
            <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => setToolsOpen(o => !o)}><Wrench className="w-4 h-4" /> Tools</Button>
            {toolsOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setToolsOpen(false)} />
                <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-30 w-56 py-1">
                  <button onClick={() => { setToolsOpen(false); setActive(null); setScreen("add") }}
                    className="w-full flex items-center gap-2 text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"><Plus className="w-4 h-4" /> Add New</button>
                  <button onClick={() => { setToolsOpen(false); setScreen("upload") }}
                    className="w-full flex items-center gap-2 text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"><Upload className="w-4 h-4" /> Upload Item</button>
                  <button onClick={() => { setToolsOpen(false); exportItems(filtered, canSeeSupplier); flash(canSeeSupplier ? "Exported to Excel." : "Exported to Excel — supplier column omitted.") }}
                    className="w-full flex items-center gap-2 text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"><FileSpreadsheet className="w-4 h-4" /> Export to Excel</button>
                  <button onClick={() => { setToolsOpen(false); setView(v => v === "deleted" ? "list" : "deleted"); setPage(1) }}
                    className="w-full flex items-center gap-2 text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                    <Search className="w-4 h-4" /> {view === "deleted" ? "Back to Product Items" : "View All Deleted Items"}</button>
                </div>
              </>
            )}
          </div>
          {view !== "deleted" && (
            <Button className="bg-teal-500 hover:bg-teal-600 text-white" onClick={() => { setView(v => v === "archived" ? "list" : "archived"); setPage(1) }}>
              {view === "archived" ? <><List className="w-4 h-4" /> List</> : <><FolderOpen className="w-4 h-4" /> Archives</>}
            </Button>
          )}
        </div>
        )}
      </div>

      {/* Tabs — Inventory Dashboard | Product List */}
      <div className="flex items-center gap-1">
        <button onClick={() => setTab("dashboard")}
          className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 ${tab === "dashboard" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100 border border-slate-200"}`}>
          <LayoutDashboard className="w-4 h-4" /> Inventory Dashboard
        </button>
        <button onClick={() => setTab("list")}
          className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 ${tab === "list" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100 border border-slate-200"}`}>
          <List className="w-4 h-4" /> Product List
        </button>
      </div>

      {tab === "dashboard" && <InventoryDashboard items={store.items} />}

      {tab === "list" && (<>
      {/* Records selector */}
      <label className="flex items-center gap-2 text-sm text-slate-500">
        <select className="h-9 rounded-lg border border-slate-300 px-3 text-sm bg-white" value={perPage} onChange={e => { setPerPage(parseInt(e.target.value)); setPage(1) }}>
          {[10, 30, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        records
      </label>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto scrollbar-dark">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left bg-slate-50">
                {["NO.", "SKU CODE", "NAME", "COG", "COLOR", "SIZE", "TYPE", "STATUS", "GOODS", "DAMAGE", "LOSS", "REMAINING", "SUPPLIER STORE NAME", "ACTIONS"].map(h => (
                  <th key={h} className="px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
              {/* Filter row — applies on Search */}
              <tr className="border-b border-slate-200 bg-white">
                <th className="px-4 py-2" />
                <th className="px-4 py-2"><input className={FINP} value={f.sku} onChange={e => setFilter("sku", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} /></th>
                <th className="px-4 py-2"><input className={FINP} value={f.name} onChange={e => setFilter("name", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} /></th>
                <th className="px-4 py-2"><input className={FINP} value={f.cog} onChange={e => setFilter("cog", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} /></th>
                <th className="px-4 py-2"><input className={FINP} value={f.color} onChange={e => setFilter("color", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} /></th>
                <th className="px-4 py-2"><input className={FINP} value={f.size} onChange={e => setFilter("size", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} /></th>
                <th className="px-4 py-2"><input className={FINP} value={f.type} onChange={e => setFilter("type", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} /></th>
                <th className="px-4 py-2">
                  <select className={FINP} value={f.status} onChange={e => setFilter("status", e.target.value)}>
                    <option value="All">All</option>
                    {ITEM_STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </th>
                <th className="px-4 py-2"><input className={FINP} value={f.goods} onChange={e => setFilter("goods", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} /></th>
                <th className="px-4 py-2"><input className={FINP} value={f.damage} onChange={e => setFilter("damage", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} /></th>
                <th className="px-4 py-2"><input className={FINP} value={f.loss} onChange={e => setFilter("loss", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} /></th>
                <th className="px-4 py-2"><input className={FINP} value={f.remaining} onChange={e => setFilter("remaining", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} /></th>
                <th className="px-4 py-2">{canSeeSupplier && <input className={FINP} value={f.supplier} onChange={e => setFilter("supplier", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} />}</th>
                <th className="px-4 py-2">
                  <Button className="h-8 px-3 bg-blue-600 hover:bg-blue-700 text-white text-xs" onClick={applyFilters}><Search className="w-3.5 h-3.5" /> Search</Button>
                </th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr><td colSpan={14} className="text-center py-12 text-slate-400 text-sm">
                  {view === "deleted" ? "No deleted items." : view === "archived" ? "No archived items."
                    : store.items.length === 0 ? <>No product items yet. Click <strong>Tools → Add New</strong> to add one.</> : "No items match the filters."}
                </td></tr>
              ) : paginated.map((i, idx) => (
                <tr key={i.id} className={`border-b border-slate-100 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50"} hover:bg-blue-50/40`}>
                  <td className="px-4 py-3 text-slate-400">{showFrom + idx}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600 whitespace-nowrap">{i.sku || "—"}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800">{i.name || "—"}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-700 whitespace-nowrap">{fmtNum(i.cog)}</td>
                  <td className="px-4 py-3 text-slate-600">{i.color || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{i.size || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{i.type || "—"}</td>
                  <td className="px-4 py-3"><span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${i.status === "Active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{i.status}</span></td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">{fmtNum(i.goods)}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">{fmtNum(i.damage)}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">{fmtNum(i.loss)}</td>
                  <td className={`px-4 py-3 tabular-nums font-semibold ${itemRemaining(i) <= 0 ? "text-rose-600" : "text-slate-800"}`}>{fmtNum(itemRemaining(i))}</td>
                  {/* Kompidensyal — nakatago hangga't hindi pinipindot ang mata. */}
                  <td className="px-4 py-3 max-w-[180px]"><Confidential value={canSeeSupplier ? i.supplier : ""} forceShow={showSuppliers} locked={!canSeeSupplier} className="text-slate-600" /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 text-slate-400">
                      {view === "deleted" ? (
                        <>
                          <button onClick={() => { store.restoreItem(i.id); flash("Item restored.") }} className="hover:text-emerald-600" title="Restore"><RotateCcw className="w-4 h-4" /></button>
                          <button onClick={() => setConfirmPurge(i)} className="hover:text-rose-600" title="Delete permanently"><Trash2 className="w-4 h-4" /></button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => setReceiving(i)} className="hover:text-emerald-600" title="Receive Stock (bagong dating, sariling COG)"><PackagePlus className="w-4 h-4" /></button>
                          <button onClick={() => { setActive(i); setScreen("view") }} className="hover:text-blue-600" title="View"><Search className="w-4 h-4" /></button>
                          <button onClick={() => { setActive(i); setScreen("edit") }} className="hover:text-teal-600" title="Edit"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => setConfirmDel(i)} className="hover:text-rose-600" title="Delete"><X className="w-4 h-4" /></button>
                          <button onClick={() => { store.setArchived(i.id, !i.archived); flash(i.archived ? "Item restored to list." : "Item archived.") }} className="hover:text-amber-600" title={i.archived ? "Restore" : "Archive"}>
                            {i.archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Footer — entries + totals (remaining qty & COG value of remaining stock) + pagination */}
        <div className="px-4 py-3 border-t border-slate-100 flex items-start justify-between flex-wrap gap-2">
          <div className="space-y-1">
            <p className="text-sm text-slate-500">Showing {showFrom} to {showTo} of {filtered.length} entr{filtered.length === 1 ? "y" : "ies"}</p>
            <p className="text-sm"><strong className="text-slate-800">Total Remaining Qty</strong> <span className="text-slate-500">: {fmtNum(filtered.reduce((s, i) => s + itemRemaining(i), 0))}</span></p>
            {/* Halaga mula sa BATCH — bawat layer sa sariling presyo. Ang qty × isang COG
                ay mali kapag may dalawang presyo ang natitirang stock. */}
            <p className="text-sm"><strong className="text-slate-800">Total COG Amount</strong> <span className="text-slate-500">: {fmtNum(filtered.reduce((s, i) => s + valueOf(batchStore.byItem(i.id)).value, 0))}</span></p>
          </div>
          <div className="flex items-center gap-1">
            <button disabled={pageSafe <= 1} onClick={() => setPage(p => p - 1)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
            <span className="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-600 text-white text-sm font-medium">{pageSafe}</span>
            <button disabled={pageSafe >= totalPages} onClick={() => setPage(p => p + 1)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      </div>
      </>)}

      {/* Naghiwalay ba ang batch sa bilang ng Product Item? Sinasabi agad — ang
          tahimik na pagkakaiba ay nangangahulugan ng maling halaga ng inventory. */}
      {batchStore.loaded && drift.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 flex items-start gap-2.5">
          <Settings className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="text-sm font-bold text-amber-800">
              {drift.length} item{drift.length === 1 ? "" : "s"} — hindi tugma ang batch sa bilang
            </p>
            <p className="text-xs text-amber-700">
              Nagkakaiba ang kabuuan ng mga batch at ang Goods/Remaining. Mali ang Total COG Amount hangga't
              hindi naaayos: {drift.slice(0, 3).map(d => {
                const it = store.items.find(i => i.id === d.item_id)
                return `${it?.name || d.item_id} (batch ${fmtNum(d.batchQty)} vs goods ${fmtNum(d.goods)})`
              }).join(" · ")}{drift.length > 3 ? ` · +${drift.length - 3} pa` : ""}.
              Ayusin sa pamamagitan ng Receive Stock o pag-edit ng batch.
            </p>
          </div>
        </div>
      )}

      {/* Receive Stock — bagong batch + kasabay na pagtaas ng Goods, para laging
          magkasundo ang bilang sa Product Item at ang kabuuan ng mga batch. */}
      {receiving && (
        <ReceiveStockModal
          item={receiving}
          batches={batchStore.byItem(receiving.id)}
          supplierOptions={supplierOptions}
          canSee={canSeeSupplier}
          onClose={() => setReceiving(null)}
          onSave={input => {
            batchStore.addBatch({ item_id: receiving.id, ...input })
            store.updateItem(receiving.id, { goods: (receiving.goods || 0) + input.qty })
            flash(`Received ${fmtNum(input.qty)} pcs @ ₱${fmtNum(input.cog)} — bagong batch para sa ${receiving.name || receiving.sku}.`)
            setReceiving(null)
          }} />
      )}

      {/* Soft-delete confirmation */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setConfirmDel(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[420px] p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-800">Delete item?</h2>
            <p className="text-sm text-slate-600"><strong>{confirmDel.name || confirmDel.sku}</strong> will move to <strong>Deleted Items</strong> (Tools → View All Deleted Items) — you can restore it from there.</p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setConfirmDel(null)}>Cancel</Button>
              <Button className="bg-rose-600 hover:bg-rose-700 text-white" onClick={() => { store.softDelete(confirmDel.id); flash("Item deleted — recoverable in Deleted Items."); setConfirmDel(null) }}>Delete</Button>
            </div>
          </div>
        </div>
      )}

      {/* Permanent-delete confirmation (deleted view) */}
      {confirmPurge && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setConfirmPurge(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[420px] p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-800">Delete permanently?</h2>
            <p className="text-sm text-slate-600">This permanently removes <strong>{confirmPurge.name || confirmPurge.sku}</strong>. This cannot be undone.</p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setConfirmPurge(null)}>Cancel</Button>
              <Button className="bg-rose-600 hover:bg-rose-700 text-white" onClick={() => { store.hardDelete(confirmPurge.id); flash("Item permanently deleted."); setConfirmPurge(null) }}>Delete Permanently</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Receive Stock ────────────────────────────────────────────────────────────
// Bawat dating ay sariling batch na may sariling COG. Dito nagsisimula ang FIFO:
// ang bawas mamaya ay kukuha sa pinakalumang batch, kaya ang COGS ng isang labas
// ay ang presyong TOTOONG binayaran para sa mga pirasong iyon — hindi average.
//
// ⚠ Nasa module scope ito. Kapag inilagay sa loob ng page component, mare-remount
// ang mga input kada keystroke at mawawala ang focus (naranasan na sa Add User).
function ReceiveStockModal({ item, batches, supplierOptions, canSee, onClose, onSave }: {
  item: ProductItem
  batches: ProductBatch[]
  /** Mga supplier na naka-rehistro — ang pipiliin, hindi ang ita-type. */
  supplierOptions: string[]
  /** Walang pahintulot? Walang field — pero hindi nawawala ang naka-imbak na. */
  canSee: boolean
  onClose: () => void
  onSave: (input: { qty: number; cog: number; received_date: string; batch_no: string; supplier: string; notes: string }) => void
}) {
  const todayStr = new Date().toISOString().slice(0, 10)
  const [qty, setQty] = useState("")
  const [cog, setCog] = useState(item.cog ? String(item.cog) : "")
  const [date, setDate] = useState(todayStr)
  const [batchNo, setBatchNo] = useState("")
  const [supplier, setSupplier] = useState(item.supplier || "")
  const [notes, setNotes] = useState("")
  const [err, setErr] = useState("")

  const qtyN = Number(qty) || 0
  const cogN = Number(cog) || 0
  const existing = fifoOrder(batches).filter(b => batchRemaining(b) > 0)

  function submit() {
    if (qtyN <= 0) return setErr("Ilagay ang dami ng dumating.")
    if (cogN <= 0) return setErr("Ilagay ang COG kada piraso para sa batch na ito.")
    if (!date) return setErr("Ilagay ang petsa ng dating — ito ang pagkakasunod-sunod ng FIFO.")
    onSave({ qty: qtyN, cog: cogN, received_date: date, batch_no: batchNo.trim(), supplier: supplier.trim(), notes: notes.trim() })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2"><PackagePlus className="w-5 h-5 text-emerald-600" /> Receive Stock</h2>
          <p className="text-xs text-slate-400 mt-0.5">{item.name || item.sku}</p>
        </div>

        <div className="px-6 py-4 space-y-3 overflow-auto">
          {err && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{err}</div>}

          {existing.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Mga batch na may natitira</p>
              {existing.map(b => (
                <p key={b.id} className="text-xs text-slate-600 flex justify-between tabular-nums">
                  <span>{b.received_date} · {b.batch_no || "—"}</span>
                  <span>{fmtNum(batchRemaining(b))} pcs @ ₱{fmtNum(b.cog)}</span>
                </p>
              ))}
              <p className="text-[11px] text-slate-400 mt-1">Dito muna kukuha ang bawas bago mapunta sa bagong batch.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-slate-600">Dami <span className="text-red-500">*</span></label>
              <Input className="mt-1" type="number" value={qty} placeholder="Ilan ang dumating" onChange={e => { setQty(e.target.value); setErr("") }} />
            </div>
            <div>
              <label className="text-sm text-slate-600">COG kada piraso <span className="text-red-500">*</span></label>
              <Input className="mt-1" type="number" value={cog} placeholder="Presyo sa batch na ito" onChange={e => { setCog(e.target.value); setErr("") }} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-slate-600">Petsa ng dating <span className="text-red-500">*</span></label>
              <Input className="mt-1" type="date" value={date} onChange={e => { setDate(e.target.value); setErr("") }} />
            </div>
            <div>
              <label className="text-sm text-slate-600">Batch / Ref No.</label>
              <Input className="mt-1" value={batchNo} placeholder="Opsyonal (hal. PO-12)" onChange={e => setBatchNo(e.target.value)} />
            </div>
          </div>

          {/* SUPPLIER — pinipili, hindi tina-type. Ang malayang teksto ay
              gumagawa ng "MBF Skincare", "MBF skincare" at "MBF  Skincare"
              bilang tatlong magkaibang supplier, at hindi na sila magkakasundo
              sa Purchase Order at sa mga ulat. Ang listahan ay galing sa
              Supplier page — doon idinadagdag ang bago.
              Walang pahintulot? Walang field — pero hindi rin nabubura ang
              naka-imbak na supplier ng item (dala pa rin ng `supplier` state). */}
          {canSee && (
            <div>
              <label className="text-sm text-slate-600">Supplier</label>
              <select className={`${INP} mt-1`} value={supplier} onChange={e => setSupplier(e.target.value)}>
                <option value="">-- SELECT SUPPLIER --</option>
                {/* Kung ang naka-imbak ay wala na sa listahan (na-archive o
                    binago ang pangalan), ipinapakita pa rin — kung hindi, tahimik
                    itong mapapalitan ng blangko sa susunod na pag-save. */}
                {!!supplier && !supplierOptions.includes(supplier) && (
                  <option value={supplier}>{supplier} (wala na sa listahan)</option>
                )}
                {supplierOptions.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-sm text-slate-600">Notes</label>
            <Input className="mt-1" value={notes} placeholder="Opsyonal" onChange={e => setNotes(e.target.value)} />
          </div>

          {qtyN > 0 && cogN > 0 && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              Idadagdag: <strong>{fmtNum(qtyN)} pcs @ ₱{fmtNum(cogN)}</strong> = <strong>₱{fmtNum(qtyN * cogN)}</strong>.
              Tataas ang Goods mula {fmtNum(item.goods)} papuntang <strong>{fmtNum(item.goods + qtyN)}</strong>.
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex gap-2">
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={submit}>Receive Stock</Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}

// ── Add / Edit ───────────────────────────────────────────────────────────────
// ── Upload Products screen (Template link · Select file · Upload / Back) ────
function UploadScreen({ onBack, onUpload }: { onBack: () => void; onUpload: (items: NewItemInput[], skipped: number) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)

  function doUpload() {
    if (!file) return setErr("Upload Excel File is required.")
    setErr(""); setUploading(true)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const { items, skipped } = parseUpload(reader.result as ArrayBuffer)
        if (items.length === 0) { setErr("No items found — fill the template rows first."); setUploading(false); return }
        onUpload(items, skipped)
      } catch { setErr("Couldn't read that file — use the downloaded template format.") }
      setUploading(false)
    }
    reader.readAsArrayBuffer(file)
  }

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft className="w-4 h-4" /> Back to Product Items</button>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-3xl">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 pb-4 mb-4 border-b border-slate-100"><Settings className="w-5 h-5" /> UPLOAD PRODUCTS</h1>
        <div className="space-y-5">
          <div className="grid grid-cols-[170px_1fr] items-center gap-3">
            <span className="text-sm text-slate-600 text-right pr-2">Template</span>
            <button onClick={downloadTemplate} className="text-sm text-blue-600 hover:underline text-left w-fit">Click to Download Sample File</button>
          </div>
          <div className="grid grid-cols-[170px_1fr] items-center gap-3">
            <span className="text-sm text-slate-600 text-right pr-2">Upload Excel File <span className="text-red-500">*</span></span>
            <div className="flex items-center gap-2">
              <div className="flex-1 max-w-md h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white flex items-center text-slate-500 truncate">
                {file ? file.name : ""}
              </div>
              <label className="h-10 px-3.5 rounded-lg border border-slate-300 bg-slate-100 hover:bg-slate-200 text-sm text-slate-700 cursor-pointer flex items-center">
                Select file
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                  onChange={e => { setFile(e.target.files?.[0] || null); setErr("") }} />
              </label>
            </div>
          </div>
        </div>
        {err && <p className="text-sm text-rose-600 mt-4">{err}</p>}
        <div className="flex gap-2 mt-6 pt-4 border-t border-slate-100">
          <Button className="bg-blue-600 hover:bg-blue-700 text-white" disabled={uploading} onClick={doUpload}>{uploading ? "Uploading…" : "Upload"}</Button>
          <Button variant="outline" onClick={onBack}>Back</Button>
        </div>
      </div>
    </div>
  )
}

// Downscale an image file to a small data URL (same approach as Product Testing).
function fileToDataUrl(file: File, maxPx = 240): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
        const canvas = document.createElement("canvas")
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL("image/jpeg", 0.8))
      }
      img.onerror = reject
      img.src = reader.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function FormScreen({ mode, initial, supplierOptions, canSee, onBack, onSave }: {
  mode: "add" | "edit"; initial?: ProductItem; supplierOptions: string[]; canSee: boolean
  onBack: () => void; onSave: (input: NewItemInput) => void
}) {
  const [f, setF] = useState<NewItemInput>({
    sku: initial?.sku || "", name: initial?.name || "", description: initial?.description || "", picture: initial?.picture || "",
    cog: initial?.cog || 0, color: initial?.color || "", size: initial?.size || "", type: initial?.type || "",
    supplier: initial?.supplier || "", goods: initial?.goods || 0, damage: initial?.damage || 0, loss: initial?.loss || 0,
    status: initial?.status || "Active",
  })
  const [err, setErr] = useState("")
  const [picName, setPicName] = useState("")
  const set = (k: keyof NewItemInput, v: any) => setF(p => ({ ...p, [k]: v }))
  const num = (v: string) => Number(v.replace(/[^\d.]/g, "")) || 0

  async function pickPicture(file: File) {
    try { set("picture", await fileToDataUrl(file)); setPicName(file.name) }
    catch { setErr("Couldn't read that image.") }
  }

  function submit() {
    if (!f.name.trim()) return setErr("Name is required.")
    if (!f.sku.trim()) return setErr("SKU Code is required.")
    setErr("")
    onSave({ ...f, sku: f.sku.trim(), name: f.name.trim(), description: f.description.trim(), color: f.color.trim(), size: f.size.trim(), type: f.type.trim(), supplier: f.supplier.trim() })
  }

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft className="w-4 h-4" /> Back to Product Items</button>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-3xl">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 pb-4 mb-2 border-b border-slate-100"><Settings className="w-5 h-5" /> {mode === "add" ? "ADD ITEM" : "EDIT ITEM"}</h1>
        <div className="space-y-0.5">
          <FormRow label="Name" required><Input className={INP} value={f.name} onChange={e => set("name", e.target.value)} /></FormRow>
          <FormRow label="SKU Code" required><Input className={INP} value={f.sku} onChange={e => set("sku", e.target.value)} placeholder="e.g. PHONE-001" /></FormRow>
          <FormRow label="Description"><textarea className={`${INP} h-24 py-2 resize-y`} value={f.description} onChange={e => set("description", e.target.value)} /></FormRow>
          <FormRow label="Cost of Goods (COG)"><input className={`${INP} max-w-sm text-right`} inputMode="decimal" value={f.cog || ""} placeholder="0.00" onChange={e => set("cog", num(e.target.value))} /></FormRow>
          <FormRow label="Color"><Input className={`${INP} max-w-sm`} value={f.color} onChange={e => set("color", e.target.value)} /></FormRow>
          <FormRow label="Size"><Input className={`${INP} max-w-sm`} value={f.size} onChange={e => set("size", e.target.value)} /></FormRow>
          <FormRow label="Type"><Input className={`${INP} max-w-sm`} value={f.type} onChange={e => set("type", e.target.value)} /></FormRow>
          <FormRow label="Quantity"><input className={`${INP} max-w-sm text-right`} inputMode="decimal" value={f.goods || ""} placeholder="0" onChange={e => set("goods", num(e.target.value))} /></FormRow>
          {mode === "edit" && (
            <>
              <FormRow label="Damage"><input className={`${INP} max-w-sm text-right`} inputMode="decimal" value={f.damage || ""} placeholder="0" onChange={e => set("damage", num(e.target.value))} /></FormRow>
              <FormRow label="Loss"><input className={`${INP} max-w-sm text-right`} inputMode="decimal" value={f.loss || ""} placeholder="0" onChange={e => set("loss", num(e.target.value))} /></FormRow>
            </>
          )}
          {canSee && <FormRow label="Supplier Store Name"><ComboInput value={f.supplier} onChange={v => set("supplier", v)} options={supplierOptions} placeholder="-- SELECT SUPPLIER --" /></FormRow>}
          <FormRow label="Upload Item Picture">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 h-10 px-3.5 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-sm text-slate-600 cursor-pointer">
                <Upload className="w-4 h-4" /> Select file
                <input type="file" accept="image/*" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) pickPicture(file) }} />
              </label>
              {f.picture
                ? <span className="flex items-center gap-2"><img src={f.picture} alt="" className="w-10 h-10 rounded object-cover border border-slate-200" /><span className="text-xs text-slate-500">{picName || "current picture"}</span>
                    <button type="button" onClick={() => { set("picture", ""); setPicName("") }} className="text-xs text-rose-500 hover:underline">Remove</button></span>
                : <span className="text-xs text-slate-400">No file selected</span>}
            </div>
          </FormRow>
          <FormRow label="">
            <label className="flex items-center gap-2 pt-1 cursor-pointer select-none text-sm text-slate-600">
              <input type="checkbox" checked={f.status === "Active"} onChange={e => set("status", e.target.checked ? "Active" : "Inactive")} className="w-4 h-4 rounded border-slate-300 accent-blue-600" />
              Is Active?
            </label>
          </FormRow>
        </div>
        {err && <p className="text-sm text-rose-600 mt-3">{err}</p>}
        <div className="flex gap-2 mt-5 pt-4 border-t border-slate-100">
          <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={submit}>Submit</Button>
          <Button variant="outline" onClick={onBack}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}

// ── View ─────────────────────────────────────────────────────────────────────
function ViewScreen({ item, onBack, onEdit, canSee }: { item: ProductItem; onBack: () => void; onEdit: () => void; canSee: boolean }) {
  const F = ({ l, v }: { l: string; v: React.ReactNode }) => (
    <div className="grid grid-cols-[170px_1fr] gap-3 py-2.5 border-b border-slate-100">
      <span className="text-sm text-slate-500 text-right pr-2">{l}</span><span className="text-sm text-slate-800">{v || "—"}</span>
    </div>
  )
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft className="w-4 h-4" /> Back to Product Items</button>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-3xl">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 mb-4"><Tag className="w-5 h-5" /> VIEW PRODUCT ITEM</h1>
        {item.picture && <div className="mb-3"><img src={item.picture} alt={item.name} className="w-28 h-28 rounded-xl object-cover border border-slate-200" /></div>}
        <F l="Name" v={item.name} /><F l="SKU Code" v={item.sku} />
        <F l="Description" v={item.description} /><F l="COG" v={fmtNum(item.cog)} />
        <F l="Color" v={item.color} /><F l="Size" v={item.size} /><F l="Type" v={item.type} />
        <F l="Supplier Store Name" v={<Confidential value={canSee ? item.supplier : ""} locked={!canSee} className="text-slate-800" />} />
        <F l="Goods" v={fmtNum(item.goods)} /><F l="Damage" v={fmtNum(item.damage)} /><F l="Loss" v={fmtNum(item.loss)} />
        <F l="Remaining" v={<strong className={itemRemaining(item) <= 0 ? "text-rose-600" : ""}>{fmtNum(itemRemaining(item))}</strong>} />
        <F l="Status" v={<span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${item.status === "Active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{item.status}</span>} />
        <div className="flex gap-2 mt-4">
          <Button className="bg-teal-500 hover:bg-teal-600 text-white" onClick={onEdit}><Pencil className="w-3.5 h-3.5" /> Edit</Button>
          <Button variant="outline" onClick={onBack}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}
