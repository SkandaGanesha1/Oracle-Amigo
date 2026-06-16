import { z } from "zod";
import type { LlmProvider } from "../oci/LlmProvider.js";
import { VoiceCommandParseResultSchema, type VoiceCommandParseResult } from "./VoiceCommandTypes.js";

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
1. remote_file_request
2. local_file_search
3. show_pending_approvals
4. open_chat
5. show_received_files
6. open_inbox
7. unknown

Rules:
- Do not invent people.
- Do not invent filenames.
- requester_reference must always be "current_user".
- If the command asks another person to send a file, use remote_file_request.
- Extract the target person as target_person_query.
- Extract the requested file as file_query.
- Extract file extension hints like pdf, docx, pptx, xlsx, png, jpg, mp4, zip, py, ts.
- If the command is ambiguous, set confidence below 0.7 and add missing_fields.
- Return JSON only.`;

export class LlmVoiceCommandParser {
  constructor(private readonly llm: LlmProvider) {}

  async parse(transcript: string): Promise<VoiceCommandParseResult> {
    if (!this.llm.isAvailable()) {
      return lowConfidence(transcript, "LLM parser is not configured.");
    }

    try {
      return toParseResult(await this.generate(transcript));
    } catch (firstError) {
      try {
        const repaired = await this.generate({
          transcript,
          previous_error: firstError instanceof Error ? firstError.message : String(firstError),
          instruction: "Repair the prior output. Return valid JSON only."
        });
        return toParseResult(repaired);
      } catch {
        return lowConfidence(transcript, "LOW_CONFIDENCE_PARSE");
      }
    }
  }

  private async generate(userInput: unknown): Promise<LlmVoiceCommand> {
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
