import { createHash, randomUUID } from "node:crypto";
import { getControlPlaneStore } from "../db/connection.js";
import type { ControlPlaneStore } from "../db/ControlPlaneStore.js";
import type { AuditEvent, OrgId, UserId, AgentInstanceId, AuditEventId } from "../types/cloud.js";

export interface AppendAuditEventInput {
  orgId: OrgId;
  actorUserId?: UserId | null;
  actorAgentInstanceId?: AgentInstanceId | null;
  eventType: string;
  details: Record<string, unknown>;
}

export async function appendAuditEvent(input: AppendAuditEventInput, store?: ControlPlaneStore): Promise<AuditEvent> {
  const conn = store ?? getControlPlaneStore();
  const id = `aud_${randomUUID()}`;
  const now = new Date().toISOString();
  const detailsJson = JSON.stringify(input.details);
  const last = await conn.one<{ event_hash: string | null }>(
    "SELECT event_hash FROM audit_events WHERE org_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1",
    [input.orgId]
  );
  const previousHash = last?.event_hash ?? null;
  const payloadToHash = `${id}|${input.orgId}|${input.actorUserId ?? ""}|${input.actorAgentInstanceId ?? ""}|${input.eventType}|${detailsJson}|${previousHash ?? ""}|${now}`;
  const eventHash = createHash("sha256").update(payloadToHash).digest("hex");
  await conn.execute(`
    INSERT INTO audit_events (id, org_id, actor_user_id, actor_agent_instance_id, event_type, details_json, previous_hash, event_hash, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [
    id,
    input.orgId,
    input.actorUserId ?? null,
    input.actorAgentInstanceId ?? null,
    input.eventType,
    detailsJson,
    previousHash,
    eventHash,
    now
  ]);
  return {
    id: id as AuditEventId,
    orgId: input.orgId,
    actorUserId: input.actorUserId ?? null,
    actorAgentInstanceId: input.actorAgentInstanceId ?? null,
    eventType: input.eventType,
    detailsJson,
    previousHash,
    eventHash,
    createdAt: now
  };
}

export async function listAuditEvents(orgId: OrgId, limit = 200, store?: ControlPlaneStore): Promise<AuditEvent[]> {
  const conn = store ?? getControlPlaneStore();
  const rows = await conn.query("SELECT * FROM audit_events WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2", [
    orgId,
    limit
  ]);
  return rows.map(rowToAudit);
}

export async function verifyAuditChain(orgId: OrgId, store?: ControlPlaneStore): Promise<{ valid: boolean; brokenAt?: string }> {
  const conn = store ?? getControlPlaneStore();
  const rows = await conn.query("SELECT * FROM audit_events WHERE org_id = $1 ORDER BY created_at ASC, id ASC", [orgId]);
  let previousHash: string | null = null;
  for (const row of rows) {
    const payload = `${row.id}|${row.org_id}|${row.actor_user_id ?? ""}|${row.actor_agent_instance_id ?? ""}|${row.event_type}|${row.details_json}|${previousHash ?? ""}|${row.created_at}`;
    const expected = createHash("sha256").update(payload).digest("hex");
    if (expected !== row.event_hash) {
      return { valid: false, brokenAt: String(row.id) };
    }
    previousHash = row.event_hash as string;
  }
  return { valid: true };
}

function rowToAudit(row: Record<string, unknown>): AuditEvent {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    actorUserId: row.actor_user_id ? String(row.actor_user_id) : null,
    actorAgentInstanceId: row.actor_agent_instance_id ? String(row.actor_agent_instance_id) : null,
    eventType: String(row.event_type),
    detailsJson: String(row.details_json),
    previousHash: row.previous_hash ? String(row.previous_hash) : null,
    eventHash: row.event_hash ? String(row.event_hash) : null,
    createdAt: String(row.created_at)
  };
}
