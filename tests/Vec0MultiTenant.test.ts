import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dbPath: string;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "vec0-multi-tenant-"));
  dbPath = join(dir, "test.db");
  process.env.AGENTIC_DB_PATH = dbPath;
  process.env.AGENTIC_TENANT_ID = "tenantA";
  process.env.AGENTIC_AGENT_ID = "agent1";
  // Dynamic import to pick up env vars
  await import("../src/db/connection.js");
});

afterAll(async () => {
  delete process.env.AGENTIC_DB_PATH;
  delete process.env.AGENTIC_TENANT_ID;
  delete process.env.AGENTIC_AGENT_ID;
  try { rmSync(dbPath, { force: true }); } catch { /* ignore */ }
  const { _resetDb } = await import("../src/db/connection.js");
  _resetDb();
});

describe("sqlite-vec multi-tenant partition keys", () => {
  it("file_embeddings has tenant_id and agent_id as partition keys", async () => {
    const { getDb } = await import("../src/db/connection.js");
    const db = getDb();
    const row = db.prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='file_embeddings'`,
    ).get() as { sql: string };
    expect(row.sql).toContain("tenant_id");
    expect(row.sql).toContain("agent_id");
    expect(row.sql).toContain("PARTITION KEY");
  });

  it("multi-tenant KNN filter by partition keys", async () => {
    const { getDb } = await import("../src/db/connection.js");
    const db = getDb();
    const dim = 384;
    const vecA = new Float32Array(dim).fill(0.1);
    const vecB = new Float32Array(dim).fill(0.9);
    const bufA = Buffer.from(vecA.buffer);
    const bufB = Buffer.from(vecB.buffer);
    db.prepare(
      "DELETE FROM file_embeddings WHERE rowid IN (1, 2)",
    ).run();
    db.prepare(
      "INSERT INTO file_embeddings(rowid, tenant_id, agent_id, source_type, namespace, embedding) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(BigInt(1), "tenantA", "agent1", "file", "ns1", bufA);
    db.prepare(
      "INSERT INTO file_embeddings(rowid, tenant_id, agent_id, source_type, namespace, embedding) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(BigInt(2), "tenantB", "agent2", "file", "ns1", bufB);
    const rowsA = db.prepare(
      "SELECT rowid, distance FROM file_embeddings WHERE embedding MATCH ? AND tenant_id = ? AND agent_id = ? AND k = 10",
    ).all(bufA, "tenantA", "agent1") as Array<{ rowid: bigint; distance: number }>;
    expect(rowsA.length).toBeGreaterThan(0);
    expect(Number(rowsA[0].rowid)).toBe(1);
    expect(rowsA.every((r) => Number(r.rowid) !== 2)).toBe(true);
  });

  it("distance constraint in KNN MATCH returns only close neighbors", async () => {
    const { getDb } = await import("../src/db/connection.js");
    const db = getDb();
    const dim = 384;
    const query = new Float32Array(dim).fill(0.1);
    const queryBuf = Buffer.from(query.buffer);
    const close = db.prepare(
      "SELECT rowid, distance FROM file_embeddings WHERE embedding MATCH ? AND tenant_id = ? AND agent_id = ? AND distance < 0.5 AND k = 10",
    ).all(queryBuf, "tenantA", "agent1") as Array<{ rowid: bigint; distance: number }>;
    expect(close.every((r) => r.distance < 0.5)).toBe(true);
    const all = db.prepare(
      "SELECT rowid, distance FROM file_embeddings WHERE embedding MATCH ? AND tenant_id = ? AND agent_id = ? AND k = 10",
    ).all(queryBuf, "tenantA", "agent1") as Array<{ rowid: bigint; distance: number }>;
    expect(all.length).toBeGreaterThanOrEqual(close.length);
  });

  it("vec0 tables support auxiliary metadata columns", async () => {
    const { getDb } = await import("../src/db/connection.js");
    const db = getDb();
    const row = db.prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='memory_embeddings'`,
    ).get() as { sql: string };
    expect(row.sql).toContain("namespace");
    expect(row.sql).toContain("memory_type");
  });
});
