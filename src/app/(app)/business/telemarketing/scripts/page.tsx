"use client"
// Telemarketing → Scripts — searchable call-script knowledge base (docs/telemarketing-spec.md §26–27).
// Agents: fast search + copy while calling (active scripts only). Admin (Mother Account):
// add / edit / activate-deactivate / delete. Data layer = useTmScripts (telemarketing-store).
import { useMemo, useState } from "react"
import {
  ScrollText, Plus, RefreshCw, Search, X, Copy, Pencil, Trash2, Check, Power,
} from "lucide-react"
import {
  useTmScripts, useTmSettings, SCRIPT_CATEGORIES, type TmScript,
} from "@/lib/telemarketing-store"
import { isMotherAccount } from "@/lib/users-store"
import { Skeleton } from "@/components/business/Skeleton"

// ── Category colors (soft bg-*-50 pill convention, one per SCRIPT_CATEGORIES entry) ──
const CATEGORY_PILL: Record<string, string> = {
  "Opening": "bg-blue-50 text-blue-700",
  "Product Introduction": "bg-cyan-50 text-cyan-700",
  "Upsell Pitch": "bg-emerald-50 text-emerald-700",
  "Cross-sell Pitch": "bg-green-50 text-green-700",
  "Benefits": "bg-teal-50 text-teal-700",
  "Pricing": "bg-amber-50 text-amber-700",
  "Objection Handling": "bg-orange-50 text-orange-700",
  "Closing": "bg-violet-50 text-violet-700",
  "Follow-up": "bg-fuchsia-50 text-fuchsia-700",
  "FAQ": "bg-sky-50 text-sky-700",
  "Other": "bg-slate-100 text-slate-600",
}
const catPill = (c: string) => CATEGORY_PILL[c] ?? "bg-slate-100 text-slate-600"
const catOrder = (c: string) => {
  const i = (SCRIPT_CATEGORIES as readonly string[]).indexOf(c)
  return i === -1 ? SCRIPT_CATEGORIES.length : i
}
const productLabel = (p: string) => (p.trim() ? p : "General")
const fmtDate = (iso: string) => (iso ? iso.slice(0, 10) : "")

// Clipboard with a fallback for non-secure origins (LAN http — same limitation as camera scan).
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch {}
  try {
    const ta = document.createElement("textarea")
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"
    document.body.appendChild(ta); ta.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}

// ── Shared UI (module scope — never define these inside a component) ─────────
function Modal({ title, icon: Icon, onClose, children, width = "max-w-2xl" }: {
  title: string; icon?: any; onClose: () => void; children: React.ReactNode; width?: string
}) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className={`bg-white rounded-2xl w-full ${width} shadow-2xl max-h-[92vh] flex flex-col`}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-bold text-slate-900 text-base flex items-center gap-2">{Icon && <Icon className="w-5 h-5 text-blue-600" />} {title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function FormRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-2 border-b border-slate-100 last:border-0">
      <label className="w-32 flex-shrink-0 text-sm text-slate-600 pt-2.5 leading-tight">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <div className="flex-1">{children}</div>
    </div>
  )
}

