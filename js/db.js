// ============================================================
// ÜRÜN TAKİP PANELİ - Veri Katmanı (Supabase)
// Tüm okuma/yazma işlemleri bu dosyadan geçer.
// ============================================================

let sb = null; // Supabase istemcisi (initDb ile kurulur)

function isConfigured() {
  return (
    typeof SUPABASE_URL === "string" &&
    SUPABASE_URL.startsWith("https://") &&
    !SUPABASE_ANON_KEY.includes("BURAYA")
  );
}

function initDb() {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// ---------- KAYITLAR ----------

async function dbFetchRecords() {
  const { data, error } = await sb
    .from("records")
    .select("*")
    .order("tarih", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

async function dbAddRecord(fields, username) {
  const { data, error } = await sb
    .from("records")
    .insert({ ...fields, created_by: username })
    .select()
    .single();
  if (error) throw error;

  await dbAddHistory(data.id, "create", username, null, fields);
  return data;
}

async function dbUpdateRecord(id, newFields, oldFields, username) {
  const { error } = await sb
    .from("records")
    .update({ ...newFields, updated_by: username, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;

  await dbAddHistory(id, "update", username, oldFields, newFields);
}

async function dbDeleteRecord(id, oldFields, username) {
  // Önce geçmişe yaz, sonra sil (silinen kaydın izi kalsın)
  await dbAddHistory(id, "delete", username, oldFields, null);
  const { error } = await sb.from("records").delete().eq("id", id);
  if (error) throw error;
}

// ---------- İŞLEM GEÇMİŞİ ----------

async function dbAddHistory(recordId, action, username, oldValues, newValues) {
  const { error } = await sb.from("history").insert({
    record_id: recordId,
    action,
    changed_by: username,
    old_values: oldValues,
    new_values: newValues,
  });
  if (error) throw error;
}

async function dbFetchHistory(recordId = null, limit = 300) {
  let query = sb
    .from("history")
    .select("*")
    .order("changed_at", { ascending: false })
    .limit(limit);
  if (recordId) query = query.eq("record_id", recordId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// ---------- KULLANICILAR (profiller) ----------

async function dbFetchUsers() {
  const { data, error } = await sb
    .from("profiles")
    .select("id, username, email, role, approved, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

// Yeni üye: geçici bir istemciyle kaydolur (admin oturumu bozulmaz),
// ardından admin yetkisiyle onaylanıp rolü atanır.
async function dbAddUser(email, password, username, role) {
  const { data: existing } = await sb
    .from("profiles")
    .select("id")
    .ilike("username", username)
    .maybeSingle();
  if (existing) throw new Error("Bu kullanıcı adı zaten mevcut.");

  const temp = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { storageKey: "utp-temp-signup", persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await temp.auth.signUp({
    email,
    password,
    options: { data: { username } },
  });
  if (error) {
    const msg = error.message || "";
    if (msg.includes("already registered")) throw new Error("Bu e-posta ile kayıtlı üye zaten var.");
    throw new Error("Üye oluşturulamadı: " + msg);
  }
  if (!data.user) throw new Error("Üye oluşturulamadı.");

  const { error: e2 } = await sb
    .from("profiles")
    .update({ approved: true, role, username })
    .eq("id", data.user.id);
  if (e2) throw e2;
}

// Üye girişini aç/kapat
async function dbSetApproved(id, approved) {
  const { error } = await sb.from("profiles").update({ approved }).eq("id", id);
  if (error) throw error;
}

// Kullanıcı adı / rol düzeltme (şifre burada değişmez — sadece kişinin kendisi
// "Şifremi unuttum" ile ya da admin yeni bir üye olarak ekleyerek değiştirebilir)
async function dbUpdateUser(id, { username, role }) {
  const { data: existing } = await sb
    .from("profiles")
    .select("id")
    .ilike("username", username)
    .neq("id", id)
    .maybeSingle();
  if (existing) throw new Error("Bu kullanıcı adı zaten mevcut.");

  const { error } = await sb.from("profiles").update({ username, role }).eq("id", id);
  if (error) throw error;
}

// Üyeyi kalıcı olarak siler (profil silinir, girişi tamamen keser).
async function dbDeleteUser(id) {
  const { error } = await sb.from("profiles").delete().eq("id", id);
  if (error) throw error;
}

// ---------- STOK ----------

async function dbFetchStockItems() {
  const { data, error } = await sb.from("stock_items").select("*").order("urun_adi");
  if (error) throw error;
  return data;
}

async function dbAddStockItem(urunAdi, username) {
  const { data, error } = await sb
    .from("stock_items")
    .insert({ urun_adi: urunAdi, created_by: username })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("Bu ürün zaten stok listesinde var.");
    throw error;
  }
  return data;
}

async function dbDeleteStockItem(id) {
  const { error } = await sb.from("stock_items").delete().eq("id", id);
  if (error) throw error;
}

async function dbFetchStockMoves() {
  const { data, error } = await sb
    .from("stock_moves")
    .select("*, stock_items(urun_adi)")
    .order("tarih", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return data;
}

async function dbAddStockMove(fields, username) {
  const { error } = await sb.from("stock_moves").insert({ ...fields, created_by: username });
  if (error) throw error;
}

async function dbDeleteStockMove(id) {
  const { error } = await sb.from("stock_moves").delete().eq("id", id);
  if (error) throw error;
}

// ---------- CANLI GÜNCELLEME ----------

// Kayıtlar tablosunda herhangi bir değişiklik olduğunda callback çalışır
function dbSubscribeRecords(callback) {
  sb.channel("records-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "records" }, callback)
    .subscribe();
}

// Stok hareketlerinde değişiklik olduğunda callback çalışır
function dbSubscribeStock(callback) {
  sb.channel("stock-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "stock_moves" }, callback)
    .subscribe();
}

// ============================================================
// ÖNİZLEME MODU (?demo=1)
// Supabase kurulmadan tasarımı denemek için. VERİLER KAYDEDİLMEZ,
// sayfa yenilenince sıfırlanır. Gerçek kullanım için README'ye bakın.
// ============================================================

const DEMO_MODE = new URLSearchParams(location.search).has("demo");

if (DEMO_MODE) {
  const nowISO = () => new Date().toISOString();
  const dayISO = (offset) => {
    const t = new Date();
    t.setDate(t.getDate() + offset);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  };

  let demoRecords = [
    { id: "d1", urun_adi: "Döner Kesme Robotu", musteri_adi: "Mehmet Yılmaz", urun_fiyati: 1450, alinan_para: 1450, kalan_para: 0, tarih: dayISO(0), aciklama: "Peşin ödendi, teslim edildi", created_by: "admin", created_at: nowISO(), updated_by: null, updated_at: null },
    { id: "d2", urun_adi: "Elektrikli Döner Ocağı 4 Radyan", musteri_adi: "Ali Kaya", urun_fiyati: 890, alinan_para: 400, kalan_para: 490, tarih: dayISO(-2), aciklama: "Kalan tutar teslimatta ödenecek", created_by: "admin", created_at: nowISO(), updated_by: null, updated_at: null },
    { id: "d3", urun_adi: "Kebap Tezgahı (Soğutmalı)", musteri_adi: "Restoran Antalya", urun_fiyati: 2300, alinan_para: 0, kalan_para: 2300, tarih: dayISO(-5), aciklama: "Fatura kesildi, ödeme bekleniyor", created_by: "kullanici", created_at: nowISO(), updated_by: null, updated_at: null },
    { id: "d4", urun_adi: "Döner Bıçağı Seti", musteri_adi: "Hasan Demir", urun_fiyati: 120, alinan_para: 120, kalan_para: 0, tarih: dayISO(-1), aciklama: "", created_by: "kullanici", created_at: nowISO(), updated_by: null, updated_at: null },
    { id: "d5", urun_adi: "Ayran Makinesi 3 Hazneli", musteri_adi: "Cafe İstanbul", urun_fiyati: 650, alinan_para: 300, kalan_para: 350, tarih: dayISO(0), aciklama: "İkinci taksit gelecek hafta", created_by: "kullanici", created_at: nowISO(), updated_by: null, updated_at: null },
  ];

  let demoUsers = [
    { id: "u1", username: "admin", email: "admin@demo.com", role: "admin", approved: true, created_at: nowISO() },
    { id: "u2", username: "kullanici", email: "kullanici@demo.com", role: "kullanici", approved: true, created_at: nowISO() },
  ];

  let demoHistory = demoRecords.map((r, i) => ({
    id: "h" + i,
    record_id: r.id,
    action: "create",
    changed_by: r.created_by,
    changed_at: r.created_at,
    old_values: null,
    new_values: { urun_adi: r.urun_adi, musteri_adi: r.musteri_adi, urun_fiyati: r.urun_fiyati, alinan_para: r.alinan_para, kalan_para: r.kalan_para, tarih: r.tarih, aciklama: r.aciklama },
  }));

  isConfigured = () => true;
  initDb = () => {};
  dbSubscribeRecords = () => {};

  dbFetchRecords = async () => [...demoRecords];

  dbAddRecord = async (fields, username) => {
    const rec = { id: "d" + Date.now(), ...fields, created_by: username, created_at: nowISO(), updated_by: null, updated_at: null };
    demoRecords.unshift(rec);
    demoHistory.unshift({ id: "h" + Date.now(), record_id: rec.id, action: "create", changed_by: username, changed_at: nowISO(), old_values: null, new_values: fields });
    return rec;
  };

  dbUpdateRecord = async (id, newFields, oldFields, username) => {
    const rec = demoRecords.find((r) => r.id === id);
    if (!rec) return;
    Object.assign(rec, newFields, { updated_by: username, updated_at: nowISO() });
    demoHistory.unshift({ id: "h" + Date.now(), record_id: id, action: "update", changed_by: username, changed_at: nowISO(), old_values: oldFields, new_values: newFields });
  };

  dbDeleteRecord = async (id, oldFields, username) => {
    demoRecords = demoRecords.filter((r) => r.id !== id);
    demoHistory.unshift({ id: "h" + Date.now(), record_id: id, action: "delete", changed_by: username, changed_at: nowISO(), old_values: oldFields, new_values: null });
  };

  dbFetchHistory = async (recordId = null) =>
    recordId ? demoHistory.filter((h) => h.record_id === recordId) : [...demoHistory];

  dbFetchUsers = async () => [...demoUsers];

  dbAddUser = async (email, password, username, role) => {
    if (demoUsers.some((u) => u.username === username)) throw new Error("Bu kullanıcı adı zaten mevcut.");
    demoUsers.push({ id: "u" + Date.now(), username, email, role, approved: true, created_at: nowISO() });
  };

  dbSetApproved = async (id, approved) => {
    const u = demoUsers.find((x) => x.id === id);
    if (u) u.approved = approved;
  };

  // Önizlemede giriş: sadece demo kullanıcılar çalışır ("admin" veya "admin@demo.com" yazılabilir)
  authLogin = async (email, password) => {
    const pairs = {
      admin: "admin123",
      "admin@demo.com": "admin123",
      kullanici: "kullanici123",
      "kullanici@demo.com": "kullanici123",
    };
    if (pairs[email] !== password) return null;
    const isAdminUser = email.startsWith("admin");
    return {
      id: isAdminUser ? "u1" : "u2",
      username: isAdminUser ? "admin" : "kullanici",
      role: isAdminUser ? "admin" : "kullanici",
      email: isAdminUser ? "admin@demo.com" : "kullanici@demo.com",
    };
  };

  authCurrentUser = async () => null;
  authLogout = async () => {};
  authSendResetMail = async () => {};
  authSetNewPassword = async () => {};

  // Önizleme: stok verileri
  let demoStockItems = [
    { id: "si1", urun_adi: "Döner Bıçağı", created_by: "admin", created_at: nowISO() },
    { id: "si2", urun_adi: "Ayran Makinesi", created_by: "admin", created_at: nowISO() },
  ];
  let demoStockMoves = [
    { id: "sm1", item_id: "si1", tip: "giris", miktar: 20, tarih: dayISO(-3), aciklama: "Tedarikçiden geldi", created_by: "admin", created_at: nowISO(), stock_items: { urun_adi: "Döner Bıçağı" } },
    { id: "sm2", item_id: "si1", tip: "cikis", miktar: 5, tarih: dayISO(-1), aciklama: "Satış", created_by: "kullanici", created_at: nowISO(), stock_items: { urun_adi: "Döner Bıçağı" } },
    { id: "sm3", item_id: "si2", tip: "giris", miktar: 8, tarih: dayISO(0), aciklama: "", created_by: "admin", created_at: nowISO(), stock_items: { urun_adi: "Ayran Makinesi" } },
  ];

  dbFetchStockItems = async () => [...demoStockItems];
  dbAddStockItem = async (urunAdi, username) => {
    if (demoStockItems.some((i) => i.urun_adi === urunAdi)) throw new Error("Bu ürün zaten stok listesinde var.");
    const it = { id: "si" + Date.now(), urun_adi: urunAdi, created_by: username, created_at: nowISO() };
    demoStockItems.push(it);
    return it;
  };
  dbDeleteStockItem = async (id) => {
    demoStockItems = demoStockItems.filter((i) => i.id !== id);
    demoStockMoves = demoStockMoves.filter((m) => m.item_id !== id);
  };
  dbFetchStockMoves = async () => [...demoStockMoves];
  dbAddStockMove = async (fields, username) => {
    const item = demoStockItems.find((i) => i.id === fields.item_id);
    demoStockMoves.unshift({
      id: "sm" + Date.now(), ...fields, created_by: username, created_at: nowISO(),
      stock_items: { urun_adi: item ? item.urun_adi : "" },
    });
  };
  dbDeleteStockMove = async (id) => {
    demoStockMoves = demoStockMoves.filter((m) => m.id !== id);
  };
  dbSubscribeStock = () => {};

  // Üstte uyarı şeridi göster
  document.addEventListener("DOMContentLoaded", () => {
    const b = document.createElement("div");
    b.textContent = "🔍 ÖNİZLEME MODU — veriler kaydedilmez. Gerçek kullanım için Supabase kurulumu gerekli (README.md).";
    b.style.cssText = "background:#d97706;color:#fff;text-align:center;padding:7px 12px;font-size:13px;font-weight:600;";
    document.body.prepend(b);
  });
}
