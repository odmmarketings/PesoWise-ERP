"use client"
import { useEffect, useRef, useState, useCallback } from "react"
import { ChevronDown, BarChart3 } from "lucide-react"

// ─────────────────────────────────────────────────────────────────────────────
// MGA BAHAGI NG DASHBOARD — ginagamit ng Sales Warehouse Logistics at ng Finance.
//
// BAKIT ISANG FILE: dalawang dashboard ang may PAREHONG stat card — may kulay,
// may watermark na icon, halaga sa kanan, label sa ilalim. Dalawang kopya iyon
// na maglalayo sa isa't isa sa unang pagbabago. Dito na lang: kapag ito ang
// binago, sabay silang nagbabago.
//
// ⚠ WALANG LOHIKA NG DATOS DITO. Halaga at label lang ang tinatanggap ng mga
// bahaging ito — walang kinukuwenta, walang hinihila. Ang bawat numero sa
// screen ay galing pa rin sa mismong pinanggalingan noon.
// ─────────────────────────────────────────────────────────────────────────────

const reduced = () =>
  typeof window !== "undefined"
  && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

/**
 * Ang bilang na umaakyat papunta sa bagong halaga.
 *
 * ⚠ HINDI ITO PALAMUTI: ang pagtalon ng ₱0.00 papuntang ₱214,429 ay hindi
 * nagsasabi kung anong nangyari; ang pag-akyat ay nagsasabing DUMATING ang
 * datos. Pero may hangganan: ang unang pinta ay hindi ini-animate kapag
 * naghihintay pa (0 → 0 lang iyon), at sinusunod ang ayaw-sa-galaw.
 */
export function useCountUp(target: number, active = true, ms = 620) {
  const [shown, setShown] = useState(target)
  const fromRef = useRef(target)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!active || reduced() || target === fromRef.current) { setShown(target); fromRef.current = target; return }
    const from = fromRef.current
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms)
      // easeOutCubic: mabilis magsimula, dumadausdos sa dulo — kaya ang mata ay
      // nakakahabol sa huling mga digit imbes na mahuli sa biglang pagtigil.
      const e = 1 - Math.pow(1 - p, 3)
      setShown(from + (target - from) * e)
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
      else fromRef.current = target
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [target, active, ms])

  return shown
}

/** Pumapalit sa halaga habang naghihintay — may sariling galaw, walang laman. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`pw-skeleton block ${className}`} />
}

export type StatCardProps = {
  label: string
  /** Ang malaking numero. Ipasa nang naka-format na — hindi ito nagfo-format. */
  value: string
  /** Hilaw na numero para sa pag-akyat; kapag wala, walang pag-akyat. */
  raw?: number
  format?: (n: number) => string
  /** Maliit na teksto sa tabi ng label, hal. bilang ng parcel. */
  meta?: string
  /** Pill sa kanan ng label, hal. "82.40%". */
  pct?: string | null
  color: string           // Tailwind bg-* — hindi nagbabago ang palette
  icon: any
  loading?: boolean
  /** Bilang ng card para sa pagkakasunod ng pagpasok. */
  index?: number
  onClick?: () => void
  title?: string
}

/**
 * Ang stat card. Pareho ng dating palette at laki — ang KALIDAD lang ang iba:
 * mas malalim na anino, ring sa gilid para hindi lumutang sa madilim, watermark
 * na icon na tumataas kapag hinawakan, at skeleton na pumapalit sa spinner.
 *
 * ⚠ BAKIT RING AT HINDI HANGGANAN: sa madilim na tema ang matingkad na card ay
 * walang gilid kontra sa madilim na pahina, kaya nagmumukhang nakalutang na
 * kulay. Ang `ring-inset` ay hindi nagdadagdag ng laki, kaya walang gumagalaw
 * na layout — mahalaga iyon dahil naka-grid ang mga card.
 */
