/* ===================================================================
   sync.js — لایه‌ی اختیاری اتصال به Supabase (حساب کاربری + سینک ابری)
   اگه config.js پر نشده باشه، این ماژول غیرفعال می‌مونه و برنامه
   کاملاً محلی (فقط localStorage) کار می‌کنه — هیچ‌چیز خراب نمیشه.
   =================================================================== */
window.Sync = (() => {
  let client = null;
  let currentUser = null;
  let currentProfile = null;
  let dataProvider = null;
  let pendingPush = false;
  const listeners = [];

  function markPending() {
    pendingPush = true;
    try { localStorage.setItem('doday_sync_pending', '1'); } catch (e) { /* noop */ }
  }
  function clearPending() {
    pendingPush = false;
    try { localStorage.removeItem('doday_sync_pending'); } catch (e) { /* noop */ }
  }
  function hasPending() { return pendingPush; }
  function setDataProvider(fn) { dataProvider = fn; }

  function isConfigured() {
    return !!(window.DODAY_CONFIG
      && DODAY_CONFIG.SUPABASE_URL
      && DODAY_CONFIG.SUPABASE_ANON_KEY
      && !DODAY_CONFIG.SUPABASE_URL.includes('YOUR-PROJECT')
      && !DODAY_CONFIG.SUPABASE_ANON_KEY.includes('YOUR-ANON'));
  }

  function usernameToEmail(username) {
    const domain = (window.DODAY_CONFIG && DODAY_CONFIG.AUTH_EMAIL_DOMAIN) || 'doday.local';
    return `${username.trim().toLowerCase()}@${domain}`;
  }

  function onChange(fn) { listeners.push(fn); }
  function emitChange() { listeners.forEach((fn) => { try { fn(); } catch (e) { /* noop */ } }); }

  async function init() {
    if (!isConfigured()) return false;
    if (!window.supabase || !window.supabase.createClient) return false;
    try { if (localStorage.getItem('doday_sync_pending')) pendingPush = true; } catch (e) { /* noop */ }
    client = window.supabase.createClient(DODAY_CONFIG.SUPABASE_URL, DODAY_CONFIG.SUPABASE_ANON_KEY);
    const { data } = await client.auth.getSession();
    if (data && data.session) {
      currentUser = data.session.user;
      await loadProfile();
    }
    client.auth.onAuthStateChange(async (_event, session) => {
      currentUser = session ? session.user : null;
      if (currentUser) await loadProfile(); else currentProfile = null;
      emitChange();
    });
    return true;
  }

  async function loadProfile() {
    if (!currentUser) { currentProfile = null; return; }
    const { data, error } = await client.from('profiles').select('*').eq('id', currentUser.id).single();
    if (!error) currentProfile = data;
  }

  async function signUp({ username, password, displayName }) {
    if (!client) return { ok: false, error: 'اتصال به سرور تنظیم نشده' };
    const email = usernameToEmail(username);
    const { data, error } = await client.auth.signUp({
      email, password,
      options: { data: { username: username.trim().toLowerCase(), display_name: displayName || username } },
    });
    if (error) return { ok: false, error: error.message };
    // اگه تایید ایمیل خاموش باشه، ممکنه Supabase خودکار وارد کنه؛
    // چون هنوز تایید ادمین رو نداره، بلافاصله خارجش می‌کنیم.
    await client.auth.signOut();
    currentUser = null; currentProfile = null;
    // پروفایل توسط تریگر دیتابیس (به‌صورت خودکار) ساخته میشه — به schema.sql نگاه کن
    return { ok: true, data };
  }

  async function signIn({ username, password }) {
    if (!client) return { ok: false, error: 'اتصال به سرور تنظیم نشده' };
    const email = usernameToEmail(username);
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: 'نام کاربری یا رمز عبور اشتباهه' };
    currentUser = data.user;
    await loadProfile();
    if (!currentProfile || !currentProfile.approved) {
      await client.auth.signOut();
      currentUser = null; currentProfile = null;
      return { ok: false, pending: true, error: 'حساب شما هنوز توسط مدیر تایید نشده' };
    }
    emitChange();
    return { ok: true };
  }

  async function signOut() {
    if (client) await client.auth.signOut();
    currentUser = null; currentProfile = null;
    emitChange();
  }

  function getUser() { return currentUser; }
  function getProfile() { return currentProfile; }
  function isLoggedIn() { return !!(currentUser && currentProfile && currentProfile.approved); }
  function isAdmin() { return !!(currentProfile && currentProfile.is_admin); }

  // ---------------- سینک داده (یک ردیف JSON برای هر کاربر) ----------------
  async function pushData(dataObj) {
    if (!client || !isLoggedIn()) return { ok: false };
    const { error } = await client.from('almanac_data').upsert({
      user_id: currentUser.id,
      data: dataObj,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    return { ok: !error, error: error && error.message };
  }
  async function pushDataSafe(dataObj) {
    if (!isLoggedIn()) return { ok: false };
    try {
      const res = await pushData(dataObj);
      if (res.ok) clearPending(); else markPending();
      return res;
    } catch (e) {
      markPending();
      return { ok: false, error: 'offline' };
    }
  }

  // وقتی اینترنت برگرده، اگه تغییری معلق مونده بود، خودکار دوباره بفرست
  window.addEventListener('online', async () => {
    if (isLoggedIn() && hasPending() && dataProvider) {
      await pushDataSafe(dataProvider());
    }
  });

  async function pullData() {
    if (!client || !isLoggedIn()) return { ok: false };
    const { data, error } = await client.from('almanac_data').select('data, updated_at').eq('user_id', currentUser.id).maybeSingle();
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: data ? data.data : null, updatedAt: data ? data.updated_at : null };
  }

  // ---------------- پنل ادمین ----------------
  async function adminListPending() {
    if (!client) return [];
    const { data } = await client.from('profiles').select('*').eq('approved', false).order('created_at', { ascending: true });
    return data || [];
  }
  async function adminListAll() {
    if (!client) return [];
    const { data } = await client.from('profiles').select('*').order('created_at', { ascending: true });
    return data || [];
  }
  async function adminApprove(userId) {
    if (!client) return { ok: false };
    const { error } = await client.from('profiles').update({ approved: true }).eq('id', userId);
    return { ok: !error, error: error && error.message };
  }
  async function adminRevoke(userId) {
    if (!client) return { ok: false };
    const { error } = await client.from('profiles').update({ approved: false }).eq('id', userId);
    return { ok: !error, error: error && error.message };
  }
  async function adminDeleteUser(userId) {
    if (!client) return { ok: false };
    if (currentUser && userId === currentUser.id) return { ok: false, error: 'نمی‌تونی خودت رو حذف کنی' };
    const { error } = await client.from('profiles').delete().eq('id', userId);
    return { ok: !error, error: error && error.message };
  }

  return {
    init, isConfigured, onChange, setDataProvider, hasPending,
    signUp, signIn, signOut,
    getUser, getProfile, isLoggedIn, isAdmin,
    pushData, pushDataSafe, pullData,
    adminListPending, adminListAll, adminApprove, adminRevoke, adminDeleteUser,
  };
})();
