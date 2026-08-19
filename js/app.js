// ============================================================
// ÜRÜN TAKİP PANELİ - Uygulama Mantığı
// ============================================================

// ---------- Kısayollar ve yardımcılar ----------

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// HTML enjeksiyonuna karşı kaçış
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

const fmtPara = (n) =>
  new Intl.NumberFormat(LOCALE, { style: "currency", currency: CURRENCY }).format(Number(n) || 0);

const fmtTarih = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("tr-TR") : "");
const fmtZaman = (ts) => (ts ? new Date(ts).toLocaleString("tr-TR") : "");

const FIELD_LABELS = {
  firma_id: "Firma",
  urun_adi: "Ürün adı",
  musteri_adi: "Müşteri adı",
  urun_fiyati: "Ürün fiyatı",
  alinan_para: "Alınan para",
  kalan_para: "Kalan para",
  tarih: "Tarih",
  aciklama: "Açıklama",
};

const MONEY_FIELDS = ["urun_fiyati", "alinan_para", "kalan_para"];

const STATUS_TEXT = { odendi: "Ödendi", borc: "Borç var", alinmadi: "Ödeme alınmadı" };

// Ödeme durumu: kalan 0 -> Ödendi, alınan 0 -> Ödeme alınmadı, aksi halde Borç var
function statusOf(r) {
  const kalan = Number(r.kalan_para) || 0;
  const alinan = Number(r.alinan_para) || 0;
  if (kalan <= 0) return "odendi";
  if (alinan <= 0) return "alinmadi";
  return "borc";
}

