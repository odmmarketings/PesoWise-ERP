"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import { X, Send, MessageSquare, AtSign, Check, CheckCheck, Undo2 } from "lucide-react"
import { useAdsComments, rosterPeople, type RosterPick } from "@/lib/ads-comments-store"
import { currentUserEmail } from "@/lib/current-user"
import { agoLabel } from "@/lib/notify"

// Usapan sa isang campaign / ad set / ad. Ang "@" ay nagbubukas ng picker ng
// tao; ang na-tag ay tumatanggap ng abiso pagkatapos mag-post.

export function CommentsModal({ objectId, level, name, account, href, onClose, onPosted }: {
  objectId: string; level: string; name: string; account: string; href: string
  onClose: () => void
  onPosted?: () => void
}) {
  const { open: openItems, done, loading, error, add, resolve, unresolve, resolveAll } = useAdsComments(objectId)
  const [showDone, setShowDone] = useState(false)
  const items = showDone ? done : openItems
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [pickOpen, setPickOpen] = useState(false)
  const [pickQ, setPickQ] = useState("")
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const people = useMemo(() => rosterPeople(), [])
  const me = (currentUserEmail() || "").toLowerCase()

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }) }, [items.length])

  // Ang "@" na kasusulat lang ang nagbubukas ng picker; ang sinusulat pagkatapos
  // nito ang salaan.
  const onChange = (v: string) => {
    setBody(v)
    const at = v.lastIndexOf("@")
    if (at === -1) { setPickOpen(false); return }
    const after = v.slice(at + 1)
    if (/\s{2,}|\n/.test(after)) { setPickOpen(false); return }
    setPickQ(after.toLowerCase())
    setPickOpen(true)
  }
  const insert = (p: RosterPick) => {
    const at = body.lastIndexOf("@")
    setBody(`${body.slice(0, at)}@${p.name} `)
    setPickOpen(false)
    inputRef.current?.focus()
  }
  const matches = people.filter(p => !pickQ || p.name.toLowerCase().includes(pickQ)).slice(0, 6)

  const post = async () => {
    if (!body.trim() || busy) return
    setBusy(true)
    await add(body, { level, name, account, href })
    setBody(""); setPickOpen(false); setBusy(false)
    onPosted?.()
  }

  // Ang na-tag na pangalan ay binibigyang-diin sa pagbasa.
  const render = (text: string) => {
    const parts: React.ReactNode[] = []
    let rest = text
    let guard = 0
    while (guard++ < 50) {
      const hit = people
        .map(p => ({ p, i: rest.toLowerCase().indexOf(`@${p.name.toLowerCase()}`) }))
        .filter(x => x.i >= 0)
        .sort((a, b) => a.i - b.i || b.p.name.length - a.p.name.length)[0]
      if (!hit) break
      parts.push(rest.slice(0, hit.i))
      parts.push(<b key={`${guard}`} className="text-blue-600">@{hit.p.name}</b>)
      rest = rest.slice(hit.i + hit.p.name.length + 1)
    }
    parts.push(rest)
    return parts
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-bold text-slate-800 flex items-center gap-1.5"><MessageSquare className="w-4 h-4" /> Comments</p>
            <p className="text-[12px] text-slate-500 truncate">{name} · {account} · {level}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 shrink-0"><X className="w-5 h-5" /></button>
        </div>

        {/* Bukas vs na-acknowledge — gaya ng Google Sheets, nawawala sa tanawin
            ang na-resolve pero nananatiling mababasa. */}
        <div className="px-5 py-2 border-b border-slate-100 flex items-center gap-2">
          <button onClick={() => setShowDone(false)}
            className={`text-[12px] px-2.5 py-1 rounded-full ${!showDone ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
            Open ({openItems.length})
          </button>
          <button onClick={() => setShowDone(true)}
            className={`text-[12px] px-2.5 py-1 rounded-full ${showDone ? "bg-slate-700 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
            Resolved ({done.length})
          </button>
          {!showDone && openItems.length > 0 && (
            <button onClick={resolveAll} title="Acknowledge everything here"
              className="ml-auto text-[12px] font-semibold text-emerald-600 hover:bg-emerald-50 px-2 py-1 rounded-lg flex items-center gap-1">
              <CheckCheck className="w-3.5 h-3.5" /> Resolve all
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3 min-h-[160px]">
          {error ? <p className="text-[13px] text-rose-600">{error}</p>
            : loading && items.length === 0 ? <p className="text-[13px] text-slate-400">Loading…</p>
            : items.length === 0 ? (
              <p className="text-[13px] text-slate-400 italic">
                {showDone
                  ? "Wala pang na-acknowledge."
                  : done.length > 0
                    ? "Lahat ay na-acknowledge na. Tingnan ang Resolved para sa kasaysayan."
                    : "Wala pang komento. Isulat kung bakit mo ito pinatay, sinukat, o sinalang — para may makita ang susunod na titingin."}
              </p>
            ) : items.map(c => (
              <div key={c.id} className={`rounded-lg px-3 py-2 group ${c.resolved ? "bg-slate-50 opacity-70" : c.author_email === me ? "bg-blue-50" : "bg-slate-50"}`}>
                <p className="text-[12px] font-semibold text-slate-700 flex items-center gap-1.5">
                  {c.author_name || "Unknown"} <span className="font-normal text-slate-400">· {agoLabel(c.created_at)}</span>
                  {c.resolved ? (
                    <button onClick={() => unresolve(c.id)} title="Bring it back"
                      className="ml-auto text-[11px] text-slate-400 hover:text-blue-600 flex items-center gap-1">
                      <Undo2 className="w-3 h-3" /> Reopen
                    </button>
                  ) : (
                    <button onClick={() => resolve(c.id)} title="Acknowledge — mawawala ito sa Open"
                      className="ml-auto text-[11px] text-slate-400 hover:text-emerald-600 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus:opacity-100">
                      <Check className="w-3.5 h-3.5" /> Resolve
                    </button>
                  )}
                </p>
                <p className="text-[13px] text-slate-700 whitespace-pre-wrap break-words">{render(c.body)}</p>
                {c.resolved && c.resolved_by && (
                  <p className="text-[11px] text-emerald-600 mt-1">✓ acknowledged by {c.resolved_by}{c.resolved_at ? ` · ${agoLabel(c.resolved_at)}` : ""}</p>
                )}
              </div>
            ))}
          <div ref={endRef} />
        </div>

        {/* Ang Resolved ay KASAYSAYAN — walang isinusulat doon; ang bagong
            komento ay laging pumapasok sa Open. */}
        <div className={`px-5 py-3 border-t border-slate-200 relative ${showDone ? "hidden" : ""}`}>
          {pickOpen && matches.length > 0 && (
            <div className="absolute bottom-full left-5 right-5 mb-1 bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden z-10">
              {matches.map(p => (
                <button key={p.email} onClick={() => insert(p)}
                  className="w-full text-left px-3 py-2 text-[13px] hover:bg-blue-50 flex items-center gap-2">
                  <AtSign className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="font-medium text-slate-700">{p.name}</span>
                  <span className="text-[11px] text-slate-400 truncate ml-auto">{p.email}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2 items-end">
            <textarea ref={inputRef} value={body} onChange={e => onChange(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post() }}
              rows={2} placeholder="Isulat ang komento… gamitin ang @ para mag-tag"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm resize-none" />
            <button onClick={post} disabled={!body.trim() || busy}
              className="h-10 px-4 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 flex items-center gap-1.5">
              <Send className="w-4 h-4" /> {busy ? "…" : "Post"}
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Ang na-tag ay makakatanggap ng abiso. Ctrl+Enter para mag-post.</p>
        </div>
      </div>
    </div>
  )
}
