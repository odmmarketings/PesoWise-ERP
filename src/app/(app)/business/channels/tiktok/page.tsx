"use client"
import { useState } from "react"
import { Activity } from "lucide-react"
import { useChannelFigures } from "@/lib/channels-store"
import { ChannelNetCard } from "@/components/business/ChannelNet"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"

export default function Page() {
  const c = useChannelFigures().find(x => x.key === "tiktok")!
  const [dateA, setDateA] = useState("")
  const [dateB, setDateB] = useState("")
  return (
    <div className="space-y-5 max-w-xl">
      <div className="flex items-center justify-between flex-wrap gap-2 pb-4 mb-1 border-b border-slate-100">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Activity className="w-5 h-5" /> TIKTOK SHOP</h1>
        <DateRangePicker a={dateA} b={dateB} variant="header" onApply={(a, b) => { setDateA(a); setDateB(b) }} />
      </div>
      <p className="text-sm text-slate-500">Orders &amp; Net Profit from TikTok Shop. Connects to the TikTok Shop API (to follow) — sales, ad spend, affiliate commission and COG roll up into the channel net below.</p>
      <ChannelNetCard c={c} />
    </div>
  )
}
