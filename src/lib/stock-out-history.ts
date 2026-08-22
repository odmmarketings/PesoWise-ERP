// STOCK-OUT HISTORY — ang talaan ng LAHAT ng lumabas sa inventory, hinango sa
// dalawang totoong pinagmulan at hindi sa counter ng Product Item:
//
//   stock_releases      → kada-item na galaw (ledger). "Shipped Out" = automated
//                         na bawas ng Pancake; NEGATIBO ang deducted sa "RTS
//                         Restock" (pabalik); lahat ng iba = manual Stocks Update.
//   shipped_out_scans   → kada-parcel na pera (COD amount, COGS) at ang dalawang
//                         tatak ng buhay ng parcel (scan ng bodega, Shipped ng POS).
//
// BAKIT ANG LEDGER AT HINDI ANG `released` NG ITEM: ang counter ay isang numerong
// pinapatungan; ang ledger ay may petsa, ref at dami kada labas — at ito rin ang
// nakaligtas nang magkamali ang counter (Ago 20 2026: 6 na parcel, 1 lang ang
// naitala ng counter). Ang kasaysayan ay dapat galing sa kasaysayan.
//
// Relative ang import na ito (hindi "@/lib") NANG SINASADYA: pinapayagan nitong
// i-compile ng tsc ang file na mag-isa para sa Node test suite.
import { parseOrderItems, STOCK_OUT_FROM } from "./shipped-out-sync"
import type { StockRelease } from "@/lib/stock-releases-store"
import type { ShippedScan } from "@/lib/shipped-out-store"

export type HistoryProductRow = { item_id: string; sku: string; name: string; shipped: number; manual: number; returned: number; net: number }
export type HistoryTotals = { units: number; shippedUnits: number; manualUnits: number; returns: number; parcels: number; amount: number; cogs: number }
export type HistoryRecent = { date: string; category: string; ref: string; summary: string; units: number; isReturn: boolean }
export type HistoryPending = { tracking_no: string; manual_scanned_at: string; by: string }
export type StockOutHistory = {
  products: HistoryProductRow[]
  totals: HistoryTotals
  /** `count` = mga parcel na nakamarkang bawas pero 0 unit ang naalis. `names` =
   *  mga pangalan sa order na walang tumugmang Product Item o Unit Code — kapag may
   *  ibinigay na `knownNames`, kasama pati ang mga linyang hindi tumugma sa loob ng
   *  parcel na NAKAPAGBAWAS naman (hating-tugma: "1x Lumyra, 1x Bago" ay bumabawas
   *  ng 1 pero tahimik na nilalampasan ang "Bago" — dating hindi ito lumilitaw). */
  zero: { count: number; names: { name: string; qty: number }[] }
  /** Na-scan na ng bodega pero hindi pa kinukuha ng rider — wala pang bawas. */
  pending: HistoryPending[]
  recent: HistoryRecent[]
}

// ⚠ ARAW NG PILIPINAS, HINDI UTC. Ang mga timestamp ng ledger at scans ay
// `toISOString()` (UTC), pero ang piniling saklaw ng gumagamit ay lokal na
// petsa — kung UTC ang hihiwain, ang lahat ng ginawa bago mag-8AM Manila ay
// napupunta sa NAKARAANG araw. Kapareho ng PH_OFFSET ng scaling-alerts.
const PH_OFFSET = 8 * 3600_000
const day10 = (iso: string) => {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t + PH_OFFSET).toISOString().slice(0, 10) : String(iso || "").slice(0, 10)
}
const inRange = (d: string, from: string, to: string) => !!d && d >= from && d <= to

// Ang mga "pangalan" sa Pancake na puro invisible character (zero-width joiner,
// Hangul filler, atbp.) ay iisang balde — ang pag-print ng literal na kawalan ay
// mukhang bug, hindi impormasyon.
const INVISIBLE = /[\u200B-\u200F\u2060\uFEFF\u00AD\u034F\u2800\u3164\u1160]/g
const visibleName = (s: string) => {
  const t = String(s || "").replace(INVISIBLE, "").trim()
  return t || "(blank name)"
}

