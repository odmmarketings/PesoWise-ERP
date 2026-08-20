"use client"
import { useCallback, useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"
import { currentUserName } from "@/lib/current-user"

// ─────────────────────────────────────────────────────────────────────────────
// TUNAY NA COST NG SUPPLIER (migration 0031) — LIHIM NG MAY-ARI.
//
// Ang may-ari ang supplier: ang idineklarang COG sa Product Items (nakikita ng
// lahat) ay may patong sa tunay niyang binayaran. Ang agwat ay kita niya, at
// WALANG ibang tao ang dapat makakita nito.
//
// ⚠ ANG KANDADO AY NASA RLS, HINDI DITO. Ang talahanayang
// `supplier_true_costs` ay MAY-ARI LANG ang policy (`businesses.owner_id =
// auth.uid()`) — walang `is_business_member` na sanga, kaya kahit buksan ng
// ibang user ang endpoint gamit ang anon key, WALANG hilerang babalik. Ang
// `useIsOwner` sa ibaba ay pang-UI lang (para hindi man lang lumitaw ang
// seksyon); hindi iyon ang seguridad.
// ─────────────────────────────────────────────────────────────────────────────

export const monthKeyNow = () => {
  const d = new Date()
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0")
}

export interface TrueCost {
  item_id: string
  true_cost: number
  note: string
}

/**
 * Ako ba ang MAY-ARI ng business (auth.uid === businesses.owner_id)?
 *
 * ⚠ HINDI ITO ANG `isMotherAccount()`. Iyon ay basa sa localStorage roster —
 * cache na kayang baguhin ng sinumang marunong magbukas ng DevTools. Ito ay
 * tunay na tanong sa Supabase session, at ang sagot ay tumutugma sa mismong
 * RLS ng talahanayan: kung sino ang makakabasa ng datos, siya rin lang ang
 * makakakita ng seksyon.
 */
export function useIsOwner(): boolean | null {
  const [isOwner, setIsOwner] = useState<boolean | null>(null)
  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        const supabase = createSupabaseBrowserClient()
        const [{ data: auth }, { data: biz }] = await Promise.all([
          supabase.auth.getUser(),
          supabase.from("businesses").select("owner_id").limit(1).maybeSingle(),
        ])
        if (!dead) setIsOwner(!!auth?.user?.id && !!biz?.owner_id && auth.user.id === biz.owner_id)
      } catch { if (!dead) setIsOwner(false) }
    })()
    return () => { dead = true }
  }, [])
  return isOwner
}

export function useTrueCosts() {
  const [costs, setCosts] = useState<Record<string, TrueCost>>({})
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState("")

  const refresh = useCallback(async () => {
    const businessId = await getBusinessId()
    if (!businessId) { setLoaded(true); return }
    const supabase = createSupabaseBrowserClient()
    const { data, error } = await supabase.from("supplier_true_costs")
      .select("item_id,true_cost,note").eq("business_id", businessId)
    if (error) {
      setError(/supplier_true_costs/.test(error.message) || error.code === "42P01"
        ? "Run migration 0031_supplier_true_costs.sql in Supabase first."
        : error.message)
      setLoaded(true); return
    }
    setError("")
    const m: Record<string, TrueCost> = {}
    for (const r of data || []) m[r.item_id] = { item_id: r.item_id, true_cost: Number(r.true_cost) || 0, note: r.note || "" }
    setCosts(m)
    setLoaded(true)
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const setTrueCost = useCallback(async (itemId: string, trueCost: number, note = "") => {
    const businessId = await getBusinessId()
    if (!businessId) return "No business"
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("supplier_true_costs").upsert({
      business_id: businessId, item_id: itemId, true_cost: trueCost, note: note.trim(),
      updated_at: new Date().toISOString(), updated_by: currentUserName() || "",
    }, { onConflict: "business_id,item_id" })
    if (error) return error.message
    await refresh()
    return ""
  }, [refresh])

  const clearTrueCost = useCallback(async (itemId: string) => {
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    await supabase.from("supplier_true_costs").delete()
      .eq("business_id", businessId).eq("item_id", itemId)
    await refresh()
  }, [refresh])

  return { costs, loaded, error, refresh, setTrueCost, clearTrueCost }
}

/**
 * Ang kita kada item: Σ sa bawat BATCH ng (idineklarang cog ng batch − tunay
 * na cost) × qty.
 *
 * ⚠ BATCH ANG BATAYAN, HINDI ANG KASALUKUYANG COG NG ITEM. Ang idineklarang
 * presyo ay nagbabago-bago kada dating (FIFO layers na may sariling cog), at
 * ang kita ay kinita sa MISMONG presyong idineklara noong dating na iyon.
 * Kung ang kasalukuyang cog ang gagamitin sa lahat, ang bawat pagpalit ng
 * presyo ay muling magsusulat ng kasaysayan.
 */
export function marginOf(
  batches: { cog: number; qty: number; received_date: string }[],
  trueCost: number,
  monthPrefix?: string,     // "2026-08" → ngayong buwan lang; wala → lahat
): { pcs: number; margin: number } {
  let pcs = 0, margin = 0
  for (const b of batches) {
    if (monthPrefix && !String(b.received_date || "").startsWith(monthPrefix)) continue
    const qty = Number(b.qty) || 0
    pcs += qty
    margin += (Number(b.cog) - trueCost) * qty
  }
  return { pcs, margin }
}
