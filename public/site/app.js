(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const icon = name => typeof window.icon === 'function' ? window.icon(name) : '';
  const fold = value => String(value ?? '').normalize('NFC').toLocaleLowerCase('tr-TR');
  const days = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
  const shortDays = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
  const seasons = ['Kış', 'İlkbahar', 'Yaz', 'Sonbahar'];
  const seasonKeys = ['winter', 'spring', 'summer', 'fall'];
  const storageBase = 'anime-takvimi-mal-v1';
  let storageKey = storageBase;
  let accountScope = null;
  const byId = new Map();
  const state = {
    page: 'discover', format: 'TV', genre: 'all', sort: 'popular', query: '',
    view: 'grid', limit: 5, hero: 0, quarter: 3, year: 2026,
    saved: new Set(), reminders: new Set(), progress: {}, dialogId: null,
    catalog: [], catalogKey: null, catalogMeta: null, catalogLoading: false, catalogError: null, catalogProgress: '',
    schedule: [], scheduleMeta: null, scheduleLoading: false, scheduleError: null,
    day: 0, todayDay: 0, week: [], todayKey: ''
  };
  let seasonRequest = 0;
  let scheduleRequest = 0;
  let seasonController;
  let scheduleController;
  let storageAvailable = true;
  let toastTimer;
  let heroImageRequest = 0;

  function safeImage(value) {
    if (typeof window.AnimeData?.safeImage === 'function') return window.AnimeData.safeImage(value);
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && ['cdn.myanimelist.net', 'myanimelist.net', 'www.myanimelist.net'].includes(url.hostname) ? url.href : null;
    } catch (_) { return null; }
  }

  function safeMalUrl(value, malId) {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && url.hostname === 'myanimelist.net' && /^\/anime\/\d+(?:\/|$)/.test(url.pathname)) return url.href;
    } catch (_) { /* Use the verified MAL identifier below. */ }
    return Number.isInteger(malId) && malId > 0 ? `https://myanimelist.net/anime/${malId}` : null;
  }

  function normalize(item) {
    if (!item || typeof item !== 'object') return null;
    const idNumber = Number(item.malId || String(item.id || '').replace(/^mal-/, ''));
    if (!Number.isSafeInteger(idNumber) || idNumber <= 0) return null;
    const episodes = Number.isInteger(item.episodes) && item.episodes > 0 && item.episodes <= 9999 ? item.episodes : null;
    const rating = typeof item.rating === 'number' && Number.isFinite(item.rating) && item.rating > 0 && item.rating <= 10 ? item.rating : null;
    return {
      id: `mal-${idNumber}`, malId: idNumber,
      title: String(item.title || item.original || `MyAnimeList #${idNumber}`), original: String(item.original || ''),
      synonyms: Array.isArray(item.synonyms) ? item.synonyms.map(String) : [],
      image: safeImage(item.image), format: String(item.format || 'Özel'),
      genres: Array.isArray(item.genres) ? item.genres.map(String).filter(Boolean).slice(0, 20) : [],
      rating, episodes, duration: typeof item.duration === 'number' && item.duration > 0 ? item.duration : null,
      durationText: String(item.durationText || ''), studio: String(item.studio || 'Stüdyo açıklanmadı'),
      day: Number.isInteger(item.day) && item.day >= 0 && item.day <= 6 ? item.day : null,
      time: typeof item.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.time) ? item.time : null,
      broadcastLocal: item.broadcastLocal === true, airing: item.airing === true,
      status: String(item.status || 'Durum açıklanmadı'), summary: String(item.summary || ''),
      malUrl: safeMalUrl(item.malUrl, idNumber), members: Number.isFinite(Number(item.members)) ? Math.max(0, Number(item.members)) : 0,
      year: Number.isInteger(item.year) ? item.year : null, season: typeof item.season === 'string' ? item.season : null,
      airedFrom: typeof item.airedFrom === 'string' ? item.airedFrom : null,
      broadcastSource: typeof item.broadcastSource === 'string' ? item.broadcastSource : null
    };
  }

  function register(items) {
    const normalized = [];
    const seen = new Set();
    (Array.isArray(items) ? items : []).forEach(raw => {
      const item = normalize(raw);
      if (!item || seen.has(item.id)) return;
      seen.add(item.id); normalized.push(item); byId.set(item.id, item);
    });
    return normalized;
  }

  function installLibrary(stored) {
      state.saved = new Set(); state.reminders = new Set(); state.progress = {}; state.view = 'grid';
      if (!stored || typeof stored !== 'object') return;
      const validId = id => typeof id === 'string' && /^mal-[1-9]\d*$/.test(id);
      if (Array.isArray(stored.saved)) state.saved = new Set(stored.saved.filter(validId));
      if (Array.isArray(stored.reminders)) state.reminders = new Set(stored.reminders.filter(validId));
      if (stored.progress && typeof stored.progress === 'object') Object.entries(stored.progress).forEach(([id, value]) => {
        if (validId(id)) state.progress[id] = Math.min(9999, Math.max(0, Math.floor(Number(value) || 0)));
      });
      if (stored.savedAnime && typeof stored.savedAnime === 'object') register(Object.values(stored.savedAnime));
      // Preserve an identifier even if old stored metadata was missing or damaged.
      new Set([...state.saved, ...state.reminders, ...Object.keys(state.progress)]).forEach(id => {
        if (!byId.has(id)) { const item = normalize({ id }); if (item) byId.set(id, item); }
      });
      if (['grid', 'list'].includes(stored.view)) state.view = stored.view;
  }

  function restore() {
    try {
      installLibrary(JSON.parse(localStorage.getItem(storageKey) || 'null'));
    } catch (_) { storageAvailable = false; }
  }

  function getLibrarySnapshot() {
    const savedAnime = {};
    new Set([...state.saved, ...state.reminders, ...Object.keys(state.progress)]).forEach(id => {
      if (byId.has(id)) savedAnime[id] = byId.get(id);
    });
    return JSON.parse(JSON.stringify({ saved: [...state.saved], reminders: [...state.reminders], progress: state.progress, view: state.view, savedAnime }));
  }

  function persist(emit = true) {
    const snapshot = getLibrarySnapshot();
    try {
      localStorage.setItem(storageKey, JSON.stringify(snapshot));
    } catch (_) {
      storageAvailable = false;
      toast('Tarayıcı depolaması kullanılamıyor; değişikliklerin bu oturumda korunacak.');
    }
    if (emit) window.dispatchEvent(new CustomEvent('anime:librarychange', { detail: snapshot }));
  }

  function replaceLibrarySnapshot(library, { emit = false } = {}) {
    installLibrary(library); persist(emit); updateGenres(); refresh();
  }

  function setAccountScope(userId, library) {
    if (typeof userId !== 'string' || !userId.trim()) return;
    accountScope = userId; storageKey = `${storageBase}:${userId}`;
    installLibrary(null); restore();
    if (library !== undefined) installLibrary(library);
    if (library !== undefined) persist(false);
    updateGenres(); refresh();
  }

  function setGuestScope() {
    accountScope = null; storageKey = storageBase;
    installLibrary(null); restore(); updateGenres(); refresh();
  }

  function toast(message) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message; el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), 4000);
  }

  function updateDates() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
    const today = new Date(Date.UTC(values.year, values.month - 1, values.day));
    const weekday = (today.getUTCDay() + 6) % 7;
    const key = `${values.year}-${values.month}-${values.day}`;
    if (state.todayKey && state.day === state.todayDay) state.day = weekday;
    if (!state.todayKey) state.day = weekday;
    state.todayDay = weekday; state.todayKey = key;
    const monday = new Date(today); monday.setUTCDate(today.getUTCDate() - weekday);
    state.week = days.map((_, index) => { const date = new Date(monday); date.setUTCDate(monday.getUTCDate() + index); return date; });
  }

  function dateLabel(date, options = {}) {
    return new Intl.DateTimeFormat('tr-TR', { timeZone: 'UTC', day: 'numeric', month: 'long', ...options }).format(date);
  }
  function weekLabel() { return `${dateLabel(state.week[0])} – ${dateLabel(state.week[6], { year: 'numeric' })}`; }
  function seasonLabel() { return `${seasons[state.quarter]} ${state.year}`; }
  function selectedKey() { return `${state.year}-${seasonKeys[state.quarter]}`; }
  function knownBroadcast(item) { return item.airing && item.day !== null && Boolean(item.time); }
  function savedItems() { return [...state.saved].map(id => byId.get(id)).filter(Boolean); }
  function totalText(item) { return item.episodes ? `${item.episodes} bölüm` : 'Bölüm sayısı belirsiz'; }
  function scoreText(item) { return item.rating === null ? '—' : item.rating.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }); }
  function countProgress(item) { return Math.min(item.episodes || 9999, Math.max(0, Math.floor(Number(state.progress[item.id]) || 0))); }
  function progressText(item) { return item.episodes ? `${countProgress(item)} / ${item.episodes} bölüm` : `${countProgress(item)} bölüm izlendi`; }
  function progressBar(item) { return item.episodes ? `<div class="progress-track"><div class="progress-fill" style="width:${Math.round(countProgress(item) / item.episodes * 100)}%"></div></div>` : ''; }
  function broadcastText(item) {
    if (item.day === null || !item.time) return 'Yayın saati açıklanmadı';
    return `${days[item.day]} · ${item.time} (${item.broadcastLocal ? 'Türkiye saati' : item.broadcastSource || 'kaynak saati'})`;
  }

  function matches(item, respectFormat = true) {
    const query = fold(state.query.trim());
    const haystack = fold([item.title, item.original, item.studio, ...item.synonyms, ...item.genres].join(' '));
    return (!query || haystack.includes(query)) && (!respectFormat || state.format === 'all' || state.format === item.format) && (state.genre === 'all' || item.genres.includes(state.genre));
  }

  function sorted(items) {
    const copy = [...items];
    if (state.sort === 'rating') return copy.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || b.members - a.members);
    if (state.sort === 'title') return copy.sort((a, b) => a.title.localeCompare(b.title, 'tr'));
    if (state.sort === 'airtime') return copy.sort((a, b) => (a.day ?? 9) - (b.day ?? 9) || (a.time || '99:99').localeCompare(b.time || '99:99'));
    return copy.sort((a, b) => b.members - a.members || (b.rating ?? -1) - (a.rating ?? -1));
  }

  function updateGenres() {
    const select = $('#genre');
    if (!select) return;
    const source = state.page === 'watchlist' ? savedItems() : state.page === 'schedule' ? state.schedule : state.catalog;
    const genres = [...new Set(source.flatMap(item => item.genres))].sort((a, b) => a.localeCompare(b, 'tr'));
    if (!genres.includes(state.genre)) state.genre = 'all';
    select.innerHTML = '<option value="all">Tüm türler</option>' + genres.map(genre => `<option value="${escape(genre)}">${escape(genre)}</option>`).join('');
    select.value = state.genre;
  }

  function chips(item, limit = Infinity) { return item.genres.slice(0, limit).map(genre => `<span class="genre-chip">${escape(genre)}</span>`).join(''); }
  function poster(item, { eager = false } = {}) {
    return `${item.image ? `<img src="${escape(item.image)}" alt="${escape(item.title)} posteri" loading="${eager ? 'eager' : 'lazy'}" decoding="async" referrerpolicy="no-referrer">` : ''}<span class="image-placeholder"${item.image ? ' hidden' : ''}>${icon('bookmark')}<span>Poster bulunamadı</span></span>`;
  }
  function art(item, classes) { return `<div class="${classes} art remote-art">${poster(item)}</div>`; }
  function bookmarkButton(item) {
    const saved = state.saved.has(item.id);
    return `<button class="bookmark-button${saved ? ' is-saved' : ''}" type="button" data-action="save" data-id="${item.id}" aria-pressed="${saved}" aria-label="${escape(item.title)} ${saved ? 'listemden çıkar' : 'listeme ekle'}" title="${saved ? 'Listemden çıkar' : 'Listeme ekle'}">${icon(saved ? 'check' : 'plus')}</button>`;
  }
  function reminderButton(item) {
    const active = state.reminders.has(item.id);
    return `<button type="button" class="reminder-button${active ? ' is-active' : ''}" data-action="reminder" data-id="${item.id}" aria-pressed="${active}" aria-label="${escape(item.title)} ${active ? 'takip işaretini kaldır' : 'için takip işareti ekle'}" title="${active ? 'Takip işaretini kaldır' : 'Yerel takip işareti ekle'}">${icon(active ? 'bell-ring' : 'bell')}</button>`;
  }

  function card(item, watchlist = false) {
    const progress = countProgress(item);
    const complete = item.episodes !== null && progress >= item.episodes;
    const day = item.day === null ? item.format : days[item.day];
    return `<article class="anime-card${watchlist ? ' watchlist-card' : ''}"><button class="card-art art remote-art" type="button" data-action="detail" data-id="${item.id}" aria-label="${escape(item.title)} detaylarını gör">${poster(item)}</button><div class="card-body"><div class="card-meta"><h3 class="card-title"><button type="button" class="title-button" data-action="detail" data-id="${item.id}">${escape(item.title)}</button></h3><span class="card-rating" title="MyAnimeList puanı">${icon('star')}<strong>${scoreText(item)}</strong></span></div><div class="card-genres">${item.genres.length ? `<span class="genre-chip">${escape(item.genres.slice(0, 2).join(' · '))}</span>` : `<span class="genre-chip">${escape(item.format)}</span>`}</div>${watchlist ? `<div class="watchlist-progress"><span>${progressText(item)}</span>${progressBar(item)}<button type="button" class="progress-inline" data-action="progress" data-id="${item.id}" data-delta="1"${complete || progress >= 9999 ? ' disabled' : ''}>${icon(complete ? 'check' : 'plus')}${complete ? 'Tamamlandı' : 'Bölüm izledim'}</button></div>` : ''}<div class="card-bottom"><span>${escape(day)} · ${totalText(item)}</span>${bookmarkButton(item)}</div></div></article>`;
  }

  function skeletons() {
    return Array.from({ length: 3 }, () => '<div class="anime-card skeleton-card" aria-hidden="true"><div class="card-art"></div><div class="card-body"><div class="skeleton-line"></div><div class="skeleton-line short"></div></div></div>').join('');
  }

  function renderWeekly() {
    const entries = state.schedule.filter(item => knownBroadcast(item) && matches(item));
    $('#card-grid').innerHTML = `<div class="weekly-schedule">${days.map((day, index) => {
      const daily = entries.filter(item => item.day === index).sort((a, b) => a.time.localeCompare(b.time));
      return `<section class="weekly-day${index === state.day ? ' selected-day' : ''}" aria-label="${escape(dateLabel(state.week[index]))} ${day}"><h3><span>${day}</span><small>${escape(dateLabel(state.week[index]))}</small></h3><div class="weekly-entries">${daily.length ? daily.map(item => `<article class="weekly-entry">${art(item, 'weekly-art')}<div class="weekly-copy"><span class="weekly-time">${icon('clock')}${escape(item.time)}${item.broadcastLocal ? '' : '<small>Kaynak saati</small>'}</span><h4><button class="title-button" type="button" data-action="detail" data-id="${item.id}">${escape(item.title)}</button></h4><span class="weekly-meta">Haftalık yayın · ${escape(item.format)}</span></div>${reminderButton(item)}</article>`).join('') : '<p class="aside-empty">Bu gün için saat bilgisi bulunan yayın yok.</p>'}</div></section>`;
    }).join('')}</div>`;
    return entries.length;
  }

  function renderEmpty(count, loading, error) {
    const empty = $('#empty-state');
    if (!empty) return;
    empty.hidden = count > 0 || loading || Boolean(error);
    if (empty.hidden) return;
    const hasFilters = Boolean(state.query.trim()) || state.genre !== 'all' || state.format !== 'all';
    const emptyList = state.page === 'watchlist' && state.saved.size === 0;
    const title = emptyList ? 'Listen henüz boş' : hasFilters ? 'Sonuç bulunamadı' : state.page === 'schedule' ? 'Saat bilgisi bulunan yayın yok' : 'Bu sezon için anime bulunamadı';
    const text = emptyList ? 'Keşfet sayfasındaki + düğmesiyle animeleri kendi listene ekle.' : state.page === 'schedule' ? 'Yayın saati açıklanmayan animeler takvimde gösterilmez.' : hasFilters ? 'Başka bir başlık dene veya filtreleri temizle.' : 'Başka bir sezon seçebilir veya verileri yenileyebilirsin.';
    empty.innerHTML = `${icon(emptyList ? 'bookmark' : 'search')}<h3>${title}</h3><p>${text}</p>${emptyList ? '<button type="button" class="empty-action" data-action="discover">Animeleri keşfet</button>' : hasFilters ? '<button type="button" class="empty-action" data-action="clear">Filtreleri temizle</button>' : '<button type="button" class="empty-action" data-action="retry">Yeniden dene</button>'}`;
  }

  function renderCatalog() {
    const grid = $('#card-grid');
    if (!grid) return;
    const weekly = state.page === 'schedule';
    const personal = state.page === 'watchlist';
    const loading = !personal && (weekly ? state.scheduleLoading && !state.schedule.length : state.catalogLoading && !state.catalog.length);
    const error = !personal && (weekly ? state.scheduleError && !state.schedule.length : state.catalogError && !state.catalog.length);
    let count = 0;
    const more = $('#load-more');
    if (more) more.hidden = true;
    grid.classList.toggle('list-view', !weekly && state.view === 'list');
    grid.classList.toggle('schedule-view', weekly);
    grid.classList.toggle('data-loading', loading);
    grid.setAttribute('aria-busy', String(loading));
    if (loading) grid.innerHTML = skeletons();
    else if (weekly) count = renderWeekly();
    else {
      const source = personal ? savedItems() : state.catalog;
      const filtered = sorted(source.filter(item => matches(item, !personal)));
      count = filtered.length;
      const shown = personal ? filtered : filtered.slice(0, state.limit);
      grid.innerHTML = shown.map(item => card(item, personal)).join('');
      if (more && !personal && filtered.length > shown.length) {
        more.hidden = false;
        more.innerHTML = `${icon('plus')} Daha fazla anime göster <span>(${Math.min(5, filtered.length - shown.length)})</span>`;
      }
    }
    renderEmpty(count, loading, error);
    if ($('#results-count')) $('#results-count').textContent = loading ? 'Yükleniyor…' : `${count} ${weekly ? 'haftalık yayın' : 'anime'}`;
    if ($('#section-title')) $('#section-title').textContent = weekly ? 'Haftalık yayın akışı' : personal ? 'Kaydedilen animeler' : state.page === 'seasons' ? `${seasonLabel()} animeleri` : 'Sezonu keşfet';
  }

  function renderAside() {
    const schedule = $('#schedule-list');
    if (schedule) {
      const daily = state.schedule.filter(item => knownBroadcast(item) && item.day === state.day).sort((a, b) => a.time.localeCompare(b.time));
      schedule.innerHTML = daily.slice(0, 3).map(item => `<article class="schedule-item">${art(item, 'schedule-art')}<div class="schedule-copy"><h4 class="schedule-title"><button type="button" class="title-button" data-action="detail" data-id="${item.id}">${escape(item.title)}</button></h4><div class="schedule-time">${escape(item.time)}</div><span class="episode-badge">Haftalık yayın</span>${item.broadcastLocal ? '' : '<small class="broadcast-note">Kaynak saati</small>'}</div>${reminderButton(item)}</article>`).join('');
      if (daily.length > 3) schedule.innerHTML += `<button type="button" class="text-button" data-page="schedule">${daily.length} yayını takvimde gör ${icon('arrow-right')}</button>`;
      if (!daily.length) schedule.innerHTML = state.scheduleLoading ? '<p class="aside-empty">Yayın takvimi yükleniyor…</p>' : state.scheduleError ? '<p class="aside-empty">Yayın takvimi alınamadı.</p><button type="button" class="text-button" data-action="retry" data-resource="schedule">Yeniden dene</button>' : '<p class="aside-empty">Bu gün için saat bilgisi bulunan yayın yok.</p>';
    }
    const follow = $('#follow-list');
    if (follow) follow.innerHTML = savedItems().slice(0, 3).map(item => `<article class="follow-item">${art(item, 'follow-art')}<div class="follow-copy"><h4 class="follow-title"><button type="button" class="title-button" data-action="detail" data-id="${item.id}">${escape(item.title)}</button></h4><div class="follow-progress"><span>${progressText(item)}</span>${item.episodes ? `<span>${Math.round(countProgress(item) / item.episodes * 100)}%</span>` : ''}</div>${progressBar(item)}</div></article>`).join('') || '<p class="aside-empty">Listene eklediğin animeler burada görünecek.</p>';
    if ($('#weekday-tabs')) $('#weekday-tabs').innerHTML = shortDays.map((day, index) => `<button type="button" class="weekday-button${state.day === index ? ' active' : ''}" data-day="${index}" aria-pressed="${state.day === index}" aria-label="${escape(dateLabel(state.week[index]))} ${days[index]}">${day}</button>`).join('');
    if ($('#schedule-date')) $('#schedule-date').textContent = `${dateLabel(state.week[state.day])} · ${days[state.day]}`;
    if ($('#watchlist-count')) $('#watchlist-count').textContent = state.saved.size;
    document.querySelectorAll('[data-watchlist-count]').forEach(el => { el.textContent = state.saved.size; });
    document.querySelectorAll('[data-reminder-count]').forEach(el => { el.textContent = state.reminders.size; });
  }

  function heroItems() { return [...state.catalog].sort((a, b) => b.members - a.members).slice(0, 3); }
  function currentHero() { const entries = heroItems(); return entries[state.hero % Math.max(1, entries.length)] || null; }
  function renderHero() {
    const imageRequest = ++heroImageRequest;
    const hero = $('#hero');
    if (!hero) return;
    const entries = heroItems();
    const item = currentHero();
    hero.hidden = !item || !['discover', 'seasons'].includes(state.page);
    hero.classList.remove('hero-atlas', 'hero-garden'); hero.classList.add('remote-hero');
    hero.style.setProperty('--hero-image', 'none'); hero.style.backgroundImage = 'none';
    if (!item) return;
    hero.dataset.hero = item.id;
    let image = $('.hero-poster');
    if (!image) { image = document.createElement('div'); image.className = 'hero-poster'; hero.prepend(image); }
    image.innerHTML = poster(item, { eager: true });
    image.dataset.source = 'poster';
    // Landscape art is separate from saved MAL metadata and catalog posters.
    if (!hero.hidden && window.AnimeBanners) {
      window.AnimeBanners.resolve(item.malId).then(value => {
        const banner = window.AnimeBanners.safeBanner(value,item.malId);
        if (!banner || imageRequest !== heroImageRequest || hero.hidden || hero.dataset.hero !== item.id) return;
        const landscape = new Image();
        landscape.alt = ''; landscape.decoding = 'async'; landscape.referrerPolicy = 'no-referrer';
        landscape.onload = () => {
          if (imageRequest !== heroImageRequest || hero.hidden || hero.dataset.hero !== item.id) return;
          image.replaceChildren(landscape); image.dataset.source = 'landscape';
        };
        landscape.src = banner;
      }).catch(() => { /* The existing poster remains visible. */ });
    }
    if ($('.hero-kicker')) $('.hero-kicker').textContent = 'SEZONUN ÖNE ÇIKANI';
    if ($('#hero-title')) $('#hero-title').textContent = item.title;
    if ($('#hero-description')) $('#hero-description').textContent = `${item.format} · ${totalText(item)} · ${item.studio}`;
    if ($('#hero-genres')) $('#hero-genres').innerHTML = chips(item, 3);
    if ($('#hero-save')) {
      const saved = state.saved.has(item.id);
      $('#hero-save').innerHTML = `${icon(saved ? 'check' : 'plus')} ${saved ? 'Listemde' : 'Listeme ekle'}`;
      $('#hero-save').setAttribute('aria-pressed', String(saved));
    }
    if ($('#hero-detail')) $('#hero-detail').innerHTML = `<span class="hero-detail-icon">${icon('arrow-right')}</span> Detayları gör`;
    if ($('#hero-pagination')) $('#hero-pagination').innerHTML = `<button type="button" class="hero-arrow" data-hero-step="-1" aria-label="Önceki öne çıkan anime"${entries.length < 2 ? ' disabled' : ''}>${icon('chevron-left')}</button>${entries.map((entry, index) => `<button type="button" class="hero-dot${index === state.hero % entries.length ? ' active' : ''}" data-hero-index="${index}" aria-label="${escape(entry.title)} göster" aria-pressed="${index === state.hero % entries.length}"></button>`).join('')}<button type="button" class="hero-arrow" data-hero-step="1" aria-label="Sonraki öne çıkan anime"${entries.length < 2 ? ' disabled' : ''}>${icon('chevron-right')}</button>`;
  }

  function updatedAt(meta) {
    if (!meta || !Number.isFinite(meta.fetchedAt)) return '';
    return new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(meta.fetchedAt));
  }

  function renderStatus() {
    const status = $('#data-status');
    if (!status) return;
    const messages = [];
    const personal = state.page === 'watchlist';
    const schedulePage = state.page === 'schedule';
    const prefix = schedulePage ? 'Yayın takvimi' : `${seasonLabel()} verileri`;
    const loading = schedulePage ? state.scheduleLoading : state.catalogLoading;
    const error = schedulePage ? state.scheduleError : state.catalogError;
    const meta = schedulePage ? state.scheduleMeta : state.catalogMeta;
    const available = schedulePage ? state.schedule.length > 0 : state.catalogKey === selectedKey() && state.catalog.length > 0;
    if (!personal) {
      if (loading) messages.push(`<span class="loading-spinner" aria-hidden="true"></span><span>${escape(prefix)} yükleniyor…${!schedulePage && state.catalogProgress ? ` ${escape(state.catalogProgress)}` : ''}</span>`);
      else if (error) messages.push(`<span>${escape(prefix)} alınamadı.${available ? ' Son alınan veriler gösteriliyor.' : ''}</span><button type="button" class="text-button" data-action="retry" data-resource="${schedulePage ? 'schedule' : 'catalog'}">Yeniden dene</button>`);
      else if (meta) messages.push(`<span>${meta.stale ? 'Önbellekteki veriler gösteriliyor · ' : ''}MyAnimeList / Tenrai${updatedAt(meta) ? ` · ${escape(updatedAt(meta))}` : ''}</span>`);
    }
    if (!schedulePage && state.scheduleError) messages.push('<span>Yayın takvimi alınamadı.</span><button type="button" class="text-button" data-action="retry" data-resource="schedule">Takvimi yeniden yükle</button>');
    if (schedulePage && !state.scheduleLoading && !state.scheduleError) {
      const unknown = state.schedule.filter(item => item.airing && !knownBroadcast(item)).length;
      if (unknown) messages.push(`<span class="broadcast-note">${unknown} animenin yayın saati açıklanmadığı için takvimde gösterilmiyor.</span>`);
    }
    status.hidden = !messages.length; status.innerHTML = messages.join(' ');
    status.classList.toggle('is-error', Boolean(error));
    status.classList.toggle('is-loading', loading && !personal);
    if ($('#refresh-data')) $('#refresh-data').disabled = schedulePage ? state.scheduleLoading : state.catalogLoading;
  }

  function renderPage() {
    document.body.dataset.page = state.page;
    const titles = { discover: seasonLabel(), seasons: 'Sezonlar', schedule: 'Yayın Takvimi', watchlist: 'Listem' };
    const subtitles = { discover: 'Yeni hikâyeler, yeni favoriler.', seasons: 'MyAnimeList sezon kataloğunu keşfet.', schedule: `${weekLabel()} · Haftalık yayın saatleri.`, watchlist: 'Bu cihazdaki listen ve izleme ilerlemen.' };
    if ($('#page-title')) $('#page-title').textContent = titles[state.page];
    if ($('#page-subtitle')) $('#page-subtitle').textContent = subtitles[state.page];
    document.querySelectorAll('#nav-items [data-page]').forEach(button => {
      const active = button.dataset.page === state.page; button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    document.querySelectorAll('#format-tabs [data-format]').forEach(button => {
      const active = button.dataset.format === state.format; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('#view-toggle [data-view]').forEach(button => {
      const active = button.dataset.view === state.view; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
    if ($('#season-label')) $('#season-label').textContent = seasonLabel();
    if ($('.rail-year')) $('.rail-year').textContent = state.year;
    if ($('.rail-season strong')) $('.rail-season strong').textContent = seasons[state.quarter];
    if ($('#season-notice')) $('#season-notice').hidden = true;
    if ($('#catalog-controls')) $('#catalog-controls').hidden = state.page === 'schedule';
    if ($('#format-tabs')) $('#format-tabs').hidden = state.page === 'watchlist';
    if ($('#promo-banner')) $('#promo-banner').hidden = state.page !== 'discover';
    renderHero(); renderCatalog(); renderAside(); renderStatus();
    window.dispatchEvent(new CustomEvent('anime:viewrender'));
  }

  function refresh() {
    renderPage();
    if (state.dialogId && $('#anime-dialog')?.open) renderDetail(byId.get(state.dialogId));
  }

  async function loadSeason(force = false) {
    const sequence = ++seasonRequest;
    if (seasonController) seasonController.abort();
    seasonController = new AbortController();
    const year = state.year;
    const season = seasonKeys[state.quarter];
    const key = `${year}-${season}`;
    if (state.catalogKey !== key) { state.catalog = []; state.catalogMeta = null; state.catalogKey = null; }
    state.catalogLoading = true; state.catalogError = null; state.catalogProgress = ''; state.hero = 0;
    updateGenres(); renderPage();
    try {
      if (!window.AnimeData?.loadSeason) throw new Error('Data provider unavailable');
      const result = await window.AnimeData.loadSeason(year, season, {
        signal: seasonController.signal, force,
        onProgress(progress) {
          if (sequence !== seasonRequest) return;
          const page = typeof progress === 'number' ? progress : progress?.page;
          const total = progress?.totalPages || progress?.pages;
          state.catalogProgress = typeof progress === 'number' ? `${progress} anime alındı.` : Number.isFinite(page) ? `${page}${Number.isFinite(total) ? ` / ${total}` : ''}. sayfa` : '';
          renderStatus();
        }
      });
      if (sequence !== seasonRequest || key !== selectedKey()) return;
      state.catalog = register(result?.anime); state.catalogKey = key;
      state.catalogMeta = { fetchedAt: Number(result?.fetchedAt) || Date.now(), stale: result?.stale === true };
      state.catalogError = null; updateGenres();
      if (state.saved.size || state.reminders.size || Object.keys(state.progress).length) persist(false);
    } catch (error) {
      if (sequence !== seasonRequest || key !== selectedKey() || error?.name === 'AbortError') return;
      state.catalogError = true;
      if (state.catalogKey !== key) { state.catalog = []; state.catalogMeta = null; }
    } finally {
      if (sequence === seasonRequest && key === selectedKey()) { state.catalogLoading = false; refresh(); }
    }
  }

  async function loadSchedule(force = false) {
    const sequence = ++scheduleRequest;
    if (scheduleController) scheduleController.abort();
    scheduleController = new AbortController();
    state.scheduleLoading = true; state.scheduleError = null; renderPage();
    try {
      if (!window.AnimeData?.getSchedule) throw new Error('Data provider unavailable');
      const result = await window.AnimeData.getSchedule({ signal: scheduleController.signal, force });
      if (sequence !== scheduleRequest) return;
      state.schedule = register(result?.anime);
      state.scheduleMeta = { fetchedAt: Number(result?.fetchedAt) || Date.now(), stale: result?.stale === true };
      state.scheduleError = null;
      if (state.page === 'schedule') updateGenres();
      if (state.saved.size || state.reminders.size || Object.keys(state.progress).length) persist(false);
    } catch (error) {
      if (sequence !== scheduleRequest || error?.name === 'AbortError') return;
      state.scheduleError = true;
    } finally {
      if (sequence === scheduleRequest) { state.scheduleLoading = false; refresh(); }
    }
  }

  function toggleSave(id) {
    const item = byId.get(id); if (!item) return;
    const had = state.saved.has(id); if (had) state.saved.delete(id); else state.saved.add(id);
    persist(); updateGenres(); refresh(); toast(`${item.title} ${had ? 'listenden çıkarıldı.' : 'listene eklendi.'}`);
  }
  function toggleReminder(id) {
    if (!byId.has(id)) return;
    const had = state.reminders.has(id); if (had) state.reminders.delete(id); else state.reminders.add(id);
    persist(); refresh(); toast(had ? 'Takip işareti kaldırıldı.' : 'Yerel takip işareti eklendi. Cihaz bildirimi gönderilmez.');
  }
  function setProgress(id, value) {
    const item = byId.get(id); if (!item) return;
    const progress = Math.min(item.episodes || 9999, Math.max(0, Math.floor(Number(value) || 0)));
    state.progress[id] = progress; if (progress > 0) state.saved.add(id);
    persist(); refresh(); toast(item.episodes && progress === item.episodes ? `${item.title} tamamlandı!` : `İzleme ilerlemesi: ${progressText(item)}.`);
  }

  function renderDetail(item) {
    const content = $('#dialog-content'); if (!item || !content) return;
    const progress = countProgress(item);
    const active = document.activeElement;
    const activeId = active?.id;
    const activeAction = active?.dataset?.action;
    const activeDelta = active?.dataset?.delta;
    const max = item.episodes || 9999;
    content.innerHTML = `<div class="dialog-layout">${art(item, 'dialog-art')}<div class="dialog-copy"><span class="dialog-kicker">${escape(item.format)} · ${escape(item.status)}</span><h2 class="dialog-title" id="dialog-title">${escape(item.title)}</h2>${item.original && item.original !== item.title ? `<p class="dialog-original">${escape(item.original)}</p>` : ''}<div class="dialog-genres">${chips(item)}</div><p class="dialog-summary">${escape(item.summary || 'MyAnimeList kaynağında özet bulunmuyor.')}</p><dl class="dialog-facts"><div><dt>Stüdyo</dt><dd>${escape(item.studio)}</dd></div><div><dt>Uzunluk</dt><dd>${totalText(item)}${item.durationText ? ` · ${escape(item.durationText)}` : item.duration ? ` · ${item.duration} dk.` : ''}</dd></div><div><dt>MyAnimeList puanı</dt><dd>${icon('star')} ${scoreText(item)}${item.rating !== null ? ' / 10' : ''}</dd></div><div><dt>Yayın saati</dt><dd>${escape(broadcastText(item))}</dd></div></dl>${item.malUrl ? `<a class="mal-source-link text-button" href="${escape(item.malUrl)}" target="_blank" rel="noopener noreferrer">MyAnimeList'te aç ${icon('arrow-right')}</a>` : ''}<div class="dialog-actions"><button type="button" class="primary-button" data-action="save" data-id="${item.id}" aria-pressed="${state.saved.has(item.id)}">${icon(state.saved.has(item.id) ? 'check' : 'plus')}${state.saved.has(item.id) ? 'Listemde · çıkar' : 'Listeme ekle'}</button><button type="button" class="secondary-button dialog-reminder" data-action="reminder" data-id="${item.id}" aria-pressed="${state.reminders.has(item.id)}">${icon(state.reminders.has(item.id) ? 'bell-ring' : 'bell')}${state.reminders.has(item.id) ? 'İşaretli · kaldır' : 'Yerel takip işareti'}</button></div><div class="progress-editor"><label for="progress-number">İzlediğin bölüm</label><div class="progress-stepper"><button type="button" data-action="progress" data-id="${item.id}" data-delta="-1" aria-label="İzlenen bölüm sayısını azalt"${progress === 0 ? ' disabled' : ''}>${icon('minus')}</button><input id="progress-number" class="progress-value" type="number" min="0" max="${max}" step="1" value="${progress}" data-progress-id="${item.id}" aria-label="İzlenen bölüm sayısı">${item.episodes ? `<span>/ ${item.episodes}</span>` : '<span>bölüm izlendi</span>'}<button type="button" data-action="progress" data-id="${item.id}" data-delta="1" aria-label="İzlenen bölüm sayısını artır"${progress >= max ? ' disabled' : ''}>${icon('plus')}</button></div>${progressBar(item)}<p class="dialog-note">${item.episodes ? '' : 'Toplam bölüm sayısı henüz açıklanmadı. '}Listen ve ilerlemen bu tarayıcıda saklanır; MyAnimeList hesabıyla eşitlenmez. Takip işaretleri bildirim göndermez.</p></div></div></div>`;
    if (activeId === 'progress-number') $('#progress-number')?.focus({ preventScroll: true });
    else if (activeAction && ['save', 'reminder', 'progress'].includes(activeAction)) content.querySelector(`[data-action="${activeAction}"]${activeDelta ? `[data-delta="${activeDelta}"]` : ''}`)?.focus({ preventScroll: true });
  }

  function openDetail(id) {
    const item = byId.get(id), dialog = $('#anime-dialog'); if (!item || !dialog) return;
    state.dialogId = id; renderDetail(item); dialog.setAttribute('aria-labelledby', 'dialog-title');
    if (!dialog.open) dialog.showModal();
  }

  function changePage(page) {
    if (!['discover', 'seasons', 'schedule', 'watchlist'].includes(page)) return;
    state.page = page; state.query = ''; state.genre = 'all'; state.limit = 5;
    if ($('#search')) $('#search').value = '';
    updateGenres(); renderPage(); window.scrollTo({ top: 0, behavior: 'smooth' });
    if (page === 'schedule' && !state.scheduleMeta && !state.scheduleLoading && !state.scheduleError) loadSchedule();
  }
  function clearFilters() {
    state.query = ''; state.genre = 'all'; state.format = 'all'; state.limit = Infinity;
    if ($('#search')) $('#search').value = ''; if ($('#genre')) $('#genre').value = 'all'; renderPage();
  }
  function stepSeason(delta) {
    state.quarter += delta;
    if (state.quarter < 0) { state.quarter = 3; state.year--; }
    if (state.quarter > 3) { state.quarter = 0; state.year++; }
    state.limit = 5; state.hero = 0;
    if (state.page === 'schedule' || state.page === 'watchlist') state.page = 'seasons';
    loadSeason();
  }
  function retry(resource) {
    if (resource === 'schedule' || (!resource && state.page === 'schedule')) loadSchedule(true);
    else loadSeason(true);
  }

  function init() {
    restore(); updateDates();
    if ($('#hero')) $('#hero').hidden = true;
    if ($('#genre')) $('#genre').addEventListener('change', event => { state.genre = event.target.value; state.limit = Infinity; renderCatalog(); });
    if ($('#sort')) {
      $('#sort').innerHTML = '<option value="popular">Popülerlik</option><option value="rating">Puana göre</option><option value="title">İsme göre A–Z</option><option value="airtime">Yayın gününe göre</option>';
      $('#sort').value = state.sort;
      $('#sort').addEventListener('change', event => { state.sort = event.target.value; renderCatalog(); });
    }
    if ($('#search')) {
      $('#search').addEventListener('input', event => { state.query = event.target.value; state.limit = state.query.trim() ? Infinity : 5; renderCatalog(); });
      $('#search').addEventListener('keydown', event => { if (event.key === 'Escape') { event.target.value = ''; state.query = ''; state.limit = 5; renderCatalog(); } });
    }
    if ($('#hero-save')) $('#hero-save').addEventListener('click', () => { const item = currentHero(); if (item) toggleSave(item.id); });
    if ($('#hero-detail')) $('#hero-detail').addEventListener('click', () => { const item = currentHero(); if (item) openDetail(item.id); });
    if ($('#load-more')) $('#load-more').addEventListener('click', () => { state.limit += 5; renderCatalog(); });
    if ($('#season-prev')) $('#season-prev').addEventListener('click', () => stepSeason(-1));
    if ($('#season-next')) $('#season-next').addEventListener('click', () => stepSeason(1));
    if ($('#refresh-data')) $('#refresh-data').addEventListener('click', () => { loadSeason(true); loadSchedule(true); });
    window.addEventListener('anime:bannerchange', event => { if (currentHero()?.malId === event.detail?.malId) renderHero(); });
    if ($('#profile-button')) {
      $('#profile-button').hidden = true;
      $('#profile-button').addEventListener('click', () => window.AnimeMembership?.openProfile?.());
    }
    if ($('.rail-brand')) $('.rail-brand').addEventListener('click', event => { event.preventDefault(); changePage('discover'); });
    if ($('#dialog-close')) $('#dialog-close').addEventListener('click', () => $('#anime-dialog')?.close());
    if ($('#anime-dialog')) {
      $('#anime-dialog').addEventListener('close', () => { state.dialogId = null; });
      $('#anime-dialog').addEventListener('click', event => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) event.currentTarget.close();
      });
    }
    document.addEventListener('error', event => {
      if (event.target.tagName !== 'IMG') return;
      const container = event.target.closest('.remote-art, .hero-poster'); if (!container) return;
      event.target.hidden = true; const placeholder = container.querySelector('.image-placeholder'); if (placeholder) placeholder.hidden = false;
    }, true);
    document.addEventListener('change', event => { const input = event.target.closest('[data-progress-id]'); if (input) setProgress(input.dataset.progressId, input.value); });
    document.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button || button.disabled) return;
      if (button.dataset.page) { changePage(button.dataset.page); return; }
      if (button.dataset.format) { state.format = button.dataset.format; state.limit = Infinity; renderPage(); return; }
      if (button.dataset.view) { state.view = button.dataset.view; persist(); renderPage(); return; }
      if (button.dataset.day !== undefined) { state.day = Number(button.dataset.day); renderAside(); if (state.page === 'schedule') renderCatalog(); return; }
      const heroes = heroItems();
      if (button.dataset.heroIndex !== undefined && heroes.length) { state.hero = Number(button.dataset.heroIndex); renderHero(); return; }
      if (button.dataset.heroStep && heroes.length) { state.hero = (state.hero + Number(button.dataset.heroStep) + heroes.length) % heroes.length; renderHero(); return; }
      const id = button.dataset.id;
      switch (button.dataset.action) {
        case 'save': toggleSave(id); break;
        case 'reminder': toggleReminder(id); break;
        case 'detail': openDetail(id); break;
        case 'progress': { const item = byId.get(id); if (item) setProgress(id, countProgress(item) + Number(button.dataset.delta)); break; }
        case 'clear': clearFilters(); break;
        case 'discover': changePage('discover'); break;
        case 'retry': retry(button.dataset.resource); break;
        case 'show-watchlist': $('#anime-dialog')?.close(); changePage('watchlist'); break;
      }
    });
    updateGenres(); renderPage();
    loadSeason(); loadSchedule();
    setInterval(() => { const previous = state.todayKey; updateDates(); if (previous !== state.todayKey) { renderPage(); loadSchedule(); } }, 60000);
    window.animeTakvimi = {
      getState: () => ({ page: state.page, season: selectedKey(), saved: [...state.saved], reminders: [...state.reminders], progress: { ...state.progress }, view: state.view, catalogCount: state.catalog.length, scheduleCount: state.schedule.length, accountScope }),
      getLibrarySnapshot, setAccountScope, setGuestScope, replaceLibrarySnapshot, refreshView: refresh
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
