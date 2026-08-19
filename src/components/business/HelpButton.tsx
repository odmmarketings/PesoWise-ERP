"use client"
import { useState } from "react"
import { Info, X } from "lucide-react"

// ──────────────────────────────────────────────────────────────────────────────
// HELP BUTTON — isang ⓘ na bilog sa tabi ng pamagat ng page. Pinindot → modal ng
// paliwanag kung paano gumagana ang module.
//
// BAKIT MODAL AT HINDI TOOLTIP: mahaba ang mga paliwanag na ito (paano gumagana ang
// FIFO, saan tumutugma ang unit code) at binabasa ang mga ito habang may ginagawa —
// kailangang manatili hanggang isara, hindi mawala pag-alis ng cursor. Sa cellphone
// naman, walang hover.
//
// Ang laman ay puro TEKSTO na ipinapasa ng page (`sections`), kaya walang lohika rito
// na puwedeng maiwan ng panahon — kapag nagbago ang gawi ng module, sa page mismo
// nakalagay ang teksto, katabi ng code na inilalarawan nito.
// ──────────────────────────────────────────────────────────────────────────────

export type HelpSection = { title: string; body: string[] }

export function HelpButton({ title, sections }: { title: string; sections: HelpSection[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Paano ito gumagana?"
        aria-label="Paano ito gumagana?"
        className="shrink-0 w-6 h-6 rounded-full border border-slate-300 flex items-center justify-center text-slate-400 hover:text-blue-600 hover:border-blue-400 transition-colors"
      >
        <Info className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[88vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
              <h2 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <Info className="w-5 h-5 text-blue-600 shrink-0" /> {title}
              </h2>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700 shrink-0"><X className="w-5 h-5" /></button>
            </div>

            <div className="px-5 py-4 space-y-4 overflow-auto">
              {sections.map((sec, i) => (
                <div key={i}>
                  <p className="text-sm font-bold text-slate-800 mb-1">{sec.title}</p>
                  {sec.body.map((line, j) => (
                    // Ang linyang nagsisimula sa ⚠ ay babala — kulay amber at may kahon,
                    // para hindi ito maging kapareho ng karaniwang paalala.
                    line.startsWith("⚠")
                      ? <p key={j} className="text-[13px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed mt-1.5">{line}</p>
                      : <p key={j} className="text-[13px] text-slate-600 leading-relaxed mt-1">{line}</p>
                  ))}
                </div>
              ))}
            </div>

            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
              <button onClick={() => setOpen(false)} className="h-9 px-5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold">Naintindihan ko</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
