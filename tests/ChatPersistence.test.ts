import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server.js";
import { _resetDb, getDb } from "../src/db/connection.js";
import { storeReceivedRelayFile } from "../src/storage/AgenticStorage.js";
import { ChatRepository } from "../src/chat/ChatRepository.js";
import { LocalCloudIdentityStore, defaultProfileId } from "../src/cloud/LocalCloudIdentityStore.js";
import { RemoteTaskDispatcher } from "../src/runtime/RemoteTaskDispatcher.js";
import { PersonalAgentProtocol } from "../src/protocol/PersonalAgentProtocol.js";

let tmpRoot: string;

vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "chat-persistence-"));
  process.env.AGENTIC_DB_PATH = join(tmpRoot, "agent.db");
  process.env.AGENTIC_STORAGE_ROOT = join(tmpRoot, "storage");
  process.env.SANDBOX_FILE_SEARCH_ROOTS = tmpRoot;
  process.env.AGENTIC_DISABLE_RUNTIME_AUTOSTART = "true";
  _resetDb();
});

afterEach(() => {
  _resetDb();
  delete process.env.AGENTIC_DB_PATH;
  delete process.env.AGENTIC_STORAGE_ROOT;
  delete process.env.SANDBOX_FILE_SEARCH_ROOTS;
  delete process.env.AGENTIC_DISABLE_RUNTIME_AUTOSTART;
  delete process.env.CONTROL_PLANE_URL;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("persisted chat API", () => {
  it("creates conversations and persists normal messages", async () => {
    const server = buildServer();
    const created = await server.inject({
      method: "POST",
      url: "/chat/conversations",
      payload: { title: "Bob Agent", mode: "local" }
    });
    expect(created.statusCode).toBe(200);
    const conversationId = created.json().conversation.id as string;

    const sent = await server.inject({
      method: "POST",
      url: `/chat/conversations/${conversationId}/messages`,
      payload: { text: "hello bob", send_as: "normal", client_message_id: "msg-test-1" }
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().delivery_status).toBe("delivered");

    const messages = await server.inject({ method: "GET", url: `/chat/conversations/${conversationId}/messages` });
    expect(messages.statusCode).toBe(200);
    expect(messages.json().messages.some((message: { kind: string; text?: string }) => message.kind === "human" && message.text === "hello bob")).toBe(true);

    const db = getDb();
    const attempts = db.prepare("SELECT COUNT(*) AS n FROM message_delivery_attempts WHERE message_id = ?").get("msg-test-1") as { n: number };
    expect(attempts.n).toBeGreaterThan(0);
    await server.close();
  });

  it("answers simple local chat without starting a broad agent run", async () => {
    const server = buildServer();
    const created = await server.inject({
      method: "POST",
      url: "/chat/conversations",
      payload: { title: "Local Agent", mode: "local" }
    });
    const conversationId = created.json().conversation.id as string;

    const sent = await server.inject({
      method: "POST",
      url: `/chat/conversations/${conversationId}/messages`,
      payload: { text: "hi", send_as: "normal", client_message_id: "msg-hi-1" }
    });

    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toMatchObject({ delivery_status: "delivered", type: "message" });
    expect(sent.json().run_id).toBeUndefined();

    const messages = await server.inject({ method: "GET", url: `/chat/conversations/${conversationId}/messages` });
    expect(JSON.stringify(messages.json())).toContain("connected to the local backend");

    const runs = await server.inject({ method: "GET", url: "/agent/runs" });
    expect(runs.json<{ runs: unknown[] }>().runs).toHaveLength(0);
    await server.close();
  });

  it("starts and persists a real agent run for substantive local chat", async () => {
    const server = buildServer();
    const created = await server.inject({
      method: "POST",
      url: "/chat/conversations",
      payload: { title: "Local Agent", mode: "local" }
    });
    const conversationId = created.json().conversation.id as string;

    const sent = await server.inject({
      method: "POST",
      url: `/chat/conversations/${conversationId}/messages`,
      payload: { text: "summarize the configured backend capabilities", send_as: "normal", client_message_id: "msg-run-1" }
    });

    expect(sent.statusCode).toBe(200);
    expect(sent.json().delivery_status).toBe("sent");
    expect(sent.json().run_id).toBeTruthy();

    const messages = await server.inject({ method: "GET", url: `/chat/conversations/${conversationId}/messages` });
    const body = JSON.stringify(messages.json());
    expect(body).toContain(sent.json().run_id);
    expect(body).toContain("Agent is working");
    await waitForAgentRun(server, sent.json().run_id as string);
    await server.close();
  });

  it("persists a file request timeline with approval metadata and no local path exposure in chat payload", async () => {
    writeFileSync(join(tmpRoot, "API design document.pdf"), "%PDF-1.4 API design");
    const server = buildServer();
    const created = await server.inject({
      method: "POST",
      url: "/chat/conversations",
      payload: { title: "Local Agent", mode: "local" }
    });
    const conversationId = created.json().conversation.id as string;

    const sent = await server.inject({
      method: "POST",
      url: `/chat/conversations/${conversationId}/messages`,
      payload: {
        text: "Can you send me the API design document?",
        send_as: "file_request",
        client_message_id: "msg-file-1"
      }
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().type).toBe("approval_required");

    const messages = await server.inject({ method: "GET", url: `/chat/conversations/${conversationId}/messages` });
    const body = JSON.stringify(messages.json());
    expect(body).toContain("approval");
    expect(body).toContain("Local path hidden from recipient");
    expect(body).toContain(sent.json().run_id);
    expect(body).not.toContain("bound_file_path");
    expect(body).not.toContain("boundFilePath");
    expect(body).not.toContain(tmpRoot);
    await server.close();
  });

  it("finishes local file requests without approval when no file is found", async () => {
    const server = buildServer();
    const created = await server.inject({
      method: "POST",
      url: "/chat/conversations",
      payload: { title: "Local Agent", mode: "local" }
    });
    const conversationId = created.json().conversation.id as string;

    const sent = await server.inject({
      method: "POST",
      url: `/chat/conversations/${conversationId}/messages`,
      payload: {
        text: "Find NonPO invoice india.pdf file",
        send_as: "file_request",
        client_message_id: "msg-file-missing"
      }
    });

    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toMatchObject({ type: "not_found", delivery_status: "failed" });
    expect(sent.json().run_id).toBeTruthy();

    const messages = await server.inject({ method: "GET", url: `/chat/conversations/${conversationId}/messages` });
    const body = messages.json() as {
      messages: Array<{ kind: string; id?: string; status?: string; status_text?: string; details?: Record<string, unknown> }>;
    };
    expect(body.messages.some((message) => message.kind === "approval")).toBe(false);
    expect(body.messages.some((message) => message.kind === "file_request" && message.id === "msg-file-missing" && message.status === "not_found")).toBe(true);
    expect(body.messages.some((message) => message.kind === "agent_status" && message.details?.run_id === sent.json().run_id)).toBe(true);
    await server.close();
  });

  it("returns structured relay auth failures for cloud-relay conversations", async () => {
    const controlPlane = await startRejectingControlPlane(401);
    process.env.CONTROL_PLANE_URL = controlPlane.url;
    const cloudStore = new LocalCloudIdentityStore();
    cloudStore.save(defaultProfileId(), {
      controlPlaneUrl: controlPlane.url,
      orgId: "org-test",
      userId: "usr-test",
      userEmail: "test@example.com",
      displayName: "Test User",
      deviceId: "dev-test",
      agentId: "agt-test",
      agentInstanceId: "agi-local",
      relayInboxUrl: `${controlPlane.url}/v1/relay/a2a/inbox`,
      userAccessToken: "user-token",
      deviceAccessToken: "device-token",
      refreshToken: "refresh-token",
      status: "enrolled"
    });
    const chatRepo = new ChatRepository();
    const conversation = chatRepo.createConversation({
      title: "Relay Peer",
      mode: "cloud_relay",
      localUserId: "usr-test",
      localAgentInstanceId: "agi-local",
      peerAgentInstanceId: "agi-peer"
    });
    const server = buildServer();

    const sent = await server.inject({
      method: "POST",
      url: `/chat/conversations/${conversation.id}/messages`,
      payload: { text: "hello relay", send_as: "normal", client_message_id: "msg-relay-auth" }
    });

    expect(sent.statusCode).toBe(401);
    expect(sent.json()).toMatchObject({
      error: "UNAUTHORIZED",
      message: "HTTP 401",
      conversation_id: conversation.id,
      message_id: "msg-relay-auth",
      relay_unavailable: true
    });
    const stored = chatRepo.getMessage("msg-relay-auth");
    expect(stored?.delivery_status).toBe("failed");
    await server.close();
    await controlPlane.close();
  });

  it("enriches cloud relay conversations with directory presence by peer agent instance", async () => {
    const controlPlane = await startDirectoryControlPlane("agi-peer", {
      user_id: "usr-peer",
      display_name: "Docin",
      email: "docin1116@gmail.com",
      agent_id: "agt-peer",
      agent_instance_id: "agi-peer",
      device_id: "dev-peer",
      device_name: "Docin Laptop",
      status: "online",
      relay_inbox_url: "http://127.0.0.1:9999/v1/relay/a2a/inbox",
      agent_card_url: "http://127.0.0.1:9999/v1/relay/a2a/agi-peer",
      agent_card_hash: "hash-peer",
      last_seen_at: new Date().toISOString()
    });
    new LocalCloudIdentityStore().save(defaultProfileId(), {
      controlPlaneUrl: controlPlane.url,
      orgId: "org-test",
      userId: "usr-local",
      userEmail: "skanda.l@oracle.com",
      displayName: "Skanda Ganesha L",
      deviceId: "dev-local",
      agentId: "agt-local",
      agentInstanceId: "agi-local",
      relayInboxUrl: `${controlPlane.url}/v1/relay/a2a/inbox`,
      deviceAccessToken: "device-token",
      status: "enrolled"
    });
    const chatRepo = new ChatRepository();
    chatRepo.createConversation({
      title: "Remote agent agi-peer",
      mode: "cloud_relay",
      localAgentInstanceId: "agi-local",
      peerAgentInstanceId: "agi-peer"
    });
    const server = buildServer();

    const res = await server.inject({ method: "GET", url: "/chat/conversations" });

    expect(res.statusCode).toBe(200);
    const peer = res.json().conversations.find((conversation: { agentInstanceId?: string }) => conversation.agentInstanceId === "agi-peer");
    expect(peer).toMatchObject({
      title: "Docin",
      presence: "online"
    });
    expect(JSON.stringify(peer)).not.toMatch(/device-token|PRIVATE KEY|[A-Za-z]:[\\/]|file:\/\//);
    await server.close();
    await controlPlane.close();
  });

  it("stores inbound relay message.send as an incoming peer chat message", async () => {
    const dispatcher = new RemoteTaskDispatcher(new PersonalAgentProtocol());
    const result = await dispatcher.dispatch({
      relay_task_id: "relay-msg-1",
      from_agent_instance_id: "agi-peer",
      to_agent_instance_id: "agi-local",
      a2a_task_id: "task-msg-1",
      type: "message.send",
      payload: { kind: "message", text: "hello from peer" },
      status: "delivered",
      created_at: new Date().toISOString(),
      delivered_at: null,
      ack_at: null
    });
    expect(result.status).toBe("created");
    const conversation = new ChatRepository().findCloudRelayConversationByPeerAgent("agi-peer");
    expect(conversation).toBeTruthy();
    const server = buildServer();

    const messages = await server.inject({ method: "GET", url: `/chat/conversations/${conversation!.id}/messages` });

    expect(messages.statusCode).toBe(200);
    expect(messages.json().messages).toContainEqual(expect.objectContaining({
      kind: "human",
      text: "hello from peer",
      direction: "incoming",
      sender_agent_instance_id: "agi-peer",
      receiver_agent_instance_id: "agi-local"
    }));
    expect(messages.json().messages).not.toContainEqual(expect.objectContaining({
      kind: "agent_status",
      status_text: "hello from peer"
    }));
    await server.close();
  });

  it("verifies a stored received file hash without exposing local paths", async () => {
    const server = buildServer();
    const data = Buffer.from("verified file bytes");
    const { createHash } = await import("node:crypto");
    const sha256 = createHash("sha256").update(data).digest("hex");
    const stored = storeReceivedRelayFile({
      transferId: "transfer-verify",
      senderAgentId: "agent-sender",
      fileName: "verified.txt",
      data,
      sha256
    });

    const res = await server.inject({ method: "GET", url: `/storage/files/${stored.id}/verify` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: stored.id,
      sha256,
      expected_sha256: sha256,
      hash_verified: true,
      size_bytes: data.length
    });
    expect(JSON.stringify(res.json())).not.toContain(stored.storedPath);
    await server.close();
  });
});

async function startRejectingControlPlane(statusCode: number): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    if (req.url === "/v1/relay/a2a/send") {
      res.writeHead(statusCode, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "UNAUTHORIZED" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to start test control plane");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
  };
}

async function startDirectoryControlPlane(agentInstanceId: string, body: Record<string, unknown>): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const expected = `/v1/directory/device/agent-instances/${encodeURIComponent(agentInstanceId)}`;
    if (req.method === "GET" && req.url === expected && req.headers.authorization === "Bearer device-token") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "NOT_FOUND" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to start test control plane");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
  };
}

async function waitForAgentRun(server: ReturnType<typeof buildServer>, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await server.inject({ method: "GET", url: `/agent/runs/${runId}` });
    if (response.json<{ status: string }>().status !== "running") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for agent run ${runId}`);
}
