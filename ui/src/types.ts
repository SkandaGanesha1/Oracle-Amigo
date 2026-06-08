export type DeliveryStatus = "local_pending" | "sent" | "delivered" | "failed";
export type PresenceState = "online" | "stale" | "offline" | "revoked" | "unknown";

export interface CloudStatus {
  cloud: {
    profileId: string;
    controlPlaneUrl: string;
    orgId: string | null;
    userId: string | null;
    userEmail: string | null;
    displayName: string | null;
    deviceId: string | null;
    agentId: string | null;
    agentInstanceId: string | null;
    relayInboxUrl: string | null;
    status: "disconnected" | "authenticated" | "enrolled";
    hasUserAccessToken: boolean;
    hasDeviceAccessToken: boolean;
    hasRefreshToken: boolean;
    updatedAt: string;
  };
  heartbeat: { running: boolean; lastResult: unknown; lastError: string | null };
  inbox: { running: boolean; lastItemCount: number; lastError: string | null };
  relayMode: string;
  defaults?: {
    localAgentUrl: string;
    controlPlaneUrl: string;
    orgSlug: string;
  };
}

export interface DirectoryUser {
  user_id: string;
  email: string;
  display_name: string;
  status: string;
  active_agent_instances: number;
}

export interface AgentInstance {
  agent_instance_id: string;
  agent_id: string;
  device_id: string;
  display_name: string;
  status: string;
  relay_inbox_url: string;
  last_seen_at: string | null;
}

export interface Contact {
  id: string;
  requester_user_id: string;
  target_user_id: string;
  status: string;
  updated_at: string;
}

export interface CandidateFile {
  candidate_id: string;
  file_name: string;
  display_path: string;
  extension: string;
  mime_type: string;
  size_bytes: number;
  modified_at: string;
  match_score: number;
  match_reason: string;
  safety_labels: string[];
}

export interface FileCandidateApprovalCard {
  approval_id: string;
  task_id: string;
  requester: string;
  request_text: string;
  candidates: CandidateFile[];
  selected_candidate_id: string | null;
  status: "pending" | "approved" | "rejected" | "feedback_requested" | "feedback_received" | "expired" | "feedback";
  feedback_text: string | null;
  expires_at: string;
}

export interface StoredFile {
  id: string;
  storedPath: string;
  originalFileName: string;
  sha256: string;
  sizeBytes: number;
  receivedAt: string;
}

export interface AuditEvent {
  id: number;
  actorAgentId: string;
  taskId: string | null;
  approvalId?: string | null;
  eventType: string;
  detailsJson: Record<string, unknown>;
  eventHash: string;
  createdAt: string;
}

export interface HumanChatMessage {
      kind: "human";
      id: string;
      conversation_id: string;
      sender_user_id: string | null;
      sender_agent_instance_id: string | null;
      receiver_agent_instance_id: string | null;
      text: string;
      created_at: string;
      delivery_status: DeliveryStatus;
}

export interface AgentStatusMessage {
      kind: "agent_status";
      id: string;
      task_id: string;
      status_text: string;
      phase: string;
      created_at: string;
      details?: Record<string, unknown>;
}

export interface SystemEventMessage {
      kind: "system_event";
      id: string;
      event_type: string;
      text: string;
      severity: "info" | "warning" | "error" | "success";
      created_at: string;
}

export interface FileRequestMessage {
      kind: "file_request";
      id: string;
      task_id: string;
      requester: string;
      target: string;
      natural_language_request: string;
      query: string;
      status: string;
      created_at: string;
}

export interface FileCandidateApprovalMessage {
      kind: "approval";
      id: string;
      created_at: string;
      card: FileCandidateApprovalCard;
}

export interface TransferProgressMessage {
      kind: "transfer";
      id: string;
      transfer_id: string;
      task_id: string;
      file_name: string;
      size_bytes: number;
      sha256: string;
      progress_percent: number;
      status: "preparing" | "uploading" | "available" | "downloading" | "verifying" | "stored" | "failed";
      created_at: string;
}

export interface FileReceiptMessage {
      kind: "receipt";
      id: string;
      transfer_id: string;
      task_id: string;
      file_name: string;
      size_bytes: number;
      sha256: string;
      sender: string;
      stored_path_display: string;
      received_at: string;
      hash_verified: boolean;
}

export interface A2ATaskMessage {
  kind: "a2a_task";
  id: string;
  task_id: string;
  protocol_state: string;
  internal_state: string;
  artifacts: unknown[];
  history: unknown[];
  created_at: string;
}

export type TimelineMessage =
  | HumanChatMessage
  | AgentStatusMessage
  | SystemEventMessage
  | FileRequestMessage
  | FileCandidateApprovalMessage
  | TransferProgressMessage
  | FileReceiptMessage
  | A2ATaskMessage;

export interface Conversation {
  id: string;
  title: string;
  subtitle: string;
  agentInstanceId: string | null;
  presence: PresenceState;
  unread: number;
  lastMessage: string;
  pendingApprovals: number;
  transferCount: number;
  messages: TimelineMessage[];
}
