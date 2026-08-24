import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

// Ang manifest at mga icon ay dapat mabasa ng browser BAGO mag-login — kung
// hindi, ang /manifest.webmanifest ay nire-redirect sa /login, HTML ang sagot,
// at hindi lumalabas ang "Install app" sa Chrome/Edge (nahuli Ago 5 2026).
const PUBLIC_PATHS = [
  "/", "/login", "/register", "/forgot-password",
  "/manifest.webmanifest", "/icon.svg", "/apple-icon.png",
  // ⚠ Ang service worker ay hinihila ng BROWSER nang walang cookie — kapag
  // nire-redirect sa /login, pumapalya ang registration at PATAY ang push.
  "/OneSignalSDKWorker.js",
]

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Always allow API auth routes and static assets
  if (pathname.startsWith("/api/auth") || pathname.startsWith("/api/paymongo")) {
    return NextResponse.next()
  }

  // Allow public pages
  const isPublic = PUBLIC_PATHS.some(p => pathname === p)
  if (isPublic) return NextResponse.next()

  // Check for Supabase session token
  const token = request.cookies.get("sb-access-token")?.value

  if (!token) {
    // ── HUWAG SUMAGOT NG HTML SA ISANG API CALL ──────────────────────────────
    // Dating ang lahat ay nire-redirect sa /login. Para sa `fetch()` ng app,
    // tahimik na sinusundan ang redirect at HTML ang natatanggap — kaya ang
    // nakikita ng user ay `Unexpected token '<', "<!DOCTYPE"... is not valid
    // JSON` sa BAWAT page, imbes na "expired ang session mo". Nangyari ito sa
    // production noong Ago 6 2026 (Page ROAS Tracker: pula ang lahat ng page).
    // Ang JSON 401 ay naipapakita nang tama ng mga page — ginagamit na nila ang
    // `json.error` — at kaya ring hulihin ng client para magpa-login muli.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          success: false,
          errorCode: "SESSION_EXPIRED",
          error: "Session expired — please sign in again.",
        },
        { status: 401 }
      )
    }
    return NextResponse.redirect(new URL("/login", request.url))
  }

  // Admin protection
  if (pathname.startsWith("/admin")) {
    const userEmail = request.cookies.get("pesowise-user-email")?.value
    if (userEmail !== process.env.ADMIN_EMAIL) {
      return NextResponse.redirect(new URL("/business/dashboard", request.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.svg|.*\\.webmanifest).*)"],
}
