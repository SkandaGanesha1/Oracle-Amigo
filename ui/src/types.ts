export type DeliveryStatus =
  | "local_pending"
  | "queued_at_relay"
  | "delivered_to_remote_agent"
  | "stored_by_remote_agent"
  | "read_by_remote_user"
  | "sent"
  | "delivered"
  | "failed";
export type PresenceState = "online" | "stale" | "offline" | "revoked" | "unknown";
export type PeerPresenceStatus = "online" | "stale" | "offline" | "unavailable";
export type PeerPresenceReason =
  | "heartbeat_recent"
  | "heartbeat_stale"
  | "no_active_agent"
  | "not_enrolled"
  | "unknown"
  | "stale_route";

export interface PeerPresence {
  status: PeerPresenceStatus;
  reason: PeerPresenceReason;
  label: string;
  lastHeartbeatAt?: string;
  activeAgentInstanceId?: string;
  capabilities?: string[];
}
export type TrustLevel = "verified" | "unverified" | "external" | "local" | "blocked";
export type MissionStatus = "active" | "awaiting_approval" | "completed" | "failed" | "cancelled";
export type ConsentStatus = "pending" | "granted" | "rejected" | "expired" | "revoked";
export type RegistryTrustLevel = "local" | "loopback" | "trusted" | "discovered" | "blocked";

/**
 * Privacy boundary for file actions
 * - local-only: Data stays on device
 * - leaving-device: Data being sent externally
 * - shared-externally: Data shared with remote agent
 * - revocable: Access can be revoked
 * - permanent-copy: Permanent copy made
 */
export type PrivacyBoundary = "local-only" | "leaving-device" | "shared-externally" | "revocable" | "permanent-copy";

/**
 * Risk score for file approvals (0-100)
 */
export interface RiskScore {
  overall: number;
  factors: {
    matchScore: number;
    sensitivity: number;
    fileSize: number;
    trustLevel: number;
  };
  level: "low" | "medium" | "high";
}

export interface RegistryAgent {
  id: number;
  did: string;
  name: string;
  description: string;
  agentCardUrl: string;
  anpEndpoint: string;
  supportedProtocols: string[];
  skills: string[];
  trustLevel: RegistryTrustLevel;
  firstSeen: string;
  lastSeen: string;
  lastCardHash: string;
  notes: string;
}

export interface SkillManifest {
  id: string;
  name: string;
  description: string;
  version?: string;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
  path?: string;
}

export interface IndexedFile {
  id: number;
  displayPath: string;
  fileName: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: string;
  score: number;
  reason: string;
}

export interface FileSearchResult extends IndexedFile {
  previewUrl?: string;
}

