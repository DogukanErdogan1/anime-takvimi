import {validateAvatarBytes, MAX_AVATAR_BYTES} from './avatar.mjs';

export class PosterError extends Error {
  constructor(status, message) {super(message); this.name = 'PosterError'; this.status = status;}
}
export function posterId(value) {
  if (!/^[1-9]\d{0,9}$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) throw new PosterError(400, 'Geçersiz anime numarası.');
  return Number(value);
}
export function safePosterSource(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash && url.hostname === 'cdn.myanimelist.net' && /^\/images\/anime\/\d+\/[A-Za-z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(url.pathname) ? url.href : null;
  } catch {return null;}
}
async function boundedBytes(response, limit) {
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) {await response.body?.cancel(); throw new PosterError(503, 'Afiş boyutu desteklenmiyor.');}
  if (!response.body) throw new PosterError(503, 'Afiş yanıtı boş.');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const {value, done} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) {await reader.cancel(); throw new PosterError(503, 'Afiş boyutu desteklenmiyor.');}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
  return bytes;
}

// Only canonical MAL identifiers and provider-verified anime image paths reach
// the network. Browser cookies, caller URLs and account data are never forwarded.
export function createPosterService(options = {}) {
  const fetcher = options.fetcher || fetch, now = options.now || Date.now;
  const cache = new Map(), failures = new Map(), pending = new Map();
  const ttl = options.ttl ?? 86400000, spacing = options.spacingMs ?? 350;
  const maxBytes = options.maxCacheBytes ?? 16 * 1024 * 1024;
  let bytesUsed = 0, active = 0, lastStart = -Infinity;
  function remember(id, image) {
    if (cache.has(id)) bytesUsed -= cache.get(id).bytes.byteLength;
    cache.delete(id); cache.set(id, image); bytesUsed += image.bytes.byteLength;
    while (cache.size > 64 || bytesUsed > maxBytes) {const key = cache.keys().next().value; bytesUsed -= cache.get(key).bytes.byteLength; cache.delete(key);}
  }
  async function load(id) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 12000);
    const request = url => fetcher(url, {signal: controller.signal, credentials: 'omit', redirect: 'manual', headers: {Accept: url.startsWith('https://api.tenrai.org/') ? 'application/json' : 'image/webp,image/jpeg,image/png'}});
    try {
      const response = await request(`https://api.tenrai.org/v1/anime/${id}`);
      if (response.status === 404) throw new PosterError(404, 'Afiş bulunamadı.');
      if (!response.ok) throw new PosterError(503, 'Afiş kaynağı geçici olarak kullanılamıyor.');
      const json = JSON.parse(new TextDecoder().decode(await boundedBytes(response, 256 * 1024)));
      if (json.data?.mal_id !== id) throw new PosterError(503, 'Afiş kaydı doğrulanamadı.');
      const images = json.data.images;
      const sources = [...new Set([images?.webp?.large_image_url, images?.jpg?.large_image_url, images?.webp?.image_url, images?.jpg?.image_url].map(safePosterSource).filter(Boolean))];
      if (!sources.length) throw new PosterError(404, 'Bu anime için afiş bulunamadı.');
      for (const source of sources) {
        if (controller.signal.aborted) break;
        try {
          const upstream = await request(source);
          if (!upstream.ok) {await upstream.body?.cancel(); continue;}
          const contentType = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
          if (!['image/jpeg','image/webp','image/png'].includes(contentType)) {await upstream.body?.cancel(); continue;}
          const bytes = await boundedBytes(upstream, MAX_AVATAR_BYTES);
          validateAvatarBytes(bytes, contentType);
          const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
          const image = {bytes, contentType, etag: `"poster-${id}-${digest}"`, fetchedAt: now()};
          remember(id, image); failures.delete(id); return image;
        } catch { /* Try the provider's JPEG or standard-size alternative. */ }
      }
      throw new PosterError(503, 'Afiş geçici olarak yüklenemedi.');
    } catch (error) {
      const previous = cache.get(id);
      if (previous && now() - previous.fetchedAt < 7 * 86400000) return {...previous, stale: true};
      const failure = error instanceof PosterError ? error : new PosterError(503, 'Afiş geçici olarak yüklenemedi.');
      failures.delete(id); failures.set(id, {error: failure, expires: now() + 2000});
      while (failures.size > 64) failures.delete(failures.keys().next().value);
      throw failure;
    } finally {clearTimeout(timeout);}
  }
  return {
    get(value) {
      let id; try {id = posterId(value);} catch (error) {return Promise.reject(error);}
      const image = cache.get(id);
      if (image && now() - image.fetchedAt < ttl) {cache.delete(id); cache.set(id, image); return Promise.resolve(image);}
      if (pending.has(id)) return pending.get(id);
      const failure = failures.get(id);
      if (failure?.expires > now()) return Promise.reject(failure.error);
      if (pending.size >= 26) return Promise.reject(new PosterError(503, 'Afiş kuyruğu dolu. Biraz sonra yeniden dene.'));
      const promise = (async () => {
        // Wait inside this request's context: starting another request's fetch
        // from a shared queue callback is not supported by Cloudflare Workers.
        while (active >= 2 || now() - lastStart < spacing) await new Promise(resolve => setTimeout(resolve, Math.max(10, spacing - (now() - lastStart))));
        active++; lastStart = now();
        try {return await load(id);} finally {active--; pending.delete(id);}
      })();
      pending.set(id, promise); return promise;
    },
  };
}
