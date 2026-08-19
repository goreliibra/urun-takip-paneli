// ============================================================
// ÜRÜN TAKİP PANELİ - Service Worker (telefonda "uygulama gibi" çalışması için)
//
// Görevi: uygulamanın dosyalarını (HTML/CSS/JS/ikon) cihazda saklamak; böylece
// ana ekrandan açıldığında anında yüklenir, internet gidip gelse bile ekran
// bozulmaz.
//
// ÖNEMLİ: Veriler (Supabase istekleri) ASLA saklanmaz — kayıtlar her zaman
// canlı veritabanından okunur, eski veri gösterilmez.
//
// Strateji: "önce ağ, olmazsa hafıza". İnternet varken hep en güncel dosya
// indirilir (yani yeni sürüm hemen gelir), internet yoksa son saklanan sürüm
// kullanılır.
// ============================================================

const CACHE = "urun-takip-v1";

// Uygulamanın çalışması için gereken temel dosyalar
const SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/config.js",
  "./js/auth.js",
  "./js/db.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Tek bir dosya inmezse kurulumun tamamı çökmesin
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((adlar) => Promise.all(adlar.filter((a) => a !== CACHE).map((a) => caches.delete(a))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Sadece basit okuma istekleri ele alınır
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Veritabanı/oturum istekleri asla saklanmaz (her zaman canlı veri)
  if (url.hostname.endsWith("supabase.co") || url.hostname.endsWith("supabase.in")) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        // Başarılı cevabı bir sonraki açılış için sakla
        if (res && (res.ok || res.type === "opaque")) {
          const kopya = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, kopya)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        // İnternet yok: son saklanan sürümü ver
        const cached = await caches.match(req);
        if (cached) return cached;
        // Sayfa isteğiyse ana sayfaya düş
        if (req.mode === "navigate") {
          const shell = await caches.match("./index.html");
          if (shell) return shell;
        }
        return Response.error();
      })
  );
});
