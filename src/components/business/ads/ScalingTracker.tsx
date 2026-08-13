"use client"
import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import {
  TrendingUp, Skull, Eye, Flame, RefreshCw, Settings, Sparkles, Send,
  ChevronDown, ChevronUp, Pause, Undo2, AlertTriangle, ArrowUp, ArrowDown, Check,
} from "lucide-react"
import { useActivePages } from "@/lib/pages-store"
import { actId, type FBAccount } from "@/lib/fb-store"
import { cachedJson } from "@/lib/pancake-cache"

// ─────────────────────────────────────────────────────────────────────────────
// SCALING TRACKER — nasa loob ng Facebook Ads tab.
//
// MGA DESISYON NG MAY-ARI (Ago 14 2026):
//   • Suggest-only ang default; may auto-pause na maaaring buksan kada rule.
//   • NET ROAS ang batayan: value × (1 − RTS rate ng page) ÷ (spend × 1.12).
//     Ang RTS rate ay kada PAGE sa parehong 30-araw na window (hindi kada ad
//     set — walang per-adset RTS ang Pancake; hayagang sinasabi ito sa UI).
//   • AD SET ang antas ng scale/kill; kada AD ang fatigue.
//   • Ready to scale = net ROAS ≥ 3.9 sa 3+ magkakasunod na araw na may spend.
//
// LIMITASYON NA SADYANG HAYAG: ang auto-pause ay tumatakbo lang kapag BUKAS ang
// tab na ito (client-side). Ang naka-schedule na 9AM/11PM na bantay ay ang
// scripts/scaling-alerts.mjs — nag-aabiso sa Discord, hindi nagpa-pause.
// ─────────────────────────────────────────────────────────────────────────────

const VAT = 1.12
const RULES_KEY = "pesowise_scaling_rules"
const AUTOLOG_KEY = "pesowise_scaling_autolog"

type Rules = {
  scaleRoas: number; scaleDays: number; minDailySpend: number
  killRoas: number; noSalesHour: number; evalMinSpend: number
  bleedRoas: number; bleedSpend: number; cppMax: number
  autoMaster: boolean; autoRules: { lowRoas: boolean; noSales: boolean; bleeding: boolean }
  autoDailyCap: number
}
const DEFAULT_RULES: Rules = {
  scaleRoas: 3.9, scaleDays: 3, minDailySpend: 500,
  killRoas: 2.8, noSalesHour: 9, evalMinSpend: 300,
  bleedRoas: 1.5, bleedSpend: 2000, cppMax: 250,
  autoMaster: false, autoRules: { lowRoas: false, noSales: false, bleeding: false },
  autoDailyCap: 5,
}
function loadRules(): Rules {
  try { return { ...DEFAULT_RULES, ...JSON.parse(localStorage.getItem(RULES_KEY) || "{}") } } catch { return DEFAULT_RULES }
}

type Daily = { date: string; spend: number; purchases: number; purchaseValue: number; impressions: number; clicks: number }
type AdsetModel = {
  id: string; name: string; campaignName: string
  account: FBAccount
  status: string; budget: number
  rtsRate: number
  dailies: Map<string, Daily>
}
type Windows = Record<"w3" | "w7" | "w15" | "w30", { spend: number; value: number; purchases: number; netRoas: number; grossRoas: number; cpp: number }>
type Signal = {
  adset: AdsetModel; windows: Windows
  kind: "scale" | "kill" | "watch"
  rule: string; reason: string; streak: number
  todaySpend: number; todayNet: number
}
type FatigueRow = {
  adId: string; adName: string; adsetName: string; account: FBAccount
  signals: string[]; freq3: number; ctrDelta: number; cpmDelta: number; cppDelta: number
}

