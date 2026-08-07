-- PesoWise — SHIPPED OUT: hiwalayin ang MANUAL SCAN sa AUTOMATED PANCAKE SHIPPED,
-- pero panatilihing IISA ang bawas sa inventory.
-- Run in Supabase Dashboard → SQL Editor. Safe to re-run.
--
-- DATI: ang manual scan ang bumabawas sa inventory. Kapag hindi na-scan ang parcel,
-- hindi nababawasan; kapag na-scan naman ang hindi pa naman talaga umaalis, maagang
-- nababawasan.
--
-- NGAYON: ISANG ROW kada parcel (nananatili ang UNIQUE sa tracking_no), na may dalawang
-- magkahiwalay na tatak:
--   manual_scanned_at   — kailan ito na-scan ng warehouse (talaan ng aktibidad)
--   pancake_shipped_at  — kailan na-detect sa Pancake na umalis na ang parcel
--
-- Ang `deducted` ang nag-iisang pinto ng bawas. Ang PANCAKE lang ang nagbubukas nito —
-- ang manual scan ay nagtatala pero HINDI bumabawas. Kaya:
--   • maikukumpara kung ilan ang na-scan ng warehouse laban sa ilan ang totoong umalis
--   • ang parcel na na-scan pero hindi pa Shipped sa Pancake ay kitang-kita (hindi pa bawas)
--   • hindi kailanman madodoble ang bawas kahit ilang beses tumakbo ang sync

alter table public.shipped_out_scans
  add column if not exists manual_scanned_at  timestamptz,
  add column if not exists manual_scanned_by  text default '',
  add column if not exists pancake_shipped_at timestamptz,
  add column if not exists deducted           boolean not null default false,
  add column if not exists deducted_at        timestamptz;

-- Backfill ng mga LUMANG row: nabawasan na ang mga ito noong panahong ang manual scan
-- ang bumabawas. Kailangang markahang `deducted` — kung hindi, aakalain ng bagong sync
-- na hindi pa sila nababawasan at DODOBLEHIN ang buong kasaysayan.
--
-- Ang `where` ang nagpapaligtas sa muling pagpapatakbo: laging may tatak ang bagong row
-- (manual_scanned_at o pancake_shipped_at), kaya ang mga naunang row lang ang tatamaan.
update public.shipped_out_scans
   set manual_scanned_at = created_at,
       manual_scanned_by = coalesce(nullif(scanned_by, ''), 'Bago ang paghihiwalay'),
       deducted          = true,
       deducted_at       = created_at
 where manual_scanned_at is null
   and pancake_shipped_at is null;

-- Hinahanap ng sync ang mga hindi pa nababawasan — pinapabilis ito.
create index if not exists shipped_out_scans_pending_idx
  on public.shipped_out_scans (business_id, deducted);

comment on column public.shipped_out_scans.manual_scanned_at is
  'Kailan na-scan ng warehouse ang waybill. Talaan ng aktibidad — HINDI ito bumabawas ng inventory.';
comment on column public.shipped_out_scans.pancake_shipped_at is
  'Kailan na-detect sa Pancake na umalis na ang parcel (Shipped/Delivered/Returning/Returned). Ito ang nagbubukas ng bawas.';
comment on column public.shipped_out_scans.deducted is
  'Nabawasan na ba ang inventory para sa parcel na ito. Isang beses lang tumatawid ang false→true, at conditional update ang nagbabantay — kaya walang dobleng bawas kahit sabay tumakbo ang dalawang device.';
