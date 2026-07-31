"use client"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CalendarDays, RefreshCw, Trash2, X } from "lucide-react"
import { useHrHolidays, HOLIDAY_TYPES, type HolidayType, uid } from "@/lib/hr-store"
import { isMotherAccount } from "@/lib/users-store"

// HOLIDAY — pinagkukunan ng "Today's Holiday" banner sa HR Dashboard at ng
// Events & Holidays sa ODM DTR. Tatlong uri, kapareho ng LHIKE legend:
// Regular (pink) · Special (teal) · Double (purple).

const INP = "h-9 rounded-lg border border-slate-300 px-2 text-sm bg-white focus:outline-none focus:border-blue-400"
const prettyDate = (s: string) => {
  const d = new Date(s + "T00:00:00")
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })
}

export default function HrHolidayPage() {
  const store = useHrHolidays()
  const [d, setD] = useState({ date: "", name: "", type: "regular" as HolidayType })
  const [err, setErr] = useState("")

  const sorted = useMemo(() => [...store.rows].sort((a, b) => a.date.localeCompare(b.date)), [store.rows])
  const typeOf = (k: string) => HOLIDAY_TYPES.find(t => t.key === k) || HOLIDAY_TYPES[0]

  if (!isMotherAccount()) {
    return <p className="text-sm text-slate-500 py-10 text-center">HR Mode is for the Mother Account only.</p>
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <div className="flex items-center justify-between pb-4 border-b border-slate-100">
        <h1 className="flex items-center gap-2 text-lg font-bold text-blue-600"><CalendarDays className="w-5 h-5" /> HOLIDAY</h1>
        <button onClick={() => store.refresh()} title="Refresh"
          className="h-10 w-10 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50 flex items-center justify-center">
          <RefreshCw className={`w-4 h-4 ${!store.loaded ? "animate-spin" : ""}`} />
        </button>
      </div>

      {err && <p className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 flex items-center gap-2"><X className="w-4 h-4" /> {err}</p>}

      <div className="flex items-end gap-2 flex-wrap mt-4">
        <div><p className="text-xs text-slate-500 mb-1">Date</p><input type="date" className={INP} value={d.date} onChange={e => setD(p => ({ ...p, date: e.target.value }))} /></div>
        <div className="flex-1 min-w-[200px]"><p className="text-xs text-slate-500 mb-1">Holiday name</p>
          <Input value={d.name} placeholder="e.g. National Heroes Day" onChange={e => setD(p => ({ ...p, name: e.target.value }))} /></div>
        <div><p className="text-xs text-slate-500 mb-1">Type</p>
          <select className={INP} value={d.type} onChange={e => setD(p => ({ ...p, type: e.target.value as HolidayType }))}>
            {HOLIDAY_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select></div>
        <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={async () => {
          setErr("")
          if (!d.date || !d.name.trim()) { setErr("Date and holiday name are required."); return }
          try { await store.add({ id: uid("hol"), date: d.date, name: d.name.trim(), type: d.type }); setD({ date: "", name: "", type: "regular" }) }
          catch (e: any) { setErr(e?.message || "Could not save.") }
        }}>Add Holiday</Button>
      </div>

      <div className="flex items-center gap-4 mt-5 text-xs text-slate-600">
        {HOLIDAY_TYPES.map(t => (
          <span key={t.key} className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: t.color }} /> {t.label}</span>
        ))}
      </div>

      <div className="mt-3 divide-y divide-slate-100">
        {store.loaded && sorted.length === 0 && <p className="py-8 text-sm text-slate-400 italic text-center">No holidays yet — add the PH holiday calendar above.</p>}
        {sorted.map(h => (
          <div key={h.id} className="py-2.5 flex items-center gap-3">
            <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: typeOf(h.type).color }} />
            <span className="text-sm font-semibold text-slate-800 w-44 shrink-0">{prettyDate(h.date)}</span>
            <span className="text-sm text-slate-700 flex-1">{h.name}</span>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: `${typeOf(h.type).color}22`, color: typeOf(h.type).color }}>{typeOf(h.type).label}</span>
            <button onClick={() => store.remove(h.id)} title="Delete"
              className="h-8 w-8 rounded-lg text-slate-300 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>
    </div>
  )
}
