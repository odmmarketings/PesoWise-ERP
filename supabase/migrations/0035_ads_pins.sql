-- SHARED ADS PINS (hiling ng may-ari, Ago 24 2026: "pag nag pin ng campaign or
-- adset, or ads, lifetime save na sa pesowise, hindi na nawawala… nakikita namin
-- lahat, syncronize lahat ng pin sa ads manager").
--
-- ⚠ BINABALIKTAD NITO ANG DATING PASYA. Ang pin ay dating localStorage LANG,
-- sinasadyang pansarili ("magkakagulo ang tatlong buyer sa iisang listahan").
-- Hatol ng may-ari: IISANG listahan para sa buong koponan — kung ano ang
-- binabantayan ng isa ay dapat nakikita ng lahat, at hindi nawawala kapag
-- nag-clear ng browser o lumipat ng makina.
--
-- ISANG ROW KADA OBJECT (unique sa business_id + object_id): ang pag-pin ng
-- dalawang tao sa iisang campaign ay iisang pin pa rin, hindi dalawa. Ang
-- `pinned_by_name` ay ang UNANG nag-pin — siya ang nagsimula ng pagbabantay.
create table if not exists public.ads_pins (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  object_id text not null,                 -- Meta id: campaign / adset / ad
  object_level text not null default 'campaign',
  object_name text not null default '',
  account_id text not null default '',     -- fb_accounts.id (para sa konteksto)
  account_name text not null default '',
  pinned_by_name text not null default '',
  pinned_by_email text not null default '',
  created_at timestamptz not null default now(),
  unique (business_id, object_id)
);
create index if not exists ads_pins_biz_idx on public.ads_pins (business_id, created_at desc);
alter table public.ads_pins enable row level security;

-- Ibinabahagi ang listahan, kaya ibinabahagi rin ang lapis: kahit sinong
-- miyembro ay makakapag-pin at makaka-alis ng pin — kapareho ng ads_comments.
-- (Ang nag-pin ay nananatiling nakatala, kaya masasagot pa rin ang "sino ang
-- nagtaas nito?" kahit may nag-alis.)
drop policy if exists "Business members access ads_pins" on public.ads_pins;
create policy "Business members access ads_pins" on public.ads_pins for all using (
  exists (select 1 from public.businesses where id = ads_pins.business_id and owner_id = auth.uid())
  or public.is_business_member(ads_pins.business_id)
) with check (
  exists (select 1 from public.businesses where id = ads_pins.business_id and owner_id = auth.uid())
  or public.is_business_member(ads_pins.business_id)
);
