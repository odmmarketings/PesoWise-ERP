"use client"
import { useCallback, useEffect, useState } from "react"
import { currentUserName } from "@/lib/current-user"
import { fetchRows, writeRow, writeManyRows, deleteRowsByIds } from "@/lib/supa-rows"

// Unit Codes (Inventory) — alphanumeric codes mapped to product item(s), optionally scoped to
// specific Pancake pages. No hard delete (used codes must stay for the shipped-out scanning /
// inventory deduction flow) — codes are hidden via Archives instead, per the LHIKE notice.
// Source of truth = Supabase `unit_codes`; `pesowise_unit_codes` localStorage is now just a
// same-session read cache (and is migrated up once on first load).
const KEY = "pesowise_unit_codes"

export interface UnitCodeItem { name: string; qty: number }   // product item name + quantity per unit
export interface UnitCode {
  id: string
  sku: string
  code: string
  items: UnitCodeItem[]  // product items (name + qty) this code maps to
  pages: string[]        // Pages with Pancake API key (empty = default → visible on all pages)
  selling_price: number
  upsell: boolean        // POS code for upsell item (UPS- prefixed)
  archived: boolean
  created_at: string
  created_by: string     // PesoWise account that added the code (View → HISTORY "Added By")
}
export type NewUnitCodeInput = Omit<UnitCode, "id" | "created_at" | "archived" | "created_by">

// Auto-generated SKU: UC-<n>, based on the highest sequence already used.
export function nextUnitSKU(codes: UnitCode[]) {
  const seq = codes.reduce((m, c) => {
    const n = Number(String(c.sku).match(/UC-(\d+)\s*$/)?.[1] || 0)
    return n > m ? n : m
  }, 0) + 1
  return `UC-${seq}`
}

function uid() { return `uc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }
// Items may be legacy plain strings (old shape) or {name, qty} objects.
function normalizeItem(i: unknown): UnitCodeItem {
  if (typeof i === "string") return { name: i, qty: 1 }
  const o = (i || {}) as Partial<UnitCodeItem>
  return { name: o.name || "", qty: Number(o.qty) || 1 }
}
function normalize(r: Partial<UnitCode> & { amount?: number }): UnitCode {
  return {
    id: r.id || uid(),
    sku: r.sku || "",
    code: r.code || "",
    items: Array.isArray(r.items) ? r.items.map(normalizeItem).filter(i => i.name) : [],
    pages: Array.isArray(r.pages) ? r.pages.filter(Boolean) : [],
    selling_price: Number(r.selling_price ?? r.amount) || 0,   // legacy `amount` → selling price
    upsell: !!r.upsell,
    archived: r.archived ?? false,
    created_at: r.created_at || new Date().toISOString(),
    created_by: r.created_by || "",
  }
}

function readCache(): UnitCode[] {
  if (typeof window === "undefined") return []
  try { const raw = localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as Partial<UnitCode>[]).map(normalize) : [] }
  catch { return [] }
}
function writeCache(list: UnitCode[]) { try { localStorage.setItem(KEY, JSON.stringify(list)) } catch {} }
const byNewest = (a: UnitCode, b: UnitCode) => (b.created_at || "").localeCompare(a.created_at || "")

export function useUnitCodes() {
  const [codes, setCodes] = useState<UnitCode[]>([])
  useEffect(() => {
    setCodes(readCache())
    fetchRows("unit_codes", normalize, readCache, writeCache).then(list => { if (list) setCodes([...list].sort(byNewest)) })
  }, [])
  const persist = useCallback((next: UnitCode[]) => { writeCache(next); setCodes(next) }, [])

  function addCode(input: NewUnitCodeInput) {
    const created = normalize({ ...input, id: uid(), created_at: new Date().toISOString(), created_by: currentUserName() })
    persist([created, ...codes])
    writeRow("unit_codes", created)
  }
  function addMany(inputs: NewUnitCodeInput[]) {
    const now = new Date().toISOString()
    const by = currentUserName()
    const created = inputs.map(i => normalize({ ...i, id: uid(), created_at: now, created_by: by }))
    persist([...created, ...codes])
    writeManyRows("unit_codes", created)
  }
  function updateCode(id: string, input: Partial<NewUnitCodeInput>) {
    const next = codes.map(c => c.id === id ? normalize({ ...c, ...input }) : c)
    persist(next)
    const row = next.find(c => c.id === id)
    if (row) writeRow("unit_codes", row)
  }
  function setArchived(id: string, archived: boolean) {
    const next = codes.map(c => c.id === id ? { ...c, archived } : c)
    persist(next)
    const row = next.find(c => c.id === id)
    if (row) writeRow("unit_codes", row)
  }
  function setArchivedMany(ids: string[], archived: boolean) {
    const set = new Set(ids)
    const next = codes.map(c => set.has(c.id) ? { ...c, archived } : c)
    persist(next)
    writeManyRows("unit_codes", next.filter(c => set.has(c.id)))
  }
  // Permanent delete (PesoWise only — does NOT remove the product from Pancake POS).
  function deleteMany(ids: string[]) {
    const set = new Set(ids)
    persist(codes.filter(c => !set.has(c.id)))
    deleteRowsByIds("unit_codes", ids)
  }
  return { codes, addCode, addMany, updateCode, setArchived, setArchivedMany, deleteMany }
}
