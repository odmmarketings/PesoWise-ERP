"use client"
import { useCallback, useEffect, useState } from "react"

// Affiliate marketing module. You register affiliates with an EDITABLE commission %;
// their attributed sales come from each platform's affiliate API (to follow). Commission
// = sales × commission%, and that commission is a deduction from net profit.
const KEY = "pesowise_affiliates"

export const AFF_PLATFORMS = ["TikTok", "Shopee", "Lazada", "Facebook"] as const
export const AFF_STATUSES = ["Active", "Inactive"] as const
export type AffStatus = typeof AFF_STATUSES[number]

export interface Affiliate {
  id: string
  name: string
  platform: string
  code: string             // affiliate / referral code
  commission_pct: number   // editable
  contact: string
  status: AffStatus
  sales: number            // attributed sales (from affiliate API — to follow; manual-safe)
  notes: string
  created_at: string
}

export interface NewAffInput {
  name: string; platform: string; code: string; commission_pct: number
  contact: string; status?: AffStatus; sales?: number; notes: string
}

function uid() { return `aff_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }
function normalize(r: Partial<Affiliate>): Affiliate {
  return {
    id: r.id || uid(),
    name: r.name || "",
    platform: r.platform || "TikTok",
    code: r.code || "",
    commission_pct: Number(r.commission_pct ?? 0),
    contact: r.contact || "",
    status: r.status || "Active",
    sales: Number(r.sales ?? 0),
    notes: r.notes || "",
    created_at: r.created_at || new Date().toISOString(),
  }
}
function load(): Affiliate[] {
  if (typeof window === "undefined") return []
  try { const raw = localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as Partial<Affiliate>[]).map(normalize) : [] }
  catch { return [] }
}
function save(list: Affiliate[]) { try { localStorage.setItem(KEY, JSON.stringify(list)) } catch {} }

export const commissionOf = (a: Affiliate) => a.sales * (a.commission_pct / 100)

export function useAffiliates() {
  const [affiliates, setAffiliates] = useState<Affiliate[]>([])
  useEffect(() => { setAffiliates(load()) }, [])
  const persist = useCallback((next: Affiliate[]) => { save(next); setAffiliates(next) }, [])

  function addAffiliate(input: NewAffInput) { persist([normalize({ ...input, id: uid(), created_at: new Date().toISOString() }), ...affiliates]) }
  function updateAffiliate(id: string, input: Partial<NewAffInput>) { persist(affiliates.map(a => a.id === id ? { ...a, ...input } : a)) }
  function deleteAffiliate(id: string) { persist(affiliates.filter(a => a.id !== id)) }

  const totalSales = affiliates.reduce((s, a) => s + a.sales, 0)
  const totalCommission = affiliates.reduce((s, a) => s + commissionOf(a), 0)
  return { affiliates, addAffiliate, updateAffiliate, deleteAffiliate, totalSales, totalCommission }
}
