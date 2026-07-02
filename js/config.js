// ============================================================
// ÜRÜN TAKİP PANELİ - Yapılandırma
// Supabase projenizi oluşturduktan sonra aşağıdaki iki değeri doldurun.
// Supabase panelinde: Project Settings > API
//   - "Project URL"        -> SUPABASE_URL
//   - "anon public" anahtar -> SUPABASE_ANON_KEY
// ============================================================

const SUPABASE_URL = "https://oenfuqkakqfpfxptbsgz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_tDi8R0dGiktbhH-UoQTeeQ_rwvrkTyH";

// Para birimi: "EUR", "TRY", "USD" ...
const CURRENCY = "EUR";

// Sayı/tarih biçimi için yerel ayar
const LOCALE = "tr-TR";

// Yedek otomatik yenileme aralığı (milisaniye).
// Canlı güncelleme (realtime) zaten açık; bu sadece güvence içindir.
const POLL_INTERVAL_MS = 30000;
