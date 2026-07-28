-- PesoWise — SHIPPED OUT: itago ang halaga ng order sa oras ng scan, para may
-- "Total Amount" ang Shipped Out Report (COD / final price ng parcel na umalis).
-- Ang mga naunang na-scan ay mananatiling 0 — walang record ng halaga noon.
-- Run in Supabase Dashboard → SQL Editor. Safe to re-run.

alter table public.shipped_out_scans
  add column if not exists amount numeric(14,2) not null default 0;
