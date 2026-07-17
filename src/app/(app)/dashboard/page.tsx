"use client"
import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { formatCurrency, formatDateShort } from "@/lib/utils"
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend
} from "recharts"
import { TrendingDown, TrendingUp, Wallet, Receipt, Target, ArrowUpRight, ArrowDownRight, Plus, ChevronLeft, ChevronRight } from "lucide-react"

// Mock data â€” replace with Supabase queries
const monthlyData = [
  { month: "Jan", amount: 18500 },
  { month: "Feb", amount: 22000 },
  { month: "Mar", amount: 19800 },
  { month: "Apr", amount: 25000 },
  { month: "May", amount: 21300 },
  { month: "Jun", amount: 23800 },
]

const categoryData = [
  { name: "Food", amount: 8500, color: "#f97316" },
  { name: "Transport", amount: 4200, color: "#3b82f6" },
  { name: "Shopping", amount: 3800, color: "#a855f7" },
  { name: "Bills", amount: 5200, color: "#ef4444" },
  { name: "Health", amount: 1200, color: "#22c55e" },
  { name: "Other", amount: 900, color: "#64748b" },
]

const dailyData = [
  { day: "1", amount: 850 }, { day: "5", amount: 1200 }, { day: "10", amount: 650 },
  { day: "15", amount: 2100 }, { day: "20", amount: 980 }, { day: "25", amount: 1500 },
  { day: "30", amount: 750 },
]

const recentExpenses = [
  { id: 1, description: "Jollibee", category: "Food", amount: 185, date: "2026-06-12", icon: "ðŸ”" },
  { id: 2, description: "Grab", category: "Transport", amount: 95, date: "2026-06-12", icon: "ðŸš—" },
  { id: 3, description: "Meralco Bill", category: "Bills", amount: 2800, date: "2026-06-11", icon: "ðŸ“„" },
  { id: 4, description: "SM Supermarket", category: "Shopping", amount: 1250, date: "2026-06-10", icon: "ðŸ›’" },
  { id: 5, description: "Mercury Drug", category: "Health", amount: 320, date: "2026-06-09", icon: "ðŸ’Š" },
]

function SummaryCard({ title, value, subtitle, icon, trend, trendValue }: {
  title: string; value: string; subtitle?: string; icon: React.ReactNode
  trend?: "up" | "down" | "neutral"; trendValue?: string
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-500 font-medium">{title}</p>
            <p className="text-2xl font-bold text-slate-900 mt-1 truncate">{value}</p>
            {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
            {trendValue && (
              <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${
                trend === "up" ? "text-red-500" : trend === "down" ? "text-green-500" : "text-slate-500"
              }`}>
                {trend === "up" ? <ArrowUpRight className="w-3 h-3" /> : trend === "down" ? <ArrowDownRight className="w-3 h-3" /> : null}
                {trendValue} vs last month
              </div>
            )}
          </div>
          <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center text-green-600 flex-shrink-0 ml-3">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

export default function DashboardPage() {
  const [currentMonth, setCurrentMonth] = useState(5) // June (0-indexed)
  const [currentYear, setCurrentYear] = useState(2026)

  const totalExpenses = 23800
  const totalIncome = 45000
  const netSavings = totalIncome - totalExpenses
  const lastMonthExpenses = 21300
  const trendPct = Math.round(((totalExpenses - lastMonthExpenses) / lastMonthExpenses) * 100)

  function prevMonth() {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(y => y - 1) }
    else setCurrentMonth(m => m - 1)
  }
  function nextMonth() {
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(y => y + 1) }
    else setCurrentMonth(m => m + 1)
  }

  return (
    <div className="space-y-6 w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-0.5">Welcome back, Juan! Here&apos;s your financial summary.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2">
            <button onClick={prevMonth} className="text-slate-400 hover:text-slate-600">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium text-slate-700 min-w-[120px] text-center">
              {MONTHS[currentMonth]} {currentYear}
            </span>
            <button onClick={nextMonth} className="text-slate-400 hover:text-slate-600">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <Button asChild>
            <a href="/expenses?add=true"><Plus className="w-4 h-4" /> Add Expense</a>
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          title="Total Expenses"
          value={formatCurrency(totalExpenses)}
          icon={<Receipt className="w-5 h-5" />}
          trend={trendPct > 0 ? "up" : "down"}
          trendValue={`${trendPct > 0 ? "+" : ""}${trendPct}%`}
        />
        <SummaryCard
          title="Total Income"
          value={formatCurrency(totalIncome)}
          icon={<Wallet className="w-5 h-5" />}
          subtitle="This month"
        />
        <SummaryCard
          title="Net Savings"
          value={formatCurrency(netSavings)}
          icon={<TrendingUp className="w-5 h-5" />}
          trend={netSavings > 0 ? "down" : "up"}
          trendValue={`${Math.round((netSavings / totalIncome) * 100)}% of income`}
        />
        <SummaryCard
          title="Biggest Category"
          value="Food"
          subtitle={formatCurrency(8500)}
          icon={<Target className="w-5 h-5" />}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly trend */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Monthly Expenses Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyData} barSize={32}>
                <XAxis dataKey="month" axisLine={false} tickLine={false} className="text-xs" />
                <YAxis axisLine={false} tickLine={false} className="text-xs" tickFormatter={v => `₱${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => [formatCurrency(Number(v)), "Expenses"]} />
                <Bar dataKey="amount" fill="#16a34a" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Category breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By Category</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={categoryData} dataKey="amount" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                  {categoryData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2 mt-2">
              {categoryData.slice(0, 4).map((c) => (
                <div key={c.name} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                    <span className="text-slate-600">{c.name}</span>
                  </div>
                  <span className="font-medium text-slate-900">{formatCurrency(c.amount)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Daily trend + Recent expenses */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Daily spending */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Daily Spending â€” {MONTHS[currentMonth]}</CardTitle>
              <div className="flex gap-3 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <TrendingDown className="w-3 h-3 text-green-500" />
                  This month
                </span>
                <span className="flex items-center gap-1">
                  <TrendingUp className="w-3 h-3 text-red-400" />
                  Last month: {formatCurrency(lastMonthExpenses)}
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={dailyData}>
                <XAxis dataKey="day" axisLine={false} tickLine={false} className="text-xs" />
                <YAxis axisLine={false} tickLine={false} className="text-xs" tickFormatter={v => `₱${(v/1000).toFixed(1)}k`} />
                <Tooltip formatter={(v) => [formatCurrency(Number(v)), "Spent"]} />
                <Line type="monotone" dataKey="amount" stroke="#16a34a" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Recent expenses */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Recent Expenses</CardTitle>
              <a href="/expenses" className="text-xs text-green-600 hover:underline">View all</a>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-slate-100">
              {recentExpenses.map((e) => (
                <div key={e.id} className="flex items-center gap-3 px-6 py-3">
                  <span className="text-xl">{e.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{e.description}</p>
                    <p className="text-xs text-slate-400">{e.category} Â· {formatDateShort(e.date)}</p>
                  </div>
                  <span className="text-sm font-semibold text-slate-900">{formatCurrency(e.amount)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

