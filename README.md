# Ürün Takip Paneli

Çok kullanıcılı, web tabanlı ürün ve ödeme takip uygulaması.
Ürünleri, ürün fiyatlarını, müşteriden alınan parayı ve kalan parayı takip eder.
3-4 kişi farklı bilgisayar ve telefonlardan aynı anda kullanabilir — herkes aynı
ortak veritabanını görür, bir kişi kayıt eklediğinde diğerlerinde otomatik güncellenir.

## Özellikler

- 🔐 Kullanıcı adı + şifre ile giriş (şifreler hash'lenerek saklanır)
- 👥 İki rol: **Admin** (her şey + silme + kullanıcı yönetimi) ve **Kullanıcı** (ekleme/düzenleme)
- 📊 Dashboard: toplam kayıt, toplam fiyat, alınan/kalan para, bugün eklenen, borçlu kayıt sayısı
- ➕ Kayıt ekleme: kalan para otomatik hesaplanır (elle de değiştirilebilir), negatif değer engellenir
- 📋 Kayıt listesi: arama (ürün/müşteri/açıklama), tarih + ödeme durumu + kullanıcı filtreleri
- ✏️ Düzenleme: kim, ne zaman düzenledi kaydedilir; eski/yeni değerler geçmişte saklanır
- 🗑 Silme: sadece admin, onay sorusu ile
- 🕓 İşlem geçmişi: hem genel sayfa hem kayıt bazında
- 🔄 Canlı güncelleme: Supabase Realtime + 30 sn'de bir yedek yenileme
- ⬇ CSV ve Excel (xlsx) dışa aktarma (aktif filtreye göre)
- 📱 Mobil uyumlu, sade koyu mavi/beyaz tasarım

## Teknoloji

- **Ön yüz:** Saf HTML + CSS + JavaScript (framework yok, statik dosyalar)
- **Veritabanı:** [Supabase](https://supabase.com) (ücretsiz PostgreSQL, bulutta kalıcı)
- **Barındırma:** Herhangi bir statik sunucu (GitHub Pages önerilir — ücretsiz)

LocalStorage'da **veri tutulmaz**; sadece oturum bilgisi saklanır. Tüm veriler buluttaki
ortak PostgreSQL veritabanında durur, kaybolmaz.

## Kurulum (bir kez, ~10 dakika)

### 1. Supabase projesi oluşturun

1. [supabase.com](https://supabase.com) adresinde ücretsiz hesap açın.
2. **New Project** deyin: bir isim verin (örn. `urun-takip`), güçlü bir veritabanı
   şifresi belirleyin, bölge olarak **Frankfurt (eu-central-1)** seçin.
3. Proje hazır olana kadar 1-2 dakika bekleyin.

### 2. Veritabanını kurun

1. Sol menüden **SQL Editor**'ü açın.
2. Bu projedeki [`db/setup.sql`](db/setup.sql) dosyasının **tamamını** kopyalayıp yapıştırın.
3. **Run** butonuna basın. "Success" görmelisiniz.

Bu adım tabloları, demo kullanıcıları ve 5 demo kaydı oluşturur.

### 3. Bağlantı bilgilerini girin

1. Supabase panelinde **Project Settings → API** sayfasını açın.
2. **Project URL** ve **anon public** anahtarını kopyalayın.
3. Bu projedeki [`js/config.js`](js/config.js) dosyasını açıp iki değeri yapıştırın:

```js
const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOi...";
```

İsterseniz aynı dosyadan para birimini değiştirin: `CURRENCY = "EUR"` → `"TRY"` vb.

## Çalıştırma

### Bilgisayarda test (yerel)

Proje klasöründe:

```bash
python3 -m http.server 8000
```

Tarayıcıda açın: <http://localhost:8000>

### İnternette yayınlama (GitHub Pages — önerilen)

```bash
git init
git add .
git commit -m "Ürün Takip Paneli"
gh repo create urun-takip-paneli --private --source=. --push
```

Sonra GitHub'da repo → **Settings → Pages → Branch: main** seçin.
Birkaç dakika içinde `https://KULLANICIADI.github.io/urun-takip-paneli/` adresinden
tüm cihazlarda kullanılabilir.

> Not: Repo private olsa bile GitHub Pages sayfası (Pages ayarına göre) herkese açık
> olabilir; giriş ekranı olmadan veriye erişilemez ama adresi paylaşmamaya özen gösterin.

## Demo Kullanıcılar

| Kullanıcı adı | Şifre          | Rol       |
|---------------|----------------|-----------|
| `admin`       | `admin123`     | Admin     |
| `kullanici`   | `kullanici123` | Kullanıcı |

⚠️ Gerçek kullanıma geçmeden önce **Kullanıcılar** sayfasından bu şifreleri değiştirin.

## Dosya Yapısı

```
urun-takip-paneli/
├── index.html      → Tüm sayfalar (giriş, dashboard, kayıtlar, geçmiş, kullanıcılar)
├── css/style.css   → Tasarım
├── js/config.js    → Supabase bağlantı ayarları (SİZ DOLDURACAKSINIZ)
├── js/auth.js      → Giriş / oturum / şifre hash'leme
├── js/db.js        → Veritabanı okuma-yazma katmanı
├── js/app.js       → Uygulama mantığı (görünümler, filtreler, export...)
└── db/setup.sql    → Veritabanı kurulum betiği (Supabase SQL Editor'de çalıştırın)
```

## Güvenlik Notları

- Şifreler veritabanında **SHA-256 hash** olarak saklanır, açık metin tutulmaz.
- Giriş yapmayan kullanıcı hiçbir sayfayı göremez; admin olmayan kullanıcı,
  kullanıcı yönetimi sayfasına giremez ve silme butonu görmez.
- Aynı kullanıcı adı iki kez oluşturulamaz (veritabanı seviyesinde engelli).
- Bu uygulama küçük ve **birbirine güvenen bir ekip** (3-4 kişi) için tasarlandı.
  Yetki kontrolü uygulama katmanındadır; bağlantı anahtarı (anon key) sayfa kaynağında
  görünür. Hassas/kurumsal veriler için ileride Supabase Auth + satır bazlı yetki
  (RLS) kurallarına geçilmesi önerilir — kod buna uygun, geliştirilebilir yapıdadır.

## Geliştirme Fikirleri

- Supabase Auth ile gerçek oturum yönetimi (JWT + RLS)
- Taksit / ödeme planı takibi (bir kayda birden çok ödeme)
- PDF rapor çıktısı
- Aylık özet grafikleri
