import { mkdirSync, existsSync, unlinkSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";
import { loadConfig } from "../config.js";

const _dbMap = new Map<string, DB>();
const _cleanedPaths = new Set<string>();

/**
 * Remove stale SQLite WAL/SHM sidecar files left by a crashed or killed process.
 * Safe to call before opening the DB: if a live process is holding them, the
 * unlink will fail (or the WAL is valid) and we keep the files. If the files
 * are truly orphaned (the prior process is gone), removing them prevents the
 * new connection from blocking on a locked journal.
 */
function cleanupStaleWalFiles(dbPath: string): void {
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = dbPath + suffix;
    try {
      if (existsSync(sidecar)) {
        const st = statSync(sidecar);
        if (st.isFile() && st.size === 0) {
          unlinkSync(sidecar);
        }
      }
    } catch {
      // Best effort. A live process holding the file → we leave it alone.
    }
  }
}

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

  // Only attempt the WAL/SHM cleanup once per process per DB path.
  if (!_cleanedPaths.has(dbPath)) {
    cleanupStaleWalFiles(dbPath);
    _cleanedPaths.add(dbPath);
  }

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
