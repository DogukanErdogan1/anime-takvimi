import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { MembershipError, createMembershipService } from '../lib/membership.mjs';
import { createCommunityService } from '../lib/community.mjs';
import { AVATAR_FRAMES, isAvatarFrame, normalizeAvatarFrame } from '../lib/avatar-frames.mjs';
import { createProfileFrameService, validateProfileFrame } from '../lib/profile-frame.mjs';

class SQLiteD1 {
  constructor({omitFrames=false}={}) {
    this.sqlite=new DatabaseSync(':memory:');this.sqlite.exec('PRAGMA foreign_keys=ON');
    const directory=new URL('../drizzle/',import.meta.url);
    for(const name of readdirSync(directory).filter(name=>name.endsWith('.sql')).sort()) {
      if(omitFrames&&name==='0006_member_profile_frames.sql')continue;
      this.sqlite.exec(readFileSync(new URL(name,directory),'utf8'));
    }
  }
  prepare(sql) {
    const database=this,statement=this.sqlite.prepare(sql);
    const bound=(values=[])=>({
      bind(...parameters){return bound(parameters);},
      async first(){const row=statement.get(...values);return row?{...row}:null;},
      async all(){return {results:statement.all(...values).map(row=>({...row}))};},
      async run(){return this._run();},
      _run(){database.beforeRun?.(sql);return {meta:{changes:Number(statement.run(...values).changes)}};},
    });return bound();
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try{const result=statements.map(statement=>statement._run());this.sqlite.exec('COMMIT');return result;}
    catch(error){this.sqlite.exec('ROLLBACK');throw error;}
  }
}
const identity=userId=>({userId,email:`${userId}@example.test`});
const alice=identity('alice'),bob=identity('bob');
const date='2026-10-18T12:00:00.000Z';
async function fixture(t,options={}) {
  const db=new SQLiteD1(options);t.after(()=>db.sqlite.close());
  const membership=createMembershipService(db,{now:()=>date});
  for(const actor of [alice,bob])await membership.register(actor,{displayName:actor.userId});
  return {db,membership,frames:createProfileFrameService(db,{now:()=>date}),community:createCommunityService(db,{now:()=>date})};
}
const put=(payload={frameId:'platin'},{origin='https://anime.example',method='PUT',type='application/json',body,headers={},query=''}={})=>new Request(`https://anime.example/api/profile/frame${query}`,{
  method,headers:{...(origin===null?{}:{Origin:origin}),...(type===null?{}:{'Content-Type':type}),...headers},body:body??JSON.stringify(payload),
});
const rejected=(operation,status,code)=>assert.rejects(operation,error=>error instanceof MembershipError&&error.status===status&&(!code||error.code===code));
const ownRow=(db,user='alice')=>db.sqlite.prepare('SELECT * FROM member_profile_frames WHERE user_id=?').get(user);
async function accountRoute(t,env,actor) {
  const key=`__frame_account_test_${crypto.randomUUID().replaceAll('-','')}`;
  globalThis[key]={env,actor};t.after(()=>delete globalThis[key]);
  let source=readFileSync(new URL('../lib/account-route.ts',import.meta.url),'utf8')
    .replace("import { env } from 'cloudflare:workers';",`const env=globalThis[${JSON.stringify(key)}].env;`)
    .replace("import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from '@/app/chatgpt-auth';",`const getChatGPTUser=async()=>globalThis[${JSON.stringify(key)}].actor;const chatGPTSignInPath=()=>'/giris';const chatGPTSignOutPath=()=>'/api/auth/signout';`);
  for(const file of ['membership.mjs','avatar.mjs','profile-frame.mjs'])source=source.replaceAll(`'./${file}'`,JSON.stringify(new URL(`../lib/${file}`,import.meta.url).href));
  const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
  return import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
}

