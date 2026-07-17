import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase"

// Employee "Request Access" (login page) — claims a PENDING business_users roster row
// (added by the admin via User Management, identified by Employee No.) by creating a real
// Supabase Auth account for them and linking it to that row. Still needs admin ENABLE
// afterwards (requested=true, enabled stays false) before they get real sidebar access.
export async function POST(req: NextRequest) {
  const { employeeNo, fullName, email, username, password } = await req.json()

  if (!employeeNo || !fullName || !email || !username || !password) {
    return NextResponse.json({ error: "Kompletuhin ang lahat ng fields." }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password dapat hindi bababa sa 8 characters." }, { status: 400 })
  }

  const supabase = createSupabaseServerClient()

  // Single-business bootstrap: this deployment serves one company.
  const { data: biz, error: bizErr } = await supabase.from("businesses").select("id").limit(1).maybeSingle()
  if (bizErr || !biz) {
    return NextResponse.json({ error: "Walang na-configure na business — kontakin ang administrator." }, { status: 400 })
  }

  const { data: roster, error: rosterErr } = await supabase
    .from("business_users")
    .select("id, user_id")
    .eq("business_id", biz.id)
    .eq("employee_no", String(employeeNo).trim())
    .maybeSingle()

  if (rosterErr || !roster) {
    return NextResponse.json({ error: "Walang nakitang Employee No. na iyan — kontakin ang administrator." }, { status: 400 })
  }
  if (roster.user_id) {
    return NextResponse.json({ error: "May existing na access request na sa Employee No. na ito." }, { status: 400 })
  }

  const { data: dupe } = await supabase
    .from("business_users")
    .select("id")
    .eq("business_id", biz.id)
    .ilike("username", String(username).trim())
    .maybeSingle()
  if (dupe) {
    return NextResponse.json({ error: "Kuha na ang username na iyan — pumili ng iba." }, { status: 400 })
  }

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true,
  })
  if (authError || !authData.user) {
    if (authError?.message.includes("already registered")) {
      return NextResponse.json({ error: "May account na gamit ang email na iyan." }, { status: 400 })
    }
    return NextResponse.json({ error: authError?.message || "Failed to create account." }, { status: 400 })
  }

  // Business employees join an already-active business, so they get premium directly
  // (no personal trial) — matches "business needs premium" gating elsewhere in the app.
  const { error: profileError } = await supabase.from("users").insert({
    id: authData.user.id, email, name: fullName, plan: "premium",
  })
  if (profileError) {
    await supabase.auth.admin.deleteUser(authData.user.id)
    return NextResponse.json({ error: profileError.message || "Failed to create profile." }, { status: 500 })
  }

  const { error: claimError } = await supabase
    .from("business_users")
    .update({ user_id: authData.user.id, username: String(username).trim(), company_email: email, full_name: fullName, requested: true })
    .eq("id", roster.id)
  if (claimError) {
    await supabase.auth.admin.deleteUser(authData.user.id)
    return NextResponse.json({ error: claimError.message || "Failed to claim roster slot." }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
