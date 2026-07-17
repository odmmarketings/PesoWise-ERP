"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Factory, Plus, Search, Pencil, X, ChevronLeft, ChevronRight, Check, Settings, Archive, ArchiveRestore, FolderOpen, List, Trash2,
} from "lucide-react"
import { useSuppliers, SUPPLIER_STATUSES, type Supplier, type NewSupplierInput, type SupplierStatus } from "@/lib/supplier-store"

const INP = "w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white focus:outline-none focus:border-blue-400"
const FINP = "w-full h-8 rounded-lg border border-slate-200 px-2 text-xs bg-white focus:outline-none focus:border-blue-400"

function FormRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[170px_1fr] items-start gap-3 py-2.5 border-b border-slate-100 last:border-0">
      <label className="text-sm text-slate-600 pt-2 text-right pr-2">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <div>{children}</div>
    </div>
  )
}

// Philippine provinces (+ Metro Manila) for the -- SELECT PROVINCE -- dropdown.
const PH_PROVINCES = [
  "Abra", "Agusan del Norte", "Agusan del Sur", "Aklan", "Albay", "Antique", "Apayao", "Aurora", "Basilan", "Bataan",
  "Batanes", "Batangas", "Benguet", "Biliran", "Bohol", "Bukidnon", "Bulacan", "Cagayan", "Camarines Norte", "Camarines Sur",
  "Camiguin", "Capiz", "Catanduanes", "Cavite", "Cebu", "Cotabato", "Davao de Oro", "Davao del Norte", "Davao del Sur",
  "Davao Occidental", "Davao Oriental", "Dinagat Islands", "Eastern Samar", "Guimaras", "Ifugao", "Ilocos Norte", "Ilocos Sur",
  "Iloilo", "Isabela", "Kalinga", "La Union", "Laguna", "Lanao del Norte", "Lanao del Sur", "Leyte", "Maguindanao del Norte",
  "Maguindanao del Sur", "Marinduque", "Masbate", "Metro Manila", "Misamis Occidental", "Misamis Oriental", "Mountain Province",
  "Negros Occidental", "Negros Oriental", "Northern Samar", "Nueva Ecija", "Nueva Vizcaya", "Occidental Mindoro",
  "Oriental Mindoro", "Palawan", "Pampanga", "Pangasinan", "Quezon", "Quirino", "Rizal", "Romblon", "Samar", "Sarangani",
  "Siquijor", "Sorsogon", "South Cotabato", "Southern Leyte", "Sultan Kudarat", "Sulu", "Surigao del Norte", "Surigao del Sur",
  "Tarlac", "Zambales", "Zamboanga del Norte", "Zamboanga del Sur", "Zamboanga Sibugay",
]

// Searchable dropdown that also accepts typed values (City / Brgy / Item pickers).
function ComboInput({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: string[]; placeholder: string }) {
  const [open, setOpen] = useState(false)
  const filtered = options.filter(o => o.toLowerCase().includes(value.toLowerCase()) && o !== value)
  return (
    <div className="relative">
      <input className={INP} value={value} placeholder={placeholder} spellCheck={false}
        onFocus={() => setOpen(true)}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && filtered.length > 0 && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-auto scrollbar-dark">
          {filtered.map(o => (
            <button key={o} type="button" className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50"
              onMouseDown={() => { onChange(o); setOpen(false) }}>{o}</button>
          ))}
        </div>
      )}
    </div>
  )
}

