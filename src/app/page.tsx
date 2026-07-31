"use client"
import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  X, Check, ChevronRight, TrendingUp, Shield, Smartphone, Brain,
  BarChart3, Bell, Camera, Wallet, Building2, Star
} from "lucide-react"

function IntroModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden relative">
        <div className="bg-gradient-to-br from-green-600 to-emerald-700 p-8 text-white text-center">
          <div className="text-5xl mb-3">💰</div>
          <h2 className="text-2xl font-bold">Welcome to PesoWise</h2>
          <p className="text-green-100 mt-2 text-sm">Your all-in-one Philippine finance companion</p>
        </div>
        <button onClick={onClose} className="absolute top-4 right-4 text-white/70 hover:text-white">
          <X className="w-5 h-5" />
        </button>
        <div className="p-6 space-y-4">
          <div className="flex gap-4">
            <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0">
              <Wallet className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Sales &amp; Logistics</h3>
              <p className="text-sm text-slate-500">Live Pancake POS orders, warehouse pipeline, PPW monitoring, and barcode-driven Shipped Out scanning.</p>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
              <Building2 className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Full Business ERP</h3>
              <p className="text-sm text-slate-500">Inventory, bookkeeping, income statement, ad spend and ROAS, suppliers, and user management.</p>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
              <Brain className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">AI-Powered Features</h3>
              <p className="text-sm text-slate-500">Just chat your expenses, screenshot your bank app, and let AI handle the rest. Built for busy Filipinos.</p>
            </div>
          </div>
          <div className="pt-2 flex gap-3">
            <Button className="flex-1" asChild>
              <Link href="/register" onClick={onClose}>Start Free Trial</Link>
            </Button>
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Explore Features
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

const features = [
  { icon: <BarChart3 className="w-6 h-6" />, color: "bg-green-50 text-green-600", title: "Smart Dashboard", desc: "Monthly totals, trends, and category breakdowns at a glance." },
  { icon: <Brain className="w-6 h-6" />, color: "bg-purple-50 text-purple-600", title: "AI Expense Logger", desc: "Just type what you spent — AI auto-categorizes everything for you." },
  { icon: <Camera className="w-6 h-6" />, color: "bg-blue-50 text-blue-600", title: "Screenshot Bank Updates", desc: "Screenshot your bank app and AI reads your balance automatically." },
  { icon: <TrendingUp className="w-6 h-6" />, color: "bg-amber-50 text-amber-600", title: "Net Worth Tracker", desc: "Track savings across all banks and compute your real net worth." },
  { icon: <Bell className="w-6 h-6" />, color: "bg-red-50 text-red-600", title: "Bill Reminders", desc: "Never miss a bill. Get notified before due dates, auto-cleared when paid." },
  { icon: <Building2 className="w-6 h-6" />, color: "bg-indigo-50 text-indigo-600", title: "Business ERP Mode", desc: "Full ERP with sales tracker, ROAS, inventory, HR, and bookkeeping." },
  { icon: <Smartphone className="w-6 h-6" />, color: "bg-pink-50 text-pink-600", title: "Auto Monthly Reports", desc: "AI-generated slideshow of your finances — bi-weekly and monthly." },
  { icon: <Shield className="w-6 h-6" />, color: "bg-slate-50 text-slate-600", title: "50/40/10 Money Guide", desc: "AI coaches you on splitting income into Needs, Investments, and Wants." },
]

