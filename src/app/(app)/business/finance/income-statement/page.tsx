"use client"
import { useEffect, useMemo, useState, useCallback } from "react"
import { Package, Truck, Warehouse, Wallet, TrendingUp, RefreshCw, FileText } from "lucide-react"
import { format, startOfMonth } from "date-fns"
import { useBookkeeping } from "@/lib/bookkeeping-store"
import { useFinanceSettings } from "@/lib/finance-settings-store"
import { useActivePages } from "@/lib/pages-store"
import { useFbPaidCharges } from "@/lib/fb-paid-store"
import { useProductItems, itemRemaining } from "@/lib/product-items-store"
import { fetchJntFees } from "@/lib/sales-shared-store"
import { fetchPageRows, mapLimit, aggregateCourier, type CourierAgg } from "@/lib/courier-live"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"

const VAT_RATE = 0.12   // 12% VAT on Ad Spend

// ──────────────────────────────────────────────────────────────────────────────
// Finance → Income Statement — fully connected / auto-computed (no editable fields).
//   Gross Revenue / Adspent / COG / OPEX / Actual Funds → Book Keeping (same model as
//     Finance Overview, so Gross Revenue matches the Finance Dashboard card).
//   Shipping Fee (J&T + SPX), In-Transit / On-Delivery amounts, Projected RTS % → live
//     Pancake order data (the Sales Tracker source). J&T fees use the Excel import the
//     Sales Tracker keeps in the shared `jnt_shipping_fees` table (sales-shared-store);
//     SPX uses Pancake's own partner shipping fee.
//   Projected RTS % (per courier) = courier's actual return rate = Returned ÷ (Delivered
//     + Returned), applied to In-Transit & On-Delivery amounts.
//   PAR              = Amount × (1 − RTS%)
//   Gross Profit     = Gross Revenue − Adspent (ex-VAT) − COG − Shipping Fee
//   OPEX             = Book Keeping OPEX debits + VAT (12% of Ad Spend)  — kasama na ang VAT
//   Profit & Loss    = Gross Profit − OPEX
//   Projected A/R    = J&T PAR + SPX PAR + PPW PAR (PPW = 0, to follow)
//   Projected Funds  = Actual Company Funds + Projected A/R
// ──────────────────────────────────────────────────────────────────────────────

function defaultDateA() { return format(startOfMonth(new Date()), "yyyy-MM-dd") }
function defaultDateB() { return format(new Date(), "yyyy-MM-dd") }

function peso(n: number) {
  const v = isFinite(n) ? n : 0
  return (v < 0 ? "-₱" : "₱") + Math.abs(v).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const pct = (n: number) => (isFinite(n) ? n * 100 : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%"

// Pancake fetch + per-courier aggregation now live in the shared courier-live lib
// (also used by the Finance Overview cards).

// ── UI bits ──────────────────────────────────────────────────────────────────
function SRow({ label, value, tone = "plain", deduct }: {
  label: string; value: string; tone?: "plain" | "revenue" | "gross" | "opex" | "pl"; deduct?: boolean
}) {
  const tones: Record<string, string> = {
    plain: "bg-white text-slate-600",
    revenue: "bg-emerald-500 text-white font-bold",
    gross: "bg-blue-500 text-white font-bold",
    opex: "bg-orange-500 text-white font-bold",
    pl: "bg-amber-400 text-slate-900 font-bold",
  }
  return (
    <div className={`flex items-center justify-between px-4 py-2.5 ${tones[tone]} border-b border-slate-100`}>
      <span className="text-sm">{deduct && <span className="text-rose-400 mr-1.5">−</span>}{label}</span>
      <span className="text-sm tabular-nums">{value}</span>
    </div>
  )
}

// Read-only courier summary
function CourierSummary({ name, color, agg }: { name: string; color: string; agg: CourierAgg }) {
  const rows = [
    { l: "In-Transit", amt: agg.inTransitAmt, par: agg.inTransitPar },
    { l: "On-Delivery", amt: agg.onDeliveryAmt, par: agg.onDeliveryPar },
  ]
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className={`flex items-center justify-between px-4 py-2.5 ${color} text-white`}>
        <span className="text-sm font-bold flex items-center gap-1.5"><Truck className="w-4 h-4" /> {name}</span>
        <span className="text-xs font-medium">Auto · Sales Tracker</span>
      </div>
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between px-1">
          <span className="text-sm text-slate-600">Shipping Fee</span>
          <span className="text-sm font-semibold text-slate-800 tabular-nums">{peso(agg.shippingFee)}</span>
        </div>
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <div className="grid grid-cols-[1fr_110px_80px_110px] gap-px bg-slate-100 text-[11px] font-semibold text-slate-500">
            <span className="bg-slate-50 px-2 py-1.5">Parcel</span>
            <span className="bg-slate-50 px-2 py-1.5 text-right">Amount</span>
            <span className="bg-slate-50 px-2 py-1.5 text-right">RTS %</span>
            <span className="bg-slate-50 px-2 py-1.5 text-right">PAR</span>
          </div>
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_110px_80px_110px] gap-px items-center border-t border-slate-100">
              <span className="px-2 py-2 text-sm text-slate-600">{row.l}</span>
              <span className="px-2 py-2 text-sm text-right tabular-nums text-slate-700">{peso(row.amt)}</span>
              <span className="px-2 py-2 text-sm text-right tabular-nums text-slate-500">{pct(agg.rtsPct)}</span>
              <span className="px-2 py-2 text-sm text-right tabular-nums font-medium text-slate-800">{peso(row.par)}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total PAR</span>
          <span className="text-sm font-bold text-slate-800 tabular-nums">{peso(agg.totalPar)}</span>
        </div>
      </div>
    </div>
  )
}

