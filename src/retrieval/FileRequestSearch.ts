import { getDb } from "../db/connection.js";
import { normalizeFilename, type FileRequestParseResult } from "../intent/FileRequestParser.js";

export type FileRequestCandidateReason =
  | "exact-filename"
  | "normalized-filename"
  | "filename-token-match"
  | "lexical"
  | "semantic"
  | "live-root";

export type FileRequestIndexedMatch = {
  id: number;
  filePath: string;
  displayPath: string;
  fileName: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: string;
  score: number;
  reason: FileRequestCandidateReason;
};

export type FileRequestSearchOptions = {
  limit?: number;
  extensions?: string[];
  excludeIds?: number[];
};

type FileIndexRow = {
  id: number;
  file_path: string;
  display_path: string;
  file_name: string;
  extension: string;
  size_bytes: number;
  modified_at: string;
};

export function searchFileRequestIndex(
  parsed: FileRequestParseResult,
  options: FileRequestSearchOptions = {}
): FileRequestIndexedMatch[] {
  return new FileRequestSearch().searchIndex(parsed, options);
}

export function searchFileRequest(
  parsed: FileRequestParseResult,
  options: FileRequestSearchOptions = {}
): FileRequestIndexedMatch[] {
  return new FileRequestSearch().searchFileRequest(parsed, options);
}

export class FileRequestSearch {
  searchFileRequest(
    parsed: FileRequestParseResult,
    options: FileRequestSearchOptions = {}
  ): FileRequestIndexedMatch[] {
    return this.searchIndex(parsed, options);
  }

  searchIndex(
    parsed: FileRequestParseResult,
    options: FileRequestSearchOptions = {}
  ): FileRequestIndexedMatch[] {
    const limit = Math.max(1, Math.min(20, options.limit ?? 10));
    const rows = loadCandidateRows(options.extensions ?? parsed.extensions, options.excludeIds ?? []);
    const scored = rows
      .map((row) => scoreRow(row, parsed))
      .filter((match): match is FileRequestIndexedMatch => Boolean(match))
      .sort((left, right) => right.score - left.score || left.fileName.localeCompare(right.fileName));
    return scored.slice(0, limit);
  }
}

function loadCandidateRows(extensions: string[], excludeIds: number[]): FileIndexRow[] {
  const db = getDb();
  const normalizedExtensions = normalizeExtensions(extensions);
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (normalizedExtensions.length > 0) {
    where.push(`extension IN (${normalizedExtensions.map(() => "?").join(", ")})`);
    params.push(...normalizedExtensions);
  }
  if (excludeIds.length > 0) {
    where.push(`id NOT IN (${excludeIds.map(() => "?").join(", ")})`);
    params.push(...excludeIds);
  }
  const sql = `
    SELECT id, file_path, display_path, file_name, extension, size_bytes, modified_at
    FROM file_index
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY modified_at DESC
    LIMIT 5000
  `;
  return db.prepare(sql).all(...params) as FileIndexRow[];
}

function scoreRow(row: FileIndexRow, parsed: FileRequestParseResult): FileRequestIndexedMatch | null {
  const exact = parsed.exactFilename?.trim() ?? null;
  const exactLower = exact?.toLowerCase() ?? null;
  const fileNameLower = row.file_name.toLowerCase();
  const normalized = normalizeFilename(row.file_name);
  const normalizedTarget = parsed.normalizedFilename;

  if (exact && row.file_name === exact) {
    return toMatch(row, 1, "exact-filename");
  }
  if (exactLower && fileNameLower === exactLower) {
    return toMatch(row, 0.98, "exact-filename");
  }
  if (normalizedTarget && normalized === normalizedTarget) {
    return toMatch(row, 0.94, "normalized-filename");
  }

  const tokens = parsed.keywords.length > 0 ? parsed.keywords : normalizeFilename(parsed.cleanQuery).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const haystack = `${normalized} ${normalizeFilename(row.display_path)}`;
  const hitCount = tokens.filter((token) => haystack.includes(token)).length;
  if (hitCount === 0) return null;
  if (hitCount === tokens.length) {
    return toMatch(row, Math.min(0.9, 0.78 + hitCount * 0.02), "filename-token-match");
  }
  if (hitCount / tokens.length >= 0.5) {
    return toMatch(row, 0.56 + (hitCount / tokens.length) * 0.18, "lexical");
  }
  return null;
}

function toMatch(row: FileIndexRow, score: number, reason: FileRequestCandidateReason): FileRequestIndexedMatch {
  return {
    id: row.id,
    filePath: row.file_path,
    displayPath: row.display_path,
    fileName: row.file_name,
    extension: row.extension,
    sizeBytes: Number(row.size_bytes),
    modifiedAt: row.modified_at,
    score,
    reason
  };
}

function normalizeExtensions(values: string[]): string[] {
  return [...new Set(values.map((value) => {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return "";
    return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
  }).filter(Boolean))];
}
