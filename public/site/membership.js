(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const icon = name => typeof window.icon === 'function' ? window.icon(name) : '';
  const copy = value => JSON.parse(JSON.stringify(value));
  const state = {
    account: null, accountLoading: true, libraryLoading: false, scopeUserId: null, actor: 0,
    pending: null, version: 0, savedVersion: 0, saving: false, blocked: false,
    notice: 'Hesap bilgileri yükleniyor…', noticeKind: 'loading', retryAction: null,
    adminOpen: false, adminDenied: false, adminLoading: false, adminPage: 1, adminPages: 1,
    adminQuery: '', members: [], stats: null, adminError: '', memberMutations: new Set(), avatarUploading: false
  };
  let debounceTimer;
  let searchTimer;
  let adminController;
  let adminSequence = 0;

  class ApiError extends Error {
    constructor(status, code, message) { super(message || 'Request failed'); this.status = status; this.code = code || ''; }
  }

  async function api(path, options = {}) {
    if (filePreview()) throw new ApiError(0, 'SERVER_REQUIRED');
    const response = await fetch(path, {
      credentials: 'same-origin', cache: 'no-store', ...options,
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
    });
    let data = null;
    try { data = await response.json(); } catch (_) { /* A non-JSON response is not an account or a library. */ }
    if (!response.ok) throw new ApiError(response.status, data?.error?.code || data?.code, data?.error?.message || data?.message);
    if (!data || typeof data !== 'object') throw new ApiError(502, 'INVALID_RESPONSE');
    return data;
  }

  function safePath(value, fallback) {
    try {
      const url = new URL(value, window.location.origin);
      if (url.origin === window.location.origin && !url.username && !url.password) return url.pathname + url.search + url.hash;
    } catch (_) { /* Use a normal native sign-in anchor instead. */ }
    return fallback;
  }
  function signInUrl() { return safePath(state.account?.signInUrl, '/giris'); }
  function registerUrl() { return safePath(state.account?.registerUrl, '/uye-ol'); }
  function signOutUrl() { return safePath(state.account?.signOutUrl, '/cikis'); }
  function filePreview() { return window.location.protocol === 'file:'; }
  function identity() { return registered() ? state.account.user : state.account?.identity || {}; }
  function initials(person = identity()) {
    const name = String(person.displayName || person.email?.split('@')[0] || 'Hesabım').trim();
    const letters = name.split(/\s+/).map(word => word.match(/[\p{L}\p{N}]/u)?.[0]).filter(Boolean);
    return (letters.length > 1 ? letters[0] + letters[letters.length - 1] : letters[0] || 'H').toLocaleUpperCase('tr-TR');
  }
  function avatarUrl(value) {
    if (!value || filePreview()) return null;
    try {
      const url = new URL(value, window.location.origin);
      return url.origin === window.location.origin && !url.username && !url.password && url.pathname === '/api/account/avatar' ? url.pathname + url.search : null;
    } catch (_) { return null; }
  }
  function avatarMarkup(person = identity()) {
    const photo = avatarUrl(person.avatarUrl);
    return `<span class="avatar-initials" data-avatar-initials${photo ? ' hidden' : ''} aria-hidden="true">${escape(initials(person))}</span>${photo ? `<img data-account-avatar src="${escape(photo)}" alt="Profil fotoğrafı" decoding="async">` : ''}`;
  }
  function registered() { return state.account?.authenticated === true && state.account?.registered === true && typeof state.account.user?.id === 'string'; }
  function activeMember() { return registered() && state.account.user.status === 'active' && !state.blocked; }
  function admin() { return activeMember() && state.account.user.role === 'admin' && !state.adminDenied; }

  function errorText(error) {
    if (error?.status === 401) return 'Oturumun doğrulanamadı. Yeniden giriş yapabilirsin.';
    if (error?.status === 403 && /suspend/i.test(error.code || '')) return 'Üyeliğin askıya alınmış. Hesap listende değişiklik yapamazsın.';
    if (error?.status === 403) return 'Bu işlem için hesabının yetkisi bulunmuyor.';
    if (error?.status === 413) return 'Liste sunucunun boyut sınırını aşıyor. Kayıt sayısını azaltıp yeniden deneyebilirsin.';
    if (error?.status === 429) return 'Çok fazla istek gönderildi. Biraz sonra yeniden deneyebilirsin.';
    if (error?.status === 400) return 'Gönderilen bilgiler kabul edilmedi. Bilgilerini kontrol edip yeniden dene.';
    if (error?.status === 409) return 'Bu üyelik zaten mevcut. Hesap bilgilerini yeniden yükleyebilirsin.';
    if (error?.code === 'SERVER_REQUIRED') return 'Giriş ve üyelik için siteyi sunucu üzerinden açman gerekiyor.';
    return 'Sunucu bağlantısı kurulamadı. Yeniden deneyebilirsin.';
  }

  function setNotice(message, kind = 'info', retryAction = null) {
    state.notice = message; state.noticeKind = kind; state.retryAction = retryAction;
    const el = $('#account-status');
    if (!el) return;
    el.className = `account-status ${kind}`;
    el.innerHTML = `<span>${escape(message)}</span>${retryAction ? `<button type="button" class="text-button" data-member-action="${escape(retryAction)}">${retryAction === 'setup' ? 'Nasıl açılır?' : 'Yeniden dene'}</button>` : ''}`;
  }

  function renderAccount() {
    const actions = $('#account-actions');
    if (actions) {
      if (state.accountLoading && !state.account) actions.innerHTML = '<span class="account-identity">Hesap yükleniyor…</span>';
      else if (!state.account?.authenticated) actions.innerHTML = filePreview() ? '<button type="button" class="account-link" data-member-action="setup">Giriş yap</button><button type="button" class="account-link primary-button" data-member-action="setup">Üye ol</button>' : `<a class="account-link" href="${escape(signInUrl())}" target="_top">Giriş yap</a><a class="account-link primary-button" href="${escape(registerUrl())}" target="_top">Üye ol</a>`;
      else if (!registered()) actions.innerHTML = `<span class="account-identity"><span class="avatar profile-avatar account-avatar" data-avatar-frame>${avatarMarkup()}</span>${escape(state.account.identity?.displayName || 'Hesabım')}</span><button type="button" class="primary-button" data-member-action="register">Üyeliği tamamla</button><a class="account-link" href="${escape(signOutUrl())}" target="_top">Çıkış</a>`;
      else actions.innerHTML = `<button type="button" class="account-identity" data-member-action="profile"><span class="avatar profile-avatar account-avatar" data-avatar-frame>${avatarMarkup(state.account.user)}</span>${escape(state.account.user.displayName)}<span class="account-badge">${state.account.user.role === 'admin' ? 'Yönetici' : 'Üye'}</span></button><a class="account-link" href="${escape(signOutUrl())}" target="_top">Çıkış</a>`;
    }
    const profile = $('#profile-button');
    if (profile) {
      profile.hidden = state.account?.authenticated !== true;
      const frame = profile.querySelector('.profile-avatar');
      if (frame) { frame.setAttribute('data-avatar-frame', ''); frame.innerHTML = profile.hidden ? '' : avatarMarkup(); }
      if (!profile.hidden) profile.setAttribute('aria-label', `${identity().displayName || 'Hesabım'} profilini aç`);
      else profile.removeAttribute('aria-label');
    }
    if ($('#admin-nav')) $('#admin-nav').hidden = !admin();
    const avatarInput = $('#avatar-file'), avatarForm = $('#avatar-form');
    if (avatarInput) avatarInput.disabled = state.avatarUploading || !activeMember();
    const avatarButton = avatarForm?.querySelector('button[type="submit"]');
    if (avatarButton) avatarButton.disabled = state.avatarUploading || !activeMember();
    if (state.adminOpen && !admin()) closeAdmin();
    window.dispatchEvent(new CustomEvent('anime:accountchange'));
  }

  function expireSession(error) {
    if (error?.status !== 401) return false;
    state.actor++; state.account = null; state.scopeUserId = null; state.accountLoading = false;
    state.pending = null; state.libraryLoading = false; state.blocked = false;
    clearTimeout(debounceTimer); state.adminDenied = true;
    closeDialog();
    window.animeTakvimi?.setGuestScope(); closeAdmin(); renderAccount();
    setNotice(errorText(error), 'error', 'reload-account');
    return true;
  }

  function blockOnForbidden(error) {
    if (error?.status !== 403) return false;
    state.blocked = true; renderAccount();
    setNotice(errorText(error), 'error', 'reload-account');
    return true;
  }

  async function loadAccount() {
    if (filePreview()) {
      state.actor++; state.account = null; state.accountLoading = false; state.scopeUserId = null;
      window.animeTakvimi?.setGuestScope(); renderAccount();
      setNotice('Dosya önizlemesi: giriş, üyelik ve profil fotoğrafı için siteyi sunucu üzerinden açman gerekiyor.', 'info', 'setup');
      return;
    }
    const actor = ++state.actor;
    state.accountLoading = true; renderAccount();
    try {
      const account = await api('/api/account');
      if (actor !== state.actor) return;
      if (account.registered && (!account.authenticated || !account.user || typeof account.user.id !== 'string' || !['admin', 'member'].includes(account.user.role) || !['active', 'suspended'].includes(account.user.status))) throw new ApiError(502, 'INVALID_ACCOUNT');
      state.account = account; state.blocked = false; state.adminDenied = false;
      renderAccount();
      state.pending = null; state.version = 0; state.savedVersion = 0; clearTimeout(debounceTimer);
      if (registered()) {
        state.scopeUserId = account.user.id;
        window.animeTakvimi?.setAccountScope(account.user.id);
        if (account.user.status === 'suspended') {
          state.blocked = true;
          setNotice('Üyeliğin askıya alınmış. Hesap listende değişiklik yapamazsın.', 'error');
        } else await loadLibrary(actor);
      } else {
        state.scopeUserId = null; window.animeTakvimi?.setGuestScope();
        setNotice(account.authenticated ? 'Üyeliğini tamamlayabilirsin. Misafir listen bu cihazda ayrı tutulur.' : 'Misafir listen yalnızca bu cihazda saklanır.');
      }
    } catch (error) {
      if (actor !== state.actor) return;
      state.account = null; state.scopeUserId = null; window.animeTakvimi?.setGuestScope();
      setNotice('Hesap bağlantısı kurulamadı; liste bu cihazda misafir olarak saklanıyor.', 'error', 'reload-account');
    } finally {
      if (actor === state.actor) {
        state.accountLoading = false; renderAccount();
        if (state.account?.authenticated && !registered() && new URL(window.location.href).searchParams.get('join') === '1') openRegistration();
      }
    }
  }

  async function loadLibrary(actor = state.actor) {
    if (!activeMember()) return;
    const userId = state.account.user.id;
    state.libraryLoading = true; setNotice('Hesap listen yükleniyor…', 'loading');
    try {
      const result = await api('/api/library');
      if (actor !== state.actor || userId !== state.scopeUserId) return;
      if (!result.library || typeof result.library !== 'object') throw new ApiError(502, 'INVALID_LIBRARY');
      window.animeTakvimi?.replaceLibrarySnapshot(result.library, { emit: false });
      state.pending = null; state.savedVersion = state.version;
      setNotice('Hesap listen yüklendi. Değişiklikler hesabına kaydedilir.', 'success');
    } catch (error) {
      if (actor !== state.actor || userId !== state.scopeUserId) return;
      if (!expireSession(error) && !blockOnForbidden(error)) setNotice('Hesap listesi alınamadı. Yalnızca bu hesaba ait cihaz önbelleği gösteriliyor.', 'error', 'retry-library');
    } finally { if (actor === state.actor) { state.libraryLoading = false; window.dispatchEvent(new CustomEvent('anime:accountchange')); } }
  }

  function libraryChanged(event) {
    if (!activeMember()) {
      if (!registered()) setNotice(filePreview() ? 'Misafir listen bu cihazda saklandı. Giriş ve üyelik için sunucu bağlantısı gerekiyor.' : 'Misafir listen bu cihazda saklandı.', 'info', filePreview() ? 'setup' : null);
      return;
    }
    if (state.libraryLoading || !event.detail || typeof event.detail !== 'object') return;
    state.pending = copy(event.detail); state.version++;
    setNotice('Cihazda saklandı; hesaba kaydediliyor…', 'loading');
    clearTimeout(debounceTimer); debounceTimer = setTimeout(flushLibrary, 700);
  }

  async function flushLibrary() {
    if (state.saving || !state.pending || !activeMember() || state.libraryLoading) return;
    const actor = state.actor, userId = state.scopeUserId, version = state.version, snapshot = copy(state.pending);
    state.saving = true;
    let failed = false;
    setNotice('Hesaba kaydediliyor…', 'loading');
    try {
      const result = await api('/api/library', { method: 'PUT', body: JSON.stringify({ library: snapshot }) });
      if (actor !== state.actor || userId !== state.scopeUserId) return;
      if (!result.library || typeof result.library !== 'object') throw new ApiError(502, 'INVALID_LIBRARY');
      state.savedVersion = version;
      if (state.version === version) { state.pending = null; setNotice('Hesaba kaydedildi.', 'success'); }
    } catch (error) {
      if (actor !== state.actor || userId !== state.scopeUserId) return;
      failed = true;
      if (!expireSession(error) && !blockOnForbidden(error)) setNotice(`Cihazda saklandı; hesaba kaydedilemedi. ${errorText(error)}`, 'error', 'retry-library');
    } finally {
      state.saving = false;
      if (activeMember() && state.pending && !state.libraryLoading && state.version > state.savedVersion && (!failed || actor !== state.actor)) flushLibrary();
    }
  }

  function openDialog(content, titleId = 'membership-title') {
    const dialog = $('#membership-dialog'), target = $('#membership-content'); if (!dialog || !target) return;
    target.innerHTML = content; dialog.setAttribute('aria-labelledby', titleId);
    if (!dialog.open) dialog.showModal();
  }
  function closeDialog() { $('#membership-dialog')?.close(); }
  function dateText(value) {
    const date = new Date(value); if (!Number.isFinite(date.getTime())) return '—';
    return new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  }

  function openSetup() {
    openDialog('<section class="membership-profile"><h2 id="membership-title" class="dialog-title">Tasarım önizlemesi</h2><p class="dialog-summary">Bu sayfa tasarım önizlemesi. Giriş, üyelik ve profil fotoğrafı için sitenin çevrimiçi bağlantısının açılması gerekiyor. Henüz yayınlanmış bir site bağlantısı bulunmuyor.</p><button type="button" class="primary-button" data-member-action="close-dialog">Anladım</button></section>');
  }

  function openRegistration() {
    if (filePreview()) { openSetup(); return; }
    if (registered()) { openProfile(); return; }
    window.location.assign(registerUrl());
  }

  function stats() {
    const library = window.animeTakvimi?.getLibrarySnapshot() || { saved: [], reminders: [], progress: {}, savedAnime: {} };
    const watched = Object.values(library.progress || {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
    const completed = Object.entries(library.savedAnime || {}).filter(([id, item]) => Number.isInteger(item.episodes) && item.episodes > 0 && (library.progress?.[id] || 0) >= item.episodes).length;
    return { saved: library.saved?.length || 0, reminders: library.reminders?.length || 0, watched, completed };
  }

  function openProfile() {
    if (window.AnimeExperienceMounted) { closeDialog(); window.dispatchEvent(new CustomEvent('anime:profile')); return; }
    if (!state.account?.authenticated) return false;
    if (!registered()) { openRegistration(); return true; }
    const user = state.account.user, counts = stats();
    const photoForm = activeMember() ? '<form id="avatar-form" class="avatar-form"><label for="avatar-file">Profil fotoğrafın</label><input id="avatar-file" type="file" accept="image/jpeg,image/png,image/webp" required><p class="form-hint">JPEG, PNG veya WebP · En fazla 2 MiB.</p><button type="submit" class="outline-button">Fotoğrafı kaydet</button><p id="avatar-message" class="avatar-message" role="status" aria-live="polite"></p></form>' : '';
    openDialog(`<section class="membership-profile"><span class="dialog-kicker">${user.role === 'admin' ? 'Yönetici hesabı' : 'Üye hesabı'}</span><div class="profile-header"><div id="profile-photo-preview" class="profile-photo-preview" data-avatar-frame>${avatarMarkup(user)}</div><div><h2 id="membership-title" class="dialog-title">${escape(user.displayName)}</h2><p class="profile-email">${escape(user.email)}</p></div></div>${photoForm}<p class="dialog-summary">${state.blocked || user.status === 'suspended' ? 'Üyeliğin askıya alınmış. Hesap listende değişiklik yapamazsın.' : 'Kişisel listen ve izleme ilerlemen bu site hesabında saklanır. MyAnimeList hesabındaki listeyle eşitlenmez.'}</p><div class="profile-stats"><div class="profile-stat"><strong>${counts.saved}</strong><span>Listemde</span></div><div class="profile-stat"><strong>${counts.watched}</strong><span>İzlenen bölüm</span></div><div class="profile-stat"><strong>${counts.completed}</strong><span>Tamamlanan anime</span></div><div class="profile-stat"><strong>${counts.reminders}</strong><span>Yerel takip işareti</span></div></div><p class="dialog-note">Üyelik: ${escape(dateText(user.createdAt))}. Takip işaretleri cihaz bildirimi göndermez.</p><div class="dialog-actions"><button type="button" class="primary-button" data-member-action="watchlist">${icon('bookmark')} Listemi aç</button><button type="button" class="outline-button" data-member-action="settings">${icon('settings')} Hesap ayarları</button></div></section>`);
    $('#avatar-form')?.addEventListener('submit', uploadAvatar);
    return true;
  }

  async function uploadAvatar(event) {
    event.preventDefault();
    if (!activeMember() || state.avatarUploading) return;
    const input = $('#avatar-file');
    const file = input?.files?.[0];
    const message = $('#avatar-message');
    const fail = text => { if (message) { message.textContent = text; message.classList.add('form-error'); } };
    if (!file) { fail('Önce bir fotoğraf seç.'); return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { fail('JPEG, PNG veya WebP formatında bir fotoğraf seç.'); return; }
    if (!Number.isFinite(file.size) || file.size <= 0 || file.size > 2 * 1024 * 1024) { fail('Fotoğraf en fazla 2 MiB olmalı ve boş olmamalı.'); return; }
    const actor = state.actor, userId = state.scopeUserId;
    const button = event.currentTarget.querySelector('button[type="submit"]');
    state.avatarUploading = true; if (button) button.disabled = true; if (input) input.disabled = true;
    if (message) { message.classList.remove('form-error'); message.textContent = 'Fotoğraf hesabına yükleniyor…'; }
    try {
      const result = await api('/api/account/avatar', { method: 'POST', body: file, headers: { 'Content-Type': file.type } });
      if (actor !== state.actor || userId !== state.scopeUserId || !registered()) return;
      const photo = avatarUrl(result.avatarUrl);
      if (!photo) throw new ApiError(502, 'INVALID_AVATAR');
      state.account.user.avatarUrl = photo; renderAccount();
      if ($('#profile-photo-preview')) $('#profile-photo-preview').innerHTML = avatarMarkup(state.account.user);
      if (message) message.textContent = 'Profil fotoğrafın hesabına kaydedildi.';
      if (input) input.value = '';
      setNotice('Profil fotoğrafın hesabına kaydedildi.', 'success');
    } catch (error) {
      if (actor !== state.actor || userId !== state.scopeUserId) return;
      if (!expireSession(error) && !blockOnForbidden(error)) fail(error?.status === 404 ? 'Profil fotoğrafı hizmeti bu sunucuda henüz hazır değil.' : error?.status === 413 ? 'Fotoğraf en fazla 2 MiB olmalı.' : error?.status === 400 || error?.status === 415 ? 'Dosya kabul edilmedi. Geçerli bir JPEG, PNG veya WebP fotoğrafı seç.' : errorText(error));
    } finally {
      state.avatarUploading = false;
      if (button) button.disabled = !activeMember(); if (input) input.disabled = !activeMember();
    }
  }

  function openSettings() {
    if (!registered()) return;
    const user = state.account.user;
    const photoForm = activeMember() ? "<form id=\"avatar-form\" class=\"avatar-form\"><label for=\"avatar-file\">Profil fotoğrafın</label><input id=\"avatar-file\" type=\"file\" accept=\"image/jpeg,image/png,image/webp\" required><p class=\"form-hint\">JPEG, PNG veya WebP · En fazla 2 MiB.</p><button type=\"submit\" class=\"outline-button\">Fotoğrafı kaydet</button><p id=\"avatar-message\" class=\"avatar-message\" role=\"status\" aria-live=\"polite\"></p></form>" : '';
    openDialog(`<section class="membership-profile"><span class="dialog-kicker">Hesap bilgilerin</span><h2 id="membership-title" class="dialog-title">Hesap ayarları</h2>${photoForm}<dl class="dialog-facts"><div><dt>Görünen ad</dt><dd>${escape(user.displayName)}</dd></div><div><dt>E-posta adresi</dt><dd>${escape(user.email)}</dd></div><div><dt>Hesap kimliği</dt><dd><input class="account-id-field" aria-label="Hesap kimliği" readonly value="${escape(user.id)}"></dd></div><div><dt>Üyelik durumu</dt><dd>${state.blocked || user.status === 'suspended' ? 'Askıya alınmış' : 'Aktif'}</dd></div></dl><p class="dialog-summary">E-posta ve şifrenle giriş yaparsın. Üyelik yetkisi sunucuda kontrol edilir. Misafir listesi ve hesap listesi ayrı tutulur.</p><p class="dialog-note">${escape(state.notice)}</p><div class="dialog-actions"><button type="button" class="primary-button" data-member-action="retry-library"${activeMember() ? '' : ' disabled'}>Hesap listesini yeniden eşitle</button><button type="button" class="outline-button" data-member-action="profile">Profile dön</button><a class="account-link" href="${escape(signOutUrl())}" target="_top">Çıkış</a></div></section>`);
    $('#avatar-form')?.addEventListener('submit', uploadAvatar);
  }

  function enforceAdminLayout() {
    if (!state.adminOpen) return;
    if ($('#admin-panel')) $('#admin-panel').hidden = false;
    ['#hero', '#catalog-section', '#format-tabs', '#promo-banner', '.data-toolbar', '.header-controls'].forEach(selector => { if ($(selector)) $(selector).hidden = true; });
    if ($('#page-title')) $('#page-title').textContent = 'Üye Yönetimi';
    if ($('#page-subtitle')) $('#page-subtitle').textContent = 'Üyeleri ara ve üyelik durumlarını yönet.';
    document.body.dataset.page = 'admin';
    window.dispatchEvent(new CustomEvent('anime:adminchange'));
    document.querySelectorAll('#nav-items [data-page]').forEach(button => { button.classList.remove('active'); button.removeAttribute('aria-current'); });
    $('#admin-nav')?.classList.add('active'); $('#admin-nav')?.setAttribute('aria-current', 'page');
  }
  function closeAdmin() {
    state.adminOpen = false;
    if ($('#admin-panel')) $('#admin-panel').hidden = true;
    ['#catalog-section', '.data-toolbar', '.header-controls'].forEach(selector => { if ($(selector)) $(selector).hidden = false; });
    $('#admin-nav')?.classList.remove('active'); $('#admin-nav')?.removeAttribute('aria-current');
    window.animeTakvimi?.refreshView?.();
  }
  function openAdmin() {
    if (!admin()) { setNotice('Üye yönetimi için yönetici yetkisi gerekiyor.', 'error'); return; }
    state.adminOpen = true; enforceAdminLayout(); renderBannerEditor(); loadMembers(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderBannerEditor() {
    const panel = $('#admin-panel');
    if (!panel || !admin()) return;
    let editor = $('#banner-editor');
    if (!editor) {
      editor = document.createElement('section'); editor.id = 'banner-editor'; editor.className = 'banner-editor';
      panel.append(editor);
      editor.innerHTML = '<h2>Anime banner görseli</h2><p>Yatay görseller AniList üzerinden otomatik bulunur. İstediğin anime için kendi görselini yükleyebilirsin. Öneri: 1920 × 720 piksel · PNG, JPEG veya WebP · En fazla 2 MiB.</p><form id="banner-form"><label>MyAnimeList anime numarası<input id="banner-mal-id" type="number" min="1" max="2147483647" step="1" placeholder="Örn. 52991" required></label><label>Yatay görsel<input id="banner-file" type="file" accept="image/png,image/jpeg,image/webp"></label><button type="submit" class="primary-button">Görseli kaydet</button><button type="button" class="outline-button" id="banner-reset">Otomatik görsele dön</button></form><p id="banner-result" role="status" aria-live="polite"></p>';
      $('#banner-form').addEventListener('submit', event => { event.preventDefault(); updateBanner(false); });
      $('#banner-reset').addEventListener('click', () => updateBanner(true));
    }
  }
  async function updateBanner(reset) {
    if (!admin()) return;
    const input = $('#banner-mal-id'), fileInput = $('#banner-file'), form = $('#banner-form'), result = $('#banner-result');
    if (!input.reportValidity()) return;
    const id = Number(input.value), file = fileInput.files?.[0];
    result.className = '';
    if (!reset && !file) { result.textContent = 'Önce yatay bir görsel seç.'; return; }
    if (!window.AnimeBanners) { result.textContent = 'Görsel hizmeti yüklenemedi. Sayfayı yenileyebilirsin.'; return; }
    form.querySelectorAll('button,input').forEach(control => control.disabled = true);
    result.textContent = reset ? 'Otomatik görsele dönülüyor…' : 'Görsel yükleniyor…';
    try {
      if (reset) await window.AnimeBanners.remove(id); else await window.AnimeBanners.upload(id,file);
      result.textContent = reset ? 'Bu anime için otomatik yatay görsel kullanılacak.' : 'Banner kaydedildi. Bu anime öne çıktığında yeni görseli görünecek.';
      fileInput.value = '';
    } catch (error) { result.className = 'form-error'; result.textContent = error.message || 'Görsel kaydedilemedi. Yeniden dene.'; }
    finally { form.querySelectorAll('button,input').forEach(control => control.disabled = false); }
  }

  function renderAdmin() {
    if ($('#admin-summary')) {
      const labels = [['total', 'Toplam üye'], ['active', 'Aktif'], ['suspended', 'Askıya alınmış'], ['admins', 'Yönetici']];
      $('#admin-summary').innerHTML = state.stats ? `<div class="admin-stats">${labels.map(([key, label]) => `<div class="profile-stat"><strong>${Math.max(0, Math.floor(Number(state.stats[key]) || 0))}</strong><span>${label}</span></div>`).join('')}</div>` : '<p>Üye bilgileri yükleniyor…</p>';
    }
    const members = $('#admin-members');
    if (members) {
      members.setAttribute('aria-busy', String(state.adminLoading));
      if (state.adminError) members.innerHTML = `<p class="admin-message form-error" role="alert">${escape(state.adminError)}</p><button type="button" class="text-button" data-member-action="reload-members">Yeniden dene</button>`;
      else if (state.adminLoading && !state.members.length) members.innerHTML = '<p class="admin-loading">Üyeler yükleniyor…</p>';
      else if (!state.members.length) members.innerHTML = '<p class="aside-empty">Aramana uygun üye bulunamadı.</p>';
      else members.innerHTML = `<div class="member-table-wrap"><table class="member-table"><thead><tr><th scope="col">Üye</th><th scope="col">Yetki</th><th scope="col">Durum</th><th scope="col">Katılım</th><th scope="col">İşlem</th></tr></thead><tbody>${state.members.map(member => {
        const self = member.id === state.account?.user?.id, protectedMember = self || member.role === 'admin';
        const active = member.status === 'active', known = active || member.status === 'suspended';
        return `<tr><td><strong>${escape(member.displayName)}</strong><span class="member-email">${escape(member.email)}</span></td><td>${member.role === 'admin' ? 'Yönetici' : 'Üye'}</td><td><span class="member-status ${active ? 'active' : 'suspended'}">${active ? 'Aktif' : member.status === 'suspended' ? 'Askıya alınmış' : 'Bilinmiyor'}</span></td><td>${escape(dateText(member.createdAt))}</td><td class="member-actions">${protectedMember ? `<span>${self ? 'Siz' : 'Yönetici'}</span>` : known ? `<button type="button" class="${active ? 'suspend-button' : 'activate-button'}" data-member-action="${active ? 'suspend' : 'activate'}" data-member-id="${escape(member.id)}"${state.memberMutations.has(member.id) ? ' disabled' : ''}>${state.memberMutations.has(member.id) ? 'Kaydediliyor…' : active ? 'Askıya al' : 'Etkinleştir'}</button>` : '—'}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    }
    if ($('#admin-pagination')) $('#admin-pagination').innerHTML = `<button type="button" class="icon-button" data-member-action="admin-page" data-page-number="${state.adminPage - 1}" aria-label="Önceki üye sayfası"${state.adminPage <= 1 || state.adminLoading ? ' disabled' : ''}>${icon('chevron-left')}</button><span>Sayfa ${state.adminPage} / ${state.adminPages}</span><button type="button" class="icon-button" data-member-action="admin-page" data-page-number="${state.adminPage + 1}" aria-label="Sonraki üye sayfası"${state.adminPage >= state.adminPages || state.adminLoading ? ' disabled' : ''}>${icon('chevron-right')}</button>`;
  }

  async function loadMembers() {
    if (!admin()) return;
    const sequence = ++adminSequence;
    if (adminController) adminController.abort(); adminController = new AbortController();
    state.adminLoading = true; state.adminError = ''; renderAdmin();
    try {
      const data = await api(`/api/admin/members?q=${encodeURIComponent(state.adminQuery)}&page=${state.adminPage}`, { signal: adminController.signal });
      if (sequence !== adminSequence) return;
      if (!Array.isArray(data.members) || !data.pagination || !data.stats) throw new ApiError(502, 'INVALID_MEMBERS');
      state.members = data.members.filter(member => member && typeof member.id === 'string');
      state.adminPage = Math.max(1, Math.floor(Number(data.pagination.page) || 1));
      state.adminPages = Math.max(1, Math.floor(Number(data.pagination.pages) || 1));
      state.stats = data.stats;
    } catch (error) {
      if (sequence !== adminSequence || error?.name === 'AbortError') return;
      state.members = []; state.adminError = errorText(error);
      if (error?.status === 401) expireSession(error);
      else if (error?.status === 403) { state.adminDenied = true; closeAdmin(); renderAccount(); setNotice(errorText(error), 'error', 'reload-account'); }
    } finally { if (sequence === adminSequence) { state.adminLoading = false; renderAdmin(); } }
  }

  async function changeMemberStatus(id, status) {
    if (!admin() || state.memberMutations.has(id)) return;
    const member = state.members.find(item => item.id === id);
    if (!member || member.role === 'admin' || member.id === state.account.user.id || !['active', 'suspended'].includes(status)) return;
    state.memberMutations.add(id); renderAdmin();
    try {
      await api(`/api/admin/members/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setNotice(status === 'suspended' ? 'Üyelik askıya alındı.' : 'Üyelik etkinleştirildi.', 'success');
      await loadMembers();
    } catch (error) {
      if (!expireSession(error)) setNotice(errorText(error), 'error');
    } finally { state.memberMutations.delete(id); renderAdmin(); }
  }

  function preventUnavailableLibraryChange(event) {
    const target = event.target;
    const button = target.closest?.('button');
    const mutation = button && (['save', 'reminder', 'progress'].includes(button.dataset.action) || button.id === 'hero-save' || Boolean(button.dataset.view));
    const input = event.type === 'change' && target.closest?.('[data-progress-id]');
    if ((state.libraryLoading || (registered() && !activeMember())) && (mutation || input)) {
      event.preventDefault(); event.stopImmediatePropagation();
      setNotice(state.libraryLoading ? 'Hesap listen yükleniyor. Kısa süre sonra düzenleyebilirsin.' : 'Üyeliğin askıya alınmış veya hesabının yazma yetkisi yok.', state.libraryLoading ? 'loading' : 'error');
    }
  }

  function init() {
    window.AnimeMembership = {
      openProfile, openSettings, closeAdmin, getAccount: () => state.account ? copy(state.account) : null, isAdminOpen: () => state.adminOpen,
      getStatus: () => ({ authenticated: state.account?.authenticated === true, registered: registered(), role: registered() ? state.account.user.role : null, scopeUserId: state.scopeUserId, saving: state.saving, pending: Boolean(state.pending), libraryLoading:state.libraryLoading, blocked:state.blocked })
    };
    if ($('#membership-close')) $('#membership-close').addEventListener('click', closeDialog);
    if ($('#membership-dialog')) $('#membership-dialog').addEventListener('click', event => {
      if (event.target !== event.currentTarget) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeDialog();
    });
    if ($('#admin-nav')) $('#admin-nav').addEventListener('click', openAdmin);
    document.addEventListener('error', event => {
      const image = event.target;
      if (image.tagName !== 'IMG' || !image.hasAttribute('data-account-avatar')) return;
      image.hidden = true;
      const frame = image.closest('[data-avatar-frame]');
      const fallback = frame?.querySelector('[data-avatar-initials]'); if (fallback) fallback.hidden = false;
    }, true);
    if ($('#admin-search')) $('#admin-search').addEventListener('input', event => {
      state.adminQuery = event.target.value.trim(); state.adminPage = 1;
      clearTimeout(searchTimer); searchTimer = setTimeout(loadMembers, 300);
    });
    window.addEventListener('anime:librarychange', libraryChanged);
    window.addEventListener('anime:avatarframechange', event => {
      const value = event.detail;
      if (!activeMember() || value?.userId !== state.account.user.id || typeof value.frameId !== 'string' || !/^[a-z-]{1,32}$/.test(value.frameId)) return;
      // The profile UI emits this only after the authenticated save is accepted.
      state.account.user.avatarFrame = value.frameId;
      renderAccount();
    });
    window.addEventListener('anime:navigate', () => { if (state.adminOpen) closeAdmin(); });
    window.addEventListener('hashchange', () => { if (state.adminOpen) closeAdmin(); });
    window.addEventListener('anime:viewrender', enforceAdminLayout);
    document.addEventListener('click', preventUnavailableLibraryChange, true);
    document.addEventListener('change', preventUnavailableLibraryChange, true);
    document.addEventListener('click', event => {
      const button = event.target.closest?.('button');
      if (state.adminOpen && button?.dataset.page) closeAdmin();
    }, true);
    document.addEventListener('click', event => {
      const button = event.target.closest?.('[data-member-action]'); if (!button || button.disabled) return;
      switch (button.dataset.memberAction) {
        case 'setup': openSetup(); break;
        case 'close-dialog': closeDialog(); break;
        case 'register': openRegistration(); break;
        case 'profile': openProfile(); break;
        case 'settings': openSettings(); break;
        case 'watchlist': closeDialog(); document.querySelector('#nav-items [data-page="watchlist"]')?.click(); break;
        case 'reload-account': loadAccount(); break;
        case 'retry-library': if (state.pending) flushLibrary(); else loadLibrary(); break;
        case 'reload-members': loadMembers(); break;
        case 'admin-page': state.adminPage = Math.max(1, Number(button.dataset.pageNumber) || 1); loadMembers(); break;
        case 'suspend': changeMemberStatus(button.dataset.memberId, 'suspended'); break;
        case 'activate': changeMemberStatus(button.dataset.memberId, 'active'); break;
      }
    });
    setNotice(state.notice, 'loading'); renderAccount(); loadAccount();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
