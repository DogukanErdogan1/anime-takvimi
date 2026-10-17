import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source = readFileSync(new URL('../public/site/data-provider.js', import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-16T09:00:00Z');
const TTL = 6 * 60 * 60 * 1000;
const PREFIX = 'anime-takvimi-data-v1:';
const image = id => `https://cdn.myanimelist.net/images/anime/1/${id}.jpg`;
const anime = (id, poster = image(id)) => ({mal_id:id,title:`Anime ${id}`,members:1000-id,images:{jpg:{large_image_url:poster}}});
const response = (data, status = 200) => ({ok:status >= 200 && status < 300,status,headers:new Headers(),json:async()=>data});
function setup(fetcher = async()=>response({data:[]})) {
  const storage = new Map(), requests = [];
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [NOW])); } static now() { return NOW; } }
  const window = {};
  runInNewContext(source, {
    window, URL, Date:FixedDate, Intl, DOMException, AbortController, console,
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
    fetch:async(url,options)=>{requests.push({url,options});return fetcher(url,options);},
    setTimeout(fn, delay) { if (delay < 20000) queueMicrotask(fn); return 1; }, clearTimeout() {},
  }, {filename:'data-provider.js'});
  const cache = (key,items,fetchedAt = NOW) => storage.set(PREFIX+key,JSON.stringify({version:1,anime:items,fetchedAt,source:'MyAnimeList / Tenrai'}));
  return {api:window.AnimeData,storage,requests,cache};
}

test('preview requests only popular first page and selects distinct safe posters in server order', async()=>{
  const ui = setup(async()=>response({data:[anime(1),anime(1,image(99)),anime(2,image(1)),anime(3,'javascript:alert(1)'),anime(4,'https://elsewhere.test/image.jpg'),anime(5),anime(6)],pagination:{has_next_page:true}}));
  const result = await ui.api.getSeasonPreview(2026,'fall');
  assert.deepEqual(Array.from(result.anime,item=>item.id),['mal-1','mal-5','mal-6']);
  assert.equal(ui.requests.length,1);
  assert.equal(ui.requests[0].url,'https://api.tenrai.org/v1/seasons/2026/fall?sfw&order_by=members&sort=desc&limit=12&page=1');
  assert.equal(result.cached,false); assert.equal(result.stale,false); assert.equal(result.fetchedAt,NOW);
  assert.deepEqual([...ui.storage.keys()],[PREFIX+'season-preview-2026-fall']);
});

test('fresh complete-season cache supplies previews without network or cache mutation', async()=>{
  const ui = setup();
  ui.cache('season-2026-fall',[anime(1),anime(2),anime(3),anime(4)].map(ui.api.normalize));
  const before = ui.storage.get(PREFIX+'season-2026-fall');
  const result = await ui.api.getSeasonPreview(2026,'fall');
  assert.deepEqual(Array.from(result.anime,item=>item.id),['mal-1','mal-2','mal-3']);
  assert.equal(ui.requests.length,0); assert.equal(result.cached,true); assert.equal(result.stale,false);
  assert.equal(ui.storage.size,1); assert.equal(ui.storage.get(PREFIX+'season-2026-fall'),before);
});

test('preview cache is reused until six hours and force refreshes without touching full cache', async()=>{
  const ui = setup(async()=>response({data:[anime(4)]}));
  ui.cache('season-preview-2026-fall',[ui.api.normalize(anime(1))]);
  let result = await ui.api.getSeasonPreview(2026,'fall');
  assert.equal(result.anime[0].id,'mal-1'); assert.equal(result.cached,true); assert.equal(ui.requests.length,0);
  ui.cache('season-2026-fall',[ui.api.normalize(anime(2))]);
  result = await ui.api.getSeasonPreview(2026,'fall',{force:true});
  assert.equal(result.anime[0].id,'mal-4'); assert.equal(result.cached,false); assert.equal(ui.requests.length,1);
  assert.equal(JSON.parse(ui.storage.get(PREFIX+'season-2026-fall')).anime[0].id,'mal-2');
  const expired = setup(async()=>response({data:[anime(3)]}));
  expired.cache('season-preview-2026-fall',[expired.api.normalize(anime(1))],NOW-TTL);
  assert.equal((await expired.api.getSeasonPreview(2026,'fall')).anime[0].id,'mal-3');
  assert.equal(expired.requests.length,1);
});

