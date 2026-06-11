import type { Database as DB } from "better-sqlite3";
import { getDb } from "../db/connection.js";
import type { OrgId, UserId } from "../types/cloud.js";
import { agentCardUrl, relayInboxUrl } from "../enrollment/CloudAgentCard.js";

export interface DirectoryUser {
  user_id: UserId;
  display_name: string;
  email: string;
  status: string;
  active_agent_instances: number;
  presence: string;
  agents: Array<{
    agent_id: string;
    agent_instance_id: string;
    device_id: string;
    display_name: string;
    device_name: string;
    status: string;
    capabilities: string[];
    relay_inbox_url: string;
    agent_card_url: string;
    agent_card_hash: string;
    last_heartbeat_at: string | null;
  }>;
}

export interface DirectoryAgentInstance {
  user_id: UserId;
  display_name: string;
  email: string;
  agent_id: string;
  agent_instance_id: string;
  device_id: string;
  device_name: string;
  status: string;
  relay_inbox_url: string;
  agent_card_url: string;
  agent_card_hash: string;
  last_seen_at: string | null;
}

export function searchUsers(
  orgId: OrgId,
  query: string,
  opts: { limit?: number; db?: DB; publicBaseUrl?: string } = {}
): DirectoryUser[] {
  const db = opts.db ?? getDb();
  const publicBaseUrl = opts.publicBaseUrl ?? "http://localhost:8080";
  const limit = opts.limit ?? 50;
  const q = `%${query.toLowerCase().trim()}%`;
  const userRows = db.prepare(`
    SELECT u.id, u.display_name, u.email
    FROM users u
    WHERE u.org_id = ? AND u.status = 'active'
      AND (lower(u.email) LIKE ? OR lower(u.display_name) LIKE ?)
    ORDER BY u.display_name
    LIMIT ?
  `).all(orgId, q, q, limit) as Array<{ id: string; display_name: string; email: string }>;

  if (userRows.length === 0) return [];
  const userIds = userRows.map((u) => u.id);
  const placeholders = userIds.map(() => "?").join(",");
  const instanceRows = db.prepare(`
    SELECT ai.id AS instance_id, ai.agent_id, ai.device_id, ai.user_id, ai.status,
           ai.relay_inbox_id, ai.agent_card_hash,
           d.device_name, p.status AS presence_status, p.last_heartbeat_at, p.capabilities_json
    FROM agent_instances ai
    JOIN devices d ON d.id = ai.device_id
    LEFT JOIN presence p ON p.agent_instance_id = ai.id
    WHERE ai.org_id = ? AND ai.user_id IN (${placeholders})
      AND ai.status = 'active'
  `).all(orgId, ...userIds) as Array<Record<string, unknown>>;

  const byUser = new Map<string, DirectoryUser>();
  for (const u of userRows) {
    byUser.set(u.id, {
      user_id: u.id,
      display_name: u.display_name,
      email: u.email,
      status: "offline",
      active_agent_instances: 0,
      presence: "offline",
      agents: []
    });
  }
  for (const inst of instanceRows) {
    const u = byUser.get(String(inst.user_id));
    if (!u) continue;
    let caps: string[] = [];
    try {
      caps = inst.capabilities_json ? JSON.parse(String(inst.capabilities_json)) : [];
    } catch { caps = []; }
    u.agents.push({
      agent_id: String(inst.agent_id),
      agent_instance_id: String(inst.instance_id),
      device_id: String(inst.device_id),
      display_name: String(inst.device_name),
      device_name: String(inst.device_name),
      status: String(inst.presence_status ?? "offline"),
      capabilities: caps,
      relay_inbox_url: relayInboxUrl(publicBaseUrl),
      agent_card_url: agentCardUrl(publicBaseUrl, String(inst.instance_id)),
      agent_card_hash: String(inst.agent_card_hash),
      last_heartbeat_at: inst.last_heartbeat_at ? String(inst.last_heartbeat_at) : null
    });
  }
  // Determine top-level presence
  for (const u of byUser.values()) {
    const online = u.agents.some((a) => a.status === "online");
    const stale = u.agents.some((a) => a.status === "stale");
    u.presence = online ? "online" : stale ? "stale" : "offline";
    u.status = u.presence;
    u.active_agent_instances = u.agents.length;
  }
  return Array.from(byUser.values());
}

