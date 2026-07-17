"use client"
import { useState, useMemo, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Link2, Plus, Search, Pencil, X, ChevronLeft, Settings, Check, Archive, ArchiveRestore, Lock, AlertTriangle, KeyRound } from "lucide-react"
import {
  useFBAccounts, useFBDefaultToken, FB_TOKEN_DAYS, FB_STATUSES, FB_FOCUS, actId,
  type FBAccount, type NewFBInput, type FBStatus,
} from "@/lib/fb-store"
import { useActivePages } from "@/lib/pages-store"
import { OwnerCombo } from "@/components/business/OwnerCombo"
import { useFinanceCards } from "@/lib/cards-store"

// Map Facebook's account_status code → our registration status.
function fbStatusToLocal(code: number): FBStatus | null {
  switch (code) {
    case 1: return "Active"
    case 2: case 100: case 101: return "Disabled"   // disabled / pending closure / closed
    case 3: case 7: case 8: case 9: return "In-review" // unsettled / risk review / settlement / grace
    default: return null   // unknown → leave as-is
  }
}

const INP = "w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white focus:outline-none focus:border-blue-400"

const STATUS_BADGE: Record<string, string> = {
  Active: "bg-emerald-100 text-emerald-700", Paused: "bg-amber-100 text-amber-700",
  Disabled: "bg-rose-100 text-rose-600", "In-review": "bg-blue-100 text-blue-700",
}
const PLATFORM_BADGE: Record<string, string> = {
  Facebook: "bg-blue-100 text-blue-700", TikTok: "bg-slate-200 text-slate-700",
  Shopee: "bg-orange-100 text-orange-700", Lazada: "bg-indigo-100 text-indigo-700", Instagram: "bg-pink-100 text-pink-600",
}
const fmtDate = (iso: string) => { try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) } catch { return "—" } }

function FormRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] items-start gap-3 py-2.5 border-b border-slate-100 last:border-0">
      <label className="text-sm text-slate-600 pt-2 text-right pr-2">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <div>{children}</div>
    </div>
  )
}

