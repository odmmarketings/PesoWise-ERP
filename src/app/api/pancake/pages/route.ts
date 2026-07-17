import { NextRequest, NextResponse } from "next/server"

// Fetch list of pages from Pancake — used to auto-detect correct page_id
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const access_token = searchParams.get("access_token")

  if (!access_token) {
    return NextResponse.json({ error: "Missing access_token" }, { status: 400 })
  }

  try {
    const url = new URL("https://pages.fm/api/v1/pages")
    url.searchParams.set("access_token", access_token)

    const res = await fetch(url.toString(), {
      cache: "no-store",
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; PesoWise/1.0)",
      },
    })

    const bodyText = await res.text()
    let json: any
    try { json = JSON.parse(bodyText) } catch {
      return NextResponse.json({ error: "Invalid JSON from Pancake", detail: bodyText.slice(0, 200) }, { status: 502 })
    }

    if (json?.success === false) {
      return NextResponse.json({ error: json?.message || "Authentication failed", error_code: json?.error_code }, { status: 401 })
    }

    // Extract pages list — handle different shapes
    const pages: any[] = (
      json?.data?.pages ??
      json?.data?.items ??
      (Array.isArray(json?.data) ? json.data : null) ??
      json?.pages ??
      []
    )

    return NextResponse.json({ success: true, pages, raw: json })
  } catch (err: any) {
    return NextResponse.json({ error: "Network error", detail: err?.message }, { status: 500 })
  }
}
