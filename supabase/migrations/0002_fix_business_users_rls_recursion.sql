-- PesoWise — fix infinite RLS recursion on business_users.
-- The "Business members manage roster" policy from migration 0001 checks membership by
-- querying business_users FROM WITHIN a policy ON business_users — Postgres re-evaluates
-- that same policy for every row the subquery touches, recursing until it hits the stack
-- depth limit (surfaces as a 500 from PostgREST). Fix: move the membership check into a
-- SECURITY DEFINER function, which runs with elevated privileges and bypasses RLS for that
-- one lookup, breaking the recursive chain.
-- Run this in the Supabase Dashboard → SQL Editor (paste + Run). Safe to re-run.

create or replace function public.is_business_member(p_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.business_users
    where business_id = p_business_id and user_id = auth.uid()
  );
$$;

drop policy if exists "Business members manage roster" on public.business_users;
create policy "Business members manage roster" on public.business_users
  for all using (
    exists (select 1 from public.businesses where id = business_users.business_id and owner_id = auth.uid())
    or public.is_business_member(business_users.business_id)
  );
