"use client"
import { useEffect, useMemo, useState } from "react"
import { ShieldCheck, AlertTriangle, Settings2, BellRing, ChevronDown, ChevronUp, Lock } from "lucide-react"
import type { FBAccount } from "@/lib/fb-store"
import { useMonitorRounds, windowFor, type MonitorCheck, type MonitorSlot } from "@/lib/monitor-store"
import { timesOf, slotWindows, slotStateAt, manilaToday, SHIFT_TIMES } from "@/lib/manila"

// ─────────────────────────────────────────────────────────────────────────────
// MONITORING ROUNDS DASHBOARD — nasa itaas ng Tasks tab para iisang lugar ang
// lahat (hiling ng may-ari). Ang grid ng araw, ang ebidensya kada check, ang
// range stats (kasama ang FIRST-TRY RATE na tahimik na naglalantad ng
// manghuhula), at ang admin config: shift kada partner + ang kandado ng app.
// ─────────────────────────────────────────────────────────────────────────────

const peso0 = (n: number) => "₱" + Math.round(n).toLocaleString("en-PH")
const pct = (n: number, d: number) => d > 0 ? Math.round(n / d * 100) + "%" : "—"
type Rounds = ReturnType<typeof useMonitorRounds>

const hmManila = (iso: string) => {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t + 8 * 3600_000).toISOString().slice(11, 16) : ""
}
const dstr = (d: Date) => new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10)

