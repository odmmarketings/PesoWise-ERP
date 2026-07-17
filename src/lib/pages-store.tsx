"use client"
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import { pagesData, type PageStore } from "./pages-data"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"
import { currentUserName } from "@/lib/current-user"

// Source of truth = Supabase `store_pages`; `pesowise_pages` localStorage is now just a
// same-session read cache (and is migrated up once on first load — ids are preserved
// because Adspent entries are keyed `${pageId}|${date}`).
const LS_KEY = "pesowise_pages"

interface PagesContextValue {
  pages: PageStore[]
  addPage: (data: Omit<PageStore, "id" | "created_at" | "archived_at" | "created_by">) => Promise<void>
  updatePage: (id: string, data: Partial<PageStore>) => Promise<void>
  deletePage: (id: string) => Promise<void>
  archivePage: (id: string) => Promise<void>
  unarchivePage: (id: string) => Promise<void>
}

const PagesContext = createContext<PagesContextValue | null>(null)

function readCache(): PageStore[] | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return JSON.parse(raw) as PageStore[]
  } catch {}
  return null
}

function writeCache(pages: PageStore[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(pages)) } catch {}
}

function toRow(p: PageStore, businessId: string) {
  return {
    id: p.id, business_id: businessId, name: p.name, description: p.description, owner: p.owner,
    platform: p.platform, page_url: p.page_url, shop_id: p.shop_id, api_key: p.api_key,
    pancake_page_id: p.pancake_page_id, sender_name: p.sender_name, status: p.status,
    created_by: p.created_by, created_at: p.created_at, archived_at: p.archived_at,
  }
}

function rowToPage(r: any): PageStore {
  return {
    id: r.id, name: r.name || "", description: r.description || "", owner: r.owner || "",
    platform: r.platform || "Facebook Ecom", page_url: r.page_url || "", shop_id: r.shop_id || "",
    api_key: r.api_key || "", pancake_page_id: r.pancake_page_id || "", sender_name: r.sender_name || "",
    status: r.status || "active", created_by: r.created_by || "", created_at: r.created_at || "",
    archived_at: r.archived_at ?? null,
  }
}

export function PagesProvider({ children }: { children: ReactNode }) {
  const [pages, setPages] = useState<PageStore[]>(pagesData)
  const [hydrated, setHydrated] = useState(false)

  const refresh = useCallback(async () => {
    const businessId = await getBusinessId()
    if (!businessId) return
    const supabase = createSupabaseBrowserClient()
    const { data, error } = await supabase.from("store_pages").select("*").eq("business_id", businessId).order("inserted_at", { ascending: true })
    if (error) return
    if (data.length === 0) {
      // One-time migration: push this browser's existing localStorage pages up
      // (real API keys / Pancake ids live here). Never seed the static dummy data.
      const cached = readCache()
      if (cached && cached.length > 0) {
        await supabase.from("store_pages").insert(cached.map(p => toRow(p, businessId)))
        setPages(cached)
        return
      }
    }
    const list = data.map(rowToPage)
    writeCache(list); setPages(list)
  }, [])

  // Cache paints instantly after mount (avoid SSR mismatch); Supabase refresh follows.
  useEffect(() => {
    setPages(readCache() ?? pagesData)
    setHydrated(true)
    refresh()
  }, [refresh])

  const addPage = useCallback(async (data: Omit<PageStore, "id" | "created_at" | "archived_at" | "created_by">) => {
    const businessId = await getBusinessId()
    if (!businessId) return
    const page: PageStore = {
      ...data,
      id: Date.now().toString(),
      created_at: new Date().toISOString().split("T")[0],
      archived_at: null,
      created_by: currentUserName() || "Admin",
    } as PageStore
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("store_pages").insert(toRow(page, businessId))
    if (error) throw error
    await refresh()
  }, [refresh])

  const updatePage = useCallback(async (id: string, data: Partial<PageStore>) => {
    const supabase = createSupabaseBrowserClient()
    const { id: _drop, ...patch } = data
    const { error } = await supabase.from("store_pages").update(patch).eq("id", id)
    if (error) throw error
    await refresh()
  }, [refresh])

  const deletePage = useCallback(async (id: string) => {
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("store_pages").delete().eq("id", id)
    if (error) throw error
    await refresh()
  }, [refresh])

  const archivePage = useCallback(async (id: string) => {
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("store_pages").update({ archived_at: new Date().toISOString() }).eq("id", id)
    if (error) throw error
    await refresh()
  }, [refresh])

  const unarchivePage = useCallback(async (id: string) => {
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("store_pages").update({ archived_at: null }).eq("id", id)
    if (error) throw error
    await refresh()
  }, [refresh])

  if (!hydrated) return null

  return (
    <PagesContext.Provider value={{ pages, addPage, updatePage, deletePage, archivePage, unarchivePage }}>
      {children}
    </PagesContext.Provider>
  )
}

export function usePages() {
  const ctx = useContext(PagesContext)
  if (!ctx) throw new Error("usePages must be inside PagesProvider")
  return ctx
}

// Convenience: active (non-archived) pages only
export function useActivePages() {
  return usePages().pages.filter(p => !p.archived_at)
}
