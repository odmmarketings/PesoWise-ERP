// The logged-in PesoWise user, persisted by the app layout after the Supabase profile loads
// (localStorage `pesowise_current_user`). Used to stamp "who edited" on local records.
export function currentUserName(): string {
  if (typeof window === "undefined") return ""
  try {
    const u = JSON.parse(localStorage.getItem("pesowise_current_user") || "{}")
    return u.name || u.email || ""
  } catch { return "" }
}
