"use client"
import { useState } from "react"

// ──────────────────────────────────────────────────────────────────────────────
// Shared searchable "Owner" dropdown (Pages & Store, Ad Accounts): lists the
// EXISTING page/store owners only (people who actually registered pages — not the
// whole User Management roster), and still accepts free text for a new owner.
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_INP = "w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"

export function OwnerCombo({ value, onChange, options, inputClassName, placeholder }: {
  value: string
  onChange: (v: string) => void
  options: string[]
  inputClassName?: string
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const filtered = options.filter(o => o.toLowerCase().includes((open ? q : "").toLowerCase()))
  return (
    <div className="relative w-full">
      <input className={inputClassName || DEFAULT_INP} value={open ? q : value}
        placeholder={placeholder || "Search or type owner…"} spellCheck={false}
        onFocus={() => { setQ(value); setOpen(true) }}
        onChange={e => { setQ(e.target.value); onChange(e.target.value); setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && filtered.length > 0 && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-auto scrollbar-dark">
          {filtered.map(o => (
            <button key={o} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
              onMouseDown={() => { onChange(o); setQ(o); setOpen(false) }}>{o}</button>
          ))}
        </div>
      )}
    </div>
  )
}
