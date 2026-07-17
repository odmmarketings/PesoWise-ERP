import { NextRequest, NextResponse } from "next/server"

// Philippine geo reference (PSGC) proxy — provinces / cities-municipalities / barangays.
// Server-side fetch (no CORS issues) with a long in-memory cache: the data is static.
//   ?level=provinces
//   ?level=cities&code=<provinceCode>     ("NCR" → Metro Manila cities)
//   ?level=barangays&code=<cityCode>
const BASE = "https://psgc.gitlab.io/api"
const NCR_REGION = "130000000"

type Entry = { code: string; name: string }
const CACHE = new Map<string, { ts: number; data: Entry[] }>()
const TTL = 24 * 60 * 60_000   // 24h

async function fetchList(url: string): Promise<Entry[]> {
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) throw new Error(`PSGC ${res.status}`)
  const json = await res.json()
  return (json as any[]).map(x => ({ code: x.code, name: x.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const level = sp.get("level") || ""
  const code = sp.get("code") || ""

  let key = "", url = ""
  if (level === "provinces") {
    key = "provinces"; url = `${BASE}/provinces/`
  } else if (level === "cities" && code) {
    key = `cities|${code}`
    url = code === "NCR" ? `${BASE}/regions/${NCR_REGION}/cities-municipalities/` : `${BASE}/provinces/${code}/cities-municipalities/`
  } else if (level === "barangays" && code) {
    key = `brgys|${code}`; url = `${BASE}/cities-municipalities/${code}/barangays/`
  } else {
    return NextResponse.json({ success: false, error: "Missing level / code" }, { status: 400 })
  }

  const hit = CACHE.get(key)
  if (hit && Date.now() - hit.ts < TTL) return NextResponse.json({ success: true, data: hit.data, cached: true })

  try {
    let data = await fetchList(url)
    if (level === "provinces") {
      data = [{ code: "NCR", name: "Metro Manila" }, ...data].sort((a, b) => a.name.localeCompare(b.name))
    }
    CACHE.set(key, { ts: Date.now(), data })
    return NextResponse.json({ success: true, data })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || "PSGC fetch failed" }, { status: 502 })
  }
}
