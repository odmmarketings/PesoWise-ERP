"use client"
import { DollarSign } from "lucide-react"
import { useAffiliates } from "@/lib/affiliates-store"

const peso = (n: number) => "₱" + (isFinite(n) ? n : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function AffiliateSalesPage() {
  const aff = useAffiliates()
  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 pb-4 mb-4 border-b border-slate-100">
        <DollarSign className="w-5 h-5" /> AFFILIATE SALES
      </h1>
      <p className="text-sm text-slate-500">Sales attributed to each affiliate. Auto-fills from each platform's affiliate API (to follow).</p>
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-200 bg-slate-50 text-left">{["Affiliate", "Platform", "Code", "Attributed Sales"].map(h => <th key={h} className="px-4 py-2.5 font-semibold text-slate-600">{h}</th>)}</tr></thead>
          <tbody>
            {aff.affiliates.length === 0 ? (
              <tr><td colSpan={4} className="text-center py-12 text-slate-400 text-sm">No affiliates yet. Add some in the Affiliates tab.</td></tr>
            ) : aff.affiliates.map(a => (
              <tr key={a.id} className="border-b border-slate-100"><td className="px-4 py-2.5 font-medium">{a.name}</td><td className="px-4 py-2.5">{a.platform}</td><td className="px-4 py-2.5 font-mono text-xs text-slate-500">{a.code || "—"}</td><td className="px-4 py-2.5 tabular-nums">{a.sales > 0 ? peso(a.sales) : <span className="text-slate-300 italic">to follow</span>}</td></tr>
            ))}
            {aff.affiliates.length > 0 && <tr className="bg-amber-50 font-bold"><td className="px-4 py-2.5" colSpan={3}>TOTAL</td><td className="px-4 py-2.5 tabular-nums">{peso(aff.totalSales)}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
