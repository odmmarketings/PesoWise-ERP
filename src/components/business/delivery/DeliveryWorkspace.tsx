"use client"
import { useEffect, useMemo, useState } from "react"
import {
  RefreshCw, Search, X, Check, ChevronDown, ChevronLeft, ChevronRight,
  User, Users, Flag, Zap, ArrowLeftRight, AlertTriangle, Trash2, type LucideIcon,
} from "lucide-react"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import { useActivePages } from "@/lib/pages-store"
import { cachedJson, PANCAKE_CONCURRENCY } from "@/lib/pancake-cache"
import { currentUserEmail } from "@/lib/current-user"
import { useDeliveryTeam, resolveDeliveryRole, type DeliveryAgent } from "@/lib/delivery-team-store"
import {
  useDeliveryOrders, planAutoAssign, fetchOrderActivity, stampNow, todayStr,
  AGENT_STATUS_BADGE, TERMINAL_STATUSES,
  type AssignmentType, type AgentStatus, type DeliveryOrder, type SnapshotInput, type DeliveryActivity,
} from "@/lib/delivery-store"

// ──────────────────────────────────────────────────────────────────────────────
// DELIVERY / PROBLEMATIC working table — ang Fulfillment-style workspace ng
// delivery team. Live Pancake rows (read-only truth) + delivery_orders (assignment
// at agent working state). Agents ay nakikita LANG ang sarili nilang assignments;
// Admin/Supervisor ang nag-a-assign (manual o auto) at nakakakita ng lahat.
// Isang component, dalawang queue: delivering at problematic (QueueConfig).
// ──────────────────────────────────────────────────────────────────────────────

export type QueueConfig = {
  type: AssignmentType
  title: string
  icon: LucideIcon
  /** Aling live parcel statuses ang pasok sa Unassigned pool ng queue na ito. */
  eligibleParcelStatuses: string[]
  agentStatuses: AgentStatus[]
}

const peso = (n: number) => "₱" + (isFinite(n) ? n : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const INP = "w-full h-8 rounded border border-slate-300 px-2 text-xs bg-white focus:outline-none focus:border-blue-400"
const nfmt = (n: number) => n.toLocaleString("en-PH")

const PARCEL_STATUS_OPTIONS = [
  "Shipped Out", "Picked Up", "In-Transit", "Out for Delivery",
  "Delivered", "Returning", "Returned", "Problematic", "Not Available",
]
const PARCEL_BADGE: Record<string, string> = {
  "Shipped Out": "bg-orange-50 text-orange-700",
  "Picked Up": "bg-indigo-50 text-indigo-700",
  "In-Transit": "bg-sky-50 text-sky-700",
  "Out for Delivery": "bg-blue-50 text-blue-700",
  "Delivered": "bg-emerald-50 text-emerald-700",
  "Returning": "bg-amber-50 text-amber-700",
  "Returned": "bg-rose-50 text-rose-700",
  "Problematic": "bg-red-50 text-red-700",
  "Not Available": "bg-slate-100 text-slate-500",
}

async function fetchPageRows(apiKey: string, pageId: string, from: string, to: string, noCache = false): Promise<any[]> {
  const json = await cachedJson(
    `/api/pancake/orders?api_key=${encodeURIComponent(apiKey)}&page_id=${encodeURIComponent(pageId)}`
    + `&from=${from}&to=${to}&phase=rows&basis=sales_order${noCache ? "&nocache=1" : ""}`,
    { force: noCache }
  )
  return Array.isArray(json.rows) ? json.rows : []
}
async function mapLimit<T>(items: T[], limit: number, fn: (i: T) => Promise<void>) {
  let i = 0; await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) await fn(items[i++]) }))
}

/** Pinagsamang row: live Pancake data (kung nasa fetch window) + delivery record. */
type WsRow = { id: string; live: any | null; rec: DeliveryOrder | null }

const liveStatus = (w: WsRow) => w.live?.parcel_status || w.rec?.parcel_status_snapshot || ""
const rowAmount = (w: WsRow) => Number(w.live?.final_price ?? w.rec?.amount ?? 0)

function toSnapshot(live: any): SnapshotInput {
  return {
    order_id: String(live.id),
    customer_name: live.customer_name || "", phone: live.contact_no || "",
    address: live.address || "", province: live.province || "", city: live.city || "",
    courier: live.courier || "", page_name: live.page_name || "",
    amount: Number(live.final_price || 0), tracking_no: live.tracking_no || "",
    order_date: live.date_added || "", parcel_status: live.parcel_status || "",
  }
}

// Column registry — key, chip label, reader, filter widget (fulfillment idiom).
type ColDef = { k: string; l: string; kind: "date" | "text" | "select" | "money"; get: (w: WsRow) => string | number }
const COLS: ColDef[] = [
  { k: "order_date", l: "Order Date", kind: "date", get: w => w.rec?.order_date || w.live?.date_added || "" },
  { k: "page", l: "Page", kind: "select", get: w => w.rec?.page_name || w.live?.page_name || "" },
  { k: "customer", l: "Customer Name", kind: "text", get: w => w.rec?.customer_name || w.live?.customer_name || "" },
  { k: "phone", l: "Phone", kind: "text", get: w => w.rec?.phone || w.live?.contact_no || "" },
  { k: "location", l: "Location", kind: "text", get: w => [w.rec?.province || w.live?.province, w.rec?.city || w.live?.city].filter(Boolean).join(", ") },
  { k: "order", l: "Order", kind: "text", get: w => w.live?.order_item || "" },
  { k: "amount", l: "Amount", kind: "money", get: w => rowAmount(w) },
  { k: "courier", l: "Courier", kind: "select", get: w => w.live?.courier || w.rec?.courier || "" },
  { k: "tracking", l: "Tracking Number", kind: "text", get: w => w.live?.tracking_no || w.rec?.tracking_no || "" },
  { k: "delivery_status", l: "Delivery Status", kind: "select", get: w => liveStatus(w) },
  { k: "agent_status", l: "Agent Status", kind: "select", get: w => w.rec?.agent_status || "" },
  { k: "last_contact", l: "Last Contact", kind: "text", get: w => w.rec?.last_contact_at || "" },
  { k: "attempts", l: "Call Attempts", kind: "text", get: w => w.rec ? String(w.rec.call_attempts || 0) : "" },
  { k: "follow_up", l: "Next Follow-Up", kind: "date", get: w => w.rec?.next_follow_up || "" },
  { k: "notes", l: "Notes", kind: "text", get: w => w.rec?.notes || "" },
  { k: "agent", l: "Assigned Agent", kind: "select", get: w => w.rec?.assigned_to_name || w.rec?.assigned_to_email || "" },
  { k: "assigned_date", l: "Assigned Date", kind: "date", get: w => w.rec?.assigned_date || "" },
  { k: "last_updated", l: "Last Updated", kind: "text", get: w => w.rec?.updated_by ? `${w.rec.updated_by} · ${String(w.rec.updated_at).slice(0, 16).replace("T", " ")}` : "" },
]
const DEFAULT_ON = ["order_date", "page", "customer", "phone", "courier", "amount", "delivery_status", "agent_status", "agent", "last_contact", "follow_up"]

