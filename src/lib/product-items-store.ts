"use client"
import { useCallback, useEffect, useState } from "react"
import { fetchRows, writeRow, writeManyRows, deleteRowById } from "@/lib/supa-rows"

// Product Items (Inventory) — item master. Quantities: Goods / Damage / Loss / Released;
// Remaining = Goods − Damage − Loss − Released. "Released" accumulates stock-outs from the
// STOCKS module (LHIKE Stocks Update). Delete is SOFT (recoverable via "View All Deleted Items");
// Archive is a separate flag, per the LHIKE manual. Source of truth = Supabase `product_items`;
// `pesowise_product_items` localStorage is now just a same-session read cache (migrated up once).
const KEY = "pesowise_product_items"

export const ITEM_STATUSES = ["Active", "Inactive"] as const
export type ItemStatus = typeof ITEM_STATUSES[number]

export interface ProductItem {
  id: string
  sku: string
  name: string
  description: string
  picture: string             // downscaled data URL (item photo)
  cog: number
  color: string
  size: string
  type: string
  supplier: string            // Supplier Store Name
  goods: number
  damage: number
  loss: number
  released: number            // total stock-outs applied via the Stocks module
  status: ItemStatus
  archived: boolean
  deleted: boolean
  created_at: string
}
export type NewItemInput = Omit<ProductItem, "id" | "created_at" | "archived" | "deleted" | "released">

export const itemRemaining = (i: Pick<ProductItem, "goods" | "damage" | "loss"> & { released?: number }) => i.goods - i.damage - i.loss - (i.released || 0)

function uid() { return `itm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }
function normalize(r: Partial<ProductItem>): ProductItem {
  return {
    id: r.id || uid(),
    sku: r.sku || "",
    name: r.name || "",
    description: r.description || "",
    picture: r.picture || "",
    cog: Number(r.cog) || 0,
    color: r.color || "",
    size: r.size || "",
    type: r.type || "",
    supplier: r.supplier || "",
    goods: Number(r.goods) || 0,
    damage: Number(r.damage) || 0,
    loss: Number(r.loss) || 0,
    released: Number(r.released) || 0,
    status: r.status === "Inactive" ? "Inactive" : "Active",
    archived: r.archived ?? false,
    deleted: r.deleted ?? false,
    created_at: r.created_at || new Date().toISOString(),
  }
}

function readCache(): ProductItem[] {
  if (typeof window === "undefined") return []
  try { const raw = localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as Partial<ProductItem>[]).map(normalize) : [] }
  catch { return [] }
}
function writeCache(list: ProductItem[]) { try { localStorage.setItem(KEY, JSON.stringify(list)) } catch {} }
const byNewest = (a: ProductItem, b: ProductItem) => (b.created_at || "").localeCompare(a.created_at || "")

export function useProductItems() {
  const [items, setItems] = useState<ProductItem[]>([])
  useEffect(() => {
    setItems(readCache())
    fetchRows("product_items", normalize, readCache, writeCache).then(list => { if (list) setItems([...list].sort(byNewest)) })
  }, [])
  const persist = useCallback((next: ProductItem[]) => { writeCache(next); setItems(next) }, [])

  function addItem(input: NewItemInput) {
    const created = normalize({ ...input, id: uid(), created_at: new Date().toISOString() })
    persist([created, ...items])
    writeRow("product_items", created)
  }
  function addMany(inputs: NewItemInput[]) {
    const now = new Date().toISOString()
    const created = inputs.map(i => normalize({ ...i, id: uid(), created_at: now }))
    persist([...created, ...items])
    writeManyRows("product_items", created)
  }
  function updateItem(id: string, input: Partial<NewItemInput>) {
    const next = items.map(i => i.id === id ? normalize({ ...i, ...input }) : i)
    persist(next)
    const row = next.find(i => i.id === id)
    if (row) writeRow("product_items", row)
  }
  function softDelete(id: string) { flag(id, { deleted: true }) }
  function restoreItem(id: string) { flag(id, { deleted: false }) }
  function hardDelete(id: string) {
    persist(items.filter(i => i.id !== id))
    deleteRowById("product_items", id)
  }
  function setArchived(id: string, archived: boolean) { flag(id, { archived }) }
  function flag(id: string, patch: Partial<ProductItem>) {
    const next = items.map(i => i.id === id ? { ...i, ...patch } : i)
    persist(next)
    const row = next.find(i => i.id === id)
    if (row) writeRow("product_items", row)
  }
  // Stocks module: apply stock-outs (adds to each item's cumulative `released`).
  function releaseStock(deltas: { id: string; qty: number }[]) {
    const m = new Map(deltas.map(d => [d.id, d.qty]))
    const next = items.map(i => m.has(i.id) ? { ...i, released: (i.released || 0) + (m.get(i.id) || 0) } : i)
    persist(next)
    writeManyRows("product_items", next.filter(i => m.has(i.id)))
  }

  // Usable items (for pickers): active, not deleted, not archived.
  const activeItems = items.filter(i => i.status === "Active" && !i.deleted && !i.archived)
  return { items, activeItems, addItem, addMany, updateItem, softDelete, restoreItem, hardDelete, setArchived, releaseStock }
}
