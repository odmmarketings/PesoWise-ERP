-- PesoWise — PRODUCT BATCHES (FIFO cost layering).
-- Run in Supabase Dashboard → SQL Editor. Safe to re-run.
--
-- ANG PROBLEMA: isang `cog` lang ang hawak ng bawat product item. Kapag dumating ang
-- bagong stock sa ibang presyo, ang pag-average nito sa luma ay RETROACTIVE na
-- nagbabago sa halaga ng mga naibenta na. Kung 100 pcs @ ₱35 ang naibenta mo na at
-- dumating ang 50 @ ₱30, hindi puwedeng maging ₱32 ang lahat — hindi mo binili sa ₱32.
--
-- ANG SOLUSYON: batch (layer) kada dating, may sariling presyo. Ang bawas ay kumukuha
-- sa PINAKALUMANG batch muna (FIFO), kaya ang COGS ng bawat labas ay ang presyong
-- totoong binayaran para sa mismong mga pirasong iyon.
--
--   Lumyra
--   ├── Ago 1 · 100 pcs @ ₱35  ← dito muna kukuha
--   └── Ago 7 ·  50 pcs @ ₱30
--
-- HALAGA NG BILANG: nananatiling nasa product_items ang bilang (goods/damage/loss/
-- released) — hindi ito ginagalaw dito. Ang batch ang nagdadala ng PRESYO, at
-- sinusundan din ang consumed para malaman kung aling layer na ang naubos. Pinapanatili
-- silang magkasundo ng app, at may babala kapag naghiwalay.

create table if not exists public.product_batches (
  id text primary key,
  business_id uuid references public.businesses(id) on delete cascade not null,
  item_id text not null,                       -- product_items.id
  batch_no text default '',                    -- label ng dating (hal. "PO-12" o "Ago 7")
  received_date text default '',               -- YYYY-MM-DD — ITO ang pinagbabatayan ng FIFO
  qty numeric(12,2) default 0,                 -- dami ng natanggap sa batch na ito
  cog numeric(12,2) default 0,                 -- presyo KADA PIRASO sa batch na ito
  consumed numeric(12,2) default 0,            -- ilan na ang nabawas dito (FIFO)
  supplier text default '',
  notes text default '',
  created_by text default '',
  created_at text default '',                  -- app field: ISO string
  inserted_at timestamptz default now()
);
create index if not exists product_batches_business_idx on public.product_batches (business_id);
-- Ang FIFO ay laging nagbabasa kada item, nakaayos ayon sa petsa ng dating.
create index if not exists product_batches_fifo_idx
  on public.product_batches (business_id, item_id, received_date);

alter table public.product_batches enable row level security;
drop policy if exists "Business members access product_batches" on public.product_batches;
create policy "Business members access product_batches" on public.product_batches for all using (
  exists (select 1 from public.businesses where id = product_batches.business_id and owner_id = auth.uid())
  or public.is_business_member(product_batches.business_id)
);

-- ── OPENING BATCH ────────────────────────────────────────────────────────────
-- Ang kasalukuyang stock ay inilalagay bilang IISANG batch sa ngayong COG. Dahil dito,
-- WALANG magbabago sa mga numerong nakikita mo ngayon: pareho pa rin ang natitira at
-- pareho pa rin ang halaga ng inventory. Ang mga susunod na dating lang ang magkakaroon
-- ng sariling layer.
--
-- Ang `consumed` ay itinatakda sa damage + loss + released, kaya tugma agad ang
-- natitira sa batch at ang itemRemaining ng app.
insert into public.product_batches (id, business_id, item_id, batch_no, received_date, qty, cog, consumed, supplier, notes, created_by, created_at)
select
  'bat_open_' || i.id,
  i.business_id,
  i.id,
  'OPENING',
  coalesce(nullif(left(i.created_at, 10), ''), to_char(i.inserted_at, 'YYYY-MM-DD')),
  coalesce(i.goods, 0),
  coalesce(i.cog, 0),
  coalesce(i.damage, 0) + coalesce(i.loss, 0) + coalesce(i.released, 0),
  coalesce(i.supplier, ''),
  'Awtomatikong ginawa noong nilipat sa FIFO batch costing.',
  'System',
  to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
from public.product_items i
where coalesce(i.deleted, false) = false
  -- Idempotent: kapag may opening batch na ang item, laktawan (kaya safe i-re-run).
  and not exists (
    select 1 from public.product_batches b
     where b.business_id = i.business_id and b.item_id = i.id
  );

comment on column public.product_batches.received_date is
  'Petsa ng dating. ITO ang pagkakasunod-sunod ng FIFO — sa pinakaluma muna kumukuha ang bawas.';
comment on column public.product_batches.cog is
  'Presyo kada piraso sa batch NA ITO. Dito nagmumula ang tunay na COGS ng bawat labas.';
comment on column public.product_batches.consumed is
  'Ilan na ang nabawas sa batch na ito. Natitira = qty − consumed. Kapag puno na, sa susunod na batch kukuha.';
