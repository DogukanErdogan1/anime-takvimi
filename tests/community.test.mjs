import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { MembershipError, createMembershipService, readJsonMutation } from '../lib/membership.mjs';
import { createCommunityService, validateProfile, validateReview, validateReviewVisibility } from '../lib/community.mjs';

// Execute the same schema and parameterized queries as D1, including foreign keys.
class SQLiteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:'); this.sqlite.exec('PRAGMA foreign_keys=ON;');
    const root = new URL('../drizzle/', import.meta.url);
    for (const name of readdirSync(root).filter(value => value.endsWith('.sql')).sort()) this.sqlite.exec(readFileSync(new URL(name, root), 'utf8'));
  }
  prepare(sql) {
    const query = this.sqlite.prepare(sql); const database = this;
    const create = (values = []) => ({
      bind(...parameters) { return create(parameters); },
      async first(column) { const row = query.get(...values); return row ? column ? row[column] : {...row} : null; },
      async all() { return {results: query.all(...values).map(row => ({...row}))}; },
      async run() { return this._run(); },
      _run() { database.beforeRun?.(sql); return {meta: {changes: Number(query.run(...values).changes)}}; },
    });
    return create();
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN;');
    try { const result = statements.map(statement => statement._run()); this.sqlite.exec('COMMIT;'); return result; }
    catch (error) { this.sqlite.exec('ROLLBACK;'); throw error; }
  }
}
const caller = userId => ({userId, email: `${userId}@example.test`});
const alice = caller('alice'); const bob = caller('bob'); const owner = caller('owner');
const library = () => ({saved:['mal-1'],reminders:['mal-1'],progress:{'mal-1':4},view:'grid',savedAnime:{'mal-1':{id:'mal-1',title:'Anime'}},tracking:{'mal-1':'watching'},scores:{'mal-1':9},favorites:['mal-1'],collections:[{id:'favorites',title:'Favorilerim',animeIds:['mal-1']}]});
async function fixture(t) {
  const db = new SQLiteD1(); t.after(() => db.sqlite.close()); let time = '2026-10-17T10:00:00.000Z';
  const membership = createMembershipService(db, {adminEmail:owner.email,now:()=>time});
  for (const member of [alice,bob,owner]) await membership.register(member,{displayName:member.userId});
  const service = createCommunityService(db, {now:()=>time,makeId:randomUUID});
  return {db,membership,service,setTime(value){time=value;}};
}
const status = (action, expected) => assert.rejects(action, error => error instanceof MembershipError && error.status === expected);
const request = (payload, max=4096, headers={}) => readJsonMutation(new Request('https://anime.example/api/profile',{method:'PUT',headers:{Origin:'https://anime.example','Content-Type':'application/json',...headers},body:JSON.stringify(payload)}),max);

test('profiles are private by default and only their verified owner may update their bio', async t => {
  const {service} = await fixture(t);
  assert.deepEqual(await service.getProfile(alice),{profile:{id:'alice',displayName:'alice',bio:'',isPublic:false}});
  await status(()=>service.getPublicProfile('alice'),404);
  await status(()=>service.getProfile(null),401);
  await status(()=>service.putProfile(caller('unknown'),{bio:'Hello',isPublic:true}),403);
  await service.putProfile(alice,{bio:' Hello anime ',isPublic:true});
  assert.equal((await service.getProfile(alice)).profile.bio,'Hello anime');
  assert.equal((await service.getProfile(bob)).profile.bio,'');
  await status(()=>service.putProfile(bob,{bio:'forged',isPublic:true,userId:'alice'}),400);
});

