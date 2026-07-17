"use client"
import { Coins } from "lucide-react"
import { useAffiliates, commissionOf } from "@/lib/affiliates-store"

const peso = (n: number) => "₱" + (isFinite(n) ? n : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function CommissionsPage() {
  const aff = useAffiliates()
  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 pb-4 mb-4 border-b border-slate-100">
        <Coins className="w-5 h-5" /> COMMISSIONS / PAYOUTS
      </h1>
      <p className="text-sm text-slate-500">Auto-computed: <strong>Commission = Sales × Commission %</strong>. This total is deducted from net profit.</p>
      <div className="rounded-2xl bg-gradient-to-br from-rose-500 to-rose-600 text-white p-6 flex items-center justify-between">
        <span className="text-sm font-semibold uppercase tracking-wider opacity-90">Total Commission<br />Payout</span>
        <span className="text-3xl font-extrabold tabular-nums">{peso(aff.totalCommission)}</span>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-200 bg-slate-50 text-left">{["Affiliate", "Platform", "Sales", "Rate", "Commission"].map(h => <th key={h} className="px-4 py-2.5 font-semibold text-slate-600">{h}</th>)}</tr></thead>
          <tbody>
            {aff.affiliates.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-12 text-slate-400 text-sm">No affiliates yet.</td></tr>
            ) : aff.affiliates.map(a => (
              <tr key={a.id} className="border-b border-slate-100"><td className="px-4 py-2.5 font-medium">{a.name}</td><td className="px-4 py-2.5">{a.platform}</td><td className="px-4 py-2.5 tabular-nums">{peso(a.sales)}</td><td className="px-4 py-2.5">{a.commission_pct}%</td><td className="px-4 py-2.5 tabular-nums font-semibold text-rose-600">{peso(commissionOf(a))}</td></tr>
            ))}
            {aff.affiliates.length > 0 && <tr className="bg-amber-50 font-bold"><td className="px-4 py-2.5" colSpan={4}>TOTAL</td><td className="px-4 py-2.5 tabular-nums text-rose-600">{peso(aff.totalCommission)}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
