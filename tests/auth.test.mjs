import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  createEmailAuthService, validateSignup, normalizeEmail,
  SESSION_COOKIE, SESSION_SECONDS, parseSessionCookie, sessionCookie, clearSessionCookie,
} from '../lib/auth.mjs';
import { MembershipError, createMembershipService } from '../lib/membership.mjs';

// Execute the production SQL against SQLite, including D1's transactional batch
// behavior. These tests verify persisted boundaries, rather than mocking users.
class SQLiteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys = ON;');
    const directory = new URL('../drizzle/', import.meta.url);
    for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
      this.sqlite.exec(readFileSync(new URL(name, directory), 'utf8'));
    }
  }
  prepare(sql) {
    const statement = this.sqlite.prepare(sql);
    const make = (parameters = []) => ({
      bind: (...values) => make(values),
      first: async () => { const row = statement.get(...parameters); return row ? {...row} : null; },
      all: async () => ({success: true, results: statement.all(...parameters).map(row => ({...row}))}),
      run: async () => { const result = statement.run(...parameters); return {success: true, meta: {changes: Number(result.changes)}}; },
      _run: () => { const result = statement.run(...parameters); return {success: true, meta: {changes: Number(result.changes)}}; },
    });
    return make();
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN;');
    try {
      const results = statements.map(statement => statement._run());
      this.sqlite.exec('COMMIT;');
      return results;
    } catch (error) { this.sqlite.exec('ROLLBACK;'); throw error; }
  }
  close() { this.sqlite.close(); }
}

const validPassword = 'Test password 12!';
const signup = (email = 'member@example.test', overrides = {}) => ({email, password: validPassword, displayName: 'Test Member', ...overrides});
function fixture(t) {
  const db = new SQLiteD1();
  t.after(() => db.close());
  let date = Date.UTC(2026, 9, 15, 12);
  const service = createEmailAuthService(db, {now: () => date});
  return {db, service, advance: milliseconds => { date += milliseconds; }};
}
const errorIs = (status, code) => error => error instanceof MembershipError && error.status === status && (!code || error.code === code);
const count = (db, table) => db.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;

test('signup atomically persists an unprivileged member, salted scrypt hash, and only a session digest', async t => {
  const {db, service} = fixture(t);
  const result = await service.register(signup());
  assert.match(result.identity.userId, /^acct-[0-9a-f-]{36}$/);
  assert.equal(result.identity.userId.includes('member'), false);
  assert.equal(result.user.role, 'member');
  assert.equal(count(db, 'app_settings'), 0);
  const account = db.sqlite.prepare('SELECT * FROM auth_accounts').get();
  assert.equal(account.password_algorithm, 'scrypt');
  assert.deepEqual(JSON.parse(account.password_parameters), {N: 16384, r: 8, p: 5});
  assert.match(account.password_hash, /^[a-f0-9]{64}$/);
  assert.match(account.password_salt, /^[a-f0-9]{64}$/);
  assert.notEqual(account.password_hash, validPassword);
  const storedSession = db.sqlite.prepare('SELECT * FROM auth_sessions').get();
  assert.notEqual(storedSession.token_hash, result.sessionToken);
  assert.equal(storedSession.token_hash, createHash('sha256').update(result.sessionToken).digest('hex'));
  assert.equal(storedSession.expires_at - storedSession.created_at, SESSION_SECONDS * 1000);
  assert.deepEqual(await service.resolveUser(result.sessionToken), result.identity);
  assert.equal(JSON.stringify(result.user).includes('password'), false);
});

test('the same password produces different salts, hashes, opaque IDs, and session tokens', async t => {
  const {db, service} = fixture(t);
  const first = await service.register(signup('first@example.test'));
  const second = await service.register(signup('second@example.test'));
  const rows = db.sqlite.prepare('SELECT password_hash,password_salt FROM auth_accounts ORDER BY email').all();
  assert.notEqual(rows[0].password_hash, rows[1].password_hash);
  assert.notEqual(rows[0].password_salt, rows[1].password_salt);
  assert.notEqual(first.identity.userId, second.identity.userId);
  assert.notEqual(first.sessionToken, second.sessionToken);
});

test('login normalizes email, verifies the password, and creates a new token for the same stable account', async t => {
  const {service} = fixture(t);
  const first = await service.register(signup(' Member@Example.Test '));
  const next = await service.login({email: 'MEMBER@example.test', password: validPassword});
  assert.deepEqual(next.identity, first.identity);
  assert.equal(next.user.email, 'member@example.test');
  assert.notEqual(next.sessionToken, first.sessionToken);
  assert.deepEqual(await service.resolveUser(next.sessionToken), first.identity);
});

test('wrong passwords and unknown emails return the same generic credential error', async t => {
  const {service} = fixture(t);
  await service.register(signup());
  let knownError; let unknownError;
  try { await service.login({email: 'member@example.test', password: 'Incorrect password!'}); } catch (error) { knownError = error; }
  try { await service.login({email: 'unknown@example.test', password: 'Incorrect password!'}); } catch (error) { unknownError = error; }
  assert.ok(errorIs(401, 'invalid_credentials')(knownError));
  assert.equal(knownError.message, unknownError.message);
  assert.equal(knownError.code, unknownError.code);
});

