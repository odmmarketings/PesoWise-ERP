"use client"
import { useState, useEffect, useCallback } from "react"
import { BarChart3, RefreshCw, Megaphone } from "lucide-react"
import { format, startOfMonth } from "date-fns"
import { useFBAccounts, actId } from "@/lib/fb-store"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"

function peso(n: number) { return "₱" + (isFinite(n) ? n : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function defaultDateA() { return format(startOfMonth(new Date()), "yyyy-MM-dd") }
function defaultDateB() { return format(new Date(), "yyyy-MM-dd") }

export default function AdsOverviewPage() {
  const fb = useFBAccounts()
  const [fbTotal, setFbTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [from, setFrom] = useState(defaultDateA())
  const [to, setTo] = useState(defaultDateB())

  const load = useCallback(async () => {
    if (fb.activeAccounts.length === 0) { setFbTotal(0); return }
    setLoading(true)
    let total = 0
    for (const a of fb.activeAccounts) {
      try {
        const res = await fetch(`/api/fb/insights?token=${encodeURIComponent(a.token)}&account_id=${encodeURIComponent(actId(a.ad_account_id))}&from=${from}&to=${to}`)
        const json = await res.json(); if (json.success) total += json.total || 0
      } catch {}
    }
    setFbTotal(total)
    setLoading(false)
  }, [fb.activeAccounts, from, to])
  useEffect(() => { load() /* eslint-disable-next-line */ }, [fb.accounts.length, from, to])

  const platforms = [
    { name: "Facebook", spend: fbTotal, accent: "from-blue-600 to-blue-700", live: true },
    { name: "TikTok", spend: 0, accent: "from-slate-800 to-black", live: false },
    { name: "Shopee", spend: 0, accent: "from-orange-500 to-orange-600", live: false },
    { name: "Lazada", spend: 0, accent: "from-indigo-500 to-purple-600", live: false },
  ]
  const grand = platforms.reduce((s, p) => s + p.spend, 0)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2 pb-4 mb-1 border-b border-slate-100">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><BarChart3 className="w-5 h-5" /> ADS OVERVIEW</h1>
        <div className="flex items-center gap-2">
          <DateRangePicker a={from} b={to} variant="header"
            onApply={(a, b) => { setFrom(a || defaultDateA()); setTo(b || defaultDateB()) }} placeholder="This month" />
          <button onClick={load} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></button>
        </div>
      </div>
      <p className="text-sm text-slate-500">All-platform ad spend ({format(new Date(from), "MMM dd")} – {format(new Date(to), "MMM dd")}).</p>

      {/* Nagsasalansan sa cellphone — pumapatong ang label at halaga kapag magkatabi */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 text-white p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <span className="text-sm font-semibold uppercase tracking-wider opacity-80">Total Ad Spend<br className="hidden sm:block" /> (all platforms)</span>
        <span className="text-2xl sm:text-3xl font-extrabold tabular-nums">{peso(grand)}</span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {platforms.map(p => (
          <div key={p.name} className={`relative overflow-hidden rounded-2xl p-3.5 sm:p-4 text-white bg-gradient-to-br ${p.accent}`}>
            <div className="text-[11px] uppercase tracking-wider opacity-90 flex items-center gap-1.5">{p.name} {!p.live && <span className="text-[9px] bg-white/20 px-1.5 py-0.5 rounded">soon</span>}</div>
            <div className="text-xl sm:text-2xl font-bold mt-1 tabular-nums">{peso(p.spend)}</div>
            <div className="text-xs opacity-80 mt-0.5">{grand > 0 ? ((p.spend / grand) * 100).toFixed(1) : "0"}% of total</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 text-sm text-slate-500 flex items-start gap-2">
        <Megaphone className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
        Facebook is live from your registered ad accounts ({fb.activeAccounts.length} active). TikTok / Shopee / Lazada light up once their API tokens are connected.
      </div>
    </div>
  )
}
