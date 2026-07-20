-- PesoWise — custom color per page (Page ROAS Tracker report tab). Isang { pageId: hex }
-- map sa ecommerce_settings. Run in Supabase Dashboard → SQL Editor. Safe to re-run.

alter table public.ecommerce_settings add column if not exists page_colors jsonb not null default '{}'::jsonb;
