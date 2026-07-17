"use client"
import { useState, useMemo } from "react"
import { Calendar, ChevronDown, Check } from "lucide-react"
import { format, startOfDay, endOfDay, startOfMonth, endOfMonth, subMonths, subDays } from "date-fns"

// Shared date-range dropdown used across ADS + SALES CHANNELS. Default = "This month".
const PRESETS = ["Today", "Yesterday", "Last 7 days", "Last 14 days", "Last 30 days", "This month", "Last month", "Maximum"]

export function getPresetRange(preset: string): { from: Date; to: Date } {
  const now = new Date()
  switch (preset) {
    case "Today": return { from: startOfDay(now), to: endOfDay(now) }
    case "Yesterday": return { from: startOfDay(subDays(now, 1)), to: endOfDay(subDays(now, 1)) }
    case "Last 7 days": return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) }
    case "Last 14 days": return { from: startOfDay(subDays(now, 13)), to: endOfDay(now) }
    case "Last 30 days": return { from: startOfDay(subDays(now, 29)), to: endOfDay(now) }
    case "This month": return { from: startOfMonth(now), to: endOfMonth(now) }
    case "Last month": return { from: startOfMonth(subMonths(now, 1)), to: endOfMonth(subMonths(now, 1)) }
    // Maximum = widest range the Meta API allows for time_range (≈ last 37 months → today).
    case "Maximum": return { from: startOfDay(subMonths(now, 37)), to: endOfDay(now) }
    default: return { from: startOfMonth(now), to: endOfMonth(now) }
  }
}

export type RangeValue = { preset: string; customFrom: string; customTo: string }
export const DEFAULT_RANGE: RangeValue = { preset: "This month", customFrom: "", customTo: "" }

export function resolveRange(v: RangeValue): { from: Date; to: Date } {
  if (v.preset === "Custom" && v.customFrom && v.customTo) return { from: new Date(v.customFrom), to: new Date(v.customTo) }
  return getPresetRange(v.preset)
}

export function DateRangeFilter({ value, onChange }: { value: RangeValue; onChange: (v: RangeValue) => void }) {
  const [open, setOpen] = useState(false)
  const isCustom = value.preset === "Custom"
  const label = useMemo(() => {
    const { from, to } = resolveRange(value)
    return `${format(from, "MMM dd, yyyy")} - ${format(to, "MMM dd, yyyy")}`.toUpperCase()
  }, [value])

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 h-9 px-3 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm tracking-wide">
        <Calendar className="w-3.5 h-3.5 text-slate-400" /> {label}
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-40 w-56 py-1">
            {PRESETS.map(p => (
              <button key={p} onClick={() => { onChange({ ...value, preset: p }); setOpen(false) }}
                className={`w-full flex items-center justify-between px-4 py-2 text-sm transition-colors ${value.preset === p ? "bg-blue-50 text-blue-700 font-semibold" : "text-slate-700 hover:bg-slate-50"}`}>
                {p}{value.preset === p && <Check className="w-3.5 h-3.5" />}
              </button>
            ))}
            <div className="border-t border-slate-100 mt-1">
              <button onClick={() => onChange({ ...value, preset: "Custom" })}
                className={`w-full flex items-center justify-between px-4 py-2 text-sm transition-colors ${isCustom ? "bg-blue-50 text-blue-700 font-semibold" : "text-slate-700 hover:bg-slate-50"}`}>
                Custom range{isCustom && <Check className="w-3.5 h-3.5" />}
              </button>
              {isCustom && (
                <div className="px-3 pb-3 space-y-1.5 pt-1">
                  <input type="date" value={value.customFrom} onChange={e => onChange({ ...value, customFrom: e.target.value })}
                    className="w-full h-8 text-xs border border-slate-200 rounded-lg px-2 focus:outline-none focus:border-blue-400" />
                  <input type="date" value={value.customTo} onChange={e => onChange({ ...value, customTo: e.target.value })}
                    className="w-full h-8 text-xs border border-slate-200 rounded-lg px-2 focus:outline-none focus:border-blue-400" />
                  <button onClick={() => setOpen(false)} className="w-full h-7 bg-blue-600 text-white text-xs rounded-lg font-medium hover:bg-blue-700">Apply</button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