// Address cell with the reference's "… more" expander.
function AddressCell({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  if (!text) return <span className="text-slate-400">—</span>
  if (text.length <= 22 || open) return (
    <span>{text}{text.length > 22 && <button onClick={() => setOpen(false)} className="text-blue-600 hover:underline ml-1 text-xs">less</button>}</span>
  )
  return <span>{text.slice(0, 22)}… <button onClick={() => setOpen(true)} className="text-blue-600 hover:underline text-xs">more</button></span>
}

const EMPTY_FILTERS = { store: "", name: "", contact: "", address: "", province: "", city: "", brgy: "", person: "", personNo: "", status: "All" }

export default function SupplierPage() {
  const sup = useSuppliers()
  const [screen, setScreen] = useState<"list" | "add" | "edit" | "view">("list")
  const [active, setActive] = useState<Supplier | null>(null)
  const [confirmDel, setConfirmDel] = useState<Supplier | null>(null)
  const [archivedView, setArchivedView] = useState(false)
  const [toast, setToast] = useState("")
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500) }

  const [perPage, setPerPage] = useState(10)
  const [page, setPage] = useState(1)
  // Filter inputs apply on Search (matching the reference's explicit Search button).
  const [f, setF] = useState(EMPTY_FILTERS)
  const [applied, setApplied] = useState(EMPTY_FILTERS)
  const setFilter = (k: keyof typeof EMPTY_FILTERS, v: string) => setF(p => ({ ...p, [k]: v }))
  const applyFilters = () => { setApplied(f); setPage(1) }

  const inc = (v: string, q: string) => !q || v.toLowerCase().includes(q.toLowerCase())
  const filtered = useMemo(() => sup.suppliers.filter(s => {
    if (!!s.archived !== archivedView) return false
    return inc(s.store_name, applied.store) && inc(s.name, applied.name) && inc(s.contact, applied.contact)
      && inc(s.address, applied.address) && inc(s.province, applied.province) && inc(s.city, applied.city)
      && inc(s.brgy, applied.brgy) && inc(s.contact_person, applied.person) && inc(s.contact_person_no, applied.personNo)
      && (applied.status === "All" || s.status === applied.status)
  }), [sup.suppliers, archivedView, applied])

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage))
  const pageSafe = Math.min(page, totalPages)
  const paginated = filtered.slice((pageSafe - 1) * perPage, pageSafe * perPage)
  const showFrom = filtered.length === 0 ? 0 : (pageSafe - 1) * perPage + 1
  const showTo = Math.min(pageSafe * perPage, filtered.length)

  const toastEl = toast ? (
    <div className="fixed top-4 right-4 z-[70] bg-emerald-600 text-white text-sm rounded-xl px-5 py-3 shadow-lg flex items-center gap-2">
      <Check className="w-4 h-4" /> <div><p className="font-semibold">Success</p><p className="text-emerald-100">{toast}</p></div>
    </div>
  ) : null

  // City / Brgy / Item suggestions from already-registered suppliers.
  const cityOptions = Array.from(new Set(sup.suppliers.map(s => s.city).filter(Boolean))).sort()
  const brgyOptions = Array.from(new Set(sup.suppliers.map(s => s.brgy).filter(Boolean))).sort()
  const itemOptions = Array.from(new Set(sup.suppliers.flatMap(s => s.items).filter(Boolean))).sort()

  if (screen === "add" || (screen === "edit" && active))
    return <>{toastEl}<FormScreen mode={screen === "edit" ? "edit" : "add"} initial={screen === "edit" ? active! : undefined}
      cityOptions={cityOptions} brgyOptions={brgyOptions} itemOptions={itemOptions}
      onBack={() => setScreen("list")}
      onSave={(input) => {
        if (screen === "edit" && active) { sup.updateSupplier(active.id, input); flash("Supplier updated successfully") }
        else { sup.addSupplier(input); flash("Supplier added successfully") }
        setScreen("list")
      }} /></>

  if (screen === "view" && active)
    return <>{toastEl}<ViewScreen supplier={sup.suppliers.find(s => s.id === active.id) || active} onBack={() => setScreen("list")} onEdit={() => setScreen("edit")} /></>

  return (
    <div className="space-y-4 relative">
      {toastEl}

      {/* Header — Tools ▾ (Add New) · Archives/List toggle */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-4 mb-1 border-b border-slate-100">
        <div>
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2"><Factory className="w-5 h-5" /> SUPPLIER {archivedView && <span className="text-sm font-semibold text-amber-600">· ARCHIVES</span>}</h1>
          <p className="text-xs text-slate-400 mt-0.5">{filtered.length} record{filtered.length === 1 ? "" : "s"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => { setActive(null); setScreen("add") }}><Plus className="w-4 h-4" /> Add New</Button>
          <Button className="bg-teal-500 hover:bg-teal-600 text-white" onClick={() => { setArchivedView(v => !v); setPage(1) }}>
            {archivedView ? <><List className="w-4 h-4" /> List</> : <><FolderOpen className="w-4 h-4" /> Archives</>}
          </Button>
        </div>
      </div>

      {/* Records selector */}
      <label className="flex items-center gap-2 text-sm text-slate-500">
        <select className="h-9 rounded-lg border border-slate-300 px-3 text-sm bg-white" value={perPage} onChange={e => { setPerPage(parseInt(e.target.value)); setPage(1) }}>
          {[10, 30, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        records
      </label>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto scrollbar-dark">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left bg-slate-50">
                {["NO.", "SUPPLIER STORE NAME", "SUPPLIER NAME", "SUPPLIER CONTACT", "SUPPLIER ADDRESS", "PROVINCE", "CITY", "BRGY.", "CONTACT PERSON", "PERSON CONTACT NO.", "STATUS", "ACTIONS"].map(h => (
                  <th key={h} className="px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
              {/* Filter row — applies on Search */}
              <tr className="border-b border-slate-200 bg-white">
                <th className="px-4 py-2" />
                <th className="px-4 py-2"><input className={FINP} value={f.store} onChange={e => setFilter("store", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} /></th>
                <th className="px-4 py-2"><input className={FINP} value={f.name} onChange={e => setFilter("name", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} /></th>
                <th className="px-4 py-2"><input className={FINP} value={f.contact} onChange={e => setFilter("contact", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} /></th>
                <th className="px-4 py-2"><input className={FINP} value={f.address} onChange={e => setFilter("address", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} /></th>
                <th className="px-4 py-2"><input className={FINP} value={f.province} onChange={e => setFilter("province", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} /></th>
                <th className="px-4 py-2"><input className={FINP} value={f.city} onChange={e => setFilter("city", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} /></th>
                <th className="px-4 py-2"><input className={FINP} value={f.brgy} onChange={e => setFilter("brgy", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} /></th>
                <th className="px-4 py-2"><input className={FINP} value={f.person} onChange={e => setFilter("person", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} /></th>
                <th className="px-4 py-2"><input className={FINP} value={f.personNo} onChange={e => setFilter("personNo", e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} /></th>
                <th className="px-4 py-2">
                  <select className={FINP} value={f.status} onChange={e => setFilter("status", e.target.value)}>
                    <option value="All">All</option>
                    {SUPPLIER_STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </th>
                <th className="px-4 py-2">
                  <Button className="h-8 px-3 bg-blue-600 hover:bg-blue-700 text-white text-xs" onClick={applyFilters}><Search className="w-3.5 h-3.5" /> Search</Button>
                </th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr><td colSpan={12} className="text-center py-12 text-slate-400 text-sm">
                  {archivedView ? "No archived suppliers." : sup.suppliers.length === 0 ? <>No suppliers yet. Click <strong>Tools → Add New</strong> to add one.</> : "No suppliers match the filters."}
                </td></tr>
              ) : paginated.map((s, i) => (
                <tr key={s.id} className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50"} hover:bg-blue-50/40`}>
                  <td className="px-4 py-3 text-slate-400">{showFrom + i}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800">{s.store_name || "—"}</td>
                  <td className="px-4 py-3 text-slate-700">{s.name || "—"}</td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{s.contact || "—"}</td>
                  <td className="px-4 py-3 text-slate-600 max-w-[220px]"><AddressCell text={s.address} /></td>
                  <td className="px-4 py-3 text-slate-600">{s.province || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{s.city || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{s.brgy || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{s.contact_person || "—"}</td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{s.contact_person_no || "—"}</td>
                  <td className="px-4 py-3"><span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${s.status === "Active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{s.status}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 text-slate-400">
                      <button onClick={() => { setActive(s); setScreen("view") }} className="hover:text-blue-600" title="View"><Search className="w-4 h-4" /></button>
                      <button onClick={() => { setActive(s); setScreen("edit") }} className="hover:text-teal-600" title="Edit"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => setConfirmDel(s)} className="hover:text-rose-600" title="Delete"><X className="w-4 h-4" /></button>
                      <button onClick={() => { sup.setArchived(s.id, !s.archived); flash(s.archived ? "Supplier restored." : "Supplier archived.") }} className="hover:text-amber-600" title={s.archived ? "Restore" : "Archive"}>
                        {s.archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Footer — entries + pagination */}
        <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm text-slate-500">Showing {showFrom} to {showTo} of {filtered.length} entr{filtered.length === 1 ? "y" : "ies"}</span>
          <div className="flex items-center gap-1">
            <button disabled={pageSafe <= 1} onClick={() => setPage(p => p - 1)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
            <span className="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-600 text-white text-sm font-medium">{pageSafe}</span>
            <button disabled={pageSafe >= totalPages} onClick={() => setPage(p => p + 1)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setConfirmDel(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[400px] p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-800">Delete supplier?</h2>
            <p className="text-sm text-slate-600">This permanently removes <strong>{confirmDel.store_name || confirmDel.name}</strong>. This cannot be undone.</p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setConfirmDel(null)}>Cancel</Button>
              <Button className="bg-rose-600 hover:bg-rose-700 text-white" onClick={() => { sup.deleteSupplier(confirmDel.id); flash("Supplier deleted."); setConfirmDel(null) }}>Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Add / Edit (LHIKE "Add Supplier" layout) ─────────────────────────────────
function FormScreen({ mode, initial, cityOptions, brgyOptions, itemOptions, onBack, onSave }: {
  mode: "add" | "edit"; initial?: Supplier
  cityOptions: string[]; brgyOptions: string[]; itemOptions: string[]
  onBack: () => void; onSave: (input: NewSupplierInput) => void
}) {
  const [f, setF] = useState<NewSupplierInput>({
    store_name: initial?.store_name || "", name: initial?.name || "", contact: initial?.contact || "",
    contact_person: initial?.contact_person || "", contact_person_no: initial?.contact_person_no || "",
    url: initial?.url || "", address: initial?.address || "",
    province: initial?.province || "", city: initial?.city || "", brgy: initial?.brgy || "",
    items: initial?.items?.length ? [...initial.items] : [""],
    status: initial?.status || "Active", remarks: initial?.remarks || "",
  })
  const [err, setErr] = useState("")
  const set = (k: keyof NewSupplierInput, v: any) => setF(p => ({ ...p, [k]: v }))
  const setItem = (idx: number, v: string) => setF(p => ({ ...p, items: p.items.map((it, i) => i === idx ? v : it) }))

  // ── PH geo cascade (PSGC via /api/ph-geo): Province → Cities → Barangays ──
  type GeoEntry = { code: string; name: string }
  const [provs, setProvs] = useState<GeoEntry[]>([])
  const [cities, setCities] = useState<GeoEntry[]>([])
  const [brgys, setBrgys] = useState<GeoEntry[]>([])
  const [provCode, setProvCode] = useState("")
  const [cityCode, setCityCode] = useState("")
  const [geoFail, setGeoFail] = useState(false)
  const [loadingCities, setLoadingCities] = useState(false)
  const [loadingBrgys, setLoadingBrgys] = useState(false)
  const resolvedInit = useRef(false)   // edit mode: resolve saved names → codes once

  const geoFetch = async (qs: string): Promise<GeoEntry[]> => {
    const j = await fetch(`/api/ph-geo?${qs}`).then(r => r.json())
    if (!j.success) throw new Error(j.error)
    return j.data
  }
  useEffect(() => {
    let alive = true
    geoFetch("level=provinces")
      .then(d => {
        if (!alive) return
        setProvs(d)
        // Edit mode: match the saved province name to its code so the cascade continues.
        if (!resolvedInit.current && initial?.province) {
          const m = d.find(p => p.name.toLowerCase() === initial.province.toLowerCase())
          if (m) setProvCode(m.code)
        }
      })
      .catch(() => alive && setGeoFail(true))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!provCode) { setCities([]); return }
    let alive = true
    setLoadingCities(true)
    geoFetch(`level=cities&code=${encodeURIComponent(provCode)}`)
      .then(d => {
        if (!alive) return
        setCities(d)
        if (!resolvedInit.current && initial?.city) {
          const m = d.find(c => c.name.toLowerCase() === initial.city.toLowerCase())
          if (m) setCityCode(m.code)
          resolvedInit.current = true
        }
      })
      .catch(() => alive && setGeoFail(true))
      .finally(() => alive && setLoadingCities(false))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provCode])
  useEffect(() => {
    if (!cityCode) { setBrgys([]); return }
    let alive = true
    setLoadingBrgys(true)
    geoFetch(`level=barangays&code=${encodeURIComponent(cityCode)}`)
      .then(d => { if (alive) setBrgys(d) })
      .catch(() => alive && setGeoFail(true))
      .finally(() => alive && setLoadingBrgys(false))
    return () => { alive = false }
  }, [cityCode])

  const pickProvince = (code: string) => {
    const name = provs.find(p => p.code === code)?.name || ""
    setProvCode(code); setCityCode("")
    setF(p => ({ ...p, province: name, city: "", brgy: "" }))
  }
  const pickCity = (code: string) => {
    const name = cities.find(c => c.code === code)?.name || ""
    setCityCode(code)
    setF(p => ({ ...p, city: name, brgy: "" }))
  }
  const addItem = () => setF(p => ({ ...p, items: [...p.items, ""] }))
  const removeItem = (idx: number) => setF(p => ({ ...p, items: p.items.length > 1 ? p.items.filter((_, i) => i !== idx) : p.items }))

  function submit() {
    if (!f.store_name.trim()) return setErr("Supplier Store Name is required.")
    if (!f.name.trim()) return setErr("Supplier Name is required.")
    if (!f.contact.trim()) return setErr("Supplier Contact No is required.")
    if (!f.contact_person.trim()) return setErr("Contact Person is required.")
    if (!f.contact_person_no.trim()) return setErr("Contact No. of Person is required.")
    if (!f.address.trim()) return setErr("Address is required.")
    if (!f.province) return setErr("Province is required.")
    if (!f.city.trim()) return setErr("City is required.")
    if (!f.brgy.trim()) return setErr("Brgy is required.")
    if (!f.items.some(i => i.trim())) return setErr("Add at least one Item.")
    setErr("")
    onSave({
      ...f, store_name: f.store_name.trim(), name: f.name.trim(), contact: f.contact.trim(),
      contact_person: f.contact_person.trim(), contact_person_no: f.contact_person_no.trim(),
      url: f.url.trim(), address: f.address.trim(), city: f.city.trim(), brgy: f.brgy.trim(),
      items: f.items.map(i => i.trim()).filter(Boolean),
    })
  }

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft className="w-4 h-4" /> Back to Suppliers</button>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-3xl">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 pb-4 mb-2 border-b border-slate-100"><Settings className="w-5 h-5" /> {mode === "add" ? "ADD SUPPLIER" : "EDIT SUPPLIER"}</h1>
        <div className="space-y-0.5">
          <FormRow label="Supplier Store Name" required><Input className={INP} value={f.store_name} onChange={e => set("store_name", e.target.value)} /></FormRow>
          <FormRow label="Supplier Name" required><Input className={INP} value={f.name} onChange={e => set("name", e.target.value)} /></FormRow>
          <FormRow label="Supplier Contact No" required><Input className={INP} value={f.contact} onChange={e => set("contact", e.target.value)} /></FormRow>
          <FormRow label="Contact Person" required><Input className={INP} value={f.contact_person} onChange={e => set("contact_person", e.target.value)} /></FormRow>
          <FormRow label="Contact No. of Person" required><Input className={INP} value={f.contact_person_no} onChange={e => set("contact_person_no", e.target.value)} /></FormRow>
          <FormRow label="Supplier URL"><Input className={INP} value={f.url} onChange={e => set("url", e.target.value)} placeholder="https://example.com" /></FormRow>
          <FormRow label="Address" required><Input className={INP} value={f.address} onChange={e => set("address", e.target.value)} /></FormRow>
          {geoFail ? (
            <>
              {/* PSGC unreachable → free-text fallback with suggestions */}
              <FormRow label="Province" required>
                <select className={INP} value={f.province} onChange={e => set("province", e.target.value)}>
                  <option value="">-- SELECT PROVINCE --</option>
                  {PH_PROVINCES.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
                </select>
              </FormRow>
              <FormRow label="City" required><ComboInput value={f.city} onChange={v => set("city", v)} options={cityOptions} placeholder="-- SELECT CITY --" /></FormRow>
              <FormRow label="Brgy" required><ComboInput value={f.brgy} onChange={v => set("brgy", v)} options={brgyOptions} placeholder="-- SELECT BRGY --" /></FormRow>
            </>
          ) : (
            <>
              {/* PSGC cascade: pick a province → its cities load; pick a city → its barangays load */}
              <FormRow label="Province" required>
                <select className={INP} value={provCode} onChange={e => pickProvince(e.target.value)}>
                  <option value="">{provs.length === 0 ? "Loading provinces…" : "-- SELECT PROVINCE --"}</option>
                  {provs.map(p => <option key={p.code} value={p.code}>{p.name.toUpperCase()}</option>)}
                </select>
              </FormRow>
              <FormRow label="City" required>
                <select className={INP} value={cityCode} onChange={e => pickCity(e.target.value)} disabled={!provCode || loadingCities}>
                  <option value="">{!provCode ? "-- SELECT PROVINCE FIRST --" : loadingCities ? "Loading cities…" : "-- SELECT CITY --"}</option>
                  {cities.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
              </FormRow>
              <FormRow label="Brgy" required>
                <select className={INP} value={f.brgy} onChange={e => set("brgy", e.target.value)} disabled={!cityCode || loadingBrgys}>
                  <option value="">{!cityCode ? "-- SELECT CITY FIRST --" : loadingBrgys ? "Loading barangays…" : "-- SELECT BRGY --"}</option>
                  {brgys.map(b => <option key={b.code} value={b.name}>{b.name}</option>)}
                </select>
              </FormRow>
            </>
          )}
          <FormRow label="Item" required>
            <div className="space-y-2">
              {f.items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_32px_40px] gap-1.5 items-center">
                  <ComboInput value={it} onChange={v => setItem(idx, v)} options={itemOptions} placeholder="-- SELECT ITEM --" />
                  <button type="button" onClick={() => removeItem(idx)} disabled={f.items.length <= 1} title="Remove item"
                    className="w-8 h-8 flex items-center justify-center rounded text-slate-300 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30"><Trash2 className="w-3.5 h-3.5" /></button>
                  {idx === f.items.length - 1
                    ? <button type="button" onClick={addItem} title="Add item"
                        className="w-9 h-9 rounded-full bg-slate-900 hover:bg-slate-800 text-white flex items-center justify-center"><Plus className="w-4 h-4" /></button>
                    : <span />}
                </div>
              ))}
            </div>
          </FormRow>
          {mode === "edit" && (
            <FormRow label="Status">
              <select className={INP} value={f.status} onChange={e => set("status", e.target.value as SupplierStatus)}>
                {SUPPLIER_STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </FormRow>
          )}
          <FormRow label="Remarks"><textarea className={`${INP} h-24 py-2 resize-y`} value={f.remarks} onChange={e => set("remarks", e.target.value)} /></FormRow>
        </div>
        {err && <p className="text-sm text-rose-600 mt-3">{err}</p>}
        <div className="flex gap-2 mt-5 pt-4 border-t border-slate-100">
          <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={submit}>Submit</Button>
          <Button variant="outline" onClick={onBack}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}

// ── View ─────────────────────────────────────────────────────────────────────
function ViewScreen({ supplier, onBack, onEdit }: { supplier: Supplier; onBack: () => void; onEdit: () => void }) {
  const F = ({ l, v }: { l: string; v: React.ReactNode }) => (
    <div className="grid grid-cols-[170px_1fr] gap-3 py-2.5 border-b border-slate-100">
      <span className="text-sm text-slate-500 text-right pr-2">{l}</span><span className="text-sm text-slate-800">{v || "—"}</span>
    </div>
  )
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft className="w-4 h-4" /> Back to Suppliers</button>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-3xl">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 mb-4"><Factory className="w-5 h-5" /> VIEW SUPPLIER</h1>
        <F l="Supplier Store Name" v={supplier.store_name} /><F l="Supplier Name" v={supplier.name} />
        <F l="Supplier Contact" v={supplier.contact} /><F l="Supplier Address" v={supplier.address} />
        <F l="Province" v={supplier.province} /><F l="City" v={supplier.city} /><F l="Brgy." v={supplier.brgy} />
        <F l="Contact Person" v={supplier.contact_person} /><F l="Person Contact No." v={supplier.contact_person_no} />
        <F l="Supplier URL" v={supplier.url ? <a href={supplier.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{supplier.url}</a> : ""} />
        <F l="Items" v={supplier.items.length ? supplier.items.join(", ") : ""} />
        <F l="Status" v={<span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${supplier.status === "Active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{supplier.status}</span>} />
        <F l="Remarks" v={supplier.remarks} />
        <div className="flex gap-2 mt-4">
          <Button className="bg-teal-500 hover:bg-teal-600 text-white" onClick={onEdit}><Pencil className="w-3.5 h-3.5" /> Edit</Button>
          <Button variant="outline" onClick={onBack}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}
