"use client"
import { useCallback, useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"

// ──────────────────────────────────────────────────────────────────────────────
// Scaling Registry — ang mga ad set na inirehistro sa Scaling tab (migration
// 0024). Supabase ang source of truth: tatlong media buyer ang gumagamit, kaya
// ang localStorage ay magpapakita ng magkakaibang listahan kada makina — mali.
// Bawat pag-scale ay event sa `scales` jsonb, hindi bagong row — para ang
// "pang-ilang scale na" ay haba lang ng array.
// ──────────────────────────────────────────────────────────────────────────────

export interface ScaleEvent {
  date: string        // YYYY-MM-DD (PHT)
  pct: number         // 10, 20, 30…
  from: number        // budget bago (pesos)
  to: number          // budget pagkatapos (pesos)
  applied: boolean    // true = na-update sa Meta via API; false = naitala lang (hal. CBO)
}
// "ad-moved" = marker na ang panalong ad ay mano-manong inilipat sa scaling
// campaign sa Ads Manager (✅ Moved sa View ads). Hindi ito lumalabas sa mga tab —
// naka-filter sila sa sariling level; shared lang ito sa tatlong buyer.
export type RegLevel = "adset" | "campaign" | "ad-moved"

export interface Registration {
  id: string
  /** Meta object id — ad set id kapag level="adset", campaign id kapag "campaign". */
  adset_id: string
  adset_name: string
  campaign_name: string
  account_name: string
  owner: string
  level: RegLevel
  registered_at: string      // YYYY-MM-DD
  starting_budget: number
  scales: ScaleEvent[]
  active: boolean
}

function rowToReg(r: any): Registration {
  return {
    id: r.id, adset_id: r.adset_id, adset_name: r.adset_name || "",
    campaign_name: r.campaign_name || "", account_name: r.account_name || "", owner: r.owner || "",
    level: r.level === "campaign" ? "campaign" : r.level === "ad-moved" ? "ad-moved" : "adset",
    registered_at: r.registered_at, starting_budget: Number(r.starting_budget) || 0,
    scales: Array.isArray(r.scales) ? r.scales : [],
    active: r.active !== false,
  }
}

export function useScalingRegistry() {
  const [regs, setRegs] = useState<Registration[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState("")

  const refresh = useCallback(async () => {
    const businessId = await getBusinessId()
    if (!businessId) { setLoaded(true); return }
    const supabase = createSupabaseBrowserClient()
    const { data, error } = await supabase
      .from("scaling_registry").select("*")
      .eq("business_id", businessId).eq("active", true)
      .order("registered_at", { ascending: false })
    if (error) {
      // Ang pinakakaraniwang sanhi: hindi pa naitatakbo ang migration 0024.
      setError(/scaling_registry/.test(error.message) || error.code === "42P01"
        ? "The scaling_registry table doesn't exist yet — run migration 0024_scaling_registry.sql in Supabase first."
        : error.message)
      setLoaded(true)
      return
    }
    setError("")
    setRegs((data || []).map(rowToReg))
    setLoaded(true)
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const register = useCallback(async (items: Omit<Registration, "id" | "scales" | "active">[]) => {
    const businessId = await getBusinessId()
    if (!businessId || items.length === 0) return
    const supabase = createSupabaseBrowserClient()
    // upsert sa (business_id, adset_id): ang muling pagrehistro ng dating
    // na-unregister ay BAGONG simula — nire-reset ang petsa/budget/scales.
    const { error } = await supabase.from("scaling_registry").upsert(items.map(i => ({
      business_id: businessId, adset_id: i.adset_id, adset_name: i.adset_name,
      campaign_name: i.campaign_name, account_name: i.account_name, owner: i.owner,
      level: i.level, registered_at: i.registered_at, starting_budget: i.starting_budget,
      scales: [], active: true, updated_at: new Date().toISOString(),
    })), { onConflict: "business_id,adset_id" })
    if (!error) await refresh()
    return error?.message
  }, [refresh])

  const unregister = useCallback(async (adsetId: string) => {
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    await supabase.from("scaling_registry")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("business_id", businessId).eq("adset_id", adsetId)
    await refresh()
  }, [refresh])

  const addScale = useCallback(async (adsetId: string, ev: ScaleEvent) => {
    const businessId = await getBusinessId()
    if (!businessId) return
    const reg = regs.find(r => r.adset_id === adsetId)
    if (!reg) return
    const supabase = createSupabaseBrowserClient()
    await supabase.from("scaling_registry")
      .update({ scales: [...reg.scales, ev], updated_at: new Date().toISOString() })
      .eq("business_id", businessId).eq("adset_id", adsetId)
    await refresh()
  }, [regs, refresh])

  // Ang HULING scale step lang ang natatanggal — ang pagbunot sa gitna ay
  // sisira sa kasaysayan (ang `from` ng bawat step ay ang `to` ng nauna).
  // Ibinabalik nito ang tinanggal na event para maibalik ng caller ang budget
  // sa Meta kung na-apply iyon.
  const undoLastScale = useCallback(async (adsetId: string): Promise<ScaleEvent | null> => {
    const businessId = await getBusinessId()
    if (!businessId) return null
    const reg = regs.find(r => r.adset_id === adsetId)
    if (!reg || reg.scales.length === 0) return null
    const last = reg.scales[reg.scales.length - 1]
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("scaling_registry")
      .update({ scales: reg.scales.slice(0, -1), updated_at: new Date().toISOString() })
      .eq("business_id", businessId).eq("adset_id", adsetId)
    if (error) return null
    await refresh()
    return last
  }, [regs, refresh])

  return { regs, loaded, error, refresh, register, unregister, addScale, undoLastScale }
}
