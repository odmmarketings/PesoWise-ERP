"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import * as XLSX from "xlsx-js-style"
import {
  ScanBarcode, ScanLine, Camera, X, RefreshCw, RotateCcw, FileSpreadsheet,
  ClipboardList, CheckCircle2, Truck, CalendarDays,
} from "lucide-react"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import { useActivePages } from "@/lib/pages-store"
import { useUnitCodes } from "@/lib/unit-codes-store"
import { useProductItems } from "@/lib/product-items-store"
import { useStockReleases } from "@/lib/stock-releases-store"
import { useProductBatches, fifoOrder, batchRemaining, type ProductBatch } from "@/lib/product-batches-store"
import { useShippedOutScans, type ParcelInfo } from "@/lib/shipped-out-store"
import { buildRecipes, explodeOrderItems, isDeductable } from "@/lib/shipped-out-sync"
import { cachedJson, PANCAKE_CONCURRENCY } from "@/lib/pancake-cache"
import { scanSound, primeScanSound } from "@/lib/scan-sound"
import { courierOf, courierTally, COURIERS, COURIER_COLOR } from "@/lib/courier"
import { HelpButton, type HelpSection } from "@/components/business/HelpButton"

// ──────────────────────────────────────────────────────────────────────────────
// SHIPPED OUT (Barcode) — DALAWANG talaan, IISANG bawas.
//
//   MANUAL SCAN (dito)  — i-scan ang waybill sa paglabas. Talaan ng warehouse: sino,
//                         kailan, ilan. HINDI ito bumabawas ng inventory.
//   PANCAKE SHIPPED     — kapag na-detect na umalis na ang parcel (Shipped/Delivered/
//                         Returning/Returned), doon nababawasan ang inventory sa pamamagitan
//                         ng unit-code recipe → product_items.released + stock_releases.
//
// Ganito para iisa ang pinagmumulan ng bawas at maikukumpara pa rin ang binilang ng
// warehouse sa aktwal na umalis. Ang `deducted` sa DB ang nag-iisang pinto — conditional
// update ang nagbabantay, kaya hindi madodoble kahit sabay tumakbo ang dalawang device.
// Pangalawang tab = SHIPPED OUT REPORT, may date filter, courier tally, at paghahambing.
// ──────────────────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0")
const dstr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01` }
const prettyDate = (s: string) => {
  if (!s) return "—"
  const d = new Date(s + "T00:00:00")
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })
}
const fmtDT = (iso: string) => {
  if (!iso) return ""
  const d = new Date(iso)
  return isNaN(d.getTime()) ? "" : d.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}
const num = (n: number) => (isFinite(n) ? n : 0).toLocaleString("en-PH")
const peso = (n: number) => "₱" + (isFinite(n) ? n : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Scanner feedback — galing sa @/lib/scan-sound para eksaktong pareho ng RTS.
const beep = scanSound

async function fetchPageRows(apiKey: string, pageId: string, from: string, to: string, noCache = false): Promise<any[]> {
  const json = await cachedJson(
    `/api/pancake/orders?api_key=${encodeURIComponent(apiKey)}&page_id=${encodeURIComponent(pageId)}`
    + `&from=${from}&to=${to}&phase=rows&basis=sales_order${noCache ? "&nocache=1" : ""}`,
    { force: noCache }
  )
  return Array.isArray(json.rows) ? json.rows : []
}
async function mapLimit<T>(items: T[], limit: number, fn: (i: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) await fn(items[i++]) }))
}

// Dalawa lang ang courier natin: SPX at J&T (tingnan ang src/lib/courier.ts — may
// tracking-prefix fallback kapag blangko ang partner_name). Lumalabas lang ang OTHER
// kung may parcel talagang hindi matukoy — hindi ito itinatago para walang mawala.
const MAIN_COURIERS = COURIERS
const courierLabel = (raw: string, tracking = "") => courierOf(raw, tracking)
const COURIER_STYLE: Record<string, { bg: string; text: string; dot: string }> = {
  "SPX": { bg: "bg-orange-50", text: "text-orange-700", dot: COURIER_COLOR["SPX"] },
  "J&T": { bg: "bg-red-50", text: "text-red-700", dot: COURIER_COLOR["J&T"] },
  "OTHER": { bg: "bg-slate-100", text: "text-slate-600", dot: COURIER_COLOR["OTHER"] },
}
/** Fixed na tally: laging kita ang SPX at J&T (kahit 0); lalabas ang OTHER kung may laman. */
function courierTallyOf(list: { courier: string; tracking_no: string }[]) {
  return courierTally(list, s => ({ name: s.courier, tracking: s.tracking_no }))
}
function CourierBadge({ courier, tracking }: { courier: string; tracking?: string }) {
  const l = courierLabel(courier, tracking)
  const st = COURIER_STYLE[l]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold ${st.bg} ${st.text}`}
      title={courier || "from tracking prefix"}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: st.dot }} />
      {l}
    </span>
  )
}

