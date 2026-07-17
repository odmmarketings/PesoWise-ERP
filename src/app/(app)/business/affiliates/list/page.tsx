"use client"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Users, Plus, Pencil, X, ChevronLeft, Check } from "lucide-react"
import { useAffiliates, commissionOf, AFF_PLATFORMS, AFF_STATUSES, type Affiliate, type NewAffInput, type AffStatus } from "@/lib/affiliates-store"

const INP = "w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white focus:outline-none focus:border-blue-400"
const peso = (n: number) => "₱" + (isFinite(n) ? n : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid grid-cols-[150px_1fr] items-start gap-3 py-2.5 border-b border-slate-100 last:border-0"><label className="text-sm text-slate-600 pt-2 text-right pr-2">{label}</label><div>{children}</div></div>
}

export default function AffiliatesListPage() {
  const aff = useAffiliates()
  const [screen, setScreen] = useState<"list" | "form">("list")
  const [editing, setEditing] = useState<Affiliate | null>(null)
  const [toast, setToast] = useState("")
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000) }

  if (screen === "form")
    return <FormScreen initial={editing} onBack={() => setScreen("list")}
      onSave={(input) => { editing ? aff.updateAffiliate(editing.id, input) : aff.addAffiliate(input); flash(editing ? "Affiliate updated." : "Affiliate added."); setScreen("list") }} />

  return (
    <div className="space-y-4 relative">
      {toast && <div className="fixed top-4 right-4 z-50 bg-emerald-600 text-white text-sm rounded-xl px-5 py-3 shadow-lg flex items-center gap-2"><Check className="w-4 h-4" /> {toast}</div>}
      <div className="flex items-center justify-between pb-4 mb-1 border-b border-slate-100">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Users className="w-5 h-5" /> AFFILIATES</h1>
        <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => { setEditing(null); setScreen("form") }}><Plus className="w-4 h-4" /> Add Affiliate</Button>
      </div>
      <p className="text-sm text-slate-500">Register affiliates and set each one's commission %. Attributed sales come from each platform's affiliate API (to follow).</p>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto scrollbar-dark">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 bg-slate-50 text-left">
              {["No", "Name", "Platform", "Code", "Commission %", "Sales", "Commission", "Status", "Actions"].map(h => <th key={h} className="px-3 py-3 font-semibold text-slate-600 whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody>
              {aff.affiliates.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-slate-400 text-sm">No affiliates yet.</td></tr>
              ) : aff.affiliates.map((a, i) => (
                <tr key={a.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2.5 text-slate-500">{i + 1}</td>
                  <td className="px-3 py-2.5 font-medium">{a.name}</td>
                  <td className="px-3 py-2.5">{a.platform}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{a.code || "—"}</td>
                  <td className="px-3 py-2.5">{a.commission_pct}%</td>
                  <td className="px-3 py-2.5 tabular-nums">{peso(a.sales)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-rose-600">{peso(commissionOf(a))}</td>
                  <td className={`px-3 py-2.5 font-medium ${a.status === "Active" ? "text-emerald-600" : "text-slate-400"}`}>{a.status}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => { setEditing(a); setScreen("form") }} className="w-8 h-8 flex items-center justify-center rounded bg-teal-500 hover:bg-teal-600 text-white"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => { if (confirm(`Delete affiliate "${a.name}"?`)) { aff.deleteAffiliate(a.id); flash("Deleted.") } }} className="w-8 h-8 flex items-center justify-center rounded bg-red-500 hover:bg-red-600 text-white"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function FormScreen({ initial, onBack, onSave }: { initial: Affiliate | null; onBack: () => void; onSave: (i: NewAffInput) => void }) {
  const [f, setF] = useState<NewAffInput>({
    name: initial?.name || "", platform: initial?.platform || "TikTok", code: initial?.code || "",
    commission_pct: initial?.commission_pct ?? 10, contact: initial?.contact || "",
    status: initial?.status || "Active", sales: initial?.sales ?? 0, notes: initial?.notes || "",
  })
  const set = (k: keyof NewAffInput, v: any) => setF(p => ({ ...p, [k]: v }))
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft className="w-4 h-4" /> Back to Affiliates</button>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-2xl">
        <h1 className="text-lg font-bold text-blue-600 mb-4">{initial ? "EDIT AFFILIATE" : "ADD AFFILIATE"}</h1>
        <FormRow label="Name"><Input className={INP} value={f.name} onChange={e => set("name", e.target.value)} /></FormRow>
        <FormRow label="Platform"><select className={INP} value={f.platform} onChange={e => set("platform", e.target.value)}>{AFF_PLATFORMS.map(p => <option key={p}>{p}</option>)}</select></FormRow>
        <FormRow label="Affiliate Code"><Input className={INP} value={f.code} onChange={e => set("code", e.target.value)} /></FormRow>
        <FormRow label="Commission %"><div className="relative w-40"><Input className={`${INP} pr-7`} type="number" value={f.commission_pct} onChange={e => set("commission_pct", parseFloat(e.target.value) || 0)} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">%</span></div></FormRow>
        <FormRow label="Contact"><Input className={INP} value={f.contact} onChange={e => set("contact", e.target.value)} /></FormRow>
        <FormRow label="Status"><select className={INP} value={f.status} onChange={e => set("status", e.target.value as AffStatus)}>{AFF_STATUSES.map(s => <option key={s}>{s}</option>)}</select></FormRow>
        <FormRow label="Notes"><textarea className={`${INP} h-20 py-2 resize-none`} value={f.notes} onChange={e => set("notes", e.target.value)} /></FormRow>
        <div className="flex gap-2 mt-5">
          <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => { if (f.name.trim()) onSave({ ...f, name: f.name.trim() }) }}>Submit</Button>
          <Button variant="outline" onClick={onBack}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}
