import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { createMembershipService, MembershipError } from '../lib/membership.mjs';
import {
  MAX_AVATAR_BYTES, validateAvatarBytes, readAvatarUpload,
  avatarObjectKey, createAvatarService,
} from '../lib/avatar.mjs';

// Real one-pixel raster fixtures generated with Pillow; no network or image
// dependencies are needed to run these tests.
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN4UxQBAAQEAbeNTRuQAAAAAElFTkSuQmCC', 'base64'));
const JPEG = Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDUooorwT7g/9k=', 'base64'));
const WEBP = Uint8Array.from(Buffer.from('UklGRjoAAABXRUJQVlA4IC4AAADQAQCdASoBAAEAAUAmJaACdLoB+AADsAD+5zD/+LORiOzzf/XAfnAfnAfysAAA', 'base64'));

class SQLiteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys=ON');
    const directory = new URL('../drizzle/', import.meta.url);
    for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
      this.sqlite.exec(readFileSync(new URL(name, directory), 'utf8'));
    }
  }
  prepare(sql) {
    const statement = this.sqlite.prepare(sql);
    const bound = (values = []) => {
      const executeRun = () => {
        const result = statement.run(...values);
        return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      };
      return {
        bind(...parameters) { return bound(parameters); },
        async first(column) {
          const row = statement.get(...values);
          return row ? (column ? row[column] : { ...row }) : null;
        },
        async all() { return { success: true, results: statement.all(...values).map(row => ({ ...row })) }; },
        async run() { return executeRun(); },
        _executeRun: executeRun,
      };
    };
    return bound();
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const result = statements.map(statement => statement._executeRun());
      this.sqlite.exec('COMMIT');
      return result;
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
  close() { this.sqlite.close(); }
}

class FakeR2 {
  objects = new Map();
  calls = [];
  async put(key, bytes, options = {}) {
    const copy = new Uint8Array(await new Response(bytes).arrayBuffer());
    this.calls.push({ method: 'put', key, options: structuredClone(options), bytes: copy });
    this.objects.set(key, { bytes: copy, options: structuredClone(options) });
    return { key };
  }
  async get(key) {
    this.calls.push({ method: 'get', key });
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      body: new ReadableStream({ start(controller) { controller.enqueue(object.bytes.slice()); controller.close(); } }),
      httpMetadata: object.options.httpMetadata,
      size: object.bytes.length,
    };
  }
  async delete(key) {
    this.calls.push({ method: 'delete', key });
    this.objects.delete(key);
  }
}

const identity = (id, email = `${id}@example.test`) => ({ userId: id, email, displayName: id });
const owner = identity('owner', 'admin@example.test');

function fixture(t) {
  const db = new SQLiteD1();
  t.after(() => db.close());
  const bucket = new FakeR2();
  const options = { now: () => '2026-10-13T11:00:00.000Z' };
  return {
    db, bucket,
    membership: createMembershipService(db, { ...options, adminEmail: 'admin@example.test' }),
    avatars: createAvatarService(db, bucket, options),
  };
}

function uploadRequest(bytes = PNG, { type = 'image/png', origin = 'https://anime.example', method = 'POST', query = '', extraHeaders = {} } = {}) {
  const headers = { ...extraHeaders };
  if (origin !== null) headers.Origin = origin;
  if (type !== null) headers['Content-Type'] = type;
  return new Request(`https://anime.example/api/account/avatar${query}`, {
    method, headers, ...(method === 'GET' || method === 'HEAD' ? {} : { body: bytes }),
  });
}

const isError = status => error => error instanceof MembershipError && error.status === status;
const rejected = (operation, status) => assert.rejects(operation, isError(status));

test('real PNG, JPEG and WebP bytes retain the declared matching raster MIME', () => {
  for (const [bytes, type] of [[PNG, 'image/png'], [JPEG, 'image/jpeg'], [WEBP, 'image/webp']]) {
    const result = validateAvatarBytes(bytes, type);
    assert.equal(result.contentType, type);
    assert.deepEqual(new Uint8Array(result.bytes), bytes);
  }
});

