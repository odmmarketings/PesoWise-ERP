"use client"
import { useMemo, useState } from "react"
import { History, Search, ChevronLeft, ChevronRight } from "lucide-react"
import { useStockReleases } from "@/lib/stock-releases-store"

// TRANSACTION HISTORY (Inventory) — every stock movement recorded by the Stocks module
// (manual Stocks Update releases now; shipped-out scan deductions will land here too).
const fmtDT = (iso: string) => iso ? iso.slice(0, 16).replace("T", " ") : "—"

export default function TransactionHistoryPage() {
  const { releases } = useStockReleases()
  const [q, setQ] = useState("")
  const [applied, setApplied] = useState("")
  const [perPage, setPerPage] = useState(25)
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    const needle = applied.trim().toLowerCase()
    if (!needle) return releases
    return releases.filter(r =>
      r.ref.toLowerCase().includes(needle) ||
      r.category.toLowerCase().includes(needle) ||
      r.items.some(i => i.name.toLowerCase().includes(needle) || i.sku.toLowerCase().includes(needle))
    )
  }, [releases, applied])

  const pages = Math.max(1, Math.ceil(filtered.length / perPage))
  const pageSafe = Math.min(page, pages)
  const paginated = filtered.slice((pageSafe - 1) * perPage, pageSafe * perPage)
  const showFrom = filtered.length === 0 ? 0 : (pageSafe - 1) * perPage + 1
  const totalDeducted = filtered.reduce((s, r) => s + r.items.reduce((x, i) => x + i.deducted, 0), 0)

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h1 className="flex items-center gap-2 text-xl font-extrabold text-blue-600 tracking-wide"><History className="w-6 h-6" /> TRANSACTION HISTORY</h1>
        <hr className="my-4 border-slate-200" />

        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <label className="flex items-center gap-2 text-sm text-slate-500">
            <select className="h-9 rounded-lg border border-slate-300 px-2 text-sm bg-white" value={perPage} onChange={e => { setPerPage(parseInt(e.target.value)); setPage(1) }}>
              {[25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select> records
          </label>
          <div className="flex items-center gap-2">
            <input className="h-9 w-64 rounded-lg border border-slate-300 px-3 text-sm bg-white focus:outline-none focus:border-blue-400"
              placeholder="Search code / item / category…" value={q} onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { setApplied(q); setPage(1) } }} />
            <button onClick={() => { setApplied(q); setPage(1) }} className="h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center gap-1.5"><Search className="w-4 h-4" /> Search</button>
          </div>
        </div>

        <div className="overflow-x-auto scrollbar-dark">
          <table className="w-full text-sm border border-slate-200">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left">
                {["No", "Date & Time", "Type", "Reference", "Items", "Total Deducted"].map(h => (
                  <th key={h} className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap border-r border-slate-200 last:border-r-0">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-slate-400 text-sm">
                  {releases.length === 0 ? <>No stock transactions yet — releases from <strong>Inventory → Stocks</strong> will appear here.</> : "No transactions match the search."}
                </td></tr>
              ) : paginated.map((r, i) => (
                <tr key={r.id} className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50"} hover:bg-blue-50/40`}>
                  <td className="px-4 py-3 text-slate-400 border-r border-slate-100">{showFrom + i}</td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap border-r border-slate-100">{fmtDT(r.date)}</td>
                  <td className="px-4 py-3 border-r border-slate-100"><span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700 whitespace-nowrap">Stock Release · {r.category}</span></td>
                  <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap border-r border-slate-100">{r.ref || "—"}</td>
                  <td className="px-4 py-3 text-slate-600 border-r border-slate-100">
                    {r.items.map((it, x) => (
                      <div key={x} className="whitespace-nowrap">{it.sku ? `${it.sku} — ` : ""}{it.name} <span className="text-slate-400">({it.release} × {it.required} =</span> <strong>{it.deducted}</strong><span className="text-slate-400">)</span></div>
                    ))}
                  </td>
                  <td className="px-4 py-3 tabular-nums font-semibold text-slate-800">{r.items.reduce((s, it) => s + it.deducted, 0).toLocaleString("en-PH")}</td>
                </tr>
              ))}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold text-slate-800">
                  <td className="px-4 py-3" colSpan={5}>TOTAL <span className="font-normal text-slate-400">· {filtered.length} transaction{filtered.length === 1 ? "" : "s"}</span></td>
                  <td className="px-4 py-3 tabular-nums">{totalDeducted.toLocaleString("en-PH")}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-2 mt-3 text-sm text-slate-600">
          <span>Showing {showFrom} to {Math.min(pageSafe * perPage, filtered.length)} of {filtered.length} entries</span>
          <div className="flex items-center gap-1">
            <button disabled={pageSafe <= 1} onClick={() => setPage(p => p - 1)} className="w-8 h-8 rounded border border-slate-300 flex items-center justify-center disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
            <span className="px-2">{pageSafe} / {pages}</span>
            <button disabled={pageSafe >= pages} onClick={() => setPage(p => p + 1)} className="w-8 h-8 rounded border border-slate-300 flex items-center justify-center disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      </div>
    </div>
  )
}
