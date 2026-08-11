"use client"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Menu, Clock } from "lucide-react"
import type { Plan } from "@/lib/types"
import { getDaysRemaining } from "@/lib/utils"
import { ThemeToggle } from "@/components/layout/ThemeToggle"

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

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center px-4 gap-4 sticky top-0 z-30">
      <button
        onClick={onToggleSidebar}
        className="lg:hidden p-2 rounded-lg hover:bg-slate-100 text-slate-600"
      >
        <Menu className="w-5 h-5" />
      </button>

      <div className="flex-1" />

      <ThemeToggle />

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

    </header>
  )
}
