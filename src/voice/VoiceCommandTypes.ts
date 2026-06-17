import { z } from "zod";

export const VoiceCommandIntentSchema = z.enum([
  "remote_file_request",
  "find_file",
  "local_file_search",
  "show_approvals",
  "show_pending_approvals",
  "open_inbox",
  "open_chat",
  "show_files_received",
  "show_received_files",
  "unknown"
]);

export const VoiceCommandStatusSchema = z.enum([
  "captured",
  "transcribed",
  "parsed",
  "preview_required",
  "confirmed",
  "submitted",
  "waiting_remote_agent",
  "waiting_receiver_approval",
  "transferring",
  "running",
  "completed",
  "failed",
  "cancelled"
]);

export const VoiceCommandRequestSchema = z.object({
  transcript: z.string().trim().min(1).max(2000),
  source: z.enum(["voice-launcher", "quickvoice"]).default("voice-launcher"),
  mode: z.enum(["preview_then_execute", "auto_execute"]).default("preview_then_execute"),
  locale: z.string().trim().max(40).optional(),
  input_mode: z.enum(["speech", "typed"]).optional(),
  stt: z.object({
    provider: z.string().trim().min(1).max(80).optional(),
    confidence: z.number().min(0).max(1).optional()
  }).optional(),
  sttConfidence: z.number().min(0).max(1).optional()
});

export const VoiceTranscribeRequestSchema = z.object({
  audioBase64: z.string().trim().min(1).max(8_000_000),
  locale: z.string().trim().max(40).optional(),
  mimeType: z.string().trim().min(1).max(120),
  source: z.enum(["voice-launcher", "quickvoice"]).default("voice-launcher")
});

export const VoiceCommandParseResultSchema = z.object({
  schemaVersion: z.literal("voice-command.v1").default("voice-command.v1"),
  intent: VoiceCommandIntentSchema,
  targetPersonQuery: z.string().trim().min(1).optional(),
  fileQuery: z.string().trim().min(1).optional(),
  fileExtensions: z.array(z.string().trim().min(1)).default([]),
  requesterReference: z.literal("current_user").default("current_user"),
  confidence: z.number().min(0).max(1),
  requiresConfirmation: z.boolean(),
  missingFields: z.array(z.string()).default([]),
  originalTranscript: z.string(),
  error: z.string().optional(),
  parserProvider: z.enum(["rule", "llm", "fallback"]).default("rule")
});

export const VoiceCommandPreviewSchema = z.object({
  commandId: z.string(),
  intent: VoiceCommandIntentSchema,
  title: z.string(),
  summary: z.string().optional(),
  targetUser: z.object({
    userId: z.string(),
    displayName: z.string().nullable(),
    email: z.string().nullable(),
    activeAgentInstanceId: z.string().nullable().optional()
  }).optional(),
  fileQuery: z.string().optional(),
  fileExtensions: z.array(z.string()).default([]),
  dataMovementNote: z.string().optional(),
  safety: z.array(z.string()).default([]),
  actions: z.array(z.enum(["confirm", "edit", "cancel"])).default(["confirm", "edit", "cancel"]),
  actionLabel: z.string(),
  requiresConfirmation: z.boolean(),
  error: z.string().optional()
});

export const VoiceCommandEventTypeSchema = z.enum([
  "VOICE_CAPTURED",
  "TRANSCRIPT_CREATED",
  "COMMAND_PARSED",
  "TARGET_RESOLVED",
  "COMMAND_PREVIEW_CREATED",
  "USER_CONFIRMED",
  "A2A_FILE_REQUEST_CREATED",
  "RELAY_SUBMITTED",
  "COMMAND_CANCELLED",
  "COMMAND_FAILED",
  "COMMAND_COMPLETED"
]);

export const VoiceCommandConfirmRequestSchema = z.object({
  idempotency_key: z.string().trim().min(1).max(200).optional()
});

export type VoiceCommandIntent = z.infer<typeof VoiceCommandIntentSchema>;
export type VoiceCommandStatus = z.infer<typeof VoiceCommandStatusSchema>;
export type VoiceCommandRequest = z.infer<typeof VoiceCommandRequestSchema>;
export type VoiceTranscribeRequest = z.infer<typeof VoiceTranscribeRequestSchema>;
export type VoiceCommandParseResult = z.infer<typeof VoiceCommandParseResultSchema>;
export type VoiceCommandPreview = z.infer<typeof VoiceCommandPreviewSchema>;
export type VoiceCommandEventType = z.infer<typeof VoiceCommandEventTypeSchema>;
export type VoiceCommandConfirmRequest = z.infer<typeof VoiceCommandConfirmRequestSchema>;

export interface VoiceCommandEventRecord {
  id: number;
  commandId: string;
  eventType: VoiceCommandEventType;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface VoiceCommandRecord {
  id: string;
  profileId: string;
  orgId: string | null;
  userId: string | null;
  agentId: string | null;
  agentInstanceId: string | null;
  transcript: string;
  source: string;
  locale: string | null;
  inputMode: "speech" | "typed" | null;
  sttProvider: string | null;
  sttConfidence: number | null;
  confidence: number | null;
  parserProvider: "rule" | "llm" | "fallback" | null;
  fileExtensions: string[];
  targetUserId: string | null;
  targetAgentInstanceId: string | null;
  parsedIntent: VoiceCommandIntent;
  parsed: VoiceCommandParseResult;
  preview: VoiceCommandPreview;
  status: VoiceCommandStatus;
  conversationId: string | null;
  missionId: string | null;
  relayTaskId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  completedAt: string | null;
}

export interface VoiceCommandExecutionResult {
  status: VoiceCommandStatus;
  conversationId?: string;
  missionId?: string;
  relayTaskId?: string;
  errorMessage?: string;
}
