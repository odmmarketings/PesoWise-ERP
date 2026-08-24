"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import { X, Send, MessageSquare, AtSign, Check, CheckCheck, Undo2, ExternalLink, ClipboardList, MailWarning } from "lucide-react"
import { useAdsComments, rosterPeople, objectHref, type RosterPick } from "@/lib/ads-comments-store"
import { createPartnerTasksDirect, taskTitleFrom, taskDetailsFrom, preselectMentioned, type TaskAssignee } from "@/lib/partner-tasks-store"
import { currentUserEmail } from "@/lib/current-user"
import { agoLabel } from "@/lib/notify"

// Usapan sa isang campaign / ad set / ad. Ang "@" ay nagbubukas ng picker ng
// tao; ang na-tag ay tumatanggap ng abiso pagkatapos mag-post.

export function CommentsModal({ objectId, level, name, account, href, accountId, campaignId, canTask, assignees, onJump, onClose, onPosted }: {
  objectId: string; level: string; name: string; account: string; href: string
  /** "Also assign as task" — sa mga makakagawa ng task lang (canCreateTask). */
  canTask?: boolean
  /** Sino ang maaatasan — partners (may ad account) at marketing. */
  assignees?: TaskAssignee[]
  /** Dala ng deep link ng abiso — at ng paglundag mula sa pamagat. */
  accountId?: string; campaignId?: string
  /**
   * "Dalhin mo ako roon" — pinipindot ang pangalan sa itaas.
   *
   * ⚠ HINDI PALAMUTI. Kapag nabasa mo ang komento mula sa abiso, ang pangalan
   * lang ang hawak mo — at ikaw pa ang maghahanap sa 22 campaign kung alin iyon
   * (hiling ng may-ari, Ago 19 2026). Kapag walang `onJump`, hindi ito nagiging
   * buton: walang pindutang nangangako ng galaw na hindi naman mangyayari.
   */
  onJump?: () => void
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

  // ── "BUKOD SA COMMENT, ADD TASK SA KANILA" (hatol ng may-ari, Ago 25 2026):
  // ang auditor ay nagkokomento AT nagtatalaga sa iisang hinto — at ang task
  // ay may dalang deep link pabalik sa MISMONG ad na inaayusan, hindi sa
  // komento: ang partner ang gagawa ng ayos, hindi magbabasa lang.
  const [taskOn, setTaskOn] = useState(false)
  const [taskSel, setTaskSel] = useState<Set<string>>(new Set())
  const [taskDeadline, setTaskDeadline] = useState("")
  const [taskMsg, setTaskMsg] = useState("")
  const taskPeople = assignees || []
  const toggleTask = () => {
    setTaskMsg("")
    if (taskOn) { setTaskOn(false); return }
    // Ang na-@mention sa komento ang unang HULA — DINARAGDAG sa dating pinili,
    // hindi pinapalitan: ang pag-off-on ng pill (para basahin muli ang komento)
    // ay dating bumubura ng maingat na pinili (nahuli ng review, Ago 25 2026).
    const mentioned = preselectMentioned(body, taskPeople, people)
    setTaskSel(prev => new Set([...prev, ...mentioned]))
    setTaskOn(true)
  }
  const toggleAssignee = (n: string) => setTaskSel(prev => {
    const next = new Set(prev)
    if (next.has(n)) next.delete(n); else next.add(n)
    return next
  })

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
    // Ang naka-arma ngunit walang napiling tao ay dating TAHIMIK na nawawala:
    // pumapasok ang komento, walang task, at "Post" lang ang tanging palatandaan
    // (nahuli ng review, Ago 25 2026). Ang Ctrl+Enter ay dumaraan din dito.
    const owners = [...taskSel].filter(n => taskPeople.some(p => p.name === n))
    if (taskOn && owners.length === 0) {
      setTaskMsg('Task not attached: pick at least one person below, or turn off "Also assign as task".')
      return
    }
    setBusy(true)
    const ok = await add(body, { level, name, account, href, accountId, campaignId })
    // Ang task ay sumusunod LANG sa nakapost na komento — walang task na
    // lilitaw nang walang pinagmulang usapan.
    if (ok && taskOn && owners.length > 0) {
      const err = await createPartnerTasksDirect({
        title: taskTitleFrom(body),
        details: taskDetailsFrom(level, name, account),
        owners, deadline: taskDeadline, reward: "",
        link: {
          href: objectHref(objectId, { level, name, accountId, campaignId }),
          label: `${name} · ${account}`,
        },
      })
      setTaskMsg(err ? `Comment posted, but the task failed: ${err}` : `Task assigned to ${owners.join(", ")}.`)
      // ⚠ DINIDIS-ARMA KAHIT PUMALYA. Ang natitirang armadong toggle ay
      // dumidikit sa SUSUNOD na komento — at ang pamagat ay galing sa BAGONG
      // teksto, kaya ibang trabaho ang naipapadala kaysa sa pumalya (nahuli ng
      // review, Ago 25 2026). Ang komento ay nakapost na; nakasulat sa mensahe
      // kung ano ang hindi.
      setTaskOn(false); setTaskSel(new Set()); setTaskDeadline("")
    } else if (ok) setTaskMsg("")
    if (ok) { setBody(""); onPosted?.() }
    setPickOpen(false); setBusy(false)
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
      {/* ⚠ overflow-hidden: kapag bukas ang task panel, ang paanan ay hindi
          na kayang lumiit, at dating tumatawid ito sa bilog na gilid — nawawala
          ang huling linya sa ilalim ng tanawin sa maikling screen (nasukat ng
          review, Ago 25 2026: 620px na taas = 22px na labis). */}
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-bold text-slate-800 flex items-center gap-1.5"><MessageSquare className="w-4 h-4" /> Comments</p>
            {onJump ? (
              <button onClick={onJump} title={`Open this ${level} in Ads Manager`}
                className="text-[12px] text-blue-600 hover:underline truncate flex items-center gap-1 max-w-full">
                <span className="truncate">{name}</span>
                <ExternalLink className="w-3 h-3 shrink-0" />
                <span className="text-slate-400 shrink-0">· {account} · {level}</span>
              </button>
            ) : (
              <p className="text-[12px] text-slate-500 truncate">{name} · {account} · {level}</p>
            )}
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

        {/* Kapag bukas ang task panel, ang listahan ang unang umuurong —
            ang paanan ang kailangang buo. */}
        <div className={`flex-1 overflow-y-auto px-5 py-3 space-y-3 ${taskOn && !showDone ? "min-h-[80px]" : "min-h-[160px]"}`}>
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
              <Send className="w-4 h-4" /> {busy ? "…" : taskOn && taskSel.size > 0 ? "Post + Task" : "Post"}
            </button>
          </div>
          {canTask && taskPeople.length > 0 && (
            <div className="mt-2">
              <button onClick={toggleTask}
                className={`text-[12px] font-semibold px-2.5 py-1 rounded-full border transition flex items-center gap-1.5 ${
                  taskOn ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:border-slate-300"}`}>
                <ClipboardList className="w-3.5 h-3.5" /> {taskOn ? "Assigning as task — pick who" : "Also assign as task"}
              </button>
              {taskOn && (
                <div className="mt-2 space-y-2 max-h-[30vh] overflow-y-auto">
                  <div className="flex flex-wrap gap-1.5">
                    {taskPeople.map(p => (
                      <button key={p.name} onClick={() => toggleAssignee(p.name)}
                        title={p.email || "no company email — will not be notified"}
                        className={`text-[12px] font-semibold px-2.5 py-1 rounded-lg border transition flex items-center gap-1.5 ${
                          taskSel.has(p.name) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:border-slate-300"}`}>
                        {p.name}
                        {/* Kagaya ng board: kitang tanda, hindi tooltip lang —
                            ang tooltip ay hindi umiiral sa touch screen. */}
                        {!p.email && <MailWarning className="w-3 h-3 text-amber-500 shrink-0" />}
                      </button>
                    ))}
                  </div>
                  {[...taskSel].some(n => !taskPeople.find(p => p.name === n)?.email) && (
                    <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
                      <MailWarning className="w-3.5 h-3.5 shrink-0 mt-px" />
                      <span>Someone selected has no company email in User Management, so they will see the task on the Tasks board but get no notification.</span>
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Deadline</span>
                    <input type="date" value={taskDeadline} onChange={e => setTaskDeadline(e.target.value)}
                      className="h-8 rounded-lg border border-slate-200 px-2 text-[12px]" />
                    <span className="text-[11px] text-slate-400">optional</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Each selected person gets a task on the Tasks board that opens this exact {level} — the comment above becomes the task.
                  </p>
                </div>
              )}
            </div>
          )}
          {taskMsg && (
            <p className={`text-[11px] mt-1 ${/failed|not attached/.test(taskMsg) ? "text-rose-600" : "text-emerald-600"}`}>{taskMsg}</p>
          )}
          <p className="text-[11px] text-slate-400 mt-1">Ang na-tag ay makakatanggap ng abiso. Ctrl+Enter para mag-post.</p>
        </div>
      </div>
    </div>
  )
}
