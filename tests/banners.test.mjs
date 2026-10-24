import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createMembershipService, MembershipError } from '../lib/membership.mjs';
import { bannerId, createBannerService } from '../lib/banners.mjs';

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN4UxQBAAQEAbeNTRuQAAAAAElFTkSuQmCC','base64'));
const OWNER = {userId:'banner-owner',email:'owner@example.test'};
const MEMBER = {userId:'banner-member',email:'member@example.test'};
const REMOTE = 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/b21-example.jpg';
class D1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:'); this.sqlite.exec('PRAGMA foreign_keys=ON');
    const dir = new URL('../drizzle/',import.meta.url);
    for (const name of readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) this.sqlite.exec(readFileSync(new URL(name,dir),'utf8'));
  }
  prepare(sql) {
    const prepared = this.sqlite.prepare(sql);
    const bound = (args=[]) => ({
      bind:(...values) => bound(values),
      first:async () => { const row=prepared.get(...args); return row ? {...row} : null; },
      all:async () => ({results:prepared.all(...args).map(row=>({...row}))}),
      run:async () => ({meta:{changes:Number(prepared.run(...args).changes)}}),
      runSync:() => ({meta:{changes:Number(prepared.run(...args).changes)}}),
    }); return bound();
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try { const result=statements.map(s=>s.runSync()); this.sqlite.exec('COMMIT'); return result; }
    catch(error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}
class R2 {
  objects = new Map(); calls = [];
  async put(key,bytes,options) { this.calls.push(['put',key]); this.objects.set(key,{bytes:bytes.slice(),options}); }
  async get(key) { this.calls.push(['get',key]); const value=this.objects.get(key); return value ? {body:value.bytes,httpMetadata:value.options.httpMetadata} : null; }
  async delete(key) { this.calls.push(['delete',key]); this.objects.delete(key); }
}
async function fixture(t) {
  const db=new D1(); t.after(()=>db.sqlite.close()); const bucket=new R2();
  const membership=createMembershipService(db,{adminEmail:OWNER.email});
  await membership.register(OWNER,{displayName:'Banner Admin'}); await membership.register(MEMBER,{displayName:'Member'});
  return {db,bucket,membership,banners:createBannerService(db,bucket)};
}
function request({method='POST',origin='https://anime.example',body=PNG,type='image/png'}={}) {
  return new Request('https://anime.example/api/banners/21',{method,headers:{...(origin ? {Origin:origin} : {}),'Content-Type':type},...(method==='DELETE' ? {} : {body})});
}
const errorStatus = status => error => error instanceof MembershipError && error.status===status;

test('banner identifiers reject path injection, coercions and out-of-range IDs',() => {
  for(const id of ['',0,-1,'1/../2','21?image=x','01','1.0','2e3',2147483648,{}]) assert.throws(()=>bannerId(id),errorStatus(400));
  assert.equal(bannerId('21'),21); assert.equal(bannerId(2147483647),2147483647);
});
test('only the active bound administrator may write public banner images',async t => {
  const {banners,bucket,db}=await fixture(t);
  await assert.rejects(()=>banners.upload(null,21,request()),errorStatus(401));
  await assert.rejects(()=>banners.upload(MEMBER,21,request()),errorStatus(403));
  db.sqlite.prepare("DELETE FROM app_settings WHERE key='admin_owner'").run();
  await assert.rejects(()=>banners.upload(OWNER,21,request()),errorStatus(403));
  assert.equal(bucket.calls.length,0);
});
test('public metadata and exact revision reads work without a member identity',async t => {
  const {banners,bucket}=await fixture(t);
  assert.deepEqual(await banners.info(21),{bannerUrl:null});
  const result=await banners.upload(OWNER,21,request());
  assert.match(result.bannerUrl,/^\/api\/banners\/21\?image=[0-9a-f-]{36}$/);
  assert.deepEqual(await banners.info(21),result);
  const version=new URL(result.bannerUrl,'https://anime.example').searchParams.get('image');
  const image=await banners.get(21,version); assert.equal(image.contentType,'image/png'); assert.deepEqual(image.body,PNG);
  assert.equal(bucket.objects.size,1);
  await assert.rejects(()=>banners.get(22,version),errorStatus(404));
  await assert.rejects(()=>banners.get(21,'../../secret'),errorStatus(404));
});
test('upload validates same-origin, raster signatures and streaming byte limits',async t => {
  const {banners,bucket}=await fixture(t);
  await assert.rejects(()=>banners.upload(OWNER,21,request({origin:null})),errorStatus(403));
  await assert.rejects(()=>banners.upload(OWNER,21,request({origin:'https://evil.example'})),errorStatus(403));
  await assert.rejects(()=>banners.upload(OWNER,21,request({body:new TextEncoder().encode('<svg/>')})),errorStatus(415));
  await assert.rejects(()=>banners.upload(OWNER,21,request({body:new Uint8Array(2*1024*1024+1)})),errorStatus(413));
  assert.equal(bucket.calls.length,0);
});
test('replacement deletes the old revision, reset returns to automatic banners',async t => {
  const {banners,bucket}=await fixture(t);
  const first=await banners.upload(OWNER,21,request()); const second=await banners.upload(OWNER,21,request());
  assert.notEqual(first.bannerUrl,second.bannerUrl); assert.equal(bucket.objects.size,1);
  const oldVersion=new URL(first.bannerUrl,'https://anime.example').searchParams.get('image');
  await assert.rejects(()=>banners.get(21,oldVersion),errorStatus(404));
  await assert.rejects(()=>banners.remove(OWNER,21,request({method:'DELETE',origin:'https://evil.example'})),errorStatus(403));
  assert.equal(bucket.objects.size,1);
  assert.deepEqual(await banners.remove(OWNER,21,request({method:'DELETE'})),{bannerUrl:null});
  assert.deepEqual(await banners.info(21),{bannerUrl:null}); assert.equal(bucket.objects.size,0);
});
test('database failure cleans the attempted image and preserves the previous banner',async t => {
  const {banners,bucket,db}=await fixture(t); const previous=await banners.upload(OWNER,21,request());
  db.sqlite.exec("CREATE TRIGGER reject_banner BEFORE UPDATE ON anime_banners BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
  await assert.rejects(()=>banners.upload(OWNER,21,request()),/fixture failure/);
  assert.deepEqual(await banners.info(21),previous); assert.equal(bucket.objects.size,1);
});
test('permission revocation while uploading cannot commit a banner pointer',async t => {
  const {banners,bucket,db}=await fixture(t); const put=bucket.put.bind(bucket);
  bucket.put=async(...args)=>{ await put(...args); db.sqlite.prepare("UPDATE members SET status='suspended' WHERE id=?").run(OWNER.userId); };
  await assert.rejects(()=>banners.upload(OWNER,21,request()),errorStatus(403));
  assert.deepEqual(await banners.info(21),{bannerUrl:null}); assert.equal(bucket.objects.size,0);
});
test('tampered pointers cannot read or delete another anime image',async t => {
  const {banners,bucket,db}=await fixture(t); const target=await banners.upload(OWNER,22,request());
  const key=db.sqlite.prepare('SELECT object_key FROM anime_banners WHERE mal_id=22').get().object_key;
  db.sqlite.prepare('INSERT INTO anime_banners(mal_id,object_key,content_type,updated_by) VALUES(?,?,?,?)').run(21,key,'image/png',OWNER.userId);
  assert.deepEqual(await banners.info(21),{bannerUrl:null});
  await banners.remove(OWNER,21,request({method:'DELETE'}));
  assert.equal(bucket.objects.has(key),true); assert.equal((await banners.info(22)).bannerUrl,target.bannerUrl);
});

function client(fetcher,existing={}) {
  const cache=new Map(Object.entries(existing)); const events=[]; const context={URL,AbortController,setTimeout,clearTimeout,console,location:{origin:'https://anime.example'},
    localStorage:{getItem:key=>cache.get(key) ?? null,setItem:(key,value)=>cache.set(key,value)},
    fetch:fetcher, CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}},window:{dispatchEvent:event=>events.push(event)}};
  runInNewContext(readFileSync(new URL('../public/site/hero-banners.js',import.meta.url),'utf8'),context);
  return {...context.window,cache,events};
}
const json=value=>Response.json(value);
test('client uses only AniList landscape CDN or exact same-origin image revisions',() => {
  const {AnimeBanners:api}=client(()=>{});
  assert.equal(api.safeBanner(REMOTE,21),REMOTE);
  for(const value of ['https://evil.example/banner.jpg','http://s4.anilist.co/file/anilistcdn/media/anime/banner/a.jpg','https://s4.anilist.co.evil.example/file/anilistcdn/media/anime/banner/a.jpg','https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/a.jpg','https://s4.anilist.co/file/anilistcdn/media/anime/banner/a.svg','//evil.example/api/banners/21','/api/account/avatar?v=123']) assert.equal(api.safeBanner(value,21),null);
  const local='/api/banners/21?image=8ef661ce-4073-4a9b-8903-028b64bf2d31';
  assert.equal(api.safeBanner(local,21),local); assert.equal(api.safeBanner(local,22),null); assert.equal(api.safeBanner(local+'&extra=yes',21),null);
});
test('client deduplicates requests and keeps catalog images outside its metadata',async()=>{
  const calls=[]; const {AnimeBanners:api,cache}=client(async(url,options)=>{calls.push([url,options]); return url.startsWith('/api/') ? json({bannerUrl:null}) : json({data:{Media:{idMal:21,bannerImage:REMOTE}}});});
  assert.deepEqual(await Promise.all([api.resolve(21),api.resolve(21),api.resolve(21)]),[REMOTE,REMOTE,REMOTE]);
  assert.equal(await api.resolve(21),REMOTE); assert.equal(calls.length,2);
  const query=JSON.parse(calls[1][1].body); assert.equal(query.variables.id,21); assert.match(query.query,/idMal: \$id/);
  assert.equal(calls[1][1].credentials,'omit'); assert.equal(cache.size,1);
});
test('custom images take precedence, invalidation reloads metadata and reset uses AniList',async()=>{
  const local='/api/banners/21?image=8ef661ce-4073-4a9b-8903-028b64bf2d31'; let custom=local; let anilistCalls=0;
  const {AnimeBanners:api,events}=client(async(url,options)=>{
    if(url.startsWith('/api/')) {if(options.method==='DELETE')custom=null;return json({bannerUrl:custom});}
    anilistCalls++;return json({data:{Media:{idMal:21,bannerImage:REMOTE}}});
  });
  assert.equal(await api.resolve(21),local); assert.equal(anilistCalls,0);
  await api.remove(21); assert.equal(await api.resolve(21),REMOTE); assert.equal(anilistCalls,1); assert.equal(events[0].detail.malId,21);
});
test('missing or failing automatic art returns null and caches the failure',async()=>{
  let calls=0; const {AnimeBanners:api}=client(async url=>{calls++; if(url.startsWith('/api/'))return json({bannerUrl:null}); throw new Error('offline');});
  assert.equal(await api.resolve(21),null);assert.equal(await api.resolve(21),null);assert.equal(calls,2);
  assert.equal(await api.resolve('../21'),null);
});


