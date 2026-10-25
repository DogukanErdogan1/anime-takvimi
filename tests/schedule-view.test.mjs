import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const fixedTime = Date.parse('2026-10-16T14:15:00Z'); // Friday, 17:15 in Istanbul.
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

function setup(overrides = {}, {now=fixedTime,todayTop=null,width=720} = {}) {
  const document = { activeElement: null };
  const clock={now};
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length?args:[clock.now])); }
    static now() { return clock.now; }
  }
  const context = { window: {}, document, Date: ClockDate };
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
    querySelector: selector => selector === '.map-scroll' ? scroller : selector === '.map-row.is-today' && todayTop!==null ? {offsetTop:todayTop} : null,
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value;
      scroller = { clientWidth:width, scrollLeft: 0, scrollTop: 0, focus() {} };
    },
  };
  const mount = (preview = false,options={}) => context.window.AnimeScheduleView.mount(target, {
    state, escape, days, shortDays, preview, ...options,
    icon: name => `<svg data-icon="${name}" aria-hidden="true"></svg>`,
    poster: item => `<img alt="" src="/fixture/${item.id}.webp">`,
  });
  return { state, target, mount, setTime:value=>{clock.now=Date.parse(value);}, view: context.window.AnimeScheduleView, get scroller() { return scroller; } };
}

