"use client"
import { useState, useMemo, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  FlaskConical, FileText, Search, Pencil, Archive, ArchiveRestore, FolderOpen,
  Plus, X, Check, ChevronLeft, ChevronDown, Settings, Link2, Trash2, AlertTriangle,
} from "lucide-react"
import {
  useProductTesting, cogPercent, peekNextRdp, PT_STATUSES, PT_VERDICTS, PT_PLATFORMS,
  type ProductTest, type NewProductInput, type Creative, type PTStatus, type PTVerdict, type ApprovalState,
} from "@/lib/product-testing-store"

const SEL = "w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white focus:outline-none focus:border-blue-400"
const FSEL = "h-8 w-full rounded border border-slate-300 px-1.5 text-xs bg-white focus:outline-none focus:border-blue-400"
const RO = "bg-slate-100 text-slate-600 cursor-default"
const fmtNum = (n: number) => Number(n || 0).toLocaleString("en-PH")

const STATUS_BADGE: Record<PTStatus, string> = { Pending: "bg-amber-50 text-amber-700", Testing: "bg-blue-50 text-blue-700", Completed: "bg-emerald-50 text-emerald-700" }
const VERDICT_TEXT: Record<PTVerdict, string> = { Pending: "text-slate-900 font-bold", Winning: "text-emerald-600 font-semibold", Losing: "text-red-600 font-semibold", Kill: "text-red-700 font-semibold" }

function FormRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-2 border-b border-slate-100 last:border-0">
      <label className="w-40 flex-shrink-0 text-sm text-slate-600 pt-2.5 leading-tight">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <div className="flex-1">{children}</div>
    </div>
  )
}

export default function ProductTestingPage() {
  const pt = useProductTesting()
  const [screen, setScreen] = useState<"list" | "archives" | "collections" | "new" | "edit" | "view">("list")
  const [active, setActive] = useState<ProductTest | null>(null)
  const [toast, setToast] = useState("")
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500) }

  if (screen === "new") return <FormScreen pt={pt} mode="new" onBack={() => setScreen("list")} onSave={(input) => { pt.addProduct(input); flash("Item request added."); setScreen("list") }} />
  if (screen === "edit" && active) return <FormScreen pt={pt} mode="edit" initial={active}
    onBack={() => setScreen("list")}
    onSave={(input) => { pt.updateProduct(active.id, input); flash("Item request updated."); setScreen("list") }}
    onRequestDelete={(reason) => { pt.requestDelete(active.id, reason); flash("Delete requested — awaiting approval."); setScreen("list") }} />
  if (screen === "view" && active) {
    const cur = pt.products.find(p => p.id === active.id) || active
    return <ViewScreen product={cur} onBack={() => setScreen("list")}
      onEdit={() => { setActive(cur); setScreen("edit") }}
      onApproveLevel={(level, remarks) => { pt.setApproval(cur.id, level, "Approved", remarks); flash(`Level ${level} approved.`) }}
      onDeclineLevel={(level, remarks) => { pt.setApproval(cur.id, level, "Declined", remarks); flash(`Level ${level} declined.`) }}
      onApproveDelete={() => { pt.approveDelete(cur.id); flash("Item deleted."); setScreen("list") }}
      onDeclineDelete={(remarks) => { pt.declineDelete(cur.id, remarks); flash("Delete request declined.") }} />
  }
  if (screen === "collections") return <CollectionsScreen pt={pt} onBack={() => setScreen("list")} />

  const archived = screen === "archives"
  return (
    <ListScreen pt={pt} archived={archived} toast={toast}
      onNew={() => setScreen("new")}
      onToggleArchivesView={() => setScreen(archived ? "list" : "archives")}
      onCollections={() => setScreen("collections")}
      onView={(p) => { setActive(p); setScreen("view") }}
      onEdit={(p) => { setActive(p); setScreen("edit") }}
      onArchive={(p) => { pt.setArchived(p.id, !p.archived); flash(p.archived ? "Moved to Requests." : "Moved to Archives.") }}
    />
  )
}

