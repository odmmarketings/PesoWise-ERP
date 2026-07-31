"use client"
import { useMemo, useState } from "react"
import Link from "next/link"
import {
  LayoutDashboard, Cake, CalendarDays, UserRound, ArrowLeft, Fingerprint,
} from "lucide-react"
import {
  useHrEmployees, useHrHolidays, useHrEvents, fullNameOf, monthNames,
  birthdayCelebrants, holidaysInMonth, eventsInMonth, HOLIDAY_TYPES, type HrEmployee,
} from "@/lib/hr-store"
import { currentUserEmail, currentUserName } from "@/lib/current-user"

// ──────────────────────────────────────────────────────────────────────────────
// ODM DTR — employee self-view, hinango sa LHIKE DTR: itim na topbar, kaliwang
// profile card (avatar + pangalan + ACTIVE badge), at sariling nav. Ang
// empleyado ay hinahanap sa 201 File sa pamamagitan ng company_email (fallback:
// personal_email) laban sa PesoWise login. SARILING buong layout ito — walang
// ERP sidebar/topbar (tingnan ang inDtr sa (app)/layout.tsx).
//
// Ang time-tracking/payslip na bahagi ng LHIKE DTR ay WALA PA — kailangan muna
// ng DTR punch data source. Ang nandito ay ang nabubuhay sa 201 File: profile,
// birthdays, events, holidays. Walang pekeng oras o palda-paldang zero.
// ──────────────────────────────────────────────────────────────────────────────

const prettyDate = (s: string) => {
  const d = new Date(s + "T00:00:00")
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })
}

type Tab = "dashboard" | "birthdays" | "calendar" | "profile"

