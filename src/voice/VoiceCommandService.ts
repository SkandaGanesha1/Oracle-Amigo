import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { defaultProfileId, type LocalCloudIdentity } from "../cloud/LocalCloudIdentityStore.js";
import { parseVoiceCommand } from "./VoiceCommandParser.js";
import {
  VoiceCommandParseResultSchema,
  VoiceCommandPreviewSchema,
  type VoiceCommandExecutionResult,
  type VoiceCommandPreview,
  type VoiceCommandRecord,
  type VoiceCommandRequest,
  type VoiceCommandStatus
} from "./VoiceCommandTypes.js";

export interface VoiceDirectoryUser {
  userId: string;
  displayName: string | null;
  email: string | null;
}

export interface VoiceCommandServiceDeps {
  db: DatabaseSync;
  getCloudIdentity: () => LocalCloudIdentity | null;
  resolveUser: (query: string) => Promise<VoiceDirectoryUser | null>;
  executeRemoteFileRequest: (input: {
    commandId: string;
    targetUserId: string;
    targetLabel: string;
    fileQuery: string;
    idempotencyKey: string;
  }) => Promise<VoiceCommandExecutionResult>;
}

export class VoiceCommandService {
  constructor(private deps: VoiceCommandServiceDeps) {}

  async createCommand(request: VoiceCommandRequest): Promise<VoiceCommandRecord> {
    const now = new Date().toISOString();
    const cloud = this.deps.getCloudIdentity();
    const id = `vc_${randomUUID()}`;
    const parsed = VoiceCommandParseResultSchema.parse(parseVoiceCommand(request.transcript));
    const preview = await this.buildPreview(id, parsed);
    const status: VoiceCommandStatus = preview.error ? "failed" : "preview_required";

    this.deps.db.prepare(`
      INSERT INTO voice_commands
        (id, profile_id, org_id, user_id, agent_id, agent_instance_id, transcript, source, locale, stt_confidence,
         parsed_intent, parsed_json, preview_json, status, conversation_id, relay_task_id, error_message,
         created_at, updated_at, confirmed_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      defaultProfileId(),
      cloud?.orgId ?? null,
      cloud?.userId ?? null,
      cloud?.agentId ?? null,
      cloud?.agentInstanceId ?? null,
      redactUnsafeText(request.transcript),
      request.source,
      request.locale ?? null,
      request.sttConfidence ?? null,
      parsed.intent,
      JSON.stringify(parsed),
      JSON.stringify(preview),
      status,
      null,
      null,
      preview.error ?? null,
      now,
      now,
      null,
      status === "failed" ? now : null
    );

    return this.getCommand(id)!;
  }

  getCommand(id: string): VoiceCommandRecord | null {
    const row = this.deps.db.prepare("SELECT * FROM voice_commands WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : null;
  }

  async confirmCommand(id: string): Promise<VoiceCommandRecord> {
    const record = this.getCommand(id);
    if (!record) throw new VoiceCommandError("VOICE_COMMAND_NOT_FOUND", "Voice command not found");
    if (record.status === "cancelled") throw new VoiceCommandError("VOICE_COMMAND_CANCELLED", "Cancelled commands cannot be confirmed");
    if (record.status === "completed") return record;
    if (record.preview.error) throw new VoiceCommandError("VOICE_COMMAND_NOT_CONFIRMABLE", record.preview.error);

    this.updateStatus(id, "confirmed", { confirmedAt: new Date().toISOString() });

    if (record.parsed.intent === "remote_file_request") {
      const targetUserId = record.preview.targetUser?.userId;
      const fileQuery = record.parsed.fileQuery;
      if (!targetUserId || !fileQuery) {
        this.updateStatus(id, "failed", { errorMessage: "Remote file request is missing a target user or file query." });
        return this.getCommand(id)!;
      }
      this.updateStatus(id, "submitted");
      try {
        const result = await this.deps.executeRemoteFileRequest({
          commandId: id,
          targetUserId,
          targetLabel: record.preview.targetUser?.displayName ?? record.preview.targetUser?.email ?? "remote user",
          fileQuery,
          idempotencyKey: `voice-${id}`
        });
        this.updateStatus(id, result.status, {
          conversationId: result.conversationId ?? null,
          relayTaskId: result.relayTaskId ?? null,
          errorMessage: result.errorMessage ? redactUnsafeText(result.errorMessage) : null,
          completedAt: result.status === "failed" ? null : new Date().toISOString()
        });
      } catch (err) {
        this.updateStatus(id, "failed", {
          errorMessage: redactUnsafeText(errorMessage(err)),
          completedAt: null
        });
      }
      return this.getCommand(id)!;
    }

    this.updateStatus(id, "completed", {
      conversationId: record.parsed.intent === "find_file" ? "local-agent" : null,
      completedAt: new Date().toISOString()
    });
    return this.getCommand(id)!;
  }

  cancelCommand(id: string): VoiceCommandRecord {
    const record = this.getCommand(id);
    if (!record) throw new VoiceCommandError("VOICE_COMMAND_NOT_FOUND", "Voice command not found");
    this.updateStatus(id, "cancelled", { completedAt: new Date().toISOString() });
    return this.getCommand(id)!;
  }

  private async buildPreview(commandId: string, parsed: ReturnType<typeof parseVoiceCommand>): Promise<VoiceCommandPreview> {
    if (parsed.intent === "remote_file_request") {
      if (!parsed.targetPersonQuery || !parsed.fileQuery) {
        return previewError(commandId, "remote_file_request", "Remote file request needs a person and a file.");
      }
      const target = await this.deps.resolveUser(parsed.targetPersonQuery);
      if (!target) {
        return previewError(commandId, "remote_file_request", `I could not find "${parsed.targetPersonQuery}" in your directory.`);
      }
      return VoiceCommandPreviewSchema.parse({
        commandId,
        intent: "remote_file_request",
        title: `Ask ${target.displayName ?? target.email ?? parsed.targetPersonQuery} to send ${parsed.fileQuery}`,
        targetUser: target,
        fileQuery: parsed.fileQuery,
        dataMovementNote: "This will submit a relay file request. The remote user must approve before any file is sent.",
        actionLabel: "Send file request",
        requiresConfirmation: true
      });
    }

    const titleByIntent = {
      find_file: `Find ${parsed.fileQuery ?? "file"} on this device`,
      show_approvals: "Show pending approvals",
      open_inbox: "Open Oracle Amigo inbox",
      open_chat: `Open chat with ${parsed.targetPersonQuery ?? "person"}`,
      show_files_received: `Show files received from ${parsed.targetPersonQuery ?? "person"}`,
      unknown: "Unsupported command"
    } as const;
    return VoiceCommandPreviewSchema.parse({
      commandId,
      intent: parsed.intent,
      title: titleByIntent[parsed.intent],
      fileQuery: parsed.fileQuery,
      actionLabel: parsed.intent === "unknown" ? "Cannot execute" : "Open in Oracle Amigo",
      requiresConfirmation: parsed.requiresConfirmation,
      error: parsed.error
    });
  }

  private updateStatus(
    id: string,
    status: VoiceCommandStatus,
    patch: {
      conversationId?: string | null;
      relayTaskId?: string | null;
      errorMessage?: string | null;
      confirmedAt?: string | null;
      completedAt?: string | null;
    } = {}
  ): void {
    const current = this.getCommand(id);
    if (!current) return;
    this.deps.db.prepare(`
      UPDATE voice_commands
      SET status = ?,
          conversation_id = ?,
          relay_task_id = ?,
          error_message = ?,
          updated_at = ?,
          confirmed_at = ?,
          completed_at = ?
      WHERE id = ?
    `).run(
      status,
      patch.conversationId !== undefined ? patch.conversationId : current.conversationId,
      patch.relayTaskId !== undefined ? patch.relayTaskId : current.relayTaskId,
      patch.errorMessage !== undefined ? patch.errorMessage : current.errorMessage,
      new Date().toISOString(),
      patch.confirmedAt !== undefined ? patch.confirmedAt : current.confirmedAt,
      patch.completedAt !== undefined ? patch.completedAt : current.completedAt,
      id
    );
  }
}

export class VoiceCommandError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export function redactUnsafeText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]+/g, "Local path hidden")
    .replace(/(?:sk|ghp|npm)_[A-Za-z0-9_=-]{12,}/gi, "[secret redacted]");
}

function previewError(commandId: string, intent: VoiceCommandPreview["intent"], error: string): VoiceCommandPreview {
  return VoiceCommandPreviewSchema.parse({
    commandId,
    intent,
    title: "Command needs clarification",
    actionLabel: "Review command",
    requiresConfirmation: true,
    error
  });
}

function rowToRecord(row: Record<string, unknown>): VoiceCommandRecord {
  const parsed = parseJson(row.parsed_json);
  const preview = parseJson(row.preview_json);
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    orgId: nullable(row.org_id),
    userId: nullable(row.user_id),
    agentId: nullable(row.agent_id),
    agentInstanceId: nullable(row.agent_instance_id),
    transcript: String(row.transcript),
    source: String(row.source),
    locale: nullable(row.locale),
    sttConfidence: row.stt_confidence == null ? null : Number(row.stt_confidence),
    parsedIntent: String(row.parsed_intent) as VoiceCommandRecord["parsedIntent"],
    parsed: VoiceCommandParseResultSchema.parse(parsed),
    preview: VoiceCommandPreviewSchema.parse(preview),
    status: String(row.status) as VoiceCommandStatus,
    conversationId: nullable(row.conversation_id),
    relayTaskId: nullable(row.relay_task_id),
    errorMessage: nullable(row.error_message),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    confirmedAt: nullable(row.confirmed_at),
    completedAt: nullable(row.completed_at)
  };
}

function parseJson(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function nullable(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
