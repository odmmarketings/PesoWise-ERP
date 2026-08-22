"use client"
import { useCallback, useEffect, useRef, useState } from "react"
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
  // ⚠ Kapareho ng releaseStock (product-items-store): ang Shipped Out sync ay
  // tumatawag ng addRelease nang sunod-sunod sa IISANG closure, kaya ang bawat
  // tawag ay dating nagsisimula sa parehong lumang listahan at ang huli lang ang
  // natitira sa session cache (ang DB ay tama — kada row ang sulat). Ref ang
  // pinagpapatungan; ang fetch ay hindi na pumapatong kapag may nagbago na.
  const releasesRef = useRef<StockRelease[]>([])
  const dirtyRef = useRef(false)
  useEffect(() => {
    const cached = readCache()
    releasesRef.current = cached
    setReleases(cached)
    fetchRows("stock_releases", normalize, readCache, writeCache).then(list => {
      if (list && !dirtyRef.current) { const sorted = [...list].sort(byNewest); releasesRef.current = sorted; setReleases(sorted) }
    })
  }, [])
  const persist = useCallback((next: StockRelease[]) => { dirtyRef.current = true; releasesRef.current = next; writeCache(next); setReleases(next) }, [])

  // Ang tumatawag ay maaaring magbigay ng SARILING id (hal. "rel_shp_" +
  // tracking): dahil upsert-sa-id ang sulat, ang pag-ulit ng parehong bawas
  // ay HINDI na nagdodoble ng ledger row — ligtas nang ulitin balang araw.
  function addRelease(input: Omit<StockRelease, "id" | "date"> & { id?: string }) {
    const created: StockRelease = { ...input, id: input.id || uid(), date: new Date().toISOString() }
    persist([created, ...releasesRef.current.filter(r => r.id !== created.id)])
    writeRow("stock_releases", created)
  }
  return { releases, addRelease }
}
