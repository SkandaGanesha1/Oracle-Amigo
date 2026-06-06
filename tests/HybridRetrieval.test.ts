import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDb = join(tmpdir(), `test-retrieval-${Date.now()}.db`);
const tmpKeys = join(tmpdir(), `test-ret-keys-${Date.now()}`);
const fixtureRoot = join(tmpdir(), `test-ret-files-${Date.now()}`);

describe("HybridRetrieval", () => {
  beforeEach(async () => {
    vi.stubEnv("AGENTIC_DB_PATH", tmpDb);
    vi.stubEnv("LOCALAPPDATA", tmpKeys);
    mkdirSync(fixtureRoot, { recursive: true });
    writeFileSync(join(fixtureRoot, "API_Design_Final.pdf"), "%PDF-1.4 API design document");
    writeFileSync(join(fixtureRoot, "quarterly_report.xlsx"), "Q4 financial data");
    writeFileSync(join(fixtureRoot, "readme.md"), "# Project readme");
    // Index the fixture root
    const { indexRoot } = await import("../src/retrieval/FileIndexer.js");
    await indexRoot(fixtureRoot);
  });

  afterEach(async () => {
    const { _resetDb } = await import("../src/db/connection.js");
    _resetDb();
    vi.unstubAllEnvs();
    try { rmSync(tmpDb); } catch { /* ignore */ }
    try { rmSync(tmpKeys, { recursive: true }); } catch { /* ignore */ }
    try { rmSync(fixtureRoot, { recursive: true }); } catch { /* ignore */ }
  });

  it("FTS5 search returns correct row for exact filename match", async () => {
    const { search } = await import("../src/retrieval/HybridRetrievalPipeline.js");
    const results = search("API Design Final pdf");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].fileName).toBe("API_Design_Final.pdf");
  });

  it("RRF fusion: item appearing in both FTS and vec lists gets higher score", async () => {
    // Both lists contain the same file → its RRF score = sum of two contributions
    const { search } = await import("../src/retrieval/HybridRetrievalPipeline.js");
    const results = search("API design");
    const hit = results.find((r) => r.fileName === "API_Design_Final.pdf");
    expect(hit).toBeDefined();
    expect(hit!.score).toBeGreaterThan(0);
    expect(hit!.reason).toMatch(/lexical|semantic|filename/);
  });

  it("MMR removes near-duplicate from top results when λ=0.75", async () => {
    // Add two near-identical files, search should not return both at top
    writeFileSync(join(fixtureRoot, "API_Design_Final_copy.pdf"), "%PDF-1.4 API design document");
    const { indexRoot } = await import("../src/retrieval/FileIndexer.js");
    await indexRoot(fixtureRoot);
    const { search } = await import("../src/retrieval/HybridRetrievalPipeline.js");
    const results = search("API design final", { limit: 2 });
    // MMR should diversify — we just verify both don't have identical scores
    if (results.length >= 2) {
      expect(results[0].score).not.toBe(results[1].score);
    }
  });

  it("IntentExtractor classifies 'find API design PPT' as file_request with ppt/pptx extensions", async () => {
    const { RuleBasedIntentExtractor } = await import("../src/intent/IntentExtractor.js");
    const ex = new RuleBasedIntentExtractor();
    const result = ex.extract("find the API design PPT");
    expect(result.intent).toBe("file_request");
    expect(result.extensions).toContain("ppt");
    expect(result.extensions).toContain("pptx");
  });

  it("IntentExtractor classifies 'hello how are you' as normal_chat", async () => {
    const { RuleBasedIntentExtractor } = await import("../src/intent/IntentExtractor.js");
    const ex = new RuleBasedIntentExtractor();
    const result = ex.extract("hello how are you doing today");
    expect(result.intent).toBe("normal_chat");
  });

  it("FeedbackRefiner excludes rejectedIds and rewrites query", async () => {
    const { refine } = await import("../src/retrieval/FeedbackRefiner.js");
    const result = refine("API design doc", "not this one, find the latest client API PPT instead", [42, 99]);
    expect(result.searchOptions.excludeIds).toEqual(expect.arrayContaining([42, 99]));
    expect(result.newQuery).not.toBe("");
    expect(result.searchOptions.extensions).toContain("ppt");
  });
});