export function StatCard({
  label, value, raw, format, meta, pct, color, icon: Icon,
  loading = false, index = 0, onClick, title,
}: StatCardProps) {
  const animate = typeof raw === "number" && !!format && !loading
  const n = useCountUp(animate ? raw! : 0, animate)
  const shown = animate ? format!(n) : value

  return (
    <div
      title={title}
      onClick={onClick}
      className={`pw-rise group relative overflow-hidden ${color} rounded-xl px-3 py-2.5 sm:px-4 sm:py-3
        flex items-center justify-between h-[70px] sm:h-[78px]
        ring-1 ring-inset ring-white/12 shadow-sm
        transition-[transform,box-shadow] duration-200 ease-out
        hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0
        ${onClick ? "cursor-pointer" : "cursor-default"}`}
      style={{ ["--d" as any]: `${Math.min(index, 11) * 45}ms` }}
    >
      {/* Watermark. Bahagyang lumalaki at lumiliwanag kapag hinawakan — tanda
          na buhay ang card, hindi larawan. */}
      <div className="absolute left-0 top-0 bottom-0 flex items-center pointer-events-none select-none">
        <Icon strokeWidth={1}
          className="w-16 h-16 text-white opacity-[0.08] -ml-2 transition-[transform,opacity] duration-300 ease-out
            group-hover:opacity-[0.16] group-hover:scale-110" />
      </div>
      <div className="text-right ml-auto z-10 min-w-0">
        {loading
          ? <Skeleton className="h-6 sm:h-7 w-24 sm:w-32 ml-auto text-white" />
          : <p className="pw-num text-lg sm:text-2xl font-bold text-white leading-none tabular-nums truncate">{shown}</p>}
        <p className="text-[11px] text-white/75 font-semibold mt-1 tracking-wider uppercase leading-tight truncate">
          {label}{meta ? ` (${meta})` : ""}
          {pct ? <span className="ml-1 font-bold text-white/95">{pct}</span> : null}
        </p>
      </div>
    </div>
  )
}

/**
 * Panel ng chart na SARADO sa simula.
 *
 * ⚠ HINDI LANG NAKATAGO — HINDI NAKA-MOUNT. Ang `children` ay hindi
 * ipinapasok sa DOM hangga't hindi binubuksan, kaya walang Recharts na
 * kumukuwenta ng SVG para sa bagay na walang nakakakita. Iyon ang pagkakaiba
 * ng "hidden by default" na mabilis at ng "hidden by default" na mabigat pa rin.
 *
 * Naaalala ang pinili sa browser na ito — kung binuksan mo kahapon, bukas na
 * ito pagbalik mo. Ang DEFAULT lang ang sarado, hindi ang gusto mo.
 */
export function ChartPanel({
  title, subtitle, storageKey, children, count,
}: {
  title: string; subtitle?: string; storageKey: string
  children: React.ReactNode; count?: number
}) {
  const [open, setOpen] = useState(false)
  const [ready, setReady] = useState(false)

  // Isang beses, sa mount: ang naaalala. Hindi sa `useState` initialiser —
  // walang localStorage sa server, at magkakaiba ang unang pinta (hydration).
  useEffect(() => {
    try { if (localStorage.getItem(storageKey) === "1") setOpen(true) } catch {}
    setReady(true)
  }, [storageKey])

  const toggle = useCallback(() => setOpen(o => {
    const next = !o
    try { localStorage.setItem(storageKey, next ? "1" : "0") } catch {}
    return next
  }), [storageKey])

  return (
    <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
      <button onClick={toggle} aria-expanded={open}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-slate-50 transition-colors">
        <BarChart3 className="w-4 h-4 text-slate-400 shrink-0" />
        <span className="min-w-0">
          <span className="block text-sm font-bold text-slate-800 truncate">{title}</span>
          {subtitle && <span className="block text-[11px] text-slate-500 truncate">{subtitle}</span>}
        </span>
        {typeof count === "number" && count > 0 && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 shrink-0">{count}</span>
        )}
        <span className="ml-auto flex items-center gap-1.5 shrink-0">
          <span className="text-[11px] font-semibold text-slate-400 hidden sm:inline">{open ? "Hide" : "Show"}</span>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {ready && open && (
        <div className="pw-rise border-t border-slate-100 p-3 sm:p-4">{children}</div>
      )}
    </div>
  )
}

/**
 * Ang guhit na gumagapang sa ilalim ng isang seksyon habang may hinihila.
 * Ipinapatong sa isang `relative` na magulang.
 */
export function LoadingBar({ show, className = "text-blue-500" }: { show: boolean; className?: string }) {
  if (!show) return null
  return <span aria-hidden className={`pw-sweep absolute inset-x-0 bottom-0 h-0.5 ${className}`} />
}