test('frame metadata shares the twelve approved IDs and permits only explicit frame choices',()=>{
  assert.equal(AVATAR_FRAMES.length,12);assert.equal(new Set(AVATAR_FRAMES.map(frame=>frame.id)).size,12);
  assert.deepEqual(AVATAR_FRAMES.map(frame=>frame.name),['Platin','Yörünge','Editör','Kırık Halo','Mürekkep','Panel','Kristal','Krom Akış','Defne','Krizantem','Koi','Yıldız Mührü']);
  for(const id of ['none',...AVATAR_FRAMES.map(frame=>frame.id)]){assert.equal(isAvatarFrame(id),true);assert.deepEqual(validateProfileFrame({frameId:id}),{frameId:id});}
  for(const value of [null,undefined,0,'','PLATIN','<svg/>','../platin','https://evil.example/frame.svg',{},[]]){assert.equal(isAvatarFrame(value),false);assert.equal(normalizeAvatarFrame(value),'none');}
  for(const payload of [null,[],{}, {frameId:'unknown'}, {frameId:'platin',userId:'bob'}, {frameId:'platin',html:'<svg/>'},Object.assign(Object.create({frameId:'platin'}),{})])assert.throws(()=>validateProfileFrame(payload),error=>error.status===400);
});

test('frame choices survive new service instances, reset to none and remain scoped to the verified account',async t=>{
  const {db,frames}=await fixture(t);
  assert.deepEqual(await frames.getOwn(alice),{avatarFrame:'none',updatedAt:null});
  const selected=await frames.put(alice,put({frameId:'koi'},{query:'?userId=bob'}));
  assert.deepEqual(selected,{avatarFrame:'koi',updatedAt:date});assert.equal(ownRow(db).frame_id,'koi');assert.equal(ownRow(db,'bob'),undefined);
  const fresh=createProfileFrameService(db);assert.equal(await fresh.ownFrame(alice),'koi');assert.equal(await fresh.ownFrame(bob),'none');
  await fresh.put(bob,put({frameId:'kristal'}));assert.equal(await frames.ownFrame(alice),'koi');
  assert.deepEqual(await frames.put(alice,put({frameId:'none'})),{avatarFrame:'none',updatedAt:date});assert.equal(await fresh.ownFrame(bob),'kristal');
});

test('anonymous, unregistered and suspended accounts cannot read or change private frame choices',async t=>{
  const {db,frames}=await fixture(t);await frames.put(alice,put());
  for(const actor of [null,identity('unregistered')]) {
    const status=actor?403:401;
    await rejected(()=>frames.getOwn(actor),status);await rejected(()=>frames.put(actor,put({frameId:'panel'})),status);
  }
  db.sqlite.prepare("UPDATE members SET status='suspended' WHERE id='alice'").run();
  await rejected(()=>frames.getOwn(alice),403,'account_suspended');await rejected(()=>frames.put(alice,put({frameId:'panel'})),403);
  assert.equal(ownRow(db).frame_id,'platin');
});

test('public frame reads require an active account and opted-in public profile; bio edits preserve the selected frame',async t=>{
  const {db,frames,community}=await fixture(t);await frames.put(alice,put({frameId:'defne'}));
  assert.equal(await frames.publicFrame('alice'),'none');assert.equal(await frames.publicFrame('unknown'),'none');
  for(const id of [null,'',{},'\u0000'])assert.equal(await frames.publicFrame(id),'none');
  await community.putProfile(alice,{bio:'First bio',isPublic:true});assert.equal(await frames.publicFrame('alice'),'defne');
  await community.putProfile(alice,{bio:'Edited bio',isPublic:true});assert.equal(await frames.ownFrame(alice),'defne');assert.equal(await frames.publicFrame('alice'),'defne');
  await community.putProfile(alice,{bio:'Private again',isPublic:false});assert.equal(await frames.publicFrame('alice'),'none');
  await community.putProfile(alice,{bio:'',isPublic:true});db.sqlite.prepare("UPDATE members SET status='suspended' WHERE id='alice'").run();assert.equal(await frames.publicFrame('alice'),'none');
});

