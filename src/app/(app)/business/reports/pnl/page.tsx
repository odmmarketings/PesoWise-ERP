"use client"
import { FileText } from "lucide-react"
import { useChannelFigures } from "@/lib/channels-store"
import { useAffiliates } from "@/lib/affiliates-store"

const peso = (n: number) => (n < 0 ? "-₱" : "₱") + Math.abs(isFinite(n) ? n : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function PnlReportPage() {
  const channels = useChannelFigures()
  const aff = useAffiliates()
  const sales = channels.reduce((s, c) => s + c.sales, 0)
  const adspend = channels.reduce((s, c) => s + c.adspend, 0)
  const cog = channels.reduce((s, c) => s + c.cog, 0)
  const commission = aff.totalCommission
  const net = sales - adspend - commission - cog

  const rows = [
    { l: "Total Sales (all channels)", v: sales, kind: "income" as const },
    { l: "Ad Spend", v: adspend, kind: "deduct" as const },
    { l: "Affiliate Commission", v: commission, kind: "deduct" as const },
    { l: "COG", v: cog, kind: "deduct" as const },
  ]

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 pb-4 mb-4 border-b border-slate-100"><FileText className="w-5 h-5" /> P&L / NET</h1>
      <p className="text-sm text-slate-500">Multi-channel net profit: <strong>Sales − Ad Spend − Affiliate Commission − COG</strong>. Separate from the Finance Income Statement (J&amp;T/SPX) — this one rolls up the sales channels.</p>
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden max-w-xl">
        {rows.map((r, i) => (
          <div key={i} className={`flex items-center justify-between px-4 py-3 border-b border-slate-100 text-sm ${r.kind === "income" ? "bg-slate-50 font-semibold text-slate-800" : "text-slate-600"}`}>
            <span>{r.kind === "deduct" && <span className="text-rose-400 mr-1.5">−</span>}{r.l}</span>
            <span className={`tabular-nums ${r.kind === "deduct" ? "text-rose-600" : ""}`}>{peso(r.v)}</span>
          </div>
        ))}
        <div className={`flex items-center justify-between px-4 py-4 font-bold text-white ${net >= 0 ? "bg-gradient-to-r from-emerald-500 to-emerald-600" : "bg-gradient-to-r from-rose-600 to-rose-700"}`}>
          <span>NET PROFIT</span><span className="text-lg tabular-nums">{peso(net)}</span>
        </div>
      </div>
    </div>
  )
}
