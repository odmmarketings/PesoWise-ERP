"use client"
import { useMemo, useState } from "react"
import { Settings, Plus, Trash2, UserPlus, ShieldCheck, Award, RotateCcw, Check } from "lucide-react"
import { useDeliveryTeam, resolveDeliveryRole, type DeliveryTeamRole } from "@/lib/delivery-team-store"
import {
  useDeliverySettings, DEFAULT_KPI_WEIGHTS, KPI_WEIGHT_LABELS, type KpiWeights,
} from "@/lib/delivery-store"
import { useErpUsers, isMotherAccount } from "@/lib/users-store"
import { currentUserEmail } from "@/lib/current-user"
import { ComingSoon } from "@/components/business/ComingSoon"

// Delivery Settings — Team & Roles roster (sino ang delivery/problematic agents at
// supervisors). Email-based para mailista ang agents kahit wala pa silang PesoWise
// accounts. Admin (Mother Account) lang ang nakakapag-edit; iba ay read-only.

const TABS = ["Team & Roles", "KPI Scoring", "Assignment Rules"] as const
type Tab = typeof TABS[number]

const INP = "h-9 rounded-lg border border-slate-300 px-2.5 text-sm bg-white focus:outline-none focus:border-blue-400"

export default function DeliverySettingsPage() {
  const [tab, setTab] = useState<Tab>("Team & Roles")
  const store = useDeliveryTeam()
  const admin = isMotherAccount()
  const myRole = resolveDeliveryRole(currentUserEmail(), store.team)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3 pb-4 mb-1 border-b border-slate-100">
        <div>
          <h1 className="text-lg font-bold text-blue-600 flex items-center gap-2">
            <Settings className="w-5 h-5" /> DELIVERY SETTINGS
          </h1>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Logistics & Delivery Ops · your role: <span className="font-semibold uppercase">{myRole}</span>
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 mb-1">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Team & Roles" && <TeamTab store={store} admin={admin} />}
      {tab === "KPI Scoring" && <KpiTab admin={admin} />}
      {tab === "Assignment Rules" && (
        <ComingSoon
          title="Assignment Rules"
          icon={ShieldCheck}
          note="Phase 4 — automated assignment rules (caps by region/courier, schedules)."
          points={[
            "Default max leads per agent",
            "Auto-assignment schedules at eligibility rules",
            "Configurable KPI formulas",
          ]}
        />
      )}
    </div>
  )
}

