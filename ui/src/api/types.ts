export type * from "../types";

import type { CloudStatus, Conversation, Mission, ConsentRecord, TrustRelationship, MissionStatus, ConsentStatus, TimelineMessage } from "../types";
import type { DeliveryStatus } from "../types";
export type { Conversation } from "../types";

export interface ChatMessagesResult {
  conversationId: string;
  conversation?: Conversation;
  messages: TimelineMessage[];
  pageInfo?: {
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
    oldestMessageId?: string;
    newestMessageId?: string;
  };
  readState?: {
    lastReadMessageId?: string;
    unreadCount: number;
    mentionCount: number;
  };
}

export interface ChatThreadResult {
  threadId: string;
  parent: TimelineMessage;
  replies: TimelineMessage[];
}

export interface CreateConversationRequest {
  peer_user_id?: string | null;
  peer_agent_instance_id?: string | null;
  title: string;
  mode?: "local" | "cloud_relay" | "loopback";
}

export interface ChatSendRequest {
  text: string;
  send_as: "normal" | "file_request";
  idempotency_key?: string;
  client_message_id?: string;
}

export interface ChatSendResult {
  ok: boolean;
  conversation_id: string;
  message_id: string;
  relay_task_id?: string;
  task_id?: string;
  run_id?: string;
  type: "message" | "file_request" | "approval_required" | "not_found" | "need_help";
  delivery_status: DeliveryStatus;
}

export interface RelayTaskStatusResult {
  relay_task_id: string;
  delivery_status: DeliveryStatus;
  relay_status: string;
  delivered_at: string | null;
  completed_at: string | null;
  receipt?: Record<string, unknown> | null;
}

export interface ChatSendErrorBody {
  error: string;
  message?: string;
  conversation_id?: string;
  message_id?: string;
  relay_unavailable?: boolean;
}

export interface MissionsListResult {
  missions: Mission[];
}

export interface ConsentActionRequest {
  consentId: string;
  action: "approve" | "reject" | "revoke";
  accessType?: "one-time" | "time-bound" | "permanent";
  expiresInHours?: number;
}

export interface TrustGraphResult {
  relationships: TrustRelationship[];
}

export interface AgentDiagnostics {
  health: { status: string; dryRun: boolean };
  cloud: CloudStatus;
  relayInbox: {
    running: boolean;
    lastItemCount: number;
    lastError: string | null;
    lastPollAt?: string | null;
    lastDispatchedCount?: number;
    dispatchCounter?: number;
  };
}

export type InboxBucket =
  | "needs_my_approval"
  | "agent_working"
  | "waiting_on_others"
  | "risky_sensitive"
  | "mentions"
  | "completed"
  | "failed_blocked"
  | "archived";

export type InboxItemKind =
  | "approval"
  | "file_request"
  | "file_transfer"
  | "agent_run"
  | "mission"
  | "chat_message"
  | "security_alert"
  | "audit_event"
  | "system";

export type InboxPriority = "critical" | "high" | "medium" | "low";
export type InboxItemStatus = "unread" | "pending" | "running" | "waiting" | "approved" | "denied" | "completed" | "failed" | "expired" | "archived";
export type InboxActionId = "preview" | "approve" | "deny" | "ask_why" | "snooze" | "archive" | "open_chat" | "view_audit";

export interface InboxItem {
  id: string;
  kind: InboxItemKind;
  bucket: InboxBucket;
  priority: InboxPriority;
  title: string;
  summary: string;
  status: InboxItemStatus;
  requester?: {
    id: string;
    label: string;
    type: "user" | "local_agent" | "remote_agent" | "system";
    trustLabel?: string;
    verified?: boolean;
  };
  target?: {
    id: string;
    label: string;
    type: "user" | "local_agent" | "remote_agent" | "file" | "mission";
  };
  conversationId?: string;
  messageId?: string;
  approvalId?: string;
  missionId?: string;
  transferId?: string;
  auditId?: string;
  risk: { level: "low" | "medium" | "high" | "critical"; reasons: string[] };
  privacy: { sensitivity: "low" | "medium" | "high" | "critical"; leavesDevice: boolean; masked: boolean; expiresAt?: string; revocable: boolean };
  file?: { name: string; path?: string; sizeBytes?: number; mimeType?: string; sha256?: string; matchScore?: number };
  actions: Array<{ id: InboxActionId; label: string; destructive?: boolean; primary?: boolean; disabledReason?: string }>;
  createdAt: string;
  updatedAt: string;
  dueAt?: string;
  unread: boolean;
}

export interface InboxItemsResult {
  items: InboxItem[];
  pageInfo: {
    nextCursor?: string;
    hasMore: boolean;
  };
  counts: Record<InboxBucket, number>;
}

export type UniversalSearchResultType =
  | "conversation"
  | "agent"
  | "file"
  | "mission"
  | "approval"
  | "transfer"
  | "audit"
  | "setting"
  | "policy";

export interface UniversalSearchResult {
  id: string;
  type: UniversalSearchResultType;
  title: string;
  subtitle: string;
  snippet: string;
  route: string;
  score: number;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface MissionThreadMessage {
  id: string;
  missionId: string;
  authorType: "user" | "agent" | "system";
  authorLabel: string;
  body: string;
  mentions: string[];
  createdAt: string;
}

export interface RedactionMark {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  reason?: string;
}

export interface WatermarkSpec {
  recipientLabel: string;
  text?: string;
}

export interface RedactionPreview {
  fileId: string;
  fileName: string;
  supported: boolean;
  pageCount: number;
  watermarkText: string;
  redactionCount: number;
}

export interface RedactionJob {
  id: string;
  sourceFileId: string;
  fileName: string;
  sha256: string;
  downloadUrl: string;
  watermarkText: string;
  createdAt: string;
}

export interface PolicyRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  role: string;
  sensitivity: string;
  fileExtension: string;
  mimeType: string;
  transferDirection: string;
  maxFileSizeBytes: number | null;
  action: "allow" | "require_approval" | "deny";
  reason: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyEvaluation {
  action: "allow" | "require_approval" | "deny";
  reason: string;
  matchedRuleId: string | null;
  matchedRuleName: string | null;
}

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

export interface BiometricCapability {
  available: boolean;
  method: "webauthn";
  enforcement: "stub";
  message: string;
}
