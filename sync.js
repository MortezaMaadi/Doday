/* ===================================================================
  sync.js — لایه اتصال حساب کاربری + سینک داده
  احراز هویت و پروفایل فعلاً از Supabase استفاده می‌کنند.
  داده اصلی سالنامه از طریق Cloudflare Worker به Neon سینک می‌شود.
  =================================================================== */

window.Sync = (() => {
  let client = null;
  let currentUser = null;
  let currentProfile = null;
  let dataProvider = null;
  let pendingPush = false;
  const listeners = [];

  // Worker فعلی که اتصالش به Neon تست شده است.
  const WORKER_URL = 'https://71fe94a5-doday.mortezamoadi.workers.dev';

  function markPending() {
    pendingPush = true;
    try {
      localStorage.setItem('doday_sync_pending', '1');
    } catch (e) { /* noop */ }
  }

  function clearPending() {
    pendingPush = false;
    try {
      localStorage.removeItem('doday_sync_pending');
    } catch (e) { /* noop */ }
  }

  function hasPending() {
    return pendingPush;
  }

  function setDataProvider(fn) {
    dataProvider = fn;
  }

  // ---------------------------------------------------------------
  // Supabase library
  // ---------------------------------------------------------------

  let libPromise = null;

  function loadSupabaseLib(timeoutMs) {
    if (window.supabase && window.supabase.createClient) {
      return Promise.resolve(true);
    }

    if (libPromise) return libPromise;

    libPromise = new Promise((resolve) => {
      const script = document.createElement('script');

      script.src =
        'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

      const timer = setTimeout(() => {
        libPromise = null;
        resolve(false);
      }, timeoutMs || 8000);

      script.onload = () => {
        clearTimeout(timer);
        resolve(true);
      };

      script.onerror = () => {
        clearTimeout(timer);
        libPromise = null;
        resolve(false);
      };

      document.head.appendChild(script);
    });

    return libPromise;
  }

  async function ensureClient(timeoutMs) {
    if (client) return true;
    if (!isConfigured()) return false;

    const loaded = await loadSupabaseLib(timeoutMs);

    if (
      !loaded ||
      !window.supabase ||
      !window.supabase.createClient
    ) {
      return false;
    }

    client = window.supabase.createClient(
      DODAY_CONFIG.SUPABASE_URL,
      DODAY_CONFIG.SUPABASE_ANON_KEY
    );

    return true;
  }

  function isConfigured() {
    return !!(
      window.DODAY_CONFIG &&
      DODAY_CONFIG.SUPABASE_URL &&
      DODAY_CONFIG.SUPABASE_ANON_KEY &&
      !DODAY_CONFIG.SUPABASE_URL.includes('YOUR-PROJECT') &&
      !DODAY_CONFIG.SUPABASE_ANON_KEY.includes('YOUR-ANON')
    );
  }

  function usernameToEmail(username) {
    const domain =
      (window.DODAY_CONFIG &&
        DODAY_CONFIG.AUTH_EMAIL_DOMAIN) ||
      'doday.local';

    return `${username.trim().toLowerCase()}@${domain}`;
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  function emitChange() {
    listeners.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        /* noop */
      }
    });
  }

  // ---------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------

  async function init() {
    if (!isConfigured()) return false;

    const ok = await ensureClient(8000);
    if (!ok) return false;

    try {
      if (localStorage.getItem('doday_sync_pending')) {
        pendingPush = true;
      }
    } catch (e) {
      /* noop */
    }

    const { data } = await client.auth.getSession();

    if (data && data.session) {
      currentUser = data.session.user;
      await loadProfile();
    }

    client.auth.onAuthStateChange(async (_event, session) => {
      currentUser = session ? session.user : null;

      if (currentUser) {
        await loadProfile();
      } else {
        currentProfile = null;
      }

      emitChange();
    });

    return true;
  }

  async function loadProfile() {
    if (!currentUser) {
      currentProfile = null;
      return;
    }

    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('id', currentUser.id)
      .single();

    if (!error) {
      currentProfile = data;
    }
  }

  async function signUp({
    username,
    password,
    displayName
  }) {
    const ok = await ensureClient(15000);

    if (!ok) {
      return {
        ok: false,
        error: 'اتصال به سرور برقرار نشد، دوباره امتحان کن'
      };
    }

    const email = usernameToEmail(username);

    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: username.trim().toLowerCase(),
          display_name: displayName || username
        }
      }
    });

    if (error) {
      return {
        ok: false,
        error: error.message
      };
    }

    await client.auth.signOut();

    currentUser = null;
    currentProfile = null;

    return {
      ok: true,
      data
    };
  }

  async function signIn({
    username,
    password
  }) {
    const ok = await ensureClient(15000);

    if (!ok) {
      return {
        ok: false,
        error: 'اتصال به سرور برقرار نشد، دوباره امتحان کن'
      };
    }

    const email = usernameToEmail(username);

    const { data, error } =
      await client.auth.signInWithPassword({
        email,
        password
      });

    if (error) {
      return {
        ok: false,
        error: 'نام کاربری یا رمز عبور اشتباهه'
      };
    }

    currentUser = data.user;

    await loadProfile();

    if (!currentProfile || !currentProfile.approved) {
      await client.auth.signOut();

      currentUser = null;
      currentProfile = null;

      return {
        ok: false,
        pending: true,
        error: 'حساب شما هنوز توسط مدیر تایید نشده'
      };
    }

    emitChange();

    return {
      ok: true
    };
  }

  async function signOut() {
    if (client) {
      await client.auth.signOut();
    }

    currentUser = null;
    currentProfile = null;

    emitChange();
  }

  function getUser() {
    return currentUser;
  }

  function getProfile() {
    return currentProfile;
  }

  function isLoggedIn() {
    return !!(
      currentUser &&
      currentProfile &&
      currentProfile.approved
    );
  }

  function isAdmin() {
    return !!(
      currentProfile &&
      currentProfile.is_admin
    );
  }

  // ---------------------------------------------------------------
  // Cloudflare Worker / Neon
  // ---------------------------------------------------------------

  async function workerRequest(path, options = {}) {
    try {
      const response = await fetch(
        `${WORKER_URL}${path}`,
        {
          ...options,
          headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
          }
        }
      );

      let result = null;

      try {
        result = await response.json();
      } catch (e) {
        result = null;
      }

      if (!response.ok) {
        return {
          ok: false,
          error:
            (result && (result.error || result.detail)) ||
            `HTTP ${response.status}`
        };
      }

      return {
        ok: true,
        data: result
      };
    } catch (e) {
      return {
        ok: false,
        error: 'offline'
      };
    }
  }

  // ---------------------------------------------------------------
  // سینک داده
  // ---------------------------------------------------------------

  async function pushData(dataObj) {
    if (!isLoggedIn()) {
      return {
        ok: false
      };
    }

    /*
      فعلاً Worker برای حساب اصلی از id = "morteza" استفاده می‌کند.
      بعد از تکمیل سیستم چندکاربره، این قسمت به شناسه واقعی کاربر
      منتقل خواهد شد.
    */

    const result = await workerRequest('/api/data', {
      method: 'PUT',
      body: JSON.stringify({
        data: dataObj
      })
    });

    if (!result.ok) {
      return {
        ok: false,
        error: result.error
      };
    }

    return {
      ok: true
    };
  }

  async function pushDataSafe(dataObj) {
    if (!isLoggedIn()) {
      return {
        ok: false
      };
    }

    markPending();

    try {
      const res = await pushData(dataObj);

      if (res.ok) {
        clearPending();
      } else {
        markPending();
      }

      return res;
    } catch (e) {
      markPending();

      return {
        ok: false,
        error: 'offline'
      };
    }
  }

  async function pullData() {
    if (!isLoggedIn()) {
      return {
        ok: false
      };
    }

    const result =
      await workerRequest('/api/data', {
        method: 'GET'
      });

    if (!result.ok) {
      return {
        ok: false,
        error: result.error
      };
    }

    const payload = result.data || {};

    return {
      ok: true,
      data: payload.data || null,
      updatedAt: payload.updated_at || null
    };
  }

  // ---------------------------------------------------------------
  // تاریخچه
  // فعلاً همچنان Supabase
  // ---------------------------------------------------------------

  async function getHistory() {
    if (!client || !isLoggedIn()) return [];

    const { data, error } = await client
      .from('almanac_data_history')
      .select('id, saved_at')
      .eq('user_id', currentUser.id)
      .order('saved_at', {
        ascending: false
      });

    return error ? [] : (data || []);
  }

  async function restoreFromHistory(historyId) {
    if (!client || !isLoggedIn()) {
      return {
        ok: false
      };
    }

    const { data, error } = await client
      .from('almanac_data_history')
      .select('data')
      .eq('id', historyId)
      .eq('user_id', currentUser.id)
      .maybeSingle();

    if (error || !data) {
      return {
        ok: false,
        error: error && error.message
      };
    }

    return {
      ok: true,
      data: data.data
    };
  }

  // ---------------------------------------------------------------
  // پنل ادمین
  // فعلاً همچنان Supabase
  // ---------------------------------------------------------------

  async function adminListPending() {
    if (!client) return [];

    const { data } = await client
      .from('profiles')
      .select('*')
      .eq('approved', false)
      .order('created_at', {
        ascending: true
      });

    return data || [];
  }

  async function adminListAll() {
    if (!client) return [];

    const { data } = await client
      .from('profiles')
      .select('*')
      .order('created_at', {
        ascending: true
      });

    return data || [];
  }

  async function adminApprove(userId) {
    if (!client) {
      return {
        ok: false
      };
    }

    const { error } = await client
      .from('profiles')
      .update({
        approved: true
      })
      .eq('id', userId);

    return {
      ok: !error,
      error: error && error.message
    };
  }

  async function adminRevoke(userId) {
    if (!client) {
      return {
        ok: false
      };
    }

    const { error } = await client
      .from('profiles')
      .update({
        approved: false
      })
      .eq('id', userId);

    return {
      ok: !error,
      error: error && error.message
    };
  }

  async function adminDeleteUser(userId) {
    if (!client) {
      return {
        ok: false
      };
    }

    if (
      currentUser &&
      userId === currentUser.id
    ) {
      return {
        ok: false,
        error: 'نمی‌تونی خودت رو حذف کنی'
      };
    }

    const { error } = await client
      .from('profiles')
      .delete()
      .eq('id', userId);

    return {
      ok: !error,
      error: error && error.message
    };
  }

  // ---------------------------------------------------------------

  return {
    init,
    isConfigured,
    onChange,
    setDataProvider,
    hasPending,

    signUp,
    signIn,
    signOut,

    getUser,
    getProfile,
    isLoggedIn,
    isAdmin,

    pushData,
    pushDataSafe,
    pullData,

    getHistory,
    restoreFromHistory,

    adminListPending,
    adminListAll,
    adminApprove,
    adminRevoke,
    adminDeleteUser
  };
})();
