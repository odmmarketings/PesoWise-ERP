"use client"
import { PieChart, Users } from "lucide-react"
import { useAffiliates, commissionOf, AFF_PLATFORMS } from "@/lib/affiliates-store"

const peso = (n: number) => "₱" + (isFinite(n) ? n : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function AffiliateOverviewPage() {
  const aff = useAffiliates()
  const byPlatform = AFF_PLATFORMS.map(p => {
    const list = aff.affiliates.filter(a => a.platform === p)
    return { p, count: list.length, sales: list.reduce((s, a) => s + a.sales, 0), comm: list.reduce((s, a) => s + commissionOf(a), 0) }
  })

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 pb-4 mb-4 border-b border-slate-100">
        <PieChart className="w-5 h-5" /> AFFILIATE OVERVIEW
      </h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { l: "Affiliates", v: String(aff.affiliates.length), a: "from-slate-700 to-slate-800" },
          { l: "Affiliate Sales", v: peso(aff.totalSales), a: "from-blue-600 to-blue-700" },
          { l: "Total Commission", v: peso(aff.totalCommission), a: "from-rose-500 to-rose-600" },
          { l: "Net to Company", v: peso(aff.totalSales - aff.totalCommission), a: "from-emerald-500 to-emerald-600" },
        ].map((c, i) => (
          <div key={i} className={`rounded-2xl p-3.5 sm:p-4 text-white bg-gradient-to-br ${c.a}`}>
            <div className="text-[11px] uppercase tracking-wider opacity-90">{c.l}</div>
            <div className="text-xl sm:text-2xl font-bold mt-1 tabular-nums">{c.v}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 text-sm font-semibold text-slate-700">By Platform</div>
        {/* Nag-scroll nang pahalang ang table sa cellphone — hindi dinudurog ang 4 kolum */}
        <div className="overflow-x-auto scrollbar-dark">
        <table className="w-full text-sm min-w-[420px]">
          <thead><tr className="border-b border-slate-200 bg-slate-50 text-left">{["Platform", "Affiliates", "Sales", "Commission"].map(h => <th key={h} className="px-4 py-2.5 font-semibold text-slate-600">{h}</th>)}</tr></thead>
          <tbody>
            {byPlatform.map(b => (
              <tr key={b.p} className="border-b border-slate-100"><td className="px-4 py-2.5 font-medium">{b.p}</td><td className="px-4 py-2.5">{b.count}</td><td className="px-4 py-2.5 tabular-nums">{peso(b.sales)}</td><td className="px-4 py-2.5 tabular-nums text-rose-600">{peso(b.comm)}</td></tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
      <p className="text-xs text-slate-400 flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Attributed sales connect via each platform's affiliate API (to follow). Commission % is set per affiliate.</p>
    </div>
  )
}
