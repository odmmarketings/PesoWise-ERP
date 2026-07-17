-- PesoWise — Phase 1: shared business + user roster/permissions
-- Run this in the Supabase Dashboard → SQL Editor (paste + Run).
-- Safe to re-run: every statement is guarded (if not exists / add column if not exists).

-- =====================
-- 1) Make business_users nullable on user_id (pending invites have no auth account yet)
--    and extend it with the full ERP roster shape (mirrors src/lib/users-store.ts's ErpUser).
-- =====================
alter table public.business_users alter column user_id drop not null;

alter table public.business_users add column if not exists employee_no text;
alter table public.business_users add column if not exists username text;
alter table public.business_users add column if not exists full_name text;
alter table public.business_users add column if not exists last_name text;
alter table public.business_users add column if not exists first_name text;
alter table public.business_users add column if not exists middle_name text;
alter table public.business_users add column if not exists birthdate date;
alter table public.business_users add column if not exists personal_email text;
alter table public.business_users add column if not exists gender text;
alter table public.business_users add column if not exists employment_date date;
alter table public.business_users add column if not exists position text;
alter table public.business_users add column if not exists company_email text;
alter table public.business_users add column if not exists contact text;
alter table public.business_users add column if not exists status text default 'Active';
alter table public.business_users add column if not exists enabled boolean default false;
alter table public.business_users add column if not exists pending boolean default true;
alter table public.business_users add column if not exists requested boolean default false;
alter table public.business_users add column if not exists mother boolean default false;
alter table public.business_users add column if not exists allowed text[] default '{}';
alter table public.business_users add column if not exists last_login timestamptz;
alter table public.business_users add column if not exists delete_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'business_users_status_check') then
    alter table public.business_users add constraint business_users_status_check
      check (status in ('Active', 'Inactive', 'Resigned', 'Terminated'));
  end if;
end $$;

-- One employee_no per business, once assigned.
create unique index if not exists business_users_employee_no_uniq
  on public.business_users (business_id, employee_no) where employee_no is not null;

-- =====================
-- 2) Bootstrap the single business + its owner as the first Mother Account.
--    Edit the email below if it's not the right owner account, then run this block.
-- =====================
do $$
declare
  v_owner_id uuid;
  v_business_id uuid;
begin
  select id into v_owner_id from public.users where email = 'Larrylobitana@gmail.com';
  if v_owner_id is null then
    raise notice 'No public.users row for that email yet — sign up/log in first, then re-run this block.';
    return;
  end if;

  select id into v_business_id from public.businesses where owner_id = v_owner_id limit 1;
  if v_business_id is null then
    insert into public.businesses (owner_id, name) values (v_owner_id, 'PesoWise ERP')
      returning id into v_business_id;
  end if;

  insert into public.business_users (
    business_id, user_id, employee_no, username, full_name, company_email,
    status, enabled, pending, requested, mother, allowed
  )
  select v_business_id, v_owner_id, 'U-1', 'Larrylobitz', 'Larry Lobitana', 'Larrylobitana@gmail.com',
    'Active', true, false, true, true, '{}'
  where not exists (select 1 from public.business_users where business_id = v_business_id and user_id = v_owner_id);

  raise notice 'Business id: %', v_business_id;
end $$;

-- =====================
-- 3) Row Level Security — business_users wasn't covered by the original schema at all.
--    Read: any logged-in PesoWise account can see the roster (single-company tool, no
--    outside strangers have accounts). Write: business owner, any existing member ("mother"
--    or not — kept simple for an internal team tool), OR a user claiming their OWN still-
--    unclaimed (user_id is null) pending invite row via Request Access.
-- =====================
alter table public.business_users enable row level security;

drop policy if exists "Roster readable by any logged-in user" on public.business_users;
create policy "Roster readable by any logged-in user" on public.business_users
  for select using (auth.uid() is not null);

drop policy if exists "Business members manage roster" on public.business_users;
create policy "Business members manage roster" on public.business_users
  for all using (
    exists (select 1 from public.businesses where id = business_users.business_id and owner_id = auth.uid())
    or exists (select 1 from public.business_users bu2 where bu2.business_id = business_users.business_id and bu2.user_id = auth.uid())
  );

drop policy if exists "Claim an unclaimed pending invite" on public.business_users;
create policy "Claim an unclaimed pending invite" on public.business_users
  for update using (user_id is null) with check (user_id = auth.uid());