const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

export function DeliveryWorkspace({ config }: { config: QueueConfig }) {
  const activePages = useActivePages()
  const pagesWithCreds = useMemo(() => activePages.filter(p => p.api_key && (p.pancake_page_id || p.shop_id)), [activePages])
  const store = useDeliveryOrders()
  const teamStore = useDeliveryTeam()
  const me = currentUserEmail().toLowerCase()
  const role = resolveDeliveryRole(currentUserEmail(), teamStore.team)
  const canManage = role === "admin" || role === "supervisor"
  const isAgent = role === "agent"
  const Icon = config.icon

  const [liveRows, setLiveRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [loadErr, setLoadErr] = useState("")
  const [lane, setLane] = useState<"assigned" | "unassigned">("assigned")
  const [visible, setVisible] = useState<Set<string>>(new Set(DEFAULT_ON))
  const [draft, setDraft] = useState<Record<string, { a: string; b: string }>>({})
  const [applied, setApplied] = useState<Record<string, { a: string; b: string }>>({})
  const [perPage, setPerPage] = useState(100)
  const [page, setPage] = useState(1)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState("")
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500) }
  const [viewRow, setViewRow] = useState<WsRow | null>(null)
  const [assignRows, setAssignRows] = useState<WsRow[] | null>(null)   // manual assign / reassign
  const [autoOpen, setAutoOpen] = useState(false)

  // Mga record ng queue na ito (delivering o problematic).
  const queueRecs = useMemo(
    () => Object.values(store.orders).filter(o => o.assignment_type === config.type),
    [store.orders, config.type])

  // ── Live fetch window: union ng date filter at pinakalumang assigned order,
  //    naka-clamp sa 60 araw — para hindi nawawala ang assigned rows kapag lumipat
  //    na ang Pancake window. Blank = current month (PH).
  const pagesKey = pagesWithCreds.map(p => `${p.api_key}~${p.pancake_page_id || p.shop_id}~${p.name}`).join("|")
  const fetchWindow = (() => {
    const now = new Date()
    const monthStart = fmt(new Date(now.getFullYear(), now.getMonth(), 1))
    const today = fmt(now)
    const f = applied.order_date || { a: "", b: "" }
    let from = f.a || f.b || monthStart
    const to = f.b || today
    const oldest = queueRecs.reduce((m, r) => (r.order_date && r.order_date < m ? r.order_date : m), from)
    const clamp = fmt(new Date(now.getTime() - 60 * 86400_000))
    from = oldest < clamp ? clamp : oldest
    return { from, to }
  })()
  const rangeKey = `${fetchWindow.from}|${fetchWindow.to}`

  async function load(noCache = false) {
    if (pagesWithCreds.length === 0) { setLiveRows([]); return }
    setLoading(true); setLoadErr("")
    const out: any[] = []
    const errs: string[] = []
    await mapLimit(pagesWithCreds, PANCAKE_CONCURRENCY, async p => {
      try {
        const rs = await fetchPageRows(p.api_key, p.pancake_page_id || p.shop_id, fetchWindow.from, fetchWindow.to, noCache)
        for (const r of rs) out.push({ ...r, page_name: p.name })
      } catch (e: any) { errs.push(`${p.name}: ${e?.message || "failed"}`) }
    })
    setLiveRows(out); setLoading(false)
    if (errs.length) setLoadErr(errs.join(" · "))
  }
  useEffect(() => { load() }, [pagesKey, rangeKey])   // eslint-disable-line react-hooks/exhaustive-deps

  const liveById = useMemo(() => {
    const m = new Map<string, any>()
    for (const r of liveRows) m.set(String(r.id), r)
    return m
  }, [liveRows])

  // ── Lane rows ───────────────────────────────────────────────────────────────
  const assignedRows = useMemo<WsRow[]>(() => {
    let recs = queueRecs
    if (isAgent) recs = recs.filter(r => r.assigned_to_email === me)
    return recs
      .map(rec => ({ id: rec.order_id, live: liveById.get(rec.order_id) || null, rec }))
      .sort((a, b) => String(b.rec?.assigned_at || "").localeCompare(String(a.rec?.assigned_at || "")))
  }, [queueRecs, liveById, isAgent, me])

  const unassignedRows = useMemo<WsRow[]>(() => {
    if (isAgent) return []
    return liveRows
      .filter(r => config.eligibleParcelStatuses.includes(r.parcel_status) && !store.orders[String(r.id)])
      .map(r => ({ id: String(r.id), live: r, rec: null }))
      .sort((a, b) => String(b.live.date_added).localeCompare(String(a.live.date_added)))
  }, [liveRows, store.orders, config.eligibleParcelStatuses, isAgent])

  const laneRows = lane === "assigned" ? assignedRows : unassignedRows

  // Bilang ng open (non-terminal) na assignment kada agent sa queue na ito —
  // ipinapakita sa assign modals at ginagamit ng least-loaded auto-assign.
  const openLoads = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of queueRecs) {
      if (TERMINAL_STATUSES.includes(r.agent_status)) continue
      const e = r.assigned_to_email.toLowerCase()
      if (e) m[e] = (m[e] || 0) + 1
    }
    return m
  }, [queueRecs])

  // ── Filters (fulfillment machinery) ─────────────────────────────────────────
  const colBy = (k: string) => COLS.find(c => c.k === k)!
  const cellVal = (w: WsRow, k: string) => colBy(k).get(w)
  const optsFor = (k: string) => {
    if (k === "delivery_status") return PARCEL_STATUS_OPTIONS
    if (k === "agent_status") return config.agentStatuses as string[]
    if (k === "agent") return teamStore.team.map(t => t.name || t.email)
    return Array.from(new Set(laneRows.map(w => String(cellVal(w, k))).filter(Boolean))).sort()
  }
  const setF = (k: string, part: "a" | "b", v: string) => setDraft(d => ({ ...d, [k]: { a: part === "a" ? v : (d[k]?.a || ""), b: part === "b" ? v : (d[k]?.b || "") } }))
  const applyFilters = () => { setApplied(draft); setPage(1) }
  const applyDateCol = (k: string) => (a: string, b: string) => {
    setDraft(d => ({ ...d, [k]: { a, b } }))
    setApplied(ap => ({ ...ap, [k]: { a, b } }))
    setPage(1)
  }
  const activeFilters = useMemo(() => Object.values(applied).filter(f => f?.a || f?.b).length, [applied])
  const hasFilters = activeFilters > 0 || Object.values(draft).some(f => f?.a || f?.b)
  const clearFilters = () => { setDraft({}); setApplied({}); setPage(1) }

  const filtered = useMemo(() => laneRows.filter(w => {
    for (const [k, f] of Object.entries(applied)) {
      if (!f.a && !f.b) continue
      const col = colBy(k)
      const v = String(col.get(w))
      if (col.kind === "date") {
        if (f.a && v < f.a) return false
        if (f.b && v > f.b) return false
      } else if (col.kind === "select") {
        if (f.a && f.a !== "All" && v !== f.a) return false
      } else if (f.a && !v.toLowerCase().includes(f.a.toLowerCase())) return false
    }
    return true
  }), [laneRows, applied])   // eslint-disable-line react-hooks/exhaustive-deps

  const totalAmount = useMemo(() => filtered.reduce((s, w) => s + rowAmount(w), 0), [filtered])
  const pages = Math.max(1, Math.ceil(filtered.length / perPage))
  const pageSafe = Math.min(page, pages)
  const paginated = filtered.slice((pageSafe - 1) * perPage, pageSafe * perPage)
  const showFrom = filtered.length === 0 ? 0 : (pageSafe - 1) * perPage + 1
  const showTo = Math.min(pageSafe * perPage, filtered.length)
  const visCols = COLS.filter(c => visible.has(c.k))
  const selRows = filtered.filter(w => sel.has(w.id))
  const pageAllSel = paginated.length > 0 && paginated.every(w => sel.has(w.id))
  const pageSomeSel = paginated.some(w => sel.has(w.id))
  const allFilteredSel = filtered.length > 0 && selRows.length === filtered.length

  // ── Actions ─────────────────────────────────────────────────────────────────
  const doAssign = async (rows: WsRow[], agent: DeliveryAgent) => {
    if (rows[0]?.rec) {
      await store.reassign(rows.map(w => w.id), { email: agent.email, name: agent.name })
      flash(`${rows.length} order${rows.length === 1 ? "" : "s"} reassigned to ${agent.name || agent.email}.`)
    } else {
      const res = await store.assignOrders(rows.map(w => toSnapshot(w.live)), { email: agent.email, name: agent.name }, config.type)
      flash(`${res.inserted} assigned to ${agent.name || agent.email}${res.skipped ? ` · ${res.skipped} skipped (already assigned)` : ""}.`)
    }
    setSel(new Set())
  }

  const doMoveQueue = async () => {
    const other: AssignmentType = config.type === "delivering" ? "problematic" : "delivering"
    const ids = selRows.filter(w => w.rec).map(w => w.id)
    await store.moveToQueue(ids, other)
    setSel(new Set())
    flash(`${ids.length} order${ids.length === 1 ? "" : "s"} moved to ${other === "problematic" ? "Problematic / RTS" : "Delivery"} queue.`)
  }

  const doUnassign = async () => {
    const ids = selRows.filter(w => w.rec).map(w => w.id)
    if (!confirm(`Remove ${ids.length} order(s) from the queue? Mawawala ang agent working state nila.`)) return
    await store.unassignOrders(ids)
    setSel(new Set())
    flash(`${ids.length} order${ids.length === 1 ? "" : "s"} removed from the queue.`)
  }

  const toastEl = toast ? (
    <div className="fixed top-4 right-4 z-[80] bg-emerald-600 text-white text-sm rounded-xl px-5 py-3 shadow-lg flex items-center gap-2">
      <Check className="w-4 h-4" /> <div><p className="font-semibold">Success</p><p className="text-emerald-100">{toast}</p></div>
    </div>
  ) : null

  // 🔍 full-page detail (fulfillment ViewOrderScreen idiom — early return, hindi modal).
  if (viewRow) {
    const fresh: WsRow = { ...viewRow, rec: store.orders[viewRow.id] || viewRow.rec }
    return (
      <>
        {toastEl}
        <ViewDeliveryScreen row={fresh} config={config}
          canEdit={canManage || (isAgent && fresh.rec?.assigned_to_email === me)}
          onBack={() => setViewRow(null)}
          onSave={async (patch, expected) => {
            const res = await store.saveAgentStatus(viewRow.id, patch, expected)
            if (res.ok) flash("Agent status updated.")
            return res
          }} />
      </>
    )
  }

  return (
    <div className="space-y-4 relative">
      {toastEl}

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2 pb-4 border-b border-slate-100">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-extrabold text-blue-600 tracking-wide">
              <Icon className="w-6 h-6" /> {config.title.toUpperCase()}
            </h1>
            <p className="text-[11px] text-slate-400 mt-0.5">
              your role: <span className="font-semibold uppercase">{role}</span>
              {isAgent && " · assigned to you only"}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => load(true)} title="Refresh from Pancake"
              className="h-10 w-10 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 flex items-center justify-center shrink-0">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            {canManage && lane === "unassigned" && (
              <button onClick={() => { if (selRows.length === 0) { flash("⚠ Select orders first (checkboxes)."); return } setAutoOpen(true) }}
                className="h-10 px-4 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold flex items-center gap-1.5">
                <Zap className="w-4 h-4" /> Auto-Assign{selRows.length ? ` (${selRows.length})` : ""}
              </button>
            )}
          </div>
        </div>

        {role === "viewer" && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Wala ka sa delivery team roster — read-only view. Ask an admin to add you in Delivery Ops → Settings.
          </div>
        )}

        {/* Lane toggle (admin/supervisor lang ang may Unassigned pool) */}
        {!isAgent && (
          <div className="flex items-center gap-2 mt-4">
            {([["assigned", `Assigned (${nfmt(assignedRows.length)})`], ["unassigned", `Unassigned (${nfmt(unassignedRows.length)})`]] as const).map(([k, label]) => (
              <button key={k} onClick={() => { setLane(k); setSel(new Set()); setPage(1) }}
                className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold ${lane === k ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100 border border-slate-200"}`}>
                {label}
              </button>
            ))}
            {lane === "unassigned" && (
              <span className="text-[11px] text-slate-400">
                = live {config.eligibleParcelStatuses.join(" / ")} orders na hindi pa naka-assign
              </span>
            )}
          </div>
        )}

        {/* Toggle columns */}
        <div className="pt-4">
          <p className="text-sm text-slate-700 mb-2"><strong>Toggle column:</strong> <span className="text-slate-400 italic text-xs">Click to hide or show column</span></p>
          <div className="flex flex-wrap gap-1.5">
            {COLS.map(c => (
              <button key={c.k} onClick={() => setVisible(v => { const n = new Set(v); if (n.has(c.k)) n.delete(c.k); else n.add(c.k); return n })}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium border ${visible.has(c.k) ? "bg-teal-500 border-teal-500 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
                {c.l}
              </button>
            ))}
          </div>
        </div>

        {/* records selector + clear filters */}
        <div className="flex items-center justify-between flex-wrap gap-2 mt-4">
          <label className="flex items-center gap-2 text-sm text-slate-500">
            <select className="h-9 rounded-lg border border-slate-300 px-2 text-sm bg-white" value={perPage} onChange={e => { setPerPage(parseInt(e.target.value)); setPage(1) }}>
              {[100, 200, 500, 1000].map(n => <option key={n} value={n}>{n}</option>)}
            </select> records
          </label>
          {hasFilters && (
            <button onClick={clearFilters} title="Clear every filter"
              className="h-9 px-3 rounded-lg border border-rose-200 bg-rose-50 text-sm font-medium text-rose-600 hover:bg-rose-100 flex items-center gap-1.5">
              <X className="w-3.5 h-3.5" /> Clear filter{activeFilters > 0 ? ` (${activeFilters})` : ""}
            </button>
          )}
        </div>

        {loadErr && <p className="text-xs text-rose-500 mt-2">⚠ {loadErr}</p>}
        {pagesWithCreds.length === 0 && <p className="text-sm text-slate-400 mt-3">No connected Pancake pages — add API keys in Pages &amp; Store first.</p>}

        {/* Selection bar */}
        {sel.size > 0 && canManage && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
            <span className="font-semibold text-blue-700">{nfmt(sel.size)} {sel.size === 1 ? "order" : "orders"} selected</span>
            {allFilteredSel ? (
              <span className="text-blue-600">— all {nfmt(filtered.length)} in this filter.</span>
            ) : pageAllSel && filtered.length > paginated.length ? (
              <>
                <span className="text-slate-500">— this page only.</span>
                <button onClick={() => setSel(new Set(filtered.map(w => w.id)))}
                  className="font-semibold text-blue-600 underline underline-offset-2 hover:text-blue-800">
                  Select all {nfmt(filtered.length)}
                </button>
              </>
            ) : null}
            <button onClick={() => setAssignRows(selRows)}
              className="h-7 px-2.5 rounded-md bg-emerald-600 text-white text-xs font-semibold flex items-center gap-1.5 hover:bg-emerald-700">
              <User className="w-3.5 h-3.5" /> {lane === "assigned" ? "Reassign" : "Assign to agent"}
            </button>
            {lane === "unassigned" && (
              <button onClick={() => setAutoOpen(true)}
                className="h-7 px-2.5 rounded-md bg-violet-600 text-white text-xs font-semibold flex items-center gap-1.5 hover:bg-violet-700">
                <Zap className="w-3.5 h-3.5" /> Auto-Assign
              </button>
            )}
            {lane === "assigned" && (
              <>
                <button onClick={doMoveQueue}
                  className="h-7 px-2.5 rounded-md bg-amber-500 text-white text-xs font-semibold flex items-center gap-1.5 hover:bg-amber-600">
                  <ArrowLeftRight className="w-3.5 h-3.5" /> Move to {config.type === "delivering" ? "Problematic" : "Delivering"}
                </button>
                {role === "admin" && (
                  <button onClick={doUnassign}
                    className="h-7 px-2.5 rounded-md bg-rose-600 text-white text-xs font-semibold flex items-center gap-1.5 hover:bg-rose-700">
                    <Trash2 className="w-3.5 h-3.5" /> Unassign
                  </button>
                )}
              </>
            )}
            <button onClick={() => setSel(new Set())} className="ml-auto text-slate-500 underline underline-offset-2 hover:text-slate-700">Clear selection</button>
          </div>
        )}

        {/* Table */}
        <div className="overflow-auto scrollbar-dark mt-3 max-h-[68vh]">
          <table className="w-full text-sm border border-slate-200">
            <thead className="sticky top-0 z-40">
              <tr className="bg-slate-50 border-b border-slate-200 text-left">
                <th className="px-2 py-2.5 sticky left-0 z-30 bg-slate-50 w-[36px] min-w-[36px] max-w-[36px] border-r border-slate-200"><input
                  type="checkbox" className="accent-blue-600" checked={pageAllSel}
                  ref={el => { if (el) el.indeterminate = pageSomeSel && !pageAllSel }}
                  onChange={e => setSel(prev => {
                    const ids = new Set(paginated.map(w => w.id))
                    if (e.target.checked) return new Set([...prev, ...ids])
                    return new Set([...prev].filter(id => !ids.has(id)))
                  })} /></th>
                <th className="px-3 py-2.5 sticky left-[36px] z-30 bg-slate-50 w-[48px] min-w-[48px] max-w-[48px] text-xs font-bold text-slate-600 border-r border-slate-200">No</th>
                {visCols.map(c => <th key={c.k} className="px-3 py-2.5 text-xs font-bold text-slate-600 whitespace-nowrap border-r border-slate-200 bg-slate-50">{c.l}</th>)}
                <th className="px-3 py-2.5 text-xs font-bold text-slate-600 bg-slate-50">Actions</th>
              </tr>
              {/* Filter row */}
              <tr className="border-b border-slate-200 bg-white">
                <th className="px-2 py-2 sticky left-0 z-30 bg-white w-[36px] min-w-[36px] max-w-[36px] border-r border-slate-100" />
                <th className="px-2 py-2 sticky left-[36px] z-30 bg-white w-[48px] min-w-[48px] max-w-[48px] border-r border-slate-100" />
                {visCols.map(c => (
                  <th key={c.k} className="px-2 py-2 border-r border-slate-100 min-w-[130px] bg-white">
                    {c.kind === "date" ? (
                      <DateRangePicker a={applied[c.k]?.a || ""} b={applied[c.k]?.b || ""} onApply={applyDateCol(c.k)} placeholder={c.k === "order_date" ? "This month" : "All"} />
                    ) : c.kind === "select" ? (
                      <select className={INP} value={draft[c.k]?.a || "All"} onChange={e => setF(c.k, "a", e.target.value)}>
                        <option>All</option>
                        {optsFor(c.k).map(o => <option key={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input className={INP} value={draft[c.k]?.a || ""} onChange={e => setF(c.k, "a", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} />
                    )}
                  </th>
                ))}
                <th className="px-2 py-2 bg-white"><button onClick={applyFilters} className="h-9 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white"><Search className="w-4 h-4" /></button></th>
              </tr>
            </thead>
            <tbody>
              {loading && laneRows.length === 0 ? (
                <tr><td colSpan={visCols.length + 3} className="py-14 text-center text-slate-400 text-sm"><RefreshCw className="w-5 h-5 animate-spin inline mr-2" /> Loading orders…</td></tr>
              ) : paginated.length === 0 ? (
                <tr><td colSpan={visCols.length + 3} className="py-12 text-center text-slate-400 text-sm">
                  {lane === "assigned"
                    ? (isAgent ? "Wala ka pang assigned orders sa queue na ito." : "No assigned orders yet — assign from the Unassigned pool.")
                    : "No unassigned eligible orders in this window."}
                </td></tr>
              ) : paginated.map((w, i) => {
                const rowBg = sel.has(w.id) ? "bg-blue-50" : i % 2 === 0 ? "bg-white" : "bg-slate-50"
                return (
                  <tr key={w.id} className={`border-b border-slate-100 ${rowBg} hover:bg-blue-50/40`}>
                    <td className={`px-2 py-2.5 sticky left-0 z-10 ${rowBg} w-[36px] min-w-[36px] max-w-[36px] border-r border-slate-100`}>
                      <input type="checkbox" checked={sel.has(w.id)} onChange={() => setSel(s => { const n = new Set(s); if (n.has(w.id)) n.delete(w.id); else n.add(w.id); return n })} className="accent-blue-600" />
                    </td>
                    <td className={`px-3 py-2.5 sticky left-[36px] z-10 ${rowBg} w-[48px] min-w-[48px] max-w-[48px] text-slate-400 border-r border-slate-100`}>{showFrom + i}</td>
                    {visCols.map(c => {
                      const v = cellVal(w, c.k)
                      return (
                        <td key={c.k} className={`px-3 py-2.5 border-r border-slate-100 whitespace-nowrap max-w-[220px] truncate ${c.kind === "money" ? "tabular-nums text-right" : ""} text-slate-700`} title={String(v)}>
                          {c.k === "delivery_status"
                            ? (v ? <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${PARCEL_BADGE[String(v)] || "bg-slate-100 text-slate-600"}`}>{v}</span> : "")
                            : c.k === "agent_status"
                              ? (v ? <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${AGENT_STATUS_BADGE[v as AgentStatus] || "bg-slate-100 text-slate-600"}`}>{v}</span> : "")
                              : c.kind === "money" ? peso(Number(v)) : (v || "")}
                        </td>
                      )
                    })}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setViewRow(w)} className="w-8 h-8 rounded border border-slate-300 flex items-center justify-center text-slate-500 hover:text-blue-600 hover:border-blue-400" title={w.rec ? "Open / update status" : "View order info"}><Search className="w-4 h-4" /></button>
                        {canManage && (
                          <button onClick={() => setAssignRows([w])} className="w-8 h-8 rounded border border-slate-300 flex items-center justify-center text-slate-500 hover:text-emerald-600 hover:border-emerald-400" title={w.rec ? "Reassign" : "Assign to agent"}><User className="w-4 h-4" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between flex-wrap gap-2 mt-3 text-sm text-slate-600">
          <span>
            Showing {showFrom} to {showTo} of {nfmt(filtered.length)} entries
            {sel.size > 0 && <span className="font-semibold text-blue-600"> · {nfmt(sel.size)} selected</span>}
          </span>
          <div className="flex items-center gap-1">
            <button disabled={pageSafe <= 1} onClick={() => setPage(p => p - 1)} className="w-8 h-8 rounded border border-slate-300 flex items-center justify-center disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
            {Array.from({ length: Math.min(pages, 7) }, (_, x) => x + Math.max(1, Math.min(pageSafe - 3, pages - 6))).map(n => (
              <button key={n} onClick={() => setPage(n)} className={`w-8 h-8 rounded border text-sm ${n === pageSafe ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300 hover:bg-slate-50"}`}>{n}</button>
            ))}
            <button disabled={pageSafe >= pages} onClick={() => setPage(p => p + 1)} className="w-8 h-8 rounded border border-slate-300 flex items-center justify-center disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
        <p className="mt-2 text-sm"><strong className="text-slate-800">Total Amount</strong> : {totalAmount.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</p>
      </div>

      {/* Manual assign / reassign modal */}
      {assignRows && assignRows.length > 0 && (
        <AssignAgentModal rows={assignRows} agents={teamStore.activeAgents} loads={openLoads}
          reassign={!!assignRows[0].rec}
          onClose={() => setAssignRows(null)}
          onSave={agent => { const rows = assignRows; setAssignRows(null); doAssign(rows, agent) }} />
      )}

      {/* Auto-assign modal */}
      {autoOpen && (
        <AutoAssignModal rows={selRows.filter(w => !w.rec)} agents={teamStore.activeAgents} loads={openLoads}
          onClose={() => setAutoOpen(false)}
          onConfirm={async plan => {
            setAutoOpen(false)
            let inserted = 0, skipped = 0
            for (const pa of plan.perAgent) {
              const res = await store.assignOrders(pa.orders, { email: pa.agent.email, name: pa.agent.name }, config.type)
              inserted += res.inserted; skipped += res.skipped
            }
            await store.logBatch("Auto-assign batch",
              `${inserted} orders → ${plan.perAgent.length} agents (${config.type})${skipped ? ` · ${skipped} skipped` : ""}${plan.leftover.length ? ` · ${plan.leftover.length} left (caps)` : ""}`)
            setSel(new Set())
            flash(`Auto-assigned ${inserted} orders to ${plan.perAgent.length} agents${skipped ? ` · ${skipped} skipped` : ""}.`)
          }} />
      )}
    </div>
  )
}

// ── ASSIGN / REASSIGN modal ──────────────────────────────────────────────────
function AssignAgentModal({ rows, agents, loads, reassign, onClose, onSave }: {
  rows: WsRow[]; agents: DeliveryAgent[]; loads: Record<string, number>
  reassign: boolean; onClose: () => void; onSave: (agent: DeliveryAgent) => void
}) {
  const [pick, setPick] = useState("")
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md p-5">
        <h2 className="text-base font-bold text-slate-800 flex items-center gap-2 mb-1">
          <User className="w-4 h-4 text-emerald-600" /> {reassign ? "Reassign" : "Assign"} {rows.length} order{rows.length === 1 ? "" : "s"}
        </h2>
        <p className="text-[11px] text-slate-400 mb-3">Ang bilang sa kanan = kasalukuyang open assignments ng agent sa queue na ito.</p>
        {agents.length === 0 ? (
          <p className="text-sm text-slate-400 py-4">Walang active agents — add them in Delivery Ops → Settings first.</p>
        ) : (
          <div className="max-h-[300px] overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
            {agents.map(a => (
              <label key={a.id} className={`flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-slate-50 ${pick === a.email ? "bg-blue-50" : ""}`}>
                <input type="radio" name="agent" className="accent-blue-600" checked={pick === a.email} onChange={() => setPick(a.email)} />
                <span className="flex-1 text-sm text-slate-700">{a.name || a.email}<span className="block text-[11px] text-slate-400">{a.email}</span></span>
                <span className="text-[11px] font-bold tabular-nums bg-slate-100 text-slate-600 rounded-md px-1.5 py-0.5">{loads[a.email.toLowerCase()] || 0}</span>
              </label>
            ))}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 mt-4">
          <button onClick={onClose} className="h-9 px-4 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button disabled={!pick} onClick={() => { const a = agents.find(x => x.email === pick); if (a) onSave(a) }}
            className="h-9 px-4 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
            {reassign ? "Reassign" : "Assign"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── AUTO-ASSIGN modal — pili ng agents, optional cap, live preview ng hatian ──
function AutoAssignModal({ rows, agents, loads, onClose, onConfirm }: {
  rows: WsRow[]; agents: DeliveryAgent[]; loads: Record<string, number>
  onClose: () => void; onConfirm: (plan: ReturnType<typeof planAutoAssign>) => void
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set(agents.map(a => a.email)))
  const [maxStr, setMaxStr] = useState("")
  const snapshots = useMemo(() => rows.map(w => toSnapshot(w.live)), [rows])
  const chosen = agents.filter(a => picked.has(a.email))
  const max = parseInt(maxStr) > 0 ? parseInt(maxStr) : undefined
  const plan = useMemo(() => planAutoAssign(snapshots, chosen, loads, max), [snapshots, chosen, loads, max])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-lg p-5">
        <h2 className="text-base font-bold text-slate-800 flex items-center gap-2 mb-1">
          <Zap className="w-4 h-4 text-violet-600" /> Auto-Assign {rows.length} order{rows.length === 1 ? "" : "s"}
        </h2>
        <p className="text-[11px] text-slate-400 mb-3">Least-loaded round-robin — pantay na hatian, isinasaalang-alang ang kasalukuyang open load ng bawat agent.</p>
        {agents.length === 0 ? (
          <p className="text-sm text-slate-400 py-4">Walang active agents — add them in Delivery Ops → Settings first.</p>
        ) : (
          <>
            <div className="max-h-[220px] overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 mb-3">
              {agents.map(a => {
                const share = plan.perAgent.find(p => p.agent.email === a.email)?.orders.length || 0
                return (
                  <label key={a.id} className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-slate-50">
                    <input type="checkbox" className="accent-violet-600" checked={picked.has(a.email)}
                      onChange={() => setPicked(p => { const n = new Set(p); if (n.has(a.email)) n.delete(a.email); else n.add(a.email); return n })} />
                    <span className="flex-1 text-sm text-slate-700">{a.name || a.email}<span className="block text-[11px] text-slate-400">open: {loads[a.email.toLowerCase()] || 0}</span></span>
                    {picked.has(a.email) && <span className="text-[11px] font-bold tabular-nums bg-violet-100 text-violet-700 rounded-md px-2 py-0.5">+{share}</span>}
                  </label>
                )
              })}
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600 mb-3">
              Max new leads per agent:
              <input className="h-8 w-24 rounded border border-slate-300 px-2 text-sm" type="number" min={1} placeholder="no cap" value={maxStr} onChange={e => setMaxStr(e.target.value)} />
            </label>
            <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-600">
              <span className="font-semibold text-slate-800">Preview:</span>{" "}
              {plan.perAgent.length === 0 ? "—" : plan.perAgent.map(p => `${p.agent.name || p.agent.email} ${p.orders.length}`).join(" · ")}
              {plan.leftover.length > 0 && <span className="text-amber-600"> · {plan.leftover.length} not assigned (caps reached)</span>}
            </div>
          </>
        )}
        <div className="flex items-center justify-end gap-2 mt-4">
          <button onClick={onClose} className="h-9 px-4 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button disabled={plan.perAgent.length === 0} onClick={() => onConfirm(plan)}
            className="h-9 px-4 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50">
            Confirm Auto-Assign
          </button>
        </div>
      </div>
    </div>
  )
}

// ── VIEW / UPDATE screen — full page (fulfillment ViewOrderScreen idiom) ─────
function DetailRow({ l, children }: { l: string; children: any }) {
  return (
    <div className="grid grid-cols-[150px_1fr] items-start gap-3">
      <span className="text-sm text-slate-600 text-right pt-2.5">{l}</span>
      {children}
    </div>
  )
}

function ViewDeliveryScreen({ row, config, canEdit, onBack, onSave }: {
  row: WsRow; config: QueueConfig; canEdit: boolean; onBack: () => void
  onSave: (patch: Partial<DeliveryOrder>, expectedUpdatedAt: string) => Promise<{ ok: true } | { ok: false; conflict: DeliveryOrder | null }>
}) {
  const rec = row.rec
  const live = row.live
  const [status, setStatus] = useState<AgentStatus>(rec?.agent_status || "Pending")
  const [notes, setNotes] = useState(rec?.notes || "")
  const [statusNote, setStatusNote] = useState(rec?.status_note || "")
  const [followUp, setFollowUp] = useState(rec?.next_follow_up || "")
  const [resched, setResched] = useState(rec?.reschedule_date || "")
  const [reschedOk, setReschedOk] = useState(rec?.reschedule_confirmed || false)
  const [cancelWhy, setCancelWhy] = useState(rec?.cancel_reason || "")
  const [err, setErr] = useState("")
  const [conflict, setConflict] = useState<DeliveryOrder | null>(null)
  const [saving, setSaving] = useState(false)
  const [activity, setActivity] = useState<DeliveryActivity[]>([])
  useEffect(() => { if (rec) fetchOrderActivity(rec.order_id).then(setActivity) }, [rec?.order_id])   // eslint-disable-line react-hooks/exhaustive-deps

  const RO = "w-full min-h-[42px] rounded-lg border border-slate-200 bg-slate-100 px-3 py-2.5 text-sm text-slate-700"
  const ED = "w-full h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:outline-none focus:border-blue-400"
  const F = DetailRow
  const pStatus = liveStatus(row)

  const save = async () => {
    if (!rec || saving) return
    setErr("")
    // Status-specific na requirements bago mag-save.
    if (status === "Rescheduled" && !resched) { setErr("New delivery date is required for Rescheduled."); return }
    if (status === "Unreachable" && !followUp) { setErr("Next follow-up date is required for Unreachable."); return }
    if (status === "Canceled" && !cancelWhy.trim()) { setErr("Cancellation reason is required."); return }
    if (status === "Other" && !statusNote.trim()) { setErr("A note is required for status \"Other\"."); return }
    const patch: Partial<DeliveryOrder> = {
      agent_status: status, notes, status_note: statusNote,
      next_follow_up: followUp, reschedule_date: resched, reschedule_confirmed: reschedOk,
      cancel_reason: cancelWhy,
    }
    // Auto-stamps: Contacted/Reminded = na-reach ang customer ngayon; Unreachable = +1 attempt.
    if (status === "Contacted" || status === "Reminded" || status === "Rescheduled" || status === "Recovery")
      patch.last_contact_at = stampNow()
    if (status === "Unreachable") patch.call_attempts = (rec.call_attempts || 0) + 1
    setSaving(true)
    const res = await onSave(patch, rec.updated_at)
    setSaving(false)
    if (!res.ok) setConflict(res.conflict)
    else setConflict(null)
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start">
      <div className="flex-1 w-full bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-center justify-between flex-wrap gap-2 pb-4 mb-5 border-b border-slate-100">
          <h1 className="flex items-center gap-2 text-xl font-extrabold text-blue-600 tracking-wide">
            <Users className="w-6 h-6" /> {config.type === "problematic" ? "PROBLEMATIC ORDER" : "DELIVERY ORDER"}
          </h1>
          <button onClick={onBack} className="h-10 px-4 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5">
            <ChevronLeft className="w-4 h-4" /> Back to list
          </button>
        </div>

        {conflict && (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            <p className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Hindi na-save — may naunang nag-edit.</p>
            <p className="mt-0.5">Updated by <strong>{conflict.updated_by || "another user"}</strong> at {String(conflict.updated_at).slice(0, 16).replace("T", " ")}. Review the new values below (na-reload na ang record) bago mag-save ulit.</p>
          </div>
        )}

        <div className="space-y-4 max-w-3xl">
          <F l="Order ID"><div className={`${RO} max-w-[280px]`}>{row.id}</div></F>
          <F l="Order Date"><div className={`${RO} max-w-[240px]`}>{rec?.order_date || live?.date_added || "—"}</div></F>
          <F l="Customer"><div className={RO}>{rec?.customer_name || live?.customer_name || "—"}</div></F>
          <F l="Phone"><div className={`${RO} max-w-[280px]`}>{rec?.phone || live?.contact_no || "—"}</div></F>
          <F l="Address"><div className={RO}>{rec?.address || live?.address || "—"}</div></F>
          <F l="Location"><div className={RO}>{[rec?.province || live?.province, rec?.city || live?.city].filter(Boolean).join(", ") || "—"}</div></F>
          {live?.order_item && <F l="Order"><div className={RO}>{live.order_item}</div></F>}
          <F l="Amount"><div className={`${RO} max-w-[240px]`}>{peso(rowAmount(row))}</div></F>
          <F l="Courier"><div className={`${RO} max-w-[280px]`}>{live?.courier || rec?.courier || "—"}</div></F>
          <F l="Tracking No."><div className={`${RO} max-w-[280px]`}>{live?.tracking_no || rec?.tracking_no || "—"}</div></F>
          <F l="Page"><div className={RO}>{rec?.page_name || live?.page_name || "—"}</div></F>
          <F l="Delivery Status">
            <div>
              {pStatus ? <span className={`inline-block px-2.5 py-1 rounded-full text-sm font-medium ${PARCEL_BADGE[pStatus] || "bg-slate-100 text-slate-600"}`}>{pStatus}</span> : <span className="text-slate-400 text-sm">—</span>}
              {!live && rec && <span className="block text-[11px] text-slate-400 mt-1">snapshot mula sa assignment — wala sa live fetch window</span>}
            </div>
          </F>
          {Array.isArray(live?.status_history) && live.status_history.length > 0 && (
            <F l="Courier Timeline">
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 text-sm">
                {live.status_history.map((h: any, i: number) => (
                  <div key={i} className="px-3 py-2 flex items-center justify-between gap-2">
                    <span className="text-slate-700">{h.status}</span>
                    <span className="text-[11px] text-slate-400 tabular-nums">{h.at}</span>
                  </div>
                ))}
              </div>
            </F>
          )}

          {rec && (
            <>
              <div className="border-t border-slate-100 pt-4">
                <p className="text-sm font-bold text-slate-800 mb-3">AGENT STATUS {!canEdit && <span className="font-normal text-slate-400">(read-only)</span>}</p>
              </div>
              <F l="Assigned Agent"><div className={`${RO} max-w-[320px]`}>{rec.assigned_to_name || rec.assigned_to_email || "—"}</div></F>
              <F l="Status">
                <div className="flex flex-wrap gap-1.5">
                  {config.agentStatuses.map(s => (
                    <button key={s} disabled={!canEdit} onClick={() => setStatus(s)}
                      className={`px-3 py-1.5 rounded-lg border text-sm font-semibold ${status === s ? "bg-blue-600 border-blue-600 text-white" : `border-slate-300 text-slate-600 ${canEdit ? "hover:bg-slate-50" : "opacity-60"}`}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </F>
              {status === "Rescheduled" && (
                <>
                  <F l="New Delivery Date"><input type="date" className={`${ED} max-w-[240px]`} disabled={!canEdit} value={resched} onChange={e => setResched(e.target.value)} /></F>
                  <F l="Customer Confirmed">
                    <label className="flex items-center gap-2 pt-2.5 text-sm text-slate-700">
                      <input type="checkbox" className="accent-blue-600" disabled={!canEdit} checked={reschedOk} onChange={e => setReschedOk(e.target.checked)} />
                      Kinumpirma ng customer ang bagong delivery date
                    </label>
                  </F>
                </>
              )}
              {status === "Unreachable" && (
                <>
                  <F l="Call Attempts"><div className={`${RO} max-w-[140px] text-center`}>{(rec.call_attempts || 0) + 1} <span className="text-[11px] text-slate-400">(auto +1 on save)</span></div></F>
                  <F l="Next Follow-Up"><input type="date" className={`${ED} max-w-[240px]`} disabled={!canEdit} value={followUp} onChange={e => setFollowUp(e.target.value)} /></F>
                </>
              )}
              {status === "Canceled" && (
                <F l="Cancel Reason"><input className={ED} disabled={!canEdit} value={cancelWhy} onChange={e => setCancelWhy(e.target.value)} placeholder="Bakit kinansela?" /></F>
              )}
              {status === "Other" && (
                <F l="Note *"><input className={ED} disabled={!canEdit} value={statusNote} onChange={e => setStatusNote(e.target.value)} placeholder="Ano ang sitwasyon?" /></F>
              )}
              {status !== "Unreachable" && (
                <F l="Next Follow-Up"><input type="date" className={`${ED} max-w-[240px]`} disabled={!canEdit} value={followUp} onChange={e => setFollowUp(e.target.value)} /></F>
              )}
              <F l="Notes"><textarea className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm min-h-[90px] focus:outline-none focus:border-blue-400 disabled:bg-slate-100" disabled={!canEdit} value={notes} onChange={e => setNotes(e.target.value)} /></F>
              {err && <p className="text-sm text-red-600">{err}</p>}
              {canEdit && (
                <div className="flex items-center gap-2 pt-2">
                  <button onClick={save} disabled={saving}
                    className="h-11 px-5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center gap-2 disabled:opacity-60">
                    {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save Agent Status
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* HISTORY sidebar */}
      <div className="w-full lg:w-80 shrink-0 bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="flex items-center gap-2 text-lg font-extrabold text-blue-600 tracking-wide mb-3"><Flag className="w-5 h-5" /> HISTORY</h2>
        {rec ? (
          <>
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 text-sm mb-4">
              <div className="px-4 py-2.5 bg-slate-50 font-bold text-slate-800">Assigned To</div>
              <div className="px-4 py-2.5 text-slate-700">{rec.assigned_to_name || rec.assigned_to_email || "—"}<br /><span className="italic text-slate-500 text-xs">by {rec.assigned_by || "—"} · {rec.assigned_date || "—"}</span></div>
              <div className="px-4 py-2.5 bg-slate-50 font-bold text-slate-800">Last Updated</div>
              <div className="px-4 py-2.5 text-slate-700">{rec.updated_by || "—"}<br /><span className="italic text-slate-500 text-xs">{String(rec.updated_at).slice(0, 16).replace("T", " ") || "—"}</span></div>
              <div className="px-4 py-2.5 bg-slate-50 font-bold text-slate-800">Call Attempts</div>
              <div className="px-4 py-2.5 text-slate-700">{rec.call_attempts || 0}{rec.last_contact_at ? <><br /><span className="italic text-slate-500 text-xs">last contact {rec.last_contact_at}</span></> : null}</div>
            </div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Timeline</p>
            <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
              {[...rec.history].reverse().map((h, i) => (
                <div key={`h${i}`} className="border border-slate-200 rounded-lg px-3 py-2 text-sm">
                  <p className="font-semibold text-slate-700">{h.action}{h.detail ? <span className="font-normal text-slate-500"> — {h.detail}</span> : null}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{h.by} · {String(h.at).slice(0, 16).replace("T", " ")}</p>
                </div>
              ))}
              {activity.filter(a => !rec.history.some(h => h.action === a.action && String(h.at).slice(0, 16) === String(a.at).slice(0, 16))).map(a => (
                <div key={a.id} className="border border-slate-100 rounded-lg px-3 py-2 text-sm bg-slate-50">
                  <p className="font-semibold text-slate-600">{a.action}{a.detail ? <span className="font-normal text-slate-500"> — {a.detail}</span> : null}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{a.by_name} · {String(a.at).slice(0, 16).replace("T", " ")}</p>
                </div>
              ))}
              {rec.history.length === 0 && activity.length === 0 && <p className="text-sm text-slate-400">No history yet.</p>}
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-400">Hindi pa naka-assign ang order na ito — walang PesoWise history. Live Pancake data lang ang makikita.</p>
        )}
      </div>
    </div>
  )
}
