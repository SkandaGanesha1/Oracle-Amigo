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
import { InboxPoller } from "../src/runtime/InboxPoller.js";
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
  it("returns derived inbox items with counts and persisted read/archive state", async () => {
    const filePath = join(tmpRoot, "report.pdf");
    writeFileSync(filePath, "approval contents");
    const protocol = new PersonalAgentProtocol();
    const approval = await protocol.createApproval("task-inbox-1", {
      requesterAgentId: "remote-agent",
      ownerAgentId: "local-agent",
      selectedFileId: "file-1",
      boundFilePath: filePath
    });
    const server = buildServer();

    const initial = await server.inject({ method: "GET", url: "/api/inbox/items?bucket=needs_my_approval" });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({
      pageInfo: { hasMore: false },
      counts: { needs_my_approval: 1 }
    });
    expect(initial.json().items[0]).toMatchObject({
      id: `approval:${approval.id}`,
      bucket: "needs_my_approval",
      status: "pending",
      approvalId: approval.id
    });

    const read = await server.inject({ method: "POST", url: `/api/inbox/items/approval:${approval.id}/read` });
    expect(read.statusCode).toBe(200);
    const afterRead = await server.inject({ method: "GET", url: `/api/inbox/items/approval:${approval.id}` });
    expect(afterRead.json().item.unread).toBe(false);

    const archived = await server.inject({ method: "POST", url: `/api/inbox/items/approval:${approval.id}/archive` });
    expect(archived.statusCode).toBe(200);
    const archiveBucket = await server.inject({ method: "GET", url: "/api/inbox/items?bucket=archived" });
    expect(archiveBucket.json().items[0]).toMatchObject({ id: `approval:${approval.id}`, bucket: "archived", status: "archived" });
    await server.close();
  });

  it("updates approval status from inbox approve and rejects unsupported actions", async () => {
    const filePath = join(tmpRoot, "transfer.pdf");
    writeFileSync(filePath, "approval contents");
    const protocol = new PersonalAgentProtocol();
    const approval = await protocol.createApproval("task-inbox-approve", {
      requesterAgentId: "remote-agent",
      ownerAgentId: "local-agent",
      selectedFileId: "file-2",
      boundFilePath: filePath
    });
    const server = buildServer();

    const unsupported = await server.inject({ method: "POST", url: "/api/inbox/items/run:missing/approve" });
    expect(unsupported.statusCode).toBe(409);

    const approved = await server.inject({ method: "POST", url: `/api/inbox/items/approval:${approval.id}/approve` });
    expect(approved.statusCode).toBe(200);
    expect(protocol.getApproval(approval.id)?.status).toBe("approved");

    const completed = await server.inject({ method: "GET", url: "/api/inbox/items?bucket=completed" });
    expect(completed.json().items.some((item: { id: string; status: string }) => item.id === `approval:${approval.id}` && item.status === "approved")).toBe(true);
    await server.close();
  });

  it("always exposes and opens the local-agent conversation", async () => {
    const server = buildServer();

    const conversations = await server.inject({ method: "GET", url: "/chat/conversations" });
    expect(conversations.statusCode).toBe(200);
    const local = conversations.json().conversations.find((conversation: { id: string }) => conversation.id === "local-agent");
    expect(local).toMatchObject({
      id: "local-agent",
      title: "My local agent",
      presence: "online"
    });

    const messages = await server.inject({ method: "GET", url: "/chat/conversations/local-agent/messages" });
    expect(messages.statusCode).toBe(200);
    expect(messages.json().conversation).toMatchObject({
      id: "local-agent",
      title: "My local agent"
    });
    expect(messages.json().readState).toMatchObject({
      conversationId: "local-agent",
      unreadCount: 0,
      mentionCount: 0
    });
    await server.close();
  });

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
    expect(messages.json().conversation).toMatchObject({
      id: conversationId,
      title: "Bob Agent"
    });
    expect(messages.json().messages.some((message: { kind: string; text?: string }) => message.kind === "human" && message.text === "hello bob")).toBe(true);

    const db = getDb();
    const attempts = db.prepare("SELECT COUNT(*) AS n FROM message_delivery_attempts WHERE message_id = ?").get("msg-test-1") as { n: number };
    expect(attempts.n).toBeGreaterThan(0);
    await server.close();
  });

  it("preserves peer user and agent targets when creating cloud relay conversations", async () => {
    const server = buildServer();
    const created = await server.inject({
      method: "POST",
      url: "/chat/conversations",
      payload: {
        title: "Docin",
        mode: "cloud_relay",
        peer_user_id: "usr-docin",
        peer_agent_instance_id: "agi-docin"
      }
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().conversation).toMatchObject({
      title: "Docin",
      peerUserId: "usr-docin",
      agentInstanceId: "agi-docin"
    });

    const messages = await server.inject({
      method: "GET",
      url: `/chat/conversations/${created.json().conversation.id}/messages`
    });
    expect(messages.statusCode).toBe(200);
    expect(messages.json().conversation).toMatchObject({
      peerUserId: "usr-docin",
      agentInstanceId: "agi-docin"
    });
    await server.close();
  });

  it("persists conversation read state and rejects markers from other conversations", async () => {
    const chatRepo = new ChatRepository();
    const conversation = chatRepo.createConversation({ title: "Read State", mode: "local" });
    const other = chatRepo.createConversation({ title: "Other Read State", mode: "local" });
    chatRepo.appendMessage({
      id: "msg-read-1",
      conversationId: conversation.id,
      messageType: "human",
      text: "one",
      deliveryStatus: "delivered",
      createdAt: "2026-06-14T10:00:00.000Z"
    });
    chatRepo.appendMessage({
      id: "msg-read-2",
      conversationId: conversation.id,
      messageType: "human",
      text: "two",
      deliveryStatus: "delivered",
      createdAt: "2026-06-14T10:01:00.000Z"
    });
    chatRepo.appendMessage({
      id: "msg-other-1",
      conversationId: other.id,
      messageType: "human",
      text: "other",
      deliveryStatus: "delivered",
      createdAt: "2026-06-14T10:02:00.000Z"
    });
    const server = buildServer();

    const initial = await server.inject({ method: "GET", url: `/chat/conversations/${conversation.id}/messages` });
    expect(initial.statusCode).toBe(200);
    expect(initial.json().readState).toMatchObject({
      conversationId: conversation.id,
      unreadCount: 2,
      mentionCount: 0
    });
    expect(initial.json().readState.lastReadMessageId).toBeUndefined();

    const rejected = await server.inject({
      method: "POST",
      url: `/chat/conversations/${conversation.id}/read-state`,
      payload: { lastReadMessageId: "msg-other-1" }
    });
    expect(rejected.statusCode).toBe(400);

    const updated = await server.inject({
      method: "POST",
      url: `/chat/conversations/${conversation.id}/read-state`,
      payload: { lastReadMessageId: "msg-read-1" }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().readState).toMatchObject({
      conversationId: conversation.id,
      lastReadMessageId: "msg-read-1",
      unreadCount: 1,
      mentionCount: 0
    });

    const refreshed = await server.inject({ method: "GET", url: `/chat/conversations/${conversation.id}/messages` });
    expect(refreshed.json().readState).toMatchObject(updated.json().readState);
    expect(chatRepo.getConversation(conversation.id)?.unread_count).toBe(1);
    await server.close();
  });

  it("persists reply previews, thread summaries, pins, and around-window message jumps", async () => {
    const chatRepo = new ChatRepository();
    const conversation = chatRepo.createConversation({ title: "Threaded Chat", mode: "local" });
    chatRepo.appendMessage({
      id: "msg-parent",
      conversationId: conversation.id,
      messageType: "human",
      text: "parent message",
      deliveryStatus: "delivered",
      createdAt: "2026-06-14T10:00:00.000Z"
    });
    for (let i = 0; i < 8; i += 1) {
      chatRepo.appendMessage({
        id: `msg-filler-${i}`,
        conversationId: conversation.id,
        messageType: "human",
        text: `filler ${i}`,
        deliveryStatus: "delivered",
        createdAt: `2026-06-14T10:0${i + 1}:00.000Z`
      });
    }
    chatRepo.appendMessage({
      id: "msg-reply",
      conversationId: conversation.id,
      messageType: "human",
      text: "reply body",
      payload: {
        reply_to_id: "msg-parent",
        thread_id: "msg-parent",
        sender_label: "Docin"
      },
      deliveryStatus: "delivered",
      createdAt: "2026-06-14T10:10:00.000Z"
    });
    const server = buildServer();

    const pinned = await server.inject({
      method: "PATCH",
      url: `/chat/conversations/${conversation.id}/messages/msg-parent/pin`,
      payload: { pinned: true }
    });
    expect(pinned.statusCode).toBe(200);
    expect(pinned.json().message).toMatchObject({ id: "msg-parent", pinned: true });

    const messages = await server.inject({ method: "GET", url: `/chat/conversations/${conversation.id}/messages` });
    expect(messages.statusCode).toBe(200);
    expect(messages.json().messages).toContainEqual(expect.objectContaining({
      id: "msg-reply",
      reply_preview: expect.objectContaining({
        messageId: "msg-parent",
        authorLabel: "You",
        textPreview: "parent message"
      })
    }));
    expect(messages.json().messages).toContainEqual(expect.objectContaining({
      id: "msg-parent",
      pinned: true,
      thread_summary: expect.objectContaining({
        threadId: "msg-parent",
        replyCount: 1
      })
    }));

    const thread = await server.inject({ method: "GET", url: `/chat/conversations/${conversation.id}/threads/msg-parent` });
    expect(thread.statusCode).toBe(200);
    expect(thread.json().replies).toContainEqual(expect.objectContaining({ id: "msg-reply", text: "reply body" }));

    const createdReply = await server.inject({
      method: "POST",
      url: `/chat/conversations/${conversation.id}/threads/msg-parent/replies`,
      payload: { text: "server-backed reply" }
    });
    expect(createdReply.statusCode).toBe(200);
    expect(createdReply.json().message).toMatchObject({
      kind: "human",
      text: "server-backed reply",
      reply_to_id: "msg-parent",
      thread_id: "msg-parent"
    });

    const around = await server.inject({
      method: "GET",
      url: `/chat/conversations/${conversation.id}/messages?around=msg-filler-4&limit=5`
    });
    expect(around.statusCode).toBe(200);
    expect(around.json().messages.map((message: { id: string }) => message.id)).toContain("msg-filler-4");
    expect(around.json().pageInfo).toMatchObject({ hasMoreBefore: true, hasMoreAfter: true });

    const before = await server.inject({
      method: "GET",
      url: `/chat/conversations/${conversation.id}/messages?before=msg-filler-4&limit=3`
    });
    expect(before.statusCode).toBe(200);
    expect(before.json().messages.map((message: { id: string }) => message.id)).toEqual([
      "msg-filler-1",
      "msg-filler-2",
      "msg-filler-3"
    ]);
    expect(before.json().pageInfo).toMatchObject({ hasMoreBefore: true, hasMoreAfter: true });

    const missing = await server.inject({
      method: "GET",
      url: `/chat/conversations/${conversation.id}/messages?around=msg-missing&limit=5`
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: "MESSAGE_NOT_FOUND" });
    await server.close();
  });

  it("persists message reactions and rejects reactions for other conversations", async () => {
    const chatRepo = new ChatRepository();
    const conversation = chatRepo.createConversation({ title: "Reaction Chat", mode: "local" });
    const other = chatRepo.createConversation({ title: "Other Reaction Chat", mode: "local" });
    chatRepo.appendMessage({
      id: "msg-reaction-1",
      conversationId: conversation.id,
      messageType: "human",
      text: "react to me",
      deliveryStatus: "delivered",
      createdAt: "2026-06-14T10:00:00.000Z"
    });
    chatRepo.appendMessage({
      id: "msg-reaction-other",
      conversationId: other.id,
      messageType: "human",
      text: "other",
      deliveryStatus: "delivered",
      createdAt: "2026-06-14T10:01:00.000Z"
    });
    const server = buildServer();
    const emoji = encodeURIComponent("👍");

    const added = await server.inject({
      method: "PUT",
      url: `/chat/conversations/${conversation.id}/messages/msg-reaction-1/reactions/${emoji}`,
      payload: {}
    });
    expect(added.statusCode).toBe(200);
    expect(added.json().reactions).toEqual([
      expect.objectContaining({ emoji: "👍", count: 1, me: true })
    ]);

    const duplicate = await server.inject({
      method: "PUT",
      url: `/chat/conversations/${conversation.id}/messages/msg-reaction-1/reactions/${emoji}`,
      payload: {}
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().reactions[0]).toMatchObject({ emoji: "👍", count: 1 });

    const refreshed = await server.inject({ method: "GET", url: `/chat/conversations/${conversation.id}/messages` });
    expect(refreshed.json().messages).toContainEqual(expect.objectContaining({
      id: "msg-reaction-1",
      reactions: [expect.objectContaining({ emoji: "👍", count: 1, me: true })]
    }));

    const rejected = await server.inject({
      method: "PUT",
      url: `/chat/conversations/${conversation.id}/messages/msg-reaction-other/reactions/${emoji}`,
      payload: {}
    });
    expect(rejected.statusCode).toBe(404);

    const invalid = await server.inject({
      method: "PUT",
      url: `/chat/conversations/${conversation.id}/messages/msg-reaction-1/reactions/${encodeURIComponent("not-an-emoji-too-long")}`,
      payload: {}
    });
    expect(invalid.statusCode).toBe(400);

    const removed = await server.inject({
      method: "DELETE",
      url: `/chat/conversations/${conversation.id}/messages/msg-reaction-1/reactions/${emoji}`
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().reactions).toEqual([]);
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

  it("repairs stale relay conversation targets before sending", async () => {
    const captured: Array<Record<string, unknown>> = [];
    const controlPlane = await startRoutingControlPlane(captured);
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
    const conversation = chatRepo.createConversation({
      title: "Remote agent agi-old",
      mode: "cloud_relay",
      localAgentInstanceId: "agi-local",
      peerAgentInstanceId: "agi-old"
    });
    const server = buildServer();

    const sent = await server.inject({
      method: "POST",
      url: `/chat/conversations/${conversation.id}/messages`,
      payload: { text: "relay route repair check", send_as: "normal", client_message_id: "msg-route-repair" }
    });

    expect(sent.statusCode).toBe(200);
    expect(captured[0]).toMatchObject({
      to_agent_instance_id: "agi-current",
      type: "message.send"
    });
    const repaired = chatRepo.getConversation(conversation.id);
    expect(repaired).toMatchObject({
      peer_user_id: "usr-peer",
      peer_agent_instance_id: "agi-current",
      title: "Docin"
    });
    expect(sent.json().delivery_status).toBe("queued_at_relay");
    const stored = chatRepo.getMessage("msg-route-repair");
    expect(stored).toMatchObject({ delivery_status: "queued_at_relay" });
    expect(stored?.payload_json).toMatchObject({
      relay_task_id: "relay-route-repair",
      to_agent_instance_id: "agi-current",
      peer_user_id: "usr-peer"
    });
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

  it("stores inbound relay messages in the existing peer-user conversation", async () => {
    const captured: Array<Record<string, unknown>> = [];
    const controlPlane = await startRoutingControlPlane(captured);
    new LocalCloudIdentityStore().save(defaultProfileId(), {
      controlPlaneUrl: controlPlane.url,
      orgId: "org-test",
      userId: "usr-local",
      userEmail: "docin1116@gmail.com",
      displayName: "Docin",
      deviceId: "dev-local",
      agentId: "agt-local",
      agentInstanceId: "agi-local",
      relayInboxUrl: `${controlPlane.url}/v1/relay/a2a/inbox`,
      deviceAccessToken: "device-token",
      status: "enrolled"
    });
    const chatRepo = new ChatRepository();
    const existing = chatRepo.createConversation({
      title: "Docin old route",
      mode: "cloud_relay",
      localAgentInstanceId: "agi-local",
      peerUserId: "usr-peer",
      peerAgentInstanceId: "agi-old"
    });
    const dispatcher = new RemoteTaskDispatcher(new PersonalAgentProtocol(), getDb(), defaultProfileId(), chatRepo);

    const result = await dispatcher.dispatch({
      relay_task_id: "relay-msg-existing-user",
      from_agent_instance_id: "agi-old",
      to_agent_instance_id: "agi-local",
      a2a_task_id: "task-msg-existing-user",
      type: "message.send",
      payload: { kind: "message", text: "hello existing peer conversation" },
      status: "delivered",
      created_at: new Date().toISOString(),
      delivered_at: null,
      ack_at: null
    });

    expect(result.status).toBe("created");
    const repaired = chatRepo.getConversation(existing.id);
    expect(repaired).toMatchObject({
      peer_user_id: "usr-peer",
      peer_agent_instance_id: "agi-current",
      title: "Docin"
    });
    const messages = chatRepo.getMessages(existing.id);
    expect(messages).toContainEqual(expect.objectContaining({
      message_type: "human",
      text: "hello existing peer conversation",
      sender_agent_instance_id: "agi-old",
      receiver_agent_instance_id: "agi-local",
      delivery_status: "stored_by_remote_agent"
    }));
    expect(captured).toContainEqual(expect.objectContaining({
      receipt_for: "relay-msg-existing-user",
      status: "stored_by_remote_agent"
    }));
    expect(chatRepo.listConversations().filter((conversation) => conversation.peer_user_id === "usr-peer")).toHaveLength(1);
    await controlPlane.close();
  });

  it("does not acknowledge relay inbox items when dispatch fails", async () => {
    let ackCount = 0;
    const controlPlane = await startInboxControlPlane(() => { ackCount += 1; });
    const store = new LocalCloudIdentityStore();
    store.save(defaultProfileId(), {
      controlPlaneUrl: controlPlane.url,
      orgId: "org-test",
      userId: "usr-local",
      userEmail: "docin1116@gmail.com",
      displayName: "Docin",
      deviceId: "dev-local",
      agentId: "agt-local",
      agentInstanceId: "agi-local",
      relayInboxUrl: `${controlPlane.url}/v1/relay/a2a/inbox`,
      deviceAccessToken: "device-token",
      status: "enrolled"
    });
    const failingDispatcher = {
      dispatch: async () => ({
        relayTaskId: "relay-failed-dispatch",
        localTaskId: "",
        approvalId: null,
        status: "failed" as const
      })
    } as unknown as RemoteTaskDispatcher;
    const poller = new InboxPoller(store, failingDispatcher, defaultProfileId());

    const result = await poller.pollOnce();

    expect(result.dispatched).toHaveLength(1);
    expect(result.dispatched[0].status).toBe("failed");
    expect(ackCount).toBe(0);
    await controlPlane.close();
  });

  it("creates a candidate-backed remote file approval from live local search when the SQLite index is empty", async () => {
    writeFileSync(join(tmpRoot, "Job Offer-Associate Consultant.pdf"), "%PDF-1.4 job offer");
    const protocol = new PersonalAgentProtocol();
    const chatRepo = new ChatRepository();
    const dispatcher = new RemoteTaskDispatcher(protocol, getDb(), defaultProfileId(), chatRepo);

    const result = await dispatcher.dispatch({
      relay_task_id: "relay-file-live-search",
      from_agent_instance_id: "agi-docin",
      to_agent_instance_id: "agi-skanda",
      a2a_task_id: "task-file-live-search",
      type: "file.request",
      payload: { kind: "file_request", text: "Send me Job Offer-Associate Consultant.pdf file" },
      status: "delivered",
      created_at: new Date().toISOString(),
      delivered_at: null,
      ack_at: null
    });

    expect(result.status).toBe("created");
    expect(result.approvalId).toBeTruthy();
    const approval = protocol.getApproval(result.approvalId!);
    expect(approval).toMatchObject({
      status: "pending",
      selectedFileId: expect.any(String),
      boundSizeBytes: expect.any(Number)
    });
    expect(approval?.boundFilePath).toContain("Job Offer-Associate Consultant.pdf");
    expect(approval?.boundSha256).toMatch(/^[a-f0-9]{64}$/);

    const approvalMessage = chatRepo.getMessages(chatRepo.listConversations()[0].id)
      .find((message) => message.message_type === "approval");
    expect(approvalMessage).toBeTruthy();
    expect(approvalMessage?.payload_json).toMatchObject({
      selected_candidate_id: approval?.selectedFileId,
      candidates: [expect.objectContaining({
        file_name: "Job Offer-Associate Consultant.pdf",
        display_path: "Local file / Job Offer-Associate Consultant.pdf"
      })]
    });
    expect(JSON.stringify(approvalMessage?.payload_json)).not.toContain(tmpRoot);
  });

  it("rejects unbound file approvals instead of approving a transfer that cannot upload", async () => {
    const protocol = new PersonalAgentProtocol();
    const dispatcher = new RemoteTaskDispatcher(protocol);
    const result = await dispatcher.dispatch({
      relay_task_id: "relay-file-missing",
      from_agent_instance_id: "agi-docin",
      to_agent_instance_id: "agi-skanda",
      a2a_task_id: "task-file-missing",
      type: "file.request",
      payload: { kind: "file_request", text: "Send me Missing Candidate.pdf file" },
      status: "delivered",
      created_at: new Date().toISOString(),
      delivered_at: null,
      ack_at: null
    });
    expect(result.approvalId).toBeTruthy();
    expect(protocol.getApproval(result.approvalId!)).toMatchObject({
      approvalType: "file.search.refinement",
      boundFilePath: null
    });

    const server = buildServer();
    const approve = await server.inject({
      method: "POST",
      url: `/approvals/${result.approvalId}/approve`,
      payload: {}
    });

    expect(approve.statusCode).toBe(409);
    expect(approve.json()).toMatchObject({ error: "APPROVAL_HAS_NO_BOUND_FILE" });
    expect(JSON.stringify(approve.json())).not.toContain(tmpRoot);
    expect(protocol.getApproval(result.approvalId!)?.status).toBe("pending");
    await server.close();
  });

  it("allows a zero-candidate remote file request to be manually bound before approval", async () => {
    const protocol = new PersonalAgentProtocol();
    const dispatcher = new RemoteTaskDispatcher(protocol);
    const result = await dispatcher.dispatch({
      relay_task_id: "relay-file-manual-bind",
      from_agent_instance_id: "agi-docin",
      to_agent_instance_id: "agi-skanda",
      a2a_task_id: "task-file-manual-bind",
      type: "file.request",
      payload: { kind: "file_request", text: "Send me Missing Candidate.pdf file" },
      status: "delivered",
      created_at: new Date().toISOString(),
      delivered_at: null,
      ack_at: null
    });
    expect(protocol.getApproval(result.approvalId!)).toMatchObject({
      approvalType: "file.search.refinement",
      boundFilePath: null
    });

    const filePath = join(tmpRoot, "Job Offer-Associate Consultant.pdf");
    writeFileSync(filePath, "%PDF-1.4 manual bind");
    const now = new Date().toISOString();
    const insert = getDb().prepare(`
      INSERT INTO file_index
        (root_id, file_path, display_path, file_name, extension, mime_type, size_bytes, modified_at, indexed_text, metadata_json, last_indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("root-test", filePath, "Downloads/Job Offer-Associate Consultant.pdf", "Job Offer-Associate Consultant.pdf", ".pdf", "application/pdf", 22, now, "", "{}", now);

    const server = buildServer();
    const rebound = await server.inject({
      method: "POST",
      url: `/approvals/${result.approvalId}/rebind-file`,
      payload: { fileId: String(insert.lastInsertRowid) }
    });

    expect(rebound.statusCode).toBe(200);
    expect(rebound.json()).toMatchObject({
      approval_type: "file.transfer.offer",
      selected_file_id: String(insert.lastInsertRowid),
      candidates: [expect.objectContaining({
        file_name: "Job Offer-Associate Consultant.pdf",
        display_path: "Local path hidden from recipient"
      })]
    });
    expect(protocol.getApproval(result.approvalId!)?.boundSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(rebound.json())).not.toContain(tmpRoot);
    await server.close();
  });

  it("refines a zero-candidate approval with live local search and returns only safe candidate fields", async () => {
    writeFileSync(join(tmpRoot, "Job Offer-Associate Consultant.pdf"), "%PDF-1.4 refined job offer");
    const protocol = new PersonalAgentProtocol();
    const dispatcher = new RemoteTaskDispatcher(protocol);
    const result = await dispatcher.dispatch({
      relay_task_id: "relay-file-feedback",
      from_agent_instance_id: "agi-docin",
      to_agent_instance_id: "agi-skanda",
      a2a_task_id: "task-file-feedback",
      type: "file.request",
      payload: { kind: "file_request", text: "Send me Definitely Missing.pdf file" },
      status: "delivered",
      created_at: new Date().toISOString(),
      delivered_at: null,
      ack_at: null
    });
    expect(protocol.getApproval(result.approvalId!)).toMatchObject({
      approvalType: "file.search.refinement",
      boundFilePath: null
    });

    const server = buildServer();
    const feedback = await server.inject({
      method: "POST",
      url: `/approvals/${result.approvalId}/feedback`,
      payload: {
        feedback: "It is named Job Offer-Associate Consultant.pdf",
        originalQuery: "Send me Definitely Missing.pdf file",
        rejectedFileIds: []
      }
    });

    expect(feedback.statusCode).toBe(200);
    const body = feedback.json<{
      candidates: Array<{ file_name: string; display_path: string }>;
      newApproval: { id: string; selected_file_id: string | null; candidates: unknown[] };
    }>();
    expect(body.candidates).toContainEqual(expect.objectContaining({
      file_name: "Job Offer-Associate Consultant.pdf",
      display_path: "Local file / Job Offer-Associate Consultant.pdf"
    }));
    expect(body.newApproval.selected_file_id).toBeTruthy();
    expect(protocol.getApproval(body.newApproval.id)?.boundSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(body)).not.toContain(tmpRoot);
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

async function startRoutingControlPlane(captured: Array<Record<string, unknown>>): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/directory/device/agent-instances/agi-old") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        user_id: "usr-peer",
        display_name: "Docin",
        email: "docin1116@gmail.com",
        agent_id: "agt-old",
        agent_instance_id: "agi-old",
        device_id: "dev-old",
        device_name: "Old Laptop",
        status: "offline",
        relay_inbox_url: "http://127.0.0.1:9999/v1/relay/a2a/inbox",
        agent_card_url: "http://127.0.0.1:9999/v1/relay/a2a/agi-old",
        agent_card_hash: "hash-old",
        last_seen_at: "2026-06-10T00:00:00.000Z"
      }));
      return;
    }
    if (req.method === "GET" && req.url === "/v1/directory/device/users/usr-peer/agents") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        user_id: "usr-peer",
        display_name: "Docin",
        email: "docin1116@gmail.com",
        status: "online",
        presence: "online",
        active_agent_instances: 2,
        agents: [
          {
            agent_id: "agt-old",
            agent_instance_id: "agi-old",
            device_id: "dev-old",
            display_name: "Old Laptop",
            device_name: "Old Laptop",
            status: "offline",
            capabilities: ["a2a.v1"],
            relay_inbox_url: "http://127.0.0.1:9999/v1/relay/a2a/inbox",
            agent_card_url: "http://127.0.0.1:9999/v1/relay/a2a/agi-old",
            agent_card_hash: "hash-old",
            last_heartbeat_at: "2026-06-10T00:00:00.000Z"
          },
          {
            agent_id: "agt-current",
            agent_instance_id: "agi-current",
            device_id: "dev-current",
            display_name: "Current Laptop",
            device_name: "Current Laptop",
            status: "online",
            capabilities: ["a2a.v1", "message.send", "file.request"],
            relay_inbox_url: "http://127.0.0.1:9999/v1/relay/a2a/inbox",
            agent_card_url: "http://127.0.0.1:9999/v1/relay/a2a/agi-current",
            agent_card_hash: "hash-current",
            last_heartbeat_at: new Date().toISOString()
          }
        ]
      }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/relay/a2a/send") {
      let body = "";
      req.on("data", (chunk) => { body += String(chunk); });
      req.on("end", () => {
        captured.push(JSON.parse(body) as Record<string, unknown>);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          relay_task_id: "relay-route-repair",
          status: "accepted",
          accepted_at: new Date().toISOString()
        }));
      });
      return;
    }
    const respondMatch = req.url?.match(/^\/v1\/relay\/a2a\/([^/]+)\/respond$/);
    if (req.method === "POST" && respondMatch) {
      let body = "";
      req.on("data", (chunk) => { body += String(chunk); });
      req.on("end", () => {
        const payload = JSON.parse(body) as Record<string, unknown>;
        captured.push({ receipt_for: decodeURIComponent(respondMatch[1]), ...payload });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "NOT_FOUND", url: req.url }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to start routing test control plane");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
  };
}

async function startInboxControlPlane(onAck: () => void): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url?.startsWith("/v1/relay/a2a/inbox")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        server_time: new Date().toISOString(),
        items: [
          {
            relay_task_id: "relay-failed-dispatch",
            relay_message_id: "relmsg-failed-dispatch",
            from_agent_instance_id: "agi-peer",
            to_agent_instance_id: "agi-local",
            a2a_task_id: "task-failed-dispatch",
            type: "message.send",
            payload: { kind: "message", text: "this should not ack" },
            status: "delivered",
            created_at: new Date().toISOString(),
            delivered_at: null,
            ack_at: null
          }
        ]
      }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/relay/a2a/relay-failed-dispatch/ack") {
      onAck();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "NOT_FOUND", url: req.url }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to start inbox test control plane");
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
