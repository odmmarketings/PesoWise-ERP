-- INVENTORY RESET MARKER (hiling ng may-ari, Ago 20 2026: "reset tayo, PPW 0"
-- — at "admin lang ang may access").
--
-- Ang PPW ay HINDI nakaimbak na bilang — hinuhusgahan ito nang buhay mula sa
-- Pancake (may waybill na PERO hindi pa nakukuha ng courier). Kaya walang
-- buburahin para maging zero ito; ang tanging tapat na paraan ay GUHIT SA
-- PETSA: mula sa reset, ang mga order BAGO ang guhit ay hindi na binibilang.
--
-- ⚠ HATI ANG RLS — SINADYA, iba sa karaniwang "for all" ng ibang tables:
--   • SELECT: lahat ng miyembro — ang PPW page ng BAWAT makina ay kailangang
--     makabasa ng guhit; kung hindi, magkakaiba ang PPW kada tao.
--   • INSERT/UPDATE/DELETE: MAY-ARI o MOTHER ACCOUNT lang. Kung "for all" ito,
--     kahit sinong staff ay kayang usugin o burahin ang guhit gamit ang anon
--     key — at ang paggalaw ng guhit ay pagpapalit ng kasaysayan ng PPW.
--
-- HINDI ito inilagay sa ecommerce_settings: iisang row iyon na "for all" ang
-- RLS para sa ibang setting, at walang per-column na kandado ang Postgres RLS.
create table if not exists public.inventory_resets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  ppw_from date not null,
  reset_at timestamptz not null default now(),
  reset_by text not null default '',
  unique (business_id)
);

alter table public.inventory_resets enable row level security;

-- BASA: lahat ng miyembro — ang guhit ay bahagi ng tanawin ng lahat.
drop policy if exists "Members read inventory_resets" on public.inventory_resets;
create policy "Members read inventory_resets" on public.inventory_resets for select using (
  exists (select 1 from public.businesses where id = inventory_resets.business_id and owner_id = auth.uid())
  or public.is_business_member(inventory_resets.business_id)
);

-- SULAT: may-ari ng business O Mother Account (`business_users.mother`) lang.
-- Ito ang tunay na "admin lang" — nasa database, hindi sa itsura ng pahina.
drop policy if exists "Admins write inventory_resets" on public.inventory_resets;
create policy "Admins write inventory_resets" on public.inventory_resets
for insert with check (
  exists (select 1 from public.businesses where id = inventory_resets.business_id and owner_id = auth.uid())
  or exists (select 1 from public.business_users bu
             where bu.business_id = inventory_resets.business_id
               and bu.user_id = auth.uid() and bu.mother = true)
);
drop policy if exists "Admins update inventory_resets" on public.inventory_resets;
create policy "Admins update inventory_resets" on public.inventory_resets
for update using (
  exists (select 1 from public.businesses where id = inventory_resets.business_id and owner_id = auth.uid())
  or exists (select 1 from public.business_users bu
             where bu.business_id = inventory_resets.business_id
               and bu.user_id = auth.uid() and bu.mother = true)
);
drop policy if exists "Admins delete inventory_resets" on public.inventory_resets;
create policy "Admins delete inventory_resets" on public.inventory_resets
for delete using (
  exists (select 1 from public.businesses where id = inventory_resets.business_id and owner_id = auth.uid())
  or exists (select 1 from public.business_users bu
             where bu.business_id = inventory_resets.business_id
               and bu.user_id = auth.uid() and bu.mother = true)
);

-- Kung naitakbo na ang naunang bersyon ng 0032 (jsonb column sa
-- ecommerce_settings), linisin — hindi na iyon ang daanan.
alter table public.ecommerce_settings drop column if exists inventory_reset;
