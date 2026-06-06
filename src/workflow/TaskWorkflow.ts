import { randomUUID } from "node:crypto";
import { getDb } from "../db/connection.js";
import { appendAuditEvent } from "../security/AuditHashChain.js";
import { A2A_STATE_MAP, InvalidTransitionError, VALID_TRANSITIONS, type InternalState } from "./WorkflowStates.js";

export type TaskRecord = {
  id: string;
  contextId: string;
  type: string;
  status: string;
  protocolState: InternalState;
  metadataJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export function createTask(input: {
  contextId?: string;
  type?: string;
  metadata?: Record<string, unknown>;
  actorAgentId?: string;
}): TaskRecord {
  const db = getDb();
  const id = randomUUID();
  const contextId = input.contextId ?? randomUUID();
  const type = input.type ?? "file.request.search";
  const initialState: InternalState = "REQUEST_RECEIVED";
  const status = A2A_STATE_MAP[initialState];
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO a2a_tasks (id, context_id, type, status, protocol_state, metadata_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, contextId, type, status, initialState, JSON.stringify(input.metadata ?? {}), now, now);

  appendAuditEvent({
    actorAgentId: input.actorAgentId ?? "system",
    taskId: id,
    eventType: "TASK_CREATED",
    detailsJson: { initialState, contextId, type },
  });

  return { id, contextId, type, status, protocolState: initialState, metadataJson: input.metadata ?? {}, createdAt: now, updatedAt: now, completedAt: null };
}

export function transition(
  taskId: string,
  newState: InternalState,
  payload?: Record<string, unknown>,
  actorAgentId = "system"
): TaskRecord {
  const db = getDb();
  const row = db.prepare("SELECT * FROM a2a_tasks WHERE id = ?").get(taskId) as Record<string, unknown> | undefined;
  if (!row) throw new Error(`Task not found: ${taskId}`);

  const currentState = row.protocol_state as InternalState;
  const allowed = VALID_TRANSITIONS.get(currentState);

  if (!allowed?.has(newState)) {
    appendAuditEvent({
      actorAgentId, taskId, eventType: "INVALID_TRANSITION",
      detailsJson: { from: currentState, to: newState },
    });
    throw new InvalidTransitionError(currentState, newState);
  }

  const newA2aStatus = A2A_STATE_MAP[newState];
  const now = new Date().toISOString();
  const isTerminal = newState === "COMPLETED" || newState === "REJECTED" || newState === "FAILED";

  db.prepare(
    `UPDATE a2a_tasks SET status=?, protocol_state=?, updated_at=?, completed_at=COALESCE(?,completed_at) WHERE id=?`
  ).run(newA2aStatus, newState, now, isTerminal ? now : null, taskId);

  db.prepare(
    `INSERT INTO workflow_events (task_id, state_from, state_to, event_type, payload_json, created_at) VALUES (?,?,?,'STATE_TRANSITION',?,?)`
  ).run(taskId, currentState, newState, JSON.stringify(payload ?? {}), now);

  appendAuditEvent({
    actorAgentId, taskId, eventType: "STATE_TRANSITION",
    detailsJson: { from: currentState, to: newState, a2aStatus: newA2aStatus, ...(payload ?? {}) },
  });

  return getTask(taskId)!;
}

export function getTask(taskId: string): TaskRecord | null {
  const row = getDb().prepare("SELECT * FROM a2a_tasks WHERE id = ?").get(taskId) as Record<string, unknown> | undefined;
  return row ? rowToTask(row) : null;
}

export function listTasks(): TaskRecord[] {
  return (getDb().prepare("SELECT * FROM a2a_tasks ORDER BY created_at DESC").all() as Array<Record<string, unknown>>).map(rowToTask);
}

function rowToTask(row: Record<string, unknown>): TaskRecord {
  return {
    id: row.id as string,
    contextId: row.context_id as string,
    type: row.type as string,
    status: row.status as string,
    protocolState: row.protocol_state as InternalState,
    metadataJson: JSON.parse(row.metadata_json as string),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    completedAt: (row.completed_at as string | null) ?? null,
  };
}
