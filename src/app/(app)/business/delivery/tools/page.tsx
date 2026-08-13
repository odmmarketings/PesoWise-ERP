"use client"
import { ComingSoon } from "@/components/business/ComingSoon"
import { Wrench } from "lucide-react"

export default function DeliveryToolsPage() {
  return (
    <ComingSoon
      title="Tools & Imports"
      icon={Wrench}
      note="Phase 3 — GoDial call data import at sync tooling para sa Admin/Supervisor."
      points={[
        "Import GoDial call exports (CSV/Excel) — matched sa orders at agents",
        "Calls Made · Connected · Not Connected · Contact Rate",
        "Import history, error downloads, reprocess failed records",
        "View last Pancake sync status",
      ]}
    />
  )
}
