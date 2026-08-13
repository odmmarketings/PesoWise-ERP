"use client"
import { AlertTriangle } from "lucide-react"
import { DeliveryWorkspace, type QueueConfig } from "@/components/business/delivery/DeliveryWorkspace"
import { PROBLEMATIC_STATUSES } from "@/lib/delivery-store"

// Problematic / RTS queue — undeliverable, returning at returned orders na
// nire-recover ng agents (may Recovery status sa working form).
const CONFIG: QueueConfig = {
  type: "problematic",
  title: "Problematic / RTS Operations",
  icon: AlertTriangle,
  eligibleParcelStatuses: ["Problematic", "Returning", "Returned"],
  agentStatuses: PROBLEMATIC_STATUSES,
}

export default function ProblematicOperationsPage() {
  return <DeliveryWorkspace config={CONFIG} />
}
