-- ============================================================
-- KULLANICI ADIYLA GİRİŞ (e-postasız üyeler için)
-- Bu dosyanın TAMAMINI Supabase > SQL Editor'e yapıştırıp "Run" deyin.
-- Mevcut hiçbir veriye/kurallara DOKUNMAZ, sadece yeni bir fonksiyon ekler.
--
-- Neden gerekli: Admin "Kullanıcı Ekle" formunda e-postayı boş bırakırsa,
-- sistem arka planda görünmeyen bir adres üretiyor (ör. ali@uye.uruntakip-paneli.com).
-- Üye bunu bilmediği için giriş ekranına kendi adını yazınca "e-posta hatalı" hatası
-- alıyordu. Bu fonksiyon, kullanıcı adını arka plandaki gerçek/üretilmiş e-postaya
-- çevirir; böylece üye sadece kullanıcı adı + şifre ile giriş yapabilir.
-- ============================================================

create or replace function public.resolve_login_email(p_identifier text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select email from public.profiles
  where lower(username) = lower(trim(p_identifier))
  limit 1
$$;

grant execute on function public.resolve_login_email(text) to anon, authenticated;
