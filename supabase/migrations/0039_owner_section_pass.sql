-- 0039: PASSWORD NG SUPPLIER MARGIN (hatol ng may-ari, Ago 31 2026: "lagyan mo
-- to ng password, tapos dun din ako pwede mag palit ng password mismo sa loob
-- nung pesowise").
--
-- HASH LANG ANG NAKAIMBAK (PBKDF2-SHA256, 120k iterations, may salt) — walang
-- plaintext kahit kailan, kahit sa may-ari mismo. Ang pagpapalit ay sa loob ng
-- seksyon; ang nakalimutang password ay burahin ang row na ito sa Supabase at
-- magtakda muli.
--
-- ⚠ PAREHONG RLS ng supplier_true_costs (0031): MAY-ARI LAMANG — walang
-- is_business_member na sanga. Ang staff ay hindi man lang makakabasa ng hash.
create table if not exists public.owner_section_pass (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  pass_hash text not null,
  salt text not null,
  updated_at timestamptz not null default now()
);

alter table public.owner_section_pass enable row level security;

drop policy if exists "Owner only owner_section_pass" on public.owner_section_pass;
create policy "Owner only owner_section_pass" on public.owner_section_pass for all using (
  exists (
    select 1 from public.businesses
    where id = owner_section_pass.business_id and owner_id = auth.uid()
  )
) with check (
  exists (
    select 1 from public.businesses
    where id = owner_section_pass.business_id and owner_id = auth.uid()
  )
);

revoke all on public.owner_section_pass from anon;
