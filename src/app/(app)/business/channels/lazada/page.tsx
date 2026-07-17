"use client"
import { useState } from "react"
import { Package } from "lucide-react"
import { useChannelFigures } from "@/lib/channels-store"
import { ChannelNetCard } from "@/components/business/ChannelNet"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"

export default function Page() {
  const c = useChannelFigures().find(x => x.key === "lazada")!
  const [dateA, setDateA] = useState("")
  const [dateB, setDateB] = useState("")
  return (
    <div className="space-y-5 max-w-xl">
      <div className="flex items-center justify-between flex-wrap gap-2 pb-4 mb-1 border-b border-slate-100">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Package className="w-5 h-5" /> LAZADA</h1>
        <DateRangePicker a={dateA} b={dateB} variant="header" onApply={(a, b) => { setDateA(a); setDateB(b) }} />
      </div>
      <p className="text-sm text-slate-500">Orders &amp; Net Profit from Lazada. Connects to the Lazada Open API (to follow).</p>
      <ChannelNetCard c={c} />
    </div>
  )
}
