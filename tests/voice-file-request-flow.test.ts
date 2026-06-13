import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { _resetDb, getDb } from "../src/db/connection.js";
import { ChatRepository } from "../src/chat/ChatRepository.js";
import { LocalCloudIdentityStore, defaultProfileId } from "../src/cloud/LocalCloudIdentityStore.js";

let tmpRoot: string;
let controlPlane: Server | null = null;
let controlPlaneUrl = "";
let relayPayload: Record<string, unknown> | null = null;

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), "voice-flow-"));
  process.env.AGENTIC_DB_PATH = join(tmpRoot, "agent.db");
  process.env.AGENTIC_DISABLE_RUNTIME_AUTOSTART = "true";
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
});

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
