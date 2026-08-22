"use client"
import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import * as XLSX from "xlsx-js-style"
import {
  Undo2, RefreshCw, Search, X, Check, ChevronLeft, ChevronRight, Upload, ScanLine, Download, Camera,
  PackageCheck, PackageX, Receipt, AlertTriangle, PackagePlus,
} from "lucide-react"
import { useActivePages } from "@/lib/pages-store"
import { useRtsMeta, type RtsMeta, type RtsItemCount } from "@/lib/rts-store"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import { cachedJson, PANCAKE_CONCURRENCY } from "@/lib/pancake-cache"
import { scanSound, primeScanSound } from "@/lib/scan-sound"
import { useShippedOutScans } from "@/lib/shipped-out-store"
import { useProductBatches, planRestore } from "@/lib/product-batches-store"
import { useProductItems } from "@/lib/product-items-store"
import { useStockReleases } from "@/lib/stock-releases-store"
import { HelpButton, type HelpSection } from "@/components/business/HelpButton"

// RTS ITEMS (LHIKE manual) — Return-to-Sender parcels, live from Pancake (orders whose status
// is Returning/Returned across all connected pages). Features: sortable/filterable table w/
// totals (Price / Shipping Fee / Unreceived / Claimed), UPLOAD CLAIMS (xlsx w/ sample file),
// SCAN & RECEIVE and SCAN & CHECK (tracking-number scanning, Enter = submit — barcode-scanner
// friendly). Received/Checked/Claims state is per TRACKING NUMBER in pesowise_rts_meta.