// ── Ad-account picker ───────────────────────────────────────────────────────
// Kaparehong hugis ng GroupPicker sa Fulfillment (purple na badge ng kabuuan),
// pero may TATLONG bilang kada ad account: berde = scale, pula = kill,
// dilaw = watch. Kaya makikita agad kung saang account nakatago ang trabaho
// nang hindi kailangang pumili isa-isa.
function AccountPicker({ value, onChange, items, totals }: {
  value: string
  onChange: (v: string) => void
  items: { name: string; scale: number; kill: number; watch: number }[]
  totals: { scale: number; kill: number; watch: number }
}) {
  const [open, setOpen] = useState(false)
  const sorted = useMemo(() =>
    [...items].sort((a, b) =>
      (b.kill + b.scale + b.watch) - (a.kill + a.scale + a.watch) || a.name.localeCompare(b.name)),
    [items])
  const cur = value === "ALL" ? totals : (items.find(i => i.name === value) ?? { scale: 0, kill: 0, watch: 0 })
  const sum = (x: { scale: number; kill: number; watch: number }) => x.scale + x.kill + x.watch
  const withWork = sorted.filter(i => sum(i) > 0).length

  // Ang zero ay pinapatahimik (kulay-abo) para ang mata ay dumapo sa may laman.
  const N = ({ n, tone }: { n: number; tone: "scale" | "kill" | "watch" }) => (
    <span className={`inline-flex items-center justify-center min-w-[22px] h-5 px-1 rounded-md text-[11px] font-bold tabular-nums ${
      n === 0 ? "bg-slate-100 text-slate-300"
        : tone === "scale" ? "bg-emerald-100 text-emerald-700"
          : tone === "kill" ? "bg-rose-100 text-rose-700"
            : "bg-amber-100 text-amber-700"}`}>{n}</span>
  )
  const Trio = ({ x }: { x: { scale: number; kill: number; watch: number } }) => (
    <span className="flex items-center gap-1 shrink-0">
      <N n={x.scale} tone="scale" /><N n={x.kill} tone="kill" /><N n={x.watch} tone="watch" />
    </span>
  )

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="h-9 pl-2 pr-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 flex items-center gap-2 text-sm min-w-[240px] max-w-[330px]">
        <Trio x={cur} />
        <span className="flex-1 text-left truncate text-slate-700">{value === "ALL" ? "All ad accounts" : value}</span>
        <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[45]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-[46] w-[380px] bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Scale · Kill · Watch</span>
              <span className="text-[11px] text-slate-400">{withWork} of {sorted.length} need attention</span>
            </div>
            <div className="max-h-[360px] overflow-y-auto py-1">
              <button onClick={() => { onChange("ALL"); setOpen(false) }}
                className={`w-full px-3 py-2 flex items-center gap-2.5 text-sm hover:bg-slate-50 ${value === "ALL" ? "bg-blue-50" : ""}`}>
                <Trio x={totals} />
                <span className="flex-1 text-left font-semibold text-slate-800 truncate">All ad accounts</span>
                {value === "ALL" && <Check className="w-4 h-4 text-blue-600 shrink-0" />}
              </button>
              <div className="my-1 border-t border-slate-100" />
              {sorted.map(it => (
                <button key={it.name} onClick={() => { onChange(it.name); setOpen(false) }}
                  className={`w-full px-3 py-2 flex items-center gap-2.5 text-sm hover:bg-slate-50 ${value === it.name ? "bg-blue-50" : ""}`}>
                  <Trio x={it} />
                  <span className={`flex-1 text-left truncate ${sum(it) > 0 ? "text-slate-700" : "text-slate-400"}`}>{it.name}</span>
                  {value === it.name && <Check className="w-4 h-4 text-blue-600 shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const peso = (n: number) => "₱" + Math.round(n).toLocaleString("en-PH")
const dec = (n: number) => (isFinite(n) ? n : 0).toFixed(2)
const dstr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const netOf = (value: number, spend: number, rts: number) => spend > 0 ? (value * (1 - rts)) / (spend * VAT) : 0

async function mapLimit<T>(items: T[], limit: number, fn: (i: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) await fn(items[i++]) }))
}

export function ScalingTracker({ accounts, onSignals }: { accounts: FBAccount[]; onSignals?: (n: number) => void }) {
  const allPages = useActivePages()
  const [rules, setRules] = useState<Rules>(() => loadRules())
  const saveRules = (r: Rules) => { setRules(r); try { localStorage.setItem(RULES_KEY, JSON.stringify(r)) } catch {} }

  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [errors, setErrors] = useState<string[]>([])
  const [adsets, setAdsets] = useState<AdsetModel[]>([])
  const [fatigue, setFatigue] = useState<FatigueRow[]>([])
  const [fatigueLoading, setFatigueLoading] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [fOwner, setFOwner] = useState("All")
  const [fAccount, setFAccount] = useState("ALL")
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc")

  const live = useMemo(() => accounts.filter(a => !a.archived && a.token && a.ad_account_id), [accounts])

  // ⚠ ANG BITAG NA NAKA-DOKUMENTO SA CLAUDE.md: ang useActivePages() (at ang mga
  // store array sa pangkalahatan) ay nagbabalik ng SARIWANG array bawat render.
  // Nailagay sila sa dependencies ng load callbacks, kaya WALANG KATAPUSANG
  // nagre-refetch ang tab: render → bagong `load` → effect → setState → render…
  // Kaya "nag-blink-blink" ang loading at hindi natatapos — nire-restart ang hila
  // bago pa matapos (nakita Ago 13 2026; ganito rin ang Jul 9 Fulfillment glitch).
  // Ang effect ay nakakabit na sa VALUE STRING (liveKey); ang arrays ay binabasa
  // sa REF sa oras ng takbo, hindi sa closure.
  const liveKey = useMemo(() => live.map(a => a.id).join(","), [live])
  const liveRef = useRef(live);      liveRef.current = live
  const pagesRef = useRef(allPages); pagesRef.current = allPages

  // ── 30-araw na saklaw (PHT — lokal na orasan ng user) ──────────────────────
  const today = dstr(new Date())
  const from30 = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 29); return dstr(d) }, [])
  const last3From = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 2); return dstr(d) }, [])
  const prev7From = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 9); return dstr(d) }, [])
  const prev7To = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 3); return dstr(d) }, [])

  const load = useCallback(async (force = false) => {
    const live = liveRef.current, allPages = pagesRef.current
    setLoading(true)
    setProgress({ done: 0, total: live.length })
    const errs: string[] = []

    // 1. RTS rate kada page (returning+returned ÷ total sales, parehong window).
    const rtsByPage = new Map<string, number>()
    const pageNames = Array.from(new Set(live.map(a => a.page_name).filter(Boolean)))
    await mapLimit(pageNames, 4, async name => {
      const pg = allPages.find(p => p.name === name && p.api_key && (p.pancake_page_id || p.shop_id))
      if (!pg) return   // walang Pancake creds → walang RTS data → gross ang gagamitin (rate 0, hayag sa UI)
      try {
        const j = await cachedJson(
          `/api/pancake/orders?api_key=${encodeURIComponent(pg.api_key)}&page_id=${encodeURIComponent(pg.pancake_page_id || pg.shop_id)}`
          + `&from=${from30}&to=${today}&phase=fast${force ? "&nocache=1" : ""}`)
        const s = j.statusSales || {}
        const total = Number(s.total || 0)
        if (total > 0) rtsByPage.set(name, Math.min(0.9, (Number(s.returning || 0) + Number(s.returned || 0)) / total))
      } catch (e: any) { errs.push(`${name}: RTS rate — ${String(e?.message).slice(0, 60)}`) }
    })

    // 2. Daily series + adset meta kada account.
    const models: AdsetModel[] = []
    await mapLimit(live, 3, async a => {
      try {
        const acct = actId(a.ad_account_id)
        const [series, meta] = await Promise.all([
          fetch(`/api/fb/insights?series=1&token=${encodeURIComponent(a.token)}&account_id=${acct}&from=${from30}&to=${today}${force ? "&nocache=1" : ""}`).then(r => r.json()),
          fetch(`/api/fb/insights?rich=1&level=adset&parent=${acct}&token=${encodeURIComponent(a.token)}&account_id=${acct}&from=${from30}&to=${today}${force ? "&nocache=1" : ""}`).then(r => r.json()),
        ])
        if (!series.success) { errs.push(`${a.name}: ${String(series.error || "series failed").slice(0, 80)}`); return }
        const metaById = new Map<string, any>((meta.rows || []).map((r: any) => [r.id, r]))
        const byId = new Map<string, AdsetModel>()
        for (const r of series.rows || []) {
          let m = byId.get(r.id)
          if (!m) {
            const mm = metaById.get(r.id) || {}
            m = {
              id: r.id, name: r.name, campaignName: r.campaignName || "",
              account: a, status: mm.status || "—", budget: mm.budget || mm.ownBudget || 0,
              rtsRate: rtsByPage.get(a.page_name) ?? 0,
              dailies: new Map(),
            }
            byId.set(r.id, m)
          }
          m.dailies.set(r.date, { date: r.date, spend: r.spend, purchases: r.purchases, purchaseValue: r.purchaseValue, impressions: r.impressions, clicks: r.clicks })
        }
        models.push(...byId.values())
      } catch (e: any) { errs.push(`${a.name}: ${String(e?.message).slice(0, 80)}`) }
      finally { setProgress(p => ({ ...p, done: p.done + 1 })) }
    })
    setAdsets(models)
    setErrors(errs)
    setLoading(false)
  }, [from30, today])

  // 3. Fatigue kada AD: huling 3 araw vs naunang 7 (frequency mula kay Meta mismo).
  const loadFatigue = useCallback(async (force = false) => {
    const live = liveRef.current
    setFatigueLoading(true)
    const out: FatigueRow[] = []
    await mapLimit(live, 3, async a => {
      try {
        const acct = actId(a.ad_account_id)
        const q = (f: string, t: string) =>
          fetch(`/api/fb/insights?rich=1&level=ad&parent=${acct}&token=${encodeURIComponent(a.token)}&account_id=${acct}&from=${f}&to=${t}${force ? "&nocache=1" : ""}`).then(r => r.json())
        const [cur, prev] = await Promise.all([q(last3From, today), q(prev7From, prev7To)])
        if (!cur.success || !prev.success) return
        const prevById = new Map<string, any>((prev.rows || []).map((r: any) => [r.id, r]))
        for (const r of cur.rows || []) {
          if (r.spend < 100) continue                    // walang saysay ang kaunting datos
          const p = prevById.get(r.id)
          if (!p || p.spend < 100) continue
          const ctrDelta = p.linkCtr > 0 ? (r.linkCtr - p.linkCtr) / p.linkCtr : 0
          const cpmDelta = p.cpm > 0 ? (r.cpm - p.cpm) / p.cpm : 0
          const cppCur = r.purchases > 0 ? r.spend / r.purchases : 0
          const cppPrev = p.purchases > 0 ? p.spend / p.purchases : 0
          const cppDelta = cppPrev > 0 && cppCur > 0 ? (cppCur - cppPrev) / cppPrev : 0
          const signals: string[] = []
          if (r.frequency >= 2.5) signals.push(`frequency ${dec(r.frequency)}`)
          if (ctrDelta <= -0.25) signals.push(`CTR ${Math.round(ctrDelta * 100)}%`)
          if (cpmDelta >= 0.20) signals.push(`CPM +${Math.round(cpmDelta * 100)}%`)
          if (cppDelta >= 0.30) signals.push(`CPP +${Math.round(cppDelta * 100)}%`)
          if (signals.length >= 2) out.push({
            adId: r.id, adName: r.name, adsetName: r.adsetId || "", account: a,
            signals, freq3: r.frequency, ctrDelta, cpmDelta, cppDelta,
          })
        }
      } catch { /* laktawan ang account na bumigo — nasa errors na ng main load kung ganoon */ }
    })
    setFatigue(out)
    setFatigueLoading(false)
  }, [last3From, prev7From, prev7To, today])

  // Isang hila kada tunay na pagbabago ng account set — HINDI kada render.
  // Ang `load`/`loadFatigue` ay sadyang WALA sa deps: matatag na sila ngayon
  // (walang array sa kanilang closure), at ang paglagay sa kanila ay ibabalik
  // lang ang loop.
  useEffect(() => {
    if (!liveKey) return
    load(); loadFatigue()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey])

  // ── Signals ────────────────────────────────────────────────────────────────
  const signals = useMemo<Signal[]>(() => {
    const out: Signal[] = []
    const now = new Date()
    const hour = now.getHours()
    const dates: string[] = []
    for (let i = 29; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); dates.push(dstr(d)) }

    for (const m of adsets) {
      const win = (n: number) => {
        let spend = 0, value = 0, purchases = 0
        for (const dt of dates.slice(-n)) { const d = m.dailies.get(dt); if (d) { spend += d.spend; value += d.purchaseValue; purchases += d.purchases } }
        return { spend, value, purchases, netRoas: netOf(value, spend, m.rtsRate), grossRoas: spend > 0 ? value / (spend * VAT) : 0, cpp: purchases > 0 ? spend / purchases : 0 }
      }
      const windows: Windows = { w3: win(3), w7: win(7), w15: win(15), w30: win(30) }
      if (windows.w30.spend === 0) continue   // walang gastos sa buwan — walang sasabihin

      const tD = m.dailies.get(today)
      const todaySpend = tD?.spend || 0
      const todayNet = tD ? netOf(tD.purchaseValue, tD.spend, m.rtsRate) : 0

      // streak: magkakasunod na araw (pinakabago pababa, laktaw ang today kung
      // maliit pa ang gastos nito — hindi pa tapos ang araw)
      let streak = 0
      const startIdx = todaySpend >= rules.minDailySpend ? dates.length - 1 : dates.length - 2
      for (let i = startIdx; i >= 0; i--) {
        const d = m.dailies.get(dates[i])
        if (!d || d.spend < rules.minDailySpend) break
        if (netOf(d.purchaseValue, d.spend, m.rtsRate) < rules.scaleRoas) break
        streak++
      }

      const isActive = /active/i.test(m.status)
      const base = { adset: m, windows, streak, todaySpend, todayNet }

      if (isActive && streak >= rules.scaleDays) {
        const cur = m.budget || 0
        out.push({ ...base, kind: "scale", rule: "ready_to_scale",
          reason: `Net ROAS ≥ ${rules.scaleRoas} for ${streak} straight days (7d: ${dec(windows.w7.netRoas)}).`
            + (cur > 0 ? ` Raise budget 20–30% (${peso(cur)} → ${peso(cur * 1.25)}), then hold 48h.` : ` Raise budget 20–30%, then hold 48h.`) })
        continue
      }
      if (!isActive) continue   // paused na — walang iki-kill o iba-bantay

      if (windows.w3.netRoas < rules.bleedRoas && windows.w3.spend >= rules.bleedSpend) {
        out.push({ ...base, kind: "kill", rule: "bleeding",
          reason: `Bleeding: 3-day net ROAS ${dec(windows.w3.netRoas)} on ${peso(windows.w3.spend)} spent. Kill now.` })
        continue
      }
      if (hour >= rules.noSalesHour && todaySpend >= rules.evalMinSpend && (tD?.purchases || 0) === 0) {
        out.push({ ...base, kind: "kill", rule: "noSales",
          reason: `No sales by ${rules.noSalesHour}:00 with ${peso(todaySpend)} already spent today.` })
        continue
      }
      if (todaySpend >= rules.evalMinSpend && todayNet < rules.killRoas) {
        out.push({ ...base, kind: "kill", rule: "lowRoas",
          reason: `Today's net ROAS ${dec(todayNet)} < ${rules.killRoas} on ${peso(todaySpend)}. Kill before midnight if it doesn't recover.` })
        continue
      }
      if (windows.w3.purchases > 0 && windows.w3.cpp > rules.cppMax) {
        out.push({ ...base, kind: "kill", rule: "cpp",
          reason: `3-day CPP ${peso(windows.w3.cpp)} > ${peso(rules.cppMax)} ceiling.` })
        continue
      }
      // watch: nasa loob ng 10% ng kill o ng scale
      if ((todaySpend >= rules.evalMinSpend && todayNet < rules.killRoas * 1.1)
        || (streak >= 1 && streak < rules.scaleDays && windows.w3.netRoas >= rules.scaleRoas * 0.9)) {
        out.push({ ...base, kind: "watch", rule: "near",
          reason: streak >= 1
            ? `${streak}/${rules.scaleDays} days toward scale (needs ${rules.scaleDays - streak} more ≥ ${rules.scaleRoas}).`
            : `Today's net ${dec(todayNet)} is within 10% of the ${rules.killRoas} kill line.` })
      }
    }
    return out
  }, [adsets, rules, today])

  // Owner options galing sa REGISTRY (hindi sa loaded rows) para mapipili pa rin
  // ang owner na walang gastos sa buwan.
  const owners = useMemo(() => Array.from(new Set(live.map(a => a.owner).filter(Boolean))).sort(), [live])

  // Ang bilang kada ad account ay sinusukat sa OWNER-filtered set (hindi sa
  // account-filtered) — kung hindi, magiging zero ang lahat ng ibang account
  // pagkapili mo ng isa, at hindi mo na makikita kung saan pa may trabaho.
  const ownerScoped = useMemo(() =>
    fOwner === "All" ? signals : signals.filter(s => s.adset.account.owner === fOwner),
    [signals, fOwner])
  const accountItems = useMemo(() => {
    const m = new Map<string, { name: string; scale: number; kill: number; watch: number }>()
    // Isama ang LAHAT ng account na nasa saklaw ng owner, kahit walang signal —
    // para malaman mong tahimik ito, hindi nawawala.
    for (const a of live) if (fOwner === "All" || a.owner === fOwner) m.set(a.name, { name: a.name, scale: 0, kill: 0, watch: 0 })
    for (const s of ownerScoped) {
      const e = m.get(s.adset.account.name) ?? { name: s.adset.account.name, scale: 0, kill: 0, watch: 0 }
      if (s.kind === "scale") e.scale++; else if (s.kind === "kill") e.kill++; else e.watch++
      m.set(e.name, e)
    }
    return [...m.values()]
  }, [live, fOwner, ownerScoped])
  const accountTotals = useMemo(() => accountItems.reduce(
    (t, i) => ({ scale: t.scale + i.scale, kill: t.kill + i.kill, watch: t.watch + i.watch }),
    { scale: 0, kill: 0, watch: 0 }), [accountItems])

  // Filter + sort ayon sa 7-day net ROAS (ang default na 30-araw na sukat).
  const view = useMemo(() => {
    const f = fAccount === "ALL" ? ownerScoped : ownerScoped.filter(s => s.adset.account.name === fAccount)
    return [...f].sort((a, b) => sortDir === "desc"
      ? b.windows.w7.netRoas - a.windows.w7.netRoas
      : a.windows.w7.netRoas - b.windows.w7.netRoas)
  }, [ownerScoped, fAccount, sortDir])

  // Ang pagpili ng owner ay maaaring mag-alis sa napiling account — ibalik sa ALL
  // para hindi mapagkamalang walang datos.
  useEffect(() => {
    if (fAccount !== "ALL" && !accountItems.some(i => i.name === fAccount)) setFAccount("ALL")
  }, [accountItems, fAccount])

  const scaleRows = view.filter(s => s.kind === "scale")
  const killRows = view.filter(s => s.kind === "kill")
  const watchRows = view.filter(s => s.kind === "watch")
  const fatigueView = useMemo(() => fatigue.filter(f =>
    (fOwner === "All" || f.account.owner === fOwner) && (fAccount === "ALL" || f.account.name === fAccount)),
    [fatigue, fOwner, fAccount])
  // Ang badge sa tab ay hindi naka-filter — ang KABUUAN ang gusto mong makita,
  // hindi ang bahagi ng napiling owner.
  const totalSignals = signals.filter(s => s.kind !== "watch").length + fatigue.length
  useEffect(() => { onSignals?.(totalSignals) }, [totalSignals, onSignals])

  // ── Auto-pause (kapag naka-ON ang master + ang rule) ───────────────────────
  const [autoLog, setAutoLog] = useState<{ date: string; items: { id: string; name: string; token: string }[] }>(() => {
    try { const l = JSON.parse(localStorage.getItem(AUTOLOG_KEY) || "null"); if (l?.date === dstr(new Date())) return l } catch {}
    return { date: dstr(new Date()), items: [] }
  })
  const saveLog = (l: typeof autoLog) => { setAutoLog(l); try { localStorage.setItem(AUTOLOG_KEY, JSON.stringify(l)) } catch {} }
  const [pausing, setPausing] = useState<string>("")

  async function pauseAdset(s: Signal, auto: boolean) {
    setPausing(s.adset.id)
    try {
      const j = await fetch("/api/fb/manage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: s.adset.account.token, action: "status", id: s.adset.id, status: "PAUSED" }),
      }).then(r => r.json())
      if (!j.success) throw new Error(j.error || "pause failed")
      saveLog({ ...autoLog, items: [...autoLog.items, { id: s.adset.id, name: s.adset.name, token: s.adset.account.token }] })
      setAdsets(prev => prev.map(m => m.id === s.adset.id ? { ...m, status: "PAUSED" } : m))
    } catch (e: any) {
      setErrors(prev => [...prev, `${s.adset.name}: ${auto ? "auto-" : ""}pause failed — ${String(e?.message).slice(0, 80)}`])
    } finally { setPausing("") }
  }
  async function undoPause(item: { id: string; name: string; token: string }) {
    try {
      const j = await fetch("/api/fb/manage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: item.token, action: "status", id: item.id, status: "ACTIVE" }),
      }).then(r => r.json())
      if (!j.success) throw new Error(j.error || "undo failed")
      saveLog({ ...autoLog, items: autoLog.items.filter(x => x.id !== item.id) })
      setAdsets(prev => prev.map(m => m.id === item.id ? { ...m, status: "ACTIVE" } : m))
    } catch (e: any) { setErrors(prev => [...prev, `${item.name}: undo failed — ${String(e?.message).slice(0, 80)}`]) }
  }
  useEffect(() => {
    if (!rules.autoMaster || loading) return
    const eligible = killRows.filter(s =>
      rules.autoRules[s.rule as keyof Rules["autoRules"]]
      && /active/i.test(s.adset.status)
      && !autoLog.items.some(x => x.id === s.adset.id))
    const room = rules.autoDailyCap - autoLog.items.length
    for (const s of eligible.slice(0, Math.max(0, room))) pauseAdset(s, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules.autoMaster, loading, killRows.length])

  // ── AI ─────────────────────────────────────────────────────────────────────
  const [aiOpen, setAiOpen] = useState<string>("")     // adset id na may bukas na opinion
  const [aiText, setAiText] = useState<Record<string, string>>({})
  const [aiBusy, setAiBusy] = useState<string>("")
  const [askQ, setAskQ] = useState("")
  const [askA, setAskA] = useState("")

  const compactRow = (s: Signal) => ({
    adset: s.adset.name, campaign: s.adset.campaignName, account: s.adset.account.name,
    signal: s.kind, rule: s.rule, streak: s.streak, status: s.adset.status,
    budget: s.adset.budget, rtsRate: +s.adset.rtsRate.toFixed(3),
    today: { spend: Math.round(s.todaySpend), netRoas: +dec(s.todayNet) },
    d3: { spend: Math.round(s.windows.w3.spend), netRoas: +dec(s.windows.w3.netRoas), cpp: Math.round(s.windows.w3.cpp) },
    d7: { spend: Math.round(s.windows.w7.spend), netRoas: +dec(s.windows.w7.netRoas) },
    d15: { spend: Math.round(s.windows.w15.spend), netRoas: +dec(s.windows.w15.netRoas) },
    d30: { spend: Math.round(s.windows.w30.spend), netRoas: +dec(s.windows.w30.netRoas) },
  })
  async function askAi(mode: "row" | "brief" | "ask", s?: Signal) {
    const key = mode === "row" && s ? s.adset.id : mode
    setAiBusy(key)
    try {
      const rows = mode === "row" && s ? [compactRow(s)] : view.map(compactRow)
      const j = await fetch("/api/ai/scaling", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, rows, question: mode === "ask" ? askQ : undefined }),
      }).then(r => r.json())
      const text = j.success ? j.text : `⚠ ${j.error}`
      if (mode === "row" && s) { setAiText(p => ({ ...p, [s.adset.id]: text })); setAiOpen(s.adset.id) }
      else setAskA(text)
    } finally { setAiBusy("") }
  }

  // ── UI ─────────────────────────────────────────────────────────────────────
  const Row = ({ s, accent }: { s: Signal; accent: string }) => (
    <div className={`border-l-4 ${accent} bg-white rounded-lg border border-slate-200 p-3 space-y-1.5`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-800 text-sm">{s.adset.name}</span>
        <span className="text-[11px] text-slate-400">{s.adset.campaignName} · {s.adset.account.name}</span>
        {s.adset.budget > 0 && <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">budget {peso(s.adset.budget)}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          <button onClick={() => askAi("row", s)} disabled={aiBusy === s.adset.id}
            className="text-[11px] flex items-center gap-1 px-2 py-1 rounded-md border border-violet-200 text-violet-600 hover:bg-violet-50 disabled:opacity-50">
            <Sparkles className="w-3 h-3" /> {aiBusy === s.adset.id ? "…" : "AI opinion"}
          </button>
          {s.kind === "kill" && /active/i.test(s.adset.status) && (
            <button onClick={() => { if (confirm(`Pause ad set "${s.adset.name}" on Facebook?`)) pauseAdset(s, false) }}
              disabled={pausing === s.adset.id}
              className="text-[11px] flex items-center gap-1 px-2 py-1 rounded-md bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">
              <Pause className="w-3 h-3" /> {pausing === s.adset.id ? "…" : "Pause now"}
            </button>
          )}
        </span>
      </div>
      <p className="text-[13px] text-slate-600">{s.reason}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 tabular-nums">
        {(["w3", "w7", "w15", "w30"] as const).map((w, i) => {
          const win = s.windows[w]
          const prev = i < 3 ? s.windows[(["w7", "w15", "w30"] as const)[i]] : null
          const up = prev ? win.netRoas >= prev.netRoas : true
          return (
            <span key={w}>
              {w.slice(1)}d: <b className={win.netRoas >= rules.scaleRoas ? "text-emerald-600" : win.netRoas < rules.killRoas ? "text-rose-600" : "text-slate-700"}>{dec(win.netRoas)}</b>
              {prev && (up ? <ChevronUp className="inline w-3 h-3 text-emerald-500" /> : <ChevronDown className="inline w-3 h-3 text-rose-500" />)}
              <span className="text-slate-400"> ({peso(win.spend)})</span>
            </span>
          )
        })}
        <span className="text-slate-400">gross 7d: {dec(s.windows.w7.grossRoas)} · RTS rate {(s.adset.rtsRate * 100).toFixed(1)}%</span>
      </div>
      {aiOpen === s.adset.id && aiText[s.adset.id] && (
        <div className="text-[13px] bg-violet-50 border border-violet-200 rounded-md p-2.5 text-slate-700 whitespace-pre-wrap">{aiText[s.adset.id]}</div>
      )}
    </div>
  )

  const Section = ({ title, icon: Icon, color, rows, accent, empty }: any) => (
    <div className="space-y-2">
      <p className={`text-sm font-bold ${color} flex items-center gap-1.5`}><Icon className="w-4 h-4" /> {title} ({rows.length})</p>
      {rows.length === 0
        ? <p className="text-[13px] text-slate-400 italic">{empty}</p>
        : rows.map((s: Signal) => <Row key={s.adset.id} s={s} accent={accent} />)}
    </div>
  )

  const num = (v: number, set: (n: number) => void) => (
    <input type="number" step="0.1" value={v} onChange={e => set(Number(e.target.value))}
      className="w-20 h-8 rounded border border-slate-300 px-2 text-sm text-right" />
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="space-y-1">
          <p className="text-sm text-slate-500">
            Net ROAS = value × (1 − page RTS rate) ÷ (spend × 1.12) · window: last 30 days · ad-set level
          </p>
          {/* Legend — ang tatlong bilang sa account picker ay nasa ganitong pagkakasunod */}
          <p className="text-[11px] text-slate-400 flex items-center gap-2.5">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> scale</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500" /> kill</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> watch</span>
          </p>
        </div>
        <span className="ml-auto flex items-center gap-2">
          <select value={fOwner} onChange={e => setFOwner(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 min-w-[130px]">
            <option value="All">All Owners</option>
            {owners.map(o => <option key={o}>{o}</option>)}
          </select>
          <AccountPicker value={fAccount} onChange={setFAccount} items={accountItems} totals={accountTotals} />
          <button onClick={() => setSortDir(d => d === "desc" ? "asc" : "desc")}
            title={sortDir === "desc" ? "Highest net ROAS first" : "Lowest net ROAS first"}
            className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-600 flex items-center gap-1.5 hover:bg-slate-50 whitespace-nowrap">
            ROAS {sortDir === "desc" ? <ArrowDown className="w-3.5 h-3.5" /> : <ArrowUp className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => askAi("brief")} disabled={aiBusy === "brief" || loading}
            className="h-9 px-3 rounded-lg bg-violet-600 text-white text-sm flex items-center gap-1.5 hover:bg-violet-700 disabled:opacity-50">
            <Sparkles className="w-4 h-4" /> {aiBusy === "brief" ? "Thinking…" : "Morning brief"}
          </button>
          <button onClick={() => setSettingsOpen(o => !o)} className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-600 flex items-center gap-1.5 hover:bg-slate-50">
            <Settings className="w-4 h-4" /> Rules
          </button>
          <button onClick={() => { load(true); loadFatigue(true) }} disabled={loading}
            className="h-9 w-9 rounded-lg border border-slate-200 bg-white text-slate-600 flex items-center justify-center hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </span>
      </div>

      {/* Auto-pause status */}
      {rules.autoMaster && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5 text-[13px] text-rose-700 flex flex-wrap items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span><b>Auto-pause is ON</b> ({Object.entries(rules.autoRules).filter(([, v]) => v).map(([k]) => k).join(", ") || "no rules enabled"}) — cap {rules.autoDailyCap}/day, {autoLog.items.length} paused today. Runs only while this tab is open.</span>
        </div>
      )}
      {autoLog.items.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-[13px] text-slate-600 space-y-1">
          <p className="font-semibold text-slate-700">Paused today (undo re-activates on Facebook):</p>
          {autoLog.items.map(it => (
            <p key={it.id} className="flex items-center gap-2">{it.name}
              <button onClick={() => undoPause(it)} className="text-[11px] flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-300 hover:bg-slate-50"><Undo2 className="w-3 h-3" /> Undo</button>
            </p>
          ))}
        </div>
      )}

      {/* Settings */}
      {settingsOpen && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 text-sm">
          <p className="font-bold text-slate-800">Rules — saved on this browser</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-slate-600">
            <label className="flex items-center justify-between gap-2">Scale: net ROAS ≥ {num(rules.scaleRoas, n => saveRules({ ...rules, scaleRoas: n }))}</label>
            <label className="flex items-center justify-between gap-2">…for days {num(rules.scaleDays, n => saveRules({ ...rules, scaleDays: n }))}</label>
            <label className="flex items-center justify-between gap-2">Min daily spend {num(rules.minDailySpend, n => saveRules({ ...rules, minDailySpend: n }))}</label>
            <label className="flex items-center justify-between gap-2">Kill: day net ROAS &lt; {num(rules.killRoas, n => saveRules({ ...rules, killRoas: n }))}</label>
            <label className="flex items-center justify-between gap-2">No-sales check hour {num(rules.noSalesHour, n => saveRules({ ...rules, noSalesHour: n }))}</label>
            <label className="flex items-center justify-between gap-2">Eval min spend {num(rules.evalMinSpend, n => saveRules({ ...rules, evalMinSpend: n }))}</label>
            <label className="flex items-center justify-between gap-2">Bleeding: 3d net &lt; {num(rules.bleedRoas, n => saveRules({ ...rules, bleedRoas: n }))}</label>
            <label className="flex items-center justify-between gap-2">…at 3d spend ≥ {num(rules.bleedSpend, n => saveRules({ ...rules, bleedSpend: n }))}</label>
            <label className="flex items-center justify-between gap-2">CPP ceiling (3d) {num(rules.cppMax, n => saveRules({ ...rules, cppMax: n }))}</label>
          </div>
          <hr className="border-slate-100" />
          <p className="font-bold text-slate-800">Auto-pause <span className="font-normal text-slate-400">(acts on real Facebook ad sets — start with suggest-only)</span></p>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-slate-600">
            <label className="flex items-center gap-2"><input type="checkbox" checked={rules.autoMaster} onChange={e => saveRules({ ...rules, autoMaster: e.target.checked })} /> Master switch</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={rules.autoRules.bleeding} onChange={e => saveRules({ ...rules, autoRules: { ...rules.autoRules, bleeding: e.target.checked } })} /> Bleeding</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={rules.autoRules.lowRoas} onChange={e => saveRules({ ...rules, autoRules: { ...rules.autoRules, lowRoas: e.target.checked } })} /> Low ROAS</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={rules.autoRules.noSales} onChange={e => saveRules({ ...rules, autoRules: { ...rules.autoRules, noSales: e.target.checked } })} /> No sales</label>
            <label className="flex items-center justify-between gap-2">Daily cap {num(rules.autoDailyCap, n => saveRules({ ...rules, autoDailyCap: n }))}</label>
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-[13px] text-amber-800 space-y-0.5">
          <p className="font-semibold">Some data didn&apos;t load — the lists below may be incomplete:</p>
          {errors.slice(0, 6).map((e, i) => <p key={i}>{e}</p>)}
        </div>
      )}

      {loading ? (
        <div className="py-10 space-y-3">
          <p className="text-sm text-slate-400 flex items-center gap-2 justify-center">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Pulling 30 days of ad-set data — {progress.done}/{progress.total} accounts
          </p>
          <div className="mx-auto w-64 h-1.5 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-[width] duration-300"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
        </div>
      ) : (
        <>
          <Section title="Ready to Scale" icon={TrendingUp} color="text-emerald-600" accent="border-emerald-500" rows={scaleRows}
            empty={`None yet — needs net ROAS ≥ ${rules.scaleRoas} for ${rules.scaleDays}+ straight days with ≥ ${peso(rules.minDailySpend)}/day.`} />
          <Section title="Kill Suggestions" icon={Skull} color="text-rose-600" accent="border-rose-500" rows={killRows}
            empty="Nothing hits the kill rules right now." />
          <Section title="Watch" icon={Eye} color="text-amber-600" accent="border-amber-400" rows={watchRows}
            empty="Nothing within 10% of a threshold." />

          {/* Fatigue — kada AD */}
          <div className="space-y-2">
            <p className="text-sm font-bold text-violet-600 flex items-center gap-1.5">
              <Flame className="w-4 h-4" /> Creative Fatigue — per ad ({fatigueView.length})
              {fatigueLoading && <RefreshCw className="w-3 h-3 animate-spin text-slate-400" />}
            </p>
            {fatigueView.length === 0
              ? <p className="text-[13px] text-slate-400 italic">{fatigueLoading ? "Comparing last 3 days vs the 7 before…" : "No ad shows 2+ fatigue signals."}</p>
              : fatigueView.map(f => (
                <div key={f.adId} className="border-l-4 border-violet-400 bg-white rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-800 text-sm">{f.adName}</span>
                    <span className="text-[11px] text-slate-400">{f.account.name}</span>
                    <span className="ml-auto text-[11px] bg-violet-50 text-violet-600 px-2 py-0.5 rounded-full">refresh creative — don&apos;t kill</span>
                  </div>
                  <p className="text-[13px] text-slate-600 mt-1">Signals (last 3d vs prior 7d): {f.signals.join(" · ")}</p>
                </div>
              ))}
          </div>

          {/* Ask AI */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
            <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-violet-600" /> Ask AI <span className="font-normal text-slate-400">— context: the {view.length} signal rows shown{fOwner !== "All" ? ` (${fOwner})` : ""}</span></p>
            <div className="flex gap-2">
              <input value={askQ} onChange={e => setAskQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && askQ.trim()) askAi("ask") }}
                placeholder="e.g. why did Lumyra Katarata drop the last 3 days?"
                className="flex-1 h-10 rounded-lg border border-slate-200 px-3 text-sm" />
              <button onClick={() => askAi("ask")} disabled={!askQ.trim() || aiBusy === "ask"}
                className="h-10 px-4 rounded-lg bg-violet-600 text-white text-sm flex items-center gap-1.5 hover:bg-violet-700 disabled:opacity-50">
                <Send className="w-4 h-4" /> {aiBusy === "ask" ? "…" : "Ask"}
              </button>
            </div>
            {askA && <div className="text-[13px] bg-violet-50 border border-violet-200 rounded-md p-3 text-slate-700 whitespace-pre-wrap">{askA}</div>}
          </div>
        </>
      )}
    </div>
  )
}
