"use client"
import { useMemo, useState } from "react"
import { Boxes, ChevronDown, Check } from "lucide-react"
import { useProductItems, itemRemaining } from "@/lib/product-items-store"
import { useUnitCodes } from "@/lib/unit-codes-store"
import { useStockReleases } from "@/lib/stock-releases-store"
import { useProductBatches } from "@/lib/product-batches-store"

// STOCKS UPDATE (LHIKE manual): search by ONE category — Sku Code (unit-code SKU) /
// Unit Code / Item Code (product-item SKU) / Item Name — then enter Release Qty per row
// and Submit. Deduction per row = Release × Quantity Required, applied to the product
// item's cumulative `released` (Remaining in Product Items drops immediately).

type Cat = "" | "sku" | "unit" | "itemCode" | "itemName"
const CAT_LABEL: Record<Exclude<Cat, "">, string> = { sku: "Sku Code", unit: "Unit Code", itemCode: "Item Code", itemName: "Item Name" }

type StockRow = {
  itemId: string; itemSku: string; itemName: string
  required: number; available: number; release: string
}

// Dropdown with an inline search box (the LHIKE picker in the manual screenshots).
function SearchSelect({ value, options, onSelect }: { value: string; options: string[]; onSelect: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const filtered = options.filter(o => o.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="relative">
      <button type="button" onClick={() => { setOpen(o => !o); setQ("") }}
        className="w-full h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-left flex items-center justify-between hover:border-slate-400">
        <span className={value ? "text-slate-800" : "text-slate-400"}>{value || "--"}</span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-xl p-2">
            <input autoFocus value={q} onChange={e => setQ(e.target.value)}
              className="w-full h-9 rounded border border-blue-400 px-2 text-sm mb-1 focus:outline-none" />
            <div className="max-h-48 overflow-auto scrollbar-dark">
              <button type="button" className="w-full text-left px-3 py-2 text-sm text-slate-500 hover:bg-slate-100" onMouseDown={() => { onSelect(""); setOpen(false) }}>--</button>
              {filtered.map(o => (
                <button key={o} type="button" onMouseDown={() => { onSelect(o); setOpen(false) }}
                  className={`w-full text-left px-3 py-2 text-sm ${o === value ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-blue-50"}`}>{o}</button>
              ))}
              {filtered.length === 0 && <div className="px-3 py-2 text-sm text-slate-400">No match</div>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function StocksPage() {
  const products = useProductItems()
  const unitStore = useUnitCodes()
  const releaseLog = useStockReleases()
  const batches = useProductBatches()

  const [pick, setPick] = useState<{ cat: Cat; value: string }>({ cat: "", value: "" })
  const [rows, setRows] = useState<StockRow[]>([])
  const [searched, setSearched] = useState(false)
  const [toast, setToast] = useState("")
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500) }

  const liveItems = useMemo(() => products.items.filter(i => !i.deleted), [products.items])
  const codes = useMemo(() => unitStore.codes.filter(c => !c.archived), [unitStore.codes])
  const skuOpts = useMemo(() => Array.from(new Set(codes.map(c => c.sku).filter(Boolean))).sort(), [codes])
  const unitOpts = useMemo(() => Array.from(new Set(codes.map(c => c.code).filter(Boolean))).sort(), [codes])
  const itemCodeOpts = useMemo(() => Array.from(new Set(liveItems.map(i => i.sku).filter(Boolean))).sort(), [liveItems])
  const itemNameOpts = useMemo(() => Array.from(new Set(liveItems.map(i => i.name).filter(Boolean))).sort(), [liveItems])

  // "Choose one category only" — picking a value in one dropdown clears the rest.
  const select = (cat: Exclude<Cat, "">) => (v: string) => setPick(v ? { cat, value: v } : { cat: "", value: "" })
  const valFor = (cat: Cat) => (pick.cat === cat ? pick.value : "")

  const findItem = (name: string) => liveItems.find(i => i.name.toLowerCase() === name.toLowerCase())

  function doSearch() {
    if (!pick.cat) { flash("⚠ Choose one category first."); return }
    let out: StockRow[] = []
    if (pick.cat === "sku" || pick.cat === "unit") {
      const c = codes.find(x => (pick.cat === "sku" ? x.sku : x.code).toLowerCase() === pick.value.toLowerCase())
      if (c) out = c.items.flatMap(r => {
        const it = findItem(r.name)
        return it ? [{ itemId: it.id, itemSku: it.sku, itemName: it.name, required: r.qty || 1, available: itemRemaining(it), release: "" }] : []
      })
    } else {
      const it = liveItems.find(i => (pick.cat === "itemCode" ? i.sku : i.name).toLowerCase() === pick.value.toLowerCase())
      if (it) out = [{ itemId: it.id, itemSku: it.sku, itemName: it.name, required: 1, available: itemRemaining(it), release: "" }]
    }
    setRows(out); setSearched(true)
  }

  const setRelease = (i: number, v: string) => setRows(rs => rs.map((r, x) => x === i ? { ...r, release: v.replace(/[^\d]/g, "") } : r))
  const remainingOf = (r: StockRow) => r.release === "" ? null : r.available - Number(r.release) * r.required
  const hasRelease = rows.some(r => Number(r.release) > 0)

  function submit() {
    const toApply = rows.filter(r => Number(r.release) > 0)
    if (toApply.length === 0) { flash("⚠ Enter a Release Qty first."); return }
    const deltas = toApply.map(r => ({ id: r.itemId, qty: Number(r.release) * r.required }))
    products.releaseStock(deltas)
    // Kaparehong FIFO na pagkain ng batch gaya ng Shipped Out — kung hindi, may
    // bawas na hindi tumatama sa anumang cost layer at masisira ang valuation.
    batches.consume(deltas)
    releaseLog.addRelease({
      category: CAT_LABEL[pick.cat as Exclude<Cat, "">] || "", ref: pick.value,
      items: toApply.map(r => ({ item_id: r.itemId, sku: r.itemSku, name: r.itemName, required: r.required, release: Number(r.release), deducted: Number(r.release) * r.required })),
    })
    setRows(rs => rs.map(r => Number(r.release) > 0 ? { ...r, available: r.available - Number(r.release) * r.required, release: "" } : r))
    flash("Stock updated — Remaining Qty adjusted in Product Items.")
  }
  function clearAll() { setPick({ cat: "", value: "" }); setRows([]); setSearched(false) }

  return (
    <div className="space-y-4 relative">
      {toast && (
        <div className="fixed top-4 right-4 z-[70] bg-emerald-600 text-white text-sm rounded-xl px-5 py-3 shadow-lg flex items-center gap-2">
          <Check className="w-4 h-4" /> <div><p className="font-semibold">Success</p><p className="text-emerald-100">{toast}</p></div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h1 className="flex items-center gap-2 text-xl font-extrabold text-blue-600 tracking-wide"><Boxes className="w-6 h-6" /> STOCKS UPDATE</h1>
        <hr className="my-4 border-slate-200" />

        <p className="text-orange-500 font-medium mb-4">Choose one category only</p>

        <div className="grid md:grid-cols-[auto_1fr_auto_1fr_auto] gap-x-4 gap-y-4 items-center max-w-4xl">
          <span className="text-sm font-semibold text-slate-700 whitespace-nowrap">Sku Code</span>
          <SearchSelect value={valFor("sku")} options={skuOpts} onSelect={select("sku")} />
          <span className="text-sm font-semibold text-slate-700 whitespace-nowrap md:pl-4">Unit Code</span>
          <SearchSelect value={valFor("unit")} options={unitOpts} onSelect={select("unit")} />
          <span />
          <span className="text-sm font-semibold text-slate-700 whitespace-nowrap">Item Code</span>
          <SearchSelect value={valFor("itemCode")} options={itemCodeOpts} onSelect={select("itemCode")} />
          <span className="text-sm font-semibold text-slate-700 whitespace-nowrap md:pl-4">Item Name</span>
          <SearchSelect value={valFor("itemName")} options={itemNameOpts} onSelect={select("itemName")} />
          <button onClick={doSearch} className="h-11 px-6 rounded-lg bg-blue-500 hover:bg-blue-600 text-white font-semibold md:ml-2">Search</button>
        </div>

        {searched && (
          <>
            <hr className="my-5 border-slate-200" />
            {rows.length === 0 ? (
              <p className="text-sm text-slate-400 py-6 text-center">No matching record — the searched code has no items registered in Product Items.</p>
            ) : (
              <>
                <div className="overflow-x-auto scrollbar-dark">
                  <table className="w-full text-sm border border-slate-200">
                    <thead>
                      <tr className="border-b border-slate-200 text-left bg-slate-50">
                        {["No", "Item Code", "Item Name", "Quantity Required", "Available Qty", "Release Qty", "Remaining Qty"].map(h => (
                          <th key={h} className="px-4 py-3 font-bold text-slate-700 whitespace-nowrap border-r border-slate-200 last:border-r-0">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => {
                        const rem = remainingOf(r)
                        return (
                          <tr key={r.itemId} className="border-b border-slate-100">
                            <td className="px-4 py-3 text-slate-600 border-r border-slate-100">{i + 1}</td>
                            <td className="px-4 py-3 text-blue-600 font-medium whitespace-nowrap border-r border-slate-100">{r.itemSku || "—"}</td>
                            <td className="px-4 py-3 text-slate-700 border-r border-slate-100">{r.itemName}</td>
                            <td className="px-4 py-3 text-slate-700 border-r border-slate-100">{r.required}</td>
                            <td className={`px-4 py-3 tabular-nums border-r border-slate-100 ${r.available <= 0 ? "text-red-600 font-semibold" : "text-slate-700"}`}>{r.available.toLocaleString("en-PH")}</td>
                            <td className="px-4 py-3 border-r border-slate-100">
                              <input value={r.release} onChange={e => setRelease(i, e.target.value)} inputMode="numeric"
                                className="w-32 h-10 rounded-lg border border-slate-300 px-3 text-sm focus:outline-none focus:border-blue-400" />
                            </td>
                            <td className="px-4 py-3">
                              <div className={`w-40 h-10 rounded-lg border border-slate-200 bg-slate-100 px-3 flex items-center text-sm tabular-nums ${rem != null && rem < 0 ? "text-red-600 font-semibold" : "text-slate-600"}`}>
                                {rem != null ? rem.toLocaleString("en-PH") : ""}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-slate-400 mt-2">Deduction per row = Release Qty × Quantity Required. A red Remaining means releasing more than the recorded stock.</p>
                <div className="flex items-center gap-2 mt-4">
                  <button onClick={submit} disabled={!hasRelease} className="h-11 px-6 rounded-lg bg-blue-500 hover:bg-blue-600 text-white font-semibold disabled:opacity-40">Submit</button>
                  <button onClick={clearAll} className="h-11 px-6 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50">Clear</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
