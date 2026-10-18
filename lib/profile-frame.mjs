import { MembershipError, createMembershipService, readJsonMutation } from './membership.mjs';
import { isAvatarFrame, normalizeAvatarFrame } from './avatar-frames.mjs';

const fail = (status, code, message) => { throw new MembershipError(status, code, message); };
const unavailable = () => fail(503, 'frame_unavailable', 'Profil çerçeveleri şu anda kaydedilemiyor. Daha sonra tekrar deneyin.');
const missingTable = error => /no such table:\s*(?:main\.)?member_profile_frames\b/i.test(error instanceof Error ? error.message : '');
const userIdValid = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f]/.test(value);
const activePredicate = "EXISTS(SELECT 1 FROM members WHERE id=? AND status='active')";

export function validateProfileFrame(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload) || Object.getPrototypeOf(payload) !== Object.prototype ||
      Object.keys(payload).length !== 1 || !Object.hasOwn(payload, 'frameId') || !isAvatarFrame(payload.frameId)) {
    fail(400, 'invalid_frame', 'Geçerli bir profil çerçevesi seçin.');
  }
  return {frameId: payload.frameId};
}

// Only a verified session may select a frame. The owner is never read from JSON.
export function createProfileFrameService(db, options = {}) {
  if (!db) unavailable();
  const membership = createMembershipService(db);
  const now = options.now || (() => new Date().toISOString());
  const statement = (sql, ...values) => db.prepare(sql).bind(...values);
  async function activeMember(identity) {
    const account = await membership.account(identity);
    if (!account.authenticated) fail(401, 'sign_in_required', 'Önce giriş yapın.');
    if (!account.registered) fail(403, 'registration_required', 'Önce üyeliğinizi tamamlayın.');
    if (account.user.status !== 'active') fail(403, 'account_suspended', 'Hesabınız askıya alınmış.');
    return account.user;
  }
  async function metadata(userId, isPublic = false) {
    try {
      return await statement(`SELECT f.frame_id,f.updated_at FROM member_profile_frames f
        JOIN members m ON m.id=f.user_id AND m.status='active'
        ${isPublic ? 'JOIN member_profiles p ON p.user_id=m.id AND p.is_public=1' : ''} WHERE f.user_id=?`, userId).first();
    } catch (error) {
      // Account/profile pages remain readable while deployment awaits migration.
      if (missingTable(error)) return null;
      throw error;
    }
  }
  async function getOwn(identity) {
    const member = await activeMember(identity);
    const row = await metadata(member.id);
    // An account can be suspended while the initial authorization is in flight.
    if (!row) await activeMember(identity);
    return {avatarFrame: normalizeAvatarFrame(row?.frame_id), updatedAt: row?.updated_at ?? null};
  }
  return {
    getOwn,
    async ownFrame(identity) { return (await getOwn(identity)).avatarFrame; },
    async publicFrame(userId) {
      if (!userIdValid(userId)) return 'none';
      return normalizeAvatarFrame((await metadata(userId, true))?.frame_id);
    },
    async put(identity, request) {
      const member = await activeMember(identity);
      if (request.method !== 'PUT') fail(405, 'method_not_allowed', 'Bu işlem desteklenmiyor.');
      const {frameId} = validateProfileFrame(await readJsonMutation(request, 1024));
      try {
        const result = await statement(`INSERT INTO member_profile_frames(user_id,frame_id,updated_at)
          SELECT ?,?,? WHERE ${activePredicate}
          ON CONFLICT(user_id) DO UPDATE SET frame_id=excluded.frame_id,updated_at=excluded.updated_at
          WHERE ${activePredicate}`, member.id, frameId, now(), member.id, member.id).run();
        if (result.meta?.changes === 0) {
          await activeMember(identity);
          fail(409, 'frame_conflict', 'Çerçeve kaydedilemedi. Tekrar deneyin.');
        }
      } catch (error) {
        if (missingTable(error)) unavailable();
        throw error;
      }
      return getOwn(identity);
    },
  };
}
