import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server.js";
import { _resetDb, getDb } from "../src/db/connection.js";
import { ChatRepository } from "../src/chat/ChatRepository.js";
import { LocalCloudIdentityStore, defaultProfileId } from "../src/cloud/LocalCloudIdentityStore.js";

vi.setConfig({ testTimeout: 30_000 });

function getVoiceFlowSuffix(p: string): string {
  const normalized = p.replace(/\\/g, "/").toLowerCase();
  const idx = normalized.indexOf("/voice-flow-");
  return idx !== -1 ? normalized.slice(idx) : normalized;
}

let tmpRoot: string;
let controlPlane: Server | null = null;
let controlPlaneUrl = "";
let relayPayload: Record<string, unknown> | null = null;

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), "voice-flow-"));
  process.env.AGENTIC_DB_PATH = join(tmpRoot, "agent.db");
  process.env.AGENTIC_DISABLE_RUNTIME_AUTOSTART = "true";
  process.env.SANDBOX_FILE_SEARCH_ROOTS = tmpRoot;
  process.env.METRICS_ENABLED = "false";
  _resetDb();
  relayPayload = null;
  await startControlPlane();
  process.env.CONTROL_PLANE_URL = controlPlaneUrl;
});

afterEach(async () => {
  await new Promise<void>((resolve) => controlPlane?.close(() => resolve()));
  controlPlane = null;
  _resetDb();
  delete process.env.AGENTIC_DB_PATH;
  delete process.env.AGENTIC_DISABLE_RUNTIME_AUTOSTART;
  delete process.env.SANDBOX_FILE_SEARCH_ROOTS;
  delete process.env.METRICS_ENABLED;
  delete process.env.CONTROL_PLANE_URL;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("voice file request flow", () => {
  it("submits a relay file request after preview confirmation", async () => {
    seedCloudIdentity();
    const server = buildServer();

    const created = await server.inject({
      method: "POST",
      url: "/voice/commands",
      payload: {
        transcript: "Ask Docin to send me NonPO invoice india.pdf file",
        source: "voice-launcher",
        mode: "preview_then_execute"
      }
    });
    expect(created.statusCode).toBe(200);
    const commandId = created.json().command.id as string;

    const confirmed = await server.inject({
      method: "POST",
      url: `/voice/commands/${commandId}/confirm`
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().command.status).toBe("submitted");
    expect(confirmed.json().command.relayTaskId).toBe("relay_voice_1");

    expect(relayPayload).toMatchObject({
      to_agent_instance_id: "agi_docin",
      type: "file.request",
      idempotency_key: `voice-${commandId}`
    });
    expect((relayPayload?.payload as Record<string, unknown>).text).toContain("NonPO invoice india.pdf");

    const messages = new ChatRepository(getDb()).listConversations()
      .flatMap((conversation) => new ChatRepository(getDb()).getMessages(conversation.id));
    expect(messages.some((message) => message.delivery_status === "queued_at_relay" && message.text?.includes("NonPO invoice india.pdf"))).toBe(true);
  });

  it("handles incoming file.request relay messages, registers a receiver approval, and transfers file upon approval", async () => {
    seedCloudIdentity();
    const server = buildServer();

    // 1. Create a dummy file to act as the selected file for transfer
    const fs = await import("node:fs");
    const dummyFile = join(tmpRoot, "Harassment Policy.pdf");
    fs.writeFileSync(dummyFile, "dummy policy content");

    // 2. Mock incoming relay file.request message
    const relayMessage = {
      relay_task_id: "relay_task_voice_999",
      a2a_task_id: "a2a_task_voice_999",
      from_agent_instance_id: "agi_docin",
      to_agent_instance_id: "agi_skanda",
      type: "file.request",
      payload: {
        text: "Harassment Policy.pdf",
        requester_user_id: "usr_docin",
        voice_command_id: "vc_voice_123"
      },
      status: "pending",
      created_at: new Date().toISOString(),
      delivered_at: null,
      ack_at: null
    };

    // 3. Dispatch the message using RemoteTaskDispatcher
    const { RemoteTaskDispatcher } = await import("../src/runtime/RemoteTaskDispatcher.js");
    const { PersonalAgentProtocol } = await import("../src/protocol/PersonalAgentProtocol.js");
    const { FileSearchService } = await import("../src/file-search/FileSearchService.js");

    const protocol = new PersonalAgentProtocol();
    const dispatcher = new RemoteTaskDispatcher(
      protocol,
      getDb(),
      defaultProfileId(),
      new ChatRepository(getDb()),
      new FileSearchService()
    );

    const result = await dispatcher.dispatch(relayMessage);
    expect(result.status).toBe("created");
    expect(result.approvalId).not.toBeNull();
    const approvalId = result.approvalId!;

    // 4. Verify database entry is created in receiver_approvals with status 'pending'
    const approvalRow = getDb().prepare("SELECT * FROM receiver_approvals WHERE id = ?").get(approvalId) as Record<string, unknown>;
    expect(approvalRow).toBeDefined();
    expect(approvalRow.status).toBe("pending");
    expect(approvalRow.file_query).toBe("Harassment Policy.pdf");

    // 5. Approve the transfer using Fastify HTTP API POST /receiver/approvals/:id/approve
    const approveResponse = await server.inject({
      method: "POST",
      url: `/receiver/approvals/${approvalId}/approve`,
      payload: {
        selected_file_path: dummyFile
      }
    });

    expect(approveResponse.statusCode).toBe(200);
    expect(approveResponse.json().approval.status).toBe("approved");

    // 6. Wait for the setImmediate background task to complete uploading and update status
    const updatedApproval = await waitForReceiverApprovalStatus(approvalId, "transferred");

    // 7. Verify status has transitioned to 'transferred' in the database
    expect(updatedApproval.status).toBe("transferred");
    expect(getVoiceFlowSuffix(String(updatedApproval.selected_file_path))).toBe(getVoiceFlowSuffix(dummyFile));
  });

  it("triggers Windows toast notifications via NotificationBridgeClient and processes native callback successfully", async () => {
    seedCloudIdentity();
    const server = buildServer();

    // 1. Create a dummy file to act as the search candidate
    const fs = await import("node:fs");
    const dummyFile = join(tmpRoot, "Harassment Policy.pdf");
    fs.writeFileSync(dummyFile, "dummy policy content");

    // 2. Setup mock notification bridge server to capture the outgoing toast payload
    let capturedNotification: any = null;
    const bridgeServer = createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.method === "POST" && req.url === "/notify") {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
          capturedNotification = JSON.parse(body);
          res.end(JSON.stringify({ supported: true, status: "ok" }));
        });
        return;
      }
      res.statusCode = 404;
      res.end();
    });

    const bridgePort = await new Promise<number>((resolve) => {
      bridgeServer.listen(0, "127.0.0.1", () => {
        const addr = bridgeServer.address();
        resolve(addr && typeof addr === "object" ? addr.port : 3400);
      });
    });
    process.env.NOTIFICATION_BRIDGE_PORT = String(bridgePort);

    try {
      // 3. Mock incoming relay file.request message
      const relayMessage = {
        relay_task_id: "relay_task_voice_888",
        a2a_task_id: "a2a_task_voice_888",
        from_agent_instance_id: "agi_docin",
        to_agent_instance_id: "agi_skanda",
        type: "file.request",
        payload: {
          text: "Harassment Policy.pdf",
          requester_user_id: "usr_docin",
          voice_command_id: "vc_voice_123"
        },
        status: "pending",
        created_at: new Date().toISOString(),
        delivered_at: null,
        ack_at: null
      };

      // Dispatch the message using RemoteTaskDispatcher
      const { RemoteTaskDispatcher } = await import("../src/runtime/RemoteTaskDispatcher.js");
      const { PersonalAgentProtocol } = await import("../src/protocol/PersonalAgentProtocol.js");
      const { FileSearchService } = await import("../src/file-search/FileSearchService.js");

      const protocol = new PersonalAgentProtocol();
      const dispatcher = new RemoteTaskDispatcher(
        protocol,
        getDb(),
        defaultProfileId(),
        new ChatRepository(getDb()),
        new FileSearchService()
      );

      const result = await dispatcher.dispatch(relayMessage);
      expect(result.status).toBe("created");
      expect(result.approvalId).not.toBeNull();
      const approvalId = result.approvalId!;

      // Wait a moment for the non-blocking sendNotification promise to resolve/hit the bridge
      await new Promise((resolve) => setTimeout(resolve, 80));

      // Assert that the bridge received the correct payload
      expect(capturedNotification).not.toBeNull();
      expect(capturedNotification).toMatchObject({
        approvalId,
        taskId: result.localTaskId,
        requesterName: "agi_docin",
        requestedItem: "Harassment Policy.pdf",
        topCandidateFileName: "Harassment Policy.pdf"
      });
      expect(capturedNotification.callbackNonce).toBeDefined();
      expect(capturedNotification.callbackSignature).toBeDefined();

      // 4. Simulate a user clicking "Approve" from the OS toast callback!
      // This sends the payload back to POST /approvals/notification-callback
      const callbackResponse = await server.inject({
        method: "POST",
        url: "/approvals/notification-callback",
        payload: {
          approvalId,
          taskId: result.localTaskId,
          action: "approve",
          nonce: capturedNotification.callbackNonce,
          signature: capturedNotification.callbackSignature,
          candidateId: capturedNotification.candidateId
        }
      });

      expect(callbackResponse.statusCode).toBe(200);
      expect(callbackResponse.json().ok).toBe(true);
      expect(callbackResponse.json().status).toBe("approved");

      // 5. Wait for the setImmediate background upload transfer to run
      const updatedApproval = await waitForReceiverApprovalStatus(approvalId, "transferred");

      // 6. Verify database status updated to 'transferred'
      expect(updatedApproval.status).toBe("transferred");
      expect(getVoiceFlowSuffix(String(updatedApproval.selected_file_path))).toBe(getVoiceFlowSuffix(dummyFile));
    } finally {
      // Cleanup
      delete process.env.NOTIFICATION_BRIDGE_PORT;
      await new Promise<void>((resolve) => bridgeServer.close(() => resolve()));
    }
  });
});

