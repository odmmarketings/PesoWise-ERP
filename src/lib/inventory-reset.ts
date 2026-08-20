"use client"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY RESET MARKER (migration 0032) — ang guhit sa petsa na nagpapa-zero
// ng PPW: ang mga order BAGO ang guhit ay hindi na binibilang.
//
// ⚠ HATI ANG KARAPATAN, AT NASA RLS ANG HATI:
//   • BASA — lahat ng miyembro. Ang guhit ay bahagi ng tanawin ng lahat; kung
//     hindi ito mababasa ng makina ng warehouse, iba ang PPW nila sa PPW mo.
//   • SULAT — may-ari o Mother Account LANG (hiling ng may-ari, Ago 20 2026:
//     "admin lang ang may access"). Wala ritong client-side na tsek na
//     nagpapanggap na kandado: kung susubukan ng staff na isulat ito, ang
//     DATABASE ang tatanggi, hindi ang itsura ng pahina.
// ─────────────────────────────────────────────────────────────────────────────

/** Ang petsa ng guhit ("YYYY-MM-DD"), o "" kung walang reset. */
export async function getPpwResetFrom(): Promise<string> {
  const businessId = await getBusinessId()
  if (!businessId) return ""
  const supabase = createSupabaseBrowserClient()
  const { data, error } = await supabase.from("inventory_resets")
    .select("ppw_from").eq("business_id", businessId).maybeSingle()
  // Kung wala pa ang table (hindi pa tumatakbo ang 0032), walang guhit —
  // bumabalik sa dating asal: lookback lang.
  if (error || !data) return ""
  return String(data.ppw_from || "")
}

/**
 * Itakda ang guhit. Ang RLS ang tunay na bantay — kapag hindi admin ang
 * nakikinabang na session, tatanggihan ito ng Supabase at ibabalik ang error.
 */
export async function setPpwReset(ppwFrom: string, by: string): Promise<string> {
  const businessId = await getBusinessId()
  if (!businessId) return "No business"
  const supabase = createSupabaseBrowserClient()
  const { error } = await supabase.from("inventory_resets").upsert({
    business_id: businessId, ppw_from: ppwFrom,
    reset_at: new Date().toISOString(), reset_by: by,
  }, { onConflict: "business_id" })
  return error ? error.message : ""
}
