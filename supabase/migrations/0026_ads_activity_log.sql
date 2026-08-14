-- ADS ACTIVITY LOG — sino ang gumalaw ng ano sa Ads, at kailan.
--
-- Tatlong media buyer ang gumagamit ng parehong ad accounts. Kapag may
-- napatay na campaign, tumaas na budget, o bagong rule, walang paraan dati
-- para malaman kung SINO — sinasabi ng Meta kung ano ang nagbago, hindi kung
-- sinong tao sa PesoWise ang pumindot (iisa lang ang FB token na hawak nila).
-- Dito naitatala ang bawat pagbabagong ipinadala ng app papuntang Facebook,
-- kasama ang pangalan ng naka-login na user.
--
-- HABANG-BUHAY NA TALA: walang update, walang delete sa daloy ng app —
-- idinadagdag lang. Kung mali ang isang tala, ang tamang sagot ay bagong tala.
create table if not exists public.ads_activity_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  at timestamptz not null default now(),
  -- Sino (galing sa naka-login na profile, hindi sa FB token)
  user_name text not null default '',
  user_email text not null default '',
  -- Ano ang ginawa: status | budget | scale | scale_undo | kill | register |
  -- unregister | ad_moved | rule_create | rule_update | rule_delete |
  -- rule_status | rule_scope
  action text not null,
  -- Saang antas: campaign | adset | ad | rule
  level text not null default '',
  object_id text not null default '',
  object_name text not null default '',
  account_name text not null default '',
  -- Isang linyang mababasa ng tao: "₱1,000 → ₱1,100 (+10%)"
  summary text not null default '',
  -- Saan sa app ginawa: ads-manager | testing | scaling | monitoring | rules
  surface text not null default '',
  -- Buong detalye para sa hinaharap (before/after, ilan ang na-bulk, atbp.)
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Ang halos lahat ng tanong ay "ano ang nangyari kamakailan sa negosyong ito",
-- kaya iyon ang unang index; ang pag-filter kada user at kada aksyon ay
-- ginagawa sa ibabaw ng resulta.
create index if not exists ads_activity_log_business_at_idx
  on public.ads_activity_log (business_id, at desc);
create index if not exists ads_activity_log_user_idx
  on public.ads_activity_log (business_id, user_name);

alter table public.ads_activity_log enable row level security;

drop policy if exists "Business members access ads_activity_log" on public.ads_activity_log;
create policy "Business members access ads_activity_log" on public.ads_activity_log for all using (
  exists (select 1 from public.businesses where id = ads_activity_log.business_id and owner_id = auth.uid())
  or public.is_business_member(ads_activity_log.business_id)
);
