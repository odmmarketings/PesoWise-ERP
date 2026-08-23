"use client"
import { useCallback, useSyncExternalStore } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"
import { currentUserEmail, currentUserName } from "@/lib/current-user"
import { notify, rosterEmailByName } from "@/lib/notify"
import { manilaToday, timesOf, windowsAround, activeWindow, slotWindows, slotStateAt, type SlotWindow } from "@/lib/manila"
import type { FBAccount } from "@/lib/fb-store"

// ─────────────────────────────────────────────────────────────────────────────
// MONITORING ROUNDS (migration 0034) — ang watchclock ng ads.
//
// ⚠ IISANG MODULE-LEVEL NA STORE, HINDI per-hook na state. Ang unang bersyon ay
// hiwalay ang instance ng clock (layout) at ng ads page — ang round na bumukas
// habang nakabukas ang page ay INVISIBLE sa manager, at ang katatapos na round
// ay nagpapakita pa rin ng kandado nang 60s. Ngayon iisa ang pinagbabasahan ng
// lahat, iisa rin ang 60s na poll.
//
// ANG FREEZE: sa pagbukas ng slot, ang mga account ng partner na may gastos SA
// ARAW NG SLOT (hindi basta "ngayon" — ang 23:45 ay tumatagal hanggang 01:45
// kinabukasan!) ay ipinipirmi bilang mga row ng monitor_checks. Ang UNIQUE key
// ng monitor_slots ang mutex — iisang device ang mananalo at magpapadala ng
// abiso (bilang "PesoWise" ang aktor, dahil ang abisong may aktor na ikaw mismo
// ay itinatago ng feed sa iyo — at kadalasan ang device ng partner mismo ang
// nananalo sa gabi).
//
// ANG CHECK-IN: conditional UPDATE (checked_at IS NULL); ang 0-row na sagot ay
// SINISIYASAT — maaaring "already" (nauna ang ibang device) o TINANGGIHAN ng
// RLS (hindi pumasa sa is_monitor_eligible) — magkaibang sagot iyon sa UI.
// ─────────────────────────────────────────────────────────────────────────────

export interface MonitorSetting {
  id: string; owner: string; shift: string; custom_times: string[]; enabled: boolean
}
export interface MonitorSlot {
  id: string; owner: string; slot_date: string; slot_time: string
  frozen_at: string; frozen_by: string; account_count: number; missed_notified: boolean
}
export interface MonitorCheck {
  id: string; slot_id: string; owner: string; slot_date: string; slot_time: string
  account_id: string; account_name: string; spend_at_freeze: number
  checked_at: string; checked_server_at: string
  checked_by_name: string; checked_by_email: string
  spend_at_check: number; active_campaigns: number; data_pulled_at: string
  dwell_ms: number; quiz_attempts: number; verdict: string; note: string; no_data: boolean
}

const rowSetting = (r: any): MonitorSetting => ({
  id: r.id, owner: r.owner || "", shift: r.shift || "am",
  custom_times: Array.isArray(r.custom_times) ? r.custom_times : [], enabled: r.enabled !== false,
})
const rowSlot = (r: any): MonitorSlot => ({
  id: r.id, owner: r.owner || "", slot_date: r.slot_date || "", slot_time: r.slot_time || "",
  frozen_at: r.frozen_at || "", frozen_by: r.frozen_by || "",
  account_count: Number(r.account_count) || 0, missed_notified: !!r.missed_notified,
})
const rowCheck = (r: any): MonitorCheck => ({
  id: r.id, slot_id: r.slot_id, owner: r.owner || "", slot_date: r.slot_date || "", slot_time: r.slot_time || "",
  account_id: r.account_id || "", account_name: r.account_name || "",
  spend_at_freeze: Number(r.spend_at_freeze) || 0,
  checked_at: r.checked_at || "", checked_server_at: r.checked_server_at || "",
  checked_by_name: r.checked_by_name || "", checked_by_email: r.checked_by_email || "",
  spend_at_check: Number(r.spend_at_check) || 0, active_campaigns: Number(r.active_campaigns) || 0,
  data_pulled_at: r.data_pulled_at || "", dwell_ms: Number(r.dwell_ms) || 0,
  quiz_attempts: Number(r.quiz_attempts) || 1, verdict: r.verdict === "action" ? "action" : "ok",
  note: r.note || "", no_data: !!r.no_data,
})

