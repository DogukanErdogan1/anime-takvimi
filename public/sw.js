/* Only the fixed public icons and heading font are cached. Account pages and API responses are never cached. */
const PUBLIC_ASSET_CACHE = 'anime-takvimi-public-assets-v2';
const HEADING_FONT = '/site/fonts/space-grotesk-variable.ttf';
const PUBLIC_ASSETS = ['/favicon.svg', '/icon-192.png', '/icon-512.png', HEADING_FONT];
const OFFLINE = `<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#142b39"><title>Anime Takvimi · Çevrimdışı</title><style>@font-face{font-family:'Space Grotesk';src:url('${HEADING_FONT}') format('truetype');font-style:normal;font-weight:300 700;font-display:swap}</style><body style="margin:0;background:#faf7f2;color:#142b39;font:16px system-ui;display:grid;place-items:center;min-height:100vh"><main style="max-width:420px;padding:32px;text-align:center"><img src="/icon-192.png" width="64" height="64" alt=""><h1 style="font:700 32px 'Space Grotesk','Segoe UI',Arial,sans-serif">Kısa bir ara.</h1><p>Anime Takvimi’ne ulaşmak için internet bağlantını kontrol et.</p><p>Hesabın ve güncel yayın bilgileri bağlantı gerektirir.</p><button onclick="location.reload()" style="border:0;border-radius:12px;background:#f16f5b;color:white;font:600 16px system-ui;padding:14px 24px;cursor:pointer">Tekrar dene</button></main></body></html>`;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(PUBLIC_ASSET_CACHE);
    await Promise.allSettled(PUBLIC_ASSETS.map(async path => {
      const response = await fetch(new Request(new URL(path, self.location.origin), {credentials: 'omit'}));
      const contentType = response.headers.get('content-type') || '';
      const expectedType = path === HEADING_FONT
        ? /^(?:font\/ttf|application\/(?:x-font-ttf|font-sfnt|octet-stream))(?:;|$)/i.test(contentType)
        : contentType.startsWith('image/');
      if (response.ok && expectedType) await cache.put(path, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => (name.startsWith('anime-takvimi-public-icons-') || name.startsWith('anime-takvimi-public-assets-')) && name !== PUBLIC_ASSET_CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (PUBLIC_ASSETS.includes(url.pathname) && !url.search) {
    event.respondWith(caches.open(PUBLIC_ASSET_CACHE).then(async cache => (await cache.match(url.pathname)) || fetch(request)));
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
