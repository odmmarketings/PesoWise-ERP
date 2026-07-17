-- PesoWise — Phase 3: E-commerce module (Pages & Store, Adspent/ROAS, FB Ad Accounts,
-- BM Accounts, Product Testing, Profitability, Sales Tracker shared maps) shared
-- persistence. Run in Supabase Dashboard → SQL Editor. Safe to re-run.

-- =====================
-- 1) Pages & Store — one row per registered page/store. `id` is TEXT and keeps the
--    app-generated id (Date.now() strings) because Adspent entries are keyed by it;
--    changing ids would orphan every existing adspent figure.
-- =====================
create table if not exists public.store_pages (
  id text primary key,
  business_id uuid references public.businesses(id) on delete cascade not null,
  name text default '',
  description text default '',
  owner text default '',
  platform text default 'Facebook Ecom',
  page_url text default '',
  shop_id text default '',
  api_key text default '',
  pancake_page_id text default '',
  sender_name text default '',
  status text default 'active',
  created_by text default '',
  created_at text default '',        -- app field: "YYYY-MM-DD" display string
  archived_at text,                  -- app field: ISO string or null
  inserted_at timestamptz default now()
);
create index if not exists store_pages_business_idx on public.store_pages (business_id);

-- =====================
-- 2) Adspent — per-page per-day ad spend (ROAS Tracker / Adspent ROAS Summary).
--    Mirrors the old `${pageId}|${YYYY-MM-DD}` localStorage map as one row per entry.
-- =====================
create table if not exists public.adspent_entries (
  business_id uuid references public.businesses(id) on delete cascade not null,
  page_id text not null,
  date text not null,                -- "YYYY-MM-DD"
  amount numeric(14,2) default 0,
  updated_at timestamptz default now(),
  primary key (business_id, page_id, date)
);

-- =====================
-- 3) Facebook / Meta ad-account registrations
-- =====================
create table if not exists public.fb_accounts (
  id text primary key,
  business_id uuid references public.businesses(id) on delete cascade not null,
  name text default '',
  owner text default '',
  page_name text default '',
  page_url text default '',
  ad_account_id text default '',
  token text default '',
  platform text default 'Facebook',
  focus text default 'Conversions',
  currency text default 'PHP',
  status text default 'Active',
  remarks text default '',
  archived boolean default false,
  created_at text default '',        -- app field: ISO string
  inserted_at timestamptz default now()
);
create index if not exists fb_accounts_business_idx on public.fb_accounts (business_id);

-- =====================
-- 4) BM (Business Manager) accounts — picture_data / id_data hold the same JPEG-compressed
--    base64 data URLs the app already stores (bounded small by the upload re-encoder).
-- =====================
create table if not exists public.bm_accounts (
  id text primary key,
  business_id uuid references public.businesses(id) on delete cascade not null,
  date_created text default '',      -- "YYYY-MM-DD"
  name text default '',
  owner text default '',
  birthday text default '',
  address text default '',
  email text default '',
  contact_no text default '',
  remarks text default '',
  picture_name text default '',
  picture_data text default '',
  id_name text default '',
  id_data text default '',
  adsmanager_link text default '',
  status text default 'Active',
  created_by text default '',
  created_date text default '',      -- ISO string
  inserted_at timestamptz default now()
);
create index if not exists bm_accounts_business_idx on public.bm_accounts (business_id);

-- =====================
-- 5) Product Testing — one row per product; nested structures (creatives, two-level
--    approvals, history audit log) stay as JSONB. Collections live in ecommerce_settings.
-- =====================
create table if not exists public.product_tests (
  id text primary key,
  business_id uuid references public.businesses(id) on delete cascade not null,
  rdp_control_no text default '',
  collection text default '',
  name text default '',
  product_name_description text default '',
  product_image text default '',
  generic_product_name text default '',
  generic_product_image text default '',
  description text default '',
  quantity_per_pack numeric(12,2) default 1,
  product_form text default '',
  other_specs text default '',
  srp numeric(12,2) default 0,
  cog numeric(12,2) default 0,
  cog_percent numeric(8,2) default 0,
  pages text default '',
  platform text default '',
  status text default 'Pending',
  verdict text default 'Pending',
  creatives jsonb not null default '[]'::jsonb,
  archived boolean default false,
  delete_status text default 'none',
  delete_reason text default '',
  delete_remarks text default '',
  approvals jsonb not null default '{}'::jsonb,
  added_by text default '',
  added_date text default '',        -- ISO string
  last_edit_by text default '',
  last_edit_date text default '',    -- ISO string
  history jsonb not null default '[]'::jsonb,
  inserted_at timestamptz default now()
);
create index if not exists product_tests_business_idx on public.product_tests (business_id);

