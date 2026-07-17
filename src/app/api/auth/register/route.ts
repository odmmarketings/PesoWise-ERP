import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase"
import { getTrialEndDate } from "@/lib/utils"

function generateReferralCode(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase()
}

export async function POST(req: NextRequest) {
  const { name, email, password, plan, referral_code } = await req.json()

  if (!name || !email || !password) {
    return NextResponse.json({ error: "All fields are required." }, { status: 400 })
  }

  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 })
  }

  const supabase = createSupabaseServerClient()

  // Create auth user
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authError) {
    if (authError.message.includes("already registered")) {
      return NextResponse.json({ error: "Email already registered. Please login instead." }, { status: 400 })
    }
    return NextResponse.json({ error: authError.message }, { status: 400 })
  }

  // Resolve referrer
  let referredBy: string | null = null
  if (referral_code) {
    const { data: referrer } = await supabase
      .from("users")
      .select("id")
      .eq("referral_code", referral_code)
      .single()
    if (referrer) referredBy = referrer.id
  }

  // Create user profile
  const userReferralCode = generateReferralCode()
  const { error: profileError } = await supabase.from("users").insert({
    id: authData.user.id,
    email,
    name,
    plan: "trial",
    trial_ends_at: getTrialEndDate().toISOString(),
    referral_code: userReferralCode,
    referred_by: referredBy,
  })

  if (profileError) {
    console.error("Profile insert error:", profileError)
    return NextResponse.json({ error: profileError.message || "Failed to create profile." }, { status: 500 })
  }

  // Log affiliate referral
  if (referredBy) {
    await supabase.from("affiliate_referrals").insert({
      referrer_id: referredBy,
      referred_user_id: authData.user.id,
      status: "pending",
    })
  }

  // Sign in immediately and set session cookie
  const { data: session, error: signInError } = await supabase.auth.signInWithPassword({ email, password })
  if (signInError || !session.session) {
    return NextResponse.json({ error: "Account created but login failed. Please login manually." }, { status: 500 })
  }

  const response = NextResponse.json({ success: true })
  response.cookies.set("sb-access-token", session.session.access_token, {
    httpOnly: false, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 60 * 60 * 24 * 7, path: "/",
  })
  response.cookies.set("sb-refresh-token", session.session.refresh_token, {
    httpOnly: false, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 60 * 60 * 24 * 30, path: "/",
  })
  return response
}
