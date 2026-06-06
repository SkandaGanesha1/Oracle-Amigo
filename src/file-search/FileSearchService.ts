import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { opendir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, join, parse, resolve, sep, delimiter } from "node:path";
import { homedir } from "node:os";

export type FileSearchCommand = {
  id: string;
  label: string;
  command: string;
  status: "running" | "completed" | "failed";
  stdout: string;
  stderr?: string;
  durationMs: number;
};

export type FileSearchProgressListener = (command: FileSearchCommand) => void;

export type FileSearchMatch = {
  id: string;
  fileName: string;
  directory: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: string;
  score: number;
  reason: string;
  previewUrl: string;
};

export type FileSearchOptions = {
  roots?: string[];
  fileTypes?: string[];
  filenameCandidates?: string[];
  keywords?: string[];
};

export type FileSearchResult = {
  planId: string;
  query: string;
  status: "found" | "not_found";
  parsedFileName: string | null;
  terminal: {
    shell: "PowerShell";
    cwd: string;
    executionMode: "sandbox-file-search";
  };
  roots: string[];
  commands: FileSearchCommand[];
  matches: FileSearchMatch[];
  selectedMatch: FileSearchMatch | null;
};

export type FileInspection = {
  id: string;
  absolutePath: string;
  fileName: string;
  directory: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: string;
  sha256: string;
  sensitivity: "public" | "internal" | "confidential" | "restricted";
  preview: string;
};

type IndexedFile = FileSearchMatch & {
  absolutePath: string;
};

type Candidate = {
  absolutePath: string;
  sizeBytes: number;
  modifiedAt: Date;
  score: number;
  reason: string;
};

const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "dist", ".vite", ".turbo", "coverage"]);
const MAX_MATCHES = 20;
const MAX_CANDIDATES = 250;
const MAX_SEMANTIC_SNIPPET_BYTES = 64 * 1024;
const DEFAULT_MAX_ROOT_SCAN_MS = 12_000;
const DEFAULT_MAX_FILES_PER_ROOT = 25_000;
const QUERY_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "can",
  "could",
  "data",
  "deta",
  "device",
  "doc",
  "document",
  "drive",
  "file",
  "files",
  "find",
  "for",
  "from",
  "filetype",
  "give",
  "local",
  "locate",
  "me",
  "need",
  "open",
  "or",
  "please",
  "preview",
  "storage",
  "send",
  "share",
  "show",
  "the",
  "to",
  "type",
  "upload",
  "you"
]);

type WalkState = {
  deadlineMs: number;
  maxFiles: number;
  scannedFiles: number;
  stoppedEarly: boolean;
  stopReason: string | null;
};

export class FileSearchService {
  private readonly fileIndex = new Map<string, IndexedFile>();

  constructor(private readonly roots = resolveSearchRoots()) {}

  getRoots(): string[] {
    return [...this.roots];
  }

