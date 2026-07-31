-- =====================================================================
-- HR MODULE (PesoWise HR) — 201 File, Holidays, Events.
--
-- ⚠ HINDI PA ITO TUMATAKBO. Ang HR module ay itinayo habang walang paraan
-- para magpatakbo ng DDL, kaya ang kasalukuyang imbakan ay JSON documents
-- sa `problem-files` storage bucket (hr/{business_id}/*.json — tingnan ang
-- src/lib/hr-store.ts). Patakbuhin ito sa Supabase SQL editor kapag handa
-- nang ilipat sa totoong tables ang data, TAPOS baguhin ang hr-store.ts na
-- magbasa/magsulat dito. Ang mga field na may kinalaman sa SWELDO ay dito
-- lang idadagdag — kailanman ay hindi sa public-read na bucket.
-- =====================================================================

create table if not exists public.hr_employees (
  id text primary key,
  business_id uuid references public.businesses(id) on delete cascade not null,
  employee_no text default '',
  first_name text default '',
  middle_name text default '',
  last_name text default '',
  position text default '',
  department text default '',
  branch text default '',
  status text default 'Active',        -- Active | Inactive | Resigned | Terminated
  gender text default '',
  birthdate text default '',           -- YYYY-MM-DD
  date_hired text default '',
  date_separated text default '',
  company_email text default '',       -- tumutugma sa PesoWise login (ODM DTR matching)
  personal_email text default '',
  contact_no text default '',
  bio_id text default '',
  dtr_username text default '',
  notes text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists hr_employees_business_idx on public.hr_employees (business_id);

create table if not exists public.hr_holidays (
  id text primary key,
  business_id uuid references public.businesses(id) on delete cascade not null,
  date text not null,                  -- YYYY-MM-DD
  name text default '',
  type text default 'regular'          -- regular | special | double
);
create index if not exists hr_holidays_business_idx on public.hr_holidays (business_id);

create table if not exists public.hr_events (
  id text primary key,
  business_id uuid references public.businesses(id) on delete cascade not null,
  date text not null,
  name text default '',
  description text default ''
);
create index if not exists hr_events_business_idx on public.hr_events (business_id);

alter table public.hr_employees enable row level security;
alter table public.hr_holidays enable row level security;
alter table public.hr_events enable row level security;

drop policy if exists "Business members access hr_employees" on public.hr_employees;
create policy "Business members access hr_employees" on public.hr_employees for all using (
  exists (select 1 from public.businesses where id = hr_employees.business_id and owner_id = auth.uid())
  or public.is_business_member(hr_employees.business_id)
);

drop policy if exists "Business members access hr_holidays" on public.hr_holidays;
create policy "Business members access hr_holidays" on public.hr_holidays for all using (
  exists (select 1 from public.businesses where id = hr_holidays.business_id and owner_id = auth.uid())
  or public.is_business_member(hr_holidays.business_id)
);

drop policy if exists "Business members access hr_events" on public.hr_events;
create policy "Business members access hr_events" on public.hr_events for all using (
  exists (select 1 from public.businesses where id = hr_events.business_id and owner_id = auth.uid())
  or public.is_business_member(hr_events.business_id)
);