test('claimed image MIME cannot disguise SVG, HTML or a different raster format', () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
  for (const [bytes, type] of [[PNG, 'image/jpeg'], [JPEG, 'image/png'], [WEBP, 'image/png'], [svg, 'image/png'], [svg, 'image/svg+xml'], [html, 'image/png'], [PNG, 'application/octet-stream'], [PNG, 'image/png.evil']]) {
    assert.throws(() => validateAvatarBytes(bytes, type), isError(415));
  }
});

test('truncated signatures and inconsistent raster headers are rejected', () => {
  const zeroWidthPng = PNG.slice(); new DataView(zeroWidthPng.buffer).setUint32(16, 0);
  const wrongRiffSize = WEBP.slice(); new DataView(wrongRiffSize.buffer).setUint32(4, 5000, true);
  const oversizedWebpChunk = WEBP.slice(); new DataView(oversizedWebpChunk.buffer).setUint32(16, 5000, true);
  const unknownWebpChunk = WEBP.slice(); unknownWebpChunk.set(new TextEncoder().encode('HTML'), 12);
  for (const [bytes, type] of [
    [PNG.slice(0, 8), 'image/png'], [PNG.slice(0, -12), 'image/png'], [zeroWidthPng, 'image/png'],
    [JPEG.slice(0, -2), 'image/jpeg'], [WEBP.slice(0, 12), 'image/webp'],
    [wrongRiffSize, 'image/webp'], [oversizedWebpChunk, 'image/webp'], [unknownWebpChunk, 'image/webp'],
  ]) assert.throws(() => validateAvatarBytes(bytes, type), isError(415));
});

test('empty uploads and uploads beyond the two MiB byte limit are refused', async () => {
  assert.equal(MAX_AVATAR_BYTES, 2 * 1024 * 1024);
  assert.throws(() => validateAvatarBytes(new Uint8Array(), 'image/png'), error => error instanceof MembershipError && [400, 415].includes(error.status));
  const bytes = new Uint8Array(MAX_AVATAR_BYTES + 1);
  bytes.set(PNG);
  assert.throws(() => validateAvatarBytes(bytes, 'image/png'), isError(413));
  await rejected(() => readAvatarUpload(uploadRequest(PNG, { extraHeaders: { 'Content-Length': String(MAX_AVATAR_BYTES + 1) } })), 413);
});

test('a valid PNG exactly at the two MiB boundary is accepted', async () => {
  // Add a valid ancillary tEXt chunk, with its CRC, before the original IEND.
  const chunk = Buffer.alloc(MAX_AVATAR_BYTES - PNG.length);
  const length = chunk.length - 12;
  chunk.writeUInt32BE(length, 0); chunk.write('tEXt', 4, 'ascii');
  chunk.fill(97, 8, chunk.length - 4); chunk.write('Comment\0', 8, 'ascii');
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  const bytes = Uint8Array.from(Buffer.concat([Buffer.from(PNG.subarray(0, -12)), chunk, Buffer.from(PNG.subarray(-12))]));
  assert.equal(bytes.length, MAX_AVATAR_BYTES);
  assert.equal(validateAvatarBytes(bytes, 'image/png').bytes.byteLength, MAX_AVATAR_BYTES);
  const result = await readAvatarUpload(uploadRequest(bytes, { extraHeaders: { 'Content-Length': String(MAX_AVATAR_BYTES) } }));
  assert.equal(result.bytes.byteLength, MAX_AVATAR_BYTES);
});

test('avatar upload validates POST and exact Origin before accepting bytes', async () => {
  for (const origin of [null, 'null', 'https://evil.example', 'https://anime.example.evil.example', 'http://anime.example']) {
    await rejected(() => readAvatarUpload(uploadRequest(PNG, { origin })), 403);
  }
  await rejected(() => readAvatarUpload(uploadRequest(PNG, { method: 'PUT' })), 405);
  const result = await readAvatarUpload(uploadRequest());
  assert.equal(result.contentType, 'image/png');
  assert.deepEqual(new Uint8Array(result.bytes), PNG);
});

