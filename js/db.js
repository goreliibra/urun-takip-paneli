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

// ---------- KULLANICILAR ----------

async function dbFetchUsers() {
  const { data, error } = await sb
    .from("users")
    .select("id, username, role, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

async function dbAddUser(username, password, role) {
  const password_hash = await sha256Hex(username + ":" + password);
  const { error } = await sb.from("users").insert({ username, password_hash, role });
  if (error) {
    if (error.code === "23505") throw new Error("Bu kullanıcı adı zaten mevcut.");
    throw error;
  }
}

async function dbDeleteUser(id) {
  const { error } = await sb.from("users").delete().eq("id", id);
  if (error) throw error;
}

async function dbChangePassword(username, newPassword) {
  const password_hash = await sha256Hex(username + ":" + newPassword);
  const { error } = await sb.from("users").update({ password_hash }).eq("username", username);
  if (error) throw error;
}

// ---------- CANLI GÜNCELLEME ----------

// Kayıtlar tablosunda herhangi bir değişiklik olduğunda callback çalışır
function dbSubscribeRecords(callback) {
  sb.channel("records-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "records" }, callback)
    .subscribe();
}
