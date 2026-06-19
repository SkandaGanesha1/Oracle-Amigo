import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import type { ControlPlaneStore } from "./ControlPlaneStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsDir = join(__dirname, "migrations");

export interface MigrationFile {
  id: string;
  filename: string;
  sql: string;
}

export function loadMigrationFiles(): MigrationFile[] {
  return readdirSync(migrationsDir)
    .filter((name) => /^\d+_.+\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b))
    .map((filename) => ({
      id: filename.replace(/\.sql$/i, ""),
      filename,
      sql: readFileSync(join(migrationsDir, filename), "utf8").trim() + "\n"
    }));
}

export async function runPostgresMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL
    )
  `);
  const result = await pool.query<{ id: string }>("SELECT id FROM schema_migrations");
  const applied = new Set(result.rows.map((row) => row.id));

  for (const migration of loadMigrationFiles()) {
    if (applied.has(migration.id)) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(migration.sql);
      await client.query("INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)", [
        migration.id,
        new Date().toISOString()
      ]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function ensureDefaultOrganization(store: ControlPlaneStore, slug: string, name: string): Promise<string> {
  const existing = await store.one<{ id: string }>("SELECT id FROM organizations WHERE slug = $1", [slug]);
  if (existing) return existing.id;
  const id = `org_${cryptoRandomHex(12)}`;
  await store.execute("INSERT INTO organizations (id, name, slug, created_at) VALUES ($1, $2, $3, $4)", [
    id,
    name,
    slug,
    new Date().toISOString()
  ]);
  return id;
}

function cryptoRandomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < bytes; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  return Buffer.from(buf).toString("hex");
}
