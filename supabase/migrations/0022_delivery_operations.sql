-- PesoWise — LOGISTICS & DELIVERY OPERATIONS (Phase 1). Sentro ng monitoring at
-- pamamahala ng Out-for-Delivery, Delivered, RTS at problematic orders: per-agent
-- assignment, agent working statuses, at audit trail. Pancake POS pa rin ang
-- pinagmumulan ng order/delivery truth — dito lang ang operational annotations.
-- Run in Supabase Dashboard → SQL Editor. Safe to re-run.

-- ── Delivery team roster (sino ang agent / supervisor) ───────────────────────────────
-- Email-based para mailista ang agents kahit wala pa silang PesoWise accounts;
-- awtomatikong tutugma sa business_users kapag nagawa na ang account nila.
create table if not exists public.delivery_team (
  id text primary key,                             -- uid("dta")
  business_id uuid references public.businesses(id) on delete cascade not null,
  email text not null default '',
  name text not null default '',
  role text not null default 'agent',              -- agent | supervisor
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz default now()
);
create index if not exists delivery_team_business_idx on public.delivery_team (business_id);
create unique index if not exists delivery_team_email_idx
  on public.delivery_team (business_id, lower(email)) where email <> '';

-- ── Assigned orders + agent working state (isang row kada Pancake order) ─────────────
-- order_id = Pancake order id (stable; ang tracking number ay maaaring mapalitan sa
-- RTS reshipment). Ang snapshot columns ay sinusulat minsan sa assignment — fallback
-- kapag ang order ay wala na sa live Pancake fetch window; live data pa rin ang panalo.
create table if not exists public.delivery_orders (
  order_id text primary key,
  business_id uuid references public.businesses(id) on delete cascade not null,
  assignment_type text not null default 'delivering',  -- delivering | problematic (queue)
  -- snapshot sa oras ng assignment
  customer_name text default '',
  phone text default '',
  address text default '',
  province text default '',
  city text default '',
  courier text default '',
  page_name text default '',
  amount numeric not null default 0,
  tracking_no text default '',
  order_date text default '',                      -- Pancake date_added (PH, YYYY-MM-DD)
  parcel_status_snapshot text default '',
  -- assignment
  assigned_to_email text default '',
  assigned_to_name text default '',
  assigned_by text default '',
  assigned_at timestamptz,
  assigned_date text default '',                   -- YYYY-MM-DD PH → per-day KPIs
  -- agent working state
  agent_status text not null default 'Pending',    -- Pending | Unreachable | Contacted | Reminded |
                                                   -- Rescheduled | Resolved | Recovery | Delivered |
                                                   -- Canceled | Returned/RTS | Other
  call_attempts int not null default 0,
  last_contact_at text default '',                 -- "YYYY-MM-DD HH:mm" PH
  next_follow_up text default '',                  -- YYYY-MM-DD
  reschedule_date text default '',                 -- YYYY-MM-DD
  reschedule_confirmed boolean not null default false,
  cancel_reason text default '',
  status_note text default '',                     -- required kapag agent_status = Other
  notes text default '',
  history jsonb not null default '[]'::jsonb,      -- [{action, detail, by, at}]
  updated_by text default '',
  updated_at timestamptz default now(),            -- optimistic-concurrency token
  created_at timestamptz default now()
);
create index if not exists delivery_orders_business_idx on public.delivery_orders (business_id);
create index if not exists delivery_orders_agent_idx    on public.delivery_orders (business_id, assigned_to_email);
create index if not exists delivery_orders_date_idx     on public.delivery_orders (business_id, assigned_date);
create index if not exists delivery_orders_status_idx   on public.delivery_orders (business_id, agent_status);
create index if not exists delivery_orders_type_idx     on public.delivery_orders (business_id, assignment_type);

-- ── Audit trail (bawat assignment / reassignment / status change ay naitatala) ───────
create table if not exists public.delivery_activity (
  id text primary key,                             -- uid("dact")
  business_id uuid references public.businesses(id) on delete cascade not null,
  order_id text default '',                        -- '' para sa batch-level entries
  action text default '',                          -- Assigned | Reassigned | Moved to Problematic |
                                                   -- Moved to Delivering | Status changed |
                                                   -- Auto-assign batch | Note
  detail text default '',                          -- hal. "Pending → Contacted", "maria@x → juan@x"
  by_name text default '',
  by_email text default '',
  at timestamptz default now()
);
create index if not exists delivery_activity_business_idx on public.delivery_activity (business_id, at desc);
create index if not exists delivery_activity_order_idx    on public.delivery_activity (order_id);

-- ── RLS — kapareho ng ibang modules (owner o business member) ────────────────────────
alter table public.delivery_team enable row level security;
drop policy if exists "Business members access delivery_team" on public.delivery_team;
create policy "Business members access delivery_team" on public.delivery_team for all using (
  exists (select 1 from public.businesses where id = delivery_team.business_id and owner_id = auth.uid())
  or public.is_business_member(delivery_team.business_id)
);

alter table public.delivery_orders enable row level security;
drop policy if exists "Business members access delivery_orders" on public.delivery_orders;
create policy "Business members access delivery_orders" on public.delivery_orders for all using (
  exists (select 1 from public.businesses where id = delivery_orders.business_id and owner_id = auth.uid())
  or public.is_business_member(delivery_orders.business_id)
);

alter table public.delivery_activity enable row level security;
drop policy if exists "Business members access delivery_activity" on public.delivery_activity;
create policy "Business members access delivery_activity" on public.delivery_activity for all using (
  exists (select 1 from public.businesses where id = delivery_activity.business_id and owner_id = auth.uid())
  or public.is_business_member(delivery_activity.business_id)
);
