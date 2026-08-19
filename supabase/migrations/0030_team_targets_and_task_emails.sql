-- TEAM TARGET + AUTO-EMAIL NG TASK DEADLINE (sundot sa 0029).
--
-- TATLONG PAGBABAGO:
--   1) Ang PREMYO ay pang-BUONG-KOPONAN na, hindi kada tao (hatol ng may-ari,
--      Ago 18 2026). Kaya isang `team_targets` na row kada buwan: target sales,
--      target net ROAS, at ISANG reward na pinaghahatian. Ang `partner_targets`
--      ay nananatili para sa INDIBIDWAL na target — pero wala nang premyo doon.
--   2) Ang `partner_targets.reward` ay DEPRECATED. Hindi na ito isinusulat ng
--      app. Hindi ito ini-drop: may naitala nang halaga ang may-ari bago ang
--      pagbabagong ito, at ang pagbura niyon ay pagbura ng kasaysayan. Basahin
--      ang `team_targets.reward` bilang tanging premyo.
--   3) Pila ng email para sa paalala ng deadline — kaparehong-kapareho ng
--      `problem_notifications` (0014), kasama ang dedupe index, para magamit ang
--      mismong padron ng `scripts/problem-notify.mjs`.

create table if not exists public.team_targets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  month text not null,                             -- 'YYYY-MM'
  target_sales numeric not null default 0,         -- kabuuang purchase value ng LAHAT
  target_roas numeric not null default 0,          -- net ROAS ng pinagsamang gastos
  reward text not null default '',                 -- ISANG premyo para sa koponan
  updated_at timestamptz not null default now(),
  updated_by text not null default '',
  unique (business_id, month)
);

-- ── Pila ng email ───────────────────────────────────────────────────────────
-- Ang `dedupe_key` ang pumipigil sa dobleng padala: minsanan kada yugto (d3,
-- d1, due_today) at ARAW-ARAW habang overdue (kasama ang petsa sa susi).
create table if not exists public.partner_task_notifications (
  id text primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  task_id uuid references public.partner_tasks(id) on delete cascade,
  kind text not null default '',                   -- d3 | d1 | due_today | overdue
  to_email text not null default '',
  subject text not null default '',
  body text not null default '',
  status text not null default 'pending',          -- pending | sent | failed
  dedupe_key text not null default '',
  error text not null default '',
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists partner_task_notifications_status_idx
  on public.partner_task_notifications (business_id, status);
create unique index if not exists partner_task_notifications_dedupe_idx
  on public.partner_task_notifications (business_id, dedupe_key) where dedupe_key <> '';

alter table public.team_targets enable row level security;
alter table public.partner_task_notifications enable row level security;

drop policy if exists "Business members access team_targets" on public.team_targets;
create policy "Business members access team_targets" on public.team_targets for all using (
  exists (select 1 from public.businesses where id = team_targets.business_id and owner_id = auth.uid())
  or public.is_business_member(team_targets.business_id)
) with check (
  exists (select 1 from public.businesses where id = team_targets.business_id and owner_id = auth.uid())
  or public.is_business_member(team_targets.business_id)
);

drop policy if exists "Business members access partner_task_notifications" on public.partner_task_notifications;
create policy "Business members access partner_task_notifications" on public.partner_task_notifications for all using (
  exists (select 1 from public.businesses where id = partner_task_notifications.business_id and owner_id = auth.uid())
  or public.is_business_member(partner_task_notifications.business_id)
) with check (
  exists (select 1 from public.businesses where id = partner_task_notifications.business_id and owner_id = auth.uid())
  or public.is_business_member(partner_task_notifications.business_id)
);
