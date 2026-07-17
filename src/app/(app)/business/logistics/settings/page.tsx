"use client"
import { ComingSoon } from "@/components/business/ComingSoon"
import { Settings } from "lucide-react"
export default function Page() {
  return <ComingSoon title="Logistics Settings" icon={Settings} accent="text-blue-600"
    note="Reference data for the Logistic & Inventory suite — categories, units, and thresholds."
    points={["Item categories & units of measure", "Default low-stock thresholds per item/category", "Courier & warehouse defaults"]} />
}
