import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface NotificationEvent {
  id: string;
  eventType: string;
  title: string;
  body: string;
  severity: "info" | "success" | "warning" | "error";
  entityType: string | null;
  entityId: string | null;
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

  record(input: {
    eventType: string;
    title: string;
    body: string;
    severity?: NotificationEvent["severity"];
    entityType?: string | null;
    entityId?: string | null;
    delivered?: boolean;
    bridgeAvailable?: boolean;
    metadata?: Record<string, unknown>;
  }): NotificationEvent {
    const event: NotificationEvent = {
      id: `not_${randomUUID()}`,
      eventType: input.eventType,
      title: input.title,
      body: input.body,
      severity: input.severity ?? "info",
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      delivered: input.delivered ?? false,
      bridgeAvailable: input.bridgeAvailable ?? false,
      metadata: input.metadata ?? {},
      createdAt: new Date().toISOString()
    };
    this.db.prepare(`
      INSERT INTO notification_events
        (id, event_type, title, body, severity, entity_type, entity_id, delivered, bridge_available, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.eventType,
      event.title,
      event.body,
      event.severity,
      event.entityType,
      event.entityId,
      event.delivered ? 1 : 0,
      event.bridgeAvailable ? 1 : 0,
      JSON.stringify(event.metadata),
      event.createdAt
    );
    return event;
  }
}

function rowToEvent(row: Record<string, unknown>): NotificationEvent {
  return {
    id: String(row.id),
    eventType: String(row.event_type),
    title: String(row.title),
    body: String(row.body),
    severity: String(row.severity ?? "info") as NotificationEvent["severity"],
    entityType: row.entity_type == null ? null : String(row.entity_type),
    entityId: row.entity_id == null ? null : String(row.entity_id),
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
