import { basename, extname } from "node:path";
import { getDb, resolveLocalTenantId, resolveLocalAgentId } from "../db/connection.js";
import { cosineSimilarity, embed, vecToBuffer } from "./EmbeddingModel.js";

export type RetrievalMatch = {
  id: number;
  filePath: string;
  displayPath: string;
  fileName: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: string;
  score: number;
  reason: string;
};

export type SearchOptions = {
  extensions?: string[];
  excludeIds?: number[];
  /** Filename tokens to penalize (set score to 0 if any token matches the file name). Used for feedback-driven re-search. */
  excludeNameTokens?: string[];
  episodicBoosts?: Map<number, number>;
  limit?: number;
  /** Max cosine distance for vec KNN results (used for cursor pagination). */
  maxDistance?: number;
  /** Tenant id for multi-tenant isolation (default: local OS user). */
  tenantId?: string;
  /** Agent id for partition key filter (default: local-agent). */
  agentId?: string;
  /** Offset for pagination (skips the first N results). */
  offset?: number;
};

// Configurable weights (can be overridden via RETRIEVAL_WEIGHTS_JSON env)
function weights() {
  try {
    if (process.env.RETRIEVAL_WEIGHTS_JSON) return JSON.parse(process.env.RETRIEVAL_WEIGHTS_JSON);
  } catch { /* use defaults */ }
  return { vec: 0.40, bm25: 0.30, filename: 0.15, recency: 0.10, episodic: 0.05 };
}

const RRF_K = 60;

