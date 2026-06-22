import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface NotificationEvent {
  id: string;
  sourceEventId: string | null;
  eventType: string;
  title: string;
  body: string;
  severity: "info" | "success" | "warning" | "error";
  entityType: string | null;
  entityId: string | null;
  status: "pending" | "shown" | "failed" | "read";
  conversationId: string | null;
  messageId: string | null;
  senderUserId: string | null;
  senderAgentInstanceId: string | null;
  bridgeError: string | null;
  shownAt: string | null;
  readAt: string | null;
  delivered: boolean;
  bridgeAvailable: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export class NotificationEventStore {
  constructor(private readonly db: DatabaseSync) {}

  list(limit = 50): NotificationEvent[] {
    const rows = this.db.prepare("SELECT * FROM notification_events ORDER BY created_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
    return rows.map(rowToEvent);
  }

  findBySourceEventId(sourceEventId: string): NotificationEvent | null {
    const row = this.db.prepare("SELECT * FROM notification_events WHERE source_event_id = ?").get(sourceEventId) as Record<string, unknown> | undefined;
    return row ? rowToEvent(row) : null;
  }

  record(input: {
    eventType: string;
    title: string;
    body: string;
    sourceEventId?: string | null;
    severity?: NotificationEvent["severity"];
    entityType?: string | null;
    entityId?: string | null;
    status?: NotificationEvent["status"];
    conversationId?: string | null;
    messageId?: string | null;
    senderUserId?: string | null;
    senderAgentInstanceId?: string | null;
    bridgeError?: string | null;
    shownAt?: string | null;
    readAt?: string | null;
    delivered?: boolean;
    bridgeAvailable?: boolean;
    metadata?: Record<string, unknown>;
  }): NotificationEvent {
    if (input.sourceEventId) {
      const existing = this.findBySourceEventId(input.sourceEventId);
      if (existing) return existing;
    }

    const event: NotificationEvent = {
      id: `not_${randomUUID()}`,
      sourceEventId: input.sourceEventId ?? null,
      eventType: input.eventType,
      title: input.title,
      body: input.body,
      severity: input.severity ?? "info",
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      status: input.status ?? (input.delivered ? "shown" : "pending"),
      conversationId: input.conversationId ?? null,
      messageId: input.messageId ?? null,
      senderUserId: input.senderUserId ?? null,
      senderAgentInstanceId: input.senderAgentInstanceId ?? null,
      bridgeError: input.bridgeError ?? null,
      shownAt: input.shownAt ?? null,
      readAt: input.readAt ?? null,
      delivered: input.delivered ?? false,
      bridgeAvailable: input.bridgeAvailable ?? false,
      metadata: input.metadata ?? {},
      createdAt: new Date().toISOString()
    };
    this.db.prepare(`
      INSERT INTO notification_events
        (id, source_event_id, event_type, title, body, severity, entity_type, entity_id, status,
         conversation_id, message_id, sender_user_id, sender_agent_instance_id, bridge_error,
         shown_at, read_at, delivered, bridge_available, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.sourceEventId,
      event.eventType,
      event.title,
      event.body,
      event.severity,
      event.entityType,
      event.entityId,
      event.status,
      event.conversationId,
      event.messageId,
      event.senderUserId,
      event.senderAgentInstanceId,
      event.bridgeError,
      event.shownAt,
      event.readAt,
      event.delivered ? 1 : 0,
      event.bridgeAvailable ? 1 : 0,
      JSON.stringify(event.metadata),
      event.createdAt
    );
    return event;
  }

  markBridgeResult(id: string, input: { bridgeAvailable: boolean; delivered: boolean; error?: string | null }): NotificationEvent | null {
    const now = new Date().toISOString();
    const status: NotificationEvent["status"] = input.delivered ? "shown" : "failed";
    this.db.prepare(`
      UPDATE notification_events
      SET status = ?,
          delivered = ?,
          bridge_available = ?,
          bridge_error = ?,
          shown_at = CASE WHEN ? = 1 THEN COALESCE(shown_at, ?) ELSE shown_at END
      WHERE id = ?
    `).run(status, input.delivered ? 1 : 0, input.bridgeAvailable ? 1 : 0, input.error ?? null, input.delivered ? 1 : 0, now, id);
    const row = this.db.prepare("SELECT * FROM notification_events WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToEvent(row) : null;
  }
}

function rowToEvent(row: Record<string, unknown>): NotificationEvent {
  return {
    id: String(row.id),
    sourceEventId: nullableString(row.source_event_id),
    eventType: String(row.event_type),
    title: String(row.title),
    body: String(row.body),
    severity: String(row.severity ?? "info") as NotificationEvent["severity"],
    entityType: row.entity_type == null ? null : String(row.entity_type),
    entityId: row.entity_id == null ? null : String(row.entity_id),
    status: String(row.status ?? (Number(row.delivered ?? 0) === 1 ? "shown" : "pending")) as NotificationEvent["status"],
    conversationId: nullableString(row.conversation_id),
    messageId: nullableString(row.message_id),
    senderUserId: nullableString(row.sender_user_id),
    senderAgentInstanceId: nullableString(row.sender_agent_instance_id),
    bridgeError: nullableString(row.bridge_error),
    shownAt: nullableString(row.shown_at),
    readAt: nullableString(row.read_at),
    delivered: Number(row.delivered ?? 0) === 1,
    bridgeAvailable: Number(row.bridge_available ?? 0) === 1,
    metadata: parseObject(row.metadata_json),
    createdAt: String(row.created_at)
  };
}

function parseObject(raw: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(raw ?? "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
