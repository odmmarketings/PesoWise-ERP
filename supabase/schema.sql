-- PesoWise Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- =====================
-- USERS
-- =====================
create table if not exists public.users (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null unique,
  name text not null,
  plan text not null default 'trial' check (plan in ('trial', 'pro', 'premium')),
  trial_ends_at timestamptz default (now() + interval '14 days'),
  subscribed_at timestamptz,
  paymongo_customer_id text,
  paymongo_subscription_id text,
  referral_code text unique,
  referred_by uuid references public.users(id),
  created_at timestamptz default now()
);

-- =====================
-- SUBSCRIPTIONS
-- =====================
create table if not exists public.subscriptions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade not null,
  plan text not null check (plan in ('pro', 'premium')),
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly', 'annual')),
  status text not null default 'active' check (status in ('active', 'cancelled', 'past_due', 'trialing')),
  paymongo_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz default now()
);

-- =====================
-- PERSONAL FINANCE
-- =====================
create table if not exists public.categories (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade not null,
  name text not null,
  budget numeric(12,2),
  color text default '#64748b',
  icon text,
  is_default boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.expenses (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade not null,
  amount numeric(12,2) not null,
  category_id uuid references public.categories(id) on delete set null,
  category_name text,
  date date not null,
  notes text,
  tags text[] default '{}',
  receipt_url text,
  created_at timestamptz default now()
);

create table if not exists public.income (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade not null,
  amount numeric(12,2) not null,
  source text not null,
  date date not null,
  notes text,
  created_at timestamptz default now()
);

create table if not exists public.bills (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade not null,
  name text not null,
  amount numeric(12,2) not null,
  due_day integer not null check (due_day between 1 and 31),
  frequency text not null default 'monthly' check (frequency in ('monthly', 'weekly', 'yearly')),
  last_paid_at timestamptz,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.bank_accounts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade not null,
  bank_name text not null,
  account_type text default 'Savings',
  balance numeric(12,2) default 0,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

create table if not exists public.dream_purchases (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade not null,
  name text not null,
  target_price numeric(12,2) not null,
  saved_amount numeric(12,2) default 0,
  target_date date,
  image_url text,
  created_at timestamptz default now()
);

-- =====================
-- AFFILIATES
-- =====================
create table if not exists public.affiliate_referrals (
  id uuid primary key default uuid_generate_v4(),
  referrer_id uuid references public.users(id) on delete cascade not null,
  referred_user_id uuid references public.users(id) on delete cascade not null,
  status text not null default 'pending' check (status in ('pending', 'converted', 'paid')),
  commission_amount numeric(10,2) default 150,
  converted_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz default now()
);

-- =====================
-- BUSINESSES
-- =====================
create table if not exists public.businesses (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid references public.users(id) on delete cascade not null,
  name text not null,
  created_at timestamptz default now()
);

create table if not exists public.business_users (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid references public.businesses(id) on delete cascade not null,
  user_id uuid references public.users(id) on delete cascade not null,
  role text not null default 'staff' check (role in ('owner', 'admin', 'staff')),
  permissions jsonb default '{}',
  created_at timestamptz default now(),
  unique(business_id, user_id)
);

-- =====================
-- ECOMMERCE
-- =====================
create table if not exists public.platforms (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid references public.businesses(id) on delete cascade not null,
  name text not null,
  added_by uuid references public.users(id),
  created_at timestamptz default now()
);

create table if not exists public.pages_stores (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid references public.businesses(id) on delete cascade not null,
  name text not null,
  description text,
  owner text,
  platform_id uuid references public.platforms(id),
  platform_name text,
  page_url text,
  shop_id text,
  api_key text,
  pancake_page_id text,
  sender_name text,
  status text default 'active' check (status in ('active', 'inactive', 'in-review', 'restricted', 'permanently_disabled')),
  created_by uuid references public.users(id),
  archived_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists public.ad_spends (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid references public.businesses(id) on delete cascade not null,
  page_id uuid references public.pages_stores(id) on delete cascade,
  date date not null,
  amount numeric(12,2) default 0,
  orders integer default 0,
  sales numeric(12,2) default 0,
  created_at timestamptz default now()
);

create table if not exists public.sales_orders (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid references public.businesses(id) on delete cascade not null,
  order_date date not null,
  csr_id uuid references public.users(id),
  csr_name text,
  verifier_name text,
  upsell_by text,
  customer_name text not null,
  address text,
  province text,
  city text,
  barangay text,
  zip_code text,
  contact_no text,
  order_items jsonb default '[]',
  quantity integer default 1,
  parcel_qty integer default 1,
  final_price numeric(12,2),
  page_id uuid references public.pages_stores(id),
  page_name text,
  platform text,
  remarks text,
  mode_of_payment text,
  is_reserve boolean default false,
  customer_request boolean default false,
  tracking_no text,
  courier text,
  parcel_status text default 'New',
  encoded_date timestamptz default now(),
  parcel_update timestamptz,
  shipped_out_date date,
  order_status text default 'New',
  created_at timestamptz default now()
);

-- =====================
-- FINANCE (BUSINESS)
-- =====================
create table if not exists public.biz_bank_accounts (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid references public.businesses(id) on delete cascade not null,
  bank_name text not null,
  running_balance numeric(12,2) default 0,
  created_at timestamptz default now()
);

create table if not exists public.bookkeeping (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid references public.businesses(id) on delete cascade not null,
  bank_id uuid references public.biz_bank_accounts(id),
  type_of_expense text,
  department text,
  debit numeric(12,2) default 0,
  credit numeric(12,2) default 0,
  date date not null,
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz default now()
);

-- =====================
-- INVENTORY
-- =====================
create table if not exists public.inventory_items (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid references public.businesses(id) on delete cascade not null,
  name text not null,
  sku text,
  stock_qty integer default 0,
  unit_code text,
  cost numeric(12,2),
  price numeric(12,2),
  created_at timestamptz default now()
);

-- =====================
-- HR
-- =====================
create table if not exists public.employees (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid references public.businesses(id) on delete cascade not null,
  name text not null,
  department text,
  position text,
  schedule text,
  branch text,
  basic_salary numeric(12,2),
  hire_date date,
  status text default 'active' check (status in ('active', 'inactive', 'resigned')),
  created_at timestamptz default now()
);

-- =====================
-- ROW LEVEL SECURITY
-- =====================
alter table public.users enable row level security;
alter table public.expenses enable row level security;
alter table public.income enable row level security;
alter table public.categories enable row level security;
alter table public.bills enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.dream_purchases enable row level security;
alter table public.subscriptions enable row level security;
alter table public.affiliate_referrals enable row level security;
alter table public.businesses enable row level security;
alter table public.pages_stores enable row level security;
alter table public.sales_orders enable row level security;

-- Users can only see/edit their own data
create policy "Users own data" on public.users for all using (auth.uid() = id);
create policy "Users own expenses" on public.expenses for all using (auth.uid() = user_id);
create policy "Users own income" on public.income for all using (auth.uid() = user_id);
create policy "Users own categories" on public.categories for all using (auth.uid() = user_id);
create policy "Users own bills" on public.bills for all using (auth.uid() = user_id);
create policy "Users own bank accounts" on public.bank_accounts for all using (auth.uid() = user_id);
create policy "Users own dream purchases" on public.dream_purchases for all using (auth.uid() = user_id);
create policy "Users own subscriptions" on public.subscriptions for all using (auth.uid() = user_id);

-- Business: owner + members can access
create policy "Business owner access" on public.businesses for all using (auth.uid() = owner_id);
create policy "Business pages access" on public.pages_stores for all using (
  exists (select 1 from public.businesses where id = pages_stores.business_id and owner_id = auth.uid())
  or exists (select 1 from public.business_users where business_id = pages_stores.business_id and user_id = auth.uid())
);
create policy "Business sales access" on public.sales_orders for all using (
  exists (select 1 from public.businesses where id = sales_orders.business_id and owner_id = auth.uid())
  or exists (select 1 from public.business_users where business_id = sales_orders.business_id and user_id = auth.uid())
);

-- =====================
-- DEFAULT CATEGORIES FUNCTION
-- =====================
create or replace function public.create_default_categories(p_user_id uuid)
returns void language plpgsql as $$
begin
  insert into public.categories (user_id, name, color, icon, is_default) values
    (p_user_id, 'Food', '#f97316', '🍔', true),
    (p_user_id, 'Transport', '#3b82f6', '🚗', true),
    (p_user_id, 'Shopping', '#a855f7', '🛒', true),
    (p_user_id, 'Bills', '#ef4444', '📄', true),
    (p_user_id, 'Health', '#22c55e', '💊', true),
    (p_user_id, 'Entertainment', '#eab308', '🎮', true),
    (p_user_id, 'Other', '#64748b', '📦', true);
end;
$$;

-- Auto-create default categories on user insert
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  perform public.create_default_categories(new.id);
  return new;
end;
$$;

create trigger on_user_created
  after insert on public.users
  for each row execute function public.handle_new_user();
