"use client"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard, Receipt, Target, TrendingUp, Bell, FileText,
  Wallet, Settings, Users, ShoppingBag, Package,
  UserCheck, DollarSign, LogOut, ChevronRight,
  Activity, Store, PieChart, ShoppingCart, FlaskConical,
  Shield, Calculator, Boxes, BookOpen, ChevronDown, Banknote, Droplet,
  ClipboardList, Factory, Warehouse, Undo2,
  Megaphone, Link2, BarChart3, Award, Coins, CreditCard, Repeat
} from "lucide-react"
import type { AppMode, Plan } from "@/lib/types"
import { useState, useEffect, useMemo } from "react"
import { accessFor } from "@/lib/users-store"

const personalNav = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/expenses", icon: Receipt, label: "Expenses" },
  { href: "/income", icon: DollarSign, label: "Income" },
  { href: "/budgets", icon: Target, label: "Budgets" },
  { href: "/savings", icon: TrendingUp, label: "Savings & Net Worth", plan: "premium" as Plan },
  { href: "/bills", icon: Bell, label: "Bill Reminders", plan: "premium" as Plan },
  { href: "/reports", icon: FileText, label: "Reports", plan: "premium" as Plan },
  { href: "/money-guide", icon: Wallet, label: "50/40/10 Guide", plan: "premium" as Plan },
]

type NavChild = { href: string; label: string }
type NavItem = { href: string; icon: any; label: string; plan?: Plan; children?: NavChild[] }
type NavSection = { section: string; items: NavItem[] }

// Exported for User Management: the Change Role screen builds its permission checkboxes
// from this catalog, and the sidebar filters itself against the user's allowed hrefs.
export const businessNav: NavSection[] = [
  {
    section: "DASHBOARD",
    items: [
      { href: "/business/dashboard", icon: Activity, label: "Sales Warehouse Logistics" },
      { href: "/business/finance", icon: PieChart, label: "Finance" },
    ],
  },
  {
    section: "E-COMMERCE",
    items: [
      { href: "/business/ecommerce/pages", icon: Store, label: "Pages & Store" },
      { href: "/business/ecommerce/roas", icon: Activity, label: "Page ROAS Tracker" },
      { href: "/business/ecommerce/adspent", icon: DollarSign, label: "Adspent ROAS Summary" },
      { href: "/business/ecommerce/sales", icon: ShoppingCart, label: "Sales Tracker" },
      { href: "/business/ecommerce/testing", icon: FlaskConical, label: "Product Testing" },
      { href: "/business/ecommerce/bm", icon: Shield, label: "BM & Ad Account" },
      { href: "/business/ecommerce/profitability", icon: Calculator, label: "Profitability Formula" },
    ],
  },
  {
    section: "ADS",
    items: [
      { href: "/business/ads", icon: BarChart3, label: "Ads Overview" },
      { href: "/business/ads/facebook", icon: Megaphone, label: "Facebook Ads" },
      { href: "/business/ads/tiktok", icon: Activity, label: "TikTok Ads" },
      { href: "/business/ads/shopee", icon: ShoppingBag, label: "Shopee Ads" },
      { href: "/business/ads/lazada", icon: Package, label: "Lazada Ads" },
      { href: "/business/ads/accounts", icon: Link2, label: "Ad Accounts" },
    ],
  },
  {
    section: "REPORTS",
    items: [
      { href: "/business/reports/sales", icon: TrendingUp, label: "Sales Report" },
      { href: "/business/reports/adspend", icon: DollarSign, label: "Ad Spend Report" },
      { href: "/business/reports/pnl", icon: FileText, label: "P&L / Net" },
    ],
  },
  {
    section: "SALES CHANNELS",
    items: [
      { href: "/business/channels", icon: BarChart3, label: "Channel Overview" },
      { href: "/business/channels/tiktok", icon: Activity, label: "TikTok Shop" },
      { href: "/business/channels/shopee", icon: ShoppingBag, label: "Shopee" },
      { href: "/business/channels/lazada", icon: Package, label: "Lazada" },
    ],
  },
  {
    section: "AFFILIATES",
    items: [
      { href: "/business/affiliates", icon: PieChart, label: "Affiliate Overview" },
      { href: "/business/affiliates/list", icon: Users, label: "Affiliates" },
      { href: "/business/affiliates/sales", icon: DollarSign, label: "Affiliate Sales" },
      { href: "/business/affiliates/leaderboard", icon: Award, label: "Leaderboard" },
      { href: "/business/affiliates/commissions", icon: Coins, label: "Commissions" },
    ],
  },
  {
    section: "PROBLEM MANAGEMENT",
    items: [
      { href: "/business/board", icon: ClipboardList, label: "Problem Cost Solution" },
      { href: "/business/board/settings", icon: Settings, label: "Departments" },
    ],
  },
  {
    section: "FINANCE",
    items: [
      { href: "/business/finance/income-statement", icon: FileText, label: "Income Statement" },
      { href: "/business/finance/bookkeeping", icon: BookOpen, label: "Bookkeeping" },
      { href: "/business/finance/reimbursement", icon: Banknote, label: "Reimbursement" },
      { href: "/business/finance/utility-expense", icon: Droplet, label: "Utility Expense" },
      { href: "/business/finance/cards", icon: CreditCard, label: "Cards" },
      { href: "/business/finance/fb-billing", icon: Receipt, label: "FB Billing" },
      { href: "/business/finance/subscriptions", icon: Repeat, label: "Subscriptions" },
      { href: "/business/finance/settings", icon: Settings, label: "Settings" },
    ],
  },
  {
    section: "LOGISTIC & INVENTORY",
    items: [
      { href: "/business/logistics/purchase-order", icon: ClipboardList, label: "Purchase Order" },
      { href: "/business/logistics/supplier", icon: Factory, label: "Supplier" },
      {
        href: "/business/logistics/inventory", icon: Package, label: "Inventory",
        children: [
          // Ang parent row ay nag-e-expand lang, kaya sariling link ang dashboard.
          { href: "/business/logistics/inventory", label: "Inventory Dashboard" },
          { href: "/business/logistics/inventory/products", label: "Product Items" },
          { href: "/business/logistics/inventory/unit-codes", label: "Unit Codes" },
          { href: "/business/logistics/inventory/stocks", label: "Stocks" },
          { href: "/business/logistics/inventory/transactions", label: "Transaction History" },
        ],
      },
      {
        href: "/business/logistics/warehouse", icon: Warehouse, label: "Warehouse",
        children: [
          // Ang parent row ay nag-e-expand lang (hindi nag-na-navigate), kaya kailangan
          // ng sariling child link para maabot ang dashboard mismo.
          { href: "/business/logistics/warehouse", label: "Warehouse Dashboard" },
          { href: "/business/logistics/warehouse/fulfillment", label: "Fulfillment" },
          { href: "/business/logistics/warehouse/shipped-out", label: "Shipped Out (Barcode)" },
          { href: "/business/logistics/warehouse/ppw", label: "PPW (Barcode)" },
        ],
      },
      { href: "/business/logistics/rts", icon: Undo2, label: "RTS Items" },
      { href: "/business/logistics/settings", icon: Settings, label: "Settings" },
    ],
  },
  {
    section: "HR",
    items: [
      { href: "/business/hr", icon: UserCheck, label: "HR Management" },
      { href: "/business/hr/payroll", icon: DollarSign, label: "Payroll" },
    ],
  },
  {
    section: "USERS",
    items: [
      { href: "/business/users", icon: Users, label: "User Management" },
    ],
  },
]

