import { MembershipError, createMembershipService, validateRegistration } from './membership.mjs';
import { scrypt, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'anime_session';
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
const PASSWORD_PARAMETERS = Object.freeze({N: 16384, r: 8, p: 5});
const DEMO_ID = 'acct-anime-takvimi-demo';
const DEMO_EMAIL = 'demo@anime-takvimi.app';
const DEMO_NAME = 'Anime Takvimi Demo';
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();
const fail = (status, code, message) => { throw new MembershipError(status, code, message); };
const invalid = () => fail(400, 'invalid_payload', 'Gönderilen bilgiler geçerli değil.');
const invalidLogin = () => fail(401, 'invalid_credentials', 'E-posta veya şifre hatalı.');
const signupUnavailable = () => fail(409, 'registration_unavailable', 'Bu bilgilerle üyelik oluşturulamıyor. Hesabınız varsa giriş yapmayı deneyin.');
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const allowedKeys = (value, keys) => plainObject(value) && Object.keys(value).every(key => keys.includes(key));
const toHex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const randomHex = bytes => toHex(crypto.getRandomValues(new Uint8Array(bytes)));
const fromHex = value => Uint8Array.from(value.match(/.{2}/g) || [], pair => parseInt(pair, 16));
const hashToken = async token => toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token))));

export function normalizeEmail(value) {
  if (typeof value !== 'string') invalid();
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email) || email.split('@')[0].length > 64) invalid();
  return email;
}

export function validateSignup(payload) {
  if (!allowedKeys(payload, ['email', 'password', 'displayName'])) invalid();
  const email = normalizeEmail(payload.email);
  const {displayName} = validateRegistration({displayName: payload.displayName});
  if (typeof payload.password !== 'string' || payload.password.length < 12 || payload.password.length > 128) {
    fail(400, 'invalid_password', 'Şifreniz 12–128 karakter arasında olmalı.');
  }
  return {email, displayName, password: payload.password};
}

function validateLogin(payload) {
  if (!allowedKeys(payload, ['email', 'password'])) invalid();
  const email = normalizeEmail(payload.email);
  if (typeof payload.password !== 'string' || !payload.password || payload.password.length > 128) invalidLogin();
  return {email, password: payload.password};
}

async function derivePassword(password, salt) {
  const derived = await new Promise((resolve, reject) => {
    scrypt(encoder.encode(password), fromHex(salt), 32,
      {...PASSWORD_PARAMETERS, maxmem: 32 * 1024 * 1024},
      (error, key) => error ? reject(error) : resolve(key));
  });
  return toHex(derived);
}

function equalHashes(left, right) {
  if (!TOKEN_PATTERN.test(left) || !TOKEN_PATTERN.test(right)) return false;
  return timingSafeEqual(fromHex(left), fromHex(right));
}

export function parseSessionCookie(cookieHeader) {
  if (typeof cookieHeader !== 'string' || cookieHeader.length > 16384) return null;
  const cookies = cookieHeader.split(';').map(part => part.trim()).filter(part => part.startsWith(`${SESSION_COOKIE}=`));
  if (cookies.length !== 1) return null;
  const token = cookies[0].slice(SESSION_COOKIE.length + 1);
  return TOKEN_PATTERN.test(token) ? token : null;
}

export function sessionCookie(token, requestUrl) {
  if (!TOKEN_PATTERN.test(token)) throw new TypeError('Invalid session token');
  const secure = new URL(requestUrl).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`;
}

export function clearSessionCookie(requestUrl) {
  const secure = new URL(requestUrl).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`;
}

