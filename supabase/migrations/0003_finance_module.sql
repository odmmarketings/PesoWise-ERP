-- PesoWise — Phase 2: Finance module (Settings, Book Keeping, Reimbursement, Utility Expense)
-- shared persistence. Run in Supabase Dashboard → SQL Editor. Safe to re-run.

-- =====================
-- 1) Finance Settings — kept as ONE JSONB blob per business (mirrors the existing app
--    architecture exactly: general toggles + banks[] + departments[] + types[] + accounts[]
--    all live together already, nothing else references them by foreign key — Bookkeeping
--    stores account/department/type/bank as plain text at write time, not as ids).
-- =====================
create table if not exists public.finance_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  data jsonb not null default '{"general":{"hide_shared_expense":false,"hide_type_request":false},"banks":[],"departments":[],"types":[],"accounts":[]}'::jsonb,
  updated_at timestamptz default now()
);

-- =====================
-- 2) Book Keeping ledger
-- =====================
create table if not exists public.bookkeeping_txns (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid references public.businesses(id) on delete cascade not null,
  voucher text default '',
  posted_date date not null,
  transaction text default '',
  account text default '',
  department text default '',
  category text default '',
  type_of_expense text default '',
  amount numeric(12,2) default 0,
  debit numeric(12,2) default 0,
  credit numeric(12,2) default 0,
  bank text default '',
  receipt_name text default '',
  status text not null default 'enabled' check (status in ('enabled', 'pending_disable', 'disabled')),
  disable_reason text default '',
  disable_remarks text default '',
  added_by text default '',
  added_date timestamptz default now(),
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz default now()
);
create index if not exists bookkeeping_txns_business_idx on public.bookkeeping_txns (business_id);

-- =====================
-- 3) Reimbursement requests
-- =====================
create table if not exists public.reimbursements (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid references public.businesses(id) on delete cascade not null,
  control_no text default '',
  date text default '',    -- app-formatted "YYYY-MM-DD HH:mm:ss" (local time display string, not a real timestamptz)
  payee_supplier text default '',
  department text default '',
  name text default '',
  purpose text default '',
  particulars text default '',
  type_of_expense text default '',
  shared_expense text default '',
  retail_share numeric(12,2) default 0,
  business_dev_share numeric(12,2) default 0,
  quantity numeric(12,2) default 1,
  unit_price numeric(12,2) default 0,
  total_payment numeric(12,2) default 0,
  mode_of_payment text default '',
  receipt_name text default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  remarks text default '',
  recorded_txn_id uuid references public.bookkeeping_txns(id) on delete set null,
  added_by text default '',
  added_date timestamptz default now(),
  approved_by text default '',
  approved_date text default '', -- same app-formatted string as `date`
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz default now()
);
create index if not exists reimbursements_business_idx on public.reimbursements (business_id);

-- =====================
-- 4) Utility Expense requests
-- =====================
create table if not exists public.utility_expenses (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid references public.businesses(id) on delete cascade not null,
  control_no text default '',
  date text default '',    -- app-formatted "YYYY-MM-DD HH:mm:ss" (local time display string, not a real timestamptz)
  due_date date,
  request_form text default '',
  payee_supplier text default '',
  requested_by text default '',
  purpose text default '',
  description text default '',
  type_of_expense text default '',
  type_of_request text default '',
  retail numeric(12,2) default 0,
  business_dev numeric(12,2) default 0,
  quantity numeric(12,2) default 1,
  unit_price numeric(12,2) default 0,
  total_amount numeric(12,2) default 0,
  mode_of_payment text default '',
  bills_name text default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  remarks text default '',
  recorded_txn_id uuid references public.bookkeeping_txns(id) on delete set null,
  added_by text default '',
  added_date timestamptz default now(),
  approved_by text default '',
  approved_date text default '', -- same app-formatted string as `date`
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz default now()
);
create index if not exists utility_expenses_business_idx on public.utility_expenses (business_id);

-- =====================
-- 5) Row Level Security — reuses is_business_member() from migration 0002.
-- =====================
alter table public.finance_settings enable row level security;
alter table public.bookkeeping_txns enable row level security;
alter table public.reimbursements enable row level security;
alter table public.utility_expenses enable row level security;

drop policy if exists "Business members access finance_settings" on public.finance_settings;
create policy "Business members access finance_settings" on public.finance_settings for all using (
  exists (select 1 from public.businesses where id = finance_settings.business_id and owner_id = auth.uid())
  or public.is_business_member(finance_settings.business_id)
);

drop policy if exists "Business members access bookkeeping_txns" on public.bookkeeping_txns;
create policy "Business members access bookkeeping_txns" on public.bookkeeping_txns for all using (
  exists (select 1 from public.businesses where id = bookkeeping_txns.business_id and owner_id = auth.uid())
  or public.is_business_member(bookkeeping_txns.business_id)
);

drop policy if exists "Business members access reimbursements" on public.reimbursements;
create policy "Business members access reimbursements" on public.reimbursements for all using (
  exists (select 1 from public.businesses where id = reimbursements.business_id and owner_id = auth.uid())
  or public.is_business_member(reimbursements.business_id)
);

drop policy if exists "Business members access utility_expenses" on public.utility_expenses;
create policy "Business members access utility_expenses" on public.utility_expenses for all using (
  exists (select 1 from public.businesses where id = utility_expenses.business_id and owner_id = auth.uid())
  or public.is_business_member(utility_expenses.business_id)
);
