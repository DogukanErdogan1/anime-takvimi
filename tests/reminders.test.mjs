import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {broadcastMinute, dueReminders, notificationStorageKey, pruneDeliveryKeys, todayFollowed, turkeyClock} from '../components/experience/reminder-logic.ts';

const at = value => new Date(value);
const anime = (id, day, time, extra = {}) => ({id, title: id, day, time, airing: true, broadcastLocal: true, ...extra});

test('reminders use Istanbul local midnight instead of the host date', () => {
  assert.deepEqual(turkeyClock(at('2026-10-18T20:59:00Z')), {key: '2026-10-18', day: 6, minute: 1439});
  assert.deepEqual(turkeyClock(at('2026-10-18T21:00:00Z')), {key: '2026-10-19', day: 0, minute: 0});
});

test('only active, timezone-converted broadcasts with canonical times qualify', () => {
  assert.equal(broadcastMinute(anime('mal-1', 0, '00:00')), 0);
  assert.equal(broadcastMinute(anime('mal-1', 6, '23:59')), 1439);
  for (const item of [anime('x', 0, '10:00'), anime('mal-1', 0, '10:00', {airing: false}),
    anime('mal-1', 0, '10:00', {broadcastLocal: false}), anime('mal-1', 7, '10:00'),
    anime('mal-1', -1, '10:00'), anime('mal-1', 1.5, '10:00'),
    ...['9:00', '24:00', '09:60', ' 09:00', '09:00 ', null].map(time => anime('mal-1', 0, time))]) {
    assert.equal(broadcastMinute(item), null);
  }
});

test('today panel shows only followed real broadcasts in time order and dedupes source copies', () => {
  const result = todayFollowed([
    anime('mal-3', 0, '14:00'), anime('mal-2', 0, '09:00'), anime('mal-2', 0, '11:00'),
    anime('mal-1', 0, '08:00'), anime('mal-4', 1, '09:00'), anime('mal-5', 0, '10:00', {airing: false}),
  ], ['mal-2', 'mal-3', 'mal-4', 'mal-5'], at('2026-10-19T06:00:00Z'));
  assert.deepEqual(result.map(item => item.id), ['mal-2', 'mal-3']);
  assert.equal(result[0].time, '09:00');
});

test('delivery is opt-in per anime with a five-minute arrival window and no overdue flood', () => {
  const items = [anime('mal-1', 0, '09:00'), anime('mal-2', 0, '08:59'),
    anime('mal-3', 0, '09:05'), anime('mal-4', 0, '09:04'), anime('mal-5', 0, '06:00')];
  const now = at('2026-10-19T06:04:59Z');
  const due = dueReminders(items, ['mal-1', 'mal-2', 'mal-3', 'mal-5'], now);
  assert.deepEqual(due.map(entry => entry.item.id), ['mal-1']);
  assert.equal(due[0].key, '2026-10-19:mal-1');
  assert.equal(dueReminders(items, ['mal-1'], at('2026-10-19T06:05:00Z')).length, 0);
  assert.equal(dueReminders(items, [], now).length, 0);
});

test('fresh inactive or unknown-time data cannot be resurrected by an older saved anime copy', () => {
  const items = [anime('mal-1', 0, '09:00', {airing: false}), anime('mal-2', 0, null),
    anime('mal-1', 0, '09:00'), anime('mal-2', 0, '09:00')];
  const now = at('2026-10-19T06:01:00Z');
  assert.deepEqual(todayFollowed(items, ['mal-1', 'mal-2'], now), []);
  assert.deepEqual(dueReminders(items, ['mal-1', 'mal-2'], now), []);
});

test('delivery just after midnight retains the previous calendar date for deduplication', () => {
  const items = [anime('mal-1', 6, '23:59'), anime('mal-2', 0, '00:00')];
  const due = dueReminders(items, ['mal-1', 'mal-2'], at('2026-10-18T21:01:00Z'));
  assert.deepEqual(due.map(entry => entry.key), ['2026-10-18:mal-1', '2026-10-19:mal-2']);
  assert.deepEqual(dueReminders(items, ['mal-1'], at('2026-10-18T21:04:00Z')), []);
});

