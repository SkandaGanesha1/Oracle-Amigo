import { randomUUID } from "node:crypto";
import { getDb, resolveLocalTenantId, resolveLocalAgentId } from "../db/connection.js";
import { embed, vecToBuffer, bufferToVec, cosineSimilarity } from "../retrieval/EmbeddingModel.js";

export interface LongTermMemoryRecord {
  id: string;
  namespace: string;
  subjectId: string;
  contentText: string;
  importance: number;
  decayScore: number;
  createdAt: string;
  lastAccessedAt: string;
  tenantId: string;
  agentId: string;
}

export interface RetrieveOptions {
  limit?: number;
  maxDistance?: number;
  tenantId?: string;
  agentId?: string;
}

export function store(
  namespace: string,
  subjectId: string,
  text: string,
  importance = 0.5,
  options: { tenantId?: string; agentId?: string } = {},
): string {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const tenantId = options.tenantId ?? resolveLocalTenantId();
  const agentId = options.agentId ?? resolveLocalAgentId();
  const result = db.prepare(`
    INSERT INTO memories (id, memory_type, namespace, subject_id, content_text, importance, decay_score, created_at, last_accessed_at)
    VALUES (?, 'long_term', ?, ?, ?, ?, 1.0, ?, ?)
  `).run(id, namespace, subjectId, text, importance, now, now);

  const rowid = BigInt(result.lastInsertRowid);
  const buf = vecToBuffer(embed(text));
  db.prepare(
    "INSERT INTO memory_embeddings(rowid, tenant_id, agent_id, memory_type, namespace, embedding) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(rowid, tenantId, agentId, "long_term", namespace, buf);
  return id;
}

export function retrieve(
  namespace: string,
  queryText: string,
  limitOrOptions: number | RetrieveOptions = 5,
): Array<{ subjectId: string; contentText: string; score: number }> {
  const opts: RetrieveOptions =
    typeof limitOrOptions === "number" ? { limit: limitOrOptions } : limitOrOptions;
  const limit = opts.limit ?? 5;
  const db = getDb();
  const queryVec = embed(queryText);
  const queryBuf = vecToBuffer(queryVec);
  const tenantId = opts.tenantId ?? resolveLocalTenantId();
  const agentId = opts.agentId ?? resolveLocalAgentId();

  let vecRows: Array<{ rowid: bigint; distance: number }> = [];
  try {
    if (opts.maxDistance !== undefined) {
      vecRows = db.prepare(
        "SELECT rowid, distance FROM memory_embeddings WHERE embedding MATCH ? AND tenant_id = ? AND agent_id = ? AND namespace = ? AND distance < ? AND k = ?",
      ).all(queryBuf, tenantId, agentId, namespace, opts.maxDistance, limit * 2) as Array<{ rowid: bigint; distance: number }>;
    } else {
      vecRows = db.prepare(
        "SELECT rowid, distance FROM memory_embeddings WHERE embedding MATCH ? AND tenant_id = ? AND agent_id = ? AND namespace = ? AND k = ?",
      ).all(queryBuf, tenantId, agentId, namespace, limit * 2) as Array<{ rowid: bigint; distance: number }>;
    }
  } catch { return []; }

  if (vecRows.length === 0) return [];

  const ids = vecRows.map((r) => BigInt(r.rowid));
  const placeholders = ids.map(() => "?").join(",");
  const memRows = db.prepare(
    `SELECT rowid, subject_id, content_text, decay_score FROM memories WHERE namespace = ? AND rowid IN (${placeholders})`
  ).all(namespace, ...ids) as Array<{ rowid: bigint; subject_id: string; content_text: string; decay_score: number }>;

  const now = new Date().toISOString();
  for (const row of memRows) {
    db.prepare("UPDATE memories SET last_accessed_at = ? WHERE rowid = ?").run(now, row.rowid);
  }

  const distMap = new Map(vecRows.map((r) => [Number(r.rowid), r.distance]));
  const maxDist = Math.max(...vecRows.map((r) => r.distance), 1);

  return memRows
    .map((r) => {
      const dist = distMap.get(Number(r.rowid)) ?? maxDist;
      const score = (1 - dist / maxDist) * 0.6 + r.decay_score * 0.4;
      return { subjectId: r.subject_id, contentText: r.content_text, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function decayOldMemories(olderThanDays: number, decayRate = 0.1): number {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 3600 * 1000).toISOString();
  const result = db.prepare(
    "UPDATE memories SET decay_score = MAX(0, decay_score - ?) WHERE last_accessed_at < ?",
  ).run(decayRate, cutoff);
  return Number(result.changes ?? 0);
}

export function evictDecayedMemories(minDecayScore: number): number {
  const db = getDb();
  const result = db.prepare("DELETE FROM memories WHERE decay_score < ?").run(minDecayScore);
  return Number(result.changes ?? 0);
}

export function listMemories(
  namespace: string,
  options: { tenantId?: string; agentId?: string; limit?: number; offset?: number } = {},
): LongTermMemoryRecord[] {
  const db = getDb();
  const tenantId = options.tenantId ?? resolveLocalTenantId();
  const agentId = options.agentId ?? resolveLocalAgentId();
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  const rows = db.prepare(
    `SELECT id, namespace, subject_id, content_text, importance, decay_score, created_at, last_accessed_at, '${tenantId}' as tenant_id, '${agentId}' as agent_id
     FROM memories
     WHERE namespace = ?
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
  ).all(namespace, limit, offset) as Array<{
    id: string;
    namespace: string;
    subject_id: string;
    content_text: string;
    importance: number;
    decay_score: number;
    created_at: string;
    last_accessed_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    namespace: r.namespace,
    subjectId: r.subject_id,
    contentText: r.content_text,
    importance: r.importance,
    decayScore: r.decay_score,
    createdAt: r.created_at,
    lastAccessedAt: r.last_accessed_at,
    tenantId,
    agentId,
  }));
}
