-- ADS COMMENTS — usapan ng team sa loob mismo ng Ads Manager, nakakabit sa
-- isang campaign / ad set / ad. Dito nagsasabihan ang tatlong buyer kung bakit
-- may pinatay, ano ang susubukan, o sino ang dapat tumingin — sa tabi mismo ng
-- numero, hindi sa hiwalay na chat kung saan mawawala ang konteksto.
--
-- Ang @mention ay nagpapadala ng in-app notification (audience='user') sa
-- na-tag. Ang mga email ng na-tag ay nakatago sa `mentions` para hindi na
-- kailangang i-parse muli ang teksto sa bawat pagbasa.
create table if not exists public.ads_comments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Saang object nakakabit: ang Meta object id + antas nito
  object_id text not null,
  object_level text not null default 'campaign',   -- campaign | adset | ad
  object_name text not null default '',
  account_name text not null default '',
  author_name text not null default '',
  author_email text not null default '',
  body text not null,
  -- Mga company_email na na-mention (lowercase)
  mentions text[] not null default '{}',
  -- Soft delete: ang burahin ang usapan ay pagbura ng kasaysayan ng desisyon
  deleted boolean not null default false,
  -- ── ACKNOWLEDGE / RESOLVE (parang Google Sheets) ──────────────────────────
  -- Kapag na-resolve, NAWAWALA ito sa tabi ng numero — pero HINDI nabubura.
  -- Ang usapan ay kasaysayan ng desisyon: kung bakit pinatay, kung ano ang
  -- napagkasunduan. Ang tunay na pagbura niyan ay pagbura ng dahilan, kaya
  -- itinatago lang: may "Show resolved" na tanawin.
  resolved boolean not null default false,
  resolved_at timestamptz,
  resolved_by text not null default ''
);

-- Idempotent: kung naunang naitakbo ang bersyon na walang resolve, ito ang
-- magdaragdag ng mga hanay nang hindi kailangang gumawa ng bagong migration.
alter table public.ads_comments add column if not exists resolved boolean not null default false;
alter table public.ads_comments add column if not exists resolved_at timestamptz;
alter table public.ads_comments add column if not exists resolved_by text not null default '';

-- Ang tanong ay laging "ano ang sinabi tungkol SA OBJECT NA ITO".
create index if not exists ads_comments_object_idx
  on public.ads_comments (business_id, object_id, created_at desc);

alter table public.ads_comments enable row level security;

drop policy if exists "Business members access ads_comments" on public.ads_comments;
create policy "Business members access ads_comments" on public.ads_comments for all using (
  exists (select 1 from public.businesses where id = ads_comments.business_id and owner_id = auth.uid())
  or public.is_business_member(ads_comments.business_id)
);
