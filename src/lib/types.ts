export type Plan = "trial" | "pro" | "premium"
export type AppMode = "personal" | "business"

export interface User {
  id: string
  email: string
  name: string
  plan: Plan
  trial_ends_at: string | null
  subscribed_at: string | null
  paymongo_customer_id: string | null
  referral_code: string
  referred_by: string | null
  created_at: string
}

export interface Expense {
  id: string
  user_id: string
  amount: number
  category: string
  date: string
  notes: string | null
  tags: string[]
  receipt_url: string | null
  created_at: string
}

export interface Category {
  id: string
  user_id: string
  name: string
  budget: number | null
  color: string
  icon: string | null
}

export interface Income {
  id: string
  user_id: string
  amount: number
  source: string
  date: string
  notes: string | null
}

export interface Bill {
  id: string
  user_id: string
  name: string
  amount: number
  due_day: number
  frequency: "monthly" | "weekly" | "yearly"
  last_paid_at: string | null
  is_active: boolean
}

export interface BankAccount {
  id: string
  user_id: string
  bank_name: string
  account_type: string
  balance: number
  updated_at: string
}

export interface DreamPurchase {
  id: string
  user_id: string
  name: string
  target_price: number
  saved_amount: number
  target_date: string | null
  image_url: string | null
}

export const PLAN_LIMITS = {
  trial: {
    max_expenses_per_month: 20,
    max_categories: 3,
    features: [] as string[],
  },
  pro: {
    max_expenses_per_month: Infinity,
    max_categories: Infinity,
    features: ["full_dashboard", "month_comparison", "budgets", "income", "export", "multi_device"],
  },
  premium: {
    max_expenses_per_month: Infinity,
    max_categories: Infinity,
    features: [
      "full_dashboard", "month_comparison", "budgets", "income", "export", "multi_device",
      "ai_chat", "screenshot_bank", "savings_tracker", "net_worth", "bill_reminders",
      "reports", "receipt_upload", "money_guide", "dream_tracker", "ai_coach",
    ],
  },
}

export const PLAN_PRICES = {
  pro: { monthly: 499, annual: 4490 },
  premium: { monthly: 999, annual: 8990 },
}

export const DEFAULT_CATEGORIES = [
  { name: "Food", color: "#f97316", icon: "🍔" },
  { name: "Transport", color: "#3b82f6", icon: "🚗" },
  { name: "Shopping", color: "#a855f7", icon: "🛒" },
  { name: "Bills", color: "#ef4444", icon: "📄" },
  { name: "Health", color: "#22c55e", icon: "💊" },
  { name: "Entertainment", color: "#eab308", icon: "🎮" },
  { name: "Other", color: "#64748b", icon: "📦" },
]
