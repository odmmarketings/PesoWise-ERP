"use client"
import { useState, useMemo, useRef } from "react"
import * as XLSX from "xlsx-js-style"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Shield, Search, Pencil, X, ChevronLeft, ChevronDown, Settings, Upload, Download,
} from "lucide-react"
import {
  useBMAccounts, BM_STATUSES,
  type BMAccount, type NewBMInput, type BMStatus,
} from "@/lib/bm-store"

// ── Style helpers ─────────────────────────────────────────────────────────────
const INP = "w-full h-10 rounded-lg border border-slate-300 px-3 text-sm bg-white focus:outline-none focus:border-blue-400"
const FINP = "h-8 w-full rounded border border-slate-300 px-1.5 text-xs bg-white focus:outline-none focus:border-blue-400"
const TA = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-400 resize-none"
const RO = "bg-slate-100 text-slate-600 cursor-default"

const STATUS_TEXT: Record<BMStatus, string> = {
  Active: "text-blue-600",
  Inactive: "text-slate-500",
  "In-review": "text-amber-600",
  Restricted: "text-orange-600",
  "Permanently Disabled": "text-red-600",
  Other: "text-slate-700",
}

const UPLOAD_COLS = [
  "BM Name", "BM OwnerName", "BM Owner Birthday",
  "Address", "Email", "Contact no", "Remarks", "Status", "BM Admanager Link",
]

function fmtBirthday(d: string) {
  if (!d) return ""
  const p = d.split("-")
  if (p.length === 3) return `${p[1]}/${p[2]}/${p[0]}`
  return d
}

function FormRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_1fr] items-start gap-3 py-2.5 border-b border-slate-100 last:border-0">
      <label className="text-sm text-slate-600 pt-2 text-right leading-tight pr-2">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className="flex-1">{children}</div>
    </div>
  )
}

function VField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[180px_1fr] items-start gap-3 py-2.5 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-500 pt-2 text-right pr-2">{label}</span>
      <div className={`${INP} ${RO} pt-2`}>{value || " "}</div>
    </div>
  )
}

// ── File → data URL (canvas-downscaled, ≤700px) ───────────────────────────────
function fileToImageData(file: File, maxDim = 700): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        let { width: w, height: h } = img
        if (w > maxDim || h > maxDim) { const s = maxDim / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s) }
        const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h
        canvas.getContext("2d")!.drawImage(img, 0, 0, w, h)
        const isPng = file.type === "image/png"
        resolve(canvas.toDataURL(isPng ? "image/png" : "image/jpeg", isPng ? undefined : 0.85))
      }
      img.onerror = reject
      img.src = e.target!.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function FilePicker({
  label, name, dataUrl, onChange,
}: { label: string; name: string; dataUrl: string; onChange: (name: string, data: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 flex items-center gap-2 h-10 border border-slate-300 rounded-lg px-3 text-sm text-slate-500 bg-white truncate">
        {name ? (
          <span className="truncate text-slate-700">{name}</span>
        ) : (
          <span className="text-slate-400 italic">No file selected</span>
        )}
      </div>
      {dataUrl && (
        <img src={dataUrl} alt="preview" className="w-10 h-10 object-cover rounded border border-slate-200" />
      )}
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="px-3 h-10 rounded-lg bg-slate-100 border border-slate-300 text-sm text-slate-600 hover:bg-slate-200 transition-colors whitespace-nowrap"
      >
        Select file
      </button>
      <input
        ref={ref} type="file" accept="image/*" className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = ""
          if (f) { const data = await fileToImageData(f); onChange(f.name, data) }
        }}
      />
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function BMAdAccountPage() {
  const bm = useBMAccounts()
  const [screen, setScreen] = useState<"list" | "add" | "view" | "edit" | "upload">("list")
  const [active, setActive] = useState<BMAccount | null>(null)
  const [toast, setToast] = useState("")

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500) }

  if (screen === "add")
    return <FormScreen
      mode="add"
      onBack={() => setScreen("list")}
      onSave={(input) => { bm.addAccount(input); flash("New BM & Ad Account added successfully."); setScreen("list") }}
    />

  if (screen === "edit" && active)
    return <FormScreen
      mode="edit"
      initial={active}
      onBack={() => setScreen("list")}
      onSave={(input) => { bm.updateAccount(active.id, input); flash("BM & Ad Account updated successfully."); setScreen("list") }}
    />

  if (screen === "view" && active) {
    const cur = bm.accounts.find(a => a.id === active.id) || active
    return <ViewScreen
      account={cur}
      onBack={() => setScreen("list")}
      onEdit={() => { setActive(cur); setScreen("edit") }}
    />
  }

  if (screen === "upload")
    return <UploadScreen
      onBack={() => setScreen("list")}
      onImport={(rows) => bm.importAccounts(rows)}
    />

  return (
    <ListScreen
      bm={bm}
      toast={toast}
      onAdd={() => setScreen("add")}
      onUpload={() => setScreen("upload")}
      onView={(a) => { setActive(a); setScreen("view") }}
      onEdit={(a) => { setActive(a); setScreen("edit") }}
      onDelete={(a) => { bm.deleteAccount(a.id); flash(`BM "${a.name}" deleted successfully.`) }}
    />
  )
}

