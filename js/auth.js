// ============================================================
// ÜRÜN TAKİP PANELİ - Giriş / Oturum İşlemleri
// Şifreler veritabanında SHA-256 hash olarak saklanır:
//   hash = sha256("kullaniciadi:sifre")
// ============================================================

const SESSION_KEY = "utp_session";

// Metni SHA-256 ile hashler, hex string döndürür
async function sha256Hex(text) {
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error(
      "Tarayıcı güvenli bağlam gerektiriyor. Sayfayı https:// veya http://localhost üzerinden açın."
    );
  }
  const data = new TextEncoder().encode(text);
  const buf = await window.crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Kullanıcı adı + şifre doğrulaması. Başarılıysa kullanıcı bilgisi, değilse null döner.
async function authLogin(username, password) {
  const hash = await sha256Hex(username + ":" + password);
  const { data, error } = await sb
    .from("users")
    .select("id, username, role, password_hash")
    .eq("username", username)
    .maybeSingle();

  if (error) throw new Error("Sunucuya ulaşılamadı: " + error.message);
  if (!data || data.password_hash !== hash) return null;

  return { id: data.id, username: data.username, role: data.role };
}

function saveSession(user) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
}

function getSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
