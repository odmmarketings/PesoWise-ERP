"use client"

// Per-sales-channel figures for the SALES CHANNELS module. Each channel rolls up its
// own Net Profit breakdown (Sales − Ad Spend − Affiliate Commission − COG). The order
// data comes from each platform's API (to follow) — figures are 0 until connected.
export type ChannelKey = "tiktok" | "shopee" | "lazada"

export interface ChannelFigures {
  key: ChannelKey
  label: string
  color: string
  sales: number
  adspend: number
  commission: number   // affiliate commission attributed to this channel
  cog: number
  connected: boolean
}

export interface ChannelNet extends ChannelFigures {
  net: number
}

export const CHANNELS: { key: ChannelKey; label: string; color: string }[] = [
  { key: "tiktok", label: "TikTok Shop", color: "bg-slate-800" },
  { key: "shopee", label: "Shopee", color: "bg-orange-500" },
  { key: "lazada", label: "Lazada", color: "bg-indigo-600" },
]

export function netOf(c: ChannelFigures): ChannelNet {
  return { ...c, net: c.sales - c.adspend - c.commission - c.cog }
}

// Hook — returns each channel's figures. APIs not wired yet, so all zero / not connected.
// Swap the zeros for real fetches per platform in Phase 2.
export function useChannelFigures(): ChannelNet[] {
  return CHANNELS.map(c => netOf({
    key: c.key, label: c.label, color: c.color,
    sales: 0, adspend: 0, commission: 0, cog: 0, connected: false,
  }))
}
