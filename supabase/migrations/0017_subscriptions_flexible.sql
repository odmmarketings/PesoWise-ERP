-- PesoWise — SUBSCRIPTIONS: suporta sa mga hindi-fixed na subscription.
-- Run in Supabase Dashboard → SQL Editor. Safe to re-run.
--
-- Dati ay laging fixed ang assumption: buwanan o taunan, may alam na billing day, at may
-- eksaktong halaga. Pero maraming totoong subscription ang hindi ganoon:
--
--   • auto top-up (hal. Botcake AI) — nagsi-singil kapag naubos ang funds, kaya WALANG
--     mahuhulaang petsa; puwedeng makailang beses sa isang buwan o lumagpas ng ilang buwan
--   • nag-iibang billing day kada cycle
--   • nag-iibang halaga (usage-based)
--   • cycle na hindi monthly/yearly — weekly, quarterly, semi-annual
--
-- Walang bagong constraint na kailangang tanggalin: `cycle` ay plain text at ang `billing_day`
-- ay plain int, kaya tumatanggap na ang column ng mga bagong value. Ang idinadagdag lang dito
-- ay ang dalawang column para sa manu-manong naka-log na singil ng variable na subscription.

alter table public.finance_subscriptions
  add column if not exists last_charged_at date,                    -- petsa ng huling naka-log na singil
  add column if not exists last_charged_amount numeric(14,2);       -- halaga ng huling naka-log na singil

-- Dokumentasyon ng bagong kahulugan ng mga umiiral na column.
comment on column public.finance_subscriptions.cycle is
  'weekly | monthly | quarterly | semiannual | yearly | topup. Ang topup = auto top-up kapag naubos ang funds — walang fixed na petsa, kaya hindi ito kailanman auto-posted.';
comment on column public.finance_subscriptions.billing_day is
  'Nakadepende sa cycle: weekly = 1-7 araw ng linggo (1=Sunday); iba pa = 1-31 araw ng buwan. 0 = HINDI fixed ang petsa (random kada cycle) → hindi auto-posted.';
comment on column public.finance_subscriptions.amount is
  'Eksaktong PHP kada cycle. 0 = nag-iibang halaga (usage-based) → hindi auto-posted, kailangang i-log nang manu-mano.';
comment on column public.finance_subscriptions.billing_month is
  'Anchor month (1-12) ng quarterly/semiannual/yearly. Ang quarterly na naka-anchor sa Feb ay nagsi-singil tuwing Feb/May/Aug/Nov. Null kapag weekly/monthly/topup.';
comment on column public.finance_subscriptions.last_charged_at is
  'Variable na subscription lang: petsa ng huling manu-manong naka-log na singil (Log charge).';
comment on column public.finance_subscriptions.last_charged_amount is
  'Variable na subscription lang: halaga ng huling manu-manong naka-log na singil.';
