"use client"
import { useState, useMemo, useEffect, useCallback } from "react"
import { PieChart, ChevronDown, TrendingUp, TrendingDown, Wallet, ShoppingCart, Megaphone, RefreshCw, Truck } from "lucide-react"
import { format, startOfMonth } from "date-fns"
import { useBookkeeping } from "@/lib/bookkeeping-store"
import { useFinanceSettings } from "@/lib/finance-settings-store"
import { useActivePages } from "@/lib/pages-store"
import { useFbPaidCharges } from "@/lib/fb-paid-store"
import { fetchJntFees } from "@/lib/sales-shared-store"
import { fetchPageRows, mapLimit, aggregateCourier } from "@/lib/courier-live"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"

const VAT_RATE = 0.12   // reverse-charge 12% VAT on FB-billed ad spend (same as Income Statement)

function defaultDateA() { return format(startOfMonth(new Date()), "yyyy-MM-dd") }
function defaultDateB() { return format(new Date(), "yyyy-MM-dd") }

function fmtPeso(n: number) {
  return "₱ " + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function CardDecoration({ icon: Icon, className }: { icon: any; className?: string }) {
  return (
    <div className={`absolute pointer-events-none select-none ${className}`}>
      <Icon strokeWidth={1} className="w-28 h-28 opacity-[0.08] text-white" />
    </div>
  )
}

interface BankTransaction { type: string; debit: number; credit: number }
interface BankData {
  name: string; abbr: string; runningBalance: number; color: string
  transactions: BankTransaction[]
}

const BANK_PALETTE = ["bg-red-600", "bg-blue-500", "bg-emerald-600", "bg-violet-600", "bg-amber-600", "bg-cyan-600", "bg-pink-600", "bg-slate-600"]

function BankCard({ bank, dateLabel }: { bank: BankData; dateLabel: string }) {
  const [open, setOpen] = useState(false)
  const totalDebit = bank.transactions.reduce((s, t) => s + t.debit, 0)
  const totalCredit = bank.transactions.reduce((s, t) => s + t.credit, 0)
  const isNegative = bank.runningBalance < 0

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-start justify-between px-5 py-4 hover:bg-slate-50 transition-colors text-left"
      >
        <div>
          <p className="text-sm font-bold text-slate-800">{bank.name}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Running Balance:{" "}
            <span className={`font-semibold underline underline-offset-2 ${isNegative ? "text-red-500" : "text-slate-700"}`}>
              {isNegative ? "-" : ""}{fmtPeso(Math.abs(bank.runningBalance))}
            </span>
          </p>
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-400 mt-1 transition-transform flex-shrink-0 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-slate-100 px-5 pb-5">
          <div className="text-center py-3 border border-slate-200 rounded-lg mt-4 mb-0 bg-slate-50">
            <p className="text-xs font-semibold text-slate-600">{dateLabel}</p>
          </div>

          <table className="w-full text-sm mt-0 border border-slate-200 rounded-lg overflow-hidden">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-600">Type of Expense</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-600">Debit</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-600">Credit</th>
              </tr>
            </thead>
            <tbody>
              {bank.transactions.length === 0 ? (
                <tr>
                  <td className="px-4 py-3 text-xs text-slate-400 italic">No transactions</td>
                  <td className="px-4 py-3 text-xs text-slate-400">0.00</td>
                  <td className="px-4 py-3 text-xs text-slate-400">0.00</td>
                </tr>
              ) : bank.transactions.map((t, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-sm text-slate-700">{t.type}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{fmtPeso(t.debit)}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{fmtPeso(t.credit)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 bg-slate-50">
                <td className="px-4 py-2.5 text-xs font-bold text-slate-800 uppercase">Total</td>
                <td className="px-4 py-2.5 text-sm font-bold text-slate-800">{fmtPeso(totalDebit)}</td>
                <td className="px-4 py-2.5 text-sm font-bold text-slate-800">{fmtPeso(totalCredit)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function BusinessFinancePage() {
  const [dateA, setDateA] = useState(defaultDateA())
  const [dateB, setDateB] = useState(defaultDateB())

  const bk = useBookkeeping()
  const fs = useFinanceSettings()
  const activePages = useActivePages()
  const paid = useFbPaidCharges()

  const from = useMemo(() => new Date(dateA), [dateA])
  const to = useMemo(() => new Date(dateB), [dateB])

  const fromStr = format(from, "yyyy-MM-dd")
  const toStr = format(to, "yyyy-MM-dd")

  // ── Live connections (same model as the Income Statement) ──
  // J&T Excel-imported fees (written by the Sales Tracker) override Pancake's shipping_fee.
  const [jntFees, setJntFees] = useState<Record<string, number>>({})
  useEffect(() => { fetchJntFees().then(setJntFees).catch(() => {}) }, [])

  // Connected pages (api_key + pancake id) → live Pancake order rows for courier fees.
  const pages = useMemo(
    () => activePages.filter(p => p.api_key && (p.pancake_page_id || p.shop_id)),
    [activePages])
  const pagesKey = pages.map(p => `${p.id}:${p.api_key}:${p.pancake_page_id || p.shop_id}`).join(",")

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagesKey, fromStr, toStr])
  useEffect(() => { loadRows() }, [loadRows])

  const jnt = useMemo(() => aggregateCourier(rows, "jnt", jntFees), [rows, jntFees])
  const spx = useMemo(() => aggregateCourier(rows, "spx", jntFees), [rows, jntFees])

  // ACTUAL FB Paid charges (fb_paid_charges) in range — the exact VAT-inclusive amounts
  // billed to the card. Manually-logged Book Keeping adspent entries are intentionally
  // excluded (FB Paid only) so the figure is real money-out, not an insights estimate.
  const fbPaid = useMemo(
    () => paid.charges.filter(c => c.paid_date >= fromStr && c.paid_date <= toStr).reduce((s, c) => s + c.amount, 0),
    [paid.charges, fromStr, toStr])
  const asOfLabel = `As of ${format(from, "MMM.dd")} - ${format(to, "MMM.dd, yyyy")}`
  const dateRangeLabel = `${format(from, "MMM. dd, yyyy")} to ${format(to, "MMM. dd, yyyy")}`

  // Enabled (non-disabled) Book Keeping transactions inside the selected date range.
  const txns = useMemo(
    () => bk.txns.filter(t => t.status !== "disabled" && t.posted_date >= fromStr && t.posted_date <= toStr),
    [bk.txns, fromStr, toStr])

  // Lookups so each transaction can read its Account flags + Type-of-Expense OPEX flag from Settings.
  const accountByName = useMemo(() => Object.fromEntries(fs.accounts.map(a => [a.name, a])), [fs.accounts])
  const typeByName = useMemo(() => Object.fromEntries(fs.types.map(t => [t.name, t])), [fs.types])

  // Headline metrics. Debit = money out (expense), Credit = money in (revenue).
  const m = useMemo(() => {
    let grossRevenue = 0, operatingRevenue = 0, adspent = 0, cog = 0, shipping = 0, opex = 0
    for (const t of txns) {
      const a = accountByName[t.account]
      const ty = typeByName[t.type_of_expense]
      const isAds = !!a?.is_adspent, isCog = !!a?.is_cog_purchase, isShip = !!a?.is_shipping_fee
      const isRevolving = isAds || isCog || isShip
      if (t.credit > 0 && !a?.excluded_in_gross_revenue) {
        grossRevenue += t.credit
        if (!isRevolving) operatingRevenue += t.credit
      }
      if (t.debit > 0) {
        if (isAds) adspent += t.debit
        if (isCog) cog += t.debit
        if (isShip) shipping += t.debit
        if (!isRevolving && ty?.opex) opex += t.debit  // OPEX excludes revolving-fund accounts (counted separately)
      }
    }
    return { grossRevenue, operatingRevenue, opex, cog, adspent, shipping }
  }, [txns, accountByName, typeByName])

  // Combined figures — Book Keeping + live sources (same totals the Income Statement shows):
  //   Adspent      = actual FB Paid charges (fb_paid_charges), ex-VAT (VAT folded into revolving)
  //   Shipping Fee = BK shipping-flagged debits + live J&T/SPX courier fees (Sales Tracker)
  //   Revolving    = Adspent + COG + Shipping · the embedded 12% VAT is added into Total OPEX + Revolving
  const adspentTotal = fbPaid / (1 + VAT_RATE)   // ex-VAT portion of the actual FB Paid charges
  const vatAds = fbPaid - adspentTotal           // embedded 12% VAT
  const shippingTotal = m.shipping + jnt.shippingFee + spx.shippingFee
  const revolvingFund = adspentTotal + m.cog + shippingTotal
  const totalOpexRevolving = m.opex + revolvingFund + vatAds

  // Per-bank running balance + a Type-of-Expense breakdown for the expandable cards.
  const banks = useMemo<BankData[]>(() => fs.activeBanks.map((b, i) => {
    const bankTxns = txns.filter(t => t.bank === b.name)
    const groups: Record<string, { debit: number; credit: number }> = {}
    for (const t of bankTxns) {
      const k = t.type_of_expense || "—"
      if (!groups[k]) groups[k] = { debit: 0, credit: 0 }
      groups[k].debit += t.debit; groups[k].credit += t.credit
    }
    const transactions = Object.entries(groups).map(([type, v]) => ({ type, debit: v.debit, credit: v.credit }))
    const runningBalance = bankTxns.reduce((s, t) => s + t.credit - t.debit, 0)  // inflow − outflow
    return { name: b.name, abbr: b.name.slice(0, 2).toUpperCase(), runningBalance, color: BANK_PALETTE[i % BANK_PALETTE.length], transactions }
  }), [fs.activeBanks, txns])

  const totalFund = banks.reduce((s, b) => s + b.runningBalance, 0)

  const financeCards = [
    { label: "GROSS REVENUE", amount: m.grossRevenue, color: "bg-emerald-500", icon: TrendingUp, tip: "Total credit (revenue) from Book Keeping accounts NOT excluded from gross revenue, in range — same figure as the Income Statement." },
    { label: "OPERATING REVENUE", amount: m.operatingRevenue, color: "bg-blue-500", icon: TrendingUp, tip: "Gross revenue excluding revolving-fund accounts (Adspent / COG / Shipping)." },
    { label: "TOTAL OPEX + REVOLVING FUND", amount: totalOpexRevolving, color: "bg-red-500", icon: TrendingDown, tip: "OPEX-type expense debits plus the revolving fund total (incl. VAT on FB ad spend)." },
    { label: "COG PURCHASE", amount: m.cog, color: "bg-orange-500", icon: ShoppingCart, tip: "Debits on accounts flagged 'COG Purchase Account' in Finance Settings." },
    { label: "ADSPENT", amount: adspentTotal, color: "bg-purple-500", icon: Megaphone, tip: "Actual FB Paid charges (Billing Hub), ex-VAT. The 12% VAT is included in Total OPEX + Revolving Fund." },
    { label: "REVOLVING FUND", amount: revolvingFund, color: "bg-slate-600", icon: RefreshCw, tip: "Adspent + COG Purchase + Shipping Fee (live + Book Keeping)." },
    { label: "SHIPPING FEE", amount: shippingTotal, color: "bg-indigo-500", icon: Truck, tip: "Live J&T + SPX courier fees (Sales Tracker source) + Book Keeping shipping-flagged debits." },
  ]

  return (
    <div className="w-full space-y-4">

      <div className="flex items-center justify-between flex-wrap gap-2 pb-4 mb-1 border-b border-slate-100">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><PieChart className="w-5 h-5" /> FINANCE OVERVIEW</h1>
        <div className="flex items-center gap-2">
          <DateRangePicker a={dateA} b={dateB} variant="header"
            onApply={(a, b) => { setDateA(a || defaultDateA()); setDateB(b || defaultDateB()) }} placeholder="This month" />
          <button onClick={loadRows} title="Refresh live courier / adspent data"
            className="h-9 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
            <RefreshCw className={`w-4 h-4 ${loadingRows ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div>
        <p className="text-xs text-slate-500 font-medium mb-2">
          {asOfLabel} · {txns.length} bookkeeping entr{txns.length === 1 ? "y" : "ies"} · {loadingRows
            ? "loading live courier data…"
            : `${rows.length} parcels from ${pages.length} connected page${pages.length === 1 ? "" : "s"}`}
        </p>
        <hr className="border-slate-200" />
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        {financeCards.map(card => (
          <div key={card.label} title={card.tip}
            className={`relative overflow-hidden ${card.color} rounded-xl px-4 py-3 cursor-default hover:opacity-95 transition-opacity flex items-center justify-between h-[78px]`}>
            <div className="absolute left-0 top-0 bottom-0 flex items-center pointer-events-none select-none">
              <card.icon strokeWidth={1} className="w-16 h-16 opacity-[0.08] text-white -ml-2" />
            </div>
            <div className="text-right ml-auto z-10">
              <p className="text-2xl font-bold text-white leading-none">{fmtPeso(card.amount)}</p>
              <p className="text-[11px] text-white/70 font-semibold mt-1 tracking-wider uppercase leading-tight">{card.label}</p>
            </div>
          </div>
        ))}
      </div>

      <hr className="border-slate-200" />

      <div>
        <div className="flex items-center justify-between mb-4">
          <p className="text-base font-bold text-slate-800 tracking-wide uppercase">Book Keeping Summary (Banks)</p>
          <p className="text-xs text-slate-500 font-medium">{asOfLabel}</p>
        </div>

        {banks.length === 0 ? (
          <p className="text-sm text-slate-400 italic">No active banks. Add banks in <span className="font-medium">Finance → Settings → Banks</span>.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {banks.map(bank => (
              <BankCard key={bank.name} bank={bank} dateLabel={dateRangeLabel} />
            ))}
          </div>
        )}
      </div>

      <div className="relative overflow-hidden bg-slate-800 rounded-2xl p-5 flex items-center justify-between">
        <CardDecoration icon={Wallet} className="-left-3 -top-3" />
        <div className="z-10">
          <p className="text-xs text-slate-400 uppercase tracking-widest font-semibold">Actual Company Fund</p>
          <p className="text-xs text-slate-500 mt-1">{banks.length} bank{banks.length === 1 ? "" : "s"} combined · inflow − outflow</p>
        </div>
        <p className={`text-3xl font-bold z-10 ${totalFund < 0 ? "text-red-400" : "text-white"}`}>
          {totalFund < 0 ? "-" : ""}{fmtPeso(Math.abs(totalFund))}
        </p>
      </div>

      <div className="pb-4" />
    </div>
  )
}
