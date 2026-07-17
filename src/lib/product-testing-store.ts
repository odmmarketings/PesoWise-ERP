"use client"
import { useCallback, useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"
import { currentUserName } from "@/lib/current-user"
import { getEcomSetting, setEcomSetting } from "@/lib/ecom-settings"

// ──────────────────────────────────────────────────────────────────────────────
// E-Commerce → Product Testing (LHIKE ERP manual). A request list of products being
// tested, each with creatives (name + links), COG/SRP + computed COG%, status/verdict,
// archive/unarchive, and Collections. Source of truth = Supabase `product_tests` (one
// row per product; creatives/approvals/history as JSONB) + `ecommerce_settings.
// pt_collections`. localStorage is now just a same-session read cache (and is migrated
// up once on first load). Mutations update local state optimistically, then persist.
// ──────────────────────────────────────────────────────────────────────────────

export type PTStatus = "Pending" | "Testing" | "Completed"
export type PTVerdict = "Pending" | "Winning" | "Losing" | "Kill"

export const PT_STATUSES: PTStatus[] = ["Pending", "Testing", "Completed"]
export const PT_VERDICTS: PTVerdict[] = ["Pending", "Winning", "Losing", "Kill"]
export const PT_PLATFORMS = ["Facebook Ecom", "Instagram", "TikTok", "Shopee", "Lazada"]

export interface Creative { id: string; name: string; links: string[] }
export interface PTHistory { action: string; by: string; date: string; note?: string }

// Two-level admin approval for an item request (Level 1 + Level 2).
export type ApprovalStatus = "Pending" | "Approved" | "Declined"
export interface ApprovalState { approver: string; status: ApprovalStatus; date: string; remarks: string }
const emptyApproval = (): ApprovalState => ({ approver: "", status: "Pending", date: "", remarks: "" })

function nowStamp(): string {
  const d = new Date(); const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export interface ProductTest {
  id: string
  rdp_control_no: string    // auto "RDP-{year}-{seq}"
  collection: string
  name: string
  product_name_description: string
  product_image: string
  generic_product_name: string
  generic_product_image: string
  description: string       // Product Description
  quantity_per_pack: number
  product_form: string
  other_specs: string       // Other Product Specifications
  srp: number               // SRP for 1pc
  cog: number
  cog_percent: number       // (cog / srp) × 100
  pages: string
  platform: string
  status: PTStatus
  verdict: PTVerdict
  creatives: Creative[]
  archived: boolean
  delete_status: "none" | "pending"   // "pending" = delete requested, awaiting admin approval
  delete_reason: string
  delete_remarks: string              // admin remarks on approve/decline
  approvals: { level1: ApprovalState; level2: ApprovalState }
  added_by: string
  added_date: string        // ISO
  last_edit_by: string
  last_edit_date: string    // ISO
  history: PTHistory[]
}

export const PT_ADDED_BY = "Admin User" // fallback only — real records stamp currentUserName()

export interface NewProductInput {
  rdp_control_no: string; collection: string; name: string; product_name_description: string; product_image: string
  generic_product_name: string; generic_product_image: string; description: string; quantity_per_pack: number
  product_form: string; other_specs: string; srp: number; cog: number; cog_percent: number
  pages: string; platform: string; status: PTStatus; verdict: PTVerdict; creatives: Creative[]
}

// Next RDP Control Number "RDP-{year}-{seq}" for the add form.
export function peekNextRdp(products: ProductTest[]): string {
  const year = new Date().getFullYear()
  const prefix = `RDP-${year}-`
  return `${prefix}${products.filter(p => String(p?.rdp_control_no || "").startsWith(prefix)).length + 1}`
}

export function cogPercent(cog: number, srp: number): number {
  if (!(srp > 0)) return 0
  return Math.round((cog / srp) * 10000) / 100   // 2-decimal %
}

const KEY = "pesowise_product_testing"
const uid = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

interface Store { products: ProductTest[]; collections: string[] }

function normalizeProduct(p: any, i = 0): ProductTest {
  return {
    id: p?.id || `pt-legacy-${i}`, rdp_control_no: p?.rdp_control_no || `RDP-${new Date().getFullYear()}-${i + 1}`,
    collection: p?.collection || "", name: p?.name || "", product_name_description: p?.product_name_description || "",
    product_image: p?.product_image || "", generic_product_name: p?.generic_product_name || "", generic_product_image: p?.generic_product_image || "",
    description: p?.description || "", quantity_per_pack: Number(p?.quantity_per_pack) || 1, product_form: p?.product_form || "", other_specs: p?.other_specs || "",
    srp: Number(p?.srp) || 0, cog: Number(p?.cog) || 0, cog_percent: Number(p?.cog_percent) || 0,
    pages: p?.pages || "", platform: p?.platform || "",
    status: PT_STATUSES.includes(p?.status) ? p.status : "Pending",
    verdict: PT_VERDICTS.includes(p?.verdict) ? p.verdict : "Pending",
    creatives: Array.isArray(p?.creatives) ? p.creatives.map((c: any, j: number) => ({ id: c?.id || `cr-${j}`, name: c?.name || "", links: Array.isArray(c?.links) ? c.links : [] })) : [],
    archived: !!p?.archived,
    delete_status: p?.delete_status === "pending" ? "pending" : "none", delete_reason: p?.delete_reason || "", delete_remarks: p?.delete_remarks || "",
    approvals: {
      level1: { approver: p?.approvals?.level1?.approver || "", status: p?.approvals?.level1?.status || "Pending", date: p?.approvals?.level1?.date || "", remarks: p?.approvals?.level1?.remarks || "" },
      level2: { approver: p?.approvals?.level2?.approver || "", status: p?.approvals?.level2?.status || "Pending", date: p?.approvals?.level2?.date || "", remarks: p?.approvals?.level2?.remarks || "" },
    },
    added_by: p?.added_by || PT_ADDED_BY, added_date: p?.added_date || new Date().toISOString(),
    last_edit_by: p?.last_edit_by || p?.added_by || PT_ADDED_BY, last_edit_date: p?.last_edit_date || p?.added_date || new Date().toISOString(),
    history: Array.isArray(p?.history) ? p.history : [],
  }
}

function normalize(s: any): Store {
  const products: ProductTest[] = (Array.isArray(s?.products) ? s.products : []).map((p: any, i: number) => normalizeProduct(p, i))
  const collections: string[] = Array.isArray(s?.collections) ? s.collections.filter(Boolean) : []
  return { products, collections }
}

function readCache(): Store {
  try { const raw = localStorage.getItem(KEY); return raw ? normalize(JSON.parse(raw)) : { products: [], collections: [] } }
  catch { return { products: [], collections: [] } }
}
function writeCache(s: Store) { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch {} }

function toRow(p: ProductTest, businessId: string) {
  return { business_id: businessId, ...p }
}

export function useProductTesting() {
  const [store, setStore] = useState<Store>({ products: [], collections: [] })
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setStore(readCache())
    ;(async () => {
      const businessId = await getBusinessId()
      if (!businessId) { setLoaded(true); return }
      const supabase = createSupabaseBrowserClient()
      const [{ data, error }, remoteCollections] = await Promise.all([
        supabase.from("product_tests").select("*").eq("business_id", businessId).order("inserted_at", { ascending: false }),
        getEcomSetting<string[]>("pt_collections"),
      ])
      if (error) { setLoaded(true); return }
      if (data.length === 0) {
        // One-time migration: push this browser's existing localStorage products up.
        const cached = readCache()
        if (cached.products.length > 0) {
          await supabase.from("product_tests").insert(cached.products.map(p => toRow(p, businessId)))
          if (cached.collections.length > 0 && (!remoteCollections || remoteCollections.length === 0)) {
            await setEcomSetting("pt_collections", cached.collections)
          }
          setStore(cached); setLoaded(true)
          return
        }
      }
      const next: Store = {
        products: data.map((r: any) => normalizeProduct(r)),
        collections: Array.isArray(remoteCollections) ? remoteCollections.filter(Boolean) : [],
      }
      writeCache(next); setStore(next); setLoaded(true)
    })()
  }, [])

  // Optimistic local commit (state + cache), shared by every mutation.
  const commitLocal = useCallback((next: Store) => { setStore(next); writeCache(next) }, [])

  const persistCollections = useCallback(async (collections: string[]) => {
    await setEcomSetting("pt_collections", collections)
  }, [])

  const addProduct = useCallback(async (input: NewProductInput) => {
    const now = new Date().toISOString()
    const by = currentUserName() || PT_ADDED_BY
    const product: ProductTest = {
      id: uid("pt"), ...input, archived: false, delete_status: "none", delete_reason: "", delete_remarks: "",
      approvals: { level1: emptyApproval(), level2: emptyApproval() },
      added_by: by, added_date: now, last_edit_by: by, last_edit_date: now,
      history: [{ action: "Created", by, date: now }],
    }
    const collections = input.collection && !store.collections.includes(input.collection)
      ? [...store.collections, input.collection] : store.collections
    commitLocal({ products: [product, ...store.products], collections })
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    await supabase.from("product_tests").insert(toRow(product, businessId))
    if (collections !== store.collections) await persistCollections(collections)
  }, [store, commitLocal, persistCollections])

  const updateProduct = useCallback(async (id: string, patch: Partial<NewProductInput>) => {
    const now = new Date().toISOString()
    const by = currentUserName() || PT_ADDED_BY
    const current = store.products.find(p => p.id === id)
    if (!current) return
    const updated: ProductTest = { ...current, ...patch, last_edit_by: by, last_edit_date: now, history: [...current.history, { action: "Edited", by, date: now }] }
    const collections = patch.collection && !store.collections.includes(patch.collection) ? [...store.collections, patch.collection] : store.collections
    commitLocal({ products: store.products.map(p => p.id === id ? updated : p), collections })
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    await supabase.from("product_tests").upsert(toRow(updated, businessId))
    if (collections !== store.collections) await persistCollections(collections)
  }, [store, commitLocal, persistCollections])

  const setArchived = useCallback(async (id: string, archived: boolean) => {
    const now = new Date().toISOString()
    const by = currentUserName() || PT_ADDED_BY
    const current = store.products.find(p => p.id === id)
    if (!current) return
    const updated: ProductTest = { ...current, archived, history: [...current.history, { action: archived ? "Archived" : "Moved to Requests", by, date: now }] }
    commitLocal({ ...store, products: store.products.map(p => p.id === id ? updated : p) })
    const supabase = createSupabaseBrowserClient()
    await supabase.from("product_tests").update({ archived, history: updated.history }).eq("id", id)
  }, [store, commitLocal])

  const addCollection = useCallback(async (name: string) => {
    const n = name.trim()
    if (!n || store.collections.includes(n)) return
    const collections = [...store.collections, n]
    commitLocal({ ...store, collections })
    await persistCollections(collections)
  }, [store, commitLocal, persistCollections])

  // Delete-request workflow (request → admin Approve = remove / Decline = keep), like Book Keeping.
  const requestDelete = useCallback(async (id: string, reason: string) => {
    const now = new Date().toISOString()
    const by = currentUserName() || PT_ADDED_BY
    const current = store.products.find(p => p.id === id)
    if (!current) return
    const updated: ProductTest = { ...current, delete_status: "pending", delete_reason: reason, history: [...current.history, { action: "Requested Delete", by, date: now, note: reason }] }
    commitLocal({ ...store, products: store.products.map(p => p.id === id ? updated : p) })
    const supabase = createSupabaseBrowserClient()
    await supabase.from("product_tests").update({ delete_status: "pending", delete_reason: reason, history: updated.history }).eq("id", id)
  }, [store, commitLocal])

  const approveDelete = useCallback(async (id: string) => {
    commitLocal({ ...store, products: store.products.filter(p => p.id !== id) })   // approved → actually removed
    const supabase = createSupabaseBrowserClient()
    await supabase.from("product_tests").delete().eq("id", id)
  }, [store, commitLocal])

  const declineDelete = useCallback(async (id: string, remarks: string) => {
    const now = new Date().toISOString()
    const by = currentUserName() || PT_ADDED_BY
    const current = store.products.find(p => p.id === id)
    if (!current) return
    const updated: ProductTest = { ...current, delete_status: "none", delete_remarks: remarks, history: [...current.history, { action: "Delete Declined", by, date: now, note: remarks }] }
    commitLocal({ ...store, products: store.products.map(p => p.id === id ? updated : p) })
    const supabase = createSupabaseBrowserClient()
    await supabase.from("product_tests").update({ delete_status: "none", delete_remarks: remarks, history: updated.history }).eq("id", id)
  }, [store, commitLocal])

  // Two-level approval — Approve / Decline a level.
  const setApproval = useCallback(async (id: string, level: 1 | 2, status: ApprovalStatus, remarks: string) => {
    const by = currentUserName() || PT_ADDED_BY
    const key = level === 1 ? "level1" : "level2"
    const current = store.products.find(p => p.id === id)
    if (!current) return
    const approvals = { ...current.approvals, [key]: { approver: by, status, date: nowStamp(), remarks } }
    const history = [...current.history, { action: `Level ${level} ${status}`, by, date: new Date().toISOString(), note: remarks }]
    const updated: ProductTest = { ...current, approvals, history }
    commitLocal({ ...store, products: store.products.map(p => p.id === id ? updated : p) })
    const supabase = createSupabaseBrowserClient()
    await supabase.from("product_tests").update({ approvals, history }).eq("id", id)
  }, [store, commitLocal])

  return {
    products: store.products, collections: store.collections, loaded,
    addProduct, updateProduct, setArchived, addCollection,
    requestDelete, approveDelete, declineDelete, setApproval,
  }
}
