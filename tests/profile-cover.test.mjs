import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { MembershipError, createMembershipService } from '../lib/membership.mjs';
import { createCommunityService } from '../lib/community.mjs';
import { createProfileCoverService, profileCoverObjectPrefix, profileCoverImageResponse } from '../lib/profile-cover.mjs';

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN4UxQBAAQEAbeNTRuQAAAAAElFTkSuQmCC','base64'));
const WEBP = Uint8Array.from(Buffer.from('UklGRjoAAABXRUJQVlA4IC4AAADQAQCdASoBAAEAAUAmJaACdLoB+AADsAD+5zD/+LORiOzzf/XAfnAfnAfysAAA','base64'));
class SQLiteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:'); this.sqlite.exec('PRAGMA foreign_keys=ON');
    const directory = new URL('../drizzle/',import.meta.url);
    for(const name of readdirSync(directory).filter(name=>name.endsWith('.sql')).sort()) this.sqlite.exec(readFileSync(new URL(name,directory),'utf8'));
  }
  prepare(sql) {
    const statement = this.sqlite.prepare(sql), database = this;
    const bound = (values=[]) => ({
      bind(...parameters){return bound(parameters);},
      async first(){const row=statement.get(...values);return row?{...row}:null;},
      async all(){return {results:statement.all(...values).map(row=>({...row}))};},
      async run(){return this._run();},
      _run(){database.beforeRun?.(sql);return {meta:{changes:Number(statement.run(...values).changes)}};},
    });
    return bound();
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try{const results=statements.map(statement=>statement._run());this.sqlite.exec('COMMIT');return results;}
    catch(error){this.sqlite.exec('ROLLBACK');throw error;}
  }
}
class FakeR2 {
  objects=new Map(); calls=[]; canceled=[];
  async put(key,bytes,options={}) {
    this.calls.push({method:'put',key,options:structuredClone(options)});
    this.objects.set(key,{bytes:bytes.slice(),options:structuredClone(options)});
    await this.afterPut?.(key);
    return {key};
  }
  async get(key) {
    this.calls.push({method:'get',key}); const object=this.objects.get(key);
    if(!object)return null;
    const database=this;
    const body=new ReadableStream({start(controller){controller.enqueue(object.bytes.slice());controller.close();},cancel(){database.canceled.push(key);}});
    await this.afterGet?.(key);
    return {body,httpMetadata:object.options.httpMetadata,size:object.bytes.length};
  }
  async delete(key) {this.calls.push({method:'delete',key});await this.beforeDelete?.(key);this.objects.delete(key);}
}
const identity=userId=>({userId,email:`${userId}@example.test`});
const alice=identity('alice'),bob=identity('bob'),owner=identity('owner');
async function fixture(t) {
  const db=new SQLiteD1();t.after(()=>db.sqlite.close());const bucket=new FakeR2();
  const options={now:()=> '2026-10-17T12:00:00.000Z'};
  const membership=createMembershipService(db,{...options,adminEmail:owner.email});
  for(const user of [alice,bob,owner]) await membership.register(user,{displayName:user.userId});
  return {db,bucket,membership,community:createCommunityService(db,options),covers:createProfileCoverService(db,bucket,options)};
}
const rejected=(operation,status)=>assert.rejects(operation,error=>error instanceof MembershipError&&error.status===status);
function upload(bytes=PNG,{origin='https://anime.example',type='image/png',method='POST',headers={},query=''}={}) {
  return new Request(`https://anime.example/api/profile/cover${query}`,{method,headers:{...(origin===null?{}:{Origin:origin}),...(type===null?{}:{'Content-Type':type}),...headers},...(method==='GET'?{}:{body:bytes})});
}
const remove=(origin='https://anime.example',method='DELETE')=>new Request('https://anime.example/api/profile/cover',{method,headers:origin===null?{}:{Origin:origin}});
const revision=url=>new URL(url,'https://anime.example').searchParams.get('v');
const ownRow=(db,userId='alice')=>db.sqlite.prepare('SELECT * FROM member_covers WHERE user_id=?').get(userId);
const bytesOf=async image=>new Uint8Array(await new Response(image.body).arrayBuffer());

