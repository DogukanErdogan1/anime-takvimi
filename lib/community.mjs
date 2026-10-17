import { MembershipError, createMembershipService, validateLibrary } from './membership.mjs';

const fail = (status, code, message) => { throw new MembershipError(status, code, message); };
const bad = () => fail(400, 'invalid_payload', 'Gönderilen bilgiler geçerli değil.');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const keys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const text = (value, max) => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f]/.test(value);
const number = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const activePredicate = "EXISTS(SELECT 1 FROM members WHERE id=? AND status='active')";
const adminPredicate = "EXISTS(SELECT 1 FROM members AS actor JOIN app_settings AS owner ON owner.key='admin_owner' AND owner.value=actor.id WHERE actor.id=? AND actor.role='admin' AND actor.status='active')";

export function communityAnimeId(value) {
  const source = typeof value === 'number' || typeof value === 'string' ? String(value).replace(/^mal-/, '') : '';
  if (!/^[1-9]\d{0,9}$/.test(source)) fail(400, 'invalid_anime_id', 'Geçerli bir anime numarası girin.');
  return Number(source);
}
export function validateProfile(payload) {
  if (!keys(payload, ['bio','isPublic']) || !text(payload.bio, 500) || typeof payload.isPublic !== 'boolean') bad();
  return {bio: payload.bio.trim(), isPublic: payload.isPublic};
}
export function validateReview(payload) {
  if (!keys(payload, ['body','spoiler','score']) || !text(payload.body, 2000) || !payload.body.trim()) bad();
  if ('spoiler' in payload && typeof payload.spoiler !== 'boolean') bad();
  if ('score' in payload && payload.score !== null && !number(payload.score, 1, 10)) bad();
  return {body: payload.body.trim(), spoiler: payload.spoiler ?? false, score: payload.score ?? null};
}
export function validateReviewVisibility(payload) {
  if (!keys(payload, ['hidden']) || payload.hidden !== true) bad();
  return {hidden: true};
}
const profileView = row => ({id: row.id, displayName: row.display_name, bio: row.bio || '', isPublic: row.is_public === 1});
const reviewView = row => ({id: row.id, userId: row.user_id, displayName: row.display_name, body: row.body, spoiler: row.spoiler === 1, score: row.score, createdAt: row.created_at});
const publicLibrary = library => {
  const tracking = library.tracking || {}, scores = library.scores || {}, favorites = library.favorites || [], collections = library.collections || [];
  // Snapshots may exist solely to power a private reminder. Only explicitly
  // shared library entries contribute metadata to an opted-in public profile.
  const ids = new Set([...library.saved, ...Object.keys(library.progress), ...Object.keys(tracking), ...Object.keys(scores), ...favorites, ...collections.flatMap(collection => collection.animeIds)]);
  const savedAnime = Object.fromEntries(Object.entries(library.savedAnime).filter(([animeId]) => ids.has(animeId)));
  return {saved: library.saved, savedAnime, progress: library.progress, tracking, scores, favorites, collections, view: library.view};
};

