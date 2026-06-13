import { z } from "zod";

export const VoiceCommandIntentSchema = z.enum([
  "remote_file_request",
  "find_file",
  "show_approvals",
  "open_inbox",
  "open_chat",
  "show_files_received",
  "unknown"
]);

export const VoiceCommandStatusSchema = z.enum([
  "captured",
  "transcribed",
  "parsed",
  "preview_required",
  "confirmed",
  "submitted",
  "running",
  "completed",
  "failed",
  "cancelled"
]);

export const VoiceCommandRequestSchema = z.object({
  transcript: z.string().trim().min(1).max(2000),
  source: z.literal("voice-launcher").default("voice-launcher"),
  mode: z.enum(["preview_then_execute", "auto_execute"]).default("preview_then_execute"),
  locale: z.string().trim().max(40).optional(),
  sttConfidence: z.number().min(0).max(1).optional()
});

export const VoiceCommandParseResultSchema = z.object({
  intent: VoiceCommandIntentSchema,
  targetPersonQuery: z.string().trim().min(1).optional(),
  fileQuery: z.string().trim().min(1).optional(),
  confidence: z.number().min(0).max(1),
  requiresConfirmation: z.boolean(),
  originalTranscript: z.string(),
  error: z.string().optional()
});

export const VoiceCommandPreviewSchema = z.object({
  commandId: z.string(),
  intent: VoiceCommandIntentSchema,
  title: z.string(),
  targetUser: z.object({
    userId: z.string(),
    displayName: z.string().nullable(),
    email: z.string().nullable()
  }).optional(),
  fileQuery: z.string().optional(),
  dataMovementNote: z.string().optional(),
  actionLabel: z.string(),
  requiresConfirmation: z.boolean(),
  error: z.string().optional()
});

export type VoiceCommandIntent = z.infer<typeof VoiceCommandIntentSchema>;
export type VoiceCommandStatus = z.infer<typeof VoiceCommandStatusSchema>;
export type VoiceCommandRequest = z.infer<typeof VoiceCommandRequestSchema>;
export type VoiceCommandParseResult = z.infer<typeof VoiceCommandParseResultSchema>;
export type VoiceCommandPreview = z.infer<typeof VoiceCommandPreviewSchema>;

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
  sttConfidence: number | null;
  parsedIntent: VoiceCommandIntent;
  parsed: VoiceCommandParseResult;
  preview: VoiceCommandPreview;
  status: VoiceCommandStatus;
  conversationId: string | null;
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
  relayTaskId?: string;
  errorMessage?: string;
}
