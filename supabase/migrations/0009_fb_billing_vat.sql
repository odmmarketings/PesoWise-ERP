-- PesoWise — FB Billing accuracy: Meta insights `spend` = media cost (walang VAT),
-- pero ang aktwal na sinisingil ng Facebook sa PH cards ay may 12% VAT. Idinagdag ang
-- `vat` column; ang Book Keeping deduction = amount + vat (= totoong card charge).
-- Run in Supabase Dashboard → SQL Editor. Safe to re-run.

alter table public.fb_billing_records add column if not exists vat numeric(14,2) default 0;
