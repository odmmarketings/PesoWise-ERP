"use client"
import { useCallback, useEffect, useState } from "react"
import type { ExpenseType } from "@/lib/finance-settings-store"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"
import { currentUserName } from "@/lib/current-user"

// ──────────────────────────────────────────────────────────────────────────────
// Book Keeping (Finance module) — data model + Supabase-backed store (`bookkeeping_txns`,
// one business, shared across every device). Reference data (Accounts, Banks, Departments,
// Types of Expense) is owned by Finance → Settings (see finance-settings-store). A
// transaction's Account is the settings Account (the tabs: !Cash Advance, …); the selected
// Type of Expense's `type` (Debit / Credit / Not Applicable) decides which column the Amount
// posts to. `pesowise_bookkeeping_txns` localStorage is now just a same-session read cache.
// ──────────────────────────────────────────────────────────────────────────────

export type TxnStatus = "enabled" | "pending_disable" | "disabled"

export interface TxnHistory {
  action: string
  by: string
  date: string            // ISO
  note?: string
}

export interface BookTxn {
  id: string
  voucher: string
  posted_date: string     // YYYY-MM-DD
  transaction: string     // description
  account: string         // Finance Settings Account (the tab/filter dimension)
  department: string
  category: string
  type_of_expense: string
  amount: number
  debit: number
  credit: number
  bank: string
  receipt_name: string
  status: TxnStatus
  disable_reason: string
  disable_remarks: string
  added_by: string
  added_date: string      // ISO
  history: TxnHistory[]
}

// Categories aren't managed in Finance Settings — keep a small seed + free-text entry.
export const SEED_CATEGORIES = ["Operating Expense", "Capital Expense", "Revolving Fund", "Cash Advance", "Reimbursement", "Revenue"]

export const ADDED_BY = "Admin User" // fallback only — real records stamp currentUserName()

const TXN_KEY = "pesowise_bookkeeping_txns"

// Split the Amount into debit/credit columns based on the Type of Expense's nature.
// "Not Applicable" still needs a home for the amount → default to Debit.
export function splitAmount(expenseType: ExpenseType, amount: number): { debit: number; credit: number } {
  return expenseType === "Credit" ? { debit: 0, credit: amount } : { debit: amount, credit: 0 }
}

