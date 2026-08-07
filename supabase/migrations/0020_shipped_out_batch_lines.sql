-- PesoWise — SHIPPED OUT: itala kung SAANG BATCH kinuha ang bawat labas.
-- Run in Supabase Dashboard → SQL Editor. Safe to re-run.
--
-- BAKIT: alam ng FIFO kung aling cost layer ang kinain nito (hal. 2 pcs sa batch na
-- ₱35, hindi sa ₱30), pero panandalian lang ang kaalamang iyon. Kapag hindi naitala,
-- MAWAWALA — at hindi na masasagot ang tanong na darating:
--
--   "Nag-RTS itong parcel. Saan ko ibabalik — sa ₱35 o sa ₱30 na batch?"
--
-- Ang tamang sagot ay LAGING sa batch na pinanggalingan niya. Kung hindi natin alam,
-- ang pagbabalik ay hula na lang, at unti-unting masisira ang halaga ng inventory.
--
-- Ito rin ang magiging basehan ng RTS restock kapag naitayo na: hanapin ang parcel
-- sa tracking number, basahin ang batch_lines, at ibalik ang dami sa MISMONG batch.

alter table public.shipped_out_scans
  add column if not exists batch_lines jsonb not null default '[]'::jsonb,
  add column if not exists cogs_value  numeric(14,2) not null default 0,
  add column if not exists cogs_short  numeric(12,2) not null default 0;

comment on column public.shipped_out_scans.batch_lines is
  '[{item_id, batch_id, batch_no, qty, cog, value}] — kung saang cost layer galing ang bawat pirasong umalis. Ito ang basehan ng pagbabalik kapag nag-RTS.';
comment on column public.shipped_out_scans.cogs_value is
  'Tunay na COGS ng parcel na ito — kabuuan ng (qty × cog ng batch na pinanggalingan), hindi average.';
comment on column public.shipped_out_scans.cogs_short is
  'Ilang piraso ang walang natagpuang batch. Kapag lumagpas sa zero, may umalis na stock na walang cost layer — kulang ang naitalang COGS at may dapat ayusin sa batch.';
