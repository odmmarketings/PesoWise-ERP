"use client"
import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Menu, Clock, ArrowLeftRight, Fingerprint } from "lucide-react"
import type { Plan } from "@/lib/types"
import { getDaysRemaining } from "@/lib/utils"
import { isMotherAccount } from "@/lib/users-store"

interface TopbarProps {
  plan: Plan
  trialEndsAt: string | null
  onToggleSidebar: () => void
  onUpgrade: () => void
}

// Walang plan badge sa topbar — panloob na ERP ito, at ang laging nakasabit na
// "Premium" ay kalat lang. Nananatili ang trial warning at Upgrade button dahil
// may silbi pa sila sa mga hindi pa premium.
export function Topbar({ plan, trialEndsAt, onToggleSidebar, onUpgrade }: TopbarProps) {
  const daysLeft = trialEndsAt ? getDaysRemaining(trialEndsAt) : 0
  const pathname = usePathname()
  const inHr = pathname.startsWith("/hr")

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center px-4 gap-4 sticky top-0 z-30">
      <button
        onClick={onToggleSidebar}
        className="lg:hidden p-2 rounded-lg hover:bg-slate-100 text-slate-600"
      >
        <Menu className="w-5 h-5" />
      </button>

      <div className="flex-1" />

      {/* Trial warning */}
      {plan === "trial" && daysLeft <= 7 && (
        <div className="hidden sm:flex items-center gap-2 text-amber-600 text-sm bg-amber-50 px-3 py-1.5 rounded-lg">
          <Clock className="w-4 h-4" />
          <span className="font-medium">{daysLeft} days left in trial</span>
        </div>
      )}

      {/* Upgrade button */}
      {plan !== "premium" && (
        <Button size="sm" variant={plan === "trial" ? "default" : "outline"} onClick={onUpgrade}>
          {plan === "trial" ? "Upgrade Now" : "Go Premium"}
        </Button>
      )}

      {/* ODM DTR — employee self-view; bukas sa lahat ng naka-login. */}
      <Link href="/dtr"
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-900 text-white hover:bg-slate-800 transition-colors">
        <Fingerprint className="w-4 h-4" /> ODM DTR
      </Link>

      {/* HR Mode ↔ Business Mode — kapareho ng dating personal-mode switcher,
          pero HR na. Mother Account lang ang nakakakita: PII ang laman ng HR. */}
      {isMotherAccount() && (
        <Link href={inHr ? "/business/dashboard" : "/hr/dashboard"}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            inHr ? "bg-slate-100 text-slate-700 hover:bg-slate-200" : "bg-blue-600 text-white hover:bg-blue-700"
          }`}>
          <ArrowLeftRight className="w-4 h-4" />
          {inHr ? "Business Mode" : "HR Mode"}
        </Link>
      )}
    </header>
  )
}
