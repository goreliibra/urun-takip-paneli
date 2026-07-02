-- ============================================================
-- E-POSTA TABANLI ÜYELİĞE GEÇİŞ (Supabase Auth)
-- Bu dosyanın TAMAMINI Supabase > SQL Editor'e yapıştırıp "Run" deyin.
-- Mevcut ürün kayıtlarına ve işlem geçmişine DOKUNMAZ.
-- ÖNEMLİ: Bunu çalıştırdıktan sonra eski kullanıcı adı/şifre girişi kapanır;
-- girişler e-posta + şifre ile olur, "şifremi unuttum" maili çalışır.
-- ============================================================

-- 1) PROFİL TABLOSU (üyelerin uygulama bilgileri)
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text not null unique,
  email      text not null,
  role       text not null default 'kullanici' check (role in ('admin', 'kullanici')),
  approved   boolean not null default false,
  created_at timestamptz not null default now()
);

-- 2) YENİ ÜYE -> OTOMATİK PROFİL
-- Sisteme kaydolan İLK kişi otomatik olarak ONAYLI ADMİN olur (yani siz).
-- Sonrakiler onaysız "kullanici" olarak başlar; admin onaylayana kadar hiçbir veri göremez.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  is_first boolean;
begin
  select not exists (select 1 from public.profiles) into is_first;
  insert into public.profiles (id, username, email, role, approved)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'username', ''), split_part(new.email, '@', 1)),
    new.email,
    case when is_first then 'admin' else 'kullanici' end,
    is_first
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3) YARDIMCI FONKSİYONLAR (yetki kontrolü artık veritabanında!)
create or replace function public.is_approved()
returns boolean language sql security definer stable set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and approved) $$;

create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and approved and role = 'admin') $$;

-- 4) SIKI GÜVENLİK KURALLARI
-- Giriş yapmamış veya onaylanmamış hiç kimse hiçbir veri okuyamaz/yazamaz.
-- Silme yetkisi yalnızca admin rolünde.
alter table public.profiles enable row level security;

drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_approved());
create policy "profiles_update" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "records_all"    on public.records;
drop policy if exists "records_select" on public.records;
drop policy if exists "records_insert" on public.records;
drop policy if exists "records_update" on public.records;
drop policy if exists "records_delete" on public.records;
create policy "records_select" on public.records
  for select to authenticated using (public.is_approved());
create policy "records_insert" on public.records
  for insert to authenticated with check (public.is_approved());
create policy "records_update" on public.records
  for update to authenticated using (public.is_approved()) with check (public.is_approved());
create policy "records_delete" on public.records
  for delete to authenticated using (public.is_admin());

drop policy if exists "history_all"    on public.history;
drop policy if exists "history_select" on public.history;
drop policy if exists "history_insert" on public.history;
create policy "history_select" on public.history
  for select to authenticated using (public.is_approved());
create policy "history_insert" on public.history
  for insert to authenticated with check (public.is_approved());
-- Geçmiş silinemez/değiştirilemez: güncelleme ve silme politikası bilerek YOK.

-- 5) ESKİ KULLANICI TABLOSU KALDIRILIYOR (şifre hash'leri dahil)
drop table if exists public.users;
