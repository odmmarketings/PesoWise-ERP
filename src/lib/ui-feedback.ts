"use client"

// ─────────────────────────────────────────────────────────────────────────────
// TUNOG NG PAGPINDOT — sintetiko, walang audio file.
//
// Ang mag-import ng .mp3 ay nangangahulugan ng bagong binary asset, dagdag na
// request, at isang bagay na maaaring hindi pa nakakarating kapag pinindot mo
// agad. Ang Web Audio ay gumagawa ng tono sa mismong sandali — 0 byte, 0
// request, at pareho ang tunog kahit offline.
//
// ⚠ Ang AudioContext ay ginagawa LANG sa loob ng isang tunay na pagpindot.
// Hinaharangan ng browser ang audio bago ang unang galaw ng user; ang paggawa
// nito sa module load ay magbubunga ng "suspended" na context na tahimik
// habambuhay.
// ─────────────────────────────────────────────────────────────────────────────

const SFX_KEY = "pesowise_sfx"

export function sfxOn(): boolean {
  if (typeof window === "undefined") return false
  try { return localStorage.getItem(SFX_KEY) !== "0" } catch { return true }
}
export function setSfxOn(on: boolean) {
  try { localStorage.setItem(SFX_KEY, on ? "1" : "0") } catch {}
}

let ctx: AudioContext | null = null
function audio(): AudioContext | null {
  if (typeof window === "undefined") return null
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext
    if (!AC) return null
    if (!ctx) ctx = new AC()
    // Naka-suspend pagkatapos ng ibang tab o ng autoplay policy — buksan muli.
    if (ctx.state === "suspended") void ctx.resume()
    return ctx
  } catch { return null }
}

/**
 * Isang maikling tono. `from`→`to` na frequency para may direksyon ang tunog:
 * pataas = binuksan, pababa = pinatay.
 */
function blip(from: number, to: number, ms: number, gain = 0.05) {
  const c = audio()
  if (!c) return
  try {
    const t = c.currentTime
    const osc = c.createOscillator()
    const amp = c.createGain()
    osc.type = "sine"
    osc.frequency.setValueAtTime(from, t)
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + ms / 1000)
    // Mabilis na attack, malambot na release — kung hindi, may "click" na pop
    // sa dulo ng tono.
    amp.gain.setValueAtTime(0.0001, t)
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.012)
    amp.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000)
    osc.connect(amp); amp.connect(c.destination)
    osc.start(t); osc.stop(t + ms / 1000 + 0.02)
  } catch { /* ang tunog ay hindi dapat makasira ng aksyon */ }
}

/** Pagbukas (pataas) o pagpatay (pababa) ng isang bagay sa Facebook. */
export function playToggle(on: boolean) {
  if (!sfxOn()) return
  if (on) { blip(520, 880, 130) } else { blip(440, 220, 160, 0.045) }
}
/** Karaniwang pindot — mas mahina at mas maikli kaysa toggle. */
export function playClick() {
  if (!sfxOn()) return
  blip(700, 700, 45, 0.03)
}
/** Nabigo — dalawang mababang tono. */
export function playError() {
  if (!sfxOn()) return
  blip(300, 200, 120, 0.05)
  setTimeout(() => blip(240, 170, 160, 0.05), 110)
}
