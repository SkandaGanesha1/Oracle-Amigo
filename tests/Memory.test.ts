import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDb = join(tmpdir(), `test-memory-${Date.now()}.db`);
const tmpKeys = join(tmpdir(), `test-mem-keys-${Date.now()}`);

describe("Memory", () => {
  beforeEach(() => {
    vi.stubEnv("AGENTIC_DB_PATH", tmpDb);
    vi.stubEnv("LOCALAPPDATA", tmpKeys);
  });

  afterEach(async () => {
    const { _resetDb } = await import("../src/db/connection.js");
    _resetDb();
    vi.unstubAllEnvs();
    try { rmSync(tmpDb); } catch { /* ignore */ }
    try { rmSync(tmpKeys, { recursive: true }); } catch { /* ignore */ }
  });

  it("ShortTermMemory.getWindow respects maxChars and returns chronological order", async () => {
    const { append, getWindow } = await import("../src/memory/ShortTermMemory.js");
    const convId = "conv-test-001";
    append(convId, "user", "hello world");
    append(convId, "agent", "hi there");
    append(convId, "user", "find the api doc");

    const window = getWindow(convId, 100);
    expect(window.length).toBe(3);
    expect(window[0].role).toBe("user");
    expect(window[2].contentText).toBe("find the api doc");

    // With tiny budget, should return fewer
    const small = getWindow(convId, 5);
    expect(small.length).toBeLessThan(3);
  });

  it("LongTermMemory store + retrieve round-trip returns relevant fact", async () => {
    const { store, retrieve } = await import("../src/memory/LongTermMemory.js");
    store("user-prefs", "pref-001", "user prefers PDF over DOCX for documents", 0.8);
    store("user-prefs", "pref-002", "user always picks the latest modified file", 0.7);

    const results = retrieve("user-prefs", "which file format does the user prefer");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].contentText).toMatch(/PDF|DOCX|format/i);
  });

  it("EpisodicMemory record + retrieveSimilar round-trip", async () => {
    const { record, retrieveSimilar } = await import("../src/memory/EpisodicMemory.js");
    record("task-ep-001", "FILE_APPROVED", "User approved API_Design_Final.pdf for transfer", { fileId: "file-abc" });
    record("task-ep-002", "FILE_REJECTED", "User rejected old API draft document", { fileId: "file-def" });

    const results = retrieveSimilar("API design file approved");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.eventType === "FILE_APPROVED")).toBe(true);
  });

  it("Approved file gets episodic boost of 0.05", async () => {
    const { record, getEpisodicBoost } = await import("../src/memory/EpisodicMemory.js");
    record("task-ep-003", "FILE_APPROVED", "User approved final report pdf", { fileId: "file-boost-99" });
    const boost = getEpisodicBoost("file-boost-99");
    expect(boost).toBe(0.05);
  });

  it("getEpisodicBoost returns 0 for unknown fileId", async () => {
    const { getEpisodicBoost } = await import("../src/memory/EpisodicMemory.js");
    expect(getEpisodicBoost("nonexistent-file-id")).toBe(0);
  });
});
