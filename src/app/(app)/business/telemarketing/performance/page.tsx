"use client"
import { Award } from "lucide-react"
import { ComingSoon } from "@/components/business/ComingSoon"

export default function TmPerformancePage() {
  return (
    <ComingSoon
      title="Agent Performance"
      icon={Award}
      note="Phase 2 — leaderboard, KPI score na may breakdown, at per-agent comparison mula sa parehong tm_sales/tm_calls data."
      points={[
        "Leaderboard: total sales, upsell, cross-sell, conversion, contact rate, orders, target %",
        "Composite KPI score (0–100) with admin-configurable weights + visible breakdown",
        "Product performance: upsell/cross-sell revenue per product + top agent",
        "Funnel view: Assigned → Called → Connected → Interested → Sold → Completed",
      ]}
    />
  )
}
