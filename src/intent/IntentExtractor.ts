import { z } from "zod";
import { getLlmProvider, type LlmProvider } from "../oci/LlmProvider.js";

const FILE_ACTION_KEYWORDS = /\b(find|send|share|show|locate|get|open|search|look for|give me|request)\b/i;
const FILE_OBJECT_KEYWORDS = /\b(file|files|document|documents|doc|docs|pdf|invoice|report|spreadsheet|presentation|deck|ppt|pptx|xls|xlsx|csv|txt|md|image|photo|zip|attachment|certificate)\b/i;
const EXT_MAP: Record<string, string[]> = {
  pdf: ["pdf"], doc: ["doc", "docx"], docx: ["docx", "doc"],
  ppt: ["ppt", "pptx"], pptx: ["pptx", "ppt"], xls: ["xls", "xlsx"],
  xlsx: ["xlsx", "xls"], csv: ["csv"], txt: ["txt"], md: ["md"],
  png: ["png"], jpg: ["jpg", "jpeg"], jpeg: ["jpeg", "jpg"],
  zip: ["zip"], ts: ["ts"], js: ["js"], json: ["json"],
};
const DATE_PATTERN = /\b(today|yesterday|last\s+\w+|this\s+\w+|\d{4}|\d{1,2}\/\d{1,2})\b/i;

export type IntentResult = {
  intent: "file_request" | "normal_chat" | "unknown";
  requestedItem: string;
  fileTypeHints: string[];
  extensions: string[];
  projectHints: string[];
  dateHint: string | null;
  confidence: number;
};

export interface IntentExtractor {
  extract(text: string): IntentResult;
}

export class RuleBasedIntentExtractor implements IntentExtractor {
  extract(text: string): IntentResult {
    const hasFileAction = FILE_ACTION_KEYWORDS.test(text);
    const hasFileObject = FILE_OBJECT_KEYWORDS.test(text);
    const extMatches = [...text.matchAll(/\b(pdf|docx?|pptx?|xlsx?|csv|txt|md|png|jpe?g|zip|ts|js|json)\b/gi)].map((m) => m[1].toLowerCase());
    const extensions = [...new Set(extMatches.flatMap((e) => EXT_MAP[e] ?? [e]))];
    const dateMatch = text.match(DATE_PATTERN);
    const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
    const stopWords = new Set(["find", "send", "share", "show", "locate", "the", "file", "document", "please", "can", "you", "and", "for", "from", "get", "give", "open"]);
    const projectHints = words.filter((w) => !stopWords.has(w) && !extMatches.includes(w));

    const isFileRequest = extensions.length > 0 || (hasFileAction && hasFileObject);

    return {
      intent: isFileRequest ? "file_request" : "normal_chat",
      requestedItem: text.trim(),
      fileTypeHints: extMatches,
      extensions,
      projectHints,
      dateHint: dateMatch ? dateMatch[0] : null,
      confidence: isFileRequest ? (hasFileAction && extensions.length > 0 ? 0.95 : 0.75) : 0.65,
    };
  }
}

const IntentResultSchema = z.object({
  intent: z.enum(["file_request", "normal_chat", "unknown"]),
  requestedItem: z.string(),
  fileTypeHints: z.array(z.string()),
  extensions: z.array(z.string()),
  projectHints: z.array(z.string()),
  dateHint: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

const INTENT_SYSTEM_PROMPT = `You are an intent classifier for a local file-search agent. Return ONLY strict JSON matching the schema. No markdown, no prose. Schema: {"intent":"file_request"|"normal_chat"|"unknown","requestedItem":"string","fileTypeHints":["string"],"extensions":["string"],"projectHints":["string"],"dateHint":"string|null","confidence":0.0-1.0}`;

export class LlmIntentExtractor implements IntentExtractor {
  constructor(private readonly fallback: IntentExtractor, private readonly llm: LlmProvider) {}
  extract(text: string): IntentResult {
    if (!this.llm.isAvailable()) return this.fallback.extract(text);
    try {
      // Synchronous wrapper: use deasync-style fallback if LLM is async
      // For simplicity, use the sync fallback path and queue async refinement via fire-and-forget
      const result = this.fallback.extract(text);
      void this.llm.generateStructured({
        systemPrompt: INTENT_SYSTEM_PROMPT,
        userInput: text,
        schema: IntentResultSchema,
      }).then((llmResult) => {
        // Best-effort: log LLM classification, can be used to refine over time
        if (process.env.DEBUG_LLM_INTENT) {
          console.log("[LlmIntentExtractor]", { text, result, llmResult });
        }
      }).catch(() => { /* silent fallback */ });
      return result;
    } catch {
      return this.fallback.extract(text);
    }
  }
}

export function createIntentExtractor(): IntentExtractor {
  const ruleBased = new RuleBasedIntentExtractor();
  const llm = getLlmProvider();
  return new LlmIntentExtractor(ruleBased, llm);
}
