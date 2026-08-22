"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { currentUserName } from "@/lib/current-user"
import { fetchRows, writeRow, writeManyRows } from "@/lib/supa-rows"

// ──────────────────────────────────────────────────────────────────────────────
// PRODUCT BATCHES — FIFO cost layering.
//
// Bawat dating ng stock ay sariling layer na may sariling presyo. Ang bawas ay
// kumukuha sa PINAKALUMANG layer muna, kaya ang COGS ng isang labas ay ang presyong
// totoong binayaran para sa mismong mga pirasong iyon — hindi average.
//
// Ang batch ang nagdadala ng PRESYO. Ang bilang ay nananatili sa product_items
// (goods/damage/loss/released). Pinapanatili silang magkasundo: ang Receive Stock ay
// sabay na nagdadagdag sa dalawa, at ang bawat bawas ay sabay na kumakain sa dalawa.
// Kapag naghiwalay pa rin sila, ipinapakita ito ng reconcile() — hindi itinatago.
// ──────────────────────────────────────────────────────────────────────────────

const KEY = "pesowise_product_batches"

export interface ProductBatch {
  id: string
  item_id: string
  batch_no: string
  received_date: string     // YYYY-MM-DD — ito ang pagkakasunod-sunod ng FIFO
  qty: number
  cog: number               // presyo kada piraso sa batch NA ITO
  consumed: number
  supplier: string
  notes: string
  created_by: string
  created_at: string
}
export type NewBatchInput = Omit<ProductBatch, "id" | "created_at" | "created_by" | "consumed">

export const batchRemaining = (b: Pick<ProductBatch, "qty" | "consumed">) =>
  Math.max(0, (Number(b.qty) || 0) - (Number(b.consumed) || 0))

