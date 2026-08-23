"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { ShieldCheck, BellRing, Lock, X } from "lucide-react"
import { useFBAccounts } from "@/lib/fb-store"
import { useMonitorRounds, myMonitorSetting, windowFor } from "@/lib/monitor-store"
import { timesOf, activeWindow, slotStateAt } from "@/lib/manila"
import { whoAmI, type Me } from "@/lib/notify"
import { scanSound } from "@/lib/scan-sound"

// Kapareho ng ADS_POSITION_RE ng PartnerTasks — sadyang HINDI ina-import: ang
// clock na ito ay naka-mount sa layout ng BAWAT pahina, at ang pag-import ng
// buong PartnerTasks module ay maghahatak ng buong Tasks board sa bawat bundle.
const ADS_POSITION_RE = /marketing|advertis|partner/i

// ─────────────────────────────────────────────────────────────────────────────
// MONITOR CLOCK — nakasabit sa app layout kaya buhay sa BAWAT pahina:
//   • kada 30s: sinusuri kung may bumukas na slot → FREEZE (unique-key mutex,
//     iisang device ang mananalo at magpapadala ng abiso)
//   • popup sa partner kapag bukas ang kanyang round — paulit-ulit kada 10 min
//     habang hindi tapos (15 min kapag late na), Snooze-able, hindi humaharang
//   • MISSED → ang unang device na makapansin ang magbabalita (conditional flip)
//   • ANG KANDADO (habol ng may-ari, Ago 24 2026): habang may bukas na round na
//     hindi tapos, LAHAT ng pahina maliban sa Facebook Ads ay nakakandado para
//     sa partner — ang admin ang may on/off nito sa dashboard ng Rounds.
// ─────────────────────────────────────────────────────────────────────────────

const ADS_PATH = "/business/ads/facebook"
const peso0 = (n: number) => "₱" + Math.round(n).toLocaleString("en-PH")

