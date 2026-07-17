"use client"
import { Button } from "@/components/ui/button"
import { X, Check, Crown } from "lucide-react"
import Link from "next/link"
import type { Plan } from "@/lib/types"

interface UpgradeModalProps {
  currentPlan: Plan
  featureName?: string
  onClose: () => void
}

export function UpgradeModal({ currentPlan, featureName, onClose }: UpgradeModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
              <Crown className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900">Upgrade Required</h2>
              {featureName && <p className="text-sm text-slate-500">{featureName} is a premium feature</p>}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {currentPlan === "trial" && (
            <div className="rounded-xl border-2 border-green-500 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-slate-900">Pro Plan</h3>
                <span className="font-bold text-green-600">₱499/mo</span>
              </div>
              <ul className="space-y-2">
                {["Unlimited expenses & categories", "Full dashboard + charts", "Budget tracking", "Export CSV/PDF"].map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm text-slate-600">
                    <Check className="w-4 h-4 text-green-500" />{f}
                  </li>
                ))}
              </ul>
              <Button className="w-full mt-4" asChild>
                <Link href="/upgrade?plan=pro" onClick={onClose}>Get Pro</Link>
              </Button>
            </div>
          )}

          <div className={`rounded-xl border-2 p-4 ${currentPlan === "pro" ? "border-purple-500" : "border-slate-200"}`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                Premium Plan <Crown className="w-4 h-4 text-amber-500" />
              </h3>
              <span className="font-bold text-purple-600">₱999/mo</span>
            </div>
            <ul className="space-y-2">
              {["AI Chat Expense Logger", "Screenshot → Auto Bank Update", "Net Worth Tracker", "Bill Reminders", "Monthly Report Presentation", "Business ERP Mode"].map(f => (
                <li key={f} className="flex items-center gap-2 text-sm text-slate-600">
                  <Check className="w-4 h-4 text-purple-500" />{f}
                </li>
              ))}
            </ul>
            <Button variant="premium" className="w-full mt-4" asChild>
              <Link href="/upgrade?plan=premium" onClick={onClose}>Get Premium</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
