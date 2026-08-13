-- Ang registry ay humahawak na ngayon ng DALAWANG antas:
--   level='adset'    → Testing tab: bagong testing ad set, sinusundan 3–5 araw
--   level='campaign' → Scaling tab: scaling campaign (1-1-40+ Andromeda), dito
--                      ang Scale 10%/20% dahil sa campaign nakalagay ang CBO budget
--
-- Ang `adset_id` ay ang OBJECT id — ad set id kapag level='adset', campaign id
-- kapag level='campaign'. Hindi sila nagsasalubong sa Meta kaya buo pa rin ang
-- unique (business_id, adset_id). Hindi pinalitan ang pangalan ng column para
-- hindi masira ang mga naunang naitala.
alter table public.scaling_registry
  add column if not exists level text not null default 'adset';

comment on column public.scaling_registry.adset_id is
  'Meta object id — ad set id kapag level=adset, campaign id kapag level=campaign';
comment on column public.scaling_registry.level is
  'adset (Testing tab) o campaign (Scaling tab)';