const COVER='https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21-example.jpg';
test('poster fallback batches and deduplicates MAL identifiers, then reuses validated covers',async()=>{
  const calls=[];
  const {AnimeBanners:api,cache}=client(async(url,options)=>{
    calls.push([url,options]);
    return json({data:{p21:{idMal:21,coverImage:{extraLarge:COVER}},p22:{idMal:22,coverImage:{extraLarge:'https://evil.example/a.jpg',large:COVER.replace('bx21','bx22')}}}});
  });
  const result=await Promise.all([api.resolvePoster(21),api.resolvePoster(22),api.resolvePoster(21)]);
  assert.deepEqual(result,[COVER,COVER.replace('bx21','bx22'),COVER]);
  assert.equal(calls.length,1);assert.equal(calls[0][0],'https://graphql.anilist.co');
  assert.equal(calls[0][1].credentials,'omit');
  const query=JSON.parse(calls[0][1].body).query;
  assert.equal((query.match(/Media\(/g)||[]).length,2);assert.match(query,/idMal: 21/);assert.match(query,/coverImage/);
  assert.equal(await api.resolvePoster(21),COVER);assert.equal(calls.length,1);
  assert.equal(JSON.parse(cache.get('anime-takvimi-posters-v1:21')).value,COVER);
});

test('poster fallback validates raster URLs, matching IDs, poisoned cache entries and rate-limit failures',async()=>{
  let calls=0;
  const {AnimeBanners:api}=client(async()=>{calls++;return json({data:{p21:{idMal:22,coverImage:{extraLarge:COVER}}}});},{'anime-takvimi-posters-v1:21':JSON.stringify({value:'https://evil.example/a.jpg',expires:Date.now()+10000})});
  for(const value of ['https://evil.example/a.jpg',COVER+'?x=1',COVER+'#x',COVER.replace('.jpg','.svg'),COVER.replace('s4.anilist.co','s4.anilist.co.evil.example'),COVER.replace('https:','http:'),COVER.replace('/cover/large/','/banner/')])assert.equal(api.safePoster(value),null);
  assert.equal(api.safePoster(COVER),COVER);
  assert.equal(await api.resolvePoster('../21'),null);assert.equal(calls,0);
  assert.equal(await api.resolvePoster(21),null);assert.equal(await api.resolvePoster(21),null);assert.equal(calls,1);
  let failures=0;
  const failing=client(async()=>{failures++;return new Response('',{status:429});}).AnimeBanners;
  assert.equal(await failing.resolvePoster(22),null);assert.equal(await failing.resolvePoster(22),null);assert.equal(failures,1);
});

test('large poster batches stay bounded and map every result to its own MAL anime',async()=>{
  const sizes=[];
  const {AnimeBanners:api}=client(async(_url,options)=>{
    const ids=[...JSON.parse(options.body).query.matchAll(/idMal: (\d+)/g)].map(match=>Number(match[1]));sizes.push(ids.length);
    return json({data:Object.fromEntries(ids.map(id=>['p'+id,{idMal:id,coverImage:{large:COVER.replace('bx21','bx'+id)}}]))});
  });
  const ids=Array.from({length:26},(_,index)=>index+1),result=await Promise.all(ids.map(id=>api.resolvePoster(id)));
  assert.deepEqual(sizes,[12,12,2]);assert.deepEqual(result,ids.map(id=>COVER.replace('bx21','bx'+id)));
});
