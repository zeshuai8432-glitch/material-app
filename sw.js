const CACHE_NAME = 'fieldmat-v122';
const ASSETS = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // 只攔截同源 GET（app assets）；跨域或 POST 讓瀏覽器直接處理
  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith(self.location.origin)) return;
  // HTML 一律繞過瀏覽器的 HTTP 快取直接跟伺服器要，否則 GitHub Pages 的 max-age
  // 會讓使用者卡在舊版本好幾分鐘（網路失敗才退回快取，離線照樣能開）
  const isDoc = e.request.mode === 'navigate'
    || e.request.destination === 'document'
    || /\.html(\?|$)/.test(e.request.url);
  const req = isDoc ? new Request(e.request.url, { cache: 'no-store', credentials: 'same-origin' }) : e.request;
  e.respondWith(
    fetch(req).then(r => {
      if (isDoc && r && r.ok) {
        const copy = r.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, copy)).catch(() => {});
      }
      return r;
    }).catch(() => caches.match(e.request))
  );
});

// 讓頁面可以叫 SW 自己退場（強制更新用）
self.addEventListener('message', e => {
  if (e.data === 'nuke') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.registration.unregister());
  }
});