const missingTable = (e: any) => e && (e.code === "42P01" || /monitor_settings|monitor_slots|monitor_checks|monitor_config|is_monitor_eligible/.test(String(e.message || "")))
const HREF = "/business/ads/facebook"

// ── ANG IISANG ESTADO ────────────────────────────────────────────────────────
type MonitorState = {
  settings: MonitorSetting[]; slots: MonitorSlot[]; checks: MonitorCheck[]
  lockEnabled: boolean; loaded: boolean; migrationNeeded: boolean; error: string
}
let G: MonitorState = { settings: [], slots: [], checks: [], lockEnabled: true, loaded: false, migrationNeeded: false, error: "" }
const subs = new Set<() => void>()
const publish = (patch: Partial<MonitorState>) => { G = { ...G, ...patch }; subs.forEach(f => f()) }

let inflight: Promise<void> | null = null
async function refreshShared(): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const businessId = await getBusinessId()
      if (!businessId) { publish({ loaded: true }); return }
      const supabase = createSupabaseBrowserClient()
      const today = manilaToday()
      const yesterday = manilaToday(Date.now() - 86400_000)
      const [st, sl, ch, cf] = await Promise.all([
        supabase.from("monitor_settings").select("*").eq("business_id", businessId),
        supabase.from("monitor_slots").select("*").eq("business_id", businessId).in("slot_date", [yesterday, today]),
        supabase.from("monitor_checks").select("*").eq("business_id", businessId).in("slot_date", [yesterday, today]),
        supabase.from("monitor_config").select("lock_enabled").eq("business_id", businessId).maybeSingle(),
      ])
      if (st.error || sl.error || ch.error) {
        const e = st.error || sl.error || ch.error
        if (missingTable(e)) { publish({ migrationNeeded: true, loaded: true }); return }
        publish({ error: e?.message || "", loaded: true }); return
      }
      publish({
        migrationNeeded: false, error: "", loaded: true,
        settings: (st.data || []).map(rowSetting),
        slots: (sl.data || []).map(rowSlot),
        checks: (ch.data || []).map(rowCheck),
        lockEnabled: cf.data ? cf.data.lock_enabled !== false : true,
      })
    } finally { inflight = null }
  })()
  return inflight
}

// Iisang 60s na poll para sa BUONG app — nagsisimula sa unang subscriber at
// tumitigil kapag wala nang nakikinig. Ang mga check ng ibang device ay
// dumarating dito.
let pollIv: ReturnType<typeof setInterval> | null = null
function subscribe(fn: () => void) {
  subs.add(fn)
  if (!pollIv) {
    void refreshShared()
    pollIv = setInterval(() => { if (!G.migrationNeeded) void refreshShared() }, 60_000)
  }
  return () => {
    subs.delete(fn)
    if (subs.size === 0 && pollIv) { clearInterval(pollIv); pollIv = null }
  }
}

// ── Gastos SA ISANG PARTIKULAR NA ARAW kada account ──────────────────────────
// ⚠ Ang araw ay PARAMETRO, hindi laging "ngayon": ang 23:45 na round na
// pinipirmi/tinsetsek pagkalampas ng hatinggabi ay dapat sumukat sa araw NG
// SLOT — kung hindi, ang gumastos kahapon ay magmumukhang ₱0 at "clear" ang
// round na dapat ay puno.
const SPEND_CACHE = new Map<string, { ts: number; spend: number }>()
const SPEND_TTL = 4 * 60_000
export async function spendOfOn(a: FBAccount, day: string): Promise<number | null> {
  const key = `${a.id}|${day}`
  const hit = SPEND_CACHE.get(key)
  if (hit && Date.now() - hit.ts < SPEND_TTL) return hit.spend
  try {
    const acct = String(a.ad_account_id).startsWith("act_") ? a.ad_account_id : `act_${a.ad_account_id}`
    const r = await fetch(`/api/fb/insights?account_id=${encodeURIComponent(acct)}&from=${day}&to=${day}&token=${encodeURIComponent(a.token)}`)
    const j = await r.json()
    if (!j?.success) return null
    const spend = Number(j.total) || 0
    SPEND_CACHE.set(key, { ts: Date.now(), spend })
    return spend
  } catch { return null }
}

