-- TUNAY NA COST NG SUPPLIER — LIHIM, PARA SA MAY-ARI LAMANG.
--
-- ANG KUWENTO: ang may-ari ang supplier mismo. Ang nakikita ng mga partner sa
-- Product Items ay ang IDINEKLARANG COG (hal. ₱27); ang tunay na binayaran ay
-- mas mababa (hal. ₱25). Ang ₱2 na agwat ay kita ng may-ari kada piraso.
--
-- ⚠⚠ ANG RLS DITO AY IBA SA LAHAT NG IBANG TALAHANAYAN — SINADYA.
-- Ang buong app ay gumagamit ng:
--     owner_id = auth.uid()  OR  public.is_business_member(business_id)
-- Ang PANGALAWANG sanga ay nagbibigay ng access sa BAWAT tauhan. Kung gagamitin
-- iyon dito, mababasa ng sinumang naka-login ang tunay na presyo sa pamamagitan
-- ng anon key — kahit pa nakatago ang pahina sa UI.
--
-- Kaya ang MAY-ARI LANG (`businesses.owner_id = auth.uid()`) ang sanga rito.
-- WALANG `is_business_member`. Ito ang tunay na kandado; ang pagtatago sa
-- interface ay pantakip lang, hindi seguridad.
--
-- ⚠ HUWAG DITO ILAGAY ANG IDINEKLARANG COG. Nasa `product_items.cog` at
-- `product_batches.cog` iyon at nakikita ng lahat — tama lang iyon, iyon ang
-- pinagbabatayan ng warehouse. Ang TUNAY na presyo LANG ang narito, kaya ang
-- paglabas ng isang hilera mula rito ay ang tanging paraan para tumagas.
create table if not exists public.supplier_true_costs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- Ang product item na nakarehistro sa Product Items (`product_items.id`).
  item_id text not null,
  -- Ang TOTOONG binayaran kada piraso. Ang agwat nito sa idineklarang COG ang kita.
  true_cost numeric not null default 0,
  note text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text not null default '',
  unique (business_id, item_id)
);

create index if not exists supplier_true_costs_biz_idx
  on public.supplier_true_costs (business_id);

alter table public.supplier_true_costs enable row level security;

-- MAY-ARI LAMANG. Walang `is_business_member` — iyon ang buong punto.
drop policy if exists "Owner only supplier_true_costs" on public.supplier_true_costs;
create policy "Owner only supplier_true_costs" on public.supplier_true_costs for all using (
  exists (
    select 1 from public.businesses
    where id = supplier_true_costs.business_id and owner_id = auth.uid()
  )
) with check (
  exists (
    select 1 from public.businesses
    where id = supplier_true_costs.business_id and owner_id = auth.uid()
  )
);

-- Wala ring pahintulot ang mga anon/authenticated na role sa labas ng RLS.
revoke all on public.supplier_true_costs from anon;
