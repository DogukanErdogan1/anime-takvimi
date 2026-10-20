import { MembershipError, createMembershipService } from './membership.mjs';
import { isSameOriginRequest } from './origin.mjs';
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const TYPES = ['image/png','image/jpeg','image/webp'];
const fail = (status, code, message) => { throw new MembershipError(status, code, message); };
const imageError = () => fail(415, 'invalid_image', 'Geçerli bir PNG, JPEG veya WebP fotoğraf seçin.');
const ascii = (data, start, value) => [...value].every((char, index) => data[start + index] === char.charCodeAt(0));
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const revisionUrl = row => `/api/account/avatar?v=${encodeURIComponent(row.object_key.split('/').at(-1))}`;
export function validateAvatarBytes(bytes, contentType) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) fail(400, 'empty_image', 'Fotoğraf dosyası boş olamaz.');
  if (bytes.byteLength > MAX_AVATAR_BYTES) fail(413, 'avatar_too_large', 'Fotoğraf en fazla 2 MB olabilir.');
  if (!TYPES.includes(contentType)) imageError();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let valid = false;
  if (contentType === 'image/png') {
    valid = bytes.length >= 45 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v) && view.getUint32(8) === 13 && ascii(bytes,12,'IHDR') && view.getUint32(16) > 0 && view.getUint32(20) > 0 && ascii(bytes,bytes.length - 8,'IEND');
  } else if (contentType === 'image/jpeg') {
    valid = bytes.length >= 12 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
  } else {
    valid = bytes.length >= 26 && ascii(bytes,0,'RIFF') && ascii(bytes,8,'WEBP') && ['VP8 ','VP8L','VP8X'].some(chunk => ascii(bytes,12,chunk)) && view.getUint32(4,true) === bytes.length - 8 && view.getUint32(16,true) > 0 && view.getUint32(16,true) <= bytes.length - 20;
  }
  if (!valid) imageError();
  return {bytes, contentType};
}
export async function readAvatarUpload(request) {
  if (request.method !== 'POST') fail(405, 'method_not_allowed', 'Bu işlem desteklenmiyor.');
  if (!isSameOriginRequest(request)) fail(403, 'invalid_origin', 'Bu istek kaynağına izin verilmiyor.');
  const contentType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!TYPES.includes(contentType)) imageError();
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_AVATAR_BYTES)) fail(413, 'avatar_too_large', 'Fotoğraf en fazla 2 MB olabilir.');
  if ((length !== null && Number(length) === 0) || !request.body) fail(400, 'empty_image', 'Fotoğraf dosyası boş olamaz.');
  const reader = request.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
      if (size > MAX_AVATAR_BYTES) { await reader.cancel(); fail(413, 'avatar_too_large', 'Fotoğraf en fazla 2 MB olabilir.'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return validateAvatarBytes(bytes, contentType);
}
export async function avatarObjectKey(platformUserId) {
  if (typeof platformUserId !== 'string' || !platformUserId || platformUserId.length > 256) fail(401, 'sign_in_required', 'Önce giriş yapın.');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(platformUserId));
  return 'avatar/' + [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2,'0')).join('');
}
export function createAvatarService(db, bucket, options = {}) {
  const membership = createMembershipService(db); const now = options.now || (() => new Date().toISOString());
  const makeId = options.makeId || (() => crypto.randomUUID());
  const statement = (sql, ...args) => db.prepare(sql).bind(...args);
  async function activeMember(identity) {
    const account = await membership.account(identity);
    if (!account.authenticated) fail(401, 'sign_in_required', 'Önce giriş yapın.');
    if (!account.registered) fail(403, 'registration_required', 'Önce üyeliğinizi tamamlayın.');
    if (account.user.status !== 'active') fail(403, 'account_suspended', 'Hesabınız askıya alınmış.');
    return account.user;
  }
  function storageRequired() { if (!bucket) fail(503, 'avatar_unavailable', 'Fotoğraf hizmeti şu anda kullanılamıyor.'); }
  async function metadata(userId) { return statement('SELECT object_key,content_type,updated_at FROM member_avatars WHERE user_id = ?', userId).first(); }
  function ownedKey(key, prefix) { return typeof key === 'string' && key.startsWith(prefix + '/') && uuid(key.slice(prefix.length + 1)); }
  async function clean(key) { try { await bucket.delete(key); } catch { /* Best-effort cleanup never changes a completed upload result. */ } }
  return {
    async url(identity) {
      const member = await activeMember(identity); const row = await metadata(member.id); if (!row) return null;
      const prefix = await avatarObjectKey(member.id);
      return ownedKey(row.object_key,prefix) && TYPES.includes(row.content_type) ? revisionUrl(row) : null;
    },
    async upload(identity, request) {
      const member = await activeMember(identity); storageRequired(); const {bytes,contentType} = await readAvatarUpload(request);
      const prefix = await avatarObjectKey(member.id); const version = makeId();
      if (!uuid(version)) fail(503, 'avatar_unavailable', 'Fotoğraf hizmeti şu anda kullanılamıyor.');
      const key = prefix + '/' + version.toLowerCase(); const previous = await metadata(member.id); const updatedAt = now();
      try { await bucket.put(key,bytes,{httpMetadata:{contentType,cacheControl:'private, no-store'}}); }
      catch (error) { await clean(key); throw error; }
      try {
        const result = await statement("INSERT INTO member_avatars(user_id,object_key,content_type,updated_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM members WHERE id=? AND status='active') ON CONFLICT(user_id) DO UPDATE SET object_key=excluded.object_key,content_type=excluded.content_type,updated_at=excluded.updated_at",member.id,key,contentType,updatedAt,member.id).run();
        if (result.meta?.changes === 0) fail(403, 'account_suspended', 'Hesabınız askıya alınmış.');
      } catch (error) { await clean(key); throw error; }
      if (previous && previous.object_key !== key && ownedKey(previous.object_key,prefix)) await clean(previous.object_key);
      return {avatarUrl: revisionUrl({object_key:key}), updatedAt};
    },
    async get(identity) {
      const member = await activeMember(identity); storageRequired(); const row = await metadata(member.id);
      const prefix = await avatarObjectKey(member.id);
      if (!row || !ownedKey(row.object_key,prefix) || !TYPES.includes(row.content_type)) fail(404, 'avatar_not_found', 'Profil fotoğrafı bulunamadı.');
      const object = await bucket.get(row.object_key);
      if (!object?.body) fail(404, 'avatar_not_found', 'Profil fotoğrafı bulunamadı.');
      const contentType = object.httpMetadata?.contentType || row.content_type;
      if (!TYPES.includes(contentType)) fail(404, 'avatar_not_found', 'Profil fotoğrafı bulunamadı.');
      return {body:object.body,contentType,updatedAt:row.updated_at};
    },
  };
}

