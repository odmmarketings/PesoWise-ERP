"use client"

// ─────────────────────────────────────────────────────────────────────────────
// HOUSE MATH ng Facebook Ads — hinugot mula sa ScalingTracker para magamit din
// ng Dashboard nang HINDI minomount ang tracker. Iisa ang pormula sa lahat ng
// tab; kapag dito mo binago, sabay-sabay silang magbabago.
// ─────────────────────────────────────────────────────────────────────────────

export const VAT = 1.12
/**
 * ROAS = purchase value ÷ (spend × 1.12). Ito ang batayan ng kill/scale.
 *
 * ⚠ WALANG RTS DITO (hatol ng may-ari, Ago 25 2026: "wala naman sa meta ads
 * manager na less RTS eh, basta i tulad mo sa meta ads manager na tunay...
 * basta meta metrics tayo"). Ang purchase value ay KUNG ANO ANG IUULAT NI
 * META — walang binabawas na balik-padala. Ang natitirang pagkakaiba sa Ads
 * Manager ay ang VAT lang: idinaragdag natin ang 12% sa gastos dahil iyon ang
 * tunay na sinisingil sa card (hatol Ago 24 2026), samantalang ang "Amount
 * spent" ni Meta ay bago pa ang buwis.
 */
export const roasOf = (value: number, spend: number) =>
  spend > 0 ? value / (spend * VAT) : 0

// Parehong localStorage key at defaults ng Rules panel sa tracker — ang
// binago ng user doon ay dapat makita rin ng Dashboard.
export type HouseRules = {
  scaleRoas: number; scaleDays: number; minDailySpend: number
  killRoas: number; noSalesHour: number; evalMinSpend: number
  bleedRoas: number; bleedSpend: number; cppMax: number
}
const DEFAULT_HOUSE: HouseRules = {
  scaleRoas: 3.9, scaleDays: 3, minDailySpend: 500,
  killRoas: 2.8, noSalesHour: 9, evalMinSpend: 300,
  bleedRoas: 1.5, bleedSpend: 2000, cppMax: 250,
}
export function loadHouseRules(): HouseRules {
  if (typeof window === "undefined") return DEFAULT_HOUSE
  try { return { ...DEFAULT_HOUSE, ...JSON.parse(localStorage.getItem("pesowise_scaling_rules") || "{}") } }
  catch { return DEFAULT_HOUSE }
}

/* ⚠ TINANGGAL ang `usePageRts` (Ago 25 2026). Hinihila nito ang 31-araw na
   RTS rate kada page mula sa Pancake para bawasan ang purchase value — hindi na
   iyon ginagamit kahit saan sa Facebook Ads: Meta metrics na tayo. Bukod sa
   maling numero, isa rin iyong hila sa Pancake kada pagbukas ng Dashboard at ng
   tracker na wala nang binibili. */

/**
 * ILANG ARAW NANG TUMATAKBO — hindi kailan nilikha.
 *
 * ⚠ ANG created_time AY HINDI EDAD NG PAGTAKBO (hiling ng may-ari, Ago 20
 * 2026): ang campaign na ginawa sa ika-20 pero naka-schedule sa ika-21 ay
 * nagsisimula ang buhay sa IKA-21 — Day 1 ang araw ng tunay na pagtakbo, at
 * doon nakasandal ang lahat ng paghuhusga sa pag-monitor.
 *
 * Ang sandigan (anchor): start_time kapag may laman at LUMIPAS NA; kapag nasa
 * hinaharap pa, hindi pa ito nagsisimula (started=false); kapag walang
 * start_time, ang created_time ang natitirang pinakamabuting alam.
 * Day N = floor(mga araw mula anchor) + 1 — Day 1 sa mismong araw ng simula.
 */
export function runAge(startTime: string, createdTime: string, now = Date.now()):
  { day: number; started: boolean; anchor: "start" | "created" | "none" } {
  const st = startTime ? Date.parse(startTime) : NaN
  if (isFinite(st)) {
    if (st > now) return { day: 0, started: false, anchor: "start" }
    return { day: Math.floor((now - st) / 86400_000) + 1, started: true, anchor: "start" }
  }
  const ct = createdTime ? Date.parse(createdTime) : NaN
  if (isFinite(ct)) return { day: Math.max(1, Math.floor((now - ct) / 86400_000) + 1), started: true, anchor: "created" }
  return { day: 0, started: false, anchor: "none" }
}
