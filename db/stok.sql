-- ============================================================
-- STOK TAKİBİ - Ürün giriş/çıkış tabloları
-- (Supabase SQL Editor'de bir kez çalıştırılır; mevcut veriye dokunmaz)
-- ============================================================

-- 1) STOK ÜRÜNLERİ
create table if not exists public.stock_items (
  id         uuid primary key default gen_random_uuid(),
  urun_adi   text not null unique,
  created_by text not null default '',
  created_at timestamptz not null default now()
);

-- 2) STOK HAREKETLERİ (giriş = stoğa ekle, çıkış = stoktan düş)
create table if not exists public.stock_moves (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.stock_items(id) on delete cascade,
  tip        text not null check (tip in ('giris', 'cikis')),
  miktar     numeric(12,2) not null check (miktar > 0),
  tarih      date not null default current_date,
  aciklama   text not null default '',
  created_by text not null,
  created_at timestamptz not null default now()
);

-- 3) GÜVENLİK: kayıtlar tablosuyla aynı model
-- Onaylı üyeler görebilir/ekleyebilir; silme yalnızca admin.
alter table public.stock_items enable row level security;
alter table public.stock_moves enable row level security;

drop policy if exists "stock_items_select" on public.stock_items;
drop policy if exists "stock_items_insert" on public.stock_items;
drop policy if exists "stock_items_delete" on public.stock_items;
create policy "stock_items_select" on public.stock_items
  for select to authenticated using (public.is_approved());
create policy "stock_items_insert" on public.stock_items
  for insert to authenticated with check (public.is_approved());
create policy "stock_items_delete" on public.stock_items
  for delete to authenticated using (public.is_admin());

drop policy if exists "stock_moves_select" on public.stock_moves;
drop policy if exists "stock_moves_insert" on public.stock_moves;
drop policy if exists "stock_moves_delete" on public.stock_moves;
create policy "stock_moves_select" on public.stock_moves
  for select to authenticated using (public.is_approved());
create policy "stock_moves_insert" on public.stock_moves
  for insert to authenticated with check (public.is_approved());
create policy "stock_moves_delete" on public.stock_moves
  for delete to authenticated using (public.is_admin());

-- 4) CANLI GÜNCELLEME
do $$
begin
  alter publication supabase_realtime add table public.stock_moves;
exception
  when duplicate_object then null;
end $$;
