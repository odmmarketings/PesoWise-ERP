"use client"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CreditCard, Plus, X, Pencil, Trash2, Eye, EyeOff, QrCode, AlertTriangle, Link2 } from "lucide-react"
import { useFinanceCards, maskCardNumber, CARD_PROVIDERS, type FinanceCard, type NewCardInput } from "@/lib/cards-store"
import { useFBAccounts } from "@/lib/fb-store"
import { isMotherAccount } from "@/lib/users-store"

const SEL = "w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white focus:outline-none focus:border-blue-400"

// Provider accent color (dot sa table) — mabilis na visual ID per card type.
function providerColor(p: string): string {
  const s = (p || "").toLowerCase()
  if (s.includes("paymaya credit")) return "#047857"  // emerald-700
  if (s.includes("paymaya") || s.includes("maya")) return "#10b981"  // emerald-500
  if (s.includes("gotyme")) return "#0891b2"  // cyan-600
  if (s.includes("gcash")) return "#3b82f6"  // blue-500
  if (s.includes("bpi")) return "#dc2626"  // red-600
  if (s.includes("union")) return "#f97316"  // orange-500
  if (s.includes("china")) return "#e11d48"  // rose-600
  return "#64748b"  // slate-500
}

// Downscale an uploaded QR image to a compact data URL (same approach as BM pictures).
function fileToDataUrl(file: File, maxSide = 800): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
        const canvas = document.createElement("canvas")
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL("image/jpeg", 0.85))
      }
      img.onerror = reject
      img.src = String(reader.result)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function Modal({ title, icon: Icon, onClose, children, width = "max-w-lg" }: {
  title: string; icon?: any; onClose: () => void; children: React.ReactNode; width?: string
}) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className={`bg-white rounded-2xl w-full ${width} shadow-2xl max-h-[92vh] flex flex-col overflow-hidden`}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-bold text-slate-900 text-base flex items-center gap-2">{Icon && <Icon className="w-5 h-5 text-blue-600" />} {title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-auto">{children}</div>
      </div>
    </div>
  )
}

const EMPTY: NewCardInput = { name: "", username: "", account_number: "", card_number: "", qr_data: "", expiry: "", cvv: "", provider: "", remarks: "" }

