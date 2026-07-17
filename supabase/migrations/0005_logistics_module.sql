-- PesoWise — Phase 4: Logistic & Inventory module (Purchase Order, Supplier, Product
-- Items, Unit Codes, Stocks, Transaction History, RTS Items, Fulfillment annotations)
-- shared persistence. Run in Supabase Dashboard → SQL Editor. Safe to re-run.

-- =====================
-- 1) Purchase Orders — line items + status history as JSONB. `id` is TEXT (keeps the
--    app-generated po_… ids so this browser's existing data migrates unchanged).
-- =====================
create table if not exists public.purchase_orders (
  id text primary key,
  business_id uuid references public.businesses(id) on delete cascade not null,
  issue_date text default '',        -- "YYYY-MM-DD"
  delivery_no text default '',
  cust_po_no text default '',
  control_no text default '',
  supplier text default '',
  delivery_to text default '',
  delivery_address text default '',
  delivery_fee numeric(12,2) default 0,
  assigned_to jsonb not null default '[]'::jsonb,   -- up to 4 employee names
  picked_up_date text default '',
  status text default 'Draft',
  items jsonb not null default '[]'::jsonb,         -- POItem[]
  remarks text default '',
  created_by text default '',
  history jsonb not null default '[]'::jsonb,       -- POHistoryEntry[]
  created_at text default '',        -- app field: ISO string
  inserted_at timestamptz default now()
);
create index if not exists purchase_orders_business_idx on public.purchase_orders (business_id);

-- =====================
-- 2) Suppliers
-- =====================
create table if not exists public.suppliers (
  id text primary key,
  business_id uuid references public.businesses(id) on delete cascade not null,
  store_name text default '',
  name text default '',
  contact text default '',
  address text default '',
  province text default '',
  city text default '',
  brgy text default '',
  contact_person text default '',
  contact_person_no text default '',
  url text default '',
  items jsonb not null default '[]'::jsonb,          -- string[]
  status text default 'Active',
  remarks text default '',
  archived boolean default false,
  created_at text default '',        -- app field: ISO string
  inserted_at timestamptz default now()
);
create index if not exists suppliers_business_idx on public.suppliers (business_id);

-- =====================
-- 3) Product Items — inventory item master. `picture` keeps the same downscaled base64
--    data URL the app already stores. `released` accumulates Stocks-module deductions.
-- =====================
create table if not exists public.product_items (
  id text primary key,
  business_id uuid references public.businesses(id) on delete cascade not null,
  sku text default '',
  name text default '',
  description text default '',
  picture text default '',
  cog numeric(12,2) default 0,
  color text default '',
  size text default '',
  type text default '',
  supplier text default '',
  goods numeric(12,2) default 0,
  damage numeric(12,2) default 0,
  loss numeric(12,2) default 0,
  released numeric(12,2) default 0,
  status text default 'Active',
  archived boolean default false,
  deleted boolean default false,     -- soft delete (recoverable), per the LHIKE manual
  created_at text default '',        -- app field: ISO string
  inserted_at timestamptz default now()
);
create index if not exists product_items_business_idx on public.product_items (business_id);

-- =====================
-- 4) Unit Codes — recipe (items jsonb) + Pancake page scoping (pages jsonb).
-- =====================
create table if not exists public.unit_codes (
  id text primary key,
  business_id uuid references public.businesses(id) on delete cascade not null,
  sku text default '',
  code text default '',
  items jsonb not null default '[]'::jsonb,          -- UnitCodeItem[] (name + qty)
  pages jsonb not null default '[]'::jsonb,          -- string[] (empty = all pages)
  selling_price numeric(12,2) default 0,
  upsell boolean default false,
  archived boolean default false,
  created_at text default '',        -- app field: ISO string
  created_by text default '',
  inserted_at timestamptz default now()
);
create index if not exists unit_codes_business_idx on public.unit_codes (business_id);

-- =====================
-- 5) Stock releases — append-only audit log of every STOCKS UPDATE submit.
-- =====================
create table if not exists public.stock_releases (
  id text primary key,
  business_id uuid references public.businesses(id) on delete cascade not null,
  date text default '',              -- app field: ISO string
  category text default '',
  ref text default '',
  items jsonb not null default '[]'::jsonb,          -- StockReleaseItem[]
  inserted_at timestamptz default now()
);
create index if not exists stock_releases_business_idx on public.stock_releases (business_id);

