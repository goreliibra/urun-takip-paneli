-- ============================================================
-- ÜRÜN TAKİP PANELİ - Veritabanı Kurulumu (Supabase / PostgreSQL)
-- Bu dosyanın TAMAMINI Supabase > SQL Editor'e yapıştırıp "Run" deyin.
-- Birden fazla kez çalıştırılabilir, mevcut veriyi bozmaz.
-- ============================================================

-- 1) KULLANICILAR TABLOSU
create table if not exists public.users (
  id            uuid primary key default gen_random_uuid(),
  username      text not null unique,
  password_hash text not null,
  role          text not null default 'kullanici' check (role in ('admin', 'kullanici')),
  created_at    timestamptz not null default now()
);

-- 2) ÜRÜN / SATIŞ KAYITLARI TABLOSU
create table if not exists public.records (
  id           uuid primary key default gen_random_uuid(),
  urun_adi     text not null,
  musteri_adi  text not null default '',
  urun_fiyati  numeric(12,2) not null check (urun_fiyati >= 0),
  alinan_para  numeric(12,2) not null default 0 check (alinan_para >= 0),
  kalan_para   numeric(12,2) not null default 0 check (kalan_para >= 0),
  tarih        date not null default current_date,
  aciklama     text not null default '',
  created_by   text not null,
  created_at   timestamptz not null default now(),
  updated_by   text,
  updated_at   timestamptz
);

-- 3) İŞLEM GEÇMİŞİ TABLOSU (kim, ne zaman, eski/yeni değerler)
create table if not exists public.history (
  id         uuid primary key default gen_random_uuid(),
  record_id  uuid,
  action     text not null check (action in ('create', 'update', 'delete')),
  changed_by text not null,
  changed_at timestamptz not null default now(),
  old_values jsonb,
  new_values jsonb
);

-- 4) SATIR SEVİYESİ GÜVENLİK (RLS)
-- Uygulama tek bir "anon" anahtar ile çalışır; yetki kontrolü uygulama
-- katmanında yapılır. RLS açık, anon erişimine izin veren politikalar tanımlı.
alter table public.users   enable row level security;
alter table public.records enable row level security;
alter table public.history enable row level security;

drop policy if exists "users_all"   on public.users;
drop policy if exists "records_all" on public.records;
drop policy if exists "history_all" on public.history;

create policy "users_all"   on public.users   for all using (true) with check (true);
create policy "records_all" on public.records for all using (true) with check (true);
create policy "history_all" on public.history for all using (true) with check (true);

-- 5) CANLI GÜNCELLEME (Realtime) - kayıt değişince diğer kullanıcılara anında yansır
do $$
begin
  alter publication supabase_realtime add table public.records;
exception
  when duplicate_object then null;
end $$;

-- 6) DEMO KULLANICILAR
-- admin / admin123  ve  kullanici / kullanici123
-- Şifreler SHA-256 ile hashlenmiş saklanır: sha256("kullaniciadi:sifre")
insert into public.users (username, password_hash, role)
values
  ('admin',     'bf6b5bdb74c79ece9fc0ad0ac9fb0359f9555d4f35a83b2e6ec69ae99e09603d', 'admin'),
  ('kullanici', '64366a8bfd326243913d7ab95ba415efc25e7702f2fcaef0712b21e2c1be0560', 'kullanici')
on conflict (username) do nothing;

-- 7) DEMO KAYITLAR (5 adet, farklı ödeme durumları)
insert into public.records (urun_adi, musteri_adi, urun_fiyati, alinan_para, kalan_para, tarih, aciklama, created_by)
select * from (values
  ('Döner Kesme Robotu',              'Mehmet Yılmaz',    1450.00, 1450.00,    0.00, current_date,     'Peşin ödendi, teslim edildi',        'admin'),
  ('Elektrikli Döner Ocağı 4 Radyan', 'Ali Kaya',          890.00,  400.00,  490.00, current_date - 2, 'Kalan tutar teslimatta ödenecek',    'admin'),
  ('Kebap Tezgahı (Soğutmalı)',       'Restoran Antalya', 2300.00,    0.00, 2300.00, current_date - 5, 'Fatura kesildi, ödeme bekleniyor',   'kullanici'),
  ('Döner Bıçağı Seti',               'Hasan Demir',       120.00,  120.00,    0.00, current_date - 1, '',                                   'kullanici'),
  ('Ayran Makinesi 3 Hazneli',        'Cafe İstanbul',     650.00,  300.00,  350.00, current_date,     'İkinci taksit gelecek hafta',        'kullanici')
) as demo(urun_adi, musteri_adi, urun_fiyati, alinan_para, kalan_para, tarih, aciklama, created_by)
where not exists (select 1 from public.records);

-- 8) DEMO KAYITLAR İÇİN "OLUŞTURULDU" GEÇMİŞİ
insert into public.history (record_id, action, changed_by, changed_at, new_values)
select r.id, 'create', r.created_by, r.created_at,
       jsonb_build_object(
         'urun_adi', r.urun_adi, 'musteri_adi', r.musteri_adi,
         'urun_fiyati', r.urun_fiyati, 'alinan_para', r.alinan_para,
         'kalan_para', r.kalan_para, 'tarih', r.tarih, 'aciklama', r.aciklama
       )
from public.records r
where not exists (select 1 from public.history);
