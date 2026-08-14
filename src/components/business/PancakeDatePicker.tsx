"use client"
import { useState, useRef, useLayoutEffect } from "react"
import { createPortal } from "react-dom"
import { Calendar, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react"

// Pancake-style date-range picker — same popover (preset rail + Start/End inputs + dual-month
// calendar + Clear/Close/Apply, portaled to <body>) behind two closed-button looks:
//   variant="compact" (default) — small chip that fills its cell, used in table filter rows
//     (Fulfillment / Sales Tracker / Book Keeping / Reimbursement / Utility / Purchase Order /
//     Unit Codes / RTS).
//   variant="header" — bordered pill with the full "MMM DD, YYYY - MMM DD, YYYY" label + a
//     trailing chevron, sized to its content (not full-width). Used in page-header date filters
//     (ROAS Tracker, Adspent Summary, Income Statement, Finance Overview, Dashboard, Ads/Channel
//     pages) — anywhere the old bespoke DateDropdown used to live.

const pfmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const DATE_PRESETS: { l: string; range: () => { a: string; b: string } }[] = [
  { l: "Today", range: () => { const t = pfmt(new Date()); return { a: t, b: t } } },
  { l: "Yesterday", range: () => { const y = pfmt(new Date(Date.now() - 86400000)); return { a: y, b: y } } },
  { l: "Last 7 days", range: () => ({ a: pfmt(new Date(Date.now() - 6 * 86400000)), b: pfmt(new Date()) }) },
  { l: "Last 14 days", range: () => ({ a: pfmt(new Date(Date.now() - 13 * 86400000)), b: pfmt(new Date()) }) },
  { l: "Last 30 days", range: () => ({ a: pfmt(new Date(Date.now() - 29 * 86400000)), b: pfmt(new Date()) }) },
  { l: "This month", range: () => { const n = new Date(); return { a: pfmt(new Date(n.getFullYear(), n.getMonth(), 1)), b: pfmt(n) } } },
  { l: "Last month", range: () => { const n = new Date(); return { a: pfmt(new Date(n.getFullYear(), n.getMonth() - 1, 1)), b: pfmt(new Date(n.getFullYear(), n.getMonth(), 0)) } } },
]
// "Maximum" — 37 buwan pabalik, ang pinakamalayong maibibigay ng Meta insights
// (iyon mismo ang tawag dito ng Ads Manager ni Meta). OPT-IN kada picker
// (`withMax`): ang parehong component ay ginagamit ng mga Pancake na pahina, at
// ang 3-taóng hila sa Pancake orders API ay mag-ti-timeout lang — doon, walang
// ganitong preset na dapat lumitaw.
const MAX_PRESET = { l: "Maximum", range: () => { const n = new Date(); return { a: pfmt(new Date(n.getFullYear(), n.getMonth() - 37, n.getDate())), b: pfmt(n) } } }
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function MonthGrid({ year, month, selA, selB, onPick }: { year: number; month: number; selA: string; selB: string; onPick: (d: string) => void }) {
  const first = new Date(year, month, 1)
  const start = new Date(year, month, 1 - first.getDay())          // grid starts on Sunday
  const cells = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  const today = pfmt(new Date())
  return (
    <div className="w-[218px]">
      <p className="text-center text-sm font-semibold text-slate-800 mb-1.5">{MONTH_NAMES[month]} {year}</p>
      <div className="grid grid-cols-7 text-center text-[11px] text-slate-400 mb-1">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(d => <span key={d}>{d}</span>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          const ds = pfmt(d)
          const inMonth = d.getMonth() === month
          const isSel = ds === selA || ds === selB
          const inRange = selA && selB && ds > selA && ds < selB
          return (
            <button key={i} type="button" onClick={() => onPick(ds)}
              className={`h-7 text-xs rounded ${isSel ? "bg-blue-600 text-white font-semibold"
                : inRange ? "bg-blue-50 text-blue-700"
                : inMonth ? "text-slate-700 hover:bg-slate-100" : "text-slate-300 hover:bg-slate-50"}
                ${ds === today && !isSel ? "ring-1 ring-blue-400" : ""}`}>
              {d.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const fmtFull = (ds: string) => { const d = new Date(ds); return `${MONTH_NAMES[d.getMonth()].toUpperCase()} ${String(d.getDate()).padStart(2, "0")}, ${d.getFullYear()}` }

export function DateRangePicker({ a, b, onApply, placeholder = "All", variant = "compact", withMax = false }: {
  a: string; b: string; onApply: (a: string, b: string) => void; placeholder?: string; variant?: "compact" | "header"
  /** Isama ang "Maximum" (37 buwan — hangganan ng Meta insights). Para sa FB Ads lang. */
  withMax?: boolean
}) {
  const presets = withMax ? [...DATE_PRESETS, MAX_PRESET] : DATE_PRESETS
  const [open, setOpen] = useState(false)
  const [selA, setSelA] = useState(a)
  const [selB, setSelB] = useState(b)
  const [view, setView] = useState(() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() } })
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })

  const openPicker = () => {
    setSelA(a); setSelB(b)
    const base = a ? new Date(a) : new Date()
    setView({ y: base.getFullYear(), m: base.getMonth() })
    const r = btnRef.current?.getBoundingClientRect()
    // Rough guess for the first paint — refined below in useLayoutEffect once the panel's
    // real size is known, so it never renders clipped off the right/bottom edge.
    if (r) setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 700)), top: Math.min(r.bottom + 6, Math.max(8, window.innerHeight - 420)) })
    setOpen(true)
  }

  // Re-clamp against the panel's ACTUAL rendered size (varies with content) so it never
  // overflows the viewport — runs before paint, so no visible jump.
  useLayoutEffect(() => {
    if (!open || !panelRef.current) return
    const panel = panelRef.current.getBoundingClientRect()
    setPos(p => ({
      left: Math.min(Math.max(8, p.left), Math.max(8, window.innerWidth - panel.width - 8)),
      top: Math.min(Math.max(8, p.top), Math.max(8, window.innerHeight - panel.height - 8)),
    }))
  }, [open])
  const pick = (ds: string) => {
    if (!selA || (selA && selB) || ds < selA) { setSelA(ds); setSelB("") }
    else setSelB(ds)
  }
  const nav = (delta: number) => setView(v => { const d = new Date(v.y, v.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() } })
  const next = new Date(view.y, view.m + 1, 1)
  const label = variant === "header"
    ? (a && b ? `${fmtFull(a)} - ${fmtFull(b)}` : placeholder)
    : a && b ? (a === b ? a : `${a.slice(5)} → ${b.slice(5)}`) : a ? `${a} →` : placeholder
  const activePreset = presets.find(p => { const r = p.range(); return r.a === selA && r.b === selB })?.l

  return (
    <>
      {variant === "header" ? (
        <button ref={btnRef} type="button" onClick={openPicker}
          className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm tracking-wide">
          <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span>{label}</span>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        </button>
      ) : (
        <button ref={btnRef} type="button" onClick={openPicker}
          className={`w-full h-8 rounded border border-slate-300 bg-white px-2 text-xs flex items-center gap-1.5 hover:border-blue-400 min-w-[120px] ${a ? "text-slate-800 font-medium" : "text-slate-400"}`}>
          <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="truncate">{label}</span>
        </button>
      )}
      {open && typeof document !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
          <div ref={panelRef} className="fixed z-[95] bg-white border border-slate-200 rounded-xl shadow-2xl flex" style={{ left: pos.left, top: pos.top }}>
            {/* Preset rail */}
            <div className="w-[130px] border-r border-slate-100 py-2">
              {presets.map(p => (
                <button key={p.l} type="button" onClick={() => { const r = p.range(); setSelA(r.a); setSelB(r.b); const d = new Date(r.a); setView({ y: d.getFullYear(), m: d.getMonth() }) }}
                  className={`w-full text-left px-4 py-1.5 text-[13px] ${activePreset === p.l ? "text-blue-600 font-semibold" : "text-slate-700 hover:bg-slate-50"}`}>
                  {p.l}
                </button>
              ))}
            </div>
            {/* Calendar side */}
            <div className="p-3">
              <div className="flex items-center gap-2 pb-2 mb-2 border-b border-slate-100">
                <input type="date" value={selA} onChange={e => setSelA(e.target.value)}
                  className="h-8 flex-1 text-xs border-b border-slate-300 px-1 focus:outline-none focus:border-blue-500" placeholder="Start date" />
                <span className="text-slate-400 text-xs">→</span>
                <input type="date" value={selB} onChange={e => setSelB(e.target.value)}
                  className="h-8 flex-1 text-xs border-b border-slate-300 px-1 focus:outline-none focus:border-blue-500" placeholder="End date" />
              </div>
              <div className="flex items-start gap-4">
                <button type="button" onClick={() => nav(-1)} className="mt-0.5 p-1 rounded hover:bg-slate-100 text-slate-500"><ChevronLeft className="w-4 h-4" /></button>
                <MonthGrid year={view.y} month={view.m} selA={selA} selB={selB} onPick={pick} />
                <MonthGrid year={next.getFullYear()} month={next.getMonth()} selA={selA} selB={selB} onPick={pick} />
                <button type="button" onClick={() => nav(1)} className="mt-0.5 p-1 rounded hover:bg-slate-100 text-slate-500"><ChevronRight className="w-4 h-4" /></button>
              </div>
              <div className="flex items-center justify-between pt-2 mt-1 border-t border-slate-100">
                <button type="button" onClick={() => { onApply("", ""); setOpen(false) }} className="px-3 py-1.5 rounded-lg text-sm text-slate-500 hover:bg-slate-50">Clear</button>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setOpen(false)} className="px-3.5 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50">Close</button>
                  <button type="button" onClick={() => { onApply(selA, selB || selA); setOpen(false) }} disabled={!selA}
                    className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-40">Apply</button>
                </div>
              </div>
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  )
}
