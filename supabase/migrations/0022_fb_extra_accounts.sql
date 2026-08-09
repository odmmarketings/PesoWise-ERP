-- PesoWise — FB ACCOUNTS: maraming ad account ID sa isang registration.
-- Run in Supabase Dashboard → SQL Editor. Safe to re-run.
--
-- ANG PROBLEMA: isang ad account ID lang ang kayang hawakan ng isang registration.
-- Pero maraming brand ang may NA-DISABLE nang ad account na may nagastos pa rin —
-- hal. ang Growtica: isang aktibo, tatlong disabled. Ang gastos ng tatlo ay TOTOONG
-- perang nagastos, pero hindi nabibilang sa adspent dahil walang mapaglagyan.
--
-- Dito sila inilalagay. Nananatiling PANGUNAHIN ang `ad_account_id` (iyon ang
-- ginagamit ng Ads Manager, FB Billing, at status sync), at ang mga karagdagan ay
-- pang-SUMA lang ng gastos — kaya walang nasisira sa mga umiiral na tampok.

alter table public.fb_accounts
  add column if not exists extra_account_ids jsonb not null default '[]'::jsonb;

comment on column public.fb_accounts.extra_account_ids is
  'Karagdagang ad account ID (kadalasan disabled na) na ang gastos ay dapat isama sa adspent ng registration na ito. Pang-suma ng gastos lang — ang ad_account_id pa rin ang pangunahing account.';
