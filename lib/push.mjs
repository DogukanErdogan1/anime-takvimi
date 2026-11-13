import {MembershipError, createMembershipService} from './membership.mjs';

const HEX = /^[a-f0-9]{64}$/;
const fail = (status, message) => {throw new MembershipError(status, 'push_error', message);};
export async function pushDigest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
function decode(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) fail(400, 'Bildirim anahtarı geçersiz.');
  try {return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0));}
  catch {fail(400, 'Bildirim anahtarı geçersiz.');}
}
export function validatePushSubscription(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['endpoint', 'keys', 'expirationTime'].includes(key)) || typeof value.endpoint !== 'string' || value.endpoint.length > 2048 || !value.keys || Object.keys(value.keys).some(key => !['p256dh', 'auth'].includes(key))) fail(400, 'Bildirim aboneliği geçersiz.');
  let url;
  try {url = new URL(value.endpoint);} catch {fail(400, 'Bildirim adresi geçersiz.');}
  const host = url.hostname;
  const permitted = host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' || host.endsWith('.notify.windows.com') || host === 'web.push.apple.com' || host.endsWith('.push.apple.com');
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !permitted) fail(400, 'Bildirim servisi desteklenmiyor.');
  const publicKey = decode(value.keys.p256dh), auth = decode(value.keys.auth);
  if (publicKey.length !== 65 || publicKey[0] !== 4 || auth.length !== 16) fail(400, 'Bildirim anahtarı geçersiz.');
  return {endpoint: url.href, keys: {p256dh: value.keys.p256dh, auth: value.keys.auth}};
}

