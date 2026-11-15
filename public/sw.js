/* Only fixed public offline files and public poster images are cached. Account HTML and private API responses never enter Cache Storage. */
const PUBLIC_ASSET_CACHE = 'anime-takvimi-public-assets-v4';
const HEADING_FONT = '/site/fonts/space-grotesk-variable.ttf';
const OFFLINE_ASSETS=['/offline.html','/site/offline.css','/site/offline-core.mjs','/site/offline-client.mjs','/site/offline-view.mjs'];
const PUBLIC_ASSETS = ['/favicon.svg', '/icon-192.png', '/icon-512.png', HEADING_FONT,...OFFLINE_ASSETS];
const POSTER_CACHE='anime-takvimi-public-posters-v1';
const OFFLINE = `<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#142b39"><title>Anime Takvimi · Çevrimdışı</title><style>@font-face{font-family:'Space Grotesk';src:url('${HEADING_FONT}') format('truetype');font-style:normal;font-weight:300 700;font-display:swap}</style><body style="margin:0;background:#faf7f2;color:#142b39;font:16px system-ui;display:grid;place-items:center;min-height:100vh"><main style="max-width:420px;padding:32px;text-align:center"><img src="/icon-192.png" width="64" height="64" alt=""><h1 style="font:700 32px 'Space Grotesk','Segoe UI',Arial,sans-serif">Kısa bir ara.</h1><p>Anime Takvimi’ne ulaşmak için internet bağlantını kontrol et.</p><p>Hesabın ve güncel yayın bilgileri bağlantı gerektirir.</p><button onclick="location.reload()" style="border:0;border-radius:12px;background:#f16f5b;color:white;font:600 16px system-ui;padding:14px 24px;cursor:pointer">Tekrar dene</button></main></body></html>`;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(PUBLIC_ASSET_CACHE);
    await Promise.allSettled(PUBLIC_ASSETS.map(async path => {
      const response = await fetch(new Request(new URL(path, self.location.origin), {credentials: 'omit'}));
      const contentType = response.headers.get('content-type') || '';
      const expectedType = path === HEADING_FONT
        ? /^(?:font\/ttf|application\/(?:x-font-ttf|font-sfnt|octet-stream))(?:;|$)/i.test(contentType)
        : OFFLINE_ASSETS.includes(path)?/^(?:text\/(?:html|css|javascript)|application\/javascript)(?:;|$)/i.test(contentType):contentType.startsWith('image/');
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

self.addEventListener('message',event=>{
 if(event.data?.type!=='CACHE_POSTERS'||!Array.isArray(event.data.ids)||!event.source?.url)return;
 let source;try{source=new URL(event.source.url);}catch{return;}if(source.origin!==self.location.origin)return;
 const ids=[...new Set(event.data.ids.filter(id=>Number.isSafeInteger(id)&&id>0&&id<=2147483647))].slice(0,24);
 event.waitUntil((async()=>{const cache=await caches.open(POSTER_CACHE);let index=0;
  const worker=async()=>{while(index<ids.length){const id=ids[index++],path='/api/posters/'+id;if(await cache.match(path))continue;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);try{const response=await fetch(new Request(new URL(path,self.location.origin),{credentials:'omit',signal:controller.signal}));if(response.ok&&response.headers.get('content-type')?.startsWith('image/')&&response.headers.get('cache-control')?.includes('public')&&!response.headers.has('set-cookie')){const data=await response.arrayBuffer();if(data.byteLength<=2097152)await cache.put(path,new Response(data,{headers:response.headers}));}}catch{}finally{clearTimeout(timer);}}};
  await Promise.all([worker(),worker()]);const keys=await cache.keys();await Promise.all(keys.slice(0,Math.max(0,keys.length-60)).map(key=>cache.delete(key)));
 })());
});

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  if(/^\/api\/posters\/[1-9]\d{0,9}$/.test(url.pathname)&&!url.search){event.respondWith(caches.open(POSTER_CACHE).then(async cache=>(await cache.match(url.pathname))||fetch(request)));return;}
  if(url.pathname.startsWith('/api/'))return;
  if (PUBLIC_ASSETS.includes(url.pathname) && !url.search) {
    event.respondWith(caches.open(PUBLIC_ASSET_CACHE).then(async cache => (await cache.match(url.pathname)) || fetch(request)));
  } else if (request.mode === 'navigate') {
    // Online navigation always reaches the server. No HTML or credentials are stored.
    event.respondWith(fetch(request).catch(async () => (await (await caches.open(PUBLIC_ASSET_CACHE)).match('/offline.html'))||new Response(OFFLINE, {
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

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    try {
      const data = event.data?.json();
      if (!data || typeof data.title !== 'string' || typeof data.body !== 'string' || typeof data.bindingId !== 'string' || !/^mal-[1-9]\d{0,9}$/.test(data.animeId)) return;
      // Queued notifications must not reveal an old account's anime after
      // logout, account switching, session expiry, or reminder removal.
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
      let response;
      try {response = await fetch('/api/push?anime=' + encodeURIComponent(data.animeId), {signal: controller.signal, credentials: 'same-origin', cache: 'no-store', headers: {Accept: 'application/json'}});}
      finally {clearTimeout(timeout);}
      if (!response.ok) return;
      const current = await response.json();
      if (!current.active || current.bindingId !== data.bindingId || current.reminderActive !== true) return;
      await self.registration.showNotification(data.title.slice(0, 100), {body: data.body.slice(0, 240), tag: typeof data.tag === 'string' ? data.tag.slice(0, 180) : 'anime-reminder', icon: '/icon-192.png', badge: '/favicon.svg'});
    } catch { /* Offline or revoked sessions never display private payloads. */ }
  })());
});
