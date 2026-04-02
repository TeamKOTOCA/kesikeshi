const CACHE_NAME = 'kesikeshi-shell-v2';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './worker.js',
  './manifest.webmanifest',
  './public/icon-192.png',
  './public/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((oldKey) => caches.delete(oldKey))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    // 1. まずネットワークにリクエストを投げる
    fetch(event.request)
      .then((networkResponse) => {
        // レスポンスが正常ならキャッシュを更新して返す
        if (networkResponse && networkResponse.status === 200 && networkResponse.type !== 'opaque') {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      })
      .catch(() => {
        // 2. ネットワーク失敗時（オフライン）のみキャッシュを確認
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          
          // 3. キャッシュにもない場合のフォールバック
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return caches.match('./public/icon-192.png');
        });
      })
  );
});