test('an opted-in public profile shares only its own library and never email or reminders', async t => {
  const {service,membership} = await fixture(t);
  await membership.putLibrary(alice,{library:library()});
  await membership.putLibrary(bob,{library:{...library(),saved:['mal-2'],savedAnime:{'mal-2':{id:'mal-2',title:'Bobs private anime'}}}});
  await service.putProfile(alice,{bio:'Anime fan',isPublic:true});
  const result = await service.getPublicProfile('alice');
  assert.deepEqual(result.profile,{id:'alice',displayName:'alice',bio:'Anime fan',isPublic:true,createdAt:'2026-10-17T10:00:00.000Z'});
  const {reminders,...expected} = library(); assert.deepEqual(result.library,expected);
  assert.equal(JSON.stringify(result).includes('@'),false); assert.equal('reminders' in result.library,false);
  assert.equal(JSON.stringify(result).includes('Bobs private anime'),false);
  await status(()=>service.getPublicProfile('bob'),404);
  await status(()=>service.getPublicProfile("alice' OR 1=1 --"),404);
  await service.putProfile(alice,{bio:'Anime fan',isPublic:false});
  await status(()=>service.getPublicProfile('alice'),404);
});

test('public profile defaults optional library fields, and suspension hides it immediately', async t => {
  const {service,membership} = await fixture(t);
  await service.putProfile(alice,{bio:'',isPublic:true});
  assert.deepEqual((await service.getPublicProfile('alice')).library,{saved:[],savedAnime:{},progress:{},tracking:{},scores:{},favorites:[],collections:[],view:'grid'});
  await membership.setMemberStatus(owner,'alice',{status:'suspended'});
  await status(()=>service.getPublicProfile('alice'),404);
  await status(()=>service.getProfile(alice),403);
  await status(()=>service.putProfile(alice,{bio:'new',isPublic:true}),403);
});

test('public profiles exclude reminder-only and orphaned snapshots while retaining every shared library category', async t => {
  const {service,membership} = await fixture(t);
  const snapshots = Object.fromEntries(Array.from({length:8},(_,index)=>[`mal-${index+1}`,{id:`mal-${index+1}`,title:`Anime ${index+1}`} ]));
  await membership.putLibrary(alice,{library:{saved:['mal-1'],reminders:['mal-2','mal-3'],progress:{'mal-3':2},view:'grid',savedAnime:snapshots,tracking:{'mal-4':'watching'},scores:{'mal-5':8},favorites:['mal-6'],collections:[{id:'shared',title:'My collection',animeIds:['mal-7']}]}});
  await service.putProfile(alice,{bio:'',isPublic:true});
  const result = await service.getPublicProfile('alice');
  assert.deepEqual(Object.keys(result.library.savedAnime),['mal-1','mal-3','mal-4','mal-5','mal-6','mal-7']);
  assert.equal('reminders' in result.library,false);
  assert.equal(JSON.stringify(result).includes('Anime 2'),false);
  assert.equal(JSON.stringify(result).includes('Anime 8'),false);
  const ownLibrary = (await membership.getLibrary(alice)).library;
  assert.equal(ownLibrary.savedAnime['mal-2'].title,'Anime 2');
  assert.deepEqual(ownLibrary.reminders,['mal-2','mal-3']);
});

test('a member has one review per anime; edits retain ID and publication date with spoiler and optional score', async t => {
  const {service,db,setTime} = await fixture(t);
  const first = (await service.postReview(alice,'mal-1',{body:'A strong first episode',spoiler:true,score:9})).review;
  assert.equal(first.spoiler,true); assert.equal(first.score,9); assert.equal('email' in first,false);
  setTime('2026-10-17T10:00:01.000Z');
  const edit = (await service.postReview(alice,'1',{body:'Edited review',score:null})).review;
  assert.equal(edit.id,first.id); assert.equal(edit.createdAt,first.createdAt); assert.equal(edit.body,'Edited review');
  assert.equal(edit.score,null); assert.equal(edit.spoiler,false);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM anime_reviews').get().n,1);
  const otherAnime = (await service.postReview(alice,'2',{body:'Different anime'})).review;
  assert.notEqual(otherAnime.id,first.id);
  const result = await service.getReviews(1); assert.deepEqual(result,{reviews:[edit],average:null,total:1});
});

