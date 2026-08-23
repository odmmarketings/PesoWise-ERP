-- MONITORING ROUNDS (Ago 24 2026) — ang "watchclock" ng ads: kada takdang oras,
-- ang partner ay dumadaan sa BAWAT ad account niyang may gastos ngayong araw at
-- nagmamarka ng "Monitored" SA LOOB mismo ng Ads Manager. Hindi ito checklist —
-- tinanggihan ng may-ari ang checklist dahil kayang tsekan nang hindi tumitingin.
--
-- ANG TATLONG TALAHANAYAN:
--   monitor_settings  → kada partner: aling shift / anong mga oras (admin lang
--                       ang nagsusulat — 0032 na hati ng RLS)
--   monitor_slots     → ISANG row kada (partner, petsa, oras): ang "freeze" ng
--                       kailangang bantayan sa sandaling bumukas ang slot. Ang
--                       UNIQUE key nito ang mutex — iisang device lang ang
--                       mananalo sa freeze at magpapadala ng abiso.
--   monitor_checks    → isang row kada account na kailangang tingnan sa slot na
--                       iyon; ang check-in ay conditional UPDATE (checked_at IS
--                       NULL) — imposible ang dobleng check sa dalawang device.
--
-- ⚠ ORAS NG SERVER ANG BATAYAN: may trigger na nagtatatak ng checked_server_at =
-- now() — walang silbi ang paggalaw ng orasan ng device. ⚠ HINDI NABABAGO ANG
-- EBIDENSYA: ang na-check nang row ay tumatanggi sa anumang UPDATE (exception);
-- ang pagtatama ay DELETE ng admin lamang.

-- ── SETTINGS ─────────────────────────────────────────────────────────────────
create table if not exists public.monitor_settings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  owner text not null,                       -- pangalan ng partner (fb_accounts.owner)
  shift text not null default 'am' check (shift in ('am','pm','custom')),
  custom_times text[] not null default '{}', -- "HH:MM" kapag custom
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text not null default '',
  unique (business_id, owner)
);
alter table public.monitor_settings enable row level security;

drop policy if exists "Members read monitor_settings" on public.monitor_settings;
create policy "Members read monitor_settings" on public.monitor_settings for select using (
  exists (select 1 from public.businesses where id = monitor_settings.business_id and owner_id = auth.uid())
  or public.is_business_member(monitor_settings.business_id)
);
-- Admin lang ang nagtatakda ng oras ng bantay — hindi ang partner mismo.
drop policy if exists "Admins insert monitor_settings" on public.monitor_settings;
create policy "Admins insert monitor_settings" on public.monitor_settings for insert with check (
  exists (select 1 from public.businesses where id = monitor_settings.business_id and owner_id = auth.uid())
  or exists (select 1 from public.business_users bu
             where bu.business_id = monitor_settings.business_id
               and bu.user_id = auth.uid() and bu.mother = true)
);
drop policy if exists "Admins update monitor_settings" on public.monitor_settings;
create policy "Admins update monitor_settings" on public.monitor_settings for update using (
  exists (select 1 from public.businesses where id = monitor_settings.business_id and owner_id = auth.uid())
  or exists (select 1 from public.business_users bu
             where bu.business_id = monitor_settings.business_id
               and bu.user_id = auth.uid() and bu.mother = true)
);
drop policy if exists "Admins delete monitor_settings" on public.monitor_settings;
create policy "Admins delete monitor_settings" on public.monitor_settings for delete using (
  exists (select 1 from public.businesses where id = monitor_settings.business_id and owner_id = auth.uid())
  or exists (select 1 from public.business_users bu
             where bu.business_id = monitor_settings.business_id
               and bu.user_id = auth.uid() and bu.mother = true)
);

-- ── CONFIG: ang kandado ng buong app ─────────────────────────────────────────
-- Habol ng may-ari (Ago 24 2026): bago magamit ang PesoWise ng partner/marketing
-- na may bukas na round, dapat matapos muna ang ads checking — naka-LOCK ang
-- lahat ng ibang pahina hanggang doon. Ang admin ang may on/off nito.
create table if not exists public.monitor_config (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lock_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text not null default '',
  unique (business_id)
);
alter table public.monitor_config enable row level security;

