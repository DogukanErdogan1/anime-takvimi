// Pure server-side rules. Caller supplies only server-verified identity.
export class MembershipError extends Error {
  constructor(status, code, message) { super(message); this.name = 'MembershipError'; this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new MembershipError(status, code, message); };
const bad = () => fail(400, 'invalid_payload', 'Gönderilen bilgiler geçerli değil.');
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const ownKeys = (v, allowed) => object(v) && Object.keys(v).every(k => allowed.includes(k));
const idValid = v => typeof v === 'string' && /^mal-[1-9]\d{0,9}$/.test(v);
const boundedText = (v, max) => typeof v === 'string' && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
const number = (v, min, max, integer = false) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max && (!integer || Number.isInteger(v));
const nullable = (v, predicate) => v === null || predicate(v);
const emptyLibrary = () => ({saved: [], reminders: [], progress: {}, view: 'grid', savedAnime: {}});
const publicMember = row => ({id: row.id, email: row.email, displayName: row.display_name, role: row.role, status: row.status, createdAt: row.created_at});
export function validateRegistration(payload) {
  if (!ownKeys(payload, ['displayName']) || !boundedText(payload.displayName, 80)) bad();
  const displayName = payload.displayName.trim(); const size = Array.from(displayName).length;
  if (size < 2 || size > 40) bad(); return {displayName};
}
export function validateStatusPatch(payload) {
  if (!ownKeys(payload, ['status']) || !['active', 'suspended'].includes(payload.status)) bad(); return {status: payload.status};
}
function safeUrl(value, image) {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const u = new URL(value); if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
    const hosts = image ? ['cdn.myanimelist.net', 'myanimelist.net', 'www.myanimelist.net'] : ['myanimelist.net', 'www.myanimelist.net'];
    return hosts.includes(u.hostname) && (image || /^\/anime\/\d+(?:\/[^?#]*)?$/.test(u.pathname));
  } catch { return false; }
}
function animeSnapshot(value, id) {
  const textFields = {title: 500, original: 500, format: 30, durationText: 120, studio: 1000, status: 100, summary: 8000};
  const fields = ['id','malId','image','malUrl','synonyms','genres','rating','episodes','duration','members','year','season','airing','airedFrom','broadcastSource','day','time','broadcastLocal', ...Object.keys(textFields)];
  if (!ownKeys(value, fields) || value.id !== id || !boundedText(value.title, 500) || !value.title.trim()) bad();
  const result = {id};
  for (const [key, v] of Object.entries(value)) {
    if (key === 'id') continue; let valid = false;
    if (key in textFields) valid = boundedText(v, textFields[key]);
    else if (key === 'image' || key === 'malUrl') valid = safeUrl(v, key === 'image');
    else if (key === 'synonyms' || key === 'genres') valid = Array.isArray(v) && v.length <= 30 && v.every(s => boundedText(s, key === 'genres' ? 100 : 500));
    else if (key === 'malId') valid = number(v, 1, 1e10, true);
    else if (key === 'rating') valid = nullable(v, x => number(x, 0, 10));
    else if (key === 'episodes') valid = nullable(v, x => number(x, 1, 9999, true));
    else if (key === 'duration') valid = nullable(v, x => number(x, 0, 10000, true));
    else if (key === 'members') valid = number(v, 0, 1e10, true);
    else if (key === 'year') valid = nullable(v, x => number(x, 1900, 2999, true));
    else if (key === 'season') valid = v === null || ['winter','spring','summer','fall'].includes(v);
    else if (key === 'airing' || key === 'broadcastLocal') valid = typeof v === 'boolean';
    else if (key === 'airedFrom') valid = nullable(v, x => boundedText(x, 50));
    else if (key === 'broadcastSource') valid = nullable(v, x => boundedText(x, 200));
    else if (key === 'day') valid = nullable(v, x => number(x, 0, 6, true));
    else if (key === 'time') valid = nullable(v, x => typeof x === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(x));
    if (!valid) bad(); result[key] = v;
  }
  return result;
}
export function validateLibrary(payload) {
  if (!ownKeys(payload, ['library']) || !ownKeys(payload.library, ['saved','reminders','progress','view','savedAnime'])) bad();
  const value = payload.library; if (!['grid','list'].includes(value.view) || !object(value.progress) || !object(value.savedAnime)) bad();
  const ids = new Set(); const result = {saved: [], reminders: [], progress: {}, view: value.view, savedAnime: {}};
  for (const key of ['saved','reminders']) {
    if (!Array.isArray(value[key]) || value[key].length > 500 || !value[key].every(idValid)) bad();
    result[key] = [...new Set(value[key])]; result[key].forEach(id => ids.add(id));
  }
  for (const [id, count] of Object.entries(value.progress)) {
    if (!idValid(id) || !number(count, 0, 9999, true)) bad(); result.progress[id] = count; ids.add(id);
  }
  for (const [id, anime] of Object.entries(value.savedAnime)) {
    if (!idValid(id)) bad(); result.savedAnime[id] = animeSnapshot(anime, id); ids.add(id);
  }
  if (ids.size > 500 || Object.keys(value.progress).length > 500 || Object.keys(value.savedAnime).length > 500) bad();
  if (new TextEncoder().encode(JSON.stringify({library: result})).byteLength > 1024 * 1024) fail(413, 'body_too_large', 'Gönderilen veri çok büyük.');
  return result;
}
export function enforceMutation(request, maxBytes = 1024 * 1024) {
  if (!['POST','PUT','PATCH'].includes(request.method)) fail(405, 'method_not_allowed', 'Bu işlem desteklenmiyor.');
  if (request.headers.get('origin') !== new URL(request.url).origin) fail(403, 'invalid_origin', 'Bu istek kaynağına izin verilmiyor.');
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') fail(415, 'json_required', 'JSON biçiminde veri gönderin.');
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) fail(413, 'body_too_large', 'Gönderilen veri çok büyük.');
}
export async function readJsonMutation(request, maxBytes = 1024 * 1024) {
  enforceMutation(request, maxBytes); if (!request.body) bad();
  const reader = request.body.getReader(); const chunks = []; let bytes = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); fail(413, 'body_too_large', 'Gönderilen veri çok büyük.'); } chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const all = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(all)); } catch { bad(); }
}
export function createMembershipService(db, options = {}) {
  const now = options.now || (() => new Date().toISOString()); const makeId = options.makeId || (() => crypto.randomUUID());
  const adminEmail = typeof options.adminEmail === 'string' ? options.adminEmail.trim().toLowerCase() : '';
  const statement = (sql, ...values) => db.prepare(sql).bind(...values);
  function identityRequired(identity) {
    if (!identity || typeof identity.userId !== 'string' || !identity.userId || identity.userId.length > 256 || !boundedText(identity.email, 320) || !identity.email.includes('@')) fail(401, 'sign_in_required', 'Önce giriş yapın.'); return identity;
  }
  async function memberRequired(identity) {
    identityRequired(identity);
    const member = await statement('SELECT id,email,display_name,role,status,created_at FROM members WHERE id = ?', identity.userId).first();
    if (!member) fail(403, 'registration_required', 'Önce üyeliğinizi tamamlayın.');
    if (member.status !== 'active') fail(403, 'account_suspended', 'Hesabınız askıya alınmış.'); return member;
  }
  async function adminRequired(identity) {
    const member = await memberRequired(identity); const owner = await statement("SELECT value FROM app_settings WHERE key = 'admin_owner'").first();
    if (member.role !== 'admin' || owner?.value !== member.id) fail(403, 'admin_required', 'Bu işlem için yönetici yetkisi gerekiyor.'); return member;
  }
  return {
    async account(identity) {
      if (!identity) return {authenticated: false, registered: false}; identityRequired(identity);
      const member = await statement('SELECT id,email,display_name,role,status,created_at FROM members WHERE id = ?', identity.userId).first();
      if (!member) return {authenticated: true, registered: false, identity: {email: identity.email, displayName: identity.displayName || identity.email}};
      return {authenticated: true, registered: true, user: publicMember(member)};
    },
    async register(identity, payload) {
      identityRequired(identity); const {displayName} = validateRegistration(payload); const date = now();
      const existing = await statement('SELECT status FROM members WHERE id = ?', identity.userId).first();
      if (existing?.status === 'suspended') fail(403, 'account_suspended', 'Hesabınız askıya alınmış.');
      const matches = !!adminEmail && adminEmail.includes('@') && identity.email.trim().toLowerCase() === adminEmail;
      await db.batch([
        statement("INSERT INTO app_settings(key,value) SELECT 'admin_owner', ? WHERE ? = 1 AND NOT EXISTS(SELECT 1 FROM members WHERE id=? AND status='suspended') ON CONFLICT(key) DO NOTHING", identity.userId, matches ? 1 : 0, identity.userId),
        statement("INSERT INTO members(id,email,display_name,role,status,created_at) VALUES(?,?,?,CASE WHEN EXISTS(SELECT 1 FROM app_settings WHERE key = 'admin_owner' AND value = ?) THEN 'admin' ELSE 'member' END,'active',?) ON CONFLICT(id) DO NOTHING", identity.userId, identity.email, displayName, identity.userId, date),
        statement("UPDATE members SET role = 'admin' WHERE id = ? AND status='active' AND EXISTS(SELECT 1 FROM app_settings WHERE key = 'admin_owner' AND value = ?)", identity.userId, identity.userId),
      ]);
      const result = await this.account(identity);
      if (result.user?.status === 'suspended') fail(403, 'account_suspended', 'Hesabınız askıya alınmış.');
      return result;
    },
    async getLibrary(identity) {
      const member = await memberRequired(identity); const row = await statement('SELECT library_json FROM member_libraries WHERE user_id = ?', member.id).first();
      if (!row) return {library: emptyLibrary()};
      try { return {library: validateLibrary({library: JSON.parse(row.library_json)})}; } catch { fail(503, 'library_unavailable', 'Listeniz şu anda okunamıyor.'); }
    },
    async putLibrary(identity, payload) {
      const member = await memberRequired(identity); const library = validateLibrary(payload);
      const result = await statement("INSERT INTO member_libraries(user_id,library_json,updated_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM members WHERE id = ? AND status = 'active') ON CONFLICT(user_id) DO UPDATE SET library_json=excluded.library_json,updated_at=excluded.updated_at", member.id, JSON.stringify(library), now(), member.id).run();
      if (result.meta?.changes === 0) fail(403, 'account_suspended', 'Hesabınız askıya alınmış.'); return {library};
    },
    async listMembers(identity, {q = '', page = 1} = {}) {
      await adminRequired(identity); if (!boundedText(q, 100) || !number(Number(page), 1, 100000, true)) bad();
      page = Number(page); const query = `%${q.trim().replace(/[\\%_]/g, '\\$&')}%`;
      const rows = await statement("SELECT id,email,display_name,role,status,created_at FROM members WHERE display_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' ORDER BY created_at DESC,id ASC LIMIT 20 OFFSET ?", query, query, (page - 1) * 20).all();
      const count = await statement("SELECT COUNT(*) AS total FROM members WHERE display_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\'", query, query).first();
      const stats = await statement("SELECT COUNT(*) AS total,COALESCE(SUM(status='active'),0) AS active,COALESCE(SUM(status='suspended'),0) AS suspended,COALESCE(SUM(role='admin'),0) AS admins FROM members").first();
      return {members: rows.results.map(publicMember), pagination: {page, total: Number(count.total), pages: Math.max(1, Math.ceil(Number(count.total) / 20))}, stats};
    },
    async setMemberStatus(identity, targetId, payload) {
      const admin = await adminRequired(identity); const {status} = validateStatusPatch(payload); if (typeof targetId !== 'string' || !targetId || targetId.length > 256) bad();
      const target = await statement('SELECT id,email,display_name,role,status,created_at FROM members WHERE id = ?', targetId).first();
      if (!target) fail(404, 'member_not_found', 'Üye bulunamadı.');
      if (target.id === admin.id || target.role === 'admin') fail(403, 'protected_admin', 'Yönetici hesabının durumunu değiştiremezsiniz.');
      if (target.status === status) return {member: publicMember(target)};
      await db.batch([
        statement("UPDATE members SET status = ? WHERE id = ? AND role = 'member' AND id <> ? AND EXISTS(SELECT 1 FROM members AS actor JOIN app_settings AS owner ON owner.key='admin_owner' AND owner.value=actor.id WHERE actor.id=? AND actor.role='admin' AND actor.status='active')", status, targetId, admin.id, admin.id),
        statement("INSERT INTO admin_audit(id,actor_id,target_id,action,metadata_json,created_at) SELECT ?,?,?,'member_status',?,? WHERE EXISTS(SELECT 1 FROM members WHERE id=? AND role='member' AND status=?) AND EXISTS(SELECT 1 FROM members AS actor JOIN app_settings AS owner ON owner.key='admin_owner' AND owner.value=actor.id WHERE actor.id=? AND actor.role='admin' AND actor.status='active')", makeId(), admin.id, targetId, JSON.stringify({from: target.status, to: status}), now(), targetId, status, admin.id),
      ]);
      const member = await statement('SELECT id,email,display_name,role,status,created_at FROM members WHERE id = ?', targetId).first();
      if (member.status !== status) fail(409, 'update_conflict', 'Üye durumu güncellenemedi. Tekrar deneyin.'); return {member: publicMember(member)};
    },
  };
}
