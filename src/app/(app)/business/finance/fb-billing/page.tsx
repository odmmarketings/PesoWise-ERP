"use client"
import { useMemo, useRef, useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DateRangePicker } from "@/components/business/PancakeDatePicker"
import { Receipt, RefreshCw, Check, CreditCard, AlertTriangle, Plus, X, Trash2, BarChart3 } from "lucide-react"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"
import { useFBAccounts, actId } from "@/lib/fb-store"
import { useFinanceCards, cardLabel, cardLast4, type FinanceCard } from "@/lib/cards-store"
import { useFinanceSettings } from "@/lib/finance-settings-store"
import { isMotherAccount } from "@/lib/users-store"
import { useFbBilling, FB_ADS_ACCOUNT, FB_ADS_TYPE, FB_VAT_RATE, billedTotal, type FbBillingRecord } from "@/lib/fb-billing-store"
import { useFbPaidCharges, type FbPaidCharge } from "@/lib/fb-paid-store"

const SEL = "h-9 rounded-lg border border-slate-300 px-2 text-sm bg-white focus:outline-none focus:border-blue-400"
const peso = (n: number) => "₱ " + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function dstr(d: Date) { return d.toISOString().slice(0, 10) }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return dstr(d) }

// Relative time (para sa auto-sync banner): "2 hours ago", "Jul 20, 9:03 AM".
function relTime(iso: string): string {
  const then = new Date(iso).getTime()
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`
  return new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

// Itugma ang last-4 sa CARDS registry (card number → account number → manual link).
function matchCard(cards: FinanceCard[], last4: string, manualCardId = ""): FinanceCard | undefined {
  if (last4) {
    const byCard = cards.find(c => c.card_number.replace(/\D/g, "").endsWith(last4))
    if (byCard) return byCard
    const byAcct = cards.find(c => c.account_number.replace(/\D/g, "").endsWith(last4))
    if (byAcct) return byAcct
  }
  return manualCardId ? cards.find(c => c.id === manualCardId) : undefined
}

const STICKY = "sticky bottom-0 bg-slate-50 border-t-2 border-slate-300"

export default function FbBillingPage() {
  const fb = useFBAccounts()
  const { cards } = useFinanceCards()
  const fs = useFinanceSettings()
  const billing = useFbBilling()
  const paid = useFbPaidCharges()
  const admin = isMotherAccount()

  const [tab, setTab] = useState<"paid" | "daily">("paid")
  const [syncing, setSyncing] = useState(false)
  const [notes, setNotes] = useState<string[]>([])
  const [fAccount, setFAccount] = useState("All")
  const [fOwner, setFOwner] = useState("All")
  const [fBank, setFBank] = useState("All")
  // Standard view = THIS MONTH; i-clear ang picker para makita lahat.
  const [dateA, setDateA] = useState(dstr(new Date()).slice(0, 8) + "01")
  const [dateB, setDateB] = useState(dstr(new Date()))
  const [showAdd, setShowAdd] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<FbPaidCharge | null>(null)
  const autoRan = useRef(false)
  const refsEnsured = useRef(false)

  // Auto-sync status (isinusulat ng daily scheduled task) — "Last synced" message.
  const [syncStatus, setSyncStatus] = useState<{ last_sync_at: string | null; ok: boolean; note: string } | null>(null)
  useEffect(() => {
    (async () => {
      const businessId = await getBusinessId()
      if (!businessId) return
      const supabase = createSupabaseBrowserClient()
      const { data } = await supabase.from("fb_sync_status").select("last_sync_at, ok, note").eq("business_id", businessId).maybeSingle()
      if (data) setSyncStatus(data)
    })()
  }, [])

  const eligible = useMemo(
    () => fb.accounts.filter(a => !a.archived && a.ad_account_id && a.token),
    [fb.accounts])

  const dept = fs.activeDepartments.find(d => /marketing/i.test(d.name))?.name || fs.activeDepartments[0]?.name || ""

  // Siguraduhing may Book Keeping account + type para sa FB bills (isang beses lang).
  useEffect(() => {
    if (refsEnsured.current || !fs.loaded) return
    refsEnsured.current = true
    if (!fs.accounts.find(a => a.name === FB_ADS_ACCOUNT)) {
      fs.addAccount({ name: FB_ADS_ACCOUNT, with_voucher: false, bank_id: "", is_adspent: false, is_cog_purchase: false, is_shipping_fee: false, excluded_in_gross_revenue: false, members: [] })
    }
    if (!fs.types.find(t => t.name === FB_ADS_TYPE)) {
      fs.addType({ name: FB_ADS_TYPE, opex: false, type: "Debit" })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fs.loaded])

  // Bank ng card provider — token-based match kaya kahit i-rename ang bank (hal. "PayMaya"
  // card → "Maya (Domini)") ay tumutugma pa rin; "GoTyme" → "GOTYME (Eric)".
  function bankFor(card?: FinanceCard): string {
    if (!card?.provider) return ""
    const words = (s: string) => s.toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter(w => w.length >= 4)
    const pw = words(card.provider)
    const hit = fs.activeBanks.find(b => {
      const bw = words(b.name)
      return pw.some(p => bw.some(x => p.includes(x) || x.includes(p)))
    })
    return hit?.name || ""
  }

  // ── DAILY SPEND sync — ANALYTICS LANG (hindi na nagpo-post sa Book Keeping; ang
  // Paid Charges tab na ang ledger source para 1:1 sa bank statement) ──
  async function sync() {
    if (syncing || !fs.loaded || !billing.loaded) return
    setSyncing(true)
    const msgs: string[] = []
    try {
      const vatOf = (media: number) => Math.round(media * FB_VAT_RATE * 100) / 100
      const byKey = new Map(billing.records.map(r => [`${r.ad_account_id}|${r.date}`, r]))
      const yesterday = daysAgo(1)
      let added = 0, corrected = 0

      for (const a of eligible) {
        const acct = actId(a.ad_account_id)
        try {
          const fRes = await fetch(`/api/fb/insights?funding=1&token=${encodeURIComponent(a.token)}&account_id=${encodeURIComponent(acct)}`)
          const fJson = await fRes.json().catch(() => ({}))
          const display = fJson.display || ""
          const last4 = fJson.last4 || ""
          const card = matchCard(cards, last4, a.card_id)
          const bank = bankFor(card)

          const sRes = await fetch(`/api/fb/insights?token=${encodeURIComponent(a.token)}&account_id=${encodeURIComponent(acct)}&from=${daysAgo(30)}&to=${yesterday}`)
          const sJson = await sRes.json().catch(() => ({}))
          if (!sJson.success) { msgs.push(`${a.name}: ${sJson.error || "spend fetch failed"}`); continue }

          for (const [date, amtRaw] of Object.entries(sJson.byDate || {})) {
            const media = Math.round(Number(amtRaw) * 100) / 100
            if (!(media > 0)) continue
            const vat = vatOf(media)
            const existing = byKey.get(`${acct}|${date}`)
            if (existing) {
              if (existing.amount !== media || existing.vat !== vat) {
                await billing.updateRecordAmount({ ...existing, amount: media, vat }, Math.round((media + vat) * 100) / 100)
                corrected++
              }
              continue
            }
            const rec: FbBillingRecord = {
              ad_account_id: acct, date, ad_account_name: a.name, amount: media, vat, currency: a.currency || "PHP",
              funding_display: display, card_last4: last4, matched_card_id: card?.id || "", bank,
              recorded_txn_id: null,
            }
            const saveErr = await billing.saveRecord(rec)
            if (saveErr) { msgs.push(`${a.name}: could not save the record (${saveErr}).`); break }
            byKey.set(`${acct}|${date}`, rec)
            added++
          }
        } catch (e: any) {
          msgs.push(`${a.name}: ${e?.message || "sync failed"}`)
        }
      }

      await billing.refresh()
      msgs.unshift(added > 0 || corrected > 0
        ? `${added} new day${added === 1 ? "" : "s"}${corrected > 0 ? `, ${corrected} updated (settling)` : ""} — analytics data.`
        : "Daily analytics is up to date.")
    } finally {
      setNotes(msgs)
      setSyncing(false)
    }
  }

  // Automated: analytics sync mag-isa pagka-load (idempotent); recover din ang mga Paid
  // charge na hindi natuloy ang Book Keeping post.
  useEffect(() => {
    if (autoRan.current || !fs.loaded || !billing.loaded || !paid.loaded || eligible.length === 0) return
    autoRan.current = true
    sync()
    paid.recoverUnrecorded(dept).then(n => { if (n > 0) setNotes(p => [`${n} Paid charge(s) recovered into Book Keeping.`, ...p]) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fs.loaded, billing.loaded, paid.loaded, eligible.length])

  // ── Lookups / filters ──
  const cardById = useMemo(() => Object.fromEntries(cards.map(c => [c.id, c])), [cards])
  const ownerByAcct = useMemo(() => {
    const m: Record<string, string> = {}
    for (const a of fb.accounts) m[actId(a.ad_account_id)] = a.owner || ""
    return m
  }, [fb.accounts])

  const dailyAccountNames = useMemo(() => Array.from(new Set(billing.records.map(r => r.ad_account_name).filter(Boolean))).sort(), [billing.records])
  const paidAccountNames = useMemo(() => Array.from(new Set(paid.charges.map(c => c.billing_account).filter(Boolean))).sort(), [paid.charges])
  const accountNames = tab === "paid" ? paidAccountNames : dailyAccountNames
  const ownerNames = useMemo(() => Array.from(new Set(billing.records.map(r => ownerByAcct[r.ad_account_id]).filter(Boolean))).sort(), [billing.records, ownerByAcct])
  const bankNames = useMemo(() => Array.from(new Set([...billing.records.map(r => r.bank), ...paid.charges.map(c => c.bank)].filter(Boolean))).sort(), [billing.records, paid.charges])

  const visibleDaily = useMemo(
    () => billing.records.filter(r => {
      if (fAccount !== "All" && r.ad_account_name !== fAccount) return false
      if (fOwner !== "All" && (ownerByAcct[r.ad_account_id] || "") !== fOwner) return false
      if (fBank !== "All" && r.bank !== fBank) return false
      if (dateA && r.date < dateA) return false
      if (dateB && r.date > dateB) return false
      return true
    }),
    [billing.records, fAccount, fOwner, fBank, dateA, dateB, ownerByAcct])
  const totMedia = visibleDaily.reduce((s, r) => s + r.amount, 0)
  const totVat = visibleDaily.reduce((s, r) => s + r.vat, 0)
  const totBilled = visibleDaily.reduce((s, r) => s + billedTotal(r), 0)

  const visiblePaid = useMemo(
    () => paid.charges.filter(c => {
      if (fAccount !== "All" && c.billing_account !== fAccount) return false
      if (fBank !== "All" && c.bank !== fBank) return false
      if (dateA && c.paid_date < dateA) return false
      if (dateB && c.paid_date > dateB) return false
      return true
    }),
    [paid.charges, fAccount, fBank, dateA, dateB])
  const totPaid = visiblePaid.reduce((s, c) => s + c.amount, 0)

  return (
    <div className="space-y-4">
      <span className="text-sm text-slate-500 font-medium">Finance / FB Billing</span>

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4 pb-4 border-b border-slate-100">
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Receipt className="w-5 h-5" /> FACEBOOK BILLING HISTORY</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <DateRangePicker a={dateA} b={dateB} variant="header" placeholder="This month"
              onApply={(a, b) => { setDateA(a || ""); setDateB(b || "") }} />
            <select className={SEL} value={fAccount} onChange={e => setFAccount(e.target.value)} title="Ad Account">
              <option>All</option>
              {accountNames.map(n => <option key={n}>{n}</option>)}
            </select>
            {tab === "daily" && (
              <select className={SEL} value={fOwner} onChange={e => setFOwner(e.target.value)} title="Owner">
                <option>All</option>
                {ownerNames.map(n => <option key={n}>{n}</option>)}
              </select>
            )}
            <select className={SEL} value={fBank} onChange={e => setFBank(e.target.value)} title="Bank">
              <option>All</option>
              {bankNames.map(n => <option key={n}>{n}</option>)}
            </select>
            {tab === "paid" ? (
              <Button onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Add Paid Charge</Button>
            ) : (
              <Button onClick={sync} disabled={syncing}>
                <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} /> {syncing ? "Syncing…" : "Sync Analytics"}
              </Button>
            )}
          </div>
        </div>

        {/* Auto-sync status — isinusulat ng daily scheduled task */}
        {syncStatus && (
          <div className={`mb-4 p-3 rounded-lg text-sm border flex items-start gap-2 ${syncStatus.ok ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-amber-50 border-amber-200 text-amber-700"}`}>
            <RefreshCw className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              <span className="font-semibold">Auto-sync (daily):</span> {syncStatus.note}
              {syncStatus.last_sync_at && <span className="opacity-70"> · {relTime(syncStatus.last_sync_at)}</span>}
            </span>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-4">
          <button onClick={() => { setTab("paid"); setFAccount("All") }}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 ${tab === "paid" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
            <Receipt className="w-4 h-4" /> Paid Charges
          </button>
          <button onClick={() => { setTab("daily"); setFAccount("All") }}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 ${tab === "daily" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
            <BarChart3 className="w-4 h-4" /> Daily Spend (Analytics)
          </button>
        </div>

        <p className="text-xs text-slate-500 mb-3">
          {tab === "paid" ? (
            <>The actual <span className="font-semibold">“Paid”</span> charges from Facebook Billing — exactly what the card was billed.
              THIS is what posts to Book Keeping (account: “{FB_ADS_ACCOUNT}”), so the ledger matches the bank statement 1:1.
              Add one manually, send a screenshot to Claude, or wait for the browser sync.</>
          ) : (
            <>Daily media cost from Meta + 12% VAT — <span className="font-semibold">analytics only</span> (ROAS, spend trends).
              This does NOT post to Book Keeping; the Paid Charges tab is the ledger. {eligible.length} ad account{eligible.length === 1 ? "" : "s"} monitored.</>
          )}
        </p>

        {notes.length > 0 && (
          <div className={`mb-3 p-3 rounded-lg text-sm border ${notes.some(n => n.includes(":")) ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-emerald-50 border-emerald-200 text-emerald-700"}`}>
            {notes.map((n, i) => <p key={i}>{n}</p>)}
          </div>
        )}

        {tab === "paid" ? (
          <div className="overflow-auto border border-slate-200 rounded-xl max-h-[65vh]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  {["Date", "Billing Account", "Payment Method", "Card (matched)", "Bank", "Amount (Paid)", "Book Keeping", ""].map((h, i) =>
                    <th key={i} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!paid.loaded ? (
                  <tr><td colSpan={8} className="text-center py-10 text-slate-400">Loading…</td></tr>
                ) : visiblePaid.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-10 text-slate-400">
                    No Paid charges in this filter yet — click “Add Paid Charge”, or send a billing screenshot to Claude.
                  </td></tr>
                ) : visiblePaid.map(c => {
                  const card = cardById[c.matched_card_id]
                  return (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-700">{c.paid_date}</td>
                      <td className="px-3 py-2.5 text-slate-800 font-medium">{c.billing_account}</td>
                      <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{c.payment_method || (c.card_last4 ? `···· ${c.card_last4}` : "—")}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {card ? (
                          <span className="inline-flex items-center gap-1.5 text-slate-700"><CreditCard className="w-3.5 h-3.5 text-blue-500" /> {card.provider} — {card.name}</span>
                        ) : c.card_last4 ? (
                          <span className="inline-flex items-center gap-1.5 text-amber-600" title="No matching card in the registry"><AlertTriangle className="w-3.5 h-3.5" /> Unmatched (*{c.card_last4})</span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{c.bank || "—"}</td>
                      <td className="px-3 py-2.5 text-slate-800 font-semibold tabular-nums whitespace-nowrap">{peso(c.amount)}</td>
                      <td className="px-3 py-2.5">
                        {c.recorded_txn_id
                          ? <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-semibold"><Check className="w-3.5 h-3.5" /> Recorded</span>
                          : <span className="text-amber-500 text-xs">pending</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        {admin && (
                          <button title="Delete (admin)" onClick={() => setConfirmDelete(c)}
                            className="w-7 h-7 flex items-center justify-center rounded border border-slate-200 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {visiblePaid.length > 0 && (
                  <tr>
                    <td colSpan={5} className={`px-3 py-2.5 text-xs font-bold text-slate-700 uppercase ${STICKY}`}>Total ({visiblePaid.length} charge{visiblePaid.length === 1 ? "" : "s"})</td>
                    <td className={`px-3 py-2.5 font-bold text-slate-900 tabular-nums whitespace-nowrap ${STICKY}`}>{peso(totPaid)}</td>
                    <td colSpan={2} className={STICKY} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-auto border border-slate-200 rounded-xl max-h-[65vh]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  {["Date", "Ad Account", "Owner", "Payment Method", "Card (matched)", "Bank", "Ad Spend", "VAT 12%", "Total (est.)"].map(h =>
                    <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!billing.loaded ? (
                  <tr><td colSpan={9} className="text-center py-10 text-slate-400">Loading…</td></tr>
                ) : visibleDaily.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-10 text-slate-400">No records in this filter.</td></tr>
                ) : visibleDaily.map(r => {
                  const card = cardById[r.matched_card_id]
                  return (
                    <tr key={`${r.ad_account_id}|${r.date}`} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-700">{r.date}</td>
                      <td className="px-3 py-2.5 text-slate-800 font-medium">{r.ad_account_name}</td>
                      <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{ownerByAcct[r.ad_account_id] || "—"}</td>
                      <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{r.funding_display || "—"}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {card ? (
                          <span className="inline-flex items-center gap-1.5 text-slate-700"><CreditCard className="w-3.5 h-3.5 text-blue-500" /> {card.provider} — {card.name}</span>
                        ) : r.card_last4 ? (
                          <span className="inline-flex items-center gap-1.5 text-amber-600"><AlertTriangle className="w-3.5 h-3.5" /> Unmatched (*{r.card_last4})</span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{r.bank || "—"}</td>
                      <td className="px-3 py-2.5 text-slate-600 tabular-nums whitespace-nowrap">{peso(r.amount)}</td>
                      <td className="px-3 py-2.5 text-slate-500 tabular-nums whitespace-nowrap">{peso(r.vat)}</td>
                      <td className="px-3 py-2.5 text-slate-700 tabular-nums whitespace-nowrap">{peso(billedTotal(r))}</td>
                    </tr>
                  )
                })}
                {visibleDaily.length > 0 && (
                  <tr>
                    <td colSpan={6} className={`px-3 py-2.5 text-xs font-bold text-slate-700 uppercase ${STICKY}`}>Total ({visibleDaily.length} day{visibleDaily.length === 1 ? "" : "s"})</td>
                    <td className={`px-3 py-2.5 font-bold text-slate-700 tabular-nums whitespace-nowrap ${STICKY}`}>{peso(totMedia)}</td>
                    <td className={`px-3 py-2.5 font-bold text-slate-600 tabular-nums whitespace-nowrap ${STICKY}`}>{peso(totVat)}</td>
                    <td className={`px-3 py-2.5 font-bold text-slate-900 tabular-nums whitespace-nowrap ${STICKY}`}>{peso(totBilled)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && (
        <AddPaidChargeModal
          cards={cards}
          accountNames={Array.from(new Set([...eligible.map(a => a.name), ...paidAccountNames]))}
          bankFor={bankFor}
          onClose={() => setShowAdd(false)}
          onSave={async input => {
            const res = await paid.addCharge({ ...input, department: dept, source: "manual" })
            setShowAdd(false)
            setNotes(res === "added" ? ["Paid charge recorded in Book Keeping."]
              : res === "duplicate" ? ["Duplicate — this charge is already recorded (not double-posted)."]
                : [`Error: ${res}`])
          }} />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-bold text-slate-900 text-base flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-red-500" /> Delete Paid Charge</h2>
              <button onClick={() => setConfirmDelete(null)} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 text-sm text-slate-700">
              This deletes <span className="font-semibold">{peso(confirmDelete.amount)}</span> ({confirmDelete.billing_account}, {confirmDelete.paid_date})
              — along with its linked Book Keeping entry.
            </div>
            <div className="px-6 py-4 border-t bg-slate-50 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={async () => { await paid.removeCharge(confirmDelete.id); setConfirmDelete(null) }}>Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Add Paid Charge — manual entry ng eksaktong "Paid" amount mula sa Facebook ──
function AddPaidChargeModal({ cards, accountNames, bankFor, onClose, onSave }: {
  cards: FinanceCard[]
  accountNames: string[]
  bankFor: (card?: FinanceCard) => string
  onClose: () => void
  onSave: (input: { paid_date: string; amount: number; billing_account: string; card_last4: string; payment_method: string; reference_no: string; matched_card_id: string; bank: string; notes: string }) => void
}) {
  const [f, setF] = useState({ paid_date: new Date().toISOString().slice(0, 10), amount: "", billing_account: "", card_id: "", reference_no: "", notes: "" })
  const [err, setErr] = useState("")
  const set = (k: keyof typeof f, v: string) => { setF(p => ({ ...p, [k]: v })); setErr("") }

  const card = cards.find(c => c.id === f.card_id)
  const last4 = card ? cardLast4(card) : ""
  const bank = bankFor(card)

  function submit() {
    const amount = parseFloat(f.amount)
    if (!f.paid_date || !(amount > 0) || !f.billing_account.trim()) { setErr("Paid date, Amount, and Billing Account are required."); return }
    if (!f.card_id) { setErr("Select the card that was billed — it decides the bank in Book Keeping."); return }
    onSave({
      paid_date: f.paid_date, amount, billing_account: f.billing_account.trim(),
      card_last4: last4, payment_method: last4 ? `Visa ···· ${last4}` : (card?.provider || ""),
      reference_no: f.reference_no.trim(), matched_card_id: f.card_id, bank, notes: f.notes.trim(),
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-bold text-slate-900 text-base flex items-center gap-2"><Receipt className="w-5 h-5 text-blue-600" /> Add Paid Charge</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-6 py-4 space-y-3 overflow-auto">
          {err && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{err}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-slate-600">Paid date <span className="text-red-500">*</span></label>
              <Input type="date" className="mt-1" value={f.paid_date} onChange={e => set("paid_date", e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-slate-600">Amount (Paid) <span className="text-red-500">*</span></label>
              <Input type="number" step="0.01" min={0} className="mt-1" placeholder="5942.72" value={f.amount} onChange={e => set("amount", e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-sm text-slate-600">Billing Account <span className="text-red-500">*</span></label>
            <Input list="paid-accounts" className="mt-1" placeholder="e.g. Cystcare-Bukol" value={f.billing_account} onChange={e => set("billing_account", e.target.value)} />
            <datalist id="paid-accounts">{accountNames.map(n => <option key={n} value={n} />)}</datalist>
          </div>
          <div>
            <label className="text-sm text-slate-600">Card na sininingil <span className="text-red-500">*</span></label>
            <select className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white mt-1 focus:outline-none focus:border-blue-400" value={f.card_id} onChange={e => set("card_id", e.target.value)}>
              <option value="">-- SELECT CARD --</option>
              {cards.map(c => <option key={c.id} value={c.id}>{cardLabel(c)}</option>)}
            </select>
            {card && <p className="text-xs text-slate-500 mt-1">Bank in Book Keeping: <span className="font-semibold">{bank || "no matching bank — check thg Settings → Banks"}</span></p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-slate-600">Reference no. (optional)</label>
              <Input className="mt-1" placeholder="FB transaction ID" value={f.reference_no} onChange={e => set("reference_no", e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-slate-600">Notes</label>
              <Input className="mt-1" placeholder="Optional" value={f.notes} onChange={e => set("notes", e.target.value)} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
          <Button onClick={submit}>Submit</Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}
