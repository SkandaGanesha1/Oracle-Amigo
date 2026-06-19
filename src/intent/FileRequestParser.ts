import { z } from "zod";

const REQUEST_WORDS = new Set([
  "a",
  "an",
  "ask",
  "can",
  "could",
  "docin",
  "document",
  "file",
  "files",
  "find",
  "for",
  "from",
  "get",
  "give",
  "i",
  "locate",
  "me",
  "need",
  "please",
  "request",
  "send",
  "share",
  "show",
  "the",
  "to",
  "upload",
  "would",
  "you"
]);

const KNOWN_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
  "csv",
  "txt",
  "md",
  "json",
  "zip",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif"
];

const FILE_NAME_PATTERN = new RegExp(
  `([^\\\\/:*?"<>|\\r\\n]{1,180}\\.(${KNOWN_EXTENSIONS.join("|")}))\\b`,
  "i"
);

export const FileRequestParseResultSchema = z.object({
  originalText: z.string(),
  cleanQuery: z.string(),
  exactFilename: z.string().nullable(),
  normalizedFilename: z.string().nullable(),
  extensions: z.array(z.string()),
  keywords: z.array(z.string()),
  requestWordsRemoved: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  confidenceReason: z.enum(["filename", "extension", "text"])
});

export type FileRequestParseResult = z.infer<typeof FileRequestParseResultSchema>;

export function parseFileRequest(input: string): FileRequestParseResult {
  return new FileRequestParser().parse(input);
}

export class FileRequestParser {
  parse(input: string): FileRequestParseResult {
    const originalText = input.trim();
    const intentText = stripRemoteRouting(originalText);
    const extracted = extractFilename(intentText);
    const stripped = extracted ? stripLeadingRequestWords(extracted) : null;
    const exactFilename = stripped?.filename ?? null;
    const extensions = extensionHints(intentText, exactFilename);
    const cleanSource = exactFilename
      ? removeExtension(exactFilename)
      : intentText;
    const cleaned = cleanRequestText(cleanSource, extensions);
    const routingRemoved = intentText === originalText ? [] : ["remote_target"];
    const requestWordsRemoved = [...new Set([...(stripped?.removed ?? []), ...cleaned.removed, ...routingRemoved])];
    const keywords = tokenize(cleaned.text, extensions);

    return FileRequestParseResultSchema.parse({
      originalText,
      cleanQuery: keywords.length > 0 ? keywords.join(" ") : originalText,
      exactFilename,
      normalizedFilename: exactFilename ? normalizeFilename(exactFilename) : null,
      extensions,
      keywords,
      requestWordsRemoved,
      confidence: exactFilename ? 0.98 : extensions.length > 0 ? 0.72 : 0.45,
      confidenceReason: exactFilename ? "filename" : extensions.length > 0 ? "extension" : "text"
    });
  }
}

export function normalizeFilename(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function stripRemoteRouting(value: string): string {
  let text = value.trim();
  text = text.replace(/^\s*ask\s+("[^"]+"|'[^']+'|[A-Za-z][\w.-]*)\s+to\s+/i, "");
  text = text.replace(/^\s*request\s+(.+?)\s+from\s+("[^"]+"|'[^']+'|[A-Za-z][\w.-]*)\s*$/i, "$1");
  text = text.replace(/^\s*send\s+(?:a\s+)?file\s+request\s+to\s+("[^"]+"|'[^']+'|[A-Za-z][\w.-]*)\s+for\s+/i, "");
  return text.trim();
}

function extractFilename(value: string): string | null {
  const match = FILE_NAME_PATTERN.exec(value);
  if (!match) return null;
  return match[1].trim().replace(/^["'`]+|["'`]+$/g, "");
}

function stripLeadingRequestWords(value: string): { filename: string; removed: string[] } {
  const parts = value.trim().split(/\s+/);
  const removed: string[] = [];
  while (parts.length > 1) {
    const first = normalizeWord(parts[0]);
    if (!REQUEST_WORDS.has(first)) break;
    removed.push(first);
    parts.shift();
  }
  return { filename: parts.join(" ").trim(), removed };
}

function cleanRequestText(value: string, extensions: string[]): { text: string; removed: string[] } {
  const removed: string[] = [];
  const kept: string[] = [];
  const extensionWords = new Set(extensions.map((item) => item.replace(/^\./, "")));
  for (const raw of value.split(/\s+/)) {
    const word = normalizeWord(raw);
    if (!word) continue;
    if (REQUEST_WORDS.has(word) || extensionWords.has(word)) {
      removed.push(word);
      continue;
    }
    kept.push(raw.replace(/^[^\w.]+|[^\w.]+$/g, ""));
  }
  return {
    text: kept.join(" ").replace(/\s+/g, " ").trim(),
    removed: [...new Set(removed)]
  };
}

function extensionHints(text: string, exactFilename: string | null): string[] {
  const values = new Set<string>();
  if (exactFilename) {
    const match = /\.([a-z0-9]+)$/i.exec(exactFilename);
    if (match) values.add(`.${match[1].toLowerCase()}`);
  }
  const extPattern = new RegExp(`\\b(${KNOWN_EXTENSIONS.join("|")})\\b`, "gi");
  for (const match of text.matchAll(extPattern)) {
    values.add(`.${match[1].toLowerCase()}`);
  }
  return [...values];
}

function removeExtension(value: string): string {
  return value.replace(/\.[a-z0-9]+$/i, "");
}

function tokenize(value: string, extensions: string[] = []): string[] {
  const extensionWords = new Set(extensions.map((item) => item.replace(/^\./, "")));
  return [...new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 1 && !REQUEST_WORDS.has(item) && !extensionWords.has(item))
  )];
}

function normalizeWord(value: string): string {
  return value.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
}
