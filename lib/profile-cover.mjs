import { MembershipError, createMembershipService } from './membership.mjs';
import { readAvatarUpload } from './avatar.mjs';

const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const fail = (status, code, message) => { throw new MembershipError(status, code, message); };
const notFound = () => fail(404, 'cover_not_found', 'Profil arka planı bulunamadı.');
const versionValid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const userIdValid = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f]/.test(value);
const activePredicate = "EXISTS(SELECT 1 FROM members WHERE id=? AND status='active')";
const ownUrl = key => `/api/profile/cover?v=${key.split('/').at(-1)}`;
const publicUrl = (userId, key) => `/api/profiles/${encodeURIComponent(userId)}/cover?v=${key.split('/').at(-1)}`;

export async function profileCoverObjectPrefix(userId) {
  if (!userIdValid(userId)) fail(401, 'sign_in_required', 'Önce giriş yapın.');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId));
  return 'cover/' + [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
}
function ownedKey(key, prefix) { return typeof key === 'string' && key.startsWith(prefix + '/') && versionValid(key.slice(prefix.length + 1)); }
function cancelBody(body) { try { const result = body?.cancel?.(); result?.catch?.(() => {}); } catch { /* Invalidated streams are never returned. */ } }

export function profileCoverImageResponse(image) {
  return new Response(image.body, {headers: {
    'Content-Type': image.contentType, 'Cache-Control': 'private, no-store', 'Vary': 'Cookie',
    'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Disposition': 'inline; filename="profile-cover"',
  }});
}

// Object names and account IDs are derived exclusively from verified sessions.
// Public access additionally depends on the owner's current profile visibility.
export function createProfileCoverService(db, bucket, options = {}) {
  if (!db) fail(503, 'cover_unavailable', 'Arka plan hizmeti şu anda kullanılamıyor.');
  const membership = createMembershipService(db);
  const now = options.now || (() => new Date().toISOString());
  const makeId = options.makeId || (() => crypto.randomUUID());
  const statement = (sql, ...values) => db.prepare(sql).bind(...values);
  function storageRequired() { if (!bucket) fail(503, 'cover_unavailable', 'Arka plan hizmeti şu anda kullanılamıyor.'); }
  async function activeMember(identity) {
    const account = await membership.account(identity);
    if (!account.authenticated) fail(401, 'sign_in_required', 'Önce giriş yapın.');
    if (!account.registered) fail(403, 'registration_required', 'Önce üyeliğinizi tamamlayın.');
    if (account.user.status !== 'active') fail(403, 'account_suspended', 'Hesabınız askıya alınmış.');
    return account.user;
  }
  const metadata = (userId, isPublic = false) => statement(`SELECT c.object_key,c.content_type,c.updated_at FROM member_covers c
    JOIN members m ON m.id=c.user_id AND m.status='active'
    ${isPublic ? 'JOIN member_profiles p ON p.user_id=m.id AND p.is_public=1' : ''} WHERE c.user_id=?`, userId).first();
  async function validMetadata(userId, isPublic = false) {
    if (!userIdValid(userId)) return null;
    const row = await metadata(userId, isPublic);
    if (!row || !TYPES.includes(row.content_type) || !ownedKey(row.object_key, await profileCoverObjectPrefix(userId))) return null;
    return row;
  }
  async function clean(key) { try { await bucket.delete(key); } catch { /* Old objects remain unreachable even when best-effort cleanup fails. */ } }
  async function read(userId, version, isPublic = false) {
    storageRequired();
    if (!userIdValid(userId) || !versionValid(version)) notFound();
    const row = await validMetadata(userId, isPublic);
    if (!row || row.object_key.split('/').at(-1) !== version.toLowerCase()) notFound();
    const object = await bucket.get(row.object_key);
    if (!object?.body || (object.httpMetadata?.contentType && object.httpMetadata.contentType !== row.content_type)) { cancelBody(object?.body); notFound(); }
    // The profile may have become private, been suspended, or changed its cover
    // while R2 was reading. Revoke the in-flight old version before returning it.
    const current = await validMetadata(userId, isPublic);
    if (!current || current.object_key !== row.object_key || current.content_type !== row.content_type) { cancelBody(object.body); notFound(); }
    return {body: object.body, contentType: row.content_type, updatedAt: row.updated_at};
  }
  return {
    async ownUrl(identity) {
      const member = await activeMember(identity); const row = await validMetadata(member.id);
      return row ? ownUrl(row.object_key) : null;
    },
    async publicUrl(userId) {
      const row = await validMetadata(userId, true);
      return row ? publicUrl(userId, row.object_key) : null;
    },
    async getOwn(identity, version) { const member = await activeMember(identity); return read(member.id, version); },
    async getPublic(userId, version) { return read(userId, version, true); },
    async upload(identity, request) {
      const member = await activeMember(identity); storageRequired();
      const {bytes, contentType} = await readAvatarUpload(request);
      const prefix = await profileCoverObjectPrefix(member.id); const version = makeId();
      if (!versionValid(version)) fail(503, 'cover_unavailable', 'Arka plan hizmeti şu anda kullanılamıyor.');
      const key = prefix + '/' + version.toLowerCase(); const previous = await metadata(member.id); const updatedAt = now();
      if (previous?.object_key === key) fail(409, 'cover_conflict', 'Arka plan değişti. Tekrar deneyin.');
      try { await bucket.put(key, bytes, {httpMetadata: {contentType, cacheControl: 'private, no-store'}}); }
      catch (error) { await clean(key); throw error; }
      try {
        const result = previous
          ? await statement(`UPDATE member_covers SET object_key=?,content_type=?,updated_at=? WHERE user_id=? AND object_key=? AND ${activePredicate}`, key, contentType, updatedAt, member.id, previous.object_key, member.id).run()
          : await statement(`INSERT INTO member_covers(user_id,object_key,content_type,updated_at) SELECT ?,?,?,? WHERE ${activePredicate} ON CONFLICT(user_id) DO NOTHING`, member.id, key, contentType, updatedAt, member.id).run();
        if (result.meta?.changes === 0) {
          await activeMember(identity);
          fail(409, 'cover_conflict', 'Arka plan değişti. Sayfayı yenileyip tekrar deneyin.');
        }
      } catch (error) { await clean(key); throw error; }
      if (previous && previous.object_key !== key && ownedKey(previous.object_key, prefix)) await clean(previous.object_key);
      return {coverUrl: ownUrl(key), updatedAt};
    },
    async remove(identity, request) {
      const member = await activeMember(identity); storageRequired();
      if (request.method !== 'DELETE') fail(405, 'method_not_allowed', 'Bu işlem desteklenmiyor.');
      if (request.headers.get('origin') !== new URL(request.url).origin) fail(403, 'invalid_origin', 'Bu istek kaynağına izin verilmiyor.');
      const previous = await metadata(member.id);
      if (!previous) { await activeMember(identity); return {coverUrl: null}; }
      const result = await statement(`DELETE FROM member_covers WHERE user_id=? AND object_key=? AND ${activePredicate}`, member.id, previous.object_key, member.id).run();
      if (result.meta?.changes === 0) {
        await activeMember(identity);
        fail(409, 'cover_conflict', 'Arka plan değişti. Sayfayı yenileyip tekrar deneyin.');
      }
      if (ownedKey(previous.object_key, await profileCoverObjectPrefix(member.id))) await clean(previous.object_key);
      return {coverUrl: null};
    },
  };
}