function CategoryPill({ category }: { category: string }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${catPill(category)}`}>{category}</span>
}

// ── Script card ──────────────────────────────────────────────────────────────
function ScriptCard({ script, admin, onOpen, onCopy, onEdit, onToggle, onDelete }: {
  script: TmScript; admin: boolean
  onOpen: () => void; onCopy: () => void; onEdit: () => void; onToggle: () => void; onDelete: () => void
}) {
  return (
    <div
      onClick={onOpen}
      className={`bg-white rounded-2xl border border-slate-200 p-4 cursor-pointer hover:border-blue-300 hover:shadow-sm transition-all flex flex-col gap-2 ${script.active ? "" : "opacity-60"}`}
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <CategoryPill category={script.category} />
        <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-50 text-slate-500 border border-slate-200">{productLabel(script.product)}</span>
        {!script.active && <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-200 text-slate-600">Inactive</span>}
      </div>
      <div className="font-semibold text-sm text-slate-900 leading-snug">{script.title}</div>
      <div className="text-xs text-slate-500 line-clamp-3 whitespace-pre-line flex-1">{script.body}</div>
      <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[11px] text-slate-400">
        <span className="truncate">{script.added_by || "—"}{fmtDate(script.updated_at || script.added_date) ? ` · ${fmtDate(script.updated_at || script.added_date)}` : ""}</span>
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          <button onClick={onCopy} title="Copy script" className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50">
            <Copy className="w-3.5 h-3.5" />
          </button>
          {admin && (
            <>
              <button onClick={onEdit} title="Edit" className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={onToggle} title={script.active ? "Deactivate" : "Activate"}
                className={`p-1.5 rounded-lg hover:bg-slate-100 ${script.active ? "text-emerald-500 hover:text-slate-500" : "text-slate-400 hover:text-emerald-600"}`}>
                <Power className="w-3.5 h-3.5" />
              </button>
              <button onClick={onDelete} title="Delete" className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function CardSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2.5">
      <div className="flex gap-1.5"><Skeleton className="h-4 w-20 rounded-full" /><Skeleton className="h-4 w-16 rounded-full" /></div>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-2/3" />
      <div className="pt-2 border-t border-slate-100"><Skeleton className="h-3 w-28" /></div>
    </div>
  )
}

// ── Full-view modal (agent's read + copy screen) ─────────────────────────────
function ViewScriptModal({ script, onClose, onCopy }: { script: TmScript; onClose: () => void; onCopy: () => void }) {
  return (
    <Modal title={script.title} icon={ScrollText} onClose={onClose} width="max-w-3xl">
      <div className="px-6 py-4 overflow-y-auto space-y-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <CategoryPill category={script.category} />
          <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-50 text-slate-500 border border-slate-200">{productLabel(script.product)}</span>
          {!script.active && <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-200 text-slate-600">Inactive</span>}
        </div>
        <div className="bg-slate-50 rounded-xl border border-slate-100 p-4 text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
          {script.body || <span className="text-slate-400 italic">No script body.</span>}
        </div>
        <div className="text-[11px] text-slate-400">
          Added by {script.added_by || "—"}
          {fmtDate(script.added_date) ? ` on ${fmtDate(script.added_date)}` : ""}
          {fmtDate(script.updated_at) ? ` · updated ${fmtDate(script.updated_at)}` : ""}
        </div>
      </div>
      <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-slate-600 hover:bg-slate-100">Close</button>
        <button onClick={onCopy}
          className="px-5 py-2 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-2">
          <Copy className="w-4 h-4" /> Copy
        </button>
      </div>
    </Modal>
  )
}

// ── Add / Edit modal (admin) ─────────────────────────────────────────────────
const NEW_PRODUCT = "__new_product__"

function ScriptFormModal({ initial, products, onClose, onSave }: {
  initial: TmScript | null
  products: string[]
  onClose: () => void
  onSave: (f: { title: string; product: string; category: string; body: string; active: boolean }) => Promise<void>
}) {
  const initialProductKnown = !initial || initial.product === "" || products.includes(initial.product)
  const [title, setTitle] = useState(initial?.title ?? "")
  const [productSel, setProductSel] = useState(initial ? (initialProductKnown ? initial.product : NEW_PRODUCT) : "")
  const [newProduct, setNewProduct] = useState(initial && !initialProductKnown ? initial.product : "")
  const [category, setCategory] = useState(initial?.category ?? "Opening")
  const [body, setBody] = useState(initial?.body ?? "")
  const [active, setActive] = useState(initial ? initial.active : true)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  async function submit() {
    const t = title.trim()
    if (!t) { setError("Title is required."); return }
    const product = productSel === NEW_PRODUCT ? newProduct.trim() : productSel
    setSaving(true)
    try {
      await onSave({ title: t, product, category, body, active })
    } catch (e: any) {
      setError(e?.message || "Failed to save script.")
      setSaving(false)
    }
  }

  return (
    <Modal title={initial ? "Edit Script" : "Add Script"} icon={ScrollText} onClose={onClose} width="max-w-2xl">
      <div className="px-6 py-4 overflow-y-auto">
        {error && <div className="mb-3 px-3 py-2 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>}
        <FormRow label="Title" required>
          <input value={title} onChange={e => { setTitle(e.target.value); setError("") }} placeholder="e.g. Upsell pitch — 2nd bottle promo"
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
        </FormRow>
        <FormRow label="Product">
          <div className="space-y-2">
            <select value={productSel} onChange={e => setProductSel(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200">
              <option value="">General (all products)</option>
              {products.map(p => <option key={p} value={p}>{p}</option>)}
              <option value={NEW_PRODUCT}>+ New product…</option>
            </select>
            {productSel === NEW_PRODUCT && (
              <input value={newProduct} onChange={e => setNewProduct(e.target.value)} placeholder="New product name"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
            )}
          </div>
        </FormRow>
        <FormRow label="Category">
          <select value={category} onChange={e => setCategory(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200">
            {SCRIPT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </FormRow>
        <FormRow label="Script body">
          <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="The exact lines the agent reads on the call…"
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm min-h-[200px] focus:outline-none focus:ring-2 focus:ring-blue-200" />
        </FormRow>
        <FormRow label="Active">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 pt-2 cursor-pointer">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="accent-blue-600 w-4 h-4" />
            Visible to agents
          </label>
        </FormRow>
      </div>
      <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
        <button onClick={submit} disabled={saving}
          className="px-5 py-2 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
          <Check className="w-4 h-4" /> {saving ? "Saving…" : initial ? "Save Changes" : "Add Script"}
        </button>
      </div>
    </Modal>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function TmScriptsPage() {
  const { scripts, loaded, refresh, addScript, updateScript, removeScript } = useTmScripts()
  const { general } = useTmSettings()
  const admin = isMotherAccount()

  const [q, setQ] = useState("")
  const [productFilter, setProductFilter] = useState("All")
  const [categoryFilter, setCategoryFilter] = useState("All")
  const [activeOnly, setActiveOnly] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [viewing, setViewing] = useState<TmScript | null>(null)
  const [editing, setEditing] = useState<{ script: TmScript | null } | null>(null)  // null = closed; {script:null} = add
  const [deleting, setDeleting] = useState<TmScript | null>(null)
  const [toast, setToast] = useState("")
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500) }

  // Product options = Settings products ∪ distinct products already on scripts (sorted, deduped).
  const products = useMemo(() => {
    const set = new Set<string>()
    for (const p of general.products) if (p.trim()) set.add(p.trim())
    for (const s of scripts) if (s.product.trim()) set.add(s.product.trim())
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [general.products, scripts])

  // Non-admin agents only ever see active scripts; the Active-only toggle is admin-only.
  const visible = useMemo(() => {
    let list = scripts
    if (!admin || activeOnly) list = list.filter(s => s.active)
    if (productFilter !== "All") {
      list = productFilter === "General"
        ? list.filter(s => !s.product.trim())
        : list.filter(s => s.product.trim() === productFilter)
    }
    if (categoryFilter !== "All") list = list.filter(s => s.category === categoryFilter)
    const needle = q.trim().toLowerCase()
    if (needle) {
      list = list.filter(s =>
        s.title.toLowerCase().includes(needle) ||
        s.body.toLowerCase().includes(needle) ||
        productLabel(s.product).toLowerCase().includes(needle)
      )
    }
    return list
  }, [scripts, admin, activeOnly, productFilter, categoryFilter, q])

  const sortScripts = (a: TmScript, b: TmScript) =>
    catOrder(a.category) - catOrder(b.category) || a.sort - b.sort || a.title.localeCompare(b.title)

  // Grouped by product (General first, then alphabetical) when nothing is narrowing the list.
  const isFiltered = q.trim() !== "" || productFilter !== "All" || categoryFilter !== "All"
  const groups = useMemo(() => {
    if (isFiltered) return null
    const map = new Map<string, TmScript[]>()
    for (const s of visible) {
      const key = productLabel(s.product)
      const arr = map.get(key)
      if (arr) arr.push(s); else map.set(key, [s])
    }
    const keys = Array.from(map.keys()).sort((a, b) =>
      a === "General" ? -1 : b === "General" ? 1 : a.localeCompare(b))
    return keys.map(k => ({ product: k, scripts: map.get(k)!.sort(sortScripts) }))
  }, [visible, isFiltered])
  const flat = useMemo(() => (isFiltered ? [...visible].sort(sortScripts) : []), [visible, isFiltered])

  async function doRefresh() {
    setRefreshing(true)
    try { await refresh() } finally { setRefreshing(false) }
  }

  async function handleCopy(s: TmScript) {
    const ok = await copyText(s.body)
    flash(ok ? "Copied!" : "Copy failed — select and copy manually.")
  }

  async function handleSave(f: { title: string; product: string; category: string; body: string; active: boolean }) {
    if (editing?.script) {
      await updateScript(editing.script.id, f)
      flash("Script updated")
    } else {
      await addScript(f)
      flash("Script added")
    }
    setEditing(null)
  }

  async function handleToggle(s: TmScript) {
    try {
      await updateScript(s.id, { active: !s.active })
      flash(s.active ? "Script deactivated" : "Script activated")
    } catch (e: any) { flash(e?.message || "Update failed") }
  }

  async function handleDelete() {
    if (!deleting) return
    try {
      await removeScript(deleting.id)
      flash("Script deleted")
    } catch (e: any) { flash(e?.message || "Delete failed") }
    setDeleting(null)
  }

  const showSkeleton = !loaded && scripts.length === 0

  const renderGrid = (list: TmScript[]) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {list.map(s => (
        <ScriptCard key={s.id} script={s} admin={admin}
          onOpen={() => setViewing(s)}
          onCopy={() => handleCopy(s)}
          onEdit={() => setEditing({ script: s })}
          onToggle={() => handleToggle(s)}
          onDelete={() => setDeleting(s)}
        />
      ))}
    </div>
  )

  return (
    <div className="space-y-3">
      {toast && <div className="fixed top-5 right-5 z-50 bg-emerald-500 text-white rounded-xl shadow-2xl px-4 py-3 text-sm flex items-center gap-2"><Check className="w-4 h-4" /> {toast}</div>}

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4 pb-4 border-b border-slate-100">
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><ScrollText className="w-5 h-5" /> SCRIPTS</h1>
          <div className="flex items-center gap-2">
            {admin && (
              <button onClick={() => setEditing({ script: null })}
                className="px-3.5 py-2 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> Add Script
              </button>
            )}
            <button onClick={doRefresh} title="Refresh"
              className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:text-blue-600 hover:border-blue-300">
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search scripts — title, body, or product…"
              className="w-full border border-slate-200 rounded-xl pl-9 pr-9 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
            {q && (
              <button onClick={() => setQ("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <select value={productFilter} onChange={e => setProductFilter(e.target.value)}
            className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200">
            <option value="All">All Products</option>
            <option value="General">General</option>
            {products.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
            className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200">
            <option value="All">All Categories</option>
            {SCRIPT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {admin && (
            <label className="inline-flex items-center gap-2 text-sm text-slate-600 px-3 py-2.5 border border-slate-200 rounded-xl cursor-pointer select-none">
              <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} className="accent-blue-600 w-4 h-4" />
              Active only
            </label>
          )}
        </div>

        {/* Content */}
        {showSkeleton ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {Array.from({ length: 8 }, (_, i) => <CardSkeleton key={i} />)}
          </div>
        ) : visible.length === 0 ? (
          <div className="py-14 text-center text-sm text-slate-400">
            {scripts.length === 0
              ? admin ? "No scripts yet — click Add Script to build the knowledge base." : "No scripts available yet."
              : "No scripts match your search or filters."}
          </div>
        ) : groups ? (
          <div className="space-y-5">
            {groups.map(g => (
              <div key={g.product}>
                <div className="flex items-center gap-2 mb-2">
                  <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{g.product}</h2>
                  <span className="text-[11px] text-slate-400">({g.scripts.length})</span>
                  <div className="flex-1 border-t border-slate-100" />
                </div>
                {renderGrid(g.scripts)}
              </div>
            ))}
          </div>
        ) : (
          renderGrid(flat)
        )}
      </div>

      {/* Modals */}
      {viewing && (
        <ViewScriptModal script={viewing} onClose={() => setViewing(null)} onCopy={() => handleCopy(viewing)} />
      )}
      {editing && (
        <ScriptFormModal initial={editing.script} products={products}
          onClose={() => setEditing(null)} onSave={handleSave} />
      )}
      {deleting && (
        <Modal title="Delete Script" icon={Trash2} onClose={() => setDeleting(null)} width="max-w-md">
          <div className="px-6 py-4 text-sm text-slate-700">
            Delete <span className="font-semibold">{deleting.title}</span>? This cannot be undone.
            {deleting.active && <div className="mt-2 text-xs text-amber-600">Tip: deactivating hides it from agents without losing the script.</div>}
          </div>
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
            <button onClick={() => setDeleting(null)} className="px-4 py-2 rounded-xl text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
            <button onClick={handleDelete}
              className="px-5 py-2 rounded-xl text-sm font-semibold bg-red-600 text-white hover:bg-red-700 flex items-center gap-2">
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