const peso = (n: number) => "₱" + (isFinite(n) ? n : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (n: number) => (isFinite(n) ? n : 0).toLocaleString("en-PH")
const fmtDT = (iso: string) => {
  if (!iso) return ""
  const d = new Date(iso)
  return isNaN(d.getTime()) ? "" : d.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}
const INP = "h-8 w-full rounded border border-slate-300 px-1.5 text-xs bg-white focus:outline-none focus:border-blue-400"

const HELP: HelpSection[] = [
  {
    title: "Ano ang nasa listahang ito?",
    body: [
      "Ang mga parcel na ibinabalik sa atin — awtomatikong hinihila mula sa Pancake ang lahat ng order na Returning o Returned sa lahat ng konektadong page.",
      "Walang inililista rito nang manu-mano. Ang Pancake ang nagsasabi kung alin ang RTS; ang trabaho rito ay ang PISIKAL na pagtanggap at pagbilang.",
      "Ang TRACKING NUMBER ang susi ng lahat — hindi ang order id. Doon nakakabit ang bawat tatak: natanggap, na-check, na-claim, naibalik sa stock.",
    ],
  },
  {
    title: "Tatlong hakbang: Unreceived → Received → Checked",
    body: [
      "Unreceived (amber) — sinabi ng Pancake na pabalik, pero wala pa sa kamay ninyo.",
      "Received (asul) — na-scan ninyo ang waybill pagdating. Bilang lang ito; hindi pa binubuksan.",
      "Checked (berdeng) — binuksan at binilang na: ilan ang mabuti, ilan ang sira, ilan ang nawala.",
      "Nakatatak ang oras at ang pangalan ng gumawa sa bawat hakbang, kaya masasagot kung sino at kailan.",
    ],
  },
  {
    title: "CAMERA SCAN — ito ang paraan ng pag-scan",
    body: [
      "Pindutin ang CAMERA SCAN, tapos piliin ang mode sa itaas: SCAN & RECEIVE (teal) o SCAN & CHECK (pula). Laging nakikita kung nasaang mode kayo.",
      "RECEIVE: awtomatiko lahat — i-scan, tapos. Tumataas na rising na tunog ang senyas.",
      "CHECK: pagkatapos mag-scan, may lalabas na sheet sa ibaba — steppers para sa Goods / Damage / Loss. Naka-default sa buong dami ang Goods; baguhin lang kung may sira. Tatlong beses na tunog ang senyas.",
      "Puwedeng barcode scanner o typed input kung ayaw bumukas ng camera. Pindutin muna ang screen bago magsimula ang camera — kailangan ng browser ng isang pindot bago magbukas ng camera at tunog.",
      "⚠ Kailangan ng HTTPS ang camera. Sa LAN IP (http://192.168.x.x) hindi ito bubukas — ang manual o hardware scanner lang ang gagana doon.",
      "Ang naulit na scan ay tinatanggihan — may mababang buzz at banner kung kailan at sino ang naunang nag-scan.",
    ],
  },
  {
    title: "⚠ Ang popup ng COG habang nag-RECEIVE",
    body: [
      "May violet na popup na hihinto sa scan at magsasabi ng item, dami, at malaking presyo — halimbawa: Lumyra, 2 pcs, COG 35.",
      "Sinasabi nito kung saang BOX ibabalik ang parcel. Binabasa ito sa naitalang batch noong umalis ang parcel, hindi hula.",
      "Lumalabas LANG kapag ang item ay may DALAWA O HIGIT PANG magkaibang presyo sa mga batch nito. Kapag iisa ang presyo, walang maipagkakamaling box, kaya hindi ito umaabala.",
      "⚠ Ang parcel na umalis bago pa naitala ang batch ay dumadaan nang tahimik — walang popup. Hindi iyon sira: mas mabuti ang walang sagot kaysa sa maling hula.",
    ],
  },
  {
    title: "Pagbukas ng parcel — ang VIEW screen (🔍)",
    body: [
      "Dito ilalagay ang Goods / Damage / Loss kada item, ang dahilan (Buyer o Courier), larawan, remarks, at RTS Fee.",
      "⚠ Kapag may Damage o Loss na higit sa zero, awtomatikong natatatakan ng FOR CLAIM ang parcel — iyon ang isisingil sa courier.",
      "Nakalista sa HISTORY sidebar kung sino ang humiling, kailan, at kailan na-claim.",
    ],
  },
  {
    title: "UPLOAD CLAIMS — ang bayad ng courier",
    body: [
      "I-download ang template, punan ang TRACKING NUMBER at DATE OF CLAIM, tapos i-upload. Walang column ng halaga: ang halaga ay ang PRESYO MISMO ng parcel, kinukuha rito.",
      "Ang na-claim ay nagiging violet na 'Claimed'. Ang tracking na wala sa listahan ay binabalaan, hindi tahimik na tinatanggap.",
    ],
  },
  {
    title: "↩ Restock — pagbabalik sa stock",
    body: [
      "Ang berdeng ↩ ay nagbabalik ng parcel sa MISMONG batch na pinanggalingan nito — hindi sa pinakabago. May confirm modal na nagsasabi kung aling batch bago tuluyang gawin.",
      "⚠ ANG MABUTING PIRASO LANG ANG BUMABALIK. Ang sira at nawala ay hindi na maibebenta; ang pagbabalik sa kanila ay magpapakita ng stock na wala naman.",
      "Ang hindi pa na-check na parcel ay ipinapalagay na lahat mabuti — nakasulat iyon sa modal bago kumpirmahin.",
      "Isang beses lang ito puwede kada parcel, kahit ilang device ang sabay pumindot.",
      "⚠ Ang parcel na umalis bago naitala ang batch ay walang maibabalik na sagot — sasabihin nito na walang naitalang batch imbes na manghula.",
    ],
  },
  {
    title: "Ang limang counter sa itaas",
    body: [
      "May sariling date preset ang mga ito, hiwalay sa filter ng talahanayan. Napipindot lahat — may lalabas na detalyadong listahan.",
      "EXPECTED RTS (indigo) — lahat ng sinasabi ng Pancake na pabalik sa date range ng TALAHANAYAN, may 'X received · Y pending'. Ito ang panukat kung ilan ang dumating sa inaasahan.",
      "Received / Claims / Damage / Loss — sinusunod ang sariling preset sa itaas nila.",
    ],
  },
]

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

// ── Scanner feedback sounds — galing sa @/lib/scan-sound (iisang kopya sa buong app).
// "receive" ay ang pangkalahatang tagumpay na tunog; iba ang "check" para marinig
// ng staff kung anong mode ang tumatakbo kahit hindi nakatingin sa screen.
const beep = (kind: "receive" | "check" | "error") =>
  scanSound(kind === "receive" ? "ok" : kind)

type RtsRow = Record<string, any> & { id: string; page_name: string }
const isRts = (r: RtsRow) => /return/i.test(String(r.order_status || "")) || /Return/i.test(String(r.parcel_status || ""))
const statusOf = (m: RtsMeta | undefined) => m?.checked_at ? "Checked" : m?.received_at ? "Received" : "Unreceived"
// Claim lane (separate from the physical lane): tagged For Claim (damaged/lost) → Claimed once
// the claim amount lands via Upload Claims.
const claimStateOf = (m: RtsMeta | undefined) => (m?.claim_amount || 0) > 0 ? "Claimed" : m?.for_claim ? "For Claim" : ""
const STATUS_BADGE: Record<string, string> = {
  Unreceived: "bg-amber-50 text-amber-700",
  Received: "bg-blue-50 text-blue-700",
  Checked: "bg-emerald-50 text-emerald-700",
  "For Claim": "bg-rose-50 text-rose-700",
  Claimed: "bg-purple-50 text-purple-700",
}

export default function RtsItemsPage() {
  const activePages = useActivePages()
  const rts = useRtsMeta()
  const pagesWithCreds = useMemo(() => activePages.filter(p => p.api_key && (p.pancake_page_id || p.shop_id)), [activePages])

  const [rows, setRows] = useState<RtsRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loadErr, setLoadErr] = useState("")
  // 100 ang default — pinakamaliit sa dropdown, kapareho ng Fulfillment.
  const [perPage, setPerPage] = useState(100)
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState("")
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500) }

  const empty = { dateA: "", dateB: "", csr: "", customer: "", address: "", contact: "", order: "", qty: "", price: "", pageN: "", tracking: "", courier: "All", status: "All" }
  const [draft, setDraft] = useState({ ...empty })
  const [applied, setApplied] = useState({ ...empty })
  const setD = (k: keyof typeof empty, v: string) => setDraft(p => ({ ...p, [k]: v }))

  const [claimsOpen, setClaimsOpen] = useState(false)
  const [viewRow, setViewRow] = useState<RtsRow | null>(null)
  const [camOpen, setCamOpen] = useState(false)

  // ── RTS RESTOCK ────────────────────────────────────────────────────────────
  // Ang nagbalik na parcel ay ibinabalik sa MISMONG cost layer na pinanggalingan
  // nito — nakasulat iyon sa `batch_lines` ng Shipped Out, magkatugma sa tracking
  // number. Kung sa pinakabagong batch ibinalik, mawawala ang isang ₱35 na piraso
  // at madadagdagan ka ng ₱30 na hindi mo naman binili.
  const shipped = useShippedOutScans()
  const batchStore = useProductBatches()
  const productStore = useProductItems()
  const releaseLog = useStockReleases()
  const [restocking, setRestocking] = useState<RtsRow | null>(null)
  const [restockBusy, setRestockBusy] = useState(false)

  const scanByTracking = useMemo(() => {
    const m = new Map<string, ReturnType<typeof useShippedOutScans>["scans"][number]>()
    for (const s of shipped.scans) m.set(s.tracking_no.trim().toLowerCase(), s)
    return m
  }, [shipped.scans])

  /**
   * Pahiwatig ng COG para sa nagbabalik na parcel — binabasa mula sa batch_lines na
   * naitala noong umalis ito. Lumalabas LANG para sa item na may higit sa isang
   * presyo sa mga batch nito ("double COG") — kapag iisa lang ang presyo ng item,
   * walang maipagkakamaling box, kaya walang popup na aabala sa scan.
   */
  const cogHintOf = useCallback((tracking: string) => {
    const scan = scanByTracking.get(tracking.trim().toLowerCase())
    if (!scan?.batch_lines?.length) return []
    return scan.batch_lines
      .filter(l => {
        const cogs = new Set(batchStore.batches.filter(b => b.item_id === l.item_id).map(b => b.cog))
        return cogs.size >= 2
      })
      .map(l => ({
        name: productStore.items.find(i => i.id === l.item_id)?.name || "Item",
        qty: l.qty, cog: l.cog, batchNo: l.batch_no || "Batch",
      }))
  }, [scanByTracking, batchStore.batches, productStore.items])

  /** Ilang MABUTING piraso ang bumalik — sira at nawala ay hindi na maibebenta. */
  function goodQtyOf(tracking: string, fallbackQty: number) {
    const m = rts.meta[tracking]
    const counted = (m?.items || []).reduce((s, i) => s + (Number(i.goods) || 0), 0)
    // Hindi pa na-check → ipinapalagay na lahat mabuti; ipinapakita ito bago kumpirmahin.
    return (m?.items && m.items.length > 0) ? counted : fallbackQty
  }

  async function doRestock(row: RtsRow) {
    const tracking = String(row.tracking_no || "").trim()
    const scan = scanByTracking.get(tracking.toLowerCase())
    if (!scan || !scan.batch_lines.length) { flash("⚠ Walang naitalang batch para sa parcel na ito — hindi malalaman kung saan ibabalik."); return }
    const good = goodQtyOf(tracking, scan.deducted_total)
    if (good <= 0) { flash("⚠ Walang mabuting piraso na ibabalik."); return }

    setRestockBusy(true)
    const lines = planRestore(scan.batch_lines.map(l => ({ batch_id: l.batch_id, batch_no: l.batch_no, qty: l.qty, cog: l.cog, value: l.value })), good)
    const withItem = lines.map((l, i) => ({ ...l, item_id: scan.batch_lines[i]?.item_id || "" }))
    // Unahin ang gate — kapag natalo tayo, ibang device na ang nagbalik at wala tayong dapat gawin.
    const res = await shipped.claimRestock(tracking, withItem, good)
    setRestockBusy(false)
    setRestocking(null)
    if (res === "already") { flash("⚠ Naibalik na ang parcel na ito sa inventory."); return }
    if (res !== "claimed") { flash(`⚠ ${res}`); return }

    batchStore.restore(withItem)
    const perItem = new Map<string, number>()
    for (const l of withItem) perItem.set(l.item_id, (perItem.get(l.item_id) || 0) + l.qty)
    const deltas = Array.from(perItem, ([id, qty]) => ({ id, qty }))
    productStore.restockStock(deltas)
    releaseLog.addRelease({
      // Idempotent na id — ang parehong pagbabalik ay iisang ledger row.
      id: "rel_rts_" + String(tracking).toLowerCase(),
      category: "RTS Restock", ref: tracking,
      items: deltas.map(d => {
        const it = productStore.items.find(x => x.id === d.id)
        // Negatibo ang deducted — stock-IN ito, at ganito ito lalabas sa Transaction History.
        return { item_id: d.id, sku: it?.sku || "", name: it?.name || "", required: 1, release: d.qty, deducted: -d.qty }
      }),
    })
    flash(`Naibalik ang ${good} pc${good === 1 ? "" : "s"} sa inventory — sa mismong batch na pinanggalingan.`)
  }

  // Scan summary — ONE date filter (presets) + 4 CLICKABLE counters: Received / Claims / Damage / Loss.
  const [statRange, setStatRange] = useState("Today")
  const [statDetail, setStatDetail] = useState<"" | "expected" | "received" | "claims" | "damage" | "loss">("")
  const statWindow = useMemo(() => {
    const ds = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    const now = new Date()
    let from = "0000-01-01", to = ds(now)
    if (statRange === "Today") from = to
    else if (statRange === "Yesterday") { from = to = ds(new Date(Date.now() - 86400000)) }
    else if (statRange === "Last 7 days") from = ds(new Date(Date.now() - 6 * 86400000))
    else if (statRange === "Last 30 days") from = ds(new Date(Date.now() - 29 * 86400000))
    else if (statRange === "This month") from = ds(new Date(now.getFullYear(), now.getMonth(), 1))
    // "All time" keeps the wide-open window
    return { from, to }
  }, [statRange])
  const inStatRange = (stamp?: string) => { if (!stamp) return false; const d = stamp.slice(0, 10); return d >= statWindow.from && d <= statWindow.to }
  const scanStats = useMemo(() => {
    let received = 0, claims = 0, claimAmt = 0, damage = 0, loss = 0
    for (const m of Object.values(rts.meta)) {
      if (inStatRange(m.received_at)) received++
      if (inStatRange(m.claimed_at)) { claims++; claimAmt += Number(m.claim_amount || 0) }
      if (inStatRange(m.checked_at)) for (const it of (m.items || [])) { damage += it.damage || 0; loss += it.loss || 0 }
    }
    return { received, claims, claimAmt, damage, loss }
  }, [rts.meta, statWindow])   // eslint-disable-line react-hooks/exhaustive-deps
  // Expected RTS = LAHAT ng returns na dineklara ni Pancake sa table's date window —
  // ito ang inaabangan; dapat tumugma ang na-receive dito, at ang pending ang hahabulin/icle-claim.
  const expectedStats = useMemo(() => {
    let received = 0
    for (const r of rows) if (rts.meta[String(r.tracking_no || "")]?.received_at) received++
    return { total: rows.length, received, pending: rows.length - received }
  }, [rows, rts.meta])
  // Detail list ng napindot na card: date + tracking (+ customer / amount / pcs).
  const statDetailRows = useMemo(() => {
    if (!statDetail) return []
    const out: { date: string; tracking: string; customer: string; by?: string; amount?: number; pcs?: number; what?: string; courier?: string; got?: boolean }[] = []
    // Expected RTS reads from the LOADED Pancake rows (table window), hindi sa meta stamps.
    if (statDetail === "expected") {
      for (const r of rows) {
        const t = String(r.tracking_no || "")
        out.push({ date: String(r.date_added || ""), tracking: t || "—", customer: r.customer_name || "—", courier: r.courier || "—", got: !!rts.meta[t]?.received_at })
      }
      return out.sort((a, b) => Number(a.got) - Number(b.got) || b.date.localeCompare(a.date))   // pending muna
    }
    for (const [tracking, m] of Object.entries(rts.meta)) {
      const row = rows.find(r => String(r.tracking_no || "") === tracking)
      const customer = row?.customer_name || "—"
      if (statDetail === "received" && inStatRange(m.received_at)) out.push({ date: m.received_at!, tracking, customer, by: m.received_by })
      else if (statDetail === "claims" && inStatRange(m.claimed_at)) out.push({ date: m.claimed_at!, tracking, customer, amount: Number(m.claim_amount || 0) })
      else if ((statDetail === "damage" || statDetail === "loss") && inStatRange(m.checked_at)) {
        const pcs = (m.items || []).reduce((s, it) => s + (statDetail === "damage" ? it.damage || 0 : it.loss || 0), 0)
        if (pcs > 0) out.push({
          date: m.checked_at!, tracking, customer, pcs,
          what: (m.items || []).filter(it => (statDetail === "damage" ? it.damage : it.loss) > 0).map(it => `${statDetail === "damage" ? it.damage : it.loss}× ${it.name}`).join(", "),
        })
      }
    }
    return out.sort((a, b) => b.date.localeCompare(a.date))
  }, [statDetail, rts.meta, rows, statWindow])   // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch window = Order Date picker (blank = current month). RTS parcels straggle, so the
  // picker matters — set Last 30 days / custom kung lumang orders ang hinahanap.
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  const pagesKey = pagesWithCreds.map(p => `${p.api_key}~${p.pancake_page_id || p.shop_id}~${p.name}`).join("|")
  const fetchWindow = (() => {
    const now = new Date()
    if (!applied.dateA && !applied.dateB) return { from: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), to: fmt(now) }
    return { from: applied.dateA || applied.dateB, to: applied.dateB || fmt(now) }
  })()
  const rangeKey = `${fetchWindow.from}|${fetchWindow.to}`
  async function load(noCache = false) {
    if (pagesWithCreds.length === 0) { setRows([]); return }
    setLoading(true); setLoadErr("")
    const out: RtsRow[] = []
    const errs: string[] = []
    await mapLimit(pagesWithCreds, PANCAKE_CONCURRENCY, async p => {
      try {
        const rs = await fetchPageRows(p.api_key, p.pancake_page_id || p.shop_id, fetchWindow.from, fetchWindow.to, noCache)
        for (const r of rs) if (isRts(r)) out.push({ ...r, page_name: p.name })
      } catch (e: any) { errs.push(`${p.name}: ${e?.message || "failed"}`) }
    })
    out.sort((a, b) => String(b.date_added).localeCompare(String(a.date_added)))
    setRows(out); setLoading(false)
    if (errs.length) setLoadErr(errs.join(" · "))
  }
  useEffect(() => { load() }, [pagesKey, rangeKey])   // eslint-disable-line react-hooks/exhaustive-deps

  const metaOf = (r: RtsRow) => rts.meta[String(r.tracking_no || "")] || undefined

  const filtered = useMemo(() => rows.filter(r => {
    const a = applied
    const like = (v: any, q: string) => !q || String(v || "").toLowerCase().includes(q.toLowerCase())
    if (!like(r.csr_name, a.csr) || !like(r.customer_name, a.customer) || !like(r.address, a.address)) return false
    if (!like(r.contact_no, a.contact) || !like(r.order_item, a.order) || !like(r.page_name, a.pageN) || !like(r.tracking_no, a.tracking)) return false
    if (a.qty && String(r.quantity ?? "") !== a.qty.trim()) return false
    if (a.price && !String(r.final_price ?? "").includes(a.price.replace(/,/g, ""))) return false
    if (a.courier !== "All" && r.courier !== a.courier) return false
    if (a.status !== "All" && statusOf(metaOf(r)) !== a.status && claimStateOf(metaOf(r)) !== a.status) return false
    return true
  }), [rows, applied, rts.meta])   // eslint-disable-line react-hooks/exhaustive-deps

  const courierOpts = useMemo(() => Array.from(new Set(rows.map(r => String(r.courier || "")).filter(Boolean))).sort(), [rows])
  const pages = Math.max(1, Math.ceil(filtered.length / perPage))
  const pageSafe = Math.min(page, pages)
  const paginated = filtered.slice((pageSafe - 1) * perPage, pageSafe * perPage)
  const showFrom = filtered.length === 0 ? 0 : (pageSafe - 1) * perPage + 1
  const showTo = Math.min(pageSafe * perPage, filtered.length)

  // Footer totals (LHIKE): price, shipping fee, unreceived (price of parcels not yet received), claimed.
  const totals = useMemo(() => {
    let price = 0, ship = 0, unreceived = 0, received = 0, claimed = 0
    for (const r of filtered) {
      const m = metaOf(r)
      price += Number(r.final_price || 0)
      ship += Number(r.shipping_fee || 0)
      if (m?.received_at) received += Number(r.final_price || 0)
      else unreceived += Number(r.final_price || 0)
      claimed += Number(m?.claim_amount || 0)
    }
    return { price, ship, unreceived, received, claimed }
  }, [filtered, rts.meta])   // eslint-disable-line react-hooks/exhaustive-deps

  const applyFilters = () => { setApplied(draft); setPage(1) }

  // ── Burahin lahat ng filter ─────────────────────────────────────────────────
  // Kasama ang date range dito — sa RTS, ang walang laman na petsa ay HINDI "walang
  // filter" kundi ang default na "this month" (tingnan ang fetchWindow). Kaya ang
  // pag-clear ay magpapabalik sa default na buwan, at magre-refetch KUNG iba ang
  // dating range. Bilang isa lang ang magkapares na petsa para tumpak ang bilang.
  const countActive = (f: typeof empty) => {
    let n = 0
    if (f.dateA || f.dateB) n++
    if (f.courier !== "All") n++
    if (f.status !== "All") n++
    for (const k of ["csr", "customer", "address", "contact", "order", "qty", "price", "pageN", "tracking"] as const) if (f[k]) n++
    return n
  }
  const activeFilters = countActive(applied)
  const hasFilters = activeFilters > 0 || countActive(draft) > 0
  const clearFilters = () => { setDraft({ ...empty }); setApplied({ ...empty }); setPage(1) }
  const toggleExpand = (id: string) => setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const COLS =["No", "Order Date", "CSR", "Customer Name", "Address", "Contact", "Order", "Total Qty", "Price", "Page", "Tracking Number", "Courier", "RTS Status", "Claim", "Actions"]

  const toastEl = toast ? (
    <div className="fixed top-4 right-4 z-[80] bg-emerald-600 text-white text-sm rounded-xl px-5 py-3 shadow-lg flex items-center gap-2">
      <Check className="w-4 h-4" /> <div><p className="font-semibold">Success</p><p className="text-emerald-100">{toast}</p></div>
    </div>
  ) : null

  if (viewRow) return (
    <>
      {toastEl}
      <ViewRtsScreen row={viewRow} meta={metaOf(viewRow)}
        onBack={() => setViewRow(null)}
        onSubmit={patch => { rts.saveDetails(String(viewRow.tracking_no || ""), patch); setViewRow(null); flash("RTS details saved.") }} />
    </>
  )

  if (claimsOpen) return (
    <>
      {toastEl}
      <ClaimsScreen rows={rows} onBack={() => setClaimsOpen(false)}
        onApply={(claims, skipped) => { rts.setClaims(claims); setClaimsOpen(false); flash(`${claims.length} claim${claims.length === 1 ? "" : "s"} uploaded${skipped ? ` · ${skipped} skipped` : ""}.`) }} />
    </>
  )

  return (
    <div className="space-y-4 relative">
      {toastEl}

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        {/* Header — LHIKE button set */}
        <div className="flex items-center justify-between flex-wrap gap-2 pb-4 border-b border-slate-100">
          <h1 className="flex items-center gap-2 text-xl font-extrabold text-blue-600 tracking-wide"><Undo2 className="w-6 h-6" /> RTS ITEMS<HelpButton title="Paano gumagana ang RTS Items" sections={HELP} /></h1>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setClaimsOpen(true)} className="h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold tracking-wide">UPLOAD CLAIMS</button>
            <button onClick={() => setCamOpen(true)} className="h-10 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold tracking-wide flex items-center gap-1.5"><Camera className="w-4 h-4" /> CAMERA SCAN</button>
            <button onClick={() => load(true)} title="Refresh" className="h-10 w-10 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50 flex items-center justify-center shrink-0"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></button>
          </div>
        </div>

        {/* Scan summary — one date filter, four counters */}
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-semibold text-slate-700">Scan Summary</span>
            <select value={statRange} onChange={e => setStatRange(e.target.value)}
              className="h-8 rounded-lg border border-slate-300 px-2 text-xs bg-white focus:outline-none">
              {["Today", "Yesterday", "Last 7 days", "Last 30 days", "This month", "All time"].map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          {/* Solid-colour na cards — kapareho ng Warehouse Dashboard ops cards:
              malaking bilang, ghost icon sa likod, label at detalye sa ilalim. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2.5">
            {([
              { k: "expected", label: "Expected RTS", value: num(expectedStats.total), sub: `${num(expectedStats.received)} received · ${num(expectedStats.pending)} pending`,
                color: "bg-indigo-600", icon: Undo2, title: "All returns Pancake declared inside the table's current date range" },
              { k: "received", label: "Received", value: num(scanStats.received), sub: `scanned · ${statRange.toLowerCase()}`,
                color: "bg-teal-600", icon: PackageCheck, title: "Scanned as Received inside the selected Scan Summary range" },
              { k: "claims", label: "Claims", value: num(scanStats.claims), sub: scanStats.claimAmt > 0 ? peso(scanStats.claimAmt) : "no amount",
                color: "bg-purple-600", icon: Receipt, title: "Parcels carrying a claim amount" },
              { k: "damage", label: "Damage", value: num(scanStats.damage), sub: "pcs",
                color: "bg-red-600", icon: AlertTriangle, title: "Number of damaged pieces" },
              { k: "loss", label: "Loss", value: num(scanStats.loss), sub: "pcs",
                color: "bg-amber-600", icon: PackageX, title: "Number of missing pieces" },
            ] as const).map(c => (
              <button key={c.k} onClick={() => setStatDetail(c.k)} title={c.title}
                className={`relative overflow-hidden ${c.color} rounded-xl px-4 py-3 h-[78px] flex items-center justify-between text-left hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-white/60 transition`}>
                <c.icon strokeWidth={1} className="absolute -left-2 w-16 h-16 opacity-[0.12] text-white" />
                <div className="text-right ml-auto z-10 min-w-0">
                  <p className="text-xl font-bold text-white leading-none tabular-nums truncate">{c.value}</p>
                  <p className="text-[10px] text-white/75 font-semibold mt-1 tracking-wider uppercase leading-tight truncate">
                    {c.label} <span className="text-white/60 normal-case tracking-normal">({c.sub})</span>
                  </p>
                </div>
              </button>
            ))}
          </div>
          {statDetail && (
            <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setStatDetail("")}>
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
                  <h2 className={`text-lg font-bold uppercase ${statDetail === "expected" ? "text-indigo-600" : statDetail === "received" ? "text-teal-600" : statDetail === "claims" ? "text-purple-600" : statDetail === "damage" ? "text-red-600" : "text-amber-600"}`}>
                    {statDetail === "expected" ? "Expected RTS — table date range" : `${statDetail} — ${statRange}`} ({statDetailRows.length})
                  </h2>
                  <button onClick={() => setStatDetail("")} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {statDetailRows.length === 0 ? (
                    <p className="py-12 text-center text-slate-400 text-sm">No records in this period.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-20">
                        <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs text-slate-500">
                          <th className="px-4 py-2.5 font-semibold whitespace-nowrap">DATE</th>
                          <th className="px-4 py-2.5 font-semibold">TRACKING NUMBER</th>
                          <th className="px-4 py-2.5 font-semibold">CUSTOMER</th>
                          {statDetail === "expected" && <><th className="px-4 py-2.5 font-semibold">COURIER</th><th className="px-4 py-2.5 font-semibold">STATUS</th></>}
                          {statDetail === "received" && <th className="px-4 py-2.5 font-semibold">RECEIVED BY</th>}
                          {statDetail === "claims" && <th className="px-4 py-2.5 font-semibold text-right">AMOUNT</th>}
                          {(statDetail === "damage" || statDetail === "loss") && <><th className="px-4 py-2.5 font-semibold text-right">PCS</th><th className="px-4 py-2.5 font-semibold">ITEMS</th></>}
                        </tr>
                      </thead>
                      <tbody>
                        {statDetailRows.map((r, i) => (
                          <tr key={i} className={`border-b border-slate-100 ${i % 2 ? "bg-slate-50" : ""}`}>
                            <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{r.date.slice(0, 16)}</td>
                            <td className="px-4 py-2.5 font-mono text-slate-800">{r.tracking}</td>
                            <td className="px-4 py-2.5 text-slate-700 max-w-[160px] truncate">{r.customer}</td>
                            {statDetail === "expected" && <>
                              <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{r.courier}</td>
                              <td className="px-4 py-2.5"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.got ? "bg-teal-50 text-teal-700" : "bg-amber-50 text-amber-700"}`}>{r.got ? "Received ✓" : "Pending"}</span></td>
                            </>}
                            {statDetail === "received" && <td className="px-4 py-2.5 text-slate-600">{r.by || "—"}</td>}
                            {statDetail === "claims" && <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{peso(r.amount || 0)}</td>}
                            {(statDetail === "damage" || statDetail === "loss") && <>
                              <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{r.pcs}</td>
                              <td className="px-4 py-2.5 text-slate-600 max-w-[200px] truncate" title={r.what}>{r.what}</td>
                            </>}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="sticky bottom-0">
                        <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold text-slate-800">
                          <td className="px-4 py-2.5" colSpan={3}>TOTAL</td>
                          {statDetail === "expected" && <td className="px-4 py-2.5" colSpan={2}>{statDetailRows.filter(r => r.got).length} received · {statDetailRows.filter(r => !r.got).length} pending</td>}
                          {statDetail === "received" && <td className="px-4 py-2.5">{statDetailRows.length} parcel{statDetailRows.length === 1 ? "" : "s"}</td>}
                          {statDetail === "claims" && <td className="px-4 py-2.5 text-right tabular-nums">{peso(statDetailRows.reduce((s, r) => s + (r.amount || 0), 0))}</td>}
                          {(statDetail === "damage" || statDetail === "loss") && <><td className="px-4 py-2.5 text-right tabular-nums">{statDetailRows.reduce((s, r) => s + (r.pcs || 0), 0)}</td><td className="px-4 py-2.5" /></>}
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between flex-wrap gap-2 mt-4">
          <label className="flex items-center gap-2 text-sm text-slate-500">
            <select className="h-9 rounded-lg border border-slate-300 px-2 text-sm bg-white" value={perPage} onChange={e => { setPerPage(parseInt(e.target.value)); setPage(1) }}>
              {[100, 200, 500, 1000].map(n => <option key={n} value={n}>{n}</option>)}
            </select> records
          </label>
          {hasFilters && (
            <button onClick={clearFilters} title="Clear every filter — returns to the default month"
              className="h-9 px-3 rounded-lg border border-rose-200 bg-rose-50 text-sm font-medium text-rose-600 hover:bg-rose-100 flex items-center gap-1.5">
              <X className="w-3.5 h-3.5" /> Clear filter{activeFilters > 0 ? ` (${activeFilters})` : ""}
            </button>
          )}
        </div>

        {loadErr && <p className="text-xs text-rose-500 mt-2">⚠ {loadErr}</p>}

        {/* Table */}
        <div className="overflow-auto scrollbar-dark mt-3 max-h-[66vh]">
          <table className="w-full text-sm border border-slate-200">
            <thead className="sticky top-0 z-40">
              <tr className="bg-slate-50 border-b border-slate-200 text-left">
                {COLS.map(h => <th key={h} className="px-3 py-2.5 text-xs font-bold text-slate-600 whitespace-nowrap border-r border-slate-200 bg-slate-50 last:border-r-0">{h}</th>)}
              </tr>
              {/* Filter row */}
              <tr className="border-b border-slate-200">
                <th className="px-2 py-2 bg-white" />
                <th className="px-2 py-2 bg-white min-w-[140px]">
                  <DateRangePicker a={applied.dateA} b={applied.dateB}
                    onApply={(a, b) => { setDraft(p => ({ ...p, dateA: a, dateB: b })); setApplied(p => ({ ...p, dateA: a, dateB: b })); setPage(1) }} placeholder="This month" />
                </th>
                {([["csr", 90], ["customer", 120], ["address", 110], ["contact", 100], ["order", 110], ["qty", 70], ["price", 80], ["pageN", 100], ["tracking", 130]] as const).map(([k, w]) => (
                  <th key={k} className="px-2 py-2 bg-white" style={{ minWidth: w }}>
                    <input className={INP} value={(draft as any)[k]} onChange={e => setD(k, e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} />
                  </th>
                ))}
                <th className="px-2 py-2 bg-white min-w-[110px]">
                  <select className={INP} value={draft.courier} onChange={e => setD("courier", e.target.value)}>
                    <option>All</option>{courierOpts.map(c => <option key={c}>{c}</option>)}
                  </select>
                </th>
                <th className="px-2 py-2 bg-white min-w-[110px]">
                  <select className={INP} value={draft.status} onChange={e => setD("status", e.target.value)}>
                    {["All", "Unreceived", "Received", "Checked", "For Claim", "Claimed"].map(s => <option key={s}>{s}</option>)}
                  </select>
                </th>
                <th className="px-2 py-2 bg-white" />
                <th className="px-2 py-2 bg-white"><button onClick={applyFilters} className="h-9 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white"><Search className="w-4 h-4" /></button></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={COLS.length} className="py-14 text-center text-slate-400 text-sm"><RefreshCw className="w-5 h-5 animate-spin inline mr-2" /> Loading RTS orders…</td></tr>
              ) : paginated.length === 0 ? (
                <tr><td colSpan={COLS.length} className="py-12 text-center text-slate-400 text-sm">No RTS orders in this date range. (Returning / Returned orders from Pancake appear here.)</td></tr>
              ) : paginated.map((r, i) => {
                const m = metaOf(r)
                const st = statusOf(m)
                const addr = String(r.address || "")
                const isOpen = expanded.has(r.id)
                return (
                  <tr key={r.id} className={`border-b border-slate-100 align-top ${i % 2 === 0 ? "bg-white" : "bg-slate-50"} hover:bg-blue-50/40`}>
                    <td className="px-3 py-2.5 text-slate-400 border-r border-slate-100">{showFrom + i}</td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap border-r border-slate-100">{r.date_added}</td>
                    <td className="px-3 py-2.5 text-slate-700 border-r border-slate-100 max-w-[110px] truncate" title={r.csr_name}>{r.csr_name}</td>
                    <td className="px-3 py-2.5 text-slate-700 border-r border-slate-100 max-w-[140px] truncate" title={r.customer_name}>{r.customer_name}</td>
                    <td className="px-3 py-2.5 text-slate-600 border-r border-slate-100 max-w-[160px]">
                      {addr.length > 28 && !isOpen ? <>{addr.slice(0, 28)}… <button onClick={() => toggleExpand(r.id)} className="text-blue-600 hover:underline text-xs">more</button></>
                        : addr.length > 28 ? <>{addr} <button onClick={() => toggleExpand(r.id)} className="text-blue-600 hover:underline text-xs">less</button></> : (addr || "—")}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap border-r border-slate-100">{r.contact_no}</td>
                    <td className="px-3 py-2.5 text-slate-700 border-r border-slate-100 max-w-[150px] truncate" title={r.order_item}>{r.order_item}</td>
                    <td className="px-3 py-2.5 text-slate-700 tabular-nums border-r border-slate-100">{r.quantity}</td>
                    <td className="px-3 py-2.5 text-slate-700 tabular-nums whitespace-nowrap border-r border-slate-100">{Number(r.final_price || 0).toLocaleString("en-PH")}</td>
                    <td className="px-3 py-2.5 text-slate-600 border-r border-slate-100 max-w-[120px] truncate" title={r.page_name}>{r.page_name}</td>
                    <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap border-r border-slate-100">{r.tracking_no || "—"}</td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap border-r border-slate-100">{r.courier || "—"}</td>
                    <td className="px-3 py-2.5 border-r border-slate-100">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${STATUS_BADGE[st]}`}>{st}</span>
                      {m?.received_at && <span className="block text-[10px] text-slate-400 mt-0.5">{m.received_at.slice(0, 16)}{m.received_by ? ` · ${m.received_by}` : ""}</span>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap border-r border-slate-100">
                      {(() => {
                        const cs = claimStateOf(m)
                        return cs ? (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[cs]}`} title={m?.damage_note || m?.claim_note || ""}>
                            {cs === "Claimed" && m?.claim_amount ? `Claimed · ${peso(m.claim_amount)}` : cs}
                          </span>
                        ) : ""
                      })()}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setViewRow(r)} className="w-8 h-8 rounded border border-slate-300 flex items-center justify-center text-slate-500 hover:text-blue-600 hover:border-blue-400" title="View / tag for claim"><Search className="w-4 h-4" /></button>
                        {(() => {
                          const tno = String(r.tracking_no || "").trim()
                          const scan = scanByTracking.get(tno.toLowerCase())
                          if (!scan) return null
                          if (scan.restocked_at) return (
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 whitespace-nowrap"
                              title={`Naibalik ${scan.restocked_qty} pc(s) noong ${fmtDT(scan.restocked_at)}${scan.restocked_by ? ` · ${scan.restocked_by}` : ""}`}>
                              ↩ NASA STOCK
                            </span>
                          )
                          return (
                            <button onClick={() => setRestocking(r)}
                              className="w-8 h-8 rounded border border-emerald-300 flex items-center justify-center text-emerald-600 hover:bg-emerald-50"
                              title="Ibalik sa inventory (sa mismong batch na pinanggalingan)"><PackagePlus className="w-4 h-4" /></button>
                          )
                        })()}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Footer — entries + pagination + LHIKE totals */}
        <div className="flex items-center justify-between flex-wrap gap-2 mt-3 text-sm text-slate-600">
          <span>Showing {showFrom} to {showTo} of {filtered.length} entries</span>
          <div className="flex items-center gap-1">
            <button disabled={pageSafe <= 1} onClick={() => setPage(p => p - 1)} className="w-8 h-8 rounded border border-slate-300 flex items-center justify-center disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
            <span className="w-8 h-8 rounded bg-blue-600 text-white flex items-center justify-center text-sm">{pageSafe}</span>
            <button disabled={pageSafe >= pages} onClick={() => setPage(p => p + 1)} className="w-8 h-8 rounded border border-slate-300 flex items-center justify-center disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="mt-3 space-y-0.5 text-sm">
          <p><strong className="text-slate-800">Total Price</strong> : {totals.price.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</p>
          <p><strong className="text-slate-800">Total Shipping Fee</strong> : {totals.ship.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</p>
          <p><strong className="text-slate-800">Total Unreceived</strong> : {totals.unreceived.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</p>
          <p><strong className="text-slate-800">Total Received</strong> : {totals.received.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</p>
          <p><strong className="text-slate-800">Total Claimed</strong> : {totals.claimed.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</p>
        </div>
      </div>

      {/* Kumpirmasyon ng pagbabalik — ipinapakita ang MISMONG batch bago pumayag, dahil
          ang maling layer ay tahimik na sumisira sa halaga ng inventory. */}
      {restocking && (() => {
        const tno = String(restocking.tracking_no || "").trim()
        const scan = scanByTracking.get(tno.toLowerCase())
        const good = scan ? goodQtyOf(tno, scan.deducted_total) : 0
        const checked = (rts.meta[tno]?.items || []).length > 0
        const lines = scan ? planRestore(scan.batch_lines, good) : []
        return (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={() => setRestocking(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
              <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <PackagePlus className="w-5 h-5 text-emerald-600" /> Ibalik sa inventory
              </h2>
              <p className="text-xs text-slate-500 font-mono">{tno}</p>

              {lines.length === 0 ? (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  Walang maibabalik. {scan ? "Walang mabuting pirasong naiulat, o walang naitalang batch para sa parcel na ito." : "Wala itong Shipped Out record, kaya hindi malalaman kung saang batch babalik."}
                </p>
              ) : (
                <>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 space-y-1">
                    <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Babalik sa mismong batch</p>
                    {lines.map((l, i) => (
                      <p key={i} className="text-sm text-slate-700 flex justify-between tabular-nums">
                        <span>{l.batch_no || "—"}</span>
                        <span>{num(l.qty)} pc{l.qty === 1 ? "" : "s"} @ {peso(l.cog)}</span>
                      </p>
                    ))}
                  </div>
                  {!checked && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                      Hindi pa na-check ang parcel na ito, kaya ipinapalagay na <strong>lahat mabuti</strong>. Kung may sira,
                      i-check muna (🔍) para tama ang maibalik — ang sira ay hindi na maibebenta.
                    </p>
                  )}
                  <p className="text-xs text-slate-500">
                    Ang sira at nawala ay hindi ibinabalik sa sellable na stock — nagastos na ang COGS nila.
                  </p>
                </>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setRestocking(null)} disabled={restockBusy}
                  className="h-9 px-4 rounded-lg border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
                <button onClick={() => doRestock(restocking)} disabled={restockBusy || lines.length === 0}
                  className="h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50">
                  {restockBusy ? "Ibinabalik…" : `Ibalik ang ${num(good)} pc${good === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {camOpen && <CameraScanScreen rows={rows} rts={rts} cogHintOf={cogHintOf} onClose={() => setCamOpen(false)} />}
    </div>
  )
}

// ── VIEW RTS (Actions 🔍) — full LHIKE screen: readonly order info + per-item Goods/Damage/Loss
// inspection counts, Reason (Buyer/Courier) + remarks, parcel photo uploads, For Approval/Pending,
// RTS Fee, Submit → saved per tracking; HISTORY sidebar. Damage/Loss > 0 auto-tags For Claim.
const parseOrderItems = (orderItem: string) => String(orderItem || "").split(",").map(s => s.trim()).filter(Boolean).map(seg => {
  const m = seg.match(/^(\d+)\s*x\s*(.+)$/i)
  return m ? { qty: Number(m[1]) || 1, name: m[2].trim() } : { qty: 1, name: seg }
})
// Downscale a photo to a compact JPEG data URL (localStorage-friendly).
function fileToDataUrl(f: File): Promise<string> {
  return new Promise(resolve => {
    const img = new Image()
    const url = URL.createObjectURL(f)
    img.onload = () => {
      const max = 720
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement("canvas")
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale)
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL("image/jpeg", 0.6))
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve("") }
    img.src = url
  })
}

function ViewRtsRow({ l, req = false, children }: { l: string; req?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_1fr] gap-3 items-start py-2">
      <span className="text-sm text-slate-600 text-right pt-2">{l} {req && <span className="text-red-500">*</span>}</span>
      <div>{children}</div>
    </div>
  )
}

function ViewRtsScreen({ row, meta, onBack, onSubmit }: {
  row: RtsRow; meta: RtsMeta | undefined; onBack: () => void
  onSubmit: (patch: Partial<RtsMeta>) => void
}) {
  const seeded = meta?.items?.length ? meta.items
    : parseOrderItems(row.order_item).map(p => ({ name: p.name, qty: p.qty, goods: 0, damage: 0, loss: 0 }))
  const [items, setItems] = useState(seeded)
  const [reason, setReason] = useState<"" | "Buyer" | "Courier">(meta?.reason || "")
  const [reasonRemarks, setReasonRemarks] = useState(meta?.reason_remarks || "")
  const [images, setImages] = useState<string[]>(meta?.images || [])
  const [approval, setApproval] = useState<"For Approval" | "Pending">(meta?.approval_status || "Pending")
  const [remarks, setRemarks] = useState(meta?.remarks || "")
  const [rtsFee, setRtsFee] = useState(meta?.rts_fee ? String(meta.rts_fee) : "")
  const setIt = (i: number, k: "goods" | "damage" | "loss", v: string) =>
    setItems(list => list.map((it, x) => x === i ? { ...it, [k]: Number(v.replace(/[^\d]/g, "")) || 0 } : it))
  async function addFiles(files: FileList | null) {
    if (!files) return
    const urls: string[] = []
    for (const f of Array.from(files)) { const u = await fileToDataUrl(f); if (u) urls.push(u) }
    setImages(imgs => [...imgs, ...urls])
  }
  const RO = "min-h-[40px] rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-700"
  const NUM = "w-20 h-9 rounded-lg border px-2 text-sm text-right focus:outline-none"
  const F = ViewRtsRow   // module-level (inline definition remounts inputs per keystroke = focus loss)
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft className="w-4 h-4" /> Back to RTS Items</button>
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* Main card */}
        <div className="flex-1 w-full bg-white rounded-2xl border border-slate-200 p-6">
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 pb-4 mb-4 border-b border-slate-100"><Undo2 className="w-5 h-5" /> VIEW RTS</h1>
          <div className="max-w-3xl">
            <F l="Order Date" req><div className={`${RO} max-w-[240px]`}>{row.date_added || "—"}</div></F>
            <F l="User" req><div className={RO}>{row.csr_name || "—"}</div></F>
            <F l="Customer Fullname" req><div className={RO}>{row.customer_name || "—"}</div></F>
            <F l="Address"><div className={RO}>{row.address || "—"}</div></F>
            <F l="Province" req><div className={RO}>{row.province || "—"}</div></F>
            <F l="City" req><div className={RO}>{row.city || "—"}</div></F>
            <F l="Brgy" req><div className={RO}>{row.barangay || "—"}</div></F>
            <F l="Contact No." req><div className={RO}>{row.contact_no || "—"}</div></F>
            {/* Per-item inspection counts */}
            <F l="Order" req>
              <div className="space-y-3">
                {items.map((it, i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      <span className="text-slate-500 text-xs">Qty <span className="text-red-500">*</span></span>
                      <div className={`${RO} w-16 text-center py-1.5`}>{it.qty}</div>
                      <span className="text-teal-600 font-semibold text-xs">Goods <span className="text-red-500">*</span></span>
                      <input className={`${NUM} border-teal-400 focus:border-teal-600`} inputMode="numeric" value={it.goods || 0} onChange={e => setIt(i, "goods", e.target.value)} />
                      <span className="text-red-600 font-semibold text-xs">Damage <span className="text-red-500">*</span></span>
                      <input className={`${NUM} border-red-400 focus:border-red-600`} inputMode="numeric" value={it.damage || 0} onChange={e => setIt(i, "damage", e.target.value)} />
                      <span className="text-red-600 font-semibold text-xs">Loss <span className="text-red-500">*</span></span>
                      <input className={`${NUM} border-red-400 focus:border-red-600`} inputMode="numeric" value={it.loss || 0} onChange={e => setIt(i, "loss", e.target.value)} />
                      <span className="text-slate-500 text-xs">Item <span className="text-red-500">*</span></span>
                    </div>
                    <div className={`${RO} max-w-[320px] py-1.5`}>{it.name}</div>
                  </div>
                ))}
                {items.length === 0 && <div className={RO}>—</div>}
              </div>
            </F>
            {/* Reason */}
            <F l="Reason">
              <div className="flex items-center gap-4 flex-wrap">
                {(["Buyer", "Courier"] as const).map(rn => (
                  <label key={rn} className="flex items-center gap-1.5 text-sm text-slate-700 cursor-pointer">
                    <input type="radio" checked={reason === rn} onChange={() => setReason(rn)} className="accent-blue-600" /> {rn}
                  </label>
                ))}
                <input value={reasonRemarks} onChange={e => setReasonRemarks(e.target.value)} placeholder="Remarks"
                  className="h-9 flex-1 min-w-[180px] rounded-lg border border-slate-300 px-3 text-sm focus:outline-none focus:border-blue-400" />
              </div>
            </F>
            {/* Upload image + status */}
            <F l="Upload Image">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <span className="h-9 px-3 rounded-l-lg border border-slate-300 bg-white text-sm text-slate-500 flex items-center min-w-[160px]">📄</span>
                    <span className="h-9 px-3.5 -ml-2 rounded-r-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold flex items-center">Select file</span>
                    <input type="file" accept="image/*" multiple className="hidden" onChange={e => { addFiles(e.target.files); e.currentTarget.value = "" }} />
                  </label>
                  <p className="text-[11px] text-slate-400 mt-1">Upload multiple files</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-blue-600">Status</span>
                  {(["For Approval", "Pending"] as const).map(s => (
                    <label key={s} className="flex items-center gap-1.5 text-sm text-slate-700 cursor-pointer">
                      <input type="radio" checked={approval === s} onChange={() => setApproval(s)} className="accent-blue-600" /> {s}
                    </label>
                  ))}
                </div>
              </div>
            </F>
            <F l="Uploads">
              {images.length === 0 ? (
                <span className="text-sm text-red-500 underline pt-2 inline-block">No RTS Image Available</span>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {images.map((src, i) => (
                    <div key={i} className="relative group">
                      <img src={src} alt="" className="w-20 h-20 object-cover rounded-lg border border-slate-200" />
                      <button onClick={() => setImages(imgs => imgs.filter((_, x) => x !== i))}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white text-xs hidden group-hover:flex items-center justify-center">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </F>
            <F l="Parcel Qty" req><div className={`${RO} max-w-[240px]`}>{row.parcel_qty ?? "—"}</div></F>
            <F l="Price" req><div className={`${RO} max-w-[240px]`}>{Number(row.final_price || 0).toLocaleString("en-PH")}</div></F>
            <F l="Page" req><div className={RO}>{row.page_name || "—"}</div></F>
            <F l="Remarks"><textarea value={remarks} onChange={e => setRemarks(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm min-h-[90px] focus:outline-none focus:border-blue-400" /></F>
            <F l="Tracking No."><div className={RO}>{row.tracking_no || "—"}</div></F>
            <F l="Shipping Fee"><div className={`${RO} max-w-[240px]`}>{Number(row.shipping_fee) > 0 ? Number(row.shipping_fee).toLocaleString("en-PH") : ""}</div></F>
            <F l="Courier"><div className={RO}>{row.courier || "—"}</div></F>
            <F l="RTS Fee"><input value={rtsFee} onChange={e => setRtsFee(e.target.value.replace(/[^\d.]/g, ""))}
              className="h-10 w-[180px] rounded-lg border border-slate-300 px-3 text-sm focus:outline-none focus:border-blue-400" /></F>
          </div>
          <div className="flex gap-2 mt-5 pt-4 border-t border-slate-100">
            <button onClick={() => onSubmit({ items, reason, reason_remarks: reasonRemarks.trim(), images, approval_status: approval, remarks: remarks.trim(), rts_fee: Number(rtsFee) || 0 })}
              className="px-5 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700">Submit</button>
            <button onClick={onBack} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50">Cancel</button>
          </div>
        </div>
        {/* HISTORY sidebar */}
        <div className="w-full lg:w-72 shrink-0 bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="flex items-center gap-2 text-lg font-bold text-blue-600 mb-3">🏳 HISTORY</h2>
          <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 text-sm">
            <div className="px-4 py-2.5 bg-slate-50 font-bold text-slate-800">RTS requested by</div>
            <div className="px-4 py-2.5 text-slate-700">{meta?.requested_by || "—"}</div>
            <div className="px-4 py-2.5 bg-slate-50 font-bold text-slate-800">RTS requested Date</div>
            <div className="px-4 py-2.5 text-slate-700">{meta?.requested_at || "—"}</div>
            <div className="px-4 py-2.5 bg-slate-50 font-bold text-slate-800">Remarks</div>
            <div className="px-4 py-2.5 text-slate-700">{meta?.remarks || meta?.damage_note || "—"}</div>
            <div className="px-4 py-2.5 bg-slate-50 font-bold text-slate-800">Claimed date</div>
            <div className="px-4 py-2.5 text-slate-700">{meta?.claimed_at || "—"}</div>
            <div className="px-4 py-2.5 bg-slate-50 font-bold text-slate-800">Uploaded by</div>
            <div className="px-4 py-2.5 text-slate-700">{meta?.updated_by || "—"}</div>
            <div className="px-4 py-2.5 bg-slate-50 font-bold text-slate-800">Uploaded date</div>
            <div className="px-4 py-2.5 text-slate-700">{meta?.updated_at || "—"}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── UPLOAD CLAIMS (LHIKE screen + template) — template columns: TRACKING NUMBER +
// DATE OF CLAIM YYYY-MM-DD (blue header, gaya ng reference). Walang amount column:
// ang claim amount = the parcel's PRICE (computed from the loaded RTS row).
const CLAIM_HEADERS = ["TRACKING NUMBER", "DATE OF CLAIM\nYYYY-MM-DD"]
function downloadClaimsTemplate() {
  const rows = [CLAIM_HEADERS, ["JT0020342874549", "2026-07-10"]]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  for (let i = 0; i < CLAIM_HEADERS.length; i++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c: i })]
    if (cell) cell.s = {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "2E75B6" } },   // blue header, LHIKE-style
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
    }
  }
  ws["!rows"] = [{ hpt: 34 }]
  ws["!cols"] = [{ wch: 24 }, { wch: 18 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
  XLSX.writeFile(wb, "Upload_Claims_template.xlsx")
}

function ClaimsScreen({ rows, onBack, onApply }: {
  rows: RtsRow[]; onBack: () => void
  onApply: (claims: { tracking: string; amount: number; date?: string }[], skipped: number) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState("")
  const [issues, setIssues] = useState<string[]>([])

  function doUpload() {
    if (!file) return setErr("Upload Excel File is required.")
    setErr(""); setIssues([]); setUploading(true)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const wb = XLSX.read(reader.result as ArrayBuffer, { type: "array" })
        const raw = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[wb.SheetNames[0]], { defval: "" })
        const key = (k: string) => k.toLowerCase().replace(/[^a-z]/g, "")
        const claims: { tracking: string; amount: number; date?: string }[] = []
        const probs: string[] = []
        let skipped = 0
        for (const row of raw) {
          const get = (...names: string[]) => { for (const [k, v] of Object.entries(row)) if (names.includes(key(k))) return v; return "" }
          const tracking = String(get("trackingnumber", "trackingno", "tracking")).trim()
          if (!tracking) { skipped++; continue }
          // Date of Claim — tanggap ang typed "YYYY-MM-DD", Excel date cells, at raw serials.
          const rawDate = get("dateofclaimyyyymmdd", "dateofclaim", "claimdate", "date")
          let date = ""
          if (rawDate instanceof Date) date = `${rawDate.getFullYear()}-${String(rawDate.getMonth() + 1).padStart(2, "0")}-${String(rawDate.getDate()).padStart(2, "0")}`
          else if (typeof rawDate === "number" && rawDate > 20000) date = new Date(Math.round((rawDate - 25569) * 86400 * 1000)).toISOString().slice(0, 10)
          else date = String(rawDate).trim().slice(0, 10)
          if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) { skipped++; probs.push(`${tracking} — invalid date "${String(rawDate)}" (use YYYY-MM-DD)`); continue }
          // Amount = the parcel's price from the loaded RTS list.
          const match = rows.find(r => String(r.tracking_no || "").toLowerCase() === tracking.toLowerCase())
          if (!match) probs.push(`${tracking} — not in the loaded RTS list (claimed without an amount; widen the Order Date range to pick up the price)`)
          claims.push({ tracking, amount: Number(match?.final_price || 0), ...(date ? { date } : {}) })
        }
        if (claims.length === 0) { setErr("No claims found — fill the template rows first."); setIssues(probs); setUploading(false); return }
        setIssues(probs)
        onApply(claims, skipped)
      } catch { setErr("Couldn't read that file — use the downloaded template format.") }
      setUploading(false)
    }
    reader.readAsArrayBuffer(file)
  }

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft className="w-4 h-4" /> Back to RTS Items</button>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-3xl">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 pb-4 mb-4 border-b border-slate-100"><Upload className="w-5 h-5" /> UPLOAD CLAIMS</h1>
        <div className="space-y-5">
          <div className="grid grid-cols-[170px_1fr] items-center gap-3">
            <span className="text-sm text-slate-600 text-right pr-2">Template</span>
            <div>
              <button onClick={downloadClaimsTemplate} className="text-sm text-blue-600 hover:underline text-left w-fit">Click to Download Sample File</button>
              <p className="text-[11px] text-slate-400 mt-1">Columns: TRACKING NUMBER · DATE OF CLAIM (YYYY-MM-DD). Claim amount = the parcel's price (automatic).</p>
            </div>
          </div>
          <div className="grid grid-cols-[170px_1fr] items-center gap-3">
            <span className="text-sm text-slate-600 text-right pr-2">Upload Excel File <span className="text-red-500">*</span></span>
            <div className="flex items-center gap-2">
              <div className="flex-1 max-w-md h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white flex items-center text-slate-500 truncate">{file ? file.name : ""}</div>
              <label className="h-10 px-3.5 rounded-lg border border-slate-300 bg-slate-100 hover:bg-slate-200 text-sm text-slate-700 cursor-pointer flex items-center">
                Select file
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { setFile(e.target.files?.[0] || null); setErr("") }} />
              </label>
            </div>
          </div>
        </div>
        {err && <p className="text-sm text-rose-600 mt-4">{err}</p>}
        {issues.length > 0 && (
          <ul className="text-xs text-amber-600 mt-2 space-y-0.5 list-disc pl-5">
            {issues.slice(0, 6).map((p, i) => <li key={i}>{p}</li>)}
            {issues.length > 6 && <li>… and {issues.length - 6} more</li>}
          </ul>
        )}
        <div className="flex gap-2 mt-6 pt-4 border-t border-slate-100">
          <button onClick={doUpload} disabled={uploading} className="px-5 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50">{uploading ? "Uploading…" : "Upload"}</button>
          <button onClick={onBack} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50">Back</button>
        </div>
      </div>
    </div>
  )
}

// ── CAMERA SCAN (mobile) — full-screen scanner: phone camera reads the waybill barcode.
// Mode toggle laging kita sa taas. RECEIVE = fully automatic (scan → sound → status update,
// walang confirmation). CHECK = after scan, bottom sheet w/ per-item Goods/Damage/Loss steppers
// + laging-kita na malaking CONFIRM button. Duplicate scan → error sound + "ALREADY SCANNED".
// Camera starts on tap (user gesture unlocks camera permission AND WebAudio beeps).
// May manual input fallback sa baba (hardware scanner / walang camera).
type CogHint = { name: string; qty: number; cog: number; batchNo: string }

function CameraScanScreen({ rows, rts, cogHintOf, onClose }: {
  rows: RtsRow[]; rts: ReturnType<typeof useRtsMeta>
  cogHintOf: (tracking: string) => CogHint[]
  onClose: () => void
}) {
  const [mode, setMode] = useState<"receive" | "check">("receive")
  const videoRef = useRef<HTMLVideoElement>(null)
  const [camState, setCamState] = useState<"idle" | "starting" | "on" | "error">("idle")
  const [camErr, setCamErr] = useState("")
  const [manual, setManual] = useState("")
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; title: string; sub: string } | null>(null)
  const [sessionR, setSessionR] = useState(0)
  const [sessionC, setSessionC] = useState(0)
  const [checkSheet, setCheckSheet] = useState<null | { row: RtsRow; items: RtsItemCount[]; note: string }>(null)
  // Popup ng COG pagkatanggap — humihinto ang scan hanggang mapindot ang OK, dahil
  // kailangang MAGLAKAD ang staff papunta sa tamang box bago ang susunod na parcel.
  const [cogPopup, setCogPopup] = useState<null | { code: string; customer: string; hints: CogHint[] }>(null)
  const controlsRef = useRef<{ stop: () => void } | null>(null)
  const lastRef = useRef({ code: "", at: 0 })
  const pausedRef = useRef(false)
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // refs para laging sariwa ang data sa continuous-decode callback
  const modeRef = useRef(mode); useEffect(() => { modeRef.current = mode }, [mode])
  const rowsRef = useRef(rows); useEffect(() => { rowsRef.current = rows }, [rows])
  const metaRef = useRef(rts.meta); useEffect(() => { metaRef.current = rts.meta }, [rts.meta])
  useEffect(() => () => { controlsRef.current?.stop() }, [])

  function showBanner(kind: "ok" | "err", title: string, sub: string) {
    if (bannerTimer.current) clearTimeout(bannerTimer.current)
    setBanner({ kind, title, sub })
    bannerTimer.current = setTimeout(() => setBanner(null), kind === "ok" ? 2000 : 3200)
  }

  async function startCamera() {
    controlsRef.current?.stop()
    // Tinatawag ito mula sa isang tap — doon lang pumapayag ang iOS/Android na
    // buhayin ang WebAudio. Kung hindi dito, tahimik ang KAUNA-UNAHANG beep.
    primeScanSound()
    setCamState("starting"); setCamErr("")
    // High-res back camera — dense waybill barcodes need the extra pixels to decode.
    const constraints: MediaStreamConstraints = {
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    }
    try {
      const BD = (window as any).BarcodeDetector
      if (BD) {
        // Native BarcodeDetector — fastest + most reliable path (Android Chrome). We own the
        // stream so the feed always renders (explicit play) and we scan the FULL frame.
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        const video = videoRef.current!
        video.srcObject = stream
        await video.play().catch(() => {})
        setCamState("on")
        let detector: any
        try {
          const supported: string[] | undefined = await BD.getSupportedFormats?.()
          const want = ["code_128", "code_39", "codabar", "ean_13", "ean_8", "itf", "upc_a", "upc_e", "qr_code", "data_matrix"]
          const formats = supported ? want.filter(f => supported.includes(f)) : want
          detector = new BD(formats.length ? { formats } : undefined)
        } catch { detector = new BD() }
        let stopped = false
        let timer: ReturnType<typeof setTimeout> | null = null
        const tick = async () => {
          if (stopped) return
          try { const codes = await detector.detect(video); if (codes?.length) handleDecode(codes[0].rawValue) } catch {}
          if (!stopped) timer = setTimeout(tick, 120)
        }
        tick()
        controlsRef.current = { stop: () => { stopped = true; if (timer) clearTimeout(timer); stream.getTracks().forEach(t => t.stop()) } }
      } else {
        // Fallback (iOS Safari / older browsers): ZXing over the same high-res constraints.
        const { BrowserMultiFormatReader } = await import("@zxing/browser")
        const reader = new BrowserMultiFormatReader()
        const controls = await reader.decodeFromConstraints(constraints, videoRef.current!, result => { if (result) handleDecode(result.getText()) })
        controlsRef.current = controls
        setCamState("on")
      }
    } catch (e: any) {
      setCamState("error")
      setCamErr(e?.message || "Camera unavailable")
    }
  }

  function handleDecode(codeRaw: string, manualEntry = false) {
    const code = codeRaw.trim()
    if (!code || pausedRef.current) return
    const now = Date.now()
    // Camera frames repeat while the barcode is in view — 1.5s cooldown per same code.
    // Manual / hardware-scanner entries are deliberate, so they skip the guard (a real
    // re-scan must ALWAYS get the duplicate error sound + message).
    if (!manualEntry && lastRef.current.code === code && now - lastRef.current.at < 1500) return
    lastRef.current = { code, at: now }

    const row = rowsRef.current.find(r => String(r.tracking_no || "").toLowerCase() === code.toLowerCase())
    const m = row ? metaRef.current[String(row.tracking_no)] : undefined
    if (!row) { beep("error"); showBanner("err", "NOT FOUND", `${code} — not in the RTS list (check the Order Date range)`); return }

    if (modeRef.current === "receive") {
      if (m?.received_at) {
        beep("error")
        showBanner("err", "ALREADY SCANNED", `${code} — received na noong ${m.received_at}${m.received_by ? ` · ${m.received_by}` : ""}`)
        return
      }
      rts.markReceived(String(row.tracking_no))
      beep("receive")
      setSessionR(n => n + 1)
      showBanner("ok", "RECEIVED ✓", `${row.customer_name || ""} · ${code}`)
      // May item bang dalawa ang presyo? Sabihin AGAD kung aling COG ang parcel na
      // ito, para sa tamang box ito maisalansan — hindi na hulaan mamaya.
      const hints = cogHintOf(String(row.tracking_no))
      if (hints.length) {
        pausedRef.current = true
        setCogPopup({ code, customer: String(row.customer_name || ""), hints })
      }
    } else {
      if (m?.checked_at) {
        beep("error")
        showBanner("err", "ALREADY CHECKED", `${code} — checked na noong ${m.checked_at}${m.checked_by ? ` · ${m.checked_by}` : ""}`)
        return
      }
      beep("check")
      pausedRef.current = true
      const items: RtsItemCount[] = (m?.items?.length ? m.items : parseOrderItems(row.order_item).map(p => ({ name: p.name, qty: p.qty, goods: p.qty, damage: 0, loss: 0 })))
      setCheckSheet({ row, items: items.map(i => ({ ...i })), note: "" })
    }
  }

  function confirmCheck() {
    if (!checkSheet) return
    const t = String(checkSheet.row.tracking_no)
    rts.markChecked(t)
    rts.saveDetails(t, { items: checkSheet.items, ...(checkSheet.note.trim() ? { reason_remarks: checkSheet.note.trim() } : {}) })
    setSessionC(n => n + 1)
    const dmg = checkSheet.items.some(i => i.damage > 0 || i.loss > 0)
    showBanner("ok", dmg ? "CHECKED — TAGGED FOR CLAIM ⚠" : "CHECKED ✓", checkSheet.row.customer_name || "")
    setCheckSheet(null)
    pausedRef.current = false
  }
  function cancelCheck() { setCheckSheet(null); pausedRef.current = false }

  const setSheetItem = (i: number, k: "goods" | "damage" | "loss", v: number) =>
    setCheckSheet(s => s ? { ...s, items: s.items.map((it, x) => x === i ? { ...it, [k]: Math.max(0, v) } : it) } : s)

  const Step = ({ v, onChange, color }: { v: number; onChange: (n: number) => void; color: string }) => (
    <div className="flex items-center justify-center gap-1">
      <button onClick={() => onChange(v - 1)} className="w-10 h-10 rounded-lg bg-slate-100 text-xl font-bold text-slate-600 active:bg-slate-200">−</button>
      <span className={`w-9 text-center text-lg font-extrabold tabular-nums ${color}`}>{v}</span>
      <button onClick={() => onChange(v + 1)} className="w-10 h-10 rounded-lg bg-slate-100 text-xl font-bold text-slate-600 active:bg-slate-200">+</button>
    </div>
  )

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950 flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <span className="text-white font-bold flex items-center gap-2"><Camera className="w-5 h-5" /> RTS Scanner</span>
        <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/10 text-white flex items-center justify-center"><X className="w-5 h-5" /></button>
      </div>
      {/* Mode toggle — laging kita */}
      <div className="px-4 pb-3 grid grid-cols-2 gap-2 shrink-0">
        <button onClick={() => setMode("receive")}
          className={`h-12 rounded-xl text-sm font-extrabold tracking-wide ${mode === "receive" ? "bg-teal-500 text-white" : "bg-white/10 text-white/60"}`}>SCAN &amp; RECEIVE</button>
        <button onClick={() => setMode("check")}
          className={`h-12 rounded-xl text-sm font-extrabold tracking-wide ${mode === "check" ? "bg-red-600 text-white" : "bg-white/10 text-white/60"}`}>SCAN &amp; CHECK</button>
      </div>

      {/* Camera area */}
      <div className="relative flex-1 min-h-0 bg-black">
        <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
        {camState !== "on" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            {camState === "error" ? (
              <>
                <p className="text-red-400 text-sm font-semibold">Camera unavailable</p>
                <p className="text-white/50 text-xs">{camErr}. Needs HTTPS (or localhost) + camera permission. You can still type or use the hardware scanner below.</p>
                <button onClick={startCamera} className="mt-1 h-11 px-5 rounded-xl bg-white/10 text-white text-sm font-bold">Try Again</button>
              </>
            ) : (
              <button onClick={startCamera} disabled={camState === "starting"}
                className="h-14 px-8 rounded-2xl bg-blue-600 text-white text-base font-extrabold flex items-center gap-2 disabled:opacity-60">
                <Camera className="w-5 h-5" /> {camState === "starting" ? "Starting…" : "START CAMERA"}
              </button>
            )}
          </div>
        )}
        {/* Scan result banner */}
        {banner && (
          <div className={`absolute inset-x-3 top-3 rounded-xl px-4 py-3 text-white shadow-xl ${banner.kind === "ok" ? "bg-emerald-600" : "bg-red-600"}`}>
            <p className="font-extrabold text-sm">{banner.title}</p>
            <p className="text-xs opacity-90 break-all">{banner.sub}</p>
          </div>
        )}
      </div>

      {/* Bottom panel — session counters + manual fallback */}
      <div className="bg-white rounded-t-2xl px-4 pt-3 pb-4 shrink-0 space-y-2.5">
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl bg-teal-50 border border-teal-100 py-1.5">
            <p className="text-[10px] uppercase tracking-wider text-teal-600">Session · Received</p>
            <p className="text-2xl font-extrabold text-teal-700 tabular-nums">{sessionR}</p>
          </div>
          <div className="rounded-xl bg-red-50 border border-red-100 py-1.5">
            <p className="text-[10px] uppercase tracking-wider text-red-500">Session · Checked</p>
            <p className="text-2xl font-extrabold text-red-600 tabular-nums">{sessionC}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <input value={manual} onChange={e => setManual(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && manual.trim()) { handleDecode(manual, true); setManual("") } }}
            placeholder="No camera? Type or hardware-scan the Tracking No."
            className="flex-1 h-11 rounded-xl border border-slate-300 px-3 text-sm font-mono focus:outline-none focus:border-blue-500" />
          <button onClick={() => { if (manual.trim()) { handleDecode(manual, true); setManual("") } }}
            className="h-11 px-4 rounded-xl bg-blue-600 text-white font-bold text-sm">Go</button>
        </div>
      </div>

      {/* CHECK confirmation sheet — big sticky CONFIRM, laging kita */}
      {/* POPUP NG COG — malaki ang presyo dahil mula sa kabilang dulo ng mesa ito
          binabasa. Sadyang blocking: kailangang MAILAGAY muna sa tamang box ang
          parcel bago magpatuloy ang scan, kaya OK ang tanging labasan. z-20 para
          nasa ibabaw ng check sheet kung sakaling magkasabay. */}
      {cogPopup && (
        <div className="absolute inset-0 z-20 bg-black/75 flex items-center justify-center p-5">
          <div className="bg-white w-full max-w-sm rounded-2xl overflow-hidden">
            <div className="px-5 py-3 bg-violet-600 text-white">
              <p className="text-xs font-bold uppercase tracking-wider">Saang box ibabalik?</p>
              <p className="text-[11px] opacity-80 font-mono truncate">{cogPopup.code}{cogPopup.customer ? ` · ${cogPopup.customer}` : ""}</p>
            </div>
            <div className="px-5 py-4 space-y-3">
              {cogPopup.hints.map((h, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-extrabold text-slate-900 truncate">{h.name}</p>
                    <p className="text-[11px] text-slate-400">{num(h.qty)} pc{h.qty === 1 ? "" : "s"} · {h.batchNo}</p>
                  </div>
                  <p className="text-3xl font-extrabold text-violet-700 tabular-nums whitespace-nowrap">₱{num(h.cog)}<span className="text-xs font-bold text-slate-400 ml-1">COG</span></p>
                </div>
              ))}
              <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                Dalawa ang presyo ng item na ito sa stock — ilagay ang parcel sa box ng
                COG na nakasulat sa itaas, para tama rin ang babalikan pag-restock.
              </p>
            </div>
            <button onClick={() => { setCogPopup(null); pausedRef.current = false }}
              className="w-full h-14 bg-violet-600 hover:bg-violet-700 text-white text-base font-extrabold">
              OK — NAILAGAY SA TAMANG BOX
            </button>
          </div>
        </div>
      )}

      {checkSheet && (
        <div className="absolute inset-0 z-10 bg-black/60 flex items-end">
          <div className="bg-white w-full rounded-t-2xl max-h-[85%] flex flex-col">
            <div className="px-4 py-3 border-b border-slate-100 shrink-0">
              <p className="font-extrabold text-slate-900 truncate">{checkSheet.row.customer_name || "—"}</p>
              <p className="text-xs text-slate-400 font-mono">{checkSheet.row.tracking_no}</p>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              {checkSheet.items.map((it, i) => (
                <div key={i} className="rounded-xl border border-slate-200 p-3">
                  <p className="font-semibold text-slate-800 text-sm mb-2">{it.name} <span className="text-slate-400 font-normal">· ordered {it.qty}</span></p>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-center">
                      <p className="text-[10px] uppercase tracking-wider text-teal-600 font-bold mb-1">Goods</p>
                      <Step v={it.goods} onChange={n => setSheetItem(i, "goods", n)} color="text-teal-700" />
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] uppercase tracking-wider text-red-500 font-bold mb-1">Damage</p>
                      <Step v={it.damage} onChange={n => setSheetItem(i, "damage", n)} color="text-red-600" />
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] uppercase tracking-wider text-red-500 font-bold mb-1">Loss / Kulang</p>
                      <Step v={it.loss} onChange={n => setSheetItem(i, "loss", n)} color="text-red-600" />
                    </div>
                  </div>
                </div>
              ))}
              <input value={checkSheet.note} onChange={e => setCheckSheet(s => s ? { ...s, note: e.target.value } : s)}
                placeholder="Note (what is damaged / missing — optional)"
                className="w-full h-11 rounded-xl border border-slate-300 px-3 text-sm focus:outline-none focus:border-blue-500" />
              {checkSheet.items.some(i => i.damage > 0 || i.loss > 0) && (
                <p className="text-xs text-rose-600 font-semibold">⚠ Damage/shortage noted — tagged FOR CLAIM automatically on Confirm.</p>
              )}
            </div>
            <div className="px-4 pt-2 pb-4 border-t border-slate-100 shrink-0 space-y-2">
              <button onClick={confirmCheck}
                className="w-full h-14 rounded-2xl bg-emerald-600 active:bg-emerald-700 text-white text-lg font-extrabold tracking-wide shadow-lg">CONFIRM ✓</button>
              <button onClick={cancelCheck} className="w-full h-10 rounded-xl text-slate-500 text-sm font-semibold">Cancel — do not save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
