import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const PUBLIC_PATHS = ["/", "/login", "/register", "/forgot-password"]

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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.svg).*)"],
}