export function MonitorClock() {
  const rounds = useMonitorRounds()
  const fb = useFBAccounts()
  const pathname = usePathname()
  const router = useRouter()
  const [me, setMe] = useState<Me>({ email: "", name: "", mother: false, position: "" })
  useEffect(() => { setMe(whoAmI()) }, [])

  // Ang 30s tick ay panloob na orasan lang (bintana ng slot); ang 60s poll ng
  // datos ay nasa IISANG shared store na — hindi na dito.
  const [tick, setTick] = useState(0)
  useEffect(() => { const iv = setInterval(() => setTick(t => t + 1), 30_000); return () => clearInterval(iv) }, [])

  const eligible = useMemo(() =>
    me.mother || ADS_POSITION_RE.test(me.position || "")
    || fb.accounts.some(a => !a.archived && (a.owner || "").trim().toLowerCase() === me.name),
    [me, fb.accounts])

  // ── FREEZE + MISSED duty — kahit sinong eligible; ang DB ang nagde-dedupe ───
  useEffect(() => {
    if (!eligible || !rounds.loaded || rounds.migrationNeeded || fb.accounts.length === 0) return
    void rounds.freezeDueSlots(fb.accounts)
    for (const s of rounds.slots) {
      if (s.missed_notified || s.account_count <= 0) continue
      const setting = rounds.settings.find(x => x.owner === s.owner)
      const w = windowFor(setting, s)
      if (!w || slotStateAt(w) !== "missed") continue
      const unchecked = rounds.checks.filter(c => c.slot_id === s.id && !c.checked_at).length
      // ⚠ Ang TAPOS na round na lumagpas lang ng oras ay HINDI missed — ang
      // "0 of N unchecked" na balita ay maling alarma sa admin.
      if (unchecked > 0) void rounds.claimMissed(s, unchecked)
    }
  }, [tick, eligible, rounds.loaded, rounds.slots, rounds.checks, fb.accounts])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── ANG AKING round ngayon ──────────────────────────────────────────────────
  const mySetting = useMemo(() => myMonitorSetting(rounds.settings, me.name, me.email), [rounds.settings, me])
  const myWindow = useMemo(() => {
    void tick
    return mySetting ? activeWindow(timesOf(mySetting.shift, mySetting.custom_times)) : null
  }, [mySetting, tick])
  const myChecks = useMemo(() => {
    if (!mySetting || !myWindow) return []
    // ⚠ Tanging mga account na BUHAY PA sa manager ang binibilang: ang
    // in-archive o tinanggalan ng token PAGKATAPOS ng freeze ay wala nang
    // pindutang makakatapos sa kanya — kung ibibilang, kandado nang 2 oras ang
    // partner sa round na imposibleng tapusin.
    const usable = new Set(fb.accounts.filter(a => !a.archived && a.token && a.ad_account_id).map(a => a.id))
    return rounds.checks.filter(c =>
      c.owner === mySetting.owner && c.slot_date === myWindow.date && c.slot_time === myWindow.time
      && usable.has(c.account_id))
  }, [rounds.checks, mySetting, myWindow, fb.accounts])
  const myDone = myChecks.filter(c => c.checked_at).length
  const roundActive = !!myWindow && myChecks.length > 0 && myDone < myChecks.length

  // ── Popup na may re-nag ─────────────────────────────────────────────────────
  const [popupOpen, setPopupOpen] = useState(false)
  const snoozeUntil = useRef(0)
  const notifiedKey = useRef("")
  useEffect(() => {
    if (!roundActive || !myWindow) { setPopupOpen(false); return }
    const now = Date.now()
    if (now < snoozeUntil.current) return
    // Huwag sumingit habang nagta-type ang tao.
    const el = document.activeElement
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return
    const key0 = `${myWindow.date}|${myWindow.time}`
    // Sa ads page, minsan lang magpapakita kada slot — ang manager na mismo ang
    // gabay doon, at ang paulit-ulit na popup ay tumatakip sa check dialog.
    if (pathname?.startsWith(ADS_PATH) && notifiedKey.current === key0) return
    setPopupOpen(true)
    const key = `${myWindow.date}|${myWindow.time}`
    if (notifiedKey.current !== key) {
      notifiedKey.current = key
      scanSound("check")
      try {
        if ("Notification" in window && Notification.permission === "granted")
          new Notification(`${myWindow.time} monitoring round`, { body: `${myChecks.length} account${myChecks.length === 1 ? "" : "s"} to check — open the Ads Manager.` })
      } catch { /* walang browser notif — nariyan pa rin ang popup */ }
    }
  }, [tick, roundActive, myWindow, myChecks.length])   // eslint-disable-line react-hooks/exhaustive-deps

  if (!rounds.loaded || rounds.migrationNeeded || !eligible) return null

  const isLate = myWindow ? slotStateAt(myWindow) === "late" : false
  const onAdsPage = pathname?.startsWith(ADS_PATH)
  // ANG KANDADO: bukas ang round ko, hindi tapos, naka-on ang lock, at WALA ako
  // sa pahina ng ads (doon ang daan palabas). Hindi kinakandado ang admin.
  const locked = rounds.lockEnabled && roundActive && !onAdsPage && !me.mother

  const goRound = () => {
    setPopupOpen(false)
    snoozeUntil.current = Date.now() + 10 * 60_000
    if (pathname?.startsWith(ADS_PATH)) {
      // Soft navigation sa parehong route ay HINDI nagre-remount — ang page ay
      // nakikinig sa event na ito at siya na ang lilipat ng tab at account.
      window.dispatchEvent(new CustomEvent("pesowise:round", { detail: { time: myWindow!.time } }))
    } else {
      router.push(`${ADS_PATH}?round=${encodeURIComponent(myWindow!.time)}`)
    }
  }

  return (
    <>
      {locked && myWindow && (
        <div className="fixed inset-0 z-[100] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 text-center space-y-3">
            <Lock className="w-10 h-10 text-rose-500 mx-auto" />
            <p className="text-lg font-extrabold text-slate-900">Ads check required</p>
            <p className="text-sm text-slate-600">
              The {myWindow.time} monitoring round is {isLate ? "LATE" : "open"} — {myChecks.length - myDone} of {myChecks.length} account{myChecks.length === 1 ? "" : "s"} still
              unchecked. PesoWise unlocks once your round is done.
            </p>
            <button onClick={goRound}
              className="w-full py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700">
              Check my ads now ({myDone}/{myChecks.length})
            </button>
            <p className="text-[11px] text-slate-400">Only the Facebook Ads page is open during a round. The admin can turn this lock off.</p>
          </div>
        </div>
      )}

      {popupOpen && !locked && roundActive && myWindow && (
        <div className="fixed inset-0 z-[96] bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
              <p className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <BellRing className={`w-4 h-4 ${isLate ? "text-rose-500" : "text-amber-500"}`} /> {myWindow.time} monitoring round{isLate ? " — LATE" : ""}
              </p>
              <button onClick={() => { setPopupOpen(false); snoozeUntil.current = Date.now() + (isLate ? 15 : 10) * 60_000 }}
                className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-slate-500">
                Walk your spending accounts one by one and mark each Monitored — biggest spend first.
              </p>
              <div className="max-h-52 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-200">
                {[...myChecks].sort((a, b) => b.spend_at_freeze - a.spend_at_freeze).map(c => (
                  <div key={c.id} className="px-3 py-2 flex items-center gap-2 text-sm">
                    <span className={`w-2 h-2 rounded-full ${c.checked_at ? "bg-emerald-500" : "bg-amber-400"}`} />
                    <span className="flex-1 truncate font-semibold text-slate-800">{c.account_name}</span>
                    <span className="tabular-nums text-[11px] text-slate-400">{peso0(c.spend_at_freeze)}</span>
                    {c.checked_at ? <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> : null}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={goRound} className="py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700">
                  Start round ({myDone}/{myChecks.length})
                </button>
                <button onClick={() => { setPopupOpen(false); snoozeUntil.current = Date.now() + 10 * 60_000 }}
                  className="py-2.5 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Snooze 10 min
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
