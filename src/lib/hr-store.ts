"use client"

// ──────────────────────────────────────────────────────────────────────────────
// HR STORE — 201 File (employee master), Holidays, at Events.
//
// SAAN NAKATAGO ANG DATA — at bakit hindi sa sariling tables (sa ngayon):
// Ang paggawa ng bagong table ay DDL na hindi kayang patakbuhin ng service key
// sa PostgREST, at itinayo ang module na ito nang gabing walang makakapagpatakbo
// ng migration. Ang ginagamit na imbakan ay ang UMIIRAL nang `problem-files`
// storage bucket (mula 0014): isang JSON document kada doc kada business, sa
// path na `hr/{business_id}/{doc}.json`.
//
// Mga kapalit ng desisyong ito — basahin bago "ayusin":
//   • Ang bucket ay public-READ. Ang path ay may business UUID kaya hindi
//     mahuhulaan, pero PII pa rin ang laman — kaya WALANG sweldo o anumang
//     kompensasyon sa mga field dito. Idadagdag lang iyon kapag nasa totoong
//     table na may RLS ang data (tingnan ang supabase/migrations/0017_hr.sql).
//   • Walang UPDATE policy ang bucket (insert + delete lang), kaya ang "save"
//     ay remove-then-upload. May maliit na bintana kung saan wala ang file —
//     tanggap iyon: iisa ang HR admin na nag-e-edit, at bawat save ay buong doc.
//   • Last-write-wins kapag dalawang tab ang sabay nag-save. Maliit ang datos
//     (daan-daang empleyado max) kaya buong-doc ang basa/sulat.
// ──────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"

export const HR_BUCKET = "problem-files"

// ── Types ─────────────────────────────────────────────────────────────────────
export const EMPLOYEE_STATUSES = ["Active", "Inactive", "Resigned", "Terminated"] as const
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number]

export type HrEmployee = {
  id: string
  employee_no: string
  first_name: string
  middle_name: string
  last_name: string
  position: string
  department: string
  branch: string
  status: EmployeeStatus
  gender: "" | "Male" | "Female"
  birthdate: string       // YYYY-MM-DD
  date_hired: string      // YYYY-MM-DD
  date_separated: string  // YYYY-MM-DD — resigned/terminated date
  company_email: string   // dapat tumugma sa PesoWise login para sa ODM DTR
  personal_email: string
  contact_no: string
  bio_id: string
  dtr_username: string
  notes: string
  created_at: string
  updated_at: string
}

export const HOLIDAY_TYPES = [
  { key: "regular", label: "Regular Holiday", color: "#f472b6" },   // pink — kapareho ng LHIKE legend
  { key: "special", label: "Special Holiday", color: "#2dd4bf" },   // teal
  { key: "double", label: "Double Holiday", color: "#a78bfa" },     // purple
] as const
export type HolidayType = (typeof HOLIDAY_TYPES)[number]["key"]

export type HrHoliday = { id: string; date: string; name: string; type: HolidayType }
export type HrEvent = { id: string; date: string; name: string; description: string }

export const uid = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
export const fullNameOf = (e: Pick<HrEmployee, "first_name" | "middle_name" | "last_name">) =>
  [e.first_name, e.middle_name, e.last_name].map(s => String(s || "").trim()).filter(Boolean).join(" ")

// ── Storage-JSON na dokumento ────────────────────────────────────────────────
async function docPath(doc: string): Promise<string | null> {
  const businessId = await getBusinessId()
  return businessId ? `hr/${businessId}/${doc}.json` : null
}

async function readDoc<T>(doc: string, fallback: T): Promise<T> {
  const path = await docPath(doc)
  if (!path) return fallback
  const supabase = createSupabaseBrowserClient()
  const { data, error } = await supabase.storage.from(HR_BUCKET).download(path)
  if (error || !data) return fallback   // wala pang file = walang laman pa
  try { return JSON.parse(await data.text()) as T } catch { return fallback }
}

async function writeDoc<T>(doc: string, value: T): Promise<void> {
  const path = await docPath(doc)
  if (!path) throw new Error("Walang business — hindi makapag-save.")
  const supabase = createSupabaseBrowserClient()
  const blob = new Blob([JSON.stringify(value)], { type: "application/json" })
  // remove-then-upload: walang UPDATE policy ang bucket, kaya hindi puwede ang upsert.
  await supabase.storage.from(HR_BUCKET).remove([path]).catch(() => {})
  const { error } = await supabase.storage.from(HR_BUCKET).upload(path, blob, { contentType: "application/json" })
  if (error) throw new Error(error.message)
}

// ── Generic hook factory — iisang pattern para sa tatlong doc ────────────────
function useHrDoc<T extends { id: string }>(doc: string) {
  const [rows, setRows] = useState<T[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const list = await readDoc<T[]>(doc, [])
    setRows(Array.isArray(list) ? list : [])
    setLoaded(true)
  }, [doc])

  useEffect(() => { refresh() }, [refresh])

  const persist = useCallback(async (next: T[]) => {
    setRows(next)                 // optimistic — mabilis ang UI
    await writeDoc(doc, next)
  }, [doc])

  const add = useCallback(async (row: T) => {
    const list = await readDoc<T[]>(doc, [])
    await persist([row, ...list.filter(r => r.id !== row.id)])
  }, [doc, persist])

  const update = useCallback(async (id: string, patch: Partial<T>) => {
    const list = await readDoc<T[]>(doc, [])
    await persist(list.map(r => (r.id === id ? { ...r, ...patch } : r)))
  }, [doc, persist])

  const remove = useCallback(async (id: string) => {
    const list = await readDoc<T[]>(doc, [])
    await persist(list.filter(r => r.id !== id))
  }, [doc, persist])

  return { rows, loaded, refresh, add, update, remove }
}

export function useHrEmployees() { return useHrDoc<HrEmployee>("employees") }
export function useHrHolidays() { return useHrDoc<HrHoliday>("holidays") }
export function useHrEvents() { return useHrDoc<HrEvent>("events") }

// ── Mga shared na derivation (dashboard + DTR) ───────────────────────────────
export const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

export function birthdayCelebrants(list: HrEmployee[], month: number) {
  return list
    .filter(e => e.status === "Active" && e.birthdate && Number(e.birthdate.slice(5, 7)) === month + 1)
    .sort((a, b) => a.birthdate.slice(8, 10).localeCompare(b.birthdate.slice(8, 10)))
}

export function newlyHired(list: HrEmployee[], days = 30) {
  const cutoff = Date.now() - days * 86400000
  return list
    .filter(e => e.date_hired && new Date(e.date_hired + "T00:00:00").getTime() >= cutoff)
    .sort((a, b) => b.date_hired.localeCompare(a.date_hired))
}

export function holidaysInMonth(list: HrHoliday[], year: number, month: number) {
  const pre = `${year}-${String(month + 1).padStart(2, "0")}`
  return list.filter(h => h.date.startsWith(pre)).sort((a, b) => a.date.localeCompare(b.date))
}

export function eventsInMonth(list: HrEvent[], year: number, month: number) {
  const pre = `${year}-${String(month + 1).padStart(2, "0")}`
  return list.filter(e => e.date.startsWith(pre)).sort((a, b) => a.date.localeCompare(b.date))
}
