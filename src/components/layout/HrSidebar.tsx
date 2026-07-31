"use client"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  Users, FolderOpen, CalendarDays, PartyPopper, LogOut, ArrowLeftRight, LayoutDashboard,
} from "lucide-react"

// ──────────────────────────────────────────────────────────────────────────────
// PESOWISE HR — sidebar ng HR Mode. Hinango sa LHIKE HRIS na sidebar (dark navy,
// section headers, star accents) pero ang mga item lang na TOTOONG gawa na ang
// nakalista — walang dead link. Dagdagan ito habang dumadami ang HR pages.
// ──────────────────────────────────────────────────────────────────────────────

const NAV: { section: string; items: { href: string; icon: any; label: string }[] }[] = [
  {
    section: "DASHBOARD",
    items: [{ href: "/hr/dashboard", icon: LayoutDashboard, label: "HR Dashboard" }],
  },
  {
    section: "HR",
    items: [
      { href: "/hr/201-file", icon: FolderOpen, label: "201 File" },
      { href: "/hr/holiday", icon: CalendarDays, label: "Holiday" },
      { href: "/hr/events", icon: PartyPopper, label: "Events" },
    ],
  },
]

export function HrSidebar({ userName, onLogout }: { userName: string; onLogout: () => void }) {
  const pathname = usePathname()
  return (
    <aside className="w-64 h-screen bg-slate-900 flex flex-col text-slate-300 flex-shrink-0">
      <div className="h-16 flex items-center px-6 border-b border-slate-800">
        <Link href="/hr/dashboard" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
            <Users className="w-4 h-4" />
          </div>
          <span className="font-bold text-white text-lg">PesoWise HR</span>
        </Link>
      </div>

      <nav className="flex-1 px-3 pb-4 overflow-y-auto space-y-0.5 scrollbar-dark">
        {NAV.map(sec => (
          <div key={sec.section} className="pt-3">
            <p className="px-3 py-1 mb-1 text-[11px] font-semibold tracking-widest text-slate-500">{sec.section}</p>
            <div className="space-y-0.5">
              {sec.items.map(item => (
                <Link key={item.href} href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors",
                    pathname === item.href ? "bg-blue-600 text-white" : "hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                  )}>
                  <item.icon className="w-4 h-4 flex-shrink-0" />
                  <span className="flex-1 leading-tight">{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-800 p-3 space-y-1">
        <Link href="/business/dashboard"
          className="flex items-center gap-3 px-3 py-2 text-sm rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors">
          <ArrowLeftRight className="w-4 h-4" /> Business Mode
        </Link>
        <button onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg hover:bg-slate-800 text-slate-400 hover:text-red-400 transition-colors">
          <LogOut className="w-4 h-4" /> Sign Out
        </button>
        <div className="px-3 py-2 text-xs text-slate-600 truncate">{userName}</div>
      </div>
    </aside>
  )
}
