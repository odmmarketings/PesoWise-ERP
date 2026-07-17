"use client"
import { useState } from "react"
import { ComingSoon } from "@/components/business/ComingSoon"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import { Package } from "lucide-react"
export default function Page() {
  const [dateA, setDateA] = useState("")
  const [dateB, setDateB] = useState("")
  return <ComingSoon title="Lazada Ads" icon={Package} accent="text-indigo-600"
    right={<DateRangePicker a={dateA} b={dateB} variant="header" onApply={(a, b) => { setDateA(a); setDateB(b) }} />}
    note="Connects to Lazada Sponsored Solutions API to pull Lazada Ads spend per shop."
    points={["Sponsored Ads spend per shop", "Daily spend sync", "ROAS per shop"]} />
}
