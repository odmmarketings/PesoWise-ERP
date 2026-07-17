"use client"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Menu, ArrowLeftRight, Crown, Clock } from "lucide-react"
import type { AppMode, Plan } from "@/lib/types"
import { getDaysRemaining } from "@/lib/utils"

interface TopbarProps {
  mode: AppMode
  plan: Plan
  trialEndsAt: string | null
  onToggleMode: () => void
  onToggleSidebar: () => void
  onUpgrade: () => void
}

const planBadgeMap: Record<Plan, { label: string; variant: "trial" | "pro" | "premium" }> = {
  trial: { label: "14-Day Trial", variant: "trial" },
  pro: { label: "Pro", variant: "pro" },
  premium: { label: "Premium", variant: "premium" },
}

export function Topbar({ mode, plan, trialEndsAt, onToggleMode, onToggleSidebar, onUpgrade }: TopbarProps) {
  const daysLeft = trialEndsAt ? getDaysRemaining(trialEndsAt) : 0
  const badge = planBadgeMap[plan]

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

      {/* Plan badge */}
      <Badge variant={badge.variant} className="cursor-default">
        {plan === "premium" && <Crown className="w-3 h-3 mr-1" />}
        {badge.label}
      </Badge>

      {/* Upgrade button */}
      {plan !== "premium" && (
        <Button size="sm" variant={plan === "trial" ? "default" : "outline"} onClick={onUpgrade}>
          {plan === "trial" ? "Upgrade Now" : "Go Premium"}
        </Button>
      )}

      {/* Mode switcher — only for premium */}
      {plan === "premium" && (
        <button
          onClick={onToggleMode}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
            mode === "business"
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }`}
        >
          <ArrowLeftRight className="w-4 h-4" />
          {mode === "business" ? "Personal Mode" : "Business Mode"}
        </button>
      )}
    </header>
  )
}
