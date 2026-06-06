import { createHash } from "node:crypto";
import { getDb } from "../db/connection.js";

const ZERO_HASH = "0".repeat(64);

export type AuditEventInput = {
  actorAgentId: string;
  taskId?: string;
  approvalId?: string;
  eventType: string;
  detailsJson: Record<string, unknown>;
};

export type AuditEvent = {
  id: number;
  actorAgentId: string;
  taskId: string | null;
  approvalId: string | null;
  eventType: string;
  detailsJson: Record<string, unknown>;
  previousHash: string;
  eventHash: string;
  createdAt: string;
};

function canonicalJson(obj: Record<string, unknown>): string {
  const sorted = Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify(sorted);
}

export function appendAuditEvent(input: AuditEventInput): AuditEvent {
  const db = getDb();
  const lastRow = db.prepare(
    "SELECT event_hash FROM audit_events ORDER BY id DESC LIMIT 1"
  ).get() as { event_hash: string } | undefined;

  const previousHash = lastRow?.event_hash ?? ZERO_HASH;
  const now = new Date().toISOString();

  const eventData = {
    actorAgentId: input.actorAgentId,
    taskId: input.taskId ?? null,
    approvalId: input.approvalId ?? null,
    eventType: input.eventType,
    detailsJson: input.detailsJson,
    createdAt: now,
  };
  const eventHash = createHash("sha256")
    .update(previousHash + canonicalJson(eventData as unknown as Record<string, unknown>))
    .digest("hex");

  const result = db.prepare(`
    INSERT INTO audit_events (actor_agent_id, task_id, approval_id, event_type, details_json, previous_hash, event_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.actorAgentId, input.taskId ?? null, input.approvalId ?? null,
    input.eventType, JSON.stringify(input.detailsJson),
    previousHash, eventHash, now
  );

  return {
    id: Number(result.lastInsertRowid),
    actorAgentId: input.actorAgentId,
    taskId: input.taskId ?? null,
    approvalId: input.approvalId ?? null,
    eventType: input.eventType,
    detailsJson: input.detailsJson,
    previousHash,
    eventHash,
    createdAt: now,
  };
}

export function verifyChain(): { valid: boolean; brokenAt?: number } {
  const db = getDb();
  const rows = db.prepare(
    "SELECT id, actor_agent_id, task_id, approval_id, event_type, details_json, previous_hash, event_hash, created_at FROM audit_events ORDER BY id ASC"
  ).all() as Array<Record<string, unknown>>;

  let prevHash = ZERO_HASH;
  for (const row of rows) {
    const eventData = {
      actorAgentId: row.actor_agent_id,
      taskId: row.task_id,
      approvalId: row.approval_id,
      eventType: row.event_type,
      detailsJson: JSON.parse(row.details_json as string),
      createdAt: row.created_at,
    };
    const expected = createHash("sha256")
      .update(prevHash + canonicalJson(eventData as unknown as Record<string, unknown>))
      .digest("hex");

    if (expected !== row.event_hash) {
      return { valid: false, brokenAt: Number(row.id) };
    }
    prevHash = row.event_hash as string;
  }
  return { valid: true };
}

export function getEvents(limit = 100): AuditEvent[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM audit_events ORDER BY id DESC LIMIT ?"
  ).all(limit) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    actorAgentId: r.actor_agent_id as string,
    taskId: (r.task_id as string | null) ?? null,
    approvalId: (r.approval_id as string | null) ?? null,
    eventType: r.event_type as string,
    detailsJson: JSON.parse(r.details_json as string),
    previousHash: r.previous_hash as string,
    eventHash: r.event_hash as string,
    createdAt: r.created_at as string,
  }));
}
