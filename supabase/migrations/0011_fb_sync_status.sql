-- PesoWise — FB Billing auto-sync status (para may "Last synced" message sa FB Billing
-- page). Isinusulat ng daily scheduled task; binabasa ng ERP. Run in Supabase SQL Editor.

create table if not exists public.fb_sync_status (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  last_sync_at timestamptz,
  ok boolean default true,           -- true = successful run; false = na-skip/nag-error
  added_count integer default 0,     -- ilang BAGONG charge ang na-import sa huling takbo
  total_count integer default 0,     -- kabuuang charges pagkatapos ng run
  note text default '',              -- human-readable status message
  updated_at timestamptz default now()
);

alter table public.fb_sync_status enable row level security;
drop policy if exists "Business members access fb_sync_status" on public.fb_sync_status;
create policy "Business members access fb_sync_status" on public.fb_sync_status for all using (
  exists (select 1 from public.businesses where id = fb_sync_status.business_id and owner_id = auth.uid())
  or public.is_business_member(fb_sync_status.business_id)
);
