"use client"
import { useMemo, useState } from "react"
import { usePersistedInputs } from "@/lib/profitability-store"
import {
  Calculator, TrendingUp, Wallet, Package, RefreshCw, RotateCcw, Sparkles, ChevronLeft,
  ToggleLeft, ToggleRight,
} from "lucide-react"

// ──────────────────────────────────────────────────────────────────────────────
// Profitability Formula — live e-commerce P&L calculator.
// Cascading model (matches the company's existing sheet) + VAT 12% on Adspent.
//   Gross Sales      = ROAS × Daily Adspent × Days
//   ODZ/INC          = ODZ% × Gross Sales
//   Parcels          = (Gross Sales − ODZ) ÷ Selling Price
//   RTS              = RTS% × (Gross Sales − ODZ)
//   Shipping         = Shipping rate × Parcels
//   COD Fee          = COD% × (Gross Sales − ODZ)
//   COG              = Unit COG × Parcels
//   Adspent (total)  = Daily Adspent × Days
//   VAT 12%          = VAT% × Adspent (total)   ← connected to Adspent
//   Gross Profit     = (Gross − ODZ − RTS) − Shipping − COD − COG − Adspent − VAT
//   NET Profit       = Gross Profit − OPEX
//   Revolving Fund   = COG + Adspent
//   COG of RTS Ret.  = Unit COG × (RTS ÷ Selling Price)
// All inputs persist to localStorage so the calculator survives reloads.
// ──────────────────────────────────────────────────────────────────────────────

const STORE_KEY = "pesowise_profitability_inputs"

interface Inputs {
  roas: number
  price: number          // selling price / AOV
  cog: number            // unit cost of goods
  adspentDaily: number   // daily ad spend
  days: number
  rtsPct: number
  odzPct: number
  shipping: number       // shipping cost per parcel
  codPct: number
  vatPct: number
  opex: number
}

const VAT_PCT = 12   // fixed VAT on total Ad Spend — not user-editable

const ZERO_INPUTS: Inputs = {
  roas: 0, price: 0, cog: 0, adspentDaily: 0, days: 0,
  rtsPct: 0, odzPct: 0, shipping: 0, codPct: 0, vatPct: VAT_PCT, opex: 0,
}

const DEFAULTS: Inputs = {
  roas: 623, price: 699, cog: 130, adspentDaily: 5000, days: 30,
  rtsPct: 20, odzPct: 1, shipping: 14, codPct: 7, vatPct: VAT_PCT, opex: 100000,
}