test('duplicate signup cannot replace a credential or leave an orphan member/session', async t => {
  const {db, service} = fixture(t);
  const original = await service.register(signup());
  const hashBefore = db.sqlite.prepare('SELECT password_hash FROM auth_accounts').get().password_hash;
  await assert.rejects(() => service.register(signup('MEMBER@example.test', {password: 'A different password!'})), errorIs(409, 'registration_unavailable'));
  assert.equal(count(db, 'members'), 1);
  assert.equal(count(db, 'auth_accounts'), 1);
  assert.equal(count(db, 'auth_sessions'), 1);
  assert.equal(db.sqlite.prepare('SELECT password_hash FROM auth_accounts').get().password_hash, hashBefore);
  const login = await service.login({email: 'member@example.test', password: validPassword});
  assert.equal(login.identity.userId, original.identity.userId);
});

test('simultaneous signups for one email commit exactly one complete account', async t => {
  const {db, service} = fixture(t);
  const results = await Promise.allSettled([
    service.register(signup('race@example.test', {displayName: 'First Racer'})),
    service.register(signup('RACE@example.test', {displayName: 'Second Racer'})),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.ok(errorIs(409)(rejected.reason));
  assert.equal(count(db, 'auth_accounts'), 1);
  assert.equal(count(db, 'members'), 1);
  assert.equal(count(db, 'auth_sessions'), 1);
});

test('public registration cannot select identity, status, role, or claim an old admin by typed email', async t => {
  const {db, service} = fixture(t);
  const oldOwner = {userId: 'legacy-platform-owner', email: 'owner@example.test'};
  const membership = createMembershipService(db, {adminEmail: 'owner@example.test'});
  await membership.register(oldOwner, {displayName: 'Old Owner'});
  for (const extra of [{role: 'admin'}, {status: 'active'}, {userId: oldOwner.userId}, {id: oldOwner.userId}]) {
    await assert.rejects(() => service.register(signup('new@example.test', extra)), errorIs(400));
  }
  const typedSameEmail = await service.register(signup('owner@example.test'));
  assert.notEqual(typedSameEmail.identity.userId, oldOwner.userId);
  assert.equal(typedSameEmail.user.role, 'member');
  assert.equal(db.sqlite.prepare("SELECT value FROM app_settings WHERE key='admin_owner'").get().value, oldOwner.userId);
  await assert.rejects(() => membership.listMembers(typedSameEmail.identity, {}), errorIs(403));
  assert.equal((await service.login({email: 'owner@example.test', password: validPassword})).identity.userId, typedSameEmail.identity.userId);
});

test('session expiry is absolute, invalid tokens are anonymous, and logout immediately revokes only that token', async t => {
  const {db, service, advance} = fixture(t);
  const first = await service.register(signup());
  const second = await service.login({email: 'member@example.test', password: validPassword});
  for (const token of [undefined, null, '', 'forged', 'a'.repeat(63), 'a'.repeat(64), first.identity.userId]) {
    assert.equal(await service.resolveUser(token), null);
  }
  await service.logout(first.sessionToken);
  assert.equal(await service.resolveUser(first.sessionToken), null);
  assert.deepEqual(await service.resolveUser(second.sessionToken), first.identity);
  assert.equal(count(db, 'auth_sessions'), 1);
  await service.logout(null);
  advance(SESSION_SECONDS * 1000 - 1);
  assert.ok(await service.resolveUser(second.sessionToken));
  advance(1);
  assert.equal(await service.resolveUser(second.sessionToken), null);
});

test('suspension immediately disables existing sessions and password login', async t => {
  const {db, service} = fixture(t);
  const result = await service.register(signup());
  db.sqlite.prepare("UPDATE members SET status='suspended' WHERE id=?").run(result.identity.userId);
  assert.equal(await service.resolveUser(result.sessionToken), null);
  await assert.rejects(() => service.login({email: 'member@example.test', password: validPassword}), errorIs(401, 'invalid_credentials'));
});

test('persistent email login rate limits survive service recreation and reset after their window', async t => {
  const {db, service, advance} = fixture(t);
  for (let attempt = 0; attempt < 10; attempt++) {
    await assert.rejects(() => service.login({email: 'unknown@example.test', password: validPassword}), errorIs(401));
  }
  const storedKey = db.sqlite.prepare("SELECT bucket_key FROM auth_rate_limits WHERE bucket_key LIKE 'login:email:%'").get().bucket_key;
  assert.equal(storedKey.includes('unknown'), false);
  assert.equal(count(db, 'auth_rate_limits'), 2);
  await assert.rejects(() => service.login({email: 'UNKNOWN@example.test', password: validPassword}), errorIs(429, 'rate_limited'));
  // Different service instance, same persistence, fixed time.
  const sameClock = createEmailAuthService(db, {now: () => Date.UTC(2026, 9, 15, 12)});
  await assert.rejects(() => sameClock.login({email: 'unknown@example.test', password: validPassword}), errorIs(429));
  advance(15 * 60 * 1000);
  await assert.rejects(() => service.login({email: 'unknown@example.test', password: validPassword}), errorIs(401));
});

test('registration has a separate persisted limit and duplicates never acquire extra accounts', async t => {
  const {db, service} = fixture(t);
  await service.register(signup());
  for (let attempt = 0; attempt < 3; attempt++) {
    await assert.rejects(() => service.register(signup()), errorIs(409));
  }
  await assert.rejects(() => service.register(signup()), errorIs(429));
  assert.equal(count(db, 'members'), 1);
  assert.equal(count(db, 'auth_accounts'), 1);
});

test('rotating unknown addresses cannot bypass the global persistent login budget', async t => {
  const {db, service} = fixture(t);
  db.sqlite.prepare('INSERT INTO auth_rate_limits(bucket_key,reset_at,attempts) VALUES(?,?,?)').run('login:global', Date.UTC(2026, 9, 15, 12) + 60000, 120);
  await assert.rejects(() => service.login({email: 'rotated@example.test', password: validPassword}), errorIs(429, 'rate_limited'));
  assert.equal(db.sqlite.prepare("SELECT attempts FROM auth_rate_limits WHERE bucket_key='login:global'").get().attempts, 121);
  assert.equal(count(db, 'auth_sessions'), 0);
});

test('a failed first-session insert rolls back both credentials and the new member', async t => {
  const {db, service} = fixture(t);
  db.sqlite.exec("CREATE TRIGGER reject_new_session BEFORE INSERT ON auth_sessions BEGIN SELECT RAISE(ABORT, 'session storage failed'); END;");
  await assert.rejects(() => service.register(signup()), /session storage failed/);
  assert.equal(count(db, 'members'), 0);
  assert.equal(count(db, 'auth_accounts'), 0);
  assert.equal(count(db, 'auth_sessions'), 0);
});

test('password and email validation imposes bounded payloads without trimming or rewriting passwords', async t => {
  const {service} = fixture(t);
  for (const password of ['', 'a'.repeat(11), 'a'.repeat(129), null, 123456789012]) {
    assert.throws(() => validateSignup(signup('member@example.test', {password})), errorIs(400));
  }
  assert.equal(validateSignup(signup('boundary@example.test', {password: 'a'.repeat(12)})).password.length, 12);
  assert.equal(validateSignup(signup('boundary@example.test', {password: 'a'.repeat(128)})).password.length, 128);
  for (const email of ['member', 'a@b', 'a@@example.test', 'x\r\n@example.test', `${'a'.repeat(65)}@example.test`, null]) {
    assert.throws(() => normalizeEmail(email), errorIs(400));
  }
  for (const displayName of [' ', 'a', 'a'.repeat(41)]) {
    assert.throws(() => validateSignup(signup('member@example.test', {displayName})), errorIs(400));
  }
  const password = '  Keep these spaces!  ';
  await service.register(signup('spaces@example.test', {password}));
  await service.login({email: 'spaces@example.test', password});
  await assert.rejects(() => service.login({email: 'spaces@example.test', password: password.trim()}), errorIs(401));
});

test('cookie handling rejects duplicates and malformed values and keeps tokens HttpOnly, host-only, and Secure on HTTPS', () => {
  const token = 'b'.repeat(64);
  assert.equal(parseSessionCookie(`other=1; ${SESSION_COOKIE}=${token}`), token);
  for (const header of [null, '', `${SESSION_COOKIE}=bad`, `${SESSION_COOKIE}=${token}; ${SESSION_COOKIE}=${token}`, `${SESSION_COOKIE}=%61${token.slice(1)}`, `${SESSION_COOKIE}=${token}\r\nInjected: bad`]) {
    assert.equal(parseSessionCookie(header), null);
  }
  const https = sessionCookie(token, 'https://anime.example/api/auth/login');
  assert.match(https, /; HttpOnly; SameSite=Lax;/);
  assert.match(https, /; Secure$/);
  assert.match(https, /; Path=\//);
  assert.equal(https.includes('Domain='), false);
  const local = sessionCookie(token, 'http://localhost:5173/api/auth/login');
  assert.equal(local.includes('Secure'), false);
  assert.match(local, /HttpOnly/);
  assert.match(clearSessionCookie('https://anime.example'), /Max-Age=0;/);
  assert.match(clearSessionCookie('https://anime.example'), /Secure$/);
  assert.throws(() => sessionCookie('bad', 'https://anime.example'), TypeError);
});

test('database constraints preserve unique email credentials and session ownership', async t => {
  const {db, service} = fixture(t);
  await service.register(signup());
  assert.throws(() => db.sqlite.prepare('INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run('f'.repeat(64), 'not-a-member', 1, 2), /FOREIGN KEY constraint failed/);
  assert.throws(() => db.sqlite.prepare('INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run('bad', db.sqlite.prepare('SELECT user_id FROM auth_accounts').get().user_id, 1, 2), /CHECK constraint failed/);
});
