"use client"
import { useCallback, useEffect, useState } from "react"
import { fetchRows, writeRow } from "@/lib/supa-rows"

// Stock release log — every STOCKS UPDATE submit is recorded here (audit trail for the
// Warehouse / RTS modules later). The actual deduction lives on ProductItem.released.
// Source of truth = Supabase `stock_releases`; localStorage = same-session read cache.
const KEY = "pesowise_stock_releases"

export interface StockReleaseItem {
  item_id: string
  sku: string
  name: string
  required: number   // qty per bundle at release time
  release: number    // bundles/units entered in Release Qty
  deducted: number   // release × required — what was actually subtracted
}
export interface StockRelease {
  id: string
  date: string       // ISO timestamp
  category: string   // which search category was used (Sku Code / Unit Code / Item Code / Item Name)
  ref: string        // the selected value (e.g. the unit code)
  items: StockReleaseItem[]
}

function uid() { return `rel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }
function normalize(r: Partial<StockRelease>): StockRelease {
  return {
    id: r.id || uid(),
    date: r.date || "",
    category: r.category || "",
    ref: r.ref || "",
    items: Array.isArray(r.items) ? r.items : [],
  }
}

function readCache(): StockRelease[] {
  if (typeof window === "undefined") return []
  try { const raw = localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as Partial<StockRelease>[]).map(normalize) : [] } catch { return [] }
}
function writeCache(list: StockRelease[]) { try { localStorage.setItem(KEY, JSON.stringify(list)) } catch {} }
const byNewest = (a: StockRelease, b: StockRelease) => (b.date || "").localeCompare(a.date || "")

export function useStockReleases() {
  const [releases, setReleases] = useState<StockRelease[]>([])
  useEffect(() => {
    setReleases(readCache())
    fetchRows("stock_releases", normalize, readCache, writeCache).then(list => { if (list) setReleases([...list].sort(byNewest)) })
  }, [])
  const persist = useCallback((next: StockRelease[]) => { writeCache(next); setReleases(next) }, [])

  function addRelease(input: Omit<StockRelease, "id" | "date">) {
    const created: StockRelease = { ...input, id: uid(), date: new Date().toISOString() }
    persist([created, ...releases])
    writeRow("stock_releases", created)
  }
  return { releases, addRelease }
}
