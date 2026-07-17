"use client"
import { ComingSoon } from "@/components/business/ComingSoon"
import { ScanBarcode } from "lucide-react"
export default function Page() {
  return <ComingSoon title="Shipped Out (Barcode)" icon={ScanBarcode} accent="text-blue-600"
    note="Scan the waybill barcode on handover — marks the order shipped out and deducts stock per the unit-code recipe."
    points={["Barcode scan per parcel on courier pickup", "Auto stock deduction via the Stocks module (COG sold tracking)", "Shipped-out log per day / courier"]} />
}
