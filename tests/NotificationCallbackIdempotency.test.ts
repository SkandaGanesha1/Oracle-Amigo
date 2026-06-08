import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../src/db/connection.js";

vi.setConfig({ testTimeout: 30_000 });

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
    await waitForTransferCount(1);
    expect(transferCount()).toBe(1);
  });

  it("approve twice creates one transfer", async () => {
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
    const payload = { approvalId: approval.id, taskId: task.id, action: "approve", idempotency_key: "same-approve" };
    const first = await server.inject({ method: "POST", url: "/approvals/notification-callback", payload });
    const second = await server.inject({ method: "POST", url: "/approvals/notification-callback", payload });
    expect(first.json<{ ok: boolean; replay: boolean }>().ok).toBe(true);
    expect(second.json<{ ok: boolean; replay: boolean }>().replay).toBe(true);
    await waitForTransferCount(1);
    expect(transferCount()).toBe(1);
  });

  it("approve then reject stays approved and creates one transfer", async () => {
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
    const approve = await server.inject({ method: "POST", url: "/approvals/notification-callback", payload: { approvalId: approval.id, taskId: task.id, action: "approve", idempotency_key: "approve-1" } });
    expect(approve.json<{ ok: boolean; status: string }>().status).toBe("approved");
    const reject = await server.inject({ method: "POST", url: "/approvals/notification-callback", payload: { approvalId: approval.id, taskId: task.id, action: "reject", idempotency_key: "reject-after-approve" } });
    const rejectBody = reject.json<{ ok: boolean; status: string; error?: string }>();
    expect(rejectBody.ok).toBe(false);
    expect(rejectBody.status).toBe("approved");
    await waitForTransferCount(1);
    expect(transferCount()).toBe(1);
  });

  it("reject then approve stays rejected and creates no transfer", async () => {
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
    const reject = await server.inject({ method: "POST", url: "/approvals/notification-callback", payload: { approvalId: approval.id, taskId: task.id, action: "reject", idempotency_key: "reject-1" } });
    expect(reject.json<{ ok: boolean; status: string }>().status).toBe("rejected");
    const approve = await server.inject({ method: "POST", url: "/approvals/notification-callback", payload: { approvalId: approval.id, taskId: task.id, action: "approve", idempotency_key: "approve-after-reject" } });
    const approveBody = approve.json<{ ok: boolean; status: string }>();
    expect(approveBody.ok).toBe(false);
    expect(approveBody.status).toBe("rejected");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(transferCount()).toBe(0);
  });

  it("feedback then approve works on the refined pending approval", async () => {
    const { buildServer } = await import("../src/server.js");
    const { PersonalAgentProtocol } = await import("../src/protocol/PersonalAgentProtocol.js");
    const protocol = new PersonalAgentProtocol();
    protocol.setIdentityPath({
      agentId: "t-agent", deviceId: "d", did: "did:wba:t",
      publicKey: "11".repeat(32), privateKeyRef: "00".repeat(32),
    });
    const task = protocol.createTask({ type: "file.transfer.offer", actorAgentId: "t-agent", metadata: { query: "real" } });
    const approval = await protocol.createApproval(task.id, { boundFilePath: fixtureFile, selectedFileId: "1" });
    const server = await buildServer();
    const feedback = await server.inject({
      method: "POST",
      url: `/approvals/${approval.id}/feedback`,
      payload: { feedback: "use the real text file", originalQuery: "real", rejectedFileIds: [] }
    });
    expect(feedback.statusCode).toBe(200);
    const refined = feedback.json<{ newApproval: { id: string; status: string } }>().newApproval;
    expect(refined.status).toBe("pending");
    const approve = await server.inject({
      method: "POST",
      url: "/approvals/notification-callback",
      payload: { approvalId: refined.id, taskId: task.id, action: "approve", idempotency_key: "approve-refined" }
    });
    expect(approve.json<{ ok: boolean; status: string }>().status).toBe("approved");
  });

  it("expired then approve is denied", async () => {
    const { buildServer } = await import("../src/server.js");
    const { PersonalAgentProtocol } = await import("../src/protocol/PersonalAgentProtocol.js");
    const protocol = new PersonalAgentProtocol();
    protocol.setIdentityPath({
      agentId: "t-agent", deviceId: "d", did: "did:wba:t",
      publicKey: "11".repeat(32), privateKeyRef: "00".repeat(32),
    });
    const task = protocol.createTask({ type: "file.transfer.offer", actorAgentId: "t-agent" });
    const approval = await protocol.createApproval(task.id, { boundFilePath: fixtureFile });
    getDb().prepare("UPDATE approval_requests SET status = 'expired', decided_at = ? WHERE id = ?").run(new Date().toISOString(), approval.id);
    const server = await buildServer();
    const approve = await server.inject({
      method: "POST",
      url: "/approvals/notification-callback",
      payload: { approvalId: approval.id, taskId: task.id, action: "approve", idempotency_key: "approve-expired" }
    });
    const body = approve.json<{ ok: boolean; status: string; error?: string }>();
    expect(body.ok).toBe(false);
    expect(body.status).toBe("expired");
    expect(transferCount()).toBe(0);
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

function transferCount(): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM transfers").get() as { n: number }).n;
}

async function waitForTransferCount(expected: number): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (transferCount() === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
