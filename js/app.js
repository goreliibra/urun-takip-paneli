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
function confirmDialog(text, okLabel = "Evet, Sil") {
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
let stockItems = [];
let stockMoves = [];
let currentView = "dashboard";
let editingRecord = null;
let pollTimer = null;

// E-postasız eklenen üyeler için otomatik üretilen adres uzantısı
const FAKE_MAIL_DOMAIN = "@uye.uruntakip-paneli.com";

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
    await Promise.all([loadRecords(), loadUsers()]);
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
  $$(".nav-link").forEach((l) => l.classList.toggle("active", l.dataset.view === name));
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

// Formdaki alanları okur ve doğrular; hata varsa mesaj döndürür
function collectForm(prefix) {
  const urun = $(`#${prefix}-urun`).value.trim();
  const musteri = $(`#${prefix}-musteri`).value.trim();
  const fiyatStr = $(`#${prefix}-fiyat`).value;
  const alinanStr = $(`#${prefix}-alinan`).value;
  const kalanStr = $(`#${prefix}-kalan`).value;
  const tarih = $(`#${prefix}-tarih`).value || todayISO();
  const aciklama = $(`#${prefix}-aciklama`).value.trim();

  if (!urun) return { error: "Ürün adı boş bırakılamaz." };
  if (fiyatStr === "") return { error: "Ürün fiyatı boş bırakılamaz." };

  const fiyat = parseFloat(fiyatStr);
  const alinan = alinanStr === "" ? 0 : parseFloat(alinanStr);
  const kalan = kalanStr === "" ? Math.max(0, fiyat - alinan) : parseFloat(kalanStr);

  if (isNaN(fiyat) || fiyat < 0) return { error: "Ürün fiyatı negatif olamaz." };
  if (isNaN(alinan) || alinan < 0) return { error: "Alınan para negatif olamaz." };
  if (isNaN(kalan) || kalan < 0) return { error: "Kalan para negatif olamaz." };

  return {
    fields: {
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

  try {
    await dbAddRecord(fields, session.username);
    $("#form-new").reset();
    $("#n-tarih").value = todayISO();
    await loadRecords();
    renderCurrentView();
    toast("✅ Kayıt başarıyla eklendi.");
  } catch (err) {
    toast("Kayıt eklenemedi: " + (err.message || err), "error");
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

function getFilteredRecords() {
  const q = $("#f-search").value.trim().toLowerCase();
  const from = $("#f-date-from").value;
  const to = $("#f-date-to").value;
  const durum = $("#f-durum").value;
  const user = $("#f-user").value;

  return records.filter((r) => {
    if (q) {
      const hay = `${r.urun_adi || ""} ${r.musteri_adi || ""} ${r.aciklama || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (from && r.tarih < from) return false;
    if (to && r.tarih > to) return false;
    if (durum && statusOf(r) !== durum) return false;
    if (user && r.created_by !== user) return false;
    return true;
  });
}

function renderRecords() {
  const rows = getFilteredRecords();
  const isAdmin = session.role === "admin";
  const tbody = $("#records-tbody");

  $("#records-count").textContent = `${rows.length} kayıt gösteriliyor (toplam ${records.length})`;

  if (rows.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="10">Gösterilecek kayıt yok.</td></tr>`;
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
    renderCurrentView();
    toast("✅ Kayıt güncellendi.");
  } catch (err) {
    toast("Güncellenemedi: " + (err.message || err), "error");
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
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">Henüz hareket yok.</td></tr>';
    return;
  }

  tbody.innerHTML = stockMoves
    .map((m) => {
      const tipBadge =
        m.tip === "giris"
          ? '<span class="badge badge-odendi">📥 Giriş</span>'
          : '<span class="badge badge-alinmadi">📤 Çıkış</span>';
      const urun = m.stock_items ? m.stock_items.urun_adi : "";
      return `<tr>
        <td>${fmtTarih(m.tarih)}</td>
        <td><b>${esc(urun)}</b></td>
        <td>${tipBadge}</td>
        <td class="num">${fmtMiktar(m.miktar)}</td>
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
  const tarih = $("#s-tarih").value || todayISO();
  const aciklama = $("#s-aciklama").value.trim();

  if (!selVal) return toast("Ürün seçin.", "error");
  if (isNaN(miktar) || miktar <= 0) return toast("Miktar 0'dan büyük olmalı.", "error");

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

    await dbAddStockMove({ item_id: itemId, tip, miktar, tarih, aciklama }, session.username);
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
// İŞLEM GEÇMİŞİ
// ============================================================

function formatDiffValue(key, val) {
  if (val === null || val === undefined || val === "") return "—";
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
          ${
            isSelf
              ? ""
              : u.approved
                ? `<button class="btn btn-danger btn-sm" data-uaction="block" data-id="${u.id}">⛔ Engelle</button>`
                : `<button class="btn btn-primary btn-sm" data-uaction="approve" data-id="${u.id}">✅ Onayla</button>`
          }
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
  }
}

// ============================================================
// DIŞA AKTARMA (CSV / Excel)
// ============================================================

function exportRows() {
  return getFilteredRecords().map((r) => ({
    Tarih: fmtTarih(r.tarih),
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

function exportCSV() {
  const rows = exportRows();
  if (!rows.length) return toast("Aktarılacak kayıt yok.", "error");

  const headers = Object.keys(rows[0]);
  const quote = (v) => `"${String(v).replace(/"/g, '""')}"`;
  // Noktalı virgül + BOM: Türkçe Excel'de doğrudan doğru açılır
  const csv =
    "\uFEFF" +
    headers.map(quote).join(";") +
    "\n" +
    rows.map((r) => headers.map((h) => quote(r[h])).join(";")).join("\n");

  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `urun-takip-${todayISO()}.csv`);
  toast("⬇ CSV dosyası indirildi.");
}

function exportExcel() {
  if (typeof XLSX === "undefined") {
    return toast("Excel kütüphanesi yüklenemedi, CSV kullanın.", "error");
  }
  const rows = exportRows();
  if (!rows.length) return toast("Aktarılacak kayıt yok.", "error");

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Kayıtlar");
  XLSX.writeFile(wb, `urun-takip-${todayISO()}.xlsx`);
  toast("⬇ Excel dosyası indirildi.");
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

  // Yeni kayıt
  $("#form-new").addEventListener("submit", onNewSubmit);
  attachAutoKalan("n");

  // Kayıt listesi
  $("#records-tbody").addEventListener("click", onRecordsTableClick);
  $("#btn-refresh").addEventListener("click", async () => {
    await refreshData();
    toast("🔄 Liste yenilendi.");
  });
  ["#f-search", "#f-date-from", "#f-date-to", "#f-durum", "#f-user"].forEach((sel) =>
    $(sel).addEventListener("input", renderRecords)
  );
  $("#btn-clear-filters").addEventListener("click", () => {
    $("#f-search").value = "";
    $("#f-date-from").value = "";
    $("#f-date-to").value = "";
    $("#f-durum").value = "";
    $("#f-user").value = "";
    renderRecords();
  });
  $("#btn-export-csv").addEventListener("click", exportCSV);
  $("#btn-export-xlsx").addEventListener("click", exportExcel);

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
}