// Kayıtta yalnızca firma kimliği (firma_id) tutulur; adı firma listesinden okunur.
// Böylece firma adı değiştirilince tüm kayıtlarda yeni ad görünür.
function companyName(id) {
  if (!id) return "";
  const c = companies.find((x) => x.id === id);
  return c ? c.firma_adi : "";
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------- Bildirim (toast) ----------

let toastTimer = null;
function toast(msg, type = "success") {
  const el = $("#toast");
  el.textContent = msg;
  el.className = `toast toast-${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3500);
}

// ---------- Onay penceresi (Promise tabanlı) ----------

let confirmResolve = null;
function confirmDialog(text, okLabel = "Evet, Sil", title = "Emin misiniz?") {
  $("#confirm-title").textContent = title;
  $("#confirm-text").textContent = text;
  $("#btn-confirm-ok").textContent = okLabel;
  $("#modal-confirm").classList.remove("hidden");
  return new Promise((resolve) => (confirmResolve = resolve));
}

function closeConfirm(result) {
  $("#modal-confirm").classList.add("hidden");
  if (confirmResolve) confirmResolve(result);
  confirmResolve = null;
}

// ---------- Şifre penceresi (Promise tabanlı) ----------

let passwordResolve = null;
function passwordDialog(title) {
  $("#password-title").textContent = title;
  $("#p-password").value = "";
  $("#p-password2").value = "";
  $("#modal-password").classList.remove("hidden");
  $("#p-password").focus();
  return new Promise((resolve) => (passwordResolve = resolve));
}

function closePassword(result) {
  $("#modal-password").classList.add("hidden");
  if (passwordResolve) passwordResolve(result);
  passwordResolve = null;
}

// ---------- Durum ----------

let session = null; // { id, username, role, email }
let records = [];
let usersList = [];
let companies = [];
let companiesReady = false; // firma tablosu veritabanında var mı? (SQL çalıştırıldı mı)
let stockItems = [];
let stockMoves = [];
let currentView = "dashboard";
let editingRecord = null;
let editingUser = null;
let editingCompany = null;
let openCompanyId = null; // "Firma sayfası" açıkken hangi firmayı gösteriyoruz
let pollTimer = null;

// E-postasız eklenen üyeler için otomatik üretilen adres uzantısı
const FAKE_MAIL_DOMAIN = "@uye.uruntakip-paneli.com";

// Her yeni kayıt eklendiğinde bilgisayara otomatik Excel yedeği indirilsin mi?
// (Sunucu tarafında düzenli yedekleme kurulunca burayı false yapabilirsiniz.)
const AUTO_BACKUP_ON_ADD = true;

// ============================================================
// BAŞLANGIÇ
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  if (!isConfigured()) {
    $("#view-setup").classList.remove("hidden");
    return;
  }
  initDb();
  wireEvents();

  // Mailden gelen "şifre yenileme" bağlantısını yakala
  if (sb) {
    sb.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") handlePasswordRecovery();
    });
  }

  session = await authCurrentUser();
  if (session) enterApp();
  else showLogin();
});

// Mail bağlantısıyla gelindiğinde yeni şifre belirletir
async function handlePasswordRecovery() {
  const pw = await passwordDialog("Yeni Şifrenizi Belirleyin");
  if (pw === null) return;
  if (pw.length < 6) {
    toast("Şifre en az 6 karakter olmalı.", "error");
    return handlePasswordRecovery();
  }
  try {
    await authSetNewPassword(pw);
    toast("✅ Şifreniz güncellendi.");
    session = await authCurrentUser();
    if (session) enterApp();
  } catch (err) {
    toast(err.message || "Şifre güncellenemedi.", "error");
  }
}

function showLogin() {
  $("#app").classList.add("hidden");
  $("#view-login").classList.remove("hidden");
  $("#login-email").focus();
}

async function enterApp() {
  $("#view-login").classList.add("hidden");
  $("#app").classList.remove("hidden");

  $("#current-user-name").textContent = session.username;
  $("#current-user-role").textContent = session.role === "admin" ? "Admin" : "Kullanıcı";

  // Admin olmayan kullanıcı, kullanıcı yönetimi sekmesini göremez
  $("#nav-users").classList.toggle("hidden", session.role !== "admin");

  $("#n-tarih").value = todayISO();
  $("#s-tarih").value = todayISO();

  await loadAll();
  showView("dashboard");

  // Canlı güncelleme: başka bir kullanıcı kayıt ekleyince/değiştirince otomatik yenilenir
  dbSubscribeRecords(async () => {
    await loadRecords();
    renderCurrentView();
  });
  dbSubscribeStock(() => {
    if (currentView === "stok") renderStok();
  });
  dbSubscribeCompanies(async () => {
    await loadCompanies();
    if (currentView === "firmalar") renderFirmaTable();
    else if (currentView === "firma-detay") renderFirmaDetay();
    else if (currentView === "records") renderRecords();
  });

  // Yedek: belirli aralıklarla ve sekme öne gelince yenile
  clearInterval(pollTimer);
  pollTimer = setInterval(refreshData, POLL_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && session) refreshData();
  });
}

async function refreshData() {
  try {
    await loadRecords();
    renderCurrentView();
  } catch {
    /* geçici bağlantı hatalarında sessiz kal */
  }
}

async function loadAll() {
  try {
    await Promise.all([loadRecords(), loadUsers(), loadCompanies()]);
  } catch (e) {
    toast("Veriler yüklenemedi: " + (e.message || e), "error");
  }
}

async function loadRecords() {
  records = await dbFetchRecords();
}

async function loadUsers() {
  usersList = await dbFetchUsers();
  fillUserFilter();
}

// Firma listesi. Veritabanında "companies" tablosu yoksa (db/upgrade-firmalar.sql
// henüz çalıştırılmadıysa) uygulamanın kalanı çalışmaya devam eder; Firmalar
// sayfasında ne yapılması gerektiği yazar.
async function loadCompanies() {
  try {
    companies = await dbFetchCompanies();
    companiesReady = true;
  } catch (e) {
    companies = [];
    companiesReady = false;
    console.warn("Firma listesi yüklenemedi:", e.message || e);
  }
  fillCompanySelect("n");
  fillCompanySelect("e");
  fillFirmaFilter();
}

// ============================================================
// GÖRÜNÜM YÖNETİMİ
// ============================================================

function showView(name) {
  // Yetkisiz erişim engeli: admin olmayan kullanıcı, kullanıcılar sayfasını açamaz
  if (name === "users" && session.role !== "admin") {
    toast("Bu sayfaya erişim yetkiniz yok.", "error");
    return;
  }

  currentView = name;
  $$(".view").forEach((v) => v.classList.add("hidden"));
  $(`#view-${name}`).classList.remove("hidden");
  // Firma sayfası menüde ayrı bir madde değil; menüde "Firmalar" işaretli kalır
  const navName = name === "firma-detay" ? "firmalar" : name;
  $$(".nav-link").forEach((l) => l.classList.toggle("active", l.dataset.view === navName));
  setSidebar(false);
  renderCurrentView();
}

// Mobil yan menüyü aç/kapat (karartma perdesiyle birlikte)
function setSidebar(open) {
  $("#sidebar").classList.toggle("open", open);
  $("#sidebar-backdrop").classList.toggle("hidden", !open);
}

function renderCurrentView() {
  if (currentView === "dashboard") renderDashboard();
  else if (currentView === "records") renderRecords();
  else if (currentView === "stok") renderStok();
  else if (currentView === "firmalar") renderFirmalar();
  else if (currentView === "firma-detay") renderFirmaDetay();
  else if (currentView === "history") renderHistoryPage();
  else if (currentView === "users") renderUsers();
}

// ============================================================
// DASHBOARD
// ============================================================

function renderDashboard() {
  const today = new Date().toDateString();
  let totalPrice = 0, totalPaid = 0, totalDue = 0, todayCount = 0, debtCount = 0;

  for (const r of records) {
    totalPrice += Number(r.urun_fiyati) || 0;
    totalPaid += Number(r.alinan_para) || 0;
    totalDue += Number(r.kalan_para) || 0;
    if (new Date(r.created_at).toDateString() === today) todayCount++;
    if ((Number(r.kalan_para) || 0) > 0) debtCount++;
  }

  $("#stat-total-count").textContent = records.length;
  $("#stat-total-price").textContent = fmtPara(totalPrice);
  $("#stat-total-paid").textContent = fmtPara(totalPaid);
  $("#stat-total-due").textContent = fmtPara(totalDue);
  $("#stat-today-count").textContent = todayCount;
  $("#stat-debt-count").textContent = debtCount;
}

// ============================================================
// YENİ KAYIT
// ============================================================

// Fiyat/alınan değişince kalanı otomatik hesapla (elle değiştirmek yine mümkün)
function attachAutoKalan(prefix) {
  const recalc = () => {
    const fiyat = parseFloat($(`#${prefix}-fiyat`).value) || 0;
    const alinan = parseFloat($(`#${prefix}-alinan`).value) || 0;
    $(`#${prefix}-kalan`).value = Math.max(0, fiyat - alinan).toFixed(2);
  };
  $(`#${prefix}-fiyat`).addEventListener("input", recalc);
  $(`#${prefix}-alinan`).addEventListener("input", recalc);
}

// Form ve filtrelerdeki firma listesini doldurur (seçili değer korunur)
function fillCompanySelect(prefix) {
  const sel = $(`#${prefix}-firma`);
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML =
    '<option value="">— Firma seçilmedi —</option>' +
    companies.map((c) => `<option value="${esc(c.id)}">${esc(c.firma_adi)}</option>`).join("") +
    '<option value="__yeni__">➕ Yeni firma ekle...</option>';
  sel.value = current;
  toggleNewCompany(prefix);
}

// "Yeni firma ekle..." seçilince yanındaki ad kutusu görünür olur
function toggleNewCompany(prefix) {
  const wrap = $(`#${prefix}-firma-yeni-wrap`);
  const sel = $(`#${prefix}-firma`);
  if (wrap && sel) wrap.classList.toggle("hidden", sel.value !== "__yeni__");
}

// Formda seçilen firmanın kimliğini döndürür. "Yeni firma ekle..." seçilmişse
// firmayı önce oluşturur (aynı isim varsa onu kullanır, kopya oluşmaz).
async function resolveCompanyId(prefix) {
  const sel = $(`#${prefix}-firma`);
  if (!sel) return null;
  if (sel.value !== "__yeni__") return sel.value || null;

  const ad = $(`#${prefix}-firma-yeni`).value.trim();
  const mevcut = companies.find((c) => c.firma_adi.toLowerCase() === ad.toLowerCase());
  if (mevcut) return mevcut.id;

  const yeni = await dbAddCompany(ad, session.username);
  companies.push(yeni);
  companies.sort((a, b) => a.firma_adi.localeCompare(b.firma_adi, LOCALE));
  return yeni.id;
}

// Formdaki alanları okur ve doğrular; hata varsa mesaj döndürür
function collectForm(prefix) {
  const firmaSel = $(`#${prefix}-firma`).value;
  const urun = $(`#${prefix}-urun`).value.trim();
  const musteri = $(`#${prefix}-musteri`).value.trim();
  const fiyatStr = $(`#${prefix}-fiyat`).value;
  const alinanStr = $(`#${prefix}-alinan`).value;
  const kalanStr = $(`#${prefix}-kalan`).value;
  const tarih = $(`#${prefix}-tarih`).value || todayISO();
  const aciklama = $(`#${prefix}-aciklama`).value.trim();

  if (!urun) return { error: "Ürün adı boş bırakılamaz." };
  if (fiyatStr === "") return { error: "Ürün fiyatı boş bırakılamaz." };
  if (firmaSel === "__yeni__" && !$(`#${prefix}-firma-yeni`).value.trim()) {
    return { error: "Yeni firmanın adını yazın." };
  }

  const fiyat = parseFloat(fiyatStr);
  const alinan = alinanStr === "" ? 0 : parseFloat(alinanStr);
  const kalan = kalanStr === "" ? Math.max(0, fiyat - alinan) : parseFloat(kalanStr);

  if (isNaN(fiyat) || fiyat < 0) return { error: "Ürün fiyatı negatif olamaz." };
  if (isNaN(alinan) || alinan < 0) return { error: "Alınan para negatif olamaz." };
  if (isNaN(kalan) || kalan < 0) return { error: "Kalan para negatif olamaz." };

  return {
    fields: {
      // "__yeni__" seçildiyse gerçek kimlik kaydetmeden önce resolveCompanyId ile atanır
      firma_id: firmaSel === "__yeni__" ? null : firmaSel || null,
      urun_adi: urun,
      musteri_adi: musteri,
      urun_fiyati: Math.round(fiyat * 100) / 100,
      alinan_para: Math.round(alinan * 100) / 100,
      kalan_para: Math.round(kalan * 100) / 100,
      tarih,
      aciklama,
    },
  };
}

async function onNewSubmit(e) {
  e.preventDefault();
  const { fields, error } = collectForm("n");
  if (error) return toast(error, "error");

  // ÖNEMLİ: indirme, düğmeye tıklamanın hemen ardından (sunucu cevabını beklemeden)
  // tetikleniyor. Çünkü başta "await" ile sunucuya gidip dönene kadar bekleseydik,
  // özellikle iPhone/Safari gibi mobil tarayıcılar "kullanıcı tıklamasından çok sonra
  // geldi" diyerek indirmeyi sessizce engelliyor (hata bile vermiyor). Bu yüzden
  // henüz sunucuya kaydedilmemiş olsa da, elimizdeki güncel veriyle hemen indiriyoruz.
  if (AUTO_BACKUP_ON_ADD) {
    // Yeni firma yazıldıysa kimliği henüz yok ama adını biliyoruz; yedeğe adı yazılır.
    const firmaAdi =
      $("#n-firma").value === "__yeni__"
        ? $("#n-firma-yeni").value.trim()
        : companyName(fields.firma_id);
    autoBackupSnapshot([...records, { ...fields, _firma_adi: firmaAdi, created_by: session.username }]);
  }

  try {
    fields.firma_id = await resolveCompanyId("n"); // gerekirse yeni firmayı oluşturur
    await dbAddRecord(fields, session.username);
    $("#form-new").reset();
    $("#n-tarih").value = todayISO();
    toggleNewCompany("n");
    await loadRecords();
    await loadCompanies();
    renderCurrentView();
    toast("✅ Kayıt başarıyla eklendi." + (AUTO_BACKUP_ON_ADD ? " 💾 Yedek indirildi." : ""));
  } catch (err) {
    toast("Kayıt eklenemedi: " + firmaHatasi(err), "error");
  }
}

// Firma sütunu/tablosu henüz veritabanında yoksa anlaşılır bir yol gösterir
function firmaHatasi(err) {
  const msg = (err && err.message) || String(err);
  if (/firma_id|companies/i.test(msg)) {
    return "firma özelliği için db/upgrade-firmalar.sql dosyasını Supabase → SQL Editor'de bir kez çalıştırmanız gerekiyor.";
  }
  return msg;
}

// Filtreden bağımsız, verilen (varsayılan: TÜM) kayıtların anlık Excel yedeğini
// bilgisayara indirir. Sunucu tarafı yedekleme kurulana kadar geçici bir güvence
// katmanıdır.
function autoBackupSnapshot(rows_) {
  const source = rows_ || records;
  if (typeof XLSX === "undefined" || !source.length) return;
  try {
    const rows = source.map((r) => ({
      Tarih: fmtTarih(r.tarih),
      Firma: r._firma_adi ?? companyName(r.firma_id),
      "Ürün Adı": r.urun_adi,
      "Müşteri Adı": r.musteri_adi || "",
      "Ürün Fiyatı": Number(r.urun_fiyati),
      "Alınan Para": Number(r.alinan_para),
      "Kalan Para": Number(r.kalan_para),
      "Ödeme Durumu": STATUS_TEXT[statusOf(r)],
      Açıklama: r.aciklama || "",
      Ekleyen: r.created_by,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Kayıtlar");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    XLSX.writeFile(wb, `yedek-urun-takip-${stamp}.xlsx`);
  } catch (err) {
    console.error("Otomatik yedek indirilemedi:", err);
  }
}

// ============================================================
// KAYIT LİSTESİ + FİLTRELER
// ============================================================

function fillUserFilter() {
  const names = new Set(usersList.map((u) => u.username));
  records.forEach((r) => names.add(r.created_by));
  const sel = $("#f-user");
  const current = sel.value;
  sel.innerHTML =
    '<option value="">Tümü</option>' +
    [...names].sort().map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
  sel.value = current;
}

// Firma filtresi listesi ("__yok__" = firması girilmemiş kayıtlar)
function fillFirmaFilter() {
  const sel = $("#f-firma");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML =
    '<option value="">Tümü</option>' +
    companies.map((c) => `<option value="${esc(c.id)}">${esc(c.firma_adi)}</option>`).join("") +
    '<option value="__yok__">— Firmasız kayıtlar —</option>';
  sel.value = current;
}

function getFilteredRecords() {
  const q = $("#f-search").value.trim().toLowerCase();
  const from = $("#f-date-from").value;
  const to = $("#f-date-to").value;
  const durum = $("#f-durum").value;
  const user = $("#f-user").value;
  const firma = $("#f-firma").value;

  return records.filter((r) => {
    if (q) {
      const hay = `${companyName(r.firma_id)} ${r.urun_adi || ""} ${r.musteri_adi || ""} ${r.aciklama || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (from && r.tarih < from) return false;
    if (to && r.tarih > to) return false;
    if (durum && statusOf(r) !== durum) return false;
    if (user && r.created_by !== user) return false;
    if (firma === "__yok__") {
      if (r.firma_id) return false;
    } else if (firma && r.firma_id !== firma) return false;
    return true;
  });
}

function renderRecords() {
  const rows = getFilteredRecords();
  const isAdmin = session.role === "admin";
  const tbody = $("#records-tbody");

  $("#records-count").textContent = `${rows.length} kayıt gösteriliyor (toplam ${records.length})`;

  if (rows.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="11">Gösterilecek kayıt yok.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map((r) => {
      const st = statusOf(r);
      const firma = companyName(r.firma_id);
      return `<tr>
        <td>${fmtTarih(r.tarih)}</td>
        <td>${firma ? esc(firma) : "<span class='muted'>—</span>"}</td>
        <td><b>${esc(r.urun_adi)}</b></td>
        <td>${esc(r.musteri_adi) || "<span class='muted'>—</span>"}</td>
        <td class="num">${fmtPara(r.urun_fiyati)}</td>
        <td class="num">${fmtPara(r.alinan_para)}</td>
        <td class="num"><b>${fmtPara(r.kalan_para)}</b></td>
        <td><span class="badge badge-${st}">${STATUS_TEXT[st]}</span></td>
        <td>${esc(r.aciklama) || "<span class='muted'>—</span>"}</td>
        <td>${esc(r.created_by)}</td>
        <td class="td-actions">
          <button class="btn btn-outline btn-sm" data-action="edit" data-id="${r.id}">✏️</button>
          <button class="btn btn-outline btn-sm" data-action="log" data-id="${r.id}">🕓</button>
          ${isAdmin ? `<button class="btn btn-danger btn-sm" data-action="delete" data-id="${r.id}">🗑</button>` : ""}
        </td>
      </tr>`;
    })
    .join("");
}

async function onRecordsTableClick(e) {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const record = records.find((r) => r.id === btn.dataset.id);
  if (!record) return;

  if (btn.dataset.action === "edit") openEditModal(record);
  else if (btn.dataset.action === "log") openRecordHistory(record);
  else if (btn.dataset.action === "delete") deleteRecord(record);
}

// ============================================================
// DÜZENLEME
// ============================================================

function openEditModal(record) {
  editingRecord = record;
  $("#e-firma-yeni").value = "";
  $("#e-firma").value = record.firma_id || "";
  toggleNewCompany("e");
  $("#e-urun").value = record.urun_adi;
  $("#e-musteri").value = record.musteri_adi || "";
  $("#e-fiyat").value = record.urun_fiyati;
  $("#e-alinan").value = record.alinan_para;
  $("#e-kalan").value = record.kalan_para;
  $("#e-tarih").value = record.tarih;
  $("#e-aciklama").value = record.aciklama || "";

  let meta = `Oluşturan: ${record.created_by} • ${fmtZaman(record.created_at)}`;
  if (record.updated_by) meta += ` | Son düzenleyen: ${record.updated_by} • ${fmtZaman(record.updated_at)}`;
  $("#edit-meta").textContent = meta;

  $("#modal-edit").classList.remove("hidden");
}

function closeEditModal() {
  editingRecord = null;
  $("#modal-edit").classList.add("hidden");
}

async function onEditSubmit(e) {
  e.preventDefault();
  if (!editingRecord) return;

  const { fields, error } = collectForm("e");
  if (error) return toast(error, "error");

  try {
    fields.firma_id = await resolveCompanyId("e"); // gerekirse yeni firmayı oluşturur
  } catch (err) {
    return toast("Firma eklenemedi: " + firmaHatasi(err), "error");
  }

  // Sadece değişen alanları geçmişe yaz
  const oldValues = {};
  const newValues = {};
  for (const key of Object.keys(fields)) {
    const oldVal = MONEY_FIELDS.includes(key) ? Number(editingRecord[key]) : editingRecord[key] || "";
    const newVal = MONEY_FIELDS.includes(key) ? Number(fields[key]) : fields[key] || "";
    if (String(oldVal) !== String(newVal)) {
      oldValues[key] = oldVal;
      newValues[key] = newVal;
    }
  }

  if (Object.keys(newValues).length === 0) {
    closeEditModal();
    return toast("Değişiklik yapılmadı.");
  }

  try {
    await dbUpdateRecord(editingRecord.id, fields, oldValues, session.username);
    closeEditModal();
    await loadRecords();
    await loadCompanies();
    renderCurrentView();
    toast("✅ Kayıt güncellendi.");
  } catch (err) {
    toast("Güncellenemedi: " + firmaHatasi(err), "error");
  }
}

// ============================================================
// SİLME (sadece admin)
// ============================================================

async function deleteRecord(record) {
  if (session.role !== "admin") return toast("Silme yetkiniz yok.", "error");

  const ok = await confirmDialog(
    `"${record.urun_adi}" kaydı kalıcı olarak silinecek. Bu işlem geri alınamaz.`
  );
  if (!ok) return;

  try {
    const snapshot = {
      firma_id: record.firma_id,
      urun_adi: record.urun_adi,
      musteri_adi: record.musteri_adi,
      urun_fiyati: record.urun_fiyati,
      alinan_para: record.alinan_para,
      kalan_para: record.kalan_para,
      tarih: record.tarih,
      aciklama: record.aciklama,
    };
    await dbDeleteRecord(record.id, snapshot, session.username);
    await loadRecords();
    renderCurrentView();
    toast("🗑 Kayıt silindi.");
  } catch (err) {
    toast("Silinemedi: " + (err.message || err), "error");
  }
}

// ============================================================
// STOK TAKİBİ
// ============================================================

const fmtMiktar = (n) => new Intl.NumberFormat(LOCALE).format(Number(n) || 0);

async function renderStok() {
  try {
    [stockItems, stockMoves] = await Promise.all([dbFetchStockItems(), dbFetchStockMoves()]);
  } catch (e) {
    return toast("Stok verileri yüklenemedi: " + (e.message || e), "error");
  }
  fillStockSelect();
  renderStockLevels();
  renderStockMoves();
}

function fillStockSelect() {
  const sel = $("#s-urun");
  const current = sel.value;
  sel.innerHTML =
    '<option value="">Seçin...</option>' +
    stockItems.map((i) => `<option value="${i.id}">${esc(i.urun_adi)}</option>`).join("") +
    '<option value="__yeni__">➕ Yeni ürün ekle...</option>';
  sel.value = current;
  toggleYeniUrun();
}

function toggleYeniUrun() {
  $("#s-yeni-wrap").classList.toggle("hidden", $("#s-urun").value !== "__yeni__");
}

// Her ürün için toplam giriş/çıkış ve mevcut stok hesabı
function stockLevels() {
  const map = {};
  for (const i of stockItems) map[i.id] = { item: i, giris: 0, cikis: 0 };
  for (const m of stockMoves) {
    if (!map[m.item_id]) continue;
    map[m.item_id][m.tip === "giris" ? "giris" : "cikis"] += Number(m.miktar) || 0;
  }
  return Object.values(map);
}

function renderStockLevels() {
  const rows = stockLevels();
  const isAdmin = session.role === "admin";
  const tbody = $("#stok-tbody");

  if (!rows.length) {
    tbody.innerHTML =
      '<tr class="empty-row"><td colspan="5">Henüz stok ürünü yok. Yukarıdaki formdan ilk girişi yapın.</td></tr>';
    return;
  }

  tbody.innerHTML = rows
    .map(({ item, giris, cikis }) => {
      const mevcut = giris - cikis;
      const cls = mevcut > 0 ? "stok-poz" : "stok-neg";
      return `<tr>
        <td><b>${esc(item.urun_adi)}</b></td>
        <td class="num">${fmtMiktar(giris)}</td>
        <td class="num">${fmtMiktar(cikis)}</td>
        <td class="num ${cls}">${fmtMiktar(mevcut)}</td>
        <td class="td-actions">${isAdmin ? `<button class="btn btn-danger btn-sm" data-saction="delitem" data-id="${item.id}">🗑</button>` : ""}</td>
      </tr>`;
    })
    .join("");
}

function renderStockMoves() {
  const isAdmin = session.role === "admin";
  const tbody = $("#stok-moves-tbody");

  if (!stockMoves.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="9">Henüz hareket yok.</td></tr>';
    return;
  }

  tbody.innerHTML = stockMoves
    .map((m) => {
      const tipBadge =
        m.tip === "giris"
          ? '<span class="badge badge-odendi">📥 Giriş</span>'
          : '<span class="badge badge-alinmadi">📤 Çıkış</span>';
      const urun = m.stock_items ? m.stock_items.urun_adi : "";
      const birimFiyat = m.birim_fiyat != null ? fmtPara(m.birim_fiyat) : "<span class='muted'>—</span>";
      const tutar = m.birim_fiyat != null ? fmtPara(Number(m.birim_fiyat) * Number(m.miktar)) : "<span class='muted'>—</span>";
      return `<tr>
        <td>${fmtTarih(m.tarih)}</td>
        <td><b>${esc(urun)}</b></td>
        <td>${tipBadge}</td>
        <td class="num">${fmtMiktar(m.miktar)}</td>
        <td class="num">${birimFiyat}</td>
        <td class="num">${tutar}</td>
        <td>${esc(m.aciklama) || "<span class='muted'>—</span>"}</td>
        <td>${esc(m.created_by)}</td>
        <td class="td-actions">${isAdmin ? `<button class="btn btn-danger btn-sm" data-saction="delmove" data-id="${m.id}">🗑</button>` : ""}</td>
      </tr>`;
    })
    .join("");
}

async function onStockSubmit(e) {
  e.preventDefault();
  const selVal = $("#s-urun").value;
  const tip = $("#s-tip").value;
  const miktar = parseFloat($("#s-miktar").value);
  const fiyatStr = $("#s-fiyat").value.trim();
  const tarih = $("#s-tarih").value || todayISO();
  const aciklama = $("#s-aciklama").value.trim();

  if (!selVal) return toast("Ürün seçin.", "error");
  if (isNaN(miktar) || miktar <= 0) return toast("Miktar 0'dan büyük olmalı.", "error");

  // Birim fiyat tamamen isteğe bağlı; girilirse negatif olamaz.
  let birimFiyat = null;
  if (fiyatStr !== "") {
    birimFiyat = parseFloat(fiyatStr);
    if (isNaN(birimFiyat) || birimFiyat < 0) return toast("Birim fiyat negatif olamaz.", "error");
  }

  try {
    let itemId = selVal;
    if (selVal === "__yeni__") {
      const ad = $("#s-yeni").value.trim();
      if (!ad) return toast("Yeni ürünün adını yazın.", "error");
      const item = await dbAddStockItem(ad, session.username);
      itemId = item.id;
    }

    // Çıkışta stok yeterliliği kontrolü
    if (tip === "cikis") {
      const lvl = stockLevels().find((r) => r.item.id === itemId);
      const mevcut = lvl ? lvl.giris - lvl.cikis : 0;
      if (miktar > mevcut) {
        return toast(`Stokta yeterli ürün yok. Mevcut: ${fmtMiktar(mevcut)}`, "error");
      }
    }

    await dbAddStockMove(
      { item_id: itemId, tip, miktar, birim_fiyat: birimFiyat, tarih, aciklama },
      session.username
    );
    $("#form-stok").reset();
    $("#s-tarih").value = todayISO();
    toggleYeniUrun();
    await renderStok();
    toast(tip === "giris" ? "📥 Giriş kaydedildi." : "📤 Çıkış kaydedildi.");
  } catch (err) {
    toast(err.message || "Kaydedilemedi.", "error");
  }
}

async function onStockTablesClick(e) {
  const btn = e.target.closest("button[data-saction]");
  if (!btn) return;
  if (session.role !== "admin") return;

  if (btn.dataset.saction === "delmove") {
    const ok = await confirmDialog("Bu stok hareketi silinecek. Emin misiniz?");
    if (!ok) return;
    try {
      await dbDeleteStockMove(btn.dataset.id);
      await renderStok();
      toast("🗑 Hareket silindi.");
    } catch (err) {
      toast(err.message || "Silinemedi.", "error");
    }
  } else if (btn.dataset.saction === "delitem") {
    const item = stockItems.find((i) => i.id === btn.dataset.id);
    const ok = await confirmDialog(
      `"${item ? item.urun_adi : ""}" ürünü ve TÜM stok hareketleri silinecek. Emin misiniz?`
    );
    if (!ok) return;
    try {
      await dbDeleteStockItem(btn.dataset.id);
      await renderStok();
      toast("🗑 Ürün ve hareketleri silindi.");
    } catch (err) {
      toast(err.message || "Silinemedi.", "error");
    }
  }
}

// ============================================================
// FİRMALAR
// ============================================================

async function renderFirmalar() {
  await loadCompanies();
  renderFirmaTable();
}

// Her firma için kayıt sayısı ve para toplamları (kayıtlardan hesaplanır)
function companyTotals() {
  const map = {};
  for (const c of companies) map[c.id] = { firma: c, adet: 0, fiyat: 0, alinan: 0, kalan: 0 };
  for (const r of records) {
    const s = map[r.firma_id];
    if (!s) continue;
    s.adet++;
    s.fiyat += Number(r.urun_fiyati) || 0;
    s.alinan += Number(r.alinan_para) || 0;
    s.kalan += Number(r.kalan_para) || 0;
  }
  return Object.values(map);
}

function renderFirmaTable() {
  const tbody = $("#firmalar-tbody");
  const isAdmin = session.role === "admin";

  if (!companiesReady) {
    $("#firmalar-count").textContent = "";
    tbody.innerHTML =
      '<tr class="empty-row"><td colspan="7">Firma tablosu veritabanında bulunamadı. Supabase → SQL Editor\'de <b>db/upgrade-firmalar.sql</b> dosyasını bir kez çalıştırın, sonra sayfayı yenileyin.</td></tr>';
    return;
  }

  const rows = companyTotals();
  $("#firmalar-count").textContent = rows.length ? `${rows.length} firma kayıtlı` : "";

  if (!rows.length) {
    tbody.innerHTML =
      '<tr class="empty-row"><td colspan="7">Henüz firma eklenmedi. Yukarıdaki formdan ilk firmayı ekleyin.</td></tr>';
    return;
  }

  tbody.innerHTML = rows
    .map(({ firma, adet, fiyat, alinan, kalan }) => {
      const kalanCls = kalan > 0 ? "stok-neg" : "stok-poz";
      return `<tr>
        <td><button class="link-btn" data-faction="open" data-id="${firma.id}"><b>${esc(firma.firma_adi)}</b></button></td>
        <td class="num">${adet}</td>
        <td class="num">${fmtPara(fiyat)}</td>
        <td class="num">${fmtPara(alinan)}</td>
        <td class="num ${kalanCls}">${fmtPara(kalan)}</td>
        <td>${esc(firma.created_by) || "<span class='muted'>—</span>"}</td>
        <td class="td-actions">
          <button class="btn btn-primary btn-sm" data-faction="open" data-id="${firma.id}">📂 Aç</button>
          <button class="btn btn-outline btn-sm" data-faction="edit" data-id="${firma.id}">✏️ Düzenle</button>
          ${isAdmin ? `<button class="btn btn-danger btn-sm" data-faction="delete" data-id="${firma.id}">🗑 Sil</button>` : ""}
        </td>
      </tr>`;
    })
    .join("");
}

async function onFirmaSubmit(e) {
  e.preventDefault();
  const ad = $("#fi-ad").value.trim();
  if (!ad) return toast("Firma adı boş olamaz.", "error");

  try {
    await dbAddCompany(ad, session.username);
    $("#form-firma").reset();
    await loadCompanies();
    renderFirmaTable();
    toast(`✅ "${ad}" firması eklendi.`);
  } catch (err) {
    toast("Firma eklenemedi: " + firmaHatasi(err), "error");
  }
}

async function onFirmalarTableClick(e) {
  const btn = e.target.closest("button[data-faction]");
  if (!btn) return;
  const firma = companies.find((c) => c.id === btn.dataset.id);
  if (!firma) return;

  if (btn.dataset.faction === "open") {
    openFirmaDetay(firma);
  } else if (btn.dataset.faction === "edit") {
    openEditFirma(firma);
  } else if (btn.dataset.faction === "delete") {
    if (session.role !== "admin") return toast("Silme yetkiniz yok.", "error");
    const bagli = records.filter((r) => r.firma_id === firma.id).length;
    const ok = await confirmDialog(
      `"${firma.firma_adi}" firması silinecek.` +
        (bagli
          ? ` Bu firmaya bağlı ${bagli} kayıt SİLİNMEZ, sadece firma bilgisi boşalır.`
          : "")
    );
    if (!ok) return;
    try {
      await dbDeleteCompany(firma.id);
      await Promise.all([loadRecords(), loadCompanies()]);
      renderFirmaTable();
      toast("🗑 Firma silindi.");
    } catch (err) {
      toast("Silinemedi: " + firmaHatasi(err), "error");
    }
  }
}

// ---------- FİRMA SAYFASI (bir firmanın kendi ürünleri) ----------

// Açık firmaya ait kayıtlar (tarih sırası dbFetchRecords'tan gelir)
function firmaRecords() {
  return records.filter((r) => r.firma_id === openCompanyId);
}

function openFirmaDetay(firma) {
  openCompanyId = firma.id;
  // Formdaki firma sabittir: gizli listeye yalnızca bu firma yazılır
  const sel = $("#fd-firma");
  sel.innerHTML = `<option value="${esc(firma.id)}">${esc(firma.firma_adi)}</option>`;
  $("#form-firma-detay").reset();
  sel.value = firma.id;
  $("#fd-tarih").value = todayISO();
  showView("firma-detay");
}

function renderFirmaDetay() {
  const firma = companies.find((c) => c.id === openCompanyId);
  if (!firma) return showView("firmalar"); // firma silinmiş/bulunamadıysa listeye dön

  $("#fd-baslik").textContent = `🏢 ${firma.firma_adi}`;
  $("#fd-form-baslik").textContent = `"${firma.firma_adi}" Firmasına Ürün Ekle`;
  $("#fd-firma").innerHTML = `<option value="${esc(firma.id)}">${esc(firma.firma_adi)}</option>`;

  const rows = firmaRecords();
  let fiyat = 0, alinan = 0, kalan = 0, borclu = 0;
  for (const r of rows) {
    fiyat += Number(r.urun_fiyati) || 0;
    alinan += Number(r.alinan_para) || 0;
    kalan += Number(r.kalan_para) || 0;
    if ((Number(r.kalan_para) || 0) > 0) borclu++;
  }

  $("#fd-stat-count").textContent = rows.length;
  $("#fd-stat-price").textContent = fmtPara(fiyat);
  $("#fd-stat-paid").textContent = fmtPara(alinan);
  $("#fd-stat-due").textContent = fmtPara(kalan);
  $("#fd-stat-debt").textContent = borclu;
  $("#fd-count").textContent = rows.length ? `${rows.length} ürün / kayıt` : "";

  const isAdmin = session.role === "admin";
  const tbody = $("#fd-tbody");

  if (!rows.length) {
    tbody.innerHTML =
      '<tr class="empty-row"><td colspan="10">Bu firmaya ait ürün yok. Yukarıdaki formdan ilk ürünü ekleyin.</td></tr>';
    return;
  }

  tbody.innerHTML = rows
    .map((r) => {
      const st = statusOf(r);
      return `<tr>
        <td>${fmtTarih(r.tarih)}</td>
        <td><b>${esc(r.urun_adi)}</b></td>
        <td>${esc(r.musteri_adi) || "<span class='muted'>—</span>"}</td>
        <td class="num">${fmtPara(r.urun_fiyati)}</td>
        <td class="num">${fmtPara(r.alinan_para)}</td>
        <td class="num"><b>${fmtPara(r.kalan_para)}</b></td>
        <td><span class="badge badge-${st}">${STATUS_TEXT[st]}</span></td>
        <td>${esc(r.aciklama) || "<span class='muted'>—</span>"}</td>
        <td>${esc(r.created_by)}</td>
        <td class="td-actions">
          <button class="btn btn-outline btn-sm" data-action="edit" data-id="${r.id}">✏️</button>
          <button class="btn btn-outline btn-sm" data-action="log" data-id="${r.id}">🕓</button>
          ${isAdmin ? `<button class="btn btn-danger btn-sm" data-action="delete" data-id="${r.id}">🗑</button>` : ""}
        </td>
      </tr>`;
    })
    .join("");
}

// Firma sayfasından ürün ekleme (kayıt otomatik olarak bu firmaya bağlanır)
async function onFirmaDetaySubmit(e) {
  e.preventDefault();
  const firma = companies.find((c) => c.id === openCompanyId);
  if (!firma) return toast("Firma bulunamadı, listeye dönün.", "error");

  const { fields, error } = collectForm("fd");
  if (error) return toast(error, "error");
  fields.firma_id = openCompanyId;

  // Yeni Kayıt sayfasındaki gibi: yedek indirme tıklamayla eş zamanlı tetiklenir
  if (AUTO_BACKUP_ON_ADD) {
    autoBackupSnapshot([
      ...records,
      { ...fields, _firma_adi: firma.firma_adi, created_by: session.username },
    ]);
  }

  try {
    await dbAddRecord(fields, session.username);
    $("#form-firma-detay").reset();
    $("#fd-firma").value = openCompanyId;
    $("#fd-tarih").value = todayISO();
    await loadRecords();
    renderFirmaDetay();
    toast(
      `✅ Ürün "${firma.firma_adi}" firmasına eklendi.` +
        (AUTO_BACKUP_ON_ADD ? " 💾 Yedek indirildi." : "")
    );
  } catch (err) {
    toast("Kayıt eklenemedi: " + firmaHatasi(err), "error");
  }
}

function openEditFirma(firma) {
  editingCompany = firma;
  $("#ef-ad").value = firma.firma_adi;
  $("#modal-edit-firma").classList.remove("hidden");
}

function closeEditFirma() {
  editingCompany = null;
  $("#modal-edit-firma").classList.add("hidden");
}

async function onEditFirmaSave() {
  if (!editingCompany) return;
  const ad = $("#ef-ad").value.trim();
  if (!ad) return toast("Firma adı boş olamaz.", "error");
  if (ad === editingCompany.firma_adi) {
    closeEditFirma();
    return toast("Değişiklik yapılmadı.");
  }

  try {
    await dbUpdateCompany(editingCompany.id, ad);
    closeEditFirma();
    await loadCompanies();
    renderCurrentView(); // firma listesi ya da açık firma sayfası yenilenir
    toast(`✅ Firma adı "${ad}" olarak güncellendi.`);
  } catch (err) {
    toast("Güncellenemedi: " + firmaHatasi(err), "error");
  }
}

// ============================================================
// İŞLEM GEÇMİŞİ
// ============================================================

function formatDiffValue(key, val) {
  if (val === null || val === undefined || val === "") return "—";
  if (key === "firma_id") return companyName(val) || "—";
  if (MONEY_FIELDS.includes(key)) return fmtPara(val);
  if (key === "tarih") return fmtTarih(val);
  return String(val);
}

function renderHistoryItem(h) {
  const actionBadge = {
    create: '<span class="badge badge-create">Eklendi</span>',
    update: '<span class="badge badge-update">Düzenlendi</span>',
    delete: '<span class="badge badge-delete">Silindi</span>',
  }[h.action];

  const name = (h.new_values && h.new_values.urun_adi) || (h.old_values && h.old_values.urun_adi) || "";

  let detail = "";
  if (h.action === "update" && h.new_values) {
    const lines = Object.keys(h.new_values)
      .filter((k) => FIELD_LABELS[k])
      .map(
        (k) =>
          `<li>${FIELD_LABELS[k]}: <s>${esc(formatDiffValue(k, h.old_values?.[k]))}</s> → <b>${esc(formatDiffValue(k, h.new_values[k]))}</b></li>`
      );
    if (lines.length) detail = `<ul class="history-diff">${lines.join("")}</ul>`;
  } else if (h.action === "create" && h.new_values) {
    detail = `<div class="history-diff">Fiyat: ${esc(formatDiffValue("urun_fiyati", h.new_values.urun_fiyati))}, Alınan: ${esc(formatDiffValue("alinan_para", h.new_values.alinan_para))}, Kalan: ${esc(formatDiffValue("kalan_para", h.new_values.kalan_para))}</div>`;
  } else if (h.action === "delete" && h.old_values) {
    detail = `<div class="history-diff">Silinen kayıt: ${esc(h.old_values.musteri_adi || "")} • Fiyat: ${esc(formatDiffValue("urun_fiyati", h.old_values.urun_fiyati))}</div>`;
  }

  return `<div class="history-item">
    <div class="history-head">
      ${actionBadge}
      <b>${esc(name)}</b>
      <span class="muted">${esc(h.changed_by)} • ${fmtZaman(h.changed_at)}</span>
    </div>
    ${detail}
  </div>`;
}

async function renderHistoryPage() {
  const el = $("#history-list");
  el.innerHTML = '<p class="muted">Yükleniyor...</p>';
  try {
    const items = await dbFetchHistory();
    el.innerHTML = items.length
      ? items.map(renderHistoryItem).join("")
      : '<p class="muted">Henüz işlem geçmişi yok.</p>';
  } catch (err) {
    el.innerHTML = '<p class="muted">Geçmiş yüklenemedi.</p>';
  }
}

async function openRecordHistory(record) {
  $("#history-title").textContent = `Kayıt Geçmişi: ${record.urun_adi}`;
  const el = $("#record-history-list");
  el.innerHTML = '<p class="muted">Yükleniyor...</p>';
  $("#modal-history").classList.remove("hidden");
  try {
    const items = await dbFetchHistory(record.id);
    el.innerHTML = items.length
      ? items.map(renderHistoryItem).join("")
      : '<p class="muted">Bu kayıt için geçmiş bulunamadı.</p>';
  } catch {
    el.innerHTML = '<p class="muted">Geçmiş yüklenemedi.</p>';
  }
}

// ============================================================
// KULLANICI YÖNETİMİ (sadece admin)
// ============================================================

function renderUsers() {
  const tbody = $("#users-tbody");
  tbody.innerHTML = usersList
    .map((u) => {
      const roleBadge =
        u.role === "admin"
          ? '<span class="badge badge-admin">Admin</span>'
          : '<span class="badge badge-kullanici">Kullanıcı</span>';
      const durum = u.approved
        ? '<span class="badge badge-odendi">Aktif</span>'
        : '<span class="badge badge-alinmadi">Engelli / Onay bekliyor</span>';
      const isSelf = u.id === session.id;
      const mailsiz = (u.email || "").endsWith(FAKE_MAIL_DOMAIN);
      return `<tr>
        <td><b>${esc(u.username)}</b>${isSelf ? ' <span class="muted">(siz)</span>' : ""}</td>
        <td>${mailsiz ? "<span class='muted'>—</span>" : esc(u.email)}</td>
        <td>${roleBadge}</td>
        <td>${durum}</td>
        <td>${fmtZaman(u.created_at)}</td>
        <td class="td-actions">
          ${mailsiz ? "" : `<button class="btn btn-outline btn-sm" data-uaction="resetmail" data-id="${u.id}">📧 Şifre maili</button>`}
          <button class="btn btn-outline btn-sm" data-uaction="edit" data-id="${u.id}">✏️ Düzenle</button>
          ${
            isSelf
              ? ""
              : u.approved
                ? `<button class="btn btn-danger btn-sm" data-uaction="block" data-id="${u.id}">⛔ Engelle</button>`
                : `<button class="btn btn-primary btn-sm" data-uaction="approve" data-id="${u.id}">✅ Onayla</button>`
          }
          ${isSelf ? "" : `<button class="btn btn-danger btn-sm" data-uaction="delete" data-id="${u.id}">🗑 Sil</button>`}
        </td>
      </tr>`;
    })
    .join("");
}

async function onUserSubmit(e) {
  e.preventDefault();
  let email = $("#u-email").value.trim();
  const username = $("#u-username").value.trim();
  const password = $("#u-password").value;
  const role = $("#u-role").value;

  if (!username) return toast("Kullanıcı adı boş olamaz.", "error");
  if (email && !email.includes("@")) return toast("E-posta adresi hatalı görünüyor.", "error");

  // E-posta boş bırakılabilir: kullanıcı adından otomatik bir adres üretilir.
  // (Bu üyeler "Şifremi unuttum" maili alamaz; şifrelerini admin belirler.)
  if (!email) {
    const slug = username
      .toLowerCase()
      .replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i")
      .replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u")
      .replace(/[^a-z0-9]/g, "");
    if (!slug) return toast("Kullanıcı adında en az bir harf veya rakam olmalı.", "error");
    email = slug + FAKE_MAIL_DOMAIN;
  }
  if (password.length < 6) return toast("Şifre en az 6 karakter olmalı.", "error");
  if (password !== $("#u-password2").value) {
    return toast("Şifreler birbirini tutmuyor. İki alana da aynı şifreyi yazın.", "error");
  }

  try {
    await dbAddUser(email, password, username, role);
    $("#form-user").reset();
    await loadUsers();
    renderUsers();
    toast(`✅ "${username}" üyesi eklendi. Belirlediğiniz şifreyi kendisine iletin.`);
  } catch (err) {
    toast(err.message || "Üye eklenemedi.", "error");
  }
}

async function onUsersTableClick(e) {
  const btn = e.target.closest("button[data-uaction]");
  if (!btn) return;
  const user = usersList.find((u) => u.id === btn.dataset.id);
  if (!user) return;

  if (btn.dataset.uaction === "resetmail") {
    try {
      await authSendResetMail(user.email);
      toast(`📧 Şifre yenileme maili "${user.email}" adresine gönderildi.`);
    } catch (err) {
      toast(err.message || "Mail gönderilemedi.", "error");
    }
  } else if (btn.dataset.uaction === "block") {
    // Son aktif admin engellenmesin, sistem kilitlenmesin
    const adminCount = usersList.filter((u) => u.role === "admin" && u.approved).length;
    if (user.role === "admin" && adminCount <= 1) {
      return toast("Son aktif admin engellenemez.", "error");
    }
    const ok = await confirmDialog(
      `"${user.username}" artık giriş yapamayacak. Emin misiniz?`,
      "Evet, Engelle"
    );
    if (!ok) return;
    try {
      await dbSetApproved(user.id, false);
      await loadUsers();
      renderUsers();
      toast(`⛔ "${user.username}" engellendi.`);
    } catch (err) {
      toast("İşlem yapılamadı: " + (err.message || err), "error");
    }
  } else if (btn.dataset.uaction === "approve") {
    try {
      await dbSetApproved(user.id, true);
      await loadUsers();
      renderUsers();
      toast(`✅ "${user.username}" onaylandı, artık giriş yapabilir.`);
    } catch (err) {
      toast("İşlem yapılamadı: " + (err.message || err), "error");
    }
  } else if (btn.dataset.uaction === "edit") {
    openEditUser(user);
  } else if (btn.dataset.uaction === "delete") {
    // Son aktif admin silinmesin, sistem kilitlenmesin
    const adminCount = usersList.filter((u) => u.role === "admin" && u.approved).length;
    if (user.role === "admin" && adminCount <= 1) {
      return toast("Son aktif admin silinemez.", "error");
    }
    const ok = await confirmDialog(
      `"${user.username}" kalıcı olarak silinecek, bir daha giriş yapamayacak. Emin misiniz?`,
      "Evet, Sil"
    );
    if (!ok) return;
    try {
      await dbDeleteUser(user.id);
      await loadUsers();
      renderUsers();
      toast(`🗑 "${user.username}" silindi.`);
    } catch (err) {
      toast("Silinemedi: " + (err.message || err), "error");
    }
  }
}

function openEditUser(user) {
  editingUser = user;
  $("#eu-username").value = user.username;
  $("#eu-role").value = user.role;
  $("#modal-edit-user").classList.remove("hidden");
}

function closeEditUser() {
  editingUser = null;
  $("#modal-edit-user").classList.add("hidden");
}

async function onEditUserSave() {
  if (!editingUser) return;
  const username = $("#eu-username").value.trim();
  const role = $("#eu-role").value;
  if (!username) return toast("Kullanıcı adı boş olamaz.", "error");

  // Son aktif admin, admin olmayan bir role düşürülmesin
  if (editingUser.role === "admin" && role !== "admin") {
    const adminCount = usersList.filter((u) => u.role === "admin" && u.approved).length;
    if (adminCount <= 1) return toast("Son aktif admin'in rolü değiştirilemez.", "error");
  }

  try {
    await dbUpdateUser(editingUser.id, { username, role });
    closeEditUser();
    await loadUsers();
    renderUsers();
    toast(`✅ "${username}" güncellendi.`);
  } catch (err) {
    toast(err.message || "Güncellenemedi.", "error");
  }
}

// ============================================================
// DIŞA AKTARMA (CSV / Excel)
// ============================================================

// Dosya adı için Türkçe karakterleri sadeleştirir
function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i")
    .replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Liste verilmezse ekrandaki filtreye uyan kayıtlar aktarılır
function exportRows(list) {
  return (list || getFilteredRecords()).map((r) => ({
    Tarih: fmtTarih(r.tarih),
    Firma: companyName(r.firma_id),
    "Ürün Adı": r.urun_adi,
    "Müşteri Adı": r.musteri_adi || "",
    "Ürün Fiyatı": Number(r.urun_fiyati),
    "Alınan Para": Number(r.alinan_para),
    "Kalan Para": Number(r.kalan_para),
    "Ödeme Durumu": STATUS_TEXT[statusOf(r)],
    Açıklama: r.aciklama || "",
    Ekleyen: r.created_by,
  }));
}

function exportCSV(list, adEki) {
  const rows = exportRows(list);
  if (!rows.length) return toast("Aktarılacak kayıt yok.", "error");

  const headers = Object.keys(rows[0]);
  const quote = (v) => `"${String(v).replace(/"/g, '""')}"`;
  // Noktalı virgül + BOM: Türkçe Excel'de doğrudan doğru açılır
  const csv =
    "\uFEFF" +
    headers.map(quote).join(";") +
    "\n" +
    rows.map((r) => headers.map((h) => quote(r[h])).join(";")).join("\n");

  const ek = adEki ? slugify(adEki) + "-" : "";
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `urun-takip-${ek}${todayISO()}.csv`);
  toast("⬇ CSV dosyası indirildi.");
}

function exportExcel(list, adEki) {
  if (typeof XLSX === "undefined") {
    return toast("Excel kütüphanesi yüklenemedi, CSV kullanın.", "error");
  }
  const rows = exportRows(list);
  if (!rows.length) return toast("Aktarılacak kayıt yok.", "error");

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Kayıtlar");
  const ek = adEki ? slugify(adEki) + "-" : "";
  XLSX.writeFile(wb, `urun-takip-${ek}${todayISO()}.xlsx`);
  toast("⬇ Excel dosyası indirildi.");
}

function exportPDF(list, adEki) {
  if (typeof window.jspdf === "undefined") {
    return toast("PDF kütüphanesi yüklenemedi, CSV/Excel kullanın.", "error");
  }
  const rows = exportRows(list);
  if (!rows.length) return toast("Aktarılacak kayıt yok.", "error");

  const MONEY_COLS = ["Ürün Fiyatı", "Alınan Para", "Kalan Para"];
  const headers = Object.keys(rows[0]);
  const body = rows.map((r) =>
    headers.map((h) => (MONEY_COLS.includes(h) ? fmtPara(r[h]) : String(r[h] ?? "")))
  );

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14);
  doc.text(adEki ? `Ürün Takip Paneli - ${adEki}` : "Ürün Takip Paneli - Kayıt Listesi", 14, 15);
  doc.setFontSize(9);
  doc.text(new Date().toLocaleString(LOCALE), 14, 21);
  doc.autoTable({
    head: [headers],
    body,
    startY: 26,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 58, 95] },
  });

  doc.save(`urun-takip-${adEki ? slugify(adEki) + "-" : ""}${todayISO()}.pdf`);
  toast("⬇ PDF dosyası indirildi.");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// GİRİŞ / ÇIKIŞ
// ============================================================

async function onLoginSubmit(e) {
  e.preventDefault();
  const email = $("#login-email").value.trim();
  const password = $("#login-password").value;
  const errBox = $("#login-error");
  const btn = $("#btn-login");

  errBox.classList.add("hidden");
  btn.disabled = true;
  btn.textContent = "Giriş yapılıyor...";

  try {
    const user = await authLogin(email, password);
    if (!user) {
      errBox.textContent = "Kullanıcı adı/e-posta veya şifre hatalı.";
      errBox.classList.remove("hidden");
      return;
    }
    session = user;
    $("#login-form").reset();
    await enterApp();
  } catch (err) {
    errBox.textContent = err.message || "Bağlantı hatası oluştu.";
    errBox.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Giriş Yap";
  }
}

async function logout() {
  await authLogout();
  session = null;
  clearInterval(pollTimer);
  location.reload();
}

// ============================================================
// UYGULAMA OLARAK YÜKLEME (telefonda/bilgisayarda "app gibi")
// ============================================================

let installPrompt = null; // tarayıcının kurulum teklifi (Android/Chrome/Edge)

// Ana ekrandan (uygulama penceresinde) mi açıldı?
const uygulamaModunda = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  window.matchMedia("(display-mode: fullscreen)").matches ||
  window.navigator.standalone === true;

const iosCihaz = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPad iOS 13+

// Yükleme butonları: zaten uygulama olarak açıldıysa gizli kalır
function updateInstallButtons() {
  const goster = !uygulamaModunda() && (installPrompt !== null || iosCihaz());
  ["#btn-install", "#btn-install-login"].forEach((sel) => {
    const el = $(sel);
    if (el) el.classList.toggle("hidden", !goster);
  });
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); // kendi butonumuzla soracağız
  installPrompt = e;
  updateInstallButtons();
});

