"use client"
import { useState } from "react"
import { Eye, EyeOff } from "lucide-react"

// ──────────────────────────────────────────────────────────────────────────────
// CONFIDENTIAL — nakatagong halaga na may per-row na 👁 reveal.
//
// Pareho ng ginagawa ng CARDS sa card number/CVV: PINAPALITAN ang teksto habang
// nakatago, hindi lang nilalabo. Mahalaga ito — ang blur ay nasa CSS lang, kaya
// nababasa pa rin ang totoong pangalan sa DOM (Inspect Element) at nawawala kapag
// naka-screenshot nang may zoom. Sa mask, wala talaga sa page ang totoong halaga
// hangga't hindi pinipindot ang mata.
//
// FIXED ang haba ng mask: kung sinusundan nito ang totoong haba, mahuhulaan pa rin
// kung aling supplier ang alin sa haba lang nito.
// ──────────────────────────────────────────────────────────────────────────────

const MASK = "••••••••"

export function Confidential({ value, className = "", forceShow = false }: {
  value: string
  /** Klase ng teksto kapag nakabukas — para tumugma sa hitsura ng column. */
  className?: string
  /** Binubuksan ng page-level na "Show" toggle; itinatago ang per-row na buton. */
  forceShow?: boolean
}) {
  const [shown, setShown] = useState(false)
  if (!value) return <span className="text-slate-300">—</span>

  const visible = forceShow || shown
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0 max-w-full">
      <span
        className={visible ? `truncate ${className}` : "truncate text-slate-400 tracking-[0.25em] select-none"}
        // Ang title ay ilalagay LANG kapag nakabukas — kung hindi, lalabas ang
        // totoong pangalan sa hover kahit nakatago.
        title={visible ? value : undefined}
      >
        {visible ? value : MASK}
      </span>
      {!forceShow && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); setShown(v => !v) }}
          title={shown ? "Itago" : "Ipakita"}
          aria-label={shown ? "Itago ang pangalan" : "Ipakita ang pangalan"}
          className="shrink-0 text-slate-400 hover:text-slate-700 transition-colors"
        >
          {shown ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      )}
    </span>
  )
}

/**
 * Page-level na "Show/Hide all" na buton. Sinasadyang HINDI ito naaalala sa
 * localStorage — nakatago ang default sa bawat pagbukas, dahil ang naaalalang
 * "naka-show" ay katumbas ng walang tago.
 */
export function ConfidentialToggle({ shown, onToggle, label = "supplier names" }: {
  shown: boolean; onToggle: () => void; label?: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50 shadow-sm whitespace-nowrap"
    >
      {shown ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      {shown ? `Hide ${label}` : `Show ${label}`}
    </button>
  )
}
