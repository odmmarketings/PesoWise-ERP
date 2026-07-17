"use client"
import { ComingSoon } from "@/components/business/ComingSoon"
import { Printer } from "lucide-react"
export default function Page() {
  return <ComingSoon title="PPW (Barcode)" icon={Printer} accent="text-blue-600"
    note="Pending Printed Waybill — scan to confirm each parcel's waybill has been printed."
    points={["Barcode scan per parcel after waybill printing", "Moves parcels from Pending Printed Waybill → ready for shipping", "Printing log per batch"]} />
}
