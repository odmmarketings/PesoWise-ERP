-- PesoWise — SHIPPED OUT (Barcode): bawat parcel na na-scan sa paglabas ay naitatala dito,
-- at awtomatikong nababawas sa inventory (via unit-code recipes → product_items.released,
-- naka-log din sa stock_releases para sa Transaction History at Stock-Out Audit).
-- Ang UNIQUE (business_id, tracking_no) ang pumipigil sa dobleng bawas sa parehong parcel.
-- Run in Supabase Dashboard → SQL Editor. Safe to re-run.

create table if not exists public.shipped_out_scans (
  id text primary key,
  business_id uuid references public.businesses(id) on delete cascade not null,
  tracking_no text not null default '',
  courier text default '',
  page_name text default '',
  order_id text default '',
  customer text default '',
  order_item text default '',            -- raw waybill line, hal. "2x Lumyra, 1x Iba"
  items jsonb not null default '[]'::jsonb,   -- [{item_id, sku, name, deducted}] — aktwal na binawas
  deducted_total numeric(12,2) not null default 0,
  scanned_by text default '',
  date text not null default '',         -- YYYY-MM-DD (araw ng scan — report date filter)
  created_at timestamptz default now()
);
create unique index if not exists shipped_out_scans_tracking_idx
  on public.shipped_out_scans (business_id, tracking_no);
create index if not exists shipped_out_scans_date_idx
  on public.shipped_out_scans (business_id, date);

alter table public.shipped_out_scans enable row level security;
drop policy if exists "Business members access shipped_out_scans" on public.shipped_out_scans;
create policy "Business members access shipped_out_scans" on public.shipped_out_scans for all using (
  exists (select 1 from public.businesses where id = shipped_out_scans.business_id and owner_id = auth.uid())
  or public.is_business_member(shipped_out_scans.business_id)
);