function peso(n: number) {
  return "₱" + (isFinite(n) ? n : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function pct(n: number) {
  return (isFinite(n) ? n * 100 : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%"
}
function qty(n: number) {
  return (isFinite(n) ? n : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function compute(i: Inputs) {
  const grossSales = i.roas * i.adspentDaily * i.days
  const odz = (i.odzPct / 100) * grossSales
  const netAfterOdz = grossSales - odz
  const parcels = i.price > 0 ? netAfterOdz / i.price : 0
  const rts = (i.rtsPct / 100) * netAfterOdz
  const netAfterRts = netAfterOdz - rts
  const shipping = i.shipping * parcels
  const codFee = (i.codPct / 100) * netAfterOdz
  const cogTotal = i.cog * parcels
  const adspentTotal = i.adspentDaily * i.days
  const vat = (VAT_PCT / 100) * adspentTotal
  const grossProfit = netAfterRts - shipping - codFee - cogTotal - adspentTotal - vat
  const netProfit = grossProfit - i.opex

  const revolvingFund = cogTotal + adspentTotal
  const parcelsFromRts = i.price > 0 ? rts / i.price : 0
  const cogOfRtsReturned = i.cog * parcelsFromRts
  const totalNetPlusRts = netProfit + cogOfRtsReturned
  const parcelPerDay = i.days > 0 ? parcels / i.days : 0

  const netMargin = revolvingFund > 0 ? netProfit / revolvingFund : 0   // NET ÷ Revolving Fund
  const cogPct = i.price > 0 ? i.cog / i.price : 0
  const grossMargin = grossSales > 0 ? grossProfit / grossSales : 0

  return {
    grossSales, odz, netAfterOdz, parcels, rts, netAfterRts, shipping, codFee,
    cogTotal, adspentTotal, vat, grossProfit, netProfit, revolvingFund,
    parcelsFromRts, cogOfRtsReturned, totalNetPlusRts, parcelPerDay,
    netMargin, cogPct, grossMargin,
  }
}

// ── Inputs ────────────────────────────────────────────────────────────────────
const INPUT_FIELDS: { key: keyof Inputs; label: string; suffix?: string; hint?: string }[] = [
  { key: "roas", label: "ROAS", hint: "Return on ad spend" },
  { key: "price", label: "Selling Price", suffix: "₱", hint: "Average order value" },
  { key: "cog", label: "COG per piece", suffix: "₱" },
  { key: "adspentDaily", label: "Ad Spend / day", suffix: "₱" },
  { key: "days", label: "Days" },
  { key: "rtsPct", label: "RTS", suffix: "%" },
  { key: "odzPct", label: "ODZ / INC", suffix: "%" },
  { key: "shipping", label: "Shipping / parcel", suffix: "₱" },
  { key: "codPct", label: "COD Fee", suffix: "%" },
  { key: "opex", label: "OPEX", suffix: "₱" },
]

function InputRow({ field, value, onChange }: {
  field: typeof INPUT_FIELDS[number]; value: number; onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-slate-700">{field.label}</div>
        {field.hint && <div className="text-[11px] text-slate-400 leading-tight">{field.hint}</div>}
      </div>
      <div className="relative w-36 flex-shrink-0">
        {field.suffix === "₱" && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">₱</span>
        )}
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          className={`w-full h-9 rounded-lg border border-slate-300 bg-white text-sm text-right tabular-nums focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 ${field.suffix === "₱" ? "pl-7 pr-3" : "px-3"} ${field.suffix === "%" ? "pr-7" : ""}`}
        />
        {field.suffix === "%" && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">%</span>
        )}
      </div>
    </div>
  )
}

// ── Breakdown rows ──────────────────────────────────────────────────────────────
function Line({ label, rate, value, kind, cls }: {
  label: string; rate?: string; value: string
  kind: "income" | "deduct" | "plain" | "recover"
  cls?: string
}) {
  const styles: Record<string, string> = {
    income: "bg-slate-50 text-slate-800 font-semibold",
    deduct: "text-slate-600",
    plain: "text-slate-600",
    recover: "text-emerald-700",
  }
  const valColor = kind === "deduct" ? "text-rose-600" : kind === "recover" ? "text-emerald-600" : ""
  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 rounded-lg ${styles[kind]} ${cls || ""}`}>
      <span className="flex-1 text-sm">
        {kind === "deduct" && <span className="text-rose-400 mr-1.5">−</span>}
        {kind === "recover" && <span className="text-emerald-400 mr-1.5">+</span>}
        {label}
        {rate && <span className="text-[11px] text-slate-400 ml-2 font-normal">{rate}</span>}
      </span>
      <span className={`text-sm tabular-nums font-semibold ${valColor}`}>{value}</span>
    </div>
  )
}

// ── KPI card ────────────────────────────────────────────────────────────────────
function Kpi({ icon: Icon, label, value, accent, sub }: {
  icon: any; label: string; value: string; accent: string; sub?: string
}) {
  return (
    <div className={`relative overflow-hidden rounded-2xl p-4 text-white ${accent} shadow-sm`}>
      <Icon strokeWidth={1} className="absolute -right-3 -bottom-3 w-24 h-24 opacity-15" />
      <div className="text-[11px] uppercase tracking-wider opacity-90">{label}</div>
      <div className="text-2xl font-bold mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-xs opacity-90 mt-0.5">{sub}</div>}
    </div>
  )
}

export default function ProfitabilityPage() {
  // ONE shared dataset — Standard and Partners always stay in sync; Partners just
  // shows the 25% view of the same numbers. Reset zeroes everything for both modes.
  // Shared team-wide via Supabase (debounced), cached in localStorage for instant paint.
  const [inputs, setInputs] = usePersistedInputs<Inputs>(STORE_KEY, "profitability_inputs", DEFAULTS)

  // Upgraded Version — ROAS × Ad-Spend sensitivity matrix (separate screen).
  const [upgraded, setUpgraded] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  // Partners / Advertiser mode — net profit becomes 25% of overall; everything else unchanged.
  const [partners, setPartners] = useState(false)
  const [animating, setAnimating] = useState(false)
  const [animLabel, setAnimLabel] = useState("")

  const set = (k: keyof Inputs, v: number) => setInputs(p => ({ ...p, [k]: v }))
  const r = useMemo(() => compute(inputs), [inputs])

  function togglePartners() {
    const next = !partners
    setPartners(next)
    setAnimLabel(next ? "PARTNERS MODE" : "STANDARD MODE")
    setAnimating(true)
    setTimeout(() => setAnimating(false), 1700)
  }

  // Partners share 25% of company profit BEFORE OPEX (OPEX is operational, not theirs),
  // so the partner base is Gross Profit (= net profit without operating expenses).
  const PARTNER_SHARE = 0.25
  const netShown = partners ? r.grossProfit * PARTNER_SHARE : r.netProfit
  const netPositive = netShown >= 0
  const netMarginShown = r.revolvingFund > 0 ? netShown / r.revolvingFund : 0
  const totalNetPlusRtsShown = netShown + r.cogOfRtsReturned

  if (upgraded) return <UpgradedVersion onExit={() => setUpgraded(false)} partners={partners} />

  // Theme: gold/amber for Partners, standard palette otherwise.
  const t = partners
    ? {
        netAccent: netPositive ? "bg-gradient-to-br from-amber-500 to-orange-600" : "bg-gradient-to-br from-rose-600 to-rose-700",
        grossAccent: "bg-gradient-to-br from-violet-600 to-purple-700",
        revAccent: "bg-gradient-to-br from-fuchsia-500 to-pink-600",
        parcelAccent: "bg-gradient-to-br from-slate-700 to-slate-900",
        netPill: netPositive ? "bg-gradient-to-r from-amber-500 to-orange-600" : "bg-gradient-to-r from-rose-600 to-rose-700",
        profitRow: "bg-amber-50 text-amber-800",
        titleIcon: "text-amber-600",
      }
    : {
        netAccent: netPositive ? "bg-gradient-to-br from-emerald-500 to-emerald-600" : "bg-gradient-to-br from-rose-600 to-rose-700",
        grossAccent: "bg-gradient-to-br from-blue-600 to-blue-700",
        revAccent: "bg-gradient-to-br from-violet-500 to-violet-600",
        parcelAccent: "bg-gradient-to-br from-slate-700 to-slate-800",
        netPill: netPositive ? "bg-gradient-to-r from-emerald-500 to-emerald-600" : "bg-gradient-to-r from-rose-600 to-rose-700",
        profitRow: "bg-emerald-50 text-emerald-800",
        titleIcon: "text-blue-600",
      }

  return (
    <div className={`space-y-5 transition-colors duration-500 ${partners ? "rounded-2xl" : ""}`}>
      {/* Mode-switch animation overlay */}
      <style>{`
        @keyframes pwBg { 0%{opacity:0} 12%{opacity:1} 78%{opacity:1} 100%{opacity:0} }
        @keyframes pwPop { 0%{transform:scale(.6);opacity:0;filter:blur(8px)} 28%{transform:scale(1.08);opacity:1;filter:blur(0)} 72%{transform:scale(1);opacity:1} 100%{transform:scale(1.12);opacity:0;filter:blur(6px)} }
        @keyframes pwShine { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
      `}</style>
      {animating && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center"
          style={{
            animation: "pwBg 1.7s ease-in-out forwards",
            background: partners
              ? "radial-gradient(circle at 50% 50%, rgba(245,158,11,0.97), rgba(124,45,18,0.98))"
              : "radial-gradient(circle at 50% 50%, rgba(16,185,129,0.96), rgba(15,23,42,0.98))",
          }}
        >
          <div className="text-center px-6" style={{ animation: "pwPop 1.7s ease-in-out forwards" }}>
            <Sparkles className="w-14 h-14 text-white/90 mx-auto mb-3" />
            <div
              className="text-4xl sm:text-5xl font-black tracking-wide text-transparent bg-clip-text"
              style={{
                backgroundImage: "linear-gradient(90deg,#fff,#ffe8b0,#fff)",
                backgroundSize: "200% 100%",
                animation: "pwShine 1.7s linear",
              }}
            >
              {animLabel}
            </div>
            <div className="text-white/80 text-sm mt-2">
              {partners ? "Advertiser share — 25% of profit before OPEX" : "Full company view"}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap pb-4 mb-1 border-b border-slate-100">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2">
          <Calculator className="w-5 h-5" /> PROFITABILITY FORMULA
          {partners && (
            <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
              Partners
            </span>
          )}
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={togglePartners}
            className={`flex items-center gap-1.5 px-3.5 h-9 rounded-lg text-sm font-medium text-white transition-all ${
              partners
                ? "bg-gradient-to-r from-emerald-500 to-emerald-600 shadow-md shadow-emerald-500/30"
                : "bg-gradient-to-r from-amber-500 to-orange-600 shadow-md shadow-amber-500/30"
            }`}
          >
            {partners ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
            {partners ? "Standard Mode" : "Partners Mode"}
          </button>
          <button
            onClick={() => setUpgraded(true)}
            className={`flex items-center gap-1.5 px-3.5 h-9 rounded-lg text-white text-sm font-medium transition-colors ${
              partners ? "bg-orange-500 hover:bg-orange-600" : "bg-teal-500 hover:bg-teal-600"
            }`}
          >
            <Sparkles className="w-4 h-4" /> Upgraded Version
          </button>
          <button
            onClick={() => setConfirmReset(true)}
            className="flex items-center gap-1.5 px-3 h-9 rounded-lg border border-slate-300 bg-white text-sm text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <RotateCcw className="w-4 h-4" /> Reset
          </button>
        </div>
      </div>

      {/* KPI row — Net reflects partner share in Partners mode; Gross / Revolving / Parcels unchanged */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={TrendingUp} label={partners ? "Net Profit (25%)" : "Net Profit"} accent={t.netAccent}
          value={peso(netShown)} sub={partners ? "25% share, before OPEX" : `${pct(netMarginShown)} of revolving fund`} />
        <Kpi icon={Wallet} label="Gross Profit" accent={t.grossAccent}
          value={peso(r.grossProfit)} sub={`${pct(r.grossMargin)} margin`} />
        <Kpi icon={RefreshCw} label="Revolving Fund" accent={t.revAccent}
          value={peso(r.revolvingFund)} sub="COG + Ad Spend" />
        <Kpi icon={Package} label="Total Parcels" accent={t.parcelAccent}
          value={qty(r.parcels)} sub={`${qty(r.parcelPerDay)} / day`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5 items-start">
        {/* Inputs */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="text-sm font-bold text-slate-700 mb-3">Assumptions</h2>
          {INPUT_FIELDS.map(f => (
            <InputRow key={f.key} field={f} value={inputs[f.key]} onChange={v => set(f.key, v)} />
          ))}
        </div>

        {/* Breakdown + recovery + metrics */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <h2 className="text-sm font-bold text-slate-700 mb-3 px-1">Profit & Loss</h2>
            <div className="space-y-1">
              <Line kind="income" label="Gross Sales" value={peso(r.grossSales)} />
              <Line kind="deduct" label="ODZ / INC" rate={`${inputs.odzPct}%`} value={peso(r.odz)} />
              <Line kind="deduct" label="RTS" rate={`${inputs.rtsPct}%`} value={peso(r.rts)} />
              <Line kind="deduct" label="Shipping" rate={`${peso(inputs.shipping)}/parcel`} value={peso(r.shipping)} />
              <Line kind="deduct" label="COD Fee" rate={`${inputs.codPct}%`} value={peso(r.codFee)} />
              <Line kind="deduct" label="COG" rate={`${peso(inputs.cog)}/pc`} value={peso(r.cogTotal)} />
              <Line kind="deduct" label="Ad Spend" value={peso(r.adspentTotal)} />
              <Line kind="deduct" label="VAT" rate="12% of Ad Spend (fixed)" value={peso(r.vat)} />
              <div className={`flex items-center gap-3 px-4 py-2.5 rounded-lg font-bold ${t.profitRow}`}>
                <span className="flex-1 text-sm">Gross Profit</span>
                <span className="text-sm tabular-nums">{peso(r.grossProfit)}</span>
              </div>
              {partners ? (
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-slate-400 line-through decoration-slate-300">
                  <span className="flex-1 text-sm">OPEX <span className="text-[11px] ml-2 no-underline text-amber-600 font-medium">excluded for partners</span></span>
                  <span className="text-sm tabular-nums">{peso(inputs.opex)}</span>
                </div>
              ) : (
                <Line kind="deduct" label="OPEX" value={peso(inputs.opex)} />
              )}
              <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-white mt-1 transition-colors duration-500 ${t.netPill}`}>
                <span className="flex-1 font-bold">{partners ? "PARTNER NET PROFIT (25%, before OPEX)" : "NET PROFIT"}</span>
                <span className="text-lg font-bold tabular-nums">{peso(netShown)}</span>
              </div>
            </div>
          </div>

          {/* Recovery & Revolving Fund + ratios — company-only, hidden in Partners mode */}
          {!partners && (<>
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <h2 className="text-sm font-bold text-slate-700 mb-3 px-1 flex items-center gap-2">
              <RefreshCw className={`w-4 h-4 ${t.titleIcon}`} /> Recovery & Revolving Fund
            </h2>
            <div className="space-y-1">
              <Line kind="plain" label="Parcels from RTS" rate={`${inputs.rtsPct}% returned`} value={qty(r.parcelsFromRts)} />
              <Line kind="recover" label="COG of RTS Returned" rate="recovered capital" value={peso(r.cogOfRtsReturned)} />
              <div className={`flex items-center gap-3 px-4 py-2.5 rounded-lg font-bold ${t.profitRow}`}>
                <span className="flex-1 text-sm">Total Net Profit &amp; COG of RTS Ret.</span>
                <span className="text-sm tabular-nums">{peso(totalNetPlusRtsShown)}</span>
              </div>
              <Line kind="income" label="Total Revolving Fund &amp; Net Profit" value={peso(r.revolvingFund)} />
            </div>
          </div>

          {/* Key ratios (all gsheet metrics) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { l: partners ? "Net Profit (25%) %" : "Gross / Net Profit %", v: pct(netMarginShown), note: "Net ÷ Revolving" },
              { l: "COG %", v: pct(r.cogPct), note: "Unit COG ÷ Price" },
              { l: "Parcel / Day", v: qty(r.parcelPerDay), note: `${inputs.days} days` },
              { l: "Parcels from RTS", v: qty(r.parcelsFromRts), note: `${inputs.rtsPct}% returned` },
            ].map((m, i) => (
              <div key={i} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-[11px] uppercase tracking-wider text-slate-400">{m.l}</div>
                <div className="text-lg font-bold text-slate-800 tabular-nums mt-0.5">{m.v}</div>
                <div className="text-[11px] text-slate-400">{m.note}</div>
              </div>
            ))}
          </div>
          </>)}
        </div>
      </div>

      {/* Reset confirmation */}
      {confirmReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setConfirmReset(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[380px] p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-slate-500" /> Reset all values?
            </h2>
            <p className="text-sm text-slate-600">
              This sets every field to <strong>0</strong> for both Standard and Partners mode. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setConfirmReset(false)} className="px-4 h-9 rounded-lg border border-slate-300 bg-white text-sm text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={() => { setInputs(ZERO_INPUTS); setConfirmReset(false) }} className="px-4 h-9 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium transition-colors">Reset to 0</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// Upgraded Version — ROAS × Ad-Spend sensitivity matrix.
// Same cascading model as the calculator, ODZ fixed at 1%, fixed 12% VAT (matches the
// company's reference sheet to the centavo). One table block per Ad-Spend value;
// columns sweep the ROAS range. Rows: Total Revolving Funds, Gross/NET Profit %,
// NET Profit, plus a "Δ per 0.1 ROAS" sensitivity figure.
// ════════════════════════════════════════════════════════════════════════════════

const UP_KEY = "pesowise_profitability_upgraded"

interface UpInputs {
  roasFrom: number; roasTo: number; roasStep: number
  pricing: number; cog: number
  adFrom: number; adTo: number; adStep: number
  days: number; rts: number; odz: number; shipping: number; cod: number; opex: number
}

const UP_DEFAULTS: UpInputs = {
  roasFrom: 5, roasTo: 24, roasStep: 1,
  pricing: 350, cog: 26,
  adFrom: 30000, adTo: 80000, adStep: 5000,
  days: 30, rts: 17, odz: 1, shipping: 71, cod: 2, opex: 220000,
}

function rangeOf(from: number, to: number, step: number, cap: number): number[] {
  let s = step > 0 ? step : 1
  let a = from, b = to
  if (b < a) [a, b] = [b, a]
  const out: number[] = []
  for (let v = a; v <= b + 1e-6 && out.length < cap; v += s) out.push(Math.round(v * 100) / 100)
  return out
}

function calcUp(p: UpInputs, roas: number, ad: number, partners = false) {
  const gross = roas * ad * p.days
  const odz = (p.odz / 100) * gross
  const netOdz = gross - odz
  const parcels = p.pricing > 0 ? netOdz / p.pricing : 0
  const rts = (p.rts / 100) * netOdz
  const netRts = netOdz - rts
  const shipping = p.shipping * parcels
  const cod = (p.cod / 100) * netOdz
  const cogT = p.cog * parcels
  const adsT = ad * p.days
  const vat = (VAT_PCT / 100) * adsT          // fixed 12% VAT on total Ad Spend
  const grossProfit = netRts - shipping - cod - cogT - adsT - vat
  // Partners: 25% of profit BEFORE OPEX. Company: full net after OPEX.
  const net = partners ? 0.25 * grossProfit : grossProfit - p.opex
  const revolving = cogT + adsT
  const gnp = revolving > 0 ? net / revolving : 0
  return { net, revolving, gnp, grossProfit }
}

// Heat color (rose → amber → emerald) for a normalized value t∈[0,1] — light tints, dark text stays readable.
function heat(t: number): string {
  const x = Math.max(0, Math.min(1, t))
  const c1 = [254, 205, 205], c2 = [254, 243, 170], c3 = [167, 243, 208] // rose-200 → yellow-200 → emerald-200
  const lerp = (a: number, b: number, f: number) => Math.round(a + (b - a) * f)
  let col: number[]
  if (x < 0.5) { const f = x / 0.5; col = c1.map((a, i) => lerp(a, c2[i], f)) }
  else { const f = (x - 0.5) / 0.5; col = c2.map((a, i) => lerp(a, c3[i], f)) }
  return `rgb(${col[0]},${col[1]},${col[2]})`
}

function UInput({ label, value, onChange, suffix, ro }: {
  label?: string; value: number; onChange?: (v: number) => void; suffix?: string; ro?: boolean
}) {
  return (
    <div>
      {label && <div className="text-[11px] text-slate-400 mb-1">{label}</div>}
      <div className="relative">
        <input
          type="number" disabled={ro} value={Number.isFinite(value) ? value : 0}
          onChange={e => onChange?.(parseFloat(e.target.value) || 0)}
          className={`w-full h-10 rounded-lg border border-slate-300 px-3 text-sm tabular-nums focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 ${suffix ? "pr-8" : ""} ${ro ? "bg-slate-100 text-slate-500" : "bg-white"}`}
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">{suffix}</span>}
      </div>
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-2 sm:gap-4 items-start py-2.5 border-b border-slate-100 last:border-0">
      <label className="text-sm text-slate-600 sm:pt-2.5">{label} <span className="text-red-500">*</span></label>
      <div>{children}</div>
    </div>
  )
}

function UpgradedVersion({ onExit, partners }: { onExit: () => void; partners: boolean }) {
  // Live: persists + recomputes on every change (no Submit needed) — shared via Supabase (debounced).
  const [u, setU] = usePersistedInputs<UpInputs>(UP_KEY, "profitability_upgraded", UP_DEFAULTS)
  const [showForm, setShowForm] = useState(true)

  const set = (k: keyof UpInputs, v: number) => setU(p => ({ ...p, [k]: v }))
  const cogPct = u.pricing > 0 ? Math.round((u.cog / u.pricing) * 100) : 0

  const matrix = useMemo(() => {
    const roasList = rangeOf(u.roasFrom, u.roasTo, u.roasStep, 60)
    const adList = rangeOf(u.adFrom, u.adTo, u.adStep, 40)
    return { roasList, adList }
  }, [u])

  const money = (n: number) => "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const plain = (n: number) => n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap pb-4 mb-1 border-b border-slate-100">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2">
          <Calculator className="w-5 h-5" /> PROFITABILITY FORMULA
          <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 border border-teal-200">Upgraded</span>
          {partners && (
            <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">Partners · 25%</span>
          )}
        </h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowForm(s => !s)}
            className="px-3.5 h-9 rounded-lg border border-slate-300 bg-white text-sm text-slate-600 hover:bg-slate-50 transition-colors">
            {showForm ? "Hide Form" : "Show Form"}
          </button>
          <button onClick={onExit}
            className="flex items-center gap-1.5 px-3.5 h-9 rounded-lg border border-slate-300 bg-white text-sm text-slate-600 hover:bg-slate-50 transition-colors">
            <ChevronLeft className="w-4 h-4" /> Standard
          </button>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-4xl">
          <FieldRow label="COG %">
            <div className="max-w-xs"><UInput value={cogPct} suffix="%" ro /></div>
          </FieldRow>
          <FieldRow label="ROAS (Range)">
            <div className="grid grid-cols-3 gap-3 max-w-2xl">
              <UInput label="From" value={u.roasFrom} onChange={v => set("roasFrom", v)} />
              <UInput label="To" value={u.roasTo} onChange={v => set("roasTo", v)} />
              <UInput label="Interval" value={u.roasStep} onChange={v => set("roasStep", v)} />
            </div>
          </FieldRow>
          <FieldRow label="Pricing">
            <div className="max-w-xs"><UInput value={u.pricing} onChange={v => set("pricing", v)} /></div>
          </FieldRow>
          <FieldRow label="COG">
            <div className="max-w-xs"><UInput value={u.cog} onChange={v => set("cog", v)} /></div>
          </FieldRow>
          <FieldRow label="Ad Spent (Range)">
            <div className="grid grid-cols-3 gap-3 max-w-2xl">
              <UInput label="From" value={u.adFrom} onChange={v => set("adFrom", v)} />
              <UInput label="To" value={u.adTo} onChange={v => set("adTo", v)} />
              <UInput label="Interval" value={u.adStep} onChange={v => set("adStep", v)} />
            </div>
          </FieldRow>
          <FieldRow label="Days">
            <div className="max-w-xs"><UInput value={u.days} onChange={v => set("days", v)} /></div>
          </FieldRow>
          <FieldRow label="RTS %">
            <div className="max-w-xs"><UInput value={u.rts} onChange={v => set("rts", v)} suffix="%" /></div>
          </FieldRow>
          <FieldRow label="ODZ / INC %">
            <div className="max-w-xs"><UInput value={u.odz} onChange={v => set("odz", v)} suffix="%" /></div>
          </FieldRow>
          <FieldRow label="Shipping">
            <div className="max-w-xs"><UInput value={u.shipping} onChange={v => set("shipping", v)} /></div>
          </FieldRow>
          <FieldRow label="COD Fee %">
            <div className="max-w-xs"><UInput value={u.cod} onChange={v => set("cod", v)} suffix="%" /></div>
          </FieldRow>
          {partners ? (
            <div className="py-2.5 text-xs text-amber-600 flex items-center gap-2">
              <ToggleRight className="w-4 h-4" /> Partners view — OPEX excluded; NET shown is 25% of profit before OPEX.
            </div>
          ) : (
            <FieldRow label="OPEX">
              <div className="max-w-xs"><UInput value={u.opex} onChange={v => set("opex", v)} /></div>
            </FieldRow>
          )}

          <p className="text-[11px] text-slate-400 mt-4 flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Includes a fixed 12% VAT on Ad Spend. The matrix below updates automatically as you edit any value.
          </p>
        </div>
      )}

      {/* Result matrix */}
      {matrix && (
      <div className="space-y-10">
      {matrix.adList.map((ad, bi) => {
        const nets = matrix.roasList.map(roas => calcUp(u, roas, ad, partners).net)
        const maxNet = Math.max(...nets)
        const minNet = Math.min(...nets)
        const span = maxNet - minNet || 1
        const r0 = calcUp(u, matrix.roasList[0], ad, partners).net
        const r1 = calcUp(u, matrix.roasList[0] + 1, ad, partners).net
        const roasDiff = (r1 - r0) / 10
        return (
          <div key={bi} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto scrollbar-dark">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-slate-50 border-b border-r border-slate-200 px-3 py-2.5 text-left text-xs font-semibold text-slate-500 min-w-[150px]">
                      Ad Spent {plain(ad)} · RTS {u.rts}%
                    </th>
                    {matrix.roasList.map((roas, i) => (
                      <th key={i} className={`text-white border-b px-3 py-2.5 text-center text-xs font-semibold whitespace-nowrap min-w-[110px] ${partners ? "bg-amber-500 border-amber-400" : "bg-blue-500 border-blue-400"}`}>
                        ROAS {roas}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="sticky left-0 z-10 bg-white border-b border-r border-slate-200 px-3 py-2.5 text-slate-600">Total Revolving Funds</td>
                    {matrix.roasList.map((roas, i) => (
                      <td key={i} className={`border-b border-r border-slate-100 px-3 py-2.5 text-right tabular-nums text-slate-600 ${i % 2 ? "bg-slate-50/60" : ""}`}>{plain(calcUp(u, roas, ad, partners).revolving)}</td>
                    ))}
                  </tr>
                  <tr>
                    <td className="sticky left-0 z-10 bg-white border-b border-r border-slate-200 px-3 py-2.5 text-slate-600">Gross / NET Profit (%)</td>
                    {matrix.roasList.map((roas, i) => {
                      const g = calcUp(u, roas, ad, partners).gnp * 100
                      return (
                        <td key={i} className={`border-b border-r border-slate-100 px-3 py-2.5 text-right tabular-nums font-medium ${g >= 100 ? "text-emerald-600" : "text-slate-500"} ${i % 2 ? "bg-slate-50/60" : ""}`}>{g.toFixed(0)}%</td>
                      )
                    })}
                  </tr>
                  <tr>
                    <td className="sticky left-0 z-10 bg-white border-r border-slate-200 px-3 py-2.5 font-bold text-slate-800">{partners ? "Partner NET (25%)" : "NET Profit"}</td>
                    {matrix.roasList.map((roas, i) => {
                      const net = calcUp(u, roas, ad, partners).net
                      const best = net === maxNet
                      return (
                        <td key={i} className="border-r border-white/60 px-3 py-2.5 text-right tabular-nums font-semibold text-slate-800"
                          style={{ backgroundColor: heat((net - minNet) / span) }}>
                          {best && <span className="text-emerald-700 mr-1">★</span>}
                          {plain(net)}
                        </td>
                      )
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 bg-slate-50 border-t border-slate-100 text-xs text-slate-500 flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
              Δ per 0.1 ROAS: <span className="font-semibold text-slate-700 tabular-nums">{money(roasDiff)}</span>
              <span className="text-slate-400">· NET Profit shaded red → green (low → high); ★ = best</span>
            </div>
          </div>
        )
      })}
      </div>
      )}
    </div>
  )
}
