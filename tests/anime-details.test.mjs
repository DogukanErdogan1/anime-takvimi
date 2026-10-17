import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source = readFileSync(new URL('../public/site/data-provider.js', import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-17T09:00:00Z');
const TTL = 6 * 60 * 60 * 1000;
const response = (data, status = 200) => ({ok:status >= 200 && status < 300,status,headers:new Headers(),json:async()=>data});
const payload = (malId, fields = {}) => ({data:{mal_id:malId,...fields}});
const plain = value => JSON.parse(JSON.stringify(value));
const idle = async () => { for(let i=0;i<12;i++) await Promise.resolve(); };
function setup(fetcher = async()=>response(payload(1))) {
  const requests = [], storage = new Map(), clock = {now:NOW};
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [clock.now])); } static now() { return clock.now; } }
  const window = {};
  runInNewContext(source, {
    window, URL, Date:FixedDate, Intl, DOMException, AbortController, console,
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
    fetch:async(url,options)=>{requests.push({url,options});return fetcher(url,options);},
    setTimeout(fn,delay) { if(delay < 20000) queueMicrotask(fn); return 1; }, clearTimeout() {},
  }, {filename:'data-provider.js'});
  return {api:window.AnimeData,requests,storage,clock};
}

test('details use the shared credential-free API queue and build a canonical trailer URL from its video ID', async()=>{
  const ui = setup(async()=>response(payload(61987,{trailer:{youtube_id:'AbC_dE-1234',url:'https://untrusted.test/trailer'}})));
  assert.deepEqual(plain(await ui.api.getDetails(61987)),{trailerUrl:'https://www.youtube.com/watch?v=AbC_dE-1234',relations:[]});
  assert.equal(ui.requests.length,1);
  assert.equal(ui.requests[0].url,'https://api.tenrai.org/v1/anime/61987/full');
  assert.equal(ui.requests[0].options.credentials,'omit'); assert.equal(ui.requests[0].options.referrerPolicy,'no-referrer');
  assert.equal(ui.requests[0].options.headers.Accept,'application/json');
  assert.equal(ui.storage.size,0);
});

test('trailers reject URL-shaped, malformed, missing or non-string IDs rather than trusting API link fields', async()=>{
  for(const youtubeId of [undefined,null,12345678901,'short','a'.repeat(12),'abcdefghij/','abcdefghij?','https://www.youtube.com/watch?v=AbC_dE-1234','javascript:alert(1)']) {
    const ui = setup(async()=>response(payload(1,{trailer:{youtube_id:youtubeId,url:'https://untrusted.test/trailer',embed_url:'javascript:alert(1)'}})));
    assert.equal((await ui.api.getDetails(1)).trailerUrl,null);
  }
  const ui = setup(async()=>response(payload(1,{trailer:null})));
  assert.equal((await ui.api.getDetails(1)).trailerUrl,null);
});

test('relations accept distinct bounded numeric anime IDs, sanitize labels and ignore supplied external URLs', async()=>{
  const invalid = [{type:'manga',mal_id:2},{type:'Anime',mal_id:3},{type:'anime',mal_id:'4'},{type:'anime',mal_id:0},{type:'anime',mal_id:-1},{type:'anime',mal_id:1.5},{type:'anime',mal_id:2147483648}];
  const entries = [{type:'anime',mal_id:22,name:'<b>Previous season</b>',url:'javascript:alert(1)'},{type:'anime',mal_id:22,name:'Duplicate'},...invalid,{type:'anime',mal_id:23,name:''},{type:'anime',mal_id:24,name:'x'.repeat(501)}];
  const ui = setup(async()=>response(payload(1,{relations:[{relation:'Prequel',entry:entries},{relation:'Sequel',entry:[{type:'anime',mal_id:25,name:'Sequel',url:'https://untrusted.test/'}]}]})));
  assert.deepEqual(plain((await ui.api.getDetails(1)).relations),[
    {id:22,title:'Previous season',url:'https://myanimelist.net/anime/22'},
    {id:23,title:'MyAnimeList #23',url:'https://myanimelist.net/anime/23'},
    {id:24,title:'x'.repeat(500),url:'https://myanimelist.net/anime/24'},
    {id:25,title:'Sequel',url:'https://myanimelist.net/anime/25'},
  ]);
  const many = setup(async()=>response(payload(1,{relations:[{entry:Array.from({length:50},(_,index)=>({type:'anime',mal_id:index+1,name:'Related'}))}]})));
  assert.equal((await many.api.getDetails(1)).relations.length,20);
});

test('malformed relation groups and entries are skipped without losing valid related anime', async()=>{
  const ui = setup(async()=>response(payload(1,{relations:[null,42,{entry:null},{entry:'bad'},{entry:[null,42,'bad',{type:'anime',mal_id:2,name:'Good'}]}]})));
  assert.deepEqual(plain((await ui.api.getDetails(1)).relations),[{id:2,title:'Good',url:'https://myanimelist.net/anime/2'}]);
});

