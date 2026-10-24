(() => {
  'use strict';
  const PREFIX = 'anime-takvimi-banners-v1:';
  const automatic = new Map(); const overrides = new Map(); const pending = new Map(); const generations = new Map();
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  const idOf = value => Number.isSafeInteger(Number(value)) && /^[1-9]\d{0,9}$/.test(String(value)) && Number(value) <= 2147483647 ? Number(value) : null;
  function safeBanner(value, malId) {
    if (typeof value !== 'string' || value.length > 2048) return null;
    try {
      const url = new URL(value,location.origin);
      if (url.username || url.password || url.hash) return null;
      if (url.origin === location.origin) {
        const match = url.pathname.match(/^\/api\/banners\/([1-9]\d{0,9})$/);
        return match && idOf(match[1]) && (!malId || Number(match[1]) === malId) && new RegExp(`^\\?image=${uuid}$`).test(url.search) ? url.pathname + url.search : null;
      }
      return url.protocol === 'https:' && !url.port && url.hostname === 's4.anilist.co' && /^\/file\/anilistcdn\/media\/anime\/banner\/[A-Za-z0-9_.-]+\.(?:jpe?g|png|webp)$/.test(url.pathname) ? url.href : null;
    } catch { return null; }
  }
  async function timedFetch(url,options = {}) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(),8000);
    try { return await fetch(url,{...options,signal:controller.signal}); }
    finally { clearTimeout(timer); }
  }
  function stored(id) {
    try {
      const entry = JSON.parse(localStorage.getItem(PREFIX + id) || 'null');
      if (entry && Number.isFinite(entry.expires) && entry.expires > Date.now() && entry.expires <= Date.now() + 24 * 60 * 60 * 1000 && (entry.value === null || safeBanner(entry.value,id)?.startsWith('https://s4.anilist.co/'))) return entry;
    } catch { /* Storage can be disabled without affecting banners. */ }
    return null;
  }
  function cacheAutomatic(id,value,ttl) {
    const entry = {value,expires:Date.now()+ttl}; automatic.set(id,entry);
    try { localStorage.setItem(PREFIX+id,JSON.stringify(entry)); } catch { /* Memory cache remains available. */ }
    return value;
  }
  async function automaticBanner(id) {
    const cached = automatic.get(id) || stored(id);
    if (cached && cached.expires > Date.now()) { automatic.set(id,cached); return cached.value; }
    try {
      const response = await timedFetch('https://graphql.anilist.co',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({query:'query HeroBanner($id: Int!) { Media(idMal: $id, type: ANIME) { idMal bannerImage } }',variables:{id}})});
      if (!response.ok) throw new Error('banner_request_failed');
      const payload = await response.json();
      if (payload.errors || !payload.data || (payload.data.Media && payload.data.Media.idMal !== id)) throw new Error('banner_response_invalid');
      const value = safeBanner(payload.data.Media?.bannerImage,id);
      return cacheAutomatic(id,value,value ? 24*60*60*1000 : 6*60*60*1000);
    } catch { return cacheAutomatic(id,null,5*60*1000); }
  }
  const POSTER_PREFIX = 'anime-takvimi-posters-v1:';
  const posterCache = new Map(), posterPending = new Map();
  let posterTimer = null;
  function safePoster(value) {
    if(typeof value !== 'string' || value.length > 2048)return null;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash && url.hostname === 's4.anilist.co' && /^\/file\/anilistcdn\/media\/anime\/cover\/(?:large|medium)\/[A-Za-z0-9_.-]+\.(?:jpe?g|png|webp)$/.test(url.pathname) ? url.href : null;
    } catch {return null;}
  }
  function cachedPoster(id) {
    let entry=posterCache.get(id);
    if(!entry)try {entry=JSON.parse(localStorage.getItem(POSTER_PREFIX+id)||'null');}catch {}
    const now=Date.now();
    if(entry && Number.isFinite(entry.expires) && entry.expires>now && entry.expires<=now+24*60*60*1000 && (entry.value===null || safePoster(entry.value)))return entry;
    return null;
  }
  function cachePoster(id,value,ttl) {
    const entry={value,expires:Date.now()+ttl};posterCache.set(id,entry);
    try {localStorage.setItem(POSTER_PREFIX+id,JSON.stringify(entry));}catch {}
    return value;
  }
  async function flushPosters() {
    posterTimer=null;
    const batch=[...posterPending].filter(([,job])=>!job.started).slice(0,12);
    if(!batch.length)return;
    for(const [,job] of batch)job.started=true;
    try {
      const query='query PosterFallback { '+batch.map(([id])=>`p${id}: Media(idMal: ${id}, type: ANIME) { idMal coverImage { extraLarge large } }`).join(' ')+' }';
      const response=await timedFetch('https://graphql.anilist.co',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({query})});
      if(!response.ok)throw new Error('poster_request_failed');
      const payload=await response.json();
      for(const [id,job] of batch) {
        const media=payload.data?.['p'+id];
        const value=media?.idMal===id ? safePoster(media.coverImage?.extraLarge)||safePoster(media.coverImage?.large) : null;
        const ttl=value ? 24*60*60*1000 : media===null && !payload.errors ? 6*60*60*1000 : 60*1000;
        job.resolve(cachePoster(id,value,ttl));
      }
    } catch {for(const [id,job] of batch)job.resolve(cachePoster(id,null,60*1000));}
    finally {
      for(const [id] of batch)posterPending.delete(id);
      if([...posterPending.values()].some(job=>!job.started) && posterTimer===null)posterTimer=setTimeout(flushPosters,100);
    }
  }
  function resolvePoster(value) {
    const id=idOf(value);if(!id)return Promise.resolve(null);
    const cached=cachedPoster(id);if(cached)return Promise.resolve(cached.value);
    if(posterPending.has(id))return posterPending.get(id).promise;
    let finish;const promise=new Promise(resolve=>{finish=resolve;});
    posterPending.set(id,{promise,resolve:finish,started:false});
    if(posterTimer===null && ![...posterPending.values()].some(job=>job.started))posterTimer=setTimeout(flushPosters,60);
    return promise;
  }
  async function overrideBanner(id,generation) {
    const cached = overrides.get(id);
    if (cached && cached.expires > Date.now()) return cached.value;
    try {
      const response = await timedFetch(`/api/banners/${id}`,{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
      if (!response.ok) throw new Error('banner_override_failed');
      const payload = await response.json(); const value = safeBanner(payload.bannerUrl,id);
      if ((generations.get(id) || 0) === generation) overrides.set(id,{value,expires:Date.now()+60000});
      return value;
    } catch {
      if ((generations.get(id)||0) === generation) overrides.set(id,{value:null,expires:Date.now()+30000});
      return null;
    }
  }
  function resolve(value) {
    const id = idOf(value); if (!id) return Promise.resolve(null);
    const generation = generations.get(id) || 0; const key = `${id}:${generation}`;
    if (pending.has(key)) return pending.get(key);
    const promise = (async () => (await overrideBanner(id,generation)) || await automaticBanner(id))();
    pending.set(key,promise); promise.finally(() => pending.delete(key));
    return promise;
  }
  function invalidate(value) {
    const id = idOf(value); if (!id) return;
    overrides.delete(id); generations.set(id,(generations.get(id)||0)+1);
  }
  async function mutation(value,options) {
    const id = idOf(value); if (!id) throw new Error('Geçerli bir MyAnimeList anime numarası girin.');
    const response = await timedFetch(`/api/banners/${id}`,{...options,credentials:'same-origin',cache:'no-store'});
    let payload; try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok) throw new Error(payload?.error?.message || 'Banner güncellenemedi. Tekrar deneyin.');
    invalidate(id); overrides.set(id,{value:safeBanner(payload?.bannerUrl,id),expires:Date.now()+60000});
    window.dispatchEvent(new CustomEvent('anime:bannerchange',{detail:{malId:id}}));
    return payload;
  }
  window.AnimeBanners = Object.freeze({
    resolve, invalidate, safeBanner, resolvePoster, safePoster,
    upload(value,file) {
      if (!file || !['image/png','image/jpeg','image/webp'].includes(file.type)) return Promise.reject(new Error('PNG, JPEG veya WebP bir yatay görsel seçin.'));
      if (!file.size || file.size > 2*1024*1024) return Promise.reject(new Error('Banner en fazla 2 MB olabilir.'));
      return mutation(value,{method:'POST',headers:{'Content-Type':file.type},body:file});
    },
    remove: value => mutation(value,{method:'DELETE'}),
  });
})();
