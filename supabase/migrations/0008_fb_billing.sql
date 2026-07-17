-- PesoWise — Facebook Billing History (daily per-ad-account FB spend recorded into Book
-- Keeping, matched to the Finance CARDS registry via the funding-source last-4 digits).
-- One row per ad account per day = ang na-bill ni Meta for that day (Meta removed the
-- per-charge transactions API, so daily spend is the billing source of truth).
-- Run in Supabase Dashboard → SQL Editor. Safe to re-run.

create table if not exists public.fb_billing_records (
  business_id uuid references public.businesses(id) on delete cascade not null,
  ad_account_id text not null,       -- act_… id
  date text not null,                -- "YYYY-MM-DD" (spend day)
  ad_account_name text default '',
  amount numeric(14,2) default 0,
  currency text default 'PHP',
  funding_display text default '',   -- e.g. "VISA *9850" from funding_source_details
  card_last4 text default '',
  matched_card_id text default '',   -- finance_cards.id na tumugma sa last4 (o manual link)
  bank text default '',              -- bank na ginamit sa Book Keeping entry
  recorded_txn_id uuid references public.bookkeeping_txns(id) on delete set null,
  inserted_at timestamptz default now(),
  primary key (business_id, ad_account_id, date)
);

alter table public.fb_billing_records enable row level security;
drop policy if exists "Business members access fb_billing_records" on public.fb_billing_records;
create policy "Business members access fb_billing_records" on public.fb_billing_records for all using (
  exists (select 1 from public.businesses where id = fb_billing_records.business_id and owner_id = auth.uid())
  or public.is_business_member(fb_billing_records.business_id)
);