const HELP: HelpSection[] = [
  {
    title: "Dalawang talaan, IISANG bawas",
    body: [
      "MANUAL SCAN (dito): talaan ng warehouse — sino ang nag-scan, kailan, ilan. HINDI ito bumabawas ng inventory.",
      "PANCAKE SHIPPED: kapag na-detect na umalis na ang parcel, DOON bumababa ang inventory — awtomatiko, walang pipindutin.",
      "Kaya iisa lang ang pinagmumulan ng bawas, at maikukumpara pa rin kung ilan ang binilang ng warehouse laban sa ilan ang totoong umalis.",
    ],
  },
  {
    title: "Bakit 'HINDI PA BAWAS' ang karamihan ng scan",
    body: [
      "Normal iyon. Karaniwan, mas maaga ang scan kaysa sa pagkuha ng rider: napakete → nag-scan ang warehouse → kinuha ng rider → naging Shipped sa Pancake → saka bumaba ang inventory.",
      "Ang ibig sabihin ng 'HINDI PA BAWAS' ay nasa pintuan pa ang parcel. Mababawas iyon mamaya nang kusa.",
      "⚠ Bantayan ang 'Hindi pa bawas' na counter. Kapag tuloy-tuloy itong lumalaki, may parcel na umalis na pero hindi minarkahang Shipped sa POS.",
    ],
  },
  {
    title: "Hindi kailangan ng scan para mabawasan",
    body: [
      "Kahit walang mag-scan ni isa, bumababa pa rin ang stock basta na-Shipped sa Pancake.",
      "Kaya ang nakalimutang i-scan ay hindi na butas sa inventory — lumalabas iyon sa 'Hindi na-scan' bilang usapin ng disiplina ng warehouse, hindi bilang maling bilang.",
    ],
  },
  {
    title: "Kapag may tanong na lumabas — 'Saan kayo kumukuha?'",
    body: [
      "Lumalabas LANG ito kapag may item na may dalawa o higit pang presyo na sabay na may laman (hal. ₱35 at ₱30 na Lumyra).",
      "Isang sagot kada sesyon, hindi kada scan. Pagkasagot, tuloy-tuloy na ang scan hanggang maubos ang piniling batch — saka lang ito magtatanong ulit.",
      "Ang sagot mo ang susundin ng bawas, hindi ang hula ng FIFO. Ito rin ang babasahin pagbalik ng parcel kapag nag-RTS, para tama ang box na pagbabalikan.",
      "Ubusin muna ang lumang / mas murang stock — nakatatak sa unang pagpipilian ang PINAKALUMA.",
    ],
  },
  {
    title: "Kapag walang nababawas sa isang parcel",
    body: [
      "Lalabas ang dilaw na 'WALANG KATUGMANG UNIT CODE'. Ibig sabihin, walang unit code na tugma sa pangalan ng produkto sa order.",
      "Ayusin sa Unit Codes: gawing EKSAKTONG katumbas ng pangalan sa Pancake ang code. Naitala pa rin ang scan — ang bawas lang ang hindi natuloy.",
    ],
  },
]

type Banner = { kind: "ok" | "warn" | "err"; title: string; sub: string }