interface SidebarProps {
  mode: AppMode
  plan: Plan
  userName: string
  onLogout: () => void
}

export function Sidebar({ mode, plan, userName, onLogout }: SidebarProps) {
  const pathname = usePathname()
  const [collapsedSections, setCollapsedSections] = useState<string[]>([])

  // User Management enforcement: business nav is filtered to the logged-in user's allowed
  // pages (roster in users-store). No roster match / Mother Account → full nav.
  const [access, setAccess] = useState<{ full: boolean; allowed: Set<string> } | null>(null)
  useEffect(() => { setAccess(accessFor([])) }, [pathname])
  const visibleBusinessNav = useMemo(() => {
    if (!access || access.full) return businessNav
    return businessNav
      .map(s => ({
        ...s,
        items: s.items
          .map(i => i.children?.length ? { ...i, children: i.children.filter(c => access.allowed.has(c.href)) } : i)
          .filter(i => i.children ? i.children.length > 0 : access.allowed.has(i.href)),
      }))
      .filter(s => s.items.length > 0)
  }, [access])

  // The single active nav item = the LONGEST href that exactly matches or is a path-segment
  // prefix of the current route. Prevents a parent like /business/finance from staying
  // highlighted on a child route like /business/finance/income-statement.
  const bestHref = businessNav
    .flatMap(s => s.items.flatMap(i => [i.href, ...(i.children?.map(c => c.href) || [])]))
    .filter(h => pathname === h || pathname.startsWith(h + "/"))
    .sort((a, b) => b.length - a.length)[0]
  const [openMenus, setOpenMenus] = useState<string[]>([])

  const isLocked = (requiredPlan?: Plan) => {
    if (!requiredPlan) return false
    if (plan === "premium") return false
    if (plan === "pro" && requiredPlan === "premium") return true
    if (plan === "trial") return true
    return false
  }

  function toggleSection(section: string) {
    setCollapsedSections(prev =>
      prev.includes(section) ? prev.filter(s => s !== section) : [...prev, section]
    )
  }

  return (
    <aside className="w-64 h-screen bg-slate-900 flex flex-col text-slate-300 flex-shrink-0">
      {/* Logo */}
      <div className="h-16 flex items-center px-6 border-b border-slate-800">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-green-600 flex items-center justify-center text-white font-bold text-sm">₱</div>
          <span className="font-bold text-white text-lg">{mode === "business" ? "PesoWise ERP" : "PesoWise"}</span>
        </Link>
      </div>

      {/* Mode label */}
      <div className="px-4 py-2 border-b border-slate-800">
        <div className={`text-xs font-semibold uppercase tracking-wider px-2 py-1 rounded ${mode === "business" ? "text-blue-400" : "text-green-400"}`}>
          {mode === "business" ? "⚡ Business Mode" : "👤 Personal Finance"}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 pb-4 overflow-y-auto space-y-0.5 scrollbar-dark">
        {mode === "personal" ? (
          // Personal nav — flat list
          <div className="pt-2 space-y-0.5">
            {personalNav.map((item) => {
              const locked = isLocked(item.plan)
              return (
                <Link
                  key={item.href}
                  href={locked ? "#" : item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg transition-colors",
                    pathname === item.href ? "bg-slate-700 text-white" : "hover:bg-slate-800 text-slate-400 hover:text-slate-200",
                    locked && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <item.icon className="w-4 h-4 flex-shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {locked && (
                    <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-medium">PRO</span>
                  )}
                </Link>
              )
            })}
          </div>
        ) : (
          // Business nav — section-grouped (filtered per User Management permissions)
          visibleBusinessNav.map((section) => {
            const collapsed = collapsedSections.includes(section.section)
            const sectionActive = section.items.some(i => i.href === bestHref)
            return (
              <div key={section.section} className="pt-3">
                {/* Section header */}
                <button
                  onClick={() => toggleSection(section.section)}
                  className="w-full flex items-center justify-between px-3 py-1 mb-1 group"
                >
                  <span className="text-[11px] font-semibold tracking-widest text-slate-500 group-hover:text-slate-400 transition-colors">
                    {section.section}
                  </span>
                  <ChevronDown className={cn("w-3 h-3 text-slate-600 transition-transform", collapsed && "-rotate-90")} />
                </button>
                {/* Section items */}
                {!collapsed && (
                  <div className="space-y-0.5">
                    {section.items.map((item) => {
                      const locked = isLocked(item.plan)
                      const active = item.href === bestHref
                      // Collapsible sub-menu (e.g. Inventory → Product Items / Stocks / Unit Codes)
                      if (item.children?.length) {
                        const childActive = item.children.some(c => c.href === bestHref)
                        const open = openMenus.includes(item.href) || childActive
                        return (
                          <div key={item.href}>
                            <button
                              onClick={() => setOpenMenus(prev => prev.includes(item.href) ? prev.filter(h => h !== item.href) : [...prev, item.href])}
                              className={cn(
                                "w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors",
                                childActive ? "text-white" : "hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                              )}
                            >
                              <item.icon className="w-4 h-4 flex-shrink-0" />
                              <span className="flex-1 text-left leading-tight">{item.label}</span>
                              <ChevronDown className={cn("w-3.5 h-3.5 text-slate-500 transition-transform", !open && "-rotate-90")} />
                            </button>
                            {open && (
                              <div className="space-y-0.5">
                                {item.children.map(c => (
                                  <Link key={c.href} href={c.href}
                                    className={cn(
                                      "flex items-center pl-10 pr-3 py-2 text-sm rounded-lg transition-colors",
                                      c.href === bestHref ? "bg-blue-600 text-white" : "hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                                    )}
                                  >
                                    <span className="flex-1 leading-tight">{c.label}</span>
                                  </Link>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      }
                      return (
                        <Link
                          key={item.href}
                          href={locked ? "#" : item.href}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors",
                            active ? "bg-blue-600 text-white" : "hover:bg-slate-800 text-slate-400 hover:text-slate-200",
                            locked && "opacity-50 cursor-not-allowed"
                          )}
                        >
                          <item.icon className="w-4 h-4 flex-shrink-0" />
                          <span className="flex-1 leading-tight">{item.label}</span>
                          {locked && (
                            <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-medium">PRO</span>
                          )}
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        )}
      </nav>

      {/* Bottom */}
      <div className="border-t border-slate-800 p-3 space-y-1">
        <Link href="/settings" className="flex items-center gap-3 px-3 py-2 text-sm rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors">
          <Settings className="w-4 h-4" />
          Settings
        </Link>
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg hover:bg-slate-800 text-slate-400 hover:text-red-400 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
        <div className="px-3 py-2 text-xs text-slate-600 truncate">{userName}</div>
      </div>
    </aside>
  )
}