export default function DtrPage() {
  const emp = useHrEmployees()
  const hol = useHrHolidays()
  const ev = useHrEvents()
  const [tab, setTab] = useState<Tab>("dashboard")

  const email = currentUserEmail().toLowerCase()
  const me: HrEmployee | undefined = useMemo(() =>
    emp.rows.find(e => e.company_email.toLowerCase() === email && email) ||
    emp.rows.find(e => e.personal_email.toLowerCase() === email && email),
  [emp.rows, email])

  const now = new Date()
  const monthHolidays = useMemo(() => holidaysInMonth(hol.rows, now.getFullYear(), now.getMonth()), [hol.rows])   // eslint-disable-line react-hooks/exhaustive-deps
  const monthEvents = useMemo(() => eventsInMonth(ev.rows, now.getFullYear(), now.getMonth()), [ev.rows])         // eslint-disable-line react-hooks/exhaustive-deps
  const celebrants = useMemo(() => birthdayCelebrants(emp.rows, now.getMonth()), [emp.rows])                      // eslint-disable-line react-hooks/exhaustive-deps
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  const todayHoliday = monthHolidays.find(h => h.date === todayStr)

  const displayName = me ? fullNameOf(me) : (currentUserName() || email || "Employee")
  const firstName = me?.first_name || displayName.split(" ")[0] || "there"

  const NAV: { k: Tab; l: string; icon: any }[] = [
    { k: "dashboard", l: "Dashboard", icon: LayoutDashboard },
    { k: "birthdays", l: "Birthday Celebrants", icon: Cake },
    { k: "calendar", l: "Events and Holidays", icon: CalendarDays },
    { k: "profile", l: "Profile", icon: UserRound },
  ]

  return (
    <div className="min-h-full flex flex-col bg-slate-100">
      {/* Itim na topbar — LHIKE DTR look */}
      <header className="h-12 bg-slate-950 flex items-center px-4 gap-3 sticky top-0 z-40">
        <Fingerprint className="w-5 h-5 text-blue-400" />
        <span className="font-extrabold text-white tracking-wide">ODM <span className="text-blue-400">DTR</span></span>
        <div className="flex-1" />
        <Link href="/business/dashboard" className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to ERP
        </Link>
      </header>

      <div className="flex-1 flex">
        {/* Kaliwang profile sidebar */}
        <aside className="w-60 bg-slate-900 text-slate-300 flex-col py-6 px-3 hidden md:flex">
          <div className="flex flex-col items-center pb-6 border-b border-slate-800">
            <div className="w-20 h-20 rounded-full bg-slate-700 flex items-center justify-center text-3xl font-bold text-white">
              {(firstName[0] || "?").toUpperCase()}
            </div>
            <p className="mt-3 font-semibold text-white text-center leading-tight">{displayName}</p>
            {me
              ? <span className={`mt-2 text-[10px] font-bold px-2 py-0.5 rounded ${me.status === "Active" ? "bg-teal-500/20 text-teal-400" : "bg-slate-600/40 text-slate-300"}`}>{me.status.toUpperCase()}</span>
              : <span className="mt-2 text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-400">NOT IN 201 FILE</span>}
          </div>
          <nav className="mt-4 space-y-1">
            {NAV.map(n => (
              <button key={n.k} onClick={() => setTab(n.k)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold uppercase tracking-wide rounded-lg transition-colors ${
                  tab === n.k ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"}`}>
                <n.icon className="w-4 h-4" /> {n.l}
              </button>
            ))}
          </nav>
        </aside>

        <main className="flex-1 p-5 space-y-4">
          {/* Mobile nav — tabs sa itaas kapag walang sidebar */}
          <div className="md:hidden flex gap-2 overflow-x-auto pb-1">
            {NAV.map(n => (
              <button key={n.k} onClick={() => setTab(n.k)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold ${tab === n.k ? "bg-blue-600 text-white" : "bg-white text-slate-600 border border-slate-200"}`}>
                {n.l}
              </button>
            ))}
          </div>

          {tab === "dashboard" && (
            <>
              <div className="bg-white rounded-2xl border border-slate-200 p-6">
                <h1 className="text-xl font-extrabold text-slate-800">Welcome back, {firstName} !</h1>
                <p className="text-sm text-slate-500 mt-1">{now.toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
                {todayHoliday && (
                  <p className="mt-3 text-sm font-semibold" style={{ color: HOLIDAY_TYPES.find(t => t.key === todayHoliday.type)?.color }}>
                    🎉 {todayHoliday.name} today — {HOLIDAY_TYPES.find(t => t.key === todayHoliday.type)?.label}
                  </p>
                )}
                {!me && emp.loaded && (
                  <p className="mt-4 text-sm text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    Your login ({email || "no email"}) is not linked to a 201 File record yet — ask HR to set your <strong>Company Email</strong> in the 201 File.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { l: "Birthdays this month", v: celebrants.length },
                  { l: "Holidays this month", v: monthHolidays.length },
                  { l: "Events this month", v: monthEvents.length },
                ].map(c => (
                  <div key={c.l} className="bg-slate-900 rounded-xl px-4 py-4 text-center">
                    <p className="text-2xl font-extrabold text-white tabular-nums">{c.v}</p>
                    <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide mt-1">{c.l}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === "birthdays" && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <h2 className="font-bold text-slate-800 mb-3">Birthday Celebrants — {monthNames[now.getMonth()]}</h2>
              {celebrants.length === 0
                ? <p className="text-sm text-slate-400 italic py-6 text-center">No birthday celebrants this month.</p>
                : celebrants.map(e => (
                  <div key={e.id} className="py-2.5 border-b border-slate-100 last:border-0 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-800">{fullNameOf(e)}</span>
                    <span className="text-sm text-teal-600 font-semibold">{prettyDate(e.birthdate).replace(/, \d{4}$/, "")}</span>
                  </div>
                ))}
            </div>
          )}

          {tab === "calendar" && (
            <div className="space-y-4">
              <div className="bg-slate-900 rounded-2xl p-6 text-white">
                <h2 className="font-extrabold text-lg">Holidays — {monthNames[now.getMonth()]} {now.getFullYear()}</h2>
                <div className="flex items-center gap-3 mt-2 text-xs">
                  {HOLIDAY_TYPES.map(t => (
                    <span key={t.key} className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: t.color }} /> {t.label}</span>
                  ))}
                </div>
                {monthHolidays.length === 0
                  ? <p className="mt-4 italic text-slate-400 text-sm">No holidays this month.</p>
                  : monthHolidays.map(h => (
                    <p key={h.id} className="mt-3 text-sm flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: HOLIDAY_TYPES.find(t => t.key === h.type)?.color }} />
                      <span className="font-semibold">{prettyDate(h.date)}</span> · {h.name}
                    </p>
                  ))}
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 p-6">
                <h2 className="font-bold text-slate-800 mb-3">Company Events</h2>
                {monthEvents.length === 0
                  ? <p className="text-sm text-slate-400 italic py-4 text-center">No events this month.</p>
                  : monthEvents.map(e => (
                    <div key={e.id} className="py-2.5 border-b border-slate-100 last:border-0">
                      <p className="text-sm font-medium text-slate-800">{e.name}</p>
                      <p className="text-xs text-slate-500">{prettyDate(e.date)}{e.description ? ` — ${e.description}` : ""}</p>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {tab === "profile" && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-2xl">
              <h2 className="font-bold text-slate-800 mb-4">My Profile</h2>
              {!me ? (
                <p className="text-sm text-slate-500">Your login is not linked to a 201 File record yet. Ask HR to add you (Company Email = <strong>{email || "your PesoWise login"}</strong>).</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5">
                  {([
                    ["Employee No.", me.employee_no], ["Status", me.status],
                    ["Name", fullNameOf(me)], ["Gender", me.gender],
                    ["Position", me.position], ["Department", me.department],
                    ["Branch", me.branch], ["Date Hired", me.date_hired ? prettyDate(me.date_hired) : ""],
                    ["Birthdate", me.birthdate ? prettyDate(me.birthdate) : ""], ["Contact No.", me.contact_no],
                    ["Company Email", me.company_email], ["BIO ID", me.bio_id],
                    ["DTR Username", me.dtr_username],
                  ] as [string, string][]).map(([l, v]) => (
                    <div key={l} className="grid grid-cols-[130px_1fr] gap-2 py-1.5 border-b border-slate-50">
                      <span className="text-xs text-slate-400 font-semibold uppercase tracking-wide pt-0.5">{l}</span>
                      <span className="text-sm text-slate-800">{v || "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