-- =====================
-- 6) RTS parcel state — one row per TRACKING NUMBER; the whole RtsMeta blob (inspection
--    counts, parcel photos as data URLs, claims) as JSONB. Row-per-tracking keeps the
--    scanner's back-to-back writes from clobbering each other.
-- =====================
create table if not exists public.rts_meta (
  business_id uuid references public.businesses(id) on delete cascade not null,
  tracking_no text not null,
  meta jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now(),
  primary key (business_id, tracking_no)
);

-- =====================
-- 7) Fulfillment warehouse annotations — one row per Pancake ORDER id (packer, shift,
--    packed date, RTS tracking, status/tracking overrides, remarks, last-edit stamps).
-- =====================
create table if not exists public.fulfillment_meta (
  business_id uuid references public.businesses(id) on delete cascade not null,
  order_id text not null,
  meta jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now(),
  primary key (business_id, order_id)
);

-- =====================
-- 8) Logistics settings — one row per business; po_settings maps the PO cost buckets
--    (Delivery Fee / COG Fee) to Finance Settings reference ids for Book Keeping posts.
-- =====================
create table if not exists public.logistics_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  po_settings jsonb not null default '{}'::jsonb,    -- { delivery: POFeeConfig, cog: POFeeConfig }
  updated_at timestamptz default now()
);

-- =====================
-- 9) Row Level Security — reuses is_business_member() from migration 0002.
-- =====================
alter table public.purchase_orders enable row level security;
alter table public.suppliers enable row level security;
alter table public.product_items enable row level security;
alter table public.unit_codes enable row level security;
alter table public.stock_releases enable row level security;
alter table public.rts_meta enable row level security;
alter table public.fulfillment_meta enable row level security;
alter table public.logistics_settings enable row level security;

drop policy if exists "Business members access purchase_orders" on public.purchase_orders;
create policy "Business members access purchase_orders" on public.purchase_orders for all using (
  exists (select 1 from public.businesses where id = purchase_orders.business_id and owner_id = auth.uid())
  or public.is_business_member(purchase_orders.business_id)
);

drop policy if exists "Business members access suppliers" on public.suppliers;
create policy "Business members access suppliers" on public.suppliers for all using (
  exists (select 1 from public.businesses where id = suppliers.business_id and owner_id = auth.uid())
  or public.is_business_member(suppliers.business_id)
);

drop policy if exists "Business members access product_items" on public.product_items;
create policy "Business members access product_items" on public.product_items for all using (
  exists (select 1 from public.businesses where id = product_items.business_id and owner_id = auth.uid())
  or public.is_business_member(product_items.business_id)
);

drop policy if exists "Business members access unit_codes" on public.unit_codes;
create policy "Business members access unit_codes" on public.unit_codes for all using (
  exists (select 1 from public.businesses where id = unit_codes.business_id and owner_id = auth.uid())
  or public.is_business_member(unit_codes.business_id)
);

drop policy if exists "Business members access stock_releases" on public.stock_releases;
create policy "Business members access stock_releases" on public.stock_releases for all using (
  exists (select 1 from public.businesses where id = stock_releases.business_id and owner_id = auth.uid())
  or public.is_business_member(stock_releases.business_id)
);

drop policy if exists "Business members access rts_meta" on public.rts_meta;
create policy "Business members access rts_meta" on public.rts_meta for all using (
  exists (select 1 from public.businesses where id = rts_meta.business_id and owner_id = auth.uid())
  or public.is_business_member(rts_meta.business_id)
);

drop policy if exists "Business members access fulfillment_meta" on public.fulfillment_meta;
create policy "Business members access fulfillment_meta" on public.fulfillment_meta for all using (
  exists (select 1 from public.businesses where id = fulfillment_meta.business_id and owner_id = auth.uid())
  or public.is_business_member(fulfillment_meta.business_id)
);

drop policy if exists "Business members access logistics_settings" on public.logistics_settings;
create policy "Business members access logistics_settings" on public.logistics_settings for all using (
  exists (select 1 from public.businesses where id = logistics_settings.business_id and owner_id = auth.uid())
  or public.is_business_member(logistics_settings.business_id)
);