export function getUserAgents(
  orgId: OrgId,
  userId: UserId,
  opts: { db?: DB; publicBaseUrl?: string } = {}
): DirectoryUser | null {
  const db = opts.db ?? getDb();
  const publicBaseUrl = opts.publicBaseUrl ?? "http://localhost:8080";
  const userRow = db.prepare(`
    SELECT id, display_name, email FROM users
    WHERE org_id = ? AND id = ? AND status = 'active'
  `).get(orgId, userId) as { id: string; display_name: string; email: string } | undefined;
  if (!userRow) return null;
  const result: DirectoryUser = {
    user_id: userRow.id,
    display_name: userRow.display_name,
    email: userRow.email,
    status: "offline",
    active_agent_instances: 0,
    presence: "offline",
    agents: []
  };
  const instanceRows = db.prepare(`
    SELECT ai.id AS instance_id, ai.agent_id, ai.device_id, ai.user_id, ai.status,
           ai.relay_inbox_id, ai.agent_card_hash,
           d.device_name, p.status AS presence_status, p.last_heartbeat_at, p.capabilities_json
    FROM agent_instances ai
    JOIN devices d ON d.id = ai.device_id
    LEFT JOIN presence p ON p.agent_instance_id = ai.id
    WHERE ai.org_id = ? AND ai.user_id = ? AND ai.status = 'active'
  `).all(orgId, userId) as Array<Record<string, unknown>>;
  for (const inst of instanceRows) {
    let caps: string[] = [];
    try { caps = inst.capabilities_json ? JSON.parse(String(inst.capabilities_json)) : []; } catch { caps = []; }
    result.agents.push({
      agent_id: String(inst.agent_id),
      agent_instance_id: String(inst.instance_id),
      device_id: String(inst.device_id),
      display_name: String(inst.device_name),
      device_name: String(inst.device_name),
      status: String(inst.presence_status ?? "offline"),
      capabilities: caps,
      relay_inbox_url: relayInboxUrl(publicBaseUrl),
      agent_card_url: agentCardUrl(publicBaseUrl, String(inst.instance_id)),
      agent_card_hash: String(inst.agent_card_hash),
      last_heartbeat_at: inst.last_heartbeat_at ? String(inst.last_heartbeat_at) : null
    });
  }
  const online = result.agents.some((a) => a.status === "online");
  const stale = result.agents.some((a) => a.status === "stale");
  result.presence = online ? "online" : stale ? "stale" : "offline";
  result.status = result.presence;
  result.active_agent_instances = result.agents.length;
  return result;
}

export function getAgentInstance(
  orgId: OrgId,
  agentInstanceId: string,
  opts: { db?: DB; publicBaseUrl?: string } = {}
): DirectoryAgentInstance | null {
  const db = opts.db ?? getDb();
  const publicBaseUrl = opts.publicBaseUrl ?? "http://localhost:8080";
  const row = db.prepare(`
    SELECT ai.id AS instance_id, ai.agent_id, ai.device_id, ai.user_id,
           ai.agent_card_hash, u.display_name, u.email,
           d.device_name, p.status AS presence_status, p.last_heartbeat_at
    FROM agent_instances ai
    JOIN users u ON u.id = ai.user_id
    JOIN devices d ON d.id = ai.device_id
    LEFT JOIN presence p ON p.agent_instance_id = ai.id
    WHERE ai.org_id = ? AND ai.id = ?
      AND ai.status = 'active'
      AND u.status = 'active'
  `).get(orgId, agentInstanceId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    user_id: String(row.user_id),
    display_name: String(row.display_name),
    email: String(row.email),
    agent_id: String(row.agent_id),
    agent_instance_id: String(row.instance_id),
    device_id: String(row.device_id),
    device_name: String(row.device_name),
    status: String(row.presence_status ?? "offline"),
    relay_inbox_url: relayInboxUrl(publicBaseUrl),
    agent_card_url: agentCardUrl(publicBaseUrl, String(row.instance_id)),
    agent_card_hash: String(row.agent_card_hash),
    last_seen_at: row.last_heartbeat_at ? String(row.last_heartbeat_at) : null
  };
}
