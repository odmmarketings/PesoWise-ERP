"use client"

// ──────────────────────────────────────────────────────────────────────────────
// SCANNER FEEDBACK SOUNDS — iisang pinagmumulan para sa LAHAT ng scanner sa app.
//
// BAKIT ISA LANG: dati may magkahiwalay pero magkaparehong kopya ang RTS at
// Shipped Out, magkaiba lang ang pangalan ng tunog ("receive" vs "ok"). Kapag
// inayos mo ang isa, hindi sumasabay ang isa — at ang staff na sanay sa RTS ay
// malilito sa Shipped Out. Dito na lang lahat.
//
// BAKIT WEBAUDIO AT HINDI MP3: walang file na ida-download, walang latency sa
// unang tunog, at gumagana offline. Mahalaga iyon sa warehouse na mahina ang WiFi.
//
// ANG ENVELOPE: may 12ms na attack at exponential decay bawat nota. Ang lumang
// bersyon ay dere-derechong `setValueAtTime` sa buong lakas — may naririnig na
// "click" sa umpisa ng bawat beep. Maliit na detalye, pero ito ang pagkaiba ng
// mumurahin at malinis kapag daan-daang beses mo naririnig kada araw.
// ──────────────────────────────────────────────────────────────────────────────

export type ScanSound = "ok" | "check" | "warn" | "error"

let _ctx: AudioContext | null = null

function audioCtx(): AudioContext | null {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return null
    if (!_ctx) _ctx = new Ctx()
    // Sinuspinde ng browser ang audio hangga't walang user gesture — subukang
    // buhayin sa bawat tawag para hindi tahimik ang unang scan.
    if (_ctx.state === "suspended") _ctx.resume()
    return _ctx
  } catch { return null }
}

/**
 * Buhayin ang audio sa loob ng isang user gesture (hal. pagpindot ng "Camera Scan").
 * Kailangan ito ng iOS Safari at Android Chrome — kung hindi, tahimik ang unang beep.
 */
export function primeScanSound() { audioCtx() }

type Note = { f: number; at: number; dur: number; type?: OscillatorType; gain?: number }

function play(notes: Note[]) {
  const ctx = audioCtx()
  if (!ctx) return
  const t0 = ctx.currentTime
  for (const n of notes) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = n.type || "sine"
    osc.frequency.setValueAtTime(n.f, t0 + n.at)
    const peak = n.gain ?? 0.25
    // exponentialRamp ay hindi tumatanggap ng 0 — kaya 0.0001 ang gamit na "katahimikan".
    gain.gain.setValueAtTime(0.0001, t0 + n.at)
    gain.gain.exponentialRampToValueAtTime(peak, t0 + n.at + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur)
    osc.connect(gain); gain.connect(ctx.destination)
    osc.start(t0 + n.at)
    osc.stop(t0 + n.at + n.dur + 0.03)
  }
}

/**
 * Apat na tunog na sadyang MAGKAKAIBA ang hugis, hindi lang taas — para masabi ng
 * packer kung ano ang nangyari nang HINDI tumitingin sa screen habang may hawak
 * na parcel:
 *   ok    — dalawang nota pataas (E6→B6). Maikli, matagumpay.
 *   check — tatlong nota pataas. Mas mahaba kaysa ok, para alam mong "check" mode.
 *   warn  — dalawang nota PABABA. Naitala pero may kulang.
 *   error — mababang buzz, dalawang beses. Malayo sa lahat ng iba, imposibleng mapagkamalan.
 */
export function scanSound(kind: ScanSound) {
  switch (kind) {
    case "ok":
      play([
        { f: 1318.5, at: 0, dur: 0.09 },
        { f: 1975.5, at: 0.075, dur: 0.17 },
      ])
      break
    case "check":
      play([
        { f: 987.8, at: 0, dur: 0.08 },
        { f: 1318.5, at: 0.07, dur: 0.08 },
        { f: 1568.0, at: 0.14, dur: 0.2 },
      ])
      break
    case "warn":
      play([
        { f: 880, at: 0, dur: 0.13, type: "triangle", gain: 0.28 },
        { f: 622.3, at: 0.14, dur: 0.24, type: "triangle", gain: 0.28 },
      ])
      break
    default:
      play([
        { f: 196, at: 0, dur: 0.23, type: "square", gain: 0.22 },
        { f: 155.6, at: 0.17, dur: 0.32, type: "square", gain: 0.22 },
      ])
  }
}
