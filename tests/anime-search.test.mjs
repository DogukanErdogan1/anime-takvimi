import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source = readFileSync(new URL('../public/site/data-provider.js', import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-18T09:00:00Z');
const anime = (id, title = `Anime ${id}`) => ({mal_id:id,title,images:{jpg:{large_image_url:`https://cdn.myanimelist.net/images/anime/1/${id}.jpg`}}});
const response = (body, status = 200) => ({ok:status >= 200 && status < 300,status,headers:new Headers(),json:async()=>body});
function setup(fetcher = async()=>response({data:[anime(1)]})) {
  let now = NOW;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const requests = [], storage = new Map(), window = {};
  runInNewContext(source, {
    window, URL, Date:Clock, Intl, DOMException, AbortController,
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
    fetch:async(url,options)=>{requests.push({url,options});return fetcher(url,options);},
    setTimeout(fn, delay) { if (delay < 20000) queueMicrotask(fn); return 1; }, clearTimeout() {},
  }, {filename:'data-provider.js'});
  return {api:window.AnimeData,requests,storage,advance(ms){now+=ms;}};
}

test('suggestions encode the query, keep relevance order, normalize real posters and fetch only one small page', async()=>{
  const unsafe = {...anime(3),images:{jpg:{large_image_url:'https://untrusted.test/poster.jpg'}}};
  const ui = setup(async()=>response({data:[null,anime(1,'<b>Naruto</b>'),anime(1),unsafe,...Array.from({length:10},(_,i)=>anime(i+4))],pagination:{has_next_page:true}}));
  for (const query of ['', ' ', 'n', null, {}]) assert.equal((await ui.api.searchAnime(query)).anime.length,0);
  assert.equal(ui.requests.length,0);
  const result = await ui.api.searchAnime('  Naruto  &\t Şippuden  ');
  assert.equal(ui.requests.length,1);
  assert.equal(ui.requests[0].url,'https://api.tenrai.org/v1/anime?sfw&q=Naruto%20%26%20%C5%9Eippuden&limit=8&page=1');
  assert.equal(ui.requests[0].options.credentials,'omit');
  assert.deepEqual(Array.from(result.anime,item=>item.malId),[1,3,4,5,6,7,8,9]);
  assert.equal(result.anime[0].title,'Naruto'); assert.equal(result.anime[1].image,null);
  assert.equal(result.cached,false); assert.equal(result.fetchedAt,NOW);
  assert.equal(ui.storage.size,0);
});

test('normalized query cache lasts five minutes, includes empty results and does not expose its array to mutation', async()=>{
  const ui = setup(async()=>response({data:[]}));
  const result = await ui.api.searchAnime('Naruto Shippuden');
  result.anime.push({id:'fake'});
  const cached = await ui.api.searchAnime('  NARUTO   SHIPPUDEN  ');
  assert.equal(cached.cached,true); assert.equal(cached.anime.length,0); assert.equal(ui.requests.length,1);
  ui.advance(5*60*1000);
  assert.equal((await ui.api.searchAnime('naruto shippuden')).cached,false);
  assert.equal(ui.requests.length,2); assert.equal(ui.storage.size,0);
});

test('suggestion cache keeps at most fifty recent query entries', async()=>{
  const ui = setup();
  for(let i=0;i<50;i++) await ui.api.searchAnime(`query ${i}`);
  assert.equal(ui.requests.length,50);
  await ui.api.searchAnime('query 0');
  await ui.api.searchAnime('query 50');
  assert.equal((await ui.api.searchAnime('query 0')).cached,true);
  assert.equal(ui.requests.length,51);
  assert.equal((await ui.api.searchAnime('query 1')).cached,false);
  assert.equal(ui.requests.length,52);
});

test('malformed and failed responses never become cached successful suggestions', async()=>{
  let mode = 'malformed';
  const ui = setup(async()=>mode==='malformed'?response({data:{}}):mode==='failed'?response({},503):response({data:[anime(2)]}));
  await assert.rejects(ui.api.searchAnime('naruto'),/beklenmeyen/);
  mode='failed'; await assert.rejects(ui.api.searchAnime('naruto'),error=>error.status===503);
  mode='ready';
  const result = await ui.api.searchAnime('naruto');
  assert.equal(result.cached,false); assert.equal(result.anime[0].id,'mal-2');
  assert.equal(ui.requests.length,3);
});

test('abort is honored before cache access, while queued and after response without poisoning later searches', async()=>{
  let release;
  const ui = setup(async()=>new Promise(resolve=>{release=()=>resolve(response({data:[anime(1)]}));}));
  const first = ui.api.searchAnime('naruto');
  for(let i=0;i<5;i++) await Promise.resolve();
  const queuedController = new AbortController();
  const queued = ui.api.searchAnime('bleach',{signal:queuedController.signal});
  const rejected = assert.rejects(queued,error=>error.name==='AbortError');
  queuedController.abort(); release(); await first; await rejected;
  assert.equal(ui.requests.length,1);
  await assert.rejects(ui.api.searchAnime('naruto',{signal:queuedController.signal}),error=>error.name==='AbortError');
  const later = ui.api.searchAnime('bleach');
  for(let i=0;i<10;i++) await Promise.resolve();
  release(); await later; assert.equal(ui.requests.length,2);

  const responseController = new AbortController(); let abortResponse = true;
  const other = setup(async()=>({ok:true,status:200,headers:new Headers(),json:async()=>{if(abortResponse)responseController.abort();return {data:[anime(3)]};}}));
  await assert.rejects(other.api.searchAnime('one piece',{signal:responseController.signal}),error=>error.name==='AbortError');
  abortResponse=false;
  assert.equal((await other.api.searchAnime('one piece')).cached,false);
  assert.equal(other.requests.length,2);
});
