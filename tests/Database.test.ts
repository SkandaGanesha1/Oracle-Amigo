import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDb = join(tmpdir(), `test-oracle-amigo-${Date.now()}.db`);

describe("SQLite database foundation", () => {
  beforeEach(() => {
    vi.stubEnv("AGENTIC_DB_PATH", tmpDb);
  });

  afterEach(async () => {
    const { _resetDb } = await import("../src/db/connection.js");
    _resetDb();
    vi.unstubAllEnvs();
    try { rmSync(tmpDb); } catch { /* ignore */ }
  });

  it("migrate() is idempotent — running twice produces no error and correct user_version", async () => {
    const { getDb } = await import("../src/db/connection.js");
    const db = getDb();
    const { migrate } = await import("../src/db/migrate.js");
    expect(() => migrate(db)).not.toThrow();
    const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
    expect(row.user_version).toBe(1);
  });

  it("all expected tables exist after migration", async () => {
    const { getDb } = await import("../src/db/connection.js");
    const db = getDb();
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>
    ).map((r) => r.name);
    for (const expected of [
      "local_profiles", "agent_cards", "peer_sessions", "conversations", "messages",
      "a2a_tasks", "workflow_events", "file_index", "approval_requests",
      "transfers", "received_files", "memories", "episodic_events", "audit_events",
    ]) {
      expect(tables, `missing table: ${expected}`).toContain(expected);
    }
  });

  it("sqlite-vec loads and vec0 table accepts float vector insert + KNN query", async () => {
    const { getDb } = await import("../src/db/connection.js");
    const db = getDb();
    const dim = 384;
    const vec = new Float32Array(dim).fill(0.1);
    const buf = Buffer.from(vec.buffer);
    // node:sqlite requires BigInt for INTEGER rowid parameters with sqlite-vec
    db.prepare(
      "INSERT INTO file_embeddings(rowid, tenant_id, agent_id, source_type, namespace, embedding) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(BigInt(1), "default", "default", "test", "default", buf);
    const rows = db.prepare(
      "SELECT rowid, distance FROM file_embeddings WHERE embedding MATCH ? AND tenant_id = ? AND agent_id = ? AND k = 1",
    ).all(buf, "default", "default") as Array<{ rowid: bigint; distance: number }>;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].rowid)).toBe(1);
    expect(rows[0].distance).toBeCloseTo(0, 3);
  });
});