  async search(query: string, onCommand?: FileSearchProgressListener, options: FileSearchOptions = {}): Promise<FileSearchResult> {
    const parsedFileName = extractFileName(query);
    const filenameCandidates = [...new Set([parsedFileName, ...(options.filenameCandidates ?? [])].filter(Boolean))] as string[];
    const fileTypes = normalizeFileTypes(options.fileTypes ?? extensionHints(filenameCandidates, query));
    const tokens = normalizeSearchTokens([...(options.keywords ?? []), ...tokenize(filenameCandidates.join(" ") || query)], fileTypes);
    if (filenameCandidates.length === 0 && fileTypes.length === 1 && tokens.length > 0) {
      filenameCandidates.push(`${tokens.join(" ")}.${fileTypes[0]}`);
    }
    filenameCandidates.push(...buildFilenameCandidates(tokens, fileTypes));
    const filter = buildFilter(tokens, fileTypes);
    const roots = normalizeRoots(options.roots, this.roots);
    const planId = createId(`plan:${query}:${Date.now()}`);
    const commands: FileSearchCommand[] = [];
    const recordCommand = (command: FileSearchCommand) => {
      commands.push(command);
      onCommand?.(command);
    };
    recordCommand({
      id: "pwd",
      label: "Confirm working directory",
      command: "Get-Location",
      status: "completed",
      stdout: process.cwd(),
      durationMs: 0
    });

    const candidates: Candidate[] = [];
    for (const root of roots) {
      const rootResult = await findExactMatchesInRoot(root, filenameCandidates, onCommand);
      const rootMatches = rootResult.matches;
      candidates.push(...rootMatches);
      commands.push(...rootResult.commands);
      if (rootMatches.length > 0) break;
    }

    if (candidates.length === 0) {
      for (const root of roots) {
        const rootResult = await findRecursiveMatchesInRoot(root, tokens, filenameCandidates, fileTypes, filter, onCommand);
        const rootMatches = rootResult.matches;
        candidates.push(...rootMatches);
        commands.push(...rootResult.commands);
      }
    }

    const matches = candidates
      .sort((left, right) => right.score - left.score || left.absolutePath.localeCompare(right.absolutePath))
      .slice(0, MAX_MATCHES)
      .map((candidate) => this.indexFile(candidate));

    recordCommand({
      id: "select-preview",
      label: "Prepare document preview",
      command: "Resolve-Path <matched-pdf> | Select-Object Directory,Name",
      status: matches.length > 0 ? "completed" : "failed",
      stdout:
        matches.length > 0
          ? `Selected ${matches[0].fileName}\nDirectory: ${matches[0].directory}`
          : "No PDF preview was prepared because no matching file was found.",
      stderr: matches.length > 0 ? undefined : "No matching PDF file in the allowed search roots.",
      durationMs: 0
    });

    return {
      planId,
      query,
      status: matches.length > 0 ? "found" : "not_found",
      parsedFileName,
      terminal: {
        shell: "PowerShell",
        cwd: process.cwd(),
        executionMode: "sandbox-file-search"
      },
      roots,
      commands,
      matches,
      selectedMatch: matches[0] ?? null
    };
  }

  async createPreviewStream(fileId: string) {
    const file = this.fileIndex.get(fileId);
    if (!file) return null;
    if (!(await isAllowedRealPath(file.absolutePath, this.roots))) return null;
    if (extname(file.absolutePath).toLowerCase() !== ".pdf") return null;

    const safePath = await realpath(file.absolutePath);
    const fileStat = await stat(safePath);
    if (!fileStat.isFile()) return null;

    return {
      fileName: file.fileName,
      stream: createReadStream(safePath)
    };
  }

  async inspectFile(fileId: string): Promise<FileInspection | null> {
    const file = this.fileIndex.get(fileId);
    if (!file) return null;
    if (!(await isAllowedRealPath(file.absolutePath, this.roots))) return null;

    const safePath = await realpath(file.absolutePath);
    const fileStat = await stat(safePath);
    if (!fileStat.isFile()) return null;

    const preview = await createSafePreview(safePath, file.extension);
    return {
      id: file.id,
      absolutePath: safePath,
      fileName: file.fileName,
      directory: dirname(safePath),
      extension: file.extension,
      sizeBytes: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
      sha256: await hashFile(safePath),
      sensitivity: classifySensitivity(safePath, preview),
      preview: redactPreview(preview)
    };
  }

  private indexFile(candidate: Candidate): FileSearchMatch {
    const id = createId(candidate.absolutePath);
    const existing = this.fileIndex.get(id);
    if (existing) return toPublicMatch(existing);

    const indexed: IndexedFile = {
      id,
      absolutePath: candidate.absolutePath,
      fileName: basename(candidate.absolutePath),
      directory: dirname(candidate.absolutePath),
      extension: extname(candidate.absolutePath).toLowerCase(),
      sizeBytes: candidate.sizeBytes,
      modifiedAt: candidate.modifiedAt.toISOString(),
      score: candidate.score,
      reason: candidate.reason,
      previewUrl: `/agent/files/${id}`
    };
    this.fileIndex.set(id, indexed);
    return toPublicMatch(indexed);
  }
}

function resolveSearchRoots(): string[] {
  const configuredRoots = process.env.SANDBOX_FILE_SEARCH_ROOTS;
  const rawRoots =
    configuredRoots && configuredRoots.trim().length > 0
      ? configuredRoots.split(delimiter)
      : [
          process.cwd(),
          join(homedir(), "Desktop"),
          join(homedir(), "Documents"),
          join(homedir(), "Downloads"),
          join(homedir(), "Pictures"),
          join(homedir(), "Videos"),
          join(homedir(), "Music")
        ];

  const seen = new Set<string>();
  return rawRoots
    .map((root) => resolve(root.trim()))
    .filter((root) => {
      if (!root || seen.has(root.toLowerCase())) return false;
      seen.add(root.toLowerCase());
      return true;
    });
}