test('full view renders all seven days, Istanbul today and the next scheduled item', () => {
  const ui = setup();
  assert.equal(ui.mount(), 3);
  assert.equal(count(ui.target.innerHTML, 'map-row'), 7);
  assert.equal(count(ui.target.innerHTML, 'map-event'), 3);
  assert.equal(count(ui.target.innerHTML, 'map-row is-today'), 1);
  assert.match(ui.target.innerHTML, /aria-label="Cuma, 16 Eki/);
  assert.match(ui.target.innerHTML, /class="map-today-badge">BUGÜN/);
  assert.match(ui.target.innerHTML, /class="map-now"[^>]*aria-label="Şimdi 17:15"/);
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

test('changing weeks changes dates and recurrence note, then the now action restores today', () => {
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


test('opening the calendar reveals today and the actual current time instead of noon',()=>{
  const ui=setup({}, {todayTop:850,width:600});
  ui.mount();
  assert.match(ui.target.innerHTML,/class="map-clock"[^>]*>Şimdi 17:15<\/time>/);
  assert.doesNotMatch(ui.target.innerHTML,/Şimdiye git|data-map-today/);
  assert.match(ui.target.innerHTML,/45 dk sonra/);
  const nowLeft=Number(ui.target.innerHTML.match(/class="map-now" style="left:([\d.]+)px"/)[1]);
  assert.ok(ui.scroller.scrollLeft>0);
  assert.ok(nowLeft-ui.scroller.scrollLeft>=80 && nowLeft-ui.scroller.scrollLeft<600);
  assert.equal(ui.scroller.scrollTop,809);
});

test('morning clock remains visible even if all broadcasts start after noon',()=>{
  const ui=setup({schedule:[fixture(1,4,'18:00')]},{now:Date.parse('2026-10-16T06:10:00Z')});
  ui.mount();
  assert.match(ui.target.innerHTML,/Şimdi 09:10/);
  const position=Number(ui.target.innerHTML.match(/class="map-now" style="left:([\d.]+)px"/)[1]);
  assert.ok(position>=0);
  assert.match(ui.target.innerHTML,/8 sa 50 dk sonra/);
});

test('minute updates advance the next broadcast without moving a manually scrolled calendar',()=>{
  const ui=setup();ui.mount();
  ui.scroller.scrollLeft=412;ui.scroller.scrollTop=137;
  ui.setTime('2026-10-16T15:01:00Z');ui.mount();
  assert.match(ui.target.innerHTML,/Şimdi 18:01/);
  assert.match(ui.target.innerHTML,/class="map-next-copy"><strong>Anime 3<\/strong>/);
  assert.match(ui.target.innerHTML,/3 sa 59 dk sonra/);
  assert.match(ui.target.innerHTML,/class="map-event is-past"[^>]*>[\s\S]*?data-id="2"/);
  assert.equal(ui.scroller.scrollLeft,412);assert.equal(ui.scroller.scrollTop,137);
});

test('the now action deliberately returns from manual scrolling to the current day and hour',()=>{
  const ui=setup({}, {todayTop:850});ui.mount();
  const current=ui.scroller.scrollLeft;
  ui.scroller.scrollLeft=900;ui.scroller.scrollTop=20;
  ui.mount(false,{focusNow:true});
  assert.equal(ui.scroller.scrollLeft,current);assert.equal(ui.scroller.scrollTop,809);
});

test('loading earlier broadcasts keeps the current marker visible as the axis expands',()=>{
  const ui=setup({schedule:[]});ui.mount();
  const before=Number(ui.target.innerHTML.match(/class="map-now" style="left:([\d.]+)px"/)[1])-ui.scroller.scrollLeft;
  ui.state.schedule=[fixture(1,0,'00:05'),fixture(2,4,'18:00')];ui.mount();
  const after=Number(ui.target.innerHTML.match(/class="map-now" style="left:([\d.]+)px"/)[1])-ui.scroller.scrollLeft;
  assert.ok(before>=80 && before<720);
  assert.ok(after>=80 && after<720);
});

test('Istanbul midnight resets the current week and focuses the midnight marker',()=>{
  const ui=setup({}, {now:Date.parse('2026-10-18T20:59:00Z')});ui.mount();
  ui.scroller.scrollLeft=500;ui.scroller.scrollTop=400;
  ui.setTime('2026-10-18T21:00:00Z');ui.mount();
  assert.match(ui.target.innerHTML,/Şimdi 00:00/);
  assert.match(ui.target.innerHTML,/aria-label="Pazartesi, 19 Eki/);
  assert.equal(ui.scroller.scrollLeft,0);assert.equal(ui.scroller.scrollTop,0);
});

test('a broadcast recurring next week does not highlight its already passed card this week',()=>{
  const ui=setup({schedule:[fixture(1,0,'00:05')]},{now:Date.parse('2026-10-18T20:55:00Z')});ui.mount();
  assert.doesNotMatch(ui.target.innerHTML,/class="map-event is-next/);
  assert.match(ui.target.innerHTML,/Gelecek hafta · Pazartesi · 10 dk sonra/);
});


test('the first API response focuses today after the empty loading board clamps its scroll',()=>{
  const ui=setup({schedule:[],scheduleLoading:true},{todayTop:850});ui.mount();
  // The empty board is shorter than the viewport, so a browser clamps to zero.
  ui.scroller.scrollTop=0;ui.scroller.scrollLeft=0;
  ui.state.scheduleLoading=false;
  ui.state.schedule=[fixture(1,4,'18:00')];ui.mount();
  assert.equal(ui.scroller.scrollTop,809);
  assert.ok(ui.scroller.scrollLeft>0);
});


const agendaHtml=ui=>ui.target.innerHTML.match(/<section class="map-mobile-agenda"[\s\S]*?<\/section>/)[0];

test('touch agenda defaults to today, with a seven-day selector and chronological broadcasts',()=>{
  const ui=setup();ui.mount();const html=agendaHtml(ui);
  assert.equal(count(html,'map-day-tab'),7);
  assert.match(html,/data-map-day="4" aria-pressed="true"/);
  assert.match(html,/<h2 id="full-agenda-heading">Cuma<\/h2>/);
  assert.equal(count(html,'map-agenda-event'),2);
  assert.ok(html.indexOf('data-id="2"')<html.indexOf('data-id="3"'));
  assert.doesNotMatch(html,/data-id="1"/);
  assert.match(html,/data-map-mobile="true" data-action="detail" data-id="2"/);
});

test('choosing another weekday shows only that day with its selected date',()=>{
  const ui=setup();ui.state.day=0;ui.mount();const html=agendaHtml(ui);
  assert.match(html,/data-map-day="0" aria-pressed="true"/);
  assert.match(html,/<h2 id="full-agenda-heading">Pazartesi<\/h2>/);
  assert.match(html,/12 Ekim/);
  assert.equal(count(html,'map-agenda-event'),1);
  assert.match(html,/data-id="1"/);
  assert.doesNotMatch(html,/data-id="2"|data-id="3"/);
});

test('elapsed broadcasts today start collapsed without hiding the current scheduled minute',()=>{
  const ui=setup({schedule:[fixture(1,4,'10:00'),fixture(2,4,'17:15'),fixture(3,4,'18:00')]});ui.mount();
  let html=agendaHtml(ui);
  assert.match(html,/data-map-past aria-expanded="false"/);
  assert.match(html,/1 geçen yayını göster/);
  assert.doesNotMatch(html,/data-id="1"/);
  assert.match(html,/data-id="2"/);
  ui.state.mapPastOpen=true;ui.mount();html=agendaHtml(ui);
  assert.match(html,/data-map-past aria-expanded="true"/);
  assert.match(html,/data-id="1"/);
  assert.match(html,/Planlanan saat geçti/);
  ui.state.weekOffset=1;ui.mount();html=agendaHtml(ui);
  assert.doesNotMatch(html,/data-map-past|Planlanan saat geçti/);
  assert.equal(count(html,'map-agenda-event'),3);
});

test('mobile search, saved filtering, and bookmark state use the same actual broadcast data',()=>{
  const ui=setup({schedule:[fixture(1,4,'18:00'),fixture(2,4,'20:00',{broadcastLocal:false}),fixture(3,4,'21:00')]});
  ui.state.saved.add(3);ui.state.mapSaved=true;ui.mount();let html=agendaHtml(ui);
  assert.equal(count(html,'map-agenda-event'),1);
  assert.match(html,/class="map-agenda-save is-saved"[^>]*data-id="3"[^>]*aria-pressed="true"/);
  assert.doesNotMatch(html,/data-id="1"|data-id="2"/);
  ui.state.mapQuery='missing';ui.mount();html=agendaHtml(ui);
  assert.equal(count(html,'map-agenda-event'),0);
  assert.match(html,/Bu gün için filtreye uygun yayın bulunamadı/);
});

test('a finished daily plan offers the elapsed broadcasts without implying live playback',()=>{
  const ui=setup({schedule:[fixture(1,4,'10:00')]});ui.mount();const html=agendaHtml(ui);
  assert.match(html,/Bugün için sırada başka planlı yayın yok/);
  assert.match(html,/1 geçen yayını göster/);
  assert.doesNotMatch(html,/Yayında|İzle/);
});

test('mobile title text is escaped and invalid day selections fall back to today',()=>{
  const ui=setup({day:99,schedule:[fixture(1,4,'18:00',{title:'<img src=x onerror="bad()"> & Anime'})]});ui.mount();const html=agendaHtml(ui);
  assert.match(html,/data-map-day="4" aria-pressed="true"/);
  assert.match(html,/&lt;img src=x onerror=&quot;bad\(\)&quot;&gt; &amp; Anime/);
  assert.doesNotMatch(html,/<img src=x/);
});
