-- 0023_telemarketing.sql
-- Telemarketing Sales & Operations module (docs/telemarketing-spec.md).
-- Tables: tm_agents, tm_leads, tm_calls, tm_sales, tm_targets, tm_scripts, tm_settings.
--
-- Run in Supabase Dashboard → SQL Editor. Safe to re-run.

-- ============================================================
-- tm_agents — telemarketer roster (pattern: delivery_team)
-- ============================================================
create table if not exists public.tm_agents (
  id text primary key,                             -- uid("tma")
  business_id uuid references public.businesses(id) on delete cascade not null,
  agent_name text not null default '',
  team text not null default '',
  phone text not null default '',
  email text not null default '',
  status text not null default 'Active' check (status in ('Active','Inactive')),
  added_by text not null default '',
  added_date timestamptz default now(),
  history jsonb not null default '[]'::jsonb
);
create index if not exists tm_agents_business_idx on public.tm_agents (business_id);

-- ============================================================
-- tm_leads — customers / leads assigned to telemarketers
-- ============================================================
create table if not exists public.tm_leads (
  id text primary key,                             -- uid("tml")
  business_id uuid references public.businesses(id) on delete cascade not null,
  customer_name text not null default '',
  phone text not null default '',
  address text not null default '',
  source text not null default '',                 -- sales source (Pancake page, manual, import…)
  original_order_id text not null default '',
  original_product text not null default '',
  order_amount numeric(12,2) default 0,
  order_date text not null default '',             -- YYYY-MM-DD
  assigned_to text not null default '',            -- tm_agents.id ('' = unassigned)
  status text not null default 'New' check (status in (
    'New','Pending','Attempted','Connected','Unreachable','Follow-up','Interested',
    'Upsell Successful','Cross-sell Successful','Both Upsell + Cross-sell',
    'Declined','Do Not Call','Completed','Other')),
  follow_up_date text not null default '',         -- YYYY-MM-DD ('' = none)
  call_attempts integer not null default 0,
  last_call_at text not null default '',           -- YYYY-MM-DD HH:MM
  notes text not null default '',
  added_by text not null default '',
  added_date timestamptz default now(),
  updated_at timestamptz default now(),            -- optimistic-concurrency token (delivery_orders pattern)
  history jsonb not null default '[]'::jsonb
);
create index if not exists tm_leads_business_idx on public.tm_leads (business_id);
create index if not exists tm_leads_assigned_idx on public.tm_leads (business_id, assigned_to);
create index if not exists tm_leads_status_idx on public.tm_leads (business_id, status);

-- ============================================================
-- tm_calls — call activity log (manual entry now, GoDial import later)
-- ============================================================
create table if not exists public.tm_calls (
  id text primary key,                             -- uid("tmc")
  business_id uuid references public.businesses(id) on delete cascade not null,
  lead_id text not null default '',                -- tm_leads.id ('' when unlinked, e.g. raw GoDial rows)
  agent_id text not null default '',
  agent_name text not null default '',
  call_date text not null default '',              -- YYYY-MM-DD
  call_time text not null default '',              -- HH:MM (24h) — hourly bucketing key
  connected boolean not null default false,
  disposition text not null default '',            -- e.g. Answered / No Answer / Busy / Wrong Number / Declined / Interested
  duration_sec integer not null default 0,         -- from GoDial when available
  attempt_no integer not null default 1,
  source text not null default 'manual' check (source in ('manual','godial')),
  notes text not null default '',
  added_by text not null default '',
  added_date timestamptz default now()
);
create index if not exists tm_calls_business_idx on public.tm_calls (business_id);
create index if not exists tm_calls_date_idx on public.tm_calls (business_id, call_date);
create index if not exists tm_calls_agent_idx on public.tm_calls (business_id, agent_id, call_date);

-- ============================================================
-- tm_sales — upsell / cross-sell transactions (single source of truth, spec §19 §34)
-- Attribution chain: customer → order → telemarketer → date → time → product → type → amount
-- ============================================================
create table if not exists public.tm_sales (
  id text primary key,                             -- uid("tms")
  business_id uuid references public.businesses(id) on delete cascade not null,
  lead_id text not null default '',                -- tm_leads.id ('' when entered without a lead)
  sale_date text not null default '',              -- YYYY-MM-DD
  sale_time text not null default '',              -- HH:MM (24h) — hourly bucketing key
  customer_name text not null default '',
  customer_phone text not null default '',
  original_order_id text not null default '',
  original_product text not null default '',
  agent_id text not null default '',
  agent_name text not null default '',
  sale_type text not null default 'Upsell' check (sale_type in ('Upsell','Cross-sell','Both')),
  upsell_product text not null default '',
  upsell_qty integer not null default 0,
  upsell_amount numeric(12,2) default 0,
  cross_product text not null default '',
  cross_qty integer not null default 0,
  cross_amount numeric(12,2) default 0,
  total_qty integer not null default 0,            -- upsell_qty + cross_qty (client-computed)
  total_amount numeric(12,2) default 0,            -- upsell_amount + cross_amount (client-computed)
  call_status text not null default '',            -- Connected / Not Connected snapshot at entry
  sales_status text not null default 'Pending' check (sales_status in ('Pending','Confirmed','Completed','Cancelled')),
  notes text not null default '',
  added_by text not null default '',
  added_date timestamptz default now(),
  updated_at timestamptz default now(),            -- optimistic-concurrency token
  history jsonb not null default '[]'::jsonb       -- amount edits audited here (spec §32)
);
create index if not exists tm_sales_business_idx on public.tm_sales (business_id);
create index if not exists tm_sales_date_idx on public.tm_sales (business_id, sale_date);
create index if not exists tm_sales_agent_idx on public.tm_sales (business_id, agent_id, sale_date);

