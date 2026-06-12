import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "../db/connection.js";

export type ChatMode = "local" | "cloud_relay" | "loopback";
export type ChatMessageType = "human" | "agent_status" | "system_event" | "file_request" | "approval" | "transfer" | "receipt";
export type DeliveryStatus =
  | "local_pending"
  | "queued_at_relay"
  | "delivered_to_remote_agent"
  | "stored_by_remote_agent"
  | "read_by_remote_user"
  | "sent"
  | "delivered"
  | "failed";

export interface RelayDeliveryReceipt {
  relay_task_id: string;
  status: DeliveryStatus;
  delivered_at?: string;
  error?: string;
  from_agent_instance_id: string;
  to_agent_instance_id: string;
}

export interface ChatConversationRecord {
  id: string;
  org_id: string | null;
  local_user_id: string | null;
  local_agent_instance_id: string | null;
  peer_user_id: string | null;
  peer_agent_instance_id: string | null;
  mode: ChatMode;
  title: string;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  unread_count: number;
}

export interface ChatMessageRecord {
  id: string;
  conversation_id: string;
  task_id: string | null;
  sender_user_id: string | null;
  sender_agent_instance_id: string | null;
  receiver_agent_instance_id: string | null;
  message_type: ChatMessageType;
  text: string | null;
  payload_json: Record<string, unknown>;
  delivery_status: DeliveryStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateConversationInput {
  id?: string;
  orgId?: string | null;
  localUserId?: string | null;
  localAgentInstanceId?: string | null;
  peerUserId?: string | null;
  peerAgentInstanceId?: string | null;
  mode?: ChatMode;
  title: string;
}

export interface AppendMessageInput {
  id?: string;
  conversationId: string;
  taskId?: string | null;
  senderUserId?: string | null;
  senderAgentInstanceId?: string | null;
  receiverAgentInstanceId?: string | null;
  messageType: ChatMessageType;
  text?: string | null;
  payload?: Record<string, unknown>;
  deliveryStatus?: DeliveryStatus;
  createdAt?: string;
}

export class ChatRepository {
  constructor(private db: DatabaseSync = getDb()) {}

  createConversation(input: CreateConversationInput): ChatConversationRecord {
    const now = new Date().toISOString();
    const id = input.id ?? `conv_${randomUUID()}`;
    this.db.prepare(`
      INSERT INTO conversations
        (id, local_agent_id, peer_agent_id, mode, org_id, local_user_id, local_agent_instance_id,
         peer_user_id, peer_agent_instance_id, title, created_at, updated_at, last_message_at, unread_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        org_id=excluded.org_id,
        local_user_id=excluded.local_user_id,
        local_agent_instance_id=excluded.local_agent_instance_id,
        peer_user_id=excluded.peer_user_id,
        peer_agent_instance_id=excluded.peer_agent_instance_id,
        mode=excluded.mode,
        title=excluded.title,
        updated_at=excluded.updated_at
    `).run(
      id,
      input.localAgentInstanceId ?? "local-agent",
      input.peerAgentInstanceId ?? null,
      input.mode ?? "local",
      input.orgId ?? null,
      input.localUserId ?? null,
      input.localAgentInstanceId ?? null,
      input.peerUserId ?? null,
      input.peerAgentInstanceId ?? null,
      input.title,
      now,
      now,
      null,
      0
    );
    this.ensureParticipant(id, input.localUserId ?? null, input.localAgentInstanceId ?? null, "local");
    if (input.peerUserId || input.peerAgentInstanceId) {
      this.ensureParticipant(id, input.peerUserId ?? null, input.peerAgentInstanceId ?? null, "peer");
    }
    return this.getConversation(id)!;
  }

  getOrCreateLocalConversation(localAgentInstanceId: string | null): ChatConversationRecord {
    const existing = this.getConversation("local-agent");
    if (existing) return existing;
    return this.createConversation({
      id: "local-agent",
      localAgentInstanceId,
      mode: "local",
      title: "My local agent"
    });
  }

  getConversation(id: string): ChatConversationRecord | null {
    const row = this.db.prepare(`
      SELECT id, org_id, local_user_id, local_agent_instance_id, peer_user_id, peer_agent_instance_id,
             mode, title, created_at, updated_at, last_message_at, unread_count
      FROM conversations WHERE id = ?
    `).get(id) as Record<string, unknown> | undefined;
    return row ? rowToConversation(row) : null;
  }

