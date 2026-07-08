-- ============================================================
-- STOK HAREKETLERİNE İSTEĞE BAĞLI BİRİM FİYAT
-- Bu dosyanın TAMAMINI Supabase > SQL Editor'e yapıştırıp "Run" deyin.
-- Mevcut veriye dokunmaz, sadece isteğe bağlı (boş bırakılabilir) yeni
-- bir sütun ekler: giriş/çıkış yaparken "500 adet, birim fiyatı 6 Euro"
-- gibi fiyat bilgisi de kaydedilebilsin diye (ne kadara aldık/sattık).
-- ============================================================

alter table public.stock_moves
  add column if not exists birim_fiyat numeric(12,2);
