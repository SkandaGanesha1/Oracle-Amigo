import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { _resetDb, getDb } from "../src/db/connection.js";
import { storeReceivedRelayFile } from "../src/storage/AgenticStorage.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "chat-persistence-"));
  process.env.AGENTIC_DB_PATH = join(tmpRoot, "agent.db");
  process.env.AGENTIC_STORAGE_ROOT = join(tmpRoot, "storage");
  process.env.AGENTIC_DISABLE_RUNTIME_AUTOSTART = "true";
  _resetDb();
});

afterEach(() => {
  _resetDb();
  delete process.env.AGENTIC_DB_PATH;
  delete process.env.AGENTIC_STORAGE_ROOT;
  delete process.env.AGENTIC_DISABLE_RUNTIME_AUTOSTART;
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

  it("persists a file request timeline with approval metadata and no local path exposure in chat payload", async () => {
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
    expect(body).not.toContain("bound_file_path");
    expect(body).not.toContain("boundFilePath");
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
