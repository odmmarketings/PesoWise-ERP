"use client"
import { useCallback, useEffect, useState } from "react"
import { currentUserName } from "@/lib/current-user"
import { fetchRows, writeRow, deleteRowById } from "@/lib/supa-rows"

// Finance → CARDS — registry ng mga payment cards/wallets na ginagamit sa ad accounts
// (PayMaya, GoTyme, credit cards…). Source of truth = Supabase `finance_cards`;
// `pesowise_finance_cards` localStorage is a same-session read cache. Ad Accounts link
// back via fb_accounts.card_id, kaya makikita per card kung ilang ad account ang nakakabit.
const KEY = "pesowise_finance_cards"

export const CARD_PROVIDERS = [
  "PayMaya", "PayMaya Credit Card", "GoTyme", "GCash", "BPI", "China Bank", "UnionBank", "Other",
]

export interface FinanceCard {
  id: string
  name: string              // Account Name
  account_number: string
  qr_data: string           // uploaded QR image (data URL) or ""
  expiry: string            // MM/YY
  cvv: string
  provider: string          // PayMaya / GoTyme / …
  remarks: string
  created_by: string
  created_at: string        // ISO
}
export type NewCardInput = Omit<FinanceCard, "id" | "created_by" | "created_at">

function uid() { return `card_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }
function normalize(r: Partial<FinanceCard>): FinanceCard {
  return {
    id: r.id || uid(),
    name: r.name || "",
    account_number: r.account_number || "",
    qr_data: r.qr_data || "",
    expiry: r.expiry || "",
    cvv: r.cvv || "",
    provider: r.provider || "",
    remarks: r.remarks || "",
    created_by: r.created_by || "",
    created_at: r.created_at || new Date().toISOString(),
  }
}

function readCache(): FinanceCard[] {
  if (typeof window === "undefined") return []
  try { const raw = localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as Partial<FinanceCard>[]).map(normalize) : [] }
  catch { return [] }
}
function writeCache(list: FinanceCard[]) { try { localStorage.setItem(KEY, JSON.stringify(list)) } catch {} }
const byNewest = (a: FinanceCard, b: FinanceCard) => (b.created_at || "").localeCompare(a.created_at || "")

// Masked number for display: last 4 digits only.
export function maskCardNumber(n: string) {
  const s = String(n || "").replace(/\s/g, "")
  return s.length > 4 ? "•••• ".repeat(3) + s.slice(-4) : s
}

export function useFinanceCards() {
  const [cards, setCards] = useState<FinanceCard[]>([])
  useEffect(() => {
    setCards(readCache())
    fetchRows("finance_cards", normalize, readCache, writeCache).then(list => { if (list) setCards([...list].sort(byNewest)) })
  }, [])
  const persist = useCallback((next: FinanceCard[]) => { writeCache(next); setCards(next) }, [])

  function addCard(input: NewCardInput): FinanceCard {
    const created = normalize({ ...input, id: uid(), created_by: currentUserName(), created_at: new Date().toISOString() })
    persist([created, ...cards])
    writeRow("finance_cards", created)
    return created
  }
  function updateCard(id: string, input: Partial<NewCardInput>) {
    const next = cards.map(c => c.id === id ? normalize({ ...c, ...input }) : c)
    persist(next)
    const row = next.find(c => c.id === id)
    if (row) writeRow("finance_cards", row)
  }
  function deleteCard(id: string) {
    persist(cards.filter(c => c.id !== id))
    deleteRowById("finance_cards", id)
  }
  return { cards, addCard, updateCard, deleteCard }
}