export default function AdAccountsPage() {
  const fb = useFBAccounts()
  const pages = useActivePages()
  const [screen, setScreen] = useState<"list" | "add" | "edit" | "view">("list")
  const [active, setActive] = useState<FBAccount | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ type: "archive" | "delete"; account: FBAccount } | null>(null)
  const [toast, setToast] = useState("")
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500) }

  // Shared default API token (one token for all ad accounts) + 60-day expiry tracking.
  const def = useFBDefaultToken()
  const daysLeft = def.daysLeft
  const expired = daysLeft != null && daysLeft <= 0
  const nearExpiry = daysLeft != null && daysLeft > 0 && daysLeft <= 3
  const expiryDate = def.setAt ? new Date(new Date(def.setAt).getTime() + FB_TOKEN_DAYS * 86400000) : null
  const [tokenModal, setTokenModal] = useState(false)
  const [tokenInput, setTokenInput] = useState("")
  function saveDefaultToken() {
    const t = tokenInput.trim()
    if (!t) return
    def.save(t)            // store token + reset the 60-day countdown
    fb.setAllTokens(t)     // apply to every registered ad account
    setTokenModal(false); setTokenInput("")
    flash("Default token saved & applied to all ad accounts.")
  }

  // Auto-sync each ad account's status from Facebook (e.g. → Disabled if FB disabled it). Runs once on load.
  const didSyncStatus = useRef(false)
  useEffect(() => {
    if (didSyncStatus.current || fb.accounts.length === 0) return
    didSyncStatus.current = true
    ;(async () => {
      const changes: Record<string, FBStatus> = {}
      for (const a of fb.accounts) {
        if (!a.token || !a.ad_account_id) continue
        try {
          const res = await fetch(`/api/fb/insights?meta=1&token=${encodeURIComponent(a.token)}&account_id=${encodeURIComponent(actId(a.ad_account_id))}`)
          const j = await res.json()
          if (!j.success) continue
          const next = fbStatusToLocal(Number(j.account_status))
          if (next && next !== a.status) changes[a.id] = next
        } catch {}
      }
      if (Object.keys(changes).length) { fb.updateStatuses(changes); flash(`Status synced from Facebook (${Object.keys(changes).length} updated).`) }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fb.accounts.length])

  // Active / Archives view + filters (Pages & Store style)
  const [archivedView, setArchivedView] = useState(false)
  const [qName, setQName] = useState("")
  const [qOwner, setQOwner] = useState("")
  const [fStatus, setFStatus] = useState("All")
  const [fPlatform, setFPlatform] = useState("All")
  const inView = useMemo(() => fb.accounts.filter(a => !!a.archived === archivedView), [fb.accounts, archivedView])
  const filtered = useMemo(() => inView.filter(a => {
    if (qName && !a.name.toLowerCase().includes(qName.toLowerCase())) return false
    if (qOwner && !a.owner.toLowerCase().includes(qOwner.toLowerCase())) return false
    if (fStatus !== "All" && a.status !== fStatus) return false
    if (fPlatform !== "All" && a.platform !== fPlatform) return false
    return true
  }), [inView, qName, qOwner, fStatus, fPlatform])

  // Owner options = Pages & Store owners only (people who actually registered pages).
  const owners = useMemo(() => Array.from(new Set(pages.map((p: any) => p.owner).filter(Boolean))).sort(), [pages])

  if (screen === "add" || (screen === "edit" && active))
    return <FormScreen mode={screen === "edit" ? "edit" : "add"} initial={screen === "edit" ? active! : undefined} pages={pages.map(p => p.name)} owners={owners} defaultToken={def.token}
      onBack={() => setScreen("list")}
      onSave={(input) => {
        if (screen === "edit" && active) { fb.updateAccount(active.id, input); flash("Ad account updated.") }
        else { fb.addAccount(input); flash("Ad account registered.") }
        setScreen("list")
      }} />

  if (screen === "view" && active)
    return <ViewScreen account={fb.accounts.find(a => a.id === active.id) || active} onBack={() => setScreen("list")} onEdit={() => setScreen("edit")} />

  return (
    <div className="space-y-4 relative">
      {toast && <div className="fixed top-4 right-4 z-50 bg-emerald-600 text-white text-sm rounded-xl px-5 py-3 shadow-lg flex items-center gap-2"><Check className="w-4 h-4" /> {toast}</div>}

      <div className="flex items-center justify-between flex-wrap gap-2 pb-4 mb-1 border-b border-slate-100">
        <div>
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Link2 className="w-5 h-5" /> AD ACCOUNTS</h1>
          <p className="text-xs text-slate-400 mt-0.5">{inView.length} record{inView.length === 1 ? "" : "s"}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Single toggle between Active list and Archives */}
          <Button variant="outline" onClick={() => setArchivedView(v => !v)}>
            {archivedView ? <><Link2 className="w-3.5 h-3.5" /> Active</> : <><Archive className="w-3.5 h-3.5" /> Archives</>}
          </Button>
          <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => { setActive(null); setScreen("add") }}><Plus className="w-4 h-4" /> Register Ad Account</Button>
        </div>
      </div>

      {/* Token-expiry warning — only appears when close to / past expiry (above the search bar) */}
      {(expired || nearExpiry) && (
        <div className={`rounded-xl border p-3.5 text-sm flex items-center gap-2 ${expired ? "bg-rose-50 border-rose-200 text-rose-700" : "bg-amber-50 border-amber-200 text-amber-700"}`}>
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {expired
            ? <span><strong>API token expired.</strong> Renew it so your ad accounts keep syncing.</span>
            : <span><strong>API token expires in {daysLeft} day{daysLeft === 1 ? "" : "s"}.</strong> Renew it before it stops working.</span>}
          <Button className={`ml-auto text-white ${expired ? "bg-rose-600 hover:bg-rose-700" : "bg-amber-500 hover:bg-amber-600"}`} onClick={() => { setTokenInput(def.token); setTokenModal(true) }}>Renew token</Button>
        </div>
      )}

      {/* Default API token — one token shared by every ad account, with a 60-day countdown */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-slate-700"><Lock className="w-4 h-4 text-slate-400" /><span className="text-sm font-medium">Default API Token</span></div>
        {def.token ? (
          <>
            <span className="font-mono text-xs text-slate-400">•••••• {def.token.length} chars</span>
            <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${expired ? "bg-rose-100 text-rose-700" : nearExpiry ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
              {expired ? "Expired" : `${daysLeft} days left`}
            </span>
            {expiryDate && <span className="text-[11px] text-slate-400">Renew by {fmtDate(expiryDate.toISOString())}</span>}
            <button onClick={() => { setTokenInput(def.token); setTokenModal(true) }} className="ml-auto text-xs text-blue-600 hover:underline flex items-center gap-1"><KeyRound className="w-3.5 h-3.5" /> Renew / change</button>
          </>
        ) : (
          <>
            <span className="text-sm text-slate-400">Not set — this one token is auto-filled into every ad account you register.</span>
            <Button className="ml-auto bg-blue-600 hover:bg-blue-700 text-white" onClick={() => { setTokenInput(""); setTokenModal(true) }}><KeyRound className="w-4 h-4" /> Set token</Button>
          </>
        )}
      </div>

      {/* Set / renew default token modal */}
      {tokenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setTokenModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[480px] p-6 space-y-3" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2"><KeyRound className="w-4 h-4 text-blue-600" /> Default API Token</h2>
            <p className="text-sm text-slate-500">One token for all ad accounts (data is pulled per ad-account ID). Saving applies it to <strong>every</strong> registered ad account and resets the {FB_TOKEN_DAYS}-day countdown.</p>
            <textarea className={`${INP} h-24 py-2 font-mono text-xs resize-y leading-relaxed`} value={tokenInput} onChange={e => setTokenInput(e.target.value)} placeholder="Paste the Meta access token" spellCheck={false} />
            <span className="text-[11px] text-slate-400">{tokenInput.trim() ? `${tokenInput.trim().length} chars` : "no token"}</span>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setTokenModal(false)}>Cancel</Button>
              <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={saveDefaultToken}>Save &amp; apply</Button>
            </div>
          </div>
        </div>
      )}

      {/* Filter bar — single row (Pages & Store style) */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input className="pl-9" placeholder="Search name..." value={qName} onChange={e => setQName(e.target.value)} />
          </div>
          <div className="relative flex-1 min-w-[160px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input className="pl-9" placeholder="Search owner..." value={qOwner} onChange={e => setQOwner(e.target.value)} />
          </div>
          <select className="h-10 rounded-lg border border-slate-200 px-3 text-sm bg-white" value={fStatus} onChange={e => setFStatus(e.target.value)}>
            <option value="All">All Status</option>{FB_STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
          <select className="h-10 rounded-lg border border-slate-200 px-3 text-sm bg-white" value={fPlatform} onChange={e => setFPlatform(e.target.value)}>
            <option value="All">All Platforms</option>{["Facebook", "TikTok", "Shopee", "Lazada", "Instagram"].map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto scrollbar-dark">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left">
                {["NO.", "DATE CREATED", "NAME", "OWNER", "FOCUS", "AD ACCOUNT ID", "STATUS", "PLATFORM", "ACTIONS"].map(h => (
                  <th key={h} className="px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-slate-400 text-sm">No ad accounts. Click <strong>Register Ad Account</strong> to add one.</td></tr>
              ) : filtered.map((a, i) => (
                <tr key={a.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-400">{i + 1}</td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtDate(a.created_at)}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800">{a.name}</td>
                  <td className="px-4 py-3 text-slate-600">{a.owner || "—"}</td>
                  <td className="px-4 py-3"><span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">{a.focus}</span></td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">{actId(a.ad_account_id)}</td>
                  <td className="px-4 py-3"><span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${STATUS_BADGE[a.status] || "bg-slate-100 text-slate-600"}`}>{a.status.toLowerCase()}</span></td>
                  <td className="px-4 py-3"><span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${PLATFORM_BADGE[a.platform] || "bg-slate-100 text-slate-600"}`}>{a.platform}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 text-slate-400">
                      <button onClick={() => { setActive(a); setScreen("view") }} className="hover:text-blue-600" title="View"><Search className="w-4 h-4" /></button>
                      <button onClick={() => { setActive(a); setScreen("edit") }} className="hover:text-teal-600" title="Edit"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => setConfirmAction({ type: "delete", account: a })} className="hover:text-rose-600" title="Delete"><X className="w-4 h-4" /></button>
                      <button onClick={() => setConfirmAction({ type: "archive", account: a })} className="hover:text-amber-600" title={a.archived ? "Restore" : "Archive"}>
                        {a.archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Archive / Delete confirmation (admin approval) */}
      {confirmAction && (() => {
        const { type, account } = confirmAction
        const restoring = type === "archive" && account.archived
        const title = type === "delete" ? "Delete ad account?" : restoring ? "Restore ad account?" : "Archive ad account?"
        const body = type === "delete"
          ? <>This permanently removes <strong>{account.name}</strong> from the system. This cannot be undone.</>
          : restoring ? <>Restore <strong>{account.name}</strong> back to Active?</>
          : <>Move <strong>{account.name}</strong> to Archives?</>
        const confirmLabel = type === "delete" ? "Delete" : restoring ? "Restore" : "Archive"
        const confirmClass = type === "delete" ? "bg-rose-600 hover:bg-rose-700" : "bg-amber-500 hover:bg-amber-600"
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setConfirmAction(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-[400px] p-6 space-y-4" onClick={e => e.stopPropagation()}>
              <h2 className="text-base font-semibold text-slate-800">{title}</h2>
              <p className="text-sm text-slate-600">{body}</p>
              <p className="text-[11px] text-amber-600">⚠ Admin approval — this action is logged to the admin.</p>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={() => setConfirmAction(null)}>Cancel</Button>
                <Button className={`${confirmClass} text-white`} onClick={() => {
                  if (type === "delete") { fb.deleteAccount(account.id); flash(`"${account.name}" deleted.`) }
                  else { fb.setArchived(account.id, !account.archived); flash(restoring ? "Restored to Active." : "Moved to Archives.") }
                  setConfirmAction(null)
                }}>{confirmLabel}</Button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// Owner dropdown is the shared OwnerCombo (existing owners + User Management roster).

function FormScreen({ mode, initial, pages, owners, defaultToken, onBack, onSave }: {
  mode: "add" | "edit"; initial?: FBAccount; pages: string[]; owners: string[]; defaultToken: string
  onBack: () => void; onSave: (input: NewFBInput) => void
}) {
  const [f, setF] = useState<NewFBInput>({
    name: initial?.name || "", owner: initial?.owner || "", page_name: initial?.page_name || "",
    page_url: initial?.page_url || "", ad_account_id: initial?.ad_account_id || "", token: initial?.token || "",
    platform: initial?.platform || "Facebook", focus: initial?.focus || "Conversions", currency: initial?.currency || "PHP",
    status: initial?.status || "Active", remarks: initial?.remarks || "", card_id: initial?.card_id || "",
  })
  const { cards } = useFinanceCards()   // Finance → Cards registry (kung saang card naka-register)
  const [err, setErr] = useState("")
  const set = (k: keyof NewFBInput, v: string) => setF(p => ({ ...p, [k]: v }))
  // Token defaults to the shared default token (locked) unless this account uses a custom one.
  const hasDefault = !!defaultToken
  const [useCustom, setUseCustom] = useState<boolean>(!!initial?.token && initial.token !== defaultToken)

  function submit() {
    if (!f.name.trim()) return setErr("Name is required.")
    if (!f.ad_account_id.trim()) return setErr("Ad Account ID is required.")
    setErr("")
    const finalToken = (hasDefault && !useCustom) ? defaultToken : f.token.trim()
    onSave({ ...f, name: f.name.trim(), ad_account_id: f.ad_account_id.trim(), token: finalToken })
  }

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft className="w-4 h-4" /> Back to Ad Accounts</button>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-3xl">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 mb-4"><Settings className="w-5 h-5" /> {mode === "add" ? "REGISTER AD ACCOUNT" : "EDIT AD ACCOUNT"}</h1>
        <div className="space-y-0.5">
          <FormRow label="Name" required><Input className={INP} value={f.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Lumyra - Glaucoma" /></FormRow>
          <FormRow label="Owner"><OwnerCombo value={f.owner} onChange={v => set("owner", v)} options={owners} /></FormRow>
          <FormRow label="Platform">
            <select className={INP} value={f.platform} onChange={e => set("platform", e.target.value)}>
              {["Facebook", "TikTok", "Shopee", "Lazada", "Instagram"].map(p => <option key={p}>{p}</option>)}
            </select>
          </FormRow>
          <FormRow label="Focus">
            <select className={INP} value={f.focus} onChange={e => set("focus", e.target.value)}>
              {FB_FOCUS.map(x => <option key={x}>{x}</option>)}
            </select>
          </FormRow>
          <FormRow label="Ad Account ID" required><Input className={INP} value={f.ad_account_id} onChange={e => set("ad_account_id", e.target.value)} placeholder="act_909054325102209 or 909054325102209" /></FormRow>
          <FormRow label="API Token">
            {hasDefault && !useCustom ? (
              <div className="space-y-1">
                <div className="w-full min-h-10 rounded-lg border border-slate-200 px-3 py-2.5 text-sm bg-slate-50 text-slate-500 flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 shrink-0" /> Using default token ({defaultToken.length} chars)
                </div>
                <button type="button" onClick={() => { setUseCustom(true); set("token", "") }} className="text-[11px] text-blue-600 hover:underline">Use a custom token for this account</button>
              </div>
            ) : (
              <div className="space-y-1">
                <textarea
                  className={`${INP} h-20 py-2 font-mono text-xs resize-y leading-relaxed`}
                  value={f.token}
                  onChange={e => set("token", e.target.value)}
                  placeholder="Paste the full Meta access / System User token"
                  spellCheck={false}
                />
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">{f.token ? `${f.token.trim().length} chars` : "no token set"}</span>
                  {hasDefault && <button type="button" onClick={() => { setUseCustom(false); set("token", "") }} className="text-[11px] text-blue-600 hover:underline">Use default token</button>}
                </div>
              </div>
            )}
          </FormRow>
          <FormRow label="Mapped Page">
            <select className={INP} value={f.page_name} onChange={e => set("page_name", e.target.value)}>
              <option value="">— none —</option>
              {pages.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </FormRow>
          <FormRow label="Card Used">
            <select className={INP} value={f.card_id || ""} onChange={e => set("card_id", e.target.value)}>
              <option value="">— none —</option>
              {cards.map(c => <option key={c.id} value={c.id}>{c.provider} — {c.name}</option>)}
            </select>
            <p className="text-[11px] text-slate-400 mt-1">Saang card naka-register ang ad account na ito (Finance → Cards).</p>
          </FormRow>
          <FormRow label="Status">
            <select className={INP} value={f.status} onChange={e => set("status", e.target.value)}>
              {FB_STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          </FormRow>
          <FormRow label="Remarks"><textarea className={`${INP} h-20 py-2 resize-none`} value={f.remarks} onChange={e => set("remarks", e.target.value)} /></FormRow>
        </div>
        {err && <p className="text-sm text-rose-600 mt-3">{err}</p>}
        <div className="flex gap-2 mt-5">
          <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={submit}>Submit</Button>
          <Button variant="outline" onClick={onBack}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}

function ViewScreen({ account, onBack, onEdit }: { account: FBAccount; onBack: () => void; onEdit: () => void }) {
  const { cards } = useFinanceCards()
  const card = cards.find(c => c.id === account.card_id)
  const F = ({ l, v }: { l: string; v: string }) => (
    <div className="grid grid-cols-[160px_1fr] gap-3 py-2.5 border-b border-slate-100">
      <span className="text-sm text-slate-500 text-right pr-2">{l}</span><span className="text-sm text-slate-800">{v || "—"}</span>
    </div>
  )
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft className="w-4 h-4" /> Back to Ad Accounts</button>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-3xl">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 mb-4"><Settings className="w-5 h-5" /> VIEW AD ACCOUNT</h1>
        <F l="Name" v={account.name} /><F l="Owner" v={account.owner} /><F l="Platform" v={account.platform} /><F l="Focus" v={account.focus} />
        <F l="Ad Account ID" v={actId(account.ad_account_id)} /><F l="API Token" v={account.token ? "•••••• (set)" : "missing"} />
        <F l="Mapped Page" v={account.page_name} />
        <F l="Card Used" v={card ? `${card.provider} — ${card.name}` : ""} />
        <F l="Status" v={account.status} /><F l="Remarks" v={account.remarks} />
        <div className="flex gap-2 mt-4">
          <Button className="bg-teal-500 hover:bg-teal-600 text-white" onClick={onEdit}><Pencil className="w-3.5 h-3.5" /> Edit</Button>
          <Button variant="outline" onClick={onBack}>Close</Button>
        </div>
      </div>
    </div>
  )
}
