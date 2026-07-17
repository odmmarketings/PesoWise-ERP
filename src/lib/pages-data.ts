export type PageStatus = "active" | "inactive" | "in-review" | "restricted" | "permanently_disabled"
export type Platform = "Facebook Ecom" | "Instagram" | "TikTok" | "Shopee" | "Lazada"

export interface PageStore {
  id: string
  name: string
  description: string
  owner: string
  platform: Platform
  page_url: string
  shop_id: string
  api_key: string
  pancake_page_id: string
  sender_name: string
  status: PageStatus
  created_by: string
  created_at: string
  archived_at: string | null
}

// Single source of truth — used by Pages & Store and ROAS Tracker
export const pagesData: PageStore[] = [
  { id: "1", name: "ODM Marketing PH", description: "Main Facebook store for ODM marketing products.", owner: "Larry Lobitana", platform: "Facebook Ecom", page_url: "https://facebook.com/odmmarketing", shop_id: "SH001xxxx", api_key: "ak_xxxxxxxxxxxxxxxxxxxxxxxxxxx", pancake_page_id: "PP001xxxx", sender_name: "ODM Team", status: "active", created_by: "Admin", created_at: "2026-01-15", archived_at: null },
  { id: "2", name: "ODM Shopee Store", description: "Shopee official store", owner: "Larry Lobitana", platform: "Shopee", page_url: "https://shopee.ph/odm", shop_id: "SH002xxxx", api_key: "ak_yyy", pancake_page_id: "", sender_name: "ODM Shopee", status: "active", created_by: "Admin", created_at: "2026-02-01", archived_at: null },
  { id: "3", name: "ODM TikTok Shop", description: "TikTok shop", owner: "Staff 1", platform: "TikTok", page_url: "https://tiktok.com/@odm", shop_id: "SH003xxxx", api_key: "", pancake_page_id: "", sender_name: "", status: "in-review", created_by: "Admin", created_at: "2026-03-10", archived_at: null },
  { id: "4", name: "ODM Instagram", description: "Instagram page", owner: "Staff 2", platform: "Instagram", page_url: "https://instagram.com/odm", shop_id: "SH004xxxx", api_key: "ak_zzz", pancake_page_id: "", sender_name: "ODM Insta", status: "active", created_by: "Admin", created_at: "2026-04-01", archived_at: null },
]
