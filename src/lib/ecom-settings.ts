"use client"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { getBusinessId } from "@/lib/business"

// ──────────────────────────────────────────────────────────────────────────────
// E-commerce settings — one `ecommerce_settings` row per business with a JSONB
// column per concern (FB default token, Product Testing collections, Profitability
// calculator inputs). Column-targeted upserts so each module can save its own slice
// without clobbering the others.
// ──────────────────────────────────────────────────────────────────────────────

export type EcomSettingColumn =
  | "fb_default_token"
  | "pt_collections"
  | "profitability_inputs"
  | "profitability_upgraded"
  | "page_colors"

export async function getEcomSetting<T>(column: EcomSettingColumn): Promise<T | null> {
  const businessId = await getBusinessId()
  if (!businessId) return null
  const supabase = createSupabaseBrowserClient()
  const { data, error } = await supabase
    .from("ecommerce_settings").select(column).eq("business_id", businessId).maybeSingle()
  if (error || !data) return null
  return ((data as Record<string, unknown>)[column] as T) ?? null
}

// Postgres upsert only touches the provided columns on conflict, so this never
// resets the other modules' columns.
export async function setEcomSetting(column: EcomSettingColumn, value: unknown): Promise<void> {
  const businessId = await getBusinessId()
  if (!businessId) return
  const supabase = createSupabaseBrowserClient()
  await supabase.from("ecommerce_settings").upsert(
    { business_id: businessId, [column]: value, updated_at: new Date().toISOString() },
    { onConflict: "business_id" }
  )
}