// ── SPEND-PICK: tatlong pagpipilian, isa ang totoo ────────────────────────────
// Multiplicative ang decoy (±20–40%) na may ₱50 man lang na pagitan, pare-
// parehong bilugan. ⚠ Ang ZERO ay espesyal: ang 0×anuman ay 0, kaya ang
// pangkalahatang pormula ay nagbubunga ng dalawang magkaparehong ₱0 — takdang
// mga decoy ang gamit doon.
export function makeSpendChoices(real: number): number[] {
  const r = Math.round(real)
  if (r < 50) {
    const d1 = 60 + Math.round(Math.random() * 120)
    return [r, d1, d1 + 70 + Math.round(Math.random() * 130)].sort(() => Math.random() - 0.5)
  }
  for (let tries = 0; tries < 40; tries++) {
    const f1 = 1 + (0.2 + Math.random() * 0.2) * (Math.random() < 0.5 ? -1 : 1)
    const f2 = 1 + (0.2 + Math.random() * 0.2) * (Math.random() < 0.5 ? -1 : 1)
    const d1 = Math.max(0, Math.round(r * f1) + (r < 250 ? 60 + Math.round(Math.random() * 80) : 0))
    const d2 = Math.max(0, Math.round(r * f2) - (r < 250 ? 55 + Math.round(Math.random() * 70) : 0))
    const ok = Math.abs(d1 - r) >= 50 && Math.abs(d2 - r) >= 50 && Math.abs(d1 - d2) >= 50 && d1 >= 0 && d2 >= 0
    if (ok) return [r, d1, d2].sort(() => Math.random() - 0.5)
  }
  return [r, r + 120, Math.max(0, r - 90)].sort(() => Math.random() - 0.5)
}

// ── Mga aksyon (module-level; lahat ay nagre-refresh ng IISANG estado) ────────
let freezeBusy = false
async function freezeDueSlotsShared(accounts: FBAccount[]) {
  if (freezeBusy || G.migrationNeeded || !G.loaded) return
  freezeBusy = true
  try {
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    const now = Date.now()
    const live = accounts.filter(a => !a.archived && a.token && a.ad_account_id && a.owner)
    for (const s of G.settings.filter(x => x.enabled)) {
      const times = timesOf(s.shift, s.custom_times)
      const w = activeWindow(times, now)

      // ── BACKFILL: ang bintanang LUMIPAS nang walang nakapansin (walang
      //    device na bukas) ay naitatala bilang account_count = -1 — "walang
      //    nakaobserba", hindi "clear" at hindi rin nawawala nang tahimik. ─────
      for (const past of windowsAround(times, now)) {
        if (slotStateAt(past, now) !== "missed") continue
        const has = G.slots.some(x => x.owner === s.owner && x.slot_date === past.date && x.slot_time === past.time)
        if (has) continue
        await supabase.from("monitor_slots").insert({
          business_id: businessId, owner: s.owner, slot_date: past.date, slot_time: past.time,
          frozen_by: "", account_count: -1,
        }).select("id").maybeSingle()   // talo sa unique = may ibang nakapansin — ayos lang
      }

      if (!w) continue
      const already = G.slots.some(x => x.owner === s.owner && x.slot_date === w.date && x.slot_time === w.time)
      if (already) continue
      const mine = live.filter(a => a.owner === s.owner)
      if (mine.length === 0) continue
      // ⚠ Gastos sa ARAW NG SLOT (w.date) — hindi manilaToday().
      const spends: { a: FBAccount; spend: number }[] = []
      let anyNull = false
      for (const a of mine) {
        const sp = await spendOfOn(a, w.date)
        if (sp === null) { anyNull = true; continue }
        if (sp > 0) spends.push({ a, spend: sp })
      }
      if (spends.length === 0 && anyNull) {
        // Lahat ng hila bigo. Habang ON TIME pa, umaasa tayong gagaling (retry
        // kada tick). Kapag LATE na at bigo pa rin, itala bilang "walang
        // nakaobserba" (-1) — kung hindi, ang patay na token ay walang-hanggang
        // "no data" na hindi kailanman lumilitaw sa admin.
        if (slotStateAt(w, now) === "late") {
          await supabase.from("monitor_slots").insert({
            business_id: businessId, owner: s.owner, slot_date: w.date, slot_time: w.time,
            frozen_by: currentUserName() || "", account_count: -1,
          }).select("id").maybeSingle()
          await refreshShared()
        }
        continue
      }
      const { data: won, error } = await supabase.from("monitor_slots")
        .insert({
          business_id: businessId, owner: s.owner, slot_date: w.date, slot_time: w.time,
          frozen_by: currentUserName() || "", account_count: spends.length,
        })
        .select("id").maybeSingle()
      if (error || !won) continue   // may ibang device na nanalo — tapos na
      if (spends.length > 0) {
        // ⚠ HINDI ATOMIC ang dalawang insert. Kapag pumalya ang checks (network,
        // isinara ang tab), ang slot ay may account_count > 0 pero WALANG check
        // row — walang-hanggang patay na round. Isang retry, at kung talo pa
        // rin, ibinabalik sa -1 ang slot para "walang nakaobserba" ang itsura at
        // hindi nagkukulong ng partner sa kandadong walang mabubuksan.
        const rows = spends.map(x => ({
          business_id: businessId, slot_id: won.id, owner: s.owner,
          slot_date: w.date, slot_time: w.time,
          account_id: x.a.id, account_name: x.a.name, spend_at_freeze: x.spend,
        }))
        let ins = await supabase.from("monitor_checks").insert(rows)
        if (ins.error) ins = await supabase.from("monitor_checks").insert(rows)
        if (ins.error) {
          await supabase.from("monitor_slots").update({ account_count: -1 })
            .eq("business_id", businessId).eq("id", won.id)
          await refreshShared()
          continue
        }
        const email = rosterEmailByName(s.owner)
        if (email) notify({
          audience: "user", toEmail: email, type: "monitor-round", severity: "info",
          title: `${w.time} monitoring round — ${spends.length} account${spends.length === 1 ? "" : "s"} to check`,
          body: spends.map(x => x.a.name).join(" · ").slice(0, 160),
          href: `${HREF}?round=${encodeURIComponent(w.time)}`,
          // ⚠ Bilang sistema: sa gabi, ang device ng PARTNER MISMO ang kadalasang
          // nananalo sa freeze — at ang abisong siya rin ang aktor ay itinatago
          // ng feed sa kanya. Ang sistema ang nagsasalita, hindi ang nagkataong
          // nanalong device.
          asSystem: true,
        })
      }
      await refreshShared()
    }
  } finally { freezeBusy = false }
}

