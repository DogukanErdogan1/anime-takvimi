import { DatabaseSync } from "node:sqlite";
import { createReadStream, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const migrationsDirectory = join(projectRoot, "drizzle");

export function railwayDataDirectory() {
  const configured = process.env.ANIME_DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH;
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("Attach a Railway volume and set RAILWAY_VOLUME_MOUNT_PATH before starting the app.");
  }
  return resolve(configured || join(projectRoot, ".anime-data"));
}

function openDatabase(databasePath) {
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
  return database;
}

export function migrateRailwayDatabase() {
  const root = railwayDataDirectory();
  const databasePath = join(root, "anime-takvimi.sqlite");
  const database = openDatabase(databasePath);
  try {
    database.exec("CREATE TABLE IF NOT EXISTS _anime_schema_migrations (name TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    const applied = database.prepare("SELECT name FROM _anime_schema_migrations");
    const seen = new Set(applied.all().map(row => row.name));
    const files = readdirSync(migrationsDirectory).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
    for (const name of files) {
      if (seen.has(name)) continue;
      const sql = readFileSync(join(migrationsDirectory, name), "utf8");
      database.exec("BEGIN IMMEDIATE");
      try {
        database.exec(sql);
        database.prepare("INSERT INTO _anime_schema_migrations(name) VALUES (?)").run(name);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw new Error(`Could not apply database migration ${name}: ${error.message}`, { cause: error });
      }
    }
  } finally {
    database.close();
  }
  return { dataDirectory: root, databasePath };
}

function bindValue(value) {
  if (typeof value === "undefined") return null;
  if (typeof value === "boolean") return Number(value);
  return value;
}

class RailwayStatement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values.map(bindValue);
  }

  bind(...values) {
    return new RailwayStatement(this.database, this.sql, values);
  }

  run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return {
      success: true,
      meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
    };
  }

  all() {
    const results = this.database.prepare(this.sql).all(...this.values);
    return { success: true, results, meta: { changes: results.length } };
  }

  first(columnName) {
    const row = this.database.prepare(this.sql).get(...this.values) ?? null;
    return columnName && row ? (row[columnName] ?? null) : row;
  }

  runInBatch() {
    const statement = this.database.prepare(this.sql);
    if (statement.columns().length > 0) {
      const results = statement.all(...this.values);
      return { success: true, results, meta: { changes: results.length } };
    }
    const result = statement.run(...this.values);
    return {
      success: true,
      meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
    };
  }
}

class RailwayD1Database {
  constructor(databasePath) {
    this.database = openDatabase(databasePath);
  }

  prepare(sql) {
    return new RailwayStatement(this.database, sql);
  }

  batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map(statement => {
        if (!(statement instanceof RailwayStatement) || statement.database !== this.database) {
          throw new TypeError("A database batch can only contain statements from this database.");
        }
        return statement.runInBatch();
      });
      this.database.exec("COMMIT");
      return Promise.resolve(results);
    } catch (error) {
      this.database.exec("ROLLBACK");
      return Promise.reject(error);
    }
  }

  exec(sql) {
    this.database.exec(sql);
  }
}

function getRuntimeSingleton(key, create) {
  const symbol = Symbol.for(key);
  if (!globalThis[symbol]) globalThis[symbol] = create();
  return globalThis[symbol];
}

function getDatabase() {
  const path = join(railwayDataDirectory(), "anime-takvimi.sqlite");
  return getRuntimeSingleton("anime-takvimi.railway.d1", () => new RailwayD1Database(path));
}

function safeObjectPath(root, key) {
  if (typeof key !== "string" || key.length < 1 || key.length > 512) throw new TypeError("Invalid object key.");
  const segments = key.split("/");
  if (segments.some(segment => !/^[A-Za-z0-9._-]+$/.test(segment) || segment === "." || segment === "..")) {
    throw new TypeError("Invalid object key.");
  }
  const base = resolve(root);
  const path = resolve(base, ...segments);
  if (path === base || !path.startsWith(`${base}${sep}`)) throw new TypeError("Invalid object key.");
  return path;
}

async function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value?.arrayBuffer === "function") return Buffer.from(await value.arrayBuffer());
  if (typeof ReadableStream !== "undefined" && value instanceof ReadableStream) {
    return Buffer.from(await new Response(value).arrayBuffer());
  }
  throw new TypeError("Unsupported object body.");
}

class RailwayBucket {
  constructor(directory) {
    this.directory = directory;
  }

  async put(key, value, options = {}) {
    const path = safeObjectPath(this.directory, key);
    mkdirSync(dirname(path), { recursive: true });
    const bytes = await asBuffer(value);
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporaryPath, bytes);
    renameSync(temporaryPath, path);
    const metadata = {
      contentType: options.httpMetadata?.contentType || "application/octet-stream",
      cacheControl: options.httpMetadata?.cacheControl || null,
    };
    const metadataPath = `${path}.metadata.json`;
    const temporaryMetadataPath = `${metadataPath}.${randomUUID()}.tmp`;
    writeFileSync(temporaryMetadataPath, JSON.stringify(metadata));
    renameSync(temporaryMetadataPath, metadataPath);
    return { key, size: bytes.byteLength };
  }

  async get(key) {
    const path = safeObjectPath(this.directory, key);
    try {
      const metadata = JSON.parse(readFileSync(`${path}.metadata.json`, "utf8"));
      return {
        body: Readable.toWeb(createReadStream(path)),
        httpMetadata: { contentType: metadata.contentType, cacheControl: metadata.cacheControl || undefined },
      };
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key) {
    const path = safeObjectPath(this.directory, key);
    rmSync(path, { force: true });
    rmSync(`${path}.metadata.json`, { force: true });
  }
}

function getBucket() {
  const directory = join(railwayDataDirectory(), "objects");
  return getRuntimeSingleton("anime-takvimi.railway.r2", () => new RailwayBucket(directory));
}

export const railwayWorkersEnv = new Proxy(Object.create(null), {
  get(_target, key) {
    if (key === "DB") return getDatabase();
    if (key === "BUCKET") return getBucket();
    if (typeof key === "string") return process.env[key];
    return undefined;
  },
});