test('failed refresh keeps prior preview timestamp and marks it stale', async()=>{
  const ui = setup(async()=>response({},503));
  ui.cache('season-preview-2026-fall',[ui.api.normalize(anime(1))],NOW-TTL-1);
  const result = await ui.api.getSeasonPreview(2026,'fall');
  assert.equal(result.stale,true); assert.equal(result.cached,true); assert.equal(result.fetchedAt,NOW-TTL-1);
  assert.equal(result.anime[0].id,'mal-1');
  assert.equal(JSON.parse(ui.storage.get(PREFIX+'season-preview-2026-fall')).fetchedAt,NOW-TTL-1);
});

test('uncached HTTP failure is preserved and does not invent art or cache results', async()=>{
  const ui = setup(async()=>response({},503));
  await assert.rejects(ui.api.getSeasonPreview(2026,'fall'),error=>error.status===503);
  assert.equal(ui.storage.size,0);
});

test('invalid preview image cache is discarded and empty API season remains an empty preview', async()=>{
  const ui = setup(async()=>response({data:[]}));
  ui.cache('season-preview-2026-fall',[{...ui.api.normalize(anime(1)),image:'https://untrusted.test/image.jpg'}]);
  const result = await ui.api.getSeasonPreview(2026,'fall');
  assert.equal(result.anime.length,0); assert.equal(result.cached,false); assert.equal(ui.requests.length,1);
});

test('season validation and already aborted signals never make requests, including fresh caches', async()=>{
  const ui = setup(); const controller = new AbortController(); controller.abort();
  for (const [year,season] of [[1916,'fall'],[3000,'fall'],['2026','fall'],[2026,'autumn']]) await assert.rejects(ui.api.getSeasonPreview(year,season));
  ui.cache('season-2026-fall',[ui.api.normalize(anime(1))]);
  await assert.rejects(ui.api.getSeasonPreview(2026,'fall',{signal:controller.signal}),error=>error.name==='AbortError');
  assert.equal(ui.requests.length,0);
});

test('aborted queued preview never fetches and queue still serves the following season', async()=>{
  let release;
  const ui = setup(async()=>new Promise(resolve=>{release=()=>resolve(response({data:[anime(1)]}));}));
  const first = ui.api.getSeasonPreview(2026,'winter');
  for(let i=0;i<5;i++) await Promise.resolve();
  const controller = new AbortController();
  const second = ui.api.getSeasonPreview(2026,'spring',{signal:controller.signal});
  const rejected = assert.rejects(second,error=>error.name==='AbortError');
  controller.abort(); release(); await first; await rejected;
  assert.equal(ui.requests.length,1);
  const third = ui.api.getSeasonPreview(2026,'summer');
  for(let i=0;i<10;i++) await Promise.resolve();
  release(); await third; assert.equal(ui.requests.length,2);
});

test('abort after response never returns stale fallback or writes a preview cache', async()=>{
  const controller = new AbortController();
  const ui = setup(async()=>({ok:true,status:200,headers:new Headers(),json:async()=>{controller.abort();return {data:[anime(1)]};}}));
  ui.cache('season-preview-2026-fall',[ui.api.normalize(anime(2))],NOW-TTL-1);
  const before = ui.storage.get(PREFIX+'season-preview-2026-fall');
  await assert.rejects(ui.api.getSeasonPreview(2026,'fall',{signal:controller.signal}),error=>error.name==='AbortError');
  assert.equal(ui.storage.get(PREFIX+'season-preview-2026-fall'),before);
});
