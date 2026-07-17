"use client"
import { useState } from "react"
import { ComingSoon } from "@/components/business/ComingSoon"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import { ShoppingBag } from "lucide-react"
export default function Page() {
  const [dateA, setDateA] = useState("")
  const [dateB, setDateB] = useState("")
  return <ComingSoon title="Shopee Ads" icon={ShoppingBag} accent="text-orange-500"
    right={<DateRangePicker a={dateA} b={dateB} variant="header" onApply={(a, b) => { setDateA(a); setDateB(b) }} />}
    note="Connects to the Shopee Open API to pull Shopee Ads spend per shop."
    points={["Spend per shop / campaign", "Daily spend sync", "ROAS per shop"]} />
}
