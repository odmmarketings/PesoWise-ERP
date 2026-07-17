"use client"
import { TrendingUp } from "lucide-react"
import { useChannelFigures } from "@/lib/channels-store"
import { useAffiliates } from "@/lib/affiliates-store"

const peso = (n: number) => "₱" + (isFinite(n) ? n : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function SalesReportPage() {
  const channels = useChannelFigures()
  const aff = useAffiliates()
  const totalSales = channels.reduce((s, c) => s + c.sales, 0)
  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 pb-4 mb-4 border-b border-slate-100"><TrendingUp className="w-5 h-5" /> SALES REPORT</h1>
      <p className="text-sm text-slate-500">All sales channels combined. Affiliate-driven sales are part of channel sales (shown for reference).</p>
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-200 bg-slate-50 text-left">{["Channel", "Sales", "Status"].map(h => <th key={h} className="px-4 py-2.5 font-semibold text-slate-600">{h}</th>)}</tr></thead>
          <tbody>
            {channels.map(c => (
              <tr key={c.key} className="border-b border-slate-100"><td className="px-4 py-2.5 font-medium">{c.label}</td><td className="px-4 py-2.5 tabular-nums">{peso(c.sales)}</td><td className="px-4 py-2.5 text-xs text-slate-400">{c.connected ? "Connected" : "API to follow"}</td></tr>
            ))}
            <tr className="bg-amber-50 font-bold"><td className="px-4 py-2.5">TOTAL SALES</td><td className="px-4 py-2.5 tabular-nums">{peso(totalSales)}</td><td /></tr>
          </tbody>
        </table>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 flex items-center justify-between text-sm">
        <span className="text-slate-500">Affiliate-attributed sales (reference)</span>
        <span className="tabular-nums font-semibold text-slate-700">{peso(aff.totalSales)}</span>
      </div>
    </div>
  )
}
