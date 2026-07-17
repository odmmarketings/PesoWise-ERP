"use client"
import { useCallback, useEffect, useState } from "react"
import { fetchRows, writeRow, deleteRowById } from "@/lib/supa-rows"

// Suppliers (Logistic & Inventory) — source of truth = Supabase `suppliers`;
// `pesowise_suppliers` localStorage is now just a same-session read cache (and is
// migrated up once on first load). Feeds the Purchase Order supplier picker.
const KEY = "pesowise_suppliers"

export const SUPPLIER_STATUSES = ["Active", "Inactive"] as const
export type SupplierStatus = typeof SUPPLIER_STATUSES[number]

export interface Supplier {
  id: string
  store_name: string          // Supplier Store Name
  name: string                // Supplier Name
  contact: string             // Supplier Contact
  address: string             // Supplier Address
  province: string
  city: string
  brgy: string
  contact_person: string
  contact_person_no: string
  url: string                 // Supplier URL (optional)
  items: string[]             // items this supplier provides (feeds the PO item picker)
  status: SupplierStatus
  remarks: string
  archived: boolean
  created_at: string
}
export type NewSupplierInput = Omit<Supplier, "id" | "created_at" | "archived">

function uid() { return `sup_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }
function normalize(r: Partial<Supplier>): Supplier {
  return {
    id: r.id || uid(),
    store_name: r.store_name || "",
    name: r.name || "",
    contact: r.contact || "",
    address: r.address || "",
    province: r.province || "",
    city: r.city || "",
    brgy: r.brgy || "",
    contact_person: r.contact_person || "",
    contact_person_no: r.contact_person_no || "",
    url: r.url || "",
    items: Array.isArray(r.items) ? r.items.filter(Boolean) : [],
    status: r.status === "Inactive" ? "Inactive" : "Active",
    remarks: r.remarks || "",
    archived: r.archived ?? false,
    created_at: r.created_at || new Date().toISOString(),
  }
}

function readCache(): Supplier[] {
  if (typeof window === "undefined") return []
  try { const raw = localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as Partial<Supplier>[]).map(normalize) : [] }
  catch { return [] }
}
function writeCache(list: Supplier[]) { try { localStorage.setItem(KEY, JSON.stringify(list)) } catch {} }
const byNewest = (a: Supplier, b: Supplier) => (b.created_at || "").localeCompare(a.created_at || "")

export function useSuppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  useEffect(() => {
    setSuppliers(readCache())
    fetchRows("suppliers", normalize, readCache, writeCache).then(list => { if (list) setSuppliers([...list].sort(byNewest)) })
  }, [])
  const persist = useCallback((next: Supplier[]) => { writeCache(next); setSuppliers(next) }, [])

  function addSupplier(input: NewSupplierInput) {
    const created = normalize({ ...input, id: uid(), created_at: new Date().toISOString() })
    persist([created, ...suppliers])
    writeRow("suppliers", created)
  }
  function updateSupplier(id: string, input: Partial<NewSupplierInput>) {
    const next = suppliers.map(s => s.id === id ? normalize({ ...s, ...input }) : s)
    persist(next)
    const row = next.find(s => s.id === id)
    if (row) writeRow("suppliers", row)
  }
  function deleteSupplier(id: string) {
    persist(suppliers.filter(s => s.id !== id))
    deleteRowById("suppliers", id)
  }
  function setArchived(id: string, archived: boolean) {
    const next = suppliers.map(s => s.id === id ? { ...s, archived } : s)
    persist(next)
    const row = next.find(s => s.id === id)
    if (row) writeRow("suppliers", row)
  }

  // Active, non-archived — used by the Purchase Order supplier picker.
  const activeSuppliers = suppliers.filter(s => s.status === "Active" && !s.archived)
  return { suppliers, activeSuppliers, addSupplier, updateSupplier, deleteSupplier, setArchived }
}
