import {existsSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {RailwayD1Database} from '../lib/railway-runtime.mjs';
import {loadPushKeys} from '../lib/push-keys.mjs';
import {startPushScheduler} from '../lib/push-scheduler.mjs';

export function localPushDatabasePath(root, configured = process.env.PUSH_LOCAL_DB) {
  const directory = join(root, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  const paths = configured ? [configured] : existsSync(directory) ? readdirSync(directory).filter(name => name.endsWith('.sqlite') && name !== 'metadata.sqlite' && !name.endsWith('.metadata.sqlite')).map(name => join(directory, name)) : [];
  return paths.length === 1 && existsSync(paths[0]) ? paths[0] : null;
}

export function startLocalPushScheduler() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const config = loadPushKeys(join(root, '.sites-runtime/local-push-keys.json'));
  let database;
  const scheduler = startPushScheduler(() => {
    if (database) return database;
    const path = localPushDatabasePath(root);
    if (!path) return null;
    const candidate = new RailwayD1Database(path);
    const tables = candidate.database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('push_subscriptions','auth_sessions')").all();
    const columns = tables.length === 2 ? candidate.database.prepare('PRAGMA table_info(push_subscriptions)').all() : [];
    if (!columns.some(column => column.name === 'session_hash')) {candidate.database.close(); return null;}
    database = candidate;
    return database;
  }, config);
  let stopped = false;
  return () => {if (stopped) return; stopped = true; scheduler.stop(); database?.database.close();};
}
