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
  // ⚠ MAY DOBLENG PANGALAN SA TOTOONG DATOS (Ago 22 2026: "Educational Flash
  // Card" = 3 buhay na row — 2 archived na walang stock + 1 totoo). Ang dating
  // `new Map(alive.map(...))` ay ANG HULI ANG PANALO, at doon tumama ang
  // archived na walang laman: ang bundle ay babawas sa patay na row habang
  // buo ang totoong stock. Ang pagpili ay sadyang pinapanigan ang item na
  // tunay na binebenta — hindi archived, Active, may natitirang stock — at
  // ang pinakabago kapag tabla. Ang TRIM ay pareho ring kasama: ang pangalang
  // may espasyo sa dulo ay hindi dapat mag-iba ng item.
  const remaining = (i: ProductItem) => i.goods - i.damage - i.loss - (i.released || 0)
  const score = (i: ProductItem) => (i.archived ? 0 : 8) + (i.status === "Active" ? 4 : 0) + (remaining(i) > 0 ? 2 : 0)
  const best = new Map<string, ProductItem>()
  for (const i of alive) {
    const k = i.name.trim().toLowerCase()
    if (!k) continue
    const prev = best.get(k)
    if (!prev || score(i) > score(prev) || (score(i) === score(prev) && (i.created_at || "") > (prev.created_at || ""))) best.set(k, i)
  }
  const m: RecipeMap = new Map()
  for (const [k, i] of best) m.set(k, [{ itemId: i.id, sku: i.sku, name: i.name, qty: 1 }])
  for (const c of codes) {
    if (!c.code) continue
    // ⚠ BUO O WALA. Ang bundle na may nawawalang sangkap ay HINDI mina-map nang
    // kalahati: ang "1x A + 1x B" na hindi mahanap si B ay babawas lang kay A
    // nang tahimik — mas mabuti ang 0 na kitang-kita sa unmatched banner kaysa
    // kulang na bawas na walang nakakapansin.
    const comps = c.items.map(r => {
      const it = best.get(String(r.name || "").trim().toLowerCase())
      return it ? { itemId: it.id, sku: it.sku, name: it.name, qty: r.qty || 1 } : null
    })
    if (comps.length && comps.every(Boolean)) m.set(c.code.trim().toLowerCase(), comps as RecipeComponent[])
  }
  return m
}

/**
 * "2x Lumyra, 1x LUM2X" → [{qty:2,name:"Lumyra"}, {qty:1,name:"LUM2X"}] — O ang
 * STRUCTURED na `order_lines` ng row, kapag meron. ⚠ Ang teksto ay pinagdugtong
 * ng ", " galing sa Pancake, kaya ang produktong may comma sa PANGALAN
 * ("Lumyra Set, 2 Boxes") ay nahahati pabalik sa dalawang maling linya — ang
 * array ang buo ang hugis at iyon ang unahin ng tumatawag kapag hawak.
 * ⚠ Ang "0x Lumyra" ay ZERO — hindi 1: ang linyang zinero ng staff ay hindi
 * naibenta, at ang `|| 1` dito noon ay nagbabawas ng isang pirasong hindi
 * lumabas kailanman.
 */
export function parseOrderItems(orderItem: string | { qty: number; name: string }[]) {
  if (Array.isArray(orderItem)) {
    return orderItem
      .map(l => ({ qty: Math.max(0, Number(l?.qty) || 0), name: String(l?.name || "").trim() }))
      .filter(l => l.name)
  }
  return String(orderItem || "").split(",").map(s => s.trim()).filter(Boolean).map(seg => {
    const m = seg.match(/^(\d+)\s*x\s*(.+)$/i)
    return m ? { qty: Math.max(0, Number(m[1])), name: m[2].trim() } : { qty: 1, name: seg }
  })
}

/**
 * Binubuklat ang teksto ng order tungo sa aktwal na babawasang Product Item.
 * Ang `unmapped` ay ang mga pangalang walang katugmang unit code o product item —
 * ipinapakita ito sa UI dahil ibig sabihin nito ay may hindi nababawasan.
 */
export function explodeOrderItems(orderItem: string | { qty: number; name: string }[], recipes: RecipeMap) {
  const perItem = new Map<string, ShippedScanItem>()
  const unmapped: string[] = []
  for (const li of parseOrderItems(orderItem)) {
    if (li.qty <= 0) continue   // zinerong linya — walang naibenta, walang babawasin
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

// ─────────────────────────────────────────────────────────────────────────────
// ANG GUHIT NG RESET (hatol ng may-ari, Ago 22 2026: "reset tayo, mga na scan
// lang ngayong araw"). Nang buksan ang Stock-Out History, 1,927 LUMANG parcel
// (Ago 1 pasulong, bago pa magkaroon ng unit codes) ang nasipsip ng sync at
// "nabawasan" — ₱1.1M ang lumabas na COD sa dashboard na kakasimula pa lang.
// Ang mga parcel na umalis BAGO ang guhit ay kasama na sa pisikal na bilang ng
// inventory reset, kaya ang pagbawas sa kanila ngayon ay DOBLENG bawas.
//
// Nasa code ang guhit at hindi sa database NANG SINASADYA: minsanang pangyayari
// ang reset, ang `inventory_resets` na table (migration 0032) ay hindi pa
// tumatakbo sa Supabase, at ang guhit na pare-pareho sa bawat makina ay kailangan
// NGAYON. Kapag nag-reset muli ang may-ari, ang petsang ito ang inuusog.
// PH na petsa ito — ang `shipped_out_date` ng row ay PH na rin (toPHDate).
export const STOCK_OUT_FROM = "2026-08-22"

/** Isang Pancake row na karapat-dapat nang bawasan sa inventory. */
export function isDeductable(row: { tracking_no?: string; order_status?: string; shipped_out_date?: string }) {
  if (!String(row.tracking_no || "").trim() || !hasLeftWarehouse(String(row.order_status || ""))) return false
  // Bago ang guhit — o WALANG mapatunayang petsa ng pag-alis — hindi binabawas.
  // Ang blangko ay halos tiyak na lumang backfill; ang tunay na kinuha ng rider
  // ay may `time_send_partner`. Mas mabuti ang kulang na kitang-kita sa audit
  // kaysa dobleng bawas na tahimik.
  return String(row.shipped_out_date || "") >= STOCK_OUT_FROM
}
