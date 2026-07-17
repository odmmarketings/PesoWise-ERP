import { NextRequest, NextResponse } from "next/server"
import { createSupabaseBrowserClient, createSupabaseServerClient } from "@/lib/supabase"

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 })
  }

  const supabase = createSupabaseBrowserClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.session) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 })
  }

  // ERP roster gate: Request Access creates the auth account agad, pero hindi pwedeng
  // pumasok hangga't hindi ENABLED ng admin sa User Management (kasama na rin dito ang
  // mga na-DISABLE later). Personal-finance accounts (wala sa roster) ay hindi apektado.
  const admin = createSupabaseServerClient()
  const { data: member } = await admin
    .from("business_users").select("enabled").eq("user_id", data.session.user.id).maybeSingle()
  if (member && !member.enabled) {
    return NextResponse.json(
      { error: "Hindi pa ENABLED ng admin ang account mo — hintayin muna ang approval." },
      { status: 403 }
    )
  }

  const response = NextResponse.json({ success: true })
  response.cookies.set("sb-access-token", data.session.access_token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  })
  response.cookies.set("sb-refresh-token", data.session.refresh_token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  })
  return response
}
