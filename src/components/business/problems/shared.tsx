"use client"
import { X, Paperclip, Loader2, Trash2, FileText, ImageIcon, Film, Sheet } from "lucide-react"
import { useRef, useState } from "react"
import { uploadProblemFile, type Attachment } from "@/lib/problems-store"

// Mga maliliit na bahaging pinagsasaluhan ng Problem Management na mga modal.

export const INPUT = "w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white focus:outline-none focus:border-blue-400 disabled:bg-slate-50 disabled:text-slate-500"
export const AREA = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-400 disabled:bg-slate-50 disabled:text-slate-500"

export function Modal({ title, subtitle, icon: Icon, onClose, children, footer, width = "max-w-3xl" }: {
  title: string; subtitle?: string; icon?: any; onClose: () => void
  children: React.ReactNode; footer?: React.ReactNode; width?: string
}) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className={`bg-white rounded-2xl w-full ${width} shadow-2xl max-h-[92vh] flex flex-col overflow-hidden`}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between shrink-0">
          <div>
            <h2 className="font-bold text-slate-900 text-base flex items-center gap-2">
              {Icon && <Icon className="w-5 h-5 text-blue-600" />} {title}
            </h2>
            {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-auto flex-1">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 shrink-0">{footer}</div>}
      </div>
    </div>
  )
}

export function Field({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode
}) {
  return (
    <div>
      <label className="text-sm text-slate-600">{label}{required && <span className="text-red-500"> *</span>}</label>
      <div className="mt-1">{children}</div>
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  )
}

function iconFor(type: string) {
  if (type.startsWith("image/")) return ImageIcon
  if (type.startsWith("video/")) return Film
  if (/spreadsheet|excel|csv/.test(type)) return Sheet
  return FileText
}
const kb = (n: number) => n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`

/** Upload + listahan ng attachments. Nasa Supabase Storage (`problem-files`) ang mga file. */
export function AttachmentBox({ files, folder, onChange, disabled, label = "Attachments" }: {
  files: Attachment[]; folder: string; onChange: (next: Attachment[]) => void
  disabled?: boolean; label?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")

  async function pick(list: FileList | null) {
    if (!list?.length) return
    setBusy(true); setErr("")
    const added: Attachment[] = []
    for (const f of Array.from(list)) {
      try { added.push(await uploadProblemFile(f, folder)) }
      catch (e: any) { setErr(e?.message || "File upload failed.") }
    }
    if (added.length) onChange([...files, ...added])
    setBusy(false)
    if (inputRef.current) inputRef.current.value = ""
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="text-sm text-slate-600">{label}</label>
        {!disabled && (
          <button onClick={() => inputRef.current?.click()} disabled={busy}
            className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
            {busy ? "Uploading…" : "Add file"}
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" multiple className="hidden" onChange={e => pick(e.target.files)}
        accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" />
      {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
      {files.length === 0 ? (
        <p className="text-xs text-slate-400 italic mt-1.5">Nothing attached yet.</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {files.map((f, i) => {
            const Ico = iconFor(f.type)
            return (
              <li key={i} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 bg-white">
                <Ico className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <a href={f.url} target="_blank" rel="noreferrer"
                  className="text-sm text-blue-600 hover:underline truncate flex-1">{f.name}</a>
                <span className="text-[11px] text-slate-400">{kb(f.size)}</span>
                {!disabled && (
                  <button onClick={() => onChange(files.filter((_, x) => x !== i))}
                    className="text-slate-300 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
