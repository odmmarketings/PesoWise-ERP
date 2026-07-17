"use client"
import { Award } from "lucide-react"
import { useAffiliates, commissionOf } from "@/lib/affiliates-store"

const peso = (n: number) => "₱" + (isFinite(n) ? n : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const MEDAL = ["🥇", "🥈", "🥉"]

export default function LeaderboardPage() {
  const aff = useAffiliates()
  const ranked = [...aff.affiliates].sort((a, b) => b.sales - a.sales)
  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 pb-4 mb-4 border-b border-slate-100">
        <Award className="w-5 h-5" /> AFFILIATE LEADERBOARD
      </h1>
      <p className="text-sm text-slate-500">Top affiliates by attributed sales.</p>
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-200 bg-slate-50 text-left">{["Rank", "Affiliate", "Platform", "Sales", "Commission"].map(h => <th key={h} className="px-4 py-2.5 font-semibold text-slate-600">{h}</th>)}</tr></thead>
          <tbody>
            {ranked.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-12 text-slate-400 text-sm">No affiliates yet.</td></tr>
            ) : ranked.map((a, i) => (
              <tr key={a.id} className={`border-b border-slate-100 ${i < 3 ? "bg-amber-50/40" : ""}`}>
                <td className="px-4 py-2.5 font-bold">{MEDAL[i] || i + 1}</td>
                <td className="px-4 py-2.5 font-medium">{a.name}</td>
                <td className="px-4 py-2.5">{a.platform}</td>
                <td className="px-4 py-2.5 tabular-nums">{peso(a.sales)}</td>
                <td className="px-4 py-2.5 tabular-nums text-rose-600">{peso(commissionOf(a))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
