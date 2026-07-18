"use client"
import { useMemo, useRef, useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Receipt, RefreshCw, Check, CreditCard, AlertTriangle } from "lucide-react"
import { useFBAccounts, actId } from "@/lib/fb-store"
import { useFinanceCards, type FinanceCard } from "@/lib/cards-store"
import { useFinanceSettings } from "@/lib/finance-settings-store"
import { pushBookkeepingTxn } from "@/lib/bookkeeping-store"
import { useFbBilling, FB_ADS_ACCOUNT, FB_ADS_TYPE, type FbBillingRecord } from "@/lib/fb-billing-store"

const SEL = "h-9 rounded-lg border border-slate-300 px-2 text-sm bg-white focus:outline-none focus:border-blue-400"
const peso = (n: number) => "₱ " + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function dstr(d: Date) { return d.toISOString().slice(0, 10) }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return dstr(d) }

// Itugma ang funding last-4 sa CARDS registry (card number → account number → manual link).
function matchCard(cards: FinanceCard[], last4: string, manualCardId: string): FinanceCard | undefined {
  if (last4) {
    const byCard = cards.find(c => c.card_number.replace(/\D/g, "").endsWith(last4))
    if (byCard) return byCard
    const byAcct = cards.find(c => c.account_number.replace(/\D/g, "").endsWith(last4))
    if (byAcct) return byAcct
  }
  return cards.find(c => c.id === manualCardId)
}

