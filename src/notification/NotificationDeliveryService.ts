import type { DatabaseSync } from "node:sqlite";
import type { ChatMessageRecord } from "../chat/ChatRepository.js";
import { getDb } from "../db/connection.js";
import { sendNotification, type BridgeResult, type NotifyParams } from "./NotificationBridgeClient.js";
import { NotificationEventStore, type NotificationEvent } from "./NotificationEventStore.js";

export type NotificationDeliveryEventType =
  | "chat_message_received"
  | "file_request_received"
  | "approval_required"
  | "system_event";

type NotificationDeliveryInput = {
  eventType: NotificationDeliveryEventType;
  sourceEventId: string;
  title: string;
  body: string;
  severity?: NotificationEvent["severity"];
  entityType?: string | null;
  entityId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  senderUserId?: string | null;
  senderAgentInstanceId?: string | null;
  metadata?: Record<string, unknown>;
  bridgePayload: NotifyParams;
};

export class NotificationDeliveryService {
  private readonly events: NotificationEventStore;

  constructor(
    private readonly db: DatabaseSync = getDb(),
    private readonly bridgeSender: (params: NotifyParams) => Promise<BridgeResult> = sendNotification
  ) {
    this.events = new NotificationEventStore(db);
  }

  async deliver(input: NotificationDeliveryInput): Promise<NotificationEvent> {
    const existing = this.events.findBySourceEventId(input.sourceEventId);
    if (existing) return existing;

    const event = this.events.record({
      sourceEventId: input.sourceEventId,
      eventType: input.eventType,
      title: input.title,
      body: input.body,
      severity: input.severity,
      entityType: input.entityType,
      entityId: input.entityId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      senderUserId: input.senderUserId,
      senderAgentInstanceId: input.senderAgentInstanceId,
      metadata: input.metadata,
      status: "pending",
      delivered: false,
      bridgeAvailable: false
    });

    const result = await this.bridgeSender({
      notificationId: event.id,
      title: input.title,
      body: input.body,
      ...input.bridgePayload
    });

    try {
      return this.events.markBridgeResult(event.id, {
        bridgeAvailable: result.bridgeAvailable,
        delivered: Boolean(result.bridgeAvailable && result.supported !== false),
        error: result.error
      }) ?? event;
    } catch {
      return event;
    }
  }

  async chatMessageReceived(input: {
    message: ChatMessageRecord;
    conversationTitle: string;
    sourceEventId: string;
    senderLabel?: string | null;
  }): Promise<NotificationEvent> {
    const senderLabel = input.senderLabel || input.conversationTitle || input.message.sender_agent_instance_id || "Oracle Amigo";
    const body = summarize(input.message.text ?? "New message");
    return this.deliver({
      eventType: "chat_message_received",
      sourceEventId: input.sourceEventId,
      title: senderLabel,
      body,
      entityType: "conversation",
      entityId: input.message.conversation_id,
      conversationId: input.message.conversation_id,
      messageId: input.message.id,
      senderUserId: input.message.sender_user_id,
      senderAgentInstanceId: input.message.sender_agent_instance_id,
      metadata: {
        taskId: input.message.task_id,
        relayTaskId: input.message.payload_json.relay_task_id
      },
      bridgePayload: {
        kind: "chat_message",
        title: senderLabel,
        body,
        conversationId: input.message.conversation_id,
        messageId: input.message.id
      }
    });
  }

  async approvalRequired(input: {
    sourceEventId: string;
    title: string;
    body: string;
    conversationId: string;
    messageId?: string | null;
    senderAgentInstanceId?: string | null;
    metadata?: Record<string, unknown>;
    bridgePayload: NotifyParams;
  }): Promise<NotificationEvent> {
    return this.deliver({
      eventType: "approval_required",
      sourceEventId: input.sourceEventId,
      title: input.title,
      body: input.body,
      severity: "warning",
      entityType: "approval",
      entityId: typeof input.metadata?.approvalId === "string" ? input.metadata.approvalId : null,
      conversationId: input.conversationId,
      messageId: input.messageId,
      senderAgentInstanceId: input.senderAgentInstanceId,
      metadata: input.metadata,
      bridgePayload: {
        kind: "approval",
        title: input.title,
        body: input.body,
        conversationId: input.conversationId,
        messageId: input.messageId ?? undefined,
        ...input.bridgePayload
      }
    });
  }
}

function summarize(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed;
}
