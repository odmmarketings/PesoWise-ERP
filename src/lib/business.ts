"use client"
import { createSupabaseBrowserClient } from "@/lib/supabase"

// Single-business helper — this deployment serves one company, so every business-scoped
// store just needs "the" business id. Cached in-memory per page load (cheap to re-fetch on
// a fresh navigation, avoids a network round trip on every store call).
let cachedBusinessId: string | null = null

export async function getBusinessId(): Promise<string | null> {
  if (cachedBusinessId) return cachedBusinessId
  const supabase = createSupabaseBrowserClient()
  const { data } = await supabase.from("businesses").select("id").limit(1).maybeSingle()
  cachedBusinessId = data?.id || null
  return cachedBusinessId
}
