import { z } from "zod";
import { getLlmProvider, type LlmProvider } from "../oci/LlmProvider.js";
import { parseFileRequest } from "./FileRequestParser.js";

export type RewrittenQuery = {
  original: string;
  normalized: string;
  lexicalQuery: string;
  semanticQuery: string;
  fileTypeHints: string[];
  extensions: string[];
  projectHints: string[];
  dateHint: string | null;
  exactFilename: string | null;
};

export interface QueryRewriter {
  rewrite(query: string): RewrittenQuery;
}

const STOP_WORDS = new Set([
  "find", "send", "share", "show", "locate", "get", "open", "search",
  "look", "give", "the", "a", "an", "file", "document", "please",
  "can", "you", "and", "for", "from", "to", "of", "in", "on", "at",
  "with", "by", "is", "are", "was", "were", "this", "that", "i",
  "me", "my", "we", "our", "need", "would", "could", "should",
  "want", "like", "have", "has", "do", "does", "did", "will",
  "any", "all", "some", "just", "about", "up", "down", "out",
  "over", "if", "then", "than", "so", "no", "not", "be", "been",
  "being", "it", "its", "your", "his", "her", "their", "them",
]);
const FILE_EXT_PATTERN = /\b(pdf|docx?|pptx?|xlsx?|csv|txt|md|png|jpe?g|gif|bmp|svg|zip|tar|gz|rar|ts|js|jsx|tsx|json|xml|yaml|yml|toml|cfg|conf|ini|log|sql|py|rb|go|rs|java|cpp|c|h|hpp|css|scss|less|html|htm|vue|svelte|wasm)\b/gi;
const DATE_PATTERN = /\b(today|yesterday|last\s+\w+|this\s+\w+|\d{4}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/i;
const EXT_MAP: Record<string, string[]> = {
  pdf: ["pdf"], doc: ["doc", "docx"], docx: ["docx", "doc"],
  ppt: ["ppt", "pptx"], pptx: ["pptx", "ppt"], xls: ["xls", "xlsx"],
  xlsx: ["xlsx", "xls"], csv: ["csv"], txt: ["txt"], md: ["md"],
  png: ["png"], jpg: ["jpg", "jpeg"], jpeg: ["jpeg", "jpg"],
  zip: ["zip"], ts: ["ts"], js: ["js"], json: ["json"],
  yaml: ["yaml", "yml"], yml: ["yaml", "yml"],
};

export class RuleBasedQueryRewriter implements QueryRewriter {
  rewrite(query: string): RewrittenQuery {
    const lowered = query.toLowerCase().trim();
    const fileRequest = parseFileRequest(query);
    if (!lowered) {
      return { original: query, normalized: "", lexicalQuery: "", semanticQuery: "", fileTypeHints: [], extensions: [], projectHints: [], dateHint: null, exactFilename: null };
    }

    const words = lowered.split(/\s+/);
    const meaningful = words.filter((w) => w.length > 1 && !STOP_WORDS.has(w));
    const normalized = meaningful.join(" ");

    const extMatches = [...lowered.matchAll(FILE_EXT_PATTERN)].map((m) => m[1].toLowerCase());
    const fileTypeHints = [...new Set(extMatches)];
    const extensions = [...new Set([
      ...fileTypeHints.flatMap((e) => EXT_MAP[e] ?? [e]),
      ...fileRequest.extensions.map((extension) => extension.replace(/^\./, ""))
    ])];

    const dateMatch = lowered.match(DATE_PATTERN);
    const dateHint = dateMatch ? dateMatch[0] : null;

    const extSet = new Set(fileTypeHints);
    const projectHints = [...new Set(meaningful.filter((w) => !extSet.has(w)))];

    const cleanTerms = projectHints.filter((w) => /^[a-z0-9]+$/.test(w));
    const lexicalQuery = cleanTerms.join(" ");
    const semanticQuery = [...new Set([...projectHints, ...fileTypeHints])].join(" ");

    return { original: query, normalized, lexicalQuery, semanticQuery, fileTypeHints, extensions, projectHints, dateHint, exactFilename: fileRequest.exactFilename };
  }
}

const RewrittenQuerySchema = z.object({
  normalized: z.string(),
  lexicalQuery: z.string(),
  semanticQuery: z.string(),
  fileTypeHints: z.array(z.string()),
  extensions: z.array(z.string()),
  projectHints: z.array(z.string()),
  dateHint: z.string().nullable(),
  exactFilename: z.string().nullable().optional(),
});

const REWRITE_SYSTEM_PROMPT = `You are a query rewriter for a local file-search agent. Normalize the user query by removing filler words, extracting exact filenames, file type hints (pdf, docx, pptx, xlsx, etc.), project hints, and date hints. Return ONLY strict JSON matching the schema. No markdown, no prose. Schema: {"normalized":"string (lowercase, no stop words)","lexicalQuery":"string (alphanumeric terms, FTS5-friendly)","semanticQuery":"string (meaningful terms + file types, for embedding)","fileTypeHints":["string"],"extensions":["string"],"projectHints":["string"],"dateHint":"string|null","exactFilename":"string|null"}`;

export class LlmQueryRewriter implements QueryRewriter {
  constructor(private readonly fallback: QueryRewriter, private readonly llm: LlmProvider) {}
  rewrite(query: string): RewrittenQuery {
    if (!this.llm.isAvailable()) return this.fallback.rewrite(query);
    try {
      const result = this.fallback.rewrite(query);
      // Fire-and-forget async refinement: best-effort LLM call, never blocks sync path
      void this.llm.generateStructured({
        systemPrompt: REWRITE_SYSTEM_PROMPT,
        userInput: query,
        schema: RewrittenQuerySchema,
      }).then((llmResult) => {
        if (process.env.DEBUG_LLM_REWRITE) {
          console.log("[LlmQueryRewriter]", { query, result, llmResult });
        }
      }).catch(() => { /* silent fallback */ });
      return result;
    } catch {
      return this.fallback.rewrite(query);
    }
  }
}

export function createQueryRewriter(): QueryRewriter {
  const ruleBased = new RuleBasedQueryRewriter();
  const llm = getLlmProvider();
  return new LlmQueryRewriter(ruleBased, llm);
}
