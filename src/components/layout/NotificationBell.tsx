"use client"
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Bell, Check, RefreshCw } from "lucide-react"
import { useNotifications, agoLabel, isMention, type Notif } from "@/lib/notify"

// Kampana sa Topbar — nakikita sa BAWAT pahina, kaya ito ang pintuan ng buong
// notification feature. Badge = bilang ng hindi pa nababasa; dropdown = huling
// 30; ang buong listahan ay nasa /business/notifications.

const SEV_DOT: Record<string, string> = {
  critical: "bg-rose-500",
  warning: "bg-amber-500",
  info: "bg-blue-500",
}

export function NotificationBell() {
  const { items, unread, loading, error, markRead, markAllRead, refresh } = useNotifications(30)
  const [open, setOpen] = useState(false)
  // "@ Mentions" — para makita agad kung saan ka na-tag (hiling ng may-ari,
  // Ago 24 2026). Salaan lang ito ng tanawin; hindi nito ginagalaw ang unread.
  const [onlyMentions, setOnlyMentions] = useState(false)
  const mentions = items.filter(isMention)
  const shown = onlyMentions ? mentions : items
  const router = useRouter()
  const panelRef = useRef<HTMLDivElement>(null)

  // Sarado kapag pumindot sa labas — pattern ng AccountPicker.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  const go = (n: Notif) => {
    markRead(n.id)
    setOpen(false)
    if (!n.href) return
    const [path, query] = n.href.split("?")
    // ⚠ Kapag NASA pahinang iyon ka na, ang router.push ay soft navigation —
    // walang remount, at ang deep link (?focus=…) ay binabasa lang sa mount,
    // kaya walang nangyayari hanggang mag-refresh (iniulat ng may-ari, Ago 24
    // 2026). Ang event ang daan: ang pahina mismo ang nakikinig at gumagalaw.
    if (query && typeof window !== "undefined" && path === window.location.pathname) {
      window.dispatchEvent(new CustomEvent("pesowise:deeplink", { detail: { query } }))
    } else {
      router.push(n.href)
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      <button onClick={() => { setOpen(o => !o); if (!open) refresh() }}
        title="Notifications"
        className="relative p-2 rounded-lg hover:bg-slate-100 text-slate-600">
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[360px] max-w-[92vw] bg-white border border-slate-200 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-slate-800">Notifications</span>
              {/* IISANG toggle (hatol ng may-ari, Ago 24 2026): pindot = mentions
                  lang; pindot ULIT = balik sa lahat. */}
              <button onClick={() => setOnlyMentions(m => !m)}
                title={onlyMentions ? "Showing mentions only — tap again for all notifications" : "Only notifications where you were mentioned"}
                className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${onlyMentions
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white text-indigo-600 border-indigo-200 hover:bg-indigo-50"}`}>
                @ Mentions{mentions.filter(x => !x.read).length > 0 ? ` (${mentions.filter(x => !x.read).length})` : ""}
              </button>
            </span>
            <span className="flex items-center gap-1">
              {unread > 0 && (
                <button onClick={markAllRead}
                  className="text-[11px] px-2 py-1 rounded-lg text-blue-600 hover:bg-blue-50 flex items-center gap-1">
                  <Check className="w-3 h-3" /> Mark all read
                </button>
              )}
              <button onClick={refresh} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-50">
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </span>
          </div>

          <div className="max-h-[420px] overflow-y-auto scrollbar-dark">
            {error ? (
              <p className="px-4 py-6 text-[12px] text-rose-600">{error}</p>
            ) : shown.length === 0 ? (
              <p className="px-4 py-8 text-[13px] text-slate-400 text-center">
                {loading ? "Loading…" : onlyMentions ? "Nobody has mentioned you yet." : "Wala pang abiso."}
              </p>
            ) : shown.map(n => (
              <button key={n.id} onClick={() => go(n)}
                className={`w-full text-left px-4 py-2.5 border-b border-slate-50 hover:bg-slate-50 flex items-start gap-2.5 ${n.read ? "opacity-60" : ""}`}>
                <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${n.read ? "bg-slate-200" : SEV_DOT[n.severity] || SEV_DOT.info}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-slate-800 leading-snug">{n.title}</span>
                  {n.body && <span className="block text-[12px] text-slate-500 leading-snug truncate">{n.body}</span>}
                  <span className="block text-[11px] text-slate-400 mt-0.5">
                    {n.actor_name && <>{n.actor_name} · </>}{agoLabel(n.created_at)}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <button onClick={() => { setOpen(false); router.push("/business/notifications") }}
            className="w-full px-4 py-2.5 text-[12px] font-semibold text-blue-600 hover:bg-blue-50 border-t border-slate-100 text-center">
            View all notifications →
          </button>
        </div>
      )}
    </div>
  )
}
