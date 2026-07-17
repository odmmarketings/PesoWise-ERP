import { NextResponse } from "next/server"

export async function GET() {
  try {
    const res = await fetch("https://nispwrqxaxyzgqalguhx.supabase.co/auth/v1/health")
    return NextResponse.json({ ok: res.ok, status: res.status })
  } catch (e: any) {
    return NextResponse.json({ error: e.message })
  }
}
