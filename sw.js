/* ===================================================================
   sw.js — سرویس‌ورکر Doday
   فایل‌های اصلی برنامه رو کش می‌کنه تا آفلاین هم باز بشه.
   =================================================================== */
const CACHE_NAME = 'doday-cache-v3';
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './jalali.js',
  './sync.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];
// config.js عمداً توی پیش‌کش نیست چون کاربر مستقیم ادیتش می‌کنه؛
// همیشه باید اول از شبکه خونده بشه (network-first)، نه از کش

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) return;

  // config.js: همیشه اول شبکه، فقط اگه آفلاین بودی برو سراغ کش
  if (event.request.url.endsWith('config.js')) {
    event.respondWith(
      fetch(event.request).then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // بقیه‌ی فایل‌ها: کش اول، ولی همزمان به‌روزرسانی پس‌زمینه
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