// The sole identity source is a secret session token resolved against D1.
// Typed email addresses never link to an earlier account or claim admin rights.
export function createEmailAuthService(db, options = {}) {
  const now = options.now || Date.now;
  const statement = (sql, ...values) => db.prepare(sql).bind(...values);
  const membership = createMembershipService(db); // Deliberately no adminEmail.

  async function rateLimit(action, email) {
    const date = now();
    const emailHash = await hashToken(email);
    const buckets = [
      {key: `${action}:email:${emailHash}`, limit: action === 'login' ? 10 : action === 'demo' ? 60 : 4, duration: action === 'login' ? 15 * 60 * 1000 : action === 'demo' ? 60 * 1000 : 60 * 60 * 1000},
      // A global budget also bounds password derivations with rotating addresses.
      {key: `${action}:global`, limit: action === 'demo' ? 300 : 120, duration: 60 * 1000},
    ];
    await statement('DELETE FROM auth_rate_limits WHERE reset_at <= ?', date).run();
    await db.batch(buckets.map(bucket => statement('INSERT INTO auth_rate_limits(bucket_key,reset_at,attempts) VALUES(?,?,1) ON CONFLICT(bucket_key) DO UPDATE SET attempts=CASE WHEN auth_rate_limits.reset_at <= ? THEN 1 ELSE auth_rate_limits.attempts+1 END,reset_at=CASE WHEN auth_rate_limits.reset_at <= ? THEN excluded.reset_at ELSE auth_rate_limits.reset_at END', bucket.key, date + bucket.duration, date, date)));
    for (const bucket of buckets) {
      const row = await statement('SELECT attempts FROM auth_rate_limits WHERE bucket_key = ?', bucket.key).first();
      if (!row || row.attempts > bucket.limit) fail(429, 'rate_limited', 'Çok fazla deneme yaptınız. Bir süre bekleyip tekrar deneyin.');
    }
  }

  function newSession(userId) {
    const sessionToken = randomHex(32);
    const createdAt = now();
    return {sessionToken, userId, createdAt, expiresAt: createdAt + SESSION_SECONDS * 1000};
  }

  async function resultFor(identity, session) {
    const account = await membership.account(identity);
    return {identity, user: account.user, sessionToken: session.sessionToken, expiresAt: session.expiresAt};
  }

  return {
    async register(payload) {
      const {email, displayName, password} = validateSignup(payload);
      await rateLimit('register', email);
      const salt = randomHex(32);
      const passwordHash = await derivePassword(password, salt);
      const identity = {userId: `acct-${crypto.randomUUID()}`, email, displayName, fullName: null};
      const session = newSession(identity.userId);
      const tokenHash = await hashToken(session.sessionToken);
      const createdAt = new Date(session.createdAt).toISOString();
      try {
        // Credentials, the unprivileged member, and its first session commit
        // together. A duplicate address rolls back the entire D1 batch.
        await db.batch([
          statement("INSERT INTO members(id,email,display_name,role,status,created_at) VALUES(?,?,?,'member','active',?)", identity.userId, email, displayName, createdAt),
          statement('INSERT INTO auth_accounts(user_id,email,password_hash,password_salt,password_algorithm,password_parameters,created_at) VALUES(?,?,?,?,?,?,?)', identity.userId, email, passwordHash, salt, 'scrypt', JSON.stringify(PASSWORD_PARAMETERS), createdAt),
          statement('INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)', tokenHash, identity.userId, session.createdAt, session.expiresAt),
          statement('DELETE FROM auth_sessions WHERE expires_at <= ?', session.createdAt),
        ]);
      } catch (error) {
        if (/UNIQUE constraint failed:\s*auth_accounts\.email/i.test(String(error?.message || error))) signupUnavailable();
        throw error;
      }
      return resultFor(identity, session);
    },

    async loginDemo() {
      await rateLimit('demo', DEMO_EMAIL);
      let row = await statement('SELECT m.id,m.email,m.display_name,m.role,m.status FROM members m JOIN auth_accounts a ON a.user_id=m.id WHERE a.email=?', DEMO_EMAIL).first();
      if (!row) {
        const salt = randomHex(32);
        const passwordHash = await derivePassword(randomHex(48), salt);
        const createdAt = new Date(now()).toISOString();
        try {
          await db.batch([
            statement("INSERT INTO members(id,email,display_name,role,status,created_at) VALUES(?,?,?,'member','active',?) ON CONFLICT(id) DO NOTHING", DEMO_ID, DEMO_EMAIL, DEMO_NAME, createdAt),
            statement('INSERT INTO auth_accounts(user_id,email,password_hash,password_salt,password_algorithm,password_parameters,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO NOTHING', DEMO_ID, DEMO_EMAIL, passwordHash, salt, 'scrypt', JSON.stringify(PASSWORD_PARAMETERS), createdAt),
          ]);
        } catch (error) {
          row = await statement('SELECT m.id,m.email,m.display_name,m.role,m.status FROM members m JOIN auth_accounts a ON a.user_id=m.id WHERE a.email=?', DEMO_EMAIL).first();
          if (!row) throw error;
        }
        row ||= await statement('SELECT m.id,m.email,m.display_name,m.role,m.status FROM members m JOIN auth_accounts a ON a.user_id=m.id WHERE a.email=?', DEMO_EMAIL).first();
      }
      if (!row || row.id !== DEMO_ID || row.role !== 'member' || row.status !== 'active') fail(503, 'demo_unavailable', 'Demo hesabı şu anda kullanılamıyor.');
      const identity = {userId: row.id, email: row.email, displayName: row.display_name, fullName: null};
      const session = newSession(identity.userId);
      const created = await statement("INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM members WHERE id=? AND status='active' AND role='member')", await hashToken(session.sessionToken), identity.userId, session.createdAt, session.expiresAt, identity.userId).run();
      if (created.meta?.changes === 0) fail(503, 'demo_unavailable', 'Demo hesabı şu anda kullanılamıyor.');
      await statement('DELETE FROM auth_sessions WHERE expires_at <= ?', session.createdAt).run();
      return resultFor(identity, session);
    },

    async login(payload) {
      const {email, password} = validateLogin(payload);
      await rateLimit('login', email);
      const row = await statement('SELECT a.user_id,a.password_hash,a.password_salt,a.password_algorithm,a.password_parameters,m.email,m.display_name,m.status FROM auth_accounts a JOIN members m ON m.id=a.user_id WHERE a.email = ?', email).first();
      // A missing address incurs the same KDF cost as a wrong password.
      const salt = row?.password_salt || '0'.repeat(64);
      try {
        const parameters = row ? JSON.parse(row.password_parameters) : null;
        if (row && (row.password_algorithm !== 'scrypt' || parameters?.N !== PASSWORD_PARAMETERS.N || parameters?.r !== PASSWORD_PARAMETERS.r || parameters?.p !== PASSWORD_PARAMETERS.p || !TOKEN_PATTERN.test(salt))) invalidLogin();
      } catch { invalidLogin(); }
      const passwordHash = await derivePassword(password, salt);
      if (!row || !equalHashes(passwordHash, row.password_hash) || row.status !== 'active') invalidLogin();
      const identity = {userId: row.user_id, email: row.email, displayName: row.display_name, fullName: null};
      const session = newSession(identity.userId);
      const created = await statement("INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM members WHERE id=? AND status='active')", await hashToken(session.sessionToken), identity.userId, session.createdAt, session.expiresAt, identity.userId).run();
      if (created.meta?.changes === 0) invalidLogin();
      await statement('DELETE FROM auth_sessions WHERE expires_at <= ?', session.createdAt).run();
      return resultFor(identity, session);
    },

    async resolveUser(sessionToken) {
      if (typeof sessionToken !== 'string' || !TOKEN_PATTERN.test(sessionToken)) return null;
      const row = await statement("SELECT m.id,m.email,m.display_name FROM auth_sessions s JOIN auth_accounts a ON a.user_id=s.user_id JOIN members m ON m.id=a.user_id WHERE s.token_hash=? AND s.expires_at>? AND m.status='active'", await hashToken(sessionToken), now()).first();
      return row ? {userId: row.id, email: row.email, displayName: row.display_name, fullName: null} : null;
    },

    async logout(sessionToken) {
      if (typeof sessionToken === 'string' && TOKEN_PATTERN.test(sessionToken)) {
        await statement('DELETE FROM auth_sessions WHERE token_hash = ?', await hashToken(sessionToken)).run();
      }
      return {ok: true};
    },
  };
}
