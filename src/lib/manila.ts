// MANILA TIME MATH ng Monitoring Rounds — IMPORTLESS at PURO nang sinasadya:
// bawat tuntunin ng oras (pati ang 23:45 na tumatawid ng hatinggabi) ay DITO
// LANG nakatira, at natetest sa Node nang walang browser. Walang DST ang
// Pilipinas — ligtas ang fixed UTC+8.

export const MANILA_OFFSET_MS = 8 * 3600_000

export const SHIFT_TIMES: Record<string, string[]> = {
  am: ["09:00", "12:00", "15:00", "18:00"],
  pm: ["21:00", "23:45"],
}

/** "YYYY-MM-DD" ngayon sa Manila. */
export function manilaToday(now = Date.now()): string {
  return new Date(now + MANILA_OFFSET_MS).toISOString().slice(0, 10)
}

/** Ang UTC ms ng isang Manila na petsa+oras ("2026-08-24", "23:45"). */
export function manilaMs(date: string, hm: string): number {
  return Date.parse(`${date}T${hm}:00+08:00`)
}

export type SlotWindow = {
  date: string          // slot_date — ang petsa NG MISMONG ORAS ng slot
  time: string          // "HH:MM"
  openMs: number        // T0 — bukas ang slot (walang maagang kredito)
  onTimeUntilMs: number // T0+30m
  lateCapMs: number     // min(T0+120m, susunod na slot NG PAREHONG petsa)
}

/**
 * Ang mga bintana ng isang araw para sa isang listahan ng oras. Ang lateCap ay
 * hindi tumatawid sa susunod na slot NG PAREHONG petsa — pero ang huling slot
 * (hal. 23:45) ay may buong 2 oras kahit lumagpas ito ng hatinggabi: ang 09:00
 * BUKAS ay ibang slot_date at hindi pumuputol.
 */
export function slotWindows(date: string, times: string[]): SlotWindow[] {
  const sorted = [...times].filter(t => /^\d{2}:\d{2}$/.test(t)).sort()
  return sorted.map((time, i) => {
    const openMs = manilaMs(date, time)
    const onTimeUntilMs = openMs + 30 * 60_000
    const hardCap = openMs + 120 * 60_000
    const next = sorted[i + 1] ? manilaMs(date, sorted[i + 1]) : Infinity
    return { date, time, openMs, onTimeUntilMs, lateCapMs: Math.min(hardCap, next) }
  })
}

export type SlotState = "upcoming" | "open" | "late" | "missed"

/** Ang kalagayan ng bintana sa sandaling ito — HINUHUSGAHAN SA PAGBASA, hindi
 *  isinusulat ng cron (parehong tuntunin ng deadlineInfo ng partner tasks). */
export function slotStateAt(w: SlotWindow, now = Date.now()): SlotState {
  if (now < w.openMs) return "upcoming"
  if (now < w.onTimeUntilMs) return "open"
  if (now < w.lateCapMs) return "late"
  return "missed"
}

/** On time ba ang isang check na may ganitong server timestamp? */
export function checkedOnTime(w: SlotWindow, checkedServerAtMs: number): boolean {
  return checkedServerAtMs < w.onTimeUntilMs
}

/**
 * Ang mga bintanang BUHAY PA o KAKALIPAS para sa isang partner ngayon: kasama
 * ang kahapon (para sa 23:45 na umaabot ng 01:45 kinabukasan) at ang ngayon.
 * Ang tumatawag ang magsasala kung alin ang open/late; ito ang nagbibigay ng
 * tamang mga kandidato nang hindi nalilito sa hatinggabi.
 */
export function windowsAround(times: string[], now = Date.now()): SlotWindow[] {
  const today = manilaToday(now)
  const yesterday = manilaToday(now - 86400_000)
  return [...slotWindows(yesterday, times), ...slotWindows(today, times)]
}

/** Ang bintanang bukas o late ngayon mismo — ang "kasalukuyang round", kung meron. */
export function activeWindow(times: string[], now = Date.now()): SlotWindow | null {
  const live = windowsAround(times, now).filter(w => {
    const s = slotStateAt(w, now)
    return s === "open" || s === "late"
  })
  // Kapag nagsalubong (hindi mangyayari sa presets, posible sa custom), ang
  // PINAKAHULING bumukas ang totoong kasalukuyan.
  return live.length ? live[live.length - 1] : null
}

/** Mga oras ng isang partner ayon sa settings row. */
export function timesOf(shift: string, customTimes: string[]): string[] {
  if (shift === "custom") return (customTimes || []).filter(t => /^\d{2}:\d{2}$/.test(t))
  return SHIFT_TIMES[shift] || SHIFT_TIMES.am
}