export function pushClock(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(now).map(part => [part.type, part.value]));
  return {key: `${parts.year}-${parts.month}-${parts.day}`, day: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].indexOf(parts.weekday), minute: +parts.hour * 60 + +parts.minute};
}
export function duePush(items, reminderIds, now) {
  const today = pushClock(now), wanted = new Set(reminderIds), seen = new Set();
  return items.flatMap(item => {
    if (!item || !/^mal-[1-9]\d*$/.test(item.id) || seen.has(item.id) || !wanted.has(item.id) || item.airing !== true || item.broadcastLocal !== true || !Number.isInteger(item.day) || item.day < 0 || item.day > 6 || typeof item.title !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.time)) return [];
    seen.add(item.id);
    const minute = +item.time.slice(0, 2) * 60 + +item.time.slice(3);
    const elapsed = item.day === today.day ? today.minute - minute : item.day === (today.day + 6) % 7 ? today.minute + 1440 - minute : Infinity;
    if (elapsed < 0 || elapsed >= 5) return [];
    const date = item.day === today.day ? today.key : new Date(Date.parse(`${today.key}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
    return [{item, key: `${date}:${item.id}`}];
  });
}

// Subscription APIs use Web Crypto only. Only the Node scheduler receives the
// encrypted-network sender, so a web request cannot trigger arbitrary delivery.
export function createPushService(db, config = {}, options = {}) {
  if (!db) fail(503, 'Bildirim hizmeti kullanılamıyor.');
  const q = (sql, ...values) => db.prepare(sql).bind(...values);
  const members = createMembershipService(db), now = options.now || Date.now;
  async function member(identity, sessionToken) {
    if (!HEX.test(sessionToken || '')) fail(401, 'Önce giriş yap.');
    const account = await members.account(identity);
    if (!account.registered || account.user.status !== 'active') fail(403, 'Aktif hesabınla giriş yap.');
    const sessionHash = await pushDigest(sessionToken);
    const session = await q('SELECT token_hash FROM auth_sessions WHERE token_hash=? AND user_id=? AND expires_at>?', sessionHash, account.user.id, now()).first();
    if (!session) fail(401, 'Oturumun sona erdi. Yeniden giriş yap.');
    return {userId: account.user.id, sessionHash};
  }
  async function deviceHash(token) {return HEX.test(token || '') ? pushDigest(token) : null;}
  async function mutationBudget(sessionHash) {
    const stamp = now();
    const result = await q('INSERT INTO auth_rate_limits(bucket_key,reset_at,attempts) VALUES(?,?,1) ON CONFLICT(bucket_key) DO UPDATE SET attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END,reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END WHERE reset_at<=? OR attempts<20', 'push:' + sessionHash, stamp + 60000, stamp, stamp, stamp).run();
    if (result.meta?.changes === 0) fail(429, 'Çok sık bildirim ayarı değiştirdin. Bir dakika sonra yeniden dene.');
  }
  return {
    /** @param {string|null} [animeId] */
    async status(identity, sessionToken, token, animeId = null) {
      const {userId, sessionHash} = await member(identity, sessionToken), hash = await deviceHash(token);
      const row = hash ? await q('SELECT binding_id FROM push_subscriptions WHERE device_hash=? AND session_hash=? AND user_id=?', hash, sessionHash, userId).first() : null;
      let reminderActive = null;
      if (animeId !== null) {
        if (typeof animeId !== 'string' || !/^mal-[1-9]\d{0,9}$/.test(animeId)) fail(400, 'Geçersiz anime numarası.');
        const saved = row ? await q('SELECT library_json FROM member_libraries WHERE user_id=?', userId).first() : null;
        try {reminderActive = !!saved && JSON.parse(saved.library_json).reminders?.includes(animeId) === true;} catch {reminderActive = false;}
      }
      return {available: !!(config.publicKey && config.privateKey), publicKey: config.publicKey || null, active: !!row, bindingId: row?.binding_id || null, reminderActive};
    },
    async subscribe(identity, sessionToken, token, payload) {
      const {userId, sessionHash} = await member(identity, sessionToken);
      if (!config.publicKey || !config.privateKey) fail(503, 'Arka plan bildirimleri henüz yapılandırılmadı.');
      await mutationBudget(sessionHash);
      const subscription = validatePushSubscription(payload);
      try {await crypto.subtle.importKey('raw', decode(subscription.keys.p256dh), {name: 'ECDH', namedCurve: 'P-256'}, false, []);} catch {fail(400, 'Bildirim anahtarı geçersiz.');}
      const endpointHash = await pushDigest(subscription.endpoint), oldHash = await deviceHash(token);
      const existing = await q('SELECT device_hash FROM push_subscriptions WHERE endpoint_hash=?', endpointHash).first();
      if (existing && existing.device_hash !== oldHash) fail(409, 'Bu tarayıcının bildirim bağlantısını yenileyip yeniden dene.');
      const count = await q('SELECT COUNT(*) AS total FROM push_subscriptions WHERE user_id=? AND endpoint_hash<>? AND (? IS NULL OR device_hash<>?)', userId, endpointHash, oldHash, oldHash).first();
      if (count.total >= 10) fail(409, 'Hesabında en fazla 10 cihaz bildirim alabilir.');
      const deviceToken = oldHash ? token : randomToken(), hash = await pushDigest(deviceToken), bindingId = crypto.randomUUID();
      // Switching the push service/key replaces only this authenticated device.
      await db.batch([
        q('DELETE FROM push_subscriptions WHERE device_hash=? AND endpoint_hash<>? AND user_id=? AND session_hash=?', hash, endpointHash, userId, sessionHash),
        q("INSERT INTO push_subscriptions(endpoint_hash,user_id,subscription_json,created_at,device_hash,binding_id,session_hash) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM auth_sessions s JOIN members m ON m.id=s.user_id WHERE s.token_hash=? AND s.user_id=? AND s.expires_at>? AND m.status='active') AND (SELECT COUNT(*) FROM push_subscriptions WHERE user_id=? AND endpoint_hash<>?)<10 ON CONFLICT(endpoint_hash) DO UPDATE SET user_id=excluded.user_id,subscription_json=excluded.subscription_json,device_hash=excluded.device_hash,session_hash=excluded.session_hash WHERE push_subscriptions.device_hash=excluded.device_hash", endpointHash, userId, JSON.stringify(subscription), new Date(now()).toISOString(), hash, bindingId, sessionHash, sessionHash, userId, now(), userId, endpointHash),
      ]);
      const row = await q('SELECT binding_id FROM push_subscriptions WHERE endpoint_hash=? AND device_hash=? AND session_hash=? AND user_id=?', endpointHash, hash, sessionHash, userId).first();
      if (!row) fail(409, 'Bildirim bağlantısı değişti. Yeniden dene.');
      return {deviceToken, bindingId: row.binding_id};
    },
    async unsubscribe(identity, sessionToken, token) {
      const {userId, sessionHash} = await member(identity, sessionToken), hash = await deviceHash(token);
      if (hash) await q('DELETE FROM push_subscriptions WHERE device_hash=? AND session_hash=? AND user_id=?', hash, sessionHash, userId).run();
      return {active: false};
    },
    async dispatch(items) {
      if (!config.publicKey || !config.privateKey || !options.send) return {sent: 0, failed: 0};
      const stamp = now();
      await q("DELETE FROM push_subscriptions WHERE NOT EXISTS(SELECT 1 FROM auth_sessions s JOIN members m ON m.id=s.user_id WHERE s.token_hash=push_subscriptions.session_hash AND s.user_id=push_subscriptions.user_id AND s.expires_at>? AND m.status='active')", stamp).run();
      await q('DELETE FROM push_deliveries WHERE claimed_at<?', stamp - 8 * 86400000).run();
      const rows = await q("SELECT p.endpoint_hash,p.binding_id,p.user_id,p.subscription_json,l.library_json FROM push_subscriptions p JOIN auth_sessions s ON s.token_hash=p.session_hash AND s.expires_at>? JOIN members m ON m.id=p.user_id AND m.status='active' JOIN member_libraries l ON l.user_id=m.id", stamp).all();
      let sent = 0, failed = 0;
      for (const row of rows.results) {
        let subscription, library;
        try {subscription = validatePushSubscription(JSON.parse(row.subscription_json)); library = JSON.parse(row.library_json);} catch {failed++; continue;}
        const due = duePush(items, Array.isArray(library.reminders) ? library.reminders : [], new Date(stamp));
        for (const entry of due) {
          const claim = await q("INSERT INTO push_deliveries(endpoint_hash,occurrence,status,claimed_at) SELECT ?,?,'sending',? WHERE EXISTS(SELECT 1 FROM push_subscriptions p JOIN auth_sessions s ON s.token_hash=p.session_hash AND s.expires_at>? JOIN members m ON m.id=p.user_id AND m.status='active' WHERE p.endpoint_hash=? AND p.binding_id=? AND p.user_id=?) ON CONFLICT(endpoint_hash,occurrence) DO UPDATE SET status='sending',claimed_at=excluded.claimed_at,attempts=push_deliveries.attempts+1 WHERE push_deliveries.attempts<3 AND ((push_deliveries.status='failed' AND push_deliveries.claimed_at<=?) OR (push_deliveries.status='sending' AND push_deliveries.claimed_at<?))", row.endpoint_hash, entry.key, stamp, stamp, row.endpoint_hash, row.binding_id, row.user_id, stamp - 30000, stamp - 120000).run();
          if (claim.meta?.changes === 0) continue;
          // Logout/session revocation can occur while an earlier device sends.
          if (!await q('SELECT endpoint_hash FROM push_subscriptions WHERE endpoint_hash=? AND binding_id=?', row.endpoint_hash, row.binding_id).first()) continue;
          try {
            await options.send(subscription, {title: 'Yayın saati geldi', body: `${entry.item.title.slice(0,180)} · ${entry.item.time} (Türkiye saati)`, tag: `anime-${entry.key}`, animeId: entry.item.id, bindingId: row.binding_id});
            await q("UPDATE push_deliveries SET status='sent' WHERE endpoint_hash=? AND occurrence=? AND claimed_at=?", row.endpoint_hash, entry.key, stamp).run(); sent++;
          } catch (error) {
            failed++;
            if (error.statusCode === 404 || error.statusCode === 410) await q('DELETE FROM push_subscriptions WHERE endpoint_hash=? AND binding_id=?', row.endpoint_hash, row.binding_id).run();
            else await q("UPDATE push_deliveries SET status='failed' WHERE endpoint_hash=? AND occurrence=? AND claimed_at=?", row.endpoint_hash, entry.key, stamp).run();
          }
        }
      }
      return {sent, failed};
    },
  };
}

export function pushDeviceCookie(request) {
  const parts = (request.headers.get('cookie') || '').split(';').map(part => part.trim()).filter(part => part.startsWith('anime_push_device='));
  const value = parts.length === 1 ? parts[0].slice('anime_push_device='.length) : null;
  return HEX.test(value || '') ? value : null;
}
export function pushDeviceCookieValue(token, url) {
  if (token && !HEX.test(token)) throw new TypeError('Invalid device token');
  return `anime_push_device=${token || ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? 31536000 : 0}${new URL(url).protocol === 'https:' ? '; Secure' : ''}`;
}