test('review lists preserve spoiler flags, use bounded pagination, and average only visible active authors', async t => {
  const {service,membership,setTime} = await fixture(t);
  const a = (await service.postReview(alice,1,{body:'Contains story spoilers',spoiler:true,score:9})).review;
  setTime('2026-10-17T10:00:01.000Z');
  const b = (await service.postReview(bob,1,{body:'Worth watching',score:6})).review;
  assert.deepEqual(await service.getReviews(1),{reviews:[b,a],average:7.5,total:2});
  assert.deepEqual((await service.getReviews(1,{limit:1,page:2})).reviews,[a]);
  await status(()=>service.getReviews(1,{limit:31}),400); await status(()=>service.getReviews(1,{page:0}),400);
  await status(()=>service.getReviews("1 OR 1=1"),400);
  await membership.setMemberStatus(owner,'bob',{status:'suspended'});
  assert.deepEqual(await service.getReviews(1),{reviews:[a],average:9,total:1});
  await status(()=>service.postReview(bob,1,{body:'Blocked'}),403);
  await service.hideReview(alice,1,a.id,{hidden:true});
  assert.deepEqual(await service.getReviews(1),{reviews:[],average:null,total:0});
});

test('review hiding checks ownership and actual server admin binding, and cannot be bypassed by editing', async t => {
  const {service,db} = await fixture(t);
  const review = (await service.postReview(alice,1,{body:'Original',score:8})).review;
  await status(()=>service.hideReview(null,1,review.id,{hidden:true}),401);
  await status(()=>service.hideReview({...bob,role:'admin'},1,review.id,{hidden:true}),404);
  await status(()=>service.hideReview(alice,2,review.id,{hidden:true}),404);
  await service.hideReview(owner,1,review.id,{hidden:true});
  assert.equal(db.sqlite.prepare('SELECT hidden_by FROM anime_reviews WHERE id=?').get(review.id).hidden_by,'owner');
  await status(()=>service.postReview(alice,1,{body:'Try to republish'}),409);
  assert.deepEqual(await service.getReviews(1),{reviews:[],average:null,total:0});
  await status(()=>service.hideReview(owner,1,review.id,{hidden:false}),400);
});

test('removing the admin_owner binding revokes moderation authority even if member.role remains admin', async t => {
  const {service,db} = await fixture(t);
  const review = (await service.postReview(alice,1,{body:'A review'})).review;
  db.sqlite.prepare("DELETE FROM app_settings WHERE key='admin_owner'").run();
  await status(()=>service.hideReview(owner,1,review.id,{hidden:true}),404);
  assert.equal((await service.getReviews(1)).total,1);
  assert.deepEqual(await service.hideReview(alice,1,review.id,{hidden:true}),{hidden:true});
});

test('write-time SQL checks reject suspension and moderator revocation after initial authorization', async t => {
  const {service,db} = await fixture(t);
  db.beforeRun = sql => { if(sql.startsWith('INSERT INTO member_profiles')) db.sqlite.prepare("UPDATE members SET status='suspended' WHERE id='alice'").run(); };
  await status(()=>service.putProfile(alice,{bio:'Should not persist',isPublic:true}),403);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM member_profiles').get().n,0);
  db.sqlite.prepare("UPDATE members SET status='active' WHERE id='alice'").run();
  db.beforeRun = sql => { if(sql.startsWith('INSERT INTO anime_reviews')) db.sqlite.prepare("UPDATE members SET status='suspended' WHERE id='alice'").run(); };
  await status(()=>service.postReview(alice,1,{body:'Should not persist'}),403);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM anime_reviews').get().n,0);
  db.sqlite.prepare("UPDATE members SET status='active' WHERE id='alice'").run();
  db.beforeRun = null;
  const review = (await service.postReview(alice,1,{body:'Still visible'})).review;
  db.beforeRun = sql => { if(sql.startsWith('UPDATE anime_reviews SET hidden=1')) db.sqlite.prepare("DELETE FROM app_settings WHERE key='admin_owner'").run(); };
  await status(()=>service.hideReview(owner,1,review.id,{hidden:true}),409);
  assert.equal((await service.getReviews(1)).total,1);
});

