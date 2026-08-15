"use client"
import { useMemo, useState } from "react"
import { ScrollText, RefreshCw, User2, Search } from "lucide-react"
import { useAdsActivity, ACTION_LABEL, type AdsActivity } from "@/lib/ads-activity-store"

// ─────────────────────────────────────────────────────────────────────────────
// ADS ACTIVITY LOG — sino ang gumalaw ng ano, kailan.
//
// Tatlong media buyer ang gumagamit ng parehong ad accounts sa ilalim ng iisang
// Facebook token, kaya walang masasagot si Meta sa "sino ang nagpatay nito?" —
// iisang tao lang ang nakikita niya. Dito naitatala ang bawat pagbabagong
// ipinapadala ng PesoWise, may pangalan ng naka-login na user.
// ─────────────────────────────────────────────────────────────────────────────

const SURFACE_LABEL: Record<string, string> = {
  "ads-manager": "Ads Manager", testing: "Testing", scaling: "Scaling",
  monitoring: "Monitoring", rules: "Rules",
}
// Kulay kada uri ng aksyon — ang mata ay dapat makakita agad ng "may pinatay".
const ACTION_TONE: Record<string, string> = {
  kill: "bg-rose-50 text-rose-700 border-rose-200",
  status: "bg-slate-100 text-slate-700 border-slate-200",
  budget: "bg-amber-50 text-amber-700 border-amber-200",
  scale: "bg-emerald-50 text-emerald-700 border-emerald-200",
  scale_undo: "bg-amber-50 text-amber-700 border-amber-200",
  register: "bg-blue-50 text-blue-700 border-blue-200",
  unregister: "bg-slate-100 text-slate-600 border-slate-200",
  ad_moved: "bg-violet-50 text-violet-700 border-violet-200",
  rule_create: "bg-blue-50 text-blue-700 border-blue-200",
  rule_update: "bg-blue-50 text-blue-700 border-blue-200",
  rule_delete: "bg-rose-50 text-rose-700 border-rose-200",
  rule_status: "bg-slate-100 text-slate-700 border-slate-200",
  rule_scope: "bg-blue-50 text-blue-700 border-blue-200",
}

const dayKey = (iso: string) => (iso || "").slice(0, 10)
const timeOf = (iso: string) => {
  const d = new Date(iso)
  if (!isFinite(d.getTime())) return ""
  const h = d.getHours(), m = String(d.getMinutes()).padStart(2, "0")
  return `${String(h % 12 === 0 ? 12 : h % 12).padStart(2, "0")}:${m}${h < 12 ? "AM" : "PM"}`
}
const dayLabel = (k: string) => {
  const today = new Date(); const y = new Date(); y.setDate(y.getDate() - 1)
  const ds = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  return k === ds(today) ? `Today · ${k}` : k === ds(y) ? `Yesterday · ${k}` : k
}

