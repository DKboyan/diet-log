/* 饮食记录 Service Worker —— 离线缓存（stale-while-revalidate） */
const CACHE = 'diet-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(cached => {
      // 后台更新缓存，下次打开就是新版
      const fresh = fetch(e.request).then(resp => {
        if (resp && resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => cached);
      if (cached) return cached;
      // 没缓存过的导航请求兜底回 index.html
      return fresh.then(r => r || caches.match('./index.html'))
        .catch(() => e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error());
    })
  );
});
