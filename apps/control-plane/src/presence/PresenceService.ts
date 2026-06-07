import type { Database as DB } from "better-sqlite3";
import { getDb } from "../db/connection.js";
import { appendAuditEvent } from "../audit/CloudAuditService.js";
import type { AgentInstanceId, OrgId, PresenceStatus } from "../types/cloud.js";

export const HEARTBEAT_ONLINE_THRESHOLD_MS = 60_000;
export const HEARTBEAT_STALE_THRESHOLD_MS = 5 * 60_000;

export interface HeartbeatInput {
  agent_instance_id: AgentInstanceId;
  device_id?: string;
  agent_id?: string;
  version?: string;
  status: PresenceStatus;
  capabilities?: string[];
  agent_card_hash?: string;
  local_queue_depth?: number;
}

export interface HeartbeatResult {
  ok: true;
  server_time: string;
  next_heartbeat_seconds: number;
}

export function recordHeartbeat(
  orgId: OrgId,
  input: HeartbeatInput,
  opts: { db?: DB } = {}
): HeartbeatResult {
  const db = opts.db ?? getDb();
  const inst = db.prepare(`
    SELECT * FROM agent_instances WHERE org_id = ? AND id = ?
  `).get(orgId, input.agent_instance_id) as Record<string, unknown> | undefined;
  if (!inst) throw new Error("Agent instance not found");
  if (input.device_id && String(inst.device_id) !== input.device_id) {
    throw new Error("Device mismatch for agent instance");
  }
  if (input.agent_id && String(inst.agent_id) !== input.agent_id) {
    throw new Error("Agent mismatch for agent instance");
  }
  if (String(inst.status) === "revoked") throw new Error("Agent instance has been revoked");
  const now = new Date().toISOString();
  const capabilitiesJson = JSON.stringify(input.capabilities ?? []);
  db.prepare(`
    INSERT INTO presence (agent_instance_id, org_id, user_id, agent_id, device_id, status, last_heartbeat_at, current_version, capabilities_json, agent_card_hash, local_queue_depth)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_instance_id) DO UPDATE SET
      status=excluded.status,
      last_heartbeat_at=excluded.last_heartbeat_at,
      current_version=excluded.current_version,
      capabilities_json=excluded.capabilities_json,
      agent_card_hash=excluded.agent_card_hash,
      local_queue_depth=excluded.local_queue_depth
  `).run(
    input.agent_instance_id, orgId,
    String(inst.user_id), String(inst.agent_id), String(inst.device_id),
    input.status, now, input.version ?? null, capabilitiesJson,
    input.agent_card_hash ?? null,
    input.local_queue_depth ?? 0
  );
  db.prepare("UPDATE agent_instances SET last_seen_at = ? WHERE id = ?").run(now, input.agent_instance_id);
  db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(now, String(inst.device_id));
  appendAuditEvent({
    orgId, actorAgentInstanceId: input.agent_instance_id, eventType: "PRESENCE_HEARTBEAT",
    details: {
      status: input.status, version: input.version ?? null,
      local_queue_depth: input.local_queue_depth ?? 0
    }
  }, db);
  return {
    ok: true,
    server_time: now,
    next_heartbeat_seconds: 15
  };
}

export function recomputeStalePresence(db: DB = getDb()): number {
  const now = Date.now();
  const onlineCutoff = new Date(now - HEARTBEAT_ONLINE_THRESHOLD_MS).toISOString();
  const staleCutoff = new Date(now - HEARTBEAT_STALE_THRESHOLD_MS).toISOString();
  let count = 0;
  const r1 = db.prepare(`
    UPDATE presence SET status = 'stale'
    WHERE status = 'online' AND last_heartbeat_at < ?
  `).run(onlineCutoff);
  count += Number(r1.changes);
  const r2 = db.prepare(`
    UPDATE presence SET status = 'offline'
    WHERE status = 'stale' AND last_heartbeat_at < ?
  `).run(staleCutoff);
  count += Number(r2.changes);
  return count;
}

export function listPresence(
  orgId: string,
  opts: { db?: DB; status?: PresenceStatus } = {}
): Array<Record<string, unknown>> {
  const db = opts.db ?? getDb();
  if (opts.status) {
    return db.prepare(`
      SELECT * FROM presence WHERE org_id = ? AND status = ? ORDER BY last_heartbeat_at DESC
    `).all(orgId, opts.status) as Array<Record<string, unknown>>;
  }
  return db.prepare(`
    SELECT * FROM presence WHERE org_id = ? ORDER BY last_heartbeat_at DESC
  `).all(orgId) as Array<Record<string, unknown>>;
}