async function claimMissedShared(slot: MonitorSlot, unchecked: number) {
  const businessId = await getBusinessId()
  if (!businessId) return
  const supabase = createSupabaseBrowserClient()
  const { data } = await supabase.from("monitor_slots")
    .update({ missed_notified: true })
    .eq("business_id", businessId).eq("id", slot.id).eq("missed_notified", false)
    .select("id")
  if (!data || data.length === 0) return   // ibang device na ang nagbalita
  notify({
    audience: "admin", type: "monitor-missed", severity: "warning",
    title: `${slot.owner} missed the ${slot.slot_time} monitoring round`,
    body: `${unchecked} of ${slot.account_count} account${slot.account_count === 1 ? "" : "s"} unchecked`,
    href: HREF, asSystem: true,
  })
  const email = rosterEmailByName(slot.owner)
  if (email) notify({
    audience: "user", toEmail: email, type: "monitor-missed", severity: "warning",
    title: `Missed round: ${slot.slot_time}`,
    body: "It is recorded as missed. The next round still counts — check in on time.",
    href: HREF, asSystem: true,
  })
  await refreshShared()
}

async function checkInShared(check: MonitorCheck, ev: {
  spend_at_check: number; active_campaigns: number; data_pulled_at: string
  dwell_ms: number; quiz_attempts: number; verdict: "ok" | "action"; note: string; no_data: boolean
}): Promise<"done" | "already" | string> {
  const businessId = await getBusinessId()
  if (!businessId) return "No business"
  const supabase = createSupabaseBrowserClient()
  const { data, error } = await supabase.from("monitor_checks")
    .update({
      checked_at: new Date().toISOString(),
      checked_by_name: currentUserName() || "", checked_by_email: (currentUserEmail() || "").toLowerCase(),
      ...ev,
    })
    .eq("business_id", businessId).eq("id", check.id).is("checked_at", null)
    .select("id")
  if (error) return error.message
  if (data && data.length) { await refreshShared(); return "done" }
  // ⚠ Ang 0-row ay DALAWANG magkaibang kuwento: (a) nauna ang ibang device —
  // ayos iyon; (b) TINANGGIHAN ng RLS (hindi pumasa sa is_monitor_eligible) —
  // ang pagsabi ng "tapos" doon ay tahimik na pagtatapon ng bawat check ng
  // partner na hindi tumugma ang pangalan. Basahin ang row para malaman.
  const { data: row } = await supabase.from("monitor_checks")
    .select("checked_at").eq("business_id", businessId).eq("id", check.id).maybeSingle()
  if (row?.checked_at) { await refreshShared(); return "already" }
  return "Not recorded — the database refused this check-in. Your roster name may not match the account owner; ask the admin."
}

