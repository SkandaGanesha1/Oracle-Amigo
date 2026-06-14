import type { FileReceiptMessage, TimelineMessage } from "../../api/types";

export type TimelineSide = "left" | "right" | "center";

export interface TimelineRowMeta {
  side: TimelineSide;
  authorKey: string;
  createdAt: string;
  timestamp: number;
  showDateSeparator: boolean;
  groupedWithPrevious: boolean;
  structuredCard: boolean;
  deleted: boolean;
  edited: boolean;
}

const GROUP_WINDOW_MS = 5 * 60 * 1000;

export function messageCreatedAt(message: TimelineMessage): string {
  return message.kind === "receipt" ? (message as FileReceiptMessage).received_at : message.created_at;
}

export function messageTimestamp(message: TimelineMessage): number {
  const timestamp = new Date(messageCreatedAt(message)).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function messageTextValue(message: TimelineMessage): string {
  if (message.kind === "human") return message.text;
  if (message.kind === "agent_status") return message.status_text;
  if (message.kind === "thinking_bar") return message.state.summary;
  if (message.kind === "system_event") return message.text;
  if (message.kind === "file_request") return message.natural_language_request;
  if (message.kind === "approval") return message.card.request_text;
  if (message.kind === "transfer") return `${message.file_name} is ${message.status} (${message.progress_percent}%)`;
  if (message.kind === "receipt") return `${message.file_name} receipt ${message.hash_verified ? "verified" : "needs review"}`;
  return "";
}

export function messageAuthorKey(message: TimelineMessage): string {
  if (message.origin_side === "system" || message.kind === "system_event") return "system";
  if (message.author_id) return `${message.origin_side ?? "unknown"}:${message.author_id}`;
  if (message.kind === "human") {
    return `${message.direction ?? "unknown"}:${message.sender_user_id ?? message.sender_agent_instance_id ?? message.sender_label ?? "human"}`;
  }
  return `${message.origin_side ?? "unknown"}:${message.author_kind ?? message.kind}`;
}

export function messageSide(message: TimelineMessage): TimelineSide {
  if (message.origin_side === "system" || message.kind === "system_event") return "center";
  if (message.origin_side === "local") return "right";
  if (message.origin_side === "remote") return "left";
  if (message.kind === "human" && message.direction !== "incoming") return "right";
  return "left";
}

export function isStructuredCardMessage(message: TimelineMessage): boolean {
  const complexAgentStatus =
    message.kind === "agent_status" &&
    (message.phase !== "completed" ||
      Boolean(message.details?.reasoning_steps) ||
      Boolean(message.details?.tool_calls));

  return (
    message.kind === "a2a_task" ||
    message.kind === "approval" ||
    message.kind === "transfer" ||
    message.kind === "receipt" ||
    message.kind === "file_request" ||
    message.kind === "thinking_bar" ||
    complexAgentStatus
  );
}

export function isDeletedMessage(message: TimelineMessage): boolean {
  return Boolean(message.deleted_at || message.moderation?.state === "deleted");
}

export function isEditedMessage(message: TimelineMessage): boolean {
  return Boolean(message.edited_at && !isDeletedMessage(message));
}

function canGroupMessage(message: TimelineMessage): boolean {
  return message.kind === "human" || message.kind === "agent_status";
}

function messageDateKey(message: TimelineMessage): string {
  const timestamp = messageTimestamp(message);
  return new Date(timestamp || messageCreatedAt(message)).toDateString();
}

function hasModerationBoundary(message: TimelineMessage): boolean {
  return Boolean(message.moderation && message.moderation.state !== "visible");
}

function hasGroupingBoundary(message: TimelineMessage): boolean {
  return (
    isStructuredCardMessage(message) ||
    isDeletedMessage(message) ||
    hasModerationBoundary(message) ||
    Boolean(message.reply_to_id) ||
    Boolean(message.thread_id) ||
    Boolean(message.thread_count && message.thread_count > 0) ||
    Boolean(message.pinned)
  );
}

export function getUnreadMessageId(
  messages: TimelineMessage[],
  lastReadMessageId?: string,
): string | null {
  if (!lastReadMessageId) return messages[0]?.id ?? null;

  const index = messages.findIndex((message) => message.id === lastReadMessageId);
  if (index < 0) return null;

  return messages[index + 1]?.id ?? null;
}

export function shouldGroupWithPrevious(
  message: TimelineMessage,
  previous?: TimelineMessage,
  currentStartsNewDay = false,
): boolean {
  if (!previous || !canGroupMessage(message) || !canGroupMessage(previous)) return false;
  if (message.kind !== previous.kind) return false;
  if (currentStartsNewDay) return false;
  if (hasGroupingBoundary(message) || hasGroupingBoundary(previous)) return false;
  if (messageSide(message) !== messageSide(previous)) return false;
  if (messageAuthorKey(message) !== messageAuthorKey(previous)) return false;
  if (messageDateKey(message) !== messageDateKey(previous)) return false;
  const currentTime = messageTimestamp(message);
  const previousTime = messageTimestamp(previous);
  if (!currentTime || !previousTime) return false;
  const delta = currentTime - previousTime;
  return delta >= 0 && delta <= GROUP_WINDOW_MS;
}

export function buildTimelineMeta(messages: TimelineMessage[]): Map<string, TimelineRowMeta> {
  const rows = new Map<string, TimelineRowMeta>();
  let lastDate = "";

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    const createdAt = messageCreatedAt(message);
    const timestamp = messageTimestamp(message);
    const dateKey = messageDateKey(message);
    const showDateSeparator = dateKey !== lastDate;
    if (showDateSeparator) lastDate = dateKey;

    rows.set(message.id, {
      side: messageSide(message),
      authorKey: messageAuthorKey(message),
      createdAt,
      timestamp,
      showDateSeparator,
      groupedWithPrevious: shouldGroupWithPrevious(message, messages[index - 1], showDateSeparator),
      structuredCard: isStructuredCardMessage(message),
      deleted: isDeletedMessage(message),
      edited: isEditedMessage(message),
    });
  }

  return rows;
}
