# Ürün Takip Paneli

Çok kullanıcılı, web tabanlı ürün ve ödeme takip uygulaması.
Ürünleri, ürün fiyatlarını, müşteriden alınan parayı ve kalan parayı takip eder.
3-4 kişi farklı bilgisayar ve telefonlardan aynı anda kullanabilir — herkes aynı
ortak veritabanını görür, bir kişi kayıt eklediğinde diğerlerinde otomatik güncellenir.

## Özellikler

- 🔐 E-posta + şifre ile giriş (Supabase Auth) ve **"Şifremi unuttum" maili** ile şifre yenileme
- 👥 İki rol: **Admin** (her şey + silme + üye yönetimi) ve **Kullanıcı** (ekleme/düzenleme)
- 📊 Dashboard: toplam kayıt, toplam fiyat, alınan/kalan para, bugün eklenen, borçlu kayıt sayısı
- ➕ Kayıt ekleme: kalan para otomatik hesaplanır (elle de değiştirilebilir), negatif değer engellenir
- 📋 Kayıt listesi: arama (firma/ürün/müşteri/açıklama), tarih + ödeme durumu + kullanıcı + firma filtreleri
- ✏️ Düzenleme: kim, ne zaman düzenledi kaydedilir; eski/yeni değerler geçmişte saklanır
- 🗑 Silme: sadece admin, onay sorusu ile
- 🕓 İşlem geçmişi: hem genel sayfa hem kayıt bazında
- 🔄 Canlı güncelleme: Supabase Realtime + 30 sn'de bir yedek yenileme
- ⬇ CSV, Excel (xlsx) ve PDF dışa aktarma (aktif filtreye göre)
- 👤 Kullanıcı Yönetimi: üye ekle, kullanıcı adı/rol düzelt, engelle/onayla, kalıcı sil
- 🏢 Firmalar: firmalar **ayrı ayrı** eklenir (Firmalar sayfası), her kayıt bir firmaya
  bağlanabilir; firma bazında kayıt sayısı, toplam fiyat, alınan ve kalan para görünür
- 📦 Stok Takibi: giriş/çıkışlarda **isteğe bağlı birim fiyat** — ne kadara alındığı/satıldığı
  ve toplam tutar otomatik hesaplanıp gösterilir
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

## Üyelik Sistemi (Supabase Auth)

Kurulumun üyelik kısmı için `db/upgrade-auth.sql` dosyasını SQL Editor'de çalıştırın ve
Supabase panelinde iki ayar yapın:

1. **Authentication → URL Configuration → Site URL:** uygulamanın yayın adresi
   (örn. `https://KULLANICIADI.github.io/urun-takip-paneli/`). Yerel test için
   `http://localhost:8000` adresini de "Redirect URLs" listesine ekleyin.
2. **Authentication → Sign In / Providers → Email → "Confirm email" kapatın.**
   (Kapatmazsanız her yeni üyenin mailindeki doğrulama bağlantısına tıklaması gerekir.)

Önemli davranışlar:

- Sisteme kaydolan **ilk üye otomatik olarak onaylı Admin** olur.
- Sonraki üyeler admin tarafından **Kullanıcılar** sayfasından eklenir (e-posta + şifre + rol).
- Şifresini unutan, giriş ekranındaki **"Şifremi unuttum"** bağlantısıyla mailine
  yenileme bağlantısı alır. (Supabase ücretsiz planda mail gönderimi saatte ~2 ile sınırlıdır.)
- Admin bir üyeyi **engelleyebilir/onaylayabilir**; kalıcı silme Supabase panelinden yapılır
  (Authentication → Users).

Demo giriş bilgileri (`admin` / `admin123`) yalnızca `?demo=1` önizleme modunda geçerlidir.

### Kullanıcı adıyla giriş

E-postasız eklenen üyeler artık giriş ekranına kendi **kullanıcı adlarını** yazarak
girebilir (e-posta girmelerine gerek yok). Bunun çalışması için `db/upgrade-username-login.sql`
dosyasını bir kez SQL Editor'de çalıştırmanız gerekir (mevcut veriye dokunmaz, sadece
kullanıcı adını arka plandaki e-postaya çeviren küçük bir fonksiyon ekler).

### Kullanıcı düzenleme / silme

Kullanıcı Yönetimi sayfasında artık her üye için **✏️ Düzenle** (kullanıcı adı/rol
düzeltme) ve **🗑 Sil** (kalıcı silme) butonları var. Düzeltme zaten çalışır durumda;
**silme** için `db/upgrade-user-delete.sql` dosyasını bir kez SQL Editor'de çalıştırmanız
gerekir (eksik olan silme yetkisini ekler). Son aktif admin silinemez/rolü düşürülemez —
sistem kilitlenmesin diye.

### Firmalar (şirketler)

Sol menüde **🏢 Firmalar** sayfası var: firma adlarını buradan tek tek eklersiniz,
adını düzeltebilir (admin ise) silebilirsiniz. Eklediğiniz firmalar hem **Yeni Kayıt**
hem **Düzenle** formundaki **Firma** listesinde çıkar; istenirse form içindeki
"➕ Yeni firma ekle..." seçeneğiyle kayıt eklerken de yeni firma oluşturulabilir.
Firma alanı **zorunlu değildir** — boş bırakılan kayıtlar eskisi gibi çalışır.

