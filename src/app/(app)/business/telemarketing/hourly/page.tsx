"use client"
import { Clock3 } from "lucide-react"
import { ComingSoon } from "@/components/business/ComingSoon"

export default function TmHourlyPage() {
  return (
    <ComingSoon
      title="Hourly Sales"
      icon={Clock3}
      note="Phase 2 — auto-bucketed hourly performance mula sa tm_sales/tm_calls timestamps (walang manual hourly encoding)."
      points={[
        "Configurable hour blocks (default 8AM–8PM) mula sa Telemarketing Settings",
        "Per hour: upsell/cross-sell orders & amounts, calls, connected, contact rate, conversion",
        "DAILY TOTAL footer + monthly hourly analysis (aling oras ang pinakamabenta)",
        "Filter by team, agent, month, product, upsell/cross-sell",
      ]}
    />
  )
}