export default function IncomeStatementPage() {
  const bk = useBookkeeping()
  const fs = useFinanceSettings()
  const activePages = useActivePages()
  const paid = useFbPaidCharges()
  const products = useProductItems()

  const [dateA, setDateA] = useState(defaultDateA())
  const [dateB, setDateB] = useState(defaultDateB())

  const fromStr = dateA, toStr = dateB

  // J&T Excel-imported fees (read-only here; written by the Sales Tracker).
  const [jntFees, setJntFees] = useState<Record<string, number>>({})
  useEffect(() => { fetchJntFees().then(setJntFees).catch(() => {}) }, [])

  // Connected pages (api_key + pancake id).
  const pages = useMemo(
    () => activePages.filter(p => p.api_key && (p.pancake_page_id || p.shop_id)),
    [activePages])
  const pagesKey = pages.map(p => `${p.id}:${p.api_key}:${p.pancake_page_id || p.shop_id}`).join(",")

  // ── Live Pancake order rows (couriers) ──
  const [rows, setRows] = useState<any[]>([])
  const [loadingRows, setLoadingRows] = useState(false)
  const loadRows = useCallback(async () => {
    if (pages.length === 0) { setRows([]); return }
    setLoadingRows(true)
    const all: any[] = []
    await mapLimit(pages, 3, async p => {
      try { all.push(...await fetchPageRows(p.api_key, p.pancake_page_id || p.shop_id, fromStr, toStr)) } catch {}
    })
    setRows(all)
    setLoadingRows(false)
  }, [pages, pagesKey, fromStr, toStr])
  useEffect(() => { loadRows() /* eslint-disable-next-line */ }, [pagesKey, fromStr, toStr])

  const jnt = useMemo(() => aggregateCourier(rows, "jnt", jntFees), [rows, jntFees])
  const spx = useMemo(() => aggregateCourier(rows, "spx", jntFees), [rows, jntFees])

  // ── Finance-connected figures (same model as Finance Overview) ──
  const fin = useMemo(() => {
    const txns = bk.txns.filter(t => t.status !== "disabled" && t.posted_date >= fromStr && t.posted_date <= toStr)
    const accountByName = Object.fromEntries(fs.accounts.map(a => [a.name, a]))
    const typeByName = Object.fromEntries(fs.types.map(t => [t.name, t]))
    let grossRevenue = 0, adspent = 0, cog = 0, opex = 0
    for (const t of txns) {
      const a = accountByName[t.account] as any
      const ty = typeByName[t.type_of_expense] as any
      const isAds = !!a?.is_adspent, isCog = !!a?.is_cog_purchase, isShip = !!a?.is_shipping_fee
      const isRevolving = isAds || isCog || isShip
      if (t.credit > 0 && !a?.excluded_in_gross_revenue) grossRevenue += t.credit
      if (t.debit > 0) {
        if (isAds) adspent += t.debit
        if (isCog) cog += t.debit
        if (!isRevolving && ty?.opex) opex += t.debit
      }
    }
    const actualFunds = fs.activeBanks.reduce((sum, b) => sum + txns.filter(t => t.bank === b.name).reduce((s, t) => s + t.credit - t.debit, 0), 0)
    return { grossRevenue, adspent, cog, opex, actualFunds, count: txns.length }
  }, [bk.txns, fs.accounts, fs.types, fs.activeBanks, fromStr, toStr])

  // ── Ad Spend — ACTUAL FB Paid charges only (fb_paid_charges): the exact amounts billed to
  // the card, VAT-inclusive, matched 1:1 to the bank/card statement. Split into the ex-VAT
  // Adspent + the embedded reverse-charge 12% VAT (adspent + vatAds = the paid amount) so VAT
  // is never doubled. Manually-logged Book Keeping adspent entries are intentionally excluded
  // — FB Paid only, para tumpak (actual money-out, hindi estimate). ──
  const fbPaid = useMemo(
    () => paid.charges.filter(c => c.paid_date >= fromStr && c.paid_date <= toStr).reduce((s, c) => s + c.amount, 0),
    [paid.charges, fromStr, toStr])
  const adspent = fbPaid / (1 + VAT_RATE)   // ex-VAT portion
  const vatAds = fbPaid - adspent           // 12% VAT — an operating expense (OPEX), deducted below Gross Profit

  // ── Derived ──
  const ppwPar = 0 // PPW integration to follow — read-only 0 for now
  const projectedAR = jnt.totalPar + spx.totalPar + ppwPar
  const shippingFee = jnt.shippingFee + spx.shippingFee
  const grossProfit = fin.grossRevenue - adspent - fin.cog - shippingFee   // VAT is OPEX now — not deducted here
  // Ang 12% VAT sa ad spend ay BAHAGI NA ng OPEX (hindi hiwalay na linya) — kaya isang
  // bawas lang ito sa Profit & Loss. Ipinapakita pa rin sa ilalim bilang breakdown.
  const opexTotal = fin.opex + vatAds
  const profitLoss = grossProfit - opexTotal

  // ── Warehouse Inventory — halaga ng natitirang stock sa Logistics → Product Items.
  // Parehong pormula ng footer ng Product Items page: Σ (cog × natitirang piraso), kung
  // saan ang natitira = goods − damage − loss − released. Hindi kasama ang deleted at
  // archived. Kasalukuyang halaga ito (walang date range) — hindi apektado ng picker.
  const warehouseInventory = useMemo(
    () => products.items
      .filter(i => !i.deleted && !i.archived)
      .reduce((s, i) => s + i.cog * itemRemaining(i), 0),
    [products.items])
  const inventoryUnits = useMemo(
    () => products.items
      .filter(i => !i.deleted && !i.archived)
      .reduce((s, i) => s + itemRemaining(i), 0),
    [products.items])
  const projectedFunds = fin.actualFunds + projectedAR

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-lg font-bold text-blue-600 flex items-center justify-center gap-2 pb-4 mb-4 border-b border-slate-100">
          <FileText className="w-5 h-5" /> INCOME STATEMENT
        </h1>
        <div className="flex justify-center items-center gap-2 mt-2">
          <DateRangePicker a={dateA} b={dateB} variant="header"
            onApply={(a, b) => { setDateA(a || defaultDateA()); setDateB(b || defaultDateB()) }} placeholder="This month" />
          <button onClick={loadRows} title="Refresh courier data"
            className="h-9 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
            <RefreshCw className={`w-4 h-4 ${loadingRows ? "animate-spin" : ""}`} />
          </button>
        </div>
        <p className="text-[11px] text-slate-400 mt-1.5">
          {fin.count} bookkeeping entr{fin.count === 1 ? "y" : "ies"} · {loadingRows ? "loading couriers…" : `${rows.length} parcels from ${pages.length} connected page${pages.length === 1 ? "" : "s"}`} · all values auto-computed
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* LEFT — main income statement */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="grid grid-cols-2 bg-blue-600 text-white text-sm font-bold">
              <span className="px-4 py-2.5">PARTICULARS</span>
              <span className="px-4 py-2.5 text-right">AMOUNT</span>
            </div>
            <SRow tone="revenue" label="GROSS REVENUE" value={peso(fin.grossRevenue)} />
            <SRow deduct label="Adspent" value={peso(adspent)} />
            <SRow deduct label="Cost of Good Purchase" value={peso(fin.cog)} />
            <SRow deduct label="Shipping Fee (J&T + SPX)" value={peso(shippingFee)} />
            <SRow tone="gross" label="GROSS PROFIT" value={peso(grossProfit)} />
            <SRow tone="opex" label="OPEX" value={peso(opexTotal)} />
            <SRow label="↳ includes VAT (12% of Ad Spend)" value={peso(vatAds)} />
            <SRow tone="pl" label="PROFIT & LOSS" value={peso(profitLoss)} />
          </div>

          <div className="rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 text-white p-6 flex items-center justify-between relative overflow-hidden">
            <Wallet strokeWidth={1} className="absolute -left-3 -bottom-3 w-28 h-28 opacity-[0.08]" />
            <span className="text-sm font-semibold tracking-wider uppercase opacity-80">Projected<br />Company Funds</span>
            <span className="text-3xl font-extrabold tabular-nums">{peso(projectedFunds)}</span>
          </div>

          <p className="text-[11px] text-slate-400 px-1 flex items-start gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            Gross Profit = Gross Revenue − Adspent (ex-VAT) − COG − Shipping Fee. Shipping Fee (J&amp;T + SPX) is pulled live from the Sales Tracker; Adspent = actual FB Paid charges (Billing Hub), shown ex-VAT. Ang 12% VAT sa ad spend ay BAHAGI NA ng OPEX (isang bawas lang, hindi doble) — Profit &amp; Loss = Gross Profit − OPEX. COGS connection is still being wired.
          </p>
        </div>

        {/* RIGHT — funds, receivables, couriers, PPW */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
            <div className="flex items-center justify-between px-4 py-3 bg-slate-100">
              <span className="text-sm font-semibold text-slate-600">ACTUAL COMPANY FUNDS</span>
              <span className={`text-sm font-bold tabular-nums ${fin.actualFunds < 0 ? "text-rose-600" : "text-slate-800"}`}>{peso(fin.actualFunds)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3 bg-slate-50">
              <span className="text-sm font-semibold text-slate-600 flex items-center gap-1.5">
                <Warehouse className="w-4 h-4 text-slate-400" /> WAREHOUSE INVENTORY
                <span className="text-[11px] font-normal text-slate-400">· {inventoryUnits.toLocaleString("en-PH")} pcs</span>
              </span>
              <span className="text-sm font-bold tabular-nums text-slate-800">{peso(warehouseInventory)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3 bg-slate-100">
              <span className="text-sm font-semibold text-slate-600">PROJECTED ACCOUNT RECEIVABLES</span>
              <span className="text-sm font-bold tabular-nums text-slate-800">{peso(projectedAR)}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <CourierSummary name="J&T Express" color="bg-red-600" agg={jnt} />
            <CourierSummary name="SPX Express" color="bg-orange-500" agg={spx} />
          </div>

          {/* PPW — read-only, integration to follow */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden opacity-90">
            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-700 text-white">
              <span className="text-sm font-bold flex items-center gap-1.5"><Package className="w-4 h-4" /> PPW (Pending Pick-up Warehouse)</span>
              <span className="text-[11px] font-medium opacity-80">integration to follow</span>
            </div>
            <div className="grid grid-cols-4 gap-px bg-slate-100 text-[11px] font-semibold text-slate-500">
              <span className="bg-slate-50 px-3 py-2 text-right">Amount</span>
              <span className="bg-slate-50 px-3 py-2 text-right">SF %</span>
              <span className="bg-slate-50 px-3 py-2 text-right">RTS %</span>
              <span className="bg-slate-50 px-3 py-2 text-right">PAR</span>
            </div>
            <div className="grid grid-cols-4 gap-px text-sm text-slate-400 tabular-nums">
              <span className="px-3 py-2.5 text-right">{peso(0)}</span>
              <span className="px-3 py-2.5 text-right">0.00%</span>
              <span className="px-3 py-2.5 text-right">0.00%</span>
              <span className="px-3 py-2.5 text-right font-bold">{peso(ppwPar)}</span>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 flex items-center justify-between px-4 py-3">
            <span className="text-sm font-bold text-slate-700">TOTAL PAR (J&T + SPX + PPW)</span>
            <span className="text-base font-extrabold tabular-nums text-blue-600">{peso(projectedAR)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
