import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { parseFileRequest, type FileRequestParseResult } from "../intent/FileRequestParser.js";
import { createQueryRewriter } from "../intent/QueryRewriter.js";
import { FileSearchService, type FileSearchMatch } from "../file-search/FileSearchService.js";
import { search as hybridSearch, type SearchOptions } from "../retrieval/HybridRetrievalPipeline.js";
import { searchFileRequest, type FileRequestIndexedMatch } from "../retrieval/FileRequestSearch.js";

export type FileRequestCandidate = {
  id: string;
  fileName: string;
  displayPath: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: string;
  score: number;
  reason: string;
  previewUrl?: string;
  boundFilePath: string;
  boundSha256: string;
  boundSizeBytes: number;
  source: "live" | "index" | "filename-index";
};

export type ResolveFileRequestCandidatesOptions = {
  limit?: number;
  searchOptions?: SearchOptions;
};

export type ResolveFileRequestCandidatesResult = {
  originalQuery: string;
  searchQuery: string;
  parsed: FileRequestParseResult;
  candidates: FileRequestCandidate[];
  lowConfidenceCandidates: FileRequestCandidate[];
  searchedRoots: string[];
  source: "live" | "index" | "filename-index" | "none";
};

export async function resolveFileRequestCandidates(
  query: string,
  fileSearch: FileSearchService,
  options: ResolveFileRequestCandidatesOptions = {}
): Promise<ResolveFileRequestCandidatesResult> {
  const limit = Math.max(1, Math.min(20, options.limit ?? 10));
  const parsed = parseFileRequest(query);
  const rewritten = createQueryRewriter().rewrite(parsed.cleanQuery || query);
  const searchQuery = parsed.exactFilename || rewritten.semanticQuery || rewritten.lexicalQuery || parsed.cleanQuery || query;
  const extensions = normalizeExtensions([
    ...(options.searchOptions?.extensions ?? []),
    ...rewritten.extensions,
    ...parsed.extensions
  ]);
  const filenameFirst = await fromIndexedMatches(
    searchFileRequest(parsed, {
      extensions,
      excludeIds: options.searchOptions?.excludeIds,
      limit
    }),
    "filename-index"
  );
  if (filenameFirst.length > 0) {
    return {
      originalQuery: query,
      searchQuery,
      parsed,
      candidates: filenameFirst,
      lowConfidenceCandidates: await findLowConfidenceOtherTypes(parsed, extensions, filenameFirst, limit),
      searchedRoots: fileSearch.getRoots(),
      source: "filename-index"
    };
  }

  const indexedPreflight = await fromIndexedMatches(
    hybridSearch(searchQuery, {
      ...options.searchOptions,
      exactFilename: parsed.exactFilename ?? options.searchOptions?.exactFilename,
      extensions: extensions.length > 0 ? extensions : options.searchOptions?.extensions,
      limit
    }),
    "index"
  );
  if (indexedPreflight.length > 0) {
    return {
      originalQuery: query,
      searchQuery,
      parsed,
      candidates: indexedPreflight,
      lowConfidenceCandidates: await findLowConfidenceOtherTypes(parsed, extensions, indexedPreflight, limit),
      searchedRoots: fileSearch.getRoots(),
      source: "index"
    };
  }

  const live = await fileSearch.search(parsed.cleanQuery || searchQuery, undefined, {
    fileTypes: extensions.length > 0 ? extensions : undefined,
    filenameCandidates: parsed.exactFilename ? [parsed.exactFilename] : undefined,
    keywords: parsed.keywords.length > 0 ? parsed.keywords : undefined
  });

  const liveCandidates = await fromLiveMatches(live.matches.slice(0, limit), fileSearch);
  if (liveCandidates.length > 0) {
    return {
      originalQuery: query,
      searchQuery,
      parsed,
      candidates: liveCandidates,
      lowConfidenceCandidates: [],
      searchedRoots: live.roots,
      source: "live"
    };
  }

  return {
    originalQuery: query,
    searchQuery,
    parsed,
    candidates: [],
    lowConfidenceCandidates: await findLowConfidenceOtherTypes(parsed, extensions, [], limit),
    searchedRoots: live.roots,
    source: "none"
  };
}