test('invalid request IDs never fetch, and mismatched or malformed API responses never enter the cache', async()=>{
  const ui = setup();
  for(const id of [null,undefined,'1','mal-1',0,-1,1.5,NaN,Infinity,2147483648]) await assert.rejects(ui.api.getDetails(id));
  assert.equal(ui.requests.length,0);
  for(const result of [null,{}, {data:null}, {data:[]},payload(2),payload('1')]) {
    let count = 0;
    const attempt = setup(async()=>response(++count === 1 ? result : payload(1,{trailer:{youtube_id:'AbC_dE-1234'}})));
    await assert.rejects(attempt.api.getDetails(1));
    assert.equal((await attempt.api.getDetails(1)).trailerUrl,'https://www.youtube.com/watch?v=AbC_dE-1234');
    assert.equal(attempt.requests.length,2);
  }
});

test('detail caches are isolated by anime and expire at the six-hour boundary', async()=>{
  let count = 0;
  const ui = setup(async url=>response(payload(Number(url.match(/\/anime\/(\d+)\/full$/)[1]),{trailer:{youtube_id:++count === 1 ? 'AbC_dE-1234' : '123456789ab'}})));
  const first = await ui.api.getDetails(1);
  assert.deepEqual(plain(await ui.api.getDetails(1)),plain(first)); assert.equal(ui.requests.length,1);
  await ui.api.getDetails(2); assert.equal(ui.requests.length,2);
  ui.clock.now = NOW + TTL - 1;
  assert.equal((await ui.api.getDetails(1)).trailerUrl,'https://www.youtube.com/watch?v=AbC_dE-1234'); assert.equal(ui.requests.length,2);
  ui.clock.now = NOW + TTL;
  assert.equal((await ui.api.getDetails(1)).trailerUrl,'https://www.youtube.com/watch?v=123456789ab'); assert.equal(ui.requests.length,3);
});

test('HTTP failures do not cache unavailable details, invent links or silently reuse expired results', async()=>{
  let count = 0;
  const ui = setup(async()=>++count === 1 || count === 3 ? response({},503) : response(payload(1)));
  await assert.rejects(ui.api.getDetails(1),error=>error.status===503);
  assert.deepEqual(plain(await ui.api.getDetails(1)),{trailerUrl:null,relations:[]});
  ui.clock.now += TTL;
  await assert.rejects(ui.api.getDetails(1),error=>error.status===503);
  assert.deepEqual(plain(await ui.api.getDetails(1)),{trailerUrl:null,relations:[]});
  assert.equal(ui.requests.length,4);
});

test('an already aborted signal rejects before a network request or a fresh cache hit', async()=>{
  const ui = setup(); const controller = new AbortController(); controller.abort();
  await assert.rejects(ui.api.getDetails(1,{signal:controller.signal}),error=>error.name==='AbortError');
  assert.equal(ui.requests.length,0);
  await ui.api.getDetails(1);
  await assert.rejects(ui.api.getDetails(1,{signal:controller.signal}),error=>error.name==='AbortError');
  assert.equal(ui.requests.length,1);
});

test('aborting a queued detail request does not fetch it or prevent subsequent requests', async()=>{
  let release;
  const ui = setup(async url=>new Promise(resolve=>{release=()=>resolve(response(payload(Number(url.match(/\/anime\/(\d+)\/full$/)[1]))));}));
  const first = ui.api.getDetails(1); await idle();
  const controller = new AbortController();
  const second = ui.api.getDetails(2,{signal:controller.signal}); const rejected = assert.rejects(second,error=>error.name==='AbortError');
  controller.abort(); release(); await first; await rejected;
  assert.equal(ui.requests.length,1);
  const third = ui.api.getDetails(3); await idle(); release(); await third;
  assert.equal(ui.requests.length,2); assert.ok(ui.requests[1].url.endsWith('/anime/3/full'));
});

test('aborting while consuming a response prevents returning or caching its trailer and relations', async()=>{
  const controller = new AbortController(); let count = 0;
  const ui = setup(async()=>({ok:true,status:200,headers:new Headers(),json:async()=>{
    count++; if(count === 1) controller.abort();
    return payload(1,{trailer:{youtube_id:'AbC_dE-1234'},relations:[{entry:[{type:'anime',mal_id:2,name:'Related'}]}]});
  }}));
  await assert.rejects(ui.api.getDetails(1,{signal:controller.signal}),error=>error.name==='AbortError');
  assert.equal(ui.requests.length,1);
  const next = await ui.api.getDetails(1); assert.equal(next.relations.length,1); assert.equal(ui.requests.length,2);
});
