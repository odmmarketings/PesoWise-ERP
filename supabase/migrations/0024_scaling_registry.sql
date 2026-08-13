-- SCALING REGISTRY — ang mga ad set na sadyang inirehistro para i-monitor sa
-- Scaling tab (Facebook Ads). Ang Monitoring tab ay awtomatikong nag-i-scan ng
-- lahat; ang Scaling tab ay ang pinili LANG — mula rehistro, sinusundan ang
-- 3/7/15/30-araw na resulta, at bawat pag-scale (10%/20%/...) ay naitatala sa
-- `scales` para makita kung pang-ilang scale na at mula saang budget nagsimula.
create table if not exists public.scaling_registry (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  adset_id text not null,
  adset_name text not null default '',
  campaign_name text not null default '',
  account_name text not null default '',
  owner text not null default '',
  registered_at date not null,
  starting_budget numeric(14,2) not null default 0,   -- budget noong irehistro (pesos)
  -- [{"date":"YYYY-MM-DD","pct":20,"from":600,"to":720,"applied":true}]
  -- applied=false → naitala lang (hal. CBO na sa Ads Manager mismo binago)
  scales jsonb not null default '[]'::jsonb,
  active boolean not null default true,               -- unregister = false (hindi binubura ang history)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, adset_id)
);

alter table public.scaling_registry enable row level security;

drop policy if exists "Business members access scaling_registry" on public.scaling_registry;
create policy "Business members access scaling_registry" on public.scaling_registry for all using (
  exists (select 1 from public.businesses where id = scaling_registry.business_id and owner_id = auth.uid())
  or public.is_business_member(scaling_registry.business_id)
);