export function toApprovalCandidatePayload(candidate: FileRequestCandidate) {
  return {
    candidate_id: candidate.id,
    file_name: candidate.fileName,
    display_path: candidate.displayPath,
    extension: candidate.extension,
    mime_type: "application/octet-stream",
    size_bytes: candidate.sizeBytes,
    modified_at: candidate.modifiedAt,
    match_score: candidate.score,
    match_reason: candidate.reason,
    preview_url: candidate.previewUrl,
    safety_labels: ["Approval required", "Local path hidden from recipient"]
  };
}

export function toReceiverApprovalCandidatePayload(candidate: FileRequestCandidate) {
  return {
    ...toApprovalCandidatePayload(candidate),
    path: candidate.boundFilePath
  };
}

async function fromLiveMatches(matches: FileSearchMatch[], fileSearch: FileSearchService): Promise<FileRequestCandidate[]> {
  const candidates: FileRequestCandidate[] = [];
  for (const match of matches) {
    const inspected = await fileSearch.inspectFile(match.id);
    if (!inspected?.absolutePath || !inspected.sha256) continue;
    candidates.push({
      id: match.id,
      fileName: match.fileName,
      displayPath: `Local file / ${match.fileName}`,
      extension: match.extension,
      sizeBytes: inspected.sizeBytes,
      modifiedAt: inspected.modifiedAt,
      score: match.score,
      reason: match.reason || "live-root",
      previewUrl: match.previewUrl,
      boundFilePath: inspected.absolutePath,
      boundSha256: inspected.sha256,
      boundSizeBytes: inspected.sizeBytes,
      source: "live"
    });
  }
  return candidates;
}

async function fromIndexedMatches(
  matches: ReturnType<typeof hybridSearch> | FileRequestIndexedMatch[],
  source: "index" | "filename-index"
): Promise<FileRequestCandidate[]> {
  const candidates: FileRequestCandidate[] = [];
  for (const match of matches) {
    const file = await inspectIndexedPath(match.filePath);
    if (!file) continue;
    candidates.push({
      id: String(match.id),
      fileName: match.fileName,
      displayPath: `Local file / ${match.fileName}`,
      extension: match.extension || extname(match.fileName).toLowerCase(),
      sizeBytes: file.sizeBytes,
      modifiedAt: file.modifiedAt,
      score: match.score,
      reason: match.reason,
      boundFilePath: match.filePath,
      boundSha256: file.sha256,
      boundSizeBytes: file.sizeBytes,
      source
    });
  }
  return candidates;
}

async function inspectIndexedPath(filePath: string): Promise<{ sha256: string; sizeBytes: number; modifiedAt: string } | null> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return null;
    return {
      sha256: await hashFile(filePath),
      sizeBytes: info.size,
      modifiedAt: info.mtime.toISOString()
    };
  } catch {
    return null;
  }
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function normalizeExtensions(values: string[] = []): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase().replace(/^\./, "")).filter(Boolean))];
}

async function findLowConfidenceOtherTypes(
  parsed: FileRequestParseResult,
  requestedExtensions: string[],
  primary: FileRequestCandidate[],
  limit: number
): Promise<FileRequestCandidate[]> {
  if (requestedExtensions.length === 0) return [];
  const requested = new Set(requestedExtensions.map((value) => value.replace(/^\./, "").toLowerCase()));
  const primaryIds = new Set(
    primary
      .map((candidate) => Number(candidate.id))
      .filter((id) => Number.isSafeInteger(id))
  );
  const matches = searchFileRequest(parsed, {
    extensions: [],
    excludeIds: [...primaryIds]
  }).filter((match) => !requested.has(match.extension.replace(/^\./, "").toLowerCase()));
  const candidates = await fromIndexedMatches(matches.slice(0, limit), "filename-index");
  return candidates.map((candidate) => ({
    ...candidate,
    score: Math.min(candidate.score, 0.49),
    reason: `${candidate.reason}; requested extension hidden`
  }));
}
