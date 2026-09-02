"use client"
import { useMemo, useState } from "react"
import { useEffect } from "react"
import { Eye, EyeOff, Lock, KeyRound, Pencil, Trash2, Check, X } from "lucide-react"
import { useProductItems } from "@/lib/product-items-store"
import { useProductBatches } from "@/lib/product-batches-store"
import { useIsOwner, useTrueCosts, marginOf, monthKeyNow } from "@/lib/true-costs-store"
import { fetchOwnerPass, saveOwnerPass, hashPass, type OwnerPassState } from "@/lib/owner-pass-store"

// ─────────────────────────────────────────────────────────────────────────────
// SUPPLIER MARGIN — ANG LIHIM NA SEKSYON NG MAY-ARI SA FINANCE.
//
// Ang may-ari ang supplier ng sariling kumpanya: ang idineklarang COG (₱27,
// nakikita ng partners) ay may patong sa tunay niyang binayaran (₱25). Ang ₱2
// kada piraso ay kita niyang hindi dapat makita ng iba.
//
// ⚠ TATLONG SUSON ANG PAGTATAGO, magkakaibang trabaho:
//   1. RLS (ang tunay na kandado)  — may-ari lang ang makakabasa ng
//      supplier_true_costs; kahit i-curl ng staff ang endpoint, walang row.
//   2. `useIsOwner` (ang pinto)    — ang seksyon ay HINDI NAGRE-RENDER para sa
//      hindi may-ari: walang placeholder, walang "Private" na kahon na
//      magpapahiwatig na may itinatago.
//   3. Eye toggle (ang tabing)     — kahit ikaw ang may-ari, nakamaskara ang
//      mga halaga hangga't hindi mo pinipindot ang mata: bukas ang screen mo
//      sa meeting nang mas madalas kaysa inaamin ng kahit sino.
//   4. PASSWORD (ang susi sa tabing, hatol Ago 31 2026) — ang bawat "Show" ay
//      humihingi ng password (PBKDF2 hash sa Supabase, may-ari-lang ang RLS;
//      migration 0039). Mapapalitan ito sa loob mismo ng seksyon; ang
//      nakalimutan ay burahin ang row sa owner_section_pass at magtakda muli.
//      Kapag hindi pa tumatakbo ang 0039: gumagana ang Show nang WALANG
//      password, may amber na paalala — hindi tayo nagkukunwaring may kandado.
// ─────────────────────────────────────────────────────────────────────────────

