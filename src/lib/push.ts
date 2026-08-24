"use client"

// ─────────────────────────────────────────────────────────────────────────────
// WEB PUSH (OneSignal v16) — ang tunay na notification sa cellphone: tumutunog,
// umiilaw at lumalabas KAHIT SARADO ang PesoWise (hatol ng may-ari, Ago 24 2026,
// para sa Monitoring Rounds ng mga advertiser/marketing).
//
// PAANO ITO UMAABOT SA PHONE:
//   • Android (Chrome/Edge, kahit anong modelo) — gumagana agad pagkatapos
//     pumayag sa "Enable alerts".
//   • iOS — kailangang naka-ADD TO HOME SCREEN ang PesoWise (ginagawa na ito ng
//     may-ari bilang "shortcut") AT iOS 16.4+; ang pahintulot ay tinatanong sa
//     LOOB ng naka-install na app. Ang manifest at apple-web-app ay nakahanda na.
//
// Ang external id ay ang EMAIL ng user — ito ang tinatarget ng server kapag
// nagpapadala (walang device token na iniimbak sa atin; si OneSignal ang bahala).
// ─────────────────────────────────────────────────────────────────────────────

declare global {
  interface Window { OneSignalDeferred?: any[] }
}

const APP_ID = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID || ""

let booted = false
let loggedInAs = ""

function loadSdk() {
  if (document.getElementById("onesignal-sdk")) return
  const s = document.createElement("script")
  s.id = "onesignal-sdk"
  s.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js"
  s.defer = true
  document.head.appendChild(s)
}

/** Ihanda ang push at itali sa email ng user. Ligtas tawagin nang paulit-ulit. */
export function initPush(email: string) {
  if (!APP_ID || typeof window === "undefined") return
  window.OneSignalDeferred = window.OneSignalDeferred || []
  if (!booted) {
    booted = true
    loadSdk()
    window.OneSignalDeferred.push(async (OneSignal: any) => {
      try {
        await OneSignal.init({
          appId: APP_ID,
          serviceWorkerPath: "/OneSignalSDKWorker.js",
          allowLocalhostAsSecureOrigin: true,
        })
      } catch { /* nag-init na sa ibang tab — ayos lang */ }
    })
  }
  const e = (email || "").toLowerCase()
  if (e && e !== loggedInAs) {
    loggedInAs = e
    window.OneSignalDeferred.push(async (OneSignal: any) => {
      try { await OneSignal.login(e) }
      catch {
        // Ibinabalik ang bantay para ang SUSUNOD na initPush ay sumubok muli —
        // kung hindi, ang minsang offline sa pag-login ay walang push habambuhay.
        loggedInAs = ""
      }
    })
  }
}

/** Hilingin ang pahintulot ng push (system prompt). Tawagin mula sa isang pindot. */
export function enablePush() {
  if (!APP_ID || typeof window === "undefined") return
  window.OneSignalDeferred = window.OneSignalDeferred || []
  window.OneSignalDeferred.push(async (OneSignal: any) => {
    try { await OneSignal.Notifications.requestPermission() } catch { /* tinanggihan — desisyon niya */ }
  })
}