// ── Dashboard / Archives list ─────────────────────────────────────────────────
function ListScreen({ pt, archived, toast, onNew, onToggleArchivesView, onCollections, onView, onEdit, onArchive }: {
  pt: ReturnType<typeof useProductTesting>; archived: boolean; toast: string
  onNew: () => void; onToggleArchivesView: () => void; onCollections: () => void
  onView: (p: ProductTest) => void; onEdit: (p: ProductTest) => void; onArchive: (p: ProductTest) => void
}) {
  const [perPage, setPerPage] = useState(10)
  const [page, setPage] = useState(1)
  const [confirm, setConfirm] = useState<ProductTest | null>(null)
  const empty = { collection: "", name: "", srp: "", pages: "", status: "All", verdict: "All" }
  const [f, setF] = useState({ ...empty })
  const setFi = (k: keyof typeof empty, v: string) => { setF(p => ({ ...p, [k]: v })); setPage(1) }

  const filtered = useMemo(() => pt.products.filter(p => {
    if (p.archived !== archived) return false
    if (f.collection && !p.collection.toLowerCase().includes(f.collection.toLowerCase())) return false
    if (f.name && !p.name.toLowerCase().includes(f.name.toLowerCase())) return false
    if (f.srp && !String(p.srp).includes(f.srp)) return false
    if (f.pages && !p.pages.toLowerCase().includes(f.pages.toLowerCase())) return false
    if (f.status !== "All" && p.status !== f.status) return false
    if (f.verdict !== "All" && p.verdict !== f.verdict) return false
    return true
  }), [pt.products, archived, f])

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage))
  const curPage = Math.min(page, totalPages)
  const rows = filtered.slice((curPage - 1) * perPage, curPage * perPage)

  return (
    <div className="space-y-3">
      <span className="text-sm text-slate-500 font-medium">Product Testing{archived ? " / Archives" : ""}</span>
      {toast && <div className="fixed top-5 right-5 z-50 bg-emerald-500 text-white rounded-xl shadow-2xl px-4 py-3 text-sm">{toast}</div>}

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-start justify-between flex-wrap gap-3 mb-4 pb-4 border-b border-slate-100">
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><FlaskConical className="w-5 h-5" /> PRODUCT TESTING{archived ? " — ARCHIVES" : ""}</h1>
          <div className="flex items-center gap-2 flex-wrap">
            {!archived && <Button onClick={onNew}><FileText className="w-4 h-4" /> New Product Testing</Button>}
            <button onClick={onToggleArchivesView} className="px-4 py-2 rounded-md bg-teal-500 hover:bg-teal-600 text-white text-sm font-semibold flex items-center gap-1.5">
              <Archive className="w-4 h-4" /> {archived ? "View Requests" : "View Archives"}
            </button>
            <button onClick={onCollections} className="px-4 py-2 rounded-md bg-slate-900 hover:bg-slate-700 text-white text-sm font-semibold flex items-center gap-1.5">
              <FolderOpen className="w-4 h-4" /> View Collections
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <select value={perPage} onChange={e => { setPerPage(parseInt(e.target.value)); setPage(1) }} className="h-9 rounded-lg border border-slate-300 px-2 text-sm bg-white">
            {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="text-sm text-slate-500">records</span>
        </div>

        <div className="overflow-auto border border-slate-200 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                {["No", "Collection", "Name", "SRP", "Pages", "Status", "Verdict", "Platform", "Action"].map(c =>
                  <th key={c} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{c}</th>)}
              </tr>
              <tr className="border-b border-slate-200 bg-white align-top">
                <th className="px-2 py-2"></th>
                <th className="px-2 py-2"><input value={f.collection} onChange={e => setFi("collection", e.target.value)} className={`${FSEL} min-w-[100px]`} /></th>
                <th className="px-2 py-2"><input value={f.name} onChange={e => setFi("name", e.target.value)} className={`${FSEL} min-w-[120px]`} /></th>
                <th className="px-2 py-2"><input value={f.srp} onChange={e => setFi("srp", e.target.value)} className={`${FSEL} min-w-[80px]`} /></th>
                <th className="px-2 py-2"><input value={f.pages} onChange={e => setFi("pages", e.target.value)} className={`${FSEL} min-w-[90px]`} /></th>
                <th className="px-2 py-2">
                  <select value={f.status} onChange={e => setFi("status", e.target.value)} className={FSEL}><option>All</option>{PT_STATUSES.map(s => <option key={s}>{s}</option>)}</select>
                </th>
                <th className="px-2 py-2">
                  <select value={f.verdict} onChange={e => setFi("verdict", e.target.value)} className={FSEL}><option>All</option>{PT_VERDICTS.map(s => <option key={s}>{s}</option>)}</select>
                </th>
                <th className="px-2 py-2"></th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!pt.loaded ? <tr><td colSpan={9} className="text-center py-12 text-slate-400">Loading…</td></tr>
                : rows.length === 0 ? <tr><td colSpan={9} className="text-center py-12 text-slate-400">No items found</td></tr>
                  : rows.map((p, i) => {
                    const creativesCount = p.creatives.length
                    const linksCount = p.creatives.reduce((s, c) => s + c.links.length, 0)
                    return (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2.5 text-slate-400">{(curPage - 1) * perPage + i + 1}</td>
                        <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{p.collection || ""}</td>
                        <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap font-medium">
                          {p.name}
                          {p.delete_status === "pending" && <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-50 text-red-600">Delete Requested</span>}
                        </td>
                        <td className="px-3 py-2.5 text-slate-700">{fmtNum(p.srp)}</td>
                        <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{p.pages || ""}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[p.status]}`}>{p.status}</span>
                          <span className="ml-1.5 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded text-[11px] font-bold bg-blue-500 text-white" title="Creatives">{creativesCount}</span>
                          <span className="ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded text-[11px] font-bold bg-amber-400 text-white" title="Links">{linksCount}</span>
                        </td>
                        <td className={`px-3 py-2.5 whitespace-nowrap ${VERDICT_TEXT[p.verdict]}`}>{p.verdict}</td>
                        <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{p.platform || ""}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1">
                            <button onClick={() => onView(p)} title="View" className="w-8 h-8 flex items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-100"><Search className="w-4 h-4" /></button>
                            {!archived && <button onClick={() => onEdit(p)} title="Edit" className="w-8 h-8 flex items-center justify-center rounded bg-teal-400 hover:bg-teal-500 text-white"><Pencil className="w-4 h-4" /></button>}
                            <button onClick={() => setConfirm(p)} title={archived ? "Move to Requests" : "Move to Archives"} className="w-8 h-8 flex items-center justify-center rounded bg-blue-500 hover:bg-blue-600 text-white">
                              {archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-3 text-sm text-slate-500">
          <span>Showing {filtered.length === 0 ? 0 : (curPage - 1) * perPage + 1} to {Math.min(curPage * perPage, filtered.length)} of {filtered.length} entries</span>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={curPage === 1} onClick={() => setPage(curPage - 1)}>Prev</Button>
              <span>Page {curPage} of {totalPages}</span>
              <Button size="sm" variant="outline" disabled={curPage === totalPages} onClick={() => setPage(curPage + 1)}>Next</Button>
            </div>
          )}
        </div>
      </div>

      {confirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6">
            <h2 className="font-bold text-slate-900 text-base mb-1">{confirm.archived ? "Move to Requests?" : "Move to Archives?"}</h2>
            <p className="text-sm text-slate-600 mb-4">
              {confirm.archived
                ? <>Unarchive <span className="font-semibold">{confirm.name}</span> and move it back to Requests?</>
                : <>Archive <span className="font-semibold">{confirm.name}</span>? You can restore it later from Archives.</>}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirm(null)}>No</Button>
              <Button onClick={() => { onArchive(confirm); setConfirm(null) }}>Yes</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Read an image file → a downscaled data URL (so the ACTUAL image is stored & shown, not just the
// filename). Capped to maxDim px + JPEG re-encode (PNG kept for transparency) to stay localStorage-safe.
function fileToImageData(file: File, maxDim = 700): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const raw = String(reader.result || "")
      const img = new window.Image()
      img.onload = () => {
        let { width, height } = img
        if (width > maxDim || height > maxDim) { const s = maxDim / Math.max(width, height); width = Math.round(width * s); height = Math.round(height * s) }
        const canvas = document.createElement("canvas")
        canvas.width = width; canvas.height = height
        const ctx = canvas.getContext("2d")
        if (!ctx) { resolve(raw); return }
        ctx.drawImage(img, 0, 0, width, height)
        try { resolve(canvas.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.85)) } catch { resolve(raw) }
      }
      img.onerror = () => resolve(raw)
      img.src = raw
    }
    reader.onerror = () => resolve("")
    reader.readAsDataURL(file)
  })
}

// File picker that stores the actual image (data URL) and previews a thumbnail.
function FilePicker({ value, onPick, label = "No file selected" }: { value: string; onPick: (data: string) => void; label?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const isImg = value.startsWith("data:")
  return (
    <div className="flex max-w-md">
      <div className="flex items-center h-10 flex-1 min-w-0 border border-r-0 border-slate-300 rounded-l-md px-3 gap-2 text-sm bg-white">
        {isImg ? <img src={value} alt="" className="h-7 w-7 object-cover rounded flex-shrink-0" /> : <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />}
        {isImg ? <span className="text-slate-700">Image selected</span> : (value ? <span className="text-slate-700 truncate">{value}</span> : <span className="text-slate-400">{label}</span>)}
      </div>
      <button type="button" onClick={() => ref.current?.click()} className="h-10 px-4 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-r-md text-sm text-slate-600 flex-shrink-0">Select file</button>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={async e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) onPick(await fileToImageData(file)) }} />
    </div>
  )
}

// ── New / Edit form (2-step: item request → creatives) ────────────────────────
function FormScreen({ pt, mode, initial, onBack, onSave, onRequestDelete }: {
  pt: ReturnType<typeof useProductTesting>; mode: "new" | "edit"; initial?: ProductTest; onBack: () => void
  onSave: (input: NewProductInput) => void; onRequestDelete?: (reason: string) => void
}) {
  const [step, setStep] = useState<1 | 2>(1)
  const [delMode, setDelMode] = useState(false)
  const [delReason, setDelReason] = useState("")
  const [rdp] = useState(() => initial?.rdp_control_no || peekNextRdp(pt.products))
  const [f, setF] = useState<NewProductInput>(initial ? {
    rdp_control_no: initial.rdp_control_no, collection: initial.collection, name: initial.name,
    product_name_description: initial.product_name_description, product_image: initial.product_image,
    generic_product_name: initial.generic_product_name, generic_product_image: initial.generic_product_image,
    description: initial.description, quantity_per_pack: initial.quantity_per_pack, product_form: initial.product_form,
    other_specs: initial.other_specs, srp: initial.srp, cog: initial.cog, cog_percent: initial.cog_percent,
    pages: initial.pages, platform: initial.platform, status: initial.status, verdict: initial.verdict, creatives: initial.creatives,
  } : {
    rdp_control_no: "", collection: "", name: "", product_name_description: "", product_image: "",
    generic_product_name: "", generic_product_image: "", description: "", quantity_per_pack: 1, product_form: "",
    other_specs: "", srp: 0, cog: 0, cog_percent: 0, pages: "", platform: "", status: "Pending", verdict: "Pending",
    creatives: [{ id: `cr-${Date.now()}`, name: "", links: [""] }],
  })
  const [errors, setErrors] = useState<string[]>([])
  const set = (k: keyof NewProductInput, v: any) => { setF(p => ({ ...p, [k]: v })); setErrors([]) }
  const ta = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-400 resize-none"

  function goNext() {
    const m: string[] = []
    if (!f.name.trim()) m.push("Product Name")
    if (!(Number(f.quantity_per_pack) > 0)) m.push("Quantity per pack")
    if (!(Number(f.cog) > 0)) m.push("COG")
    if (!(Number(f.srp) > 0)) m.push("SRP for 1pc")
    if (m.length) { setErrors(m); return }
    setErrors([]); setStep(2)
  }

  // Creatives helpers
  const setCreative = (ci: number, patch: Partial<Creative>) => setF(p => ({ ...p, creatives: p.creatives.map((c, i) => i === ci ? { ...c, ...patch } : c) }))
  const addCreative = () => setF(p => ({ ...p, creatives: [...p.creatives, { id: `cr-${Date.now()}-${p.creatives.length}`, name: "", links: [""] }] }))
  const removeCreative = (ci: number) => setF(p => ({ ...p, creatives: p.creatives.filter((_, i) => i !== ci) }))
  const setLink = (ci: number, li: number, v: string) => setCreative(ci, { links: f.creatives[ci].links.map((l, i) => i === li ? v : l) })
  const addLink = (ci: number) => setCreative(ci, { links: [...f.creatives[ci].links, ""] })
  const removeLink = (ci: number, li: number) => setCreative(ci, { links: f.creatives[ci].links.filter((_, i) => i !== li) })

  function submit() {
    const creatives = f.creatives.map(c => ({ ...c, links: c.links.map(l => l.trim()).filter(Boolean) })).filter(c => c.name.trim() || c.links.length)
    onSave({ ...f, rdp_control_no: rdp, srp: Number(f.srp), cog: Number(f.cog), quantity_per_pack: Number(f.quantity_per_pack), creatives })
  }

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"><ChevronLeft className="w-4 h-4" /> Back to Product Testing</button>
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 mb-1">
          <Settings className="w-5 h-5" /> {step === 1 ? (mode === "new" ? "ADD ITEM REQUEST" : "EDIT ITEM REQUEST") : "ITEM CREATIVES"}
        </h1>
        <hr className="border-slate-200 mb-4" />
        {errors.length > 0 && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 max-w-2xl">
            <p className="font-medium mb-1">Please fill in required fields:</p>
            <ul className="list-disc pl-4 space-y-0.5">{errors.map(e => <li key={e}>{e}</li>)}</ul>
          </div>
        )}

        {step === 1 ? (
          <>
            <div className="max-w-3xl">
              <FormRow label="Collection">
                <select className={SEL} value={f.collection} onChange={e => set("collection", e.target.value)}>
                  <option value="">--SELECT COLLECTION--</option>{pt.collections.map(c => <option key={c}>{c}</option>)}
                </select>
              </FormRow>
              <FormRow label="RDP Control Number"><Input value={rdp} readOnly className={`${RO}`} /></FormRow>
              <FormRow label="Product Name" required><Input value={f.name} onChange={e => set("name", e.target.value)} /></FormRow>
              <FormRow label="Product Name Description"><textarea rows={3} value={f.product_name_description} onChange={e => set("product_name_description", e.target.value)} className={ta} /></FormRow>
              <FormRow label="Product Image"><FilePicker value={f.product_image} onPick={v => set("product_image", v)} /></FormRow>
              <FormRow label="Generic Product Name"><Input value={f.generic_product_name} onChange={e => set("generic_product_name", e.target.value)} /></FormRow>
              <FormRow label="Generic Product Image"><FilePicker value={f.generic_product_image} onPick={v => set("generic_product_image", v)} /></FormRow>
              <FormRow label="Product Description"><textarea rows={3} value={f.description} onChange={e => set("description", e.target.value)} className={ta} /></FormRow>
              <FormRow label="Quantity per pack" required><Input type="number" min={1} value={f.quantity_per_pack || ""} onChange={e => set("quantity_per_pack", parseInt(e.target.value) || 0)} className="max-w-[220px]" /></FormRow>
              <FormRow label="Product Form"><Input value={f.product_form} onChange={e => set("product_form", e.target.value)} /></FormRow>
              <FormRow label="Other Product Specifications"><textarea rows={3} value={f.other_specs} onChange={e => set("other_specs", e.target.value)} className={ta} /></FormRow>
              <FormRow label="COG" required><Input type="number" min={0} value={f.cog || ""} placeholder="0.00" onChange={e => set("cog", parseFloat(e.target.value) || 0)} className="max-w-[260px]" /></FormRow>
              <FormRow label="COG Percent">
                <div className="flex items-center gap-3">
                  <Input value={f.cog_percent ? `${f.cog_percent}%` : ""} readOnly placeholder="—" className={`max-w-[260px] ${RO}`} />
                  <Button onClick={() => set("cog_percent", cogPercent(Number(f.cog), Number(f.srp)))}>Get Percentage</Button>
                </div>
              </FormRow>
              <FormRow label="SRP for 1pc" required><Input type="number" min={0} value={f.srp || ""} placeholder="0.00" onChange={e => set("srp", parseFloat(e.target.value) || 0)} className="max-w-[260px]" /></FormRow>
            </div>

            {mode === "edit" && onRequestDelete && initial?.delete_status !== "pending" && delMode && (
              <div className="mt-4 p-3 border border-red-200 rounded-lg bg-red-50/60 max-w-2xl">
                <p className="text-sm font-medium text-slate-700 mb-2">Reason for delete request</p>
                <textarea rows={3} value={delReason} onChange={e => setDelReason(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-400 resize-none" placeholder="Why should this item be deleted?" />
                <div className="flex gap-2 mt-2">
                  <Button size="sm" className="bg-red-500 hover:bg-red-600 text-white" disabled={!delReason.trim()} onClick={() => onRequestDelete(delReason.trim())}>Submit Delete Request</Button>
                  <Button size="sm" variant="outline" onClick={() => { setDelMode(false); setDelReason("") }}>Cancel</Button>
                </div>
              </div>
            )}
            {mode === "edit" && initial?.delete_status === "pending" && (
              <div className="mt-4 p-3 border border-amber-200 rounded-lg bg-amber-50 max-w-2xl text-sm text-amber-800">
                <span className="font-medium">Delete already requested</span> — awaiting admin approval. Reason: “{initial.delete_reason}”
              </div>
            )}

            <hr className="border-slate-200 my-5" />
            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={onBack}>Back</Button>
              <div className="flex gap-2">
                {mode === "edit" && onRequestDelete && initial?.delete_status !== "pending" && !delMode && (
                  <Button className="bg-red-500 hover:bg-red-600 text-white" onClick={() => setDelMode(true)}><Trash2 className="w-4 h-4" /> Request to Delete</Button>
                )}
                <Button onClick={goNext}>Submit and Go to Next Page</Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="max-w-3xl">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-bold text-slate-700">Creatives — name &amp; link(s)</p>
                <Button size="sm" variant="outline" onClick={addCreative}><Plus className="w-4 h-4" /> Add Creative</Button>
              </div>
              <div className="space-y-3">
                {f.creatives.map((c, ci) => (
                  <div key={c.id} className="border border-slate-200 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Input value={c.name} placeholder={`Creative ${ci + 1} name`} onChange={e => setCreative(ci, { name: e.target.value })} />
                      {f.creatives.length > 1 && <button onClick={() => removeCreative(ci)} className="w-8 h-8 flex items-center justify-center rounded border border-slate-200 text-slate-400 hover:text-red-500 flex-shrink-0"><X className="w-4 h-4" /></button>}
                    </div>
                    <div className="space-y-1.5 pl-1">
                      {c.links.map((l, li) => (
                        <div key={li} className="flex items-center gap-2">
                          <Link2 className="w-4 h-4 text-slate-400 flex-shrink-0" />
                          <Input value={l} placeholder="https://…" onChange={e => setLink(ci, li, e.target.value)} />
                          {c.links.length > 1 && <button onClick={() => removeLink(ci, li)} className="text-slate-400 hover:text-red-500 flex-shrink-0"><X className="w-4 h-4" /></button>}
                        </div>
                      ))}
                      <button onClick={() => addLink(ci)} className="text-xs text-blue-600 hover:text-blue-700 ml-6"><Plus className="w-3 h-3 inline" /> Add Link</button>
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-sm font-bold text-slate-700 mt-6 mb-1">Testing</p>
              <FormRow label="Platform">
                <select className={`${SEL} max-w-[260px]`} value={f.platform} onChange={e => set("platform", e.target.value)}>
                  <option value="">-- SELECT PLATFORM --</option>{PT_PLATFORMS.map(p => <option key={p}>{p}</option>)}
                </select>
              </FormRow>
              <FormRow label="Pages"><Input value={f.pages} placeholder="Pages tested on" onChange={e => set("pages", e.target.value)} /></FormRow>
              <FormRow label="Status"><select className={`${SEL} max-w-[200px]`} value={f.status} onChange={e => set("status", e.target.value as PTStatus)}>{PT_STATUSES.map(s => <option key={s}>{s}</option>)}</select></FormRow>
              <FormRow label="Verdict"><select className={`${SEL} max-w-[200px]`} value={f.verdict} onChange={e => set("verdict", e.target.value as PTVerdict)}>{PT_VERDICTS.map(s => <option key={s}>{s}</option>)}</select></FormRow>
            </div>
            <hr className="border-slate-200 my-5" />
            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={submit}>Submit</Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── View ──────────────────────────────────────────────────────────────────────
function fmtDateTime(iso: string): string {
  const d = new Date(iso); if (isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
const APPROVAL_TEXT: Record<string, string> = { Pending: "text-slate-900 font-bold", Approved: "text-emerald-600 font-semibold", Declined: "text-red-600 font-semibold" }

function ItemRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr className="border-b border-slate-200 last:border-0 align-top">
      <td className="bg-slate-50/70 px-4 py-2.5 font-bold text-sm text-slate-700 w-64">{label}</td>
      <td className="px-4 py-2.5 text-sm text-slate-700">{children}</td>
    </tr>
  )
}

function ApprovalCard({ level, state, onApprove, onDecline }: {
  level: 1 | 2; state: ApprovalState; onApprove?: (remarks: string) => void; onDecline?: (remarks: string) => void
}) {
  const [mode, setMode] = useState<"" | "approve" | "decline">("")
  const [remarks, setRemarks] = useState("")
  const done = state.status !== "Pending"
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200">
        <p className="font-bold text-slate-800">Level {level}</p>
        {!done && (onApprove || onDecline) && mode === "" && (
          <div className="flex gap-1.5">
            {onApprove && <Button size="sm" className="bg-teal-500 hover:bg-teal-600 text-white" onClick={() => setMode("approve")}><Check className="w-3.5 h-3.5" /> Approve</Button>}
            {onDecline && <Button size="sm" variant="outline" onClick={() => setMode("decline")}>Decline</Button>}
          </div>
        )}
      </div>
      {mode && (
        <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50">
          <textarea rows={2} value={remarks} onChange={e => setRemarks(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-400 resize-none" placeholder="Remarks (optional)" />
          <div className="flex gap-2 mt-1.5">
            <Button size="sm" onClick={() => { (mode === "approve" ? onApprove : onDecline)?.(remarks.trim()); setMode(""); setRemarks("") }}>Confirm {mode === "approve" ? "Approve" : "Decline"}</Button>
            <Button size="sm" variant="outline" onClick={() => { setMode(""); setRemarks("") }}>Cancel</Button>
          </div>
        </div>
      )}
      <table className="w-full text-sm">
        <tbody>
          <tr className="border-b border-slate-100"><td className="px-4 py-2 text-slate-500 w-32">Approver</td><td className="px-4 py-2 text-slate-700">{state.approver || ""}</td></tr>
          <tr className="border-b border-slate-100"><td className="px-4 py-2 text-slate-500">Status</td><td className={`px-4 py-2 ${APPROVAL_TEXT[state.status]}`}>{state.status}</td></tr>
          <tr className="border-b border-slate-100"><td className="px-4 py-2 text-slate-500">Date</td><td className="px-4 py-2 text-slate-700">{state.date || ""}</td></tr>
          <tr><td className="px-4 py-2 text-slate-500 bg-slate-50/70">Remarks</td><td className="px-4 py-2 text-slate-700 bg-slate-50/70">{state.remarks || ""}</td></tr>
        </tbody>
      </table>
    </div>
  )
}

function ViewScreen({ product, onBack, onEdit, onApproveLevel, onDeclineLevel, onApproveDelete, onDeclineDelete }: {
  product: ProductTest; onBack: () => void; onEdit?: () => void
  onApproveLevel?: (level: 1 | 2, remarks: string) => void; onDeclineLevel?: (level: 1 | 2, remarks: string) => void
  onApproveDelete?: () => void; onDeclineDelete?: (remarks: string) => void
}) {
  const [declineMode, setDeclineMode] = useState(false)
  const [remarks, setRemarks] = useState("")
  const pendingDelete = product.delete_status === "pending"
  const imgCell = (val: string) => !val
    ? <span className="text-slate-400">No image</span>
    : val.startsWith("data:")
      ? <img src={val} alt="" className="max-h-40 max-w-[200px] rounded-md border border-slate-200" />
      : <span className="inline-flex items-center gap-2"><FileText className="w-4 h-4 text-slate-400" />{val}</span>
  const platforms = product.platform.split(",").map(s => s.trim()).filter(Boolean)

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"><ChevronLeft className="w-4 h-4" /> Back to Product Testing</button>
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 mb-4"><Settings className="w-5 h-5" /> ITEM REQUEST</h1>

        {pendingDelete && (
          <div className="mb-4 rounded-lg border-l-4 border-red-400 bg-red-50 px-4 py-3">
            <p className="text-sm font-semibold text-red-700 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Delete Requested — awaiting admin approval</p>
            {product.delete_reason && <p className="text-sm text-red-600 mt-0.5">Reason: “{product.delete_reason}”</p>}
            {(onApproveDelete || onDeclineDelete) && !declineMode && (
              <div className="flex gap-2 mt-2">
                {onApproveDelete && <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" onClick={onApproveDelete}><Trash2 className="w-4 h-4" /> Approve Delete</Button>}
                {onDeclineDelete && <Button size="sm" variant="outline" onClick={() => setDeclineMode(true)}>Decline</Button>}
              </div>
            )}
            {declineMode && (
              <div className="mt-2">
                <textarea rows={2} value={remarks} onChange={e => setRemarks(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-400 resize-none" placeholder="Remarks (optional)" />
                <div className="flex gap-2 mt-1.5">
                  <Button size="sm" onClick={() => { onDeclineDelete?.(remarks.trim()); setDeclineMode(false); setRemarks("") }}>Confirm Decline</Button>
                  <Button size="sm" variant="outline" onClick={() => { setDeclineMode(false); setRemarks("") }}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Details table */}
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full"><tbody>
            <ItemRow label="Collection">{product.collection || "NO COLLECTION"}</ItemRow>
            <ItemRow label="RDP Control Number">{product.rdp_control_no}</ItemRow>
            <ItemRow label="Product Name">{product.name}</ItemRow>
            <ItemRow label="Product Name Description">{product.product_name_description || ""}</ItemRow>
            <ItemRow label="Product Image">{imgCell(product.product_image)}</ItemRow>
            <ItemRow label="Generic Product Name">{product.generic_product_name || ""}</ItemRow>
            <ItemRow label="Generic Product Image">{imgCell(product.generic_product_image)}</ItemRow>
            <ItemRow label="Product Description">{product.description || ""}</ItemRow>
            <ItemRow label="Quantity per pack | Net weight">{fmtNum(product.quantity_per_pack)} pc</ItemRow>
            <ItemRow label="Product Form">{product.product_form || ""}</ItemRow>
            <ItemRow label="COG">{fmtNum(product.cog)}</ItemRow>
            <ItemRow label="COG Percentage">{product.cog_percent || 0}</ItemRow>
            <ItemRow label="SRP">1 pc: {fmtNum(product.srp)}</ItemRow>
            <ItemRow label="Other Product Specifications">{product.other_specs || ""}</ItemRow>
            <ItemRow label="Page Name">{product.pages
              ? product.pages
              : <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-500 text-white text-xs font-semibold px-3 py-1.5">Set Page <Check className="w-3.5 h-3.5" /></span>}</ItemRow>
            <ItemRow label="Platform">
              {platforms.length ? <div className="flex flex-wrap gap-1.5">{platforms.map(pl => <span key={pl} className="rounded bg-slate-100 text-slate-600 text-xs px-2 py-1">{pl}</span>)}</div> : ""}
            </ItemRow>
            <ItemRow label="Verdict"><span className={VERDICT_TEXT[product.verdict]}>{product.verdict}</span></ItemRow>
            <ItemRow label="Creatives">
              {product.creatives.length === 0 ? <span className="text-slate-400">No creatives</span> : (
                <ul className="list-disc pl-5 space-y-0.5">
                  {product.creatives.map(c => (
                    <li key={c.id}>
                      {c.links[0] ? <a href={c.links[0]} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{c.name || "Creative"}</a> : (c.name || "Creative")}
                      {c.links.length > 1 && <span className="text-xs text-slate-400"> (+{c.links.length - 1} more link{c.links.length > 2 ? "s" : ""})</span>}
                    </li>
                  ))}
                </ul>
              )}
            </ItemRow>
          </tbody></table>
        </div>

        {/* Two-level admin approval */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <ApprovalCard level={1} state={product.approvals.level1}
            onApprove={onApproveLevel && ((r) => onApproveLevel(1, r))} onDecline={onDeclineLevel && ((r) => onDeclineLevel(1, r))} />
          <ApprovalCard level={2} state={product.approvals.level2}
            onApprove={onApproveLevel && ((r) => onApproveLevel(2, r))} onDecline={onDeclineLevel && ((r) => onDeclineLevel(2, r))} />
        </div>

        {/* History */}
        <div className="mt-4 border-l-4 border-blue-400 bg-blue-50/50 rounded-lg p-4">
          <p className="font-bold text-slate-700 mb-1">History</p>
          <ul className="list-disc pl-5 text-sm text-slate-600 space-y-0.5">
            <li>Created By - {product.added_by}</li>
            <li>Created Date - {fmtDateTime(product.added_date)}</li>
            <li>Last Edit By - {product.last_edit_by || product.added_by}</li>
            <li>Last Edit Date - {fmtDateTime(product.last_edit_date || product.added_date)}</li>
          </ul>
        </div>

        <div className="flex items-center gap-2 mt-5">
          {onEdit && <Button variant="outline" onClick={onEdit}><Pencil className="w-4 h-4" /> Edit Item</Button>}
          <Button className="bg-slate-900 hover:bg-slate-700 text-white" onClick={onBack}>Close</Button>
        </div>
      </div>
    </div>
  )
}

// ── Collections ───────────────────────────────────────────────────────────────
function CollectionsScreen({ pt, onBack }: { pt: ReturnType<typeof useProductTesting>; onBack: () => void }) {
  const [name, setName] = useState("")
  const grouped = useMemo(() => {
    const all = Array.from(new Set([...pt.collections, ...pt.products.map(p => p.collection).filter(Boolean)]))
    return all.map(col => ({ name: col, items: pt.products.filter(p => p.collection === col && !p.archived) }))
  }, [pt.collections, pt.products])

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"><ChevronLeft className="w-4 h-4" /> Back to Product Testing</button>
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 mb-4"><FolderOpen className="w-5 h-5" /> COLLECTIONS</h1>
        <div className="flex items-center gap-2 mb-5 max-w-md">
          <Input value={name} placeholder="New collection name" onChange={e => setName(e.target.value)} />
          <Button onClick={() => { if (name.trim()) { pt.addCollection(name.trim()); setName("") } }}><Plus className="w-4 h-4" /> Add</Button>
        </div>
        {grouped.length === 0 ? <p className="text-sm text-slate-400 italic">No collections yet.</p> : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {grouped.map(g => (
              <div key={g.name} className="border border-slate-200 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-slate-800 flex items-center gap-2"><FolderOpen className="w-4 h-4 text-amber-500" /> {g.name}</p>
                  <span className="text-xs text-slate-500">{g.items.length} item{g.items.length === 1 ? "" : "s"}</span>
                </div>
                {g.items.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-sm text-slate-600">
                    {g.items.map(it => <li key={it.id} className="truncate">• {it.name}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
        <hr className="border-slate-200 my-5" />
        <Button variant="outline" onClick={onBack}>Back</Button>
      </div>
    </div>
  )
}