function CardFormModal({ initial, onClose, onSave }: {
  initial?: FinanceCard; onClose: () => void; onSave: (input: NewCardInput) => void
}) {
  const [f, setF] = useState<NewCardInput>(initial ? { ...initial } : EMPTY)
  const [err, setErr] = useState("")
  const set = (k: keyof NewCardInput, v: string) => { setF(p => ({ ...p, [k]: v })); setErr("") }

  async function pickQr(file?: File | null) {
    if (!file) return
    try { set("qr_data", await fileToDataUrl(file)) } catch { setErr("Could not read the QR image — try another file.") }
  }
  function submit() {
    if (!f.name.trim() || !f.account_number.trim() || !f.provider) { setErr("Account Name, Account Number, and Card type are required."); return }
    onSave({ ...f, name: f.name.trim(), account_number: f.account_number.trim() })
  }

  return (
    <Modal title={initial ? "Edit Card" : "Add Card"} icon={CreditCard} onClose={onClose}>
      <div className="px-6 py-4 space-y-3">
        {err && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{err}</div>}
        <div>
          <label className="text-sm text-slate-600">Card type <span className="text-red-500">*</span></label>
          <select className={`${SEL} mt-1`} value={f.provider} onChange={e => set("provider", e.target.value)}>
            <option value="">-- SELECT CARD --</option>
            {CARD_PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm text-slate-600">Account Name <span className="text-red-500">*</span></label>
          <Input className="mt-1" value={f.name} placeholder="Name on the card/wallet" onChange={e => set("name", e.target.value)} />
        </div>
        <div>
          <label className="text-sm text-slate-600">Username</label>
          <Input className="mt-1" value={f.username} placeholder="App/wallet login username" onChange={e => set("username", e.target.value)} />
        </div>
        <div>
          <label className="text-sm text-slate-600">Card Number</label>
          <Input className="mt-1" value={f.card_number} placeholder="16-digit number on the card" onChange={e => set("card_number", e.target.value)} />
        </div>
        <div>
          <label className="text-sm text-slate-600">Account Number <span className="text-red-500">*</span></label>
          <Input className="mt-1" value={f.account_number} placeholder="Wallet / bank account number" onChange={e => set("account_number", e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-slate-600">Expiry (MM/YY)</label>
            <Input className="mt-1" value={f.expiry} placeholder="MM/YY" onChange={e => set("expiry", e.target.value)} />
          </div>
          <div>
            <label className="text-sm text-slate-600">CVV</label>
            <Input className="mt-1" type="password" value={f.cvv} placeholder="•••" onChange={e => set("cvv", e.target.value)} />
          </div>
        </div>
        <div>
          <label className="text-sm text-slate-600">QR Code (upload)</label>
          <input type="file" accept="image/*" onChange={e => pickQr(e.target.files?.[0])}
            className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-slate-100 file:text-slate-700 file:text-sm hover:file:bg-slate-200" />
          {f.qr_data && (
            <div className="mt-2 flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.qr_data} alt="QR" className="w-20 h-20 object-contain border border-slate-200 rounded-lg bg-white" />
              <button className="text-xs text-red-500 hover:underline" onClick={() => set("qr_data", "")}>Remove</button>
            </div>
          )}
        </div>
        <div>
          <label className="text-sm text-slate-600">Remarks</label>
          <Input className="mt-1" value={f.remarks} placeholder="Optional" onChange={e => set("remarks", e.target.value)} />
        </div>
      </div>
      <div className="flex items-center gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
        <Button onClick={submit}>{initial ? "Save Changes" : "Submit"}</Button>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  )
}

export default function FinanceCardsPage() {
  const store = useFinanceCards()
  const fb = useFBAccounts()
  const admin = isMotherAccount()

  const [showAdd, setShowAdd] = useState(false)
  const [edit, setEdit] = useState<FinanceCard | null>(null)
  const [qrView, setQrView] = useState<FinanceCard | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<FinanceCard | null>(null)
  const [revealed, setRevealed] = useState<Set<string>>(new Set())   // ids na naka-show ang number/CVV
  const [filter, setFilter] = useState("All")                        // card type filter (GoTyme / Maya / …)

  const providers = Array.from(new Set(store.cards.map(c => c.provider).filter(Boolean)))
  const visibleCards = filter === "All" ? store.cards : store.cards.filter(c => c.provider === filter)

  const toggleReveal = (id: string) => setRevealed(prev => {
    const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next
  })
  const connectedCount = (cardId: string) => fb.accounts.filter(a => a.card_id === cardId && !a.archived).length

  return (
    <div className="space-y-4">
      <span className="text-sm text-slate-500 font-medium">Finance / Cards</span>

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4 pb-4 border-b border-slate-100">
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><CreditCard className="w-5 h-5" /> CARDS</h1>
          <Button onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Add Card</Button>
        </div>

        {/* Card type filter — GoTyme / Maya / iba pa (kung ano ang nasa registry) */}
        {providers.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap mb-4">
            {["All", ...providers].map(p => (
              <button key={p} onClick={() => setFilter(p)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${filter === p ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                {p}{p !== "All" && <span className="ml-1.5 opacity-70">({store.cards.filter(c => c.provider === p).length})</span>}
              </button>
            ))}
          </div>
        )}

        {store.cards.length === 0 ? (
          <p className="text-sm text-slate-400 italic py-10 text-center">No cards yet — click “Add Card” to add one.</p>
        ) : visibleCards.length === 0 ? (
          <p className="text-sm text-slate-400 italic py-10 text-center">No {filter} cards.</p>
        ) : (
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-[11px] font-semibold uppercase tracking-wide border-b border-slate-200">
                    <th className="px-4 py-3 text-left">Card Type</th>
                    <th className="px-4 py-3 text-left">Card Number</th>
                    <th className="px-4 py-3 text-left">Account #</th>
                    <th className="px-4 py-3 text-left">Account Name</th>
                    <th className="px-4 py-3 text-left">Expiry</th>
                    <th className="px-4 py-3 text-left">CVV</th>
                    <th className="px-4 py-3 text-left">Ad Accounts</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleCards.map(c => {
                    const shown = revealed.has(c.id)
                    const links = connectedCount(c.id)
                    return (
                      <tr key={c.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="inline-flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-1 ring-black/5" style={{ background: providerColor(c.provider) }} />
                            <span className="font-semibold text-slate-800">{c.provider || "Card"}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap font-mono tabular-nums text-slate-700">
                          {c.card_number ? (shown ? c.card_number : maskCardNumber(c.card_number)) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap font-mono tabular-nums text-slate-600">
                          {c.account_number ? (shown ? c.account_number : maskCardNumber(c.account_number)) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 min-w-[180px]">
                          <p className="font-semibold text-slate-800 leading-tight">{c.name}</p>
                          {c.username && <p className="text-xs text-slate-400 leading-tight mt-0.5">User: {c.username}</p>}
                          {c.remarks && <p className="text-xs text-slate-400 italic leading-tight mt-0.5 max-w-[220px] truncate" title={c.remarks}>{c.remarks}</p>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap font-mono tabular-nums text-slate-600">{c.expiry || <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-3 whitespace-nowrap font-mono tabular-nums text-slate-600">{shown ? (c.cvv || "—") : "•••"}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {links > 0 ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 text-blue-700 px-2.5 py-1 text-xs font-semibold" title={`${links} connected ad account${links === 1 ? "" : "s"}`}>
                              <Link2 className="w-3.5 h-3.5" /> {links}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center justify-end gap-0.5">
                            <button title={shown ? "Hide number & CVV" : "Show number & CVV"} onClick={() => toggleReveal(c.id)}
                              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700">
                              {shown ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                            {c.qr_data && (
                              <button title="View QR" onClick={() => setQrView(c)}
                                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"><QrCode className="w-4 h-4" /></button>
                            )}
                            <button title="Edit" onClick={() => setEdit(c)}
                              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"><Pencil className="w-4 h-4" /></button>
                            {admin && (
                              <button title="Delete (admin)" onClick={() => setConfirmDelete(c)}
                                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {showAdd && <CardFormModal onClose={() => setShowAdd(false)} onSave={input => { store.addCard(input); setShowAdd(false) }} />}
      {edit && <CardFormModal initial={edit} onClose={() => setEdit(null)} onSave={input => { store.updateCard(edit.id, input); setEdit(null) }} />}

      {qrView && (
        <Modal title={`QR — ${qrView.name}`} icon={QrCode} onClose={() => setQrView(null)} width="max-w-sm">
          <div className="p-6 flex flex-col items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrView.qr_data} alt="QR code" className="w-64 h-64 object-contain border border-slate-200 rounded-xl bg-white" />
            <p className="text-sm text-slate-600 text-center">{qrView.provider} · {qrView.account_number}</p>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal title="Delete Card" icon={AlertTriangle} onClose={() => setConfirmDelete(null)}>
          <div className="px-6 py-5 text-sm text-slate-700">
            Delete <span className="font-semibold">{confirmDelete.provider} — {confirmDelete.name}</span>?
            {connectedCount(confirmDelete.id) > 0 && (
              <p className="text-xs text-amber-600 mt-2 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                Still linked to {connectedCount(confirmDelete.id)} ad account(s) — they will lose their card reference.
              </p>
            )}
          </div>
          <div className="px-6 py-4 border-t bg-slate-50 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={() => { store.deleteCard(confirmDelete.id); setConfirmDelete(null) }}>Delete</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
