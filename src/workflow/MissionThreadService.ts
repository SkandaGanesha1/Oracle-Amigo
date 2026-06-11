import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { DatabaseSync } from "node:sqlite";

export interface MissionThreadMessage {
  id: string;
  missionId: string;
  authorType: "user" | "agent" | "system";
  authorLabel: string;
  body: string;
  mentions: string[];
  createdAt: string;
}

export class MissionThreadService {
  private readonly events = new EventEmitter();

  constructor(private readonly db: DatabaseSync) {}

  list(missionId: string): MissionThreadMessage[] {
    const rows = this.db.prepare(`
      SELECT * FROM mission_threads WHERE mission_id = ? ORDER BY created_at ASC
    `).all(missionId) as Array<Record<string, unknown>>;
    return rows.map(rowToMessage);
  }

  create(input: {
    missionId: string;
    authorType: "user" | "agent" | "system";
    authorLabel: string;
    body: string;
    mentions?: string[];
  }): MissionThreadMessage {
    const now = new Date().toISOString();
    const message: MissionThreadMessage = {
      id: `mth_${randomUUID()}`,
      missionId: input.missionId,
      authorType: input.authorType,
      authorLabel: input.authorLabel,
      body: input.body,
      mentions: input.mentions ?? [],
      createdAt: now
    };
    this.db.prepare(`
      INSERT INTO mission_threads (id, mission_id, author_type, author_label, body, mentions_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      message.id,
      message.missionId,
      message.authorType,
      message.authorLabel,
      message.body,
      JSON.stringify(message.mentions),
      message.createdAt
    );
    this.events.emit(input.missionId, message);
    return message;
  }

  subscribe(missionId: string, listener: (message: MissionThreadMessage) => void): () => void {
    this.events.on(missionId, listener);
    return () => this.events.off(missionId, listener);
  }
}

function rowToMessage(row: Record<string, unknown>): MissionThreadMessage {
  return {
    id: String(row.id),
    missionId: String(row.mission_id),
    authorType: String(row.author_type) as MissionThreadMessage["authorType"],
    authorLabel: String(row.author_label),
    body: String(row.body),
    mentions: parseMentions(row.mentions_json),
    createdAt: String(row.created_at)
  };
}

function parseMentions(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