  findCloudRelayConversationByPeerAgent(peerAgentInstanceId: string): ChatConversationRecord | null {
    const row = this.db.prepare(`
      SELECT id, org_id, local_user_id, local_agent_instance_id, peer_user_id, peer_agent_instance_id,
             mode, title, created_at, updated_at, last_message_at, unread_count
      FROM conversations
      WHERE mode = 'cloud_relay' AND peer_agent_instance_id = ?
      ORDER BY
        CASE WHEN peer_user_id IS NOT NULL THEN 0 ELSE 1 END,
        COALESCE(last_message_at, updated_at, created_at) DESC
      LIMIT 1
    `).get(peerAgentInstanceId) as Record<string, unknown> | undefined;
    return row ? rowToConversation(row) : null;
  }

  findCloudRelayConversationByPeerUser(peerUserId: string): ChatConversationRecord | null {
    const row = this.db.prepare(`
      SELECT id, org_id, local_user_id, local_agent_instance_id, peer_user_id, peer_agent_instance_id,
             mode, title, created_at, updated_at, last_message_at, unread_count
      FROM conversations
      WHERE mode = 'cloud_relay' AND peer_user_id = ?
      ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC
      LIMIT 1
    `).get(peerUserId) as Record<string, unknown> | undefined;
    return row ? rowToConversation(row) : null;
  }

  updateConversationPeer(conversationId: string, input: {
    peerUserId?: string | null;
    peerAgentInstanceId?: string | null;
    title?: string | null;
  }): ChatConversationRecord | null {
    const existing = this.getConversation(conversationId);
    if (!existing) return null;
    const now = new Date().toISOString();
    const peerUserId = input.peerUserId !== undefined ? input.peerUserId : existing.peer_user_id;
    const peerAgentInstanceId = input.peerAgentInstanceId !== undefined
      ? input.peerAgentInstanceId
      : existing.peer_agent_instance_id;
    const title = input.title !== undefined && input.title !== null && input.title.trim()
      ? input.title.trim()
      : existing.title;

    this.db.prepare(`
      UPDATE conversations
      SET peer_user_id = ?, peer_agent_instance_id = ?, peer_agent_id = ?, title = ?, updated_at = ?
      WHERE id = ?
    `).run(peerUserId, peerAgentInstanceId, peerAgentInstanceId, title, now, conversationId);
    if (peerUserId || peerAgentInstanceId) {
      this.ensureParticipant(conversationId, peerUserId ?? null, peerAgentInstanceId ?? null, "peer");
    }
    return this.getConversation(conversationId);
  }

  updateConversationPeerAgent(conversationId: string, peerAgentInstanceId: string): ChatConversationRecord | null {
    return this.updateConversationPeer(conversationId, { peerAgentInstanceId });
  }

  listConversations(): ChatConversationRecord[] {
    const rows = this.db.prepare(`
      SELECT id, org_id, local_user_id, local_agent_instance_id, peer_user_id, peer_agent_instance_id,
             mode, title, created_at, updated_at, last_message_at, unread_count
      FROM conversations
      ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC
    `).all() as Array<Record<string, unknown>>;
    return rows.map(rowToConversation);
  }

  appendMessage(input: AppendMessageInput): ChatMessageRecord {
    const now = input.createdAt ?? new Date().toISOString();
    const id = input.id ?? `msg_${randomUUID()}`;
    this.db.prepare(`
      INSERT INTO chat_messages
        (id, conversation_id, task_id, sender_user_id, sender_agent_instance_id, receiver_agent_instance_id,
         message_type, text, payload_json, delivery_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        text=excluded.text,
        delivery_status=excluded.delivery_status,
        payload_json=excluded.payload_json,
        updated_at=excluded.updated_at
    `).run(
      id,
      input.conversationId,
      input.taskId ?? null,
      input.senderUserId ?? null,
      input.senderAgentInstanceId ?? null,
      input.receiverAgentInstanceId ?? null,
      input.messageType,
      input.text ?? null,
      JSON.stringify(input.payload ?? {}),
      input.deliveryStatus ?? "local_pending",
      now,
      now
    );
    this.db.prepare("UPDATE conversations SET updated_at = ?, last_message_at = ? WHERE id = ?").run(now, now, input.conversationId);
    return this.getMessage(id)!;
  }

