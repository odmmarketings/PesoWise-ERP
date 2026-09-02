"use client"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"

// ─────────────────────────────────────────────────────────────────────────────
// PASSWORD NG SUPPLIER MARGIN (migration 0039) — hatol ng may-ari, Ago 31 2026:
// "lagyan mo to ng password, tapos dun din ako pwede mag palit ng password
// mismo sa loob nung pesowise."
//
// ⚠ HASH LANG ANG NAIIMBAK. PBKDF2-SHA256 (120k iterations) na may sariling
// salt kada pagtakda — walang plaintext sa database, sa network, o sa code.
// Ang RLS ng talahanayan ay MAY-ARI LANG (kapareho ng supplier_true_costs),
// kaya ni ang hash ay hindi mababasa ng ibang tauhan.
//
// Ito ay PANG-SCREEN na kandado (ang tabing sa "Show") — ang tunay na
// seguridad ng datos ay ang RLS pa rin. Ang kalaban nito ay ang bukas na
// laptop sa meeting, hindi ang hacker.
// ─────────────────────────────────────────────────────────────────────────────

// ── PURONG BAHAGI — walang import, nate-test sa Node ─────────────────────────
export async function hashPass(pass: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder()
  const salt = new Uint8Array((saltHex.match(/.{2}/g) || []).map(h => parseInt(h, 16)))
  const key = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits"])
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 120_000 }, key, 256)
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("")
}

export function newSaltHex(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return Array.from(b).map(x => x.toString(16).padStart(2, "0")).join("")
}
// ── DULO NG PURONG BAHAGI ────────────────────────────────────────────────────

const missingTable = (e: any) =>
  e && (e.code === "42P01" || /owner_section_pass/.test(String(e?.message || "")))

export type OwnerPassState =
  | { status: "none" }
  | { status: "set"; salt: string; hash: string }
  | { status: "missing-table" }
  | { status: "error"; error: string }

export async function fetchOwnerPass(): Promise<OwnerPassState> {
  const businessId = await getBusinessId()
  if (!businessId) return { status: "error", error: "No business loaded yet." }
  const supabase = createSupabaseBrowserClient()
  const { data, error } = await supabase.from("owner_section_pass")
    .select("pass_hash,salt").eq("business_id", businessId).maybeSingle()
  if (error) return missingTable(error) ? { status: "missing-table" } : { status: "error", error: error.message }
  return data ? { status: "set", salt: data.salt, hash: data.pass_hash } : { status: "none" }
}

/** Itakda (o palitan) ang password — bagong salt kada pagtakda. */
export async function saveOwnerPass(pass: string): Promise<string> {
  const businessId = await getBusinessId()
  if (!businessId) return "No business loaded yet."
  const salt = newSaltHex()
  const pass_hash = await hashPass(pass, salt)
  const supabase = createSupabaseBrowserClient()
  const { error } = await supabase.from("owner_section_pass").upsert({
    business_id: businessId, pass_hash, salt, updated_at: new Date().toISOString(),
  }, { onConflict: "business_id" })
  if (!error) return ""
  return missingTable(error)
    ? "Run migration 0039_owner_section_pass.sql in Supabase first."
    : error.message
}
