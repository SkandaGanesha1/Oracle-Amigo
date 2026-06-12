export type * from "../types";

import type { CloudStatus, Mission, ConsentRecord, TrustRelationship, MissionStatus, ConsentStatus } from "../types";
import type { DeliveryStatus } from "../types";
export type { Conversation } from "../types";

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