async function waitForReceiverApprovalStatus(
  approvalId: string,
  expectedStatus: string,
  timeoutMs = 5_000
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let lastRow: Record<string, unknown> | undefined;

  while (Date.now() < deadline) {
    lastRow = getDb().prepare("SELECT * FROM receiver_approvals WHERE id = ?").get(approvalId) as Record<string, unknown> | undefined;
    if (lastRow?.status === expectedStatus) {
      return lastRow;
    }
    if (lastRow?.status === "failed") {
      throw new Error(`Receiver approval ${approvalId} failed: ${String(lastRow.error_message ?? "unknown error")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for receiver approval ${approvalId} to reach ${expectedStatus}; last status was ${String(lastRow?.status ?? "missing")}`);
}

function seedCloudIdentity(): void {
  new LocalCloudIdentityStore(getDb()).save(defaultProfileId(), {
    controlPlaneUrl,
    orgId: "org_1",
    userId: "usr_skanda",
    userEmail: "skanda@example.com",
    displayName: "Skanda",
    deviceId: "dev_skanda",
    agentId: "ag_skanda",
    agentInstanceId: "agi_skanda",
    userAccessToken: "user-token",
    deviceAccessToken: "device-token",
    status: "enrolled"
  });
}

async function startControlPlane(): Promise<void> {
  controlPlane = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url === "/v1/directory/users/usr_docin/agents") {
      res.end(JSON.stringify({
        user_id: "usr_docin",
        email: "docin@example.com",
        display_name: "Docin",
        status: "online",
        presence: "online",
        agents: [{
          agent_instance_id: "agi_docin",
          agent_id: "ag_docin",
          display_name: "Docin",
          status: "online",
          capabilities: ["a2a.v1", "file.request", "file.transfer"],
          last_heartbeat_at: new Date().toISOString()
        }]
      }));
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/v1/directory/users")) {
      res.end(JSON.stringify({
        users: [{
          user_id: "usr_docin",
          email: "docin@example.com",
          display_name: "Docin",
          status: "online",
          presence: "online"
        }]
      }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/relay/a2a/send") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        relayPayload = JSON.parse(body) as Record<string, unknown>;
        res.end(JSON.stringify({
          relay_task_id: "relay_voice_1",
          status: "pending",
          accepted_at: new Date().toISOString()
        }));
      });
      return;
    }
    if (req.method === "POST" && req.url === "/v1/transfers/init") {
      res.end(JSON.stringify({
        transfer_id: "tx_mock_999",
        status: "ready",
        upload_url: "/v1/transfers/tx_mock_999/upload",
        download_url: "/v1/transfers/tx_mock_999/download",
        expires_at: new Date(Date.now() + 3600000).toISOString()
      }));
      return;
    }
    if (req.method === "PUT" && req.url === "/v1/transfers/tx_mock_999/upload") {
      res.end(JSON.stringify({ ok: true, status: "uploaded" }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found", url: req.url }));
  });
  await new Promise<void>((resolve) => {
    controlPlane!.listen(0, "127.0.0.1", () => {
      const address = controlPlane!.address();
      if (address && typeof address === "object") controlPlaneUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
}
