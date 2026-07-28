-- PesoWise — PROBLEM MANAGEMENT (Root Cause Analysis). Pinapalitan nito ang dating
-- Kanban Board: bawat isyu ay sinusubaybayan mula sa pagkakatuklas hanggang sa resolusyon,
-- may malinaw na may-ari, root cause, solusyon, deadline, at katayuan.
-- Run in Supabase Dashboard → SQL Editor. Safe to re-run.

-- ── Departments (walang limitasyon — kayang magdagdag ng admin anumang oras) ──────────
create table if not exists public.problem_departments (
  id text primary key,
  business_id uuid references public.businesses(id) on delete cascade not null,
  name text not null default '',
  manager_emails text[] not null default '{}',   -- Manager role para sa department na ito
  sort int not null default 0,
  status text not null default 'active',         -- active | inactive
  created_at timestamptz default now()
);
create index if not exists problem_departments_business_idx on public.problem_departments (business_id);

-- ── Problems (ang pangunahing talaan) ────────────────────────────────────────────────
create table if not exists public.problems (
  id text primary key,
  business_id uuid references public.businesses(id) on delete cascade not null,
  code text not null default '',                 -- PRB-0001 (auto-generated)
  title text not null default '',
  description text default '',
  department text default '',
  owner_email text default '',                   -- Assigned User (Owner)
  owner_name text default '',
  support_emails text[] not null default '{}',   -- optional supporting users
  reported_by text default '',
  date_reported text default '',                 -- YYYY-MM-DD
  priority text not null default 'Medium',       -- Critical | High | Medium | Low
  status text not null default 'Open',           -- Open | Investigation | Root Cause Identified |
                                                 -- In Progress | Waiting for Approval | Monitoring |
                                                 -- Completed | Cancelled
  -- Root Cause Analysis chain
  cause text default '',
  root_cause text default '',
  solution text default '',                      -- Proposed Solution
  action_plan text default '',
  corrective_action text default '',
  preventive_action text default '',
  -- Deadline / completion
  target_date text default '',                   -- Target Completion Date (YYYY-MM-DD)
  actual_completion_date text default '',        -- Actual Completion Date (YYYY-MM-DD)
  completion_notes text default '',
  evidence jsonb not null default '[]'::jsonb,   -- Completion Evidence [{name,type,size,url}]
  approved_by text default '',
  approved_at timestamptz,
  -- Misc
  attachments jsonb not null default '[]'::jsonb,
  notes text default '',                         -- Notes / Updates
  created_by text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()           -- Last Updated
);
create index if not exists problems_business_idx on public.problems (business_id);
create index if not exists problems_status_idx on public.problems (business_id, status);
create index if not exists problems_owner_idx on public.problems (business_id, owner_email);

-- ── Comments (internal discussion — may replies, @mentions, attachments) ─────────────
create table if not exists public.problem_comments (
  id text primary key,
  business_id uuid references public.businesses(id) on delete cascade not null,
  problem_id text references public.problems(id) on delete cascade not null,
  parent_id text default '',                     -- '' = top-level; kung hindi, reply ito
  author text default '',
  author_email text default '',
  body text default '',
  mentions text[] not null default '{}',         -- mga na-@mention na email
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz default now()
);
create index if not exists problem_comments_problem_idx on public.problem_comments (problem_id);

-- ── Activity timeline (bawat galaw ay naitatala) ─────────────────────────────────────
create table if not exists public.problem_activity (
  id text primary key,
  business_id uuid references public.businesses(id) on delete cascade not null,
  problem_id text references public.problems(id) on delete cascade not null,
  action text default '',                        -- "Status changed", "Assigned to user", …
  detail text default '',                        -- "Open → In Progress"
  by text default '',
  at timestamptz default now()
);
create index if not exists problem_activity_problem_idx on public.problem_activity (problem_id);

-- ── Notification queue (email) — pinupuno ng app, ipinapadala ng scripts/problem-notify.mjs ──
create table if not exists public.problem_notifications (
  id text primary key,
  business_id uuid references public.businesses(id) on delete cascade not null,
  problem_id text references public.problems(id) on delete cascade,
  kind text default '',                          -- assigned | d7 | d3 | d1 | due_today | overdue | completed
  to_email text default '',
  subject text default '',
  body text default '',
  status text not null default 'pending',        -- pending | sent | failed
  dedupe_key text default '',                    -- pumipigil sa dobleng padala kada araw/kada yugto
  error text default '',
  sent_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists problem_notifications_status_idx on public.problem_notifications (business_id, status);
create unique index if not exists problem_notifications_dedupe_idx
  on public.problem_notifications (business_id, dedupe_key) where dedupe_key <> '';

-- ── RLS — kapareho ng ibang modules (owner o business member) ────────────────────────
alter table public.problem_departments enable row level security;
drop policy if exists "Business members access problem_departments" on public.problem_departments;
create policy "Business members access problem_departments" on public.problem_departments for all using (
  exists (select 1 from public.businesses where id = problem_departments.business_id and owner_id = auth.uid())
  or public.is_business_member(problem_departments.business_id)
);

alter table public.problems enable row level security;
drop policy if exists "Business members access problems" on public.problems;
create policy "Business members access problems" on public.problems for all using (
  exists (select 1 from public.businesses where id = problems.business_id and owner_id = auth.uid())
  or public.is_business_member(problems.business_id)
);

alter table public.problem_comments enable row level security;
drop policy if exists "Business members access problem_comments" on public.problem_comments;
create policy "Business members access problem_comments" on public.problem_comments for all using (
  exists (select 1 from public.businesses where id = problem_comments.business_id and owner_id = auth.uid())
  or public.is_business_member(problem_comments.business_id)
);

alter table public.problem_activity enable row level security;
drop policy if exists "Business members access problem_activity" on public.problem_activity;
create policy "Business members access problem_activity" on public.problem_activity for all using (
  exists (select 1 from public.businesses where id = problem_activity.business_id and owner_id = auth.uid())
  or public.is_business_member(problem_activity.business_id)
);

alter table public.problem_notifications enable row level security;
drop policy if exists "Business members access problem_notifications" on public.problem_notifications;
create policy "Business members access problem_notifications" on public.problem_notifications for all using (
  exists (select 1 from public.businesses where id = problem_notifications.business_id and owner_id = auth.uid())
  or public.is_business_member(problem_notifications.business_id)
);

-- ── Storage bucket para sa attachments (images, PDF, Excel, Word, video) ─────────────
-- 50MB kada file. Public read para gumana ang preview links; ang pag-upload/pagbura ay
-- nangangailangan ng naka-login na user.
insert into storage.buckets (id, name, public, file_size_limit)
values ('problem-files', 'problem-files', true, 52428800)
on conflict (id) do nothing;

drop policy if exists "Public read problem files" on storage.objects;
create policy "Public read problem files" on storage.objects
  for select using (bucket_id = 'problem-files');

drop policy if exists "Authenticated write problem files" on storage.objects;
create policy "Authenticated write problem files" on storage.objects
  for insert with check (bucket_id = 'problem-files' and auth.role() = 'authenticated');

drop policy if exists "Authenticated delete problem files" on storage.objects;
create policy "Authenticated delete problem files" on storage.objects
  for delete using (bucket_id = 'problem-files' and auth.role() = 'authenticated');
