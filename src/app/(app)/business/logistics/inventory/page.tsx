"use client"
import { ComingSoon } from "@/components/business/ComingSoon"
import { Package } from "lucide-react"
export default function Page() {
  return <ComingSoon title="Inventory" icon={Package} accent="text-blue-600"
    note="Stock levels per item — movements in/out, low-stock floors, and valuation."
    points={["Item master list with stock on hand", "Stock movements (PO receiving, sales deductions, RTS restock)", "Low-stock thresholds → powers the Sales Tracker out-of-stock / low-stock colors"]} />
}