export interface TransferRecord {
  id?: number | string;
  transfer_id?: string;
  transferId?: string;
  task_id?: string;
  taskId?: string;
  file_name?: string;
  fileName?: string;
  status?: string;
  progress_percent?: number;
  progressPercent?: number;
  sha256?: string;
  created_at?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface A2ATaskSummary {
  id: string;
  status: string;
  state: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface WorkflowEvent {
  id?: number;
  task_id?: string;
  taskId?: string;
  state_from?: string | null;
  state_to?: string | null;
  event_type?: string;
  eventType?: string;
  payload_json?: string | Record<string, unknown> | null;
  payloadJson?: string | Record<string, unknown> | null;
  created_at?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface MemoryConversationSummary {
  conversationId: string;
  messageCount: number;
  lastMessageAt: string;
  tenantId: string;
  agentId: string;
}

export interface MemoryWindowEntry {
  role: string;
  contentText: string;
  createdAt: string;
}

export interface EpisodicMemoryEvent {
  id?: string;
  taskId?: string;
  eventType: string;
  summary: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface LongTermMemoryEntry {
  id?: string;
  namespace?: string;
  subjectId: string;
  contentText: string;
  importance?: number;
  decayScore?: number;
  score?: number;
  createdAt?: string;
  lastAccessedAt?: string;
}

export interface PolicySummary {
  command: {
    maxCommandLength: number;
    maxTimeoutMs: number;
    enforcedRules: string[];
  };
  network: {
    profiles: Array<{ profile: string; allowedHosts: string[] }>;
  };
  secrets: {
    redactionEnabled: boolean;
    configuredSecretCount: number;
    scopedSecretNames: string[];
  };
}

export interface PolicyCommandEvaluation {
  allowed: boolean;
  reason: string;
  matchedRule?: string;
  classification: string;
  cappedTimeoutMs: number;
  redactedCommand: string;
  containsSecret: boolean;
}

export interface IntentClassification {
  intent: "file_request" | "normal_chat" | "unknown";
  requestedItem: string;
  fileTypeHints: string[];
  extensions: string[];
  projectHints: string[];
  dateHint: string | null;
  confidence: number;
}

export interface QueryRewriteResult {
  original: string;
  normalized: string;
  lexicalQuery: string;
  semanticQuery: string;
  fileTypeHints: string[];
  extensions: string[];
  projectHints: string[];
  dateHint: string | null;
}

export interface AuditVerifyResult {
  valid: boolean;
  checked?: number;
  reason?: string;
}

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
  tokenIssue?: "expired" | null;
  canRecoverDeviceToken?: boolean;
  localPublicKeyFingerprint?: string | null;
  relayMode: string;
  controlPlane?: {
    savedUrl: string;
    configuredUrl: string;
    matchesConfigured: boolean;
    reachable: boolean;
    status: "ok" | "mismatch" | "unreachable";
    message: string | null;
  };
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
  presence?: PresenceState;
  active_agent_instances: number;
  agents?: AgentInstance[];
}

export interface AgentInstance {
  agent_instance_id: string;
  agent_id: string;
  device_id: string;
  display_name: string;
  device_name?: string;
  status: string;
  capabilities?: string[];
  relay_inbox_url: string;
  agent_card_url: string;
  agent_card_hash: string;
  last_seen_at: string | null;
  last_heartbeat_at?: string | null;
}

export interface Contact {
  id: string;
  org_id?: string;
  requester_user_id: string;
  target_user_id: string;
  status: string;
  created_at?: string;
  updated_at: string;
  requester_display_name?: string;
  requester_email?: string;
  target_display_name?: string;
  target_email?: string;
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
  preview_url?: string;
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

export type FileSensitivity = "low" | "medium" | "high" | "critical";

export function detectFileSensitivity(fileName: string, filePath?: string): { level: FileSensitivity; label: string } {
  const combined = `${filePath ?? ""} ${fileName}`.toLowerCase();

  // Critical: Personally identifiable information, HR, security-sensitive
  if (/\b(passport|ssn|ss#|social.security|tax.id|credit.card|bank.account|pin|secret|classified|hr|human.resources|salary|payroll|personnel|employee|performance|review|confidential|security|authentication|credentials|password|token|key)\b/.test(combined)) {
    return { level: "critical", label: "Contains sensitive personal or security data" };
  }

  // High: Financial, legal, proprietary business documents
  if (/\b(finance|financial|invoice|budget|revenue|tax|audit|compliance|legal|contract|nda|proprietary|intellectual.property|ip|trade.secret|merger|acquisition|investor|board|shareholder)\b/.test(combined)) {
    return { level: "high", label: "Financial or legal document" };
  }

  // High: Specific high-risk folders
  if (/\b(finance|financial|legal|hr|human.resources|accounting|payroll|treasury|compliance|audit|risk)\b/.test(filePath?.toLowerCase() ?? "")) {
    return { level: "high", label: "From high-sensitivity folder" };
  }

  // Low: Downloads, temp, cache folders
  if (/\b(downloads?|temp|tmp|cache|recycle|trash)\b/.test(filePath?.toLowerCase() ?? "")) {
    return { level: "low", label: "From Downloads or temp folder" };
  }

  // Medium: General work documents
  if (/\b(documents?|docs?|work|projects?|reports?|meeting|presentation|proposal|specification|design|architecture)\b/.test(combined)) {
    return { level: "medium", label: "General work document" };
  }

  return { level: "low", label: "Unclassified" };
}

export const SENSITIVITY_CONFIG: Record<FileSensitivity, { color: string; bg: string; label: string }> = {
  low: { color: "text-oa-green", bg: "bg-oa-green/10", label: "Low" },
  medium: { color: "text-oa-blue", bg: "bg-oa-blue/10", label: "Medium" },
  high: { color: "text-oa-amber", bg: "bg-oa-amber/10", label: "High" },
  critical: { color: "text-oa-red", bg: "bg-oa-red/10", label: "Critical" },
};

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
      direction?: "incoming" | "outgoing";
      sender_label?: string;
      text: string;
      created_at: string;
      delivery_status: DeliveryStatus;
      relay_task_id?: string | null;
      delivery_receipt?: Record<string, unknown> | null;
      delivery_status_updated_at?: string | null;
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

export interface ChainOfThoughtStep {
  id: string;
  description: string;
  technicalTrace: string;
  status: "pending" | "completed" | "failed";
  timestamp: string;
  toolUsed?: string;
  confidence?: number;
}

export interface ThinkingBarState {
  isActive: boolean;
  steps: ChainOfThoughtStep[];
  currentStepId?: string;
  summary: string;
  progress: number;
  streamingText?: string;
}

export interface MessageReaction {
  emoji: string;
  count: number;
  users: string[];
}

export interface SuggestedPrompt {
  text: string;
  category: "approval" | "mission" | "search" | "memory";
  confidence: number;
}

export interface ChatSplitViewContext {
  messageId: string;
  trustGraph: TrustRelationship[];
  riskScore: "low" | "medium" | "high";
  dataMovement: {
    leavesDevice: boolean;
    recipient?: AgentInstance;
    expiresAt?: string;
    revocable: boolean;
  };
  auditPreview: string[];
  memoryUsed: string[];
  actions: string[];
}

export interface ThreadedMessage {
  id: string;
  parentMessageId: string;
  content: string;
  author: AgentInstance | { display_name: string; agent_instance_id?: string };
  timestamp: string;
  reactions: MessageReaction[];
  missionId?: string;
}

export type ChatViewMode = "main_timeline" | "threaded" | "thinking_bar_expanded" | "privacy_masked";

export interface ThinkingBarMessage {
  kind: "thinking_bar";
  id: string;
  run_id: string;
  task_id: string;
  created_at: string;
  updated_at: string;
  state: ThinkingBarState;
  sourceMessageIds: string[];
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
      details?: Record<string, unknown>;
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
      file_id: string;
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

export type AgentRunStatus = "running" | "completed" | "partial" | "failed";
export type AgentRunStepStatus = "running" | "completed" | "failed" | "skipped";

export interface AgentRunStep {
  id: string;
  label: string;
  executionTarget: "agent-orchestrator" | "oci-llm" | "gondolin-vm-command" | "host-file-search";
  status: AgentRunStepStatus;
  command?: string;
  stdout: string;
  stderr?: string;
  durationMs: number;
  sessionId?: string;
}

export interface AgentRunResult {
  runId: string;
  query: string;
  createdAt: string;
  updatedAt: string;
  status: AgentRunStatus;
  steps: AgentRunStep[];
  finalAnswer: {
    status: "found" | "not_found" | "need_help";
    message: string;
    selectedFileId?: string;
  } | null;
}

export interface MissionStep {
  id: string;
  label: string;
  kind: "search" | "reasoning" | "tool_call" | "approval" | "transfer" | "receipt" | "error";
  status: "running" | "completed" | "failed" | "skipped";
  description: string;
  durationMs?: number;
  details?: Record<string, unknown>;
}

export interface Mission {
  id: string;
  title: string;
  description: string;
  status: MissionStatus;
  createdAt: string;
  updatedAt: string;
  requesterName: string;
  requesterAgentName: string;
  requesterAgentVerified: boolean;
  recipientName: string;
  recipientAgentName: string;
  steps: MissionStep[];
  activeStepIndex: number;
  consentRecordId: string | null;
  conversationId: string;
  artifactCount: number;
  transferCount: number;
}

export interface ConsentRecord {
  id: string;
  missionId: string;
  status: ConsentStatus;
  requesterAgentId: string;
  requesterDisplayName: string;
  purpose: string;
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  fileSensitivity: "unknown" | "financial" | "hr" | "legal" | "personal" | "confidential";
  matchConfidence: number;
  matchReason: string;
  dataLeavingDevice: boolean;
  recipientAgentId: string;
  recipientAgentVerified: boolean;
  accessType: "one-time" | "time-bound" | "permanent";
  expiresAt: string | null;
  revokedAt: string | null;
  policyApplied: string[];
  createdAt: string;
  decidedAt: string | null;
}

export interface TrustRelationship {
  agentPairId: string;
  localAgentInstanceId: string;
  remoteAgentInstanceId: string;
  remoteAgentName: string;
  remoteAgentOwnerName: string;
  trustLevel: TrustLevel;
  capabilities: string[];
  permissionScope: string;
  isBlocked: boolean;
  lastInteractionAt: string | null;
  requestCount: number;
  createdAt: string;
}

export interface ChatDiagnostics {
  backend: "ok";
  agentRuns: { active: number; total: number };
  oci: { configured: boolean };
  fileSearch: { roots: string[]; rootCount: number };
}

export type TimelineMessage =
  | HumanChatMessage
  | AgentStatusMessage
  | ThinkingBarMessage
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
  peerUserId?: string | null;
  agentInstanceId: string | null;
  presence: PresenceState;
  unread: number;
  lastMessage: string;
  pendingApprovals: number;
  transferCount: number;
  messages: TimelineMessage[];
}
