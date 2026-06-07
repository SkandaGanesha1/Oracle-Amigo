import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";
import { loadConfig } from "../config.js";

const _dbMap = new Map<string, DB>();

export function resolveDbPath(path?: string): string {
  const cfg = loadConfig();
  const raw = path ?? cfg.CONTROL_PLANE_DB_PATH;
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

export function getDb(path?: string): DB {
  const dbPath = resolveDbPath(path);
  const existing = _dbMap.get(dbPath);
  if (existing) return existing;

  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  _dbMap.set(dbPath, db);
  return db;
}

export function closeAll(): void {
  for (const db of _dbMap.values()) {
    try { db.close(); } catch { /* ignore */ }
  }
  _dbMap.clear();
}

export function _resetForTest(path?: string): void {
  if (path) {
    const db = _dbMap.get(resolveDbPath(path));
    if (db) { try { db.close(); } catch { /* ignore */ } _dbMap.delete(resolveDbPath(path)); }
  } else {
    closeAll();
  }
}
