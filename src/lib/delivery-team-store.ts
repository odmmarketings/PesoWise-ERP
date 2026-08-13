"use client"
import { useCallback, useEffect, useMemo, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"
import { isMotherAccount } from "@/lib/users-store"

// ──────────────────────────────────────────────────────────────────────────────
// Delivery team roster — sino ang mga Delivery/Problematic agents at supervisors.
// Email-based (problem_departments.manager_emails precedent) para mailista ang
// agents kahit wala pa silang PesoWise accounts; tutugma sa business_users kapag
// nagawa na ang account nila. Source of truth = Supabase `delivery_team`.
// ──────────────────────────────────────────────────────────────────────────────

const uid = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

export type DeliveryTeamRole = "agent" | "supervisor"
/** Resolved na papel sa module: admin = Mother Account · supervisor/agent = nasa roster ·
 *  viewer = may nav permission pero wala sa roster (read-only). */
export type DeliveryRole = "admin" | "supervisor" | "agent" | "viewer"

export interface DeliveryAgent {
  id: string
  email: string
  name: string
  role: DeliveryTeamRole
  active: boolean
  sort: number
}

function rowToAgent(r: any): DeliveryAgent {
  return {
    id: r.id, email: r.email || "", name: r.name || "",
    role: r.role === "supervisor" ? "supervisor" : "agent",
    active: r.active !== false, sort: r.sort ?? 0,
  }
}

export function resolveDeliveryRole(email: string, team: DeliveryAgent[]): DeliveryRole {
  if (isMotherAccount()) return "admin"
  const e = (email || "").toLowerCase()
  const member = e ? team.find(t => t.active && t.email.toLowerCase() === e) : undefined
  if (member?.role === "supervisor") return "supervisor"
  if (member?.role === "agent") return "agent"
  return "viewer"
}

export function useDeliveryTeam() {
  const [team, setTeam] = useState<DeliveryAgent[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const businessId = await getBusinessId()
    if (!businessId) { setLoaded(true); return }
    const supabase = createSupabaseBrowserClient()
    const { data } = await supabase.from("delivery_team").select("*")
      .eq("business_id", businessId).order("sort", { ascending: true }).order("created_at", { ascending: true })
    setTeam((data || []).map(rowToAgent))
    setLoaded(true)
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const addMember = useCallback(async (input: { email: string; name: string; role: DeliveryTeamRole }) => {
    const businessId = await getBusinessId()
    const email = input.email.trim().toLowerCase()
    if (!businessId || !email) return "Email is required."
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("delivery_team").insert({
      id: uid("dta"), business_id: businessId, email,
      name: input.name.trim(), role: input.role, active: true, sort: 999,
    })
    if (error) return /duplicate|unique/i.test(error.message) ? "That email is already on the roster." : error.message
    await refresh()
    return ""
  }, [refresh])

  const updateMember = useCallback(async (id: string, patch: Partial<DeliveryAgent>) => {
    const supabase = createSupabaseBrowserClient()
    const row: Record<string, any> = {}
    if (patch.email !== undefined) row.email = patch.email.trim().toLowerCase()
    if (patch.name !== undefined) row.name = patch.name
    if (patch.role !== undefined) row.role = patch.role
    if (patch.active !== undefined) row.active = patch.active
    if (patch.sort !== undefined) row.sort = patch.sort
    await supabase.from("delivery_team").update(row).eq("id", id)
    await refresh()
  }, [refresh])

  const removeMember = useCallback(async (id: string) => {
    const supabase = createSupabaseBrowserClient()
    await supabase.from("delivery_team").delete().eq("id", id)
    await refresh()
  }, [refresh])

  const activeAgents = useMemo(() => team.filter(t => t.active && t.role === "agent"), [team])
  return { team, activeAgents, loaded, refresh, addMember, updateMember, removeMember }
}
