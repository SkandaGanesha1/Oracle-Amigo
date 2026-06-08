import { mkdirSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getLoadablePath } from "sqlite-vec";
import { migrate } from "./migrate.js";

const _dbMap = new Map<string, DatabaseSync>();

export const VEC_DIMENSIONS = 384;

export function resolveDbPath(): string {
  if (process.env.AGENTIC_DB_PATH) return process.env.AGENTIC_DB_PATH;
  const base =
    process.platform === "win32" && process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "AgenticApp")
      : join(homedir(), ".agentic-app");
  return join(base, "oracle-amigo.db");
}

/**
 * Local-agent tenant identity.
 * For single-user local agent, tenant = OS user, agent = device's local agent.
 * For multi-tenant cloud/relay, this would be a workspace/team ID.
 */
export function resolveLocalTenantId(): string {
  if (process.env.AGENTIC_TENANT_ID) return process.env.AGENTIC_TENANT_ID;
  try {
    return userInfo().username || "default";
  } catch {
    return "default";
  }
}

export function resolveLocalAgentId(): string {
  if (process.env.AGENTIC_AGENT_ID) return process.env.AGENTIC_AGENT_ID;
  return "local-agent";
}

export function getDb(path?: string): DatabaseSync {
  const dbPath = path ?? resolveDbPath();
  const existing = _dbMap.get(dbPath);
  if (existing) return existing;

  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath, {
    allowExtension: true,
    enableForeignKeyConstraints: true,
  });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.loadExtension(getLoadablePath());

  // Migrate vec0 tables before running schema migrations to add partition keys.
  migrateVec0Tables(db);

  migrate(db);
  _dbMap.set(dbPath, db);
  return db;
}

/**
 * Migrate vec0 virtual tables to add multi-tenant partition keys + auxiliary columns.
 * vec0 schemas are immutable, so we drop+recreate. For new DBs (no tables), this is a no-op.
 */
function migrateVec0Tables(db: DatabaseSync): void {
  const existing = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('file_embeddings','memory_embeddings','episodic_embeddings')`,
    )
    .all() as Array<{ name: string }>;
  if (existing.length === 0) {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS file_embeddings
        USING vec0(
          tenant_id TEXT PARTITION KEY,
          agent_id TEXT PARTITION KEY,
          source_type TEXT,
          namespace TEXT,
          embedding FLOAT[384]
        );
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_embeddings
        USING vec0(
          tenant_id TEXT PARTITION KEY,
          agent_id TEXT PARTITION KEY,
          memory_type TEXT,
          namespace TEXT,
          embedding FLOAT[384]
        );
      CREATE VIRTUAL TABLE IF NOT EXISTS episodic_embeddings
        USING vec0(
          tenant_id TEXT PARTITION KEY,
          agent_id TEXT PARTITION KEY,
          task_id TEXT,
          embedding FLOAT[384]
        );
    `);
    return;
  }
  const needsMigration = existing.some((t) => {
    const sql = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`)
      .get(t.name) as { sql: string } | undefined;
    if (!sql?.sql) return false;
    return !sql.sql.includes("PARTITION KEY");
  });
  if (!needsMigration) return;
  db.exec("BEGIN");
  try {
    for (const tableName of existing.map((t) => t.name)) {
      const staging = `${tableName}_staging`;
      const metaCols =
        tableName === "file_embeddings"
          ? "rowid INTEGER PRIMARY KEY, tenant_id TEXT, agent_id TEXT, source_type TEXT, namespace TEXT, embedding BLOB"
          : tableName === "memory_embeddings"
            ? "rowid INTEGER PRIMARY KEY, tenant_id TEXT, agent_id TEXT, memory_type TEXT, namespace TEXT, embedding BLOB"
            : "rowid INTEGER PRIMARY KEY, tenant_id TEXT, agent_id TEXT, task_id TEXT, embedding BLOB";
      const vecCols =
        tableName === "file_embeddings"
          ? "tenant_id TEXT PARTITION KEY, agent_id TEXT PARTITION KEY, source_type TEXT, namespace TEXT, embedding FLOAT[384]"
          : tableName === "memory_embeddings"
            ? "tenant_id TEXT PARTITION KEY, agent_id TEXT PARTITION KEY, memory_type TEXT, namespace TEXT, embedding FLOAT[384]"
            : "tenant_id TEXT PARTITION KEY, agent_id TEXT PARTITION KEY, task_id TEXT, embedding FLOAT[384]";
      db.exec(`CREATE TABLE ${staging} (${metaCols})`);
      if (tableName === "file_embeddings") {
        db.exec(`INSERT INTO ${staging}(rowid, tenant_id, agent_id, source_type, namespace, embedding)
          SELECT rowid, 'default', 'default', 'file', 'default', embedding FROM ${tableName}`);
      } else if (tableName === "memory_embeddings") {
        db.exec(`INSERT INTO ${staging}(rowid, tenant_id, agent_id, memory_type, namespace, embedding)
          SELECT rowid, 'default', 'default', 'memory', 'default', embedding FROM ${tableName}`);
      } else {
        db.exec(`INSERT INTO ${staging}(rowid, tenant_id, agent_id, task_id, embedding)
          SELECT rowid, 'default', 'default', '', embedding FROM ${tableName}`);
      }
      db.exec(`DROP TABLE ${tableName}`);
      db.exec(`CREATE VIRTUAL TABLE ${tableName} USING vec0(${vecCols})`);
      if (tableName === "file_embeddings") {
        db.exec(`INSERT INTO ${tableName}(rowid, tenant_id, agent_id, source_type, namespace, embedding)
          SELECT rowid, tenant_id, agent_id, source_type, namespace, embedding FROM ${staging}`);
      } else if (tableName === "memory_embeddings") {
        db.exec(`INSERT INTO ${tableName}(rowid, tenant_id, agent_id, memory_type, namespace, embedding)
          SELECT rowid, tenant_id, agent_id, memory_type, namespace, embedding FROM ${staging}`);
      } else {
        db.exec(`INSERT INTO ${tableName}(rowid, tenant_id, agent_id, task_id, embedding)
          SELECT rowid, tenant_id, agent_id, task_id, embedding FROM ${staging}`);
      }
      db.exec(`DROP TABLE ${staging}`);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** Reset all singletons — used in tests only. */
export function _resetDb(): void {
  for (const db of _dbMap.values()) {
    try { db.close(); } catch { /* ignore */ }
  }
  _dbMap.clear();
}
