import { randomUUID } from "node:crypto";
import { getDb, resolveLocalTenantId, resolveLocalAgentId } from "../db/connection.js";

export interface MessageRecord {
  id: string;
  conversationId: string;
  tenantId: string;
  agentId: string;
  role: string;
  contentText: string | null;
  contentJson: unknown;
  createdAt: string;
}

export interface AppendOptions {
  tenantId?: string;
  agentId?: string;
  senderAgentId?: string;
  receiverAgentId?: string;
}

export function append(
  conversationId: string,
  role: string,
  contentText: string,
  contentJson?: unknown,
  options: AppendOptions = {},
): string {
  const now = new Date().toISOString();
  const id = randomUUID();
  const tenantId = options.tenantId ?? resolveLocalTenantId();
  const agentId = options.agentId ?? resolveLocalAgentId();
  getDb().prepare(`
    INSERT INTO messages (id, conversation_id, a2a_task_id, sender_agent_id, receiver_agent_id, role, content_text, content_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    conversationId,
    null,
    options.senderAgentId ?? agentId,
    options.receiverAgentId ?? "peer",
    role,
    contentText,
    contentJson ? JSON.stringify(contentJson) : null,
    now,
  );
  void tenantId;
  return id;
}

export interface GetWindowOptions {
  tenantId?: string;
  agentId?: string;
  maxMessages?: number;
  beforeTimestamp?: string;
  conversationIds?: string[];
}

export function getWindow(
  conversationId: string,
  maxChars: number,
  options: GetWindowOptions = {},
): Array<{ role: string; contentText: string; createdAt: string }> {
  const tenantId = options.tenantId ?? resolveLocalTenantId();
  const agentId = options.agentId ?? resolveLocalAgentId();
  const maxMessages = options.maxMessages ?? 100;

  let rows: Array<{ role: string; content_text: string | null; created_at: string }>;
  if (options.conversationIds && options.conversationIds.length > 0) {
    const placeholders = options.conversationIds.map(() => "?").join(",");
    rows = getDb().prepare(
      `SELECT role, content_text, created_at FROM messages
       WHERE conversation_id IN (${placeholders})
         ${options.beforeTimestamp ? "AND created_at < ?" : ""}
       ORDER BY created_at DESC, rowid DESC
       LIMIT ?`,
    ).all(...(options.beforeTimestamp ? [...options.conversationIds, options.beforeTimestamp, maxMessages] : [...options.conversationIds, maxMessages])) as typeof rows;
  } else {
    rows = getDb().prepare(
      `SELECT role, content_text, created_at FROM messages
       WHERE conversation_id = ?
         ${options.beforeTimestamp ? "AND created_at < ?" : ""}
       ORDER BY created_at DESC, rowid DESC
       LIMIT ?`,
    ).all(...(options.beforeTimestamp ? [conversationId, options.beforeTimestamp, maxMessages] : [conversationId, maxMessages])) as typeof rows;
  }

  const window: typeof rows = [];
  let total = 0;
  for (const row of rows) {
    const len = (row.content_text ?? "").length;
    if (total + len > maxChars) break;
    total += len;
    window.push(row);
  }
  return window.reverse().map((r) => ({
    role: r.role,
    contentText: r.content_text ?? "",
    createdAt: r.created_at,
  }));
}

export function listConversations(
  options: { tenantId?: string; agentId?: string; limit?: number; offset?: number } = {},
): Array<{ conversationId: string; messageCount: number; lastMessageAt: string; tenantId: string; agentId: string }> {
  const tenantId = options.tenantId ?? resolveLocalTenantId();
  const agentId = options.agentId ?? resolveLocalAgentId();
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  const rows = getDb().prepare(
    `SELECT conversation_id, COUNT(*) as count, MAX(created_at) as last_at
     FROM messages
     GROUP BY conversation_id
     ORDER BY last_at DESC
     LIMIT ? OFFSET ?`,
  ).all(limit, offset) as Array<{ conversation_id: string; count: number; last_at: string }>;
  return rows.map((r) => ({
    conversationId: r.conversation_id,
    messageCount: r.count,
    lastMessageAt: r.last_at,
    tenantId,
    agentId,
  }));
}

export function clearConversation(conversationId: string, options: { tenantId?: string; agentId?: string } = {}): number {
  void options.tenantId;
  void options.agentId;
  const result = getDb().prepare("DELETE FROM messages WHERE conversation_id = ?").run(conversationId);
  return Number(result.changes ?? 0);
}

export function summarizeWindow(
  conversationId: string,
  options: GetWindowOptions & { maxChars?: number } = {},
): string {
  const window = getWindow(conversationId, options.maxChars ?? 8000, options);
  return window.map((m) => `${m.role}: ${m.contentText}`).join("\n");
}
