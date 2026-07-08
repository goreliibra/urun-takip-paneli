-- ============================================================
-- KULLANICI SİLME YETKİSİ (admin)
-- Bu dosyanın TAMAMINI Supabase > SQL Editor'e yapıştırıp "Run" deyin.
-- Mevcut veriye dokunmaz, sadece admin'in "Kullanıcı Yönetimi" sayfasından
-- üye silebilmesi için eksik olan silme (delete) kuralını ekler.
-- Not: kullanıcı adı/rol DÜZELTME zaten çalışıyor (mevcut profiles_update
-- kuralı admin'e izin veriyor) — bu dosya sadece SİLME içindir.
-- ============================================================

drop policy if exists "profiles_delete" on public.profiles;
create policy "profiles_delete" on public.profiles
  for delete to authenticated using (public.is_admin());
