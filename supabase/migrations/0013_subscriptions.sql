-- PesoWise — SUBSCRIPTIONS: recurring bills (AI tools / SaaS) na auto-posted sa Book Keeping
-- tuwing billing day nila. EXACT PHP amount per subscription (walang FX). Nagpo-post as a
-- Debit sa "Subscriptions" account (operating expense). Run in Supabase Dashboard → SQL
-- Editor. Safe to re-run.
--
-- NOTE: `finance_subscriptions` ang pangalan (HINDI `subscriptions`) — maraming Supabase
-- starter/Stripe templates ay may existing na `public.subscriptions` table na walang
-- business_id, kaya iniiwasan natin ang name collision.

create table if not exists public.finance_subscriptions (
  id text primary key,
  business_id uuid references public.businesses(id) on delete cascade not null,
  name text not null default '',             -- e.g. "ChatGPT Plus", "Cursor", "Claude Pro"
  amount numeric(14,2) not null default 0,   -- EXACT PHP charged per cycle
  billing_day int not null default 1,        -- day of month it bills (1-31; clamps sa dulo ng buwan)
  cycle text not null default 'monthly',     -- monthly | yearly
  billing_month int,                         -- yearly only (1-12); null kung monthly
  account text not null default 'Subscriptions',       -- Book Keeping account (Finance Settings)
  type_of_expense text not null default 'Software Subscription',
  department text default '',
  bank text default '',                      -- card / bank na sinisingil
  status text not null default 'active',     -- active | paused
  last_billed_period text default '',        -- 'YYYY-MM' (monthly) / 'YYYY' (yearly) — dedup guard
  notes text default '',
  created_by text default '',
  created_at timestamptz default now()
);
create index if not exists finance_subscriptions_business_idx on public.finance_subscriptions (business_id);

alter table public.finance_subscriptions enable row level security;
drop policy if exists "Business members access finance_subscriptions" on public.finance_subscriptions;
create policy "Business members access finance_subscriptions" on public.finance_subscriptions for all using (
  exists (select 1 from public.businesses where id = finance_subscriptions.business_id and owner_id = auth.uid())
  or public.is_business_member(finance_subscriptions.business_id)
);
