# Telemarketing Sales & Operations — Module Spec

Owner-supplied requirements (2026-08-13). New main module in PesoWise for the Telemarketing Team:
one workspace for upsell/cross-sell entry; PesoWise auto-computes KPIs, quotas, hourly performance,
dashboards, and scheduled reports. Single source of truth — no duplicate manual trackers.

## Navigation (sub-tabs)
1. Dashboard  2. Sales Operations  3. Customers / Leads  4. Agent Performance
5. Hourly Sales  6. Reports  7. Scripts  8. Tools & Integrations  9. Settings (Admin only)

## Core formulas
- Total Orders = Upsell Orders + Cross-sell Orders
- Grand Total Sales = Upsell Amount + Cross-sell Amount
- Contact Rate = Connected Calls ÷ Total Calls × 100
- Conversion Rate = Successful Upsell/Cross-sell Orders ÷ Connected Customers × 100
- Target Achievement = Actual ÷ Target × 100; Remaining Quota = Target − Actual
- Required Daily Pace = Remaining Target ÷ Remaining Working Days
- AOV = Sales ÷ Orders; Sales per Connected Call; Orders per Connected Call; Sales/Orders per Hour

## Dashboard
- KPI cards: Upsell Orders/Amount, Cross-sell Orders/Amount, Total Orders, Grand Total Sales,
  Calls Made, Connected, Not Connected, Contact Rate, Conversion Rate, Daily Target,
  Monthly Target, Remaining Quota, Achievement %.
- Filters (same design as rest of PesoWise): Today / Yesterday / Last 7 / Last 14 / Last 30 /
  This Week / This Month / Previous Month / Custom + Agent, Team, Product, Sale Type
  (upsell/cross-sell), Order Status, Call Status, Lead Status, Sales Source. Whole dashboard reacts.
- Layout rows: (1) core sales KPIs, (2) target/conversion/AOV, (3) call KPIs, (4) charts
  (Hourly Sales, Daily Sales, Upsell vs Cross-sell, Target vs Actual; show/hide toggles),
  (5) agent performance table, (6) Action Required (follow-ups, uncalled leads, below-target
  agents, interested customers, pending sales).
- Today vs Yesterday comparison block: orders/sales/upsell/cross-sell diff + % change.
- Funnel: Assigned → Called → Connected → Interested → Upsell/Cross-sell → Completed (count + %).

## Daily Sales Report (monthly table)
Rows Day 1–31: Upsell Orders/Amount, Cross-sell Orders/Amount, Total Orders, Total Sales,
Target, Remaining, Achievement %. MONTH TOTAL footer with all totals + monthly target.

## Quotas
- Team monthly target (e.g. ₱1,000,000): current, remaining, achievement %, required daily
  pace, expected sales pace.
- Per-agent: monthly/daily sales targets, order targets, conversion target — Admin-configurable.
- Dynamic daily target (pace) alongside fixed daily quota.

## Hourly Sales
- Configurable hour blocks (default 8AM–8PM). Per hour: upsell/cross-sell orders & amounts,
  totals, calls, connected, contact rate, conversion. DAILY TOTAL footer.
- Auto-bucketing from transaction timestamps (sale at 10:37 → 10:00–11:00). No manual hourly encoding.
- Monthly hourly analysis view (which hours sell best), filterable by team/agent/month/product/type.

## Sales Operations (agent workspace)
Fields: date, time, customer name/contact, original order ID, original/upsell/cross-sell product,
assigned telemarketer, sale type, upsell qty/amount, cross-sell qty/amount, total orders/amount
(auto-computed), call status, sales status, notes, created/updated at.
Fast entry: agent enters only upsell and/or cross-sell qty+product+amount; totals auto-calc;
pull customer/order info from existing data instead of re-encoding.

## Customers / Leads
View/search/filter assigned customers, record call outcomes, add upsell/cross-sell, notes,
schedule follow-ups, view interaction history + previous purchases.
Lead statuses: New, Pending, Attempted, Connected, Unreachable, Follow-up, Interested,
Upsell Successful, Cross-sell Successful, Both, Declined, Do Not Call, Completed, Other.
Assignment: admin manual/bulk assign, reassign, add/deactivate telemarketers; agents see only
their assigned leads.

## Call metrics
Leads assigned, calls made, unique customers called, connected/not connected, contact rate,
follow-ups, successful sales, conversion. From GoDial (if available): talk time, avg duration,
calls/hour, attempts/lead.

## Integrations
- **GoDial CRM/API** (§17): sync agent, phone, call date/time/status/duration/attempts/disposition.
  Fallback: GoDial CSV/Excel import tool, matched to customer→lead→agent→date/time.
- **Pancake / POS / Pandig.ws** (§18): verify actual existing PesoWise source first; pull customer,
  original order, products, amount, status, contact, date. Telemarketing layer adds upsell/cross-sell/
  calls/notes/follow-ups on top without duplicating the source order.
- Attribution chain (§19): Customer → Order → Telemarketer → Date → Time → Product → Sale Type → Amount.

## Reports (automated)
Default schedule 9AM / 12PM / 3PM / 6PM / 8PM (admin-configurable). Contents: team totals
(upsell/cross-sell orders & amounts, grand totals, daily target, remaining, achievement %) +
per-agent rows (orders, amounts, calls, connected, conversion, achievement %).
Discord delivery (§21): admin-configurable webhook, schedule, report choice, team/agent scope.

## Leaderboard & KPI score
Leaderboard by: total sales, upsell sales, cross-sell sales, conversion, contact rate, orders,
achievement (not raw sales alone). Optional composite KPI score 0–100 with admin-configurable
weights (sales achievement, order achievement, conversion, contact rate, upsell/cross-sell,
productivity) and visible breakdown.

## Product performance
Per product: upsell orders/revenue, cross-sell orders/revenue, totals, conversion, top agent.

## Scripts tab
Scripts per product + purpose (Opening, Product Intro, Upsell Pitch, Cross-sell Pitch, Benefits,
Pricing, Objection Handling, Closing, Follow-up, FAQ). Admin: add/edit/assign/categorize/
activate-deactivate. Agents: fast search while calling.

## Operational alerts
Agent below daily target, team below pace, leads with no call attempt, follow-ups due/overdue,
high unconnected calls, low-conversion agent, high-performing product, interested-not-closed.

## Roles (§31)
- Telemarketer: own leads/sales/hourly/targets/quota/calls/follow-ups + scripts.
- Supervisor: whole team, all leads, team dashboard, comparisons, reports, assignments.
- Admin: everything + targets, users, integrations, report schedules, scripts, assignment rules,
  KPI weights, Discord config.

## Audit (§32)
Track who created/modified upsell-cross-sell records, old→new amounts, timestamps, lead
reassignment, status changes. No silent overwrite on concurrent edits.

## Build phases (§35)
1. **Core ops**: dashboard, sales operations, customers/leads, assignment, upsell/cross-sell entry,
   daily/monthly targets, individual agent dashboard, basic call tracking.
2. **Analytics**: hourly sales, daily report, agent performance, conversion/contact/achievement,
   today-vs-yesterday, product performance, funnel.
3. **Reporting**: scheduled reports, templates, Discord, report history.
4. **Integrations**: GoDial API + import fallback, Pancake/POS, auto call sync, auto attribution,
   advanced KPI scoring.