drop policy if exists "Members read monitor_config" on public.monitor_config;
create policy "Members read monitor_config" on public.monitor_config for select using (
  exists (select 1 from public.businesses where id = monitor_config.business_id and owner_id = auth.uid())
  or public.is_business_member(monitor_config.business_id)
);
drop policy if exists "Admins insert monitor_config" on public.monitor_config;
create policy "Admins insert monitor_config" on public.monitor_config for insert with check (
  exists (select 1 from public.businesses where id = monitor_config.business_id and owner_id = auth.uid())
  or exists (select 1 from public.business_users bu
             where bu.business_id = monitor_config.business_id
               and bu.user_id = auth.uid() and bu.mother = true)
);
drop policy if exists "Admins update monitor_config" on public.monitor_config;
create policy "Admins update monitor_config" on public.monitor_config for update using (
  exists (select 1 from public.businesses where id = monitor_config.business_id and owner_id = auth.uid())
  or exists (select 1 from public.business_users bu
             where bu.business_id = monitor_config.business_id
               and bu.user_id = auth.uid() and bu.mother = true)
);

-- ── SINO ANG MAAARING MAG-FREEZE AT MAG-CHECK ────────────────────────────────
-- Partners at marketing lang (hiling ng may-ari) + ang admin. Nasa DATABASE ang
-- pinto, hindi sa itsura ng pahina: ang position regex ay kapareho ng nasa app
-- (/marketing|advertis|partner/i), at ang may hawak na ad account ay partner
-- kahit blangko ang position niya (totoong kaso: may-ari ng 3 account, walang
-- position sa roster).
create or replace function public.is_monitor_eligible(biz uuid)
returns boolean language sql stable as $$
  select
    exists (select 1 from public.businesses b where b.id = biz and b.owner_id = auth.uid())
    or exists (
      select 1 from public.business_users bu
      where bu.business_id = biz and bu.user_id = auth.uid()
        and (
          bu.mother = true
          or coalesce(bu.position, '') ~* 'marketing|advertis|partner'
          or exists (
            select 1 from public.fb_accounts f
            where f.business_id = biz
              and (
                lower(f.owner) = lower(coalesce(nullif(bu.full_name, ''), bu.username, ''))
                -- ⚠ UNANG + HULING SALITA rin — ang gitnang pangalan ang pumuputol
                -- ng ugnayan (totoong kaso: fb owner "Eugene Andaya" pero roster
                -- "Eugene Noval Andaya"). Kapareho ng fallback ng rosterEmailByName.
                or (
                  nullif(trim(coalesce(bu.full_name, '')), '') is not null
                  and lower(split_part(trim(f.owner), ' ', 1)) = lower(split_part(trim(bu.full_name), ' ', 1))
                  and lower(reverse(split_part(reverse(trim(f.owner)), ' ', 1)))
                      = lower(reverse(split_part(reverse(trim(bu.full_name)), ' ', 1)))
                )
              )
          )
        )
    )
$$;

-- ── SLOTS (ang freeze + notification mutex) ──────────────────────────────────
create table if not exists public.monitor_slots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  owner text not null,
  slot_date date not null,                   -- petsa NG MISMONG ORAS ng slot (Manila) —
  slot_time text not null,                   -- kaya ang 23:45 ay hindi nadadala ng hatinggabi
  frozen_at timestamptz not null default now(),
  frozen_by text not null default '',
  account_count int not null default 0,
  missed_notified boolean not null default false,
  unique (business_id, owner, slot_date, slot_time)
);
alter table public.monitor_slots enable row level security;

drop policy if exists "Members read monitor_slots" on public.monitor_slots;
create policy "Members read monitor_slots" on public.monitor_slots for select using (
  exists (select 1 from public.businesses where id = monitor_slots.business_id and owner_id = auth.uid())
  or public.is_business_member(monitor_slots.business_id)
);
drop policy if exists "Eligible insert monitor_slots" on public.monitor_slots;
create policy "Eligible insert monitor_slots" on public.monitor_slots for insert
  with check (public.is_monitor_eligible(monitor_slots.business_id));
drop policy if exists "Eligible update monitor_slots" on public.monitor_slots;
create policy "Eligible update monitor_slots" on public.monitor_slots for update
  using (public.is_monitor_eligible(monitor_slots.business_id));
drop policy if exists "Admins delete monitor_slots" on public.monitor_slots;
create policy "Admins delete monitor_slots" on public.monitor_slots for delete using (
  exists (select 1 from public.businesses where id = monitor_slots.business_id and owner_id = auth.uid())
  or exists (select 1 from public.business_users bu
             where bu.business_id = monitor_slots.business_id
               and bu.user_id = auth.uid() and bu.mother = true)
);

