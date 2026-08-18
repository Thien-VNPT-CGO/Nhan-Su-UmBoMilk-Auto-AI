// ===== Service Worker: app shell network-first, API network-first, assets cache-first =====
const CACHE_NAME = 'umbo-milk-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(['/', '/manifest.webmanifest'])),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API + socket: luôn qua mạng (network-first)
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match(event.request).then((r) => r || new Response(JSON.stringify({ success: false }), { status: 503, headers: { 'Content-Type': 'application/json' } })),
      ),
    );
    return;
  }

  // App shell (trang HTML): network-first + fallback cache -> luôn lấy UI MỚI sau khi deploy,
  // cache chỉ dùng khi offline (tránh bị kẹt giao diện cũ như trước)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok && res.type === 'basic') {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/', clone));
          }
          return res;
        })
        .catch(() =>
          caches.match(event.request).then((r) => r || caches.match('/')),
        ),
    );
    return;
  }

  // Assets (đã hash theo nội dung): cache-first (offline vẫn mở được)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      });
    }),
  );
});
