// SHIPPED OUT — pinagsasaluhang lohika ng manual scan at ng automated Pancake sync.
//
// Iisang resipe ang ginagamit ng dalawa. Kung magkahiwalay ang kopya nila, darating ang
// araw na magkaiba ang binabawas ng scan at ng sync sa iisang parcel — at tahimik iyon.

import type { ProductItem } from "@/lib/product-items-store"
import type { UnitCode } from "@/lib/unit-codes-store"
import type { ShippedScanItem } from "@/lib/shipped-out-store"

export type RecipeComponent = { itemId: string; sku: string; name: string; qty: number }
export type RecipeMap = Map<string, RecipeComponent[]>

/**
 * Pangalan sa order → mga Product Item na babawasan.
 *
 * Dalawa ang puwedeng maging susi, at PAREHONG naka-lowercase:
 *   • pangalan ng Product Item — tuwirang benta, isang piraso kada isa
 *   • ang Unit Code mismo      — bundle, sinusundan ang qty ng resipe nito
 *
 * Ang unit code ang nananaig kapag nagkapareho — ito ang tumutugma sa produktong
 * ginawa sa Pancake (name = custom_id = barcode = ang code).
 */
export function buildRecipes(items: ProductItem[], codes: UnitCode[]): RecipeMap {
  const alive = items.filter(i => !i.deleted)
  const byName = new Map(alive.map(i => [i.name.toLowerCase(), i]))
  const m: RecipeMap = new Map()
  for (const i of alive) {
    const k = i.name.toLowerCase()
    if (!m.has(k)) m.set(k, [{ itemId: i.id, sku: i.sku, name: i.name, qty: 1 }])
  }
  for (const c of codes) {
    if (!c.code) continue
    const comps = c.items
      .map(r => {
        const it = byName.get(r.name.toLowerCase())
        return it ? { itemId: it.id, sku: it.sku, name: it.name, qty: r.qty || 1 } : null
      })
      .filter(Boolean) as RecipeComponent[]
    if (comps.length) m.set(c.code.toLowerCase(), comps)
  }
  return m
}

/** "2x Lumyra, 1x LUM2X" → [{qty:2,name:"Lumyra"}, {qty:1,name:"LUM2X"}] */
export function parseOrderItems(orderItem: string) {
  return String(orderItem || "").split(",").map(s => s.trim()).filter(Boolean).map(seg => {
    const m = seg.match(/^(\d+)\s*x\s*(.+)$/i)
    return m ? { qty: Number(m[1]) || 1, name: m[2].trim() } : { qty: 1, name: seg }
  })
}

/**
 * Binubuklat ang teksto ng order tungo sa aktwal na babawasang Product Item.
 * Ang `unmapped` ay ang mga pangalang walang katugmang unit code o product item —
 * ipinapakita ito sa UI dahil ibig sabihin nito ay may hindi nababawasan.
 */
export function explodeOrderItems(orderItem: string, recipes: RecipeMap) {
  const perItem = new Map<string, ShippedScanItem>()
  const unmapped: string[] = []
  for (const li of parseOrderItems(orderItem)) {
    const recipe = recipes.get(li.name.toLowerCase())
    if (!recipe) { unmapped.push(li.name); continue }
    for (const c of recipe) {
      const add = li.qty * c.qty
      const prev = perItem.get(c.itemId)
      if (prev) prev.deducted += add
      else perItem.set(c.itemId, { item_id: c.itemId, sku: c.sku, name: c.name, deducted: add })
    }
  }
  const items = Array.from(perItem.values())
  return { items, unmapped, total: items.reduce((s, i) => s + i.deducted, 0) }
}

// ── Kailan itinuturing na UMALIS NA ang parcel ───────────────────────────────
// Hindi lang "Shipped" ang tinitingnan. Pana-panahon tumatakbo ang sync, kaya
// posibleng maabutan na natin ang parcel na Delivered na — kung "Shipped" lang ang
// hinahanap, lalampasan ito at hindi na mababawasan kailanman.
//
// SINASADYANG WALA RITO ang "Waiting for Pick Up": may waybill na iyon pero nasa
// bodega pa (ang PPW mo) — hindi pa dapat bumababa ang stock.
const LEFT_WAREHOUSE = [
  ["ship"],                       // shipped
  ["deliver"],                    // delivered / delivering
  ["return"],                     // returning / returned — nakaalis bago bumalik
]
export function hasLeftWarehouse(orderStatus: string): boolean {
  const s = String(orderStatus || "").toLowerCase()
  if (!s) return false
  // Ang "waiting for pickup" ay naglalaman ng "pick", hindi ng alinman sa itaas — ligtas.
  return LEFT_WAREHOUSE.some(g => g.some(m => s.includes(m)))
}

/** Isang Pancake row na karapat-dapat nang bawasan sa inventory. */
export function isDeductable(row: { tracking_no?: string; order_status?: string }) {
  return !!String(row.tracking_no || "").trim() && hasLeftWarehouse(String(row.order_status || ""))
}
