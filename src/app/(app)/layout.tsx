"use client"
import { useState, useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import { Sidebar } from "@/components/layout/Sidebar"
import { Topbar } from "@/components/layout/Topbar"
import { UpgradeModal } from "@/components/modals/UpgradeModal"
import { createSupabaseBrowserClient } from "@/lib/supabase"
import { PagesProvider } from "@/lib/pages-store"
import { syncRosterFromSupabase } from "@/lib/users-store"
import type { AppMode, Plan } from "@/lib/types"

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [mode, setMode] = useState<AppMode>("personal")
  const [user, setUser] = useState<{
    name: string; email: string; plan: Plan; trial_ends_at: string | null
  }>({ name: "", email: "", plan: "trial", trial_ends_at: null })

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

      // Refresh the ERP roster/permissions cache from Supabase so accessFor() (Sidebar) and
      // User Management see the latest shared state on every app load, not stale per-browser data.
      syncRosterFromSupabase()
    }
    loadUser()
  }, [router])

  useEffect(() => {
    if (pathname.startsWith("/business")) setMode("business")
    else setMode("personal")
  }, [pathname])

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push("/login")
  }

  function handleToggleMode() {
    if (user.plan !== "premium") { setShowUpgrade(true); return }
    if (mode === "personal") { setMode("business"); router.push("/business/dashboard") }
    else { setMode("personal"); router.push("/dashboard") }
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      <div className={`fixed lg:static inset-y-0 left-0 z-30 transition-transform duration-200 ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>
        <Sidebar mode={mode} plan={user.plan} userName={user.name} onLogout={handleLogout} />
      </div>
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Topbar
          mode={mode}
          plan={user.plan}
          trialEndsAt={user.trial_ends_at}
          onToggleMode={handleToggleMode}
          onToggleSidebar={() => setSidebarOpen(s => !s)}
          onUpgrade={() => setShowUpgrade(true)}
        />
        <main className="flex-1 overflow-y-auto px-6 pt-4 pb-6">
          <PagesProvider>{children}</PagesProvider>
        </main>
      </div>
      {showUpgrade && <UpgradeModal currentPlan={user.plan} onClose={() => setShowUpgrade(false)} />}
    </div>
  )
}
