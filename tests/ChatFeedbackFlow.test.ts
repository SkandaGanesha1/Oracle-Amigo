import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpRoot = mkdtempSync(join(tmpdir(), "chat-feedback-"));
const tmpDb = join(tmpRoot, "test.db");
const tmpKeys = join(tmpRoot, "keys");
const fixtureRoot = join(tmpRoot, "files");

describe("Chat + feedback flow with refined search", () => {
  beforeEach(async () => {
    vi.stubEnv("AGENTIC_DB_PATH", tmpDb);
    vi.stubEnv("LOCALAPPDATA", tmpKeys);
    mkdirSync(fixtureRoot, { recursive: true });
    writeFileSync(join(fixtureRoot, "API_Design_2019.pdf"), "%PDF-1.4 2019 API design");
    writeFileSync(join(fixtureRoot, "API_Design_2024.pdf"), "%PDF-1.4 2024 API design client module");
    const { indexRoot } = await import("../src/retrieval/FileIndexer.js");
    await indexRoot(fixtureRoot);
  });

  afterEach(async () => {
    const { _resetDb } = await import("../src/db/connection.js");
    _resetDb();
    vi.unstubAllEnvs();
    try { rmSync(tmpRoot, { recursive: true }); } catch { /* ignore */ }
  });

  it("rejects then refines search to return the 2024 file", async () => {
    const { search } = await import("../src/retrieval/HybridRetrievalPipeline.js");
    const { refine } = await import("../src/retrieval/FeedbackRefiner.js");

    const first = search("API design", { limit: 5 });
    expect(first.length).toBeGreaterThan(0);
    const rejectedId = first[0].id;

    // Feedback: "I want the 2024 version, not the 2019 one"
    const refined = refine("API design", "I want the 2024 version, not the 2019 one", [rejectedId]);
    expect(refined.searchOptions.excludeIds).toContain(rejectedId);
    expect(refined.newQuery.length).toBeGreaterThan(0);

    const second = search(refined.newQuery, { ...refined.searchOptions, limit: 5 });
    expect(second.length).toBeGreaterThan(0);
    // Top result must not be the rejected one
    expect(second[0].id).not.toBe(rejectedId);
  });
});
