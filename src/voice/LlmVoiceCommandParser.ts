import { z } from "zod";
import type { LlmProvider } from "../oci/LlmProvider.js";
import { VoiceCommandParseResultSchema, type VoiceCommandParseResult } from "./VoiceCommandTypes.js";
import type { VoiceCommandParserInput } from "./VoiceCommandParserInterface.js";

const LlmVoiceCommandSchema = z.object({
  schema_version: z.literal("voice-command.v1"),
  intent: z.enum([
    "remote_file_request",
    "local_file_search",
    "find_file",
    "show_pending_approvals",
    "show_approvals",
    "open_chat",
    "show_received_files",
    "show_files_received",
    "open_inbox",
    "unknown"
  ]),
  target_person_query: z.string().nullable(),
  file_query: z.string().nullable(),
  file_extensions: z.array(z.string()).default([]),
  requester_reference: z.literal("current_user"),
  confidence: z.number().min(0).max(1),
  requires_confirmation: z.boolean(),
  missing_fields: z.array(z.string()).default([]),
  original_transcript: z.string()
});

type LlmVoiceCommand = z.infer<typeof LlmVoiceCommandSchema>;

const SYSTEM_PROMPT = `You are Oracle Amigo's voice command parser.

Convert the transcript into strict JSON matching the schema.

Supported intents:
1. remote_file_request  — user asks someone else to send a file
2. local_file_search    — user wants to find a file on their own device
3. show_pending_approvals — user wants to see items waiting for their approval
4. open_chat            — user wants to open a chat conversation
5. show_received_files  — user wants to see files received from someone
6. open_inbox           — user wants to open their Oracle Amigo inbox
7. unknown              — none of the above match

Rules:
- Do not invent people or filenames.
- requester_reference must always be "current_user".
- If the command asks another person to send a file, use remote_file_request.
- Extract the target person as target_person_query (name or email as spoken).
- Extract the requested file as file_query (natural language description).
- Extract file extension hints like pdf, docx, pptx, xlsx, png, jpg, mp4, zip, py, ts.
- If confidence is below 0.7, add the ambiguous field to missing_fields.
- Return JSON only — no markdown, no explanation, no code fences.`;

export class LlmVoiceCommandParser {
  constructor(private readonly llm: LlmProvider) {}

  /**
   * Accepts either a plain transcript string or a full VoiceCommandParserInput,
   * implementing the VoiceCommandParser interface contract.
   */
  async parse(input: string | VoiceCommandParserInput): Promise<VoiceCommandParseResult> {
    const transcript = typeof input === "string" ? input : input.transcript;
    const currentUser = typeof input === "string" ? null : (input.currentUser ?? null);

    if (!this.llm.isAvailable()) {
      console.warn("[LlmVoiceCommandParser] LLM provider is not configured — falling back to low-confidence result. Check OCI_GENAI_MODEL_ID, OCI_GENAI_SERVICE_ENDPOINT, OCI_GENAI_COMPARTMENT_ID env vars.");
      return lowConfidence(transcript, "LLM parser is not configured.");
    }

    try {
      return toParseResult(await this.generate(transcript, currentUser));
    } catch (firstError) {
      console.warn("[LlmVoiceCommandParser] First parse attempt failed:", firstError instanceof Error ? firstError.message : String(firstError));
      try {
        const repaired = await this.generate(transcript, currentUser, {
          previous_error: firstError instanceof Error ? firstError.message : String(firstError),
          instruction: "Repair the prior output. Return valid JSON only."
        });
        return toParseResult(repaired);
      } catch (secondError) {
        console.error("[LlmVoiceCommandParser] Repair attempt also failed:", secondError instanceof Error ? secondError.message : String(secondError));
        return lowConfidence(transcript, "LOW_CONFIDENCE_PARSE");
      }
    }
  }

  private async generate(
    transcript: string,
    currentUser: VoiceCommandParserInput["currentUser"],
    extra?: Record<string, unknown>
  ): Promise<LlmVoiceCommand> {
    const userContext = currentUser
      ? `\nCurrent user: ${currentUser.displayName ?? currentUser.email ?? currentUser.userId}`
      : "";

    const userInput = extra
      ? { transcript, ...extra }
      : { transcript, context: `Parse this voice command.${userContext}` };

    const output = await this.llm.generateStructured<unknown>({
      systemPrompt: SYSTEM_PROMPT,
      userInput,
      schema: LlmVoiceCommandSchema,
      temperature: 0,
      maxOutputTokens: 500
    });
    return LlmVoiceCommandSchema.parse(output);
  }
}

function toParseResult(value: LlmVoiceCommand): VoiceCommandParseResult {
  const intent = normalizeIntent(value.intent);
  return VoiceCommandParseResultSchema.parse({
    schemaVersion: "voice-command.v1",
    intent,
    targetPersonQuery: value.target_person_query || undefined,
    fileQuery: value.file_query || undefined,
    fileExtensions: value.file_extensions.map((item) => item.toLowerCase().replace(/^\./, "")),
    requesterReference: "current_user",
    confidence: value.confidence,
    requiresConfirmation: value.requires_confirmation || intent === "remote_file_request",
    missingFields: value.missing_fields,
    originalTranscript: value.original_transcript,
    parserProvider: "llm"
  });
}

function normalizeIntent(value: LlmVoiceCommand["intent"]): VoiceCommandParseResult["intent"] {
  if (value === "local_file_search") return "find_file";
  if (value === "show_pending_approvals") return "show_approvals";
  if (value === "show_received_files") return "show_files_received";
  return value;
}

function lowConfidence(transcript: string, error: string): VoiceCommandParseResult {
  return VoiceCommandParseResultSchema.parse({
    schemaVersion: "voice-command.v1",
    intent: "unknown",
    confidence: 0.2,
    requiresConfirmation: true,
    fileExtensions: [],
    requesterReference: "current_user",
    missingFields: ["intent"],
    originalTranscript: transcript.trim(),
    parserProvider: "fallback",
    error
  });
}
