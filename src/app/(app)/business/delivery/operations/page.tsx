"use client"
import { Truck } from "lucide-react"
import { DeliveryWorkspace, type QueueConfig } from "@/components/business/delivery/DeliveryWorkspace"
import { DELIVERING_STATUSES } from "@/lib/delivery-store"

// Delivering queue — Out for Delivery / In-Transit orders na tinatawagan ng agents.
const CONFIG: QueueConfig = {
  type: "delivering",
  title: "Delivery Operations",
  icon: Truck,
  eligibleParcelStatuses: ["Out for Delivery", "In-Transit", "Shipped Out", "Picked Up"],
  agentStatuses: DELIVERING_STATUSES,
}

export default function DeliveryOperationsPage() {
  return <DeliveryWorkspace config={CONFIG} />
}