export function search(query: string, options: SearchOptions = {}): RetrievalMatch[] {
  const db = getDb();
  const limit = options.limit ?? 20;
  const excludeIds = new Set(options.excludeIds ?? []);
  const tenantId = options.tenantId ?? resolveLocalTenantId();
  const agentId = options.agentId ?? resolveLocalAgentId();

  // 1. FTS5 lexical
  const ftsQuery = query.replace(/[^a-zA-Z0-9\s]/g, " ").trim();
  let ftsRows: Array<{ rowid: number; rank: number }> = [];
  if (ftsQuery) {
    try {
      ftsRows = db.prepare(
        "SELECT rowid, rank FROM fts_file_index WHERE fts_file_index MATCH ? ORDER BY rank LIMIT 50"
      ).all(ftsQuery) as Array<{ rowid: number; rank: number }>;
    } catch { /* no FTS matches */ }
  }

  // 2. Vec KNN with tenant/agent partition filter and optional distance constraint
  const queryVec = vecToBuffer(embed(query));
  let vecRows: Array<{ rowid: bigint; distance: number }> = [];
  try {
    if (options.maxDistance !== undefined) {
      vecRows = db.prepare(
        "SELECT rowid, distance FROM file_embeddings WHERE embedding MATCH ? AND tenant_id = ? AND agent_id = ? AND distance < ? AND k = 50",
      ).all(queryVec, tenantId, agentId, options.maxDistance) as Array<{ rowid: bigint; distance: number }>;
    } else {
      vecRows = db.prepare(
        "SELECT rowid, distance FROM file_embeddings WHERE embedding MATCH ? AND tenant_id = ? AND agent_id = ? AND k = 50",
      ).all(queryVec, tenantId, agentId) as Array<{ rowid: bigint; distance: number }>;
    }
  } catch { /* no vec matches */ }

  // 3. RRF fusion
  const scores = new Map<number, number>();
  ftsRows.forEach((r, rank) => {
    const id = Number(r.rowid);
    scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank + 1));
  });
  vecRows.forEach((r, rank) => {
    const id = Number(r.rowid);
    scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank + 1));
  });

  if (scores.size === 0) return [];

  // 4. Load file_index rows for candidates
  const ids = [...scores.keys()].filter((id) => !excludeIds.has(id));
  if (ids.length === 0) return [];

  const placeholders = ids.map(() => "?").join(",");
  const fileRows = db.prepare(
    `SELECT id, file_path, display_path, file_name, extension, size_bytes, modified_at FROM file_index WHERE id IN (${placeholders})`
  ).all(...ids) as Array<Record<string, unknown>>;

  // 5. Extension filter
  const extFilter = options.extensions?.map((e) => (e.startsWith(".") ? e : `.${e}`));

  const now = Date.now();
  const W = weights();
  const wBoost = options.episodicBoosts ?? new Map();

  // Precompute vec score map (1 - normalized_distance → higher = better)
  const maxDist = Math.max(...vecRows.map((r) => r.distance), 1);
  const vecScoreMap = new Map(vecRows.map((r) => [Number(r.rowid), 1 - r.distance / maxDist]));

  // FTS rank: sqlite FTS5 returns negative BM25 scores
  const minRank = Math.min(...ftsRows.map((r) => r.rank), 0);
  const ftsScoreMap = new Map(ftsRows.map((r) => [Number(r.rowid), Math.abs(r.rank) / (Math.abs(minRank) || 1)]));

  const candidates = fileRows
    .filter((r) => !extFilter || extFilter.includes(r.extension as string))
    .map((r) => {
      const id = Number(r.id);
      const name = (r.file_name as string).toLowerCase();
      const excluded = (options.excludeNameTokens ?? []).some((tok) => tok && name.includes(tok.toLowerCase()));
      const idExcluded = excludeIds.has(id);
      return { row: r, id, name, excluded: excluded || idExcluded };
    })
    .filter((c) => !c.excluded)
    .map(({ row: r, id, name }) => {
      const vecScore = vecScoreMap.get(id) ?? 0;
      const bm25Score = ftsScoreMap.get(id) ?? 0;
      const queryBase = query.toLowerCase();
      const filenameScore = name.includes(queryBase) ? 1.0 : queryBase.split(" ").filter((t) => t && name.includes(t)).length / Math.max(queryBase.split(" ").length, 1);
      const mtime = new Date(r.modified_at as string).getTime();
      const recencyScore = Math.max(0, 1 - (now - mtime) / (365 * 24 * 3600 * 1000));
      const episodicScore = wBoost.get(id) ?? 0;
      const score = W.vec * vecScore + W.bm25 * bm25Score + W.filename * filenameScore + W.recency * recencyScore + W.episodic * episodicScore;
      const reasons = [];
      if (bm25Score > 0) reasons.push("lexical");
      if (vecScore > 0) reasons.push("semantic");
      if (filenameScore > 0) reasons.push("filename");
      if (episodicScore > 0) reasons.push("episodic-boost");
      return { id, filePath: r.file_path as string, displayPath: r.display_path as string, fileName: r.file_name as string, extension: r.extension as string, sizeBytes: Number(r.size_bytes), modifiedAt: r.modified_at as string, score, reason: reasons.join(", ") || "rrf" };
    })
    .sort((a, b) => b.score - a.score);

  // 6. MMR diversity (λ=0.75) — precompute candidate embeddings to avoid repeated embed() calls
  const lambda = 0.75;
  const selected: typeof candidates = [];
  const remaining = [...candidates];

  // Precompute all candidate embeddings once
  const candVecMap = new Map<number, Float32Array>();
  for (const c of remaining) {
    candVecMap.set(c.id, embed(`${c.fileName} ${c.displayPath}`));
  }

  while (selected.length < limit && remaining.length > 0) {
    let bestIdx = 0;
    let bestMmr = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const candVec = candVecMap.get(cand.id)!;
      const maxSim = selected.length === 0 ? 0 : Math.max(
        ...selected.map((s) => {
          const sVec = candVecMap.get(s.id);
          return sVec ? cosineSimilarity(candVec, sVec) : 0;
        })
      );
      const mmr = lambda * cand.score - (1 - lambda) * maxSim;
      if (mmr > bestMmr) { bestMmr = mmr; bestIdx = i; }
    }
    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }

  const offset = options.offset ?? 0;
  if (offset > 0) {
    return selected.slice(offset);
  }
  return selected;
}