-- =====================
-- 6) E-commerce settings — one row per business, COLUMN-per-concern (not one blob) so
--    the FB default token, Product Testing collections and Profitability calculator
--    inputs can each be updated without clobbering the others.
-- =====================
create table if not exists public.ecommerce_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  fb_default_token jsonb not null default '{}'::jsonb,          -- { token, setAt }
  pt_collections jsonb not null default '[]'::jsonb,            -- string[]
  profitability_inputs jsonb not null default '{}'::jsonb,      -- calculator Inputs
  profitability_upgraded jsonb not null default '{}'::jsonb,    -- UpInputs matrix params
  updated_at timestamptz default now()
);

-- =====================
-- 7) Sales Tracker shared maps
--    a) J&T shipping fees imported from Excel (read by Income Statement too)
--    b) Per-order pre-upsell baseline snapshots (Pancake keeps no "previous amount")
-- =====================
create table if not exists public.jnt_shipping_fees (
  business_id uuid references public.businesses(id) on delete cascade not null,
  tracking_no text not null,
  fee numeric(12,2) default 0,
  updated_at timestamptz default now(),
  primary key (business_id, tracking_no)
);

create table if not exists public.order_baselines (
  business_id uuid references public.businesses(id) on delete cascade not null,
  order_uid text not null,           -- `${pageId}-${pancakeOrderId}`
  amount numeric(14,2) default 0,
  updated_at timestamptz default now(),
  primary key (business_id, order_uid)
);

-- =====================
-- 8) Row Level Security — reuses is_business_member() from migration 0002.
-- =====================
alter table public.store_pages enable row level security;
alter table public.adspent_entries enable row level security;
alter table public.fb_accounts enable row level security;
alter table public.bm_accounts enable row level security;
alter table public.product_tests enable row level security;
alter table public.ecommerce_settings enable row level security;
alter table public.jnt_shipping_fees enable row level security;
alter table public.order_baselines enable row level security;

drop policy if exists "Business members access store_pages" on public.store_pages;
create policy "Business members access store_pages" on public.store_pages for all using (
  exists (select 1 from public.businesses where id = store_pages.business_id and owner_id = auth.uid())
  or public.is_business_member(store_pages.business_id)
);

drop policy if exists "Business members access adspent_entries" on public.adspent_entries;
create policy "Business members access adspent_entries" on public.adspent_entries for all using (
  exists (select 1 from public.businesses where id = adspent_entries.business_id and owner_id = auth.uid())
  or public.is_business_member(adspent_entries.business_id)
);

drop policy if exists "Business members access fb_accounts" on public.fb_accounts;
create policy "Business members access fb_accounts" on public.fb_accounts for all using (
  exists (select 1 from public.businesses where id = fb_accounts.business_id and owner_id = auth.uid())
  or public.is_business_member(fb_accounts.business_id)
);

drop policy if exists "Business members access bm_accounts" on public.bm_accounts;
create policy "Business members access bm_accounts" on public.bm_accounts for all using (
  exists (select 1 from public.businesses where id = bm_accounts.business_id and owner_id = auth.uid())
  or public.is_business_member(bm_accounts.business_id)
);

drop policy if exists "Business members access product_tests" on public.product_tests;
create policy "Business members access product_tests" on public.product_tests for all using (
  exists (select 1 from public.businesses where id = product_tests.business_id and owner_id = auth.uid())
  or public.is_business_member(product_tests.business_id)
);

drop policy if exists "Business members access ecommerce_settings" on public.ecommerce_settings;
create policy "Business members access ecommerce_settings" on public.ecommerce_settings for all using (
  exists (select 1 from public.businesses where id = ecommerce_settings.business_id and owner_id = auth.uid())
  or public.is_business_member(ecommerce_settings.business_id)
);

drop policy if exists "Business members access jnt_shipping_fees" on public.jnt_shipping_fees;
create policy "Business members access jnt_shipping_fees" on public.jnt_shipping_fees for all using (
  exists (select 1 from public.businesses where id = jnt_shipping_fees.business_id and owner_id = auth.uid())
  or public.is_business_member(jnt_shipping_fees.business_id)
);

drop policy if exists "Business members access order_baselines" on public.order_baselines;
create policy "Business members access order_baselines" on public.order_baselines for all using (
  exists (select 1 from public.businesses where id = order_baselines.business_id and owner_id = auth.uid())
  or public.is_business_member(order_baselines.business_id)
);
