"use client"
import { type ChannelNet } from "@/lib/channels-store"

function peso(n: number) { return (n < 0 ? "-₱" : "₱") + Math.abs(isFinite(n) ? n : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

// Per-channel Net Profit breakdown card (own mini P&L).
export function ChannelNetCard({ c, headerColor }: { c: ChannelNet; headerColor?: string }) {
  const rows = [
    { l: "Channel Sales", v: c.sales, kind: "income" as const },
    { l: "Ad Spend", v: c.adspend, kind: "deduct" as const },
    { l: "Affiliate Commission", v: c.commission, kind: "deduct" as const },
    { l: "COG", v: c.cog, kind: "deduct" as const },
  ]
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className={`flex items-center justify-between px-4 py-2.5 text-white ${headerColor || c.color}`}>
        <span className="text-sm font-bold">{c.label}</span>
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-white/20">{c.connected ? "Connected" : "API to follow"}</span>
      </div>
      <div>
        {rows.map((r, i) => (
          <div key={i} className={`flex items-center justify-between px-4 py-2.5 border-b border-slate-100 text-sm ${r.kind === "income" ? "bg-slate-50 font-semibold text-slate-800" : "text-slate-600"}`}>
            <span>{r.kind === "deduct" && <span className="text-rose-400 mr-1.5">−</span>}{r.l}</span>
            <span className={`tabular-nums ${r.kind === "deduct" ? "text-rose-600" : ""}`}>{peso(r.v)}</span>
          </div>
        ))}
        <div className={`flex items-center justify-between px-4 py-3 font-bold ${c.net >= 0 ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>
          <span>NET PROFIT</span><span className="tabular-nums">{peso(c.net)}</span>
        </div>
      </div>
    </div>
  )
}
