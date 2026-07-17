"use client"
import { useState } from "react"
import { BarChart3 } from "lucide-react"
import { useChannelFigures } from "@/lib/channels-store"
import { ChannelNetCard } from "@/components/business/ChannelNet"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"

function peso(n: number) { return (n < 0 ? "-₱" : "₱") + Math.abs(isFinite(n) ? n : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

export default function ChannelOverviewPage() {
  const channels = useChannelFigures()
  const [dateA, setDateA] = useState("")
  const [dateB, setDateB] = useState("")
  const totalSales = channels.reduce((s, c) => s + c.sales, 0)
  const totalNet = channels.reduce((s, c) => s + c.net, 0)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2 pb-4 mb-1 border-b border-slate-100">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><BarChart3 className="w-5 h-5" /> CHANNEL OVERVIEW</h1>
        <DateRangePicker a={dateA} b={dateB} variant="header" onApply={(a, b) => { setDateA(a); setDateB(b) }} />
      </div>
      <p className="text-sm text-slate-500">Combined Net Profit across all sales channels. Each channel keeps its own breakdown below; data lights up as each platform API connects.</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 text-white p-5">
          <div className="text-[11px] uppercase tracking-wider opacity-90">Total Channel Sales</div>
          <div className="text-2xl font-bold mt-1 tabular-nums">{peso(totalSales)}</div>
        </div>
        <div className={`rounded-2xl text-white p-5 bg-gradient-to-br ${totalNet >= 0 ? "from-emerald-500 to-emerald-600" : "from-rose-600 to-rose-700"}`}>
          <div className="text-[11px] uppercase tracking-wider opacity-90">Total Net (all channels)</div>
          <div className="text-2xl font-bold mt-1 tabular-nums">{peso(totalNet)}</div>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-slate-700 to-slate-800 text-white p-5">
          <div className="text-[11px] uppercase tracking-wider opacity-90">Channels</div>
          <div className="text-2xl font-bold mt-1 tabular-nums">{channels.length}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {channels.map(c => <ChannelNetCard key={c.key} c={c} />)}
      </div>
    </div>
  )
}
