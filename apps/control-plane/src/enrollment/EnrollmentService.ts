import { createHash, randomUUID } from "node:crypto";
import type { Database as DB } from "better-sqlite3";
import { getDb } from "../db/connection.js";
import { issueDeviceToken } from "./../auth/TokenService.js";
import { appendAuditEvent } from "./../audit/CloudAuditService.js";
import type {
  Agent, AgentId, AgentInstance, AgentInstanceId, AuthContext,
  Device, DeviceId, OrgId, UserId
} from "./../types/cloud.js";

export interface EnrollmentInput {
  device: {
    device_name: string;
    os?: string;
    os_version?: string;
    public_key: string;
    did?: string;
  };
  agent: {
    display_name: string;
    version?: string;
    capabilities?: string[];
    agent_card: Record<string, unknown>;
  };
}

export interface EnrollmentResult {
  org_id: OrgId;
  user_id: UserId;
  device_id: DeviceId;
  agent_id: AgentId;
  agent_instance_id: AgentInstanceId;
  relay_inbox_id: string;
  relay_inbox_url: string;
  agent_card_url: string;
  device_access_token: string;
  refresh_token: string;
  expires_in: number;
}

function canonicalizeCard(card: Record<string, unknown>): string {
  const sortedKeys = Object.keys(card).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of sortedKeys) sorted[k] = card[k];
  return JSON.stringify(sorted);
}

function fingerprintPublicKey(publicKey: string): string {
  return createHash("sha256").update(publicKey.toLowerCase()).digest("hex");
}

function hashAgentCard(card: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalizeCard(card)).digest("hex");
}