test('own cover uploads use hashed immutable R2 keys, validated raster bytes and private version URLs',async t=>{
  const {db,bucket,covers}=await fixture(t);
  assert.equal(await covers.ownUrl(alice),null);
  const result=await covers.upload(alice,upload());const row=ownRow(db);
  assert.match(result.coverUrl,/^\/api\/profile\/cover\?v=[a-f0-9-]{36}$/);
  assert.equal(result.updatedAt,'2026-10-17T12:00:00.000Z');
  assert.equal(row.object_key,`cover/${createHash('sha256').update('alice').digest('hex')}/${revision(result.coverUrl)}`);
  assert.equal(row.object_key.length,107);
  assert.deepEqual(bucket.calls[0].options.httpMetadata,{contentType:'image/png',cacheControl:'private, no-store'});
  assert.equal(await covers.ownUrl(alice),result.coverUrl);
  assert.deepEqual(await bytesOf(await covers.getOwn(alice,revision(result.coverUrl))),PNG);
  const opaque="../another-user' OR 1=1 --";
  assert.equal(await profileCoverObjectPrefix(opaque),`cover/${createHash('sha256').update(opaque).digest('hex')}`);
});

test('cover read responses forbid caching and content sniffing for both private and public images',async t=>{
  const {covers}=await fixture(t);const result=await covers.upload(alice,upload());
  const response=profileCoverImageResponse(await covers.getOwn(alice,revision(result.coverUrl)));
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('Vary'),'Cookie');
  assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(response.headers.get('Cross-Origin-Resource-Policy'),'same-origin');
  assert.equal(response.headers.get('Content-Type'),'image/png');assert.equal(response.headers.get('Content-Disposition'),'inline; filename="profile-cover"');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),PNG);
});

test('a private cover never becomes public without profile opt-in and cannot be read through another account',async t=>{
  const {covers,bucket,community}=await fixture(t);const result=await covers.upload(alice,upload());const version=revision(result.coverUrl);
  assert.equal(await covers.publicUrl('alice'),null);
  const calls=bucket.calls.length;
  await rejected(()=>covers.getPublic('alice',version),404);await rejected(()=>covers.getOwn(bob,version),404);
  assert.equal(bucket.calls.length,calls);
  await community.putProfile(alice,{bio:'My profile',isPublic:true});
  assert.equal(await covers.publicUrl('alice'),`/api/profiles/alice/cover?v=${version}`);
  assert.deepEqual(await bytesOf(await covers.getPublic('alice',version)),PNG);
  await community.putProfile(alice,{bio:'My profile',isPublic:false});
  await rejected(()=>covers.getPublic('alice',version),404);assert.equal(await covers.publicUrl('alice'),null);
  assert.deepEqual(await bytesOf(await covers.getOwn(alice,version)),PNG);
});

test('anonymous, unregistered and suspended accounts cannot read or mutate private covers',async t=>{
  const {covers,membership,bucket,community}=await fixture(t);
  const result=await covers.upload(alice,upload());const version=revision(result.coverUrl);
  for(const actor of [null,identity('unregistered')]) {
    const status=actor?403:401;
    await rejected(()=>covers.upload(actor,upload()),status);await rejected(()=>covers.ownUrl(actor),status);
    await rejected(()=>covers.getOwn(actor,version),status);await rejected(()=>covers.remove(actor,remove()),status);
  }
  await community.putProfile(alice,{bio:'',isPublic:true});
  await membership.setMemberStatus(owner,'alice',{status:'suspended'});const calls=bucket.calls.length;
  await rejected(()=>covers.upload(alice,upload()),403);await rejected(()=>covers.ownUrl(alice),403);
  await rejected(()=>covers.getOwn(alice,version),403);await rejected(()=>covers.remove(alice,remove()),403);
  await rejected(()=>covers.getPublic('alice',version),404);assert.equal(await covers.publicUrl('alice'),null);
  assert.equal(bucket.calls.length,calls);
});

test('replacing and deleting covers revoke all old version URLs and clean only their own objects',async t=>{
  const {covers,bucket,db,community}=await fixture(t);
  const first=await covers.upload(alice,upload());const firstKey=ownRow(db).object_key;
  const other=await covers.upload(bob,upload());const otherKey=ownRow(db,'bob').object_key;
  const second=await covers.upload(alice,upload(WEBP,{type:'image/webp'}));
  assert.notEqual(second.coverUrl,first.coverUrl);assert.equal(bucket.objects.has(firstKey),false);assert.equal(bucket.objects.has(otherKey),true);
  await rejected(()=>covers.getOwn(alice,revision(first.coverUrl)),404);
  assert.deepEqual(await bytesOf(await covers.getOwn(alice,revision(second.coverUrl))),WEBP);
  await community.putProfile(alice,{bio:'',isPublic:true});await rejected(()=>covers.getPublic('alice',revision(first.coverUrl)),404);
  assert.deepEqual(await covers.remove(alice,remove()),{coverUrl:null});assert.equal(ownRow(db),undefined);
  assert.equal(await covers.ownUrl(alice),null);assert.equal(await covers.publicUrl('alice'),null);
  await rejected(()=>covers.getOwn(alice,revision(second.coverUrl)),404);await rejected(()=>covers.getPublic('alice',revision(second.coverUrl)),404);
  assert.deepEqual(await covers.remove(alice,remove()),{coverUrl:null});
  assert.deepEqual(await bytesOf(await covers.getOwn(bob,revision(other.coverUrl))),PNG);
});

