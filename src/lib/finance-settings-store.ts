"use client"
import { useCallback, useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"

// ──────────────────────────────────────────────────────────────────────────────
// Finance → Settings (LHIKE ERP "Finance - Settings" manual). Single source of the
// finance reference data that the Book Keeping module consumes: Accounts, Banks,
// Departments, Types of Expense, plus General toggles. Source of truth = Supabase
// `finance_settings` (one JSONB blob per business — nothing else references these by
// foreign key, Book Keeping stores account/department/type/bank as plain text at write
// time, so a single blob mirrors the existing shape with the least risk). `pesowise_
// finance_settings` localStorage is now just a same-session read cache for instant paint.
// ──────────────────────────────────────────────────────────────────────────────

export type ActiveStatus = "active" | "inactive"
export type ExpenseType = "Debit" | "Credit" | "Not Applicable"

export interface FinanceBank { id: string; name: string; status: ActiveStatus }
export interface FinanceDepartment { id: string; name: string; status: ActiveStatus }
export interface FinanceTypeOfExpense {
  id: string; name: string; opex: boolean; type: ExpenseType; status: ActiveStatus
}
export interface FinanceAccount {
  id: string
  name: string
  hardcoded: boolean          // the 3 system accounts — name/status locked, only bank editable
  status: ActiveStatus
  with_voucher: boolean       // "Is account With/No voucher?"
  bank_id: string             // bank assignation
  // Revolving Fund Account Settings
  is_adspent: boolean
  is_cog_purchase: boolean
  is_shipping_fee: boolean
  excluded_in_gross_revenue: boolean
  members: string[]
}
export interface GeneralSettings {
  hide_shared_expense: boolean   // Reimbursement submodule
  hide_type_request: boolean     // Utility Expense submodule
}

export interface FinanceSettings {
  general: GeneralSettings
  banks: FinanceBank[]
  departments: FinanceDepartment[]
  types: FinanceTypeOfExpense[]
  accounts: FinanceAccount[]
}

// Members available to assign to accounts (no user directory yet — seed a list).
export const MEMBERS = ["Larry Lobitana", "Admin User", "Staff 1", "Staff 2", "Warehouse Staff"]

const KEY = "pesowise_finance_settings"
const uid = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

function seed(): FinanceSettings {
  const banks: FinanceBank[] = ["CHINA BANK", "BPI", "GCASH", "PETTY CASH", "GOTYME"].map((n, i) => ({ id: `bank-${i + 1}`, name: n, status: "active" }))
  const departments: FinanceDepartment[] = ["DEPARTMENT 1", "Warehouse Department", "Marketing"].map((n, i) => ({ id: `dept-${i + 1}`, name: n, status: "active" }))
  const types: FinanceTypeOfExpense[] = [
    { id: "toe-1", name: "Expense Example 1", opex: true, type: "Debit", status: "active" },
    { id: "toe-2", name: "Utilities", opex: true, type: "Debit", status: "active" },
    { id: "toe-3", name: "Salaries & Wages", opex: true, type: "Debit", status: "active" },
    { id: "toe-4", name: "Supplies", opex: true, type: "Debit", status: "active" },
    { id: "toe-5", name: "Adspent", opex: true, type: "Debit", status: "active" },
    { id: "toe-6", name: "Shipping Fee", opex: false, type: "Debit", status: "active" },
    { id: "toe-7", name: "Sales Revenue", opex: false, type: "Credit", status: "active" },
    { id: "toe-8", name: "Adjustment", opex: false, type: "Not Applicable", status: "active" },
  ]
  // 3 hardcoded accounts + custom ones matching the Book Keeping tabs.
  const mk = (name: string, hardcoded: boolean, bank_id: string): FinanceAccount => ({
    id: uid("acct"), name, hardcoded, status: "active", with_voucher: !hardcoded,
    bank_id, is_adspent: false, is_cog_purchase: false, is_shipping_fee: false,
    excluded_in_gross_revenue: false, members: [],
  })
  const accounts: FinanceAccount[] = [
    mk("!Cash Advance", true, "bank-1"),
    mk("!Reimbursement", true, "bank-1"),
    mk("!Utility Expense", true, "bank-1"),
    mk("For Test", false, "bank-2"),
    mk("Warehouse Department", false, "bank-1"),
  ]
  return { general: { hide_shared_expense: false, hide_type_request: false }, banks, departments, types, accounts }
}

function readCache(): FinanceSettings | null {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null } catch { return null }
}
function writeCache(s: FinanceSettings) { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch {} }

async function persist(next: FinanceSettings) {
  const businessId = await getBusinessId()
  if (!businessId) return
  const supabase = createSupabaseBrowserClient()
  await supabase.from("finance_settings").upsert({ business_id: businessId, data: next, updated_at: new Date().toISOString() })
}

