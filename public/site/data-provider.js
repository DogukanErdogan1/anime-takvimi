(() => {
  'use strict';
  const BASE = 'https://api.tenrai.org/v1';
  const CACHE_PREFIX = 'anime-takvimi-data-v1:';
  const CACHE_TTL = 6 * 60 * 60 * 1000;
  const SEASONS = ['winter', 'spring', 'summer', 'fall'];
  const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const GENRES = {
    Action: 'Aksiyon', Adventure: 'Macera', Comedy: 'Komedi', Drama: 'Dram', Fantasy: 'Fantastik',
    Horror: 'Korku', Mystery: 'Gizem', Romance: 'Romantik', 'Sci-Fi': 'Bilim Kurgu', Sports: 'Spor',
    Supernatural: 'Doğaüstü', Suspense: 'Gerilim', 'Slice of Life': 'Yaşamdan Kesit', Music: 'Müzik',
    AwardWinning: 'Ödüllü', 'Award Winning': 'Ödüllü', Historical: 'Tarih', School: 'Okul',
    Military: 'Askerî', 'Martial Arts': 'Dövüş Sanatları', Psychological: 'Psikolojik',
    Isekai: 'Isekai', Mecha: 'Mecha', Space: 'Uzay', Detective: 'Dedektif', Medical: 'Tıp',
    'Team Sports': 'Takım Sporları', 'Time Travel': 'Zaman Yolculuğu', 'Video Game': 'Video Oyunları',
    Reincarnation: 'Reenkarnasyon', 'Adult Cast': 'Yetişkin Karakterler', 'Performing Arts': 'Sahne Sanatları'
  };
  const STATUS = {'Currently Airing': 'Yayında', 'Finished Airing': 'Tamamlandı', 'Not yet aired': 'Henüz yayımlanmadı'};
  let queue = Promise.resolve();
  let lastRequest = 0;
  const text = (value, max = 8000) => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').trim().slice(0, max) : '';
  const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  const count = value => Number.isInteger(value) && value > 0 ? value : null;
  function abortError() { return new DOMException('İstek iptal edildi.', 'AbortError'); }
  function checkAbort(signal) { if (signal?.aborted) throw abortError(); }

  function safeImage(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      if (!['cdn.myanimelist.net', 'myanimelist.net', 'www.myanimelist.net'].includes(url.hostname)) return null;
      return url.href;
    } catch { return null; }
  }

  function dateParts(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-GB', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'long'}).formatToParts(date);
    return Object.fromEntries(parts.map(part => [part.type, part.value]));
  }

  function broadcastInTurkey(broadcast, referenceDate = new Date()) {
    const unknown = {day: null, time: null, broadcastLocal: false};
    if (!broadcast || typeof broadcast !== 'object') return unknown;
    const sourceDay = DAY_NAMES.indexOf(text(broadcast.day, 30).toLowerCase().replace(/s$/, ''));
    const match = text(broadcast.time, 10).match(/^(\d{2}):(\d{2})$/);
    const zone = text(broadcast.timezone, 100);
    if (sourceDay < 0 || !match || !zone || +match[1] > 23 || +match[2] > 59) return unknown;
    try {
      const local = dateParts(new Date(referenceDate), zone);
      const todayIndex = DAY_NAMES.indexOf(local.weekday.toLowerCase());
      const calendarDate = new Date(Date.UTC(+local.year, +local.month - 1, +local.day + sourceDay - todayIndex));
      const desired = Date.UTC(calendarDate.getUTCFullYear(), calendarDate.getUTCMonth(), calendarDate.getUTCDate(), +match[1], +match[2]);
      let instant = desired;
      for (let i = 0; i < 3; i++) {
        const p = dateParts(new Date(instant), zone);
        const offset = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - instant;
        instant = desired - offset;
      }
      const turkey = dateParts(new Date(instant), 'Europe/Istanbul');
      const day = DAY_NAMES.indexOf(turkey.weekday.toLowerCase());
      return {day, time: `${turkey.hour}:${turkey.minute}`, broadcastLocal: day >= 0};
    } catch { return unknown; }
  }

  function normalize(raw) {
    if (!raw || !count(raw.mal_id)) return null;
    const title = text(raw.title, 500);
    if (!title) return null;
    const image = [raw.images?.webp?.large_image_url, raw.images?.jpg?.large_image_url, raw.images?.webp?.image_url, raw.images?.jpg?.image_url].map(safeImage).find(Boolean) || null;
    const type = text(raw.type, 30);
    const genres = [...new Set((Array.isArray(raw.genres) ? raw.genres : []).concat(Array.isArray(raw.themes) ? raw.themes : []).map(g => text(g?.name, 100)).filter(Boolean).map(g => GENRES[g] || g))];
    const studios = (Array.isArray(raw.studios) ? raw.studios : []).map(studio => text(studio?.name, 150)).filter(Boolean);
    const durationText = text(raw.duration, 120);
    const hours = durationText.match(/(\d+)\s*hr/);
    const minutes = durationText.match(/(\d+)\s*min/);
    const duration = hours || minutes ? (+(hours?.[1] || 0) * 60 + +(minutes?.[1] || 0)) : null;
    const score = positive(raw.score);
    return {
      id: `mal-${raw.mal_id}`, malId: raw.mal_id, title, original: text(raw.title_english, 500) || title,
      synonyms: (Array.isArray(raw.title_synonyms) ? raw.title_synonyms : []).map(s => text(s, 500)).filter(Boolean),
      image, malUrl: `https://myanimelist.net/anime/${raw.mal_id}`,
      format: ({TV: 'TV', Movie: 'Film', OVA: 'OVA', ONA: 'ONA', Special: 'Özel', 'TV Special': 'Özel', Music: 'Müzik'})[type] || type || 'Diğer',
      genres, rating: score && score <= 10 ? score : null, episodes: count(raw.episodes), duration, durationText,
      studio: studios.join(', ') || 'Stüdyo bilgisi yok', members: positive(raw.members) || 0,
      year: count(raw.year), season: SEASONS.includes(raw.season) ? raw.season : null,
      airing: raw.airing === true, status: STATUS[raw.status] || text(raw.status, 100) || 'Durum bilgisi yok',
      summary: text(raw.synopsis) || 'Bu anime için henüz bir özet bulunmuyor.',
      airedFrom: text(raw.aired?.from, 50) || null,
      broadcastSource: text(raw.broadcast?.string, 200) || null,
      ...broadcastInTurkey(raw.broadcast)
    };
  }

  function pause(ms, signal) {
    checkAbort(signal);
    return new Promise((resolve, reject) => {
      const done = () => { signal?.removeEventListener('abort', cancel); resolve(); };
      const timer = setTimeout(done, ms);
      const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(abortError()); };
      signal?.addEventListener('abort', cancel, {once: true});
    });
  }

  async function fetchOnce(url, signal) {
    checkAbort(signal);
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, {once: true});
    try {
      const response = await fetch(url, {signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', headers: {Accept: 'application/json'}});
      if (!response.ok) {
        const error = new Error(response.status === 429 ? 'Veri servisi yoğun. Biraz sonra tekrar deneyin.' : `Anime verisi alınamadı (HTTP ${response.status}).`);
        error.status = response.status;
        error.retryAfter = response.headers.get('Retry-After');
        throw error;
      }
      const result = await response.json();
      checkAbort(signal);
      return result;
    } catch (error) {
      if (signal?.aborted) throw abortError();
      if (timedOut) throw new Error('Veri servisi zamanında yanıt vermedi. Tekrar deneyebilirsiniz.');
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
    }
  }

  function request(path, signal) {
    const task = queue.then(async () => {
      checkAbort(signal);
      for (let attempt = 0; attempt < 3; attempt++) {
        const remaining = 550 - (Date.now() - lastRequest);
        if (remaining > 0) await pause(remaining, signal);
        checkAbort(signal);
        lastRequest = Date.now();
        try { return await fetchOnce(BASE + path, signal); }
        catch (error) {
          if (error.name === 'AbortError') throw error;
          if (error.status !== 429 || attempt === 2) throw error;
          const retrySeconds = Number(error.retryAfter);
          if (Number.isFinite(retrySeconds) && retrySeconds > 30) throw error;
          await pause(Number.isFinite(retrySeconds) && retrySeconds > 0 ? retrySeconds * 1000 : 1500 * (attempt + 1), signal);
        }
      }
    });
    queue = task.catch(() => {});
    return task;
  }

  function readCache(key) {
    try {
      const record = JSON.parse(localStorage.getItem(CACHE_PREFIX + key));
      if (!record || record.version !== 1 || !Array.isArray(record.anime) || !Number.isFinite(record.fetchedAt)) return null;
      if (!record.anime.every(item => item && /^mal-\d+$/.test(item.id) && typeof item.title === 'string')) return null;
      return record;
    } catch { return null; }
  }

  function writeCache(key, result) {
    try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({version: 1, ...result})); }
    catch { /* The catalogue still works when browser storage is full or disabled. */ }
  }

  async function paged(endpoint, {signal, onProgress} = {}) {
    const byId = new Map();
    for (let page = 1; page <= 20; page++) {
      checkAbort(signal);
      const separator = endpoint.includes('?') ? '&' : '?';
      const result = await request(`${endpoint}${separator}limit=100&page=${page}`, signal);
      if (!result || !Array.isArray(result.data)) throw new Error('Veri servisinden beklenmeyen bir yanıt geldi.');
      for (const raw of result.data) { const item = normalize(raw); if (item) byId.set(item.id, item); }
      onProgress?.(byId.size);
      if (result.pagination?.has_next_page !== true) return [...byId.values()];
      if (result.data.length === 0) throw new Error('Veri servisinin sayfalama yanıtı tutarsız.');
    }
    throw new Error('Bu sorgu için çok fazla sayfa döndü. Daha sonra tekrar deneyin.');
  }

  async function load(key, endpoint, options = {}) {
    const cached = readCache(key);
    checkAbort(options.signal);
    if (!options.force && cached && Date.now() - cached.fetchedAt < CACHE_TTL) return {...cached, stale: false, cached: true};
    try {
      const anime = await paged(endpoint, options);
      checkAbort(options.signal);
      const result = {anime, fetchedAt: Date.now(), source: 'MyAnimeList / Tenrai', stale: false, cached: false};
      writeCache(key, result);
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      if (cached) return {...cached, stale: true, cached: true};
      if (error.status) throw error;
      throw new Error(error.message && error.message !== 'Failed to fetch' ? error.message : 'Anime verisine bağlanılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.');
    }
  }

  function previewPosters(items) {
    const selected = [], ids = new Set(), images = new Set();
    for (const item of items) {
      if (!item || !count(item.malId) || item.id !== `mal-${item.malId}` || typeof item.title !== 'string' || !item.title.trim()) continue;
      const image = safeImage(item.image);
      if (!image || ids.has(item.malId) || images.has(image)) continue;
      selected.push({...item, image}); ids.add(item.malId); images.add(image);
      if (selected.length === 3) break;
    }
    return selected;
  }

  async function seasonPreview(year, season, {signal, force} = {}) {
    checkAbort(signal);
    const full = readCache(`season-${year}-${season}`);
    const fresh = record => record && Date.now() - record.fetchedAt >= 0 && Date.now() - record.fetchedAt < CACHE_TTL;
    const resultFromCache = (record, stale) => ({anime: previewPosters(record.anime), fetchedAt: record.fetchedAt, stale, cached: true, source: 'MyAnimeList / Tenrai'});
    if (!force && fresh(full)) {
      const result = resultFromCache(full, false); checkAbort(signal); return result;
    }
    const key = `season-preview-${year}-${season}`;
    const stored = readCache(key);
    // Preview records contain only selected posters; a damaged browser cache
    // must not turn unsafe or duplicated image entries into a fresh preview.
    const cached = stored && stored.anime.length <= 3 && previewPosters(stored.anime).length === stored.anime.length ? stored : null;
    if (!force && fresh(cached)) {
      const result = resultFromCache(cached, false); checkAbort(signal); return result;
    }
    try {
      const response = await request(`/seasons/${year}/${season}?sfw&order_by=members&sort=desc&limit=12&page=1`, signal);
      checkAbort(signal);
      if (!response || !Array.isArray(response.data)) throw new Error('Veri servisinden beklenmeyen bir yanıt geldi.');
      const anime = previewPosters(response.data.map(normalize).filter(Boolean));
      checkAbort(signal);
      const result = {anime, fetchedAt: Date.now(), stale: false, cached: false, source: 'MyAnimeList / Tenrai'};
      writeCache(key, result);
      return result;
    } catch (error) {
      checkAbort(signal);
      if (error.name === 'AbortError') throw error;
      if (cached) return resultFromCache(cached, true);
      if (error.status) throw error;
      throw new Error(error.message && error.message !== 'Failed to fetch' ? error.message : 'Anime verisine bağlanılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.');
    }
  }

  const searchCache = new Map();
  const SEARCH_CACHE_TTL = 5 * 60 * 1000;
  async function searchAnime(value, {signal} = {}) {
    checkAbort(signal);
    const query = text(value, 300).normalize('NFC').replace(/\s+/g, ' ');
    const source = 'MyAnimeList / Tenrai';
    if (query.length < 2) return {anime: [], fetchedAt: Date.now(), cached: false, source};
    const key = query.toLowerCase();
    const cached = searchCache.get(key);
    const age = cached ? Date.now() - cached.fetchedAt : Infinity;
    if (cached && age >= 0 && age < SEARCH_CACHE_TTL) {
      searchCache.delete(key); searchCache.set(key, cached);
      checkAbort(signal);
      return {...cached, anime: cached.anime.slice(), cached: true};
    }
    try {
      // Keep the service's relevance order and retrieve only the suggestion page.
      const response = await request(`/anime?sfw&q=${encodeURIComponent(query)}&limit=8&page=1`, signal);
      checkAbort(signal);
      if (!response || !Array.isArray(response.data)) throw new Error('Veri servisinden beklenmeyen bir yanıt geldi.');
      const anime = [], ids = new Set();
      for (const raw of response.data) {
        const item = normalize(raw);
        if (!item || ids.has(item.id)) continue;
        ids.add(item.id); anime.push(item);
        if (anime.length === 8) break;
      }
      checkAbort(signal);
      const result = {anime, fetchedAt: Date.now(), cached: false, source};
      searchCache.delete(key); searchCache.set(key, result);
      while (searchCache.size > 50) searchCache.delete(searchCache.keys().next().value);
      return {...result, anime: anime.slice()};
    } catch (error) {
      checkAbort(signal);
      if (error.name === 'AbortError' || error.status) throw error;
      throw new Error(error.message && error.message !== 'Failed to fetch' ? error.message : 'Anime aramasına bağlanılamadı. Tekrar deneyebilirsin.');
    }
  }

  const detailCache = new Map();
  async function getDetails(malId, {signal} = {}) {
    checkAbort(signal);
    if (!Number.isInteger(malId) || malId < 1 || malId > 2147483647) throw new Error('Geçersiz anime numarası.');
    const cached = detailCache.get(malId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) return cached.data;
    const response = await request(`/anime/${malId}/full`, signal); checkAbort(signal);
    if (!response?.data || response.data.mal_id !== malId) throw new Error('Anime ayrıntıları alınamadı.');
    const raw = response.data, youtubeId = raw.trailer?.youtube_id;
    const trailerUrl = typeof youtubeId === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(youtubeId) ? `https://www.youtube.com/watch?v=${youtubeId}` : null;
    const relations = [], ids = new Set();
    for (const group of (Array.isArray(raw.relations) ? raw.relations : [])) for (const entry of (Array.isArray(group?.entry) ? group.entry : [])) {
      if (entry?.type !== 'anime' || !Number.isInteger(entry.mal_id) || entry.mal_id < 1 || entry.mal_id > 2147483647 || ids.has(entry.mal_id)) continue;
      ids.add(entry.mal_id); relations.push({id:entry.mal_id,title:text(entry.name,500) || `MyAnimeList #${entry.mal_id}`,url:`https://myanimelist.net/anime/${entry.mal_id}`});
      if (relations.length >= 20) break;
    }
    const data = {trailerUrl,relations:relations.slice(0,20)};
    detailCache.set(malId,{fetchedAt:Date.now(),data}); return data;
  }

  window.AnimeData = Object.freeze({
    normalize,
    safeImage,
    broadcastInTurkey,
    loadSeason(year, season, options = {}) {
      if (!Number.isInteger(year) || year < 1917 || year > 2999 || !SEASONS.includes(season)) return Promise.reject(new Error('Geçersiz sezon seçimi.'));
      return load(`season-${year}-${season}`, `/seasons/${year}/${season}?sfw&order_by=members&sort=desc`, options);
    },
    getSeasonPreview(year, season, options = {}) {
      if (!Number.isInteger(year) || year < 1917 || year > 2999 || !SEASONS.includes(season)) return Promise.reject(new Error('Geçersiz sezon seçimi.'));
      return seasonPreview(year, season, options);
    },
    getSchedule(options = {}) { return load('schedules', '/schedules?sfw', options); },
    getDetails,
    searchAnime
  });
})();
