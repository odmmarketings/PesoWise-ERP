"use client"
import { useState, useMemo, useEffect, useCallback } from "react"
import { PieChart, ChevronDown, TrendingUp, TrendingDown, Wallet, ShoppingCart, Megaphone, RefreshCw, Truck, Percent } from "lucide-react"
import { format, startOfMonth } from "date-fns"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts"
import { StatCard, ChartPanel, LoadingBar } from "@/components/ui/dash"
import { useBookkeeping } from "@/lib/bookkeeping-store"
import { useFinanceSettings } from "@/lib/finance-settings-store"
import { useActivePages } from "@/lib/pages-store"
import { useFbPaidCharges } from "@/lib/fb-paid-store"
import { fetchJntFees } from "@/lib/sales-shared-store"
import { fetchPageRows, mapLimit, aggregateCourier } from "@/lib/courier-live"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"

const VAT_RATE = 0.12   // reverse-charge 12% VAT on FB-billed ad spend — counted as OPEX

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
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white transition-shadow hover:shadow-md">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-start justify-between gap-3 px-4 sm:px-5 py-4 hover:bg-slate-50 transition-colors text-left"
      >
        {/* Ang kulay ng bangko ay isang manipis na guhit sa kaliwa, hindi buong
            bloke — pinapayagan itong makilala nang hindi nakikipagkumpitensya sa
            halaga, na siyang tunay na sagot ng card. */}
        <span className={`w-1 self-stretch rounded-full ${bank.color} shrink-0 opacity-80`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-800 truncate">{bank.name}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Running Balance:{" "}
            <span className={`font-semibold tabular-nums ${isNegative ? "text-red-500" : "text-slate-700"}`}>
              {isNegative ? "-" : ""}{fmtPeso(Math.abs(bank.runningBalance))}
            </span>
          </p>
        </div>
        <span className="flex items-center gap-1.5 shrink-0 mt-0.5">
          <span className="text-[10px] font-semibold text-slate-400 hidden sm:inline">
            {bank.transactions.length} type{bank.transactions.length === 1 ? "" : "s"}
          </span>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open && (
        <div className="pw-rise border-t border-slate-100 px-4 sm:px-5 pb-5">
          <div className="text-center py-3 border border-slate-200 rounded-lg mt-4 mb-0 bg-slate-50">
            <p className="text-xs font-semibold text-slate-600">{dateLabel}</p>
          </div>

          {/* Sa cellphone, ang tatlong kolum ng pera ay pwedeng lumampas sa lapad —
              pinapayagan ang scroll sa loob nito imbes na sirain ang card. */}
          <div className="overflow-x-auto scrollbar-dark -mx-1 px-1">
          <table className="w-full text-sm mt-0 border border-slate-200 rounded-lg overflow-hidden min-w-[380px]">
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
                <td className="px-4 py-2.5 text-sm font-bold text-slate-800 tabular-nums">{fmtPeso(totalDebit)}</td>
                <td className="px-4 py-2.5 text-sm font-bold text-slate-800 tabular-nums">{fmtPeso(totalCredit)}</td>
              </tr>
            </tbody>
          </table>
          </div>
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
  //   Adspent      = actual FB Paid charges (fb_paid_charges), ex-VAT
  //   12% VAT      = reverse-charge VAT on that ad spend — counted as OPEX (NOT the revolving fund)
  //   Shipping Fee = BK shipping-flagged debits + live J&T/SPX courier fees (Sales Tracker)
  //   Revolving    = Adspent (ex-VAT) + COG + Shipping
  const adspentTotal = fbPaid / (1 + VAT_RATE)   // ex-VAT portion of the actual FB Paid charges
  const vat = fbPaid - adspentTotal              // 12% VAT — an operating expense, not revolving
  const shippingTotal = m.shipping + jnt.shippingFee + spx.shippingFee
  const revolvingFund = adspentTotal + m.cog + shippingTotal
  const totalOpexRevolving = m.opex + vat + revolvingFund

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
    { label: "TOTAL OPEX + REVOLVING FUND", amount: totalOpexRevolving, color: "bg-red-500", icon: TrendingDown, tip: "OPEX-type expense debits + 12% ad-spend VAT + the revolving fund total." },
    { label: "COG PURCHASE", amount: m.cog, color: "bg-orange-500", icon: ShoppingCart, tip: "Debits on accounts flagged 'COG Purchase Account' in Finance Settings." },
    { label: "ADSPENT", amount: adspentTotal, color: "bg-purple-500", icon: Megaphone, tip: "Actual FB Paid charges (Billing Hub), ex-VAT — the 12% VAT is the separate card." },
    { label: "12% VAT", amount: vat, color: "bg-rose-500", icon: Percent, tip: "12% reverse-charge VAT on the FB ad spend — an operating expense (part of Total OPEX + Revolving Fund), NOT the Revolving Fund." },
    { label: "REVOLVING FUND", amount: revolvingFund, color: "bg-slate-600", icon: RefreshCw, tip: "Adspent (ex-VAT) + COG Purchase + Shipping Fee (live + Book Keeping)." },
    { label: "SHIPPING FEE", amount: shippingTotal, color: "bg-indigo-500", icon: Truck, tip: "Live J&T + SPX courier fees (Sales Tracker source) + Book Keeping shipping-flagged debits." },
  ]

  // ── MGA CHART ──────────────────────────────────────────────────────────────
  // ⚠ WALANG BAGONG PINAGKUKUNAN. Ang dalawang chart ay ang MISMONG numerong
  // pinipinta na ng mga card sa itaas, nakahanay lang para makita ang laki ng
  // isa kontra sa iba — na hindi kayang sabihin ng walong hiwalay na card.
  const spendMix = useMemo(() => [
    { name: "COG", amount: m.cog, fill: "#f97316" },
    { name: "Adspent", amount: adspentTotal, fill: "#a855f7" },
    { name: "Shipping", amount: shippingTotal, fill: "#6366f1" },
    { name: "12% VAT", amount: vat, fill: "#f43f5e" },
    { name: "OPEX", amount: m.opex, fill: "#64748b" },
  ].filter(d => d.amount > 0).sort((a, b) => b.amount - a.amount),
    [m.cog, m.opex, adspentTotal, shippingTotal, vat])

  const bankMix = useMemo(() => banks
    .map(b => ({ name: b.name, amount: b.runningBalance }))
    .sort((a, b) => b.amount - a.amount), [banks])
  const anyBankMoved = bankMix.some(b => b.amount !== 0)

  return (
    <div className="w-full space-y-4">

      <div className="relative flex items-center justify-between flex-wrap gap-2 pb-4 mb-1 border-b border-slate-100">
        <LoadingBar show={loadingRows} />
        <h1 className="text-base sm:text-lg font-bold text-blue-600 flex items-center gap-2 tracking-tight min-w-0">
          <span className="grid place-items-center w-7 h-7 rounded-lg bg-blue-500/10 text-blue-600 shrink-0">
            <PieChart className="w-4 h-4" />
          </span>
          <span className="truncate">FINANCE OVERVIEW</span>
        </h1>
        <div className="flex items-center gap-2">
          <DateRangePicker a={dateA} b={dateB} variant="header"
            onApply={(a, b) => { setDateA(a || defaultDateA()); setDateB(b || defaultDateB()) }} placeholder="This month" />
          <button onClick={loadRows} title="Refresh live courier / adspent data"
            className="flex items-center justify-center h-9 w-9 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:border-slate-300 shadow-sm transition-colors active:scale-95">
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

      {/* 2 kada hanay sa cellphone — hindi kasya ang halaga sa 3 kolum sa 375px */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {financeCards.map((card, i) => (
          <StatCard key={card.label} label={card.label} color={card.color} icon={card.icon}
            raw={card.amount} format={fmtPeso} value={fmtPeso(card.amount)}
            title={card.tip} index={i} />
        ))}
      </div>

      {/* ── MGA CHART — SARADO SA SIMULA ───────────────────────────────────
          Hindi naka-mount hangga't hindi binubuksan; naaalala ang pinili mo. */}
      <div className="space-y-2.5">
        <ChartPanel title="Where the money went" storageKey="pw_fin_mix"
          subtitle="The same figures as the cards above, side by side"
          count={spendMix.length}>
          {spendMix.length === 0 ? (
            <p className="text-sm text-slate-400 italic py-8 text-center">No expenses recorded in this range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(180, spendMix.length * 46)}>
              <BarChart data={spendMix} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                  tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={76} />
                <Tooltip formatter={(v: any) => fmtPeso(Number(v))} />
                <Bar dataKey="amount" radius={[0, 5, 5, 0]} animationDuration={520}>
                  {spendMix.map(d => <Cell key={d.name} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>

        <ChartPanel title="Balance per bank" storageKey="pw_fin_banks"
          subtitle="Inflow − outflow in range · red means it went out more than it came in"
          count={bankMix.length}>
          {!anyBankMoved ? (
            <p className="text-sm text-slate-400 italic py-8 text-center">No bank movement in this range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(180, bankMix.length * 42)}>
              <BarChart data={bankMix} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                  tickFormatter={(v: number) => Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={96} />
                <Tooltip formatter={(v: any) => fmtPeso(Number(v))} />
                <Bar dataKey="amount" radius={[0, 5, 5, 0]} animationDuration={520}>
                  {bankMix.map(b => <Cell key={b.name} fill={b.amount < 0 ? "#ef4444" : "#10b981"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {banks.map(bank => (
              <BankCard key={bank.name} bank={bank} dateLabel={dateRangeLabel} />
            ))}
          </div>
        )}
      </div>

      {/* Sa cellphone, pumapatong ang label at halaga — kaya nagsasalansan
          (label sa itaas, halaga sa ibaba) sa maliit na screen. */}
      {/* Ang kabuuan. Ito ang huling sagot ng pahina, kaya ito lang ang may
          sariling laki at sariling anino — hindi ito isa pa sa mga card. */}
      <div className="pw-rise relative overflow-hidden bg-slate-800 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3
        ring-1 ring-inset ring-white/10 shadow-lg">
        <CardDecoration icon={Wallet} className="-left-3 -top-3" />
        <div className="z-10">
          <p className="text-xs text-slate-400 uppercase tracking-widest font-semibold">Actual Company Fund</p>
          <p className="text-xs text-slate-500 mt-1">{banks.length} bank{banks.length === 1 ? "" : "s"} combined · inflow − outflow</p>
        </div>
        <p className={`text-2xl sm:text-3xl font-bold z-10 tabular-nums ${totalFund < 0 ? "text-red-400" : "text-white"}`}>
          {totalFund < 0 ? "-" : ""}{fmtPeso(Math.abs(totalFund))}
        </p>
      </div>

      <div className="pb-4" />
    </div>
  )
}