async function findExactMatchesInRoot(
  root: string,
  filenameCandidates: string[],
  onCommand?: FileSearchProgressListener
): Promise<{ matches: Candidate[]; commands: FileSearchCommand[] }> {
  const results: Candidate[] = [];
  const commands: FileSearchCommand[] = [];
  const recordCommand = (command: FileSearchCommand) => {
    commands.push(command);
    onCommand?.(command);
  };
  try {
    for (const exactFileName of filenameCandidates) {
      const exactStartedAt = Date.now();
      const exactCommand = {
        id: createId(`exact:${root}:${exactFileName}`),
        label: `Check exact file in ${root}`,
        command: `Test-Path -LiteralPath "${join(root, exactFileName)}" -PathType Leaf`,
        status: "running" as const,
        stdout: "Checking exact path.",
        durationMs: 0
      };
      onCommand?.(exactCommand);
      const directMatch = await tryCandidate(join(root, exactFileName), [root]);
      recordCommand({
        ...exactCommand,
        status: "completed",
        stdout: directMatch ? directMatch.absolutePath : "Exact file was not found directly under this root.",
        durationMs: Date.now() - exactStartedAt
      });
      if (directMatch) return { matches: [directMatch], commands };
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { matches: results, commands };
    }
    throw error;
  }
  return { matches: results, commands };
}

async function findRecursiveMatchesInRoot(
  root: string,
  tokens: string[],
  filenameCandidates: string[],
  fileTypes: string[],
  filter: string,
  onCommand?: FileSearchProgressListener
): Promise<{ matches: Candidate[]; commands: FileSearchCommand[] }> {
  const results: Candidate[] = [];
  const commands: FileSearchCommand[] = [];
  const recordCommand = (command: FileSearchCommand) => {
    commands.push(command);
    onCommand?.(command);
  };
  try {
    const state: WalkState = {
      deadlineMs: Date.now() + getRootScanTimeoutMs(),
      maxFiles: getRootScanMaxFiles(),
      scannedFiles: 0,
      stoppedEarly: false,
      stopReason: null
    };

    const recursiveStartedAt = Date.now();
    const recursiveCommand = {
      id: createId(`search:${root}:${filter}`),
      label: `Search recursively in ${root}`,
      command: `Get-ChildItem -Path "${root}" -Filter "${filter}" -Recurse -File -ErrorAction SilentlyContinue`,
      status: "running" as const,
      stdout: `Scanning ${root}`,
      durationMs: 0
    };
    onCommand?.(recursiveCommand);
    await walk(root, tokens, fileTypes, filenameCandidates, results, [root], state);
    const stoppedMessage = state.stoppedEarly
      ? `\nSearch stopped early after checking ${state.scannedFiles} file(s): ${state.stopReason}. Results may be partial.`
      : `\nChecked ${state.scannedFiles} file(s).`;
    recordCommand({
      ...recursiveCommand,
      status: "completed",
      stdout:
        results.length > 0
          ? `${results.map((match) => match.absolutePath).join("\n")}${stoppedMessage}`
          : state.stoppedEarly
            ? `No matching files found before the scan budget was reached.${stoppedMessage}`
            : `No matching files found.${stoppedMessage}`,
      stderr: state.stoppedEarly ? "Root scan stopped by the configured search budget." : undefined,
      durationMs: Date.now() - recursiveStartedAt
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { matches: results, commands };
    }
    throw error;
  }
  return { matches: results, commands };
}

async function tryCandidate(filePath: string, allowedRoots: string[]): Promise<Candidate | null> {
  try {
    const safePath = await realpath(filePath);
    if (!(await isAllowedRealPath(safePath, allowedRoots))) return null;
    const fileStat = await stat(safePath);
    if (!fileStat.isFile()) return null;
    return {
      absolutePath: safePath,
      sizeBytes: fileStat.size,
      modifiedAt: fileStat.mtime,
      score: 1,
      reason: "Exact filename match"
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      const code = String(error.code);
      if (["ENOENT", "EACCES", "EPERM", "ENOTDIR"].includes(code)) return null;
    }
    throw error;
  }
}

async function walk(
  directory: string,
  tokens: string[],
  fileTypes: string[],
  filenameCandidates: string[],
  results: Candidate[],
  allowedRoots: string[],
  state: WalkState
): Promise<void> {
  if (shouldStopWalk(state)) return;
  let entries;
  try {
    entries = await opendir(directory);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      const code = String(error.code);
      if (["ENOENT", "EACCES", "EPERM", "ENOTDIR"].includes(code)) return;
    }
    throw error;
  }

  for await (const entry of entries) {
    if (shouldStopWalk(state)) return;
    const absolutePath = join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) await walk(absolutePath, tokens, fileTypes, filenameCandidates, results, allowedRoots, state);
      continue;
    }
    if (!entry.isFile()) continue;
    const entryExtension = extname(entry.name).toLowerCase().replace(/^\./, "");
    if (fileTypes.length > 0 && !fileTypes.includes(entryExtension)) continue;
    state.scannedFiles += 1;
    if (shouldStopWalk(state)) return;
    const safePath = await realpath(absolutePath).catch(() => null);
    if (!safePath || !(await isAllowedRealPath(safePath, allowedRoots))) continue;
    const ranking = await rankFile(safePath, tokens, filenameCandidates, fileTypes);
    if (!ranking) continue;
    const fileStat = await stat(safePath);
    insertCandidate(results, {
      absolutePath: safePath,
      sizeBytes: fileStat.size,
      modifiedAt: fileStat.mtime,
      score: ranking.score,
      reason: ranking.reason
    });
  }
}

