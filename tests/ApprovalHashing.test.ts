import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpRoot = mkdtempSync(join(tmpdir(), "approval-hash-"));
const tmpDb = join(tmpRoot, "test.db");
const tmpKeys = join(tmpRoot, "keys");

describe("createApproval hashes the bound file at creation time", () => {
  beforeEach(() => {
    vi.stubEnv("AGENTIC_DB_PATH", tmpDb);
    vi.stubEnv("LOCALAPPDATA", tmpKeys);
  });

  afterEach(async () => {
    const { _resetDb } = await import("../src/db/connection.js");
    _resetDb();
    vi.unstubAllEnvs();
    try { rmSync(tmpRoot, { recursive: true }); } catch { /* ignore */ }
  });

  it("computes boundSha256 and boundSizeBytes when boundFilePath is provided", async () => {
    const filePath = join(tmpRoot, "note.txt");
    const content = "hello oracle amigo";
    writeFileSync(filePath, content);

    const expectedSha = createHash("sha256").update(content).digest("hex");
    const expectedSize = Buffer.byteLength(content);

    const { PersonalAgentProtocol } = await import("../src/protocol/PersonalAgentProtocol.js");
    const protocol = new PersonalAgentProtocol();
    protocol.setIdentityPath({
      agentId: "test-agent",
      deviceId: "test-device",
      did: "did:wba:test:abc",
      publicKey: "11".repeat(32),
      privateKeyRef: "00".repeat(32),
    });

    const task = protocol.createTask({ type: "file.transfer.offer", actorAgentId: "test-agent" });
    const approval = await protocol.createApproval(task.id, {
      boundFilePath: filePath,
    });

    expect(approval.boundSha256).toBe(expectedSha);
    expect(approval.boundSizeBytes).toBe(expectedSize);
    expect(approval.boundFilePath).toBe(filePath);
  });

  it("rejects transfer approvals when boundFilePath is missing", async () => {
    const { PersonalAgentProtocol } = await import("../src/protocol/PersonalAgentProtocol.js");
    const protocol = new PersonalAgentProtocol();
    protocol.setIdentityPath({
      agentId: "test-agent",
      deviceId: "test-device",
      did: "did:wba:test:abc",
      publicKey: "11".repeat(32),
      privateKeyRef: "00".repeat(32),
    });

    const task = protocol.createTask({ type: "file.transfer.offer", actorAgentId: "test-agent" });
    await expect(protocol.createApproval(task.id, {
      boundFilePath: null,
    })).rejects.toThrow("APPROVAL_HAS_NO_BOUND_FILE");
  });

  it("allows refinement approvals without a bound file", async () => {
    const { PersonalAgentProtocol } = await import("../src/protocol/PersonalAgentProtocol.js");
    const protocol = new PersonalAgentProtocol();
    protocol.setIdentityPath({
      agentId: "test-agent",
      deviceId: "test-device",
      did: "did:wba:test:abc",
      publicKey: "11".repeat(32),
      privateKeyRef: "00".repeat(32),
    });

    const task = protocol.createTask({ type: "file.search.refinement", actorAgentId: "test-agent" });
    const approval = await protocol.createApproval(task.id, {
      approvalType: "file.search.refinement",
      boundFilePath: null,
    });

    expect(approval.boundSha256).toBeNull();
    expect(approval.boundSizeBytes).toBeNull();
    expect(approval.approvalType).toBe("file.search.refinement");
  });
});