export default function FbBillingPage() {
  const fb = useFBAccounts()
  const { cards } = useFinanceCards()
  const fs = useFinanceSettings()
  const billing = useFbBilling()

  const [syncing, setSyncing] = useState(false)
  const [notes, setNotes] = useState<string[]>([])
  const [fAccount, setFAccount] = useState("All")
  const autoRan = useRef(false)

  const eligible = useMemo(
    () => fb.accounts.filter(a => !a.archived && a.ad_account_id && a.token),
    [fb.accounts])

  // Bank ng card provider — hal. provider "GoTyme" → bank na "GOTYME" sa Finance Settings.
  function bankFor(card?: FinanceCard): string {
    if (!card?.provider) return ""
    const p = card.provider.toUpperCase()
    const hit = fs.activeBanks.find(b => p.includes(b.name.toUpperCase()) || b.name.toUpperCase().includes(p.split(" ")[0]))
    return hit?.name || ""
  }

  async function sync() {
    if (syncing || !fs.loaded || !billing.loaded) return
    setSyncing(true)
    const msgs: string[] = []
    try {
      // Siguraduhing may Book Keeping account + type para sa FB bills (auto-create once).
      if (!fs.accounts.find(a => a.name === FB_ADS_ACCOUNT)) {
        fs.addAccount({ name: FB_ADS_ACCOUNT, with_voucher: false, bank_id: "", is_adspent: false, is_cog_purchase: false, is_shipping_fee: false, excluded_in_gross_revenue: false, members: [] })
      }
      if (!fs.types.find(t => t.name === FB_ADS_TYPE)) {
        fs.addType({ name: FB_ADS_TYPE, opex: false, type: "Debit" })
      }
      const dept = fs.activeDepartments.find(d => /marketing/i.test(d.name))?.name || fs.activeDepartments[0]?.name || ""

      const have = new Set(billing.records.map(r => `${r.ad_account_id}|${r.date}`))
      const yesterday = daysAgo(1)
      let added = 0, recovered = 0

      // Retry muna: records na na-save pero hindi natuloy ang Book Keeping post (naputol na sync).
      for (const r of billing.records.filter(x => !x.recorded_txn_id)) {
        try {
          const txn = await pushBookkeepingTxn({
            posted_date: r.date, transaction: `FB Ads — ${r.ad_account_name} (${r.date})`,
            account: FB_ADS_ACCOUNT, department: dept, category: "Expense - Debit",
            type_of_expense: FB_ADS_TYPE, expense_type: "Debit", amount: r.amount,
            bank: r.bank, voucher: "", receipt_name: "",
          }, "Recorded from FB Billing")
          await billing.setRecordTxn(r.ad_account_id, r.date, txn.id)
          recovered++
        } catch {}
      }

      for (const a of eligible) {
        const acct = actId(a.ad_account_id)
        try {
          // 1) Payment method (funding source) — last 4 digits → CARDS registry match.
          const fRes = await fetch(`/api/fb/insights?funding=1&token=${encodeURIComponent(a.token)}&account_id=${encodeURIComponent(acct)}`)
          const fJson = await fRes.json().catch(() => ({}))
          const display = fJson.display || ""
          const last4 = fJson.last4 || ""
          const card = matchCard(cards, last4, a.card_id)
          const bank = bankFor(card)

          // 2) Daily spend (ito ang bini-bill ni Meta) — huling 30 araw hanggang kahapon.
          const sRes = await fetch(`/api/fb/insights?token=${encodeURIComponent(a.token)}&account_id=${encodeURIComponent(acct)}&from=${daysAgo(30)}&to=${yesterday}`)
          const sJson = await sRes.json().catch(() => ({}))
          if (!sJson.success) { msgs.push(`${a.name}: ${sJson.error || "spend fetch failed"}`); continue }

          for (const [date, amtRaw] of Object.entries(sJson.byDate || {})) {
            const amount = Math.round(Number(amtRaw) * 100) / 100
            if (!(amount > 0) || have.has(`${acct}|${date}`)) continue
            // 3) I-save MUNA ang dedup record bago mag-post sa Book Keeping — kapag hindi
            //    ma-save (hal. wala pa ang fb_billing_records table), HINDI magpo-post,
            //    para imposibleng magdoble ang entries.
            const rec: FbBillingRecord = {
              ad_account_id: acct, date, ad_account_name: a.name, amount, currency: a.currency || "PHP",
              funding_display: display, card_last4: last4, matched_card_id: card?.id || "", bank,
              recorded_txn_id: null,
            }
            const saveErr = await billing.saveRecord(rec)
            if (saveErr) { msgs.push(`${a.name}: hindi ma-save ang billing record (${saveErr}) — itinigil ang posting para walang doble.`); break }
            const txn = await pushBookkeepingTxn({
              posted_date: date,
              transaction: `FB Ads — ${a.name} (${date})`,
              account: FB_ADS_ACCOUNT, department: dept, category: "Expense - Debit",
              type_of_expense: FB_ADS_TYPE, expense_type: "Debit", amount,
              bank, voucher: "", receipt_name: "",
            }, "Recorded from FB Billing")
            await billing.setRecordTxn(acct, date, txn.id)
            have.add(`${acct}|${date}`)
            added++
          }
        } catch (e: any) {
          msgs.push(`${a.name}: ${e?.message || "sync failed"}`)
        }
      }

      await billing.refresh()
      msgs.unshift(added > 0 || recovered > 0
        ? `${added} bagong billing day(s) na-record${recovered > 0 ? ` (+${recovered} na-recover)` : ""}.`
        : "Up to date — walang bagong billing.")
    } finally {
      setNotes(msgs)
      setSyncing(false)
    }
  }

  // Automated: mag-sync mag-isa pagka-load ng lahat (idempotent — may dedup sa records).
  useEffect(() => {
    if (autoRan.current || !fs.loaded || !billing.loaded || eligible.length === 0 || cards.length === 0) return
    autoRan.current = true
    sync()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fs.loaded, billing.loaded, eligible.length, cards.length])

  const accountNames = useMemo(() => Array.from(new Set(billing.records.map(r => r.ad_account_name).filter(Boolean))).sort(), [billing.records])
  const visible = useMemo(
    () => billing.records.filter(r => fAccount === "All" || r.ad_account_name === fAccount),
    [billing.records, fAccount])
  const total = visible.reduce((s, r) => s + r.amount, 0)
  const cardById = useMemo(() => Object.fromEntries(cards.map(c => [c.id, c])), [cards])

  return (
    <div className="space-y-4">
      <span className="text-sm text-slate-500 font-medium">Finance / FB Billing</span>

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4 pb-4 border-b border-slate-100">
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Receipt className="w-5 h-5" /> FACEBOOK BILLING HISTORY</h1>
          <div className="flex items-center gap-2">
            <select className={SEL} value={fAccount} onChange={e => setFAccount(e.target.value)}>
              <option>All</option>
              {accountNames.map(n => <option key={n}>{n}</option>)}
            </select>
            <Button onClick={sync} disabled={syncing}>
              <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} /> {syncing ? "Syncing…" : "Sync Billing"}
            </Button>
          </div>
        </div>

        <p className="text-xs text-slate-500 mb-3">
          Daily FB ad spend per ad account (ito ang tina-total ng Meta sa mga singil) — automatic na naka-post sa
          Book Keeping (account: “{FB_ADS_ACCOUNT}”) at nakabawas sa bank ng card na tumugma sa payment method.
          {" "}{eligible.length} ad account{eligible.length === 1 ? "" : "s"} monitored.
        </p>

        {notes.length > 0 && (
          <div className={`mb-3 p-3 rounded-lg text-sm border ${notes.some(n => n.includes(":")) ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-emerald-50 border-emerald-200 text-emerald-700"}`}>
            {notes.map((n, i) => <p key={i}>{n}</p>)}
          </div>
        )}

        <div className="overflow-auto border border-slate-200 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                {["Date", "Ad Account", "Payment Method", "Card (matched)", "Bank", "Amount", "Book Keeping"].map(h =>
                  <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!billing.loaded ? (
                <tr><td colSpan={7} className="text-center py-10 text-slate-400">Loading…</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-10 text-slate-400">Wala pang billing records — i-click ang “Sync Billing”.</td></tr>
              ) : visible.map(r => {
                const card = cardById[r.matched_card_id]
                return (
                  <tr key={`${r.ad_account_id}|${r.date}`} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-700">{r.date}</td>
                    <td className="px-3 py-2.5 text-slate-800 font-medium">{r.ad_account_name}</td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{r.funding_display || "—"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {card ? (
                        <span className="inline-flex items-center gap-1.5 text-slate-700"><CreditCard className="w-3.5 h-3.5 text-blue-500" /> {card.provider} — {card.name}</span>
                      ) : r.card_last4 ? (
                        <span className="inline-flex items-center gap-1.5 text-amber-600" title="Walang tumugmang card sa registry — i-check ang Finance → Cards">
                          <AlertTriangle className="w-3.5 h-3.5" /> Unmatched (*{r.card_last4})
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{r.bank || "—"}</td>
                    <td className="px-3 py-2.5 text-slate-800 font-semibold tabular-nums whitespace-nowrap">{peso(r.amount)}</td>
                    <td className="px-3 py-2.5">
                      {r.recorded_txn_id
                        ? <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-semibold"><Check className="w-3.5 h-3.5" /> Recorded</span>
                        : <span className="text-slate-400 text-xs">—</span>}
                    </td>
                  </tr>
                )
              })}
              {visible.length > 0 && (
                <tr className="bg-slate-50 border-t-2 border-slate-300">
                  <td colSpan={5} className="px-3 py-2.5 text-xs font-bold text-slate-700 uppercase">Total ({visible.length} day{visible.length === 1 ? "" : "s"})</td>
                  <td className="px-3 py-2.5 font-bold text-slate-900 tabular-nums whitespace-nowrap">{peso(total)}</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
