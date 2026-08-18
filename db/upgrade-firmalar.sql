-- ============================================================
-- FİRMALAR (şirketler) — ayrı firma listesi + kayıtlara firma bağlama
-- Bu dosyanın TAMAMINI Supabase > SQL Editor'e yapıştırıp "Run" deyin.
-- Mevcut veriye DOKUNMAZ: yeni bir tablo (companies) ve kayıtlara
-- isteğe bağlı (boş bırakılabilir) bir firma sütunu ekler.
-- Birden fazla kez çalıştırılabilir.
-- ============================================================

-- 1) FİRMALAR TABLOSU
create table if not exists public.companies (
  id         uuid primary key default gen_random_uuid(),
  firma_adi  text not null unique,
  created_by text not null default '',
  created_at timestamptz not null default now()
);

-- 2) KAYITLARA FİRMA SÜTUNU (isteğe bağlı)
-- Firma silinirse kayıtlar silinmez, sadece firma bilgisi boşalır.
alter table public.records
  add column if not exists firma_id uuid references public.companies(id) on delete set null;

create index if not exists records_firma_id_idx on public.records (firma_id);

-- 3) GÜVENLİK (RLS): diğer tablolarla aynı model
-- Onaylı üyeler görebilir/ekleyebilir/adını düzeltebilir; silme yalnızca admin.
alter table public.companies enable row level security;

drop policy if exists "companies_select" on public.companies;
drop policy if exists "companies_insert" on public.companies;
drop policy if exists "companies_update" on public.companies;
drop policy if exists "companies_delete" on public.companies;
create policy "companies_select" on public.companies
  for select to authenticated using (public.is_approved());
create policy "companies_insert" on public.companies
  for insert to authenticated with check (public.is_approved());
create policy "companies_update" on public.companies
  for update to authenticated using (public.is_approved()) with check (public.is_approved());
create policy "companies_delete" on public.companies
  for delete to authenticated using (public.is_admin());

-- 4) CANLI GÜNCELLEME (bir kişi firma eklerse diğerlerinde de görünsün)
do $$
begin
  alter publication supabase_realtime add table public.companies;
exception
  when duplicate_object then null;
end $$;