test('midnight delivery keys work across year and leap-day boundaries', () => {
  const newYear = dueReminders([anime('mal-1', 3, '23:59')], ['mal-1'], at('2026-12-31T21:01:00Z'));
  assert.equal(newYear[0].key, '2026-12-31:mal-1');
  const leap = dueReminders([anime('mal-1', 3, '23:59')], ['mal-1'], at('2024-02-29T21:01:00Z'));
  assert.equal(leap[0].key, '2024-02-29:mal-1');
});

test('notification preference and delivery storage are separate for each account and guests', () => {
  assert.notEqual(notificationStorageKey('alice'), notificationStorageKey('bob'));
  assert.notEqual(notificationStorageKey('alice'), notificationStorageKey(null));
  assert.notEqual(notificationStorageKey('a:b'), notificationStorageKey('a%3Ab'));
  assert.equal(notificationStorageKey(undefined), notificationStorageKey(null));
  assert.deepEqual(pruneDeliveryKeys(['2026-10-19:mal-1', '2026-10-19:mal-1', '2026-10-18:mal-2',
    '2026-10-17:mal-3', '2026-10-20:mal-4', '2026-10-19:bad'], at('2026-10-19T07:00:00Z')),
    ['2026-10-19:mal-1', '2026-10-18:mal-2']);
});

function workerHarness() {
  const handlers = {}, requests = [], stored = [], deleted = [];
  const cache = {put: async (key, value) => {stored.push({key, value});}, match: async () => null};
  const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  runInNewContext(source, {
    self: {location: {origin: 'https://anime.test'}, addEventListener: (name, listener) => {handlers[name] = listener;}, skipWaiting: async () => {}, clients: {claim: async () => {}}},
    caches: {open: async () => cache, keys: async () => ['anime-takvimi-public-icons-v0', 'some-other-cache'], delete: async name => {deleted.push(name);}},
    fetch: async request => {
      requests.push(request);
      if (request.mode === 'navigate') throw new Error('offline');
      return new Response('icon', {headers: {'Content-Type': 'image/png'}});
    },
    URL, Request, Response,
  });
  return {handlers, requests, stored, deleted};
}

test('service worker caches only the three fixed public icons with credentials omitted', async () => {
  const {handlers, requests, stored, deleted} = workerHarness();
  let work;
  handlers.install({waitUntil: value => {work = value;}}); await work;
  assert.deepEqual(stored.map(item => item.key).sort(), ['/favicon.svg', '/icon-192.png', '/icon-512.png']);
  assert.ok(requests.every(request => request.credentials === 'omit'));
  handlers.activate({waitUntil: value => {work = value;}}); await work;
  assert.deepEqual(deleted, ['anime-takvimi-public-icons-v0']);
});

test('service worker never intercepts API, foreign-origin, or write requests', () => {
  const {handlers, requests, stored} = workerHarness();
  for (const request of [
    {url: 'https://anime.test/api/account', method: 'GET', mode: 'navigate'},
    {url: 'https://anime.test/api/library', method: 'PUT'},
    {url: 'https://other.test/', method: 'GET', mode: 'navigate'},
  ]) handlers.fetch({request, respondWith: () => assert.fail('private/foreign request was intercepted')});
  assert.equal(requests.length, 0); assert.equal(stored.length, 0);
});

test('offline navigation returns a no-store page without caching any HTML', async () => {
  const {handlers, stored} = workerHarness(); let result;
  handlers.fetch({request: {url: 'https://anime.test/', method: 'GET', mode: 'navigate'}, respondWith: value => {result = value;}});
  const response = await result;
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.match(await response.text(), /internet bağlantını kontrol et/);
  assert.equal(stored.length, 0);
});

test('install manifest uses real generated brand icon files with correct PNG dimensions', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.display, 'standalone'); assert.equal(manifest.scope, '/');
  for (const size of [192, 512]) {
    const icon = manifest.icons.find(item => item.sizes === `${size}x${size}`);
    const bytes = readFileSync(new URL(`../public${icon.src}`, import.meta.url));
    assert.equal(bytes.readUInt32BE(16), size); assert.equal(bytes.readUInt32BE(20), size);
  }
});
