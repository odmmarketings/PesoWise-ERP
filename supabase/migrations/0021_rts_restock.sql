-- PesoWise — RTS RESTOCK: ibalik sa inventory ang mga nagbalik na parcel.
-- Run in Supabase Dashboard → SQL Editor. Safe to re-run.
--
-- Ang gate ay nakalagay sa shipped_out_scans, katabi ng `batch_lines` — doon nakasulat
-- kung saang cost layer galing ang bawat piraso, at doon din dapat ibalik. Kaparehong
-- pananggalang ng `deducted`: conditional update, kaya isang beses lang tumatawid ang
-- isang parcel kahit ilang device ang sabay pumindot.
--
-- ANG MABUTI LANG ANG BUMABALIK. Ang sira at nawala ay HINDI ibinabalik sa sellable na
-- stock — umalis sila at hindi na maibebenta, at nagastos na ang COGS nila. Kung
-- ibabalik sila, magmumukhang may 100 kang maibebenta gayong 99 lang ang totoo.

alter table public.shipped_out_scans
  add column if not exists restocked_at  timestamptz,
  add column if not exists restocked_by  text default '',
  add column if not exists restocked_qty numeric(12,2) not null default 0,
  add column if not exists restock_lines jsonb not null default '[]'::jsonb;

comment on column public.shipped_out_scans.restocked_at is
  'Kailan ibinalik sa inventory ang parcel na ito. Null = hindi pa. Ito ang gate — conditional update ang nagbabantay kaya hindi madodoble ang pagbabalik.';
comment on column public.shipped_out_scans.restocked_qty is
  'Ilang MABUTING piraso ang naibalik sa sellable na stock. Hindi kasama ang sira at nawala — hindi na sila maibebenta.';
comment on column public.shipped_out_scans.restock_lines is
  '[{item_id, batch_id, batch_no, qty, cog}] — kung saang batch ibinalik. Sinusundan ang batch_lines: sa mismong layer na pinanggalingan bumabalik, hindi sa pinakabago.';