test('mutation requires exact origin, JSON, PUT, bounded bytes and exact {frameId} payload',async t=>{
  const {db,frames}=await fixture(t);await frames.put(alice,put({frameId:'yorunge'}));
  for(const origin of [null,'null','https://evil.example','http://anime.example'])await rejected(()=>frames.put(alice,put(undefined,{origin})),403);
  for(const method of ['POST','PATCH','DELETE'])await rejected(()=>frames.put(alice,put(undefined,{method})),405);
  for(const type of [null,'text/plain'])await rejected(()=>frames.put(alice,put(undefined,{type})),415);
  for(const payload of [{},{frameId:'unknown'},{frameId:'platin',userId:'bob'},{frameId:'platin',avatarFrame:'koi'},null,[]])await rejected(()=>frames.put(alice,put(payload)),400);
  await rejected(()=>frames.put(alice,put(undefined,{body:'{'})),400);
  await rejected(()=>frames.put(alice,put(undefined,{headers:{'Content-Length':'1025'}})),413);
  await rejected(()=>frames.put(alice,put(undefined,{body:' '.repeat(1025),headers:{'Content-Length':'1'}})),413);
  assert.equal(ownRow(db).frame_id,'yorunge');assert.equal(ownRow(db,'bob'),undefined);
});

test('suspension between authorization and SQL write cannot insert or replace a frame',async t=>{
  const {db,frames}=await fixture(t);
  db.beforeRun=sql=>{if(sql.startsWith('INSERT INTO member_profile_frames'))db.sqlite.prepare("UPDATE members SET status='suspended' WHERE id='alice'").run();};
  await rejected(()=>frames.put(alice,put()),403,'account_suspended');assert.equal(ownRow(db),undefined);
  db.beforeRun=null;db.sqlite.prepare("UPDATE members SET status='active' WHERE id='alice'").run();await frames.put(alice,put({frameId:'murekkep'}));
  db.beforeRun=sql=>{if(sql.startsWith('INSERT INTO member_profile_frames'))db.sqlite.prepare("UPDATE members SET status='suspended' WHERE id='alice'").run();};
  await rejected(()=>frames.put(alice,put({frameId:'platin'})),403,'account_suspended');assert.equal(ownRow(db).frame_id,'murekkep');
});

test('a pending migration preserves profile readability but saving clearly reports temporary unavailability',async t=>{
  const {frames}=await fixture(t,{omitFrames:true});
  assert.deepEqual(await frames.getOwn(alice),{avatarFrame:'none',updatedAt:null});assert.equal(await frames.publicFrame('alice'),'none');
  await rejected(()=>frames.put(alice,put()),503,'frame_unavailable');
  assert.throws(()=>createProfileFrameService(null),error=>error.status===503&&error.code==='frame_unavailable');
});

test('database constraints reject arbitrary frames and orphan accounts',async t=>{
  const {db,frames}=await fixture(t);await frames.put(alice,put());
  assert.throws(()=>db.sqlite.prepare('UPDATE member_profile_frames SET frame_id=? WHERE user_id=?').run('<svg/>','alice'),/CHECK/);
  assert.throws(()=>db.sqlite.prepare('INSERT INTO member_profile_frames(user_id,frame_id) VALUES(?,?)').run('unknown','platin'),/FOREIGN KEY/);
});

test('the real account response returns the saved frame without requiring an image-storage bucket',async t=>{
  const {db,frames}=await fixture(t);await frames.put(alice,put({frameId:'krizantem'}));
  const route=await accountRoute(t,{DB:db},alice);const response=await route.accountResponse();const account=await response.json();
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Vary'),'Cookie');
  assert.equal(account.user.id,'alice');assert.equal(account.user.avatarFrame,'krizantem');assert.equal(account.user.avatarUrl,null);
  const anonymousRoute=await accountRoute(t,{DB:db},null);const anonymous=await(await anonymousRoute.accountResponse()).json();assert.equal(anonymous.authenticated,false);assert.equal(anonymous.user,undefined);
});

test('the real account response tolerates a pending frame migration and preserves ordinary errors',async t=>{
  const {db}=await fixture(t,{omitFrames:true});const route=await accountRoute(t,{DB:db},alice);
  assert.equal((await(await route.accountResponse()).json()).user.avatarFrame,'none');
  const original=db.prepare.bind(db);db.prepare=sql=>{if(sql.includes('FROM member_profile_frames'))throw new Error('Database unavailable');return original(sql);};
  await assert.rejects(()=>route.accountResponse(),/Database unavailable/);
});
