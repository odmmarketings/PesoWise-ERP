"use client"
import { FileText } from "lucide-react"
import { ComingSoon } from "@/components/business/ComingSoon"

export default function TmReportsPage() {
  return (
    <ComingSoon
      title="Telemarketing Reports"
      icon={FileText}
      note="Phase 3 — scheduled team + per-agent sales updates (9AM/12PM/3PM/6PM/8PM, configurable) with Discord delivery."
      points={[
        "Auto-generated mula sa tm_sales/tm_calls — hindi manually encoded",
        "Team totals + per-agent breakdown + today vs yesterday comparison",
        "Discord webhook delivery (pattern: scripts/roas-discord-report.mjs + GitHub Actions cron)",
        "Report history at daily-performance monthly table (Day 1–31 + MONTH TOTAL)",
      ]}
    />
  )
}