test('the upload byte limit holds when Content-Length is absent or forged', async () => {
  const bytes = new Uint8Array(MAX_AVATAR_BYTES + 1);
  bytes.set(PNG);
  await rejected(() => readAvatarUpload(uploadRequest(bytes)), 413);
  await rejected(() => readAvatarUpload(uploadRequest(bytes, { extraHeaders: { 'Content-Length': '1' } })), 413);
  const body = new ReadableStream({ start(controller) { controller.enqueue(PNG); controller.enqueue(new Uint8Array(MAX_AVATAR_BYTES)); controller.close(); } });
  const request = new Request('https://anime.example/api/account/avatar', {
    method: 'POST', headers: { Origin: 'https://anime.example', 'Content-Type': 'image/png' }, body, duplex: 'half',
  });
  await rejected(() => readAvatarUpload(request), 413);
});

test('avatar object keys hash opaque identity IDs rather than exposing email or path components', async () => {
  const id = "../someone/avatar' OR 1=1 --";
  const key = await avatarObjectKey(id);
  assert.equal(key, `avatar/${createHash('sha256').update(id).digest('hex')}`);
  assert.equal(await avatarObjectKey(id), key);
  assert.notEqual(await avatarObjectKey('another-user'), key);
  assert.match(key, /^avatar\/[a-f0-9]{64}$/);
  assert.equal(key.includes(id), false);
});

test('registered members upload and read their own private raster avatar', async t => {
  const { db, bucket, membership, avatars } = fixture(t);
  const member = identity('avatar-member');
  await membership.register(member, { displayName: 'Avatar Member' });
  assert.equal(await avatars.url(member), null);
  const result = await avatars.upload(member, uploadRequest());
  assert.equal(typeof result.avatarUrl, 'string');
  assert.ok(result.avatarUrl.startsWith('/'));
  assert.equal(bucket.calls.length, 1);
  assert.ok(bucket.calls[0].key.startsWith(`${await avatarObjectKey(member.userId)}/`));
  assert.match(bucket.calls[0].key, /^avatar\/[a-f0-9]{64}\/[0-9a-f-]{36}$/);
  assert.deepEqual(bucket.calls[0].options.httpMetadata, { contentType: 'image/png', cacheControl: 'private, no-store' });
  const row = db.sqlite.prepare('SELECT * FROM member_avatars WHERE user_id = ?').get(member.userId);
  assert.equal(row.object_key, bucket.calls[0].key);
  assert.equal(row.content_type, 'image/png');
  assert.equal(await avatars.url(member), result.avatarUrl);
  const stored = await avatars.get(member);
  assert.equal(stored.contentType, 'image/png');
  assert.deepEqual(new Uint8Array(await new Response(stored.body).arrayBuffer()), PNG);
});

test('anonymous and unregistered visitors cannot modify or fetch R2 objects', async t => {
  const { bucket, avatars } = fixture(t);
  await rejected(() => avatars.upload(null, uploadRequest()), 401);
  await rejected(() => avatars.get(null), 401);
  const notRegistered = identity('not-registered');
  await rejected(() => avatars.upload(notRegistered, uploadRequest()), 403);
  await rejected(() => avatars.get(notRegistered), 403);
  assert.equal(bucket.calls.length, 0);
});

test('suspension blocks avatar access and upload before any R2 operation', async t => {
  const { bucket, membership, avatars } = fixture(t);
  const member = identity('suspended-avatar-member');
  await membership.register(owner, { displayName: 'Owner' });
  await membership.register(member, { displayName: 'Avatar Member' });
  await avatars.upload(member, uploadRequest());
  await membership.setMemberStatus(owner, member.userId, { status: 'suspended' });
  const callsBefore = bucket.calls.length;
  await rejected(() => avatars.upload(member, uploadRequest(JPEG, { type: 'image/jpeg' })), 403);
  await rejected(() => avatars.get(member), 403);
  assert.equal(bucket.calls.length, callsBefore);
});

