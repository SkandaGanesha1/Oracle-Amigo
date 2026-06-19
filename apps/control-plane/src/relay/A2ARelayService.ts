import { randomUUID } from "node:crypto";
import { loadConfig } from "../config.js";
import { getControlPlaneStore } from "../db/connection.js";
import type { ControlPlaneStore } from "../db/ControlPlaneStore.js";
import { appendAuditEvent } from "../audit/CloudAuditService.js";
import type {
  AgentInstanceId, OrgId, RelayTask, RelayTaskStatus
} from "../types/cloud.js";
import { DbPollingRelayQueue, type RelayQueue, type RelayRetryPolicy } from "./RelayQueue.js";

export interface RelaySendInput {
  orgId: OrgId;
  fromAgentInstanceId: AgentInstanceId;
  toAgentInstanceId: AgentInstanceId;
  a2aTaskId: string;
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
  ttlSeconds?: number;
}

export interface RelaySendResult {
  relay_task_id: string;
  relay_message_id: string;
  status: RelayTaskStatus;
  accepted_at: string;
  queued_at: string | null;
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
  status: "delivered";
  created_at: string;
  delivered_at: string | null;
  ack_at: string | null;
  attempt_count: number;
  max_attempts: number;
}

async function assertActiveInstance(
  store: ControlPlaneStore,
  orgId: OrgId,
  instanceId: AgentInstanceId,
  field: "from" | "to"
): Promise<void> {
  const row = await store.one("SELECT status FROM agent_instances WHERE org_id = $1 AND id = $2", [orgId, instanceId]);
  if (!row) throw new Error(`Target ${field} agent instance not found`);
  if (String(row.status) !== "active") throw new Error(`Target ${field} agent instance is ${row.status}`);
}

export async function sendRelay(input: RelaySendInput, opts: { store?: ControlPlaneStore; queue?: RelayQueue } = {}): Promise<RelaySendResult> {
  const store = opts.store ?? getControlPlaneStore();
  const retry = loadRelayRetryPolicy();
  await assertActiveInstance(store, input.orgId, input.fromAgentInstanceId, "from");
  await assertActiveInstance(store, input.orgId, input.toAgentInstanceId, "to");
  if (input.fromAgentInstanceId === input.toAgentInstanceId) throw new Error("Cannot send a relay message to the same agent instance");
  if (!input.a2aTaskId.trim()) throw new Error("a2a_task_id is required");
  if (!input.type.trim()) throw new Error("type is required");

  if (input.idempotencyKey) {
    const existing = await store.one<{ id: string; relay_task_id: string | null }>(`
      SELECT id, relay_task_id FROM relay_messages
      WHERE org_id = $1 AND from_agent_instance_id = $2 AND idempotency_key = $3
    `, [input.orgId, input.fromAgentInstanceId, input.idempotencyKey]);
    if (existing) {
      const task = existing.relay_task_id
        ? await store.one<{ status: RelayTaskStatus; accepted_at: string | null; queued_at: string | null }>(
          "SELECT status, accepted_at, queued_at FROM relay_tasks WHERE org_id = $1 AND id = $2",
          [input.orgId, existing.relay_task_id]
        )
        : undefined;
      return {
        relay_task_id: existing.relay_task_id ?? "",
        relay_message_id: existing.id,
        status: task?.status ?? "queued",
        accepted_at: task?.accepted_at ? String(task.accepted_at) : new Date().toISOString(),
        queued_at: task?.queued_at ? String(task.queued_at) : null
      };
    }
  }

  const now = new Date().toISOString();
  const taskId = `rt_${randomUUID()}`;
  const messageId = `rm_${randomUUID()}`;
  const payloadJson = JSON.stringify(input.payload);
  const ttlSeconds = Math.max(input.ttlSeconds ?? retry.taskTtlSeconds, 60);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  await store.transaction(async (tx) => {
    await tx.execute(`
      INSERT INTO relay_tasks (
        id, org_id, from_agent_instance_id, to_agent_instance_id, a2a_task_id, type, payload_json,
        status, attempt_count, max_attempts, created_at, updated_at, accepted_at, expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'accepted', 0, $8, $9, $10, $11, $12)
    `, [
      taskId,
      input.orgId,
      input.fromAgentInstanceId,
      input.toAgentInstanceId,
      input.a2aTaskId,
      input.type,
      payloadJson,
      retry.maxAttempts,
      now,
      now,
      now,
      expiresAt
    ]);
    await tx.execute(`
      INSERT INTO relay_messages (
        id, org_id, relay_task_id, from_agent_instance_id, to_agent_instance_id, payload_json,
        status, idempotency_key, created_at, expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7, $8, $9)
    `, [
      messageId,
      input.orgId,
      taskId,
      input.fromAgentInstanceId,
      input.toAgentInstanceId,
      payloadJson,
      input.idempotencyKey ?? null,
      now,
      expiresAt
    ]);
    await appendAuditEvent({
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
    }, tx);
  });

  const queue = opts.queue ?? new DbPollingRelayQueue(store);
  await queue.enqueue({ orgId: input.orgId, relayTaskId: taskId, relayMessageId: messageId, queuedAt: now });

  return { relay_task_id: taskId, relay_message_id: messageId, status: "queued", accepted_at: now, queued_at: now };
}

