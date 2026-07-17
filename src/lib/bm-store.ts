"use client"
import { useCallback, useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"
import { currentUserName } from "@/lib/current-user"

// BM (Business Manager) account records. Source of truth = Supabase `bm_accounts`;
// `pesowise_bm_accounts` localStorage is now just a same-session read cache (and is
// migrated up once on first load). picture_data / id_data stay as the same
// JPEG-compressed base64 data URLs the app already produced.

export type BMStatus = "Active" | "Inactive" | "In-review" | "Restricted" | "Permanently Disabled" | "Other"

export const BM_STATUSES: BMStatus[] = ["Active", "Inactive", "In-review", "Restricted", "Permanently Disabled", "Other"]

export interface BMAccount {
  id: string
  date_created: string      // "YYYY-MM-DD"
  name: string              // BM Name (required)
  owner: string             // (required)
  birthday: string          // "YYYY-MM-DD"
  address: string
  email: string
  contact_no: string
  remarks: string
  picture_name: string      // original filename
  picture_data: string      // data URL or ""
  id_name: string
  id_data: string           // data URL or ""
  adsmanager_link: string
  status: BMStatus
  created_by: string
  created_date: string      // ISO
}

export interface NewBMInput {
  name: string; owner: string; birthday: string; address: string
  email: string; contact_no: string; remarks: string
  picture_name: string; picture_data: string
  id_name: string; id_data: string
  adsmanager_link: string
  status?: BMStatus
}

const KEY = "pesowise_bm_accounts"
const BM_CREATED_BY = "Admin User" // fallback only — real records stamp currentUserName()

function todayStr() { return new Date().toISOString().slice(0, 10) }
function nowIso() { return new Date().toISOString() }
function uid() { return `bm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }

function normalize(r: Partial<BMAccount>): BMAccount {
  return {
    id: r.id || uid(),
    date_created: r.date_created || todayStr(),
    name: r.name || "",
    owner: r.owner || "",
    birthday: r.birthday || "",
    address: r.address || "",
    email: r.email || "",
    contact_no: r.contact_no || "",
    remarks: r.remarks || "",
    picture_name: r.picture_name || "",
    picture_data: r.picture_data || "",
    id_name: r.id_name || "",
    id_data: r.id_data || "",
    adsmanager_link: r.adsmanager_link || "",
    status: r.status || "Active",
    created_by: r.created_by || BM_CREATED_BY,
    created_date: r.created_date || nowIso(),
  }
}

function readCache(): BMAccount[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    return (JSON.parse(raw) as Partial<BMAccount>[]).map(normalize)
  } catch { return [] }
}

function writeCache(list: BMAccount[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { }
}

function toRow(a: BMAccount, businessId: string) {
  return { business_id: businessId, ...a }
}

export function useBMAccounts() {
  const [accounts, setAccounts] = useState<BMAccount[]>([])

  const refresh = useCallback(async () => {
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    const { data, error } = await supabase.from("bm_accounts").select("*").eq("business_id", businessId).order("inserted_at", { ascending: false })
    if (error) return
    if (data.length === 0) {
      // One-time migration: push this browser's existing localStorage records up.
      const cached = readCache()
      if (cached.length > 0) {
        await supabase.from("bm_accounts").insert(cached.map(a => toRow(a, businessId)))
        setAccounts(cached)
        return
      }
    }
    const list = data.map(r => normalize(r as Partial<BMAccount>))
    writeCache(list); setAccounts(list)
  }, [])

  useEffect(() => { setAccounts(readCache()); refresh() }, [refresh])

  async function addAccount(input: NewBMInput): Promise<BMAccount> {
    const rec = normalize({
      ...input,
      id: uid(),
      date_created: todayStr(),
      status: input.status || "Active",
      created_by: currentUserName() || BM_CREATED_BY,
      created_date: nowIso(),
    })
    const businessId = await getBusinessId()
    if (!businessId) return rec
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("bm_accounts").insert(toRow(rec, businessId))
    if (error) throw error
    await refresh()
    return rec
  }

  async function updateAccount(id: string, input: Partial<NewBMInput> & { status?: BMStatus }) {
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("bm_accounts").update(input).eq("id", id)
    if (error) throw error
    await refresh()
  }

  async function deleteAccount(id: string) {
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("bm_accounts").delete().eq("id", id)
    if (error) throw error
    await refresh()
  }

  // Bulk import from xlsx — returns count added
  async function importAccounts(rows: NewBMInput[]): Promise<number> {
    const by = currentUserName() || BM_CREATED_BY
    const recs = rows.map(r => normalize({
      ...r,
      id: uid(),
      date_created: todayStr(),
      created_by: by,
      created_date: nowIso(),
    }))
    if (recs.length === 0) return 0
    const businessId = await getBusinessId()
    if (!businessId) return 0
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("bm_accounts").insert(recs.map(a => toRow(a, businessId)))
    if (error) throw error
    await refresh()
    return recs.length
  }

  return { accounts, addAccount, updateAccount, deleteAccount, importAccounts }
}
