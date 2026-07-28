// The logged-in PesoWise user, persisted by the app layout after the Supabase profile loads
// (localStorage `pesowise_current_user`). Used to stamp "who edited" on local records.
export function currentUserName(): string {
  if (typeof window === "undefined") return ""
  try {
    const u = JSON.parse(localStorage.getItem("pesowise_current_user") || "{}")
    return u.name || u.email || ""
  } catch { return "" }
}

// Ang email ng naka-login na account — ito ang katugma ng roster (`business_users.company_email`),
// kaya ito ang gamit sa assignment at permissions (hal. Problem Management).
export function currentUserEmail(): string {
  if (typeof window === "undefined") return ""
  try {
    return String(JSON.parse(localStorage.getItem("pesowise_current_user") || "{}").email || "")
  } catch { return "" }
}
