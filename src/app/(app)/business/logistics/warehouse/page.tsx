"use client"
import { ComingSoon } from "@/components/business/ComingSoon"
import { Warehouse } from "lucide-react"
export default function Page() {
  return <ComingSoon title="Warehouse" icon={Warehouse} accent="text-blue-600"
    note="Warehouse locations and per-warehouse stock — transfers, counts, and packing flow."
    points={["Multiple warehouse locations with stock per site", "Stock transfers between warehouses", "Cycle counts / stock adjustments with audit trail"]} />
}
