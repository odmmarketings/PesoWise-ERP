import { NextRequest, NextResponse } from "next/server"

// ─────────────────────────────────────────────────────────────────────────────
// AI opinion para sa Scaling Tracker — server-side proxy para hindi lumabas ang
// ANTHROPIC_API_KEY sa client.
//
// TATLONG MAHIGPIT NA PANUNTUNAN:
//   1. Ang AI ay HINDI nagsasagawa ng aksyon — teksto lang ang ibinabalik.
//   2. Metrics lang ang ipinapadala (pangalan ng adset/campaign + numero) —
//      walang customer data, walang token.
//   3. Bawat rekomendasyon ay dapat nakabatay sa metrics na ipinasa; sinasabi
//      iyon sa system prompt para hindi mag-imbento ng numero.
//
// POST body: { mode: "row" | "brief" | "ask", rows: CompactRow[], question?: string }
// ─────────────────────────────────────────────────────────────────────────────

const MODEL = "claude-opus-5"

const SYSTEM = `You are a senior media buyer for a Philippine COD e-commerce operation.
Currency is PHP. ROAS convention here: Net ROAS = (purchase value x (1 - page RTS rate)) / (spend x 1.12) — the 1.12 is 12% VAT on ad spend, and RTS (return-to-sender) is real lost revenue in COD.
House thresholds: ready-to-scale = net ROAS >= 3.9 for 3+ consecutive days; kill candidates: net ROAS < 2.8 for the day, zero sales by 9am with spend, net < 1.5 bleeding, CPP > 250 over 3 days. Fatigue = frequency >= 2.5, CTR down >= 25%, CPM up >= 20%, or CPP up >= 30% (last 3d vs prior 7d), any two.
Rules for your answers:
- Base every statement ONLY on the metrics given. Never invent numbers. If data is missing, say so.
- Be direct and short: 2-4 sentences per ad set unless asked for more. State the action first, then why, then your confidence (high/medium/low).
- Budget moves: +20-30% per step for scaling, never more; wait 48h between raises.
- You only advise. You cannot pause or edit anything.`

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    return NextResponse.json({ success: false, error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 501 })
  }
  let body: any = {}
  try { body = await req.json() } catch {}
  const { mode, rows, question } = body
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ success: false, error: "No rows given." }, { status: 400 })
  }
  // Bawasan: max 40 rows para hindi lumobo ang prompt (at ang bill).
  const compact = rows.slice(0, 40)

  const user =
    mode === "brief"
      ? `Morning brief. Here are today's signals as JSON. Summarize what deserves attention first, ordered by money at stake. Group into: scale now, kill now, watch, fatigue. End with one-line overall read.\n${JSON.stringify(compact)}`
      : mode === "ask"
        ? `Question from the media buyer: ${String(question || "").slice(0, 500)}\nContext rows (JSON): ${JSON.stringify(compact)}`
        : `Give your opinion on each of these ad sets (JSON). For each: action, reason, confidence.\n${JSON.stringify(compact)}`

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: mode === "brief" ? 900 : 700,
        system: SYSTEM,
        messages: [{ role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(60_000),
    })
    const j: any = await res.json().catch(() => ({}))
    if (!res.ok) {
      return NextResponse.json({ success: false, error: String(j?.error?.message || `AI error (${res.status})`).slice(0, 200) }, { status: 502 })
    }
    const text = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n")
    return NextResponse.json({ success: true, text })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.name === "TimeoutError" ? "AI timed out after 60s." : (e?.message || "AI request failed") }, { status: 500 })
  }
}
