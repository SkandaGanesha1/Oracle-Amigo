import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("/approvals/notification-callback idempotency", () => {
  let tmpRoot: string;
  let tmpDb: string;
  let tmpKeys: string;
  let fixtureFile: string;

  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "callback-idem-"));
    tmpDb = join(tmpRoot, "test.db");
    tmpKeys = join(tmpRoot, "keys");
    fixtureFile = join(tmpRoot, "real.txt");
    vi.stubEnv("AGENTIC_DB_PATH", tmpDb);
    vi.stubEnv("LOCALAPPDATA", tmpKeys);
    writeFileSync(fixtureFile, "hello");
    const { indexRoot } = await import("../src/retrieval/FileIndexer.js");
    await indexRoot(tmpRoot);
  });

  afterEach(async () => {
    const { _resetDb } = await import("../src/db/connection.js");
    _resetDb();
    vi.unstubAllEnvs();
    try { rmSync(tmpRoot, { recursive: true }); } catch { /* ignore */ }
  });

  it("rejects unknown actions", async () => {
    const { buildServer } = await import("../src/server.js");
    const server = await buildServer();
    const res = await server.inject({
      method: "POST",
      url: "/approvals/notification-callback",
      payload: { approvalId: "missing", taskId: "t1", action: "banana" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; status: string; error?: string };
    expect(body.ok).toBe(false);
    expect(body.status).toBe("invalid");
    expect(body.error).toContain("banana");
  });

  it("rejects taskId mismatch", async () => {
    const { buildServer } = await import("../src/server.js");
    const { PersonalAgentProtocol } = await import("../src/protocol/PersonalAgentProtocol.js");
    const protocol = new PersonalAgentProtocol();
    protocol.setIdentityPath({
      agentId: "t-agent", deviceId: "d", did: "did:wba:t",
      publicKey: "11".repeat(32), privateKeyRef: "00".repeat(32),
    });
    const task = protocol.createTask({ type: "file.transfer.offer", actorAgentId: "t-agent" });
    const approval = await protocol.createApproval(task.id, { boundFilePath: fixtureFile });

    const server = await buildServer();
    const res = await server.inject({
      method: "POST",
      url: "/approvals/notification-callback",
      payload: { approvalId: approval.id, taskId: "wrong-task-id", action: "approve" },
    });
    const body = res.json() as { ok: boolean; status: string };
    expect(body.ok).toBe(false);
    expect(body.status).toBe("task-mismatch");
  });

  it("first apply returns replay=false; second apply returns replay=true with same status", async () => {
    const { buildServer } = await import("../src/server.js");
    const { PersonalAgentProtocol } = await import("../src/protocol/PersonalAgentProtocol.js");
    const protocol = new PersonalAgentProtocol();
    protocol.setIdentityPath({
      agentId: "t-agent", deviceId: "d", did: "did:wba:t",
      publicKey: "11".repeat(32), privateKeyRef: "00".repeat(32),
    });
    const task = protocol.createTask({ type: "file.transfer.offer", actorAgentId: "t-agent" });
    const approval = await protocol.createApproval(task.id, { boundFilePath: fixtureFile });

    const server = await buildServer();
    const payload = { approvalId: approval.id, taskId: task.id, action: "approve" };
    const first = await server.inject({ method: "POST", url: "/approvals/notification-callback", payload });
    const firstBody = first.json() as { ok: boolean; status: string; replay: boolean };
    expect(firstBody.ok).toBe(true);
    expect(firstBody.replay).toBe(false);
    expect(firstBody.status).toBe("approved");

    const second = await server.inject({ method: "POST", url: "/approvals/notification-callback", payload });
    const secondBody = second.json() as { ok: boolean; status: string; replay: boolean };
    expect(secondBody.ok).toBe(true);
    expect(secondBody.replay).toBe(true);
    expect(secondBody.status).toBe("approved");
  });

  it("rejects unknown approvalId with status=not-found", async () => {
    const { buildServer } = await import("../src/server.js");
    const server = await buildServer();
    const res = await server.inject({
      method: "POST",
      url: "/approvals/notification-callback",
      payload: { approvalId: "no-such-approval", taskId: "t1", action: "approve" },
    });
    const body = res.json() as { ok: boolean; status: string };
    expect(body.ok).toBe(false);
    expect(body.status).toBe("not-found");
  });
});