const plans = [
  {
    name: "14-Day Trial",
    price: "Free",
    period: "",
    badge: null,
    highlight: false,
    description: "Try PesoWise risk-free",
    included: ["20 expenses per month", "3 expense categories", "Basic dashboard", "No credit card required"],
    excluded: ["Full charts & reports", "AI features", "Bill reminders", "Export & more"],
    cta: "Start Free Trial",
    href: "/register",
    variant: "outline" as const,
  },
  {
    name: "Pro",
    price: "₱499",
    period: "/month",
    badge: "Most Popular",
    highlight: true,
    description: "Everything you need to manage your money",
    included: [
      "Unlimited expenses & categories",
      "Full dashboard with charts",
      "Month vs month comparison",
      "Budget per category",
      "Income & net savings tracking",
      "Search, tags, filters",
      "Export CSV & PDF",
      "Multi-device sync",
    ],
    excluded: [],
    cta: "Get Pro",
    href: "/register?plan=pro",
    variant: "default" as const,
  },
  {
    name: "Premium",
    price: "₱999",
    period: "/month",
    badge: "Best Value",
    highlight: false,
    description: "AI-powered finance + Business ERP",
    included: [
      "Everything in Pro",
      "AI Chat Expense Logger",
      "Screenshot → Auto Bank Update",
      "Savings & Net Worth Tracker",
      "Bill Reminders & Notifications",
      "Monthly Report Presentation",
      "50/40/10 Money Guide + AI Coach",
      "Dream Purchase Tracker",
      "Business ERP Mode (full)",
      "Receipt photo upload",
      "Priority support",
    ],
    excluded: [],
    cta: "Get Premium",
    href: "/register?plan=premium",
    variant: "premium" as const,
  },
]

const testimonials = [
  { name: "Marco S.", role: "Freelancer, Cebu", text: "Grabe, dati hindi ko alam saan napupunta pera ko. PesoWise literally changed how I manage my income. Yung AI chat feature — sulit na sulit!" },
  { name: "Janelle R.", role: "Business Owner, Manila", text: "Yung Business ERP mode is what sold me. Sales tracker + ROAS in one place. Hindi na kailangan ng maraming apps!" },
  { name: "Carlo M.", role: "OFW, Dubai", text: "Screenshot lang ng bank statement ko tapos updated na agad ang savings tracker. Perfect for tracking remittances." },
]