// ── KPI Scoring — configurable weights (spec §16: "adjustable by Admin rather
// than permanently hard-coded"). Ang score ay weighted average, kaya hindi
// kailangang eksaktong 100 ang kabuuan — pero pinapaalala kung hindi.
function KpiTab({ admin }: { admin: boolean }) {
  const { weights, loaded, saveWeights } = useDeliverySettings()
  const [draft, setDraft] = useState<KpiWeights | null>(null)
  const [saved, setSaved] = useState(false)
  const w = draft ?? weights
  const total = Object.values(w).reduce((s, v) => s + (Number(v) || 0), 0)
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(weights)

  const set = (k: keyof KpiWeights, v: string) =>
    setDraft({ ...w, [k]: Math.max(0, Math.min(100, parseInt(v) || 0)) })

  const save = async () => {
    if (!draft) return
    await saveWeights(draft)
    setDraft(null); setSaved(true); setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-5 max-w-2xl">
        <p className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
          <Award className="w-4 h-4 text-blue-500" /> Agent KPI Score Weights
        </p>
        <p className="text-[11px] text-slate-400 mt-1 mb-4">
          Ang KPI Score ay weighted average ng mga sukatang ito. Kapag walang problematic case
          ang isang agent, hindi kasama ang Recovery Rate sa score niya — hindi siya paparusahan
          sa trabahong hindi naman sa kanya. {!loaded && "Loading…"}
        </p>

        <div className="space-y-3">
          {(Object.keys(KPI_WEIGHT_LABELS) as (keyof KpiWeights)[]).map(k => (
            <div key={k} className="flex items-center gap-3">
              <label className="flex-1 text-sm text-slate-700">{KPI_WEIGHT_LABELS[k]}</label>
              <input type="range" min={0} max={100} step={5} disabled={!admin}
                className="w-40 accent-blue-600" value={w[k]} onChange={e => set(k, e.target.value)} />
              <div className="flex items-center gap-1">
                <input type="number" min={0} max={100} disabled={!admin}
                  className="h-9 w-16 rounded-lg border border-slate-300 px-2 text-sm text-right tabular-nums disabled:bg-slate-100"
                  value={w[k]} onChange={e => set(k, e.target.value)} />
                <span className="text-sm text-slate-400">%</span>
              </div>
            </div>
          ))}
        </div>

        <div className={`mt-4 rounded-lg border px-3 py-2 text-sm ${total === 100 ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
          Total: <strong className="tabular-nums">{total}%</strong>
          {total !== 100 && " — hindi eksaktong 100%, pero gagana pa rin (proporsiyonal ang timbang)."}
        </div>

        {admin && (
          <div className="flex items-center gap-2 mt-4">
            <button onClick={save} disabled={!dirty}
              className="h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-1.5">
              <Check className="w-4 h-4" /> Save Weights
            </button>
            <button onClick={() => setDraft({ ...DEFAULT_KPI_WEIGHTS })}
              className="h-10 px-4 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5">
              <RotateCcw className="w-4 h-4" /> Reset to defaults
            </button>
            {saved && <span className="text-sm text-emerald-600 font-medium">Saved.</span>}
          </div>
        )}
        {!admin && <p className="text-[11px] text-slate-400 mt-3">Read-only — Mother Account lang ang nakakapagbago ng weights.</p>}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 max-w-2xl">
        <p className="text-sm font-semibold text-slate-700 mb-2">Paano kinakalkula</p>
        <ul className="text-sm text-slate-500 space-y-1.5">
          <li>• <strong className="text-slate-700">Delivery Rate</strong> = delivered ÷ assigned</li>
          <li>• <strong className="text-slate-700">Contact Rate</strong> = may call attempt o last contact ÷ assigned</li>
          <li>• <strong className="text-slate-700">Recovery Rate</strong> = recovery outcome na "Recovered / Delivered" ÷ problematic assigned</li>
          <li>• <strong className="text-slate-700">Productivity</strong> = nagalaw na records (hindi na Pending) ÷ assigned</li>
          <li>• <strong className="text-slate-700">Follow-up completion</strong> = due follow-ups na naaksyunan ÷ due follow-ups</li>
        </ul>
        <p className="text-[11px] text-slate-400 mt-3">
          Ang RTS Rate ay ipinapakita sa scorecard pero HINDI kasama sa score — resulta iyon ng
          courier at customer, hindi lang ng agent.
        </p>
      </div>
    </div>
  )
}

function TeamTab({ store, admin }: { store: ReturnType<typeof useDeliveryTeam>; admin: boolean }) {
  const { users } = useErpUsers()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<DeliveryTeamRole>("agent")
  const [err, setErr] = useState("")
  const [busy, setBusy] = useState(false)

  // Quick-pick mula sa User Management roster (company emails na wala pa sa delivery team).
  const candidates = useMemo(() => {
    const taken = new Set(store.team.map(t => t.email.toLowerCase()))
    return users.filter(u => u.email && !taken.has(u.email.toLowerCase()))
  }, [users, store.team])

  const add = async () => {
    if (busy) return
    setBusy(true)
    setErr("")
    const msg = await store.addMember({ name, email, role })
    setBusy(false)
    if (msg) { setErr(msg); return }
    setName(""); setEmail(""); setRole("agent")
  }

  return (
    <div className="space-y-4">
      {admin && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <p className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-1.5">
            <UserPlus className="w-4 h-4 text-blue-500" /> Add Team Member
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1">From User Management</label>
              <select className={`${INP} w-56`} value="" onChange={e => {
                const u = candidates.find(c => c.email === e.target.value)
                if (u) { setName(u.full_name || u.username || ""); setEmail(u.email) }
              }}>
                <option value="">— pick an existing user —</option>
                {candidates.map(u => <option key={u.email} value={u.email}>{u.full_name || u.username} ({u.email})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1">Name</label>
              <input className={`${INP} w-44`} value={name} onChange={e => setName(e.target.value)} placeholder="Agent name" />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1">Email</label>
              <input className={`${INP} w-60`} value={email} onChange={e => setEmail(e.target.value)} placeholder="agent@company.com" />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1">Role</label>
              <select className={`${INP} w-36`} value={role} onChange={e => setRole(e.target.value as DeliveryTeamRole)}>
                <option value="agent">Agent</option>
                <option value="supervisor">Supervisor</option>
              </select>
            </div>
            <button onClick={add} disabled={busy || !email.trim()}
              className="h-9 px-4 rounded-lg bg-blue-600 text-white text-sm font-semibold flex items-center gap-1.5 hover:bg-blue-700 disabled:opacity-50">
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>
          {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
          <p className="text-[11px] text-slate-400 mt-2">
            Pwedeng idagdag ang agents kahit wala pa silang PesoWise account — ang email ang itutugma pag nag-login na sila.
          </p>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <p className="text-sm font-semibold text-slate-700 mb-3">Delivery Team ({store.team.length})</p>
        <div className="overflow-x-auto scrollbar-dark">
          <table className="w-full text-sm border border-slate-200">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left">
                <th className="px-3 py-2 font-semibold text-slate-600">Name</th>
                <th className="px-3 py-2 font-semibold text-slate-600">Email</th>
                <th className="px-3 py-2 font-semibold text-slate-600">Role</th>
                <th className="px-3 py-2 font-semibold text-slate-600">Active</th>
                {admin && <th className="px-3 py-2 font-semibold text-slate-600 w-16">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {store.team.length === 0 && (
                <tr><td colSpan={admin ? 5 : 4} className="px-3 py-8 text-center text-slate-400">
                  {store.loaded ? "Wala pang team members — add agents above." : "Loading…"}
                </td></tr>
              )}
              {store.team.map((m, i) => (
                <tr key={m.id} className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50"} hover:bg-blue-50/40`}>
                  <td className="px-3 py-2 font-medium text-slate-700">{m.name || "—"}</td>
                  <td className="px-3 py-2 text-slate-500">{m.email}</td>
                  <td className="px-3 py-2">
                    {admin ? (
                      <select className="h-8 rounded border border-slate-300 px-1.5 text-xs bg-white"
                        value={m.role} onChange={e => store.updateMember(m.id, { role: e.target.value as DeliveryTeamRole })}>
                        <option value="agent">Agent</option>
                        <option value="supervisor">Supervisor</option>
                      </select>
                    ) : (
                      <span className={`text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${m.role === "supervisor" ? "bg-purple-50 text-purple-700" : "bg-blue-50 text-blue-700"}`}>
                        {m.role}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <button disabled={!admin} onClick={() => store.updateMember(m.id, { active: !m.active })}
                      className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${m.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400"} ${admin ? "cursor-pointer" : "cursor-default"}`}>
                      {m.active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  {admin && (
                    <td className="px-3 py-2">
                      <button onClick={() => { if (confirm(`Remove ${m.name || m.email} from the delivery team?`)) store.removeMember(m.id) }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50" title="Remove">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!admin && <p className="text-[11px] text-slate-400 mt-2">Read-only — Mother Account lang ang nakakapag-edit ng roster.</p>}
      </div>
    </div>
  )
}
