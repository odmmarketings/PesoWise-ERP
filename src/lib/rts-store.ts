"use client"
import { useCallback, useEffect, useState } from "react"
import { currentUserName } from "@/lib/current-user"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"

// RTS Items — warehouse state for Return-to-Sender parcels, keyed by TRACKING NUMBER
// (that's what the barcode scanner reads off the returned parcel).
// Lifecycle: Unreceived → Received (Scan & Receive) → Checked (Scan & Check).
// Claims (courier refunds) attach per tracking number via the Upload Claims xlsx.
// Source of truth = Supabase `rts_meta` (one row per tracking number — row-level upserts
// keep the scanner's back-to-back writes from clobbering each other across users too);
// `pesowise_rts_meta` localStorage is a same-session read cache (migrated up once).
const KEY = "pesowise_rts_meta"

export interface RtsItemCount { name: string; qty: number; goods: number; damage: number; loss: number }
export interface RtsMeta {
  received_at?: string   // "YYYY-MM-DD HH:mm:ss" (PH local)
  received_by?: string
  checked_at?: string
  checked_by?: string
  // View RTS form (LHIKE): per-item inspection counts + reason + evidence + workflow status.
  items?: RtsItemCount[]           // Goods / Damage / Loss per item (qty = ordered)
  reason?: "" | "Buyer" | "Courier"
  reason_remarks?: string
  images?: string[]                // downscaled data-URL photos of the returned parcel
  approval_status?: "For Approval" | "Pending"
  remarks?: string
  rts_fee?: number
  requested_by?: string            // first Submit of the View RTS form
  requested_at?: string
  updated_by?: string              // last Submit (HISTORY "Uploaded by/date")
  updated_at?: string
  for_claim?: boolean    // tagged as damaged / lost → to be claimed from the courier
  damage_note?: string   // what's wrong with the parcel (checker's note)
  claim_amount?: number  // courier claim/refund for this parcel (Upload Claims) → status "Claimed"
  claim_note?: string
  claimed_at?: string    // when the claim amount landed (Upload Claims)
}

function readCache(): Record<string, RtsMeta> {
  if (typeof window === "undefined") return {}
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") } catch { return {} }
}
function writeCache(map: Record<string, RtsMeta>) { try { localStorage.setItem(KEY, JSON.stringify(map)) } catch {} }

const stampNow = () => {
  const n = new Date(), p = (x: number) => String(x).padStart(2, "0")
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())} ${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}`
}

// Background row-level upsert of specific tracking numbers (idempotent — safe to re-fire).
function upsertRows(entries: [string, RtsMeta][]) {
  if (entries.length === 0) return
  void (async () => {
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    const now = new Date().toISOString()
    for (let i = 0; i < entries.length; i += 200) {
      await supabase.from("rts_meta").upsert(entries.slice(i, i + 200).map(([tracking_no, meta]) => ({
        business_id: businessId, tracking_no, meta, updated_at: now,
      })))
    }
  })()
}

async function fetchAll(): Promise<Record<string, RtsMeta> | null> {
  const businessId = await getBusinessId()
  if (!businessId) return null
  const supabase = createSupabaseBrowserClient()
  const out: Record<string, RtsMeta> = {}
  const PAGE = 1000
  let total = 0
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from("rts_meta").select("tracking_no, meta").eq("business_id", businessId).range(from, from + PAGE - 1)
    if (error || !data) return null
    for (const r of data) out[r.tracking_no] = (r.meta || {}) as RtsMeta
    total += data.length
    if (data.length < PAGE) break
  }
  if (total === 0) {
    // One-time migration: push this browser's existing localStorage map up.
    const cached = readCache()
    const entries = Object.entries(cached)
    if (entries.length > 0) { upsertRows(entries); return cached }
  }
  writeCache(out)
  return out
}

export function useRtsMeta() {
  const [meta, setMeta] = useState<Record<string, RtsMeta>>({})
  useEffect(() => {
    setMeta(readCache())
    fetchAll().then(map => { if (map) setMeta(map) })
  }, [])
  // FUNCTIONAL updates only — back-to-back writes (e.g. markChecked + saveDetails from the
  // camera scanner) must never build on a stale snapshot, or the later write drops the earlier.
  // `touched` = the tracking numbers this update changed; only those rows are upserted.
  const update = useCallback((fn: (prev: Record<string, RtsMeta>) => Record<string, RtsMeta>, touched: string[]) => {
    setMeta(prev => {
      const next = fn(prev)
      writeCache(next)
      upsertRows(touched.filter(t => next[t]).map(t => [t, next[t]] as [string, RtsMeta]))
      return next
    })
  }, [])
  const patch = (tracking: string, p: RtsMeta) =>
    update(prev => ({ ...prev, [tracking]: { ...(prev[tracking] || {}), ...p } }), [tracking])

  function markReceived(tracking: string) { patch(tracking, { received_at: stampNow(), received_by: currentUserName() }) }
  function markChecked(tracking: string) { patch(tracking, { checked_at: stampNow(), checked_by: currentUserName() }) }
  function tagClaim(tracking: string, forClaim: boolean, note: string) { patch(tracking, { for_claim: forClaim, damage_note: note }) }
  // View RTS form submit — stamps requested_by on first save, updated_by every save; parcels
  // with any Damage/Loss are auto-tagged For Claim.
  function saveDetails(tracking: string, details: Partial<RtsMeta>) {
    const hasDamage = (details.items || []).some(i => (i.damage || 0) > 0 || (i.loss || 0) > 0)
    update(prev => {
      const old = prev[tracking] || {}
      return {
        ...prev,
        [tracking]: {
          ...old, ...details,
          ...(old.requested_by ? {} : { requested_by: currentUserName(), requested_at: stampNow() }),
          updated_by: currentUserName(), updated_at: stampNow(),
          ...(hasDamage ? { for_claim: true, damage_note: details.reason_remarks || old.damage_note || "" } : {}),
        },
      }
    }, [tracking])
  }
  // Claims upload (LHIKE template: TRACKING NUMBER + DATE OF CLAIM) — amount = the parcel's
  // price (computed by the caller); the claim date from the file becomes claimed_at.
  function setClaims(claims: { tracking: string; amount: number; date?: string; note?: string }[]) {
    update(prev => {
      const next = { ...prev }
      for (const c of claims) next[c.tracking] = { ...(next[c.tracking] || {}), claim_amount: c.amount, claimed_at: c.date ? `${c.date} 00:00:00` : stampNow(), ...(c.note ? { claim_note: c.note } : {}) }
      return next
    }, claims.map(c => c.tracking))
  }
  return { meta, markReceived, markChecked, tagClaim, saveDetails, setClaims }
}
