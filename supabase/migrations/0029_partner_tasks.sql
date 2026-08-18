-- PARTNER TASKS — trabaho kada media buyer, may deadline, may premyo.
--
-- TATLONG KALAGAYAN, hindi dalawa: open → review → done. Ang partner mismo ang
-- nagsasabing tapos na siya ("Mark as done"), pero ang may-ari ang nag-aapruba —
-- kung hindi, ang premyo ay sariling-sertipika. Ang "pending" na hinihingi ng
-- may-ari ay ang review na kalagayan: naghihintay ng tingin.
--
-- Ang OVERDUE ay HINDI kalagayan — hinuhusgahan ito sa pagbasa (deadline <
-- today at hindi pa done). Kung gagawin itong kolum, mangangailangan ito ng
-- cron na magpapalit nito sa hatinggabi; ang derived ay laging tama.
create table if not exists public.partner_tasks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null,
  details text not null default '',
  -- Ang PANGALAN ng partner (owner ng ad accounts) — pangalan ang hawak ng
  -- buong Ads section, hindi email; ang email ay hinahanap sa roster sa oras
  -- ng abiso, gaya ng packer picker.
  owner text not null,
  deadline date,
  -- Malayang teksto ang premyo ("₱500 GCash", "1 day off") — ang may-ari ang
  -- nagpapasya, hindi tayo nagpapataw ng pera-lang na hugis.
  reward text not null default '',
  status text not null default 'open',            -- open | review | done
  created_by_name text not null default '',
  created_by_email text not null default '',
  submitted_at timestamptz,                        -- kailan sinabing tapos
  done_at timestamptz,                             -- kailan inaprubahan
  approved_by text not null default '',
  -- Soft delete — ang tinapos na trabaho ay kasaysayan ng premyo.
  deleted boolean not null default false
);

create index if not exists partner_tasks_biz_idx
  on public.partner_tasks (business_id, deleted, status, deadline);

-- MONTHLY TARGETS — target sales at target net ROAS kada partner kada buwan.
-- Ang AKTUWAL ay hindi nakatago rito: kinukuwenta ito sa pagbasa mula sa
-- Meta insights (walang inimbentong numero, walang lumang kopya).
create table if not exists public.partner_targets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  owner text not null,
  month text not null,                             -- 'YYYY-MM'
  target_sales numeric not null default 0,         -- purchase value, pesos
  target_roas numeric not null default 0,          -- NET roas (house math)
  reward text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text not null default '',
  unique (business_id, owner, month)
);

create index if not exists partner_targets_month_idx
  on public.partner_targets (business_id, month);

alter table public.partner_tasks enable row level security;
alter table public.partner_targets enable row level security;

drop policy if exists "Business members access partner_tasks" on public.partner_tasks;
create policy "Business members access partner_tasks" on public.partner_tasks for all using (
  exists (select 1 from public.businesses where id = partner_tasks.business_id and owner_id = auth.uid())
  or public.is_business_member(partner_tasks.business_id)
) with check (
  exists (select 1 from public.businesses where id = partner_tasks.business_id and owner_id = auth.uid())
  or public.is_business_member(partner_tasks.business_id)
);

drop policy if exists "Business members access partner_targets" on public.partner_targets;
create policy "Business members access partner_targets" on public.partner_targets for all using (
  exists (select 1 from public.businesses where id = partner_targets.business_id and owner_id = auth.uid())
  or public.is_business_member(partner_targets.business_id)
) with check (
  exists (select 1 from public.businesses where id = partner_targets.business_id and owner_id = auth.uid())
  or public.is_business_member(partner_targets.business_id)
);
