import {MembershipError,createMembershipService} from './membership.mjs';
const fail=(status,code,message)=>{throw new MembershipError(status,code,message);};
const bad=()=>fail(400,'invalid_payload','Gönderilen bilgiler geçerli değil.');
const object=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const keys=(v,list)=>object(v)&&Object.keys(v).every(k=>list.includes(k));
const validId=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(v);
const title=v=>typeof v==='string'&&v.trim().length>0&&v.length<=80&&!/[\x00-\x1f]/.test(v);
export function sharedAnime(value){
 if(!keys(value,['malId','title'])||!Number.isInteger(value.malId)||value.malId<1||value.malId>2147483647||typeof value.title!=='string'||!value.title.trim()||value.title.length>500||/[\x00-\x1f]/.test(value.title))bad();
 return {id:`mal-${value.malId}`,malId:value.malId,title:value.title.trim(),image:null};
}
const hash=async token=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
export function createWatchClubService(db,options={}){
 if(!db)fail(503,'clubs_unavailable','Ortak koleksiyonlar şu anda kullanılamıyor.');
 const s=(sql,...args)=>db.prepare(sql).bind(...args),membership=createMembershipService(db),now=options.now||Date.now,makeId=options.makeId||(()=>crypto.randomUUID());
 const active="EXISTS(SELECT 1 FROM members WHERE id=? AND status='active')";
 const allowed=`EXISTS(SELECT 1 FROM watch_club_members cm JOIN members m ON m.id=cm.user_id AND m.status='active' JOIN watch_clubs c ON c.id=cm.club_id JOIN members owner ON owner.id=c.owner_id AND owner.status='active' WHERE cm.club_id=? AND cm.user_id=?)`;
 async function member(identity){const account=await membership.account(identity);if(!account.authenticated)fail(401,'sign_in_required','Ortak koleksiyonlar için giriş yap.');if(!account.registered||account.user.status!=='active')fail(403,'account_unavailable','Etkin bir üyelik gerekiyor.');return account.user;}
 async function access(identity,id){if(!validId(id))bad();const user=await member(identity);const club=await s(`SELECT c.* FROM watch_clubs c WHERE c.id=? AND ${allowed}`,id,id,user.id).first();if(!club)fail(404,'club_not_found','Bu koleksiyon bulunamadı veya erişimin yok.');return {user,club};}
 const unchanged=result=>{if(result.meta?.changes===0)fail(409,'club_changed','Koleksiyon değişmiş veya sınırına ulaşmış olabilir. Yenile ve tekrar dene.');};
 return {
  async list(identity){const user=await member(identity);const rows=await s(`SELECT c.id,c.title,c.owner_id AS ownerId,c.created_at AS createdAt,(SELECT COUNT(*) FROM watch_club_entries e WHERE e.club_id=c.id) AS animeCount,(SELECT COUNT(*) FROM watch_club_members cm JOIN members m ON m.id=cm.user_id AND m.status='active' WHERE cm.club_id=c.id) AS memberCount FROM watch_clubs c JOIN watch_club_members cm ON cm.club_id=c.id JOIN members owner ON owner.id=c.owner_id AND owner.status='active' WHERE cm.user_id=? ORDER BY c.created_at DESC,c.id`,user.id).all();return {clubs:rows.results};},
  async create(identity,payload){if(!keys(payload,['title'])||!title(payload.title))bad();const user=await member(identity),id=makeId(),date=new Date(now()).toISOString();const results=await db.batch([
   s(`INSERT INTO watch_clubs(id,owner_id,title,created_at) SELECT ?,?,?,? WHERE ${active} AND (SELECT COUNT(*) FROM watch_club_members WHERE user_id=?)<20`,id,user.id,payload.title.trim(),date,user.id,user.id),
   s(`INSERT INTO watch_club_members(club_id,user_id,joined_at) SELECT id,owner_id,created_at FROM watch_clubs WHERE id=? AND owner_id=? AND ${active}`,id,user.id,user.id)
  ]);unchanged(results[0]);return this.get(identity,id);},
  async get(identity,id){const {user,club}=await access(identity,id);const [people,entries]=await Promise.all([
   s("SELECT m.id,m.display_name AS displayName FROM watch_club_members cm JOIN members m ON m.id=cm.user_id AND m.status='active' WHERE cm.club_id=? ORDER BY cm.joined_at,m.id",id).all(),
   s("SELECT e.anime_id,e.anime_json,e.added_by,(SELECT COUNT(*) FROM watch_club_votes v JOIN members m ON m.id=v.user_id AND m.status='active' WHERE v.club_id=e.club_id AND v.anime_id=e.anime_id) AS votes,EXISTS(SELECT 1 FROM watch_club_votes v WHERE v.club_id=e.club_id AND v.anime_id=e.anime_id AND v.user_id=?) AS voted FROM watch_club_entries e WHERE e.club_id=? ORDER BY votes DESC,e.created_at,e.anime_id",user.id,id).all()
  ]);return {club:{id:club.id,title:club.title,ownerId:club.owner_id,members:people.results,entries:entries.results.map(r=>({item:JSON.parse(r.anime_json),addedBy:r.added_by,votes:r.votes,voted:!!r.voted}))}};},
  async invite(identity,id){const {user,club}=await access(identity,id);if(club.owner_id!==user.id)fail(403,'owner_required','Davet bağlantısını koleksiyon sahibi oluşturabilir.');const token=randomToken(),expiresAt=now()+7*86400000;const result=await s(`INSERT INTO watch_club_invites(club_id,token_hash,expires_at) SELECT id,?,? FROM watch_clubs WHERE id=? AND owner_id=? AND ${allowed} ON CONFLICT(club_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at`,await hash(token),expiresAt,id,user.id,id,user.id).run();unchanged(result);return {token,expiresAt};},
  async join(identity,payload){if(!keys(payload,['token'])||typeof payload.token!=='string'||!/^[a-f0-9]{64}$/.test(payload.token))bad();const user=await member(identity),tokenHash=await hash(payload.token),time=now();
   const invite=await s("SELECT i.club_id FROM watch_club_invites i JOIN watch_clubs c ON c.id=i.club_id JOIN members owner ON owner.id=c.owner_id AND owner.status='active' WHERE i.token_hash=? AND i.expires_at>?",tokenHash,time).first();if(!invite)fail(404,'invite_expired','Davet bağlantısı geçersiz veya süresi dolmuş.');
   const existing=await s('SELECT 1 AS found FROM watch_club_members WHERE club_id=? AND user_id=?',invite.club_id,user.id).first();if(existing)return this.get(identity,invite.club_id);
   const result=await s(`INSERT OR IGNORE INTO watch_club_members(club_id,user_id,joined_at) SELECT i.club_id,?,? FROM watch_club_invites i JOIN watch_clubs c ON c.id=i.club_id JOIN members owner ON owner.id=c.owner_id AND owner.status='active' WHERE i.token_hash=? AND i.expires_at>? AND ${active} AND (SELECT COUNT(*) FROM watch_club_members WHERE user_id=?)<20 AND (SELECT COUNT(*) FROM watch_club_members WHERE club_id=i.club_id)<20`,user.id,new Date(time).toISOString(),tokenHash,time,user.id,user.id).run();unchanged(result);return this.get(identity,invite.club_id);},
  async add(identity,id,payload){const item=sharedAnime(payload);const {user}=await access(identity,id);const result=await s(`INSERT INTO watch_club_entries(club_id,anime_id,anime_json,added_by,created_at) SELECT ?,?,?,?,? WHERE ${allowed} AND (SELECT COUNT(*) FROM watch_club_entries WHERE club_id=?)<50 ON CONFLICT(club_id,anime_id) DO NOTHING`,id,item.malId,JSON.stringify(item),user.id,new Date(now()).toISOString(),id,user.id,id).run();unchanged(result);return this.get(identity,id);},
  async vote(identity,id,animeId){if(animeId!==null&&(!Number.isInteger(animeId)||animeId<1||animeId>2147483647))bad();const {user}=await access(identity,id);
   if(animeId===null)await s(`DELETE FROM watch_club_votes WHERE club_id=? AND user_id=? AND ${allowed}`,id,user.id,id,user.id).run();
   else {const result=await s(`INSERT INTO watch_club_votes(club_id,user_id,anime_id) SELECT ?,?,? WHERE ${allowed} AND EXISTS(SELECT 1 FROM watch_club_entries WHERE club_id=? AND anime_id=?) ON CONFLICT(club_id,user_id) DO UPDATE SET anime_id=excluded.anime_id`,id,user.id,animeId,id,user.id,id,animeId).run();unchanged(result);}return this.get(identity,id);},
  async remove(identity,id,animeId){if(!Number.isInteger(animeId))bad();const {user}=await access(identity,id);const result=await s(`DELETE FROM watch_club_entries WHERE club_id=? AND anime_id=? AND (added_by=? OR EXISTS(SELECT 1 FROM watch_clubs WHERE id=? AND owner_id=?)) AND ${allowed}`,id,animeId,user.id,id,user.id,id,user.id).run();unchanged(result);return this.get(identity,id);},
  async leave(identity,id){const {user,club}=await access(identity,id);if(club.owner_id===user.id)fail(409,'owner_required','Koleksiyon sahibi ayrılmak yerine koleksiyonu silebilir.');await s(`DELETE FROM watch_club_members WHERE club_id=? AND user_id=? AND ${allowed}`,id,user.id,id,user.id).run();return {ok:true};},
  async delete(identity,id){const {user,club}=await access(identity,id);if(club.owner_id!==user.id)fail(403,'owner_required','Bu işlem koleksiyon sahibine ait.');const result=await s(`DELETE FROM watch_clubs WHERE id=? AND owner_id=? AND ${allowed}`,id,user.id,id,user.id).run();unchanged(result);return {ok:true};}
 };
}