test('client-selected IDs, filenames and keys cannot target another member avatar', async t => {
  const { db, bucket, membership, avatars } = fixture(t);
  const alice = identity('avatar-alice');
  const bob = identity('avatar-bob');
  await membership.register(alice, { displayName: 'Alice' });
  await membership.register(bob, { displayName: 'Bob' });
  await avatars.upload(bob, uploadRequest(JPEG, { type: 'image/jpeg' }));
  const bobKey = db.sqlite.prepare('SELECT object_key FROM member_avatars WHERE user_id = ?').get(bob.userId).object_key;
  await avatars.upload(alice, uploadRequest(PNG, { query: `?userId=${bob.userId}&key=${encodeURIComponent(bobKey)}&filename=../../bob.jpg` }));
  assert.ok(bucket.calls.at(-1).key.startsWith(`${await avatarObjectKey(alice.userId)}/`));
  assert.notEqual(bucket.calls.at(-1).key, bobKey);
  const result = await avatars.get(alice, { userId: bob.userId });
  assert.deepEqual(new Uint8Array(await new Response(result.body).arrayBuffer()), PNG);
  const bobAvatar = await avatars.get(bob);
  assert.deepEqual(new Uint8Array(await new Response(bobAvatar.body).arrayBuffer()), JPEG);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM member_avatars').get().count, 2);
});

test('bad MIME, bad Origin and oversized images leave existing avatar storage untouched', async t => {
  const { db, bucket, membership, avatars } = fixture(t);
  const member = identity('invalid-upload-member');
  await membership.register(member, { displayName: 'Member' });
  await avatars.upload(member, uploadRequest());
  const before = bucket.calls.length;
  await rejected(() => avatars.upload(member, uploadRequest(JPEG, { type: 'image/png' })), 415);
  await rejected(() => avatars.upload(member, uploadRequest(PNG, { origin: 'https://evil.example' })), 403);
  const bytes = new Uint8Array(MAX_AVATAR_BYTES + 1); bytes.set(PNG);
  await rejected(() => avatars.upload(member, uploadRequest(bytes)), 413);
  assert.equal(bucket.calls.length, before);
  assert.equal(db.sqlite.prepare('SELECT content_type FROM member_avatars WHERE user_id = ?').get(member.userId).content_type, 'image/png');
});

test('replacement uploads use a new revision and delete only the previous own object', async t => {
  const { db, bucket, membership, avatars } = fixture(t);
  const member = identity('replacing-member');
  await membership.register(member, { displayName: 'Member' });
  const first = await avatars.upload(member, uploadRequest());
  const firstKey = db.sqlite.prepare('SELECT object_key FROM member_avatars WHERE user_id = ?').get(member.userId).object_key;
  const second = await avatars.upload(member, uploadRequest(JPEG, { type: 'image/jpeg' }));
  const secondKey = db.sqlite.prepare('SELECT object_key FROM member_avatars WHERE user_id = ?').get(member.userId).object_key;
  assert.notEqual(firstKey, secondKey);
  assert.notEqual(first.avatarUrl, second.avatarUrl);
  assert.equal(bucket.objects.has(firstKey), false);
  assert.equal(bucket.objects.has(secondKey), true);
  assert.deepEqual(bucket.calls.filter(call => call.method === 'delete').map(call => call.key), [firstKey]);
  const result = await avatars.get(member);
  assert.equal(result.contentType, 'image/jpeg');
  assert.deepEqual(new Uint8Array(await new Response(result.body).arrayBuffer()), JPEG);
});

test('a tampered avatar pointer cannot read or delete another member object', async t => {
  const { db, bucket, membership, avatars } = fixture(t);
  const alice = identity('pointer-alice'); const bob = identity('pointer-bob');
  await membership.register(alice, { displayName: 'Alice' });
  await membership.register(bob, { displayName: 'Bob' });
  await avatars.upload(alice, uploadRequest());
  await avatars.upload(bob, uploadRequest(JPEG, { type: 'image/jpeg' }));
  const bobKey = db.sqlite.prepare('SELECT object_key FROM member_avatars WHERE user_id = ?').get(bob.userId).object_key;
  db.sqlite.prepare('UPDATE member_avatars SET object_key = ? WHERE user_id = ?').run(bobKey, alice.userId);
  const before = bucket.calls.length;
  assert.equal(await avatars.url(alice), null);
  await rejected(() => avatars.get(alice), 404);
  assert.equal(bucket.calls.length, before);
  await avatars.upload(alice, uploadRequest(WEBP, { type: 'image/webp' }));
  assert.equal(bucket.objects.has(bobKey), true);
  assert.equal(bucket.calls.some(call => call.method === 'delete' && call.key === bobKey), false);
});