export function useFinanceSettings() {
  const [settings, setSettings] = useState<FinanceSettings | null>(() => readCache())

  useEffect(() => {
    (async () => {
      const businessId = await getBusinessId()
      if (!businessId) return
      const supabase = createSupabaseBrowserClient()
      const { data, error } = await supabase.from("finance_settings").select("data").eq("business_id", businessId).maybeSingle()
      if (error) return
      if (data) { setSettings(data.data as FinanceSettings); writeCache(data.data as FinanceSettings) }
      else {
        const s = seed()
        await supabase.from("finance_settings").insert({ business_id: businessId, data: s })
        setSettings(s); writeCache(s)
      }
    })()
  }, [])

  const save = useCallback((next: FinanceSettings) => {
    setSettings(next)
    writeCache(next)
    persist(next)
  }, [])

  const update = useCallback((fn: (s: FinanceSettings) => FinanceSettings) => {
    setSettings(prev => {
      if (!prev) return prev
      const next = fn(prev)
      writeCache(next)
      persist(next)
      return next
    })
  }, [])

  // ── General ──
  const setGeneral = (patch: Partial<GeneralSettings>) => update(s => ({ ...s, general: { ...s.general, ...patch } }))

  // ── Banks ──
  const addBank = (name: string) => update(s => ({ ...s, banks: [...s.banks, { id: uid("bank"), name, status: "active" }] }))
  const updateBank = (id: string, name: string) => update(s => ({ ...s, banks: s.banks.map(b => b.id === id ? { ...b, name } : b) }))
  const toggleBank = (id: string) => update(s => ({ ...s, banks: s.banks.map(b => b.id === id ? { ...b, status: b.status === "active" ? "inactive" : "active" } : b) }))

  // ── Departments ──
  const addDepartment = (name: string) => update(s => ({ ...s, departments: [...s.departments, { id: uid("dept"), name, status: "active" }] }))
  const updateDepartment = (id: string, name: string) => update(s => ({ ...s, departments: s.departments.map(d => d.id === id ? { ...d, name } : d) }))
  const toggleDepartment = (id: string) => update(s => ({ ...s, departments: s.departments.map(d => d.id === id ? { ...d, status: d.status === "active" ? "inactive" : "active" } : d) }))
  // Admin-only sa UI (Mother Account). Existing Book Keeping entries keep the department
  // as plain text, so deleting here never rewrites history.
  const removeDepartment = (id: string) => update(s => ({ ...s, departments: s.departments.filter(d => d.id !== id) }))
  // Admin-only sa UI. The Finance Overview bank cards + Actual Company Fund read activeBanks,
  // so deleting/adding a bank reflows those automatically. Accounts assigned to the deleted
  // bank keep their bank_id but resolve to no name — reassign them in the Accounts tab.
  const removeBank = (id: string) => update(s => ({ ...s, banks: s.banks.filter(b => b.id !== id) }))

  // ── Types of Expense ──
  const addType = (t: Omit<FinanceTypeOfExpense, "id" | "status">) => update(s => ({ ...s, types: [...s.types, { ...t, id: uid("toe"), status: "active" }] }))
  const updateType = (id: string, patch: Partial<FinanceTypeOfExpense>) => update(s => ({ ...s, types: s.types.map(t => t.id === id ? { ...t, ...patch } : t) }))
  const toggleType = (id: string) => update(s => ({ ...s, types: s.types.map(t => t.id === id ? { ...t, status: t.status === "active" ? "inactive" : "active" } : t) }))

  // ── Accounts ──
  const addAccount = (a: Omit<FinanceAccount, "id" | "hardcoded" | "status">) => update(s => ({ ...s, accounts: [...s.accounts, { ...a, id: uid("acct"), hardcoded: false, status: "active" }] }))
  const updateAccount = (id: string, patch: Partial<FinanceAccount>) => update(s => ({
    ...s,
    accounts: s.accounts.map(a => {
      if (a.id !== id) return a
      // Hardcoded accounts: only bank assignation may change.
      if (a.hardcoded) return { ...a, bank_id: patch.bank_id ?? a.bank_id }
      return { ...a, ...patch }
    }),
  }))
  const toggleAccount = (id: string) => update(s => ({
    ...s, accounts: s.accounts.map(a => a.id === id && !a.hardcoded ? { ...a, status: a.status === "active" ? "inactive" : "active" } : a),
  }))
  const toggleAccountVoucher = (id: string) => update(s => ({
    ...s, accounts: s.accounts.map(a => a.id === id ? { ...a, with_voucher: !a.with_voucher } : a),
  }))

  const s = settings
  return {
    settings: s, loaded: !!s,
    banks: s?.banks ?? [], departments: s?.departments ?? [], types: s?.types ?? [], accounts: s?.accounts ?? [],
    general: s?.general ?? { hide_shared_expense: false, hide_type_request: false },
    // Active-only helpers (what downstream modules like Book Keeping should offer).
    activeBanks: (s?.banks ?? []).filter(b => b.status === "active"),
    activeDepartments: (s?.departments ?? []).filter(d => d.status === "active"),
    activeTypes: (s?.types ?? []).filter(t => t.status === "active"),
    activeAccounts: (s?.accounts ?? []).filter(a => a.status === "active"),
    bankName: (id: string) => (s?.banks ?? []).find(b => b.id === id)?.name ?? "",
    save, setGeneral,
    addBank, updateBank, toggleBank, removeBank,
    addDepartment, updateDepartment, toggleDepartment, removeDepartment,
    addType, updateType, toggleType,
    addAccount, updateAccount, toggleAccount, toggleAccountVoucher,
  }
}
