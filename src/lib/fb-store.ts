"use client"
import { useCallback, useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"
import { getEcomSetting, setEcomSetting } from "@/lib/ecom-settings"

// Facebook / Meta ad-account registrations — set up like Pages & Store: you register
// each ad account (name, owner, page URL, ad account ID, API token, …) and the ADS
// module reads live spend from the Meta Marketing API via /api/fb/insights.
// Source of truth = Supabase `fb_accounts`; `pesowise_fb_accounts` localStorage is now
// just a same-session read cache (and is migrated up once on first load).
const KEY = "pesowise_fb_accounts"

export const FB_STATUSES = ["Active", "Paused", "Disabled", "In-review"] as const
export type FBStatus = typeof FB_STATUSES[number]

// What the ad account is optimised for.
export const FB_FOCUS = ["Conversions", "Messaging", "Sales", "Leads", "Traffic", "Engagement", "Awareness"] as const

export interface FBAccount {
  id: string
  name: string              // friendly label, e.g. "Lumyra - Glaucoma"
  owner: string
  page_name: string         // PesoWise page this maps to (for adspent sync)
  page_url: string
  ad_account_id: string     // e.g. act_909054325102209 or just the digits — ANG PANGUNAHIN
  /**
   * Karagdagang ad account ID na ang gastos ay dapat isama sa adspent ng registration
   * na ito — kadalasan mga NA-DISABLE nang account na may nagastos pa rin.
   *
   * PANG-SUMA LANG NG GASTOS. Ang `ad_account_id` pa rin ang ginagamit ng Ads Manager,
   * ng FB Billing, at ng status sync — sinasadya, para walang masira sa mga umiiral na
   * tampok habang nakukuha pa rin ang nawawalang gastos.
   */
  extra_account_ids: string[]
  token: string             // Meta access token (System User token ideally)
  platform: string          // "Facebook"
  focus: string             // Conversions / Messaging / …
  currency: string
  status: FBStatus
  remarks: string
  card_id: string           // Finance CARDS registry — kung saang card naka-register ang ad account
  archived: boolean
  created_at: string
}

export interface NewFBInput {
  name: string; owner: string; page_name: string; page_url: string
  ad_account_id: string; extra_account_ids?: string[]; token: string; platform: string; focus: string; currency: string
  status?: FBStatus; remarks: string; card_id?: string
}

function uid() { return `fb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }
// Normalize an ad account id to the "act_<digits>" form Meta expects.
export function actId(raw: string) {
  const s = String(raw || "").trim()
  if (!s) return ""
  return s.startsWith("act_") ? s : `act_${s.replace(/\D/g, "")}`
}

/**
 * LAHAT ng ad account ID ng isang registration — ang pangunahin at ang mga karagdagan,
 * naka-normalize at walang duplicate.
 *
 * Ito ang dapat gamitin ng anumang SUMA NG GASTOS. Ang paggamit ng `ad_account_id`
 * lang ay tahimik na nagbabawas sa adspent ng bawat na-disable na account.
 */
export function allAccountIds(a: Pick<FBAccount, "ad_account_id" | "extra_account_ids">): string[] {
  const out: string[] = []
  for (const raw of [a.ad_account_id, ...(a.extra_account_ids || [])]) {
    const id = actId(raw)
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

function normalize(r: Partial<FBAccount>): FBAccount {
  return {
    id: r.id || uid(),
    name: r.name || "",
    owner: r.owner || "",
    page_name: r.page_name || "",
    page_url: r.page_url || "",
    ad_account_id: r.ad_account_id || "",
    extra_account_ids: Array.isArray(r.extra_account_ids)
      ? r.extra_account_ids.map(x => String(x || "").trim()).filter(Boolean)
      : [],
    token: r.token || "",
    platform: r.platform || "Facebook",
    focus: r.focus || "Conversions",
    currency: r.currency || "PHP",
    status: r.status || "Active",
    remarks: r.remarks || "",
    card_id: r.card_id || "",
    archived: r.archived ?? false,
    created_at: r.created_at || new Date().toISOString(),
  }
}

function readCache(): FBAccount[] {
  if (typeof window === "undefined") return []
  try { const raw = localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as Partial<FBAccount>[]).map(normalize) : [] }
  catch { return [] }
}
function writeCache(list: FBAccount[]) { try { localStorage.setItem(KEY, JSON.stringify(list)) } catch {} }

function toRow(a: FBAccount, businessId: string) {
  return { business_id: businessId, ...a }
}

export function useFBAccounts() {
  const [accounts, setAccounts] = useState<FBAccount[]>(() => readCache())

  const refresh = useCallback(async () => {
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    const { data, error } = await supabase.from("fb_accounts").select("*").eq("business_id", businessId).order("inserted_at", { ascending: false })
    if (error) return
    if (data.length === 0) {
      // One-time migration: push this browser's existing localStorage records up.
      const cached = readCache()
      if (cached.length > 0) {
        await supabase.from("fb_accounts").insert(cached.map(a => toRow(a, businessId)))
        setAccounts(cached)
        return
      }
    }
    const list = data.map(r => normalize(r as Partial<FBAccount>))
    writeCache(list); setAccounts(list)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function addAccount(input: NewFBInput) {
    const businessId = await getBusinessId()
    if (!businessId) return
    const rec = normalize({ ...input, id: uid(), created_at: new Date().toISOString() })
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("fb_accounts").insert(toRow(rec, businessId))
    if (error) throw error
    await refresh()
  }

  async function updateAccount(id: string, input: Partial<NewFBInput>) {
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("fb_accounts").update(input).eq("id", id)
    if (error) throw error
    await refresh()
  }

  async function deleteAccount(id: string) {
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("fb_accounts").delete().eq("id", id)
    if (error) throw error
    await refresh()
  }

  async function setArchived(id: string, archived: boolean) {
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("fb_accounts").update({ archived }).eq("id", id)
    if (error) throw error
    await refresh()
  }

  // Apply one token to every registered ad account (the shared "default" token holds all accounts).
  async function setAllTokens(token: string) {
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("fb_accounts").update({ token: token.trim() }).eq("business_id", businessId)
    if (error) throw error
    await refresh()
  }

  // Batch-apply auto-synced statuses (functional update avoids stale-closure clobbering).
  const updateStatuses = useCallback(async (map: Record<string, FBStatus>) => {
    const ids = Object.keys(map)
    if (ids.length === 0) return
    setAccounts(prev => { const next = prev.map(a => map[a.id] ? { ...a, status: map[a.id] } : a); writeCache(next); return next })
    const supabase = createSupabaseBrowserClient()
    await Promise.all(ids.map(id => supabase.from("fb_accounts").update({ status: map[id] }).eq("id", id)))
  }, [])

  // Active = registered Active, not archived, with creds — used by the ADS fetch.
  const activeAccounts = accounts.filter(a => a.status === "Active" && !a.archived && a.ad_account_id && a.token)
  return { accounts, activeAccounts, addAccount, updateAccount, deleteAccount, setArchived, updateStatuses, setAllTokens }
}

// ── Shared "default" API token ──────────────────────────────────────────────
// One token used by every ad account (data is pulled per ad-account ID). Tracks when it was set
// so the UI can show a 60-day countdown and warn before it expires. Stored in the shared
// `ecommerce_settings.fb_default_token` column; localStorage is a same-session read cache.
const DEFAULT_TOKEN_KEY = "pesowise_fb_default_token"
export const FB_TOKEN_DAYS = 60
export interface FBDefaultToken { token: string; setAt: string }

function readTokenCache(): FBDefaultToken {
  try { const raw = localStorage.getItem(DEFAULT_TOKEN_KEY); if (raw) return JSON.parse(raw) } catch {}
  return { token: "", setAt: "" }
}

export function useFBDefaultToken() {
  const [data, setData] = useState<FBDefaultToken>(() => readTokenCache())

  useEffect(() => {
    (async () => {
      const remote = await getEcomSetting<FBDefaultToken>("fb_default_token")
      if (remote?.token) {
        setData(remote)
        try { localStorage.setItem(DEFAULT_TOKEN_KEY, JSON.stringify(remote)) } catch {}
      } else {
        // One-time migration: push this browser's existing token up.
        const cached = readTokenCache()
        if (cached.token) await setEcomSetting("fb_default_token", cached)
      }
    })()
  }, [])

  const save = useCallback(async (token: string) => {
    const next: FBDefaultToken = { token: token.trim(), setAt: new Date().toISOString() }
    try { localStorage.setItem(DEFAULT_TOKEN_KEY, JSON.stringify(next)) } catch {}
    setData(next)
    await setEcomSetting("fb_default_token", next)
  }, [])

  // Days until the token "expires" (setAt + FB_TOKEN_DAYS). null when no token set.
  const daysLeft = data.setAt ? Math.ceil((new Date(data.setAt).getTime() + FB_TOKEN_DAYS * 86400000 - Date.now()) / 86400000) : null
  return { token: data.token, setAt: data.setAt, save, daysLeft }
}
