import { randomUUID } from "node:crypto";
import { getDb, resolveLocalTenantId, resolveLocalAgentId } from "../db/connection.js";
import { embed, vecToBuffer } from "../retrieval/EmbeddingModel.js";

export interface EpisodicEvent {
  id: string;
  taskId: string;
  eventType: string;
  summary: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface RetrieveOptions {
  limit?: number;
  maxDistance?: number;
  taskId?: string;
  tenantId?: string;
  agentId?: string;
}

export function record(
  taskId: string,
  eventType: string,
  summary: string,
  payload: Record<string, unknown>,
  options: { tenantId?: string; agentId?: string } = {},
): string {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const tenantId = options.tenantId ?? resolveLocalTenantId();
  const agentId = options.agentId ?? resolveLocalAgentId();
  const result = db.prepare(`
    INSERT INTO episodic_events (id, task_id, event_type, summary, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, taskId, eventType, summary, JSON.stringify(payload), now);

  const rowid = BigInt(result.lastInsertRowid);
  db.prepare(
    "INSERT INTO episodic_embeddings(rowid, tenant_id, agent_id, task_id, embedding) VALUES (?, ?, ?, ?, ?)",
  ).run(rowid, tenantId, agentId, taskId, vecToBuffer(embed(summary)));
  return id;
}

export function retrieveSimilar(
  query: string,
  limitOrOptions: number | RetrieveOptions = 5,
): Array<{ taskId: string; eventType: string; summary: string; createdAt: string }> {
  const opts: RetrieveOptions =
    typeof limitOrOptions === "number" ? { limit: limitOrOptions } : limitOrOptions;
  const limit = opts.limit ?? 5;
  const db = getDb();
  const tenantId = opts.tenantId ?? resolveLocalTenantId();
  const agentId = opts.agentId ?? resolveLocalAgentId();
  const queryBuf = vecToBuffer(embed(query));

  let vecRows: Array<{ rowid: bigint; distance: number }> = [];
  try {
    if (opts.taskId !== undefined) {
      if (opts.maxDistance !== undefined) {
        vecRows = db.prepare(
          "SELECT rowid, distance FROM episodic_embeddings WHERE embedding MATCH ? AND tenant_id = ? AND agent_id = ? AND task_id = ? AND distance < ? AND k = ?",
        ).all(queryBuf, tenantId, agentId, opts.taskId, opts.maxDistance, limit * 2) as Array<{ rowid: bigint; distance: number }>;
      } else {
        vecRows = db.prepare(
          "SELECT rowid, distance FROM episodic_embeddings WHERE embedding MATCH ? AND tenant_id = ? AND agent_id = ? AND task_id = ? AND k = ?",
        ).all(queryBuf, tenantId, agentId, opts.taskId, limit * 2) as Array<{ rowid: bigint; distance: number }>;
      }
    } else if (opts.maxDistance !== undefined) {
      vecRows = db.prepare(
        "SELECT rowid, distance FROM episodic_embeddings WHERE embedding MATCH ? AND tenant_id = ? AND agent_id = ? AND distance < ? AND k = ?",
      ).all(queryBuf, tenantId, agentId, opts.maxDistance, limit * 2) as Array<{ rowid: bigint; distance: number }>;
    } else {
      vecRows = db.prepare(
        "SELECT rowid, distance FROM episodic_embeddings WHERE embedding MATCH ? AND tenant_id = ? AND agent_id = ? AND k = ?",
      ).all(queryBuf, tenantId, agentId, limit * 2) as Array<{ rowid: bigint; distance: number }>;
    }
  } catch { return []; }

  if (vecRows.length === 0) return [];
  const ids = vecRows.map((r) => BigInt(r.rowid));
  const placeholders = ids.map(() => "?").join(",");
  return (db.prepare(
    `SELECT task_id, event_type, summary, created_at FROM episodic_events WHERE rowid IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`,
  ).all(...ids, limit) as Array<Record<string, string>>).map((r) => ({
    taskId: r.task_id,
    eventType: r.event_type,
    summary: r.summary,
    createdAt: r.created_at,
  }));
}

export function listByTask(taskId: string, options: { limit?: number; offset?: number } = {}): EpisodicEvent[] {
  const db = getDb();
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  const rows = db.prepare(
    `SELECT id, task_id, event_type, summary, payload_json, created_at
     FROM episodic_events
     WHERE task_id = ?
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
  ).all(taskId, limit, offset) as Array<{
    id: string;
    task_id: string;
    event_type: string;
    summary: string;
    payload_json: string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    taskId: r.task_id,
    eventType: r.event_type,
    summary: r.summary,
    payload: JSON.parse(r.payload_json),
    createdAt: r.created_at,
  }));
}

/** Returns 0.05 boost if a prior 'approved' episode exists for this file (by matching fileId in summary). */
export function getEpisodicBoost(fileId: string): number {
  const db = getDb();
  const row = db.prepare(
    "SELECT id FROM episodic_events WHERE event_type = 'FILE_APPROVED' AND payload_json LIKE ? LIMIT 1",
  ).get(`%${fileId}%`) as { id: string } | undefined;
  return row ? 0.05 : 0;
}
