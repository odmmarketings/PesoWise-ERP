"use client"
import { useMemo, useState } from "react"
import { RefreshCw, Users, Mars, Venus, UserCheck, UserMinus, UserX, DoorOpen } from "lucide-react"
import {
  useHrEmployees, useHrHolidays, useHrEvents, fullNameOf, monthNames,
  birthdayCelebrants, newlyHired, holidaysInMonth, eventsInMonth, HOLIDAY_TYPES,
} from "@/lib/hr-store"
import { isMotherAccount } from "@/lib/users-store"

// ──────────────────────────────────────────────────────────────────────────────
// HR DASHBOARD — replica ng LHIKE HRIS HR Dashboard: pitong dark stat cards
// (Total/Male/Female + Active/Inactive/Resigned/Terminated), tabs sa ibaba
// (Holidays · Events · Birthday Celebrants · Newly Hired), at ang "Today's
// Holiday for the Month" banner na may legend ng tatlong holiday type.
// Lahat ng bilang ay galing sa 201 File — walang inimbentong numero.
// ──────────────────────────────────────────────────────────────────────────────

const prettyDate = (s: string) => {
  if (!s) return "—"
  const d = new Date(s + "T00:00:00")
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })
}

function StatCard({ label, value, icon: Icon, wide = false }: { label: string; value: number; icon: any; wide?: boolean }) {
  return (
    <div className={`bg-slate-800 rounded-xl px-5 py-4 flex flex-col justify-between min-h-[92px] ${wide ? "col-span-2" : ""}`}>
      <p className="text-white font-bold text-lg text-center">{label}</p>
      <div className="flex items-end justify-between">
        <Icon className="w-5 h-5 text-slate-400" />
        <span className="text-white text-2xl font-extrabold tabular-nums">{value}</span>
      </div>
    </div>
  )
}

export default function HrDashboardPage() {
  const emp = useHrEmployees()
  const hol = useHrHolidays()
  const ev = useHrEvents()
  const [tab, setTab] = useState<"holidays" | "events" | "birthdays" | "newhires">("holidays")

  const now = new Date()
  const stats = useMemo(() => {
    const by = (s: string) => emp.rows.filter(e => e.status === s).length
    return {
      total: emp.rows.length,
      male: emp.rows.filter(e => e.gender === "Male").length,
      female: emp.rows.filter(e => e.gender === "Female").length,
      active: by("Active"), inactive: by("Inactive"), resigned: by("Resigned"), terminated: by("Terminated"),
    }
  }, [emp.rows])

  const monthHolidays = useMemo(() => holidaysInMonth(hol.rows, now.getFullYear(), now.getMonth()), [hol.rows])   // eslint-disable-line react-hooks/exhaustive-deps
  const monthEvents = useMemo(() => eventsInMonth(ev.rows, now.getFullYear(), now.getMonth()), [ev.rows])         // eslint-disable-line react-hooks/exhaustive-deps
  const celebrants = useMemo(() => birthdayCelebrants(emp.rows, now.getMonth()), [emp.rows])                      // eslint-disable-line react-hooks/exhaustive-deps
  const hires = useMemo(() => newlyHired(emp.rows), [emp.rows])
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  const todayHolidays = monthHolidays.filter(h => h.date === todayStr)

  if (!isMotherAccount()) {
    return <p className="text-sm text-slate-500 py-10 text-center">HR Mode is for the Mother Account only.</p>
  }

  const TABS = [
    { k: "holidays" as const, l: "Holidays" },
    { k: "events" as const, l: "Events" },
    { k: "birthdays" as const, l: "Birthday Celebrants" },
    { k: "newhires" as const, l: "Newly Hired" },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-slate-800 tracking-wide">HR DASHBOARD</h1>
        <button onClick={() => { emp.refresh(); hol.refresh(); ev.refresh() }} title="Refresh"
          className="h-10 w-10 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50 flex items-center justify-center">
          <RefreshCw className={`w-4 h-4 ${!emp.loaded ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Stat cards — dalawang hanay gaya ng LHIKE: 3 sa itaas, 4 sa ibaba */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total Employees" value={stats.total} icon={Users} />
        <StatCard label="Male" value={stats.male} icon={Mars} />
        <StatCard label="Female" value={stats.female} icon={Venus} />
      </div>
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Active" value={stats.active} icon={UserCheck} />
        <StatCard label="Inactive" value={stats.inactive} icon={UserMinus} />
        <StatCard label="Resigned" value={stats.resigned} icon={DoorOpen} />
        <StatCard label="Terminated" value={stats.terminated} icon={UserX} />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-6 border-b border-slate-200">
        {TABS.map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`pb-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t.k ? "border-teal-500 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {t.l}
          </button>
        ))}
      </div>

      {tab === "holidays" && (
        <div className="bg-slate-800 rounded-xl px-6 py-6 text-white">
          <h2 className="text-2xl font-extrabold">Today&apos;s Holiday for the Month of {monthNames[now.getMonth()]} {now.getFullYear()} !</h2>
          <div className="flex items-center gap-4 mt-3 text-sm">
            {HOLIDAY_TYPES.map(t => (
              <span key={t.key} className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm" style={{ background: t.color }} /> {t.label}
              </span>
            ))}
          </div>
          {todayHolidays.length === 0 && <p className="mt-4 italic text-slate-300">No Holiday Today !</p>}
          {todayHolidays.map(h => (
            <p key={h.id} className="mt-3 font-semibold" style={{ color: HOLIDAY_TYPES.find(t => t.key === h.type)?.color }}>
              {h.name} — {prettyDate(h.date)}
            </p>
          ))}
          {monthHolidays.length > 0 && (
            <div className="mt-5 pt-4 border-t border-slate-700 space-y-1.5">
              {monthHolidays.map(h => (
                <p key={h.id} className="text-sm flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: HOLIDAY_TYPES.find(t => t.key === h.type)?.color }} />
                  <span className="font-semibold">{prettyDate(h.date)}</span> · {h.name}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "events" && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          {monthEvents.length === 0
            ? <p className="text-sm text-slate-400 italic py-6 text-center">No events this month.</p>
            : monthEvents.map(e => (
              <div key={e.id} className="py-2.5 border-b border-slate-100 last:border-0">
                <p className="font-semibold text-slate-800 text-sm">{e.name}</p>
                <p className="text-xs text-slate-500">{prettyDate(e.date)}{e.description ? ` — ${e.description}` : ""}</p>
              </div>
            ))}
        </div>
      )}

      {tab === "birthdays" && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          {celebrants.length === 0
            ? <p className="text-sm text-slate-400 italic py-6 text-center">No birthday celebrants this month.</p>
            : celebrants.map(e => (
              <div key={e.id} className="py-2.5 border-b border-slate-100 last:border-0 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-slate-800 text-sm">{fullNameOf(e)}</p>
                  <p className="text-xs text-slate-500">{e.position || "—"}</p>
                </div>
                <span className="text-sm font-semibold text-teal-600">{prettyDate(e.birthdate).replace(/, \d{4}$/, "")}</span>
              </div>
            ))}
        </div>
      )}

      {tab === "newhires" && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          {hires.length === 0
            ? <p className="text-sm text-slate-400 italic py-6 text-center">No new hires in the last 30 days.</p>
            : hires.map(e => (
              <div key={e.id} className="py-2.5 border-b border-slate-100 last:border-0 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-slate-800 text-sm">{fullNameOf(e)}</p>
                  <p className="text-xs text-slate-500">{e.position || "—"} · {e.department || "—"}</p>
                </div>
                <span className="text-sm text-slate-500">Hired {prettyDate(e.date_hired)}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