// ── PILI NG BATCH ────────────────────────────────────────────────────────────
// Lumalabas LANG kapag may tunay na pagpipilian: dalawa o higit pang batch na may
// laman at MAGKAIBA ang presyo. Isang pili kada sesyon — hindi kada scan — kaya
// hindi ito nagiging ritwal na pinipindot nang hindi binabasa. Ang sagot dito ang
// nananaig sa hula ng FIFO pagdating ng bawas.
// z-[110]: dapat lumutang pati sa ibabaw ng camera overlay (z-[100]).
function BatchPickModal({ items, initial, onConfirm, onClose }: {
  items: { itemId: string; name: string; choices: ProductBatch[] }[]
  initial: Record<string, string>
  onConfirm: (picks: Record<string, string>) => void
  onClose: () => void
}) {
  const [picks, setPicks] = useState<Record<string, string>>(initial)
  const allPicked = items.every(it => picks[it.itemId])
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[88vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-800">Saan kayo kumukuha ngayon?</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            May higit sa isang presyo ang stock — sabihin kung aling batch ang pisikal na
            pinagkukunan. Isang beses lang ito kada sesyon.
          </p>
        </div>
        <div className="px-5 py-3 space-y-4 overflow-auto">
          {items.map(it => (
            <div key={it.itemId}>
              <p className="text-sm font-bold text-slate-800 mb-1.5">{it.name}</p>
              <div className="space-y-1.5">
                {it.choices.map((b, i) => (
                  <button key={b.id} type="button" onClick={() => setPicks(p => ({ ...p, [it.itemId]: b.id }))}
                    className={`w-full flex items-center justify-between rounded-xl border-2 px-3 py-2.5 text-left transition-colors ${picks[it.itemId] === b.id ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:border-slate-300"}`}>
                    <span className="min-w-0">
                      <span className="text-sm font-semibold text-slate-800">{b.batch_no || "Batch"} · ₱{num(b.cog)}</span>
                      {/* Ang pinakaluma ay laging una sa listahan (fifoOrder) at may tatak,
                          para ang tamang ugali — ubusin muna ang luma — ang pinakamadaling pindutin. */}
                      {i === 0 && <span className="ml-1.5 text-[10px] font-bold text-emerald-700 bg-emerald-100 rounded-full px-1.5 py-0.5 whitespace-nowrap">PINAKALUMA — unahin</span>}
                      <span className="block text-[11px] text-slate-400">{b.received_date || "walang petsa"} · {num(batchRemaining(b))} pcs natitira</span>
                    </span>
                    {picks[it.itemId] === b.id && <span className="text-emerald-600 font-bold ml-2">✓</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            💡 Ubusin muna ang lumang / mas murang stock bago buksan ang bagong batch —
            para hindi ma-stuck ang lumang bilihin at tama ang COGS ng bawat labas.
          </p>
        </div>
        <div className="px-5 py-4 border-t border-slate-200 bg-slate-50 flex gap-2">
          <button onClick={() => onConfirm(picks)} disabled={!allPicked}
            className="h-10 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold disabled:opacity-40">
            Tuloy ang scan
          </button>
          <button onClick={onClose} className="h-10 px-4 rounded-lg border border-slate-300 text-sm font-medium text-slate-600 hover:bg-white">Cancel</button>
        </div>
      </div>
    </div>
  )
}

export default function ShippedOutPage() {
  const activePages = useActivePages()
  const unitStore = useUnitCodes()
  const products = useProductItems()
  const releases = useStockReleases()
  const batches = useProductBatches()
  const store = useShippedOutScans()

  const [tab, setTab] = useState<"scan" | "report">("scan")
  const pagesWithCreds = useMemo(() => activePages.filter(p => p.api_key && (p.pancake_page_id || p.shop_id)), [activePages])

  // ── Order lookup window (Pancake) — default: this month ──────────────────────
  const [winA, setWinA] = useState("")
  const [winB, setWinB] = useState("")
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [loadErr, setLoadErr] = useState("")
  const win = useMemo(() => ({
    // ⚠ HINDI puwedeng monthStart lang. Ang window ay `inserted_at` (petsa ng
    // paggawa ng ORDER), kaya ang order na ginawa Ago 28 na kukunin ng rider sa
    // Set 2 ay WALA sa "Set 1..ngayon" — hindi makikita ng sync kailanman at
    // hindi mababawas kailanman. Umaabot ang default ng 14 araw pabalik kahit
    // lumagpas ang buwan; ang guhit ng reset ang pumipigil sa sobrang luma.
    from: winA || (() => { const b = dstr(new Date(Date.now() - 14 * 86400000)); const m = monthStart(); return b < m ? b : m })(),
    to: winB || dstr(new Date()),
  }), [winA, winB])
  const pagesKey = pagesWithCreds.map(p => `${p.api_key}~${p.pancake_page_id || p.shop_id}~${p.name}`).join("|")

  async function loadOrders(noCache = false) {
    if (pagesWithCreds.length === 0) { setRows([]); return }
    setLoading(true); setLoadErr("")
    const out: any[] = []
    const errs: string[] = []
    await mapLimit(pagesWithCreds, PANCAKE_CONCURRENCY, async p => {
      try {
        const rs = await fetchPageRows(p.api_key, p.pancake_page_id || p.shop_id, win.from, win.to, noCache)
        for (const r of rs) out.push({ ...r, page_name: p.name })
      } catch (e: any) { errs.push(`${p.name}: ${e?.message || "failed"}`) }
    })
    setRows(out); setLoading(false)
    if (errs.length) setLoadErr(errs.join(" · "))
  }
  useEffect(() => { loadOrders() }, [pagesKey, win.from, win.to])   // eslint-disable-line react-hooks/exhaustive-deps

  const byTracking = useMemo(() => {
    const m = new Map<string, any>()
    for (const r of rows) {
      const t = String(r.tracking_no || "").trim().toLowerCase()
      if (t && !m.has(t)) m.set(t, r)
    }
    return m
  }, [rows])

  // Order name → product item components (unit-code recipes; plain items = sarili nila).
  // Pinagsasaluhan ng manual scan at ng automated sync — tingnan ang lib/shipped-out-sync.
  const recipeByName = useMemo(
    () => buildRecipes(products.items, unitStore.codes),
    [products.items, unitStore.codes])

  const parcelInfo = (row: any, code: string): ParcelInfo => ({
    tracking_no: code, courier: String(row.courier || ""), page_name: String(row.page_name || ""),
    order_id: String(row.id || ""), customer: String(row.customer_name || ""),
    order_item: String(row.order_item || ""), amount: Number(row.final_price || 0),
    date: dstr(new Date()),
  })

  // ── PILI NG BATCH (kada sesyon) ─────────────────────────────────────────────
  // Ang tanong ay lumalabas LANG kapag may tunay na pagpipilian — dalawa o higit
  // pang batch na may laman at magkaiba ang presyo. Isang sagot kada sesyon;
  // kapag naubos ang piniling batch, saka lang muling magtatanong. Sinadyang
  // HINDI ito naaalala sa localStorage: bawat pagbukas ng page ay panibagong
  // tanong, dahil ang naiwang lumang sagot ay tahimik na magiging mali.
  const [sessionPicks, setSessionPicks] = useState<Record<string, string>>({})
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Pancake row, walang pormal na type sa buong file
  const [askPick, setAskPick] = useState<{ row: any; code: string; itemIds: string[] } | null>(null)
  const [sessionTally, setSessionTally] = useState<Record<string, number>>({})   // "OPENING @ ₱35" → pcs

  /** Mga batch na may laman pa, pinakaluma muna — ito rin ang ayos sa modal. */
  const liveBatchesOf = (itemId: string) =>
    fifoOrder(batches.batches.filter(b => b.item_id === itemId)).filter(b => batchRemaining(b) > 0)
  /** May tunay na pagpipilian: ≥2 batch na may laman AT magkaiba ang presyo. */
  const isAmbiguous = (itemId: string) => {
    const c = liveBatchesOf(itemId)
    return c.length >= 2 && new Set(c.map(b => b.cog)).size >= 2
  }
  /** Ang pili ay balido lang habang may laman pa ang batch — ubos = muling tanong. */
  const validPickOf = (itemId: string, picks: Record<string, string>) => {
    const id = picks[itemId]
    if (!id) return false
    const b = batches.batches.find(x => x.id === id && x.item_id === itemId)
    return !!b && batchRemaining(b) > 0
  }

  /** Ang NAG-IISANG lugar kung saan bumababa ang inventory. Tumatakbo lang kapag
   *  nanalo tayo sa claim — hindi kailanman kapag "already". */
  async function applyDeduction(row: any, code: string) {
    const { items, total } = explodeOrderItems(row.order_lines || String(row.order_item || ""), recipeByName)
    // ⚠ HUWAG ANGKININ ANG WALANG MAI-BABAWAS. Ang device na walang laman o
    // luma ang cache ng resipe ay dating nag-a-angkin ng parcel na may
    // items: [] at total: 0 — tuluyang nakakandado ang parcel sa "bawas na"
    // nang WALANG nabawas, at hindi na ito maaabot ng device na tama ang
    // resipe. Iniiwan itong hindi claimed: sa sandaling magkaroon ng tamang
    // Product Item o Unit Code, ang susunod na takbo ang babawas nang totoo.
    if (items.length === 0) return "unmapped"
    const res = await store.claimDeduction(parcelInfo(row, code), items, total)
    if (res !== "claimed") return res            // "already" o error — walang binabawas
    if (items.length) {
      products.releaseStock(items.map(i => ({ id: i.item_id, qty: i.deducted })))
      // Ang sagot ng warehouse (piniling batch sa scan) ang UNANG sinusunod — iyon
      // ang pisikal na nangyari. Walang sagot → FIFO, gaya ng dati.
      const picked = store.scans.find(x => x.tracking_no.toLowerCase() === code.toLowerCase())?.picked_batches || {}
      const used = batches.consume(items.map(i => ({ id: i.item_id, qty: i.deducted, preferBatchId: picked[i.item_id] })))
      // Itinatago kung saang batch galing — kung hindi, mawawala ang impormasyon at
      // hindi na malalaman kung saan ibabalik kapag nag-RTS ang parcel na ito.
      const lines = used.flatMap(u => u.lines.map(l => ({ item_id: u.item_id, ...l })))
      void store.saveBatchLines(code, lines,
        used.reduce((s, u) => s + u.cogsValue, 0),
        used.reduce((s, u) => s + u.short, 0))
      releases.addRelease({
        // Idempotent na id — ang parehong parcel ay iisang ledger row magpakailanman.
        id: "rel_shp_" + code.toLowerCase(),
        category: "Shipped Out", ref: code,
        items: items.map(i => ({ item_id: i.item_id, sku: i.sku, name: i.name, required: 1, release: i.deducted, deducted: i.deducted })),
      })
    }
    return "claimed"
  }

  // ── AUTOMATED PANCAKE SHIPPED — ito ang bumabawas ────────────────────────────
  // Tumatakbo tuwing may bagong Pancake rows. Ang parcel na umalis na sa bodega
  // (Shipped/Delivered/Returning/Returned) at hindi pa nababawasan ay babawasan.
  // Ligtas ulit-ulitin: ang claim gate sa DB ang huling nagpapasya, hindi ito.
  const [syncing, setSyncing] = useState(false)
  const [syncedCount, setSyncedCount] = useState(0)
  const [syncTick, setSyncTick] = useState(0)
  const syncBusy = useRef(false)

  useEffect(() => {
    // ⚠ HINTAYIN ANG SERVER BAGO MAGBAWAS. Ang mga resipe ay galing sa
    // product items at unit codes — kapag ang Pancake rows ang naunang dumating
    // sa mga hila ng Supabase, lumang cache ang batayan ng bawas (maling item,
    // maling batch). Ang `loaded` ng bawat store ay totoo lang pagkatapos ng
    // unang hila.
    if (syncBusy.current || !store.loaded || !products.loaded || !batches.loaded || loading || rows.length === 0) return
    const done = new Set(store.scans.filter(s => s.deducted).map(s => s.tracking_no.toLowerCase()))
    const pending = rows.filter(r => isDeductable(r) && !done.has(String(r.tracking_no).trim().toLowerCase()))
    if (pending.length === 0) return

    syncBusy.current = true
    setSyncing(true)
    ;(async () => {
      let n = 0
      for (const r of pending) {
        const code = String(r.tracking_no).trim()
        try { if (await applyDeduction(r, code) === "claimed") n++ } catch { /* susunod na takbo */ }
      }
      if (n > 0) { setSyncedCount(c => c + n); await store.refresh() }
      setSyncing(false)
      syncBusy.current = false
      // Kung may rows na dumating habang tumatakbo ito, ang effect ay hindi na
      // babalik mag-isa (busy noon) — ang tick ang nagpapabalik ng pagsusuri.
      // Hindi ito umiikot: kapag walang pending, walang takbo at walang tick.
      setSyncTick(t => t + 1)
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, store.loaded, products.loaded, batches.loaded, loading, syncTick])

  // ── Scan handling ────────────────────────────────────────────────────────────
  const [manual, setManual] = useState("")
  const [banner, setBanner] = useState<Banner | null>(null)
  const [camOpen, setCamOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastRef = useRef({ code: "", at: 0 })

  function showBanner(b: Banner) {
    if (bannerTimer.current) clearTimeout(bannerTimer.current)
    setBanner(b)
    bannerTimer.current = setTimeout(() => setBanner(null), b.kind === "ok" ? 2500 : 4000)
  }

  async function handleScan(codeRaw: string, fromCamera = false) {
    const code = codeRaw.trim()
    if (!code || busy) return
    // Camera frames repeat habang nasa view ang barcode — 1.5s cooldown per same code.
    const now = Date.now()
    if (fromCamera && lastRef.current.code === code && now - lastRef.current.at < 1500) return
    lastRef.current = { code, at: now }

    const key = code.toLowerCase()
    const existing = store.scans.find(s => s.tracking_no.toLowerCase() === key)
    // ⚠ "ALREADY SCANNED" lang kapag may MANUAL na tatak na. Ang row na gawa ng
    // Pancake sync (nauna ang rider sa warehouse scan) ay walang manual na
    // tatak — dating tinatanggihan ito rito kaya HINDI naitatala ang scan ng
    // warehouse kailanman, at laging mali ang manual-vs-auto na paghahambing.
    if (existing && existing.manual_scanned_at) {
      beep("error")
      showBanner({ kind: "err", title: "ALREADY SCANNED", sub: `${code} — na-scan na noong ${fmtDT(existing.manual_scanned_at)}${existing.manual_scanned_by || existing.scanned_by ? ` · ${existing.manual_scanned_by || existing.scanned_by}` : ""}` })
      return
    }
    if (existing) {
      // Nauna ang Pancake — itatak ang manual sa row na buo na ang datos.
      setBusy(true)
      await store.markManualScan({
        tracking_no: existing.tracking_no, courier: existing.courier, page_name: existing.page_name,
        order_id: existing.order_id, customer: existing.customer, order_item: existing.order_item,
        amount: existing.amount, date: existing.date,
      })
      setBusy(false)
      beep("ok")
      showBanner({ kind: "ok", title: existing.deducted ? "SCANNED ✓ · BAWAS NA" : "SCANNED ✓ · HINDI PA BAWAS", sub: `${code} — naitala ang scan ng warehouse (nauna ang Pancake).` })
      return
    }
    const row = byTracking.get(key)
    if (!row) {
      beep("error")
      showBanner({ kind: "err", title: "NOT FOUND", sub: `${code} — not in the loaded orders (check the Order Date range above)` })
      return
    }

    // Ang manual scan ay TALAAN ng warehouse — hindi ito bumabawas ng inventory.
    // Ang Pancake shipped ang bumabawas, kaya iisa lang ang pinagmumulan ng bawas.
    // Binubuklat pa rin ang resipe para maipakita AGAD kung may hindi magkakatugma.
    const { items } = explodeOrderItems(row.order_lines || String(row.order_item || ""), recipeByName)

    // May item bang kailangan ng pili (dalawang presyo ang may laman) na wala pang
    // balidong sagot ngayong sesyon? Itigil ang scan at itanong MUNA — hindi
    // maitatala ang parcel nang walang sagot, kung hindi ay FIFO na naman ang hula.
    const needPick = Array.from(new Set(
      items.filter(i => isAmbiguous(i.item_id) && !validPickOf(i.item_id, sessionPicks)).map(i => i.item_id)
    ))
    if (needPick.length) {
      beep("warn")
      setAskPick({ row, code, itemIds: needPick })
      return
    }
    await recordScan(row, code, sessionPicks)
  }

  /** Itala ang scan dala ang mga pili. Hiwalay sa handleScan para matawag din ito
   *  ng modal matapos sagutin ang tanong — sariwang `picks` ang dala, hindi ang
   *  posibleng lumang state. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Pancake row, kapareho ng handleScan
  async function recordScan(row: any, code: string, picks: Record<string, string>) {
    const key = code.toLowerCase()
    const { items, unmapped } = explodeOrderItems(row.order_lines || String(row.order_item || ""), recipeByName)
    const parcelPicks: Record<string, string> = {}
    for (const i of items) if (validPickOf(i.item_id, picks)) parcelPicks[i.item_id] = picks[i.item_id]

    setBusy(true)
    const res = await store.markManualScan(parcelInfo(row, code), parcelPicks)
    setBusy(false)
    if (res !== "added" && res !== "restamped") {
      beep("error")
      showBanner(res === "already"
        ? { kind: "err", title: "ALREADY SCANNED", sub: `${code} — naitala na (ibang device/tab).` }
        : { kind: "err", title: "SAVE FAILED", sub: res })
      return
    }
    setManual("")

    // Buod ng sesyon — ang system ang bumibilang, hindi ang tao. Ang item na may
    // pili ay naitatala sa piniling batch; ang iisang-batch na item ay sa batch na
    // iyon; ang wala (FIFO sa maraming batch na iisa ang presyo) ay sa pinakaluma,
    // dahil doon talaga kukuha ang FIFO.
    setSessionTally(prev => {
      const next = { ...prev }
      for (const i of items) {
        const b = parcelPicks[i.item_id]
          ? batches.batches.find(x => x.id === parcelPicks[i.item_id])
          : liveBatchesOf(i.item_id)[0]
        if (!b) continue
        const label = `${b.batch_no || "Batch"} @ ₱${num(b.cog)}`
        next[label] = (next[label] || 0) + i.deducted
      }
      return next
    })

    // Kung umalis na sa Pancake, nabawasan na ito ng sync — sabihin, para alam ng
    // warehouse na tapos na ang parcel na ito at hindi na maghintay.
    const already = store.scans.find(s => s.tracking_no.toLowerCase() === key)?.deducted
      || isDeductable(row)
    if (unmapped.length && items.length === 0) {
      beep("warn")
      showBanner({ kind: "warn", title: "SCANNED — WALANG KATUGMANG UNIT CODE", sub: `${code} — walang tumugma sa "${row.order_item}". Naitala pa rin, pero hindi ito mababawas hangga't walang unit code na ganito ang pangalan.` })
    } else {
      beep("ok")
      showBanner({
        kind: "ok",
        title: already ? "SCANNED ✓ · BAWAS NA" : "SCANNED ✓ · HINDI PA BAWAS",
        sub: already
          ? `${code} · ${row.customer_name || ""} — Shipped na sa Pancake, kaya nabawasan na ang inventory.`
          : `${code} · ${row.customer_name || ""} — naitala. Mababawas kapag na-Shipped na ito sa Pancake.${unmapped.length ? ` · walang tugma: ${unmapped.join(", ")}` : ""}`,
      })
    }
    inputRef.current?.focus()
  }

  // ── Today panel (kanan, kagaya ng reference) ─────────────────────────────────
  const today = dstr(new Date())
  const todayScans = useMemo(() => store.scans.filter(s => s.date === today), [store.scans, today])
  const todayCouriers = useMemo(() => courierTallyOf(todayScans), [todayScans])

  // Paghahambing ng dalawang pinagmumulan. Ang `pending` ang mahalaga: na-scan ng
  // warehouse pero hindi pa Shipped sa Pancake, kaya hindi pa bawas. Kapag lumaki ito,
  // may hindi minamarkahang Shipped sa POS — hindi nawawalang tahimik ang parcel.
  const statsOf = (list: typeof store.scans) => ({
    manual: list.filter(s => s.manual_scanned_at).length,
    auto: list.filter(s => s.pancake_shipped_at).length,
    deducted: list.filter(s => s.deducted).length,
    pending: list.filter(s => s.manual_scanned_at && !s.deducted).length,
    autoOnly: list.filter(s => s.pancake_shipped_at && !s.manual_scanned_at).length,
  })
  const todayStats = useMemo(() => statsOf(todayScans), [todayScans])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Report tab ───────────────────────────────────────────────────────────────
  const [repA, setRepA] = useState(monthStart())
  const [repB, setRepB] = useState(dstr(new Date()))
  const [repCourier, setRepCourier] = useState("All")
  const repScans = useMemo(() =>
    store.scans.filter(s =>
      s.date >= repA && s.date <= repB &&
      (repCourier === "All" || courierLabel(s.courier, s.tracking_no) === repCourier))
  , [store.scans, repA, repB, repCourier])
  const repCouriers = useMemo(() => courierTallyOf(repScans), [repScans])

  const repTotals = useMemo(() => ({
    amount: repScans.reduce((s, r) => s + (r.amount || 0), 0),
    units: repScans.reduce((s, r) => s + (r.deducted_total || 0), 0),
    cogs: repScans.reduce((s, r) => s + (r.cogs_value || 0), 0),
  }), [repScans])
  const repStats = useMemo(() => statsOf(repScans), [repScans])   // eslint-disable-line react-hooks/exhaustive-deps

  function exportReport() {
    const headers = ["Date/Time", "Tracking No", "Courier", "Page", "Customer", "Order", "Item Name (deducted)", "Deducted from Inventory (units)", "Amount", "Manual Scan", "Scanned By", "POS Shipped", "Deducted?", "Galing sa Batch (COG)", "COGS"]
    const data = [headers, ...repScans.map(s => [
      fmtDT(s.created_at), s.tracking_no, courierLabel(s.courier, s.tracking_no), s.page_name, s.customer, s.order_item,
      s.items.map(i => `${i.deducted}x ${i.name}`).join(", "), s.deducted_total, s.amount,
      fmtDT(s.manual_scanned_at), s.manual_scanned_by || s.scanned_by, fmtDT(s.pancake_shipped_at), s.deducted ? "Oo" : "Hindi pa",
      (s.batch_lines || []).map(l => `${l.qty}x @₱${l.cog}${l.batch_no ? ` (${l.batch_no})` : ""}`).join(", "), s.cogs_value,
    ]), ["TOTAL", "", "", "", "", "", "", repTotals.units, repTotals.amount, "", "", "", "", "", repTotals.cogs]]
    const ws = XLSX.utils.aoa_to_sheet(data)
    for (let c = 0; c < headers.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c })
      if (ws[addr]) (ws[addr] as any).s = { fill: { patternType: "solid", fgColor: { rgb: "FF17858C" } }, font: { bold: true, color: { rgb: "FFFFFFFF" } } }
    }
    ws["!cols"] = headers.map(h => ({ wch: Math.max(14, h.length + 2) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Shipped Out")
    XLSX.writeFile(wb, `Shipped-Out_${repA}_to_${repB}.xlsx`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2 pb-4 border-b border-slate-100">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><ScanBarcode className="w-5 h-5" /> SHIPPED OUT<HelpButton title="Paano gumagana ang Shipped Out scan" sections={HELP} /></h1>
        <div className="flex items-center gap-2">
          <DateRangePicker a={winA} b={winB} variant="header"
            onApply={(a, b) => { setWinA(a || ""); setWinB(b || "") }} placeholder="Order window: This month" />
          <button onClick={() => loadOrders(true)} title="Refresh orders"
            className="h-9 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1">
        <button onClick={() => setTab("scan")}
          className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 ${tab === "scan" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100 border border-slate-200"}`}>
          <ScanLine className="w-4 h-4" /> Scan
        </button>
        <button onClick={() => setTab("report")}
          className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 ${tab === "report" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100 border border-slate-200"}`}>
          <ClipboardList className="w-4 h-4" /> Shipped Out Report ({num(store.scans.length)})
        </button>
      </div>

      {loadErr && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{loadErr}</div>}

      {tab === "scan" && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 items-start">
          {/* Left — tracking input (reference layout) */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            {banner && (
              <div className={`mb-4 rounded-xl px-4 py-3 text-white ${banner.kind === "ok" ? "bg-emerald-600" : banner.kind === "warn" ? "bg-amber-500" : "bg-red-600"}`}>
                <p className="font-extrabold text-sm">{banner.title}</p>
                <p className="text-xs opacity-90 break-words">{banner.sub}</p>
              </div>
            )}
            {/* Laging kita habang nag-i-scan: aling batch ang ginagamit, ilan ang
                natitira, at ang paalala — hindi isang pop-up na mawawala. Lumilitaw
                lang kapag may item na talagang may dalawang presyo. */}
            {(() => {
              const ambiguous = products.items.filter(i => !i.deleted && isAmbiguous(i.id))
              if (ambiguous.length === 0) return null
              return (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-1.5">
                  <p className="text-[11px] font-bold text-amber-800 uppercase tracking-wider">Dalawang presyo ang stock — piliin ang pinagkukunan</p>
                  {ambiguous.map(it => {
                    const pickedId = sessionPicks[it.id]
                    const b = pickedId ? batches.batches.find(x => x.id === pickedId && batchRemaining(x) > 0) : undefined
                    return (
                      <div key={it.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate">
                          <span className="font-semibold text-slate-800">{it.name}</span>
                          {b
                            ? <span className="text-slate-600"> → {b.batch_no || "Batch"} @ ₱{num(b.cog)} · <span className="tabular-nums">{num(batchRemaining(b))}</span> pcs na lang</span>
                            : <span className="text-amber-700 font-medium"> — wala pang pili (itatanong sa unang scan)</span>}
                        </span>
                        <button type="button" onClick={() => setAskPick({ row: null, code: "", itemIds: [it.id] })}
                          className="shrink-0 text-[11px] font-bold text-blue-600 hover:underline">{b ? "Palitan" : "Pumili"}</button>
                      </div>
                    )
                  })}
                  <p className="text-[11px] text-amber-700">💡 Ubusin muna ang lumang / mas murang stock bago buksan ang bago.</p>
                  {Object.keys(sessionTally).length > 0 && (
                    <p className="text-[11px] text-slate-600 border-t border-amber-200 pt-1.5">
                      Ngayong sesyon: {Object.entries(sessionTally).map(([k, v]) => `${num(v)} pcs · ${k}`).join("  ·  ")}
                    </p>
                  )}
                </div>
              )
            })()}
            <div className="grid grid-cols-[130px_1fr] items-center gap-3 py-4 border-b border-slate-100">
              <label className="text-sm font-semibold text-slate-600 text-right">TRACKING NO <span className="text-red-500">*</span></label>
              <input ref={inputRef} autoFocus value={manual} spellCheck={false}
                onChange={e => setManual(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && manual.trim()) handleScan(manual) }}
                placeholder="Type, hardware-scan, or open the camera"
                className="h-11 rounded-lg border border-slate-300 px-3 text-sm font-mono focus:outline-none focus:border-blue-500" />
            </div>
            <div className="flex items-center gap-2 pt-4 flex-wrap">
              <Button onClick={() => manual.trim() && handleScan(manual)} disabled={busy || !manual.trim()}>
                {busy ? "Saving…" : "Submit"}
              </Button>
              <Button variant="outline" onClick={() => { setManual(""); inputRef.current?.focus() }}>Cancel</Button>
              <Button className="ml-auto bg-slate-900 hover:bg-slate-800 text-white" onClick={() => setCamOpen(true)}>
                <Camera className="w-4 h-4" /> SCAN BARCODE
              </Button>
            </div>
            <p className="text-[11px] text-slate-400 mt-4">
              {loading ? "Loading orders from Pancake…" : `${num(rows.length)} order${rows.length === 1 ? "" : "s"} loaded (${win.from} → ${win.to}) mula sa ${pagesWithCreds.length} page${pagesWithCreds.length === 1 ? "" : "s"}.`}
              {" "}Ang scan ay talaan ng warehouse — ang bawas sa inventory ay awtomatikong nangyayari kapag
              na-Shipped na ang parcel sa Pancake.
            </p>
            {/* Kitang-kita ang automated na bawas — kung hindi, walang paraan para malaman
                ng warehouse kung gumagana ito o tahimik na tumigil. */}
            <div className="mt-2 text-[11px] flex items-center gap-1.5">
              {syncing ? (
                <span className="text-blue-600 flex items-center gap-1.5">
                  <RefreshCw className="w-3 h-3 animate-spin" /> Sinusuri ang Pancake para sa mga umalis na parcel…
                </span>
              ) : syncedCount > 0 ? (
                <span className="text-emerald-600 font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="w-3 h-3" /> {num(syncedCount)} parcel{syncedCount === 1 ? "" : "s"} ang awtomatikong nabawas ngayong session
                </span>
              ) : (
                <span className="text-slate-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3 h-3" /> Walang bagong parcel na kailangang bawasan — updated ang inventory.
                </span>
              )}
            </div>
          </div>

          {/* Right — today panel (reference: As of + list + courier tally) */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between">
              <div>
                <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><ScanBarcode className="w-4 h-4 text-blue-600" /> SHIPPED OUT</p>
                <p className="text-[11px] text-slate-400 flex items-center gap-1"><CalendarDays className="w-3 h-3" /> As of {prettyDate(today)}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-extrabold text-blue-600 tabular-nums">{num(todayScans.length)}</span>
                <button onClick={() => store.refresh()} title="Reset / reload"
                  className="text-xs text-slate-400 hover:text-slate-700 flex items-center gap-1"><RotateCcw className="w-3.5 h-3.5" /> Reset</button>
              </div>
            </div>
            <div className="max-h-[380px] overflow-auto divide-y divide-slate-100">
              {todayScans.length === 0 && <p className="px-4 py-6 text-sm text-slate-400 italic text-center">Nothing scanned yet today.</p>}
              {todayScans.map(s => (
                <div key={s.id} className="px-4 py-2 flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-mono text-slate-800 truncate">{s.tracking_no}</p>
                    <p className="text-[11px] text-slate-400 truncate flex items-center gap-1.5">
                      <CourierBadge courier={s.courier} tracking={s.tracking_no} /> {num(s.deducted_total)} unit{s.deducted_total === 1 ? "" : "s"} less · {fmtDT(s.created_at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-slate-200">
              {/* Fixed na tally — laging kita ang SPX at J&T kahit 0 */}
              <div className={`grid divide-x divide-slate-100 text-center ${todayCouriers.length > 2 ? "grid-cols-3" : "grid-cols-2"}`}>
                {todayCouriers.map(c => (
                  <div key={c.label} className="px-2 py-2">
                    <p className="text-[10px] font-semibold uppercase flex items-center justify-center gap-1"
                      style={{ color: COURIER_STYLE[c.label]?.dot }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: COURIER_STYLE[c.label]?.dot }} />
                      {c.label}
                    </p>
                    <p className="text-sm font-extrabold text-slate-800 tabular-nums">{num(c.count)}</p>
                  </div>
                ))}
              </div>
              {/* Manual laban sa automated — dalawang talaan, iisang bawas. */}
              <div className="grid grid-cols-3 divide-x divide-slate-100 text-center border-t border-slate-100">
                <div className="px-2 py-2">
                  <p className="text-[10px] font-semibold uppercase text-slate-400">Manual scan</p>
                  <p className="text-sm font-extrabold text-slate-800 tabular-nums">{num(todayStats.manual)}</p>
                </div>
                <div className="px-2 py-2">
                  <p className="text-[10px] font-semibold uppercase text-emerald-600">POS · bawas</p>
                  <p className="text-sm font-extrabold text-emerald-700 tabular-nums">{num(todayStats.deducted)}</p>
                </div>
                <div className="px-2 py-2">
                  <p className="text-[10px] font-semibold uppercase text-amber-600">Hindi pa bawas</p>
                  <p className="text-sm font-extrabold text-amber-700 tabular-nums">{num(todayStats.pending)}</p>
                </div>
              </div>
              <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">Total Shipped Out</span>
                <span className="text-base font-extrabold text-slate-900 tabular-nums">{num(todayScans.length)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "report" && (
        <div className="space-y-3">
          <div className="bg-white rounded-xl border border-slate-200 p-3 flex items-center gap-2 flex-wrap">
            <DateRangePicker a={repA} b={repB} variant="header"
              onApply={(a, b) => { setRepA(a || monthStart()); setRepB(b || dstr(new Date())) }} placeholder="This month" />
            <span className="text-xs text-slate-400">{repA} → {repB}</span>
            {/* Courier filter — SPX / J&T lang ang gamit natin */}
            <div className="flex items-center gap-1">
              {["All", ...MAIN_COURIERS, "OTHER"].map(c => (
                <button key={c} onClick={() => setRepCourier(c)}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${repCourier === c ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                  {c}
                </button>
              ))}
            </div>
            <div className="ml-auto">
              <Button variant="outline" onClick={exportReport} disabled={repScans.length === 0}>
                <FileSpreadsheet className="w-4 h-4" /> Export to Excel
              </Button>
            </div>
          </div>

          {/* Courier tally — SPX at J&T laging kita (OTHER kung may laman) */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
            {repCouriers.map(c => (
              <div key={c.label} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1"
                  style={{ color: COURIER_STYLE[c.label]?.dot }}>
                  <Truck className="w-3 h-3" /> {c.label}
                </p>
                <p className="text-xl font-extrabold text-slate-800 tabular-nums">{num(c.count)}</p>
              </div>
            ))}
            <div className="bg-slate-800 rounded-xl px-4 py-3">
              <p className="text-[10px] font-semibold text-slate-300 uppercase tracking-wider">Total Shipped Out</p>
              <p className="text-xl font-extrabold text-white tabular-nums">{num(repScans.length)}</p>
            </div>
            <div className="bg-emerald-600 rounded-xl px-4 py-3">
              <p className="text-[10px] font-semibold text-emerald-100 uppercase tracking-wider">Total Amount</p>
              <p className="text-xl font-extrabold text-white tabular-nums">{peso(repTotals.amount)}</p>
            </div>
          </div>

          {/* Paghahambing ng dalawang pinagmumulan — dito makikita kung tugma ang
              binilang ng warehouse sa aktwal na umalis ayon sa Pancake. */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Manual scan</p>
              <p className="text-xl font-extrabold text-slate-800 tabular-nums">{num(repStats.manual)}</p>
              <p className="text-[10px] text-slate-400">na-scan ng warehouse</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">POS automated · bawas</p>
              <p className="text-xl font-extrabold text-emerald-700 tabular-nums">{num(repStats.deducted)}</p>
              <p className="text-[10px] text-slate-400">nabawasan sa inventory</p>
            </div>
            <div className="bg-white rounded-xl border border-amber-200 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">Hindi pa bawas</p>
              <p className="text-xl font-extrabold text-amber-700 tabular-nums">{num(repStats.pending)}</p>
              <p className="text-[10px] text-slate-400">na-scan pero hindi pa Shipped sa POS</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-600">Hindi na-scan</p>
              <p className="text-xl font-extrabold text-blue-700 tabular-nums">{num(repStats.autoOnly)}</p>
              <p className="text-[10px] text-slate-400">umalis pero walang manual scan</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1150px] text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-[11px] font-semibold uppercase tracking-wide border-b border-slate-200">
                    <th className="px-4 py-3 text-left">Date/Time</th>
                    <th className="px-4 py-3 text-left">Tracking No</th>
                    <th className="px-4 py-3 text-left">Courier</th>
                    <th className="px-4 py-3 text-left">Page</th>
                    <th className="px-4 py-3 text-left">Customer</th>
                    <th className="px-4 py-3 text-left">Order</th>
                    <th className="px-4 py-3 text-left">Item Name</th>
                    <th className="px-4 py-3 text-right">Deducted from Inventory</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-left">Scanned By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {!store.loaded && <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-400 italic">Loading…</td></tr>}
                  {store.loaded && repScans.length === 0 && (
                    <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-400 italic">Nothing scanned in this range.</td></tr>
                  )}
                  {repScans.map(s => (
                    <tr key={s.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-2.5 whitespace-nowrap text-xs text-slate-500">{fmtDT(s.created_at)}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap font-mono text-slate-800">{s.tracking_no}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap"><CourierBadge courier={s.courier} tracking={s.tracking_no} /></td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600 max-w-[140px] truncate">{s.page_name || "—"}</td>
                      <td className="px-4 py-2.5 text-slate-600 max-w-[160px] truncate">{s.customer || "—"}</td>
                      <td className="px-4 py-2.5 text-slate-600 max-w-[200px] truncate" title={s.order_item}>{s.order_item || "—"}</td>
                      <td className="px-4 py-2.5 max-w-[240px]">
                        {s.items.length === 0 ? <span className="text-slate-300">—</span> : (
                          <div className="flex flex-wrap gap-1">
                            {s.items.map((i, x) => (
                              <span key={x} className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
                                <strong className="tabular-nums">{num(i.deducted)}×</strong> {i.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {s.deducted_total > 0
                          ? <span className="font-semibold text-slate-800 tabular-nums">{num(s.deducted_total)} unit{s.deducted_total === 1 ? "" : "s"}</span>
                          : <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700">no match</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums font-semibold text-slate-800">
                        {s.amount > 0 ? peso(s.amount) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-xs text-slate-500">{s.scanned_by || "—"}</td>
                    </tr>
                  ))}
                </tbody>
                {repScans.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-100 border-t-2 border-slate-300 font-extrabold text-slate-900">
                      <td className="px-4 py-2.5 text-[11px] uppercase tracking-wider" colSpan={7}>
                        Total · {num(repScans.length)} parcel{repScans.length === 1 ? "" : "s"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{num(repTotals.units)} units</td>
                      <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{peso(repTotals.amount)}</td>
                      <td className="px-4 py-2.5" />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}

      {camOpen && <CameraScanOverlay onDecode={code => handleScan(code, true)} onClose={() => setCamOpen(false)} />}

      {/* Ang tanong — lumalabas lang kapag may scan na kailangan ng sagot, o kapag
          pinindot ang Palitan/Pumili sa panel. Pagkatapos sagutin, tuloy agad ang
          scan na naghihintay — sariwang picks ang dala, hindi ang lumang state. */}
      {askPick && (
        <BatchPickModal
          items={askPick.itemIds.map(id => ({
            itemId: id,
            name: products.items.find(i => i.id === id)?.name || id,
            choices: liveBatchesOf(id),
          }))}
          initial={sessionPicks}
          onClose={() => setAskPick(null)}
          onConfirm={picks => {
            const merged = { ...sessionPicks, ...picks }
            setSessionPicks(merged)
            const pendingRow = askPick.row, pendingCode = askPick.code
            setAskPick(null)
            if (pendingRow) void recordScan(pendingRow, pendingCode, merged)
          }} />
      )}
    </div>
  )
}

// ── Camera scanner — same approach as the RTS scanner (native BarcodeDetector sa
// Android Chrome, high-res, buong frame; ZXing fallback sa iOS/lumang browser). ──
function CameraScanOverlay({ onDecode, onClose }: { onDecode: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<{ stop: () => void } | null>(null)
  const [state, setState] = useState<"idle" | "starting" | "on" | "error">("idle")
  const [err, setErr] = useState("")
  useEffect(() => () => { controlsRef.current?.stop() }, [])

  async function start() {
    controlsRef.current?.stop()
    // Tap ito — dito lang pumapayag ang iOS/Android na buhayin ang WebAudio.
    // Kung wala nito, tahimik ang kauna-unahang beep pagkatapos buksan ang camera.
    primeScanSound()
    setState("starting"); setErr("")
    const constraints: MediaStreamConstraints = {
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    }
    try {
      const BD = (window as any).BarcodeDetector
      if (BD) {
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        const video = videoRef.current!
        video.srcObject = stream
        await video.play().catch(() => {})
        setState("on")
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
          try { const codes = await detector.detect(video); if (codes?.length) onDecode(codes[0].rawValue) } catch {}
          if (!stopped) timer = setTimeout(tick, 120)
        }
        tick()
        controlsRef.current = { stop: () => { stopped = true; if (timer) clearTimeout(timer); stream.getTracks().forEach(t => t.stop()) } }
      } else {
        const { BrowserMultiFormatReader } = await import("@zxing/browser")
        const reader = new BrowserMultiFormatReader()
        const controls = await reader.decodeFromConstraints(constraints, videoRef.current!, result => { if (result) onDecode(result.getText()) })
        controlsRef.current = controls
        setState("on")
      }
    } catch (e: any) {
      setState("error")
      setErr(e?.message || "Camera unavailable")
    }
  }

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <span className="text-white font-bold flex items-center gap-2"><Camera className="w-5 h-5" /> Shipped Out Scanner</span>
        <button onClick={() => { controlsRef.current?.stop(); onClose() }}
          className="w-9 h-9 rounded-full bg-white/10 text-white flex items-center justify-center"><X className="w-5 h-5" /></button>
      </div>
      <div className="relative flex-1 min-h-0 bg-black">
        <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
        {state !== "on" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            {state === "error" ? (
              <>
                <p className="text-red-400 text-sm font-semibold">Camera unavailable</p>
                <p className="text-white/50 text-xs">{err}. Needs HTTPS + camera permission. You can still type or use a hardware scanner.</p>
                <button onClick={start} className="mt-1 h-11 px-5 rounded-xl bg-white/10 text-white text-sm font-bold">Try Again</button>
              </>
            ) : (
              <button onClick={start} disabled={state === "starting"}
                className="h-14 px-8 rounded-2xl bg-blue-600 text-white text-base font-extrabold flex items-center gap-2 disabled:opacity-60">
                <Camera className="w-5 h-5" /> {state === "starting" ? "Starting…" : "START CAMERA"}
              </button>
            )}
          </div>
        )}
      </div>
      <p className="text-center text-white/40 text-xs py-3 shrink-0">Point at the waybill barcode — it beeps and deducts inventory automatically.</p>
    </div>
  )
}
