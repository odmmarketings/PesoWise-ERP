"use client"
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Bell, Check, RefreshCw } from "lucide-react"
import { useNotifications, agoLabel, isMention, type Notif } from "@/lib/notify"

// Buong listahan ng abiso — ang dropdown sa kampana ay huling 30 lang; dito
// ang kasaysayan, may filter kada uri at severity.

const SEV_TONE: Record<string, string> = {
  critical: "bg-rose-50 text-rose-700 border-rose-200",
  warning: "bg-amber-50 text-amber-700 border-amber-200",
  info: "bg-blue-50 text-blue-700 border-blue-200",
}

export default function NotificationsPage() {
  const { items, unread, loading, error, refresh, markRead, markAllRead } = useNotifications(500)
  const [fSev, setFSev] = useState("All")
  const [fRead, setFRead] = useState("All")
  const [fMention, setFMention] = useState(false)
  const router = useRouter()

  const view = useMemo(() => items.filter(n => {
    if (fMention && !isMention(n)) return false
    if (fSev !== "All" && n.severity !== fSev.toLowerCase()) return false
    if (fRead === "Unread" && n.read) return false
    if (fRead === "Read" && !n.read) return false
    return true
  }), [items, fSev, fRead, fMention])
  const mentionCount = useMemo(() => items.filter(isMention).length, [items])

  // Kada araw — parehong pagbasa ng Activity Log.
  const grouped = useMemo(() => {
    const m = new Map<string, Notif[]>()
    for (const n of view) {
      const k = (n.created_at || "").slice(0, 10)
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(n)
    }
    return [...m.entries()]
  }, [view])

  const open = (n: Notif) => { markRead(n.id); if (n.href) router.push(n.href) }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3 pb-4 mb-1 border-b border-slate-100">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Bell className="w-5 h-5" /> NOTIFICATIONS</h1>
        <span className="flex items-center gap-2">
          {unread > 0 && (
            <button onClick={markAllRead} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-1.5">
              <Check className="w-4 h-4" /> Mark all read ({unread})
            </button>
          )}
          <button onClick={refresh} disabled={loading} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </span>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-[13px] text-rose-700">{error}</div>}

      <div className="flex flex-wrap gap-2">
        {["All", "Critical", "Warning", "Info"].map(s => (
          <button key={s} onClick={() => setFSev(s)}
            className={`px-3 py-1.5 rounded-full text-sm border ${fSev === s ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>{s}</button>
        ))}
        <span className="w-px bg-slate-200 mx-1" />
        <button onClick={() => setFMention(m => !m)}
          title="Only notifications where you were mentioned"
          className={`px-3 py-1.5 rounded-full text-sm border font-semibold ${fMention
            ? "bg-indigo-600 text-white border-indigo-600"
            : "bg-white text-indigo-600 border-indigo-200 hover:bg-indigo-50"}`}>
          @ Mentions{mentionCount > 0 ? ` (${mentionCount})` : ""}
        </button>
        <span className="w-px bg-slate-200 mx-1" />
        {["All", "Unread", "Read"].map(s => (
          <button key={s} onClick={() => setFRead(s)}
            className={`px-3 py-1.5 rounded-full text-sm border ${fRead === s ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>{s}</button>
        ))}
        <span className="ml-auto text-[12px] text-slate-400 self-center">{view.length} of {items.length}</span>
      </div>

      {loading && items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 py-16 text-center text-slate-400 text-sm">
          <RefreshCw className="w-5 h-5 animate-spin inline mr-2" /> Loading…
        </div>
      ) : view.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 py-16 text-center">
          <Bell className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">{items.length === 0 ? "Wala pang abiso para sa'yo." : "Walang tumutugma sa filter."}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([day, list]) => (
            <div key={day} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <span className="text-[13px] font-bold text-slate-700">{day}</span>
                <span className="text-[12px] text-slate-400">{list.length}</span>
              </div>
              <div className="divide-y divide-slate-100">
                {list.map(n => (
                  <button key={n.id} onClick={() => open(n)}
                    className={`w-full text-left px-3 sm:px-4 py-3 flex flex-wrap items-start gap-x-2.5 gap-y-1 hover:bg-slate-50/60 ${n.read ? "opacity-60" : ""}`}>
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border shrink-0 ${SEV_TONE[n.severity] || SEV_TONE.info}`}>{n.severity}</span>
                    <span className="min-w-0 flex-1 basis-full sm:basis-auto">
                      <span className="block text-[13px] font-semibold text-slate-800">{n.title}</span>
                      {n.body && <span className="block text-[12px] text-slate-500">{n.body}</span>}
                      <span className="block text-[11px] text-slate-400 mt-0.5">
                        {n.actor_name && <>{n.actor_name} · </>}{agoLabel(n.created_at)}
                        {n.audience === "department" && <> · dept: {n.department}</>}
                        {n.audience === "admin" && <> · admins</>}
                      </span>
                    </span>
                    {!n.read && <span className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
