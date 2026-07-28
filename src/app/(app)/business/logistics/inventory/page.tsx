"use client"
import { Package, RefreshCw } from "lucide-react"
import { useProductItems } from "@/lib/product-items-store"
import { InventoryDashboard } from "@/components/business/inventory/InventoryDashboard"

// INVENTORY DASHBOARD — buod ng buong warehouse stock. Kaparehong view ng tab sa loob
// ng Product Items (iisang component), pero may sariling ruta para direktang mapuntahan
// mula sa sidebar nang hindi dumadaan sa listahan.

export default function InventoryDashboardPage() {
  const store = useProductItems()
  const live = store.items.filter(i => !i.deleted && !i.archived)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2 pb-4 border-b border-slate-100">
        <div>
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2">
            <Package className="w-5 h-5" /> INVENTORY DASHBOARD
          </h1>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {live.length} active item{live.length === 1 ? "" : "s"} · halaga, natitirang stock, paubos/patay na stock, at stock-out audit
          </p>
        </div>
        <button onClick={() => window.location.reload()} title="Refresh"
          className="h-9 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <InventoryDashboard items={store.items} />
    </div>
  )
}