export default function LandingPage() {
  const [showIntro, setShowIntro] = useState(false)

  return (
    <div className="min-h-screen bg-white">
      {showIntro && <IntroModal onClose={() => setShowIntro(false)} />}

      {/* Navbar */}
      <nav className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <button onClick={() => setShowIntro(true)} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 rounded-lg bg-green-600 flex items-center justify-center text-white font-bold text-sm">₱</div>
            <span className="font-bold text-slate-900 text-lg">PesoWise</span>
          </button>
          <div className="hidden md:flex items-center gap-6 text-sm text-slate-600">
            <a href="#features" className="hover:text-slate-900 transition-colors">Features</a>
            <a href="#pricing" className="hover:text-slate-900 transition-colors">Pricing</a>
            <a href="#testimonials" className="hover:text-slate-900 transition-colors">Reviews</a>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/login">Login</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/register">Start Free Trial</Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-green-950 to-slate-900 text-white py-24 px-4">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-green-800/20 via-transparent to-transparent" />
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <div className="inline-flex items-center gap-2 bg-green-900/50 border border-green-700/50 rounded-full px-4 py-1.5 text-green-300 text-xs font-medium mb-6">
            🇵🇭 Built for Filipinos
          </div>
          <h1 className="text-4xl md:text-6xl font-bold leading-tight mb-6">
            Pamahalaan ang Pera Mo
            <span className="block text-green-400 mt-2">The Smart Way</span>
          </h1>
          <p className="text-xl text-slate-300 max-w-2xl mx-auto mb-10">
            Buong business ERP sa isang app — sales, logistics, inventory, ad spend, at bookkeeping. Gawa para sa Philippine COD sellers.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="xl" asChild>
              <Link href="/register">
                Start 14-Day Free Trial <ChevronRight className="w-5 h-5" />
              </Link>
            </Button>
            <Button size="xl" variant="outline" className="border-slate-600 text-white bg-white/5 hover:bg-white/10" onClick={() => setShowIntro(true)}>
              Learn More
            </Button>
          </div>
          <p className="text-sm text-slate-500 mt-4">No credit card required • Cancel anytime</p>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 px-4 bg-slate-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-slate-900 mb-3">Everything you need, wala nang iba</h2>
            <p className="text-slate-500 max-w-xl mx-auto">From daily expense tracking to full business ERP — PesoWise handles it all.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((f) => (
              <div key={f.title} className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
                <div className={`w-12 h-12 rounded-xl ${f.color} flex items-center justify-center mb-4`}>{f.icon}</div>
                <h3 className="font-semibold text-slate-900 mb-2">{f.title}</h3>
                <p className="text-sm text-slate-500">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 px-4 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-slate-900 mb-3">Simple, transparent pricing</h2>
            <p className="text-slate-500">Start free, upgrade when you&apos;re ready.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`rounded-2xl border p-8 relative flex flex-col ${
                  plan.badge === "Most Popular"
                    ? "border-green-500 shadow-lg shadow-green-100"
                    : plan.badge === "Best Value"
                    ? "border-purple-400 shadow-lg shadow-purple-100 bg-gradient-to-br from-purple-50 to-white"
                    : "border-slate-200"
                }`}
              >
                {plan.badge && (
                  <div className={`absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${plan.badge === "Most Popular" ? "bg-green-600 text-white" : "bg-purple-600 text-white"}`}>
                    {plan.badge}
                  </div>
                )}
                <div className="mb-6">
                  <h3 className="text-lg font-bold text-slate-900">{plan.name}</h3>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-3xl font-bold text-slate-900">{plan.price}</span>
                    <span className="text-slate-500 text-sm">{plan.period}</span>
                  </div>
                  <p className="text-sm text-slate-500 mt-1">{plan.description}</p>
                </div>
                <ul className="space-y-3 flex-1 mb-6">
                  {plan.included.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                      <Check className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                  {plan.excluded.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-slate-400">
                      <X className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span className="line-through">{f}</span>
                    </li>
                  ))}
                </ul>
                <Button variant={plan.variant} className="w-full" asChild>
                  <Link href={plan.href}>{plan.cta}</Link>
                </Button>
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-slate-400 mt-8">Annual plans available — save up to ₱2,998/year</p>
        </div>
      </section>

      {/* Testimonials */}
      <section id="testimonials" className="py-20 px-4 bg-slate-50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-slate-900 text-center mb-12">What Filipinos are saying</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map((t) => (
              <div key={t.name} className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
                <div className="flex mb-3">{[...Array(5)].map((_, i) => <Star key={i} className="w-4 h-4 text-amber-400 fill-amber-400" />)}</div>
                <p className="text-sm text-slate-600 mb-4 italic">&quot;{t.text}&quot;</p>
                <p className="font-semibold text-sm text-slate-900">{t.name}</p>
                <p className="text-xs text-slate-400">{t.role}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4 bg-gradient-to-br from-green-600 to-emerald-700 text-white text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold mb-4">Handa ka na bang mag-ipon?</h2>
          <p className="text-green-100 mb-8">Join thousands of Filipinos managing their finances smarter with PesoWise.</p>
          <Button size="xl" className="bg-white text-green-700 hover:bg-green-50" asChild>
            <Link href="/register">Start Your Free 14-Day Trial <ChevronRight className="w-5 h-5" /></Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-10 px-4">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-green-600 flex items-center justify-center text-white font-bold text-xs">₱</div>
            <span className="font-semibold text-white">PesoWise</span>
          </div>
          <p className="text-sm">© {new Date().getFullYear()} PesoWise. All rights reserved.</p>
          <div className="flex gap-4 text-sm">
            <a href="/privacy" className="hover:text-white transition-colors">Privacy</a>
            <a href="/terms" className="hover:text-white transition-colors">Terms</a>
            <a href="/contact" className="hover:text-white transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