  getMessages(conversationId: string): ChatMessageRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC
    `).all(conversationId) as Array<Record<string, unknown>>;
    return rows.map(rowToMessage);
  }

  getMessage(id: string): ChatMessageRecord | null {
    const row = this.db.prepare("SELECT * FROM chat_messages WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToMessage(row) : null;
  }

  markMessageStatus(id: string, status: DeliveryStatus, error?: string): void {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE chat_messages SET delivery_status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
    const row = this.getMessage(id);
    if (row) this.recordDeliveryAttempt(id, status, error);
  }

  updateMessageDeliveryStatus(
    id: string,
    status: DeliveryStatus,
    receipt?: RelayDeliveryReceipt | null,
    payloadPatch: Record<string, unknown> = {}
  ): ChatMessageRecord | null {
    const existing = this.getMessage(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const payload = {
      ...existing.payload_json,
      ...payloadPatch,
      ...(receipt ? { delivery_receipt: receipt } : {}),
      delivery_status_updated_at: now
    };
    this.db.prepare(`
      UPDATE chat_messages
      SET delivery_status = ?, payload_json = ?, updated_at = ?
      WHERE id = ?
    `).run(status, JSON.stringify(payload), now, id);
    this.recordDeliveryAttempt(id, status, receipt?.error);
    return this.getMessage(id);
  }

  updateDeliveryStatusForRelayTask(
    relayTaskId: string,
    status: DeliveryStatus,
    receipt?: RelayDeliveryReceipt | null
  ): ChatMessageRecord[] {
    const rows = this.db.prepare(`
      SELECT id, payload_json FROM chat_messages
      WHERE payload_json LIKE ?
      ORDER BY created_at DESC
      LIMIT 1000
    `).all(`%"relay_task_id":"${relayTaskId}"%`) as Array<Record<string, unknown>>;
    const updated: ChatMessageRecord[] = [];
    for (const row of rows) {
      const payload = parseJson(row.payload_json);
      if (payload.relay_task_id !== relayTaskId) continue;
      const message = this.updateMessageDeliveryStatus(String(row.id), status, receipt);
      if (message) updated.push(message);
    }
    return updated;
  }

  queueOutbox(messageId: string, conversationId: string, payload: Record<string, unknown>, error?: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO outbox (id, conversation_id, message_id, payload_json, status, next_retry_at, attempts, created_at)
      VALUES (?, ?, ?, ?, 'queued', ?, 0, ?)
      ON CONFLICT(message_id) DO UPDATE SET
        payload_json=excluded.payload_json,
        status='queued',
        next_retry_at=excluded.next_retry_at,
        attempts=attempts + 1
    `).run(`out_${randomUUID()}`, conversationId, messageId, JSON.stringify({ ...payload, error }), now, now);
  }

  recordDeliveryAttempt(messageId: string, status: string, errorMessage?: string): void {
    const now = new Date().toISOString();
    const next = this.db.prepare("SELECT COALESCE(MAX(attempt_no), 0) + 1 AS next FROM message_delivery_attempts WHERE message_id = ?")
      .get(messageId) as { next: number };
    this.db.prepare(`
      INSERT INTO message_delivery_attempts (id, message_id, attempt_no, status, error_code, error_message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(`attempt_${randomUUID()}`, messageId, next.next, status, null, errorMessage ?? null, now);
  }

  private ensureParticipant(conversationId: string, userId: string | null, agentInstanceId: string | null, role: string): void {
    if (!userId && !agentInstanceId) return;
    this.db.prepare(`
      INSERT INTO conversation_participants (conversation_id, user_id, agent_instance_id, role, joined_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id, role, agent_instance_id) DO NOTHING
    `).run(conversationId, userId, agentInstanceId, role, new Date().toISOString());
  }
}

function rowToConversation(row: Record<string, unknown>): ChatConversationRecord {
  return {
    id: String(row.id),
    org_id: nullableString(row.org_id),
    local_user_id: nullableString(row.local_user_id),
    local_agent_instance_id: nullableString(row.local_agent_instance_id),
    peer_user_id: nullableString(row.peer_user_id),
    peer_agent_instance_id: nullableString(row.peer_agent_instance_id),
    mode: normalizeMode(String(row.mode ?? "local")),
    title: String(row.title ?? row.id),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    last_message_at: nullableString(row.last_message_at),
    unread_count: Number(row.unread_count ?? 0)
  };
}

function rowToMessage(row: Record<string, unknown>): ChatMessageRecord {
  return {
    id: String(row.id),
    conversation_id: String(row.conversation_id),
    task_id: nullableString(row.task_id),
    sender_user_id: nullableString(row.sender_user_id),
    sender_agent_instance_id: nullableString(row.sender_agent_instance_id),
    receiver_agent_instance_id: nullableString(row.receiver_agent_instance_id),
    message_type: String(row.message_type) as ChatMessageType,
    text: nullableString(row.text),
    payload_json: parseJson(row.payload_json),
    delivery_status: String(row.delivery_status ?? "local_pending") as DeliveryStatus,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseJson(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizeMode(value: string): ChatMode {
  if (value === "cloud_relay" || value === "loopback" || value === "local") return value;
  if (value === "single-device") return "local";
  return "local";
}
