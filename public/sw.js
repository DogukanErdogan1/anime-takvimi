/* Only public, fixed icon resources are cached. Account pages and API responses are never cached. */
const ICON_CACHE = 'anime-takvimi-public-icons-v1';
const ICONS = ['/favicon.svg', '/icon-192.png', '/icon-512.png'];
const OFFLINE = '<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#142b39"><title>Anime Takvimi · Çevrimdışı</title><body style="margin:0;background:#faf7f2;color:#142b39;font:16px system-ui;display:grid;place-items:center;min-height:100vh"><main style="max-width:420px;padding:32px;text-align:center"><img src="/icon-192.png" width="64" height="64" alt=""><h1 style="font:700 32px Georgia">Kısa bir ara.</h1><p>Anime Takvimi’ne ulaşmak için internet bağlantını kontrol et.</p><p>Hesabın ve güncel yayın bilgileri bağlantı gerektirir.</p><button onclick="location.reload()" style="border:0;border-radius:12px;background:#f16f5b;color:white;font:600 16px system-ui;padding:14px 24px;cursor:pointer">Tekrar dene</button></main></body></html>';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(ICON_CACHE);
    await Promise.allSettled(ICONS.map(async path => {
      const response = await fetch(new Request(new URL(path, self.location.origin), {credentials: 'omit'}));
      if (response.ok && response.headers.get('content-type')?.startsWith('image/')) await cache.put(path, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('anime-takvimi-public-icons-') && name !== ICON_CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (ICONS.includes(url.pathname) && !url.search) {
    event.respondWith(caches.open(ICON_CACHE).then(async cache => (await cache.match(url.pathname)) || fetch(request)));
  } else if (request.mode === 'navigate') {
    // Online navigation always reaches the server. No HTML or credentials are stored.
    event.respondWith(fetch(request).catch(() => new Response(OFFLINE, {
      status: 503,
      headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'},
    })));
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL('/#watchlist', self.location.origin).href;
    const windows = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.navigate(target); await existing.focus(); }
    else await self.clients.openWindow(target);
  })());
});