export function MonitorDashboard({ rounds, accounts, isAdmin }: {
  rounds: Rounds; accounts: FBAccount[]; isAdmin: boolean
}) {
  const today = manilaToday()
  const [drill, setDrill] = useState<string>("")        // slot id na nakabukas ang ebidensya
  const [showConfig, setShowConfig] = useState(false)

  const liveAccounts = useMemo(() => accounts.filter(a => !a.archived && a.token && a.ad_account_id), [accounts])
  const ownerNames = useMemo(() => Array.from(new Set(liveAccounts.map(a => a.owner).filter(Boolean))).sort(), [liveAccounts])
  const unscheduled = useMemo(() =>
    ownerNames.filter(o => !rounds.settings.some(s => s.owner === o)), [ownerNames, rounds.settings])
  const noOwnerCount = useMemo(() => liveAccounts.filter(a => !a.owner).length, [liveAccounts])

  // ── RANGE STATS (huling 7 araw by default) ──────────────────────────────────
  const [rangeFrom, setRangeFrom] = useState(dstr(new Date(Date.now() - 6 * 86400_000)))
  const [rangeTo, setRangeTo] = useState(today)
  const [range, setRange] = useState<{ slots: MonitorSlot[]; checks: MonitorCheck[] } | null>(null)
  useEffect(() => {
    if (rounds.migrationNeeded) return
    let dead = false
    rounds.fetchRange(rangeFrom, rangeTo).then(r => { if (!dead) setRange(r) })
    return () => { dead = true }
  }, [rangeFrom, rangeTo, rounds.migrationNeeded, rounds.checks.length])   // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    if (!range) return []
    const per = new Map<string, { req: number; done: number; onTime: number; late: number; firstTry: number; actions: number; delayMs: number }>()
    for (const c of range.checks) {
      const p = per.get(c.owner) || { req: 0, done: 0, onTime: 0, late: 0, firstTry: 0, actions: 0, delayMs: 0 }
      p.req++
      if (c.checked_at) {
        p.done++
        if (c.quiz_attempts <= 1) p.firstTry++
        if (c.verdict === "action") p.actions++
        const setting = rounds.settings.find(s => s.owner === c.owner)
        const w = windowFor(setting, c)
        const at = Date.parse(c.checked_server_at || c.checked_at)
        if (w && Number.isFinite(at)) {
          if (at < w.onTimeUntilMs) p.onTime++
          else { p.late++; p.delayMs += Math.max(0, at - w.onTimeUntilMs) }
        }
      }
      per.set(c.owner, p)
    }
    return Array.from(per, ([owner, p]) => ({ owner, ...p })).sort((a, b) => a.owner.localeCompare(b.owner))
  }, [range, rounds.settings])

  if (rounds.migrationNeeded) return (
    <div className="bg-white rounded-2xl border border-amber-200 p-4">
      <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-amber-500" /> Monitoring Rounds</p>
      <p className="text-xs text-amber-700 mt-1">The monitoring tables don't exist yet — run migration <strong>0034_ads_monitoring.sql</strong> in Supabase first.</p>
    </div>
  )

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" /> Monitoring Rounds
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Ad-account check-ins — every partner walks their spending accounts at set times and marks each
            Monitored inside the Ads Manager.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {"Notification" in globalThis && Notification.permission === "default" && (
            <button onClick={() => Notification.requestPermission()}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
              <BellRing className="w-3.5 h-3.5" /> Enable alerts
            </button>
          )}
          {isAdmin && (
            <button onClick={() => setShowConfig(s => !s)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
              <Settings2 className="w-3.5 h-3.5" /> Configure {showConfig ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {isAdmin && (unscheduled.length > 0 || noOwnerCount > 0) && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[11px] text-amber-800 space-y-0.5">
            {unscheduled.length > 0 && <p>⚠ No monitoring schedule yet: <strong>{unscheduled.join(", ")}</strong> — set their shift in Configure.</p>}
            {noOwnerCount > 0 && <p>⚠ {noOwnerCount} ad account{noOwnerCount === 1 ? "" : "s"} have no owner — nobody is required to monitor them.</p>}
          </div>
        )}

        {isAdmin && showConfig && <ConfigPanel rounds={rounds} ownerNames={ownerNames} />}

        {/* ── ANG ARAW NA ITO ─────────────────────────────────────────────────── */}
        <div className="space-y-2">
          {rounds.settings.filter(s => s.enabled).length === 0 ? (
            <p className="text-sm text-slate-400 italic py-2 text-center">No partners scheduled yet{isAdmin ? " — open Configure to set shifts." : "."}</p>
          ) : rounds.settings.filter(s => s.enabled).map(s => {
            const times = timesOf(s.shift, s.custom_times)
            const windows = slotWindows(today, times)
            return (
              <div key={s.owner} className="rounded-xl border border-slate-200 px-3 py-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-slate-800 w-40 truncate">{s.owner}</span>
                  <span className="text-[10px] font-semibold uppercase text-slate-400">{s.shift}</span>
                  <div className="flex items-center gap-1.5 flex-wrap ml-auto">
                    {windows.map(w => {
                      const slot = rounds.slots.find(x => x.owner === s.owner && x.slot_date === w.date && x.slot_time === w.time)
                      const cs = rounds.checks.filter(c => c.owner === s.owner && c.slot_date === w.date && c.slot_time === w.time)
                      const done = cs.filter(c => c.checked_at).length
                      const state = slotStateAt(w)
                      let cls = "bg-slate-100 text-slate-400", label = `${w.time} —`
                      if (slot && slot.account_count < 0) { cls = "bg-slate-100 text-slate-400"; label = `${w.time} no data` }
                      else if (slot && slot.account_count === 0) { cls = "bg-slate-100 text-slate-400"; label = `${w.time} clear` }
                      else if (slot && done >= cs.length && cs.length > 0) {
                        const lateDone = cs.some(c => { const at = Date.parse(c.checked_server_at || c.checked_at); return Number.isFinite(at) && at >= w.onTimeUntilMs })
                        cls = lateDone ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"
                        label = `${w.time} ✓ ${done}/${cs.length}`
                      }
                      else if (state === "open" && slot) { cls = "bg-blue-50 text-blue-700 animate-pulse"; label = `${w.time} now · ${done}/${cs.length}` }
                      else if (state === "late" && slot) { cls = "bg-amber-50 text-amber-700"; label = `${w.time} late · ${done}/${cs.length}` }
                      else if (state === "missed" && slot) { cls = "bg-rose-50 text-rose-700"; label = `${w.time} ✗ ${done}/${cs.length}` }
                      else if (state === "missed" && !slot) { cls = "bg-slate-100 text-slate-400"; label = `${w.time} no data` }
                      return (
                        <button key={w.time} onClick={() => slot && setDrill(d => d === slot.id ? "" : slot.id)}
                          className={`px-2 py-1 rounded-md text-[11px] font-bold tabular-nums whitespace-nowrap ${cls} ${slot ? "cursor-pointer" : "cursor-default"}`}>
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>
                {/* Ebidensya ng napindot na slot */}
                {windows.some(w => rounds.slots.find(x => x.owner === s.owner && x.slot_date === w.date && x.slot_time === w.time && x.id === drill)) && (
                  <div className="mt-2 rounded-lg border border-slate-100 divide-y divide-slate-100">
                    {rounds.checks.filter(c => c.slot_id === drill).map(c => (
                      <div key={c.id} className="px-3 py-1.5 flex items-center gap-2 text-[12px] flex-wrap">
                        <span className={`w-2 h-2 rounded-full ${c.checked_at ? (c.verdict === "action" ? "bg-amber-400" : "bg-emerald-500") : "bg-slate-300"}`} />
                        <span className="font-semibold text-slate-800 truncate max-w-[160px]">{c.account_name}</span>
                        {c.checked_at ? (
                          <>
                            <span className="tabular-nums text-slate-500">{hmManila(c.checked_server_at || c.checked_at)}</span>
                            {c.checked_by_name && c.checked_by_name.toLowerCase() !== c.owner.toLowerCase() && <span className="text-indigo-600">by {c.checked_by_name}</span>}
                            <span className="tabular-nums text-slate-400">{peso0(c.spend_at_check)} · {c.active_campaigns} active · {Math.round(c.dwell_ms / 1000)}s</span>
                            {c.quiz_attempts > 1 && <span className="text-rose-600 font-semibold">{c.quiz_attempts} tries</span>}
                            {c.no_data && <span className="text-amber-600 font-semibold">no data</span>}
                            {c.verdict === "action" && <span className="text-amber-700 font-semibold">⚠ needs action{c.note ? `: ${c.note}` : ""}</span>}
                            {c.verdict === "ok" && c.note && <span className="text-slate-500 italic">“{c.note}”</span>}
                          </>
                        ) : <span className="text-slate-400 italic">unchecked</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ── RANGE STATS ─────────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2 flex-wrap">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 flex-1">Compliance</p>
            <input type="date" value={rangeFrom} onChange={e => setRangeFrom(e.target.value)} className="px-2 py-1 rounded border border-slate-300 text-[11px]" />
            <span className="text-slate-400 text-[11px]">→</span>
            <input type="date" value={rangeTo} onChange={e => setRangeTo(e.target.value)} className="px-2 py-1 rounded border border-slate-300 text-[11px]" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-[11px] text-slate-500 uppercase tracking-wide border-b border-slate-100">
                  <th className="px-3 py-2">Partner</th>
                  <th className="px-3 py-2 text-right">Required</th>
                  <th className="px-3 py-2 text-right">On time</th>
                  <th className="px-3 py-2 text-right">Completed</th>
                  <th className="px-3 py-2 text-right" title="Correct spend pick on the first try — ~33% means guessing, ~100% means actually looking">First-try</th>
                  <th className="px-3 py-2 text-right">Needs action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stats.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-400 italic text-sm">No rounds in this range yet.</td></tr>
                ) : stats.map(p => (
                  <tr key={p.owner}>
                    <td className="px-3 py-2 font-semibold text-slate-800">{p.owner}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{p.req}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-bold ${p.onTime === p.req && p.req > 0 ? "text-emerald-600" : "text-slate-800"}`}>{pct(p.onTime, p.req)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{pct(p.done, p.req)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-bold ${p.done > 0 && p.firstTry / p.done < 0.7 ? "text-rose-600" : "text-slate-700"}`}>{pct(p.firstTry, p.done)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-700">{p.actions || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-[11px] text-slate-400">
          Alerts fire while PesoWise is open on any device (popup + browser notification). When the app is closed
          on every device, nothing can ring at slot time — the round is recorded as missed and the reminders wait
          at next open. Push notifications to phones are a possible upgrade.
        </p>
      </div>
    </div>
  )
}

// ── ADMIN: shift kada partner + ang kandado ng app ────────────────────────────
function ConfigPanel({ rounds, ownerNames }: { rounds: Rounds; ownerNames: string[] }) {
  const all = useMemo(() => Array.from(new Set([...ownerNames, ...rounds.settings.map(s => s.owner)])).sort(), [ownerNames, rounds.settings])
  const [saving, setSaving] = useState("")
  const [err, setErr] = useState("")
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
        <input type="checkbox" checked={rounds.lockEnabled}
          onChange={async e => { const m = await rounds.saveLockEnabled(e.target.checked); setErr(m || "") }} />
        <Lock className="w-3.5 h-3.5 text-rose-500" /> Require the ads check before using PesoWise (locks every
        other page while a round is open)
      </label>
      {err && <p className="text-[11px] text-rose-600">⚠ {err}</p>}
      <div className="divide-y divide-slate-200">
        {all.map(o => {
          const s = rounds.settings.find(x => x.owner === o)
          return (
            <div key={o} className="py-2 flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-slate-800 w-40 truncate">{o}</span>
              <select defaultValue={s?.shift || "am"} id={`shift-${o}`}
                className="px-2 py-1 rounded border border-slate-300 text-xs bg-white">
                <option value="am">AM — {SHIFT_TIMES.am.join(", ")}</option>
                <option value="pm">PM — {SHIFT_TIMES.pm.join(", ")}</option>
                <option value="custom">Custom</option>
              </select>
              <input id={`times-${o}`} defaultValue={(s?.custom_times || []).join(", ")} placeholder="09:00, 14:30"
                className="px-2 py-1 rounded border border-slate-300 text-xs w-36" />
              <label className="flex items-center gap-1 text-[11px] text-slate-600">
                <input type="checkbox" id={`on-${o}`} defaultChecked={s ? s.enabled : true} /> enabled
              </label>
              <button disabled={saving === o} onClick={async () => {
                setSaving(o)
                const shift = (document.getElementById(`shift-${o}`) as HTMLSelectElement).value
                const raw = (document.getElementById(`times-${o}`) as HTMLInputElement).value
                const times = raw.split(",").map(x => x.trim()).filter(x => /^\d{2}:\d{2}$/.test(x))
                const on = (document.getElementById(`on-${o}`) as HTMLInputElement).checked
                const m = await rounds.saveSetting(o, shift, times, on)
                setErr(m || ""); setSaving("")
              }} className="px-2.5 py-1 rounded-lg bg-blue-600 text-white text-[11px] font-bold hover:bg-blue-700 disabled:opacity-50">
                {saving === o ? "Saving…" : s ? "Save" : "Add"}
              </button>
              {s && !s.enabled && <span className="text-[10px] text-slate-400 uppercase font-bold">off</span>}
            </div>
          )
        })}
      </div>
      {!all.length && <p className="text-xs text-slate-400 italic">No ad-account owners found yet.</p>}
    </div>
  )
}
