-- MONITORING SCOPE KADA PARTNER (hiling ng may-ari, Ago 24 2026: "makapili ng
-- kung ano momonitor nila na ads per user, hindi lang yung active — may options
-- na: mga active lang, or custom").
--
--   scope = 'active'  → ang dating asal: ang mga account NIYA na may gastos sa
--                       araw ng slot (kusa ang listahan, walang pipiliin)
--   scope = 'custom'  → TAKDANG listahan ng ad account (fb_accounts.id) na
--                       dapat niyang bantayan KADA round, may gastos man o wala
--                       — at maaaring account ng iba (hal. marketing na
--                       binabantayan ang account ng partner).
alter table public.monitor_settings
  add column if not exists scope text not null default 'active';
alter table public.monitor_settings
  add column if not exists custom_accounts text[] not null default '{}';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'monitor_settings_scope_check') then
    alter table public.monitor_settings add constraint monitor_settings_scope_check
      check (scope in ('active', 'custom'));
  end if;
end $$;