export async function enroll(
  auth: AuthContext,
  input: EnrollmentInput,
  opts: {
    publicBaseUrl: string;
    db?: DB;
  }
): Promise<EnrollmentResult> {
  const conn = opts.db ?? getDb();
  const now = new Date().toISOString();
  const publicKey = input.device.public_key.trim();
  if (!publicKey) throw new Error("public_key is required");
  if (publicKey.length < 32) throw new Error("public_key appears too short");
  if (!input.device.device_name.trim()) throw new Error("device_name is required");
  if (!input.agent.display_name.trim()) throw new Error("agent.display_name is required");
  if (!input.agent.agent_card || typeof input.agent.agent_card !== "object") {
    throw new Error("agent.agent_card is required");
  }
  const fingerprint = fingerprintPublicKey(publicKey);

  let device: Device | null = null;
  const existingDevice = conn
    .prepare("SELECT * FROM devices WHERE org_id = ? AND public_key_fingerprint = ?")
    .get(auth.orgId, fingerprint) as Record<string, unknown> | undefined;
  if (existingDevice) {
    if (existingDevice.user_id !== auth.userId) {
      throw new Error("Device public key already enrolled by another user");
    }
    conn.prepare(`
      UPDATE devices SET device_name = ?, os = ?, os_version = ?, did = ?, status = 'active', last_seen_at = ?
      WHERE id = ?
    `).run(
      input.device.device_name.trim(),
      input.device.os ?? null,
      input.device.os_version ?? null,
      input.device.did ?? null,
      now,
      existingDevice.id
    );
    device = {
      id: String(existingDevice.id),
      orgId: String(existingDevice.org_id),
      userId: String(existingDevice.user_id),
      deviceName: input.device.device_name.trim(),
      os: input.device.os ?? null,
      osVersion: input.device.os_version ?? null,
      publicKey,
      publicKeyFingerprint: fingerprint,
      did: input.device.did ?? null,
      status: "active",
      createdAt: String(existingDevice.created_at),
      lastSeenAt: now
    };
  } else {
    const deviceId = `dev_${randomUUID()}`;
    conn.prepare(`
      INSERT INTO devices (id, org_id, user_id, device_name, os, os_version, public_key, public_key_fingerprint, did, status, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      deviceId, auth.orgId, auth.userId,
      input.device.device_name.trim(),
      input.device.os ?? null,
      input.device.os_version ?? null,
      publicKey, fingerprint,
      input.device.did ?? null,
      now, now
    );
    device = {
      id: deviceId, orgId: auth.orgId, userId: auth.userId,
      deviceName: input.device.device_name.trim(),
      os: input.device.os ?? null, osVersion: input.device.os_version ?? null,
      publicKey, publicKeyFingerprint: fingerprint,
      did: input.device.did ?? null,
      status: "active", createdAt: now, lastSeenAt: now
    };
  }

  // Find or create the personal agent (1:1 user:agent by default)
  let agent: Agent | null = null;
  const existingAgent = conn
    .prepare("SELECT * FROM agents WHERE org_id = ? AND owner_user_id = ? AND display_name = ?")
    .get(auth.orgId, auth.userId, input.agent.display_name.trim()) as Record<string, unknown> | undefined;
  if (existingAgent) {
    conn.prepare("UPDATE agents SET status = 'active' WHERE id = ?").run(existingAgent.id);
    agent = {
      id: String(existingAgent.id),
      orgId: String(existingAgent.org_id),
      ownerUserId: String(existingAgent.owner_user_id),
      displayName: String(existingAgent.display_name),
      status: "active",
      createdAt: String(existingAgent.created_at)
    };
  } else {
    const agentId = `agt_${randomUUID()}`;
    conn.prepare(`
      INSERT INTO agents (id, org_id, owner_user_id, display_name, status, created_at)
      VALUES (?, ?, ?, ?, 'active', ?)
    `).run(agentId, auth.orgId, auth.userId, input.agent.display_name.trim(), now);
    agent = {
      id: agentId, orgId: auth.orgId, ownerUserId: auth.userId,
      displayName: input.agent.display_name.trim(),
      status: "active", createdAt: now
    };
  }

  // Find or create agent_instance for (agent, device)
  const agentCardJson = JSON.stringify(input.agent.agent_card);
  const agentCardHash = hashAgentCard(input.agent.agent_card);
  let instance: AgentInstance | null = null;
  const existingInstance = conn
    .prepare("SELECT * FROM agent_instances WHERE org_id = ? AND agent_id = ? AND device_id = ?")
    .get(auth.orgId, agent.id, device.id) as Record<string, unknown> | undefined;
  if (existingInstance) {
    conn.prepare(`
      UPDATE agent_instances SET agent_card_json = ?, agent_card_hash = ?, version = ?, status = 'active', last_seen_at = ?
      WHERE id = ?
    `).run(agentCardJson, agentCardHash, input.agent.version ?? null, now, existingInstance.id);
    instance = {
      id: String(existingInstance.id),
      orgId: String(existingInstance.org_id),
      agentId: String(existingInstance.agent_id),
      deviceId: String(existingInstance.device_id),
      userId: String(existingInstance.user_id),
      agentCardJson,
      agentCardHash,
      relayInboxId: String(existingInstance.relay_inbox_id),
      version: input.agent.version ?? null,
      status: "active",
      createdAt: String(existingInstance.created_at),
      lastSeenAt: now
    };
  } else {
    const instanceId = `agi_${randomUUID()}`;
    const relayInboxId = `rin_${randomUUID()}`;
    conn.prepare(`
      INSERT INTO agent_instances (id, org_id, agent_id, device_id, user_id, agent_card_json, agent_card_hash, relay_inbox_id, version, status, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      instanceId, auth.orgId, agent.id, device.id, auth.userId,
      agentCardJson, agentCardHash, relayInboxId,
      input.agent.version ?? null, now, now
    );
    instance = {
      id: instanceId, orgId: auth.orgId, agentId: agent.id, deviceId: device.id, userId: auth.userId,
      agentCardJson, agentCardHash, relayInboxId,
      version: input.agent.version ?? null,
      status: "active", createdAt: now, lastSeenAt: now
    };
  }

  // Upsert presence row
  const capabilitiesJson = JSON.stringify(input.agent.capabilities ?? []);
  conn.prepare(`
    INSERT INTO presence (agent_instance_id, org_id, user_id, agent_id, device_id, status, last_heartbeat_at, current_version, capabilities_json, agent_card_hash, local_queue_depth)
    VALUES (?, ?, ?, ?, ?, 'online', ?, ?, ?, ?, 0)
    ON CONFLICT(agent_instance_id) DO UPDATE SET
      status='online', last_heartbeat_at=excluded.last_heartbeat_at,
      current_version=excluded.current_version,
      capabilities_json=excluded.capabilities_json,
      agent_card_hash=excluded.agent_card_hash
  `).run(
    instance.id, auth.orgId, auth.userId, agent.id, device.id,
    now, input.agent.version ?? null, capabilitiesJson, agentCardHash
  );

  // Issue device token + opaque refresh token
  const deviceToken = issueDeviceToken({
    agentInstanceId: instance.id,
    agentId: agent.id,
    deviceId: device.id,
    userId: auth.userId,
    orgId: auth.orgId
  });
  const opaqueRefresh = (await import("./../auth/TokenService.js")).generateOpaqueToken();
  const deviceRefreshId = `drt_${randomUUID()}`;
  conn.prepare(`
    INSERT INTO device_tokens (id, org_id, user_id, device_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    `dat_${randomUUID()}`, auth.orgId, auth.userId, device.id,
    deviceToken.tokenHash,
    new Date(Date.now() + deviceToken.expiresIn * 1000).toISOString(),
    now
  );
  conn.prepare(`
    INSERT INTO device_tokens (id, org_id, user_id, device_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    deviceRefreshId, auth.orgId, auth.userId, device.id,
    opaqueRefresh.hash,
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    now
  );

  appendAuditEvent({
    orgId: auth.orgId,
    actorUserId: auth.userId,
    actorAgentInstanceId: instance.id,
    eventType: "DEVICE_AGENT_ENROLLED",
    details: {
      device_id: device.id,
      device_name: device.deviceName,
      agent_id: agent.id,
      agent_instance_id: instance.id,
      agent_card_hash: agentCardHash,
      version: input.agent.version ?? null
    }
  }, conn);

  const relayInboxUrl = `${opts.publicBaseUrl}/v1/relay/a2a/inbox`;
  const agentCardUrl = `${opts.publicBaseUrl}/v1/agents/${instance.id}/card`;

  return {
    org_id: auth.orgId,
    user_id: auth.userId,
    device_id: device.id,
    agent_id: agent.id,
    agent_instance_id: instance.id,
    relay_inbox_id: instance.relayInboxId,
    relay_inbox_url: relayInboxUrl,
    agent_card_url: agentCardUrl,
    device_access_token: deviceToken.token,
    refresh_token: opaqueRefresh.token,
    expires_in: deviceToken.expiresIn
  };
}
