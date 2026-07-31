"use client"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PartyPopper, RefreshCw, Trash2, X } from "lucide-react"
import { useHrEvents, uid } from "@/lib/hr-store"
import { isMotherAccount } from "@/lib/users-store"

// EVENTS — company events (team building, town hall, atbp.). Lumalabas sa HR
// Dashboard Events tab at sa ODM DTR Events & Holidays.

const INP = "h-9 rounded-lg border border-slate-300 px-2 text-sm bg-white focus:outline-none focus:border-blue-400"
const prettyDate = (s: string) => {
  const d = new Date(s + "T00:00:00")
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })
}

export default function HrEventsPage() {
  const store = useHrEvents()
  const [d, setD] = useState({ date: "", name: "", description: "" })
  const [err, setErr] = useState("")
  const sorted = useMemo(() => [...store.rows].sort((a, b) => a.date.localeCompare(b.date)), [store.rows])

  if (!isMotherAccount()) {
    return <p className="text-sm text-slate-500 py-10 text-center">HR Mode is for the Mother Account only.</p>
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <div className="flex items-center justify-between pb-4 border-b border-slate-100">
        <h1 className="flex items-center gap-2 text-lg font-bold text-blue-600"><PartyPopper className="w-5 h-5" /> EVENTS</h1>
        <button onClick={() => store.refresh()} title="Refresh"
          className="h-10 w-10 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50 flex items-center justify-center">
          <RefreshCw className={`w-4 h-4 ${!store.loaded ? "animate-spin" : ""}`} />
        </button>
      </div>

      {err && <p className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 flex items-center gap-2"><X className="w-4 h-4" /> {err}</p>}

      <div className="flex items-end gap-2 flex-wrap mt-4">
        <div><p className="text-xs text-slate-500 mb-1">Date</p><input type="date" className={INP} value={d.date} onChange={e => setD(p => ({ ...p, date: e.target.value }))} /></div>
        <div className="flex-1 min-w-[180px]"><p className="text-xs text-slate-500 mb-1">Event name</p>
          <Input value={d.name} placeholder="e.g. Team Building" onChange={e => setD(p => ({ ...p, name: e.target.value }))} /></div>
        <div className="flex-1 min-w-[220px]"><p className="text-xs text-slate-500 mb-1">Description (optional)</p>
          <Input value={d.description} onChange={e => setD(p => ({ ...p, description: e.target.value }))} /></div>
        <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={async () => {
          setErr("")
          if (!d.date || !d.name.trim()) { setErr("Date and event name are required."); return }
          try { await store.add({ id: uid("evt"), date: d.date, name: d.name.trim(), description: d.description.trim() }); setD({ date: "", name: "", description: "" }) }
          catch (e: any) { setErr(e?.message || "Could not save.") }
        }}>Add Event</Button>
      </div>

      <div className="mt-5 divide-y divide-slate-100">
        {store.loaded && sorted.length === 0 && <p className="py-8 text-sm text-slate-400 italic text-center">No events yet.</p>}
        {sorted.map(e => (
          <div key={e.id} className="py-2.5 flex items-center gap-3">
            <span className="text-sm font-semibold text-slate-800 w-44 shrink-0">{prettyDate(e.date)}</span>
            <div className="flex-1">
              <p className="text-sm text-slate-800 font-medium">{e.name}</p>
              {e.description && <p className="text-xs text-slate-500">{e.description}</p>}
            </div>
            <button onClick={() => store.remove(e.id)} title="Delete"
              className="h-8 w-8 rounded-lg text-slate-300 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>
    </div>
  )
}
