/**
 * Tests for FileIndexer reindexAll.
 *
 * Regression: the old reindexAll deleted `file_index` rows first, then ran
 * `DELETE FROM file_embeddings WHERE rowid IN (SELECT id FROM file_index WHERE root_id = ?)`,
 * which (because the rows were already gone) deleted zero embeddings and
 * left orphans in `file_embeddings` and `fts_file_index`. The fix captures
 * the rowids first.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getLoadablePath } from "sqlite-vec";
import { getDb } from "../src/db/connection.js";
import { vecToBuffer } from "../src/retrieval/EmbeddingModel.js";

describe("FileIndexer.reindexAll", () => {
  let workDir: string;
  let rootDir: string;
  let dbPath: string;
  let prevDbPath: string | undefined;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "reindex-test-"));
    dbPath = join(workDir, "test.db");
    // FileIndexer uses the default getDb() which honours AGENTIC_DB_PATH.
    prevDbPath = process.env.AGENTIC_DB_PATH;
    process.env.AGENTIC_DB_PATH = dbPath;
    // Touch the DB so the connection picks it up
    getDb(dbPath);
    rootDir = join(workDir, "docs");
    mkdirSync(rootDir, { recursive: true });
    writeFileSync(join(rootDir, "a.txt"), "alpha content");
    writeFileSync(join(rootDir, "b.md"), "beta content");
  });

  afterEach(() => {
    if (prevDbPath === undefined) delete process.env.AGENTIC_DB_PATH;
    else process.env.AGENTIC_DB_PATH = prevDbPath;
    try { rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("cleans up file_embeddings when re-indexing an existing root", async () => {
    const { reindexAll } = await import("../src/retrieval/FileIndexer.js");
    const db = getDb(dbPath);

    // First index creates rows
    const first = await reindexAll(rootDir);
    expect(first).toBe(2);
    const beforeRowids = (db.prepare("SELECT id FROM file_index WHERE root_id = ?").all(rootDir) as Array<{ id: number }>);
    expect(beforeRowids.length).toBe(2);
    const beforeEmbedRows = (db
      .prepare(`SELECT COUNT(*) AS n FROM file_embeddings WHERE rowid IN (${beforeRowids.map(() => "?").join(",")})`)
      .get(...beforeRowids.map((r) => r.id)) as { n: number }).n;
    expect(beforeEmbedRows).toBe(2);

    // Second index should clean up the old embeddings and re-create them
    const second = await reindexAll(rootDir);
    expect(second).toBe(2);
    const afterRowids = (db.prepare("SELECT id FROM file_index WHERE root_id = ?").all(rootDir) as Array<{ id: number }>);
    expect(afterRowids.length).toBe(2);
    // No rowid should have more than one embedding (no orphans from the prior run).
    const dupes = (db
      .prepare("SELECT rowid, COUNT(*) AS n FROM file_embeddings GROUP BY rowid HAVING n > 1")
      .all() as Array<{ rowid: number; n: number }>);
    expect(dupes.length).toBe(0);
    // Every rowid in file_index should have a matching embedding.
    const orphans = (db
      .prepare(`SELECT id FROM file_index WHERE root_id = ? AND id NOT IN (SELECT rowid FROM file_embeddings)`)
      .all(rootDir) as Array<{ id: number }>);
    expect(orphans.length).toBe(0);
  });

  it("removes the old file_index rows on reindex (the regression target)", async () => {
    const { reindexAll } = await import("../src/retrieval/FileIndexer.js");
    const db = getDb(dbPath);

    await reindexAll(rootDir);
    const beforeRowids = (db.prepare("SELECT id FROM file_index WHERE root_id = ?").all(rootDir) as Array<{ id: number }>).map((r) => r.id);
    expect(beforeRowids.length).toBe(2);

    // Delete a file so reindex removes its row
    rmSync(join(rootDir, "a.txt"));
    await reindexAll(rootDir);
    const afterRowids = (db.prepare("SELECT id FROM file_index WHERE root_id = ?").all(rootDir) as Array<{ id: number }>).map((r) => r.id);
    expect(afterRowids.length).toBe(1);
    // The remaining row should not be one of the prior rowids that we re-inserted
    // (i.e. the fix removed the orphan instead of letting the old row stick).
    expect(afterRowids[0]).not.toBe(beforeRowids[0]);
  });

  it("works on an empty / non-existent root without throwing", async () => {
    const { reindexAll } = await import("../src/retrieval/FileIndexer.js");
    const emptyRoot = join(workDir, "nope");
    expect(await reindexAll(emptyRoot)).toBe(0);
  });

  it("preserves compatible old vec0 embeddings during partition-key migration and drops staging tables", () => {
    const legacyDbPath = join(workDir, "legacy-vec.db");
    const legacy = new DatabaseSync(legacyDbPath, { allowExtension: true });
    legacy.loadExtension(getLoadablePath());
    legacy.exec("CREATE VIRTUAL TABLE file_embeddings USING vec0(embedding FLOAT[384])");
    legacy.prepare("INSERT INTO file_embeddings(rowid, embedding) VALUES (?, ?)").run(42n, vecToBuffer(new Float32Array(384).fill(0.25)));
    legacy.close();

    const db = getDb(legacyDbPath);
    const migrated = db.prepare("SELECT rowid, tenant_id, agent_id, source_type, namespace FROM file_embeddings WHERE rowid = 42").get() as
      | { rowid: bigint; tenant_id: string; agent_id: string; source_type: string; namespace: string }
      | undefined;
    expect(migrated).toBeDefined();
    expect(migrated!.tenant_id).toBe("default");
    expect(migrated!.agent_id).toBe("default");
    expect(migrated!.source_type).toBe("file");
    const staging = db.prepare("SELECT name FROM sqlite_master WHERE name = 'file_embeddings_staging'").get();
    expect(staging).toBeUndefined();
  });
});
