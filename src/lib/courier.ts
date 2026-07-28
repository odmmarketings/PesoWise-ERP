// ──────────────────────────────────────────────────────────────────────────────
// COURIER RESOLVER — isang pinagkakasunduan ng buong app kung anong courier ang
// isang parcel. Dalawa lang ang gamit natin: SPX at J&T.
//
// BAKIT KAILANGAN ANG TRACKING FALLBACK: sa mga bagong parcel (hal. PPW na hindi
// pa nakukuha), madalas BLANGKO pa ang `partner.partner_name` sa Pancake kahit may
// naka-print nang waybill. Kapag pangalan lang ang tinignan, napupunta sila sa
// "OTHER" — kaya sinusuri rin ang TRACKING PREFIX, na napatunayan sa live data:
//   SPEPH065741004087 → SPX   ·   JT0012345678 → J&T   ·   980208157812 → J&T
// ──────────────────────────────────────────────────────────────────────────────

export const COURIERS = ["SPX", "J&T"] as const
export type CourierKey = (typeof COURIERS)[number] | "OTHER"

export const COURIER_COLOR: Record<string, string> = {
  "SPX": "#f97316",    // orange
  "J&T": "#dc2626",    // red
  "OTHER": "#94a3b8",  // slate
}

/** Anong courier ito — pangalan muna, tracking prefix kapag walang pangalan. */
export function courierOf(name: string, tracking = ""): CourierKey {
  const s = String(name || "").toLowerCase()
  if (/spx|shopee/.test(s)) return "SPX"
  if (/j&t|jnt|\bjt\b/.test(s)) return "J&T"

  const t = String(tracking || "").trim().toUpperCase()
  if (!t) return "OTHER"
  if (/^SP/.test(t)) return "SPX"                  // SPEPH…, SPX…
  if (/^JT/.test(t)) return "J&T"                  // JT00…
  if (/^\d{11,}$/.test(t)) return "J&T"            // J&T PH = mahabang numero (hal. 980208157812)
  return "OTHER"
}

/** Bilangan kada courier — laging kasama ang SPX at J&T kahit 0; OTHER kung may laman. */
export function courierTally<T>(
  list: T[],
  pick: (row: T) => { name: string; tracking?: string; amount?: number }
): { label: CourierKey; count: number; amount: number }[] {
  const m = new Map<string, { count: number; amount: number }>()
  for (const c of [...COURIERS, "OTHER"]) m.set(c, { count: 0, amount: 0 })
  for (const row of list) {
    const { name, tracking, amount } = pick(row)
    const k = courierOf(name, tracking)
    const cur = m.get(k)!
    cur.count++
    cur.amount += amount || 0
  }
  const out = COURIERS.map(label => ({ label: label as CourierKey, ...m.get(label)! }))
  const other = m.get("OTHER")!
  if (other.count > 0) out.push({ label: "OTHER" as CourierKey, ...other })
  return out
}
