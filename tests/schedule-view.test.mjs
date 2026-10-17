import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const fixedTime = Date.parse('2026-10-16T14:15:00Z'); // Friday, 17:15 in Istanbul.
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [fixedTime])); }
  static now() { return fixedTime; }
}
const days = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const shortDays = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const fixture = (id, day, time, extra = {}) => ({
  id, day, time, airing: true, broadcastLocal: true, title: `Anime ${id}`,
  original: `Original ${id}`, synonyms: [], studio: 'Orbit', format: 'TV', ...extra,
});
const count = (html, className) => (html.match(new RegExp(`class="${className}(?: |")`, 'g')) || []).length;

function setup(overrides = {}) {
  const document = { activeElement: null };
  const context = { window: {}, document, Date: FixedDate };
  for (const filename of ['schedule-map.js', 'schedule-view.js']) {
    runInNewContext(readFileSync(new URL(`../public/site/${filename}`, import.meta.url), 'utf8'), context, { filename });
  }
  const state = {
    schedule: [fixture(1, 0, '14:00'), fixture(2, 4, '18:00'), fixture(3, 4, '22:00')],
    saved: new Set(), mapQuery: '', mapSaved: false, weekOffset: 0,
    scheduleLoading: false, scheduleError: false, ...overrides,
  };
  // A remount replaces the real scroller, so each HTML write creates a new node.
  let html = '', scroller = null;
  const target = {
    contains: () => false,
    querySelector: selector => selector === '.map-scroll' ? scroller : null,
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value;
      scroller = { scrollLeft: 0, scrollTop: 0, focus() {} };
    },
  };
  const mount = (preview = false) => context.window.AnimeScheduleView.mount(target, {
    state, escape, days, shortDays, preview,
    icon: name => `<svg data-icon="${name}" aria-hidden="true"></svg>`,
    poster: item => `<img alt="" src="/fixture/${item.id}.webp">`,
  });
  return { state, target, mount, view: context.window.AnimeScheduleView, get scroller() { return scroller; } };
}

