import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import {
  MembershipError, createMembershipService, validateLibrary,
  validateRegistration, validateStatusPatch, enforceMutation, readJsonMutation,
} from '../lib/membership.mjs';

// The adapter executes the service's actual parameterized SQL, including atomic
// D1 batches, rather than mocking query results or duplicating service behavior.
class SQLiteD1 {
  constructor(schema) {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys = ON;');
    this.sqlite.exec(schema);
  }
  prepare(sql) {
    const database = this.sqlite;
    const statement = database.prepare(sql);
    const create = (parameters = []) => {
      const executeRun = () => {
        const result = statement.run(...parameters);
        return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      };
      return {
      bind(...values) { return create(values); },
      async first(column) {
        const row = statement.get(...parameters);
        if (!row) return null;
        return column ? row[column] : { ...row };
      },
      async all() {
        return { success: true, results: statement.all(...parameters).map(row => ({ ...row })) };
      },
      async run() { return executeRun(); },
      _executeRun: executeRun,
      };
    };
    return create();
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN TRANSACTION;');
    try {
      const results = [];
      for (const statement of statements) results.push(statement._executeRun());
      this.sqlite.exec('COMMIT;');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK;');
      throw error;
    }
  }
  close() { this.sqlite.close(); }
}

const migrationDirectory = new URL('../drizzle/', import.meta.url);
const migrations = readdirSync(migrationDirectory).filter(name => name.endsWith('.sql')).sort();
// Prefer the deployment migrations once generated. This initial fixture matches
// db/schema.ts, including constraints, so early core QA has the same boundaries.
const SCHEMA = migrations.length ? migrations.map(name => readFileSync(new URL(name, migrationDirectory), 'utf8')).join('\n') : `
CREATE TABLE members (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT members_role_check CHECK(role IN ('admin','member')),
  CONSTRAINT members_status_check CHECK(status IN ('active','suspended')),
  CONSTRAINT members_name_check CHECK(length(display_name) BETWEEN 2 AND 40)
);
CREATE UNIQUE INDEX members_single_admin ON members(role) WHERE role = 'admin';
CREATE INDEX members_created_idx ON members(created_at,id);
CREATE INDEX members_email_idx ON members(email);
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  CONSTRAINT settings_key_check CHECK(key = 'admin_owner')
);
CREATE TABLE member_libraries (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES members(id),
  library_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT library_json_check CHECK(json_valid(library_json) AND length(library_json) <= 1048576)
);
CREATE TABLE admin_audit (
  id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL REFERENCES members(id),
  target_id TEXT NOT NULL REFERENCES members(id),
  action TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT audit_action_check CHECK(action = 'member_status'),
  CONSTRAINT audit_metadata_check CHECK(json_valid(metadata_json) AND length(metadata_json) <= 512)
);
CREATE INDEX audit_created_idx ON admin_audit(created_at);`;

const identity = (userId, email = `${userId}@example.test`) => ({ userId, email, displayName: userId });
const adminIdentity = identity('owner-identity', 'admin@example.test');

function fixture(t, options = {}) {
  const db = new SQLiteD1(SCHEMA);
  t.after(() => db.close());
  const service = createMembershipService(db, {
    adminEmail: 'admin@example.test',
    now: () => '2026-10-13T09:00:00.000Z',
    makeId: randomUUID,
    ...options,
  });
  return { db, service };
}

async function rejectsStatus(action, status) {
  await assert.rejects(action, error => error instanceof MembershipError && error.status === status);
}

