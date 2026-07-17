-- PesoWise — businesses table was owner-read-only (schema.sql "Business owner access"),
-- so employees' getBusinessId() returned nothing and every module looked empty for them.
-- Members of the business can now READ the business row (owner keeps full access).
-- Run in Supabase Dashboard → SQL Editor. Safe to re-run. (Applied Jul 17 2026.)

drop policy if exists "Business members can read" on public.businesses;
create policy "Business members can read" on public.businesses
  for select using (public.is_business_member(businesses.id));