// Identity is provided exclusively by the verified server session, never by JSON.
export function createCommunityService(db, options = {}) {
  if (!db) fail(503, 'community_unavailable', 'Topluluk hizmeti şu anda kullanılamıyor.');
  const statement = (sql, ...values) => db.prepare(sql).bind(...values);
  const membership = createMembershipService(db);
  const now = options.now || (() => new Date().toISOString());
  const makeId = options.makeId || (() => crypto.randomUUID());
  async function memberRequired(identity) {
    const account = await membership.account(identity);
    if (!account.authenticated) fail(401, 'sign_in_required', 'Önce giriş yapın.');
    if (!account.registered) fail(403, 'registration_required', 'Önce üyeliğinizi tamamlayın.');
    if (account.user.status !== 'active') fail(403, 'account_suspended', 'Hesabınız askıya alınmış.');
    return account.user;
  }
  async function consumeReviewRate(userId, date) {
    const stamp = Date.parse(date);
    if (!Number.isFinite(stamp)) fail(503, 'community_unavailable', 'Topluluk hizmeti şu anda kullanılamıyor.');
    const result = await statement(`INSERT INTO community_rate_limits(bucket_key,reset_at,attempts) VALUES(?,?,1)
      ON CONFLICT(bucket_key) DO UPDATE SET reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END,
      attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END WHERE reset_at<=? OR attempts<10`, `review:${userId}`, stamp + 60_000, stamp, stamp, stamp).run();
    if (result.meta?.changes === 0) fail(429, 'rate_limited', 'Çok sık yorum gönderiyorsunuz. Bir dakika sonra tekrar deneyin.');
  }
  return {
    async getProfile(identity) {
      const member = await memberRequired(identity);
      const row = await statement("SELECT members.id,members.display_name,p.bio,p.is_public FROM members LEFT JOIN member_profiles p ON p.user_id=members.id WHERE members.id=? AND members.status='active'", member.id).first();
      if (!row) fail(403, 'account_suspended', 'Hesabınız askıya alınmış.');
      return {profile: profileView(row)};
    },
    async putProfile(identity, payload) {
      const member = await memberRequired(identity); const profile = validateProfile(payload);
      const result = await statement(`INSERT INTO member_profiles(user_id,bio,is_public,updated_at) SELECT ?,?,?,? WHERE ${activePredicate}
        ON CONFLICT(user_id) DO UPDATE SET bio=excluded.bio,is_public=excluded.is_public,updated_at=excluded.updated_at`, member.id, profile.bio, profile.isPublic ? 1 : 0, now(), member.id).run();
      if (result.meta?.changes === 0) fail(403, 'account_suspended', 'Hesabınız askıya alınmış.');
      return this.getProfile(identity);
    },
    async getPublicProfile(userId) {
      if (!id(userId)) fail(404, 'profile_not_found', 'Profil bulunamadı.');
      const row = await statement("SELECT m.id,m.display_name,m.created_at,p.bio,p.is_public,l.library_json FROM members m JOIN member_profiles p ON p.user_id=m.id AND p.is_public=1 LEFT JOIN member_libraries l ON l.user_id=m.id WHERE m.id=? AND m.status='active'", userId).first();
      if (!row) fail(404, 'profile_not_found', 'Profil bulunamadı.');
      let library;
      try { library = validateLibrary({library: row.library_json ? JSON.parse(row.library_json) : {saved:[],savedAnime:{},progress:{},reminders:[],view:'grid'}}); }
      catch { fail(503, 'library_unavailable', 'Bu profilin listesi şu anda okunamıyor.'); }
      return {profile: {...profileView(row), createdAt: row.created_at}, library: publicLibrary(library)};
    },
    async getReviews(value, {page = 1, limit = 20} = {}) {
      const animeId = communityAnimeId(value);
      page = Number(page); limit = Number(limit);
      if (!number(page, 1, 10000) || !number(limit, 1, 30)) bad();
      const visible = "FROM anime_reviews r JOIN members m ON m.id=r.user_id AND m.status='active' WHERE r.anime_id=? AND r.hidden=0";
      const rows = await statement(`SELECT r.id,r.user_id,m.display_name,r.body,r.spoiler,r.score,r.created_at ${visible} ORDER BY r.created_at DESC,r.id ASC LIMIT ? OFFSET ?`, animeId, limit, (page - 1) * limit).all();
      const totals = await statement(`SELECT COUNT(*) AS total,AVG(r.score) AS average ${visible}`, animeId).first();
      return {reviews: rows.results.map(reviewView), average: totals.average === null ? null : Math.round(Number(totals.average) * 10) / 10, total: Number(totals.total)};
    },
    async postReview(identity, value, payload) {
      const member = await memberRequired(identity); const animeId = communityAnimeId(value); const review = validateReview(payload); const date = now();
      await consumeReviewRate(member.id, date);
      const reviewId = makeId();
      if (!id(reviewId)) fail(503, 'community_unavailable', 'Topluluk hizmeti şu anda kullanılamıyor.');
      const result = await statement(`INSERT INTO anime_reviews(id,anime_id,user_id,body,spoiler,score,created_at,updated_at,hidden)
        SELECT ?,?,?,?,?,?,?,?,0 WHERE ${activePredicate}
        ON CONFLICT(anime_id,user_id) DO UPDATE SET body=excluded.body,spoiler=excluded.spoiler,score=excluded.score,updated_at=excluded.updated_at
        WHERE anime_reviews.hidden=0 AND ${activePredicate}`, reviewId, animeId, member.id, review.body, review.spoiler ? 1 : 0, review.score, date, date, member.id, member.id).run();
      if (result.meta?.changes === 0) {
        await memberRequired(identity);
        fail(409, 'review_hidden', 'Bu yorum kaldırılmış. Yeniden yayınlanamaz.');
      }
      const row = await statement("SELECT r.id,r.user_id,m.display_name,r.body,r.spoiler,r.score,r.created_at FROM anime_reviews r JOIN members m ON m.id=r.user_id AND m.status='active' WHERE r.anime_id=? AND r.user_id=? AND r.hidden=0", animeId, member.id).first();
      if (!row) fail(409, 'review_conflict', 'Yorum değişti. Sayfayı yenileyip tekrar deneyin.');
      return {review: reviewView(row)};
    },
    async hideReview(identity, value, reviewId, payload) {
      const member = await memberRequired(identity); const animeId = communityAnimeId(value); validateReviewVisibility(payload);
      if (!id(reviewId)) fail(404, 'review_not_found', 'Yorum bulunamadı.');
      const authorization = `(user_id=? OR ${adminPredicate}) AND ${activePredicate}`;
      const permitted = await statement(`SELECT id FROM anime_reviews WHERE id=? AND anime_id=? AND ${authorization}`, reviewId, animeId, member.id, member.id, member.id).first();
      if (!permitted) fail(404, 'review_not_found', 'Yorum bulunamadı veya bu işlem için yetkiniz yok.');
      const result = await statement(`UPDATE anime_reviews SET hidden=1,hidden_by=?,hidden_at=?,updated_at=? WHERE id=? AND anime_id=? AND ${authorization}`, member.id, now(), now(), reviewId, animeId, member.id, member.id, member.id).run();
      if (result.meta?.changes === 0) fail(409, 'review_conflict', 'Yorum değişti. Sayfayı yenileyip tekrar deneyin.');
      return {hidden: true};
    },
  };
}
