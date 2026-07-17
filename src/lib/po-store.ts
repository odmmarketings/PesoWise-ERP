"use client"
import { useCallback, useEffect, useState } from "react"
import { currentUserName } from "@/lib/current-user"
import { fetchRows, writeRow, deleteRowById, getSettingBlob, setSettingBlob } from "@/lib/supa-rows"

// Purchase Orders (Logistic & Inventory) — source of truth = Supabase `purchase_orders`;
// `pesowise_purchase_orders` localStorage is now just a same-session read cache (and is
// migrated up once on first load). Mutations commit locally first, write in background.
// A PO carries line items; receiving/stock effects wire up when the Inventory module ships.
const KEY = "pesowise_purchase_orders"

export const PO_STATUSES = ["Draft", "For Approval", "Approved", "Paid", "Partial Delivery", "Delivered", "Cancelled"] as const
export type POStatus = typeof PO_STATUSES[number]

// Allowed status transitions (the Status dropdown on the Order view shows these).
// LHIKE flow: Draft → For Approval → Approved → Paid → (Partial) Delivery.
export const PO_NEXT_STATUS: Record<POStatus, POStatus[]> = {
  Draft: ["For Approval", "Cancelled"],
  "For Approval": ["Approved", "Draft", "Cancelled"],
  Approved: ["Paid", "Cancelled"],
  Paid: ["Partial Delivery", "Delivered", "Cancelled"],
  "Partial Delivery": ["Delivered", "Cancelled"],
  Delivered: [],
  Cancelled: ["Draft"],
}

// "Items that are beyond Paid status cannot be edited/deleted" (per the LHIKE manual).
export const poLocked = (s: POStatus) => s === "Partial Delivery" || s === "Delivered"

export interface POHistoryEntry { date: string; action: string; by: string; remarks?: string }
export interface POItem { supplier: string; name: string; qty: number; unit: string; cost: number }
export interface PurchaseOrder {
  id: string
  issue_date: string        // YYYY-MM-DD
  delivery_no: string       // auto: DN-<n>
  cust_po_no: string        // auto: CPO-<n>
  control_no: string        // auto: CN-<n>
  supplier: string          // legacy top-level supplier (superseded by per-item supplier)
  delivery_to: string
  delivery_address: string
  delivery_fee: number
  assigned_to: string[]     // up to 4 employees
  picked_up_date: string
  status: POStatus
  items: POItem[]
  remarks: string
  created_by: string
  history: POHistoryEntry[]
  created_at: string
}
export type NewPOInput = Omit<PurchaseOrder, "id" | "created_at" | "history" | "created_by"> & { created_by?: string }

export const poTotal = (po: Pick<PurchaseOrder, "items">) => po.items.reduce((s, i) => s + i.qty * i.cost, 0)

// Next auto-generated numbers (DN-n / CPO-n / CN-n) — one shared sequence, based on the
// highest numeric suffix already used so deletes never cause collisions.
export function nextPONumbers(orders: PurchaseOrder[]) {
  const seq = orders.reduce((m, o) => {
    for (const v of [o.delivery_no, o.cust_po_no, o.control_no]) {
      const n = Number(String(v).match(/(\d+)\s*$/)?.[1] || 0)
      if (n > m) m = n
    }
    return m
  }, 0) + 1
  return { delivery_no: `DN-${seq}`, cust_po_no: `CPO-${seq}`, control_no: `CN-${seq}` }
}