export function buildStockOutHistory(
  releases: StockRelease[], scans: ShippedScan[], from: string, to: string,
  /** Mga balidong pangalan (Product Item names + Unit Codes, lowercased). Kapag
   *  ibinigay, ang bawat linya ng bawat nabawasang parcel ay sinusuri — hindi
   *  lang ang mga parcel na 0 ang kabuuang bawas. */
  knownNames?: Set<string>,
  /** Ang guhit ng reset — walang binibilang bago rito (kahit anong piliin sa
   *  date picker). Default ang STOCK_OUT_FROM; ang mga test ang nagpapasa ng
   *  mas maagang guhit para masubok ang mekanika nang hiwalay sa patakaran. */
  cutoff: string = STOCK_OUT_FROM,
): StockOutHistory {
  // Ang mas huli sa dalawa ang umiiral — hindi kayang lampasan ng picker ang guhit.
  const lo = from > cutoff ? from : cutoff
  // ── Kada-produkto, hati sa pinagmulan ─────────────────────────────────────
  // ⚠ TATLONG balde, hindi dalawa: ang RTS Restock ay nagtatala ng NEGATIBONG
  //   deducted (pabalik sa istante). Kung isisilid iyon sa "Manual", magiging
  //   negatibo ang Manual ng produktong walang sinumang nag-manual-release, at
  //   ang "Units Deducted" ay magsisinungaling nang pababa. Ang pabalik ay
  //   pabalik — sariling hanay, at ang Net ang nagtutuos.
  const per = new Map<string, HistoryProductRow>()
  let shippedUnits = 0, manualUnits = 0, returnUnits = 0
  const recent: HistoryRecent[] = []
  for (const r of releases) {
    if (!inRange(day10(r.date), lo, to)) continue
    const isShipped = r.category === "Shipped Out"
    let units = 0
    for (const it of r.items) {
      const q = Number(it.deducted) || 0
      if (!q) continue
      units += q
      const row = per.get(it.item_id) || { item_id: it.item_id, sku: it.sku, name: it.name, shipped: 0, manual: 0, returned: 0, net: 0 }
      if (q < 0) { row.returned += -q; returnUnits += -q }
      else if (isShipped) { row.shipped += q; shippedUnits += q }
      else { row.manual += q; manualUnits += q }
      row.net = row.shipped + row.manual - row.returned
      per.set(it.item_id, row)
    }
    recent.push({
      date: r.date, category: isShipped ? "Shipped Out" : (r.category || "Manual"), ref: r.ref,
      summary: r.items.filter(i => (Number(i.deducted) || 0) !== 0).map(i => `${Math.abs(Number(i.deducted) || 0)}x ${i.name}`).join(", "),
      units, isReturn: units < 0,
    })
  }
  recent.sort((a, b) => (b.date || "").localeCompare(a.date || ""))

  // ── Kada-parcel na pera at ang mga hindi tumutugmang pangalan ─────────────
  let parcels = 0, amount = 0, cogs = 0, zeroCount = 0
  const badNames = new Map<string, number>()
  for (const s of scans) {
    if (!s.deducted || !inRange(day10(s.deducted_at), lo, to)) continue
    parcels++
    amount += Number(s.amount) || 0
    cogs += Number(s.cogs_value) || 0
    const zero = (Number(s.deducted_total) || 0) <= 0
    if (zero) zeroCount++
    // May knownNames → suriin ang BAWAT linya (nahuhuli pati ang hating-tugma).
    // Wala → ang mga 0-unit na parcel lang ang masusuri (doon, garantisadong
    // walang tumugma ang bawat linya — kung may tumugma, tumaas sana ang total).
    if (!knownNames && !zero) continue
    for (const li of parseOrderItems(s.order_item)) {
      if (knownNames && knownNames.has(String(li.name || "").trim().toLowerCase())) continue
      const k = visibleName(li.name)
      badNames.set(k, (badNames.get(k) || 0) + (Number(li.qty) || 1))
    }
  }

  // ── Na-scan na, hindi pa bawas — anumang petsa: backlog ito, hindi history ─
  const pending = scans
    .filter(s => s.manual_scanned_at && !s.deducted && day10(s.manual_scanned_at) >= cutoff)
    .sort((a, b) => (b.manual_scanned_at || "").localeCompare(a.manual_scanned_at || ""))
    .map(s => ({ tracking_no: s.tracking_no, manual_scanned_at: s.manual_scanned_at, by: s.manual_scanned_by || s.scanned_by || "" }))

  return {
    products: Array.from(per.values()).sort((a, b) => (b.shipped + b.manual) - (a.shipped + a.manual)),
    totals: { units: shippedUnits + manualUnits, shippedUnits, manualUnits, returns: returnUnits, parcels, amount, cogs },
    zero: { count: zeroCount, names: Array.from(badNames, ([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty) },
    pending,
    recent,
  }
}
