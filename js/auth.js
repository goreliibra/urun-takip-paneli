// ============================================================
// ÜRÜN TAKİP PANELİ - Giriş / Oturum (Supabase Auth, e-posta tabanlı)
// Şifreler Supabase üyelik sisteminde güvenle saklanır.
// "Şifremi unuttum" mailleri Supabase tarafından gönderilir.
// ============================================================

// E-posta VEYA kullanıcı adı + şifre ile giriş. Başarılıysa kullanıcı bilgisi, hatalıysa null döner.
async function authLogin(identifier, password) {
  let email = identifier;
  if (!email.includes("@")) {
    const { data: resolved, error: resolveErr } = await sb.rpc("resolve_login_email", {
      p_identifier: identifier,
    });
    if (resolveErr) throw new Error("Giriş yapılamadı: " + resolveErr.message);
    if (!resolved) return null; // bilinmeyen kullanıcı adı -> şifre hatalı ile aynı mesaj
    email = resolved;
  }

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    const msg = error.message || "";
    if (msg.includes("Invalid login credentials")) return null;
    if (msg.includes("Email not confirmed"))
      throw new Error("E-posta adresiniz henüz doğrulanmamış. Gelen kutunuzu kontrol edin.");
    throw new Error("Giriş yapılamadı: " + msg);
  }

  const profile = await authLoadProfile(data.user.id);
  if (!profile) {
    await sb.auth.signOut();
    throw new Error("Profil bulunamadı. Yöneticinizle iletişime geçin.");
  }
  if (!profile.approved) {
    await sb.auth.signOut();
    throw new Error("Hesabınız henüz onaylanmamış. Yöneticinizin onayını bekleyin.");
  }
  return { id: profile.id, username: profile.username, role: profile.role, email: profile.email };
}

async function authLoadProfile(userId) {
  const { data, error } = await sb.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

// Sayfa açılışında mevcut oturumu kontrol eder (oturum tarayıcıda güvenle saklanır)
async function authCurrentUser() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  try {
    const profile = await authLoadProfile(session.user.id);
    if (!profile || !profile.approved) return null;
    return { id: profile.id, username: profile.username, role: profile.role, email: profile.email };
  } catch {
    return null;
  }
}

async function authLogout() {
  await sb.auth.signOut();
}

// Şifre yenileme maili gönderir (bağlantı, kullanıcıyı uygulamaya geri getirir)
async function authSendResetMail(email) {
  const redirect = location.origin + location.pathname;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect });
  if (error) throw new Error("Mail gönderilemedi: " + error.message);
}

// Mailden gelen bağlantıyla girildiğinde yeni şifreyi kaydeder
async function authSetNewPassword(newPassword) {
  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (error) throw new Error("Şifre güncellenemedi: " + error.message);
}
