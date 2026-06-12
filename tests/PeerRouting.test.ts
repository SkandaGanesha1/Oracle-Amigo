import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChatRepository } from "../src/chat/ChatRepository.js";
import { LocalCloudIdentityStore, defaultProfileId } from "../src/cloud/LocalCloudIdentityStore.js";
import { _resetDb } from "../src/db/connection.js";
import { PeerRoutingService } from "../src/runtime/PeerRoutingService.js";
import { normalizePeerPresence } from "../ui/src/lib/normalizePeerPresence.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "peer-routing-"));
  process.env.AGENTIC_DB_PATH = join(tmpRoot, "agent.db");
  process.env.AGENTIC_DISABLE_RUNTIME_AUTOSTART = "true";
  _resetDb();
});

afterEach(() => {
  _resetDb();
  delete process.env.AGENTIC_DB_PATH;
  delete process.env.AGENTIC_DISABLE_RUNTIME_AUTOSTART;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("peer routing and presence hardening", () => {
  it("repairs a stale peer agent route to the current online instance", async () => {
    const controlPlane = await startDirectoryControlPlane();
    const store = new LocalCloudIdentityStore();
    store.save(defaultProfileId(), {
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
    const repo = new ChatRepository();
    const conversation = repo.createConversation({
      title: "Remote agent agi-old",
      mode: "cloud_relay",
      localAgentInstanceId: "agi-local",
      peerAgentInstanceId: "agi-old"
    });
    const routing = new PeerRoutingService(repo, { identityStore: store, profileId: defaultProfileId() });

    const repaired = await routing.refreshConversationPeer(conversation, {
      cloud: store.get(defaultProfileId()),
      capability: "message.send"
    });

    expect(repaired).toMatchObject({
      peer_user_id: "usr-peer",
      peer_agent_instance_id: "agi-current",
      title: "Docin"
    });
    await controlPlane.close();
  });

  it("normalizes peer presence without treating unknown as offline", () => {
    expect(normalizePeerPresence({ presence: "online", agentInstanceId: "agi-current" })).toMatchObject({
      status: "online",
      label: "Online"
    });
    expect(normalizePeerPresence({ presence: "unknown", agentInstanceId: "agi-current" })).toMatchObject({
      status: "unavailable",
      label: "Presence unavailable"
    });
    expect(normalizePeerPresence({
      presence: "online",
      agentInstanceId: "agi-old",
      activeAgentInstanceId: "agi-current"
    })).toMatchObject({
      status: "stale",
      reason: "stale_route",
      label: "Old agent route - switch to current agent"
    });
  });

  it("updates delivery status for all local messages tied to a relay task", () => {
    const repo = new ChatRepository();
    const conversation = repo.createConversation({
      title: "Docin",
      mode: "cloud_relay",
      peerUserId: "usr-peer",
      peerAgentInstanceId: "agi-current"
    });
    repo.appendMessage({
      id: "msg-relay",
      conversationId: conversation.id,
      senderAgentInstanceId: "agi-local",
      receiverAgentInstanceId: "agi-current",
      messageType: "human",
      text: "hello",
      payload: { relay_task_id: "relay-status-test" },
      deliveryStatus: "queued_at_relay"
    });

    const updated = repo.updateDeliveryStatusForRelayTask("relay-status-test", "stored_by_remote_agent", {
      relay_task_id: "relay-status-test",
      status: "stored_by_remote_agent",
      delivered_at: "2026-06-11T00:00:00.000Z",
      from_agent_instance_id: "agi-current",
      to_agent_instance_id: "agi-local"
    });

    expect(updated).toHaveLength(1);
    expect(repo.getMessage("msg-relay")).toMatchObject({ delivery_status: "stored_by_remote_agent" });
    expect(repo.getMessage("msg-relay")?.payload_json.delivery_receipt).toMatchObject({
      status: "stored_by_remote_agent"
    });
  });
});

async function startDirectoryControlPlane(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
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
        active_agent_instances: 1,
        agents: [
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
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "NOT_FOUND", url: req.url }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to start directory test control plane");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
  };
}
