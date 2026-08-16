-- PesoWise — LOGISTICS & DELIVERY OPERATIONS, Phase 2: RTS Recovery workflow at
-- KPI scoring. Dalawang dagdag:
--   1. recovery_outcome sa delivery_orders — ang HATOL sa isang problematic case
--      (hiwalay sa agent_status na araw-araw na galaw). Dito kinukuha ang tunay
--      na Recovery Rate, hindi na hula mula sa agent_status.
--   2. delivery_settings — isang JSONB blob para sa configurable KPI weights
--      (finance_settings/logistics_settings precedent).
-- Run in Supabase Dashboard → SQL Editor. Safe to re-run.

-- ── Recovery outcome (Problematic / RTS cases) ──────────────────────────────────────
alter table public.delivery_orders add column if not exists recovery_outcome text default '';
  -- '' = wala pang hatol (bukas pa ang case)
  -- Recovered / Delivered · Rescheduled · Still Pending · Unreachable ·
  -- Customer Refused · Canceled · Returned · Failed Recovery
alter table public.delivery_orders add column if not exists recovery_outcome_at timestamptz;
alter table public.delivery_orders add column if not exists recovery_notes text default '';

create index if not exists delivery_orders_recovery_idx
  on public.delivery_orders (business_id, recovery_outcome);

-- ── Module settings (KPI weights, at iba pang config sa hinaharap) ──────────────────
create table if not exists public.delivery_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,   -- { kpi: { weights: {...}, ... } }
  updated_at timestamptz default now()
);

alter table public.delivery_settings enable row level security;
drop policy if exists "Business members access delivery_settings" on public.delivery_settings;
create policy "Business members access delivery_settings" on public.delivery_settings for all using (
  exists (select 1 from public.businesses where id = delivery_settings.business_id and owner_id = auth.uid())
  or public.is_business_member(delivery_settings.business_id)
);
