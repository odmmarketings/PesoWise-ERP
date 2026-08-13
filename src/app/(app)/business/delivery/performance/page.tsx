"use client"
import { ComingSoon } from "@/components/business/ComingSoon"
import { Award } from "lucide-react"

export default function AgentPerformancePage() {
  return (
    <ComingSoon
      title="Agent Performance"
      icon={Award}
      note="Phase 2 — per-agent KPI scorecards computed from the Delivery & Problematic workspaces."
      points={[
        "Per-agent scorecard: Assigned, Worked, Delivered, RTS, Recovery, Contact Rate",
        "Configurable KPI weights (Delivery / Contact / Recovery / Productivity)",
        "Click an agent for a detailed individual performance view",
        "Delivery Rate, RTS Rate at Recovery Rate trends per agent",
      ]}
    />
  )
}
