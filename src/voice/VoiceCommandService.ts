import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { DatabaseSync } from "node:sqlite";
import { defaultProfileId, type LocalCloudIdentity } from "../cloud/LocalCloudIdentityStore.js";
import { appendAuditEvent } from "../security/AuditHashChain.js";
import { CommandUnderstandingService } from "./CommandUnderstandingService.js";
import {
  VoiceCommandParseResultSchema,
  VoiceCommandPreviewSchema,
  type VoiceCommandConfirmRequest,
  type VoiceCommandEventRecord,
  type VoiceCommandEventType,
  type VoiceCommandExecutionResult,
  type VoiceCommandParseResult,
  type VoiceCommandPreview,
  type VoiceCommandRecord,
  type VoiceCommandRequest,
  type VoiceCommandStatus
} from "./VoiceCommandTypes.js";

export interface VoiceDirectoryUser {
  userId: string;
  displayName: string | null;
  email: string | null;
  activeAgentInstanceId?: string | null;
}

export interface VoiceCommandServiceDeps {
  db: DatabaseSync;
  getCloudIdentity: () => LocalCloudIdentity | null;
  resolveUser: (query: string) => Promise<VoiceDirectoryUser | null>;
  appendVoiceCommandMessage?: (record: VoiceCommandRecord) => Promise<void> | void;
  executeRemoteFileRequest: (input: {
    commandId: string;
    targetUserId: string;
    targetLabel: string;
    fileQuery: string;
    fileExtensions: string[];
    idempotencyKey: string;
  }) => Promise<VoiceCommandExecutionResult>;
  commandUnderstanding?: CommandUnderstandingService;
}

export class VoiceCommandService {
  private readonly events = new EventEmitter();
  private readonly commandUnderstanding: CommandUnderstandingService;

  constructor(private deps: VoiceCommandServiceDeps) {
    this.commandUnderstanding = deps.commandUnderstanding ?? new CommandUnderstandingService();
  }