// ── List / Dashboard ──────────────────────────────────────────────────────────
function ListScreen({ bm, toast, onAdd, onUpload, onView, onEdit, onDelete }: {
  bm: ReturnType<typeof useBMAccounts>; toast: string
  onAdd: () => void; onUpload: () => void
  onView: (a: BMAccount) => void; onEdit: (a: BMAccount) => void; onDelete: (a: BMAccount) => void
}) {
  const [perPage, setPerPage] = useState(10)
  const [page, setPage] = useState(1)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [confirmDel, setConfirmDel] = useState<BMAccount | null>(null)

  const empty = { date: "", name: "", owner: "", birthday: "", status: "All" }
  const [f, setF] = useState({ ...empty })
  const setFi = (k: keyof typeof empty, v: string) => { setF(p => ({ ...p, [k]: v })); setPage(1) }

  const filtered = useMemo(() => bm.accounts.filter(a => {
    if (f.date && !a.date_created.includes(f.date)) return false
    if (f.name && !a.name.toLowerCase().includes(f.name.toLowerCase())) return false
    if (f.owner && !a.owner.toLowerCase().includes(f.owner.toLowerCase())) return false
    if (f.birthday && !a.birthday.includes(f.birthday)) return false
    if (f.status !== "All" && a.status !== f.status) return false
    return true
  }), [bm.accounts, f])

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage))
  const pg = Math.min(page, totalPages)
  const rows = filtered.slice((pg - 1) * perPage, pg * perPage)

  return (
    <div className="space-y-4 relative">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-emerald-600 text-white text-sm rounded-xl px-5 py-3 shadow-lg flex items-center gap-2">
          <span className="text-lg">✓</span> {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between pb-4 mb-1 border-b border-slate-100">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2">
          <Shield className="w-5 h-5" /> BM &amp; AD ACCOUNT
        </h1>
        <div className="relative">
          <button
            onClick={() => setToolsOpen(o => !o)}
            className="flex items-center gap-1.5 px-4 h-9 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
          >
            <Settings className="w-4 h-4" /> Tools <ChevronDown className="w-3.5 h-3.5" />
          </button>
          {toolsOpen && (
            <div className="absolute right-0 top-10 z-30 bg-white border border-slate-200 rounded-xl shadow-lg w-44 overflow-hidden">
              <button onClick={() => { setToolsOpen(false); onAdd() }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                <span className="text-base">+</span> Add New
              </button>
              <button onClick={() => { setToolsOpen(false); onUpload() }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                <Upload className="w-4 h-4" /> Upload BM
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Records selector */}
      <div className="flex items-center gap-2 text-sm text-slate-600">
        <select
          value={perPage}
          onChange={e => { setPerPage(Number(e.target.value)); setPage(1) }}
          className="h-8 rounded border border-slate-300 px-2 text-sm bg-white"
        >
          {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <span>records</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto scrollbar-dark">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left">
                {["No ▲", "Date Created", "BM Name", "Owner", "Birthday", "Status", "Remarks", "", "Actions"].map(h => (
                  <th key={h} className="px-3 py-3 font-semibold text-slate-700 whitespace-nowrap">{h}</th>
                ))}
              </tr>
              {/* Filter row */}
              <tr className="border-b border-slate-200">
                <td className="px-2 py-1.5" />
                <td className="px-2 py-1.5">
                  <Input className={FINP} value={f.date} onChange={e => setFi("date", e.target.value)} placeholder="Filter…" />
                </td>
                <td className="px-2 py-1.5">
                  <Input className={FINP} value={f.name} onChange={e => setFi("name", e.target.value)} placeholder="Filter…" />
                </td>
                <td className="px-2 py-1.5">
                  <Input className={FINP} value={f.owner} onChange={e => setFi("owner", e.target.value)} placeholder="Filter…" />
                </td>
                <td className="px-2 py-1.5">
                  <Input className={FINP} value={f.birthday} onChange={e => setFi("birthday", e.target.value)} placeholder="Filter…" />
                </td>
                <td className="px-2 py-1.5">
                  <select
                    value={f.status}
                    onChange={e => setFi("status", e.target.value)}
                    className="h-7 w-full rounded border border-slate-300 px-1.5 text-xs bg-white focus:outline-none"
                  >
                    <option>All</option>
                    {BM_STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1.5" />
                <td className="px-2 py-1.5" />
                <td className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-slate-400 text-sm">No records found.</td></tr>
              ) : rows.map((a, i) => (
                <tr key={a.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2.5 text-slate-500">{(pg - 1) * perPage + i + 1}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{a.date_created}</td>
                  <td className="px-3 py-2.5 font-medium">{a.name}</td>
                  <td className="px-3 py-2.5">{a.owner}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{fmtBirthday(a.birthday)}</td>
                  <td className={`px-3 py-2.5 font-medium ${STATUS_TEXT[a.status]}`}>{a.status}</td>
                  <td className="px-3 py-2.5 max-w-[180px] truncate text-slate-500">{a.remarks}</td>
                  <td className="px-3 py-2.5" />
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => onView(a)}
                        className="w-8 h-8 flex items-center justify-center rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-600"
                        title="View"
                      >
                        <Search className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onEdit(a)}
                        className="w-8 h-8 flex items-center justify-center rounded bg-teal-500 hover:bg-teal-600 text-white"
                        title="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setConfirmDel(a)}
                        className="w-8 h-8 flex items-center justify-center rounded bg-red-500 hover:bg-red-600 text-white"
                        title="Delete"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm text-slate-500">
            <span>Page {pg} of {totalPages} ({filtered.length} records)</span>
            <div className="flex gap-1">
              <button disabled={pg === 1} onClick={() => setPage(pg - 1)}
                className="px-3 h-7 rounded border border-slate-300 disabled:opacity-40 hover:bg-slate-50">‹</button>
              <button disabled={pg === totalPages} onClick={() => setPage(pg + 1)}
                className="px-3 h-7 rounded border border-slate-300 disabled:opacity-40 hover:bg-slate-50">›</button>
            </div>
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-[380px] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-800">Confirmation</h2>
              <button onClick={() => setConfirmDel(null)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-sm text-slate-600">
              Are you sure you want to delete <strong>{confirmDel.name}</strong>?
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setConfirmDel(null)}>No</Button>
              <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => { onDelete(confirmDel); setConfirmDel(null) }}>Yes</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Add / Edit form ───────────────────────────────────────────────────────────
function FormScreen({ mode, initial, onBack, onSave }: {
  mode: "add" | "edit"
  initial?: BMAccount
  onBack: () => void
  onSave: (input: NewBMInput & { status?: BMStatus }) => void
}) {
  const [name, setName] = useState(initial?.name || "")
  const [owner, setOwner] = useState(initial?.owner || "")
  const [birthday, setBirthday] = useState(initial?.birthday || "")
  const [address, setAddress] = useState(initial?.address || "")
  const [email, setEmail] = useState(initial?.email || "")
  const [contact, setContact] = useState(initial?.contact_no || "")
  const [remarks, setRemarks] = useState(initial?.remarks || "")
  const [picName, setPicName] = useState(initial?.picture_name || "")
  const [picData, setPicData] = useState(initial?.picture_data || "")
  const [idName, setIdName] = useState(initial?.id_name || "")
  const [idData, setIdData] = useState(initial?.id_data || "")
  const [link, setLink] = useState(initial?.adsmanager_link || "")
  const [status, setStatus] = useState<BMStatus>(initial?.status || "Active")
  const [error, setError] = useState("")

  function submit() {
    if (!name.trim()) { setError("BM Name is required."); return }
    if (!owner.trim()) { setError("Owner is required."); return }
    setError("")
    onSave({ name: name.trim(), owner: owner.trim(), birthday, address, email, contact_no: contact, remarks, picture_name: picName, picture_data: picData, id_name: idName, id_data: idData, adsmanager_link: link, status })
  }

  const title = mode === "add" ? "ADD BM" : "EDIT BM"

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
        <ChevronLeft className="w-4 h-4" /> Back to BM &amp; Ad Account
      </button>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-3xl">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 mb-4">
          <Settings className="w-5 h-5" /> {title}
        </h1>

        <div className="space-y-0.5">
          <FormRow label="Name" required>
            <Input className={INP} value={name} onChange={e => setName(e.target.value)} />
          </FormRow>
          <FormRow label="Owner" required>
            <Input className={INP} value={owner} onChange={e => setOwner(e.target.value)} />
          </FormRow>
          <FormRow label="Owner Birthday">
            <Input className={INP} type="date" value={birthday} onChange={e => setBirthday(e.target.value)} />
          </FormRow>
          <FormRow label="Address">
            <textarea className={`${TA} h-20`} value={address} onChange={e => setAddress(e.target.value)} />
          </FormRow>
          <FormRow label="Email">
            <Input className={INP} type="email" value={email} onChange={e => setEmail(e.target.value)} />
          </FormRow>
          <FormRow label="Contact no">
            <Input className={INP} value={contact} onChange={e => setContact(e.target.value)} />
          </FormRow>
          <FormRow label="Remarks">
            <textarea className={`${TA} h-20`} value={remarks} onChange={e => setRemarks(e.target.value)} />
          </FormRow>
          <FormRow label="Upload Picture">
            <div className="space-y-1">
              <FilePicker label="picture" name={picName} dataUrl={picData}
                onChange={(n, d) => { setPicName(n); setPicData(d) }} />
              {mode === "edit" && picName && (
                <p className="text-xs text-slate-400">Reuploading image will rewrite the existing picture.</p>
              )}
            </div>
          </FormRow>
          <FormRow label="Upload ID">
            <div className="space-y-1">
              <FilePicker label="id" name={idName} dataUrl={idData}
                onChange={(n, d) => { setIdName(n); setIdData(d) }} />
              {mode === "edit" && idName && (
                <p className="text-xs text-slate-400">Reuploading image will rewrite the existing ID.</p>
              )}
            </div>
          </FormRow>
          <FormRow label="Adsmanager Link">
            <Input className={INP} value={link} onChange={e => setLink(e.target.value)} placeholder="https://example.com" />
          </FormRow>

          {mode === "edit" && (
            <FormRow label="Status">
              <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
                {BM_STATUSES.map(s => (
                  <label key={s} className="flex items-center gap-1.5 text-sm text-slate-700 cursor-pointer">
                    <input type="radio" name="bm_status" value={s} checked={status === s}
                      onChange={() => setStatus(s)} className="accent-blue-600" />
                    {s}
                  </label>
                ))}
              </div>
            </FormRow>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        <div className="flex gap-2 mt-6">
          <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={submit}>Submit</Button>
          <Button variant="outline" onClick={onBack}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}

// ── View (Search / read-only) ─────────────────────────────────────────────────
function ViewScreen({ account, onBack, onEdit }: {
  account: BMAccount; onBack: () => void; onEdit: () => void
}) {
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
        <ChevronLeft className="w-4 h-4" /> Back to BM &amp; Ad Account
      </button>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-3xl">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 mb-4">
          <Settings className="w-5 h-5" /> VIEW BM
        </h1>

        <div className="space-y-0.5">
          <VField label="Name *" value={account.name} />
          <VField label="Owner *" value={account.owner} />
          <VField label="Owner Birthday" value={fmtBirthday(account.birthday)} />
          <VField label="Address" value={account.address} />
          <VField label="Email" value={account.email} />
          <VField label="Contact no" value={account.contact_no} />
          <VField label="Remarks" value={account.remarks} />
          <VField label="Adsmanager Link" value={account.adsmanager_link} />

          {/* Uploads */}
          <div className="grid grid-cols-[180px_1fr] items-start gap-3 py-2.5 border-b border-slate-100">
            <span className="text-sm text-slate-500 pt-2 text-right pr-2">Uploads</span>
            <div className="space-y-2 pt-1">
              {account.picture_data ? (
                <div className="flex items-center gap-2">
                  <img src={account.picture_data} alt="picture" className="w-16 h-16 object-cover rounded border border-slate-200" />
                  <span className="text-sm text-slate-600">{account.picture_name}</span>
                </div>
              ) : (
                <span className="text-sm text-slate-400 italic">No Upload Picture Available</span>
              )}
              {account.id_data ? (
                <div className="flex items-center gap-2">
                  <img src={account.id_data} alt="id" className="w-16 h-16 object-cover rounded border border-slate-200" />
                  <span className="text-sm text-slate-600">{account.id_name}</span>
                </div>
              ) : (
                <span className="text-sm text-slate-400 italic">No ID Picture Available</span>
              )}
            </div>
          </div>

          {/* Status */}
          <div className="grid grid-cols-[180px_1fr] items-center gap-3 py-2.5 border-b border-slate-100">
            <span className="text-sm text-slate-500 text-right pr-2">Status</span>
            <div className="flex items-center gap-1.5">
              <span className={`font-medium text-sm ${STATUS_TEXT[account.status]}`}>✓ {account.status}</span>
            </div>
          </div>

          {/* Meta */}
          <div className="grid grid-cols-[180px_1fr] items-start gap-3 py-2.5">
            <span />
            <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3 space-y-0.5">
              <div>Created By: {account.created_by}</div>
              <div>Created Date: {new Date(account.created_date).toLocaleString("en-PH")}</div>
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <Button className="bg-teal-500 hover:bg-teal-600 text-white flex items-center gap-1.5" onClick={onEdit}>
            <Pencil className="w-3.5 h-3.5" /> Edit BM
          </Button>
          <Button variant="outline" onClick={onBack}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}

// ── Upload BM ─────────────────────────────────────────────────────────────────
function UploadScreen({ onBack, onImport }: {
  onBack: () => void
  onImport: (rows: NewBMInput[]) => Promise<number>
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<{ added: number; skipped: number; errors: string[] } | null>(null)

  function downloadTemplate() {
    const headerStyle = {
      fill: { patternType: "solid", fgColor: { rgb: "007575" } },
      font: { color: { rgb: "FFFFFF" }, bold: true },
      alignment: { horizontal: "center", vertical: "center" },
    }
    const hintRow = ["BM Name here", "Owner Name", "YYYY-MM-DD", "Address", "email@example.com", "09XXXXXXXXX", "", "Active", "https://example.com"]
    const ws = XLSX.utils.aoa_to_sheet([UPLOAD_COLS, hintRow])
    UPLOAD_COLS.forEach((_, i) => {
      const ref = XLSX.utils.encode_cell({ r: 0, c: i })
      if ((ws as any)[ref]) (ws as any)[ref].s = headerStyle
    });
    (ws as any)["!cols"] = UPLOAD_COLS.map(h => ({ wch: Math.max(16, h.length + 4) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "BM Accounts")
    XLSX.writeFile(wb, "Bm_Add_Template.xlsx")
  }

  function handleUpload() {
    if (!file) return
    setProcessing(true)
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: "array", cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" })
        if (rows.length < 2) { setResult({ added: 0, skipped: rows.length < 1 ? 0 : 0, errors: ["The file has no data rows."] }); setProcessing(false); return }
        const header = rows[0].map((h: any) => String(h).trim().toLowerCase())
        const idx = (n: string) => header.indexOf(n.toLowerCase())
        const col = {
          name: idx("bm name"), owner: idx("bm ownername"), birthday: idx("bm owner birthday"),
          address: idx("address"), email: idx("email"), contact: idx("contact no"),
          remarks: idx("remarks"), status: idx("status"), link: idx("bm admanager link"),
        }
        const valid: NewBMInput[] = []
        let skipped = 0
        const errors: string[] = []
        const str = (r: any[], i: number) => i >= 0 ? String(r[i] ?? "").trim() : ""

        for (let r = 1; r < rows.length; r++) {
          const c = rows[r]
          const name = str(c, col.name)
          const owner = str(c, col.owner)
          if (!name && !owner) continue  // blank row
          if (!name) { skipped++; errors.push(`Row ${r + 1}: BM Name is required.`); continue }
          const rawStatus = str(c, col.status)
          const status: BMStatus = (BM_STATUSES as string[]).includes(rawStatus) ? rawStatus as BMStatus : "Active"
          valid.push({
            name, owner, birthday: str(c, col.birthday), address: str(c, col.address),
            email: str(c, col.email), contact_no: str(c, col.contact), remarks: str(c, col.remarks),
            picture_name: "", picture_data: "", id_name: "", id_data: "",
            adsmanager_link: str(c, col.link), status,
          })
        }
        const added = valid.length ? await onImport(valid) : 0
        setResult({ added, skipped, errors: errors.slice(0, 8) })
      } catch {
        setResult({ added: 0, skipped: 0, errors: ["Could not read the file — make sure it's a valid Excel (.xlsx) file."] })
      }
      setProcessing(false)
    }
    reader.readAsArrayBuffer(file)
  }

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
        <ChevronLeft className="w-4 h-4" /> Back to BM &amp; Ad Account
      </button>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-2xl">
        <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2 mb-6">
          <Settings className="w-5 h-5" /> UPLOAD BM
        </h1>

        <div className="space-y-4">
          <div className="grid grid-cols-[160px_1fr] items-center gap-3">
            <span className="text-sm text-slate-600 text-right">Template</span>
            <button onClick={downloadTemplate}
              className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
              <Download className="w-4 h-4" /> Click to Download Sample File
            </button>
          </div>

          <div className="grid grid-cols-[160px_1fr] items-center gap-3">
            <span className="text-sm text-slate-600 text-right">Upload Excel File <span className="text-red-500">*</span></span>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 flex-1 h-10 border border-slate-300 rounded-lg px-3 text-sm bg-white">
                {file ? (
                  <>
                    <span className="truncate text-slate-700">{file.name}</span>
                    <button onClick={() => { setFile(null); setResult(null) }} className="ml-auto text-slate-400 hover:text-red-500">
                      <X className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <span className="text-slate-400 italic">No file selected</span>
                )}
              </div>
              {file ? (
                <button onClick={() => { setFile(null); setResult(null) }}
                  className="px-3 h-10 rounded-lg bg-red-50 border border-red-300 text-sm text-red-600 hover:bg-red-100">
                  Remove
                </button>
              ) : (
                <button onClick={() => fileRef.current?.click()}
                  className="px-3 h-10 rounded-lg bg-slate-100 border border-slate-300 text-sm text-slate-600 hover:bg-slate-200">
                  Select file
                </button>
              )}
              <input
                ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { setFile(f); setResult(null) } }}
              />
            </div>
          </div>
        </div>

        {result && (
          <div className={`mt-4 rounded-xl px-4 py-3 text-sm ${result.errors.length && result.added === 0 ? "bg-red-50 border border-red-200 text-red-700" : "bg-emerald-50 border border-emerald-200 text-emerald-700"}`}>
            <div className="font-semibold mb-1">{result.errors.length && result.added === 0 ? "Upload failed" : "Success"}</div>
            <div>Total Row Added = {result.added}</div>
            <div>Total Row Skipped = {result.skipped}</div>
            {result.errors.map((e, i) => <div key={i} className="mt-1 text-xs">{e}</div>)}
          </div>
        )}

        <div className="flex gap-2 mt-6">
          <Button
            className="bg-blue-600 hover:bg-blue-700 text-white"
            onClick={handleUpload}
            disabled={!file || processing}
          >
            {processing ? "Uploading…" : "Upload"}
          </Button>
          <Button variant="outline" onClick={onBack}>Back</Button>
        </div>
      </div>
    </div>
  )
}
