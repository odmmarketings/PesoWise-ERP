"use client"
import { useState } from "react"
import { ComingSoon } from "@/components/business/ComingSoon"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import { Activity } from "lucide-react"
export default function Page() {
  const [dateA, setDateA] = useState("")
  const [dateB, setDateB] = useState("")
  return <ComingSoon title="TikTok Ads" icon={Activity} accent="text-slate-800"
    right={<DateRangePicker a={dateA} b={dateB} variant="header" onApply={(a, b) => { setDateA(a); setDateB(b) }} />}
    note="Connects to the TikTok Marketing API to pull spend per ad account / campaign."
    points={["Per ad account & campaign spend", "Daily spend → ROAS / Income Statement sync", "ROAS & CPP per campaign"]} />
}