function insertCandidate(results: Candidate[], candidate: Candidate): void {
  results.push(candidate);
  results.sort((left, right) => right.score - left.score || left.absolutePath.localeCompare(right.absolutePath));
  if (results.length > MAX_CANDIDATES) results.length = MAX_CANDIDATES;
}

function extractFileName(query: string): string | null {
  const match = query.match(/(?:find|open|show|preview|locate)?\s*(?:the\s+)?([^"'<>|?*\r\n]+?\.[a-z0-9]{1,12})\b/i);
  if (!match) return null;
  return match[1].trim().replace(/^\[(Search|Think|Canvas):\s*/i, "");
}

function tokenize(value: string): string[] {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\.[a-z0-9]{1,12}$/i, "")
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 1)
    .filter((token) => !QUERY_STOPWORDS.has(token));
}

function normalizeSearchTokens(tokens: string[], fileTypes: string[]): string[] {
  const extensionSet = new Set(fileTypes.map((type) => type.toLowerCase()));
  const rawTokens = tokens.map((token) => token.toLowerCase()).filter((token) => !extensionSet.has(token));
  const normalized: string[] = [];
  for (let index = 0; index < rawTokens.length; index += 1) {
    const token = rawTokens[index];
    if (token === "non" && rawTokens[index + 1] === "po") {
      normalized.push("nonpo", "npo");
      index += 1;
      continue;
    }
    normalized.push(token);
  }
  return [...new Set(normalized)];
}

function buildFilenameCandidates(tokens: string[], fileTypes: string[]): string[] {
  if (fileTypes.length !== 1 || tokens.length === 0) return [];
  const extension = fileTypes[0];
  const baseTokens = tokens.filter((token) => token !== "npo" || !tokens.includes("nonpo"));
  const compactTokens = baseTokens.filter((token) => token.length > 2);
  const tokenSets = [baseTokens, compactTokens].filter((set, index, sets) => set.length > 0 && sets.findIndex((candidate) => candidate.join("|") === set.join("|")) === index);
  const candidates: string[] = [];
  for (const tokenSet of tokenSets) {
    for (const separator of [" ", "_", "-", ""]) {
      candidates.push(`${tokenSet.join(separator)}.${extension}`);
    }
  }
  return [...new Set(candidates)];
}

function shouldStopWalk(state: WalkState): boolean {
  if (state.stoppedEarly) return true;
  if (Date.now() > state.deadlineMs) {
    state.stoppedEarly = true;
    state.stopReason = `root time limit of ${getRootScanTimeoutMs()} ms reached`;
    return true;
  }
  if (state.scannedFiles >= state.maxFiles) {
    state.stoppedEarly = true;
    state.stopReason = `root file limit of ${state.maxFiles} reached`;
    return true;
  }
  return false;
}

function getRootScanTimeoutMs(): number {
  const configured = Number(process.env.FILE_SEARCH_ROOT_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_ROOT_SCAN_MS;
}

function getRootScanMaxFiles(): number {
  const configured = Number(process.env.FILE_SEARCH_MAX_FILES_PER_ROOT);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_FILES_PER_ROOT;
}

async function rankFile(filePath: string, tokens: string[], filenameCandidates: string[], fileTypes: string[]): Promise<{ score: number; reason: string } | null> {
  const fileName = basename(filePath);
  const normalizedName = fileName.toLowerCase();
  const normalizedPath = filePath.toLowerCase();
  const compactPath = normalizedPath.replace(/[^a-z0-9]/gi, "");
  const extension = extname(fileName).toLowerCase().replace(/^\./, "");
  if (fileTypes.length > 0 && !fileTypes.includes(extension)) return null;
  if (filenameCandidates.some((candidate) => candidate.toLowerCase() === normalizedName)) {
    return { score: 1, reason: "Exact filename match" };
  }
  const matchedTokens = tokens.filter((token) => {
    const normalizedToken = token.toLowerCase();
    return normalizedPath.includes(normalizedToken) || compactPath.includes(normalizedToken);
  });
  const semanticTokens = await matchedSemanticTokens(filePath, tokens);
  const fuzzyScore = filenameCandidates.some((candidate) => fuzzyContains(normalizedName, candidate.toLowerCase())) ? 0.25 : 0;
  const evidenceCount = new Set([...matchedTokens, ...semanticTokens]).size;
  if (tokens.length > 0 && evidenceCount === 0 && fuzzyScore === 0) return null;
  if (tokens.length >= 3 && evidenceCount < 2 && fuzzyScore === 0) return null;
  const tokenScore = tokens.length === 0 ? 0.2 : matchedTokens.length / tokens.length;
  const semanticScore = tokens.length === 0 ? 0 : semanticTokens.length / tokens.length;
  const extScore = fileTypes.length > 0 ? 0.15 : 0;
  const score = Math.min(0.99, tokenScore * 0.55 + semanticScore * 0.3 + extScore + fuzzyScore);
  const reasons = [
    matchedTokens.length > 0
      ? `lexical path match on ${matchedTokens.length} token${matchedTokens.length === 1 ? "" : "s"}`
      : null,
    semanticTokens.length > 0
      ? `semantic content match on ${semanticTokens.length} token${semanticTokens.length === 1 ? "" : "s"}`
      : null,
    extension ? `.${extension}` : null
  ].filter(Boolean);
  return {
    score,
    reason: `Matched ${reasons.join(", ")}`
  };
}

async function matchedSemanticTokens(filePath: string, tokens: string[]): Promise<string[]> {
  if (tokens.length === 0 || !isSemanticTextFile(filePath)) return [];
  if (isLikelySensitivePath(filePath)) return [];
  const content = await readFile(filePath, "utf8").catch(() => "");
  if (!content) return [];
  const normalized = content.slice(0, MAX_SEMANTIC_SNIPPET_BYTES).toLowerCase();
  return tokens.filter((token) => normalized.includes(token.toLowerCase()));
}

function isLikelySensitivePath(filePath: string): boolean {
  return /(\.env\b|private[_-]?key|password|secret|token|credential|\.oci[\\/]|\.ssh[\\/]|id_rsa|id_ed25519)/i.test(filePath);
}

function isSemanticTextFile(filePath: string): boolean {
  return [".txt", ".md", ".json", ".csv", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".html", ".css", ".xml", ".yml", ".yaml"].includes(
    extname(filePath).toLowerCase()
  );
}

async function isAllowedRealPath(filePath: string, roots: string[]): Promise<boolean> {
  const resolvedPath = await realpath(filePath).catch(() => resolve(filePath));
  const lowerPath = resolvedPath.toLowerCase();
  for (const root of roots) {
    const resolvedRoot = await realpath(root).catch(() => resolve(root));
    const lowerRoot = resolvedRoot.toLowerCase();
    const rootWithSeparator = lowerRoot.endsWith(sep) ? lowerRoot : `${lowerRoot}${sep}`;
    if (lowerPath === lowerRoot || lowerPath.startsWith(rootWithSeparator)) return true;
  }
  return false;
}

function isAllowedPath(filePath: string, roots: string[]): boolean {
  const resolvedPath = resolve(filePath).toLowerCase();
  return roots.some((root) => {
    const resolvedRoot = resolve(root).toLowerCase();
    const rootWithSeparator = resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`;
    return (
      resolvedPath === resolvedRoot ||
      resolvedPath.startsWith(rootWithSeparator)
    );
  });
}

function createId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function toPublicMatch(file: IndexedFile): FileSearchMatch {
  return {
    id: file.id,
    fileName: file.fileName,
    directory: file.directory,
    extension: file.extension,
    sizeBytes: file.sizeBytes,
    modifiedAt: file.modifiedAt,
    score: file.score,
    reason: file.reason,
    previewUrl: file.previewUrl
  };
}

function buildFilter(tokens: string[], fileTypes: string[]): string {
  const tokenPart = tokens.length > 0 ? `*${tokens.join("*")}*` : "*";
  if (fileTypes.length === 1) return `${tokenPart}.${fileTypes[0]}`;
  return tokenPart;
}

function normalizeFileTypes(fileTypes: string[]): string[] {
  return [...new Set(fileTypes.map((type) => type.trim().toLowerCase().replace(/^\./, "")).filter(Boolean))];
}

function extensionHints(filenameCandidates: string[], query: string): string[] {
  const fromNames = filenameCandidates.map((candidate) => extname(candidate).replace(/^\./, ""));
  const fromQuery = [...query.matchAll(/\b(?:pdf|txt|docx|doc|xlsx|csv|pptx|png|jpg|jpeg|zip|json|ts|tsx|js|md)\b/gi)].map((match) => match[0]);
  return [...fromNames, ...fromQuery];
}

function normalizeRoots(requestedRoots: string[] | undefined, defaultRoots: string[]): string[] {
  const allowFullDrive = process.env.ALLOW_FULL_DRIVE_SEARCH === "true";
  const normalizedDefaults = uniqueResolvedRoots(defaultRoots);
  const requested = requestedRoots && requestedRoots.length > 0 ? uniqueResolvedRoots(requestedRoots) : [];
  const constrainedRequested = allowFullDrive
    ? requested
    : requested.filter((root) => normalizedDefaults.some((allowedRoot) => isPathInsideResolvedRoot(root, allowedRoot)));
  const candidates = constrainedRequested.length > 0 ? constrainedRequested : normalizedDefaults;
  const safeRoots = allowFullDrive ? [...candidates, parse(homedir()).root] : candidates;
  return uniqueResolvedRoots(safeRoots);
}

function uniqueResolvedRoots(roots: string[]): string[] {
  const seen = new Set<string>();
  return roots
    .map((root) => resolve(root.trim()))
    .filter((root) => {
      if (!root || seen.has(root.toLowerCase())) return false;
      seen.add(root.toLowerCase());
      return true;
    });
}

function isPathInsideResolvedRoot(pathValue: string, rootValue: string): boolean {
  const lowerPath = resolve(pathValue).toLowerCase();
  const lowerRoot = resolve(rootValue).toLowerCase();
  const rootWithSeparator = lowerRoot.endsWith(sep) ? lowerRoot : `${lowerRoot}${sep}`;
  return lowerPath === lowerRoot || lowerPath.startsWith(rootWithSeparator);
}

function fuzzyContains(fileName: string, candidate: string): boolean {
  const left = fileName.replace(/[^a-z0-9]/gi, "");
  const right = candidate.replace(/[^a-z0-9]/gi, "");
  return Boolean(right) && (left.includes(right) || right.includes(left));
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

async function createSafePreview(filePath: string, extension: string): Promise<string> {
  if (extension === ".pdf") return "PDF document. Inline preview is available after approval.";
  if (![".txt", ".md", ".json", ".csv", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".html", ".css", ".xml", ".yml", ".yaml"].includes(extension)) {
    return "Preview unavailable for this binary or unsupported file type.";
  }
  const content = await readFile(filePath, "utf8").catch(() => "");
  return content.slice(0, 2000);
}

function classifySensitivity(filePath: string, preview: string): FileInspection["sensitivity"] {
  const value = `${filePath}\n${preview}`;
  if (/(\.env\b|private[_-]?key|password|secret|token|credential|\.oci[\\/]|\.ssh[\\/]|id_rsa|id_ed25519)/i.test(value)) {
    return "restricted";
  }
  if (/\b(confidential|nda|contract|invoice|tax|salary|offer|passport|ssn|bank)\b/i.test(value)) {
    return "confidential";
  }
  return "internal";
}

function redactPreview(preview: string): string {
  return preview
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/(password|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
}
