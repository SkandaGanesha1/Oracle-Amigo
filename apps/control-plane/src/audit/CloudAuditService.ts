import { createHash, randomUUID } from "node:crypto";
import type { Database as DB } from "better-sqlite3";
import { getDb } from "../db/connection.js";
import type { AuditEvent, OrgId, UserId, AgentInstanceId, AuditEventId } from "../types/cloud.js";

export interface AppendAuditEventInput {
  orgId: OrgId;
  actorUserId?: UserId | null;
  actorAgentInstanceId?: AgentInstanceId | null;
  eventType: string;
  details: Record<string, unknown>;
}

export function appendAuditEvent(input: AppendAuditEventInput, db?: DB): AuditEvent {
  const conn = db ?? getDb();
  const id = `aud_${randomUUID()}`;
  const now = new Date().toISOString();
  const detailsJson = JSON.stringify(input.details);
  const last = conn
    .prepare("SELECT event_hash FROM audit_events WHERE org_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
    .get(input.orgId) as { event_hash: string | null } | undefined;
  const previousHash = last?.event_hash ?? null;
  const payloadToHash = `${id}|${input.orgId}|${input.actorUserId ?? ""}|${input.actorAgentInstanceId ?? ""}|${input.eventType}|${detailsJson}|${previousHash ?? ""}|${now}`;
  const eventHash = createHash("sha256").update(payloadToHash).digest("hex");
  conn.prepare(`
    INSERT INTO audit_events (id, org_id, actor_user_id, actor_agent_instance_id, event_type, details_json, previous_hash, event_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.orgId,
    input.actorUserId ?? null,
    input.actorAgentInstanceId ?? null,
    input.eventType,
    detailsJson,
    previousHash,
    eventHash,
    now
  );
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

export function listAuditEvents(orgId: OrgId, limit = 200, db?: DB): AuditEvent[] {
  const conn = db ?? getDb();
  const rows = conn
    .prepare("SELECT * FROM audit_events WHERE org_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(orgId, limit) as Array<Record<string, unknown>>;
  return rows.map(rowToAudit);
}

export function verifyAuditChain(orgId: OrgId, db?: DB): { valid: boolean; brokenAt?: string } {
  const conn = db ?? getDb();
  const rows = conn
    .prepare("SELECT * FROM audit_events WHERE org_id = ? ORDER BY created_at ASC, id ASC")
    .all(orgId) as Array<Record<string, unknown>>;
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
