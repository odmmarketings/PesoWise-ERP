"use client"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Menu, Clock, PanelLeftClose, PanelLeftOpen } from "lucide-react"
import type { Plan } from "@/lib/types"
import { getDaysRemaining } from "@/lib/utils"
import { ThemeToggle } from "@/components/layout/ThemeToggle"
import { NotificationBell } from "@/components/layout/NotificationBell"

interface TopbarProps {
  plan: Plan
  trialEndsAt: string | null
  onToggleSidebar: () => void
  onUpgrade: () => void
  /** Desktop: isinasara ang sidebar para sa full-width na talahanayan. */
  onToggleCollapsed?: () => void
  collapsed?: boolean
}

// Walang plan badge sa topbar — panloob na ERP ito, at ang laging nakasabit na
// "Premium" ay kalat lang. Nananatili ang trial warning at Upgrade button dahil
// may silbi pa sila sa mga hindi pa premium.
export function Topbar({ plan, trialEndsAt, onToggleSidebar, onUpgrade, onToggleCollapsed, collapsed }: TopbarProps) {
  const daysLeft = trialEndsAt ? getDaysRemaining(trialEndsAt) : 0

  // Bahagyang lumulusot ang laman sa likod habang nag-i-scroll — tanda na may
  // higit pa sa itaas. `bg-white/95` ay may dark rule na, kaya hindi ito
  // nagiging maputing guhit sa madilim na tema.
  return (
    <header className="h-16 bg-white/95 backdrop-blur-md border-b border-slate-200 flex items-center px-4 gap-4 sticky top-0 z-50">
      {/* Cellphone: drawer. Desktop: tuluyang pagsasara. Dalawang buton, hindi
          isang buton na nanghuhula ng laki ng screen. */}
      <button
        onClick={onToggleSidebar}
        aria-label="Open menu"
        className="lg:hidden p-2 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors active:scale-95"
      >
        <Menu className="w-5 h-5" />
      </button>
      {onToggleCollapsed && (
        <button
          onClick={onToggleCollapsed}
          title={collapsed ? "Show menu" : "Hide menu — full width"}
          aria-label={collapsed ? "Show menu" : "Hide menu"}
          className="hidden lg:block p-2 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors active:scale-95"
        >
          {collapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
        </button>
      )}

      <div className="flex-1" />

      <NotificationBell />
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