Kayıt listesinde **Firma** kolonu ve **Firma filtresi** (ayrıca "firmasız kayıtlar"
seçeneği) vardır; arama kutusu firma adında da arar; CSV/Excel/PDF çıktılarına ve
otomatik Excel yedeğine Firma kolonu eklenir. Firma adını değiştirdiğinizde ona bağlı
tüm kayıtlarda yeni ad görünür. Bir firmayı silmek **kayıtları silmez**, sadece o
kayıtların firma bilgisi boşalır.

Bunun çalışması için `db/upgrade-firmalar.sql` dosyasını bir kez SQL Editor'de
çalıştırmanız gerekir (yeni `companies` tablosunu ve kayıtlara isteğe bağlı `firma_id`
sütununu ekler; mevcut veriye dokunmaz).

### Stok hareketlerinde birim fiyat

Stok girişi/çıkışı yaparken artık isteğe bağlı bir **"Birim Fiyat"** alanı da var (ör.
500 adet, birim fiyatı 6 €) — boş bırakılabilir, zorunlu değildir. Girilirse "Son
Hareketler" tablosunda birim fiyat ve toplam tutar (miktar × birim fiyat) otomatik
gösterilir. Bunun çalışması için `db/upgrade-stok-fiyat.sql` dosyasını bir kez SQL
Editor'de çalıştırmanız gerekir (yeni, isteğe bağlı bir sütun ekler).

## Yedekleme

**1. Anlık/yerel yedek:** Her yeni kayıt eklendiğinde tarayıcı otomatik olarak tüm
kayıtların bir Excel kopyasını bilgisayara indirir (`js/app.js` içindeki
`AUTO_BACKUP_ON_ADD` sabitiyle kapatılabilir). Bu, sadece o anda kaydı ekleyen kişinin
kendi cihazına iner — merkezi bir yedek değildir.

**2. Merkezi/otomatik yedek (önerilen):** `.github/workflows/backup.yml` **her 30 dakikada
bir** Supabase'deki tüm tabloları (`profiles`, `records`, `history`, `companies`,
`stock_items`, `stock_moves`) JSON olarak indirip bu depoya (`backups/TARIH/`) kaydeder. Veri gerçekten
değişmediyse yeni bir kayıt (commit) oluşturmaz, yer kaplamaz. **Hiçbir eski yedek silinmez
— kalıcı olarak birikir**, git geçmişinin tamamı da ayrıca tarihli bir değişiklik kaydı
gibi işlev görür. **Depo private olduğu için bu yedekler yalnızca sizin erişiminiz olan
kişiler tarafından görülebilir.** Kurulum (bir kez):

1. Supabase panelinde **Project Settings → API → Project API keys → service_role**
   anahtarını kopyalayın (bu anahtar RLS'i atlar, çok güçlüdür — asla paylaşmayın/kod
   içine yazmayın).
2. GitHub'da bu depo → **Settings → Secrets and variables → Actions → New repository
   secret** → İsim: `SUPABASE_SERVICE_ROLE_KEY`, Değer: kopyaladığınız anahtar.
3. İsterseniz hemen test etmek için **Actions** sekmesi → "Haftalık Veritabanı Yedeği" →
   **Run workflow** ile elle bir kez çalıştırabilirsiniz.

## Dosya Yapısı

```
urun-takip-paneli/
├── index.html      → Tüm sayfalar (giriş, dashboard, kayıtlar, firmalar, stok, geçmiş, kullanıcılar)
├── css/style.css   → Tasarım
├── js/config.js    → Supabase bağlantı ayarları (SİZ DOLDURACAKSINIZ)
├── js/auth.js      → Giriş / oturum / şifre hash'leme
├── js/db.js        → Veritabanı okuma-yazma katmanı
├── js/app.js       → Uygulama mantığı (görünümler, filtreler, export...)
├── db/setup.sql    → Veritabanı kurulum betiği (Supabase SQL Editor'de çalıştırın)
└── db/upgrade-firmalar.sql → Firmalar tablosu + kayıtlara firma sütunu (bir kez çalıştırın)
```

## Güvenlik Notları

- Şifreler Supabase'in üyelik sisteminde güvenle (bcrypt) saklanır, açık metin tutulmaz.
- Veritabanı **satır bazlı güvenlik (RLS)** ile kilitlidir: giriş yapmamış veya
  onaylanmamış hiç kimse hiçbir veriyi okuyamaz/yazamaz — sayfa kaynağındaki
  bağlantı anahtarı tek başına veriye erişim sağlamaz.
- Kayıt silme yetkisi veritabanı seviyesinde yalnızca admin rolündedir.
- İşlem geçmişi tablosu değiştirilemez/silinemez (denetim izi korunur).
- Aynı kullanıcı adı veya e-posta iki kez kullanılamaz.

## Geliştirme Fikirleri

- Taksit / ödeme planı takibi (bir kayda birden çok ödeme)
- PDF rapor çıktısı
- Aylık özet grafikleri