test('raw uploads enforce exact origin, MIME, actual and advertised size, and cannot accept keys or URLs',async t=>{
  const {covers,bucket}=await fixture(t);
  for(const origin of [null,'null','https://evil.example','http://anime.example']) await rejected(()=>covers.upload(alice,upload(PNG,{origin})),403);
  await rejected(()=>covers.upload(alice,upload(PNG,{method:'PUT'})),405);
  await rejected(()=>covers.upload(alice,upload(new TextEncoder().encode('<svg/>'),{type:'image/png'})),415);
  await rejected(()=>covers.upload(alice,upload(PNG,{type:'image/jpeg'})),415);
  await rejected(()=>covers.upload(alice,upload(PNG,{type:'application/json'})),415);
  await rejected(()=>covers.upload(alice,upload(new Uint8Array())),400);
  await rejected(()=>covers.upload(alice,upload(PNG,{headers:{'Content-Length':String(2*1024*1024+1)}})),413);
  await rejected(()=>covers.upload(alice,upload(new Uint8Array(2*1024*1024+1),{headers:{'Content-Length':'1'}})),413);
  for(const origin of [null,'null','https://evil.example']) await rejected(()=>covers.remove(alice,remove(origin)),403);
  await rejected(()=>covers.remove(alice,remove('https://anime.example','POST')),405);
  assert.equal(bucket.calls.length,0);
  const result=await covers.upload(alice,upload(PNG,{query:'?userId=bob&key=cover/bob&url=https://evil.example'}));
  assert.ok(result.coverUrl.startsWith('/api/profile/cover?v='));assert.equal(await covers.ownUrl(bob),null);
});

test('missing, malformed, foreign and obsolete versions never trigger an R2 read',async t=>{
  const {covers,bucket}=await fixture(t);await covers.upload(alice,upload());const calls=bucket.calls.length;
  for(const version of [undefined,null,'','../object','https://evil.example','00000000-0000-4000-8000-000000000000']) await rejected(()=>covers.getOwn(alice,version),404);
  assert.equal(bucket.calls.length,calls);
});

test('R2 or database upload failure removes only the attempted object and preserves the previous cover',async t=>{
  const {covers,bucket,db}=await fixture(t);const first=await covers.upload(alice,upload());const key=ownRow(db).object_key;
  bucket.afterPut=()=>{throw new Error('R2 failure after partial write');};
  await assert.rejects(covers.upload(alice,upload()),/R2 failure/);
  assert.equal(await covers.ownUrl(alice),first.coverUrl);assert.deepEqual([...bucket.objects.keys()],[key]);
  bucket.afterPut=null;db.beforeRun=sql=>{if(sql.startsWith('UPDATE member_covers'))throw new Error('DB unavailable');};
  await assert.rejects(covers.upload(alice,upload()),/DB unavailable/);db.beforeRun=null;
  assert.equal(await covers.ownUrl(alice),first.coverUrl);assert.deepEqual([...bucket.objects.keys()],[key]);
});

test('suspension during upload or deletion prevents committing a change after initial authorization',async t=>{
  const {covers,bucket,db}=await fixture(t);const first=await covers.upload(alice,upload());const key=ownRow(db).object_key;
  bucket.afterPut=()=>{db.sqlite.prepare("UPDATE members SET status='suspended' WHERE id='alice'").run();};
  await rejected(()=>covers.upload(alice,upload()),403);assert.equal(ownRow(db).object_key,key);assert.deepEqual([...bucket.objects.keys()],[key]);
  bucket.afterPut=null;db.sqlite.prepare("UPDATE members SET status='active' WHERE id='alice'").run();
  db.beforeRun=sql=>{if(sql.startsWith('DELETE FROM member_covers'))db.sqlite.prepare("UPDATE members SET status='suspended' WHERE id='alice'").run();};
  await rejected(()=>covers.remove(alice,remove()),403);db.beforeRun=null;
  assert.equal(ownRow(db).object_key,key);assert.equal(bucket.objects.has(key),true);
  db.sqlite.prepare("UPDATE members SET status='active' WHERE id='alice'").run();assert.equal(await covers.ownUrl(alice),first.coverUrl);
});

