"use client"
import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatDate } from "@/lib/utils"
import { Search, Eye, Pencil, X, FolderOpen, ChevronDown, Plus, Upload, Settings, Archive, ChevronLeft, Check, Settings2, Info, Store } from "lucide-react"

import { type PageStore, type PageStatus as Status, type Platform } from "@/lib/pages-data"
import { usePages } from "@/lib/pages-store"
import { OwnerCombo } from "@/components/business/OwnerCombo"

const STATUS_COLORS: Record<Status, string> = {
  active: "bg-green-100 text-green-700",
  inactive: "bg-slate-100 text-slate-500",
  "in-review": "bg-amber-100 text-amber-700",
  restricted: "bg-red-100 text-red-700",
  permanently_disabled: "bg-red-200 text-red-800",
}

const PLATFORM_COLORS: Record<Platform, string> = {
  "Facebook Ecom": "bg-blue-100 text-blue-700",
  Instagram: "bg-pink-100 text-pink-700",
  TikTok: "bg-slate-100 text-slate-700",
  Shopee: "bg-orange-100 text-orange-700",
  Lazada: "bg-purple-100 text-purple-700",
}

function mask(val: string) {
  return val ? "•".repeat(Math.min(val.length, 20)) : "—"
}

function ViewScreen({ page, onBack, onEdit }: { page: PageStore; onBack: () => void; onEdit: () => void }) {
  const [showSettings, setShowSettings] = useState(false)

  return (
    <div className="w-full space-y-0">
      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <Settings2 className="w-5 h-5 text-slate-500" />
        <h1 className="text-lg font-bold text-slate-800 uppercase tracking-wide">View Page / Store</h1>
      </div>

      {/* Form-style read-only fields */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {/* Name */}
        <div className="flex items-start gap-4 px-6 py-4 border-b border-slate-100">
          <label className="text-sm text-slate-600 w-44 pt-2 flex-shrink-0">Name <span className="text-red-500">*</span></label>
          <div className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800">{page.name}</div>
        </div>
        {/* Description */}
        <div className="flex items-start gap-4 px-6 py-4 border-b border-slate-100">
          <label className="text-sm text-slate-600 w-44 pt-2 flex-shrink-0">Description <span className="text-red-500">*</span></label>
          <div className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 min-h-[80px]">{page.description || "—"}</div>
        </div>
        {/* Owner */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-100">
          <label className="text-sm text-slate-600 w-44 flex-shrink-0">Owner <span className="text-red-500">*</span></label>
          <div className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800">{page.owner}</div>
        </div>
        {/* Platform */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-100">
          <label className="text-sm text-slate-600 w-44 flex-shrink-0">Platform <span className="text-red-500">*</span></label>
          <div className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800">{page.platform}</div>
        </div>
        {/* Page URL */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-100">
          <label className="text-sm text-slate-600 w-44 flex-shrink-0">Page URL</label>
          <a href={page.page_url} target="_blank" rel="noopener noreferrer"
            className="flex-1 text-sm text-blue-600 hover:underline break-all">{page.page_url || "—"}</a>
        </div>

        {/* Pancake section header */}
        <div className="flex items-center justify-end gap-2 px-6 py-3 bg-slate-50 border-b border-slate-200">
          <span className="text-xs font-bold text-slate-600 uppercase tracking-widest">Pancake Set Up</span>
          <a href="#" className="text-xs text-blue-500 hover:underline flex items-center gap-1">
            Get Info <Info className="w-3 h-3" />
          </a>
        </div>

        {/* Show Settings toggle */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-100">
          <label className="text-sm text-slate-600 w-44 flex-shrink-0"></label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={showSettings} onChange={e => setShowSettings(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 accent-blue-600" />
            <span className="text-sm text-slate-600">Show Settings</span>
          </label>
        </div>

        {/* Pancake Shop ID */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-100">
          <label className="text-sm text-slate-600 w-44 flex-shrink-0">Pancake Shop ID</label>
          <div className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono text-slate-800">
            {showSettings ? page.shop_id || "—" : mask(page.shop_id)}
          </div>
        </div>
        {/* API Key */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-100">
          <label className="text-sm text-slate-600 w-44 flex-shrink-0">API Key</label>
          <div className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono text-slate-800">
            {showSettings ? page.api_key || "—" : mask(page.api_key)}
          </div>
        </div>
        {/* Pancake Page ID */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-100">
          <label className="text-sm text-slate-600 w-44 flex-shrink-0 leading-tight">
            Pancake Page ID <span className="font-normal italic text-slate-400 text-xs">for combine shop</span>
          </label>
          <div className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono text-slate-800">
            {showSettings ? page.pancake_page_id || "—" : mask(page.pancake_page_id)}
          </div>
        </div>
        {/* Sender Name */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-100">
          <label className="text-sm text-slate-600 w-44 flex-shrink-0">Sender Name</label>
          <div className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800">{page.sender_name || "—"}</div>
        </div>

        {/* Status */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-100">
          <label className="text-sm text-slate-600 w-44 flex-shrink-0"></label>
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-semibold text-amber-600 capitalize">{page.status}</span>
          </div>
        </div>

        {/* Created info */}
        <div className="flex items-start gap-4 px-6 py-4">
          <label className="text-sm text-slate-600 w-44 flex-shrink-0"></label>
          <div className="flex-1 bg-teal-50 border-l-4 border-teal-400 rounded-r-lg px-4 py-3 text-sm space-y-0.5">
            <p className="text-slate-700"><span className="font-semibold">Created By:</span> {page.created_by}</p>
            <p className="text-slate-700"><span className="font-semibold">Created Date:</span> {page.created_at}</p>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-3 pt-6">
        <Button variant="outline" size="sm" onClick={onEdit} className="flex items-center gap-1.5">
          <Pencil className="w-3.5 h-3.5" /> Edit Page
        </Button>
        <Button variant="outline" size="sm" onClick={onBack}>Cancel</Button>
      </div>
    </div>
  )
}

function EditScreen({ page, owners, onBack, onSave }: { page: PageStore | null; owners: string[]; onBack: () => void; onSave: (p: Partial<PageStore>) => void }) {
  const [form, setForm] = useState<Partial<PageStore>>(page || { status: "active", platform: "Facebook Ecom" })
  const [showPancake, setShowPancake] = useState(false)
  const [loading, setLoading] = useState(false)
  const isNew = !page

  function set(key: string, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function handleSave() {
    setLoading(true)
    setTimeout(() => {
      onSave(form)
      setLoading(false)
      onBack()
    }, 1500)
  }

  return (
    <div className="w-full space-y-0 relative">
      {/* Loading overlay */}
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/60">
          <div className="flex flex-col items-center gap-4">
            <div className="relative w-16 h-16">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="absolute w-3 h-3 rounded-full bg-blue-500"
                  style={{
                    top: `${50 - 38 * Math.cos((i * Math.PI * 2) / 8)}%`,
                    left: `${50 + 38 * Math.sin((i * Math.PI * 2) / 8)}%`,
                    transform: "translate(-50%,-50%)",
                    opacity: (i + 1) / 8,
                    animation: `spin-dot 0.8s linear infinite`,
                    animationDelay: `${(i * 0.8) / 8}s`,
                  }}
                />
              ))}
            </div>
            <p className="text-sm text-slate-500 font-medium">Saving page...</p>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Settings2 className="w-5 h-5 text-slate-500" />
          <h1 className="text-lg font-bold text-slate-800 uppercase tracking-wide">
            {isNew ? "Add New Page / Store" : "Edit Page / Store"}
          </h1>
        </div>
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {/* Name */}
        <div className="flex items-start gap-4 px-6 py-4 border-b border-slate-100">
          <label className="text-sm text-slate-600 w-44 pt-2 flex-shrink-0">Name <span className="text-red-500">*</span></label>
          <Input className="flex-1 max-w-xl" placeholder="Page / Store name" value={(form as any).name || ""}
            onChange={e => set("name", e.target.value)} />
        </div>
        {/* Description */}
        <div className="flex items-start gap-4 px-6 py-4 border-b border-slate-100">
          <label className="text-sm text-slate-600 w-44 pt-2 flex-shrink-0">Description <span className="text-red-500">*</span></label>
          <textarea className="flex-1 max-w-xl min-h-[80px] rounded-lg border border-slate-300 px-3 py-2 text-sm resize-y focus:outline-none focus:border-blue-400"
            placeholder="Description" value={(form as any).description || ""}
            onChange={e => set("description", e.target.value)} />
        </div>
        {/* Owner — dropdown ng existing owners + User Management roster (pwede pa ring mag-type ng bago) */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-100">
          <label className="text-sm text-slate-600 w-44 flex-shrink-0">Owner <span className="text-red-500">*</span></label>
          <div className="flex-1 max-w-xl">
            <OwnerCombo value={(form as any).owner || ""} onChange={v => set("owner", v)} options={owners} placeholder="Owner name" />
          </div>
        </div>
        {/* Status — radio buttons */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-100">
          <label className="text-sm text-slate-600 w-44 flex-shrink-0"></label>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {([
              { val: "inactive", label: "Inactive", color: "text-blue-600" },
              { val: "active", label: "Active", color: "text-green-600" },
              { val: "in-review", label: "In-review", color: "text-blue-500" },
              { val: "restricted", label: "Restricted", color: "text-red-500" },
              { val: "permanently_disabled", label: "Permanently Disabled", color: "text-red-600 font-bold" },
            ] as { val: Status; label: string; color: string }[]).map(({ val, label, color }) => (
              <label key={val} className="flex items-center gap-1.5 cursor-pointer select-none whitespace-nowrap">
                <input type="radio" name="status" value={val} checked={form.status === val}
                  onChange={() => set("status", val)} className="accent-blue-600 w-4 h-4 flex-shrink-0" />
                <span className={`text-sm whitespace-nowrap ${color}`}>{label}</span>
              </label>
            ))}
          </div>
        </div>
        {/* Platform */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-100">
          <label className="text-sm text-slate-600 w-44 flex-shrink-0">Platform <span className="text-red-500">*</span></label>
          <select className="flex-1 max-w-xl h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white"
            value={form.platform} onChange={e => set("platform", e.target.value)}>
            {["Facebook Ecom", "Instagram", "TikTok", "Shopee", "Lazada"].map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
        {/* Page URL */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-100">
          <label className="text-sm text-slate-600 w-44 flex-shrink-0">Page URL</label>
          <Input className="flex-1 max-w-xl" placeholder="https://..." value={(form as any).page_url || ""}
            onChange={e => set("page_url", e.target.value)} />
        </div>

        {/* Pancake section header */}
        <div className="flex items-center justify-end gap-2 px-6 py-3 bg-slate-50 border-b border-slate-200">
          <span className="text-xs font-bold text-slate-600 uppercase tracking-widest">Pancake Set Up</span>
          <a href="#" className="text-xs text-blue-500 hover:underline flex items-center gap-1">
            Get Info <Info className="w-3 h-3" />
          </a>
        </div>

        {/* Show Settings toggle */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-100">
          <label className="text-sm text-slate-600 w-44 flex-shrink-0"></label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={showPancake} onChange={e => setShowPancake(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 accent-blue-600" />
            <span className="text-sm text-slate-600">Show Settings</span>
          </label>
        </div>
        {/* Pancake Shop ID */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-100">
          <label className="text-sm text-slate-600 w-44 flex-shrink-0">Pancake Shop ID</label>
          <Input className="flex-1 max-w-xl font-mono text-sm" type={showPancake ? "text" : "password"}
            placeholder="Shop ID" value={(form as any).shop_id || ""}
            onChange={e => set("shop_id", e.target.value)} />
        </div>
        {/* API Key */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-100">
          <label className="text-sm text-slate-600 w-44 flex-shrink-0">API Key</label>
          <Input className="flex-1 max-w-xl font-mono text-sm" type={showPancake ? "text" : "password"}
            placeholder="API Key" value={(form as any).api_key || ""}
            onChange={e => set("api_key", e.target.value)} />
        </div>
        {/* Pancake Page ID */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-100">
          <label className="text-sm text-slate-600 w-44 flex-shrink-0 leading-tight">
            Pancake Page ID <span className="font-normal italic text-slate-400 text-xs">for combine shop</span>
          </label>
          <Input className="flex-1 max-w-xl font-mono text-sm" type={showPancake ? "text" : "password"}
            placeholder="Pancake Page ID" value={(form as any).pancake_page_id || ""}
            onChange={e => set("pancake_page_id", e.target.value)} />
        </div>
        {/* Sender Name */}
        <div className="flex items-center gap-4 px-6 py-4">
          <label className="text-sm text-slate-600 w-44 flex-shrink-0">Sender Name</label>
          <Input className="flex-1 max-w-xl" placeholder="Sender Name" value={(form as any).sender_name || ""}
            onChange={e => set("sender_name", e.target.value)} />
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-3 pt-6 pl-48">
        <Button size="sm" onClick={handleSave} disabled={loading} className="px-6 bg-green-600 hover:bg-green-700 text-white">
          {isNew ? "Submit" : "Submit"}
        </Button>
        <Button variant="outline" size="sm" onClick={onBack} disabled={loading} className="px-6">Cancel</Button>
      </div>
    </div>
  )
}

function ConfirmModal({ message, onConfirm, onClose }: { message: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl p-6 text-center">
        <p className="text-slate-700 mb-6">{message}</p>
        <div className="flex gap-3">
          <Button className="flex-1" onClick={() => { onConfirm(); onClose() }}>Yes</Button>
          <Button variant="outline" className="flex-1" onClick={onClose}>No</Button>
        </div>
      </div>
    </div>
  )
}

export default function PagesStorePage() {
  const { pages, addPage, updatePage, deletePage, archivePage } = usePages()
  const [tab, setTab] = useState<"active" | "archives">("active")
  const [searchName, setSearchName] = useState("")
  const [searchOwner, setSearchOwner] = useState("")

  // Owner dropdown options: distinct EXISTING page owners only (not the user roster).
  const ownerOptions = useMemo(() => Array.from(new Set(pages.map(p => p.owner).filter(Boolean))).sort(), [pages])
  const [filterStatus, setFilterStatus] = useState("All")
  const [filterPlatform, setFilterPlatform] = useState("All")
  const [screen, setScreen] = useState<{ mode: "view" | "edit"; page: PageStore } | { mode: "new" } | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ message: string; onConfirm: () => void } | null>(null)
  const [showTools, setShowTools] = useState(false)
  const [successName, setSuccessName] = useState<string | null>(null)
  const [showToast, setShowToast] = useState(false)

  const filtered = useMemo(() => pages.filter(p => {
    const archived = tab === "archives"
    if (archived !== !!p.archived_at) return false
    if (searchName && !p.name.toLowerCase().includes(searchName.toLowerCase())) return false
    if (searchOwner && !p.owner.toLowerCase().includes(searchOwner.toLowerCase())) return false
    if (filterStatus !== "All" && p.status !== filterStatus) return false
    if (filterPlatform !== "All" && p.platform !== filterPlatform) return false
    return true
  }), [pages, tab, searchName, searchOwner, filterStatus, filterPlatform])

  function handleDelete(id: string) {
    setConfirmAction({ message: "Are you sure you want to delete this page?", onConfirm: () => deletePage(id) })
  }
  function handleArchive(id: string) {
    setConfirmAction({ message: "Move this page to archive?", onConfirm: () => archivePage(id) })
  }
  function handleSave(data: Partial<PageStore>) {
    if (screen?.mode === "new") {
      addPage(data as Omit<PageStore, "id" | "created_at" | "archived_at" | "created_by">)
      setSuccessName(data.name || "New Page")
      setShowToast(true)
      setTimeout(() => setShowToast(false), 6000)
    } else if (screen?.mode === "edit") {
      updatePage((screen as any).page.id, data)
      setSuccessName(data.name || "Page")
      setShowToast(true)
      setTimeout(() => setShowToast(false), 6000)
    }
  }

  if (screen?.mode === "view") {
    return <ViewScreen page={screen.page} onBack={() => setScreen(null)} onEdit={() => setScreen({ mode: "edit", page: screen.page })} />
  }
  if (screen?.mode === "edit") {
    return <EditScreen page={screen.page} owners={ownerOptions} onBack={() => setScreen(null)} onSave={handleSave} />
  }
  if (screen?.mode === "new") {
    return <EditScreen page={null} owners={ownerOptions} onBack={() => setScreen(null)} onSave={handleSave} />
  }

  return (
    <div className="space-y-5 w-full">
      {confirmAction && <ConfirmModal message={confirmAction.message} onConfirm={confirmAction.onConfirm} onClose={() => setConfirmAction(null)} />}

      {/* Toast (top-right) */}
      {showToast && successName && (
        <div className="fixed top-5 right-5 z-50 w-80 bg-teal-500 text-white rounded-xl shadow-2xl p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-3">
              <Check className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <div className="text-sm space-y-0.5">
                <p className="font-bold">Success!</p>
                <p>&ldquo;{successName}&rdquo; has been saved successfully.</p>
                <p className="text-xs text-teal-100 mt-1">It is now available across ROAS Tracker, Sales Tracker, and Adspent Summary.</p>
              </div>
            </div>
            <button onClick={() => setShowToast(false)} className="flex-shrink-0 opacity-80 hover:opacity-100">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Success banner (inline) */}
      {successName && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 relative">
          <button onClick={() => setSuccessName(null)} className="absolute top-3 right-3 text-green-400 hover:text-green-600">
            <X className="w-4 h-4" />
          </button>
          <p className="text-green-700 font-bold text-base mb-1">Success!</p>
          <p className="text-green-700 text-sm">&ldquo;{successName}&rdquo; has been saved and is now connected to all modules.</p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between pb-4 mb-1 border-b border-slate-100">
        <div>
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2">
            <Store className="w-5 h-5" /> PAGES &amp; STORE
          </h1>
          <p className="text-slate-500 text-sm">{filtered.length} records</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setTab(tab === "active" ? "archives" : "active")}>
            {tab === "active" ? <><Archive className="w-3.5 h-3.5" /> Archives</> : "Active"}
          </Button>
          <div className="relative">
            <Button variant="outline" size="sm" onClick={() => setShowTools(s => !s)}>
              Tools <ChevronDown className="w-3.5 h-3.5" />
            </Button>
            {showTools && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowTools(false)} />
                <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-20 w-56 py-1">
                  <button onClick={() => { setScreen({ mode: "new" }); setShowTools(false) }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 text-slate-700">
                    <Plus className="w-4 h-4 text-green-500" /> Add New Page / Store
                  </button>
                  <button onClick={() => setShowTools(false)} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 text-slate-700">
                    <Upload className="w-4 h-4 text-blue-500" /> Upload Pages / Stores (Excel)
                  </button>
                  <button onClick={() => setShowTools(false)} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 text-slate-700">
                    <Settings className="w-4 h-4 text-slate-500" /> Platform Management
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search page name..." value={searchName} onChange={e => setSearchName(e.target.value)} />
          </div>
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search owner..." value={searchOwner} onChange={e => setSearchOwner(e.target.value)} />
          </div>
          <select className="h-10 rounded-lg border border-slate-200 px-3 text-sm bg-white"
            value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="All">All Status</option>
            {["active", "inactive", "in-review", "restricted", "permanently_disabled"].map(s => <option key={s}>{s}</option>)}
          </select>
          <select className="h-10 rounded-lg border border-slate-200 px-3 text-sm bg-white"
            value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)}>
            <option value="All">All Platforms</option>
            {["Facebook Ecom", "Instagram", "TikTok", "Shopee", "Lazada"].map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {["No.", "Date Created", "Name", "Owner", "Status", "Platform", "Actions"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-400">No pages found</td></tr>
              ) : filtered.map((page, i) => (
                <tr key={page.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-500">{i + 1}</td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{formatDate(page.created_at)}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{page.name}</td>
                  <td className="px-4 py-3 text-slate-600">{page.owner}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[page.status]}`}>{page.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${PLATFORM_COLORS[page.platform]}`}>{page.platform}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => setScreen({ mode: "view", page })} title="View" className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600"><Eye className="w-4 h-4" /></button>
                      <button onClick={() => setScreen({ mode: "edit", page })} title="Edit" className="p-1.5 rounded-lg hover:bg-amber-50 text-slate-400 hover:text-amber-600"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => handleDelete(page.id)} title="Delete" className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600"><X className="w-4 h-4" /></button>
                      <button onClick={() => handleArchive(page.id)} title="Archive" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"><FolderOpen className="w-4 h-4" /></button>
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