export async function fetchInbox(input: InboxFetchInput, opts: { store?: ControlPlaneStore; queue?: RelayQueue } = {}): Promise<InboxItem[]> {
  const store = opts.store ?? getControlPlaneStore();
  const queue = opts.queue ?? new DbPollingRelayQueue(store);
  const rows = await queue.fetchInbox({
    orgId: input.orgId,
    toAgentInstanceId: input.toAgentInstanceId,
    maxBatch: Math.min(input.maxBatch ?? 50, 500),
    markDelivered: input.markDelivered ?? true,
    retry: loadRelayRetryPolicy()
  });

  if (input.markDelivered !== false && rows.length > 0) {
    await appendAuditEvent({
      orgId: input.orgId,
      actorAgentInstanceId: input.toAgentInstanceId,
      eventType: "RELAY_INBOX_DELIVERED",
      details: { count: rows.length, task_ids: Array.from(new Set(rows.map((row) => row.relay_task_id))) }
    }, store);
  }

  return rows.map((row) => ({
    relay_task_id: String(row.relay_task_id),
    relay_message_id: String(row.relay_message_id),
    from_agent_instance_id: String(row.from_agent_instance_id),
    to_agent_instance_id: String(row.to_agent_instance_id),
    a2a_task_id: String(row.a2a_task_id),
    type: String(row.type),
    payload: safeParse(row.payload_json),
    status: "delivered",
    created_at: String(row.created_at),
    delivered_at: row.delivered_at ? String(row.delivered_at) : null,
    ack_at: null,
    attempt_count: Number(row.attempt_count),
    max_attempts: Number(row.max_attempts)
  }));
}

export async function ackRelay(
  orgId: OrgId,
  relayTaskId: string,
  agentInstanceId: AgentInstanceId,
  opts: { store?: ControlPlaneStore } = {}
): Promise<{ ok: true; status: RelayTaskStatus }> {
  const store = opts.store ?? getControlPlaneStore();
  const row = await store.one("SELECT * FROM relay_tasks WHERE org_id = $1 AND id = $2", [orgId, relayTaskId]);
  if (!row) throw new Error("Relay task not found");
  if (String(row.to_agent_instance_id) !== agentInstanceId) throw new Error("Not authorized to ack this relay task");

  const current = String(row.status) as RelayTaskStatus;
  if (current === "failed" || current === "expired") throw new Error(`Cannot ack a ${current} relay task`);
  const nextStatus = statusAfterAck(current);
  const now = new Date().toISOString();
  let status: RelayTaskStatus = current;

  await store.transaction(async (tx) => {
    await tx.execute(`
      UPDATE relay_messages
      SET status = 'acked',
          acked_at = COALESCE(acked_at, $1)
      WHERE org_id = $2
        AND relay_task_id = $3
        AND status IN ('queued', 'delivered', 'acked')
    `, [now, orgId, relayTaskId]);

    if (nextStatus !== current) {
      await tx.execute(`
        UPDATE relay_tasks
        SET status = $1,
            delivered_at = COALESCE(delivered_at, $2),
            stored_at = COALESCE(stored_at, $3),
            next_retry_at = NULL,
            updated_at = $4
        WHERE org_id = $5
          AND id = $6
          AND status NOT IN ('failed', 'expired', 'completed')
      `, [nextStatus, now, now, now, orgId, relayTaskId]);
      status = nextStatus;
    }

    await appendAuditEvent({
      orgId,
      actorAgentInstanceId: agentInstanceId,
      eventType: "RELAY_TASK_ACKED",
      details: { relay_task_id: relayTaskId, status }
    }, tx);
  });

  return { ok: true, status };
}