-- ============================================================
-- tm_targets — team + per-agent quotas per month (agent_id '' = TEAM target)
-- ============================================================
create table if not exists public.tm_targets (
  id text primary key,                             -- uid("tmt")
  business_id uuid references public.businesses(id) on delete cascade not null,
  month text not null default '',                  -- YYYY-MM
  agent_id text not null default '',               -- '' = team-level target
  sales_target numeric(12,2) default 0,            -- monthly ₱ target
  orders_target integer not null default 0,        -- monthly orders target
  daily_sales_target numeric(12,2) default 0,      -- fixed daily quota (pace is computed live)
  daily_orders_target integer not null default 0,
  conversion_target numeric(5,2) default 0,        -- %
  added_by text not null default '',
  added_date timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists tm_targets_business_idx on public.tm_targets (business_id);
do $$ begin
  alter table public.tm_targets add constraint tm_targets_month_agent_uniq unique (business_id, month, agent_id);
exception when duplicate_table then null; when duplicate_object then null; end $$;

-- ============================================================
-- tm_scripts — product/purpose call scripts knowledge base (spec §26–27)
-- ============================================================
create table if not exists public.tm_scripts (
  id text primary key,                             -- uid("tmk")
  business_id uuid references public.businesses(id) on delete cascade not null,
  product text not null default '',                -- '' = general (Follow-up, Closing, …)
  category text not null default 'Opening' check (category in (
    'Opening','Product Introduction','Upsell Pitch','Cross-sell Pitch','Benefits','Pricing',
    'Objection Handling','Closing','Follow-up','FAQ','Other')),
  title text not null default '',
  body text not null default '',
  active boolean not null default true,
  sort integer not null default 0,
  added_by text not null default '',
  added_date timestamptz default now(),
  updated_at timestamptz default now(),
  history jsonb not null default '[]'::jsonb
);
create index if not exists tm_scripts_business_idx on public.tm_scripts (business_id);

-- ============================================================
-- tm_settings — one row per business, one jsonb column per concern
-- (pattern: ecommerce_settings + getSettingBlob/setSettingBlob)
-- ============================================================
create table if not exists public.tm_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  hour_blocks jsonb,                               -- e.g. {"start":8,"end":20} configurable schedule (spec §8)
  report_schedule jsonb,                           -- e.g. {"times":["09:00","12:00","15:00","18:00","20:00"]}
  discord jsonb,                                   -- {"webhook_url":"","enabled":false,...} (spec §21)
  kpi_weights jsonb,                               -- configurable KPI score weights (spec §24)
  general jsonb,                                   -- teams, products list, misc
  updated_at timestamptz default now()             -- written by setSettingBlob on every upsert
);

-- ============================================================
-- RLS — verbatim membership pattern (0002 helper + per-table policy)
-- ============================================================
alter table public.tm_agents enable row level security;
drop policy if exists "Business members access tm_agents" on public.tm_agents;
create policy "Business members access tm_agents" on public.tm_agents for all using (
  exists (select 1 from public.businesses where id = tm_agents.business_id and owner_id = auth.uid())
  or public.is_business_member(tm_agents.business_id)
);

alter table public.tm_leads enable row level security;
drop policy if exists "Business members access tm_leads" on public.tm_leads;
create policy "Business members access tm_leads" on public.tm_leads for all using (
  exists (select 1 from public.businesses where id = tm_leads.business_id and owner_id = auth.uid())
  or public.is_business_member(tm_leads.business_id)
);

alter table public.tm_calls enable row level security;
drop policy if exists "Business members access tm_calls" on public.tm_calls;
create policy "Business members access tm_calls" on public.tm_calls for all using (
  exists (select 1 from public.businesses where id = tm_calls.business_id and owner_id = auth.uid())
  or public.is_business_member(tm_calls.business_id)
);

alter table public.tm_sales enable row level security;
drop policy if exists "Business members access tm_sales" on public.tm_sales;
create policy "Business members access tm_sales" on public.tm_sales for all using (
  exists (select 1 from public.businesses where id = tm_sales.business_id and owner_id = auth.uid())
  or public.is_business_member(tm_sales.business_id)
);

alter table public.tm_targets enable row level security;
drop policy if exists "Business members access tm_targets" on public.tm_targets;
create policy "Business members access tm_targets" on public.tm_targets for all using (
  exists (select 1 from public.businesses where id = tm_targets.business_id and owner_id = auth.uid())
  or public.is_business_member(tm_targets.business_id)
);

alter table public.tm_scripts enable row level security;
drop policy if exists "Business members access tm_scripts" on public.tm_scripts;
create policy "Business members access tm_scripts" on public.tm_scripts for all using (
  exists (select 1 from public.businesses where id = tm_scripts.business_id and owner_id = auth.uid())
  or public.is_business_member(tm_scripts.business_id)
);

alter table public.tm_settings enable row level security;
drop policy if exists "Business members access tm_settings" on public.tm_settings;
create policy "Business members access tm_settings" on public.tm_settings for all using (
  exists (select 1 from public.businesses where id = tm_settings.business_id and owner_id = auth.uid())
  or public.is_business_member(tm_settings.business_id)
);
