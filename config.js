/* =================================================================
   config.js
   این فایل رو با اطلاعات پروژه‌ی Supabase خودت پر کن.
   از داشبورد Supabase برو به: Project Settings → API
   - SUPABASE_URL       = Project URL
   - SUPABASE_ANON_KEY   = anon / public key
   (این کلید public و امنه که توی کد فرانت‌اند باشه — کلید service_role
   رو هیچ‌وقت اینجا نذار، اون فقط سمت سرور استفاده میشه.)
   ================================================================= */

const DODAY_CONFIG = {
  SUPABASE_URL: 'https://xsynpzrbvqfbboflrphl.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_3POHY1bP1eEnYSrW4BL1dQ_u4YPQocw',

  // این پسوند برای ساخت یک ایمیل داخلی از روی یوزرنیم استفاده میشه
  // (چون Supabase Auth برای ثبت‌نام به ایمیل نیاز داره ولی کاربر فقط یوزرنیم وارد می‌کنه)
  AUTH_EMAIL_DOMAIN: 'doday.local',
};