function request(body = {}, { origin = 'https://anime.example', method = 'POST', type = 'application/json', extraHeaders = {} } = {}) {
  const headers = { ...extraHeaders };
  if (origin != null) headers.Origin = origin;
  if (type != null) headers['Content-Type'] = type;
  return new Request('https://anime.example/api/account/register', {
    method, headers, ...(method === 'GET' || method === 'HEAD' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}

function library(overrides = {}) {
  return { saved: ['mal-61987'], reminders: [], progress: { 'mal-61987': 3 }, view: 'grid', savedAnime: {
    'mal-61987': { id: 'mal-61987', title: 'The Apothecary Diaries Season 3' },
  }, ...overrides };
}

test('the first normal signup remains a member; only the configured verified email claims admin', async t => {
  const { db, service } = fixture(t);
  const first = identity('first-member');
  await service.register(first, { displayName: 'First Member' });
  assert.equal(db.sqlite.prepare('SELECT role FROM members WHERE id = ?').get(first.userId).role, 'member');
  assert.equal(db.sqlite.prepare('SELECT value FROM app_settings WHERE key = ?').get('admin_owner'), undefined);
  await rejectsStatus(() => service.listMembers(first, {}), 403);
  await service.register(adminIdentity, { displayName: 'Owner' });
  assert.equal(db.sqlite.prepare('SELECT role FROM members WHERE id = ?').get(adminIdentity.userId).role, 'admin');
  assert.equal(db.sqlite.prepare('SELECT value FROM app_settings WHERE key = ?').get('admin_owner').value, adminIdentity.userId);
  await service.listMembers(adminIdentity, {});
});

test('without a server-configured owner email signup never promotes the first visitor', async t => {
  const { db, service } = fixture(t, { adminEmail: '' });
  await service.register(adminIdentity, { displayName: 'Regular Member' });
  assert.equal(db.sqlite.prepare('SELECT role FROM members WHERE id = ?').get(adminIdentity.userId).role, 'member');
  await rejectsStatus(() => service.listMembers(adminIdentity, {}), 403);
});

test('once bound, owner authority follows stable identity ID and never transfers to another matching email', async t => {
  const { db, service } = fixture(t);
  await service.register(adminIdentity, { displayName: 'Owner' });
  const changedEmail = { ...adminIdentity, email: 'new-email@example.test' };
  await service.account(changedEmail);
  await service.listMembers(changedEmail, {});
  const duplicateEmail = identity('different-identity', 'admin@example.test');
  await service.register(duplicateEmail, { displayName: 'Different Identity' });
  await rejectsStatus(() => service.listMembers(duplicateEmail, {}), 403);
  const roles = db.sqlite.prepare('SELECT id FROM members WHERE role = ?').all('admin');
  assert.deepEqual(roles.map(row => row.id), [adminIdentity.userId]);
  assert.equal(db.sqlite.prepare('SELECT value FROM app_settings WHERE key = ?').get('admin_owner').value, adminIdentity.userId);
});

test('simultaneous eligible registrations leave exactly one owner', async t => {
  const { db, service } = fixture(t);
  await Promise.all([
    service.register(identity('eligible-a', 'admin@example.test'), { displayName: 'Eligible A' }),
    service.register(identity('eligible-b', 'admin@example.test'), { displayName: 'Eligible B' }),
  ]);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM app_settings WHERE key = ?').get('admin_owner').count, 1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM members WHERE role = ?').get('admin').count, 1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM members').get().count, 2);
});

test('signup rejects client-supplied identity, email, status and role fields', async t => {
  const { db, service } = fixture(t);
  const caller = identity('unprivileged');
  for (const extra of [{ role: 'admin' }, { email: 'admin@example.test' }, { userId: adminIdentity.userId }, { status: 'active' }]) {
    await rejectsStatus(() => service.register(caller, { displayName: 'Valid Name', ...extra }), 400);
  }
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM members').get().count, 0);
  for (const bad of [null, [], {}, { displayName: ' ' }, { displayName: 'A' }, { displayName: 'a'.repeat(41) }]) {
    assert.throws(() => validateRegistration(bad), error => error instanceof MembershipError && error.status === 400);
  }
});

test('member data and administration require a signed-in identity and an active registration', async t => {
  const { service } = fixture(t);
  for (const caller of [null, undefined]) {
    await rejectsStatus(() => service.register(caller, { displayName: 'Anonymous' }), 401);
    await rejectsStatus(() => service.getLibrary(caller), 401);
    await rejectsStatus(() => service.putLibrary(caller, { library: library() }), 401);
    await rejectsStatus(() => service.listMembers(caller, {}), 401);
  }
  const unregistered = identity('not-registered');
  await rejectsStatus(() => service.getLibrary(unregistered), 403);
  await rejectsStatus(() => service.putLibrary(unregistered, { library: library() }), 403);
  await rejectsStatus(() => service.listMembers(unregistered, {}), 403);
});

test('members cannot enumerate accounts or perform an administrative status change', async t => {
  const { service } = fixture(t);
  const member = identity('ordinary-member');
  await service.register(member, { displayName: 'Member' });
  await service.register(adminIdentity, { displayName: 'Owner' });
  await rejectsStatus(() => service.listMembers(member, {}), 403);
  await rejectsStatus(() => service.setMemberStatus(member, adminIdentity.userId, { status: 'suspended' }), 403);
});

test('an administrator cannot suspend the owner or themselves', async t => {
  const { db, service } = fixture(t);
  await service.register(adminIdentity, { displayName: 'Owner' });
  await rejectsStatus(() => service.setMemberStatus(adminIdentity, adminIdentity.userId, { status: 'suspended' }), 403);
  assert.equal(db.sqlite.prepare('SELECT status FROM members WHERE id = ?').get(adminIdentity.userId).status, 'active');
});

test('suspension blocks protected data immediately and reactivation restores access', async t => {
  const { db, service } = fixture(t);
  const member = identity('suspend-target');
  await service.register(adminIdentity, { displayName: 'Owner' });
  await service.register(member, { displayName: 'Target Member' });
  await service.putLibrary(member, { library: library() });
  await service.setMemberStatus(adminIdentity, member.userId, { status: 'suspended' });
  await rejectsStatus(() => service.getLibrary(member), 403);
  await rejectsStatus(() => service.putLibrary(member, { library: library() }), 403);
  await rejectsStatus(() => service.listMembers(member, {}), 403);
  await rejectsStatus(() => service.register(member, { displayName: 'Attempted Reactivation' }), 403);
  await service.setMemberStatus(adminIdentity, member.userId, { status: 'active' });
  await service.getLibrary(member);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM admin_audit').get().count, 2);
});

test('status changes accept only the explicit active/suspended operation', async () => {
  for (const payload of [null, [], {}, { status: 'admin' }, { status: 'active', role: 'admin' }, { status: 'suspended', email: 'forged@example.test' }]) {
    assert.throws(() => validateStatusPatch(payload), error => error instanceof MembershipError && error.status === 400);
  }
});

test('library validation rejects malformed values and client-selected account IDs', () => {
  for (const input of [null, [], {}, { library: [] }, { library: library(), userId: 'another-user' }, { library: { ...library(), role: 'admin' } }]) {
    assert.throws(() => validateLibrary(input), error => error instanceof MembershipError && error.status === 400);
  }
  for (const progress of [{ 'mal-61987': -1 }, { 'mal-61987': 10000 }, { 'mal-61987': 1.2 }, { 'mal-61987': '12' }]) {
    assert.throws(() => validateLibrary({ library: library({ progress }) }), error => error instanceof MembershipError && error.status === 400);
  }
  assert.throws(() => validateLibrary({ library: library({ saved: ['../other-user'] }) }), error => error instanceof MembershipError && error.status === 400);
  assert.throws(() => validateLibrary({ library: library({ saved: ['invented-anime-slug'] }) }), error => error instanceof MembershipError && error.status === 400);
});

test('metadata cannot store arbitrary, credential-bearing, or insecure image and MAL URLs', () => {
  for (const image of [
    'javascript:alert(1)', 'data:image/png;base64,AAAA',
    'http://cdn.myanimelist.net/images/anime/1/1.jpg',
    'https://cdn.myanimelist.net.evil.example/poster.jpg',
    'https://user:password@cdn.myanimelist.net/poster.jpg',
  ]) {
    const savedAnime = { 'mal-61987': { id: 'mal-61987', title: 'Unsafe metadata', image } };
    assert.throws(() => validateLibrary({ library: library({ savedAnime }) }), error => error instanceof MembershipError && error.status === 400);
  }
  for (const malUrl of ['javascript:alert(1)', 'https://evil.example/anime/61987', 'http://myanimelist.net/anime/61987']) {
    const savedAnime = { 'mal-61987': { id: 'mal-61987', title: 'Unsafe metadata', malUrl } };
    assert.throws(() => validateLibrary({ library: library({ savedAnime }) }), error => error instanceof MembershipError && error.status === 400);
  }
  assert.doesNotThrow(() => validateLibrary({ library: library({ savedAnime: {
    'mal-61987': { id: 'mal-61987', title: 'Safe metadata', image: 'https://cdn.myanimelist.net/images/anime/1028/160277l.webp', malUrl: 'https://myanimelist.net/anime/61987' },
  } }) }));
});

test('oversized libraries and oversized metadata are refused before database storage', async t => {
  const { db, service } = fixture(t);
  const member = identity('size-test-member');
  await service.register(member, { displayName: 'Size Test Member' });
  const oversized = library({ saved: Array.from({ length: 501 }, (_, i) => `mal-${i + 1}`), progress: {}, savedAnime: {} });
  await rejectsStatus(() => service.putLibrary(member, { library: oversized }), 400);
  const oversizedMetadata = library({ savedAnime: { 'mal-61987': { id: 'mal-61987', title: 'a'.repeat(10000) } } });
  await rejectsStatus(() => service.putLibrary(member, { library: oversizedMetadata }), 400);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM member_libraries').get().count, 0);
  await rejectsStatus(() => readJsonMutation(request({ value: 'a'.repeat(1024 * 1024) })), 413);
});

test('the 500-anime boundary counts the union of every library collection', () => {
  const saved = Array.from({ length: 250 }, (_, i) => `mal-${i + 1}`);
  const reminders = Array.from({ length: 250 }, (_, i) => `mal-${i + 251}`);
  const boundary = library({ saved, reminders, progress: {}, savedAnime: {} });
  const accepted = validateLibrary({ library: boundary });
  assert.equal(accepted.saved.length + accepted.reminders.length, 500);
  assert.throws(() => validateLibrary({ library: { ...boundary, reminders: [...reminders, 'mal-501'] } }), error => error instanceof MembershipError && error.status === 400);
});

test('even individually valid metadata cannot bypass the one MiB logical library limit', () => {
  const savedAnime = Object.fromEntries(Array.from({ length: 150 }, (_, i) => {
    const id = `mal-${i + 1}`;
    return [id, { id, title: `Title ${i + 1}`, summary: 'a'.repeat(8000) }];
  }));
  const payload = { library: library({ saved: Object.keys(savedAnime), progress: {}, savedAnime }) };
  assert.ok(Buffer.byteLength(JSON.stringify(payload)) > 1024 * 1024);
  assert.throws(() => validateLibrary(payload), error => error instanceof MembershipError && error.status === 413);
});

test('SQL metacharacters in trusted opaque IDs, display names and admin search are inert', async t => {
  const { db, service } = fixture(t);
  await service.register(adminIdentity, { displayName: 'Owner' });
  const hostileName = "Name'); DROP TABLE members;--";
  const opaqueId = identity("member' OR '1'='1", 'opaque@example.test');
  await service.register(opaqueId, { displayName: hostileName });
  await service.putLibrary(opaqueId, { library: library() });
  assert.equal(db.sqlite.prepare('SELECT display_name FROM members WHERE id = ?').get(opaqueId.userId).display_name, hostileName);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM members').get().count, 2);
  const result = await service.listMembers(adminIdentity, { q: "no-match' OR 1=1 --", page: 1 });
  assert.equal(JSON.stringify(result).includes('opaque@example.test'), false);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM members').get().count, 2);
  assert.equal(db.sqlite.prepare('SELECT user_id FROM member_libraries').get().user_id, opaqueId.userId);
});

test('a caller-selected ID cannot read or overwrite another member library', async t => {
  const { db, service } = fixture(t);
  const alice = identity('alice');
  const bob = identity('bob');
  await service.register(alice, { displayName: 'Alice' });
  await service.register(bob, { displayName: 'Bob' });
  const aliceLibrary = library();
  const bobLibrary = library({ saved: ['mal-999'], progress: { 'mal-999': 7 }, savedAnime: {
    'mal-999': { id: 'mal-999', title: 'Bob Private Choice' },
  } });
  await service.putLibrary(alice, { library: aliceLibrary });
  await service.putLibrary(bob, { library: bobLibrary });
  const result = await service.getLibrary(alice, { userId: bob.userId });
  assert.deepEqual(result.library, aliceLibrary);
  assert.equal(JSON.stringify(result).includes('Bob Private Choice'), false);
  await rejectsStatus(() => service.putLibrary(alice, { userId: bob.userId, library: aliceLibrary }), 400);
  assert.deepEqual((await service.getLibrary(bob)).library, bobLibrary);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM member_libraries').get().count, 2);
});

test('metadata keys cannot mutate prototypes or silently lose stored progress', () => {
  const payload = JSON.parse('{"library":{"saved":["__proto__"],"reminders":[],"progress":{"__proto__":1},"view":"grid","savedAnime":{"__proto__":{"id":"__proto__","title":"Reserved-key snapshot"}}}}');
  let result;
  try { result = validateLibrary(payload); }
  catch (error) {
    assert.ok(error instanceof MembershipError && error.status === 400);
    return; // Refusing reserved identifiers is also safe.
  }
  assert.ok(Object.getPrototypeOf(result.savedAnime) === Object.prototype || Object.getPrototypeOf(result.savedAnime) === null);
  assert.ok(Object.hasOwn(result.savedAnime, '__proto__'));
  assert.ok(Object.hasOwn(result.progress, '__proto__'));
  assert.equal(result.progress.__proto__, 1);
  const stored = JSON.parse(JSON.stringify(result));
  assert.equal(stored.savedAnime.__proto__.title, 'Reserved-key snapshot');
  assert.equal(stored.progress.__proto__, 1);
});

test('the database enforces one admin, and a role flag alone cannot grant owner rights', async t => {
  const { db, service } = fixture(t);
  const legacyAdmin = identity('legacy-admin');
  await service.register(adminIdentity, { displayName: 'Owner' });
  await service.register(legacyAdmin, { displayName: 'Legacy Admin' });
  assert.throws(() => db.sqlite.prepare('UPDATE members SET role = ? WHERE id = ?').run('admin', legacyAdmin.userId), /UNIQUE constraint failed/);
  await rejectsStatus(() => service.listMembers(legacyAdmin, {}), 403);
  // Simulate a legacy/tampered role while preserving the DB singleton invariant:
  // permission must still derive from the bound stable owner ID.
  db.sqlite.prepare('UPDATE members SET role = ? WHERE id = ?').run('member', adminIdentity.userId);
  db.sqlite.prepare('UPDATE members SET role = ? WHERE id = ?').run('admin', legacyAdmin.userId);
  await rejectsStatus(() => service.listMembers(legacyAdmin, {}), 403);
  db.sqlite.prepare('UPDATE members SET role = ? WHERE id = ?').run('member', legacyAdmin.userId);
  db.sqlite.prepare('UPDATE members SET role = ? WHERE id = ?').run('admin', adminIdentity.userId);
  db.sqlite.prepare('UPDATE members SET status = ? WHERE id = ?').run('suspended', adminIdentity.userId);
  await rejectsStatus(() => service.listMembers(adminIdentity, {}), 403);
});

test('mutation guard rejects a missing, null, foreign, or downgraded Origin', async () => {
  for (const origin of [null, 'null', 'https://evil.example', 'https://anime.example.evil.example', 'http://anime.example']) {
    await rejectsStatus(async () => enforceMutation(request({}, { origin })), 403);
  }
  await enforceMutation(request());
});

test('mutation guard accepts the public origin forwarded by Railway and rejects mismatched forwarded origins', async () => {
  const publicOrigin = 'https://anime.example';
  const proxiedRequest = headers => new Request('http://internal:8080/api/auth/register', {
    method: 'POST',
    headers: {'Origin': publicOrigin, 'Content-Type': 'application/json', ...headers},
    body: '{}',
  });
  await enforceMutation(proxiedRequest({'X-Forwarded-Host': 'anime.example', 'X-Forwarded-Proto': 'https'}));
  await rejectsStatus(async () => enforceMutation(proxiedRequest({'X-Forwarded-Host': 'other.example', 'X-Forwarded-Proto': 'https'})), 403);
  await rejectsStatus(async () => enforceMutation(proxiedRequest({'X-Forwarded-Host': 'anime.example', 'X-Forwarded-Proto': 'http'})), 403);
});

test('mutation guard requires a write method and genuine JSON Content-Type', async () => {
  await rejectsStatus(async () => enforceMutation(request({}, { method: 'GET' })), 405);
  for (const type of [null, 'text/plain', 'application/x-www-form-urlencoded', 'application/jsonp', 'application/json.evil']) {
    await rejectsStatus(async () => enforceMutation(request({}, { type })), 415);
  }
  const parsed = await readJsonMutation(request({ displayName: 'Valid Member' }, { type: 'application/json; charset=utf-8' }));
  assert.deepEqual(parsed, { displayName: 'Valid Member' });
});

test('JSON mutation reader rejects malformed JSON and oversized advertised bodies', async () => {
  await rejectsStatus(() => readJsonMutation(request('{broken')), 400);
  await rejectsStatus(() => readJsonMutation(request('{}', { extraHeaders: { 'Content-Length': '1000' } }), 64), 413);
});

test('JSON mutation reader measures actual UTF-8 bytes even when length is absent or forged', async () => {
  const body = JSON.stringify({ value: '💚'.repeat(20) });
  assert.ok(body.length < 64);
  assert.ok(Buffer.byteLength(body) > 64);
  await rejectsStatus(() => readJsonMutation(request(body), 64), 413);
  await rejectsStatus(() => readJsonMutation(request(body, { extraHeaders: { 'Content-Length': '1' } }), 64), 413);
});

test('streamed JSON is bounded without relying on a Content-Length header', async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('{"value":"'));
      controller.enqueue(encoder.encode('a'.repeat(64)));
      controller.enqueue(encoder.encode('"}'));
      controller.close();
    },
  });
  const req = new Request('https://anime.example/api/account/library', {
    method: 'PUT', headers: { Origin: 'https://anime.example', 'Content-Type': 'application/json' }, body, duplex: 'half',
  });
  await rejectsStatus(() => readJsonMutation(req, 64), 413);
});

