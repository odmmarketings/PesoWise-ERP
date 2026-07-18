import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Browser client (anon key) — SINGLETON. Dating gumagawa ito ng bagong client bawat
// tawag, kaya nagkaka-maraming GoTrueClient na naglalaban sa iisang session storage
// ("Multiple GoTrueClient instances"). Sa bagong login (empty localStorage) nag-fe-fetch
// ang mga store bago ma-set ang session → unauthenticated queries → RLS blank → 0 data.
// Iisang instance na lang: isang session, walang race, lahat ng store authenticated.
let browserClient: SupabaseClient | null = null
export function createSupabaseBrowserClient() {
  if (typeof window === "undefined") {
    // SSR/prerender: ephemeral, walang session persistence.
    return createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } })
  }
  if (!browserClient) browserClient = createClient(supabaseUrl, supabaseAnonKey)
  return browserClient
}

// Server client (service role key) — server-side only
export function createSupabaseServerClient() {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
