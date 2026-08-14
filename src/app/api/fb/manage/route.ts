import { NextRequest, NextResponse } from "next/server"

// Write proxy for the Meta Marketing API — campaign/ad-set/ad management.
// Safety: created / duplicated objects default to PAUSED so nothing spends without an
// explicit Activate. POST body: { token, action, ... }
//   action "status"          { id, status: "ACTIVE" | "PAUSED" }
//   action "delete"          { id }
//   action "update"          { id, name?, daily_budget? (pesos) }
//   action "duplicate"       { id }                         → deep copy, PAUSED
//   action "create_campaign" { account_id, name, objective }→ PAUSED
//   action "me"              {}                              → token owner { id, name } (rule Subscriber)
//   action "rules_list"      { account_id }                  → automated rules of the account
//   action "rule_create"     { account_id, rule: { name, evaluation_spec, execution_spec, schedule_spec, status } }
//   action "rule_status"     { id, status: ENABLED|DISABLED }
//   action "rule_update"     { id, rule: { evaluation_spec } }  → e.g. widen scope (Apply existing rule)
//   action "rule_delete"     { id }
// Rules run on Meta's side (adrules_library) — same engine as Ads Manager's Automated Rules.
const V = "v21.0"
const BASE = `https://graph.facebook.com/${V}`

async function fbGet(path: string, params: Record<string, string>, token: string) {
  const qs = new URLSearchParams({ ...params, access_token: token }).toString()
  const res = await fetch(`${BASE}/${path}?${qs}`, { cache: "no-store" })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.error) {
    const e = json?.error || {}
    throw new Error(`${e.error_user_msg || e.message || `Graph API error (${res.status})`}${e.code ? ` (#${e.code}${e.error_subcode ? "/" + e.error_subcode : ""})` : ""}`)
  }
  return json
}

async function fbCall(path: string, method: "POST" | "DELETE", params: Record<string, string>, token: string) {
  const qs = new URLSearchParams({ ...params, access_token: token }).toString()
  const res = await fetch(`${BASE}/${path}?${qs}`, { method, cache: "no-store" })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.error) {
    // Surface Facebook's real reason (error_user_msg / subcode / blamed field) instead of the
    // generic "Invalid parameter" so the actual cause is visible.
    const e = json?.error || {}
    const blame = e.error_data?.blame_field_specs ? ` [field: ${JSON.stringify(e.error_data.blame_field_specs)}]` : ""
    const detail = e.error_user_msg || e.message || `Graph API error (${res.status})`
    const code = e.code ? ` (#${e.code}${e.error_subcode ? "/" + e.error_subcode : ""})` : ""
    throw new Error(`${detail}${code}${blame}`)
  }
  return json
}

export async function POST(req: NextRequest) {
  let body: any = {}
  try { body = await req.json() } catch {}
  const { token, action, id, status, name, daily_budget, account_id, objective, rule } = body
  if (!token || !action) return NextResponse.json({ success: false, error: "Missing token / action" }, { status: 400 })

  try {
    switch (action) {
      case "status":
        await fbCall(id, "POST", { status: status === "ACTIVE" ? "ACTIVE" : "PAUSED" }, token)
        return NextResponse.json({ success: true })
      case "delete":
        await fbCall(id, "DELETE", {}, token)
        return NextResponse.json({ success: true })
      case "update": {
        const p: Record<string, string> = {}
        if (name != null) p.name = String(name)
        if (daily_budget != null) p.daily_budget = String(Math.round(Number(daily_budget) * 100)) // pesos → centavos
        await fbCall(id, "POST", p, token)
        return NextResponse.json({ success: true })
      }
      case "duplicate": {
        const j = await fbCall(`${id}/copies`, "POST", { deep_copy: "true", status_option: "PAUSED" }, token)
        return NextResponse.json({ success: true, copied_id: j.copied_campaign_id || j.id })
      }
      case "create_campaign": {
        const j = await fbCall(`${account_id}/campaigns`, "POST", {
          name: String(name || "New Campaign"),
          objective: String(objective || "OUTCOME_SALES"),
          status: "PAUSED",
          special_ad_categories: "[]",
        }, token)
        return NextResponse.json({ success: true, id: j.id })
      }
      case "me": {
        const j = await fbGet("me", { fields: "id,name" }, token)
        return NextResponse.json({ success: true, id: j.id, name: j.name })
      }
      case "rules_list": {
        // `created_by` = ang FACEBOOK user na gumawa ng rule (kasama ang mga
        // ginawa mismo sa Ads Manager). Ang gumawa sa loob ng PesoWise ay nasa
        // ads_activity_log — magkaibang tanong, magkaibang pinagkukunan.
        const j = await fbGet(`${account_id}/adrules_library`, { fields: "name,status,created_time,created_by,evaluation_spec,execution_spec,schedule_spec", limit: "100" }, token)
        return NextResponse.json({ success: true, rules: j.data || [] })
      }
      case "rule_create": {
        if (!rule?.name || !rule?.evaluation_spec || !rule?.execution_spec) return NextResponse.json({ success: false, error: "Incomplete rule" }, { status: 400 })
        const p: Record<string, string> = {
          name: String(rule.name),
          evaluation_spec: JSON.stringify(rule.evaluation_spec),
          execution_spec: JSON.stringify(rule.execution_spec),
          status: rule.status === "DISABLED" ? "DISABLED" : "ENABLED",
        }
        if (rule.schedule_spec) p.schedule_spec = JSON.stringify(rule.schedule_spec)
        const j = await fbCall(`${account_id}/adrules_library`, "POST", p, token)
        return NextResponse.json({ success: true, id: j.id })
      }
      case "rule_status":
        await fbCall(id, "POST", { status: status === "DISABLED" ? "DISABLED" : "ENABLED" }, token)
        return NextResponse.json({ success: true })
      case "rule_update": {
        // Bahagyang pag-update: ang ipinadala LANG ang binabago. Ginagamit ito ng
        // "Apply existing rule" (evaluation_spec lang, para lawakan ang saklaw) at
        // ng Edit sa listahan ng rules (pangalan/aksyon/kondisyon/iskedyul).
        const p: Record<string, string> = {}
        if (rule?.name) p.name = String(rule.name)
        if (rule?.evaluation_spec) p.evaluation_spec = JSON.stringify(rule.evaluation_spec)
        if (rule?.execution_spec) p.execution_spec = JSON.stringify(rule.execution_spec)
        if (rule?.schedule_spec) p.schedule_spec = JSON.stringify(rule.schedule_spec)
        if (Object.keys(p).length === 0) return NextResponse.json({ success: false, error: "Nothing to update" }, { status: 400 })
        await fbCall(id, "POST", p, token)
        return NextResponse.json({ success: true })
      }
      case "rule_delete":
        await fbCall(id, "DELETE", {}, token)
        return NextResponse.json({ success: true })
      default:
        return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 })
    }
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || "FB API error" }, { status: 502 })
  }
}
