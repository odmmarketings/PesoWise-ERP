"use client"
import { useState, useEffect, useCallback } from "react"
import { DollarSign, RefreshCw } from "lucide-react"
import { format, startOfMonth } from "date-fns"
import { useFBAccounts, actId } from "@/lib/fb-store"

const peso = (n: number) => "₱" + (isFinite(n) ? n : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function AdSpendReportPage() {
  const fb = useFBAccounts()
  const [fbTotal, setFbTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const from = format(startOfMonth(new Date()), "yyyy-MM-dd"), to = format(new Date(), "yyyy-MM-dd")

  const load = useCallback(async () => {
    if (fb.activeAccounts.length === 0) { setFbTotal(0); return }
    setLoading(true); let total = 0
    for (const a of fb.activeAccounts) {
      try { const r = await fetch(`/api/fb/insights?token=${encodeURIComponent(a.token)}&account_id=${encodeURIComponent(actId(a.ad_account_id))}&from=${from}&to=${to}`); const j = await r.json(); if (j.success) total += j.total || 0 } catch {}
    }
    setFbTotal(total); setLoading(false)
  }, [fb.activeAccounts, from, to])
  useEffect(() => { load() /* eslint-disable-next-line */ }, [fb.accounts.length])

  const rows = [
    { p: "Facebook", v: fbTotal, live: true },
    { p: "TikTok", v: 0, live: false },
    { p: "Shopee", v: 0, live: false },
    { p: "Lazada", v: 0, live: false },
  ]
  const total = rows.reduce((s, r) => s + r.v, 0)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between pb-4 mb-1 border-b border-slate-100">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><DollarSign className="w-5 h-5" /> AD SPEND REPORT</h1>
        <button onClick={load} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></button>
      </div>
      <p className="text-sm text-slate-500">Ad spend across all platforms this month. Facebook is live from registered ad accounts.</p>
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-200 bg-slate-50 text-left">{["Platform", "Ad Spend", "Source"].map(h => <th key={h} className="px-4 py-2.5 font-semibold text-slate-600">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.p} className="border-b border-slate-100"><td className="px-4 py-2.5 font-medium">{r.p}</td><td className="px-4 py-2.5 tabular-nums text-blue-600 font-medium">{peso(r.v)}</td><td className="px-4 py-2.5 text-xs text-slate-400">{r.live ? "Meta API (live)" : "API to follow"}</td></tr>
            ))}
            <tr className="bg-amber-50 font-bold"><td className="px-4 py-2.5">TOTAL AD SPEND</td><td className="px-4 py-2.5 tabular-nums">{peso(total)}</td><td /></tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