export async function respondRelay(
  orgId: OrgId,
  relayTaskId: string,
  agentInstanceId: AgentInstanceId,
  responsePayload: Record<string, unknown>,
  opts: { store?: ControlPlaneStore } = {}
): Promise<{ ok: true; status: RelayTaskStatus }> {
  const store = opts.store ?? getControlPlaneStore();
  const row = await store.one("SELECT * FROM relay_tasks WHERE org_id = $1 AND id = $2", [orgId, relayTaskId]);
  if (!row) throw new Error("Relay task not found");
  if (String(row.to_agent_instance_id) !== agentInstanceId) throw new Error("Not authorized to respond to this relay task");
  const currentStatus = String(row.status) as RelayTaskStatus;
  if (currentStatus === "completed" || currentStatus === "failed" || currentStatus === "expired") {
    return { ok: true, status: currentStatus };
  }
  const now = new Date().toISOString();
  const nextStatus = statusFromResponse(responsePayload);

  await store.transaction(async (tx) => {
    await tx.execute(`
      INSERT INTO relay_messages (id, org_id, relay_task_id, from_agent_instance_id, to_agent_instance_id, payload_json, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'responded', $7)
    `, [
      `rm_${randomUUID()}`,
      orgId,
      relayTaskId,
      agentInstanceId,
      String(row.from_agent_instance_id),
      JSON.stringify({ kind: "response", payload: responsePayload }),
      now
    ]);
    await tx.execute(`
      UPDATE relay_tasks
      SET status = $1,
          stored_at = CASE WHEN $1 IN ('stored_by_remote_agent', 'waiting_approval', 'approved', 'transfer_started', 'completed') THEN COALESCE(stored_at, $2) ELSE stored_at END,
          waiting_approval_at = CASE WHEN $1 = 'waiting_approval' THEN COALESCE(waiting_approval_at, $2) ELSE waiting_approval_at END,
          approved_at = CASE WHEN $1 = 'approved' THEN COALESCE(approved_at, $2) ELSE approved_at END,
          transfer_started_at = CASE WHEN $1 = 'transfer_started' THEN COALESCE(transfer_started_at, $2) ELSE transfer_started_at END,
          completed_at = CASE WHEN $1 = 'completed' THEN COALESCE(completed_at, $2) ELSE completed_at END,
          failed_at = CASE WHEN $1 = 'failed' THEN COALESCE(failed_at, $2) ELSE failed_at END,
          last_error = CASE WHEN $1 = 'failed' THEN COALESCE($3, last_error, 'relay response marked task failed') ELSE last_error END,
          next_retry_at = NULL,
          updated_at = $4
      WHERE org_id = $5
        AND id = $6
        AND status NOT IN ('failed', 'expired', 'completed')
    `, [nextStatus, now, typeof responsePayload.error === "string" ? responsePayload.error : null, now, orgId, relayTaskId]);
    await appendAuditEvent({
      orgId,
      actorAgentInstanceId: agentInstanceId,
      eventType: "RELAY_TASK_RESPONDED",
      details: { relay_task_id: relayTaskId, status: nextStatus }
    }, tx);
  });
  return { ok: true, status: nextStatus };
}