const Sel = ({ value, onChange, opts, label }: { value: string; onChange: (v: string) => void; opts: string[]; label: string }) => (
  <div className="flex flex-col gap-1">
    <span className="text-[10px] uppercase tracking-wider text-slate-400">{label}</span>
    <select value={value} onChange={e => onChange(e.target.value)}
      className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 min-w-[150px]">
      {opts.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  </div>
)

export default function AdsActivityPage() {
  const { rows, loading, error, refresh } = useAdsActivity(1000)
  const [fUser, setFUser] = useState("All")
  const [fAction, setFAction] = useState("All")
  const [fSurface, setFSurface] = useState("All")
  const [fAccount, setFAccount] = useState("All")
  const [q, setQ] = useState("")

  const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).sort()
  const users = useMemo(() => uniq(rows.map(r => r.user_name)), [rows])
  const actions = useMemo(() => uniq(rows.map(r => r.action)), [rows])
  const surfaces = useMemo(() => uniq(rows.map(r => r.surface)), [rows])
  const accounts = useMemo(() => uniq(rows.map(r => r.account_name)), [rows])

  const view = useMemo(() => rows.filter(r => {
    if (fUser !== "All" && r.user_name !== fUser) return false
    if (fAction !== "All" && r.action !== fAction) return false
    if (fSurface !== "All" && r.surface !== fSurface) return false
    if (fAccount !== "All" && r.account_name !== fAccount) return false
    if (q) {
      const hay = `${r.object_name} ${r.summary} ${r.user_name} ${r.account_name}`.toLowerCase()
      if (!hay.includes(q.toLowerCase())) return false
    }
    return true
  }), [rows, fUser, fAction, fSurface, fAccount, q])

  // Pinagpapangkat kada araw — iyon ang paraan ng pagbasa ng tao sa log.
  const grouped = useMemo(() => {
    const m = new Map<string, AdsActivity[]>()
    for (const r of view) {
      const k = dayKey(r.at)
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(r)
    }
    return [...m.entries()]
  }, [view])

  // Ilan ang ginawa ng bawat user sa nakikitang saklaw — ito ang unang tanong.
  const perUser = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of view) m.set(r.user_name || "Unknown", (m.get(r.user_name || "Unknown") || 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [view])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3 pb-4 mb-1 border-b border-slate-100">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><ScrollText className="w-5 h-5" /> ADS ACTIVITY LOG</h1>
        <button onClick={refresh} disabled={loading}
          className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <p className="text-sm text-slate-500">
        Every change PesoWise sent to Facebook — who did it, what changed, and when. Facebook can&apos;t answer this:
        the three buyers share one token, so Meta only ever sees one person.
      </p>

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-[13px] text-rose-700">{error}</div>
      )}

      {/* Sino ang gumagalaw — bilang kada user sa kasalukuyang salaan */}
      {perUser.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {perUser.map(([name, n]) => (
            <button key={name} onClick={() => setFUser(fUser === name ? "All" : name)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm ${
                fUser === name ? "border-blue-400 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
              <User2 className="w-4 h-4 shrink-0" />
              <span className="font-medium">{name}</span>
              <span className="text-[11px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">{n}</span>
            </button>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap gap-3 items-end">
        <Sel value={fUser} onChange={setFUser} opts={["All", ...users]} label="User" />
        <Sel value={fAction} onChange={setFAction} opts={["All", ...actions]} label="Action" />
        <Sel value={fSurface} onChange={setFSurface} opts={["All", ...surfaces]} label="Where" />
        <Sel value={fAccount} onChange={setFAccount} opts={["All", ...accounts]} label="Ad account" />
        <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
          <span className="text-[10px] uppercase tracking-wider text-slate-400">Search</span>
          <span className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Campaign, ad set, rule…"
              className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm" />
          </span>
        </div>
        <span className="text-[12px] text-slate-500 pb-2.5">{view.length} of {rows.length}</span>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 py-16 text-center text-slate-400 text-sm">
          <RefreshCw className="w-5 h-5 animate-spin inline mr-2" /> Loading activity…
        </div>
      ) : view.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 py-16 text-center">
          <ScrollText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">
            {rows.length === 0
              ? "Nothing logged yet. Turning something on or off, editing a budget, scaling, killing, or touching a rule will show up here."
              : "No activity matches these filters."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([day, items]) => (
            <div key={day} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <span className="text-[13px] font-bold text-slate-700">{dayLabel(day)}</span>
                <span className="text-[12px] text-slate-400">{items.length} change{items.length === 1 ? "" : "s"}</span>
              </div>
              <div className="divide-y divide-slate-100">
                {items.map(r => (
                  <div key={r.id} className="px-3 sm:px-4 py-3 flex flex-wrap items-start gap-x-2 sm:gap-x-3 gap-y-1 hover:bg-slate-50/60">
                    <span className="text-[12px] text-slate-400 tabular-nums w-[62px] shrink-0 pt-0.5">{timeOf(r.at)}</span>
                    <span className="text-[13px] font-semibold text-slate-800 sm:min-w-[130px]">{r.user_name || "Unknown user"}</span>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${ACTION_TONE[r.action] || "bg-slate-100 text-slate-700 border-slate-200"}`}>
                      {ACTION_LABEL[r.action] || r.action}
                    </span>
                    <span className="text-[13px] text-slate-700 min-w-0 flex-1 basis-full sm:basis-auto">
                      <b className="break-all">{r.object_name || r.object_id || "—"}</b>
                      {r.summary && <span className="text-slate-500"> — {r.summary}</span>}
                      <span className="block text-[11px] text-slate-400">
                        {r.level && <>{r.level} · </>}
                        {r.account_name && <>{r.account_name} · </>}
                        {SURFACE_LABEL[r.surface] || r.surface}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
