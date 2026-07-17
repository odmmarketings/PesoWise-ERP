"use client"
import { Megaphone } from "lucide-react"

// Clean placeholder for modules whose data source (TikTok/Shopee/Lazada API) is
// still being wired. Keeps the route alive and explains what will land here.
export function ComingSoon({ title, icon: Icon = Megaphone, accent = "text-blue-600", points = [] as string[], note, right }: {
  title: string; icon?: any; accent?: string; points?: string[]; note?: string; right?: React.ReactNode
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2 pb-4 mb-1 border-b border-slate-100">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2">
          <Icon className="w-5 h-5" /> {title.toUpperCase()}
          <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">Coming soon</span>
        </h1>
        {right}
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
        <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
          <Icon className="w-7 h-7 text-slate-400" />
        </div>
        <p className="text-slate-600 font-medium">{title} integration is being wired.</p>
        {note && <p className="text-sm text-slate-400 mt-1 max-w-md mx-auto">{note}</p>}
        {points.length > 0 && (
          <ul className="mt-5 inline-block text-left text-sm text-slate-500 space-y-1.5">
            {points.map((p, i) => <li key={i} className="flex items-start gap-2"><span className="text-slate-300 mt-0.5">•</span>{p}</li>)}
          </ul>
        )}
      </div>
    </div>
  )
}