export async function expireRelayTasks(opts: { store?: ControlPlaneStore; queue?: RelayQueue } = {}): Promise<number> {
  const store = opts.store ?? getControlPlaneStore();
  const queue = opts.queue ?? new DbPollingRelayQueue(store);
  return queue.markExpired();
}

export async function getRelayTask(
  orgId: OrgId,
  relayTaskId: string,
  agentInstanceId: AgentInstanceId | null,
  opts: { store?: ControlPlaneStore } = {}
): Promise<RelayTask | null> {
  const store = opts.store ?? getControlPlaneStore();
  const row = await store.one("SELECT * FROM relay_tasks WHERE org_id = $1 AND id = $2", [orgId, relayTaskId]);
  if (!row) return null;
  if (agentInstanceId) {
    const from = String(row.from_agent_instance_id);
    const to = String(row.to_agent_instance_id);
    if (from !== agentInstanceId && to !== agentInstanceId) throw new Error("Not authorized to view this relay task");
  }
  const responseRow = await store.one(`
    SELECT payload_json
    FROM relay_messages
    WHERE org_id = $1 AND relay_task_id = $2 AND status = 'responded'
    ORDER BY created_at DESC
    LIMIT 1
  `, [orgId, relayTaskId]);
  const responseEnvelope = safeParse(responseRow?.payload_json);
  const responsePayload = responseEnvelope && typeof responseEnvelope.payload === "object" && responseEnvelope.payload !== null
    ? responseEnvelope.payload as Record<string, unknown>
    : null;
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    fromAgentInstanceId: String(row.from_agent_instance_id),
    toAgentInstanceId: String(row.to_agent_instance_id),
    a2aTaskId: String(row.a2a_task_id),
    type: String(row.type),
    payloadJson: String(row.payload_json),
    status: String(row.status) as RelayTaskStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    acceptedAt: row.accepted_at ? String(row.accepted_at) : null,
    queuedAt: row.queued_at ? String(row.queued_at) : null,
    deliveredAt: row.delivered_at ? String(row.delivered_at) : null,
    storedAt: row.stored_at ? String(row.stored_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    failedAt: row.failed_at ? String(row.failed_at) : null,
    expiredAt: row.expired_at ? String(row.expired_at) : null,
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    attemptCount: Number(row.attempt_count ?? 0),
    maxAttempts: Number(row.max_attempts ?? 0),
    lastError: row.last_error ? String(row.last_error) : null,
    nextRetryAt: row.next_retry_at ? String(row.next_retry_at) : null,
    response: responsePayload
  };
}

function loadRelayRetryPolicy(): RelayRetryPolicy {
  const cfg = loadConfig();
  return {
    maxAttempts: cfg.RELAY_MAX_DELIVERY_ATTEMPTS,
    retryBaseMs: cfg.RELAY_RETRY_BASE_MS,
    retryMaxMs: cfg.RELAY_RETRY_MAX_MS,
    taskTtlSeconds: cfg.RELAY_TASK_TTL_SECONDS
  };
}

function statusAfterAck(current: RelayTaskStatus): RelayTaskStatus {
  if (current === "accepted" || current === "queued" || current === "delivered_to_remote_agent") {
    return "stored_by_remote_agent";
  }
  return current;
}

function statusFromResponse(payload: Record<string, unknown>): RelayTaskStatus {
  const value = typeof payload.status === "string" ? payload.status : "";
  if (isRelayTaskStatus(value)) return value;
  switch (value) {
    case "waiting_for_approval":
    case "no_candidate_found_waiting_for_refinement":
      return "waiting_approval";
    case "transfer_starting":
      return "transfer_started";
    case "file_received_hash_verified":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "completed";
  }
}

function isRelayTaskStatus(value: string): value is RelayTaskStatus {
  return [
    "accepted",
    "queued",
    "delivered_to_remote_agent",
    "stored_by_remote_agent",
    "waiting_approval",
    "approved",
    "transfer_started",
    "completed",
    "failed",
    "expired"
  ].includes(value);
}

function safeParse(s: unknown): Record<string, unknown> {
  if (typeof s !== "string") return {};
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; }
}
