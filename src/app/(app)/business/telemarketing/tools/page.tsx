"use client"
import { Wrench } from "lucide-react"
import { ComingSoon } from "@/components/business/ComingSoon"

export default function TmToolsPage() {
  return (
    <ComingSoon
      title="Tools & Integrations"
      icon={Wrench}
      note="Phase 4 — GoDial call-data sync at Pancake order pulls para sa leads."
      points={[
        "GoDial CSV/Excel import — calls matched sa lead → agent → date/time",
        "GoDial API sync kung available (agent, status, duration, attempts, disposition)",
        "Pancake order pull → auto-create leads mula sa existing customer orders",
        "Bulk lead import template (xlsx-js-style, same pattern sa J&T fee import)",
      ]}
    />
  )
}