window.addEventListener("appinstalled", () => {
  installPrompt = null;
  updateInstallButtons();
  toast("✅ Uygulama cihaza yüklendi. Artık ana ekrandan açabilirsiniz.");
});

async function onInstallClick() {
  if (installPrompt) {
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    installPrompt = null;
    updateInstallButtons();
    if (outcome === "accepted") toast("📲 Uygulama yükleniyor...");
    return;
  }
  // iPhone/iPad: Safari'de otomatik kurulum penceresi yok, elle eklenir
  await confirmDialog(
    'Safari\'de ekranın altındaki Paylaş düğmesine (kutudan çıkan ok) dokunun, açılan listeyi kaydırıp "Ana Ekrana Ekle"yi seçin. Uygulama ana ekranınıza kendi simgesiyle eklenir ve tam ekran açılır.',
    "Anladım",
    "📲 Ana Ekrana Ekle"
  );
}

// Dosyaları cihazda saklayan service worker (çevrimdışı açılış + hızlı yükleme).
// Veriler saklanmaz; ayrıntı için sw.js dosyasına bakın.
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker
    .register("sw.js")
    .catch((err) => console.warn("Service worker kaydedilemedi:", err));
}

// ============================================================
// OLAY BAĞLAMA
// ============================================================

function wireEvents() {
  $("#login-form").addEventListener("submit", onLoginSubmit);
  $("#btn-forgot").addEventListener("click", async () => {
    const email = $("#login-email").value.trim();
    if (!email.includes("@")) {
      return toast(
        "Şifre sıfırlama maili yalnızca e-postalı üyelerde çalışır. Kullanıcı adıyla giriş yapıyorsanız yöneticinizden yeni şifre isteyin.",
        "error"
      );
    }
    try {
      await authSendResetMail(email);
      toast("📧 Yenileme bağlantısı e-postanıza gönderildi. Spam klasörünü de kontrol edin.");
    } catch (err) {
      toast(err.message || "Mail gönderilemedi.", "error");
    }
  });
  $("#btn-logout").addEventListener("click", logout);

  // "Uygulamayı yükle" butonları (menüde ve giriş ekranında)
  $("#btn-install").addEventListener("click", onInstallClick);
  $("#btn-install-login").addEventListener("click", onInstallClick);
  updateInstallButtons();
  $("#btn-menu").addEventListener("click", () =>
    setSidebar(!$("#sidebar").classList.contains("open"))
  );
  $("#sidebar-backdrop").addEventListener("click", () => setSidebar(false));

  $$(".nav-link").forEach((link) =>
    link.addEventListener("click", () => showView(link.dataset.view))
  );

  // Stok
  $("#form-stok").addEventListener("submit", onStockSubmit);
  $("#s-urun").addEventListener("change", toggleYeniUrun);
  $("#view-stok").addEventListener("click", onStockTablesClick);

  // Firmalar
  $("#form-firma").addEventListener("submit", onFirmaSubmit);
  $("#firmalar-tbody").addEventListener("click", onFirmalarTableClick);
  $("#btn-edit-firma-save").addEventListener("click", onEditFirmaSave);
  $("#btn-edit-firma-cancel").addEventListener("click", closeEditFirma);
  $("#n-firma").addEventListener("change", () => toggleNewCompany("n"));
  $("#e-firma").addEventListener("change", () => toggleNewCompany("e"));

  // Firma sayfası (bir firmanın kendi ürünleri)
  $("#form-firma-detay").addEventListener("submit", onFirmaDetaySubmit);
  attachAutoKalan("fd");
  $("#fd-tbody").addEventListener("click", onRecordsTableClick);
  $("#btn-fd-back").addEventListener("click", () => showView("firmalar"));
  $("#btn-fd-rename").addEventListener("click", () => {
    const firma = companies.find((c) => c.id === openCompanyId);
    if (firma) openEditFirma(firma);
  });
  const acikFirmaAdi = () => companyName(openCompanyId) || "firma";
  $("#btn-fd-csv").addEventListener("click", () => exportCSV(firmaRecords(), acikFirmaAdi()));
  $("#btn-fd-xlsx").addEventListener("click", () => exportExcel(firmaRecords(), acikFirmaAdi()));
  $("#btn-fd-pdf").addEventListener("click", () => exportPDF(firmaRecords(), acikFirmaAdi()));

  // Yeni kayıt
  $("#form-new").addEventListener("submit", onNewSubmit);
  attachAutoKalan("n");

  // Kayıt listesi
  $("#records-tbody").addEventListener("click", onRecordsTableClick);
  $("#btn-refresh").addEventListener("click", async () => {
    await refreshData();
    toast("🔄 Liste yenilendi.");
  });
  ["#f-search", "#f-date-from", "#f-date-to", "#f-durum", "#f-user", "#f-firma"].forEach((sel) =>
    $(sel).addEventListener("input", renderRecords)
  );
  $("#btn-clear-filters").addEventListener("click", () => {
    $("#f-search").value = "";
    $("#f-date-from").value = "";
    $("#f-date-to").value = "";
    $("#f-durum").value = "";
    $("#f-user").value = "";
    $("#f-firma").value = "";
    renderRecords();
  });
  $("#btn-export-csv").addEventListener("click", () => exportCSV());
  $("#btn-export-xlsx").addEventListener("click", () => exportExcel());
  $("#btn-export-pdf").addEventListener("click", () => exportPDF());

  // Düzenleme
  $("#form-edit").addEventListener("submit", onEditSubmit);
  $("#btn-edit-cancel").addEventListener("click", closeEditModal);
  attachAutoKalan("e");

  // Onay penceresi
  $("#btn-confirm-ok").addEventListener("click", () => closeConfirm(true));
  $("#btn-confirm-cancel").addEventListener("click", () => closeConfirm(false));

  // Kayıt geçmişi penceresi
  $("#btn-history-close").addEventListener("click", () =>
    $("#modal-history").classList.add("hidden")
  );

  // Şifre penceresi
  $("#btn-password-save").addEventListener("click", () => {
    if ($("#p-password").value !== $("#p-password2").value) {
      return toast("Şifreler birbirini tutmuyor. İki alana da aynı şifreyi yazın.", "error");
    }
    closePassword($("#p-password").value);
  });
  $("#btn-password-cancel").addEventListener("click", () => closePassword(null));

  // Kullanıcı yönetimi
  $("#form-user").addEventListener("submit", onUserSubmit);
  $("#users-tbody").addEventListener("click", onUsersTableClick);
  $("#btn-edit-user-save").addEventListener("click", onEditUserSave);
  $("#btn-edit-user-cancel").addEventListener("click", closeEditUser);
}