test('profile privacy or account suspension during R2 reads revokes the in-flight image',async t=>{
  const {covers,bucket,community,db}=await fixture(t);const first=await covers.upload(alice,upload());const version=revision(first.coverUrl);
  await community.putProfile(alice,{bio:'',isPublic:true});
  bucket.afterGet=()=>{db.sqlite.prepare("UPDATE member_profiles SET is_public=0 WHERE user_id='alice'").run();};
  await rejected(()=>covers.getPublic('alice',version),404);
  bucket.afterGet=()=>{db.sqlite.prepare("UPDATE members SET status='suspended' WHERE id='alice'").run();};
  await rejected(()=>covers.getOwn(alice,version),404);
  assert.equal(bucket.canceled.length,2);
});

test('concurrent first uploads cannot overwrite the winning version or leave the losing object reachable',async t=>{
  const {covers,bucket,db}=await fixture(t);const pending=[];
  bucket.afterPut=key=>new Promise(resolve=>pending.push({key,resolve}));
  const first=covers.upload(alice,upload()),second=covers.upload(alice,upload(WEBP,{type:'image/webp'}));const settled=Promise.allSettled([first,second]);
  for(let i=0;i<100&&pending.length<2;i++)await new Promise(setImmediate);
  assert.equal(pending.length,2);
  pending[1].resolve();
  for(let i=0;i<100&&!ownRow(db);i++)await new Promise(setImmediate);
  assert.equal(ownRow(db).object_key,pending[1].key);
  pending[0].resolve();const results=await settled;
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.filter(result=>result.status==='rejected'&&result.reason.status===409).length,1);
  assert.deepEqual([...bucket.objects.keys()],[pending[1].key]);
});

test('replacement during an R2 read invalidates its already retrieved old stream',async t=>{
  const {covers,bucket}=await fixture(t);const first=await covers.upload(alice,upload());let latest;
  bucket.afterGet=async()=>{bucket.afterGet=null;latest=await covers.upload(alice,upload(WEBP,{type:'image/webp'}));};
  await rejected(()=>covers.getOwn(alice,revision(first.coverUrl)),404);
  assert.equal(bucket.canceled.length,1);assert.deepEqual(await bytesOf(await covers.getOwn(alice,revision(latest.coverUrl))),WEBP);
});

test('cleanup failures do not expose deleted or replaced versions, and corrupt metadata cannot target other objects',async t=>{
  const {covers,bucket,db}=await fixture(t);const first=await covers.upload(alice,upload());const firstKey=ownRow(db).object_key;
  bucket.beforeDelete=()=>{throw new Error('Cleanup unavailable');};
  const second=await covers.upload(alice,upload());assert.equal(bucket.objects.has(firstKey),true);
  await rejected(()=>covers.getOwn(alice,revision(first.coverUrl)),404);
  await covers.remove(alice,remove());await rejected(()=>covers.getOwn(alice,revision(second.coverUrl)),404);
  bucket.beforeDelete=null;const bobs=await covers.upload(bob,upload());const bobsKey=ownRow(db,'bob').object_key;
  db.sqlite.prepare('INSERT INTO member_covers(user_id,object_key,content_type) VALUES(?,?,?)').run('alice',bobsKey,'image/png');
  assert.equal(await covers.ownUrl(alice),null);await rejected(()=>covers.getOwn(alice,revision(bobs.coverUrl)),404);
  await covers.remove(alice,remove());assert.equal(bucket.objects.has(bobsKey),true);
});

test('mismatched R2 content metadata is refused and schema rejects invalid types, paths and orphan owners',async t=>{
  const {covers,bucket,db}=await fixture(t);const result=await covers.upload(alice,upload());const row=ownRow(db);
  bucket.objects.get(row.object_key).options.httpMetadata.contentType='text/html';await rejected(()=>covers.getOwn(alice,revision(result.coverUrl)),404);
  assert.throws(()=>db.sqlite.prepare('UPDATE member_covers SET object_key=? WHERE user_id=?').run('../foreign','alice'),/CHECK/);
  assert.throws(()=>db.sqlite.prepare('UPDATE member_covers SET content_type=? WHERE user_id=?').run('image/svg+xml','alice'),/CHECK/);
  assert.throws(()=>db.sqlite.prepare('INSERT INTO member_covers(user_id,object_key,content_type) VALUES(?,?,?)').run('unknown',row.object_key,'image/png'),/FOREIGN KEY/);
});
