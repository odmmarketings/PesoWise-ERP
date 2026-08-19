"use client"
import { useMemo, useState, useEffect, useRef } from "react"
import JsBarcode from "jsbarcode"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import * as XLSX from "xlsx-js-style"
import {
  Tag, Plus, Search, Pencil, ChevronLeft, ChevronRight, Check, Settings, Archive, ArchiveRestore,
  FolderOpen, List, Wrench, Upload, FileSpreadsheet, FileText, Copy, Trash2, Info, X, Flag,
} from "lucide-react"
import { useUnitCodes, nextUnitSKU, type UnitCode, type UnitCodeItem, type NewUnitCodeInput } from "@/lib/unit-codes-store"
import { useProductItems, itemRemaining } from "@/lib/product-items-store"
import { useActivePages } from "@/lib/pages-store"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import { HelpButton, type HelpSection } from "@/components/business/HelpButton"

const INP = "w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white focus:outline-none focus:border-blue-400"
const FINP = "w-full h-8 rounded-lg border border-slate-200 px-2 text-xs bg-white focus:outline-none focus:border-blue-400"
const fmtNum = (n: number) => n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDT = (iso: string) => { try { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}` } catch { return iso } }

function FormRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[190px_1fr] items-start gap-3 py-2.5 border-b border-slate-100 last:border-0">
      <label className="text-sm text-slate-600 pt-2 text-right pr-2">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <div>{children}</div>
    </div>
  )
}

// Searchable dropdown that also accepts typed values (Item picker).
// `labels` = optional display text per option value (e.g. "SKU - Name") — the STORED value
// stays the plain option (item name), so COG/Remaining lookups and the Pancake push keep working.
function ComboInput({ value, onChange, options, placeholder, labels }: {
  value: string; onChange: (v: string) => void; options: string[]; placeholder: string; labels?: Record<string, string>
}) {
  const [open, setOpen] = useState(false)
  const [typing, setTyping] = useState<string | null>(null)   // free text while the user searches
  const labelOf = (o: string) => labels?.[o] || o
  const q = (typing ?? "").toLowerCase()
  const filtered = options.filter(o => (typing === null || labelOf(o).toLowerCase().includes(q) || o.toLowerCase().includes(q)) && o !== value)
  return (
    <div className="relative">
      <input className={INP} value={typing ?? (value ? labelOf(value) : "")} placeholder={placeholder} spellCheck={false}
        onFocus={() => setOpen(true)}
        onChange={e => { setTyping(e.target.value); onChange(e.target.value); setOpen(true) }}
        onBlur={() => setTimeout(() => { setOpen(false); setTyping(null) }, 150)} />
      {open && filtered.length > 0 && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-auto scrollbar-dark">
          {filtered.map(o => (
            <button key={o} type="button" className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50"
              onMouseDown={() => { onChange(o); setTyping(null); setOpen(false) }}>{labelOf(o)}</button>
          ))}
        </div>
      )}
    </div>
  )
}

// Tag-style multi-select for "Pages with Pancake API Key" (chips with ×, dropdown of
// CONNECTED pages only — like the reference).
function PageTagSelect({ options, selected, onChange }: { options: string[]; selected: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const remaining = options.filter(o => !selected.includes(o))
  return (
    <div className="relative">
      <div onClick={() => setOpen(true)} className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 flex flex-wrap gap-1.5 items-center cursor-text">
        {selected.map(s => (
          <span key={s} className="flex items-center gap-1 bg-slate-50 border border-slate-300 text-slate-700 text-xs font-semibold px-2 py-1 rounded">
            <button type="button" onClick={e => { e.stopPropagation(); onChange(selected.filter(x => x !== s)) }} className="text-slate-400 hover:text-rose-500 font-normal">×</button>
            {s}
          </span>
        ))}
        {selected.length === 0 && <span className="text-sm text-slate-400 px-1">Select pages…</span>}
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-44 overflow-auto scrollbar-dark">
            {remaining.length === 0
              ? <p className="px-3 py-2 text-xs text-slate-400">{options.length === 0 ? "No connected pages — add API keys in Pages & Store." : "All connected pages selected."}</p>
              : remaining.map(o => (
                <button key={o} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                  onMouseDown={() => { onChange([...selected, o]); setOpen(false) }}>{o}</button>
              ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Excel / PDF exports (teal headers, same style family as Product Items) ──
const HEADER_STYLE = {
  fill: { patternType: "solid", fgColor: { rgb: "FF17858C" } },
  font: { bold: true, color: { rgb: "FFFFFFFF" } },
  alignment: { vertical: "center" },
}
function styleHeaderRow(ws: XLSX.WorkSheet, count: number) {
  for (let c = 0; c < count; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c })
    if (ws[addr]) (ws[addr] as any).s = HEADER_STYLE
  }
}

const TPL_HEADERS = ["SKU", "Code *", "Items *", "Selling Price", "Pages"]
function downloadTemplate() {
  const rows = [TPL_HEADERS, ["UC-1", "ABC-123", "Songbird Charm, Soul Mirror", 400, ""]]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  styleHeaderRow(ws, TPL_HEADERS.length)
  ws["!cols"] = [{ wch: 16 }, { wch: 16 }, { wch: 34 }, { wch: 14 }, { wch: 26 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Unit Codes")
  XLSX.writeFile(wb, "Add_UnitCodes_template.xlsx")
}

function parseUpload(data: ArrayBuffer): { codes: NewUnitCodeInput[]; skipped: number } {
  const wb = XLSX.read(data, { type: "array" })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" })
  const key = (k: string) => k.toLowerCase().replace(/[^a-z]/g, "")
  const codes: NewUnitCodeInput[] = []
  let skipped = 0
  for (const row of raw) {
    const get = (...names: string[]) => {
      for (const [k, v] of Object.entries(row)) if (names.includes(key(k))) return v
      return ""
    }
    const code = String(get("code", "unitcode")).trim()
    if (!code) { skipped++; continue }
    codes.push({
      sku: String(get("sku", "skucode")).trim(),
      code,
      items: String(get("items", "item")).split(",").map(s => s.trim()).filter(Boolean).map(name => ({ name, qty: 1 })),
      selling_price: Number(get("sellingprice", "totalamount", "amount")) || 0,
      upsell: false,
      pages: String(get("pages", "page")).split(",").map(s => s.trim()).filter(Boolean),
    })
  }
  return { codes, skipped }
}

type CodeRow = UnitCode & { remaining: number; itemsLabel: string; totalCog: number }

function exportExcel(rows: CodeRow[]) {
  const headers = ["Date Created", "SKU", "Code", "Items", "Remaining", "Total Amount"]
  const data = [headers, ...rows.map(c => [fmtDT(c.created_at), c.sku, c.code, c.itemsLabel, c.remaining, c.totalCog])]
  const ws = XLSX.utils.aoa_to_sheet(data)
  styleHeaderRow(ws, headers.length)
  ws["!cols"] = [{ wch: 20 }, { wch: 14 }, { wch: 18 }, { wch: 40 }, { wch: 12 }, { wch: 14 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Unit Codes")
  XLSX.writeFile(wb, "Unit-Codes.xlsx")
}

// Export PDF: printable window (Save as PDF in the print dialog).
function exportPDF(rows: CodeRow[]) {
  const w = window.open("", "_blank", "width=1000,height=700")
  if (!w) return
  w.document.write(`<!doctype html><html><head><title>Unit Codes</title><style>
    body{font-family:Arial,Helvetica,sans-serif;padding:24px}
    h1{font-size:18px;color:#0f766e}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th{background:#17858C;color:#fff;text-align:left;padding:6px 8px}
    td{border-bottom:1px solid #e2e8f0;padding:6px 8px}
    tr:nth-child(even) td{background:#f8fafc}
  </style></head><body><h1>UNIT CODES</h1><table><thead><tr>
    <th>No</th><th>Date Created</th><th>SKU</th><th>Code</th><th>Items</th><th>Remaining</th><th>Total Amount</th>
  </tr></thead><tbody>
  ${rows.map((c, i) => `<tr><td>${i + 1}</td><td>${fmtDT(c.created_at)}</td><td>${c.sku || "—"}</td><td>${c.code}</td><td>${c.itemsLabel || "—"}</td><td>${fmtNum(c.remaining)}</td><td>${fmtNum(c.totalCog)}</td></tr>`).join("")}
  </tbody></table><script>window.onload=()=>window.print()</script></body></html>`)
  w.document.close()
}

const EMPTY_FILTERS = { from: "", to: "", sku: "", code: "", items: "" }

const HELP: HelpSection[] = [
  {
    title: "Ano ang Unit Code?",
    body: [
      "Ito ang BINEBENTA sa POS — at isa itong RESIPE: itinuturo nito kung ilang piraso ng Product Item ang bawasan kapag may nabenta.",
      "Halimbawa: ang unit code na 'Lumyra x2' ay may resipeng Lumyra × 2. Kapag may bumili nito, dalawang piraso ang bumababa sa stock mo — hindi isa.",
      "Isang unit code kada variation. Lahat sila tumuturo sa IISANG Product Item, kaya hindi nahahati ang bilang mo.",
    ],
  },
  {
    title: "⚠ ANG PANGALAN ANG TINUTUGMA — hindi ang ID",
    body: [
      "Kapag may na-scan na parcel, kinukuha ng system ang teksto ng order mula sa Pancake (hal. '1x Lumyra x2') at hinahanap kung may unit code na EKSAKTONG ganoon ang pangalan.",
      "Kaya kung 'Lumyra 2x' ang produkto sa Pancake pero 'Lumyra x2' ang unit code mo, HINDI ito magtutugma. Naitatala pa rin ang scan, pero ZERO ang mababawas — at may dilaw na babalang lalabas.",
      "Hindi ito case-sensitive, pero dapat tugma ang spelling at espasyo.",
      "⚠ Kapag ginawa mo rito ang unit code, awtomatiko itong gumagawa ng produkto sa Pancake na ang pangalan ay ang mismong code — kaya tugma agad. Ang problema ay sa mga produktong ginawa nang DIRETSO sa Pancake; tingnan mo doon ang eksaktong pangalan at gayahin mo rito.",
    ],
  },
  {
    title: "Paano magdagdag",
    body: [
      "Product Items MUNA bago Unit Code — walang mapipiling item ang resipe kung wala pang naka-rehistrong produkto.",
      "SKU: awtomatiko na (UC-1, UC-2…), huwag nang galawin.",
      "Unit Code: ang pangalan sa POS. Item rows: ang resipe (aling produkto, ilang piraso). Selling Price: presyong binebenta.",
      "Pages: aling store ang makakakita. Blangko = lahat ng konektadong page.",
    ],
  },
  {
    title: "Saan ito gumagana",
    body: [
      "Sa Shipped Out scan: binubuklat ang order sa resipe, at doon nakukuha kung ilang piraso ang babawasan.",
      "Sa Sales Tracker: dito nagmumula ang pula/orange na kulay ng stock warning.",
      "Sa View COG Sold: dito kinukuwenta ang COG ng bawat order.",
    ],
  },
]

export default function UnitCodesPage() {
  const store = useUnitCodes()
  const products = useProductItems()
  const activePages = useActivePages()
  const [screen, setScreen] = useState<"list" | "add" | "edit" | "view" | "copy" | "upload">("list")
  const [active, setActive] = useState<UnitCode | null>(null)
  const [archivedView, setArchivedView] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [confirmDel, setConfirmDel] = useState<UnitCode[]>([])   // codes pending delete confirmation
  const [toast, setToast] = useState("")
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500) }

  const [perPage, setPerPage] = useState(25)
  const [page, setPage] = useState(1)
  const [f, setF] = useState(EMPTY_FILTERS)
  const [applied, setApplied] = useState(EMPTY_FILTERS)
  const setFilter = (k: keyof typeof EMPTY_FILTERS, v: string) => setF(p => ({ ...p, [k]: v }))
  const applyFilters = () => { setApplied(f); setPage(1) }

  // Remaining = sum of the linked product items' remaining stock (live from Product Items).
  const remainingOf = (name: string) => {
    const it = products.items.find(i => i.name.toLowerCase() === name.toLowerCase() && !i.deleted)
    return it ? itemRemaining(it) : 0
  }
  const cogOf = (name: string) => {
    const it = products.items.find(i => i.name.toLowerCase() === name.toLowerCase() && !i.deleted)
    return it ? it.cog : 0
  }
  const enrich = (c: UnitCode): CodeRow => {
    const remaining = c.items.reduce((s, i) => s + remainingOf(i.name), 0)
    const totalCog = c.items.reduce((s, i) => s + i.qty * cogOf(i.name), 0)
    return { ...c, remaining, totalCog, itemsLabel: c.items.map(i => `${i.name} (${fmtNum(remainingOf(i.name)).replace(/\.00$/, "")})`).join(", ") }
  }

  const filtered = useMemo(() => store.codes.filter(c => {
    if (!!c.archived !== archivedView) return false
    const d = c.created_at.slice(0, 10)
    if (applied.from && d < applied.from) return false
    if (applied.to && d > applied.to) return false
    if (applied.sku && !c.sku.toLowerCase().includes(applied.sku.toLowerCase())) return false
    if (applied.code && !c.code.toLowerCase().includes(applied.code.toLowerCase())) return false
    if (applied.items && !c.items.some(i => i.name.toLowerCase().includes(applied.items.toLowerCase()))) return false
    return true
  }).map(enrich), [store.codes, archivedView, applied, products.items])

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage))
  const pageSafe = Math.min(page, totalPages)
  const paginated = filtered.slice((pageSafe - 1) * perPage, pageSafe * perPage)
  const showFrom = filtered.length === 0 ? 0 : (pageSafe - 1) * perPage + 1
  const showTo = Math.min(pageSafe * perPage, filtered.length)

  const itemOptions = useMemo(() => Array.from(new Set(products.activeItems.map(i => i.name))).sort(), [products.activeItems])
  // Item picker shows "SKU - Name" but the stored value stays the plain name (lookups are name-keyed).
  const itemLabels = useMemo(() => {
    const m: Record<string, string> = {}
    for (const i of products.activeItems) if (!m[i.name]) m[i.name] = i.sku ? `${i.sku} - ${i.name}` : i.name
    return m
  }, [products.activeItems])
  // Only CONNECTED pages (with Pancake creds) can receive the product push.
  const connectedPages = useMemo(() => activePages.filter(p => p.api_key && (p.pancake_page_id || p.shop_id)), [activePages])
  const pageOptions = useMemo(() => connectedPages.map(p => p.name), [connectedPages])

  // On submit, automatically create the unit code as a PRODUCT on Pancake POS for the target
  // pages (selected ones; none selected = default → ALL connected pages). Runs in background.
  async function pushToPancake(input: NewUnitCodeInput) {
    const targets = input.pages.length ? connectedPages.filter(p => input.pages.includes(p.name)) : connectedPages
    if (targets.length === 0) return
    const totalCog = input.items.reduce((s, i) => s + i.qty * cogOf(i.name), 0)
    let ok = 0
    const errs: string[] = []
    for (const pg of targets) {
      try {
        const j = await fetch("/api/pancake/products/create", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: pg.api_key, page_id: pg.pancake_page_id || pg.shop_id,
            // Product name AND Product ID (custom_id) on Pancake = the unit code itself (user spec).
            name: input.code, custom_id: input.code, barcode: input.code,
            retail_price: input.selling_price, original_price: totalCog,
          }),
        }).then(r => r.json())
        if (j.success) ok++
        else errs.push(`${pg.name}: ${j.error || "failed"}`)
      } catch { errs.push(`${pg.name}: network error`) }
    }
    if (errs.length) flash(`⚠ Pancake push — ${ok} ok, ${errs.length} failed: ${errs[0]}`)
    else if (ok) flash(`Product created on Pancake (${ok} page${ok === 1 ? "" : "s"}).`)
  }

  // Mirror of the push: deleting a unit code also removes the matching product(s) on Pancake POS
  // (matched by name/custom_id = the code; runs in background after the local delete).
  async function deleteFromPancake(codesToDel: UnitCode[]) {
    let deleted = 0
    const errs: string[] = []
    for (const c of codesToDel) {
      const targets = c.pages?.length ? connectedPages.filter(p => c.pages.includes(p.name)) : connectedPages
      for (const pg of targets) {
        try {
          const j = await fetch("/api/pancake/products/delete", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ api_key: pg.api_key, page_id: pg.pancake_page_id || pg.shop_id, code: c.code }),
          }).then(r => r.json())
          if (j.success) deleted += j.deleted || 0
          else errs.push(`${c.code} @ ${pg.name}: ${j.error || "failed"}`)
        } catch { errs.push(`${c.code} @ ${pg.name}: network error`) }
      }
    }
    if (errs.length) flash(`⚠ Pancake delete — ${deleted} removed, ${errs.length} failed: ${errs[0]}`)
    else if (deleted) flash(`Deleted on Pancake POS too (${deleted} product${deleted === 1 ? "" : "s"}).`)
  }

  const toggleSel = (id: string) => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allChecked = paginated.length > 0 && paginated.every(c => sel.has(c.id))

  const toastEl = toast ? (
    <div className="fixed top-4 right-4 z-[70] bg-emerald-600 text-white text-sm rounded-xl px-5 py-3 shadow-lg flex items-center gap-2">
      <Check className="w-4 h-4" /> <div><p className="font-semibold">Success</p><p className="text-emerald-100">{toast}</p></div>
    </div>
  ) : null

  if (screen === "add" || screen === "copy" || (screen === "edit" && active))
    return <>{toastEl}<FormScreen mode={screen === "edit" ? "edit" : "add"}
      initial={screen === "edit" ? active! : screen === "copy" && active ? { ...active, code: "", sku: "" } as UnitCode : undefined}
      skuAuto={nextUnitSKU(store.codes)} itemOptions={itemOptions} itemLabels={itemLabels} pageOptions={pageOptions} cogOf={cogOf}
      onBack={() => setScreen("list")}
      onSave={(input, addUpsell) => {
        if (screen === "edit" && active) { store.updateCode(active.id, input); flash("Unit code updated successfully") }
        else {
          // "Add POS code for Upsell Item" → also creates the UPS- prefixed code.
          const batch = addUpsell ? [input, { ...input, sku: `UPS-${input.sku}`, code: `UPS-${input.code}`, upsell: true }] : [input]
          store.addMany(batch)
          flash(addUpsell ? "Unit code + UPS- upsell code added" : "Unit code added successfully")
          for (const b of batch) pushToPancake(b)   // background → creates the product(s) on Pancake POS
        }
        setScreen("list")
      }} /></>

  if (screen === "view" && active)
    return <>{toastEl}<ViewScreen code={enrich(store.codes.find(c => c.id === active.id) || active)} remainingOf={remainingOf} cogOf={cogOf} onBack={() => setScreen("list")} onEdit={() => setScreen("edit")} /></>

  if (screen === "upload")
    return <>{toastEl}<UploadScreen onBack={() => setScreen("list")}
      onUpload={(codes, skipped) => {
        if (codes.length) store.addMany(codes)
        flash(`${codes.length} unit code${codes.length === 1 ? "" : "s"} uploaded${skipped ? ` · ${skipped} skipped` : ""}.`)
        setScreen("list")
      }} /></>

  return (
    <div className="space-y-4 relative">
      {toastEl}

      {/* Delete confirmation — permanent, PesoWise only (Pancake products are untouched) */}
      {confirmDel.length > 0 && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setConfirmDel([])}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0"><Trash2 className="w-5 h-5 text-red-600" /></div>
              <h2 className="text-lg font-bold text-slate-900">Delete {confirmDel.length === 1 ? "unit code" : `${confirmDel.length} unit codes`}?</h2>
            </div>
            <p className="text-sm text-slate-600">
              {confirmDel.length === 1 ? <>This permanently deletes <strong>{confirmDel[0].code}</strong>.</> : <>This permanently deletes <strong>{confirmDel.length} unit codes</strong>.</>}{" "}
              This cannot be undone. The matching product{confirmDel.length === 1 ? "" : "s"} on <strong>Pancake POS</strong> will also be deleted.
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDel([])} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50">Cancel</button>
              <button onClick={() => {
                const doomed = confirmDel
                store.deleteMany(doomed.map(c => c.id))
                setSel(s => { const n = new Set(s); doomed.forEach(c => n.delete(c.id)); return n })
                flash(`${doomed.length} unit code${doomed.length === 1 ? "" : "s"} deleted.`)
                setConfirmDel([])
                deleteFromPancake(doomed)   // background → removes the product(s) on Pancake POS
              }} className="px-5 py-2 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Header — Tools ▾ · Archives toggle */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-4 mb-1 border-b border-slate-100">
        <div>
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Tag className="w-5 h-5" /> UNIT CODES {archivedView && <span className="text-sm font-semibold text-amber-600">· ARCHIVES</span>}<HelpButton title="Paano gumagana ang Unit Codes" sections={HELP} /></h1>
          <p className="text-xs text-slate-400 mt-0.5">{filtered.length} record{filtered.length === 1 ? "" : "s"}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => setToolsOpen(o => !o)}><Wrench className="w-4 h-4" /> Tools</Button>
            {toolsOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setToolsOpen(false)} />
                <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-30 w-56 py-1">
                  <button onClick={() => { setToolsOpen(false); setActive(null); setScreen("add") }}
                    className="w-full flex items-center gap-2 text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"><Plus className="w-4 h-4" /> Add New</button>
                  <button onClick={() => { setToolsOpen(false); setScreen("upload") }}
                    className="w-full flex items-center gap-2 text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"><Upload className="w-4 h-4" /> Upload Unit Codes</button>
                  <button onClick={() => { setToolsOpen(false); exportExcel(filtered); flash("Exported to Excel.") }}
                    className="w-full flex items-center gap-2 text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"><FileSpreadsheet className="w-4 h-4" /> Export to Excel</button>
                  <button onClick={() => { setToolsOpen(false); exportPDF(filtered) }}
                    className="w-full flex items-center gap-2 text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"><FileText className="w-4 h-4" /> Export PDF</button>
                </div>
              </>
            )}
          </div>
          <Button className="bg-teal-500 hover:bg-teal-600 text-white" onClick={() => { setArchivedView(v => !v); setSel(new Set()); setPage(1) }}>
            {archivedView ? <><List className="w-4 h-4" /> List</> : <><FolderOpen className="w-4 h-4" /> Archives</>}
          </Button>
        </div>
      </div>

      {/* Notice — archive to hide, delete removes here only (not on Pancake) */}
      <div className="bg-sky-50 border-l-4 border-sky-400 rounded-r-xl px-4 py-3 text-sm text-slate-600 flex gap-2">
        <Info className="w-4 h-4 text-sky-500 shrink-0 mt-0.5" />
        <p><strong className="text-slate-700">NOTE:</strong> Use <strong>Archives</strong> to hide unit codes you still might need. <strong>Delete</strong> permanently removes the code from PesoWise <strong>and</strong> deletes the matching product on Pancake POS. Inventory deduction stays automated through the shipped-out scanning system.</p>
      </div>

      {/* Bulk bar */}
      {sel.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border border-blue-100 rounded-xl text-sm">
          <span className="font-medium text-blue-700">{sel.size} selected</span>
          <button onClick={() => { store.setArchivedMany([...sel], !archivedView); flash(archivedView ? "Restored to list." : "Moved to Archives."); setSel(new Set()) }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md hover:bg-white text-amber-700">
            {archivedView ? <><ArchiveRestore className="w-3.5 h-3.5" /> Restore</> : <><Archive className="w-3.5 h-3.5" /> Archive</>}
          </button>
          <button onClick={() => setConfirmDel(filtered.filter(c => sel.has(c.id)))}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md hover:bg-white text-red-600"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
          <button onClick={() => setSel(new Set())} className="ml-auto text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Records selector */}
      <label className="flex items-center gap-2 text-sm text-slate-500">
        <select className="h-9 rounded-lg border border-slate-300 px-3 text-sm bg-white" value={perPage} onChange={e => { setPerPage(parseInt(e.target.value)); setPage(1) }}>
          {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        records
      </label>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto scrollbar-dark">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left bg-slate-50">
                <th className="px-3 py-3 w-[36px]"><input type="checkbox" checked={allChecked} onChange={e => setSel(e.target.checked ? new Set(paginated.map(c => c.id)) : new Set())} className="accent-blue-600" /></th>
                {["NO.", "DATE CREATED", "SKU", "CODE", "ITEMS", "REMAINING", "TOTAL AMOUNT", "ACTIONS"].map(h => (
                  <th key={h} className="px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
              {/* Filter row — applies on Search */}
              <tr className="border-b border-slate-200 bg-white">
                <th className="px-3 py-2" /><th className="px-4 py-2" />
                <th className="px-4 py-2">
                  <div className="min-w-[124px]">
                    <DateRangePicker a={applied.from} b={applied.to}
                      onApply={(a, b) => { setF(p => ({ ...p, from: a, to: b })); setApplied(p => ({ ...p, from: a, to: b })); setPage(1) }} />
                  </div>
                </th>
                <th className="px-4 py-2"><input className={FINP} value={f.sku} onChange={e => setFilter("sku", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} /></th>
                <th className="px-4 py-2"><input className={FINP} value={f.code} onChange={e => setFilter("code", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} /></th>
                <th className="px-4 py-2"><input className={FINP} value={f.items} onChange={e => setFilter("items", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} /></th>
                <th className="px-4 py-2" /><th className="px-4 py-2" />
                <th className="px-4 py-2"><Button className="h-8 px-3 bg-blue-600 hover:bg-blue-700 text-white text-xs" onClick={applyFilters}><Search className="w-3.5 h-3.5" /> Search</Button></th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-slate-400 text-sm">
                  {archivedView ? "No archived unit codes." : store.codes.length === 0 ? <>No unit codes yet. Click <strong>Tools → Add New</strong> to add one.</> : "No unit codes match the filters."}
                </td></tr>
              ) : paginated.map((c, i) => (
                <tr key={c.id} className={`border-b border-slate-100 ${sel.has(c.id) ? "bg-blue-50" : i % 2 === 0 ? "bg-white" : "bg-slate-50"} hover:bg-blue-50/40`}>
                  <td className="px-3 py-3"><input type="checkbox" checked={sel.has(c.id)} onChange={() => toggleSel(c.id)} className="accent-blue-600" /></td>
                  <td className="px-4 py-3 text-slate-400">{showFrom + i}</td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap text-xs">{fmtDT(c.created_at)}</td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{c.sku || "—"}</td>
                  <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{c.code}</td>
                  <td className="px-4 py-3 text-slate-600 max-w-[320px] truncate" title={c.itemsLabel}>{c.itemsLabel || "—"}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">{fmtNum(c.remaining).replace(/\.00$/, "")}</td>
                  <td className="px-4 py-3 tabular-nums font-semibold text-slate-800 whitespace-nowrap">{fmtNum(c.totalCog)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 text-slate-400">
                      <button onClick={() => { setActive(c); setScreen("view") }} className="hover:text-blue-600" title="View"><Search className="w-4 h-4" /></button>
                      <button onClick={() => { setActive(c); setScreen("edit") }} className="hover:text-teal-600" title="Edit"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => { store.setArchived(c.id, !c.archived); flash(c.archived ? "Restored to list." : "Moved to Archives.") }} className="hover:text-amber-600" title={c.archived ? "Restore" : "Archive"}>
                        {c.archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                      </button>
                      <button onClick={() => { setActive(c); setScreen("copy") }} className="text-slate-700 hover:text-slate-900" title="Copy unit code"><Copy className="w-4 h-4" /></button>
                      <button onClick={() => setConfirmDel([c])} className="hover:text-red-600" title="Delete"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Footer */}
        <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm text-slate-500">Showing {showFrom} to {showTo} of {filtered.length} entr{filtered.length === 1 ? "y" : "ies"}</span>
          <div className="flex items-center gap-1">
            <button disabled={pageSafe <= 1} onClick={() => setPage(p => p - 1)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
            <span className="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-600 text-white text-sm font-medium">{pageSafe}</span>
            <button disabled={pageSafe >= totalPages} onClick={() => setPage(p => p + 1)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Add / Edit / Copy (LHIKE "Add Order" layout) ─────────────────────────────
function FormScreen({ mode, initial, skuAuto, itemOptions, itemLabels, pageOptions, cogOf, onBack, onSave }: {
  mode: "add" | "edit"; initial?: UnitCode; skuAuto: string; itemOptions: string[]; itemLabels: Record<string, string>; pageOptions: string[]
  cogOf: (name: string) => number
  onBack: () => void; onSave: (input: NewUnitCodeInput, addUpsell: boolean) => void
}) {
  const [f, setF] = useState<NewUnitCodeInput>({
    sku: initial?.sku || skuAuto,   // auto-generated, locked (like the reference)
    code: initial?.code || "",
    items: initial?.items?.length ? initial.items.map(i => ({ ...i })) : [{ name: "", qty: 1 }],
    pages: initial?.pages ? [...initial.pages] : [],
    selling_price: initial?.selling_price || 0,
    upsell: initial?.upsell || false,
  })
  const [addUpsell, setAddUpsell] = useState(false)
  const [err, setErr] = useState("")
  const set = (k: keyof NewUnitCodeInput, v: any) => setF(p => ({ ...p, [k]: v }))
  const setItem = (idx: number, k: keyof UnitCodeItem, v: string) =>
    setF(p => ({ ...p, items: p.items.map((it, i) => i === idx ? { ...it, [k]: k === "qty" ? Number(v.replace(/[^\d.]/g, "")) || 0 : v } : it) }))
  const addItem = () => setF(p => ({ ...p, items: [...p.items, { name: "", qty: 1 }] }))
  const removeItem = (idx: number) => setF(p => ({ ...p, items: p.items.length > 1 ? p.items.filter((_, i) => i !== idx) : p.items }))
  const totalCog = f.items.reduce((s, i) => s + i.qty * cogOf(i.name), 0)

  function submit() {
    if (!f.code.trim()) return setErr("Unit Code is required.")
    if (f.code.trim().length > 30) return setErr("The maximum length allowed for the unit code is 30 characters.")
    if (!f.items.some(i => i.name.trim() && i.qty > 0)) return setErr("Add at least one Item with Qty.")
    setErr("")
    onSave({ ...f, sku: f.sku.trim(), code: f.code.trim(), items: f.items.filter(i => i.name.trim()) }, addUpsell && mode === "add")
  }

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft className="w-4 h-4" /> Back to Unit Codes</button>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-4xl">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 pb-4 mb-3 border-b border-slate-100"><Settings className="w-5 h-5" /> {mode === "add" ? "ADD UNIT CODE" : "EDIT UNIT CODE"}</h1>
        <div className="bg-sky-50 border-l-4 border-sky-400 rounded-r-lg px-4 py-2.5 text-sm text-slate-600 mb-3">
          • Removing unit code on your Pancake POS pages is not applicable. Please check your data before clicking submit
        </div>
        <div className="space-y-0.5">
          <FormRow label="SKU"><input className={`${INP} bg-slate-100 text-slate-500`} value={f.sku} readOnly /></FormRow>
          <FormRow label="Unit Code" required>
            <div>
              <Input className={INP} value={f.code} maxLength={30} onChange={e => set("code", e.target.value)} placeholder="e.g. unit code 112233" />
              <p className="text-[11px] text-blue-500 mt-1">note: The maximum length allowed for the unit code is 30 characters.</p>
            </div>
          </FormRow>
          <FormRow label="Item" required>
            <div className="space-y-2">
              <div className="grid grid-cols-[90px_110px_1fr_32px_40px] gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider px-1">
                <span>Qty *</span><span>COG</span><span>Item *</span><span /><span />
              </div>
              {f.items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-[90px_110px_1fr_32px_40px] gap-1.5 items-center">
                  <input className={`${INP} text-right`} inputMode="decimal" value={it.qty || ""} placeholder="0" onChange={e => setItem(idx, "qty", e.target.value)} />
                  <input className={`${INP} bg-slate-100 text-slate-500 text-right`} value={it.name ? fmtNum(cogOf(it.name)).replace(/\.00$/, "") : ""} readOnly title="COG (from Product Items)" />
                  <ComboInput value={it.name} onChange={v => setItem(idx, "name", v)} options={itemOptions} labels={itemLabels} placeholder="-- SELECT ITEM --" />
                  <button type="button" onClick={() => removeItem(idx)} disabled={f.items.length <= 1} title="Remove item"
                    className="w-8 h-8 flex items-center justify-center rounded text-slate-300 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30"><Trash2 className="w-3.5 h-3.5" /></button>
                  {idx === f.items.length - 1
                    ? <button type="button" onClick={addItem} title="Add item"
                        className="w-9 h-9 rounded-full bg-slate-900 hover:bg-slate-800 text-white flex items-center justify-center"><Plus className="w-4 h-4" /></button>
                    : <span />}
                </div>
              ))}
            </div>
          </FormRow>
          <FormRow label="Selling Price">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 items-center">
              <input className={`${INP} text-right`} inputMode="decimal" value={f.selling_price || ""} placeholder="0.00"
                onChange={e => set("selling_price", Number(e.target.value.replace(/[^\d.]/g, "")) || 0)} />
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-600 whitespace-nowrap">Total COG Amount</span>
                <input className={`${INP} bg-slate-100 text-slate-500 text-right`} value={fmtNum(totalCog).replace(/\.00$/, "")} readOnly />
              </div>
            </div>
          </FormRow>
          {mode === "add" && (
            <FormRow label="">
              <div className="pt-1">
                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
                  <input type="checkbox" checked={addUpsell} onChange={e => setAddUpsell(e.target.checked)} className="w-4 h-4 rounded border-slate-300 accent-blue-600" />
                  Add POS code for Upsell Item
                </label>
                <p className="text-[11px] text-slate-400 mt-1 pl-6">note: Prefix <span className="text-blue-500 underline">UPS-</span></p>
              </div>
            </FormRow>
          )}
          <FormRow label="Pages with Pancake API Key">
            <div className="space-y-1">
              <PageTagSelect options={pageOptions} selected={f.pages} onChange={v => set("pages", v)} />
              {(f.pages.length > 0 || pageOptions.length > 0) && (
                <p className="text-xs text-slate-500">Will also be added to Pages: {(f.pages.length ? f.pages : pageOptions).join(", ")},</p>
              )}
              {f.pages.length === 0 && <p className="text-[11px] text-slate-400">Note: not choosing a page sets the item to default — added to all connected Pancake pages.</p>}
            </div>
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
// LHIKE "VIEW ORDER" layout: info banner + readonly fields + generated BARCODE (CODE128 of
// the unit code, printable/scannable label) + HISTORY sidebar (Added By / Added Date).
function ViewScreen({ code, remainingOf, cogOf, onBack, onEdit }: { code: CodeRow; remainingOf: (n: string) => number; cogOf: (n: string) => number; onBack: () => void; onEdit: () => void }) {
  const barcodeRef = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (barcodeRef.current && code.code) {
      try { JsBarcode(barcodeRef.current, code.code, { format: "CODE128", height: 46, width: 1.7, fontSize: 13, margin: 0, displayValue: true }) } catch {}
    }
  }, [code.code])
  const RO = "w-full min-h-[40px] rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-700"
  const F = ({ l, req = false, children }: { l: string; req?: boolean; children: React.ReactNode }) => (
    <div className="grid grid-cols-[130px_1fr] gap-3 items-start py-2">
      <span className="text-sm text-slate-600 text-right pt-2">{l} {req && <span className="text-red-500">*</span>}</span>
      <div>{children}</div>
    </div>
  )
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft className="w-4 h-4" /> Back to Unit Codes</button>
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* Main card */}
        <div className="flex-1 w-full bg-white rounded-2xl border border-slate-200 p-6">
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 pb-4 mb-4 border-b border-slate-100"><Settings className="w-5 h-5" /> VIEW ORDER</h1>
          <div className="border-l-4 border-blue-400 bg-sky-50 rounded-r-lg px-4 py-3 text-sm text-slate-700 mb-5">
            <span className="mr-1.5">•</span> Removing unit code on your Pancake POS pages is not applicable. Please check your data before clicking submit
          </div>
          <div className="max-w-2xl">
            <F l="SKU"><div className={RO}>{code.sku || "—"}</div></F>
            <F l="Unit Code" req>
              <div className={RO}>{code.code}</div>
              <p className="text-[11px] text-blue-500 mt-1">note: The maximum length allowed for the unit code is 30 characters.</p>
            </F>
            <F l="Item" req>
              <div className="space-y-1.5">
                {code.items.map((it, i) => (
                  <div key={i} className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-slate-500">Qty <span className="text-red-500">*</span></span>
                    <div className={`${RO} w-20 text-center`}>{it.qty}</div>
                    <div className={`${RO} w-24 text-right`} title="COG (from Product Items)">{fmtNum(cogOf(it.name)).replace(/\.00$/, "")}</div>
                    <span className="text-xs text-slate-500">Item <span className="text-red-500">*</span></span>
                    <div className={`${RO} flex-1 min-w-[160px]`}>{it.name} <span className="text-slate-400 text-xs">— remaining {fmtNum(remainingOf(it.name)).replace(/\.00$/, "")}</span></div>
                  </div>
                ))}
                {code.items.length === 0 && <div className={RO}>—</div>}
              </div>
            </F>
            <div className="grid grid-cols-2 gap-3">
              <F l="Selling Price" req><div className={`${RO} max-w-[180px]`}>{fmtNum(code.selling_price).replace(/\.00$/, "")}</div></F>
              <div className="grid grid-cols-[150px_1fr] gap-3 items-start py-2">
                <span className="text-sm text-slate-600 text-right pt-2">Total COG Amount</span>
                <div className={`${RO} max-w-[180px]`}>{fmtNum(code.totalCog).replace(/\.00$/, "")}</div>
              </div>
            </div>
            {/* Connected pages — bullet list, like the reference */}
            <div className="pl-[142px] py-1">
              <ul className="text-sm font-semibold text-slate-800 space-y-0.5">
                {(code.pages.length ? code.pages : ["Default (all Pancake pages)"]).map(p => <li key={p}>• {p}</li>)}
              </ul>
            </div>
            <F l="Barcode">
              <svg ref={barcodeRef} className="mt-1" />
            </F>
          </div>
          <div className="flex gap-2 mt-5 pt-4 border-t border-slate-100">
            <Button className="bg-teal-500 hover:bg-teal-600 text-white" onClick={onEdit}><Pencil className="w-3.5 h-3.5" /> Edit</Button>
            <Button variant="outline" onClick={onBack}>Cancel</Button>
          </div>
        </div>
        {/* HISTORY sidebar */}
        <div className="w-full lg:w-72 shrink-0 bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="flex items-center gap-2 text-lg font-bold text-blue-600 mb-3"><Flag className="w-5 h-5" /> HISTORY</h2>
          <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 text-sm">
            <div className="px-4 py-2.5 bg-slate-50 font-bold text-slate-800">Added By</div>
            <div className="px-4 py-2.5 text-slate-700">{code.created_by || "—"}</div>
            <div className="px-4 py-2.5 bg-slate-50 font-bold text-slate-800">Added Date</div>
            <div className="px-4 py-2.5 text-slate-700">{fmtDT(code.created_at)}</div>
            <div className="px-4 py-2.5 bg-slate-50 font-bold text-slate-800">Remaining (total)</div>
            <div className="px-4 py-2.5 text-slate-700 font-semibold">{fmtNum(code.remaining).replace(/\.00$/, "")}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Upload Unit Codes screen ─────────────────────────────────────────────────
function UploadScreen({ onBack, onUpload }: { onBack: () => void; onUpload: (codes: NewUnitCodeInput[], skipped: number) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState("")

  function doUpload() {
    if (!file) return setErr("Upload Excel File is required.")
    setErr(""); setUploading(true)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const { codes, skipped } = parseUpload(reader.result as ArrayBuffer)
        if (codes.length === 0) { setErr("No unit codes found — fill the template rows first."); setUploading(false); return }
        onUpload(codes, skipped)
      } catch { setErr("Couldn't read that file — use the downloaded template format.") }
      setUploading(false)
    }
    reader.readAsArrayBuffer(file)
  }

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft className="w-4 h-4" /> Back to Unit Codes</button>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-3xl">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 pb-4 mb-4 border-b border-slate-100"><Settings className="w-5 h-5" /> UPLOAD UNIT CODES</h1>
        <div className="space-y-5">
          <div className="grid grid-cols-[170px_1fr] items-center gap-3">
            <span className="text-sm text-slate-600 text-right pr-2">Template</span>
            <div>
              <button onClick={downloadTemplate} className="text-sm text-blue-600 hover:underline text-left w-fit">Click to Download Sample File</button>
              <p className="text-[11px] text-slate-400 mt-1">Items &amp; Pages columns accept multiple values separated by commas.</p>
            </div>
          </div>
          <div className="grid grid-cols-[170px_1fr] items-center gap-3">
            <span className="text-sm text-slate-600 text-right pr-2">Upload Excel File <span className="text-red-500">*</span></span>
            <div className="flex items-center gap-2">
              <div className="flex-1 max-w-md h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white flex items-center text-slate-500 truncate">{file ? file.name : ""}</div>
              <label className="h-10 px-3.5 rounded-lg border border-slate-300 bg-slate-100 hover:bg-slate-200 text-sm text-slate-700 cursor-pointer flex items-center">
                Select file
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { setFile(e.target.files?.[0] || null); setErr("") }} />
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
