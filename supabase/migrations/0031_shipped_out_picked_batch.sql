-- PesoWise — SHIPPED OUT: itala ang PINILING batch ng warehouse sa oras ng scan.
-- Run in Supabase Dashboard → SQL Editor. Safe to re-run.
--
-- ANG FIFO AY HULA: ipinagpapalagay nito na ang pinakalumang batch ang pisikal na
-- kinuha. Kapag dalawang presyo ang magkasabay na may laman (₱35 at ₱30) at ang
-- packer ay kumukuha ng kung ano ang abot-kamay, maaaring mali ang hula.
--
-- Ang scan screen ay nagtatanong na ngayon KUNG KAILAN LANG MAY TUNAY NA PAGPIPILIAN
-- (dalawa o higit pang batch na may laman at magkaiba ang presyo) — isang pili kada
-- sesyon, hindi kada scan. Ang sagot ay naitatala rito, at ito ang UNANG sinusunod
-- ng bawas kapag na-Shipped na sa Pancake; ang FIFO ay fallback na lang para sa mga
-- parcel na walang sagot (hindi na-scan, o iisa lang naman ang batch).

alter table public.shipped_out_scans
  add column if not exists picked_batches jsonb not null default '{}'::jsonb;

comment on column public.shipped_out_scans.picked_batches is
  '{item_id: batch_id} — ang batch na sinabi ng warehouse na pisikal na pinagkunan, napili sa scan screen. Nauuna ito sa FIFO sa pagkuwenta ng bawas; walang laman = FIFO ang masusunod.';