-- ── CHECKS (isang row kada account na dapat tingnan) ─────────────────────────
create table if not exists public.monitor_checks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  slot_id uuid not null references public.monitor_slots(id) on delete cascade,
  owner text not null,
  slot_date date not null,
  slot_time text not null,
  account_id text not null,                  -- fb_accounts.id (app row id — hindi nagbabago sa token swap)
  account_name text not null default '',
  spend_at_freeze numeric not null default 0,
  checked_at timestamptz,                    -- null = hindi pa nababantayan
  checked_server_at timestamptz,             -- tatak ng SERVER — trigger ang nagsusulat
  checked_by_name text not null default '',
  checked_by_email text not null default '',
  spend_at_check numeric not null default 0,
  active_campaigns int not null default 0,
  data_pulled_at timestamptz,
  dwell_ms int not null default 0,
  quiz_attempts int not null default 1,
  verdict text not null default 'ok' check (verdict in ('ok','action')),
  note text not null default '',
  no_data boolean not null default false,
  unique (business_id, owner, slot_date, slot_time, account_id)
);
create index if not exists monitor_checks_day_idx on public.monitor_checks (business_id, slot_date);
alter table public.monitor_checks enable row level security;

drop policy if exists "Members read monitor_checks" on public.monitor_checks;
create policy "Members read monitor_checks" on public.monitor_checks for select using (
  exists (select 1 from public.businesses where id = monitor_checks.business_id and owner_id = auth.uid())
  or public.is_business_member(monitor_checks.business_id)
);
drop policy if exists "Eligible insert monitor_checks" on public.monitor_checks;
create policy "Eligible insert monitor_checks" on public.monitor_checks for insert
  with check (public.is_monitor_eligible(monitor_checks.business_id));
drop policy if exists "Eligible update monitor_checks" on public.monitor_checks;
create policy "Eligible update monitor_checks" on public.monitor_checks for update
  using (public.is_monitor_eligible(monitor_checks.business_id));
drop policy if exists "Admins delete monitor_checks" on public.monitor_checks;
create policy "Admins delete monitor_checks" on public.monitor_checks for delete using (
  exists (select 1 from public.businesses where id = monitor_checks.business_id and owner_id = auth.uid())
  or exists (select 1 from public.business_users bu
             where bu.business_id = monitor_checks.business_id
               and bu.user_id = auth.uid() and bu.mother = true)
);

-- ── TRIGGERS: oras ng server + hindi nababagong ebidensya ────────────────────
create or replace function public.monitor_check_stamp() returns trigger
language plpgsql as $$
begin
  -- Ang UNANG pagtawid mula null → may checked_at: ang server ang nagtatatak ng
  -- totoong oras. Kahit ano ang ipadala ng kliyente, ito ang paniniwalaan.
  if old.checked_at is null and new.checked_at is not null then
    new.checked_server_at := now();
    return new;
  end if;
  -- Ang na-check nang row ay BATO na: walang edit ng ebidensya pagkatapos.
  if old.checked_at is not null then
    raise exception 'monitor check is immutable once recorded';
  end if;
  return new;
end $$;
drop trigger if exists monitor_check_stamp_trg on public.monitor_checks;
create trigger monitor_check_stamp_trg
  before update on public.monitor_checks
  for each row execute function public.monitor_check_stamp();

-- ⚠ Ang INSERT ay laging HINDI PA na-check. Kung wala ito, kayang mag-insert ng
-- partner (deretso sa API) ng row na may checked_at, dwell, quiz at server na
-- oras na gawa-gawa — lampas sa UPDATE na trigger. Ang bagong row ay laging
-- malinis; ang tanging daan sa "checked" ay ang UPDATE na tinatatakan ng server.
create or replace function public.monitor_check_insert_guard() returns trigger
language plpgsql as $$
begin
  new.checked_at := null;
  new.checked_server_at := null;
  new.checked_by_name := '';
  new.checked_by_email := '';
  new.spend_at_check := 0;
  new.active_campaigns := 0;
  new.data_pulled_at := null;
  new.dwell_ms := 0;
  new.quiz_attempts := 1;
  new.verdict := 'ok';
  new.note := '';
  new.no_data := false;
  return new;
end $$;
drop trigger if exists monitor_check_insert_guard_trg on public.monitor_checks;
create trigger monitor_check_insert_guard_trg
  before insert on public.monitor_checks
  for each row execute function public.monitor_check_insert_guard();
