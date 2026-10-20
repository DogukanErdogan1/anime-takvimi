import { MembershipError, createMembershipService } from './membership.mjs';
import { readAvatarUpload } from './avatar.mjs';
import { isSameOriginRequest } from './origin.mjs';

const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const fail = (status, code, message) => { throw new MembershipError(status, code, message); };
const versionValid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export function bannerId(value) {
  if (!/^[1-9]\d{0,9}$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) fail(400, 'invalid_anime_id', 'Geçerli bir MyAnimeList anime numarası girin.');
  return Number(value);
}
const imageUrl = (id, key) => `/api/banners/${id}?image=${encodeURIComponent(key.split('/').at(-1))}`;
const ownedKey = (id, key) => typeof key === 'string' && key.startsWith(`banner/${id}/`) && versionValid(key.slice(`banner/${id}/`.length));

export function createBannerService(db, bucket, options = {}) {
  if (!db) fail(503, 'banner_unavailable', 'Banner hizmeti şu anda kullanılamıyor.');
  const membership = createMembershipService(db);
  const statement = (sql, ...values) => db.prepare(sql).bind(...values);
  const now = options.now || (() => new Date().toISOString());
  const makeId = options.makeId || (() => crypto.randomUUID());
  const adminPredicate = "EXISTS(SELECT 1 FROM members AS actor JOIN app_settings AS owner ON owner.key='admin_owner' AND owner.value=actor.id WHERE actor.id=? AND actor.role='admin' AND actor.status='active')";
  async function adminRequired(identity) {
    const account = await membership.account(identity);
    if (!account.authenticated) fail(401, 'sign_in_required', 'Önce giriş yapın.');
    const owner = await statement("SELECT value FROM app_settings WHERE key='admin_owner'").first();
    if (!account.registered || account.user.status !== 'active' || account.user.role !== 'admin' || owner?.value !== account.user.id) fail(403, 'admin_required', 'Bu işlem için yönetici yetkisi gerekiyor.');
    return account.user;
  }
  const metadata = id => statement('SELECT object_key,content_type,updated_at FROM anime_banners WHERE mal_id=?', id).first();
  function storageRequired() { if (!bucket) fail(503, 'banner_unavailable', 'Banner hizmeti şu anda kullanılamıyor.'); }
  async function clean(key) { try { await bucket.delete(key); } catch { /* An obsolete image can be cleaned later. */ } }
  return {
    async info(value) {
      const id = bannerId(value); const row = await metadata(id);
      if (!row || !ownedKey(id,row.object_key) || !TYPES.includes(row.content_type)) return {bannerUrl:null};
      return {bannerUrl:imageUrl(id,row.object_key), updatedAt:row.updated_at};
    },
    async get(value, version) {
      const id = bannerId(value); storageRequired();
      if (!versionValid(version)) fail(404, 'banner_not_found', 'Banner bulunamadı.');
      const row = await metadata(id);
      if (!row || !ownedKey(id,row.object_key) || row.object_key !== `banner/${id}/${version}` || !TYPES.includes(row.content_type)) fail(404, 'banner_not_found', 'Banner bulunamadı.');
      const object = await bucket.get(row.object_key);
      if (!object?.body || (object.httpMetadata?.contentType && object.httpMetadata.contentType !== row.content_type)) fail(404, 'banner_not_found', 'Banner bulunamadı.');
      return {body:object.body, contentType:row.content_type};
    },
    async upload(identity, value, request) {
      const id = bannerId(value); const admin = await adminRequired(identity); storageRequired();
      const {bytes,contentType} = await readAvatarUpload(request); const version = makeId();
      if (!versionValid(version)) fail(503, 'banner_unavailable', 'Banner hizmeti şu anda kullanılamıyor.');
      const key = `banner/${id}/${version}`; const previous = await metadata(id); const updatedAt = now();
      try { await bucket.put(key,bytes,{httpMetadata:{contentType,cacheControl:'public, max-age=31536000, immutable'}}); }
      catch (error) { await clean(key); throw error; }
      try {
        const result = await statement(`INSERT INTO anime_banners(mal_id,object_key,content_type,updated_at,updated_by) SELECT ?,?,?,?,? WHERE ${adminPredicate} ON CONFLICT(mal_id) DO UPDATE SET object_key=excluded.object_key,content_type=excluded.content_type,updated_at=excluded.updated_at,updated_by=excluded.updated_by`,id,key,contentType,updatedAt,admin.id,admin.id).run();
        if (result.meta?.changes === 0) fail(403, 'admin_required', 'Bu işlem için yönetici yetkisi gerekiyor.');
      } catch (error) { await clean(key); throw error; }
      if (previous && previous.object_key !== key && ownedKey(id,previous.object_key)) await clean(previous.object_key);
      return {bannerUrl:imageUrl(id,key), updatedAt};
    },
    async remove(identity, value, request) {
      const id = bannerId(value); const admin = await adminRequired(identity); storageRequired();
      if (request.method !== 'DELETE') fail(405, 'method_not_allowed', 'Bu işlem desteklenmiyor.');
      if (!isSameOriginRequest(request)) fail(403, 'invalid_origin', 'Bu istek kaynağına izin verilmiyor.');
      const previous = await metadata(id);
      if (!previous) return {bannerUrl:null};
      const result = await statement(`DELETE FROM anime_banners WHERE mal_id=? AND object_key=? AND ${adminPredicate}`,id,previous.object_key,admin.id).run();
      if (result.meta?.changes === 0) fail(409, 'banner_conflict', 'Banner değişti. Sayfayı yenileyip tekrar deneyin.');
      if (ownedKey(id,previous.object_key)) await clean(previous.object_key);
      return {bannerUrl:null};
    },
  };
}

