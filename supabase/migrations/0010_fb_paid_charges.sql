-- PesoWise — FB PAID CHARGES: ang mga aktwal na "Paid" transactions mula sa Facebook
-- Billing (eksaktong sinisingil sa card, VAT-inclusive). ITO ang nagpo-post sa Book
-- Keeping para 1:1 ang ledger vs bank statement; ang daily spend ay analytics na lang.
-- Run in Supabase Dashboard → SQL Editor. Safe to re-run.

create table if not exists public.fb_paid_charges (
  id text primary key,               -- reference no. kung meron; kung wala, composite ${acct}|${date}|${amount}|${last4}
  business_id uuid references public.businesses(id) on delete cascade not null,
  paid_date text default '',         -- "YYYY-MM-DD" (petsa ng Paid sa Facebook)
  amount numeric(14,2) default 0,    -- eksaktong Paid amount (VAT-inclusive na)
  billing_account text default '',   -- ad account / billing account name sa FB
  payment_method text default '',    -- hal. "Visa ···· 7349"
  card_last4 text default '',
  reference_no text default '',
  matched_card_id text default '',   -- finance_cards.id na tumugma
  bank text default '',              -- bank ledger na binawasan sa Book Keeping
  source text default 'manual',      -- manual | screenshot | browser
  notes text default '',
  recorded_txn_id uuid references public.bookkeeping_txns(id) on delete set null,
  created_by text default '',
  inserted_at timestamptz default now()
);
create index if not exists fb_paid_charges_business_idx on public.fb_paid_charges (business_id);

alter table public.fb_paid_charges enable row level security;
drop policy if exists "Business members access fb_paid_charges" on public.fb_paid_charges;
create policy "Business members access fb_paid_charges" on public.fb_paid_charges for all using (
  exists (select 1 from public.businesses where id = fb_paid_charges.business_id and owner_id = auth.uid())
  or public.is_business_member(fb_paid_charges.business_id)
);