test('a D1 failure removes the newly uploaded object and preserves the previous revision', async t => {
  const { db, bucket, membership, avatars } = fixture(t);
  const member = identity('db-failure-member');
  await membership.register(member, { displayName: 'Member' });
  await avatars.upload(member, uploadRequest());
  const previous = db.sqlite.prepare('SELECT * FROM member_avatars WHERE user_id = ?').get(member.userId);
  db.sqlite.exec("CREATE TRIGGER reject_avatar_write BEFORE UPDATE ON member_avatars BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END");
  const before = bucket.calls.length;
  await assert.rejects(() => avatars.upload(member, uploadRequest(JPEG, { type: 'image/jpeg' })), /fixture write failure/);
  const calls = bucket.calls.slice(before);
  assert.deepEqual(calls.map(call => call.method), ['put', 'delete']);
  assert.equal(calls[0].key, calls[1].key);
  assert.notEqual(calls[0].key, previous.object_key);
  assert.equal(bucket.objects.has(calls[0].key), false);
  assert.equal(bucket.objects.has(previous.object_key), true);
  assert.deepEqual({ ...db.sqlite.prepare('SELECT * FROM member_avatars WHERE user_id = ?').get(member.userId) }, { ...previous });
});

test('suspension during R2 upload prevents committing the new avatar pointer', async t => {
  const { db, bucket, membership, avatars } = fixture(t);
  const member = identity('racing-suspension-member');
  await membership.register(member, { displayName: 'Member' });
  await avatars.upload(member, uploadRequest());
  const previous = db.sqlite.prepare('SELECT * FROM member_avatars WHERE user_id = ?').get(member.userId);
  const ordinaryPut = bucket.put.bind(bucket);
  bucket.put = async (...args) => {
    const result = await ordinaryPut(...args);
    db.sqlite.prepare('UPDATE members SET status = ? WHERE id = ?').run('suspended', member.userId);
    return result;
  };
  const before = bucket.calls.length;
  await rejected(() => avatars.upload(member, uploadRequest(JPEG, { type: 'image/jpeg' })), 403);
  const calls = bucket.calls.slice(before);
  assert.deepEqual(calls.map(call => call.method), ['put', 'delete']);
  assert.equal(calls[0].key, calls[1].key);
  assert.equal(bucket.objects.has(calls[0].key), false);
  assert.equal(bucket.objects.has(previous.object_key), true);
  assert.equal(db.sqlite.prepare('SELECT object_key FROM member_avatars WHERE user_id = ?').get(member.userId).object_key, previous.object_key);
});

test('the avatar migration enforces member ownership, raster MIME and bounded key shape', async t => {
  const { db, membership } = fixture(t);
  const member = identity('avatar-schema-member');
  await membership.register(member, { displayName: 'Schema Member' });
  const key = `${await avatarObjectKey(member.userId)}/8ef661ce-4073-4a9b-8903-028b64bf2d31`;
  const insert = db.sqlite.prepare('INSERT INTO member_avatars(user_id,object_key,content_type) VALUES(?,?,?)');
  assert.throws(() => insert.run('not-a-member', key, 'image/png'), /FOREIGN KEY constraint failed/);
  assert.throws(() => insert.run(member.userId, key, 'image/svg+xml'), /CHECK constraint failed/);
  assert.throws(() => insert.run(member.userId, '../avatar.jpg', 'image/png'), /CHECK constraint failed/);
  insert.run(member.userId, key, 'image/png');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM member_avatars').get().count, 1);
});
