// ─────────────────────────────────────────────────────────────────────────────
// DELIVERY VERDICT — hinugot mula sa ads/facebook/page.tsx (Ago 25 2026) para
// IISA ang hatol ng "tumatakbo ba talaga ito" sa buong app: Ads Manager na
// Status column, Dashboard na active counts at brand cards, at ang Monitoring
// na spend-quiz evidence. Dalawang bilang para sa iisang account ay gulo
// (nahuli ng review nang magkaiba ang quiz at ang dashboard).
// ─────────────────────────────────────────────────────────────────────────────
//
// ⚠ ANG `effective_status` NG CAMPAIGN AY HINDI TUMITINGIN PABABA. Nananatili
// itong ACTIVE kahit patay na ang lahat ng ad set nito, kaya "Active" ang
// nakikita mo sa campaign na wala nang naipapadala. Binibilang ng Ads Manager
// ang mga anak para dito — ganoon din tayo (`kidsOn`/`kidsTotal` mula sa API).
//
// Ang mga anak naman ay SINASABI ni Meta kung sino ang may sala sa itaas:
// CAMPAIGN_PAUSED at ADSET_PAUSED — ginagamit natin nang deretso.
const DELIVERY_MAP: Record<string, string> = {
  CAMPAIGN_PAUSED: "Campaign off",
  ADSET_PAUSED: "Ad set off",
  PENDING_REVIEW: "In review",
  PENDING_BILLING_INFO: "Needs billing info",
  DISAPPROVED: "Rejected",
  PREAPPROVED: "Scheduled",
  WITH_ISSUES: "Not delivering",
  IN_PROCESS: "Processing",
  ARCHIVED: "Archived",
  DELETED: "Deleted",
}
// LEARNING — sa AD SET nangyayari (ang ad ay nagmamana). Ang `status` ni Meta:
//   LEARNING  → nag-aaral pa, hindi pa matatag ang delivery
//   FAIL      → "Learning limited": lumabas sa learning nang KULANG ang events
//               (~50 kada 7 araw ang kailangan), kaya mahina ang optimization
//   SUCCESS   → tapos na; normal na "Active" ang ipapakita
const LEARN_TARGET = 50
type Learning = { status: string; conversions: number } | null
type DeliveryRow = { status: string; configuredStatus: string; kidsOn?: number; kidsTotal?: number; kidsLive?: number; kidsStart?: string; learning?: Learning; startTime?: string; stopTime?: string }
export function deliveryOf(r: DeliveryRow, level: "campaign" | "adset" | "ad", now = Date.now()): { label: string; tone: "on" | "off" | "warn" | "bad" } {
  const eff = String(r.status || "").toUpperCase()
  const own = String(r.configuredStatus || r.status || "").toUpperCase()

  // 1. Ang sarili mong switch ang unang sagot — kung patay ka, "Off" ka.
  if (/PAUSED/.test(own) && own !== "CAMPAIGN_PAUSED" && own !== "ADSET_PAUSED") return { label: "Off", tone: "off" }
  // 2. May sinasabi ba si Meta na natatangi?
  if (eff === "DISAPPROVED") return { label: "Rejected", tone: "bad" }
  if (eff === "WITH_ISSUES") return { label: "Not delivering", tone: "bad" }
  if (DELIVERY_MAP[eff] && eff !== "ACTIVE") {
    const bad = eff === "PENDING_BILLING_INFO"
    return { label: DELIVERY_MAP[eff], tone: bad ? "bad" : eff === "CAMPAIGN_PAUSED" || eff === "ADSET_PAUSED" || eff === "ARCHIVED" || eff === "DELETED" ? "off" : "warn" }
  }
  // 3. Buhay ang switch — pero dumating na ba ang oras? Ang `effective_status`
  //    ay HINDI tumitingin sa orasan: ACTIVE na agad ang isinasagot ni Meta sa
  //    isang bagong gawang campaign na sa Lunes pa magsisimula, kaya "Active"
  //    ang lumalabas sa hindi pa umaandar (iniulat ng may-ari, Ago 17 2026).
  //    Nauuna ang pause at ang tanggi rito — kapag hinintuan mo ang naka-schedule
  //    ay "Off" ang sabi ng Ads Manager, hindi "Scheduled".
  //    BERDE ang Scheduled, kapareho ng Active — hatol ng may-ari (Ago 17 2026).
  //    Malusog ito: nakabukas, tama ang pagkakatakda, wala lang gagawin hangga't
  //    hindi sumasapit ang oras. Ang kulay-abo ay para sa hindi na tatakbo, at
  //    hindi iyon ang kalagayan nito. (Kulay-abo ito sa Ads Manager ni Meta —
  //    sinadya nating lumihis.) Ang COMPLETED ay kulay-abo pa rin: tapos na iyon.
  const start = r.startTime ? Date.parse(r.startTime) : NaN
  const stop = r.stopTime ? Date.parse(r.stopTime) : NaN
  if (!Number.isNaN(start) && start > now) return { label: "Scheduled", tone: "on" }
  if (!Number.isNaN(stop) && stop <= now) return { label: "Completed", tone: "off" }
  //    ⚠ SA AD SET ITINATAKDA ANG ORAS, HINDI SA CAMPAIGN. Ang campaign ay
  //    maaaring may lumipas nang `start_time` (o wala) habang ang lahat ng
  //    BUKAS na ad set nito ay bukas pa magsisimula — kaya "Scheduled" ang
  //    mababasa mo sa ad set pero "Active" sa campaign sa itaas niya
  //    (iniulat ng may-ari, Ago 21 2026). `kidsStart` ang PINAKAMAAGANG simula
  //    sa mga bukas na ad set: kapag ang pinakamaaga ay wala pa, wala pang
  //    kahit isa — naka-schedule ang buong campaign. Blangko = hindi alam.
  //    Nauuna ito sa bilang ng anak: ang "Ad set off"/"Ads off" sa isang hindi
  //    pa nagsisimula ay maling babala, kapareho ng dahilan sa taas.
  const kidStart = r.kidsStart ? Date.parse(r.kidsStart) : NaN
  if (level === "campaign" && (r.kidsOn ?? -1) > 0 && !Number.isNaN(kidStart) && kidStart > now) {
    return { label: "Scheduled", tone: "on" }
  }
  // 4. Buhay ako — pero may naipapadala ba talaga? Tanungin ang mga anak.
  //    -1 = walang datos ng anak; huwag manghula.
  const on = r.kidsOn ?? -1, total = r.kidsTotal ?? -1
  if (level !== "ad" && total > 0 && on === 0) {
    return { label: level === "campaign" ? "Ad set off" : "Ads off", tone: "warn" }
  }
  //    ⚠ DALAWANG HAKBANG PABABA ANG CAMPAIGN. Hindi sapat na may bukas na ad
  //    set: kung ang bukas na ad set na iyon ay walang kahit isang bukas na ad,
  //    wala pa ring lumalabas — pero "Active" ang mababasa (iniulat ng may-ari,
  //    Ago 21 2026: 1/3 ang bukas na ad set, at ang isang iyon ay 0/3 ang ad).
  //    `kidsLive` = bukas na ad set na may bukas na ad. Kapag wala ni isa, ang
  //    ADS ang dahilan, hindi ang ad set — kaya "Ads off" ang sinasabi natin,
  //    tulad ng hiling: ad set ang patay → "Ad set off"; ads ang patay → "Ads off".
  //    -1 = hindi alam (pumalya ang hila) — huwag manghula.
  const live = r.kidsLive ?? -1
  if (level === "campaign" && total > 0 && on > 0 && live === 0) {
    return { label: "Ads off", tone: "warn" }
  }
  // 5. Buhay at may naipapadala — pero nag-aaral pa ba? Ang learning ay
  //    pumapalit sa "Active" sa Ads Manager, hindi dinadagdag sa tabi nito.
  //    Campaign lang ang walang ganito (walang learning sa antas na iyon).
  const L = r.learning
  if (level !== "campaign" && L) {
    if (L.status === "LEARNING") {
      // ⚠ ANG BILANG AY SA AD SET LANG. Ang mga event ay naiipon sa AD SET, kaya
      // ang paglalagay ng "12/50" sa bawat ad sa ilalim nito ay pag-uulit ng
      // iisang numero — at mukhang sariling progreso ng ad, gayong hindi.
      // Sa ad, "Learning" lang: totoo, at hindi nagsisinungaling kung kanino
      // ang bilang.
      if (level !== "adset") return { label: "Learning", tone: "warn" }
      return { label: `Learning ${Math.max(0, L.conversions)}/${LEARN_TARGET}`, tone: "warn" }
    }
    // FAIL = "Learning limited" sa wika ng Ads Manager. Hindi ito error kaya
    // hindi pula — pero babala: hindi na mag-o-optimize nang maayos hangga't
    // hindi tumaas ang events (dagdagan ang budget, palawakin ang audience,
    // o pagsamahin ang mga ad set).
    if (L.status === "FAIL") return { label: "Learning limited", tone: "warn" }
  }
  if (/ACTIVE/.test(own) || /ACTIVE/.test(eff)) return { label: "Active", tone: "on" }
  return { label: eff ? eff.replace(/_/g, " ").toLowerCase() : "—", tone: "off" }
}