// Plain number formatting for the Debit/Credit columns (no ₱ sign, matches screenshot).
export function fmtAmount(n: number): string {
  return Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── Excel bulk-upload template + CSV export ───────────────────────────────────
// Template columns match the Finance bulk-upload spreadsheet exactly (the .xlsx workbook is
// built/parsed with xlsx-js-style in the Upload screen). DEBIT/CREDIT are explicit columns here.
export const UPLOAD_COLUMNS = ["POSTED DATE", "ACCOUNTS", "TRANSACTION", "DEPARTMENT", "TYPE OF EXPENSE", "DEBIT", "CREDIT", "BANK", "VOUCHER"]

function csvCell(v: any): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`
}

export function exportTxnsCSV(txns: BookTxn[]): string {
  const headers = ["No.", "Posted Date", "Voucher", "Transaction", "Account", "Department", "Category", "Type of Expense", "Debit", "Credit", "Bank", "Status", "Added By", "Added Date"]
  const rows = txns.map((t, i) => [
    i + 1, t.posted_date, t.voucher, t.transaction, t.account, t.department, t.category,
    t.type_of_expense, t.debit, t.credit, t.bank, t.status, t.added_by, t.added_date.slice(0, 10),
  ])
  return [headers, ...rows].map(r => r.map(csvCell).join(",")).join("\n")
}

export function downloadCSV(filename: string, csv: string) {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url; link.download = filename
  document.body.appendChild(link); link.click(); document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export interface NewTxnInput {
  posted_date: string; transaction: string; account: string; department: string; category: string
  type_of_expense: string; expense_type: ExpenseType; amount: number; bank: string
  voucher: string; receipt_name: string
  debit?: number; credit?: number   // explicit split (bulk Excel upload) — overrides expense_type
}

function rowToTxn(r: any): BookTxn {
  return {
    id: r.id,
    voucher: r.voucher || "", posted_date: r.posted_date || "", transaction: r.transaction || "",
    account: r.account || "", department: r.department || "", category: r.category || "",
    type_of_expense: r.type_of_expense || "", amount: Number(r.amount) || 0, debit: Number(r.debit) || 0, credit: Number(r.credit) || 0,
    bank: r.bank || "", receipt_name: r.receipt_name || "",
    status: r.status || "enabled", disable_reason: r.disable_reason || "", disable_remarks: r.disable_remarks || "",
    added_by: r.added_by || ADDED_BY, added_date: r.added_date || r.created_at || new Date().toISOString(),
    history: Array.isArray(r.history) ? r.history : [],
  }
}

function readCache(): BookTxn[] {
  try { const raw = localStorage.getItem(TXN_KEY); return raw ? JSON.parse(raw) : [] } catch { return [] }
}
function writeCache(list: BookTxn[]) { try { localStorage.setItem(TXN_KEY, JSON.stringify(list)) } catch {} }

function buildRow(businessId: string, input: NewTxnInput, actionLabel: string) {
  const explicit = input.debit != null || input.credit != null
  const debit = explicit ? Number(input.debit || 0) : splitAmount(input.expense_type, input.amount).debit
  const credit = explicit ? Number(input.credit || 0) : splitAmount(input.expense_type, input.amount).credit
  const amount = explicit ? debit + credit : input.amount
  const now = new Date().toISOString()
  const by = currentUserName() || ADDED_BY
  return {
    business_id: businessId,
    voucher: input.voucher, posted_date: input.posted_date, transaction: input.transaction,
    account: input.account, department: input.department, category: input.category,
    type_of_expense: input.type_of_expense, amount, debit, credit, bank: input.bank,
    receipt_name: input.receipt_name, status: "enabled", disable_reason: "", disable_remarks: "",
    added_by: by, added_date: now,
    history: [{ action: actionLabel, by, date: now }],
  }
}

// Insert a Book Keeping transaction directly (used by the Reimbursement/Utility modules on
// approval — "recorded as an item on Bookkeeping"). Works even when the Book Keeping page
// isn't mounted since it goes straight to Supabase; the Book Keeping page picks it up on its
// next fetch (mount or refresh()).
export async function pushBookkeepingTxn(input: NewTxnInput, actionLabel = "Recorded from Reimbursement"): Promise<BookTxn> {
  const businessId = await getBusinessId()
  if (!businessId) throw new Error("No business configured.")
  const supabase = createSupabaseBrowserClient()
  const { data, error } = await supabase.from("bookkeeping_txns").insert(buildRow(businessId, input, actionLabel)).select().single()
  if (error || !data) throw error || new Error("Failed to record transaction.")
  return rowToTxn(data)
}

export function useBookkeeping() {
  const [txns, setTxns] = useState<BookTxn[]>(() => readCache())
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const businessId = await getBusinessId()
    if (!businessId) { setLoading(false); return }
    const supabase = createSupabaseBrowserClient()
    const { data, error } = await supabase.from("bookkeeping_txns").select("*").eq("business_id", businessId).order("created_at", { ascending: false })
    if (!error && data) { const list = data.map(rowToTxn); writeCache(list); setTxns(list) }
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const addTxn = useCallback(async (input: NewTxnInput) => {
    const businessId = await getBusinessId()
    if (!businessId) throw new Error("No business configured.")
    const supabase = createSupabaseBrowserClient()
    const { data, error } = await supabase.from("bookkeeping_txns").insert(buildRow(businessId, input, "Created")).select().single()
    if (error || !data) throw error || new Error("Failed to add transaction.")
    const txn = rowToTxn(data)
    await refresh()
    return txn
  }, [refresh])

  const importTxns = useCallback(async (inputs: NewTxnInput[]) => {
    const businessId = await getBusinessId()
    if (!businessId) return 0
    const supabase = createSupabaseBrowserClient()
    const rows = inputs.map(input => buildRow(businessId, input, "Created (bulk upload)"))
    const { data, error } = await supabase.from("bookkeeping_txns").insert(rows).select()
    if (error) throw error
    await refresh()
    return data?.length ?? 0
  }, [refresh])

  const patchWithHistory = useCallback(async (id: string, patch: Record<string, any>, historyAction: string, note: string) => {
    const current = txns.find(t => t.id === id)
    if (!current) return
    const by = currentUserName() || ADDED_BY
    const supabase = createSupabaseBrowserClient()
    const history = [...current.history, { action: historyAction, by, date: new Date().toISOString(), note }]
    const { error } = await supabase.from("bookkeeping_txns").update({ ...patch, history }).eq("id", id)
    if (error) throw error
    await refresh()
  }, [txns, refresh])

  const requestDisable = useCallback((id: string, reason: string) =>
    patchWithHistory(id, { status: "pending_disable", disable_reason: reason }, "Requested Disable", reason), [patchWithHistory])
  const approveDisable = useCallback((id: string, remarks: string) =>
    patchWithHistory(id, { status: "disabled", disable_remarks: remarks }, "Disable Approved", remarks), [patchWithHistory])
  const declineDisable = useCallback((id: string, remarks: string) =>
    patchWithHistory(id, { status: "enabled", disable_reason: "", disable_remarks: remarks }, "Disable Declined", remarks), [patchWithHistory])

  return { txns, loaded: !loading, addTxn, importTxns, requestDisable, approveDisable, declineDisable }
}