test('full view renders all seven days, Istanbul today and the next scheduled item', () => {
  const ui = setup();
  assert.equal(ui.mount(), 3);
  assert.equal(count(ui.target.innerHTML, 'map-row'), 7);
  assert.equal(count(ui.target.innerHTML, 'map-event'), 3);
  assert.equal(count(ui.target.innerHTML, 'map-row is-today'), 1);
  assert.match(ui.target.innerHTML, /aria-label="Cuma, 16 Eki/);
  assert.match(ui.target.innerHTML, /class="map-today-badge">BUGÜN/);
  assert.match(ui.target.innerHTML, /class="map-now"[^>]*aria-label="Şimdi"/);
  assert.match(ui.target.innerHTML, /class="map-event is-next"[\s\S]*?data-id="2"/);
  assert.match(ui.target.innerHTML, /class="map-next-copy"><strong>Anime 2<\/strong>/);
  assert.match(ui.target.innerHTML, /Türkiye saati · UTC\+3/);
});

test('only converted active broadcasts reach cards and the returned count', () => {
  const ui = setup({ schedule: [
    fixture(1, 0, '14:00'), fixture(2, 0, '14:00', { airing: false }),
    fixture(3, 1, '15:00', { broadcastLocal: false }), fixture(4, 7, '15:00'),
    fixture(5, 1, '24:00'),
  ] });
  assert.equal(ui.mount(), 1);
  assert.equal(count(ui.target.innerHTML, 'map-event'), 1);
  assert.match(ui.target.innerHTML, /data-id="1"/);
  for (const id of [2, 3, 4, 5]) assert.doesNotMatch(ui.target.innerHTML, new RegExp(`data-id="${id}"`));
});

test('saved items show pressed bookmark state and the list filter follows saves', () => {
  const ui = setup();
  ui.state.saved.add(2);
  ui.mount();
  assert.match(ui.target.innerHTML, /class="map-save is-saved"[^>]*data-id="2"[^>]*aria-pressed="true"/);
  assert.match(ui.target.innerHTML, /aria-label="Anime 2 listemden çıkar"/);
  ui.state.mapSaved = true;
  assert.equal(ui.mount(), 1);
  assert.equal(count(ui.target.innerHTML, 'map-event'), 1);
  assert.match(ui.target.innerHTML, /data-map-filter="saved" aria-pressed="true"/);
  assert.doesNotMatch(ui.target.innerHTML, /data-id="1"/);
  ui.state.saved.delete(2);
  assert.equal(ui.mount(), 0);
  assert.match(ui.target.innerHTML, /Listendeki animeler için yayın saati bulunamadı\./);
  assert.equal(count(ui.target.innerHTML, 'map-event'), 0);
});

test('search uses Turkish case folding, alternate names and studios before applying saved filter', () => {
  const ui = setup({ schedule: [
    fixture(1, 0, '14:00', { title: 'İstanbul Koruyucuları', synonyms: ['Gökyüzü'], studio: 'Studio İki' }),
    fixture(2, 1, '16:00', { original: 'Tsuki no Hikari' }),
  ] });
  for (const [query, expected] of [['  istanbul ', 1], ['GÖKYÜZÜ', 1], ['studio iki', 1], ['TSUKİ NO HİKARİ', 2]]) {
    ui.state.mapQuery = query;
    assert.deepEqual(Array.from(ui.view.filtered(ui.state), item => item.id), [expected]);
  }
  ui.state.mapQuery = 'istanbul';
  ui.state.mapSaved = true;
  assert.equal(ui.mount(), 0);
  ui.state.saved.add(1);
  assert.equal(ui.mount(), 1);
});

test('provider text and the search value are escaped in labels, text and attributes', () => {
  const dangerous = '" autofocus><img src=x onerror="alert(1)"> & Anime';
  const ui = setup({ schedule: [fixture(1, 4, '18:00', { title: dangerous })], mapQuery: dangerous });
  assert.equal(ui.mount(), 1);
  assert.match(ui.target.innerHTML, /value="&quot; autofocus&gt;&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; Anime"/);
  assert.match(ui.target.innerHTML, /<strong>&quot; autofocus&gt;&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; Anime<\/strong>/);
  assert.doesNotMatch(ui.target.innerHTML, /<img src=x/);
  assert.doesNotMatch(ui.target.innerHTML, /value="" autofocus/);
});

test('loading, errors and empty searches have explicit feedback with a retry only for errors', () => {
  for (const [overrides, message, retry] of [
    [{ schedule: [], scheduleLoading: true }, 'Yayın akışı yükleniyor…', false],
    [{ schedule: [], scheduleError: true }, 'Yayın akışı alınamadı.', true],
    [{ schedule: [] }, 'Türkiye saatine çevrilmiş bir yayın bilgisi henüz yok.', false],
    [{ mapQuery: 'does-not-exist' }, 'Aramana uygun yayın bulunamadı.', false],
  ]) {
    const ui = setup(overrides);
    assert.equal(ui.mount(), 0);
    assert.ok(ui.target.innerHTML.includes(message));
    assert.equal(ui.target.innerHTML.includes('data-action="retry"'), retry);
    assert.equal(count(ui.target.innerHTML, 'map-row'), 7);
  }
  const cached = setup({ scheduleLoading: true, scheduleError: true });
  assert.equal(cached.mount(), 3);
  assert.equal(count(cached.target.innerHTML, 'map-event'), 3);
  assert.doesNotMatch(cached.target.innerHTML, /Yayın akışı (?:yükleniyor|alınamadı)/);
});

test('changing weeks changes dates and recurrence note, then Bu hafta state restores today', () => {
  const ui = setup();
  ui.mount();
  const currentRange = ui.target.innerHTML.match(/class="map-range">([^<]+)/)[1];
  ui.state.weekOffset = 1;
  ui.mount();
  const nextRange = ui.target.innerHTML.match(/class="map-range">([^<]+)/)[1];
  assert.notEqual(nextRange, currentRange);
  assert.match(nextRange, /19 Eki.*25 Eki 2026/);
  assert.doesNotMatch(ui.target.innerHTML, /map-today-badge|class="map-now"|class="map-next"/);
  assert.match(ui.target.innerHTML, /kesin bölüm tarihleri değildir/);
  ui.state.weekOffset = 0;
  ui.mount();
  assert.equal(ui.target.innerHTML.match(/class="map-range">([^<]+)/)[1], currentRange);
  assert.match(ui.target.innerHTML, /class="map-today-badge">BUGÜN/);
  assert.match(ui.target.innerHTML, /class="map-next"/);
  for (const offset of [-4, 4]) {
    ui.state.weekOffset = offset;
    ui.mount();
    assert.match(ui.target.innerHTML, new RegExp(`data-map-week="${Math.sign(offset)}"[^>]* disabled`));
  }
});

test('preview picks two chronological events per day and links overflow to the full map', () => {
  const ui = setup({ schedule: [fixture(4, 0, '22:00'), fixture(3, 0, '16:00'), fixture(2, 0, '14:00'), fixture(1, 1, '18:00')] });
  assert.equal(ui.mount(true), 4);
  assert.match(ui.target.innerHTML, /class="broadcast-map broadcast-preview"/);
  assert.equal(count(ui.target.innerHTML, 'map-event'), 3);
  assert.match(ui.target.innerHTML, /class="map-more"[^>]*data-page="schedule"[^>]*>\+1 yayın/);
  assert.match(ui.target.innerHTML, /id="preview-map-search"/);
  const cards = ui.target.innerHTML.match(/<article class="map-event[\s\S]*?<\/article>/g);
  assert.ok(cards.every(card => !card.includes('data-id="4"')));
});

test('remounts preserve horizontal and vertical scroll after search or save changes', () => {
  const ui = setup();
  ui.mount();
  assert.ok(Number.isFinite(ui.scroller.scrollLeft));
  assert.equal(ui.scroller.scrollTop, 0);
  const oldScroller = ui.scroller;
  oldScroller.scrollLeft = 412;
  oldScroller.scrollTop = 137;
  ui.state.saved.add(2);
  ui.state.mapQuery = 'Anime';
  ui.mount();
  assert.notEqual(ui.scroller, oldScroller);
  assert.equal(ui.scroller.scrollLeft, 412);
  assert.equal(ui.scroller.scrollTop, 137);
  assert.equal(ui.view.mount(null, {}), 0);
});