function uid() { return `bat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }

function normalize(r: Partial<ProductBatch>): ProductBatch {
  return {
    id: r.id || uid(),
    item_id: r.item_id || "",
    batch_no: r.batch_no || "",
    received_date: r.received_date || "",
    qty: Number(r.qty) || 0,
    cog: Number(r.cog) || 0,
    consumed: Number(r.consumed) || 0,
    supplier: r.supplier || "",
    notes: r.notes || "",
    created_by: r.created_by || "",
    created_at: r.created_at || new Date().toISOString(),
  }
}

function readCache(): ProductBatch[] {
  if (typeof window === "undefined") return []
  try { const raw = localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as Partial<ProductBatch>[]).map(normalize) : [] }
  catch { return [] }
}
function writeCache(list: ProductBatch[]) { try { localStorage.setItem(KEY, JSON.stringify(list)) } catch {} }

/**
 * Pagkakasunod-sunod ng FIFO: pinakaluma ang unang kinakain.
 * Ang `created_at` ang pambasag ng tabla kapag pareho ang petsa ng dating — kaya
 * matatag ang pagkakasunod kahit dalawang batch ang dumating sa iisang araw.
 */
export function fifoOrder(batches: ProductBatch[]) {
  return [...batches].sort((a, b) =>
    (a.received_date || "").localeCompare(b.received_date || "")
    || (a.created_at || "").localeCompare(b.created_at || ""))
}

export interface ConsumeLine { batch_id: string; batch_no: string; qty: number; cog: number; value: number }
export interface ConsumePlan {
  lines: ConsumeLine[]
  consumed: number       // kung ilan ang tunay na nakuha sa mga batch
  short: number          // kulang — walang sapat na batch para sa laki ng bawas
  cogsValue: number      // tunay na halaga ng COGS ng labas na ito
}

/**
 * Binabalak kung saang batch kukunin ang `qty` na piraso, FIFO.
 *
 * PURO ito — walang isinusulat. Sinasadya, para masubukan nang mag-isa at para
 * makita muna ng tumatawag ang magiging resulta bago ito ipatupad.
 *
 * Kapag kulang ang batch, kinukuha ang lahat ng available at INIULAT ang `short`.
 * HINDI ito humihinto: totoong umalis na ang parcel, kaya dapat pa ring bumaba ang
 * bilang — ang kulang ay sa PRESYO lang, at ipinapakita iyon imbes na itago.
 */
export function planFifo(batches: ProductBatch[], qty: number): ConsumePlan {
  const want = Math.max(0, Number(qty) || 0)
  const lines: ConsumeLine[] = []
  let left = want
  for (const b of fifoOrder(batches)) {
    if (left <= 0) break
    const avail = batchRemaining(b)
    if (avail <= 0) continue
    const take = Math.min(avail, left)
    lines.push({ batch_id: b.id, batch_no: b.batch_no, qty: take, cog: b.cog, value: take * b.cog })
    left -= take
  }
  const consumed = want - left
  return {
    lines, consumed, short: left,
    cogsValue: lines.reduce((s, l) => s + l.value, 0),
  }
}

/**
 * Kagaya ng planFifo, pero ang PINILING batch ang unang kinakain — ito ang sagot ng
 * warehouse sa "saan kayo pisikal na kumukuha ngayon", kaya nananaig ito sa hula ng
 * pagkakasunod ng petsa. Ang lampas sa laman ng pinili ay dumudulog pa rin sa FIFO,
 * at ang pinili ring iyon ay hindi na kakainin ulit ng fallback.
 *
 * Walang pinili, o wala na sa listahan ang pinili (nabura, ibang item) → purong FIFO.
 * PURO ito — walang isinusulat.
 */
export function planPick(batches: ProductBatch[], qty: number, preferBatchId?: string): ConsumePlan {
  const want = Math.max(0, Number(qty) || 0)
  const preferred = preferBatchId ? batches.find(b => b.id === preferBatchId) : undefined
  if (!preferred) return planFifo(batches, want)

  const lines: ConsumeLine[] = []
  let left = want
  const takeFromPreferred = Math.min(batchRemaining(preferred), left)
  if (takeFromPreferred > 0) {
    lines.push({ batch_id: preferred.id, batch_no: preferred.batch_no, qty: takeFromPreferred, cog: preferred.cog, value: takeFromPreferred * preferred.cog })
    left -= takeFromPreferred
  }
  if (left > 0) {
    const rest = planFifo(batches.filter(b => b.id !== preferred.id), left)
    lines.push(...rest.lines)
    left = rest.short
  }
  return { lines, consumed: want - left, short: left, cogsValue: lines.reduce((s, l) => s + l.value, 0) }
}

/**
 * Binabalak kung saang batch ibabalik ang `qty` na MABUTING piraso ng isang nagbalik na parcel.
 *
 * Sinusundan ang `lines` na naitala noong umalis ito — sa MISMONG cost layer bumabalik,
 * hindi sa pinakabago. Kung ibinalik sa maling layer, mawawala ang isang ₱35 na piraso at
 * madadagdagan ka ng ₱30 na hindi mo naman binili.
 *
 * Kapag mas kaunti ang bumalik kaysa sa umalis (may sira o nawala), unahin ang mga linya
 * ayon sa pagkakatala — FIFO din iyon, kaya ang pinakaluma ang unang naibabalik.
 *
 * PURO ito — walang isinusulat.
 */
export function planRestore(lines: ConsumeLine[], goodQty: number): ConsumeLine[] {
  let left = Math.max(0, Number(goodQty) || 0)
  const out: ConsumeLine[] = []
  for (const l of lines) {
    if (left <= 0) break
    const take = Math.min(l.qty, left)
    if (take <= 0) continue
    out.push({ ...l, qty: take, value: take * l.cog })
    left -= take
  }
  return out
}

/** Kabuuang natitira at halaga ng isang item — ito ang tamang valuation, hindi qty × isang COG. */
export function valueOf(batches: ProductBatch[]) {
  return batches.reduce((acc, b) => {
    const rem = batchRemaining(b)
    acc.qty += rem
    acc.value += rem * b.cog
    return acc
  }, { qty: 0, value: 0 })
}

/** Timbang na average ng natitira — pang-display lang (hal. kolum na COG), hindi pang-COGS. */
export function avgCog(batches: ProductBatch[]) {
  const { qty, value } = valueOf(batches)
  return qty > 0 ? value / qty : 0
}

export function useProductBatches() {
  const [batches, setBatches] = useState<ProductBatch[]>([])
  const [loaded, setLoaded] = useState(false)
  // ⚠ Kapareho ng releaseStock (product-items-store, Ago 20 2026): ang Shipped
  // Out sync ay tumatawag ng consume() kada parcel sa IISANG closure — kung ang
  // render-frozen na `batches` ang babasahin, bawat parcel ay kakain sa PAREHONG
  // hindi pa nagagalaw na batch at ang huling sulat lang ang matitira (mali ang
  // consumed, mali ang COGS kada parcel, mali ang RTS provenance). Ref ang
  // binabasa at pinagpapatungan; ang huling-dumating na fetch ay hindi na
  // pumapatong kapag may galaw na (dirtyRef), para hindi mabura ang naipaton.
  const batchesRef = useRef<ProductBatch[]>([])
  const dirtyRef = useRef(false)

  useEffect(() => {
    const cached = readCache()
    batchesRef.current = cached
    setBatches(cached)
    fetchRows("product_batches", normalize, readCache, writeCache).then(list => {
      if (list && !dirtyRef.current) { batchesRef.current = list; setBatches(list) }
      setLoaded(true)
    })
  }, [])
  const persist = useCallback((next: ProductBatch[]) => { dirtyRef.current = true; batchesRef.current = next; writeCache(next); setBatches(next) }, [])

  const byItem = useCallback((itemId: string) => batches.filter(b => b.item_id === itemId), [batches])

  /** Bagong dating ng stock. Ang TUMATAWAG ang magdaragdag sa product_items.goods. */
  function addBatch(input: NewBatchInput) {
    const created = normalize({
      ...input, id: uid(), consumed: 0,
      created_at: new Date().toISOString(), created_by: currentUserName(),
    })
    persist([created, ...batches])
    writeRow("product_batches", created)
    return created
  }

  function updateBatch(id: string, patch: Partial<NewBatchInput>) {
    const next = batches.map(b => b.id === id ? normalize({ ...b, ...patch }) : b)
    persist(next)
    const row = next.find(b => b.id === id)
    if (row) writeRow("product_batches", row)
  }

  /**
   * Ipinapatupad ang FIFO na bawas para sa maraming item nang sabay.
   * Ibinabalik ang tunay na COGS bawat item, para maitala ito ng tumatawag.
   */
  function consume(deltas: { id: string; qty: number; preferBatchId?: string }[]) {
    const patch = new Map<string, number>()   // batch_id → bagong consumed
    const result: { item_id: string; cogsValue: number; short: number; lines: ConsumeLine[] }[] = []

    for (const d of deltas) {
      const mine = batchesRef.current
        .filter(b => b.item_id === d.id)
        // Isinasama ang mga naunang pagbawas sa loob ng iisang tawag na ito, kung hindi
        // ay parehong batch ang kakainin ng dalawang linya ng iisang order.
        .map(b => patch.has(b.id) ? { ...b, consumed: patch.get(b.id)! } : b)
      // Ang piniling batch ng warehouse (kung meron) ang unang kinakain — tingnan
      // ang planPick. Walang pinili → FIFO, gaya ng dati.
      const plan = planPick(mine, d.qty, d.preferBatchId)
      for (const l of plan.lines) {
        const b = mine.find(x => x.id === l.batch_id)!
        patch.set(l.batch_id, (patch.has(l.batch_id) ? patch.get(l.batch_id)! : b.consumed) + l.qty)
      }
      result.push({ item_id: d.id, cogsValue: plan.cogsValue, short: plan.short, lines: plan.lines })
    }

    if (patch.size) {
      const next = batchesRef.current.map(b => patch.has(b.id) ? { ...b, consumed: patch.get(b.id)! } : b)
      persist(next)
      writeManyRows("product_batches", next.filter(b => patch.has(b.id)))
    }
    return result
  }

  /**
   * Ibinabalik ang mga piraso sa MISMONG batch na pinanggalingan nila (binabawasan ang
   * `consumed`). Ang tumatawag ang nagbabawas sa `released` ng product item.
   */
  function restore(lines: { batch_id: string; qty: number }[]) {
    const back = new Map<string, number>()
    for (const l of lines) back.set(l.batch_id, (back.get(l.batch_id) || 0) + l.qty)
    if (back.size === 0) return
    const next = batchesRef.current.map(b => back.has(b.id)
      // Hindi bumababa sa zero: ang negatibong consumed ay magpapalabas ng stock na
      // hindi naman natanggap kailanman.
      ? { ...b, consumed: Math.max(0, b.consumed - (back.get(b.id) || 0)) }
      : b)
    persist(next)
    writeManyRows("product_batches", next.filter(b => back.has(b.id)))
  }

  /**
   * Naghiwalay ba ang batch sa product_items? Ipinapakita ito sa UI.
   * Ang pagkakaiba ay hindi kusang nawawala — mas mabuting makita agad kaysa
   * maniwala sa maling halaga ng inventory nang matagal.
   */
  function reconcile(items: { id: string; goods: number; damage: number; loss: number; released?: number }[]) {
    const out: { item_id: string; batchQty: number; goods: number; batchConsumed: number; itemOut: number }[] = []
    for (const i of items) {
      const mine = batches.filter(b => b.item_id === i.id)
      if (mine.length === 0) continue
      const batchQty = mine.reduce((s, b) => s + b.qty, 0)
      const batchConsumed = mine.reduce((s, b) => s + b.consumed, 0)
      const itemOut = (i.damage || 0) + (i.loss || 0) + (i.released || 0)
      if (Math.abs(batchQty - (i.goods || 0)) > 0.001 || Math.abs(batchConsumed - itemOut) > 0.001)
        out.push({ item_id: i.id, batchQty, goods: i.goods || 0, batchConsumed, itemOut })
    }
    return out
  }

  return { batches, loaded, byItem, addBatch, updateBatch, consume, restore, reconcile }
}