const peso = (n: number) => "₱" + (isFinite(n) ? n : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const MASK = "••••••"

export function OwnerTrueProfit() {
  const isOwner = useIsOwner()
  // ⚠ WALANG HOOKS PAGKATAPOS NG GUARD — kaya ang lahat ng hook ay tumatakbo
  // muna bago ang anumang return, sa bawat render, kahit hindi may-ari.
  const items = useProductItems()
  const batches = useProductBatches()
  const tc = useTrueCosts()
  const [shown, setShown] = useState(false)
  // ── Ang kandado ng "Show" ───────────────────────────────────────────────────
  const [pass, setPass] = useState<OwnerPassState | null>(null)
  const [dialog, setDialog] = useState<"" | "unlock" | "setup" | "change">("")
  const [pwCur, setPwCur] = useState("")
  const [pw1, setPw1] = useState("")
  const [pw2, setPw2] = useState("")
  const [pwErr, setPwErr] = useState("")
  const [pwBusy, setPwBusy] = useState(false)
  useEffect(() => {
    if (isOwner !== true) return
    let dead = false
    fetchOwnerPass().then(p => { if (!dead) setPass(p) })
    return () => { dead = true }
  }, [isOwner])
  const openDialog = (d: "unlock" | "setup" | "change") => {
    setPwCur(""); setPw1(""); setPw2(""); setPwErr(""); setDialog(d)
  }
  // Ang pindot ng Show: may password na → unlock; wala pa → setup muna; wala
  // pang 0039 → bukas agad (may paalala sa ibaba — walang pekeng kandado).
  const onShowClick = () => {
    if (shown) { setShown(false); return }
    if (!pass || pass.status === "missing-table" || pass.status === "error") { setShown(true); return }
    openDialog(pass.status === "set" ? "unlock" : "setup")
  }
  const submitUnlock = async () => {
    if (pass?.status !== "set" || pwBusy) return
    setPwBusy(true)
    const h = await hashPass(pwCur, pass.salt)
    if (h === pass.hash) { setShown(true); setDialog("") ; setPwBusy(false); return }
    // Maling password: sandaling kandado — hindi mabilisang hulaan.
    await new Promise(r => setTimeout(r, 1200))
    setPwErr("Wrong password."); setPwBusy(false)
  }
  const submitSetup = async () => {
    if (pwBusy) return
    if (pw1.length < 4) { setPwErr("Use at least 4 characters."); return }
    if (pw1 !== pw2) { setPwErr("The two entries don't match."); return }
    setPwBusy(true)
    const err = await saveOwnerPass(pw1)
    setPwBusy(false)
    if (err) { setPwErr(err); return }
    setPass({ status: "set", salt: "", hash: "" })
    // Kunin ang bagong salt/hash para sa susunod na unlock ngayong session.
    fetchOwnerPass().then(setPass)
    setShown(true); setDialog("")
  }
  const submitChange = async () => {
    if (pass?.status !== "set" || pwBusy) return
    setPwBusy(true)
    const h = await hashPass(pwCur, pass.salt)
    if (h !== pass.hash) {
      await new Promise(r => setTimeout(r, 1200))
      setPwErr("Wrong current password."); setPwBusy(false); return
    }
    if (pw1.length < 4) { setPwErr("Use at least 4 characters."); setPwBusy(false); return }
    if (pw1 !== pw2) { setPwErr("The two new entries don't match."); setPwBusy(false); return }
    const err = await saveOwnerPass(pw1)
    setPwBusy(false)
    if (err) { setPwErr(err); return }
    fetchOwnerPass().then(setPass)
    setDialog("")
  }
  const [editId, setEditId] = useState("")
  const [editVal, setEditVal] = useState("")
  const [busy, setBusy] = useState(false)
  const month = monthKeyNow()

  const live = useMemo(() => items.items.filter(i => !i.deleted && !i.archived), [items.items])

  const rows = useMemo(() => live.map(i => {
    const t = tc.costs[i.id]
    const bs = batches.byItem(i.id)
    const all = t ? marginOf(bs, t.true_cost) : { pcs: 0, margin: 0 }
    const mtd = t ? marginOf(bs, t.true_cost, month) : { pcs: 0, margin: 0 }
    return { item: i, trueCost: t?.true_cost ?? null, all, mtd }
  })
    // Ang may nakarehistrong tunay na presyo ang nasa itaas, pinakamalaking kita muna.
    .sort((a, b) => (a.trueCost == null ? 1 : 0) - (b.trueCost == null ? 1 : 0) || b.all.margin - a.all.margin),
    [live, tc.costs, batches, month])

  const totals = useMemo(() => rows.reduce((s, r) => ({
    all: s.all + (r.trueCost != null ? r.all.margin : 0),
    mtd: s.mtd + (r.trueCost != null ? r.mtd.margin : 0),
    items: s.items + (r.trueCost != null ? 1 : 0),
  }), { all: 0, mtd: 0, items: 0 }), [rows])

  // ⚠ WALANG render para sa hindi may-ari — ni placeholder. Ang kahon na
  // nagsasabing "may lihim dito" ay imbitasyon, hindi proteksyon. Habang
  // hindi pa tiyak (null) ay wala ring ipinapakita — mas mabuting huli nang
  // kaunti kaysa kumislap sa maling mata.
  if (isOwner !== true) return null

  const money = (n: number) => shown ? peso(n) : MASK

  return (
    <div className="pw-rise bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 sm:px-5 py-3.5 border-b border-slate-100">
        <Lock className="w-4 h-4 text-slate-400 shrink-0" />
        <span className="min-w-0">
          <span className="block text-sm font-bold text-slate-800">Supplier margin</span>
          <span className="block text-[11px] text-slate-400">
            Only you can see this section — declared COG vs your true cost, per received batch.
          </span>
        </span>
        <span className="ml-auto flex items-center gap-1.5 shrink-0">
          {/* Palitan ang password — sa loob mismo, gaya ng hiling. */}
          {pass?.status === "set" && (
            <button onClick={() => openDialog("change")} title="Change the password of this section"
              className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-blue-600">
              <KeyRound className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={onShowClick} title={shown ? "Hide amounts" : pass?.status === "set" ? "Show amounts — asks for the password" : "Show amounts"}
            className="flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
            {shown ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {shown ? "Hide" : "Show"}
          </button>
        </span>
      </div>
      {pass?.status === "missing-table" && (
        <p className="px-5 py-2 text-[12px] text-amber-700 bg-amber-50 border-b border-amber-200">
          The password lock needs migration <b>0039_owner_section_pass.sql</b> in Supabase — until then, Show works without one.
        </p>
      )}

      {tc.error && (
        <p className="px-5 py-3 text-[13px] text-amber-700 bg-amber-50 border-b border-amber-200">{tc.error}</p>
      )}

      {/* Ang buod — kita ngayong buwan at kabuuan. */}
      <div className="grid grid-cols-2 gap-2.5 px-4 sm:px-5 py-3.5">
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-3.5 py-2.5">
          <p className="text-lg font-bold text-emerald-600 tabular-nums leading-none">{money(totals.mtd)}</p>
          <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide mt-1">Your margin — {month}</p>
        </div>
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-3.5 py-2.5">
          <p className="text-lg font-bold text-slate-800 tabular-nums leading-none">{money(totals.all)}</p>
          <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide mt-1">All time · {totals.items} item{totals.items === 1 ? "" : "s"}</p>
        </div>
      </div>

      <div className="px-2 sm:px-3 pb-3 overflow-x-auto scrollbar-dark">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="text-left text-[11px] text-slate-500 uppercase tracking-wide border-b border-slate-100">
              <th className="px-2 py-2 font-semibold">Item</th>
              <th className="px-2 py-2 font-semibold text-right">Declared COG</th>
              <th className="px-2 py-2 font-semibold text-right">True cost</th>
              <th className="px-2 py-2 font-semibold text-right">/pc</th>
              <th className="px-2 py-2 font-semibold text-right">Pcs in</th>
              <th className="px-2 py-2 font-semibold text-right">Margin (all)</th>
              <th className="px-2 py-2 w-[70px]"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-2 py-6 text-center text-[13px] text-slate-400 italic">
                No product items yet — register items in Product Items first.
              </td></tr>
            )}
            {rows.map(r => (
              <tr key={r.item.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                <td className="px-2 py-2 max-w-[200px]">
                  <span className="block truncate font-medium text-slate-700">{r.item.name || r.item.sku}</span>
                  <span className="block text-[10px] text-slate-400 truncate">{r.item.sku}</span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-slate-600">{peso(r.item.cog)}</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {editId === r.item.id ? (
                    <input autoFocus type="number" min="0" step="0.01" value={editVal}
                      onChange={e => setEditVal(e.target.value)}
                      onKeyDown={async e => {
                        if (e.key === "Escape") setEditId("")
                        if (e.key === "Enter") {
                          const v = Number(editVal)
                          if (!isFinite(v) || v < 0) return
                          setBusy(true)
                          const err = await tc.setTrueCost(r.item.id, v)
                          setBusy(false); setEditId("")
                          if (err) alert(err)
                        }
                      }}
                      className="w-24 h-7 rounded border border-blue-400 px-1.5 text-right text-sm" />
                  ) : r.trueCost != null ? (
                    <span className="text-slate-800 font-medium">{money(r.trueCost)}</span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                {/* Ang agwat kada piraso ay sa KASALUKUYANG idineklarang cog —
                    mabilis na pagtingin lang; ang totoong margin sa kanan ay
                    kada-batch ang kuwenta. */}
                <td className={`px-2 py-2 text-right tabular-nums font-medium ${
                  r.trueCost != null ? (r.item.cog - r.trueCost >= 0 ? "text-emerald-600" : "text-rose-600") : "text-slate-300"}`}>
                  {r.trueCost != null ? (shown ? peso(r.item.cog - r.trueCost) : MASK) : "—"}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-slate-600">{r.trueCost != null ? r.all.pcs.toLocaleString() : "—"}</td>
                <td className={`px-2 py-2 text-right tabular-nums font-bold ${
                  r.trueCost != null ? (r.all.margin >= 0 ? "text-emerald-600" : "text-rose-600") : "text-slate-300"}`}>
                  {r.trueCost != null ? money(r.all.margin) : "—"}
                </td>
                <td className="px-2 py-2 text-right whitespace-nowrap">
                  {editId === r.item.id ? (
                    <span className="inline-flex gap-0.5">
                      <button disabled={busy} onClick={async () => {
                        const v = Number(editVal)
                        if (!isFinite(v) || v < 0) return
                        setBusy(true)
                        const err = await tc.setTrueCost(r.item.id, v)
                        setBusy(false); setEditId("")
                        if (err) alert(err)
                      }} className="p-1 rounded text-emerald-600 hover:bg-emerald-50"><Check className="w-3.5 h-3.5" /></button>
                      <button onClick={() => setEditId("")} className="p-1 rounded text-slate-400 hover:bg-slate-100"><X className="w-3.5 h-3.5" /></button>
                    </span>
                  ) : (
                    <span className="inline-flex gap-0.5">
                      <button onClick={() => { setEditId(r.item.id); setEditVal(r.trueCost != null ? String(r.trueCost) : "") }}
                        title={r.trueCost != null ? "Edit true cost" : "Register your true cost"}
                        className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-slate-100"><Pencil className="w-3.5 h-3.5" /></button>
                      {r.trueCost != null && (
                        <button onClick={() => { if (confirm(`Remove the true cost for "${r.item.name || r.item.sku}"?`)) tc.clearTrueCost(r.item.id) }}
                          title="Remove" className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-slate-100"><Trash2 className="w-3.5 h-3.5" /></button>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-2 pt-2 text-[11px] text-slate-400 leading-snug">
          Margin = Σ per received batch of (that batch&apos;s declared COG − your true cost) × qty — batch prices
          vary, so history is never rewritten when you change a price. Items without a registered true cost
          are not counted.
        </p>
      </div>

      {/* ── PASSWORD DIALOGS ─────────────────────────────────────────────── */}
      {dialog && (
        <div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4"
          onClick={() => !pwBusy && setDialog("")}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xs p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <Lock className="w-4 h-4 text-slate-400" />
              {dialog === "unlock" ? "Enter password" : dialog === "setup" ? "Set a password" : "Change password"}
            </p>
            {dialog === "setup" && (
              <p className="text-[11px] text-slate-400 leading-snug">
                This locks the Show button of Supplier margin. Only a hash is stored — if you forget it, delete the
                row in <b>owner_section_pass</b> (Supabase) and set a new one.
              </p>
            )}
            {(dialog === "unlock" || dialog === "change") && (
              <input autoFocus type="password" value={pwCur} onChange={e => setPwCur(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && dialog === "unlock") submitUnlock() }}
                placeholder={dialog === "unlock" ? "Password" : "Current password"}
                className="w-full h-9 rounded-lg border border-slate-300 px-3 text-sm" />
            )}
            {(dialog === "setup" || dialog === "change") && (
              <>
                <input autoFocus={dialog === "setup"} type="password" value={pw1} onChange={e => setPw1(e.target.value)}
                  placeholder="New password" className="w-full h-9 rounded-lg border border-slate-300 px-3 text-sm" />
                <input type="password" value={pw2} onChange={e => setPw2(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") (dialog === "setup" ? submitSetup() : submitChange()) }}
                  placeholder="Repeat new password" className="w-full h-9 rounded-lg border border-slate-300 px-3 text-sm" />
              </>
            )}
            {pwErr && <p className="text-[12px] text-rose-600">{pwErr}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setDialog("")} disabled={pwBusy}
                className="h-8 px-3 rounded-lg border border-slate-300 text-[13px] font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
              <button disabled={pwBusy}
                onClick={() => dialog === "unlock" ? submitUnlock() : dialog === "setup" ? submitSetup() : submitChange()}
                className="h-8 px-3.5 rounded-lg bg-blue-600 text-white text-[13px] font-semibold hover:bg-blue-700 disabled:opacity-50">
                {pwBusy ? "…" : dialog === "unlock" ? "Unlock" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