// ── Ang hook — payat na balat sa ibabaw ng iisang estado ─────────────────────
export function useMonitorRounds() {
  const state = useSyncExternalStore(subscribe, () => G, () => G)
  const refresh = useCallback(() => refreshShared(), [])
  const freezeDueSlots = useCallback((accounts: FBAccount[]) => freezeDueSlotsShared(accounts), [])
  const checkIn = useCallback(checkInShared, [])
  const claimMissed = useCallback(claimMissedShared, [])

  const saveSetting = useCallback(async (owner: string, shift: string, customTimes: string[], enabled: boolean) => {
    const businessId = await getBusinessId()
    if (!businessId) return "No business"
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("monitor_settings").upsert({
      business_id: businessId, owner, shift, custom_times: customTimes, enabled,
      updated_at: new Date().toISOString(), updated_by: currentUserName() || "",
    }, { onConflict: "business_id,owner" })
    if (error) return missingTable(error) ? "Run migration 0034_ads_monitoring.sql in Supabase first." : error.message
    await refreshShared()
    return ""
  }, [])

  const saveLockEnabled = useCallback(async (on: boolean) => {
    const businessId = await getBusinessId()
    if (!businessId) return "No business"
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("monitor_config").upsert({
      business_id: businessId, lock_enabled: on,
      updated_at: new Date().toISOString(), updated_by: currentUserName() || "",
    }, { onConflict: "business_id" })
    if (error) return missingTable(error) ? "Run migration 0034_ads_monitoring.sql in Supabase first." : error.message
    await refreshShared()
    return ""
  }, [])

  const fetchRange = useCallback(async (from: string, to: string) => {
    const businessId = await getBusinessId()
    if (!businessId) return { slots: [] as MonitorSlot[], checks: [] as MonitorCheck[] }
    const supabase = createSupabaseBrowserClient()
    const [sl, ch] = await Promise.all([
      supabase.from("monitor_slots").select("*").eq("business_id", businessId).gte("slot_date", from).lte("slot_date", to),
      supabase.from("monitor_checks").select("*").eq("business_id", businessId).gte("slot_date", from).lte("slot_date", to),
    ])
    return { slots: (sl.data || []).map(rowSlot), checks: (ch.data || []).map(rowCheck) }
  }, [])

  return { ...state, refresh, fetchRange, saveSetting, saveLockEnabled, freezeDueSlots, checkIn, claimMissed }
}

// ── Mga tulong sa paghusga (puro; ginagamit ng chip, popup at dashboard) ──────
/**
 * Ang bintana ng isang slot. ⚠ HINDI kondisyonal sa KASALUKUYANG oras ng
 * setting: kapag pinalitan ng admin ang shift sa kalagitnaan ng araw, ang mga
 * NAIPIRMI nang slot ay dapat pa ring matapos, ma-eskala at mabilang — kaya ang
 * slot na wala na sa listahan ay binubuo pa rin mula sa sarili niyang oras.
 */
export function windowFor(setting: MonitorSetting | undefined, slot: { slot_date: string; slot_time: string }): SlotWindow | null {
  if (!/^\d{2}:\d{2}$/.test(slot.slot_time)) return null
  const times = setting ? timesOf(setting.shift, setting.custom_times) : []
  if (times.includes(slot.slot_time)) {
    const all = slotWindows(slot.slot_date, times)
    return all.find(w => w.time === slot.slot_time) || null
  }
  return slotWindows(slot.slot_date, [slot.slot_time])[0] || null
}

/** Ang settings row ng kasalukuyang user (partner) — pangalan ang tugma. */
export function myMonitorSetting(settings: MonitorSetting[], meName: string, meEmail: string): MonitorSetting | undefined {
  const n = meName.trim().toLowerCase()
  return settings.find(s => s.enabled && (
    s.owner.trim().toLowerCase() === n
    || (!!meEmail && rosterEmailByName(s.owner) === meEmail)
  ))
}