function uid() { return `po_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }
function normalizeItem(i: Partial<POItem>): POItem {
  return { supplier: i.supplier || "", name: i.name || "", qty: Number(i.qty) || 0, unit: i.unit || "pcs", cost: Number(i.cost) || 0 }
}
function normalize(r: Partial<PurchaseOrder>): PurchaseOrder {
  return {
    id: r.id || uid(),
    issue_date: r.issue_date || "",
    delivery_no: r.delivery_no || "",
    cust_po_no: r.cust_po_no || "",
    control_no: r.control_no || "",
    supplier: r.supplier || "",
    delivery_to: r.delivery_to || "",
    delivery_address: r.delivery_address || "",
    delivery_fee: Number(r.delivery_fee) || 0,
    assigned_to: Array.isArray(r.assigned_to) ? r.assigned_to.filter(Boolean).slice(0, 4) : [],
    picked_up_date: r.picked_up_date || "",
    status: (r.status as string) === "Ordered" ? "Approved"   // legacy status from before the LHIKE flow
      : (PO_STATUSES as readonly string[]).includes(r.status || "") ? (r.status as POStatus) : "Draft",
    items: Array.isArray(r.items) ? r.items.map(normalizeItem) : [],
    remarks: r.remarks || "",
    created_by: r.created_by || "Admin",
    history: Array.isArray(r.history) ? r.history.map(h => ({ date: h.date || "", action: h.action || "", by: h.by || "", remarks: h.remarks || "" })) : [],
    created_at: r.created_at || new Date().toISOString(),
  }
}

function readCache(): PurchaseOrder[] {
  if (typeof window === "undefined") return []
  try { const raw = localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as Partial<PurchaseOrder>[]).map(normalize) : [] }
  catch { return [] }
}
function writeCache(list: PurchaseOrder[]) { try { localStorage.setItem(KEY, JSON.stringify(list)) } catch {} }
const byNewest = (a: PurchaseOrder, b: PurchaseOrder) => (b.created_at || "").localeCompare(a.created_at || "")

export function usePurchaseOrders() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  useEffect(() => {
    setOrders(readCache())
    fetchRows("purchase_orders", normalize, readCache, writeCache).then(list => { if (list) setOrders([...list].sort(byNewest)) })
  }, [])
  const persist = useCallback((next: PurchaseOrder[]) => { writeCache(next); setOrders(next) }, [])

  function addOrder(input: NewPOInput): PurchaseOrder {
    const now = new Date().toISOString()
    const by = input.created_by || currentUserName() || "Admin"
    const created = normalize({ ...input, id: uid(), created_at: now, created_by: by, history: [{ date: now, action: "Created", by }] })
    persist([created, ...orders])
    writeRow("purchase_orders", created)
    return created
  }
  function updateOrder(id: string, input: Partial<NewPOInput>) {
    const next = orders.map(o => o.id === id ? normalize({ ...o, ...input }) : o)
    persist(next)
    const row = next.find(o => o.id === id)
    if (row) writeRow("purchase_orders", row)
  }
  // Status workflow: change status + log it to the PO's history (who / remarks / when).
  function changeStatus(id: string, status: POStatus, remarks: string, by: string) {
    const next = orders.map(o => o.id === id
      ? normalize({ ...o, status, history: [...o.history, { date: new Date().toISOString(), action: `Status changed to ${status}`, by, remarks }] })
      : o)
    persist(next)
    const row = next.find(o => o.id === id)
    if (row) writeRow("purchase_orders", row)
  }
  function deleteOrder(id: string) {
    persist(orders.filter(o => o.id !== id))
    deleteRowById("purchase_orders", id)
  }
  // Duplicate → fresh Draft dated today with the next auto-generated numbers.
  function duplicateOrder(id: string) {
    const src = orders.find(o => o.id === id); if (!src) return
    const today = new Date().toISOString().slice(0, 10)
    const copy = normalize({ ...src, id: uid(), created_at: new Date().toISOString(), issue_date: today, status: "Draft", ...nextPONumbers(orders) })
    persist([copy, ...orders])
    writeRow("purchase_orders", copy)
  }
  return { orders, addOrder, updateOrder, deleteOrder, duplicateOrder, changeStatus }
}

// ── PO Account & Bank Settings ───────────────────────────────────────────────
// Maps the two PO cost buckets (Delivery Fee / COG Fee) to Finance Settings reference data
// (Account · Bank · Type of Expense · Department) — so PO costs can post to Book Keeping.
// Stored in the shared `logistics_settings.po_settings` column; localStorage = read cache.
const SETTINGS_KEY = "pesowise_po_settings"

export interface POFeeConfig { account_id: string; bank_id: string; type_id: string; department_id: string }
export interface POSettings { delivery: POFeeConfig; cog: POFeeConfig }

const emptyFee = (): POFeeConfig => ({ account_id: "", bank_id: "", type_id: "", department_id: "" })
const normalizeFee = (f?: Partial<POFeeConfig>): POFeeConfig => ({ ...emptyFee(), ...(f || {}) })
const normalizeSettings = (p: any): POSettings => ({ delivery: normalizeFee(p?.delivery), cog: normalizeFee(p?.cog) })

export function usePOSettings() {
  const [settings, setSettings] = useState<POSettings>({ delivery: emptyFee(), cog: emptyFee() })
  useEffect(() => {
    let cached: POSettings | null = null
    try { const raw = localStorage.getItem(SETTINGS_KEY); if (raw) cached = normalizeSettings(JSON.parse(raw)) } catch {}
    if (cached) setSettings(cached)
    ;(async () => {
      const remote = await getSettingBlob<Partial<POSettings>>("logistics_settings", "po_settings")
      if (remote && Object.keys(remote).length > 0) {
        const s = normalizeSettings(remote)
        setSettings(s)
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch {}
      } else if (cached) {
        setSettingBlob("logistics_settings", "po_settings", cached)   // one-time migration
      }
    })()
  }, [])
  const save = useCallback((next: POSettings) => {
    setSettings(next)
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)) } catch {}
    setSettingBlob("logistics_settings", "po_settings", next)
  }, [])
  return { settings, save }
}
