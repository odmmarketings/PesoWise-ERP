-- PesoWise — Finance CARDS registry (payment cards used for ad accounts) + link from
-- fb_accounts to the card used at registration. Run in Supabase SQL Editor. Safe to re-run.

create table if not exists public.finance_cards (
  id text primary key,
  business_id uuid references public.businesses(id) on delete cascade not null,
  name text default '',              -- Account Name (as printed on the card/wallet)
  account_number text default '',    -- wallet/bank account number
  card_number text default '',       -- 16-digit number sa mismong card
  qr_data text default '',           -- uploaded QR image (downscaled data URL)
  expiry text default '',            -- MM/YY
  cvv text default '',
  provider text default '',          -- PayMaya / PayMaya Credit Card / GoTyme / …
  remarks text default '',
  created_by text default '',
  created_at text default '',        -- ISO string (app field)
  inserted_at timestamptz default now()
);
create index if not exists finance_cards_business_idx on public.finance_cards (business_id);

alter table public.fb_accounts add column if not exists card_id text default '';
alter table public.finance_cards add column if not exists card_number text default '';
alter table public.finance_cards add column if not exists username text default '';

alter table public.finance_cards enable row level security;
drop policy if exists "Business members access finance_cards" on public.finance_cards;
create policy "Business members access finance_cards" on public.finance_cards for all using (
  exists (select 1 from public.businesses where id = finance_cards.business_id and owner_id = auth.uid())
  or public.is_business_member(finance_cards.business_id)
);