test('review throttle is per active account and atomically bounds concurrent requests; it resets after one minute', async t => {
  const {service,db,setTime} = await fixture(t);
  const results = await Promise.allSettled(Array.from({length:14},(_,index)=>service.postReview(alice,index+1,{body:'A valid review'})));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,10);
  assert.equal(results.filter(result=>result.status==='rejected' && result.reason.status===429).length,4);
  assert.equal(db.sqlite.prepare('SELECT attempts FROM community_rate_limits WHERE bucket_key=?').get('review:alice').attempts,10);
  await service.postReview(bob,1,{body:'Independent account'});
  setTime('2026-10-17T10:01:00.000Z'); await service.postReview(alice,99,{body:'After reset'});
  assert.equal(db.sqlite.prepare('SELECT attempts FROM community_rate_limits WHERE bucket_key=?').get('review:alice').attempts,1);
});

test('profile and review inputs reject privilege fields, malformed values, and oversized content', () => {
  for(const input of [null,[],{}, {bio:'x',isPublic:'true'},{bio:'x'.repeat(501),isPublic:false},{bio:'',isPublic:true,email:'secret@example.test'},{bio:'\0',isPublic:false}]) assert.throws(()=>validateProfile(input),MembershipError);
  for(const input of [null,[],{}, {body:' '},{body:'x'.repeat(2001)},{body:'valid',score:0},{body:'valid',score:11},{body:'valid',score:7.5},{body:'valid',spoiler:1},{body:'valid',userId:'owner'},{body:'valid',hidden:false}]) assert.throws(()=>validateReview(input),MembershipError);
  for(const input of [null,{},{hidden:false},{hidden:true,userId:'owner'}]) assert.throws(()=>validateReviewVisibility(input),MembershipError);
  assert.deepEqual(validateReview({body:'  Good  '}),{body:'Good',spoiler:false,score:null});
});

test('new mutation routes use bounded same-origin JSON readers, which reject bad origins and body sizes', async () => {
  for(const [path,limit] of [['profile/route.ts',4096],['anime/[id]/reviews/route.ts',16384],['anime/[id]/reviews/[reviewId]/route.ts',1024]]) {
    const source = readFileSync(new URL(`../app/api/${path}`,import.meta.url),'utf8');
    assert.ok(source.includes(`readJsonMutation(request, ${limit})`));
  }
  await status(()=>request({bio:'',isPublic:true},4096,{Origin:'https://other.example'}),403);
  await status(()=>request({body:'x'.repeat(2000)},1024),413);
  await status(()=>request({bio:'',isPublic:true},4096,{'Content-Type':'text/plain'}),415);
});

test('the real migration enforces database-level review uniqueness, bounds and references', async t => {
  const {db,service} = await fixture(t);
  const review = (await service.postReview(alice,1,{body:'Valid'})).review;
  assert.throws(()=>db.sqlite.prepare('INSERT INTO anime_reviews(id,anime_id,user_id,body) VALUES(?,?,?,?)').run('duplicate',1,'alice','Duplicate'),/UNIQUE/);
  assert.throws(()=>db.sqlite.prepare('INSERT INTO anime_reviews(id,anime_id,user_id,body) VALUES(?,?,?,?)').run('orphan',2,'unknown','Orphan'),/FOREIGN KEY/);
  assert.throws(()=>db.sqlite.prepare('UPDATE anime_reviews SET score=11 WHERE id=?').run(review.id),/CHECK/);
  assert.throws(()=>db.sqlite.prepare('UPDATE anime_reviews SET spoiler=3 WHERE id=?').run(review.id),/CHECK/);
  assert.throws(()=>db.sqlite.prepare('INSERT INTO member_profiles(user_id,bio,is_public) VALUES(?,?,?)').run('alice','x',2),/CHECK/);
});
