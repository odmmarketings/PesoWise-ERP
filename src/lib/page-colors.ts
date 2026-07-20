"use client"
import { useCallback, useEffect, useState } from "react"
import { getEcomSetting, setEcomSetting } from "@/lib/ecom-settings"

// Custom (o auto) na kulay per page — shared via ecommerce_settings.page_colors.
// Kung walang custom, deterministic ang kulay mula sa page id (stable kahit walang set).
const PALETTE = [
  "#fb923c", "#60a5fa", "#34d399", "#f472b6", "#a78bfa", "#fbbf24",
  "#22d3ee", "#f87171", "#4ade80", "#c084fc", "#38bdf8", "#facc15",
  "#fca5a5", "#818cf8", "#2dd4bf", "#e879f9",
]

export function colorForPage(id: string, custom: Record<string, string>): string {
  if (custom[id]) return custom[id]
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

// Readable text color (black/white) para sa isang background hex.
export function textOn(hex: string): string {
  const c = hex.replace("#", "")
  if (c.length < 6) return "#111827"
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? "#111827" : "#ffffff"
}

export function usePageColors() {
  const [colors, setColors] = useState<Record<string, string>>({})
  useEffect(() => {
    getEcomSetting<Record<string, string>>("page_colors").then(c => { if (c) setColors(c) }).catch(() => {})
  }, [])
  const setColor = useCallback((pageId: string, color: string) => {
    setColors(prev => { const next = { ...prev, [pageId]: color }; setEcomSetting("page_colors", next); return next })
  }, [])
  return { colors, setColor }
}
