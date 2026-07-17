"use client"
import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Plus, Search, Filter, X, Edit2, Trash2, ChevronDown } from "lucide-react"

const CATEGORIES = ["All", "Food", "Transport", "Shopping", "Bills", "Health", "Entertainment", "Other"]
const CATEGORY_COLORS: Record<string, string> = {
  Food: "bg-orange-100 text-orange-700",
  Transport: "bg-blue-100 text-blue-700",
  Shopping: "bg-purple-100 text-purple-700",
  Bills: "bg-red-100 text-red-700",
  Health: "bg-green-100 text-green-700",
  Entertainment: "bg-yellow-100 text-yellow-700",
  Other: "bg-slate-100 text-slate-700",
}

// Mock data
const mockExpenses = [
  { id: "1", description: "Jollibee", category: "Food", amount: 185, date: "2026-06-12", tags: ["lunch"], notes: "" },
  { id: "2", description: "Grab", category: "Transport", amount: 95, date: "2026-06-12", tags: [], notes: "To BGC" },
  { id: "3", description: "Meralco Bill", category: "Bills", amount: 2800, date: "2026-06-11", tags: ["monthly"], notes: "" },
  { id: "4", description: "SM Supermarket", category: "Shopping", amount: 1250, date: "2026-06-10", tags: ["groceries"], notes: "" },
  { id: "5", description: "Mercury Drug", category: "Health", amount: 320, date: "2026-06-09", tags: [], notes: "" },
  { id: "6", description: "Netflix", category: "Entertainment", amount: 549, date: "2026-06-08", tags: ["subscription"], notes: "" },
  { id: "7", description: "Mang Inasal", category: "Food", amount: 220, date: "2026-06-07", tags: ["lunch"], notes: "" },
  { id: "8", description: "Globe Postpaid", category: "Bills", amount: 999, date: "2026-06-06", tags: ["monthly"], notes: "" },
]

interface AddExpenseFormProps {
  onClose: () => void
  onSave: (expense: Omit<typeof mockExpenses[0], "id">) => void
}

function AddExpenseForm({ onClose, onSave }: AddExpenseFormProps) {
  const [form, setForm] = useState({
    description: "", category: "Food", amount: "", date: new Date().toISOString().split("T")[0], tags: "", notes: "",
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSave({
      description: form.description,
      category: form.category,
      amount: parseFloat(form.amount),
      date: form.date,
      tags: form.tags ? form.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
      notes: form.notes,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-bold text-slate-900 text-lg">Add Expense</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700">Description <span className="text-red-500">*</span></label>
            <Input className="mt-1" placeholder="e.g. Jollibee, Grab, Meralco" value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700">Amount (₱) <span className="text-red-500">*</span></label>
              <Input className="mt-1" type="number" placeholder="0.00" step="0.01" min="0" value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Date <span className="text-red-500">*</span></label>
              <Input className="mt-1" type="date" value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))} required />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Category <span className="text-red-500">*</span></label>
            <select
              className="mt-1 w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {CATEGORIES.slice(1).map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Tags <span className="text-slate-400 text-xs">(comma separated)</span></label>
            <Input className="mt-1" placeholder="lunch, monthly, work" value={form.tags}
              onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Notes</label>
            <Input className="mt-1" placeholder="Optional notes" value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="submit" className="flex-1">Save Expense</Button>
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  )
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const YEARS = [2024, 2025, 2026]

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState(mockExpenses)
  const [showAdd, setShowAdd] = useState(false)
  const [search, setSearch] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("All")
  const [selectedMonth, setSelectedMonth] = useState("All")
  const [selectedYear, setSelectedYear] = useState("2026")
  const [sortBy, setSortBy] = useState<"date" | "amount">("date")
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc")

  const filtered = useMemo(() => {
    return expenses
      .filter(e => {
        const matchSearch = e.description.toLowerCase().includes(search.toLowerCase()) ||
          e.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))
        const matchCategory = selectedCategory === "All" || e.category === selectedCategory
        const eDate = new Date(e.date)
        const matchMonth = selectedMonth === "All" || eDate.getMonth() === parseInt(selectedMonth)
        const matchYear = eDate.getFullYear() === parseInt(selectedYear)
        return matchSearch && matchCategory && matchMonth && matchYear
      })
      .sort((a, b) => {
        const dir = sortDir === "desc" ? -1 : 1
        if (sortBy === "date") return dir * (new Date(a.date).getTime() - new Date(b.date).getTime())
        return dir * (a.amount - b.amount)
      })
  }, [expenses, search, selectedCategory, selectedMonth, selectedYear, sortBy, sortDir])

  const total = filtered.reduce((s, e) => s + e.amount, 0)

  function handleDelete(id: string) {
    if (confirm("Delete this expense?")) setExpenses(prev => prev.filter(e => e.id !== id))
  }

  function handleAdd(expense: Omit<typeof mockExpenses[0], "id">) {
    setExpenses(prev => [{ ...expense, id: Date.now().toString() }, ...prev])
  }

  return (
    <div className="space-y-6 w-full">
      {showAdd && <AddExpenseForm onClose={() => setShowAdd(false)} onSave={handleAdd} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Expenses</h1>
          <p className="text-slate-500 text-sm mt-0.5">{filtered.length} records Â· {formatCurrency(total)} total</p>
        </div>
        <Button onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4" /> Add Expense
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input className="pl-9" placeholder="Search expenses, tags..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
            <select
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>
              <option value="All">All Months</option>
              {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
            </select>
            <select
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              value={selectedYear} onChange={e => setSelectedYear(e.target.value)}>
              {YEARS.map(y => <option key={y}>{y}</option>)}
            </select>
            <button
              className="h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm flex items-center gap-1 hover:bg-slate-50"
              onClick={() => { setSortBy(s => s === "date" ? "amount" : "date") }}>
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              Sort: {sortBy === "date" ? "Date" : "Amount"}
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 cursor-pointer"
                onClick={e => { e.stopPropagation(); setSortDir(d => d === "desc" ? "asc" : "desc") }} />
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Expense list */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Receipt className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No expenses found</p>
              <p className="text-sm mt-1">Try adjusting your filters or add a new expense.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filtered.map((expense) => (
                <div key={expense.id} className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 group">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-slate-900">{expense.description}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[expense.category] || "bg-slate-100 text-slate-700"}`}>
                        {expense.category}
                      </span>
                      {expense.tags.map(tag => (
                        <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">#{tag}</span>
                      ))}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">{formatDate(expense.date)}{expense.notes && ` Â· ${expense.notes}`}</p>
                  </div>
                  <p className="text-base font-bold text-slate-900">{formatCurrency(expense.amount)}</p>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500" onClick={() => handleDelete(expense.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Receipt({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  )
}

