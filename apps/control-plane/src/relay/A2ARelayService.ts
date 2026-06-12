import { randomUUID } from "node:crypto";
import type { Database as DB } from "better-sqlite3";
import { getDb } from "../db/connection.js";
import { appendAuditEvent } from "../audit/CloudAuditService.js";
import type {
  AgentInstanceId, OrgId, RelayMessage, RelayMessageStatus,
  RelayTask, RelayTaskStatus
} from "../types/cloud.js";

export interface RelaySendInput {
  orgId: OrgId;
  fromAgentInstanceId: AgentInstanceId;
  toAgentInstanceId: AgentInstanceId;
  a2aTaskId: string;
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface RelaySendResult {
  relay_task_id: string;
  relay_message_id: string;
  status: RelayTaskStatus;
}

function assertActiveInstance(
  db: DB,
  orgId: OrgId,
  instanceId: AgentInstanceId,
  field: "from" | "to"
): void {
  const row = db.prepare(`
    SELECT * FROM agent_instances WHERE org_id = ? AND id = ?
  `).get(orgId, instanceId) as Record<string, unknown> | undefined;
  if (!row) throw new Error(`Target ${field} agent instance not found`);
  if (String(row.status) !== "active") throw new Error(`Target ${field} agent instance is ${row.status}`);
}

export function sendRelay(input: RelaySendInput, opts: { db?: DB } = {}): RelaySendResult {
  const db = opts.db ?? getDb();
  assertActiveInstance(db, input.orgId, input.fromAgentInstanceId, "from");
  assertActiveInstance(db, input.orgId, input.toAgentInstanceId, "to");
  if (input.fromAgentInstanceId === input.toAgentInstanceId) {
    throw new Error("Cannot send a relay message to the same agent instance");
  }
  if (!input.a2aTaskId.trim()) throw new Error("a2a_task_id is required");
  if (!input.type.trim()) throw new Error("type is required");

  if (input.idempotencyKey) {
    const existing = db.prepare(`
      SELECT id, relay_task_id FROM relay_messages
      WHERE org_id = ? AND from_agent_instance_id = ? AND idempotency_key = ?
    `).get(input.orgId, input.fromAgentInstanceId, input.idempotencyKey) as
      { id: string; relay_task_id: string | null } | undefined;
    if (existing) {
      const taskStatus = existing.relay_task_id ?
        (db.prepare("SELECT status FROM relay_tasks WHERE id = ?").get(existing.relay_task_id) as { status: RelayTaskStatus } | undefined)?.status ?? "pending" :
        "pending";
      return { relay_task_id: existing.relay_task_id ?? "", relay_message_id: existing.id, status: taskStatus };
    }
  }

  const now = new Date().toISOString();
  const taskId = `rt_${randomUUID()}`;
  const messageId = `rm_${randomUUID()}`;
  const payloadJson = JSON.stringify(input.payload);

  db.prepare("BEGIN").run();
  try {
    db.prepare(`
      INSERT INTO relay_tasks (id, org_id, from_agent_instance_id, to_agent_instance_id, a2a_task_id, type, payload_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      taskId, input.orgId, input.fromAgentInstanceId, input.toAgentInstanceId,
      input.a2aTaskId, input.type, payloadJson, now, now
    );
    db.prepare(`
      INSERT INTO relay_messages (id, org_id, relay_task_id, from_agent_instance_id, to_agent_instance_id, payload_json, status, idempotency_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      messageId, input.orgId, taskId, input.fromAgentInstanceId, input.toAgentInstanceId,
      payloadJson, input.idempotencyKey ?? null, now
    );
    appendAuditEvent({
      orgId: input.orgId,
      actorAgentInstanceId: input.fromAgentInstanceId,
      eventType: "RELAY_MESSAGE_SENT",
      details: {
        relay_task_id: taskId,
        relay_message_id: messageId,
        to_agent_instance_id: input.toAgentInstanceId,
        type: input.type,
        a2a_task_id: input.a2aTaskId
      }
    }, db);
  } catch (e) {
    db.prepare("ROLLBACK").run();
    throw e;
  }
  db.prepare("COMMIT").run();
  return { relay_task_id: taskId, relay_message_id: messageId, status: "pending" };
}

export interface InboxFetchInput {
  orgId: OrgId;
  toAgentInstanceId: AgentInstanceId;
  maxBatch?: number;
  markDelivered?: boolean;
}

export interface InboxItem {
  relay_task_id: string;
  relay_message_id: string;
  from_agent_instance_id: AgentInstanceId;
  to_agent_instance_id: AgentInstanceId;
  a2a_task_id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export function fetchInbox(input: InboxFetchInput, opts: { db?: DB } = {}): InboxItem[] {
  const db = opts.db ?? getDb();
  const limit = Math.min(input.maxBatch ?? 50, 500);
  const rows = db.prepare(`
    SELECT m.id AS message_id, m.relay_task_id, m.from_agent_instance_id, m.to_agent_instance_id,
           m.payload_json, m.created_at, t.a2a_task_id, t.type
    FROM relay_messages m
    JOIN relay_tasks t ON t.id = m.relay_task_id
    WHERE m.org_id = ? AND m.to_agent_instance_id = ? AND m.status = 'pending'
    ORDER BY m.created_at ASC
    LIMIT ?
  `).all(input.orgId, input.toAgentInstanceId, limit) as Array<Record<string, unknown>>;
  if (input.markDelivered && rows.length > 0) {
    const now = new Date().toISOString();
    const ids = rows.map((r) => String(r.message_id));
    const placeholders = ids.map(() => "?").join(",");
    db.prepare(`
      UPDATE relay_messages SET status = 'delivered', delivered_at = ?
      WHERE id IN (${placeholders})
    `).run(now, ...ids);
    const taskIds = Array.from(new Set(rows.map((r) => String(r.relay_task_id))));
    const tPlaceholders = taskIds.map(() => "?").join(",");
    db.prepare(`
      UPDATE relay_tasks SET status = 'delivered', delivered_at = ?, updated_at = ?
      WHERE id IN (${tPlaceholders}) AND status = 'pending'
    `).run(now, now, ...taskIds);
    appendAuditEvent({
      orgId: input.orgId, actorAgentInstanceId: input.toAgentInstanceId,
      eventType: "RELAY_INBOX_DELIVERED",
      details: { count: rows.length, task_ids: taskIds }
    }, db);
  }
  return rows.map((r) => ({
    relay_task_id: String(r.relay_task_id),
    relay_message_id: String(r.message_id),
    from_agent_instance_id: String(r.from_agent_instance_id),
    to_agent_instance_id: String(r.to_agent_instance_id),
    a2a_task_id: String(r.a2a_task_id),
    type: String(r.type),
    payload: safeParse(r.payload_json),
    created_at: String(r.created_at)
  }));
}

export function ackRelay(
  orgId: OrgId,
  relayTaskId: string,
  agentInstanceId: AgentInstanceId,
  opts: { db?: DB } = {}
): { ok: true; status: RelayTaskStatus } {
  const db = opts.db ?? getDb();
  const row = db.prepare(`
    SELECT * FROM relay_tasks WHERE org_id = ? AND id = ?
  `).get(orgId, relayTaskId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("Relay task not found");
  if (String(row.to_agent_instance_id) !== agentInstanceId) {
    throw new Error("Not authorized to ack this relay task");
  }
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE relay_messages SET status = 'acked' WHERE relay_task_id = ? AND status IN ('pending','delivered')
  `).run(relayTaskId);
  db.prepare(`
    UPDATE relay_tasks SET status = 'delivered', delivered_at = COALESCE(delivered_at, ?), updated_at = ?
    WHERE id = ?
  `).run(now, now, relayTaskId);
  appendAuditEvent({
    orgId, actorAgentInstanceId: agentInstanceId, eventType: "RELAY_TASK_ACKED",
    details: { relay_task_id: relayTaskId }
  }, db);
  return { ok: true, status: "delivered" };
}

export function respondRelay(
  orgId: OrgId,
  relayTaskId: string,
  agentInstanceId: AgentInstanceId,
  responsePayload: Record<string, unknown>,
  opts: { db?: DB } = {}
): { ok: true; status: RelayTaskStatus } {
  const db = opts.db ?? getDb();
  const row = db.prepare(`
    SELECT * FROM relay_tasks WHERE org_id = ? AND id = ?
  `).get(orgId, relayTaskId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("Relay task not found");
  if (String(row.to_agent_instance_id) !== agentInstanceId) {
    throw new Error("Not authorized to respond to this relay task");
  }
  const now = new Date().toISOString();
  db.prepare("BEGIN").run();
  try {
    db.prepare(`
      INSERT INTO relay_messages (id, org_id, relay_task_id, from_agent_instance_id, to_agent_instance_id, payload_json, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'responded', ?)
    `).run(
      `rm_${randomUUID()}`, orgId, relayTaskId,
      agentInstanceId, String(row.from_agent_instance_id),
      JSON.stringify({ kind: "response", payload: responsePayload }),
      now
    );
    db.prepare(`
      UPDATE relay_tasks SET status = 'completed', completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, relayTaskId);
    appendAuditEvent({
      orgId, actorAgentInstanceId: agentInstanceId, eventType: "RELAY_TASK_RESPONDED",
      details: { relay_task_id: relayTaskId }
    }, db);
  } catch (e) {
    db.prepare("ROLLBACK").run();
    throw e;
  }
  db.prepare("COMMIT").run();
  return { ok: true, status: "completed" };
}

export function getRelayTask(
  orgId: OrgId,
  relayTaskId: string,
  agentInstanceId: AgentInstanceId | null,
  opts: { db?: DB } = {}
): RelayTask | null {
  const db = opts.db ?? getDb();
  const row = db.prepare(`SELECT * FROM relay_tasks WHERE org_id = ? AND id = ?`).get(orgId, relayTaskId) as
    Record<string, unknown> | undefined;
  if (!row) return null;
  if (agentInstanceId) {
    const sender = String(row.from_agent_instance_id);
    const receiver = String(row.to_agent_instance_id);
    if (sender !== agentInstanceId && receiver !== agentInstanceId) {
      throw new Error("Not authorized to view this relay task");
    }
  }
  const responseRow = db.prepare(`
    SELECT payload_json
    FROM relay_messages
    WHERE org_id = ? AND relay_task_id = ? AND status = 'responded'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(orgId, relayTaskId) as Record<string, unknown> | undefined;
  const responseEnvelope = safeParse(responseRow?.payload_json);
  const responsePayload = responseEnvelope && typeof responseEnvelope.payload === "object" && responseEnvelope.payload !== null
    ? responseEnvelope.payload as Record<string, unknown>
    : null;
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    fromAgentInstanceId: sender(row),
    toAgentInstanceId: receiver(row),
    a2aTaskId: String(row.a2a_task_id),
    type: String(row.type),
    payloadJson: String(row.payload_json),
    status: String(row.status) as RelayTaskStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deliveredAt: row.delivered_at ? String(row.delivered_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    response: responsePayload
  };
}

function sender(row: Record<string, unknown>): AgentInstanceId {
  return String(row.from_agent_instance_id) as AgentInstanceId;
}
function receiver(row: Record<string, unknown>): AgentInstanceId {
  return String(row.to_agent_instance_id) as AgentInstanceId;
}

function safeParse(s: unknown): Record<string, unknown> {
  if (typeof s !== "string") return {};
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; }
}
