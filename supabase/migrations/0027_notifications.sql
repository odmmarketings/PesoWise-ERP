-- NOTIFICATIONS — in-app na abiso para sa buong PesoWise.
--
-- Tatlong uri ng tagatanggap (audience):
--   'admin'      → mga Mother Account lang (roster `mother` flag)
--   'department' → lahat ng user na TUGMA ang `position` sa `department` na
--                  salita (case-insensitive substring, hal. 'warehouse' →
--                  "Warehouse Staff"). Walang bagong department table — ang
--                  position sa roster na ang hatian, gaya ng packer picker.
--   'user'       → isang tao, tinutukoy ng `recipient_email` (company_email)
--   'all'        → bawat miyembro ng negosyo
--
-- Ang PAGBASA ay bawat-tao: hiwalay na `notification_reads` (hindi jsonb sa
-- mismong row) para hindi nag-aagawan ang dalawang user na sabay nagbasa.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  created_at timestamptz not null default now(),
  audience text not null check (audience in ('admin','department','user','all')),
  department text not null default '',
  recipient_email text not null default '',
  -- Sino ang may gawa ng pangyayari — hindi ipinapakita sa kanya mismo ang abiso.
  actor_name text not null default '',
  actor_email text not null default '',
  -- Uri ng pangyayari (kebab): ads-kill | ads-scale | ads-budget | ads-rule |
  -- packer-assigned | problem-assigned | user-added | po-created | ...
  type text not null,
  title text not null,
  body text not null default '',
  -- Saan dadalhin kapag pinindot (in-app na ruta, hal. /business/ads/facebook)
  href text not null default '',
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  details jsonb not null default '{}'::jsonb
);

create index if not exists notifications_business_at_idx
  on public.notifications (business_id, created_at desc);

create table if not exists public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_email text not null,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_email)
);

alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;

drop policy if exists "Business members access notifications" on public.notifications;
create policy "Business members access notifications" on public.notifications for all using (
  exists (select 1 from public.businesses where id = notifications.business_id and owner_id = auth.uid())
  or public.is_business_member(notifications.business_id)
);

-- Ang reads ay nakakabit sa notification; parehong miyembro ang saklaw.
drop policy if exists "Business members access notification_reads" on public.notification_reads;
create policy "Business members access notification_reads" on public.notification_reads for all using (
  exists (
    select 1 from public.notifications n
    where n.id = notification_reads.notification_id
      and (
        exists (select 1 from public.businesses b where b.id = n.business_id and b.owner_id = auth.uid())
        or public.is_business_member(n.business_id)
      )
  )
);
