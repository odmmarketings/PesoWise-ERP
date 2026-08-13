"use client"
import { ComingSoon } from "@/components/business/ComingSoon"
import { BookOpen } from "lucide-react"

export default function DeliveryScriptsPage() {
  return (
    <ComingSoon
      title="Call Scripts"
      icon={BookOpen}
      note="Phase 2 — approved call scripts for delivery at recovery agents."
      points={[
        "Out for Delivery Reminder · Delivery Confirmation · Address Confirmation",
        "Customer Unreachable Follow-Up · Rescheduling",
        "RTS Recovery · Customer Refusal Recovery · Problematic Order Follow-Up",
        "Admin ang gagawa/mag-e-edit; active scripts lang ang makikita ng agents",
      ]}
    />
  )
}
