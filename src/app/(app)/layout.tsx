"use client"
import { useState, useEffect } from "react"
import { RefreshCw } from "lucide-react"
import { useRouter, usePathname } from "next/navigation"
import { Sidebar } from "@/components/layout/Sidebar"
import { Topbar } from "@/components/layout/Topbar"
import { UpgradeModal } from "@/components/modals/UpgradeModal"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { PagesProvider } from "@/lib/pages-store"
import { syncRosterFromSupabase } from "@/lib/users-store"
import type { Plan } from "@/lib/types"

// Kaparehong hugis ng cookie na itinatakda ng /api/auth/login, para pareho ang
// nababasa ng middleware saan man ito manggaling.
const COOKIE_DAYS = { access: 7, refresh: 30 }
function writeSessionCookies(accessToken: string, refreshToken: string) {
  const secure = location.protocol === "https:" ? "; Secure" : ""
  document.cookie = `sb-access-token=${accessToken}; Max-Age=${COOKIE_DAYS.access * 86400}; Path=/; SameSite=Lax${secure}`
  if (refreshToken) {
    document.cookie = `sb-refresh-token=${refreshToken}; Max-Age=${COOKIE_DAYS.refresh * 86400}; Path=/; SameSite=Lax${secure}`
  }
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [user, setUser] = useState<{
    name: string; email: string; plan: Plan; trial_ends_at: string | null
  }>({ name: "", email: "", plan: "trial", trial_ends_at: null })
  // Huwag i-render ang mga page hangga't hindi pa nakaka-authenticate ang Supabase session —
  // kung hindi, mag-fe-fetch ang mga store bago ma-set ang session (child effects run before
  // parent effects) → unauthenticated queries → RLS blank → 0 data sa bagong login.
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    async function loadUser() {
      const supabase = createSupabaseBrowserClient()

      // Try to get session — if expired, read token from cookie and set it
      let { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        const token = document.cookie.split("; ").find(r => r.startsWith("sb-access-token="))?.split("=")[1]
        const refresh = document.cookie.split("; ").find(r => r.startsWith("sb-refresh-token="))?.split("=")[1]
        if (token && refresh) {
          await supabase.auth.setSession({ access_token: token, refresh_token: refresh })
          const res = await supabase.auth.getSession()
          session = res.data.session
        }
      }

      if (!session) { router.push("/login"); return }

      // ── PANATILIHING SARIWA ANG COOKIE ────────────────────────────────────
      // Ang middleware ay ang cookie ang tinitingnan, pero 7 araw lang ang
      // `maxAge` nito at HINDI ito naa-update. Ang Supabase client naman ay
      // kusang nag-re-refresh ng access token (30 araw ang refresh token) —
      // nasa localStorage lang, hindi sa cookie. Kaya eksaktong 7 araw
      // pagkatapos mag-login, patay ang cookie habang buhay pa ang session:
      // mukhang naka-login pa ang UI (localStorage ang pinagkukunan ng pangalan)
      // pero bumabagsak ang LAHAT ng API call. Iyon ang production error noong
      // Ago 6 2026. Isinusulat ngayon ang sariwang token sa bawat pag-load.
      writeSessionCookies(session.access_token, session.refresh_token)

      const { data: profile } = await supabase
        .from("users")
        .select("name, email, plan, trial_ends_at")
        .eq("id", session.user.id)
        .single()

      if (profile) {
        setUser(profile)
        // Expose the logged-in user to feature pages (e.g. Fulfillment "Last Edit By" stamps).
        try { localStorage.setItem("pesowise_current_user", JSON.stringify({ name: profile.name, email: profile.email })) } catch {}
      }

      // ERP roster gate: kung nasa roster ang account pero DISABLED (hindi pa in-ENABLE ng
      // admin, o tinanggalan ng access later), palabasin agad — kahit may dati pang session.
      const { data: member } = await supabase
        .from("business_users").select("enabled").eq("user_id", session.user.id).maybeSingle()
      if (member && !member.enabled) {
        await supabase.auth.signOut()
        document.cookie = "sb-access-token=; Max-Age=0; path=/"
        document.cookie = "sb-refresh-token=; Max-Age=0; path=/"
        router.push("/login")
        return
      }

      // Session confirmed + enabled → safe nang mag-render ang mga page (authenticated na
      // ang shared Supabase client, kaya makikita ng lahat ng store ang data).
      setAuthReady(true)

      // Refresh the ERP roster/permissions cache from Supabase so accessFor() (Sidebar) and
      // User Management see the latest shared state on every app load, not stale per-browser data.
      syncRosterFromSupabase()
    }
    loadUser()

    // Habang bukas ang app, kusang nag-re-refresh ng token ang Supabase. Dapat
    // sumunod ang cookie — kung hindi, luluma ito habang tumatakbo ang session
    // at babagsak ang mga API call kahit hindi umaalis ang user sa page.
    const supabase = createSupabaseBrowserClient()
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.access_token && (event === "TOKEN_REFRESHED" || event === "SIGNED_IN")) {
        writeSessionCookies(session.access_token, session.refresh_token || "")
      }
      if (event === "SIGNED_OUT") {
        document.cookie = "sb-access-token=; Max-Age=0; path=/"
        document.cookie = "sb-refresh-token=; Max-Age=0; path=/"
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [router])

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push("/login")
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Z-INDEX SCALE (huwag baguhin nang hiwalay — magkakabit sila):
            40      sticky <thead> ng mga table
            46      GroupPicker at iba pang dropdown sa loob ng page
            47/48   mobile sidebar backdrop / drawer
            50      modals
          Ang sidebar ay DAPAT mas mataas sa 40 — kung hindi, tumatagos ang
          column headers ng table sa ibabaw ng bukas na drawer sa cellphone.
          Ganoon ang nangyayari dati sa iPhone: kita ang "No / Order Date /
          Page" na nakapatong sa nav. */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-[47] lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      <div className={`fixed lg:static inset-y-0 left-0 z-[48] transition-transform duration-200 ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>
        <Sidebar plan={user.plan} userName={user.name} onLogout={handleLogout} />
      </div>
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Topbar
          plan={user.plan}
          trialEndsAt={user.trial_ends_at}
          onToggleSidebar={() => setSidebarOpen(s => !s)}
          onUpgrade={() => setShowUpgrade(true)}
        />
        <main className="flex-1 overflow-y-auto px-6 pt-4 pb-6">
          {authReady ? (
            <PagesProvider>{children}</PagesProvider>
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="flex items-center gap-3 text-slate-400 text-sm">
                <RefreshCw className="w-4 h-4 animate-spin" /> Loading your data…
              </div>
            </div>
          )}
        </main>
      </div>
      {showUpgrade && <UpgradeModal currentPlan={user.plan} onClose={() => setShowUpgrade(false)} />}
    </div>
  )
}