  async createCommand(request: VoiceCommandRequest): Promise<VoiceCommandRecord> {
    const now = new Date().toISOString();
    const cloud = this.deps.getCloudIdentity();
    const id = `vc_${randomUUID()}`;
    const inputMode = request.input_mode ?? (request.stt || request.sttConfidence !== undefined ? "speech" : "typed");
    const sttProvider = request.stt?.provider ?? (request.sttConfidence !== undefined ? "browser" : null);
    const sttConfidence = request.stt?.confidence ?? request.sttConfidence ?? null;

    this.recordEvent(id, "VOICE_CAPTURED", { source: request.source, inputMode });
    this.recordEvent(id, "TRANSCRIPT_CREATED", { locale: request.locale ?? null, sttProvider, sttConfidence });

    const parsed = VoiceCommandParseResultSchema.parse(await this.commandUnderstanding.parse(request.transcript));
    this.recordEvent(id, "COMMAND_PARSED", {
      intent: parsed.intent,
      confidence: parsed.confidence,
      parserProvider: parsed.parserProvider,
      missingFields: parsed.missingFields
    });

    const preview = await this.buildPreview(id, parsed);
    const status: VoiceCommandStatus = preview.error ? "failed" : "preview_required";
    if (preview.targetUser) {
      this.recordEvent(id, "TARGET_RESOLVED", {
        targetUserId: preview.targetUser.userId,
        activeAgentInstanceId: preview.targetUser.activeAgentInstanceId ?? null
      });
    }
    this.recordEvent(id, preview.error ? "COMMAND_FAILED" : "COMMAND_PREVIEW_CREATED", {
      title: preview.title,
      error: preview.error ?? null
    });

    this.deps.db.prepare(`
      INSERT INTO voice_commands
        (id, profile_id, org_id, user_id, agent_id, agent_instance_id, transcript, source, locale, stt_confidence,
         input_mode, stt_provider, confidence, parser_provider, file_extensions_json, target_user_id, target_agent_instance_id,
         parsed_intent, parsed_json, preview_json, status, conversation_id, mission_id, relay_task_id, error_message,
         created_at, updated_at, confirmed_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      sttConfidence,
      inputMode,
      sttProvider,
      parsed.confidence,
      parsed.parserProvider,
      JSON.stringify(parsed.fileExtensions),
      preview.targetUser?.userId ?? null,
      preview.targetUser?.activeAgentInstanceId ?? null,
      parsed.intent,
      JSON.stringify(parsed),
      JSON.stringify(preview),
      status,
      null,
      null,
      null,
      preview.error ?? null,
      now,
      now,
      null,
      status === "failed" ? now : null
    );

    const record = this.getCommand(id)!;
    appendAuditEvent({
      actorAgentId: cloud?.agentInstanceId ?? cloud?.agentId ?? "local-agent",
      taskId: id,
      eventType: status === "failed" ? "VOICE_COMMAND_FAILED" : "VOICE_COMMAND_PREVIEW_CREATED",
      detailsJson: {
        intent: parsed.intent,
        confidence: parsed.confidence,
        parserProvider: parsed.parserProvider,
        targetUserId: preview.targetUser?.userId ?? null
      }
    });
    if (!preview.error) await this.deps.appendVoiceCommandMessage?.(record);
    return record;
  }

  getCommand(id: string): VoiceCommandRecord | null {
    const row = this.deps.db.prepare("SELECT * FROM voice_commands WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : null;
  }

  listCommands(options: { limit?: number; offset?: number } = {}): VoiceCommandRecord[] {
    const limit = clampInt(options.limit ?? 50, 1, 100);
    const offset = clampInt(options.offset ?? 0, 0, 10_000);
    const rows = this.deps.db.prepare(`
      SELECT * FROM voice_commands
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as Array<Record<string, unknown>>;
    return rows.map(rowToRecord);
  }

  listEvents(commandId: string): VoiceCommandEventRecord[] {
    const rows = this.deps.db.prepare(`
      SELECT * FROM voice_command_events WHERE command_id = ? ORDER BY created_at ASC, id ASC
    `).all(commandId) as Array<Record<string, unknown>>;
    return rows.map(rowToEvent);
  }

  subscribe(commandId: string, listener: (event: VoiceCommandEventRecord) => void): () => void {
    const key = eventKey(commandId);
    this.events.on(key, listener);
    return () => this.events.off(key, listener);
  }

  async confirmCommand(id: string, options: VoiceCommandConfirmRequest = {}): Promise<VoiceCommandRecord> {
    const record = this.getCommand(id);
    if (!record) throw new VoiceCommandError("VOICE_COMMAND_NOT_FOUND", "Voice command not found");
    if (record.status === "cancelled") throw new VoiceCommandError("VOICE_COMMAND_CANCELLED", "Cancelled commands cannot be confirmed");
    if (record.status === "completed" || record.status === "submitted" || record.status === "running") return record;
    if (record.preview.error) throw new VoiceCommandError("VOICE_COMMAND_NOT_CONFIRMABLE", record.preview.error);

    const idempotencyKey = options.idempotency_key ?? `voice-${id}`;
    this.updateStatus(id, "confirmed", { confirmedAt: new Date().toISOString() });
    this.recordEvent(id, "USER_CONFIRMED", { idempotencyKey });

    if (record.parsed.intent === "remote_file_request") {
      const targetUserId = record.preview.targetUser?.userId;
      const fileQuery = record.parsed.fileQuery;
      if (!targetUserId || !fileQuery) {
        this.updateStatus(id, "failed", { errorMessage: "Remote file request is missing a target user or file query." });
        this.recordEvent(id, "COMMAND_FAILED", { reason: "LOW_CONFIDENCE_PARSE" });
        return this.getCommand(id)!;
      }

      this.updateStatus(id, "submitted");
      this.recordEvent(id, "A2A_FILE_REQUEST_CREATED", { targetUserId, fileQuery });
      try {
        const result = await this.deps.executeRemoteFileRequest({
          commandId: id,
          targetUserId,
          targetLabel: record.preview.targetUser?.displayName ?? record.preview.targetUser?.email ?? "remote user",
          fileQuery,
          fileExtensions: record.parsed.fileExtensions,
          idempotencyKey
        });
        this.updateStatus(id, result.status, {
          conversationId: result.conversationId ?? null,
          missionId: result.missionId ?? null,
          relayTaskId: result.relayTaskId ?? null,
          errorMessage: result.errorMessage ? redactUnsafeText(result.errorMessage) : null,
          completedAt: result.status === "failed" ? null : new Date().toISOString()
        });
        this.recordEvent(id, result.status === "failed" ? "COMMAND_FAILED" : "RELAY_SUBMITTED", {
          conversationId: result.conversationId ?? null,
          missionId: result.missionId ?? null,
          relayTaskId: result.relayTaskId ?? null,
          errorMessage: result.errorMessage ? redactUnsafeText(result.errorMessage) : null
        });
      } catch (err) {
        this.updateStatus(id, "failed", {
          errorMessage: redactUnsafeText(errorMessage(err)),
          completedAt: null
        });
        this.recordEvent(id, "COMMAND_FAILED", { errorMessage: redactUnsafeText(errorMessage(err)) });
      }
      return this.getCommand(id)!;
    }

    this.updateStatus(id, "completed", {
      conversationId: record.parsed.intent === "find_file" ? "local-agent" : null,
      completedAt: new Date().toISOString()
    });
    this.recordEvent(id, "COMMAND_COMPLETED", { intent: record.parsed.intent });
    return this.getCommand(id)!;
  }

  cancelCommand(id: string): VoiceCommandRecord {
    const record = this.getCommand(id);
    if (!record) throw new VoiceCommandError("VOICE_COMMAND_NOT_FOUND", "Voice command not found");
    this.updateStatus(id, "cancelled", { completedAt: new Date().toISOString() });
    this.recordEvent(id, "COMMAND_CANCELLED", {});
    return this.getCommand(id)!;
  }

  private async buildPreview(commandId: string, parsed: VoiceCommandParseResult): Promise<VoiceCommandPreview> {
    if (parsed.intent === "remote_file_request") {
      if (!parsed.targetPersonQuery || !parsed.fileQuery) {
        return previewError(commandId, "remote_file_request", "Remote file request needs a person and a file.");
      }
      const target = await this.deps.resolveUser(parsed.targetPersonQuery);
      if (!target) {
        return previewError(commandId, "remote_file_request", `I could not find "${parsed.targetPersonQuery}" in your directory.`);
      }
      const targetLabel = target.displayName ?? target.email ?? parsed.targetPersonQuery;
      return VoiceCommandPreviewSchema.parse({
        commandId,
        intent: "remote_file_request",
        title: `Request file from ${targetLabel}`,
        summary: `Ask ${targetLabel}'s agent to find and send ${withExtensionSummary(parsed.fileQuery, parsed.fileExtensions)}.`,
        targetUser: target,
        fileQuery: parsed.fileQuery,
        fileExtensions: parsed.fileExtensions,
        dataMovementNote: "This will submit a relay file request. The remote user must approve before any file is sent.",
        safety: [
          "No local file leaves your device.",
          "The remote user must approve before any file is sent.",
          "The request will be sent through the Oracle Amigo relay."
        ],
        actions: ["confirm", "edit", "cancel"],
        actionLabel: "Send file request",
        requiresConfirmation: true
      });
    }

    const titleByIntent = {
      find_file: `Find ${parsed.fileQuery ?? "file"} on this device`,
      local_file_search: `Find ${parsed.fileQuery ?? "file"} on this device`,
      show_approvals: "Show pending approvals",
      show_pending_approvals: "Show pending approvals",
      open_inbox: "Open Oracle Amigo inbox",
      open_chat: `Open chat with ${parsed.targetPersonQuery ?? "person"}`,
      show_files_received: `Show files received from ${parsed.targetPersonQuery ?? "person"}`,
      show_received_files: `Show files received from ${parsed.targetPersonQuery ?? "person"}`,
      unknown: "Unsupported command"
    } as const;
    return VoiceCommandPreviewSchema.parse({
      commandId,
      intent: parsed.intent,
      title: titleByIntent[parsed.intent],
      fileQuery: parsed.fileQuery,
      fileExtensions: parsed.fileExtensions,
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
      missionId?: string | null;
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
          mission_id = ?,
          relay_task_id = ?,
          error_message = ?,
          updated_at = ?,
          confirmed_at = ?,
          completed_at = ?
      WHERE id = ?
    `).run(
      status,
      patch.conversationId !== undefined ? patch.conversationId : current.conversationId,
      patch.missionId !== undefined ? patch.missionId : current.missionId,
      patch.relayTaskId !== undefined ? patch.relayTaskId : current.relayTaskId,
      patch.errorMessage !== undefined ? patch.errorMessage : current.errorMessage,
      new Date().toISOString(),
      patch.confirmedAt !== undefined ? patch.confirmedAt : current.confirmedAt,
      patch.completedAt !== undefined ? patch.completedAt : current.completedAt,
      id
    );
  }

  private recordEvent(commandId: string, eventType: VoiceCommandEventType, payload: Record<string, unknown>): VoiceCommandEventRecord {
    const now = new Date().toISOString();
    const result = this.deps.db.prepare(`
      INSERT INTO voice_command_events (command_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(commandId, eventType, JSON.stringify(payload), now);
    const event = {
      id: Number(result.lastInsertRowid),
      commandId,
      eventType,
      payload,
      createdAt: now
    };
    this.events.emit(eventKey(commandId), event);
    return event;
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
  const parsedRecord = VoiceCommandParseResultSchema.parse(parseJson(row.parsed_json));
  const previewRecord = VoiceCommandPreviewSchema.parse(parseJson(row.preview_json));
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
    inputMode: normalizeInputMode(row.input_mode),
    sttProvider: nullable(row.stt_provider),
    sttConfidence: row.stt_confidence == null ? null : Number(row.stt_confidence),
    confidence: row.confidence == null ? parsedRecord.confidence : Number(row.confidence),
    parserProvider: normalizeParserProvider(row.parser_provider ?? parsedRecord.parserProvider),
    fileExtensions: parseStringArray(row.file_extensions_json, parsedRecord.fileExtensions),
    targetUserId: nullable(row.target_user_id),
    targetAgentInstanceId: nullable(row.target_agent_instance_id),
    parsedIntent: String(row.parsed_intent) as VoiceCommandRecord["parsedIntent"],
    parsed: parsedRecord,
    preview: previewRecord,
    status: String(row.status) as VoiceCommandStatus,
    conversationId: nullable(row.conversation_id),
    missionId: nullable(row.mission_id),
    relayTaskId: nullable(row.relay_task_id),
    errorMessage: nullable(row.error_message),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    confirmedAt: nullable(row.confirmed_at),
    completedAt: nullable(row.completed_at)
  };
}

function rowToEvent(row: Record<string, unknown>): VoiceCommandEventRecord {
  return {
    id: Number(row.id),
    commandId: String(row.command_id),
    eventType: String(row.event_type) as VoiceCommandEventType,
    payload: parseJson(row.payload_json),
    createdAt: String(row.created_at)
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

function eventKey(commandId: string): string {
  return `voice-command:${commandId}`;
}

function parseStringArray(value: unknown, fallback: string[]): string[] {
  if (typeof value !== "string" || !value) return fallback;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : fallback;
  } catch {
    return fallback;
  }
}

function normalizeInputMode(value: unknown): VoiceCommandRecord["inputMode"] {
  return value === "speech" || value === "typed" ? value : null;
}

function normalizeParserProvider(value: unknown): VoiceCommandRecord["parserProvider"] {
  return value === "rule" || value === "llm" || value === "fallback" ? value : null;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function withExtensionSummary(fileQuery: string, extensions: string[]): string {
  const suffix = extensions.length ? ` ${extensions.map((ext) => ext.toUpperCase()).join("/")} file` : " file";
  return `"${fileQuery}"${suffix}`;
}
