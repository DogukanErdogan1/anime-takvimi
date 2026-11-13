import {MembershipError,createMembershipService} from './membership.mjs';
const fail=(status,message)=>{throw new MembershipError(status,'moderation_error',message);};
export function createModerationService(db,{now=()=>new Date().toISOString()}={}){
 const q=(sql,...args)=>db.prepare(sql).bind(...args),members=createMembershipService(db);
 async function member(identity,admin=false){const account=await members.account(identity);if(!account.registered||account.user.status!=='active')fail(403,'Bu işlem için aktif hesabınla giriş yap.');if(admin){const owner=await q("SELECT value FROM app_settings WHERE key='admin_owner'").first();if(account.user.role!=='admin'||owner?.value!==account.user.id)fail(403,'Bu alan yalnız yöneticiye açık.');}return account.user;}
 return {
  async report(identity,animeId,reviewId,payload){const user=await member(identity);
   if(!payload||Object.keys(payload).some(k=>!['reason','detail'].includes(k))||!['spoiler','abuse','spam','other'].includes(payload.reason)||typeof payload.detail!=='string'||payload.detail.length>500)fail(400,'Şikâyet bilgisi geçersiz.');
   const review=await q('SELECT id,user_id FROM anime_reviews WHERE id=? AND anime_id=? AND hidden=0',reviewId,animeId).first();if(!review||review.user_id===user.id)fail(404,'Şikâyet edilebilir yorum bulunamadı.');
   const stamp=Date.parse(now()),rate=await q('INSERT INTO community_rate_limits(bucket_key,reset_at,attempts) VALUES(?,?,1) ON CONFLICT(bucket_key) DO UPDATE SET attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END,reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END WHERE reset_at<=? OR attempts<10','report:'+user.id,stamp+3600000,stamp,stamp,stamp).run();if(rate.meta?.changes===0)fail(429,'Bir saatte en fazla 10 yorum bildirebilirsin.');
   await q("INSERT INTO review_reports(id,review_id,reporter_id,reason,detail,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM members WHERE id=? AND status='active') ON CONFLICT(review_id,reporter_id) DO NOTHING",crypto.randomUUID(),review.id,user.id,payload.reason,payload.detail.trim(),now(),user.id).run();return {reported:true};
  },
  async list(identity){await member(identity,true);const rows=await q("SELECT p.id,p.reason,p.detail,p.created_at,r.id AS review_id,r.anime_id,r.body,r.spoiler,m.display_name FROM review_reports p JOIN anime_reviews r ON r.id=p.review_id JOIN members m ON m.id=r.user_id WHERE p.status='open' ORDER BY p.created_at ASC LIMIT 50").all();return {reports:rows.results};},
  async resolve(identity,reportId,payload){const user=await member(identity,true);if(!payload||Object.keys(payload).length!==1||!['dismiss','remove'].includes(payload.action))fail(400,'Geçersiz işlem.');const row=await q("SELECT review_id FROM review_reports WHERE id=? AND status='open'",reportId).first();if(!row)fail(404,'Açık şikâyet bulunamadı.');
   const guard="EXISTS(SELECT 1 FROM members m JOIN app_settings a ON a.key='admin_owner' AND a.value=m.id WHERE m.id=? AND m.role='admin' AND m.status='active')";
   const updates=[];if(payload.action==='remove')updates.push(q('UPDATE anime_reviews SET hidden=1,hidden_by=?,hidden_at=?,updated_at=? WHERE id=? AND '+guard,user.id,now(),now(),row.review_id,user.id));
   updates.push(q("UPDATE review_reports SET status=?,resolved_by=?,resolved_at=? WHERE "+(payload.action==='remove'?"review_id=?":"id=?")+" AND status='open' AND "+guard,payload.action==='remove'?'removed':'dismissed',user.id,now(),payload.action==='remove'?row.review_id:reportId,user.id));const results=await db.batch(updates);if(results.at(-1)?.meta?.changes===0)fail(403,'Yetkin değişti veya şikâyet zaten işlendi.');return {resolved:true};
  }
 };
}
