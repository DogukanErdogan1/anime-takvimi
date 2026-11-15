import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readdirSync,readFileSync} from 'node:fs';
import {createMembershipService,MembershipError} from '../lib/membership.mjs';
import {createWatchClubService,sharedAnime} from '../lib/watch-clubs.mjs';
class D1{
 constructor(){this.sqlite=new DatabaseSync(':memory:');this.sqlite.exec('PRAGMA foreign_keys=ON');for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())this.sqlite.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));}
 prepare(sql){const q=this.sqlite.prepare(sql),db=this,create=(values=[])=>({bind(...args){return create(args);},async first(){const row=q.get(...values);return row?{...row}:null;},async all(){return {results:q.all(...values).map(r=>({...r}))};},async run(){return this._run();},_run(){db.beforeRun?.(sql);return {meta:{changes:Number(q.run(...values).changes)}};}});return create();}
 async batch(statements){this.sqlite.exec('BEGIN');try{const results=statements.map(s=>s._run());this.sqlite.exec('COMMIT');return results;}catch(e){this.sqlite.exec('ROLLBACK');throw e;}}
}
const identity=id=>({userId:id,email:id+'@example.test'}),alice=identity('alice'),bob=identity('bob'),eve=identity('eve');
const rejects=(fn,status)=>assert.rejects(fn,e=>e instanceof MembershipError&&e.status===status);
async function fixture(t){const db=new D1();t.after(()=>db.sqlite.close());const membership=createMembershipService(db);for(const who of [alice,bob,eve])await membership.register(who,{displayName:who.userId});let time=Date.parse('2026-11-15T12:00:00Z'),counter=0;const service=createWatchClubService(db,{now:()=>time,makeId:()=>`club-${++counter}`});return {db,service,advance(ms){time+=ms;}};}
const item=malId=>({malId,title:'Real anime '+malId});
test('shared snapshots accept only explicit public metadata, reject private fields and arbitrary URLs',()=>{
 assert.deepEqual(sharedAnime(item(1)),{id:'mal-1',malId:1,title:'Real anime 1',image:null});
 for(const value of [{...item(1),notes:'private'},{...item(1),image:'https://evil.test'},{...item(1),progress:5},item(0),{...item(1),title:'\n'}])assert.throws(()=>sharedAnime(value),MembershipError);
});
test('only an active authenticated member can create and unauthorized readers cannot discover a private club',async t=>{
 const {service}=await fixture(t);await rejects(()=>service.list(null),401);await rejects(()=>service.create(identity('unknown'),{title:'x'}),403);const {club}=await service.create(alice,{title:'Movie night'});assert.equal(club.members.length,1);assert.equal((await service.list(bob)).clubs.length,0);await rejects(()=>service.get(bob,club.id),404);await rejects(()=>service.add(bob,club.id,item(1)),404);await rejects(()=>service.create(alice,{title:'x',ownerId:'bob'}),400);assert.ok(!JSON.stringify(club).includes('@'));
});
test('invites are hashed, owner-only, explicit, rotating and expiring',async t=>{
 const {db,service,advance}=await fixture(t),{club}=await service.create(alice,{title:'Friends'}),invite=await service.invite(alice,club.id);assert.equal(invite.token.length,64);const row=db.sqlite.prepare('SELECT * FROM watch_club_invites').get();assert.notEqual(row.token_hash,invite.token);assert.equal((await service.get(alice,club.id)).club.members.length,1);
 await service.join(bob,{token:invite.token});await service.join(bob,{token:invite.token});assert.equal((await service.get(alice,club.id)).club.members.length,2);await rejects(()=>service.invite(bob,club.id),403);
 const rotated=await service.invite(alice,club.id);await rejects(()=>service.join(eve,{token:invite.token}),404);advance(7*86400000);await rejects(()=>service.join(eve,{token:rotated.token}),404);
});
test('one vote per person moves atomically and removal or leaving clears votes',async t=>{
 const {service,db}=await fixture(t),{club}=await service.create(alice,{title:'Vote'});const invite=await service.invite(alice,club.id);await service.join(bob,{token:invite.token});await service.add(alice,club.id,item(1));await service.add(bob,club.id,item(2));await service.vote(alice,club.id,1);await service.vote(bob,club.id,1);assert.equal((await service.get(alice,club.id)).club.entries[0].votes,2);
 await service.vote(bob,club.id,2);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM watch_club_votes').get().n,2);await rejects(()=>service.vote(eve,club.id,1),404);await rejects(()=>service.vote(bob,club.id,999),409);await rejects(()=>service.remove(bob,club.id,1),409);
 await service.remove(alice,club.id,2);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM watch_club_votes').get().n,1);await service.vote(bob,club.id,1);await service.leave(bob,club.id);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM watch_club_votes').get().n,1);await service.vote(alice,club.id,null);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM watch_club_votes').get().n,0);
});
test('only owners can delete; deletion cascades members, anime, invites and votes',async t=>{
 const {service,db}=await fixture(t),{club}=await service.create(alice,{title:'Delete'});const invite=await service.invite(alice,club.id);await service.join(bob,{token:invite.token});await service.add(alice,club.id,item(1));await service.vote(bob,club.id,1);await rejects(()=>service.delete(bob,club.id),403);await rejects(()=>service.leave(alice,club.id),409);await service.delete(alice,club.id);
 for(const table of ['watch_clubs','watch_club_members','watch_club_entries','watch_club_votes','watch_club_invites'])assert.equal(db.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);await rejects(()=>service.join(eve,{token:invite.token}),404);
});
test('collection, entry and membership limits are enforced in SQL at write time',async t=>{
 const {service,db}=await fixture(t);const {club}=await service.create(alice,{title:'Limits'});for(let i=1;i<=50;i++)await service.add(alice,club.id,item(i));await rejects(()=>service.add(alice,club.id,item(51)),409);
 for(let i=1;i<20;i++)await service.create(alice,{title:'Group '+i});await rejects(()=>service.create(alice,{title:'Too many'}),409);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM watch_clubs').get().n,20);
});
test('suspension excludes votes and blocks owner clubs and invite joins immediately',async t=>{
 const {service,db}=await fixture(t),{club}=await service.create(alice,{title:'Status'}),invite=await service.invite(alice,club.id);await service.join(bob,{token:invite.token});await service.add(alice,club.id,item(1));await service.vote(bob,club.id,1);db.sqlite.prepare("UPDATE members SET status='suspended' WHERE id='bob'").run();assert.equal((await service.get(alice,club.id)).club.entries[0].votes,0);await rejects(()=>service.vote(bob,club.id,1),403);
 db.sqlite.prepare("UPDATE members SET status='suspended' WHERE id='alice'").run();await rejects(()=>service.join(eve,{token:invite.token}),404);await rejects(()=>service.get(alice,club.id),403);
});
test('authorization is rechecked in a mutation after the initial account lookup',async t=>{
 const {service,db}=await fixture(t),{club}=await service.create(alice,{title:'Race'});db.beforeRun=sql=>{if(sql.startsWith('INSERT INTO watch_club_entries')){db.beforeRun=null;db.sqlite.prepare("UPDATE members SET status='suspended' WHERE id='alice'").run();}};await rejects(()=>service.add(alice,club.id,item(1)),409);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM watch_club_entries').get().n,0);
});
test('the twentieth member is accepted and a full club rejects another invite join',async t=>{
 const {service,db}=await fixture(t),{club}=await service.create(alice,{title:'Twenty'}),invite=await service.invite(alice,club.id),membership=createMembershipService(db);
 for(let i=1;i<=20;i++){const who=identity('friend-'+i);await membership.register(who,{displayName:'Friend '+i});if(i<20)await service.join(who,{token:invite.token});else await rejects(()=>service.join(who,{token:invite.token}),409);}
 assert.equal((await service.get(alice,club.id)).club.members.length,20);
});
test('a revoked invitation is rechecked at the actual membership insertion',async t=>{
 const {service,db}=await fixture(t),{club}=await service.create(alice,{title:'Join race'}),invite=await service.invite(alice,club.id);
 db.beforeRun=sql=>{if(sql.startsWith('INSERT OR IGNORE INTO watch_club_members')){db.beforeRun=null;db.sqlite.prepare('DELETE FROM watch_club_invites WHERE club_id=?').run(club.id);}};
 await rejects(()=>service.join(bob,{token:invite.token}),409);assert.equal((await service.get(alice,club.id)).club.members.length,1);
});
