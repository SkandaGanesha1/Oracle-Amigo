import "dotenv/config";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream, existsSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import fastifyMetrics from "fastify-metrics";
import { register as promRegister } from "prom-client";
import { z, ZodError } from "zod";
import { SandboxTool } from "./agent-tools/SandboxTool.js";
import {
  CloneRepoAndRunTestsSchema,
  CreateSandboxSessionSchema,
  RunCodeSchema,
  RunShellCommandSchema
} from "./agent-tools/ToolSchemas.js";
import { AgentRunService, type AgentRunResult, type AgentRunStep } from "./agent-runs/AgentRunService.js";
import type { AgentReasoner } from "./agent-runs/AgentDecision.js";
import { FileSearchService, type FileSearchMatch } from "./file-search/FileSearchService.js";
import { createLogger } from "./logging/Logger.js";
import { PersonalAgentProtocol } from "./protocol/PersonalAgentProtocol.js";
import { indexRoot, reindexAll } from "./retrieval/FileIndexer.js";
import { search as hybridSearch } from "./retrieval/HybridRetrievalPipeline.js";
import { createIntentExtractor } from "./intent/IntentExtractor.js";
import { parseFileRequest } from "./intent/FileRequestParser.js";
import { createQueryRewriter } from "./intent/QueryRewriter.js";
import { refine as refineSearch } from "./retrieval/FeedbackRefiner.js";
import { searchFileRequestIndex } from "./retrieval/FileRequestSearch.js";
import { buildAgentCard, ORACLE_AMIGO_SKILLS } from "./protocol/a2a/AgentCard.js";
import { handleA2ARequest, makeMessage, makeTask, makeTextPart, makeTaskStatusUpdate, type A2AContext } from "./protocol/a2a/A2AHandler.js";
import type { AgentCard, Message as A2AMessage, Task as A2ATask, TaskState, TaskPushNotificationConfig, PushNotificationConfig } from "./protocol/a2a/types.js";
import { A2A_PROTOCOL_VERSION } from "./protocol/a2a/types.js";
import { A2Av1Handler, type A2Av1Context } from "./protocol/a2a-v1/A2Av1Handler.js";
import { buildV1AgentCard } from "./protocol/a2a-v1/AgentCardV1.js";
import { registerA2Av1RoutesWithOptions, getA2Av1UrlRewriter } from "./protocol/a2a-v1/A2Av1Routes.js";
import { A2Av1PushNotificationStore } from "./protocol/a2a-v1/A2Av1PushNotificationHandler.js";
import type {
  A2Av1AgentCard,
  A2Av1Message as A2Av1MessageT,
  A2Av1Task as A2Av1TaskT,
  A2Av1TaskPushNotificationConfig as A2Av1TaskPushNotificationConfigT,
  A2Av1PushNotificationConfig as A2Av1PushNotificationConfigT,
  A2Av1ListTasksRequest as A2Av1ListTasksRequestT,
  A2Av1ListTasksResponse as A2Av1ListTasksResponseT
} from "./protocol/a2a-v1/types.js";
import { getDefaultRegistry } from "./skills/SkillStore.js";
import { writeSkill, deleteSkill, loadSkillFromDir } from "./skills/SkillRegistry.js";
import { appendAuditEvent, getEvents, verifyChain } from "./security/AuditHashChain.js";
import { append as memAppend, getWindow as memGetWindow, listConversations as memListConversations } from "./memory/ShortTermMemory.js";
import { record as epRecord, retrieveSimilar as epRetrieveSimilar, listByTask as epListByTask } from "./memory/EpisodicMemory.js";
import { retrieve as ltRetrieve, listMemories as ltListMemories } from "./memory/LongTermMemory.js";
import { CommandPolicy } from "./policy/CommandPolicy.js";
import { AdminPolicyEngine } from "./policy/AdminPolicyEngine.js";
import { NetworkPolicy } from "./policy/NetworkPolicy.js";
import { SecretPolicy } from "./policy/SecretPolicy.js";
import { sendNotification as notifyBridge } from "./notification/NotificationBridgeClient.js";
import { NotificationEventStore } from "./notification/NotificationEventStore.js";
import { RedactionEngine } from "./redaction/RedactionEngine.js";
import { UniversalSearchService } from "./search/UniversalSearchService.js";
import { deleteAgent, getAgent, listAgents, setTrustLevel, upsertAgent, type TrustLevel } from "./registry/AgentRegistry.js";
import { discoverAndRegister, refreshAgent } from "./registry/AgentDiscovery.js";
import { listStoredFiles, getStoredFile } from "./storage/AgenticStorage.js";
import { MissionThreadService } from "./workflow/MissionThreadService.js";
import { createTask as wfCreateTask, transition as wfTransition, listTasks as wfListTasks, getTask as wfGetTask } from "./workflow/TaskWorkflow.js";
import { getDb, resolveDbPath } from "./db/connection.js";
import { generateOrLoadIdentity, resetLocalIdentity } from "./security/DeviceIdentity.js";
import { CloudError, ControlPlaneClient } from "./cloud/ControlPlaneClient.js";
import { DirectoryClient, type CloudAgentInstance, type CloudAgentInstanceDirectoryEntry } from "./cloud/DirectoryClient.js";
import { RelayClient } from "./cloud/RelayClient.js";
import { LocalCloudIdentityStore, defaultControlPlaneUrl, defaultProfileId, type LocalCloudIdentity } from "./cloud/LocalCloudIdentityStore.js";
import { DeviceEnrollmentService } from "./enrollment/DeviceEnrollmentService.js";
import { AgentRegistrationService } from "./enrollment/AgentRegistrationService.js";
import { HeartbeatService } from "./runtime/HeartbeatService.js";
import { InboxPoller } from "./runtime/InboxPoller.js";
import { RemoteTaskDispatcher } from "./runtime/RemoteTaskDispatcher.js";
import { PeerRoutingService } from "./runtime/PeerRoutingService.js";
import { ApprovalTransferOrchestrator } from "./runtime/ApprovalTransferOrchestrator.js";
import { resolveFileRequestCandidates, toApprovalCandidatePayload } from "./runtime/FileRequestCandidateResolver.js";
import { getDeviceTokenRecoveryStatus, structuredEnrollmentError, withRecoveredDeviceToken } from "./runtime/CloudTokenRecovery.js";
import { ChatRepository, type ChatConversationRecord, type ChatMessageRecord, type ChatMessageReaction, type ChatRepositoryEvent, type ConversationReadState, type DeliveryStatus, type RelayDeliveryReceipt } from "./chat/ChatRepository.js";
import { VoiceCommandService } from "./voice/VoiceCommandService.js";
import { registerVoiceCommandRoutes } from "./voice/VoiceCommandRoutes.js";
import { HybridVoiceCommandParser } from "./voice/HybridVoiceCommandParser.js";
import { getLlmProvider } from "./oci/LlmProvider.js";
import { registerReceiverApprovalRoutes } from "./runtime/ReceiverApprovalRoutes.js";
import { ReceiverAgentOrchestrator } from "./runtime/ReceiverAgentOrchestrator.js";
import { assertPublicHttpsUrl, constantTimeEqual, hasValidLocalUiSession, isPrivateOrMetadataHost, LOCAL_UI_SESSION_COOKIE, requireLocalApiToken, setLocalUiSessionCookie, signApprovalCallback, verifyApprovalCallbackSignature } from "./security/SecurityGuards.js";
import { createHandshakeContext, verifyHandshakeOffer, verifyHandshakeResponse } from "./security/AnpHandshakeAdapter.js";

const FileSearchSchema = z.object({
  query: z.string().trim().min(1).max(500)
});

const AgentRunSchema = z.object({
  query: z.string().trim().min(1).max(500),
  createSandboxSession: z.boolean().optional()
});

const ChatMessageSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  conversationId: z.string().trim().min(1).max(200).optional()
});

const ChatConversationSchema = z.object({
  peer_user_id: z.string().trim().min(1).nullable().optional(),
  peer_agent_instance_id: z.string().trim().min(1).nullable().optional(),
  title: z.string().trim().min(1).max(200),
  mode: z.enum(["local", "cloud_relay", "loopback"]).optional()
});

const ChatConversationSendSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  send_as: z.enum(["normal", "file_request"]).default("normal"),
  idempotency_key: z.string().trim().min(1).max(200).optional(),
  client_message_id: z.string().trim().min(1).max(200).optional()
});

const ChatMessagesQuerySchema = z.object({
  around: z.string().trim().min(1).max(200).optional(),
  before: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(80)
});

const ChatPinSchema = z.object({
  pinned: z.boolean()
});

const ChatReactionParamsSchema = z.object({
  conversationId: z.string().trim().min(1).max(200),
  messageId: z.string().trim().min(1).max(200),
  emoji: z.string().trim().min(1).max(32).refine((value) => !/[\u0000-\u001F\u007F]/u.test(value), "Invalid emoji")
});

const ThreadReplySchema = z.object({
  text: z.string().trim().min(1).max(2000)
});

const ChatReadStateSchema = z.object({
  lastReadMessageId: z.string().trim().min(1).max(200)
});

const InboxBucketSchema = z.enum([
  "needs_my_approval",
  "agent_working",
  "waiting_on_others",
  "risky_sensitive",
  "mentions",
  "completed",
  "failed_blocked",
  "archived"
]);

const InboxItemsQuerySchema = z.object({
  bucket: InboxBucketSchema.optional(),
  status: z.string().trim().min(1).max(40).optional(),
  q: z.string().trim().max(200).optional(),
  cursor: z.string().trim().min(1).max(20).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

const InboxSnoozeSchema = z.object({
  snoozedUntil: z.string().datetime().optional()
});

const InboxBulkSchema = z.object({
  itemIds: z.array(z.string().trim().min(1).max(240)).min(1).max(100),
  action: z.enum(["read", "archive", "snooze"]),
  snoozedUntil: z.string().datetime().optional()
});

const UserAgentSettingsSchema = z.object({
  privacy: z.object({
    showOnline: z.boolean().default(true),
    shareDiagnostics: z.boolean().default(false),
    safeMode: z.boolean().default(false),
    maskFileNames: z.boolean().default(true)
  }).default({}),
  notifications: z.object({
    enabled: z.boolean().default(true),
    approvals: z.boolean().default(true),
    transfers: z.boolean().default(true),
    errors: z.boolean().default(true)
  }).default({}),
  autonomy: z.object({
    autoApproveLowRisk: z.boolean().default(false),
    autoRetry: z.boolean().default(true),
    confirmFileAccess: z.boolean().default(true),
    confirmExternal: z.boolean().default(true),
    maxRetries: z.number().int().min(1).max(5).default(3)
  }).default({}),
  fileAccess: z.object({
    confirmBeforeSend: z.boolean().default(true),
    showPreview: z.boolean().default(true),
    autoVerify: z.boolean().default(true)
  }).default({})
});

const SkillIdSchema = z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,63}$/);

const SkillWriteSchema = z.object({
  manifest: z.object({
    id: SkillIdSchema,
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2_000).optional(),
    version: z.string().trim().min(1).max(50).optional(),
    tags: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
    examples: z.array(z.string().trim().min(1).max(1_000)).max(20).optional(),
    inputModes: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    outputModes: z.array(z.string().trim().min(1).max(100)).max(20).optional()
  }),
  body: z.string().max(100_000).default("")
});

const RegistryTrustLevelSchema = z.enum(["local", "loopback", "trusted", "discovered", "blocked"]);

const AgentRegistrySchema = z.object({
  did: z.string().trim().min(1).max(500),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).optional(),
  agentCardUrl: z.string().trim().max(2_000).optional(),
  anpEndpoint: z.string().trim().max(2_000).optional(),
  supportedProtocols: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  skills: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
  trustLevel: RegistryTrustLevelSchema.optional(),
  notes: z.string().trim().max(2_000).optional(),
  autoFetch: z.boolean().optional()
});

const AgentRegistryDiscoverSchema = z.object({
  url: z.string().trim().min(1).max(2_000),
  trustLevel: RegistryTrustLevelSchema.optional()
});

const AnpVerifyOfferSchema = z.object({
  offer: z.any(),
  publicKey: z.string().trim().min(1).max(4_096)
});

const AnpVerifyResponseSchema = z.object({
  response: z.any(),
  publicKey: z.string().trim().min(1).max(4_096)
});

const FileIndexSchema = z.object({
  roots: z.array(z.string().trim().min(1)).max(20).default([])
});

const IntentClassifySchema = z.object({
  text: z.string().trim().min(1).max(4000)
});

const IntentRewriteSchema = z.object({
  query: z.string().trim().min(1).max(4000)
});

const PolicyCommandEvaluateSchema = z.object({
  command: z.string().trim().min(1).max(4000),
  timeoutMs: z.number().int().positive().optional()
});

const UniversalSearchQuerySchema = z.object({
  q: z.string().trim().max(500).default(""),
  types: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

const MissionThreadCreateSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  authorType: z.enum(["user", "agent", "system"]).default("user"),
  authorLabel: z.string().trim().min(1).max(120).default("You"),
  mentions: z.array(z.string().trim().min(1).max(120)).max(20).optional()
});

const RedactionMarkSchema = z.object({
  page: z.number().int().min(1),
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
  reason: z.string().trim().max(200).optional()
});

const RedactionRequestSchema = z.object({
  fileId: z.string().trim().min(1).max(200),
  recipientLabel: z.string().trim().min(1).max(200),
  watermarkText: z.string().trim().max(500).optional(),
  redactions: z.array(RedactionMarkSchema).max(100).default([])
});

const PolicyRuleSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  enabled: z.boolean().optional(),
  role: z.string().trim().max(80).optional(),
  sensitivity: z.string().trim().max(80).optional(),
  fileExtension: z.string().trim().max(40).optional(),
  mimeType: z.string().trim().max(120).optional(),
  transferDirection: z.string().trim().max(40).optional(),
  maxFileSizeBytes: z.number().int().positive().nullable().optional(),
  action: z.enum(["allow", "require_approval", "deny"]),
  reason: z.string().trim().max(500).optional(),
  priority: z.number().int().min(0).max(10000).optional()
});

const PolicyEvaluateSchema = z.object({
  role: z.string().trim().max(80).optional(),
  sensitivity: z.string().trim().max(80).optional(),
  fileExtension: z.string().trim().max(40).optional(),
  mimeType: z.string().trim().max(120).optional(),
  transferDirection: z.string().trim().max(40).optional(),
  fileSizeBytes: z.number().int().nonnegative().optional()
});

const NotificationEventSchema = z.object({
  eventType: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(1000),
  severity: z.enum(["info", "success", "warning", "error"]).optional(),
  entityType: z.string().trim().max(80).nullable().optional(),
  entityId: z.string().trim().max(200).nullable().optional(),
  metadata: z.record(z.unknown()).optional()
});

const CloudAuthSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  display_name: z.string().trim().min(1).max(120).optional(),
  org_slug: z.string().trim().min(1).max(120).optional(),
  control_plane_url: z.string().url().optional()
});

const CloudEnrollSchema = z.object({
  device_name: z.string().trim().min(1).max(120).optional(),
  agent_display_name: z.string().trim().min(1).max(120).optional(),
  version: z.string().trim().max(40).optional(),
  capabilities: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  agent_card: z.record(z.unknown()).optional()
});

const ContactRequestSchema = z.object({
  target_user_id: z.string().trim().min(1)
});

const RelaySendSchema = z.object({
  to_agent_instance_id: z.string().trim().min(1).optional(),
  peer_user_id: z.string().trim().min(1).optional(),
  text: z.string().trim().min(1).max(2000),
  a2a_task_id: z.string().trim().min(1).max(120).optional(),
  idempotency_key: z.string().trim().min(1).max(200).optional(),
  conversation_id: z.string().trim().min(1).max(200).optional(),
  message_id: z.string().trim().min(1).max(200).optional()
}).refine((value) => value.to_agent_instance_id || value.peer_user_id, {
  message: "Either to_agent_instance_id or peer_user_id is required"
});

const ApprovalCallbackSchema = z.object({
  approvalId: z.string().trim().min(1).max(200),
  taskId: z.string().trim().min(1).max(200),
  action: z.enum(["approve", "reject", "feedback"]).default("approve"),
  feedback: z.string().max(1000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  idempotency_key: z.string().trim().min(1).max(200).optional(),
  nonce: z.string().trim().min(16).max(128),
  signature: z.string().trim().regex(/^[a-fA-F0-9]{64}$/),
  candidateId: z.string().trim().min(1).max(200).optional(),
  candidate_id: z.string().trim().min(1).max(200).optional()
});

const DEFAULT_DEV_ORG_SLUG = "local-dev";
const LOCAL_UI_RUNTIME_HEADER = "x-oracle-amigo-runtime";
const LOCAL_UI_RUNTIME_VERSION = "local-ui-session-v1";

export function buildServer(
  tool = new SandboxTool(),
  fileSearch = new FileSearchService(),
  reasoner?: AgentReasoner
) {
  const logger = createLogger();

  // Load or generate a persistent ui_session_secret in user_agent_settings SQLite table
  try {
    const db = getDb();
    const profileId = defaultProfileId();
    let uiSessionSecret: string | undefined;

    const row = db.prepare("SELECT settings_json FROM user_agent_settings WHERE profile_id = ?").get(profileId) as { settings_json?: string } | undefined;
    let currentSettings: Record<string, unknown> = {};
    if (row?.settings_json) {
      try {
        currentSettings = JSON.parse(row.settings_json);
        if (currentSettings && typeof currentSettings === "object" && typeof currentSettings.ui_session_secret === "string") {
          uiSessionSecret = currentSettings.ui_session_secret;
        }
      } catch {
        // ignore JSON parsing errors
      }
    }

    if (!uiSessionSecret) {
      uiSessionSecret = randomBytes(32).toString("hex");
      currentSettings.ui_session_secret = uiSessionSecret;
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO user_agent_settings (profile_id, settings_json, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(profile_id) DO UPDATE SET
          settings_json = excluded.settings_json,
          updated_at = excluded.updated_at
      `).run(profileId, JSON.stringify(currentSettings), now, now);
    }

    if (!process.env.LOCAL_AGENT_UI_SESSION_SECRET) {
      process.env.LOCAL_AGENT_UI_SESSION_SECRET = uiSessionSecret;
    }
  } catch (err) {
    logger.error("Failed to load/initialize persistent LOCAL_AGENT_UI_SESSION_SECRET", { err });
  }

  const server = Fastify({ logger: false, rewriteUrl: getA2Av1UrlRewriter() });

  // Prometheus metrics (controlled by env var, enabled by default)
  const agentMetricsEnabled = process.env.METRICS_ENABLED !== "false";
  if (agentMetricsEnabled) {
    promRegister.clear();
    server.register(fastifyMetrics as never, {
      endpoint: process.env.METRICS_ENDPOINT ?? "/metrics",
      defaultMetrics: { enabled: true },
      routeMetrics: { enabled: true }
    });
  }

  const localOnly = { preHandler: requireLocalApiToken };
  server.addContentTypeParser("application/a2a+json", { parseAs: "string" }, (_req, body, done) => {
    try { done(null, body ? JSON.parse(body as string) : {}); } catch (err) { done(err as Error, undefined); }
  });
  const requestStartTimes = new WeakMap<object, number>();
  const publicDir = resolve(process.cwd(), "public");
  const agentRuns = new AgentRunService(tool, fileSearch, reasoner);
  const chatRunSubscriptions = new Map<string, () => void>();
  const protocol = new PersonalAgentProtocol();
  const anpHandshakeContext = createHandshakeContext();
  const intentExtractor = createIntentExtractor();
  const queryRewriter = createQueryRewriter();
  const commandPolicy = new CommandPolicy();
  const networkPolicy = new NetworkPolicy();
  const secretPolicy = new SecretPolicy();
  const cloudStore = new LocalCloudIdentityStore();
  const deviceEnrollment = new DeviceEnrollmentService(cloudStore);
  const agentRegistration = new AgentRegistrationService(cloudStore);
  const chatRepo = new ChatRepository(getDb());
  const approvalTransfers = new ApprovalTransferOrchestrator(getDb(), cloudStore, defaultProfileId(), chatRepo);
  const universalSearch = new UniversalSearchService(getDb(), (value) => redactLocalPathText(secretPolicy.redactText(value)));
  const missionThreads = new MissionThreadService(getDb());
  const redactionEngine = new RedactionEngine(getDb());
  const adminPolicy = new AdminPolicyEngine(getDb());
  const notificationEvents = new NotificationEventStore(getDb());
  const approvalCallbackSecret = process.env.APPROVAL_CALLBACK_SECRET && process.env.APPROVAL_CALLBACK_SECRET.length >= 32
    ? process.env.APPROVAL_CALLBACK_SECRET
    : (() => {
        const generated = randomBytes(32).toString("base64url");
        process.env.APPROVAL_CALLBACK_SECRET = generated;
        return generated;
      })();

  const createApprovalCallbackAuth = (approvalId: string, taskId: string) => {
    const nonce = randomBytes(16).toString("base64url");
    return {
      nonce,
      signature: signApprovalCallback({ approvalId, taskId, action: "notification", nonce, secret: approvalCallbackSecret })
    };
  };

  const sanitizeFacadePayload = <T>(value: T): T => {
    const redacted = redactSecretTextOnly(value, secretPolicy);
    return redactLocalPaths(redacted);
  };

  const chatRealtimePayload = (event: ChatRepositoryEvent) => {
    const conversation = event.conversation ?? chatRepo.getConversation(event.conversationId);
    return sanitizeFacadePayload({
      conversationId: event.conversationId,
      messageId: event.messageId ?? null,
      messageType: event.message?.message_type ?? null,
      deliveryStatus: event.message?.delivery_status ?? null,
      preview: event.message ? safeMessagePreview(event.message) : null,
      createdAt: event.message?.created_at ?? null,
      updatedAt: event.message?.updated_at ?? event.timestamp,
      unreadCount: conversation?.unread_count ?? 0
    });
  };

  const chatRealtimeEvent = (event: ChatRepositoryEvent) => {
    const messageOperation = event.operation === "message_updated" ? "updated" : "created";
    return sanitizeFacadePayload({
      kind: event.operation === "message_created" ? "message_created" : "conversation_update",
      entityType: event.operation === "message_created" ? "message" : "conversation",
      entityId: event.messageId ?? event.conversationId,
      operation: event.operation === "message_created" ? messageOperation : event.operation,
      payload: chatRealtimePayload(event),
      timestamp: event.timestamp
    });
  };

  const chatSnapshotRealtimeEvent = () => sanitizeFacadePayload({
    kind: "conversation_update",
    entityType: "conversation",
    entityId: "*",
    operation: "snapshot",
    payload: {
      conversationId: "*",
      conversationCount: chatRepo.listConversations().length,
      updatedAt: new Date().toISOString()
    },
    timestamp: new Date().toISOString()
  });

  // Eagerly init identity with resolved db path so handlers don't re-read process.env
  const dbPath = resolveDbPath();
  const identity = generateOrLoadIdentity("Local User", dbPath);
  protocol.setIdentityPath(identity, dbPath);
  const peerRouting = new PeerRoutingService(chatRepo, {
    identityStore: cloudStore,
    enrollmentService: deviceEnrollment,
    profileId: defaultProfileId()
  });
  const voiceCommands = new VoiceCommandService({
    db: getDb(),
    getCloudIdentity: () => cloudStore.get(),
    parser: new HybridVoiceCommandParser(getLlmProvider()),
    resolveUser: async (query) => {
      const cloud = cloudStore.get();
      if (!cloud?.controlPlaneUrl) return null;
      let token = cloud.userAccessToken;
      if (cloud.refreshToken) {
        token = await deviceEnrollment.refreshUserAccessToken().catch(() => token ?? null);
      }
      if (!token) return null;
      const directory = new DirectoryClient(new ControlPlaneClient(cloud.controlPlaneUrl));
      const usersResponse = await directory.searchUsers(query, token);
      const users = usersResponse.users ?? [];
      const normalized = query.trim().toLowerCase();
      const exact = users.find((user) =>
        user.email?.toLowerCase() === normalized ||
        user.display_name?.toLowerCase() === normalized
      );
      const user = exact ?? users[0] ?? null;
      const agents = user
        ? await directory.getUserAgents(user.user_id, token).catch(() => null)
        : null;
      const activeFileAgent = agents?.agents.find((agent) =>
        (agent.status === "online" || agent.status === "active") &&
        (agent.capabilities ?? []).includes("file.request")
      ) ?? agents?.agents.find((agent) => (agent.capabilities ?? []).includes("file.request")) ?? null;
      return user ? {
        userId: user.user_id,
        displayName: user.display_name ?? null,
        email: user.email ?? null,
        activeAgentInstanceId: activeFileAgent?.agent_instance_id ?? null
      } : null;
    },
    appendVoiceCommandMessage: async (record) => {
      const cloud = cloudStore.get();
      const targetUser = record.preview.targetUser;
      const conversation = targetUser
        ? chatRepo.findCloudRelayConversationByPeerUser(targetUser.userId) ?? chatRepo.createConversation({
          orgId: cloud?.orgId ?? null,
          localUserId: cloud?.userId ?? null,
          localAgentInstanceId: cloud?.agentInstanceId ?? localIdentity.agentId,
          peerUserId: targetUser.userId,
          peerAgentInstanceId: targetUser.activeAgentInstanceId ?? null,
          mode: "cloud_relay",
          title: targetUser.displayName ?? targetUser.email ?? "Remote user"
        })
        : chatRepo.getOrCreateLocalConversation(cloud?.agentInstanceId ?? localIdentity.agentId);
      if (targetUser) {
        chatRepo.updateConversationPeer(conversation.id, {
          peerUserId: targetUser.userId,
          peerAgentInstanceId: targetUser.activeAgentInstanceId ?? conversation.peer_agent_instance_id,
          title: targetUser.displayName ?? targetUser.email ?? conversation.title
        });
      }
      chatRepo.appendMessage({
        id: `msg_voice_origin_${record.id}`,
        conversationId: conversation.id,
        taskId: record.id,
        senderUserId: cloud?.userId ?? null,
        senderAgentInstanceId: cloud?.agentInstanceId ?? localIdentity.agentId,
        receiverAgentInstanceId: targetUser?.activeAgentInstanceId ?? conversation.peer_agent_instance_id,
        messageType: "voice_command",
        text: record.transcript,
        payload: {
          voice_command_id: record.id,
          transcript: record.transcript,
          parsed: record.parsed,
          preview: record.preview,
          status: record.status,
          target_user_id: targetUser?.userId ?? null
        },
        deliveryStatus: "delivered"
      });
    },
    executeRemoteFileRequest: async ({ commandId, targetUserId, targetLabel, fileQuery, fileExtensions, idempotencyKey }) => {
      const cloud = cloudStore.get();
      if (!cloud?.deviceAccessToken || !cloud.agentInstanceId) {
        return { status: "failed", errorMessage: "This device is not enrolled for cloud relay." };
      }
      const target = await peerRouting.resolveTarget({
        peerUserId: targetUserId,
        capability: "file.request.search",
        cloud
      });
      const toAgentInstanceId = target.agentInstanceId;
      if (!toAgentInstanceId) {
        return { status: "failed", errorMessage: "No active remote agent is available for this user." };
      }

      const lowerQuery = fileQuery.toLowerCase();
      const hasExtensionInQuery = fileExtensions.some((ext) => lowerQuery.endsWith(`.${ext.toLowerCase()}`));
      const extensionText = fileExtensions.length && !hasExtensionInQuery ? ` ${fileExtensions.join("/")} file` : " file";
      const text = `Send me ${fileQuery}${extensionText}`;
      const conversation = chatRepo.findCloudRelayConversationByPeerUser(targetUserId) ?? chatRepo.createConversation({
        orgId: cloud.orgId,
        localUserId: cloud.userId,
        localAgentInstanceId: cloud.agentInstanceId,
        peerUserId: targetUserId,
        peerAgentInstanceId: toAgentInstanceId,
        mode: "cloud_relay",
        title: target.displayName ?? targetLabel
      });
      chatRepo.updateConversationPeer(conversation.id, {
        peerUserId: targetUserId,
        peerAgentInstanceId: toAgentInstanceId,
        title: target.displayName ?? targetLabel
      });

      const a2aTaskId = `task_${randomUUID()}`;
      const messageId = `msg_voice_${commandId}`;
      chatRepo.appendMessage({
        id: messageId,
        conversationId: conversation.id,
        taskId: a2aTaskId,
        senderUserId: cloud.userId,
        senderAgentInstanceId: cloud.agentInstanceId,
        receiverAgentInstanceId: toAgentInstanceId,
        messageType: "file_request",
        text,
        payload: {
          requester: cloud.displayName ?? cloud.userEmail ?? "You",
          target: target.displayName ?? targetLabel,
          natural_language_request: text,
          query: text,
          source: "voice-launcher",
          voice_command_id: commandId,
          mission_id: a2aTaskId,
          file_extensions: fileExtensions,
          status: "submitted"
        },
        deliveryStatus: "local_pending"
      });

      try {
        const relay = await withRecoveredDeviceToken(cloudStore, defaultProfileId(), async (fresh) =>
          new RelayClient(new ControlPlaneClient(fresh.controlPlaneUrl)).send({
            to_agent_instance_id: toAgentInstanceId,
            a2a_task_id: a2aTaskId,
            type: "file.request",
            payload: { kind: "file_request", text, requestText: text, voice_command_id: commandId, mission_id: a2aTaskId },
            idempotency_key: idempotencyKey
          }, fresh.deviceAccessToken!)
        );
        chatRepo.updateMessageDeliveryStatus(messageId, "queued_at_relay", null, {
          relay_task_id: relay.relay_task_id,
          relay_status: relay.status,
          relay_accepted_at: relay.accepted_at,
          to_agent_instance_id: toAgentInstanceId,
          peer_user_id: targetUserId,
          voice_command_id: commandId,
          mission_id: a2aTaskId
        });
        chatRepo.appendMessage({
          conversationId: conversation.id,
          taskId: a2aTaskId,
          senderAgentInstanceId: cloud.agentInstanceId,
          receiverAgentInstanceId: toAgentInstanceId,
          messageType: "agent_status",
          text: "Waiting for remote approval",
          payload: { relay_task_id: relay.relay_task_id, phase: "input_required", voice_command_id: commandId, mission_id: a2aTaskId },
          deliveryStatus: "queued_at_relay"
        });
        return { status: "submitted", conversationId: conversation.id, missionId: a2aTaskId, relayTaskId: relay.relay_task_id };
      } catch (err) {
        const relayError = normalizeRelaySendError(err);
        chatRepo.markMessageStatus(messageId, "failed", relayError.message);
        return { status: "failed", conversationId: conversation.id, errorMessage: relayError.message };
      }
    }
  });
  registerVoiceCommandRoutes(server, voiceCommands, () => {
    const cloud = cloudStore.get();
    return {
      enrolled: cloud?.status === "enrolled",
      user: cloud ? {
        email: cloud.userEmail,
        displayName: cloud.displayName,
        agentInstanceId: cloud.agentInstanceId
      } : null,
      heartbeat: heartbeatService.status(),
      inbox: inboxPoller.status()
    };
  });
  registerReceiverApprovalRoutes(server, getDb());
  const remoteDispatcher = new RemoteTaskDispatcher(protocol, getDb(), defaultProfileId(), chatRepo, fileSearch);
  const heartbeatService = new HeartbeatService(cloudStore, defaultProfileId());
  const inboxPoller = new InboxPoller(cloudStore, remoteDispatcher, defaultProfileId());
  const existingCloud = cloudStore.get(defaultProfileId());
  if (
    process.env.AGENTIC_DISABLE_RUNTIME_AUTOSTART !== "true" &&
    existingCloud?.status === "enrolled" &&
    existingCloud.deviceAccessToken
  ) {
    heartbeatService.start();
    inboxPoller.start();
  }

  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      reply.status(400).send({ error: "Validation failed", issues: error.issues });
      return;
    }
    if (error instanceof CloudError) {
      reply.status(error.statusCode).send({
        error: error.code,
        message: error.message
      });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("Unknown sandbox session")) {
      reply.status(404).send({ error: message });
      return;
    }
    if (isIndexRootValidationError(message)) {
      reply.status(400).send({ error: "INVALID_INDEX_ROOT", message });
      return;
    }
    if (message.startsWith("Control plane URL") || message === "Unsupported control plane URL scheme") {
      reply.status(400).send({ error: "INVALID_CONTROL_PLANE_URL", message });
      return;
    }
    if (typeof message === 'string' && (message.includes('jwt expired') || message.includes('expired') || message.includes('TOKEN_EXPIRED'))) {
      reply.status(401).send({ 
        error: "TOKEN_EXPIRED", 
        message: "Your device token has expired. Please re-enroll your device in Settings or use /cloud/enroll to get a new one. This was causing offline status, queued messages, and 'Not delivered' errors." 
      });
      return;
    }
    if (isCloudConnectivityError(error)) {
      const requestedControlPlaneUrl = getRequestedControlPlaneUrl(_request.body);
      reply.status(502).send({
        error: "CONTROL_PLANE_UNAVAILABLE",
        message: `Cannot reach the control plane at ${requestedControlPlaneUrl}. Start it with npm run dev:control-plane or set the Control-plane URL to a running service.`
      });
      return;
    }
    logger.error("request failed", { error: message });
    reply.status(500).send({ error: "Internal server error" });
  });

  server.addHook("onRequest", async (request, reply) => {
    requestStartTimes.set(request, Date.now());
    const origin = request.headers.origin;
    if (isAllowedLocalAppOrigin(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
      reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
      reply.header("Access-Control-Allow-Headers", "content-type,authorization,x-local-agent-token");
      reply.header("Access-Control-Allow-Credentials", "true");
      if (request.method === "OPTIONS") {
        reply.status(204).send();
        return;
      }
    }
    logger.info("request started", { method: request.method, url: request.url });
  });

  server.addHook("onResponse", async (request, reply) => {
    const startedAt = requestStartTimes.get(request);
    logger.info("request completed", {
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      durationMs: startedAt ? Date.now() - startedAt : undefined
    });
  });

  server.addHook("onClose", async () => {
    heartbeatService.stop();
    inboxPoller.stop();
    for (const unsubscribe of chatRunSubscriptions.values()) unsubscribe();
    chatRunSubscriptions.clear();
  });

  server.get("/health", async (request) => ({
    status: "ok",
    dryRun: process.env.SANDBOX_DRY_RUN === "true",
    localAgentUrl: localAgentUrl(),
    controlPlaneUrl: defaultControlPlaneUrl(),
    defaultOrgSlug: defaultOrgSlug(),
    localUiSession: {
      enabled: true,
      runtime: LOCAL_UI_RUNTIME_VERSION,
      cookieName: LOCAL_UI_SESSION_COOKIE,
      valid: hasValidLocalUiSession(request)
    }
  }));

  server.get("/local-ui-session", async (request, reply) => {
    const wasValid = hasValidLocalUiSession(request);
    return withLocalUiAppShell(reply).send({
      ok: true,
      localUiSession: {
        enabled: true,
        runtime: LOCAL_UI_RUNTIME_VERSION,
        cookieName: LOCAL_UI_SESSION_COOKIE,
        wasValid
      }
    });
  });

  server.get("/manifest.webmanifest", async () => ({
    name: "Oracle Amigo",
    short_name: "Amigo",
    description: "Agentic messaging, approvals, vault, policy, and mission control",
    start_url: "/inbox",
    scope: "/",
    display: "standalone",
    background_color: "#05070d",
    theme_color: "#7c3aed",
    icons: []
  }));

  server.get("/profile", localOnly, async () => {
    const identity = protocol.createLocalIdentity();
    return {
      agentId: identity.agentId,
      deviceId: identity.deviceId,
      did: identity.did,
      mode: "single-device"
    };
  });

  server.post("/profile/init", localOnly, async () => ({
    identity: protocol.createLocalIdentity(),
    session: protocol.createPeerSession({ agentId: protocol.createLocalIdentity().agentId, did: protocol.createLocalIdentity().did, publicKey: protocol.createLocalIdentity().publicKey, trustLevel: "local" })
  }));

  server.get("/settings/user-agent", localOnly, async () => {
    return sanitizeFacadePayload({ settings: loadUserAgentSettings(defaultProfileId()) });
  });

  server.put("/settings/user-agent", localOnly, async (request) => {
    const incoming = parseBody(UserAgentSettingsSchema, request.body ?? {});
    const settings = saveUserAgentSettings(defaultProfileId(), incoming);
    appendAuditEvent({
      actorAgentId: protocol.createLocalIdentity().agentId,
      taskId: "user-agent-settings",
      eventType: "USER_AGENT_SETTINGS_UPDATED",
      detailsJson: { sections: Object.keys(incoming) }
    });
    return sanitizeFacadePayload({ settings });
  });

  server.get("/search/universal", localOnly, async (request) => {
    const query = parseBody(UniversalSearchQuerySchema, request.query ?? {});
    const types = query.types
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) as Parameters<typeof universalSearch.search>[0]["types"];
    return sanitizeFacadePayload(universalSearch.search({ query: query.q, types, limit: query.limit }));
  });

  server.get("/missions", localOnly, async () => {
    return sanitizeFacadePayload({ missions: buildMissionProjections({ chatRepo, protocol, agentRuns: agentRuns.listRuns(), voiceCommands }) });
  });

  server.get("/missions/:missionId", localOnly, async (request, reply) => {
    const { missionId } = request.params as { missionId: string };
    const mission = buildMissionProjections({ chatRepo, protocol, agentRuns: agentRuns.listRuns(), voiceCommands })
      .find((candidate) => candidate.id === missionId);
    if (!mission) return reply.status(404).send({ error: "MISSION_NOT_FOUND", message: "Mission not found" });
    return sanitizeFacadePayload({ mission });
  });

  server.get("/missions/:missionId/thread", localOnly, async (request) => {
    const { missionId } = request.params as { missionId: string };
    return sanitizeFacadePayload({ messages: missionThreads.list(missionId) });
  });

  server.post("/missions/:missionId/thread", localOnly, async (request) => {
    const { missionId } = request.params as { missionId: string };
    const body = parseBody(MissionThreadCreateSchema, request.body ?? {});
    const message = missionThreads.create({
      missionId,
      authorType: body.authorType,
      authorLabel: body.authorLabel,
      body: secretPolicy.redactText(body.body),
      mentions: body.mentions
    });
    appendAuditEvent({
      actorAgentId: protocol.createLocalIdentity().agentId,
      taskId: missionId,
      eventType: "mission_thread_message_created",
      detailsJson: { messageId: message.id, authorType: message.authorType }
    });
    return sanitizeFacadePayload({ message });
  });

  server.get("/missions/:missionId/thread/events", localOnly, async (request, reply) => {
    const { missionId } = request.params as { missionId: string };
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive"
    });
    for (const message of missionThreads.list(missionId)) {
      writeSse(reply.raw, "thread_message", sanitizeFacadePayload(message));
    }
    const unsubscribe = missionThreads.subscribe(missionId, (message) => {
      writeSse(reply.raw, "thread_message", sanitizeFacadePayload(message));
    });
    request.raw.on("close", unsubscribe);
  });

  server.get("/events", localOnly, async (request, reply) => {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive"
    });

    const emitSnapshot = () => {
      const timestamp = new Date().toISOString();
      writeSse(reply.raw, "message", sanitizeFacadePayload({
        kind: "mission_update",
        entityType: "mission",
        entityId: "*",
        operation: "snapshot",
        payload: { missions: buildMissionProjections({ chatRepo, protocol, agentRuns: agentRuns.listRuns(), voiceCommands }).slice(0, 100) },
        timestamp
      }));
      writeSse(reply.raw, "message", sanitizeFacadePayload({
        kind: "voice_command_update",
        entityType: "voice_command",
        entityId: "*",
        operation: "snapshot",
        payload: { commands: voiceCommands.listCommands({ limit: 25 }) },
        timestamp
      }));
      writeSse(reply.raw, "message", chatSnapshotRealtimeEvent());
    };

    emitSnapshot();
    const unsubscribeChat = chatRepo.subscribe((event) => {
      writeSse(reply.raw, "message", chatRealtimeEvent(event));
    });
    const timer = setInterval(emitSnapshot, 5000);
    request.raw.on("close", () => {
      clearInterval(timer);
      unsubscribeChat();
    });
  });

  server.post("/redactions/preview", localOnly, async (request, reply) => {
    const body = parseBody(RedactionRequestSchema, request.body ?? {});
    const file = getStoredFile(body.fileId);
    if (!file) return reply.status(404).send({ error: "File not found" });
    const preview = await redactionEngine.preview(file, {
      recipientLabel: body.recipientLabel,
      text: body.watermarkText
    }, body.redactions);
    return sanitizeFacadePayload(preview);
  });

  server.post("/redactions/apply", localOnly, async (request, reply) => {
    const body = parseBody(RedactionRequestSchema, request.body ?? {});
    const file = getStoredFile(body.fileId);
    if (!file) return reply.status(404).send({ error: "File not found" });
    const policy = adminPolicy.evaluate({
      role: "user",
      sensitivity: "unknown",
      fileExtension: extname(file.originalFileName),
      mimeType: "application/pdf",
      transferDirection: "outbound",
      fileSizeBytes: file.sizeBytes
    });
    if (policy.action === "deny") {
      return reply.status(403).send({ error: "POLICY_DENIED", policy });
    }
    const job = await redactionEngine.apply(file, {
      recipientLabel: body.recipientLabel,
      text: body.watermarkText
    }, body.redactions);
    appendAuditEvent({
      actorAgentId: protocol.createLocalIdentity().agentId,
      eventType: "redaction_applied",
      detailsJson: {
        sourceFileId: file.id,
        redactionId: job.id,
        outputSha256: job.sha256,
        watermarkText: job.watermarkText,
        policy
      }
    });
    return sanitizeFacadePayload({ job, policy });
  });

  server.get("/redactions/:id/download", localOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const output = redactionEngine.getOutput(id);
    if (!output || !existsSync(output.path)) return reply.status(404).send({ error: "Redacted file not found" });
    return reply
      .type("application/pdf")
      .header("Content-Disposition", `attachment; filename="${output.fileName}"`)
      .send(createReadStream(output.path));
  });

  server.get("/notifications", localOnly, async (request) => {
    const q = (request.query ?? {}) as { limit?: string };
    return sanitizeFacadePayload({ events: notificationEvents.list(Math.min(Math.max(Number(q.limit ?? 50), 1), 100)) });
  });

  server.post("/notifications", localOnly, async (request) => {
    const body = parseBody(NotificationEventSchema, request.body ?? {});
    const event = notificationEvents.record(body);
    return sanitizeFacadePayload({ event });
  });

  server.get("/api/inbox/items", localOnly, async (request) => {
    const query = parseBody(InboxItemsQuerySchema, request.query ?? {});
    const { allItems: _allItems, ...result } = buildInboxItemsResult({
      query,
      chatRepo,
      protocol,
      agentRuns: agentRuns.listRuns()
    });
    return sanitizeFacadePayload(result);
  });

  server.get("/api/inbox/items/:itemId", localOnly, async (request, reply) => {
    const { itemId } = request.params as { itemId: string };
    const result = buildInboxItemsResult({
      query: { limit: 100 },
      chatRepo,
      protocol,
      agentRuns: agentRuns.listRuns()
    });
    const item = result.allItems.find((entry) => entry.id === itemId);
    if (!item) return reply.status(404).send({ error: "INBOX_ITEM_NOT_FOUND", message: "Inbox item not found." });
    return sanitizeFacadePayload({ item });
  });

  server.post("/api/inbox/items/:itemId/read", localOnly, async (request) => {
    const { itemId } = request.params as { itemId: string };
    updateInboxItemState(itemId, { readAt: new Date().toISOString() });
    return sanitizeFacadePayload({ ok: true, itemId });
  });

  server.post("/api/inbox/items/:itemId/archive", localOnly, async (request) => {
    const { itemId } = request.params as { itemId: string };
    const now = new Date().toISOString();
    updateInboxItemState(itemId, { readAt: now, archivedAt: now, snoozedUntil: null });
    return sanitizeFacadePayload({ ok: true, itemId });
  });

  server.post("/api/inbox/items/:itemId/snooze", localOnly, async (request) => {
    const { itemId } = request.params as { itemId: string };
    const body = parseBody(InboxSnoozeSchema, request.body ?? {});
    const snoozedUntil = body.snoozedUntil ?? new Date(Date.now() + 60 * 60 * 1000).toISOString();
    updateInboxItemState(itemId, { snoozedUntil });
    return sanitizeFacadePayload({ ok: true, itemId, snoozedUntil });
  });

  server.post("/api/inbox/items/:itemId/approve", localOnly, async (request, reply) => {
    const { itemId } = request.params as { itemId: string };
    const item = findInboxItem(itemId, chatRepo, protocol, agentRuns.listRuns());
    if (!item?.approvalId) {
      return reply.status(409).send({ error: "UNSUPPORTED_INBOX_ACTION", message: "This inbox item cannot be approved." });
    }
    const decision = protocol.applyApprovalDecisionWithResult(item.approvalId, "approve", {
      idempotencyKey: `${item.approvalId}|inbox|approve`
    });
    if (!decision.approval) return reply.status(404).send({ error: "Approval not found" });
    if (decision.outcome === "denied") return reply.status(409).send({ error: decision.error, approval: approvalToSafeResponse(decision.approval) });
    const cloudTransfer = await approvalTransfers.scheduleForApproval(decision.approval);
    updateInboxItemState(itemId, { readAt: new Date().toISOString() });
    if (decision.outcome === "applied") {
      appendApprovalDecisionTimeline(chatRepo, decision.approval.taskId, "approved", {
        approvalId: decision.approval.id,
        fileName: decision.approval.boundFilePath ? decision.approval.boundFilePath.split(/[\\/]/).pop() : "Selected file",
        sha256: decision.approval.boundSha256,
        sizeBytes: decision.approval.boundSizeBytes,
        transferId: cloudTransfer.transferId ?? undefined
      });
    }
    return sanitizeFacadePayload({ ok: true, itemId, approval: approvalToSafeResponse(decision.approval), cloudTransfer });
  });

  server.post("/api/inbox/items/:itemId/deny", localOnly, async (request, reply) => {
    const { itemId } = request.params as { itemId: string };
    const item = findInboxItem(itemId, chatRepo, protocol, agentRuns.listRuns());
    if (!item?.approvalId) {
      return reply.status(409).send({ error: "UNSUPPORTED_INBOX_ACTION", message: "This inbox item cannot be denied." });
    }
    const decision = protocol.applyApprovalDecisionWithResult(item.approvalId, "reject", {
      idempotencyKey: `${item.approvalId}|inbox|deny`
    });
    if (!decision.approval) return reply.status(404).send({ error: "Approval not found" });
    if (decision.outcome === "denied") return reply.status(409).send({ error: decision.error, approval: approvalToSafeResponse(decision.approval) });
    updateInboxItemState(itemId, { readAt: new Date().toISOString() });
    if (decision.outcome === "applied") {
      appendApprovalDecisionTimeline(chatRepo, decision.approval.taskId, "rejected", { approvalId: decision.approval.id });
    }
    return sanitizeFacadePayload({ ok: true, itemId, approval: approvalToSafeResponse(decision.approval) });
  });

  server.post("/api/inbox/items/:itemId/ask-why", localOnly, async (request, reply) => {
    const { itemId } = request.params as { itemId: string };
    const item = findInboxItem(itemId, chatRepo, protocol, agentRuns.listRuns());
    if (!item?.approvalId) {
      return reply.status(409).send({ error: "UNSUPPORTED_INBOX_ACTION", message: "This inbox item cannot receive an ask-why request." });
    }
    const decision = protocol.applyApprovalDecisionWithResult(item.approvalId, "feedback", {
      feedback: "Please explain why this access or transfer is needed.",
      idempotencyKey: `${item.approvalId}|inbox|ask-why`
    });
    if (!decision.approval) return reply.status(404).send({ error: "Approval not found" });
    if (decision.outcome === "denied") return reply.status(409).send({ error: decision.error, approval: approvalToSafeResponse(decision.approval) });
    updateInboxItemState(itemId, { readAt: new Date().toISOString() });
    appendApprovalDecisionTimeline(chatRepo, decision.approval.taskId, "feedback", { approvalId: item.approvalId, feedback: "Please explain why this access or transfer is needed." });
    return sanitizeFacadePayload({ ok: true, itemId, approval: approvalToSafeResponse(decision.approval) });
  });

  server.post("/api/inbox/bulk", localOnly, async (request) => {
    const body = parseBody(InboxBulkSchema, request.body ?? {});
    const now = new Date().toISOString();
    for (const itemId of body.itemIds) {
      if (body.action === "read") updateInboxItemState(itemId, { readAt: now });
      if (body.action === "archive") updateInboxItemState(itemId, { readAt: now, archivedAt: now, snoozedUntil: null });
      if (body.action === "snooze") updateInboxItemState(itemId, { snoozedUntil: body.snoozedUntil ?? new Date(Date.now() + 60 * 60 * 1000).toISOString() });
    }
    return sanitizeFacadePayload({ ok: true, itemIds: body.itemIds, action: body.action });
  });

  server.get("/biometric/capability", async () => ({
    available: false,
    method: "webauthn",
    enforcement: "stub",
    message: "WebAuthn capability is detected in the browser UI; backend biometric enforcement is not enabled in this release."
  }));

  server.post("/cloud/signup", async (request) => {
    const body = parseBody(CloudAuthSchema, request.body);
    return deviceEnrollment.signup({
      email: body.email,
      password: body.password,
      display_name: body.display_name ?? body.email,
      org_slug: body.org_slug
    }, { controlPlaneUrl: assertAllowedControlPlaneUrl(body.control_plane_url ?? defaultControlPlaneUrl()) });
  });

  server.post("/cloud/login", async (request) => {
    const body = parseBody(CloudAuthSchema.omit({ display_name: true }).extend({ display_name: z.string().optional() }), request.body);
    return deviceEnrollment.login({
      email: body.email,
      password: body.password,
      org_slug: body.org_slug
    }, { controlPlaneUrl: assertAllowedControlPlaneUrl(body.control_plane_url ?? defaultControlPlaneUrl()) });
  });

  server.post("/cloud/logout", async () => {
    heartbeatService.stop();
    inboxPoller.stop();
    return deviceEnrollment.logout();
  });

  server.post("/cloud/enroll", async (request, reply) => {
    const body = parseBody(CloudEnrollSchema, request.body ?? {});
    let result: Awaited<ReturnType<AgentRegistrationService["enroll"]>>;
    try {
      result = await agentRegistration.enroll({
        deviceName: body.device_name,
        agentDisplayName: body.agent_display_name,
        version: body.version,
        capabilities: body.capabilities,
        agentCard: body.agent_card
      });
    } catch (err) {
      const structured = structuredEnrollmentError(err, cloudStore.get(defaultProfileId()));
      if (structured) {
        return reply.status(409).send(structured);
      }
      throw err;
    }
    if (process.env.AGENTIC_DISABLE_RUNTIME_AUTOSTART !== "true") {
      heartbeatService.start();
      inboxPoller.start();
      void heartbeatService.pulse().catch(() => undefined);
      void inboxPoller.pollOnce().catch(() => undefined);
    }
    return result;
  });

  server.post("/cloud/device-identity/reset", async (_request, reply) => {
    const cloud = cloudStore.getOrCreate();
    if (!cloud.userAccessToken) {
      return reply.status(401).send({
        error: "CLOUD_USER_TOKEN_REQUIRED",
        message: "Log in before resetting this local device identity."
      });
    }
    if (cloud.status === "enrolled" && cloud.deviceAccessToken) {
      return reply.status(409).send({
        error: "DEVICE_ALREADY_ENROLLED",
        message: "This device is already enrolled. Log out first if you intend to enroll this machine as another user."
      });
    }
    heartbeatService.stop();
    inboxPoller.stop();
    const nextIdentity = resetLocalIdentity(cloud.displayName ?? "Local User", dbPath);
    protocol.setIdentityPath(nextIdentity, dbPath);
    const updated = cloudStore.save(defaultProfileId(), {
      deviceId: null,
      agentId: null,
      agentInstanceId: null,
      relayInboxUrl: null,
      deviceAccessToken: null,
      deviceRefreshToken: null,
      status: "authenticated"
    });
    return {
      ok: true,
      cloud: publicCloudIdentity(updated),
      localPublicKeyFingerprint: createHash("sha256").update(nextIdentity.publicKey.trim().toLowerCase()).digest("hex").slice(0, 16)
    };
  });

  server.get("/cloud/status", async () => {
    const cloud = cloudStore.getOrCreate();
    const configuredControlPlaneUrl = defaultControlPlaneUrl();
    const controlPlane = await inspectControlPlaneConnection(cloud.controlPlaneUrl, configuredControlPlaneUrl);
    const recovery = getDeviceTokenRecoveryStatus(cloud);
    return {
      cloud: publicCloudIdentity(cloud),
      heartbeat: heartbeatService.status(),
      inbox: inboxPoller.status(),
      tokenIssue: recovery.tokenIssue,
      canRecoverDeviceToken: recovery.canRecoverDeviceToken,
      localPublicKeyFingerprint: recovery.localPublicKeyFingerprint,
      relayMode: process.env.AGENTIC_RELAY_MODE ?? "polling",
      controlPlane,
      defaults: {
        localAgentUrl: localAgentUrl(),
        controlPlaneUrl: configuredControlPlaneUrl,
        orgSlug: defaultOrgSlug()
      }
    };
  });

  server.get("/cloud/me", localOnly, async (request, reply) => {
    const cloud = requireCloudIdentity(cloudStore.get(), reply);
    if (!cloud) return;
    const token = requireUserAccessToken(cloud, reply);
    if (!token) return;
    const me = await new (await import("./cloud/AuthClient.js")).AuthClient(new ControlPlaneClient(cloud.controlPlaneUrl)).me(token);
    return me;
  });

  server.get("/cloud/directory/users", localOnly, async (request, reply) => {
    const cloud = requireCloudIdentity(cloudStore.get(), reply);
    if (!cloud) return;
    const token = await requireFreshUserAccessToken(deviceEnrollment, reply);
    if (!token) return;
    const q = ((request.query as { q?: string })?.q ?? "").trim();
    return new DirectoryClient(new ControlPlaneClient(cloud.controlPlaneUrl)).searchUsers(q, token);
  });

  server.get("/cloud/directory/users/:user_id/agents", localOnly, async (request, reply) => {
    const cloud = requireCloudIdentity(cloudStore.get(), reply);
    if (!cloud) return;
    const token = await requireFreshUserAccessToken(deviceEnrollment, reply);
    if (!token) return;
    const { user_id } = request.params as { user_id: string };
    return new DirectoryClient(new ControlPlaneClient(cloud.controlPlaneUrl)).getUserAgents(user_id, token);
  });

  server.get("/cloud/contacts", localOnly, async (_request, reply) => {
    const cloud = requireCloudIdentity(cloudStore.get(), reply);
    if (!cloud) return;
    const token = await requireFreshUserAccessToken(deviceEnrollment, reply);
    if (!token) return;
    const client = new DirectoryClient(new ControlPlaneClient(cloud.controlPlaneUrl));
    const result = await client.listContacts(token);
    const contacts = await Promise.all((result.contacts ?? []).map(async (contact) => {
      const peerUserId = contact.requester_user_id === cloud.userId ? contact.target_user_id : contact.requester_user_id;
      try {
        const peer = await client.getUserAgents(peerUserId, token);
        if (contact.requester_user_id === peerUserId) {
          return { ...contact, requester_display_name: peer.display_name, requester_email: peer.email };
        }
        return { ...contact, target_display_name: peer.display_name, target_email: peer.email };
      } catch {
        return contact;
      }
    }));
    return { contacts };
  });

  server.post("/cloud/contacts/request", localOnly, async (request, reply) => {
    const cloud = requireCloudIdentity(cloudStore.get(), reply);
    if (!cloud) return;
    const token = await requireFreshUserAccessToken(deviceEnrollment, reply);
    if (!token) return;
    const body = parseBody(ContactRequestSchema, request.body);
    return new DirectoryClient(new ControlPlaneClient(cloud.controlPlaneUrl)).requestContact(body.target_user_id, token);
  });

  server.post("/cloud/contacts/:contact_id/accept", localOnly, async (request, reply) => {
    const cloud = requireCloudIdentity(cloudStore.get(), reply);
    if (!cloud) return;
    const token = await requireFreshUserAccessToken(deviceEnrollment, reply);
    if (!token) return;
    const { contact_id } = request.params as { contact_id: string };
    return new DirectoryClient(new ControlPlaneClient(cloud.controlPlaneUrl)).acceptContact(contact_id, token);
  });

  server.get("/relay/inbox/status", localOnly, async () => inboxPoller.status());

  server.get("/relay/task/:relay_task_id/status", localOnly, async (request, reply) => {
    const cloud = requireCloudIdentity(cloudStore.get(), reply);
    if (!cloud) return;
    const { relay_task_id } = request.params as { relay_task_id: string };
    const status = await fetchRelayDeliveryStatus(cloudStore, defaultProfileId(), relay_task_id);
    chatRepo.updateDeliveryStatusForRelayTask(relay_task_id, status.delivery_status, status.receipt);
    return status;
  });

  server.post("/relay/send-message", localOnly, async (request, reply) => {
    const cloud = requireCloudIdentity(cloudStore.get(), reply);
    if (!cloud) return;
    const body = parseBody(RelaySendSchema, request.body);
    const target = await peerRouting.resolveTarget({
      peerUserId: body.peer_user_id ?? null,
      peerAgentInstanceId: body.to_agent_instance_id ?? null,
      capability: "message.send",
      cloud
    });
    const toAgentInstanceId = target.agentInstanceId ?? body.to_agent_instance_id;
    if (!toAgentInstanceId) return reply.status(409).send({ error: "NO_ACTIVE_PEER_AGENT", message: "No active agent instance is available for this peer." });
    if (body.conversation_id && (target.userId || target.agentInstanceId)) {
      chatRepo.updateConversationPeer(body.conversation_id, {
        peerUserId: target.userId ?? undefined,
        peerAgentInstanceId: target.agentInstanceId ?? undefined,
        title: target.displayName ?? undefined
      });
    }
    const result = await withRecoveredDeviceToken(cloudStore, defaultProfileId(), async (fresh) =>
      new RelayClient(new ControlPlaneClient(fresh.controlPlaneUrl)).send({
        to_agent_instance_id: toAgentInstanceId,
        a2a_task_id: body.a2a_task_id ?? randomUUID(),
        type: "message.send",
        payload: { kind: "message", text: body.text },
        idempotency_key: body.idempotency_key
      }, fresh.deviceAccessToken!)
    );
    if (body.message_id) {
      chatRepo.updateMessageDeliveryStatus(body.message_id, "queued_at_relay", null, {
        relay_task_id: result.relay_task_id,
        relay_status: result.status,
        relay_accepted_at: result.accepted_at,
        to_agent_instance_id: toAgentInstanceId,
        peer_user_id: target.userId ?? null
      });
    }
    return result;
  });

  server.post("/relay/send-file-request", localOnly, async (request, reply) => {
    const cloud = requireCloudIdentity(cloudStore.get(), reply);
    if (!cloud) return;
    const body = parseBody(RelaySendSchema, request.body);
    const target = await peerRouting.resolveTarget({
      peerUserId: body.peer_user_id ?? null,
      peerAgentInstanceId: body.to_agent_instance_id ?? null,
      capability: "file.request",
      cloud
    });
    const toAgentInstanceId = target.agentInstanceId ?? body.to_agent_instance_id;
    if (!toAgentInstanceId) return reply.status(409).send({ error: "NO_ACTIVE_PEER_AGENT", message: "No active agent instance is available for this peer." });
    if (body.conversation_id && (target.userId || target.agentInstanceId)) {
      chatRepo.updateConversationPeer(body.conversation_id, {
        peerUserId: target.userId ?? undefined,
        peerAgentInstanceId: target.agentInstanceId ?? undefined,
        title: target.displayName ?? undefined
      });
    }
    const a2aTaskId = body.a2a_task_id ?? randomUUID();
    const result = await withRecoveredDeviceToken(cloudStore, defaultProfileId(), async (fresh) =>
      new RelayClient(new ControlPlaneClient(fresh.controlPlaneUrl)).send({
        to_agent_instance_id: toAgentInstanceId,
        a2a_task_id: a2aTaskId,
        type: "file.request",
        payload: { kind: "file_request", text: body.text, requestText: body.text },
        idempotency_key: body.idempotency_key
      }, fresh.deviceAccessToken!)
    );
    if (body.message_id) {
      chatRepo.updateMessageDeliveryStatus(body.message_id, "queued_at_relay", null, {
        relay_task_id: result.relay_task_id,
        relay_status: result.status,
        relay_accepted_at: result.accepted_at,
        to_agent_instance_id: toAgentInstanceId,
        peer_user_id: target.userId ?? null
      });
    }
    if (body.conversation_id) {
      chatRepo.appendMessage({
        conversationId: body.conversation_id,
        taskId: a2aTaskId,
        senderAgentInstanceId: cloud.agentInstanceId,
        receiverAgentInstanceId: toAgentInstanceId,
        messageType: "agent_status",
        text: "Waiting for remote approval",
        payload: { relay_task_id: result.relay_task_id, phase: "input_required" },
        deliveryStatus: "queued_at_relay"
      });
    }
    return result;
  });

  const baseUrl = `http://127.0.0.1:${process.env.SANDBOX_PORT ?? 3399}`;
  const localIdentity = protocol.createLocalIdentity();
  const agentCard: AgentCard = buildAgentCard({
    name: "Oracle Amigo Local Agent",
    description: "Local-first personal agent for file search, approval workflow, ANP peer handshake, and Agent Skills discovery.",
    version: A2A_PROTOCOL_VERSION,
    baseUrl,
    organization: "Oracle Amigo",
    organizationUrl: "https://oracle-amigo.local",
    skills: ORACLE_AMIGO_SKILLS,
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    documentationUrl: "https://oracle-amigo.local/docs",
    supportsAuthenticatedExtendedCard: true,
  });

  const extendedAgentCard: AgentCard = {
    ...agentCard,
    skills: [
      ...ORACLE_AMIGO_SKILLS,
      {
        id: "agent.internal.diagnostics",
        name: "Internal diagnostics",
        description: "Extended skill: full audit log access, system metrics, and debug information (requires authentication).",
        tags: ["diagnostics", "audit", "admin"],
        examples: ["show audit events", "get system metrics"],
        inputModes: ["text/plain"],
        outputModes: ["application/json"],
      },
    ],
  };

  // v1.0.0 Agent Card is served by registerA2Av1Routes below.
  // The legacy v0.3 `/.well-known/agent-card.json` endpoint is no longer registered;
  // per A2A v1 spec, the same well-known path serves the v1 card.

  // A2A v0.3.0 JSON-RPC endpoint
  const pushNotificationStore = new Map<string, TaskPushNotificationConfig[]>();

  const a2aCtx: A2AContext = {
    agentCard,
    onMessageSend: async (message: A2AMessage, configuration): Promise<A2ATask | A2AMessage> => {
      const text = message.parts
        .filter((p): p is { kind: "text"; text: string } => p.kind === "text")
        .map((p) => p.text)
        .join(" ");
      const task = protocol.createTask({ contextId: message.contextId, type: "file.request.search", metadata: { text, messageId: message.messageId }, actorAgentId: "a2a-peer" });
      wfTransition(task.id, "INTENT_CLASSIFIED", { text });
      const intent = intentExtractor.extract(text);
      const messageText = intent.intent === "file_request"
        ? "File request received and classified. Starting local search..."
        : "Message received and classified as normal chat.";
      if (configuration?.pushNotificationConfig) {
        const list = pushNotificationStore.get(task.id) ?? [];
        list.push({ taskId: task.id, pushNotificationConfig: sanitizePushNotificationConfig(configuration.pushNotificationConfig) });
        pushNotificationStore.set(task.id, list);
      }
      return makeTask({
        id: task.id,
        contextId: message.contextId ?? task.id,
        state: "working",
        history: [message],
        message: makeMessage("agent", [makeTextPart(messageText)], { contextId: message.contextId, taskId: task.id }),
      });
    },
    onMessageStream: async (message, configuration): Promise<void> => {
      const text = message.parts
        .filter((p): p is { kind: "text"; text: string } => p.kind === "text")
        .map((p) => p.text)
        .join(" ");
      const task = protocol.createTask({ contextId: message.contextId, type: "file.request.search", metadata: { text, messageId: message.messageId, streaming: true }, actorAgentId: "a2a-peer" });
      wfTransition(task.id, "INTENT_CLASSIFIED", { text });
      if (configuration.pushNotificationConfig) {
        const list = pushNotificationStore.get(task.id) ?? [];
        list.push({ taskId: task.id, pushNotificationConfig: sanitizePushNotificationConfig(configuration.pushNotificationConfig) });
        pushNotificationStore.set(task.id, list);
      }
      configuration.emit(makeMessage("agent", [makeTextPart("Streaming started...")], { contextId: message.contextId, taskId: task.id }));
      configuration.emit(makeTaskStatusUpdate({ taskId: task.id, contextId: message.contextId ?? task.id, state: "working", final: false }));
      configuration.emit(makeTaskStatusUpdate({ taskId: task.id, contextId: message.contextId ?? task.id, state: "completed", final: true }));
    },
    onTaskGet: async (id: string, historyLength?: number): Promise<A2ATask | null> => {
      const task = protocol.getTask(id);
      if (!task) return null;
      const state = (task.protocolState ?? "working") as TaskState;
      const metadata = task.metadataJson && Object.keys(task.metadataJson).length > 0 ? task.metadataJson : undefined;
      return makeTask({
        id: task.id,
        contextId: task.contextId ?? task.id,
        state,
        history: historyLength && historyLength > 0 ? [] : undefined,
        metadata,
      });
    },
    onTaskList: async (params): Promise<{ tasks: A2ATask[]; nextPageToken?: string; totalSize?: number }> => {
      const allTasks = wfListTasks();
      let filtered = allTasks;
      if (params.contextId) filtered = filtered.filter((t) => t.contextId === params.contextId);
      if (params.status) filtered = filtered.filter((t) => t.protocolState === (params.status as string));
      const pageSize = params.pageSize ?? 50;
      const startIndex = params.pageToken ? Number(Buffer.from(params.pageToken, "base64").toString("utf8")) : 0;
      const page = filtered.slice(startIndex, startIndex + pageSize);
      const tasks: A2ATask[] = page.map((t) =>
        makeTask({
          id: t.id,
          contextId: t.contextId ?? t.id,
          state: (t.protocolState ?? "working") as TaskState,
        })
      );
      const nextIndex = startIndex + page.length;
      const nextPageToken = nextIndex < filtered.length ? Buffer.from(String(nextIndex)).toString("base64") : undefined;
      return { tasks, nextPageToken, totalSize: filtered.length };
    },
    onTaskCancel: async (id: string): Promise<A2ATask | null> => {
      try { wfTransition(id, "FAILED", { reason: "canceled" }); } catch { /* already terminal */ }
      const task = protocol.getTask(id);
      if (!task) return null;
      return makeTask({ id: task.id, contextId: task.contextId ?? task.id, state: "canceled" });
    },
    onTaskResubscribe: async (id, configuration): Promise<void> => {
      const task = protocol.getTask(id);
      if (!task) {
        configuration.emit({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32001, message: `Task not found: ${id}` },
        });
        return;
      }
      configuration.emit(makeTaskStatusUpdate({ taskId: task.id, contextId: task.contextId ?? task.id, state: (task.protocolState ?? "working") as TaskState, final: true }));
    },
    onPushNotificationConfigSet: async (taskId, config): Promise<TaskPushNotificationConfig> => {
      const list = pushNotificationStore.get(taskId) ?? [];
      const id = config.id ?? randomUUID();
      const stored: TaskPushNotificationConfig = { taskId, pushNotificationConfig: sanitizePushNotificationConfig({ ...config, id }) };
      list.push(stored);
      pushNotificationStore.set(taskId, list);
      return stored;
    },
    onPushNotificationConfigGet: async (taskId, configId): Promise<TaskPushNotificationConfig | null> => {
      const list = pushNotificationStore.get(taskId) ?? [];
      return list.find((c) => !configId || c.pushNotificationConfig.id === configId) ?? null;
    },
    onPushNotificationConfigList: async (taskId): Promise<TaskPushNotificationConfig[]> => {
      return pushNotificationStore.get(taskId) ?? [];
    },
    onPushNotificationConfigDelete: async (taskId, configId): Promise<boolean> => {
      const list = pushNotificationStore.get(taskId) ?? [];
      const idx = list.findIndex((c) => c.pushNotificationConfig.id === configId);
      if (idx < 0) return false;
      list.splice(idx, 1);
      pushNotificationStore.set(taskId, list);
      return true;
    },
    supportsAuthenticatedExtendedCard: () => agentCard.supportsAuthenticatedExtendedCard === true,
    onGetAuthenticatedExtendedCard: async () => extendedAgentCard,
  };

  server.post("/a2a/jsonrpc", async (request, reply) => {
    const response = await handleA2ARequest(request.body, a2aCtx);
    return reply.send(response);
  });

  // ============================================================
  // ===== A2A v1.0.0 (HTTP+JSON binding) — pure v1.0.0 implementation, no v0.3 wrapper =====
  // ============================================================
  const a2aV1Card: A2Av1AgentCard = buildV1AgentCard(
    {
      name: agentCard.name,
      description: agentCard.description,
      version: agentCard.version,
      organization: agentCard.provider?.organization ?? "Oracle Amigo",
      organizationUrl: agentCard.provider?.url,
      skills: agentCard.skills.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        tags: s.tags,
        examples: s.examples,
        inputModes: s.inputModes,
        outputModes: s.outputModes
      })),
      defaultInputModes: agentCard.defaultInputModes,
      defaultOutputModes: agentCard.defaultOutputModes,
      documentationUrl: agentCard.documentationUrl,
      iconUrl: agentCard.iconUrl
    },
    {
      publicBaseUrl: baseUrl,
      capabilities: {
        streaming: agentCard.capabilities.streaming ?? true,
        pushNotifications: agentCard.capabilities.pushNotifications ?? true,
        stateTransitionHistory: agentCard.capabilities.stateTransitionHistory ?? true,
        extendedAgentCard: true
      }
    }
  );

  const a2aV1ExtendedCard: A2Av1AgentCard = {
    ...a2aV1Card,
    skills: [
      ...a2aV1Card.skills,
      {
        id: "agent.internal.diagnostics",
        name: "Internal diagnostics",
        description: "Extended skill: full audit log access, system metrics, and debug information (requires authentication).",
        tags: ["diagnostics", "audit", "admin"],
        examples: ["show audit events", "get system metrics"],
        inputModes: ["text/plain"],
        outputModes: ["application/json"]
      }
    ]
  };

  // v1 in-memory push notification store
  const a2aV1PushStore = new A2Av1PushNotificationStore();

  const a2aV1Ctx: A2Av1Context = {
    agentCard: a2aV1Card,
    onMessageSend: async (message, configuration, _tenant): Promise<A2Av1TaskT | A2Av1MessageT> => {
      // Same business logic as v0.3 but returns v1-shaped Task/Message
      const text = message.parts
        .filter((p): p is { text: string } => typeof (p as { text?: string }).text === "string")
        .map((p) => p.text)
        .join(" ");
      const task = protocol.createTask({
        contextId: message.contextId,
        type: "file.request.search",
        metadata: { text, messageId: message.messageId, a2aVersion: "1.0" },
        actorAgentId: "a2a-v1-peer"
      });
      wfTransition(task.id, "INTENT_CLASSIFIED", { text });
      const intent = intentExtractor.extract(text);
      const messageText = intent.intent === "file_request"
        ? "File request received and classified. Starting local search..."
        : "Message received and classified as normal chat.";
      if (configuration?.taskPushNotificationConfig) {
        a2aV1PushStore.set(task.id, {
          ...configuration.taskPushNotificationConfig,
          id: configuration.taskPushNotificationConfig.id ?? randomUUID()
        });
      }
      return {
        id: task.id,
        contextId: message.contextId ?? task.id,
        status: {
          state: "TASK_STATE_WORKING",
          timestamp: new Date().toISOString(),
          message: {
            messageId: randomUUID(),
            role: "ROLE_AGENT",
            parts: [{ text: messageText }],
            contextId: message.contextId,
            taskId: task.id,
            timestamp: new Date().toISOString()
          }
        },
        history: [message]
      };
    },
    onMessageStream: async (message, configuration): Promise<void> => {
      const text = message.parts
        .filter((p): p is { text: string } => typeof (p as { text?: string }).text === "string")
        .map((p) => p.text)
        .join(" ");
      const task = protocol.createTask({
        contextId: message.contextId,
        type: "file.request.search",
        metadata: { text, messageId: message.messageId, streaming: true, a2aVersion: "1.0" },
        actorAgentId: "a2a-v1-peer"
      });
      wfTransition(task.id, "INTENT_CLASSIFIED", { text });
      if (configuration.taskPushNotificationConfig) {
        a2aV1PushStore.set(task.id, {
          ...configuration.taskPushNotificationConfig,
          id: configuration.taskPushNotificationConfig.id ?? randomUUID()
        });
      }
      configuration.emit({
        type: "message",
        taskId: task.id,
        contextId: message.contextId ?? task.id,
        message: {
          messageId: randomUUID(),
          role: "ROLE_AGENT",
          parts: [{ text: "Streaming started..." }],
          contextId: message.contextId,
          taskId: task.id,
          timestamp: new Date().toISOString()
        }
      });
      configuration.emit({
        type: "status",
        event: {
          taskId: task.id,
          contextId: message.contextId ?? task.id,
          status: { state: "TASK_STATE_WORKING", timestamp: new Date().toISOString() },
          final: false
        }
      });
      configuration.emit({
        type: "status",
        event: {
          taskId: task.id,
          contextId: message.contextId ?? task.id,
          status: { state: "TASK_STATE_COMPLETED", timestamp: new Date().toISOString() },
          final: true
        }
      });
    },
    onTaskGet: async (id, historyLength, _tenant) => {
      const task = protocol.getTask(id);
      if (!task) return null;
      const state = (task.protocolState ?? "working") as string;
      const v1State = (
        state === "submitted" ? "TASK_STATE_SUBMITTED" :
        state === "working" ? "TASK_STATE_WORKING" :
        state === "input-required" ? "TASK_STATE_INPUT_REQUIRED" :
        state === "completed" ? "TASK_STATE_COMPLETED" :
        state === "failed" ? "TASK_STATE_FAILED" :
        state === "rejected" ? "TASK_STATE_REJECTED" :
        state === "canceled" ? "TASK_STATE_CANCELED" :
        state === "auth-required" ? "TASK_STATE_AUTH_REQUIRED" :
        "TASK_STATE_UNKNOWN"
      ) as A2Av1TaskT["status"]["state"];
      return {
        id: task.id,
        contextId: task.contextId ?? task.id,
        status: { state: v1State, timestamp: new Date().toISOString() },
        history: historyLength && historyLength > 0 ? [] : undefined,
        metadata: task.metadataJson && Object.keys(task.metadataJson).length > 0 ? task.metadataJson : undefined
      };
    },
    onTaskList: async (params): Promise<A2Av1ListTasksResponseT> => {
      const allTasks = wfListTasks();
      let filtered = allTasks;
      if (params.contextId) filtered = filtered.filter((t) => t.contextId === params.contextId);
      if (params.state) {
        const v03StateMap: Record<string, string> = {
          TASK_STATE_SUBMITTED: "submitted",
          TASK_STATE_WORKING: "working",
          TASK_STATE_INPUT_REQUIRED: "input-required",
          TASK_STATE_COMPLETED: "completed",
          TASK_STATE_FAILED: "failed",
          TASK_STATE_REJECTED: "rejected",
          TASK_STATE_CANCELED: "canceled",
          TASK_STATE_AUTH_REQUIRED: "auth-required"
        };
        const v03 = v03StateMap[params.state] ?? "unknown";
        filtered = filtered.filter((t) => t.protocolState === v03);
      }
      const pageSize = params.pageSize ?? 50;
      const startIndex = params.pageToken ? Number(Buffer.from(params.pageToken, "base64").toString("utf8")) : 0;
      const page = filtered.slice(startIndex, startIndex + pageSize);
      const tasks: A2Av1TaskT[] = page.map((t) => ({
        id: t.id,
        contextId: t.contextId ?? t.id,
        status: {
          state: ((): A2Av1TaskT["status"]["state"] => {
            const s = String(t.protocolState ?? "working");
            if (s === "working") return "TASK_STATE_WORKING";
            if (s === "submitted") return "TASK_STATE_SUBMITTED";
            if (s === "input-required") return "TASK_STATE_INPUT_REQUIRED";
            if (s === "completed") return "TASK_STATE_COMPLETED";
            if (s === "failed") return "TASK_STATE_FAILED";
            if (s === "rejected") return "TASK_STATE_REJECTED";
            if (s === "canceled") return "TASK_STATE_CANCELED";
            if (s === "auth-required") return "TASK_STATE_AUTH_REQUIRED";
            return "TASK_STATE_UNKNOWN";
          })(),
          timestamp: new Date().toISOString()
        }
      }));
      const nextIndex = startIndex + page.length;
      const nextPageToken = nextIndex < filtered.length ? Buffer.from(String(nextIndex)).toString("base64") : undefined;
      return { tasks, nextPageToken, totalSize: filtered.length };
    },
    onTaskCancel: async (id, _tenant) => {
      try { wfTransition(id, "FAILED", { reason: "canceled" }); } catch { /* already terminal */ }
      const task = protocol.getTask(id);
      if (!task) return null;
      return {
        id: task.id,
        contextId: task.contextId ?? task.id,
        status: { state: "TASK_STATE_CANCELED", timestamp: new Date().toISOString() }
      };
    },
    onTaskResubscribe: async (id, configuration) => {
      const task = protocol.getTask(id);
      if (!task) {
        configuration.emit({
          type: "status",
          event: {
            taskId: id,
            contextId: "",
            status: { state: "TASK_STATE_FAILED", timestamp: new Date().toISOString() },
            final: true
          }
        });
        return;
      }
      configuration.emit({
        type: "status",
        event: {
          taskId: task.id,
          contextId: task.contextId ?? task.id,
          status: { state: "TASK_STATE_COMPLETED", timestamp: new Date().toISOString() },
          final: true
        }
      });
    },
    onPushNotificationConfigSet: async (taskId, config, _tenant): Promise<A2Av1TaskPushNotificationConfigT> => {
      const stored = a2aV1PushStore.set(taskId, config);
      return { taskId, taskPushNotificationConfig: stored.taskPushNotificationConfig };
    },
    onPushNotificationConfigGet: async (taskId, configId, _tenant) => {
      return a2aV1PushStore.get(taskId, configId);
    },
    onPushNotificationConfigList: async (taskId, _tenant) => {
      return a2aV1PushStore.list(taskId);
    },
    onPushNotificationConfigDelete: async (taskId, configId, _tenant) => {
      return a2aV1PushStore.delete(taskId, configId);
    },
    supportsAuthenticatedExtendedCard: () => true,
    onGetAuthenticatedExtendedCard: async (_tenant) => a2aV1ExtendedCard
  };

  const a2aV1Handler = new A2Av1Handler(a2aV1Ctx);
  registerA2Av1RoutesWithOptions(server, a2aV1Handler, {
    requireRemoteAuth: process.env.AGENTIC_A2A_REMOTE_AUTH_REQUIRED !== "false",
    verifyAuth: async (request, tenant) => {
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "").trim();
      if (!token) return null;
      const identity = cloudStore.get();
      if (!identity?.deviceAccessToken || !constantTimeEqual(identity.deviceAccessToken, token)) return null;
      return {
        token,
        orgId: identity.orgId ?? undefined,
        callerAgentInstanceId: identity.agentInstanceId ?? undefined,
        targetAgentInstanceId: identity.agentInstanceId ?? undefined,
        skillScopes: ["message.send", "tasks.read", "tasks.cancel", "tasks.subscribe", "push.config", "agent-card.extended"]
      };
    }
  });

  // ===== Agent Skills (agentskills.io) =====
  const skillRegistry = getDefaultRegistry();
  void skillRegistry.refresh();

  server.get("/.well-known/agent-skills/", async (_request, reply) => {
    const skills = await skillRegistry.ensureFresh();
    return reply.send({
      "@context": "https://agentskills.io/context/v1",
      version: "1.0",
      agent: { name: agentCard.name, did: localIdentity.did },
      count: skills.length,
      skills: skills.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        version: s.version,
        tags: s.tags,
        examples: s.examples,
        inputModes: s.inputModes,
        outputModes: s.outputModes,
        path: s.path,
      })),
    });
  });

  server.get("/.well-known/agent-skills/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const skill = skillRegistry.get(params.id);
    if (!skill) return reply.status(404).send({ error: "Skill not found" });
    return reply.send({
      "@context": "https://agentskills.io/context/v1",
      ...skill,
    });
  });

  server.post("/skills", localOnly, async (request, reply) => {
    const body = parseBody(SkillWriteSchema, request.body ?? {});
    const skillDir = skillPathForId(body.manifest.id);
    try {
      await writeSkill(skillDir, {
        id: body.manifest.id,
        name: body.manifest.name,
        description: body.manifest.description ?? "",
        version: body.manifest.version ?? "0.1.0",
        tags: body.manifest.tags ?? [],
        examples: body.manifest.examples ?? [],
        inputModes: body.manifest.inputModes ?? ["text/plain"],
        outputModes: body.manifest.outputModes ?? ["application/json"],
        body: body.body ?? "",
      });
      const loaded = await loadSkillFromDir(skillDir);
      if (loaded) skillRegistry.upsert(loaded);
      return reply.send({ ok: true, skill: loaded });
    } catch (err) {
      return reply.status(500).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  server.delete("/skills/:id", localOnly, async (request, reply) => {
    const { id } = parseBody(z.object({ id: SkillIdSchema }), request.params);
    const skill = skillRegistry.get(id);
    if (!skill) return reply.status(404).send({ error: "Skill not found" });
    try {
      await deleteSkill(skillPathForId(id));
      skillRegistry.remove(id);
      return reply.send({ ok: true });
    } catch (err) {
      return reply.status(500).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  server.get("/skills", async () => {
    const skills = await skillRegistry.ensureFresh();
    return { count: skills.length, skills };
  });

  // ===== Agent Registry =====
  server.get("/.well-known/agents.json", async () => {
    const trusted = listAgents({ trustLevel: "trusted" });
    const loopback = listAgents({ trustLevel: "loopback" });
    const local = listAgents({ trustLevel: "local" });
    return {
      "@context": "https://oracle-amigo.local/context/agents/v1",
      version: "1.0",
      agent: { name: agentCard.name, did: localIdentity.did },
      count: trusted.length + loopback.length + local.length,
      agents: [...local, ...loopback, ...trusted].map((a) => ({
        did: a.did,
        name: a.name,
        description: a.description,
        trustLevel: a.trustLevel,
        agentCardUrl: a.agentCardUrl,
        anpEndpoint: a.anpEndpoint,
        supportedProtocols: a.supportedProtocols,
        skills: a.skills,
        lastSeen: a.lastSeen,
      })),
    };
  });

  server.get("/registry", async (request) => {
    const query = request.query as { trustLevel?: TrustLevel };
    const agents = query.trustLevel ? listAgents({ trustLevel: query.trustLevel }) : listAgents();
    return { count: agents.length, agents };
  });

  server.get("/registry/:did", async (request, reply) => {
    const params = request.params as { did: string };
    const decoded = decodeURIComponent(params.did);
    const agent = getAgent(decoded);
    if (!agent) return reply.status(404).send({ error: "Agent not found" });
    return agent;
  });

  server.post("/registry", localOnly, async (request, reply) => {
    const body = parseBody(AgentRegistrySchema, request.body ?? {});
    try {
      if (body.autoFetch && body.agentCardUrl) {
        const result = await discoverAndRegister({
          url: body.agentCardUrl,
          did: body.did,
          trustLevel: body.trustLevel,
        });
        return reply.send({ ok: true, did: result.did, cardHash: result.cardHash });
      }
      const record = upsertAgent({
        did: body.did,
        name: body.name,
        description: body.description,
        agentCardUrl: body.agentCardUrl,
        anpEndpoint: body.anpEndpoint,
        supportedProtocols: body.supportedProtocols,
        skills: body.skills,
        trustLevel: body.trustLevel,
        notes: body.notes,
      });
      return reply.send({ ok: true, agent: record });
    } catch (err) {
      return reply.status(500).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  server.delete("/registry/:did", localOnly, async (request, reply) => {
    const params = request.params as { did: string };
    const decoded = decodeURIComponent(params.did);
    const ok = deleteAgent(decoded);
    if (!ok) return reply.status(404).send({ error: "Agent not found" });
    return { ok: true };
  });

  server.put("/registry/:did/trust", localOnly, async (request, reply) => {
    const params = request.params as { did: string };
    const body = (request.body ?? {}) as { trustLevel?: TrustLevel };
    if (!body.trustLevel) return reply.status(400).send({ error: "trustLevel required" });
    const allowed: TrustLevel[] = ["local", "loopback", "trusted", "discovered", "blocked"];
    if (!allowed.includes(body.trustLevel)) return reply.status(400).send({ error: "invalid trustLevel" });
    const updated = setTrustLevel(decodeURIComponent(params.did), body.trustLevel);
    if (!updated) return reply.status(404).send({ error: "Agent not found" });
    return updated;
  });

  server.post("/registry/:did/refresh", localOnly, async (request, reply) => {
    const params = request.params as { did: string };
    const decoded = decodeURIComponent(params.did);
    const result = await refreshAgent(decoded);
    if (!result) return reply.status(404).send({ ok: false, error: "Agent not found or no agentCardUrl" });
    return { ok: true, did: decoded, cardHash: result.cardHash };
  });

  server.post("/registry/discover", localOnly, async (request, reply) => {
    const body = parseBody(AgentRegistryDiscoverSchema, request.body ?? {});
    try {
      const result = await discoverAndRegister({ url: body.url, trustLevel: body.trustLevel });
      return reply.send({ ok: true, did: result.did, cardHash: result.cardHash, card: result.card });
    } catch (err) {
      return reply.status(502).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  server.get("/memory/conversations", localOnly, async (request) => {
    const q = (request.query ?? {}) as { limit?: string; offset?: string };
    const limit = Math.max(1, Math.min(100, Number(q.limit ?? 25)));
    const offset = Math.max(0, Number(q.offset ?? 0));
    return sanitizeFacadePayload({
      conversations: memListConversations({ limit, offset }),
      limit,
      offset
    });
  });

  server.get("/memory/conversations/:id/window", localOnly, async (request) => {
    const { id } = request.params as { id: string };
    const q = (request.query ?? {}) as { maxChars?: string; maxMessages?: string };
    const maxChars = Math.max(500, Math.min(20000, Number(q.maxChars ?? 8000)));
    const maxMessages = Math.max(1, Math.min(200, Number(q.maxMessages ?? 80)));
    return sanitizeFacadePayload({
      conversationId: id,
      messages: memGetWindow(id, maxChars, { maxMessages }),
      maxChars,
      maxMessages
    });
  });

  server.get("/memory/episodic", localOnly, async (request) => {
    const q = (request.query ?? {}) as { taskId?: string; query?: string; limit?: string };
    const limit = Math.max(1, Math.min(100, Number(q.limit ?? 25)));
    const events = q.taskId
      ? epListByTask(q.taskId, { limit })
      : q.query
        ? epRetrieveSimilar(q.query, { limit })
        : [];
    return sanitizeFacadePayload({ events, limit });
  });

  server.get("/memory/long-term", localOnly, async (request) => {
    const q = (request.query ?? {}) as { namespace?: string; query?: string; limit?: string; offset?: string };
    const namespace = (q.namespace ?? "default").trim() || "default";
    const limit = Math.max(1, Math.min(100, Number(q.limit ?? 25)));
    const offset = Math.max(0, Number(q.offset ?? 0));
    const memories = q.query
      ? ltRetrieve(namespace, q.query, { limit })
      : ltListMemories(namespace, { limit, offset });
    return sanitizeFacadePayload({ namespace, memories, limit, offset });
  });

  server.post("/intent/classify", async (request) => {
    const { text } = parseBody(IntentClassifySchema, request.body);
    const classification = intentExtractor.extract(secretPolicy.redactText(text));
    return sanitizeFacadePayload({ classification });
  });

  server.post("/intent/rewrite", async (request) => {
    const { query } = parseBody(IntentRewriteSchema, request.body);
    const rewrite = queryRewriter.rewrite(secretPolicy.redactText(query));
    return sanitizeFacadePayload({ rewrite });
  });

  server.get("/policy/summary", localOnly, async () => {
    const networkProfiles = (["none", "npm", "python", "github", "web-basic"] as const)
      .map((profile) => networkPolicy.resolve(profile));
    const hostScopedSecrets = secretPolicy.getHostScopedSecrets();
    return sanitizeFacadePayload({
      command: {
        maxCommandLength: commandPolicy.maxCommandLength,
        maxTimeoutMs: commandPolicy.maxTimeoutMs,
        enforcedRules: [
          "destructive filesystem",
          "disk formatting",
          "raw disk writes",
          "shutdown/reboot",
          "fork bombs",
          "cloud metadata exfiltration",
          "host secret paths",
          "sensitive environment printing"
        ]
      },
      network: { profiles: networkProfiles },
      secrets: {
        redactionEnabled: true,
        configuredSecretCount: Object.keys(hostScopedSecrets).length,
        scopedSecretNames: Object.keys(hostScopedSecrets)
      }
    });
  });

  server.get("/policy/rules", localOnly, async () => {
    return sanitizeFacadePayload({ rules: adminPolicy.list() });
  });

  server.post("/policy/rules", localOnly, async (request) => {
    const body = parseBody(PolicyRuleSchema, request.body ?? {});
    const rule = adminPolicy.upsert(body);
    appendAuditEvent({
      actorAgentId: protocol.createLocalIdentity().agentId,
      eventType: "policy_rule_created",
      detailsJson: { ruleId: rule.id, action: rule.action }
    });
    return sanitizeFacadePayload({ rule });
  });

  server.put("/policy/rules/:id", localOnly, async (request) => {
    const { id } = request.params as { id: string };
    const body = parseBody(PolicyRuleSchema, { ...(request.body as object), id });
    const rule = adminPolicy.upsert(body);
    appendAuditEvent({
      actorAgentId: protocol.createLocalIdentity().agentId,
      eventType: "policy_rule_updated",
      detailsJson: { ruleId: rule.id, action: rule.action }
    });
    return sanitizeFacadePayload({ rule });
  });

  server.delete("/policy/rules/:id", localOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ok = adminPolicy.delete(id);
    if (!ok) return reply.status(404).send({ error: "Policy rule not found" });
    appendAuditEvent({
      actorAgentId: protocol.createLocalIdentity().agentId,
      eventType: "policy_rule_deleted",
      detailsJson: { ruleId: id }
    });
    return { ok: true };
  });

  server.post("/policy/evaluate", localOnly, async (request) => {
    const body = parseBody(PolicyEvaluateSchema, request.body ?? {});
    return sanitizeFacadePayload({ evaluation: adminPolicy.evaluate(body) });
  });

  server.get("/policy/export.csv", localOnly, async (_request, reply) => {
    return reply
      .type("text/csv; charset=utf-8")
      .header("Content-Disposition", "attachment; filename=\"oracle-amigo-policy-rules.csv\"")
      .send(adminPolicy.exportCsv());
  });

  server.post("/policy/command/evaluate", localOnly, async (request) => {
    const { command, timeoutMs } = parseBody(PolicyCommandEvaluateSchema, request.body);
    const redactedCommand = secretPolicy.redactText(command);
    const decision = commandPolicy.evaluate(redactedCommand);
    return sanitizeFacadePayload({
      ...decision,
      cappedTimeoutMs: commandPolicy.capTimeout(timeoutMs),
      redactedCommand,
      containsSecret: secretPolicy.containsRedaction(command)
    });
  });

  // Legacy /a2a/v1 endpoint for backward compatibility (now delegates to v1.0 handler for message/send only)
  server.post("/a2a/v1", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    if (body?.jsonrpc === "2.0") {
      const response = await handleA2ARequest(body, a2aCtx);
      return reply.send(response);
    }
    // Simple mode
    const text = (body?.query as string) ?? "file request";
    const task = protocol.createTask({ contextId: (body?.id as string) ?? "local-request", type: (body?.type as string) ?? "file.request.search", metadata: { text }, actorAgentId: "system" });
    return { task: { id: task.id, status: task.status, state: task.protocolState }, message: { role: "agent", parts: [{ type: "text", text: "Task created for local file request workflow." }] } };
  });

  server.get("/a2a/tasks/:taskId", async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const task = protocol.getTask(taskId);
    if (!task) return reply.status(404).send({ error: "Task not found" });
    return {
      jsonrpc: "2.0",
      id: "1",
      result: {
        task: { id: task.id, status: task.status, state: task.protocolState, metadata: task.metadataJson }
      }
    };
  });

  server.get("/a2a/tasks", async () => {
    const tasks = wfListTasks();
    return { tasks: tasks.map((t) => ({ id: t.id, status: t.status, state: t.protocolState, createdAt: t.createdAt })) };
  });

  // Mission control endpoints
  server.post("/missions/:taskId/pause", localOnly, async (request, reply) => {
    const schema = z.object({ taskId: z.string().trim().min(1) });
    const { taskId } = parseBody(schema, request.params);
    const db = getDb();

    const task = db.prepare("SELECT * FROM a2a_tasks WHERE id = ?").get(taskId) as Record<string, unknown> | undefined;
    if (!task) {
      return reply.status(404).send({ error: "Mission not found" });
    }

    const currentStatus = task.status as string;
    const result = db.prepare(`
      UPDATE a2a_tasks
      SET status = 'paused', updated_at = ?
      WHERE id = ?
        AND status NOT IN ('completed', 'rejected', 'failed', 'canceled', 'paused')
    `).run(new Date().toISOString(), taskId);
    if (Number(result.changes) !== 1) {
      return reply.status(409).send({ error: "INVALID_MISSION_STATE", message: `Cannot pause mission with status: ${currentStatus}` });
    }

    appendAuditEvent({
      actorAgentId: "user",
      taskId,
      eventType: "MISSION_PAUSED",
      detailsJson: { previousStatus: currentStatus }
    });
    
    return { ok: true, status: "paused" };
  });

  server.post("/missions/:taskId/resume", localOnly, async (request, reply) => {
    const schema = z.object({ taskId: z.string().trim().min(1) });
    const { taskId } = parseBody(schema, request.params);
    const db = getDb();

    const task = db.prepare("SELECT * FROM a2a_tasks WHERE id = ?").get(taskId) as Record<string, unknown> | undefined;
    if (!task) {
      return reply.status(404).send({ error: "Mission not found" });
    }

    const currentStatus = task.status as string;
    const protocolState = task.protocol_state as string;
    const appropriateStatus = protocolState === "APPROVAL_REQUIRED" ? "input-required" : "working";

    const result = db.prepare(`
      UPDATE a2a_tasks
      SET status = ?, updated_at = ?
      WHERE id = ? AND status = 'paused'
    `).run(appropriateStatus, new Date().toISOString(), taskId);
    if (Number(result.changes) !== 1) {
      return reply.status(409).send({ error: "INVALID_MISSION_STATE", message: `Cannot resume mission with status: ${currentStatus}` });
    }

    appendAuditEvent({
      actorAgentId: "user",
      taskId,
      eventType: "MISSION_RESUMED",
      detailsJson: { newStatus: appropriateStatus }
    });
    
    return { ok: true, status: appropriateStatus };
  });

  server.post("/missions/:taskId/cancel", localOnly, async (request, reply) => {
    const schema = z.object({ taskId: z.string().trim().min(1) });
    const { taskId } = parseBody(schema, request.params);
    const db = getDb();

    const task = db.prepare("SELECT * FROM a2a_tasks WHERE id = ?").get(taskId) as Record<string, unknown> | undefined;
    if (!task) {
      return reply.status(404).send({ error: "Mission not found" });
    }

    const currentStatus = task.status as string;
    const now = new Date().toISOString();
    const result = db.prepare(`
      UPDATE a2a_tasks
      SET status = 'canceled', updated_at = ?, completed_at = ?
      WHERE id = ?
        AND status NOT IN ('completed', 'rejected', 'failed', 'canceled')
    `).run(now, now, taskId);
    if (Number(result.changes) !== 1) {
      return reply.status(409).send({ error: "INVALID_MISSION_STATE", message: `Cannot cancel mission with status: ${currentStatus}` });
    }

    appendAuditEvent({
      actorAgentId: "user",
      taskId,
      eventType: "MISSION_CANCELED",
      detailsJson: { previousStatus: currentStatus }
    });
    
    return { ok: true, status: "canceled" };
  });

  server.post("/missions/:taskId/retry", localOnly, async (request, reply) => {
    const schema = z.object({ taskId: z.string().trim().min(1) });
    const { taskId } = parseBody(schema, request.params);
    const db = getDb();
    
    const task = db.prepare("SELECT * FROM a2a_tasks WHERE id = ?").get(taskId) as Record<string, unknown> | undefined;
    if (!task) {
      return reply.status(404).send({ error: "Mission not found" });
    }
    
    const currentStatus = task.status as string;
    if (currentStatus !== "failed") {
      return reply.status(400).send({ error: `Can only retry failed missions, current status: ${currentStatus}` });
    }
    
    // For retry, we'll create a new task with the same metadata
    const metadata = task.metadata_json as string;
    const contextId = task.context_id as string;
    const type = task.type as string;
    
    try {
      const newTask = wfCreateTask({
        contextId,
        type,
        metadata: JSON.parse(metadata),
        actorAgentId: "user"
      });
      
      appendAuditEvent({
        actorAgentId: "user",
        taskId: newTask.id,
        eventType: "MISSION_RETRIED",
        detailsJson: { originalTaskId: taskId }
      });
      
      return { ok: true, taskId: newTask.id, status: newTask.status };
    } catch (error) {
      return reply.status(500).send({ error: "Failed to create retry task" });
    }
  });

  // SSE stream for task workflow events
  server.get("/a2a/tasks/:taskId/events", async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const task = protocol.getTask(taskId);
    if (!task) return reply.status(404).send({ error: "Task not found" });
    const events = getDb().prepare("SELECT * FROM workflow_events WHERE task_id = ? ORDER BY id ASC").all(taskId) as Array<Record<string, unknown>>;
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    for (const e of events) {
      writeSse(reply.raw, "workflow_event", e);
    }
    reply.raw.end();
    return reply;
  });

  async function localFileRequestFlow(text: string, conversationId: string, sourceMessageId?: string): Promise<{
    taskId: string;
    runId: string;
    type: "approval_required" | "not_found" | "need_help";
    approvalId?: string;
    candidates: Array<{ id: string; fileName: string; displayPath: string; extension: string; sizeBytes: number; modifiedAt: string; score: number; reason: string; previewUrl: string }>;
  }> {
    const intent = intentExtractor.extract(text);
    const task = wfCreateTask({ contextId: conversationId, type: "file.request.search", metadata: { query: text, intent }, actorAgentId: "local-user" });
    wfTransition(task.id, "INTENT_CLASSIFIED", { intent: intent.intent });
    wfTransition(task.id, "SEARCH_QUERY_BUILT", { query: text });
    wfTransition(task.id, "LOCAL_SEARCH_RUNNING", { query: text });

    const run = agentRuns.createRun({ query: text, createSandboxSession: false });
    attachRunToConversation(run.runId, conversationId);
    persistAgentRunSnapshot(conversationId, run, localIdentity.agentId);
    const completedRun = await waitForAgentRunCompletion(run.runId);
    persistAgentRunSnapshot(conversationId, completedRun, localIdentity.agentId);

    const candidates = (completedRun.fileSearch?.matches ?? []).slice(0, 10);
    wfTransition(task.id, "CANDIDATES_RANKED", { count: candidates.length, runId: run.runId });
    const topCandidate = completedRun.fileSearch?.selectedMatch ?? candidates[0] ?? null;
    if (!topCandidate) {
      wfTransition(task.id, "FAILED", {
        runId: run.runId,
        reason: completedRun.finalAnswer?.message ?? "No matching file was found.",
        roots: completedRun.searchedRoots
      });
      if (sourceMessageId) {
        markFileRequestMessageComplete(sourceMessageId, text, "failed", "not_found", run.runId);
      }
      chatRepo.appendMessage({
        id: `run_${run.runId}_file_request_done`,
        conversationId,
        taskId: task.id,
        senderAgentInstanceId: protocol.createLocalIdentity().agentId,
        messageType: "agent_status",
        text: chatSafeFinalAnswerMessage(completedRun),
        payload: {
          phase: "completed",
          run_id: run.runId,
          run_status: completedRun.status,
          final_status: completedRun.finalAnswer?.status ?? "not_found",
          searched_roots: completedRun.searchedRoots,
          command_count: completedRun.fileSearch?.commands.length ?? 0
        },
        deliveryStatus: "delivered"
      });
      return { taskId: task.id, runId: run.runId, type: "not_found", candidates: [] };
    }

    const inspected = await fileSearch.inspectFile(topCandidate.id);
    const approval = await protocol.createApproval(task.id, {
      approvalType: inspected?.absolutePath ? "file.transfer.offer" : "file.search.refinement",
      requesterAgentId: "local-user",
      ownerAgentId: protocol.createLocalIdentity().agentId,
      selectedFileId: inspected?.absolutePath ? topCandidate.id : null,
      boundFilePath: inspected?.absolutePath ?? null,
      boundSha256: inspected?.sha256 ?? null,
      boundSizeBytes: inspected?.sizeBytes ?? topCandidate.sizeBytes,
    });
    wfTransition(task.id, "APPROVAL_REQUIRED", { approvalId: approval.id, candidateCount: candidates.length, runId: run.runId });
    if (sourceMessageId) {
      markFileRequestMessageComplete(sourceMessageId, text, "delivered", "approval_pending", run.runId);
    }
    chatRepo.appendMessage({
      conversationId,
      taskId: task.id,
      senderAgentInstanceId: protocol.createLocalIdentity().agentId,
      messageType: "agent_status",
      text: candidates.length > 0 ? `Your agent found ${candidates.length} candidates` : "Your agent did not find matching files",
      payload: {
        phase: "input_required",
        run_id: run.runId,
        run_status: completedRun.status,
        selected_file_id: topCandidate.id,
        searched_roots: completedRun.searchedRoots
      },
      deliveryStatus: "delivered"
    });
    chatRepo.appendMessage({
      conversationId,
      taskId: task.id,
      senderAgentInstanceId: protocol.createLocalIdentity().agentId,
      messageType: "approval",
      text: "Approval required",
      payload: {
        approval_id: approval.id,
        task_id: task.id,
        requester: "You",
        request_text: text,
        status: approval.status,
        expires_at: approval.expiresAt,
        selected_candidate_id: approval.selectedFileId,
        candidates: candidates.map((candidate) => ({
          candidate_id: candidate.id,
          file_name: candidate.fileName,
          display_path: displayPathForFileSearchMatch(candidate),
          extension: candidate.extension,
          mime_type: "application/octet-stream",
          size_bytes: candidate.sizeBytes,
          modified_at: candidate.modifiedAt,
          match_score: candidate.score,
          match_reason: candidate.reason,
          preview_url: candidate.previewUrl,
          safety_labels: ["Approval required", "Local path hidden from recipient"]
        }))
      },
      deliveryStatus: "delivered"
    });
    if (topCandidate) {
      const callbackPort = Number(process.env.SANDBOX_PORT ?? 3399);
      const callbackAuth = createApprovalCallbackAuth(approval.id, task.id);
      notifyBridge({
        approvalId: approval.id,
        taskId: task.id,
        candidateId: topCandidate.id,
        callbackNonce: callbackAuth.nonce,
        callbackSignature: callbackAuth.signature,
        requesterName: protocol.createLocalIdentity().agentId,
        requestedItem: text,
        topCandidateFileName: topCandidate.fileName,
        localAgentCallbackPort: callbackPort,
      }).catch(() => {
        // In-app approval remains the source of truth.
      });
    }
    epRecord(task.id, "SEARCH_COMPLETED", `User searched for "${text}"`, { query: text, intent, candidateCount: candidates.length });
    return {
      taskId: task.id,
      runId: run.runId,
      type: "approval_required",
      approvalId: approval.id,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        fileName: candidate.fileName,
        displayPath: displayPathForFileSearchMatch(candidate),
        extension: candidate.extension,
        sizeBytes: candidate.sizeBytes,
        modifiedAt: candidate.modifiedAt,
        score: candidate.score,
        reason: candidate.reason,
        previewUrl: candidate.previewUrl
      }))
    };
  }

  function attachRunToConversation(runId: string, conversationId: string): void {
    if (chatRunSubscriptions.has(runId)) return;
    const unsubscribe = agentRuns.subscribe(runId, (run) => {
      persistAgentRunSnapshot(conversationId, run, localIdentity.agentId);
      if (run.status !== "running") {
        const stop = chatRunSubscriptions.get(runId);
        if (stop) stop();
        chatRunSubscriptions.delete(runId);
      }
    });
    chatRunSubscriptions.set(runId, unsubscribe);
  }

  function waitForAgentRunCompletion(runId: string): Promise<AgentRunResult> {
    const current = agentRuns.getRun(runId);
    if (!current) return Promise.reject(new Error(`Agent run not found: ${runId}`));
    if (current.status !== "running") return Promise.resolve(current);

    return new Promise((resolveRun, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Agent run ${runId} did not finish before the chat request timeout.`));
      }, Number(process.env.CHAT_AGENT_RUN_WAIT_MS ?? 125000));
      const unsubscribe = agentRuns.subscribe(runId, (run) => {
        if (run.status === "running") return;
        clearTimeout(timer);
        unsubscribe();
        resolveRun(run);
      });
    });
  }

  function persistAgentRunSnapshot(conversationId: string, run: AgentRunResult, agentInstanceId: string): void {
    for (const step of run.steps) {
      chatRepo.appendMessage({
        id: `run_${run.runId}_${step.id}`,
        conversationId,
        taskId: run.runId,
        senderAgentInstanceId: agentInstanceId,
        messageType: "agent_status",
        text: sanitizeChatText(summarizeAgentRunStep(step), run),
        payload: {
          phase: phaseForAgentRunStep(step),
          run_id: run.runId,
          run_status: run.status,
          step_id: step.id,
          step_label: step.label,
          execution_target: step.executionTarget,
          step_status: step.status,
          command: step.command,
          stdout: sanitizeChatText(step.stdout, run),
          stderr: step.stderr ? sanitizeChatText(step.stderr, run) : undefined,
          duration_ms: step.durationMs
        },
        deliveryStatus: step.status === "failed" ? "failed" : run.status === "running" ? "sent" : "delivered"
      });
    }

    if (run.finalAnswer) {
      chatRepo.appendMessage({
        id: `run_${run.runId}_final`,
        conversationId,
        taskId: run.runId,
        senderAgentInstanceId: agentInstanceId,
        messageType: "agent_status",
        text: chatSafeFinalAnswerMessage(run),
        payload: {
          phase: run.status === "failed" ? "failed" : "completed",
          run_id: run.runId,
          run_status: run.status,
          final_status: run.finalAnswer.status,
          selected_file_id: run.finalAnswer.selectedFileId
        },
        deliveryStatus: run.status === "failed" ? "failed" : "delivered"
      });
    }
  }

  function chatSafeFinalAnswerMessage(run: AgentRunResult): string {
    const selected = run.fileSearch?.selectedMatch;
    if (selected) return `Found ${selected.fileName}.`;
    const message = run.finalAnswer?.message ?? "No matching file was found in the configured local file roots.";
    return sanitizeChatText(message, run);
  }

  function sanitizeChatText(text: string, run?: AgentRunResult): string {
    let safe = text;
    for (const root of run?.searchedRoots ?? []) {
      if (root) safe = safe.split(root).join("configured local roots");
    }
    for (const match of run?.fileSearch?.matches ?? []) {
      if (match.directory) safe = safe.split(match.directory).join("Local file");
      safe = safe.split(`${match.directory}\\${match.fileName}`).join(match.fileName);
      safe = safe.split(`${match.directory}/${match.fileName}`).join(match.fileName);
    }
    return safe.replace(/[A-Za-z]:\\[^\r\n"]*?([^\\\r\n"]+\.[A-Za-z0-9]{1,8})/g, "$1");
  }

  function markFileRequestMessageComplete(
    messageId: string,
    text: string,
    deliveryStatus: "delivered" | "failed",
    status: "approval_pending" | "not_found" | "need_help",
    runId: string
  ): void {
    const existing = chatRepo.getMessage(messageId);
    if (!existing) return;
    chatRepo.appendMessage({
      id: messageId,
      conversationId: existing.conversation_id,
      taskId: existing.task_id,
      senderUserId: existing.sender_user_id,
      senderAgentInstanceId: existing.sender_agent_instance_id,
      receiverAgentInstanceId: existing.receiver_agent_instance_id,
      messageType: "file_request",
      text,
      payload: {
        ...existing.payload_json,
        status,
        run_id: runId
      },
      deliveryStatus
    });
  }

  server.post("/chat/messages", localOnly, async (request) => {
    const { text, conversationId } = parseBody(ChatMessageSchema, request.body);
    const convId = conversationId ?? `conv-${Date.now()}`;
    const now = new Date().toISOString();

    // Store the message
    memAppend(convId, "user", text);

    // Classify intent
    const intent = intentExtractor.extract(text);

    if (intent.intent === "normal_chat") {
      memAppend(convId, "agent", `Message received (normal chat): ${intent.requestedItem}`);
      return { ok: true, conversationId: convId, type: "chat", text: `I received your message: "${text}". This is a personal agent chat.` };
    }

    // File request workflow
    const task = wfCreateTask({ contextId: convId, type: "file.request.search", metadata: { query: text, intent }, actorAgentId: "local-user" });
    wfTransition(task.id, "INTENT_CLASSIFIED", { intent: intent.intent });
    wfTransition(task.id, "SEARCH_QUERY_BUILT", { query: text });

    // Search
    const queryRewriter = createQueryRewriter();
    const rewritten = queryRewriter.rewrite(text);
    const searchQuery = rewritten.semanticQuery || text;
    const extensions = (rewritten.extensions.length > 0 ? rewritten.extensions : intent.extensions).length > 0
      ? { extensions: (rewritten.extensions.length > 0 ? rewritten.extensions : intent.extensions) }
      : undefined;
    wfTransition(task.id, "LOCAL_SEARCH_RUNNING", { query: searchQuery });
    const candidates = hybridSearch(searchQuery, { ...extensions, limit: 10 });
    wfTransition(task.id, "CANDIDATES_RANKED", { count: candidates.length });

    // Create approval
    const topCandidate = candidates[0];
    const approval = await protocol.createApproval(task.id, {
      approvalType: topCandidate ? "file.transfer.offer" : "file.search.refinement",
      requesterAgentId: "local-user",
      ownerAgentId: protocol.createLocalIdentity().agentId,
      selectedFileId: topCandidate ? String(topCandidate.id) : null,
      boundFilePath: topCandidate?.filePath ?? null,
      boundSha256: null,
      boundSizeBytes: topCandidate?.sizeBytes ?? null,
    });
    wfTransition(task.id, "APPROVAL_REQUIRED", { approvalId: approval.id, candidateCount: candidates.length });

    // Fire OS notification (Windows toast) via local bridge; non-blocking on bridge failure.
    if (topCandidate) {
      const callbackPort = Number(process.env.SANDBOX_PORT ?? 3399);
      const callbackAuth = createApprovalCallbackAuth(approval.id, task.id);
      notifyBridge({
        approvalId: approval.id,
        taskId: task.id,
        candidateId: String(topCandidate.id),
        callbackNonce: callbackAuth.nonce,
        callbackSignature: callbackAuth.signature,
        requesterName: protocol.createLocalIdentity().agentId,
        requestedItem: text,
        topCandidateFileName: topCandidate.fileName,
        localAgentCallbackPort: callbackPort,
      })
        .then((result) => {
          if (result.bridgeAvailable) {
            wfTransition(task.id, "APPROVAL_NOTIFICATION_SENT", {
              approvalId: approval.id,
              channel: "toast",
            });
          }
        })
        .catch(() => {
          // bridge errors are already logged inside sendNotification; keep in-app approval path alive
        });
    }

    // Record episodic memory
    epRecord(task.id, "SEARCH_COMPLETED", `User searched for "${text}"`, { query: text, intent, candidateCount: candidates.length });

    return {
      ok: true,
      conversationId: convId,
      type: "approval_required",
      taskId: task.id,
      approvalId: approval.id,
      candidates: candidates.map((c) => ({
        id: c.id, fileName: c.fileName, displayPath: c.displayPath, extension: c.extension,
        sizeBytes: c.sizeBytes, modifiedAt: c.modifiedAt, score: c.score, reason: c.reason,
      })),
    };
  });

  server.post("/chat/conversations", localOnly, async (request) => {
    const body = parseBody(ChatConversationSchema, request.body);
    const cloud = cloudStore.get();
    const conversation = chatRepo.createConversation({
      orgId: cloud?.orgId ?? null,
      localUserId: cloud?.userId ?? null,
      localAgentInstanceId: cloud?.agentInstanceId ?? localIdentity.agentId,
      peerUserId: body.peer_user_id ?? null,
      peerAgentInstanceId: body.peer_agent_instance_id ?? null,
      mode: body.mode ?? (body.peer_agent_instance_id ? "cloud_relay" : "local"),
      title: body.title
    });
    chatRepo.appendMessage({
      conversationId: conversation.id,
      senderAgentInstanceId: cloud?.agentInstanceId ?? localIdentity.agentId,
      messageType: "system_event",
      text: body.peer_agent_instance_id ? "Relay chat ready. File requests become A2A tasks." : "Local chat ready - connected to the local backend.",
      payload: { severity: "success" },
      deliveryStatus: "delivered"
    });
    const peer = await resolveRelayPeerInfo(conversation, cloud, deviceEnrollment);
    return { conversation: conversationToUi(conversation, chatRepo.getMessages(conversation.id), peer, cloud?.agentInstanceId ?? localIdentity.agentId) };
  });

  server.get("/chat/conversations", localOnly, async () => {
    const cloud = cloudStore.get();
    chatRepo.getOrCreateLocalConversation(cloud?.agentInstanceId ?? localIdentity.agentId);
    const conversations: ChatConversationRecord[] = [];
    for (const conversation of chatRepo.listConversations()) {
      conversations.push(await refreshRelayConversationPeer(conversation, cloud, peerRouting, "message.send"));
    }
    for (const conversation of conversations) {
      await refreshRelayDeliveryStatuses(chatRepo.getMessages(conversation.id), cloudStore, defaultProfileId());
    }
    const peerInfo = await resolveRelayPeerInfoMap(conversations, cloud, deviceEnrollment);
    return {
      conversations: conversations.map((conversation) =>
        conversationToUi(
          conversation,
          chatRepo.getMessages(conversation.id),
          peerInfo.get(conversation.id) ?? null,
          cloud?.agentInstanceId ?? localIdentity.agentId
        )
      )
    };
  });

  server.get("/chat/conversations/:id/messages", localOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = parseBody(ChatMessagesQuerySchema, request.query ?? {});
    const cloud = cloudStore.get();
    const conversation = id === "local-agent"
      ? chatRepo.getOrCreateLocalConversation(cloud?.agentInstanceId ?? localIdentity.agentId)
      : chatRepo.getConversation(id);
    if (!conversation) {
      return reply.status(404).send({ error: "CONVERSATION_NOT_FOUND", message: "Conversation not found" });
    }
    const localAgentInstanceId = conversation?.local_agent_instance_id ?? cloud?.agentInstanceId ?? localIdentity.agentId;
    const windowResult = query.around
      ? chatRepo.getMessagesAround(id, query.around, query.limit)
      : query.before
        ? chatRepo.getMessagesBefore(id, query.before, query.limit)
        : null;
    if ((query.around || query.before) && !windowResult) {
      return reply.status(404).send({ error: "MESSAGE_NOT_FOUND", message: "Message not found in this conversation" });
    }
    const sourceMessages = windowResult?.messages ?? chatRepo.getMessages(id);
    const refreshed = await refreshRelayDeliveryStatuses(sourceMessages, cloudStore, defaultProfileId());
    const allMessages = chatRepo.getMessages(id);
    const messages = refreshed.map((message) => messageToTimeline(message, localAgentInstanceId, allMessages));
    const peer = await resolveRelayPeerInfo(conversation, cloud, deviceEnrollment);
    return {
      conversationId: id,
      conversation: conversationToUi(conversation, allMessages, peer, localAgentInstanceId),
      messages,
      pageInfo: {
        hasMoreBefore: windowResult?.hasMoreBefore ?? false,
        hasMoreAfter: windowResult?.hasMoreAfter ?? false,
        oldestMessageId: refreshed[0]?.id,
        newestMessageId: refreshed.at(-1)?.id
      },
      readState: chatRepo.getReadState(id) ?? {
        conversationId: id,
        unreadCount: 0,
        mentionCount: 0
      }
    };
  });

  server.patch("/chat/conversations/:conversationId/messages/:messageId/pin", localOnly, async (request, reply) => {
    const { conversationId, messageId } = request.params as { conversationId: string; messageId: string };
    const { pinned } = parseBody(ChatPinSchema, request.body ?? {});
    const message = chatRepo.getMessage(messageId);
    if (!message || message.conversation_id !== conversationId) {
      return reply.status(404).send({ error: "MESSAGE_NOT_FOUND", message: "Message not found in this conversation" });
    }
    const updated = chatRepo.updateMessagePayload(messageId, { pinned });
    return { message: updated ? messageToTimeline(updated, cloudStore.get()?.agentInstanceId ?? localIdentity.agentId, chatRepo.getMessages(conversationId)) : null };
  });

  async function setChatMessageReaction(request: FastifyRequest, reply: FastifyReply, active: boolean) {
    const { conversationId, messageId, emoji } = parseBody(ChatReactionParamsSchema, request.params);
    const message = chatRepo.getMessage(messageId);
    if (!message || message.conversation_id !== conversationId) {
      return reply.status(404).send({ error: "MESSAGE_NOT_FOUND", message: "Message not found in this conversation" });
    }
    if (emoji.length > 16) {
      return reply.status(400).send({ error: "INVALID_REACTION", message: "Reaction emoji is too long" });
    }
    const cloud = cloudStore.get();
    const actorId = cloud?.userId ?? cloud?.agentInstanceId ?? localIdentity.agentId;
    const reactions: ChatMessageReaction[] | null = chatRepo.setMessageReaction(messageId, actorId, emoji, active);
    if (!reactions) {
      return reply.status(404).send({ error: "MESSAGE_NOT_FOUND", message: "Message not found in this conversation" });
    }
    const updated = chatRepo.updateMessagePayload(messageId, { reactions });
    return {
      reactions,
      message: updated ? messageToTimeline(updated, cloud?.agentInstanceId ?? localIdentity.agentId, chatRepo.getMessages(conversationId)) : null
    };
  }

  server.put("/chat/conversations/:conversationId/messages/:messageId/reactions/:emoji", localOnly, async (request, reply) => {
    return setChatMessageReaction(request, reply, true);
  });

  server.delete("/chat/conversations/:conversationId/messages/:messageId/reactions/:emoji", localOnly, async (request, reply) => {
    return setChatMessageReaction(request, reply, false);
  });

  server.get("/chat/conversations/:conversationId/threads/:threadId", localOnly, async (request, reply) => {
    const { conversationId, threadId } = request.params as { conversationId: string; threadId: string };
    const messages = chatRepo.getMessages(conversationId);
    const parent = messages.find((message) => message.id === threadId);
    if (!parent) return reply.status(404).send({ error: "THREAD_NOT_FOUND", message: "Thread not found in this conversation" });
    const localAgentInstanceId = chatRepo.getConversation(conversationId)?.local_agent_instance_id ?? cloudStore.get()?.agentInstanceId ?? localIdentity.agentId;
    const replies = threadReplies(messages, threadId).map((message) => messageToTimeline(message, localAgentInstanceId, messages));
    return {
      threadId,
      parent: messageToTimeline(parent, localAgentInstanceId, messages),
      replies
    };
  });

  server.post("/chat/conversations/:conversationId/threads/:threadId/replies", localOnly, async (request, reply) => {
    const { conversationId, threadId } = request.params as { conversationId: string; threadId: string };
    const { text } = parseBody(ThreadReplySchema, request.body ?? {});
    const conversation = chatRepo.getConversation(conversationId);
    if (!conversation) return reply.status(404).send({ error: "Conversation not found" });
    const messages = chatRepo.getMessages(conversationId);
    const parent = messages.find((message) => message.id === threadId);
    if (!parent) return reply.status(404).send({ error: "THREAD_NOT_FOUND", message: "Thread not found in this conversation" });
    const cloud = cloudStore.get();
    const replyMessage = chatRepo.appendMessage({
      conversationId,
      senderUserId: cloud?.userId ?? null,
      senderAgentInstanceId: cloud?.agentInstanceId ?? localIdentity.agentId,
      receiverAgentInstanceId: conversation.peer_agent_instance_id,
      messageType: "human",
      text,
      payload: {
        reply_to_id: parent.id,
        thread_id: threadId,
        sender_label: cloud?.displayName ?? cloud?.userEmail ?? "You"
      },
      deliveryStatus: "delivered"
    });
    const allMessages = chatRepo.getMessages(conversationId);
    return { message: messageToTimeline(replyMessage, cloud?.agentInstanceId ?? localIdentity.agentId, allMessages) };
  });

  server.post("/chat/conversations/:id/read-state", localOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = parseBody(ChatReadStateSchema, request.body);
    const conversation = chatRepo.getConversation(id);
    if (!conversation) return reply.status(404).send({ error: "Conversation not found" });

    const marker = chatRepo.getMessage(body.lastReadMessageId);
    if (!marker) return reply.status(404).send({ error: "Message not found" });
    if (marker.conversation_id !== id) {
      return reply.status(400).send({ error: "Message does not belong to conversation" });
    }

    const readState = chatRepo.updateReadState(id, body.lastReadMessageId);
    if (!readState) return reply.status(500).send({ error: "Failed to update read state" });
    return { readState };
  });

  server.get("/chat/diagnostics", localOnly, async (request) => {
    const runs = agentRuns.listRuns();
    return {
      backend: "ok",
      localUiSession: {
        enabled: true,
        runtime: LOCAL_UI_RUNTIME_VERSION,
        cookieName: LOCAL_UI_SESSION_COOKIE,
        valid: hasValidLocalUiSession(request)
      },
      agentRuns: {
        active: runs.filter((run) => run.status === "running").length,
        total: runs.length
      },
      oci: {
        configured: Boolean(process.env.OCI_GENAI_MODEL_ID && process.env.OCI_GENAI_SERVICE_ENDPOINT && process.env.OCI_GENAI_COMPARTMENT_ID)
      },
      fileSearch: {
        roots: fileSearch.getRoots(),
        rootCount: fileSearch.getRoots().length
      }
    };
  });

  server.post("/chat/conversations/:id/messages", localOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = parseBody(ChatConversationSendSchema, request.body);
    const cloud = cloudStore.get();
    let conversation = chatRepo.getConversation(id);
    if (!conversation) return reply.status(404).send({ error: "Conversation not found" });
    conversation = await refreshRelayConversationPeer(conversation, cloud, peerRouting, body.send_as === "file_request" ? "file.request" : "message.send");
    const messageId = body.client_message_id ?? `msg_${randomUUID()}`;
    const detectedIntent = intentExtractor.extract(body.text);
    const isFileRequest = body.send_as === "file_request" || detectedIntent.intent === "file_request";
    const a2aTaskId = isFileRequest ? `task_${randomUUID()}` : null;
    chatRepo.appendMessage({
      id: messageId,
      conversationId: id,
      taskId: a2aTaskId,
      senderUserId: cloud?.userId ?? null,
      senderAgentInstanceId: cloud?.agentInstanceId ?? localIdentity.agentId,
      receiverAgentInstanceId: conversation.peer_agent_instance_id,
      messageType: isFileRequest ? "file_request" : "human",
      text: body.text,
      payload: isFileRequest ? {
        requester: cloud?.displayName ?? cloud?.userEmail ?? "You",
        target: conversation.title,
        natural_language_request: body.text,
        query: body.text,
        status: "submitted"
      } : {},
      deliveryStatus: "local_pending"
    });

    if (conversation.mode === "cloud_relay" && conversation.peer_agent_instance_id) {
      if (!cloud?.deviceAccessToken) {
        chatRepo.markMessageStatus(messageId, "failed", "Device is not enrolled.");
        chatRepo.queueOutbox(messageId, id, { text: body.text, send_as: body.send_as }, "Device is not enrolled.");
        return reply.status(409).send({ error: "Device is not enrolled.", conversation_id: id, message_id: messageId });
      }
      try {
        let senderAgentInstanceId = cloud.agentInstanceId;
        const relay = await withRecoveredDeviceToken(cloudStore, defaultProfileId(), async (fresh) => {
          senderAgentInstanceId = fresh.agentInstanceId;
          return new RelayClient(new ControlPlaneClient(fresh.controlPlaneUrl)).send({
            to_agent_instance_id: conversation.peer_agent_instance_id!,
            a2a_task_id: a2aTaskId ?? randomUUID(),
            type: isFileRequest ? "file.request" : "message.send",
            payload: isFileRequest
              ? { kind: "file_request", text: body.text, requestText: body.text }
              : { kind: "message", text: body.text },
            idempotency_key: body.idempotency_key ?? `ui-${messageId}`
          }, fresh.deviceAccessToken!);
        });
        chatRepo.updateMessageDeliveryStatus(messageId, "queued_at_relay", null, {
          relay_task_id: relay.relay_task_id,
          relay_status: relay.status,
          relay_accepted_at: relay.accepted_at,
          to_agent_instance_id: conversation.peer_agent_instance_id,
          peer_user_id: conversation.peer_user_id
        });
        if (isFileRequest) {
          chatRepo.appendMessage({
            conversationId: id,
            taskId: a2aTaskId,
            senderAgentInstanceId,
            receiverAgentInstanceId: conversation.peer_agent_instance_id,
            messageType: "agent_status",
            text: "Waiting for remote approval",
            payload: { relay_task_id: relay.relay_task_id, phase: "input_required" },
            deliveryStatus: "queued_at_relay"
          });
        }
        return {
          ok: true,
          conversation_id: id,
          message_id: messageId,
          relay_task_id: relay.relay_task_id,
          task_id: a2aTaskId ?? undefined,
          type: isFileRequest ? "file_request" : "message",
          delivery_status: "queued_at_relay"
        };
      } catch (err) {
        const relayError = normalizeRelaySendError(err);
        chatRepo.markMessageStatus(messageId, "failed", relayError.message);
        chatRepo.queueOutbox(messageId, id, { text: body.text, send_as: body.send_as }, relayError.message);
        return reply.status(relayError.statusCode).send({
          error: relayError.code,
          message: relayError.message,
          conversation_id: id,
          message_id: messageId,
          relay_unavailable: true
        });
      }
    }

    if (!isFileRequest) {
      if (isFastLocalChat(body.text)) {
        const answer = localChatAnswer(body.text);
        chatRepo.markMessageStatus(messageId, "delivered");
        chatRepo.appendMessage({
          conversationId: id,
          senderAgentInstanceId: localIdentity.agentId,
          messageType: "agent_status",
          text: answer,
          payload: { phase: "completed", mode: "direct_chat" },
          deliveryStatus: "delivered"
        });
        return { ok: true, conversation_id: id, message_id: messageId, type: "message", delivery_status: "delivered" };
      }

      chatRepo.markMessageStatus(messageId, "sent");
      const run = agentRuns.createRun({ query: body.text, createSandboxSession: false });
      chatRepo.appendMessage({
        id: `run_${run.runId}_working`,
        conversationId: id,
        taskId: run.runId,
        senderAgentInstanceId: localIdentity.agentId,
        messageType: "agent_status",
        text: "Agent is working on your request.",
        payload: { phase: "thinking", run_id: run.runId, status: run.status },
        deliveryStatus: "sent"
      });
      attachRunToConversation(run.runId, id);
      persistAgentRunSnapshot(id, run, localIdentity.agentId);
      return {
        ok: true,
        conversation_id: id,
        message_id: messageId,
        run_id: run.runId,
        type: "message",
        delivery_status: "sent"
      };
    }

    const local = await localFileRequestFlow(body.text, id, messageId);
    return {
      ok: true,
      conversation_id: id,
      message_id: messageId,
      task_id: local.taskId,
      run_id: local.runId,
      approval_id: local.approvalId,
      type: local.type,
      delivery_status: local.type === "approval_required" ? "delivered" : "failed"
    };
  });

  server.post("/files/index-roots", localOnly, async (request) => {
    const { roots } = parseBody(FileIndexSchema, request.body ?? {});
    const results: Array<{ root: string; indexed: number }> = [];
    for (const root of roots ?? []) {
      const allowedRoot = assertAllowedIndexRoot(root, fileSearch.getRoots());
      const count = await indexRoot(allowedRoot);
      results.push({ root: allowedRoot, indexed: count });
    }
    return { ok: true, roots: results };
  });

  server.get("/files/index-roots", localOnly, async () => ({ roots: fileSearch.getRoots() }));

  server.post("/files/reindex", localOnly, async (request) => {
    const { roots } = parseBody(FileIndexSchema, request.body ?? {});
    const results: Array<{ root: string; indexed: number }> = [];
    for (const root of roots ?? []) {
      const allowedRoot = assertAllowedIndexRoot(root, fileSearch.getRoots());
      const count = await reindexAll(allowedRoot);
      results.push({ root: allowedRoot, indexed: count });
    }
    return { ok: true, message: "Incremental reindex completed.", roots: results };
  });

  // Vault folder management endpoints
  server.get("/files/roots", localOnly, async () => {
    const db = getDb();
    const roots = db.prepare(`
      SELECT id, root_path, display_name, enabled, last_indexed_at, file_count, created_at, updated_at
      FROM file_index_roots
      ORDER BY created_at DESC
    `).all() as Array<Record<string, unknown>>;
    return { roots: roots.map((r) => ({
      id: Number(r.id),
      rootPath: r.root_path as string,
      displayName: r.display_name as string,
      enabled: Boolean(r.enabled),
      lastIndexedAt: r.last_indexed_at as string | null,
      fileCount: Number(r.file_count),
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string
    }))};
  });

  server.post("/files/roots", localOnly, async (request, reply) => {
    const schema = z.object({
      rootPath: z.string().trim().min(1),
      displayName: z.string().trim().min(1).optional()
    });
    const body = parseBody(schema, request.body ?? {});
    const allowedRoot = assertAllowedIndexRoot(body.rootPath, fileSearch.getRoots());
    const db = getDb();
    const now = new Date().toISOString();
    const displayName = body.displayName || allowedRoot.split(/[\\/]/).pop() || allowedRoot;
    
    try {
      const result = db.prepare(`
        INSERT INTO file_index_roots (root_path, display_name, enabled, file_count, created_at, updated_at)
        VALUES (?, ?, 1, 0, ?, ?)
      `).run(allowedRoot, displayName, now, now);
      
      const root = db.prepare("SELECT * FROM file_index_roots WHERE id = ?").get(result.lastInsertRowid) as Record<string, unknown>;
      return {
        ok: true,
        root: {
          id: Number(root.id),
          rootPath: root.root_path as string,
          displayName: root.display_name as string,
          enabled: Boolean(root.enabled),
          lastIndexedAt: root.last_indexed_at as string | null,
          fileCount: Number(root.file_count),
          createdAt: root.created_at as string,
          updatedAt: root.updated_at as string
        }
      };
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
        return reply.status(409).send({ error: "Root path already exists" });
      }
      throw error;
    }
  });

  server.delete("/files/roots/:id", localOnly, async (request, reply) => {
    const schema = z.object({ id: z.string().transform(Number) });
    const { id } = parseBody(schema, request.params);
    const db = getDb();
    
    // Delete all files for this root first
    const root = db.prepare("SELECT root_path FROM file_index_roots WHERE id = ?").get(id) as { root_path: string } | undefined;
    if (!root) {
      return reply.status(404).send({ error: "Root not found" });
    }
    
    // Delete files from file_index (cascade will handle FTS and embeddings)
    db.prepare("DELETE FROM file_index WHERE root_id = ?").run(root.root_path);
    
    // Delete the root
    db.prepare("DELETE FROM file_index_roots WHERE id = ?").run(id);
    db.prepare("DELETE FROM file_index_excludes WHERE root_path = ?").run(root.root_path);
    
    return { ok: true };
  });

  server.get("/files/excludes", localOnly, async (request) => {
    const schema = z.object({ rootPath: z.string().optional() });
    const { rootPath } = parseBody(schema, request.query ?? {});
    const db = getDb();
    
    let query = "SELECT * FROM file_index_excludes";
    const params: string[] = [];
    if (rootPath) {
      query += " WHERE root_path = ?";
      params.push(rootPath);
    }
    query += " ORDER BY created_at DESC";
    
    const excludes = db.prepare(query).all(...params) as Array<Record<string, unknown>>;
    return { excludes: excludes.map((e) => ({
      id: Number(e.id),
      rootPath: e.root_path as string,
      excludePath: e.exclude_path as string,
      excludeType: e.exclude_type as string,
      createdAt: e.created_at as string
    }))};
  });

  server.post("/files/excludes", localOnly, async (request) => {
    const schema = z.object({
      rootPath: z.string().trim().min(1),
      excludePath: z.string().trim().min(1),
      excludeType: z.enum(["folder", "pattern"]).default("folder")
    });
    const body = parseBody(schema, request.body ?? {});
    assertAllowedIndexRoot(body.rootPath, fileSearch.getRoots());
    const db = getDb();
    const now = new Date().toISOString();
    
    const result = db.prepare(`
      INSERT INTO file_index_excludes (root_path, exclude_path, exclude_type, created_at)
      VALUES (?, ?, ?, ?)
    `).run(body.rootPath, body.excludePath, body.excludeType, now);
    
    const exclude = db.prepare("SELECT * FROM file_index_excludes WHERE id = ?").get(result.lastInsertRowid) as Record<string, unknown>;
    return {
      ok: true,
      exclude: {
        id: Number(exclude.id),
        rootPath: exclude.root_path as string,
        excludePath: exclude.exclude_path as string,
        excludeType: exclude.exclude_type as string,
        createdAt: exclude.created_at as string
      }
    };
  });

  server.delete("/files/excludes/:id", localOnly, async (request, reply) => {
    const schema = z.object({ id: z.string().transform(Number) });
    const { id } = parseBody(schema, request.params);
    const db = getDb();
    
    const result = db.prepare("DELETE FROM file_index_excludes WHERE id = ?").run(id);
    if (result.changes === 0) {
      return reply.status(404).send({ error: "Exclude rule not found" });
    }
    
    return { ok: true };
  });

  server.post("/files/search", localOnly, async (request) => {
    const { query } = parseBody(FileSearchSchema, request.body);
    const queryRewriter = createQueryRewriter();
    const rewritten = queryRewriter.rewrite(query);
    const searchQuery = rewritten.semanticQuery || query;
    const extensions = rewritten.extensions.length > 0 ? { extensions: rewritten.extensions } : undefined;
    const results = hybridSearch(searchQuery, { ...extensions, limit: 20 });
    return results;
  });

  server.get("/files/indexed", localOnly, async (request) => {
    const q = (request.query ?? {}) as { limit?: string; offset?: string; query?: string; extension?: string };
    const limit = Math.max(1, Math.min(500, Number(q.limit ?? 100)));
    const offset = Math.max(0, Number(q.offset ?? 0));
    const query = String(q.query ?? "").trim().toLowerCase();
    const extension = String(q.extension ?? "").trim().toLowerCase().replace(/^\./, "");
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (query) {
      where.push("(LOWER(file_name) LIKE ? OR LOWER(display_path) LIKE ?)");
      params.push(`%${query}%`, `%${query}%`);
    }
    if (extension) {
      where.push("extension = ?");
      params.push(`.${extension}`);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, file_path, display_path, file_name, extension, size_bytes, modified_at
      FROM file_index
      ${whereSql}
      ORDER BY modified_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as Array<Record<string, unknown>>;
    const total = (db.prepare(`SELECT COUNT(*) as n FROM file_index ${whereSql}`).get(...params) as { n: number }).n;
    const items = rows.map((r) => ({
      id: Number(r.id),
      displayPath: r.display_path as string,
      fileName: r.file_name as string,
      extension: r.extension as string,
      sizeBytes: Number(r.size_bytes),
      modifiedAt: r.modified_at as string,
      score: 0,
      reason: "manual-pick",
    }));
    return { items, total, limit, offset };
  });

  server.get("/files/search/debug", localOnly, async (request) => {
    const q = (request.query ?? {}) as { query?: string; limit?: string };
    const query = String(q.query ?? "").trim();
    if (!query) return { error: "query is required" };
    const limit = Math.max(1, Math.min(20, Number(q.limit ?? 10)));
    const parsed = parseFileRequest(query);
    const indexed = searchFileRequestIndex(parsed, { limit });
    const resolved = await resolveFileRequestCandidates(query, fileSearch, { limit });
    const db = getDb();
    const indexedCount = (db.prepare("SELECT COUNT(*) as n FROM file_index").get() as { n: number }).n;
    return {
      query,
      parsed,
      indexedCount,
      searchedRoots: resolved.searchedRoots,
      filenameCandidates: indexed.map((candidate) => ({
        candidate_id: String(candidate.id),
        file_name: candidate.fileName,
        display_path: `Local file / ${candidate.fileName}`,
        extension: candidate.extension,
        size_bytes: candidate.sizeBytes,
        modified_at: candidate.modifiedAt,
        match_score: candidate.score,
        match_reason: candidate.reason
      })),
      finalCandidates: resolved.candidates.map(toApprovalCandidatePayload),
      source: resolved.source
    };
  });

  server.get("/approvals/pending", { preHandler: requireLocalApiToken }, async () => ({
    approvals: protocol.listApprovals()
      .filter((item) => item.status === "pending")
      .map(approvalToSafeResponse)
  }));

  server.get("/approvals/:id", { preHandler: requireLocalApiToken }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const approval = protocol.getApproval(id);
    if (!approval) return reply.status(404).send({ error: "Approval not found" });
    return approvalToSafeResponse(approval);
  });

  server.post("/approvals/:id/approve", { preHandler: requireLocalApiToken }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { idempotency_key?: string };
    const current = protocol.getApproval(id);
    if (!current) return reply.status(404).send({ error: "Approval not found" });
    if (isUnboundFileTransferApproval(current)) {
      return reply.status(409).send({
        error: "APPROVAL_HAS_NO_BOUND_FILE",
        message: "This approval has no selected local file. Refine the search and select a candidate before approving.",
        approval: approvalToSafeResponse(current)
      });
    }
    const policy = adminPolicy.evaluate({
      role: "user",
      sensitivity: "unknown",
      fileExtension: current.boundFilePath ? extname(current.boundFilePath) : "none",
      mimeType: "application/octet-stream",
      transferDirection: "outbound",
      fileSizeBytes: current.boundSizeBytes ?? 0
    });
    if (policy.action === "deny") {
      notificationEvents.record({
        eventType: "policy_denied",
        title: "Transfer blocked by policy",
        body: policy.reason,
        severity: "error",
        entityType: "approval",
        entityId: id,
        metadata: { matchedRuleId: policy.matchedRuleId }
      });
      appendAuditEvent({
        actorAgentId: protocol.createLocalIdentity().agentId,
        taskId: current.taskId,
        approvalId: current.id,
        eventType: "policy_denied_transfer",
        detailsJson: { policy }
      });
      return reply.status(403).send({ error: "POLICY_DENIED", policy, approval: approvalToSafeResponse(current) });
    }
    const decision = protocol.applyApprovalDecisionWithResult(id, "approve", { idempotencyKey: body.idempotency_key });
    if (!decision.approval) return reply.status(404).send({ error: "Approval not found" });
    if (decision.outcome === "denied") return reply.status(409).send({ error: decision.error, approval: approvalToSafeResponse(decision.approval) });
    const cloudTransfer = await approvalTransfers.scheduleForApproval(decision.approval);
    notificationEvents.record({
      eventType: "approval_approved",
      title: "Approval granted",
      body: "A file request was approved and transfer preparation has started.",
      severity: "success",
      entityType: "approval",
      entityId: decision.approval.id,
      delivered: true,
      metadata: { taskId: decision.approval.taskId, policy }
    });
    if (decision.outcome === "applied") {
      appendApprovalDecisionTimeline(chatRepo, decision.approval.taskId, "approved", {
        approvalId: decision.approval.id,
        fileName: decision.approval.boundFilePath ? decision.approval.boundFilePath.split(/[\\/]/).pop() : "Selected file",
        sha256: decision.approval.boundSha256,
        sizeBytes: decision.approval.boundSizeBytes,
        transferId: cloudTransfer.transferId ?? undefined
      });
    }
    return { ...approvalToSafeResponse(decision.approval), cloudTransfer };
  });

  server.post("/approvals/:id/rebind-file", { preHandler: requireLocalApiToken }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { fileId?: number | string; filePath?: string };
    if (body.fileId == null && !body.filePath) {
      return reply.status(400).send({ error: "fileId or filePath is required" });
    }
    const approval = protocol.getApproval(id);
    if (!approval) return reply.status(404).send({ error: "Approval not found" });
    if (approval.status !== "pending") {
      return reply.status(409).send({ error: `Cannot rebind a ${approval.status} approval` });
    }
    const db = getDb();
    let row: { file_path: string; size_bytes: number; file_name: string; id: number } | undefined;
    if (body.fileId != null) {
      row = db.prepare("SELECT id, file_path, size_bytes, file_name FROM file_index WHERE id = ?").get(Number(body.fileId)) as typeof row;
    } else if (body.filePath) {
      row = db.prepare("SELECT id, file_path, size_bytes, file_name FROM file_index WHERE file_path = ?").get(body.filePath) as typeof row;
    }
    if (!row) return reply.status(404).send({ error: "File not found in index" });

    // Recompute SHA-256 from the manually picked file
    const { createHash } = await import("node:crypto");
    const { createReadStream } = await import("node:fs");
    const hash = createHash("sha256");
    await new Promise<void>((resolve, reject) => {
      const s = createReadStream(row!.file_path);
      s.on("data", (c) => hash.update(c));
      s.on("end", () => resolve());
      s.on("error", reject);
    });

    db.prepare(`
      UPDATE approval_requests
      SET approval_type = 'file.transfer.offer',
          selected_file_id = ?,
          bound_file_path = ?,
          bound_size_bytes = ?,
          bound_sha256 = ?
      WHERE id = ?
    `).run(String(row.id), row.file_path, row.size_bytes, hash.digest("hex"), id);
    const rebound = protocol.getApproval(id);
    return rebound ? approvalToSafeResponse(rebound) : null;
  });

  server.post("/approvals/:id/reject", { preHandler: requireLocalApiToken }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { idempotency_key?: string };
    const decision = protocol.applyApprovalDecisionWithResult(id, "reject", { idempotencyKey: body.idempotency_key });
    if (!decision.approval) return reply.status(404).send({ error: "Approval not found" });
    if (decision.outcome === "denied") return reply.status(409).send({ error: decision.error, approval: approvalToSafeResponse(decision.approval) });
    notificationEvents.record({
      eventType: "approval_rejected",
      title: "Approval rejected",
      body: "A file request was rejected.",
      severity: "warning",
      entityType: "approval",
      entityId: decision.approval.id,
      delivered: true,
      metadata: { taskId: decision.approval.taskId }
    });
    if (decision.outcome === "applied") {
      appendApprovalDecisionTimeline(chatRepo, decision.approval.taskId, "rejected", { approvalId: decision.approval.id });
    }
    return approvalToSafeResponse(decision.approval);
  });

  server.post("/approvals/:id/feedback", { preHandler: requireLocalApiToken }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { feedback?: string; rejectedFileIds?: number[]; originalQuery?: string };
    const decision = protocol.applyApprovalDecisionWithResult(id, "feedback", {
      feedback: body.feedback,
      idempotencyKey: `${id}|feedback|${body.feedback ?? ""}`
    });
    const approval = decision.approval;
    if (!approval) return reply.status(404).send({ error: "Approval not found" });
    if (decision.outcome === "denied") return reply.status(409).send({ error: decision.error, approval: approvalToSafeResponse(approval) });
    if (decision.outcome === "replay") return { approval: approvalToSafeResponse(approval), newApproval: null, candidates: [] };
    notificationEvents.record({
      eventType: "approval_feedback",
      title: "Approval feedback sent",
      body: "File search feedback was submitted for refinement.",
      severity: "info",
      entityType: "approval",
      entityId: approval.id,
      delivered: true,
      metadata: { taskId: approval.taskId }
    });
    appendApprovalDecisionTimeline(chatRepo, approval.taskId, "feedback", { approvalId: approval.id, feedback: body.feedback });

    // Re-run search with feedback: refine the query and exclude the previously rejected file IDs.
    const originalQuery = body.originalQuery ?? (approval.taskId ? (wfGetTask(approval.taskId)?.metadataJson?.query as string | undefined) ?? "" : "");
    const rejectedIds = body.rejectedFileIds ?? (approval.selectedFileId ? [Number(approval.selectedFileId)] : []);
    const refined = refineSearch(originalQuery, body.feedback ?? "", rejectedIds);

    // Transition to SEARCH_REFINED
    try { wfTransition(approval.taskId, "SEARCH_REFINED", { refinedQuery: refined.newQuery, rejected: rejectedIds }); } catch { /* already */ }

    const resolved = await resolveFileRequestCandidates(refined.newQuery, fileSearch, {
      searchOptions: refined.searchOptions,
      limit: 10
    });
    const newCandidates = resolved.candidates;

    // Create a new approval for the new top candidate
    const top = newCandidates[0];
    const newApproval = await protocol.createApproval(approval.taskId, {
      approvalType: top ? "file.transfer.offer" : "file.search.refinement",
      requesterAgentId: approval.requesterAgentId,
      ownerAgentId: approval.ownerAgentId,
      selectedFileId: top?.id ?? null,
      boundFilePath: top?.boundFilePath ?? null,
      boundSha256: top?.boundSha256 ?? null,
      boundSizeBytes: top?.boundSizeBytes ?? null,
    });
    try { wfTransition(approval.taskId, "APPROVAL_REQUIRED", { approvalId: newApproval.id, candidateCount: newCandidates.length, refined: true }); } catch { /* ignore */ }
    const safeCandidates = newCandidates.map(toApprovalCandidatePayload);
    appendRefinedApprovalTimeline(chatRepo, approval.taskId, newApproval.id, body.feedback ?? "", safeCandidates);

    return {
      ok: true,
      previousApproval: approvalToSafeResponse(approval),
      refinedSearch: { ...refined, resolvedSource: resolved.source },
      candidates: safeCandidates,
      newApproval: approvalToSafeResponse(newApproval),
    };
  });

  server.post("/approvals/notification-callback", async (request, reply) => {
    const parsedCallback = ApprovalCallbackSchema.safeParse(request.body ?? {});
    if (!parsedCallback.success) {
      return reply.code(400).send({ ok: false, status: "invalid", error: "INVALID_CALLBACK" });
    }
    const body = parsedCallback.data;
    const action = body.action;
    if (!verifyApprovalCallbackSignature({
      approvalId: body.approvalId,
      taskId: body.taskId,
      action,
      nonce: body.nonce,
      signature: body.signature,
      secret: approvalCallbackSecret
    })) {
      return { ok: false, status: "invalid", error: "Invalid approval callback signature" };
    }
    const current = protocol.getApproval(body.approvalId);
    if (!current) {
      const receiverOrchestrator = new ReceiverAgentOrchestrator(getDb());
      const receiverApproval = receiverOrchestrator.getApproval(body.approvalId);
      if (receiverApproval) {
        if (action === "approve") {
          let selectedPath = body.candidateId
            ? (() => {
                const candidates = JSON.parse(receiverApproval.candidatesJson) as Array<Record<string, unknown>>;
                const match = candidates.find((c) => c.candidate_id === body.candidateId || c.candidateId === body.candidateId);
                return typeof match?.path === "string" ? match.path : null;
              })()
            : null;
          if (!selectedPath) {
            const candidates = JSON.parse(receiverApproval.candidatesJson) as Array<Record<string, unknown>>;
            if (candidates[0] && typeof candidates[0].path === "string") {
              selectedPath = candidates[0].path;
            }
          }
          if (!selectedPath) {
            return { ok: false, approvalId: receiverApproval.id, taskId: receiverApproval.a2aTaskId, error: "NO_FILE_PATH_SELECTED" };
          }
          receiverOrchestrator.approveTransfer(receiverApproval.id, selectedPath);
          setImmediate(async () => {
            try {
              const approval = receiverOrchestrator.getApproval(receiverApproval.id);
              if (approval) {
                await approvalTransfers.transferReceiverApproval(approval);
                receiverOrchestrator.markTransferred(receiverApproval.id);
              }
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              console.error(`[ReceiverApproval] Callback transfer failed:`, message);
              receiverOrchestrator.markFailed(receiverApproval.id, message);
            }
          });
          return {
            ok: true,
            approvalId: receiverApproval.id,
            taskId: receiverApproval.a2aTaskId,
            status: "approved"
          };
        } else if (action === "reject") {
          receiverOrchestrator.rejectTransfer(receiverApproval.id, body.feedback || "Rejected by receiver");
          return {
            ok: true,
            approvalId: receiverApproval.id,
            taskId: receiverApproval.a2aTaskId,
            status: "rejected"
          };
        }
      }
      return { ok: false, status: "not-found" };
    }
    if (current.taskId !== body.taskId) {
      return { ok: false, status: "task-mismatch" };
    }
    if (action === "approve" && isUnboundFileTransferApproval(current)) {
      return {
        ok: false,
        approvalId: current.id,
        taskId: current.taskId,
        status: current.status,
        replay: false,
        error: "APPROVAL_HAS_NO_BOUND_FILE"
      };
    }
    const decision = protocol.applyApprovalDecisionWithResult(body.approvalId, action, {
      feedback: body.feedback,
      idempotencyKey: body.idempotency_key ?? body.idempotencyKey ?? `${current.id}|${current.taskId}|${action}`
    });
    const cloudTransfer = action === "approve" && decision.approval
      ? await approvalTransfers.scheduleForApproval(decision.approval)
      : null;
    if (decision.outcome === "denied") {
      return {
        ok: false,
        approvalId: current.id,
        taskId: current.taskId,
        status: decision.approval?.status ?? current.status,
        replay: false,
        error: decision.error
      };
    }
    return {
      ok: true,
      approvalId: current.id,
      taskId: current.taskId,
      status: decision.approval?.status ?? "unknown",
      replay: decision.replay,
      cloudTransfer,
    };
  });

  server.get("/transfers", localOnly, async () => {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM transfers ORDER BY created_at DESC").all() as Array<Record<string, unknown>>;
    return { transfers: rows };
  });

  server.get("/storage/files", localOnly, async () => {
    const files = listStoredFiles();
    return { files };
  });

  server.get("/storage/files/:id/open", localOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const stored = getStoredFile(id);
    if (!stored) return reply.status(404).send({ error: "File not found" });
    if (!existsSync(stored.storedPath)) return reply.status(404).send({ error: "File not found on disk" });
    const stream = createReadStream(stored.storedPath);
    return reply.type("application/octet-stream").header("Content-Disposition", `inline; filename="${stored.originalFileName}"`).send(stream);
  });

  server.get("/storage/files/:id/verify", localOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const stored = getStoredFile(id);
    if (!stored) return reply.status(404).send({ error: "File not found" });
    if (!existsSync(stored.storedPath)) return reply.status(404).send({ error: "File not found on disk" });
    const hash = createHash("sha256");
    let sizeBytes = 0;
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(stored.storedPath);
      stream.on("data", (chunk: Buffer | string) => {
        hash.update(chunk);
        sizeBytes += Buffer.byteLength(chunk);
      });
      stream.on("end", resolve);
      stream.on("error", reject);
    });
    const actualSha256 = hash.digest("hex");
    return {
      id,
      sha256: actualSha256,
      expected_sha256: stored.sha256,
      hash_verified: actualSha256 === stored.sha256,
      size_bytes: sizeBytes
    };
  });

  server.get("/storage/files/:id/download", localOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const stored = getStoredFile(id);
    if (!stored) return reply.status(404).send({ error: "File not found" });
    if (!existsSync(stored.storedPath)) return reply.status(404).send({ error: "File not found on disk" });
    const stream = createReadStream(stored.storedPath);
    return reply.type("application/octet-stream").header("Content-Disposition", `attachment; filename="${stored.originalFileName}"`).send(stream);
  });

  server.get("/audit/events", localOnly, async () => {
    const events = getEvents(100);
    const chainValid = verifyChain();
    return { events, chainValid };
  });

  server.get("/audit/verify", async () => {
    return verifyChain();
  });

  server.get("/anp/identity", localOnly, async () => ({ identity: protocol.createLocalIdentity(), sessions: protocol.listPeerSessions() }));

  // ===== ANP v1.0 with DID:WBA + ECDHE =====
  const anpCtx = {
    identity: protocol.createLocalIdentity(),
    port: process.env.SANDBOX_PORT ?? 3399,
  };
  // Cache in-flight handshake contexts (sessionId -> initiator context)
  const anpHandshakeCache = new Map<string, { ecdhePrivate: Buffer; sourceRandom: string; sourcePublicKeyHex: string; sourceDid: string; destinationDid: string; expiresAt: number }>();

  server.get("/.well-known/did.json", async (_request, reply) => {
    const { buildDidWba } = await import("./security/anp/DidWba.js");
    const hostname = process.env.ANP_HOSTNAME ?? "127.0.0.1";
    const port = anpCtx.port;
    const did = buildDidWba({ domain: hostname, port: Number(port), publicKeyHex: anpCtx.identity.publicKey });
    return reply.send(did.didDocument);
  });

  server.post("/anp/handshake/source-hello", async (request, reply) => {
    const body = (request.body ?? {}) as { destinationDid: string; supportedCapabilities?: string[]; candidateProtocols?: string[] };
    if (!body.destinationDid) return reply.status(400).send({ error: "destinationDid required" });
    const { initiateHandshake } = await import("./security/anp/AnpProtocol.js");
    const hostname = process.env.ANP_HOSTNAME ?? "127.0.0.1";
    const { did } = (await import("./security/anp/DidWba.js")).buildDidWba({ domain: hostname, port: Number(anpCtx.port), publicKeyHex: anpCtx.identity.publicKey });
    const { message, context } = initiateHandshake({
      identity: anpCtx.identity,
      sourceDid: did,
      destinationDid: body.destinationDid,
      supportedCapabilities: body.supportedCapabilities,
      candidateProtocols: body.candidateProtocols,
    });
    anpHandshakeCache.set(context.sessionId, {
      ecdhePrivate: context.ecdhe.privateKey,
      sourceRandom: context.sourceRandom,
      sourcePublicKeyHex: anpCtx.identity.publicKey,
      sourceDid: did,
      destinationDid: body.destinationDid,
      expiresAt: context.expiresAt,
    });
    return reply.send({ message, sessionId: context.sessionId });
  });

  server.post("/anp/handshake/destination-hello", async (request, reply) => {
    const body = (request.body ?? {}) as { sourceHello: import("./security/anp/AnpProtocol.js").SourceHello };
    if (!body.sourceHello) return reply.status(400).send({ error: "sourceHello required" });
    const { respondToHandshake } = await import("./security/anp/AnpProtocol.js");
    const hostname = process.env.ANP_HOSTNAME ?? "127.0.0.1";
    const { did } = (await import("./security/anp/DidWba.js")).buildDidWba({ domain: hostname, port: Number(anpCtx.port), publicKeyHex: anpCtx.identity.publicKey });
    const { message, context } = respondToHandshake({
      identity: anpCtx.identity,
      sourceDid: body.sourceHello.sourceDid,
      destinationDid: did,
      sourceHello: body.sourceHello,
    });
    // Cache for the destination so it can verify Finished later
    anpHandshakeCache.set(context.sessionId, {
      ecdhePrivate: context.ecdhe.privateKey,
      sourceRandom: context.sourceRandom ?? "",
      sourcePublicKeyHex: body.sourceHello.sourcePublicKeyHex,
      sourceDid: body.sourceHello.sourceDid,
      destinationDid: did,
      expiresAt: context.expiresAt,
    });
    return reply.send({ message, sessionId: context.sessionId });
  });

  server.post("/anp/handshake/finished", async (request, reply) => {
    const body = (request.body ?? {}) as { sessionId: string; finished: import("./security/anp/AnpProtocol.js").FinishedMessage };
    if (!body.sessionId || !body.finished) return reply.status(400).send({ error: "sessionId and finished required" });
    const cached = anpHandshakeCache.get(body.sessionId);
    if (!cached) return reply.status(404).send({ error: "No handshake context for sessionId" });
    const { verifyFinishedAsResponder } = await import("./security/anp/AnpProtocol.js");
    if (!cached.sourceRandom) return reply.status(400).send({ error: "Missing source random" });
    // Reconstruct destination context (ecdhePrivate is ours, but we need destination ecdhe public from Finished)
    // Since the destination already derived the session key when sending DestinationHello, we can use the cached context
    const destCtx = {
      sessionId: body.sessionId,
      ecdhe: { privateKey: cached.ecdhePrivate, publicKey: Buffer.alloc(0) },
      sourceRandom: cached.sourceRandom,
      expiresAt: cached.expiresAt,
    } as import("./security/anp/AnpProtocol.js").AnpHandshakeContext;
    // We need the destinationRandom from the message we sent — not available here, so derive from the Finished proof
    // For simplicity, use the secretKeyId field from the Finished.verifyData
    const expectedSecretKeyId = body.finished.verifyData.secretKeyId;
    const result = verifyFinishedAsResponder(destCtx, body.finished, anpCtx.identity, expectedSecretKeyId);
    if (!result.ok) return reply.status(400).send({ ok: false, error: result.error });
    anpHandshakeCache.delete(body.sessionId);
    return reply.send({ ok: true, sessionId: body.sessionId, secretKeyId: expectedSecretKeyId });
  });

  server.post("/anp/handshake/offer", async (request) => {
    const body = (request.body ?? {}) as { peer?: string };
    const offer = protocol.createHandshakeOffer(body.peer ?? "local-peer");
    return offer;
  });

  server.post("/anp/handshake/response", async (request) => {
    const body = (request.body ?? {}) as { offer?: import("./security/AnpHandshakeAdapter.js").HandshakeOffer };
    if (!body.offer) return { error: "Missing offer object" };
    const response = protocol.createHandshakeResponse(body.offer);
    return response;
  });

  server.post("/anp/handshake/verify-offer", localOnly, async (request) => {
    const body = parseBody(AnpVerifyOfferSchema, request.body ?? {});
    const result = await verifyHandshakeOffer(body.offer, body.publicKey, anpHandshakeContext);
    return { ok: result.valid, reason: result.reason };
  });

  server.post("/anp/handshake/verify-response", localOnly, async (request) => {
    const body = parseBody(AnpVerifyResponseSchema, request.body ?? {});
    const result = await verifyHandshakeResponse(body.response, body.publicKey, anpHandshakeContext);
    return { ok: result.valid, reason: result.reason };
  });

  // ===== ANP Agent Description Protocol (ADP) =====
  const adpRegistry = new Map<string, import("./security/anp/AgentDescriptionProtocol.js").AdpAgentDescription>();

  server.get("/.well-known/agent-description.json", async (_request, reply) => {
    const { buildAdpAgentDescription } = await import("./security/anp/AgentDescriptionProtocol.js");
    const { ANP_CAPABILITY_IDS } = await import("./security/anp/AnpMetaProtocol.js");
    const hostname = process.env.ANP_HOSTNAME ?? "127.0.0.1";
    const port = anpCtx.port;
    const adp = buildAdpAgentDescription({
      identity: anpCtx.identity,
      agentCard,
      organization: { name: "Oracle Amigo", url: "https://oracle-amigo.local" },
      capabilities: [
        ANP_CAPABILITY_IDS.FILE_TRANSFER,
        ANP_CAPABILITY_IDS.AGENT_DISCOVERY,
        ANP_CAPABILITY_IDS.NATURAL_LANGUAGE,
        ANP_CAPABILITY_IDS.HUMAN_AUTHORIZATION,
      ],
      baseUrl: `http://${hostname}:${port}`,
      anpEndpointUrl: `http://${hostname}:${port}/anp/messages`,
      humanAuthorizationRequired: true,
    });
    adpRegistry.set(adp.id, adp);
    return reply.send(adp);
  });

  // ===== ANP Agent Discovery Protocol =====
  server.post("/anp/discovery/query", async (request, reply) => {
    const body = (request.body ?? {}) as import("./security/anp/AgentDiscoveryProtocol.js").DiscoveryRequest;
    const { buildDiscoveryResult } = await import("./security/anp/AgentDiscoveryProtocol.js");
    const descriptions = Array.from(adpRegistry.values());
    const result = buildDiscoveryResult(descriptions, body);
    return reply.send(result);
  });

  // ===== ANP E2E Messaging =====
  const anpMessageThreads = new Map<string, import("./security/anp/MessagingProtocol.js").MessageThread>();

  server.post("/anp/messages/send", localOnly, async (request, reply) => {
    const body = (request.body ?? {}) as {
      message: import("./security/anp/MessagingProtocol.js").AnpMessage;
      sessionKey?: string;
      secretKeyId?: string;
    };
    if (!body.message) return reply.status(400).send({ error: "message required" });
    const threadId = body.message.threadId ?? body.message.id;
    const existing = anpMessageThreads.get(threadId) ?? {
      threadId,
      participants: [body.message.from, body.message.to],
      messages: [],
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    };
    anpMessageThreads.set(threadId, {
      ...existing,
      messages: [...existing.messages, body.message],
      lastActivity: new Date().toISOString(),
    });
    return reply.send({ ok: true, threadId, messageId: body.message.id });
  });

  server.get("/anp/messages/thread/:threadId", localOnly, async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const thread = anpMessageThreads.get(threadId);
    if (!thread) return reply.status(404).send({ error: "Thread not found" });
    return reply.send(thread);
  });

  // ===== ANP AP2 Payment Protocol =====
  const ap2Intents = new Map<string, import("./security/anp/Ap2PaymentProtocol.ts").Ap2PaymentIntent>();
  const ap2Settlements = new Map<string, import("./security/anp/Ap2PaymentProtocol.ts").Ap2Settlement>();

  server.post("/anp/payment/intent", localOnly, async (request, reply) => {
    const body = (request.body ?? {}) as Parameters<typeof import("./security/anp/Ap2PaymentProtocol.js").buildPaymentIntent>[0];
    try {
      const { buildPaymentIntent, issueIntent } = await import("./security/anp/Ap2PaymentProtocol.js");
      const intent = issueIntent(buildPaymentIntent(body));
      ap2Intents.set(intent.id, intent);
      return reply.send(intent);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  server.post("/anp/payment/intent/:intentId/authorize", localOnly, async (request, reply) => {
    const { intentId } = request.params as { intentId: string };
    const body = (request.body ?? {}) as { authorizedBy: string; authorizedDid: string; signature: import("./security/anp/Ap2PaymentProtocol.js").Ap2Authorization["signature"] };
    const intent = ap2Intents.get(intentId);
    if (!intent) return reply.status(404).send({ error: "Intent not found" });
    try {
      const { authorizeIntent } = await import("./security/anp/Ap2PaymentProtocol.js");
      const updated = authorizeIntent(intent, {
        intentId,
        authorizedBy: body.authorizedBy,
        authorizedDid: body.authorizedDid,
        authorizedAt: new Date().toISOString(),
        signature: body.signature,
      });
      ap2Intents.set(intentId, updated);
      return reply.send(updated);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  server.post("/anp/payment/intent/:intentId/settle", localOnly, async (request, reply) => {
    const { intentId } = request.params as { intentId: string };
    const body = (request.body ?? {}) as { settledBy: string; transactionHash?: string };
    const intent = ap2Intents.get(intentId);
    if (!intent) return reply.status(404).send({ error: "Intent not found" });
    try {
      const { settleIntent } = await import("./security/anp/Ap2PaymentProtocol.js");
      const settlement: import("./security/anp/Ap2PaymentProtocol.js").Ap2Settlement = {
        intentId,
        settledBy: body.settledBy,
        settledAt: new Date().toISOString(),
        transactionHash: body.transactionHash,
        receipt: {
          totalAmount: intent.totalAmount,
          currency: intent.currency,
          lineItems: intent.lineItems,
        },
        status: "settled",
      };
      const updated = settleIntent(intent, settlement);
      ap2Intents.set(intentId, updated);
      ap2Settlements.set(intentId, settlement);
      return reply.send({ intent: updated, settlement });
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  server.get("/anp/payment/intent/:intentId", localOnly, async (request, reply) => {
    const { intentId } = request.params as { intentId: string };
    const intent = ap2Intents.get(intentId);
    if (!intent) return reply.status(404).send({ error: "Intent not found" });
    return reply.send(intent);
  });

  server.get("/", async (_request, reply) => {
    const asset = await tryReadPublicFile(publicDir, "index.html");
    if (!asset.ok) {
      return reply.status(asset.statusCode).send({ error: asset.message });
    }
    return withLocalUiAppShell(reply).type("text/html; charset=utf-8").send(asset.content);
  });

  server.get("/favicon.ico", async (_request, reply) => reply.status(204).send());

  server.get("/assets/*", async (request, reply) => {
    const params = request.params as { "*": string };
    const assetPath = params["*"];
    const asset = await tryReadPublicFile(publicDir, join("assets", assetPath));
    if (!asset.ok) {
      return reply.status(asset.statusCode).send({ error: asset.message });
    }
    return reply.type(contentType(assetPath)).send(asset.content);
  });

  server.get("/sessions", { preHandler: requireLocalApiToken }, async () => ({
    sessions: tool.listSandboxSessions()
  }));

  server.post("/sessions", { preHandler: requireLocalApiToken }, async (request) => {
    return tool.createSandboxSession(parseBody(CreateSandboxSessionSchema, request.body));
  });

  server.post("/sessions/:sessionId/shell", { preHandler: requireLocalApiToken }, async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    return tool.runShellCommand(parseBody(RunShellCommandSchema, { ...(request.body as object), sessionId }));
  });

  server.post("/sessions/:sessionId/python", { preHandler: requireLocalApiToken }, async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    return tool.runPythonCode(parseBody(RunCodeSchema, { ...(request.body as object), sessionId }));
  });

  server.post("/sessions/:sessionId/node", { preHandler: requireLocalApiToken }, async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    return tool.runNodeCode(parseBody(RunCodeSchema, { ...(request.body as object), sessionId }));
  });

  server.post("/sessions/:sessionId/clone-and-test", { preHandler: requireLocalApiToken }, async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    return tool.cloneRepoAndRunTests(parseBody(CloneRepoAndRunTestsSchema, { ...(request.body as object), sessionId }));
  });

  server.get("/sessions/:sessionId/events", { preHandler: requireLocalApiToken }, async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    return { sessionId, events: tool.sessions.getEvents(sessionId) };
  });

  server.post("/agent/file-search", { preHandler: requireLocalApiToken }, async (request) => {
    const { query } = parseBody(FileSearchSchema, request.body);
    return fileSearch.search(query);
  });

  server.post("/agent/runs", { preHandler: requireLocalApiToken }, async (request) => {
    return agentRuns.createRun(parseBody(AgentRunSchema, request.body));
  });

  server.get("/agent/runs", { preHandler: requireLocalApiToken }, async () => ({
    runs: agentRuns.listRuns()
  }));

  server.get("/agent/runs/:runId/events", { preHandler: requireLocalApiToken }, async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const run = agentRuns.getRun(runId);
    if (!run) {
      return reply.status(404).send({ error: "Agent run not found" });
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    writeSse(reply.raw, "snapshot", run);
    if (run.status !== "running") {
      reply.raw.end();
      return reply;
    }

    const unsubscribe = agentRuns.subscribe(runId, (updatedRun) => {
      writeSse(reply.raw, "snapshot", updatedRun);
      if (updatedRun.status !== "running") {
        unsubscribe();
        reply.raw.end();
      }
    });

    request.raw.on("close", unsubscribe);
    return reply;
  });

  server.get("/agent/runs/:runId", { preHandler: requireLocalApiToken }, async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const run = agentRuns.getRun(runId);
    if (!run) {
      return reply.status(404).send({ error: "Agent run not found" });
    }
    return run;
  });

  server.get("/agent/files/:fileId", { preHandler: requireLocalApiToken }, async (request, reply) => {
    const { fileId } = request.params as { fileId: string };
    const preview = await fileSearch.createPreviewStream(fileId);
    if (!preview) {
      return reply.status(404).send({ error: "File preview not found" });
    }
    return reply
      .header("Content-Disposition", `inline; filename="${preview.fileName.replaceAll('"', "")}"`)
      .header("X-Content-Type-Options", "nosniff")
      .type("application/pdf")
      .send(preview.stream);
  });

  server.delete("/sessions/:sessionId", { preHandler: requireLocalApiToken }, async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    return tool.closeSandboxSession({ sessionId });
  });

  server.setNotFoundHandler(async (_request, reply) => {
    const url = _request.url;
    const raw = _request.raw.url ?? url;
    if (raw.includes("..") || raw.includes("%2e") || url.startsWith("/assets/") || url.includes("/src/") || url.match(/\.(ts|tsx|js|map|json|md)$/)) {
      return reply.status(404).send({ error: "Not found" });
    }
    const asset = await tryReadPublicFile(publicDir, "index.html");
    if (!asset.ok) {
      return reply.status(asset.statusCode).send({ error: asset.message });
    }
    return withLocalUiAppShell(reply).type("text/html; charset=utf-8").send(asset.content);
  });

  return server;
}

type PublicAssetResult =
  | { ok: true; content: Buffer }
  | { ok: false; statusCode: 400 | 404; message: string };

async function tryReadPublicFile(publicDir: string, relativePath: string): Promise<PublicAssetResult> {
  const normalizedPath = relativePath.replaceAll("\\", "/");
  const resolvedPath = resolve(join(publicDir, normalizedPath));
  const publicRoot = publicDir.endsWith(sep) ? publicDir : `${publicDir}${sep}`;
  if (!resolvedPath.startsWith(publicRoot)) {
    return { ok: false, statusCode: 400, message: "Invalid public asset path" };
  }

  try {
    return { ok: true, content: await readFile(resolvedPath) };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { ok: false, statusCode: 404, message: "Public asset not found" };
    }
    throw error;
  }
}

function contentType(path: string): string {
  switch (extname(path)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

type InboxBucket =
  | "needs_my_approval"
  | "agent_working"
  | "waiting_on_others"
  | "risky_sensitive"
  | "mentions"
  | "completed"
  | "failed_blocked"
  | "archived";

type InboxItemKind =
  | "approval"
  | "file_request"
  | "file_transfer"
  | "agent_run"
  | "mission"
  | "chat_message"
  | "security_alert"
  | "audit_event"
  | "system";

type InboxPriority = "critical" | "high" | "medium" | "low";
type InboxStatus = "unread" | "pending" | "running" | "waiting" | "approved" | "denied" | "completed" | "failed" | "expired" | "archived";

interface InboxItem {
  id: string;
  kind: InboxItemKind;
  bucket: InboxBucket;
  priority: InboxPriority;
  title: string;
  summary: string;
  status: InboxStatus;
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
  actions: Array<{
    id: "preview" | "approve" | "deny" | "ask_why" | "snooze" | "archive" | "open_chat" | "view_audit";
    label: string;
    destructive?: boolean;
    primary?: boolean;
    disabledReason?: string;
  }>;
  createdAt: string;
  updatedAt: string;
  dueAt?: string;
  unread: boolean;
}

interface InboxItemState {
  itemId: string;
  readAt: string | null;
  archivedAt: string | null;
  snoozedUntil: string | null;
  updatedAt: string;
}

type UserAgentSettings = z.infer<typeof UserAgentSettingsSchema>;
type MissionProjectionStatus = "active" | "awaiting_approval" | "completed" | "failed" | "cancelled";
type MissionProjectionSource = "chat" | "approval" | "transfer" | "agent_run" | "a2a" | "voice" | "audit";

interface MissionProjectionStep {
  id: string;
  label: string;
  kind: "search" | "reasoning" | "tool_call" | "approval" | "transfer" | "receipt" | "error";
  status: "running" | "completed" | "failed" | "skipped";
  description: string;
  durationMs?: number;
  details?: Record<string, unknown>;
}

interface MissionProjection {
  id: string;
  source: MissionProjectionSource;
  title: string;
  description: string;
  status: MissionProjectionStatus;
  participants: Array<{ id: string; label: string; role: "requester" | "owner" | "agent" | "recipient"; type: "user" | "local_agent" | "remote_agent" | "system"; verified?: boolean }>;
  risk: { level: "low" | "medium" | "high" | "critical"; score: number; reasons: string[] };
  dataMovement: { leavesDevice: boolean; direction: "none" | "incoming" | "outgoing" | "bidirectional"; scope: string; expiresAt?: string | null; revocable: boolean };
  steps: MissionProjectionStep[];
  artifacts: Array<{ id: string; type: "file" | "message" | "audit" | "run"; name: string; status?: string; url?: string | null }>;
  approvals: string[];
  transfers: string[];
  agentRunIds: string[];
  a2aTaskIds: string[];
  voiceCommandId?: string | null;
  conversationId: string | null;
  failure?: { message: string; retryable: boolean } | null;
  retry?: { count: number; lastRetriedAt?: string | null } | null;
  createdAt: string;
  updatedAt: string;
  requesterName: string;
  requesterAgentName: string;
  requesterAgentVerified: boolean;
  recipientName: string;
  recipientAgentName: string;
  activeStepIndex: number;
  consentRecordId: string | null;
  artifactCount: number;
  transferCount: number;
}

const INBOX_BUCKETS: InboxBucket[] = [
  "needs_my_approval",
  "agent_working",
  "waiting_on_others",
  "risky_sensitive",
  "mentions",
  "completed",
  "failed_blocked",
  "archived"
];

function buildInboxItemsResult(input: {
  query: z.infer<typeof InboxItemsQuerySchema> | { limit: number };
  chatRepo: ChatRepository;
  protocol: PersonalAgentProtocol;
  agentRuns: AgentRunResult[];
}): { items: InboxItem[]; pageInfo: { nextCursor?: string; hasMore: boolean }; counts: Record<InboxBucket, number>; allItems: InboxItem[] } {
  const query = input.query as z.infer<typeof InboxItemsQuerySchema>;
  const limit = query.limit ?? 50;
  const offset = Number(query.cursor ?? 0);
  const now = new Date();
  const states = loadInboxItemStates();
  const baseItems = deriveInboxItems(input.chatRepo, input.protocol, input.agentRuns);
  const allItems = baseItems
    .map((item) => applyInboxState(item, states.get(item.id), now))
    .filter((item) => !isSnoozed(item.id, states, now))
    .sort(compareInboxItems);
  const counts = countInboxBuckets(allItems);
  const q = query.q?.trim().toLowerCase() ?? "";
  const filtered = allItems.filter((item) => {
    if (query.bucket && item.bucket !== query.bucket) return false;
    if (query.status && item.status !== query.status) return false;
    if (q && !`${item.title} ${item.summary} ${item.requester?.label ?? ""} ${item.file?.name ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const items = filtered.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  return {
    items,
    pageInfo: { nextCursor: nextOffset < filtered.length ? String(nextOffset) : undefined, hasMore: nextOffset < filtered.length },
    counts,
    allItems
  };
}

function deriveInboxItems(chatRepo: ChatRepository, protocol: PersonalAgentProtocol, agentRuns: AgentRunResult[]): InboxItem[] {
  const conversations = chatRepo.listConversations();
  const messagesByConversation = new Map(conversations.map((conversation) => [conversation.id, chatRepo.getMessages(conversation.id)]));
  const items: InboxItem[] = [];

  for (const approval of protocol.listApprovals()) {
    const fileName = approval.boundFilePath ? basename(approval.boundFilePath) : approval.approvalType === "file.search.refinement" ? "Search refinement" : "Selected local file";
    const pending = approval.status === "pending" && new Date(approval.expiresAt).getTime() > Date.now();
    const expired = approval.status === "expired" || (approval.status === "pending" && !pending);
    const conversation = findConversationByTask(conversations, messagesByConversation, approval.taskId);
    items.push({
      id: `approval:${approval.id}`,
      kind: "approval",
      bucket: pending ? "needs_my_approval" : expired ? "failed_blocked" : "completed",
      priority: pending ? "high" : expired ? "medium" : "low",
      title: pending ? `Approval needed: ${fileName}` : `Approval ${approval.status}: ${fileName}`,
      summary: `${approvalRequesterDisplayName(approval.id, approval.requesterAgentId)} requested ${approval.approvalType.replaceAll(".", " ")}.`,
      status: pending ? "pending" : approval.status === "approved" ? "approved" : approval.status === "rejected" ? "denied" : expired ? "expired" : "completed",
      requester: { id: approval.requesterAgentId, label: approvalRequesterDisplayName(approval.id, approval.requesterAgentId), type: "remote_agent", trustLabel: "Verified", verified: true },
      target: { id: approval.ownerAgentId, label: "My local agent", type: "local_agent" },
      conversationId: conversation?.id,
      approvalId: approval.id,
      missionId: approval.taskId,
      risk: { level: pending ? "high" : "medium", reasons: ["Human approval required", approval.boundFilePath ? "Local file selected" : "No bound file selected"] },
      privacy: { sensitivity: pending ? "high" : "medium", leavesDevice: true, masked: true, expiresAt: approval.expiresAt, revocable: approval.status === "approved" },
      file: { name: fileName, path: approval.boundFilePath ?? undefined, sizeBytes: approval.boundSizeBytes ?? undefined, mimeType: "application/octet-stream", sha256: approval.boundSha256 ?? undefined, matchScore: approval.boundFilePath ? 1 : 0 },
      actions: pending
        ? [
            { id: "preview", label: "Preview" },
            { id: "approve", label: "Approve", primary: true },
            { id: "deny", label: "Deny", destructive: true },
            { id: "ask_why", label: "Ask why" },
            { id: "snooze", label: "Snooze" },
            { id: "archive", label: "Archive" },
            ...(conversation ? [{ id: "open_chat" as const, label: "Open chat" }] : [])
          ]
        : [
            { id: "view_audit", label: "View audit" },
            { id: "archive", label: "Archive" },
            ...(conversation ? [{ id: "open_chat" as const, label: "Open chat" }] : [])
          ],
      createdAt: approval.createdAt,
      updatedAt: approval.decidedAt ?? approval.createdAt,
      dueAt: approval.expiresAt,
      unread: pending
    });
  }

  for (const row of getDb().prepare("SELECT * FROM transfers ORDER BY created_at DESC LIMIT 100").all() as Array<Record<string, unknown>>) {
    const status = String(row.status ?? "created");
    const failed = status.toLowerCase().includes("fail");
    const completed = Boolean(row.completed_at) || status === "completed" || status === "stored";
    const fileName = String(row.file_name ?? "Transferred file");
    items.push({
      id: `transfer:${String(row.id)}`,
      kind: "file_transfer",
      bucket: failed ? "failed_blocked" : completed ? "completed" : "risky_sensitive",
      priority: failed ? "high" : completed ? "low" : "medium",
      title: `Transfer activity: ${fileName}`,
      summary: `${formatBytes(Number(row.size_bytes ?? 0))} transfer ${status}.`,
      status: failed ? "failed" : completed ? "completed" : "running",
      requester: { id: String(row.from_agent_id ?? "system"), label: shortInboxLabel(String(row.from_agent_id ?? "Transfer service")), type: "remote_agent", trustLabel: "Tracked", verified: true },
      target: { id: String(row.to_agent_id ?? "local-agent"), label: shortInboxLabel(String(row.to_agent_id ?? "My local agent")), type: "local_agent" },
      missionId: String(row.task_id ?? ""),
      transferId: String(row.id),
      risk: { level: failed ? "high" : "medium", reasons: ["File transfer tracked", "Data movement event"] },
      privacy: { sensitivity: "high", leavesDevice: true, masked: true, revocable: !completed },
      file: { name: fileName, path: String(row.storage_path ?? ""), sizeBytes: Number(row.size_bytes ?? 0), mimeType: String(row.mime_type ?? "application/octet-stream"), sha256: String(row.sha256 ?? "") },
      actions: [{ id: "view_audit", label: "View audit" }, { id: "archive", label: "Archive" }],
      createdAt: String(row.created_at ?? new Date().toISOString()),
      updatedAt: String(row.completed_at ?? row.created_at ?? new Date().toISOString()),
      unread: !completed
    });
  }

  for (const run of agentRuns.slice(0, 50)) {
    items.push({
      id: `run:${run.runId}`,
      kind: "agent_run",
      bucket: run.status === "running" ? "agent_working" : run.status === "failed" ? "failed_blocked" : "completed",
      priority: run.status === "failed" ? "high" : run.status === "running" ? "medium" : "low",
      title: run.status === "running" ? "Agent is working" : `Agent run ${run.status}`,
      summary: run.finalAnswer?.message ?? run.query,
      status: run.status === "running" ? "running" : run.status === "failed" ? "failed" : "completed",
      requester: { id: "local-agent", label: "My local agent", type: "local_agent", trustLabel: "Local", verified: true },
      risk: { level: run.status === "failed" ? "medium" : "low", reasons: run.status === "failed" ? ["Agent run failed"] : ["Local agent activity"] },
      privacy: { sensitivity: "medium", leavesDevice: false, masked: false, revocable: false },
      actions: [{ id: "archive", label: "Archive" }],
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      unread: run.status === "running" || run.status === "failed"
    });
  }

  for (const conversation of conversations) {
    const messages = messagesByConversation.get(conversation.id) ?? [];
    if (conversation.unread_count <= 0 && conversation.mention_count <= 0) continue;
    const last = messages.at(-1);
    items.push({
      id: `conversation:${conversation.id}`,
      kind: "chat_message",
      bucket: conversation.mention_count > 0 ? "mentions" : "waiting_on_others",
      priority: conversation.mention_count > 0 ? "high" : "medium",
      title: conversation.mention_count > 0 ? `Mention in ${conversation.title}` : `Unread in ${conversation.title}`,
      summary: last ? summarizeChatMessage(last) : `${conversation.unread_count} unread message${conversation.unread_count === 1 ? "" : "s"}.`,
      status: "unread",
      requester: { id: conversation.peer_user_id ?? conversation.peer_agent_instance_id ?? "peer", label: conversation.title, type: conversation.peer_agent_instance_id ? "remote_agent" : "user" },
      conversationId: conversation.id,
      messageId: last?.id,
      risk: { level: "low", reasons: ["Unread conversation activity"] },
      privacy: { sensitivity: "low", leavesDevice: false, masked: false, revocable: false },
      actions: [{ id: "open_chat", label: "Open chat", primary: true }, { id: "archive", label: "Archive" }],
      createdAt: conversation.created_at,
      updatedAt: conversation.last_message_at ?? conversation.updated_at,
      unread: true
    });
  }

  for (const event of getEvents(50)) {
    const risky = /denied|failed|blocked|policy|security/i.test(event.eventType);
    items.push({
      id: `audit:${event.id}`,
      kind: risky ? "security_alert" : "audit_event",
      bucket: risky ? "risky_sensitive" : "completed",
      priority: risky ? "high" : "low",
      title: event.eventType.replaceAll("_", " "),
      summary: event.taskId ? `Task ${shortId(event.taskId)} audit event.` : "Audit event recorded.",
      status: risky ? "pending" : "completed",
      requester: { id: event.actorAgentId, label: shortInboxLabel(event.actorAgentId), type: "system", trustLabel: "Audit chain", verified: true },
      approvalId: event.approvalId ?? undefined,
      missionId: event.taskId ?? undefined,
      auditId: String(event.id),
      risk: { level: risky ? "high" : "low", reasons: risky ? ["Policy or failure event"] : ["Audit event"] },
      privacy: { sensitivity: risky ? "high" : "medium", leavesDevice: false, masked: true, revocable: false },
      actions: [{ id: "view_audit", label: "View audit" }, { id: "archive", label: "Archive" }],
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
      unread: risky
    });
  }

  return dedupeInboxItems(items);
}

function findInboxItem(itemId: string, chatRepo: ChatRepository, protocol: PersonalAgentProtocol, agentRuns: AgentRunResult[]): InboxItem | null {
  return deriveInboxItems(chatRepo, protocol, agentRuns).find((item) => item.id === itemId) ?? null;
}

function loadInboxItemStates(): Map<string, InboxItemState> {
  const rows = getDb().prepare("SELECT * FROM inbox_item_state").all() as Array<Record<string, unknown>>;
  return new Map(rows.map((row) => [String(row.item_id), {
    itemId: String(row.item_id),
    readAt: typeof row.read_at === "string" ? row.read_at : null,
    archivedAt: typeof row.archived_at === "string" ? row.archived_at : null,
    snoozedUntil: typeof row.snoozed_until === "string" ? row.snoozed_until : null,
    updatedAt: String(row.updated_at ?? new Date().toISOString())
  }]));
}

function updateInboxItemState(itemId: string, patch: { readAt?: string | null; archivedAt?: string | null; snoozedUntil?: string | null }): void {
  const current = loadInboxItemStates().get(itemId);
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO inbox_item_state (item_id, read_at, archived_at, snoozed_until, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(item_id) DO UPDATE SET
      read_at=excluded.read_at,
      archived_at=excluded.archived_at,
      snoozed_until=excluded.snoozed_until,
      updated_at=excluded.updated_at
  `).run(
    itemId,
    patch.readAt !== undefined ? patch.readAt : current?.readAt ?? null,
    patch.archivedAt !== undefined ? patch.archivedAt : current?.archivedAt ?? null,
    patch.snoozedUntil !== undefined ? patch.snoozedUntil : current?.snoozedUntil ?? null,
    now
  );
}

function applyInboxState(item: InboxItem, state: InboxItemState | undefined, now: Date): InboxItem {
  const unread = state?.readAt ? false : item.unread;
  if (state?.archivedAt) return { ...item, bucket: "archived", status: "archived", unread: false };
  if (state?.snoozedUntil && new Date(state.snoozedUntil).getTime() > now.getTime()) return { ...item, unread: false };
  return { ...item, unread };
}

function isSnoozed(itemId: string, states: Map<string, InboxItemState>, now: Date): boolean {
  const state = states.get(itemId);
  return Boolean(state?.snoozedUntil && new Date(state.snoozedUntil).getTime() > now.getTime() && !state.archivedAt);
}

function countInboxBuckets(items: InboxItem[]): Record<InboxBucket, number> {
  const counts = Object.fromEntries(INBOX_BUCKETS.map((bucket) => [bucket, 0])) as Record<InboxBucket, number>;
  for (const item of items) counts[item.bucket] += 1;
  return counts;
}

function compareInboxItems(a: InboxItem, b: InboxItem): number {
  const priority = { critical: 4, high: 3, medium: 2, low: 1 };
  const bucket = { needs_my_approval: 8, risky_sensitive: 7, failed_blocked: 6, mentions: 5, agent_working: 4, waiting_on_others: 3, completed: 2, archived: 1 };
  return bucket[b.bucket] - bucket[a.bucket] || priority[b.priority] - priority[a.priority] || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function dedupeInboxItems(items: InboxItem[]): InboxItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function defaultUserAgentSettings(): UserAgentSettings {
  return UserAgentSettingsSchema.parse({});
}

function loadUserAgentSettings(profileId: string): UserAgentSettings {
  const row = getDb().prepare("SELECT settings_json FROM user_agent_settings WHERE profile_id = ?").get(profileId) as { settings_json?: string } | undefined;
  if (!row?.settings_json) return defaultUserAgentSettings();
  return UserAgentSettingsSchema.parse(parseRecordJson(row.settings_json));
}

function saveUserAgentSettings(profileId: string, settings: UserAgentSettings): UserAgentSettings {
  const parsed = UserAgentSettingsSchema.parse(settings);
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO user_agent_settings (profile_id, settings_json, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(profile_id) DO UPDATE SET
      settings_json = excluded.settings_json,
      updated_at = excluded.updated_at
  `).run(profileId, JSON.stringify(parsed), now, now);
  return parsed;
}

function buildMissionProjections(input: {
  chatRepo: ChatRepository;
  protocol: PersonalAgentProtocol;
  agentRuns: AgentRunResult[];
  voiceCommands: VoiceCommandService;
}): MissionProjection[] {
  const missions = new Map<string, MissionProjection>();
  const conversations = input.chatRepo.listConversations();
  const messagesByConversation = new Map(conversations.map((conversation) => [conversation.id, input.chatRepo.getMessages(conversation.id)]));

  const ensureMission = (id: string, seed: Partial<MissionProjection> & Pick<MissionProjection, "title" | "description" | "source" | "createdAt" | "updatedAt">): MissionProjection => {
    const existing = missions.get(id);
    if (existing) {
      existing.updatedAt = maxIso(existing.updatedAt, seed.updatedAt);
      existing.createdAt = minIso(existing.createdAt, seed.createdAt);
      existing.status = strongerMissionStatus(existing.status, seed.status ?? existing.status);
      if (seed.failure) existing.failure = seed.failure;
      return existing;
    }
    const mission: MissionProjection = {
      id,
      source: seed.source,
      title: seed.title,
      description: seed.description,
      status: seed.status ?? "active",
      participants: seed.participants ?? [],
      risk: seed.risk ?? { level: "low", score: 10, reasons: ["Local agent activity"] },
      dataMovement: seed.dataMovement ?? { leavesDevice: false, direction: "none", scope: "local", revocable: false },
      steps: seed.steps ?? [],
      artifacts: seed.artifacts ?? [],
      approvals: seed.approvals ?? [],
      transfers: seed.transfers ?? [],
      agentRunIds: seed.agentRunIds ?? [],
      a2aTaskIds: seed.a2aTaskIds ?? [],
      voiceCommandId: seed.voiceCommandId ?? null,
      conversationId: seed.conversationId ?? null,
      failure: seed.failure ?? null,
      retry: seed.retry ?? { count: 0, lastRetriedAt: null },
      createdAt: seed.createdAt,
      updatedAt: seed.updatedAt,
      requesterName: seed.requesterName ?? "My local agent",
      requesterAgentName: seed.requesterAgentName ?? "Oracle Amigo",
      requesterAgentVerified: seed.requesterAgentVerified ?? true,
      recipientName: seed.recipientName ?? "Me",
      recipientAgentName: seed.recipientAgentName ?? "My Local Agent",
      activeStepIndex: 0,
      consentRecordId: seed.consentRecordId ?? null,
      artifactCount: seed.artifactCount ?? 0,
      transferCount: seed.transferCount ?? 0
    };
    missions.set(id, mission);
    return mission;
  };

  for (const task of wfListTasks()) {
    const conversation = findConversationByTask(conversations, messagesByConversation, task.id);
    const status = normalizeMissionStatus(`${task.status} ${task.protocolState}`);
    const mission = ensureMission(task.id, {
      source: "a2a",
      title: missionTitleFromMetadata(task.metadataJson, task.type, task.id),
      description: missionDescriptionFromMetadata(task.metadataJson, task.type),
      status,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      conversationId: conversation?.id ?? task.contextId,
      a2aTaskIds: [task.id],
      steps: workflowStepsForTask(task.id)
    });
    addUnique(mission.a2aTaskIds, task.id);
    if (mission.steps.length === 0) {
      mission.steps.push({
        id: `task:${task.id}`,
        label: task.type.replaceAll(".", " "),
        kind: "tool_call",
        status: status === "completed" ? "completed" : status === "failed" ? "failed" : "running",
        description: task.protocolState
      });
    }
  }

  for (const approval of input.protocol.listApprovals()) {
    const conversation = findConversationByTask(conversations, messagesByConversation, approval.taskId);
    const pending = approval.status === "pending" && new Date(approval.expiresAt).getTime() > Date.now();
    const failed = approval.status === "rejected" || approval.status === "expired" || !pending && approval.status === "pending";
    const fileName = approval.boundFilePath ? basename(approval.boundFilePath) : "Approval candidate";
    const mission = ensureMission(approval.taskId, {
      source: "approval",
      title: pending ? `Approval needed: ${fileName}` : `Approval ${approval.status}: ${fileName}`,
      description: approval.approvalType.replaceAll(".", " "),
      status: pending ? "awaiting_approval" : failed ? "failed" : "completed",
      createdAt: approval.createdAt,
      updatedAt: approval.decidedAt ?? approval.createdAt,
      conversationId: conversation?.id ?? null,
      consentRecordId: approval.id,
      participants: [
        { id: approval.requesterAgentId, label: approvalRequesterDisplayName(approval.id, approval.requesterAgentId), role: "requester", type: "remote_agent", verified: true },
        { id: approval.ownerAgentId, label: "My local agent", role: "owner", type: "local_agent", verified: true }
      ],
      risk: {
        level: pending ? "high" : failed ? "medium" : "low",
        score: pending ? 72 : failed ? 55 : 25,
        reasons: ["Human consent required", approval.boundFilePath ? "Local file selected" : "No final file selected"]
      },
      dataMovement: { leavesDevice: true, direction: "outgoing", scope: approval.approvalType, expiresAt: approval.expiresAt, revocable: approval.status === "approved" },
      approvals: [approval.id],
      steps: [{
        id: `approval:${approval.id}`,
        label: "Human approval",
        kind: "approval",
        status: pending ? "running" : failed ? "failed" : "completed",
        description: approval.approvalType.replaceAll(".", " ")
      }],
      requesterName: approvalRequesterDisplayName(approval.id, approval.requesterAgentId),
      requesterAgentName: approvalRequesterDisplayName(approval.id, approval.requesterAgentId),
      recipientName: "Me",
      recipientAgentName: "My Local Agent"
    });
    addUnique(mission.approvals, approval.id);
    mission.consentRecordId ??= approval.id;
  }

  for (const row of getDb().prepare("SELECT * FROM transfers ORDER BY created_at DESC LIMIT 200").all() as Array<Record<string, unknown>>) {
    const taskId = String(row.task_id ?? row.transfer_id ?? row.id);
    const transferId = String(row.transfer_id ?? row.id);
    const fileName = String(row.file_name ?? "Transferred file");
    const status = normalizeMissionStatus(String(row.status ?? ""));
    const mission = ensureMission(taskId, {
      source: "transfer",
      title: `Transfer: ${fileName}`,
      description: `${formatBytes(Number(row.size_bytes ?? 0))} tracked transfer.`,
      status,
      createdAt: String(row.created_at ?? new Date().toISOString()),
      updatedAt: String(row.completed_at ?? row.created_at ?? new Date().toISOString()),
      dataMovement: { leavesDevice: true, direction: "bidirectional", scope: "file.transfer", revocable: status !== "completed" },
      transfers: [transferId],
      artifacts: [{ id: transferId, type: "file", name: fileName, status: String(row.status ?? "created") }],
      steps: [{
        id: `transfer:${transferId}`,
        label: "File transfer",
        kind: "transfer",
        status: status === "failed" ? "failed" : status === "completed" ? "completed" : "running",
        description: String(row.status ?? "created")
      }]
    });
    addUnique(mission.transfers, transferId);
    addArtifact(mission, { id: transferId, type: "file", name: fileName, status: String(row.status ?? "created") });
  }

  for (const run of input.agentRuns.slice(0, 100)) {
    const mission = ensureMission(`run:${run.runId}`, {
      source: "agent_run",
      title: run.query,
      description: run.finalAnswer?.message ?? "Local agent run",
      status: run.status === "running" ? "active" : run.status === "failed" ? "failed" : "completed",
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      agentRunIds: [run.runId],
      artifacts: [{ id: run.runId, type: "run", name: run.query, status: run.status }],
      steps: run.steps.map((step) => ({
        id: `run:${run.runId}:${step.id}`,
        label: step.label,
        kind: step.executionTarget === "oci-llm" ? "reasoning" : "tool_call",
        status: step.status === "skipped" ? "skipped" : step.status,
        description: step.stderr ?? step.stdout ?? step.executionTarget,
        durationMs: step.durationMs,
        details: step.command ? { command: redactLocalPathText(step.command) } : undefined
      })),
      failure: run.status === "failed" ? { message: run.finalAnswer?.message ?? "Agent run failed", retryable: true } : null
    });
    addUnique(mission.agentRunIds, run.runId);
  }

  for (const command of input.voiceCommands.listCommands({ limit: 100 })) {
    const missionId = command.missionId ?? command.relayTaskId ?? command.id;
    const status: MissionProjectionStatus =
      command.status === "failed" ? "failed" :
      command.status === "cancelled" ? "cancelled" :
      command.status === "completed" || command.status === "submitted" ? "completed" :
      command.status === "preview_required" ? "awaiting_approval" : "active";
    const mission = ensureMission(missionId, {
      source: "voice",
      title: command.preview.title,
      description: command.preview.summary ?? command.transcript,
      status,
      createdAt: command.createdAt,
      updatedAt: command.updatedAt,
      voiceCommandId: command.id,
      conversationId: command.conversationId,
      dataMovement: command.parsed.intent === "remote_file_request"
        ? { leavesDevice: true, direction: "outgoing", scope: "relay.file_request", revocable: command.status !== "completed" }
        : { leavesDevice: false, direction: "none", scope: "local.voice_command", revocable: false },
      risk: command.parsed.intent === "remote_file_request"
        ? { level: "high", score: 70, reasons: ["Voice command can initiate a relay request", "Explicit confirmation required"] }
        : { level: "low", score: 20, reasons: ["Local command preview"] },
      steps: [{
        id: `voice:${command.id}`,
        label: "Voice command",
        kind: "tool_call",
        status: status === "failed" ? "failed" : status === "awaiting_approval" ? "running" : "completed",
        description: command.transcript,
        details: { intent: command.parsed.intent, parserProvider: command.parserProvider, confidence: command.confidence }
      }],
      failure: command.errorMessage ? { message: command.errorMessage, retryable: command.status === "failed" } : null
    });
    mission.voiceCommandId = command.id;
    if (command.conversationId) mission.conversationId = command.conversationId;
  }

  for (const mission of missions.values()) {
    mission.steps = dedupeMissionSteps(mission.steps);
    mission.artifacts = dedupeMissionArtifacts(mission.artifacts);
    mission.status = inferMissionStatus(mission);
    mission.activeStepIndex = Math.max(0, mission.steps.findIndex((step) => step.status === "running"));
    mission.artifactCount = mission.artifacts.length;
    mission.transferCount = mission.transfers.length;
  }

  return [...missions.values()].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function workflowStepsForTask(taskId: string): MissionProjectionStep[] {
  const rows = getDb().prepare(`
    SELECT * FROM workflow_events WHERE task_id = ? ORDER BY created_at ASC, id ASC
  `).all(taskId) as Array<Record<string, unknown>>;
  return rows.map((row, index) => {
    const payload = parseRecordJson(row.payload_json);
    const status = /failed|rejected|error/i.test(String(row.state_to ?? row.event_type ?? "")) ? "failed" : "completed";
    return {
      id: `workflow:${taskId}:${String(row.id ?? index)}`,
      label: String(row.event_type ?? "Workflow event").replaceAll("_", " ").toLowerCase(),
      kind: status === "failed" ? "error" : "tool_call",
      status,
      description: String(row.state_to ?? row.state_from ?? "Workflow updated"),
      details: payload
    };
  });
}

function missionTitleFromMetadata(metadata: Record<string, unknown>, type: string, id: string): string {
  const candidate = metadata.title ?? metadata.requestText ?? metadata.text ?? metadata.query ?? metadata.fileQuery;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : `${type.replaceAll(".", " ")} ${shortId(id)}`;
}

function missionDescriptionFromMetadata(metadata: Record<string, unknown>, type: string): string {
  const candidate = metadata.description ?? metadata.requestText ?? metadata.text ?? metadata.query ?? metadata.fileQuery;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : type.replaceAll(".", " ");
}

function normalizeMissionStatus(value: string): MissionProjectionStatus {
  const text = value.toLowerCase();
  if (/cancel/.test(text)) return "cancelled";
  if (/fail|error|reject|expired/.test(text)) return "failed";
  if (/complete|completed|done|stored|available|submitted/.test(text)) return "completed";
  if (/approval|input-required|input_required|pending/.test(text)) return "awaiting_approval";
  return "active";
}

function inferMissionStatus(mission: MissionProjection): MissionProjectionStatus {
  if (mission.status === "failed" || mission.status === "cancelled") return mission.status;
  if (mission.approvals.length > 0 && mission.steps.some((step) => step.kind === "approval" && step.status === "running")) return "awaiting_approval";
  if (mission.steps.some((step) => step.status === "failed")) return "failed";
  if (mission.steps.length > 0 && mission.steps.every((step) => step.status === "completed" || step.status === "skipped")) return mission.status === "awaiting_approval" ? "awaiting_approval" : "completed";
  return mission.status;
}

function strongerMissionStatus(a: MissionProjectionStatus, b: MissionProjectionStatus): MissionProjectionStatus {
  const rank: Record<MissionProjectionStatus, number> = { failed: 5, awaiting_approval: 4, active: 3, cancelled: 2, completed: 1 };
  return rank[b] > rank[a] ? b : a;
}

function addUnique(values: string[], value: string): void {
  if (value && !values.includes(value)) values.push(value);
}

function addArtifact(mission: MissionProjection, artifact: MissionProjection["artifacts"][number]): void {
  if (!mission.artifacts.some((candidate) => candidate.id === artifact.id)) mission.artifacts.push(artifact);
}

function dedupeMissionSteps(steps: MissionProjectionStep[]): MissionProjectionStep[] {
  const seen = new Set<string>();
  return steps.filter((step) => {
    if (seen.has(step.id)) return false;
    seen.add(step.id);
    return true;
  });
}

function dedupeMissionArtifacts(artifacts: MissionProjection["artifacts"]): MissionProjection["artifacts"] {
  const seen = new Set<string>();
  return artifacts.filter((artifact) => {
    if (seen.has(artifact.id)) return false;
    seen.add(artifact.id);
    return true;
  });
}

function minIso(a: string, b: string): string {
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
}

function maxIso(a: string, b: string): string {
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function parseRecordJson(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function findConversationByTask(
  conversations: ChatConversationRecord[],
  messagesByConversation: Map<string, ChatMessageRecord[]>,
  taskId: string
): ChatConversationRecord | null {
  return conversations.find((conversation) => (messagesByConversation.get(conversation.id) ?? []).some((message) => message.task_id === taskId)) ?? null;
}

function shortInboxLabel(value: string): string {
  if (/^ag[ei]?[_-]/i.test(value)) return "Remote agent";
  if (value.length > 32) return shortId(value);
  return value || "System";
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parseBody<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, body: unknown): T {
  return schema.parse(body);
}

function withLocalUiAppShell(reply: FastifyReply): FastifyReply {
  return setLocalUiSessionCookie(reply).header(LOCAL_UI_RUNTIME_HEADER, LOCAL_UI_RUNTIME_VERSION);
}

function skillPathForId(id: string): string {
  return join(resolve(process.cwd(), ".agents", "skills"), id);
}

function isIndexRootValidationError(message: string): boolean {
  return (
    message === "Credential directories cannot be indexed" ||
    message === "Index root is outside configured file-search roots"
  );
}

function assertAllowedIndexRoot(input: string, configuredRoots: string[]): string {
  const resolved = resolveExistingPath(input);
  if (isSensitiveIndexPath(resolved)) {
    throw new Error("Credential directories cannot be indexed");
  }

  const allowedRoots = configuredRoots.map((root) => resolveConfiguredRoot(root));
  if (!allowedRoots.some((root) => isPathInsideRoot(resolved, root))) {
    throw new Error("Index root is outside configured file-search roots");
  }

  return resolved;
}

function resolveExistingPath(input: string): string {
  const resolved = resolve(input.trim());
  return realpathSync(resolved);
}

function resolveConfiguredRoot(input: string): string {
  const resolved = resolve(input.trim());
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function isSensitiveIndexPath(pathValue: string): boolean {
  return /(^|[\\/])(\.ssh|\.aws|\.azure|\.oci|\.gnupg|\.kube)([\\/]|$)/i.test(pathValue);
}

function isPathInsideRoot(pathValue: string, rootValue: string): boolean {
  const normalizedPath = pathValue.toLowerCase();
  const normalizedRoot = rootValue.toLowerCase();
  const rootWithSeparator = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(rootWithSeparator);
}

function sanitizePushNotificationConfig(config: PushNotificationConfig): PushNotificationConfig {
  return {
    ...config,
    url: assertPublicHttpsUrl(config.url)
  };
}

function redactLocalPaths<T>(input: T): T {
  if (typeof input === "string") {
    return redactLocalPathText(input) as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactLocalPaths(item)) as T;
  }

  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([key, value]) => {
        if (/^(filePath|storedPath|boundFilePath|path)$/i.test(key)) {
          return [key, "Local path hidden"];
        }
        return [key, redactLocalPaths(value)];
      })
    ) as T;
  }

  return input;
}

function redactSecretTextOnly<T>(input: T, secretPolicy: SecretPolicy): T {
  if (typeof input === "string") {
    return secretPolicy.redactText(input) as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactSecretTextOnly(item, secretPolicy)) as T;
  }

  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([key, value]) => [
        key,
        redactSecretTextOnly(value, secretPolicy)
      ])
    ) as T;
  }

  return input;
}

function redactLocalPathText(input: string): string {
  return input
    .replace(/[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\s"'`]+/g, "Local path hidden")
    .replace(/(?:\/Users|\/home)\/[^\s"'`]+/g, "Local path hidden");
}

function isCloudConnectivityError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const maybeCodedError = error as Error & { code?: unknown };
  const code = typeof maybeCodedError.code === "string" ? maybeCodedError.code : "";
  return (
    ["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"].includes(code) ||
    /Cloud request .* timed out|fetch failed|connect ECONNREFUSED/i.test(error.message)
  );
}

function getRequestedControlPlaneUrl(body: unknown): string {
  if (body && typeof body === "object" && "control_plane_url" in body) {
    const raw = (body as { control_plane_url?: unknown }).control_plane_url;
    if (typeof raw === "string" && raw.trim()) {
      return raw.trim();
    }
  }
  return defaultControlPlaneUrl();
}

function assertAllowedControlPlaneUrl(value: string): string {
  const trimmed = value.trim();
  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Unsupported control plane URL scheme");
  }

  const normalized = normalizeUrlForComparison(url.toString());
  const normalizedDefault = normalizeUrlForComparison(defaultControlPlaneUrl());
  const allowlist = new Set([
    normalizedDefault,
    ...String(process.env.ALLOWED_CONTROL_PLANE_URLS ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map(normalizeUrlForComparison)
  ]);

  if (!allowlist.has(normalized)) {
    throw new Error("Control plane URL is not allowlisted");
  }
  if (normalized !== normalizedDefault && isPrivateOrMetadataHost(url.hostname)) {
    throw new Error("Control plane URL host is not allowed");
  }

  return trimmed;
}

function localAgentUrl(): string {
  const host = process.env.SANDBOX_HOST ?? "127.0.0.1";
  const port = process.env.SANDBOX_PORT ?? "3399";
  return `http://${host}:${port}`;
}

function defaultOrgSlug(): string {
  return process.env.DEFAULT_ORG_SLUG?.trim() || DEFAULT_DEV_ORG_SLUG;
}

function publicCloudIdentity(identity: LocalCloudIdentity): Omit<LocalCloudIdentity, "userAccessToken" | "deviceAccessToken" | "refreshToken" | "userRefreshToken" | "deviceRefreshToken"> & {
  hasUserAccessToken: boolean;
  hasDeviceAccessToken: boolean;
  hasRefreshToken: boolean;
} {
  const { userAccessToken, deviceAccessToken, refreshToken, userRefreshToken, deviceRefreshToken, ...safe } = identity;
  return {
    ...safe,
    hasUserAccessToken: Boolean(userAccessToken),
    hasDeviceAccessToken: Boolean(deviceAccessToken),
    hasRefreshToken: Boolean(refreshToken || userRefreshToken || deviceRefreshToken)
  };
}

async function inspectControlPlaneConnection(savedUrl: string, configuredUrl: string): Promise<{
  savedUrl: string;
  configuredUrl: string;
  matchesConfigured: boolean;
  reachable: boolean;
  status: "ok" | "mismatch" | "unreachable";
  message: string | null;
}> {
  const normalizedSaved = normalizeUrlForComparison(savedUrl);
  const normalizedConfigured = normalizeUrlForComparison(configuredUrl);
  const matchesConfigured = normalizedSaved === normalizedConfigured;
  try {
    await new ControlPlaneClient(savedUrl).request("/health", { timeoutMs: 2500 });
    return {
      savedUrl,
      configuredUrl,
      matchesConfigured,
      reachable: true,
      status: matchesConfigured ? "ok" : "mismatch",
      message: matchesConfigured
        ? null
        : `This agent is enrolled against ${savedUrl}, but the configured control plane is ${configuredUrl}.`
    };
  } catch (err) {
    return {
      savedUrl,
      configuredUrl,
      matchesConfigured,
      reachable: false,
      status: "unreachable",
      message: err instanceof Error ? err.message : String(err)
    };
  }
}

function normalizeUrlForComparison(value: string): string {
  try {
    const url = new URL(value);
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim().replace(/\/+$/, "");
  }
}

function requireCloudIdentity(identity: LocalCloudIdentity | null, reply: FastifyReply): LocalCloudIdentity | null {
  if (!identity) {
    reply.status(401).send({ error: "CLOUD_NOT_CONFIGURED", message: "Cloud login is required" });
    return null;
  }
  return identity;
}

function requireUserAccessToken(identity: LocalCloudIdentity, reply: FastifyReply): string | null {
  if (!identity.userAccessToken) {
    reply.status(401).send({ error: "CLOUD_USER_TOKEN_REQUIRED", message: "Cloud login is required" });
    return null;
  }
  return identity.userAccessToken;
}

async function requireFreshUserAccessToken(
  enrollmentService: DeviceEnrollmentService,
  reply: FastifyReply
): Promise<string | null> {
  const identity = new LocalCloudIdentityStore().get();
  if (!identity) {
    reply.status(401).send({ error: "CLOUD_NOT_CONFIGURED", message: "Cloud login is required" });
    return null;
  }
  if (identity.refreshToken) {
    try {
      const refreshed = await enrollmentService.refreshUserAccessToken();
      if (refreshed) return refreshed;
    } catch (err) {
      reply.status(401).send({
        error: "CLOUD_USER_TOKEN_EXPIRED",
        message: err instanceof Error ? err.message : "Cloud login expired"
      });
      return null;
    }
  }
  if (identity.userAccessToken) return identity.userAccessToken;
  reply.status(401).send({ error: "CLOUD_USER_TOKEN_REQUIRED", message: "Cloud login is required" });
  return null;
}

async function refreshRelayConversationPeer(
  conversation: ChatConversationRecord,
  cloud: LocalCloudIdentity | null,
  peerRouting: PeerRoutingService,
  capability = "message.send"
): Promise<ChatConversationRecord> {
  if (conversation.mode !== "cloud_relay" || !cloud?.controlPlaneUrl) {
    return conversation;
  }
  return peerRouting.refreshConversationPeer(conversation, { cloud, capability });
}

async function refreshRelayDeliveryStatuses(
  messages: ChatMessageRecord[],
  cloudStore: LocalCloudIdentityStore,
  profileId: string
): Promise<ChatMessageRecord[]> {
  const pendingStatuses = new Set<DeliveryStatus>([
    "local_pending",
    "sent",
    "queued_at_relay",
    "delivered_to_remote_agent"
  ]);
  const repo = new ChatRepository();
  const refreshed: ChatMessageRecord[] = [];
  for (const message of messages) {
    const relayTaskId = typeof message.payload_json.relay_task_id === "string" ? message.payload_json.relay_task_id : null;
    if (!relayTaskId || !pendingStatuses.has(message.delivery_status)) {
      refreshed.push(message);
      continue;
    }
    try {
      const status = await fetchRelayDeliveryStatus(cloudStore, profileId, relayTaskId);
      const updated = repo.updateMessageDeliveryStatus(message.id, status.delivery_status, status.receipt);
      refreshed.push(updated ?? message);
    } catch {
      refreshed.push(message);
    }
  }
  return refreshed;
}

async function fetchRelayDeliveryStatus(
  cloudStore: LocalCloudIdentityStore,
  profileId: string,
  relayTaskId: string
): Promise<{
  relay_task_id: string;
  delivery_status: DeliveryStatus;
  relay_status: string;
  delivered_at: string | null;
  completed_at: string | null;
  receipt: RelayDeliveryReceipt;
}> {
  const task = await withRecoveredDeviceToken(cloudStore, profileId, async (fresh) =>
    new RelayClient(new ControlPlaneClient(fresh.controlPlaneUrl)).getTask(relayTaskId, fresh.deviceAccessToken!)
  );
  const responseStatus = typeof task.response?.status === "string" ? task.response.status : null;
  const responseError = typeof task.response?.error === "string" ? task.response.error : undefined;
  const deliveryStatus = normalizeRelayDeliveryStatus(task.status, responseStatus);
  const deliveredAt = typeof task.response?.delivered_at === "string"
    ? task.response.delivered_at
    : task.completedAt ?? task.deliveredAt ?? null;
  const receipt: RelayDeliveryReceipt = {
    relay_task_id: relayTaskId,
    status: deliveryStatus,
    delivered_at: deliveredAt ?? undefined,
    error: responseError,
    from_agent_instance_id: task.toAgentInstanceId,
    to_agent_instance_id: task.fromAgentInstanceId
  };
  return {
    relay_task_id: relayTaskId,
    delivery_status: deliveryStatus,
    relay_status: task.status,
    delivered_at: task.deliveredAt ?? null,
    completed_at: task.completedAt ?? null,
    receipt
  };
}

function normalizeRelayDeliveryStatus(relayStatus: string, responseStatus: string | null): DeliveryStatus {
  if (responseStatus && isDeliveryStatus(responseStatus)) return responseStatus;
  if (relayStatus === "completed") return "stored_by_remote_agent";
  if (relayStatus === "delivered") return "delivered_to_remote_agent";
  if (relayStatus === "pending") return "queued_at_relay";
  if (relayStatus === "cancelled" || relayStatus === "expired") return "failed";
  return "queued_at_relay";
}

function isDeliveryStatus(value: string): value is DeliveryStatus {
  return [
    "local_pending",
    "queued_at_relay",
    "delivered_to_remote_agent",
    "stored_by_remote_agent",
    "read_by_remote_user",
    "sent",
    "delivered",
    "failed"
  ].includes(value);
}

function chooseRelayPeerAgent(agents: CloudAgentInstance[]): CloudAgentInstance | null {
  const ranked = [...agents].sort((a, b) => {
    const statusRank = statusScore(b.status) - statusScore(a.status);
    if (statusRank !== 0) return statusRank;
    return Date.parse(b.last_seen_at ?? b.last_heartbeat_at ?? "0") - Date.parse(a.last_seen_at ?? a.last_heartbeat_at ?? "0");
  });
  return ranked[0] ?? null;
}

function statusScore(status: string): number {
  if (status === "online") return 3;
  if (status === "stale") return 2;
  if (status === "offline") return 1;
  return 0;
}

interface RelayPeerInfo {
  agentInstanceId: string | null;
  userId: string | null;
  displayName: string | null;
  email: string | null;
  presence: string;
}

interface DirectoryAuthContext {
  client: DirectoryClient;
  userToken: string | null;
  deviceToken: string | null;
}

async function resolveRelayPeerInfoMap(
  conversations: ChatConversationRecord[],
  cloud: LocalCloudIdentity | null,
  enrollmentService: DeviceEnrollmentService
): Promise<Map<string, RelayPeerInfo>> {
  const result = new Map<string, RelayPeerInfo>();
  for (const conversation of conversations) {
    const info = await resolveRelayPeerInfo(conversation, cloud, enrollmentService);
    if (info) result.set(conversation.id, info);
  }
  return result;
}

async function resolveRelayPeerInfo(
  conversation: ChatConversationRecord,
  cloud: LocalCloudIdentity | null,
  enrollmentService: DeviceEnrollmentService
): Promise<RelayPeerInfo | null> {
  if (conversation.mode !== "cloud_relay" || !cloud?.controlPlaneUrl) return null;
  const auth = await createDirectoryAuthContext(cloud, enrollmentService);
  if (!auth) return null;

  if (conversation.peer_user_id) {
    const directory = await getPeerUserDirectory(auth, conversation.peer_user_id);
    if (directory) {
      const best = chooseRelayPeerAgent(directory.agents ?? []);
      return {
        agentInstanceId: best?.agent_instance_id ?? conversation.peer_agent_instance_id,
        userId: directory.user_id ?? conversation.peer_user_id,
        displayName: directory.display_name ?? best?.display_name ?? conversation.title,
        email: directory.email ?? null,
        presence: best?.status ?? directory.presence ?? directory.status ?? "unknown"
      };
    }
  }

  if (conversation.peer_agent_instance_id) {
    const agent = await getPeerAgentInstance(auth, conversation.peer_agent_instance_id);
    if (agent) {
      return {
        agentInstanceId: agent.agent_instance_id,
        userId: agent.user_id,
        displayName: agent.display_name || agent.device_name || conversation.title,
        email: agent.email,
        presence: agent.status || "unknown"
      };
    }
  }

  return null;
}

async function createDirectoryAuthContext(
  cloud: LocalCloudIdentity,
  enrollmentService: DeviceEnrollmentService
): Promise<DirectoryAuthContext | null> {
  if (!cloud.controlPlaneUrl) return null;
  let userToken = cloud.userAccessToken;
  if (cloud.refreshToken) {
    userToken = await enrollmentService.refreshUserAccessToken().catch(() => userToken ?? null);
  }
  if (!userToken && !cloud.deviceAccessToken) return null;
  return {
    client: new DirectoryClient(new ControlPlaneClient(cloud.controlPlaneUrl)),
    userToken: userToken ?? null,
    deviceToken: cloud.deviceAccessToken ?? null
  };
}

async function getPeerUserDirectory(auth: DirectoryAuthContext, userId: string): Promise<{
  user_id: string;
  display_name?: string;
  email?: string;
  status?: string;
  presence?: string;
  agents?: CloudAgentInstance[];
} | null> {
  if (auth.userToken) {
    try {
      return await auth.client.getUserAgents(userId, auth.userToken);
    } catch {
      // Device auth fallback keeps presence working after user token expiry.
    }
  }
  if (auth.deviceToken) {
    try {
      return await auth.client.getUserAgentsWithDevice(userId, auth.deviceToken);
    } catch {
      return null;
    }
  }
  return null;
}

async function getPeerAgentInstance(auth: DirectoryAuthContext, agentInstanceId: string): Promise<CloudAgentInstanceDirectoryEntry | null> {
  if (auth.userToken) {
    try {
      return await auth.client.getAgentInstance(agentInstanceId, auth.userToken);
    } catch {
      // Device auth fallback keeps presence working after user token expiry.
    }
  }
  if (auth.deviceToken) {
    try {
      return await auth.client.getAgentInstanceWithDevice(agentInstanceId, auth.deviceToken);
    } catch {
      return null;
    }
  }
  return null;
}

function requireDeviceAccessToken(identity: LocalCloudIdentity, reply: FastifyReply): string | null {
  if (!identity.deviceAccessToken) {
    reply.status(401).send({ error: "CLOUD_DEVICE_TOKEN_REQUIRED", message: "Cloud enrollment is required" });
    return null;
  }
  return identity.deviceAccessToken;
}

function isAllowedLocalAppOrigin(origin: unknown): origin is string {
  if (typeof origin !== "string") return false;
  if (origin === "tauri://localhost" || origin === "http://tauri.localhost") return true;
  return /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+$/i.test(origin);
}

function normalizeRelaySendError(error: unknown): { statusCode: number; code: string; message: string } {
  if (error instanceof CloudError) {
    return {
      statusCode: error.statusCode === 401 || error.statusCode === 403 ? error.statusCode : 503,
      code: error.code,
      message: error.message
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    statusCode: 503,
    code: "RELAY_UNAVAILABLE",
    message
  };
}

function isFastLocalChat(text: string): boolean {
  const value = text.trim().toLowerCase();
  if (!value) return false;
  if (/^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|yes|no)[!.?\s]*$/.test(value)) return true;
  if (/^(hi|hello|hey)\b[\w\s,.!?-]{0,40}$/.test(value)) return true;
  if (value.length <= 80 && /\b(how are you|what can you do|who are you|help)\b/.test(value)) return true;
  return false;
}

function localChatAnswer(text: string): string {
  const value = text.trim().toLowerCase();
  if (/\b(thanks|thank you)\b/.test(value)) {
    return "You are welcome. I am ready to help with local file search, approvals, transfers, or agent tasks.";
  }
  if (/\b(what can you do|help)\b/.test(value)) {
    return "I can search your indexed local files, create approval-gated file requests, run safe agent tasks, and show backend progress as it happens.";
  }
  if (/\b(who are you)\b/.test(value)) {
    return "I'm the local agent on this device. I can help find indexed files and prepare file requests, but I'll ask before accessing or sharing anything sensitive.";
  }
  return "Hi. I'm your local agent, ready to help find files and handle requests.";
}

function summarizeAgentRunStep(step: AgentRunStep): string {
  if (step.status === "running") return step.label;
  if (step.status === "failed") return step.stderr ? `${step.label}: ${truncateChatText(step.stderr)}` : `${step.label} failed.`;
  if (step.status === "skipped") return step.stderr ? `${step.label}: ${truncateChatText(step.stderr)}` : `${step.label} was skipped.`;
  const output = step.stdout?.trim();
  if (!output) return step.label;
  return `${step.label}: ${truncateChatText(output)}`;
}

function phaseForAgentRunStep(step: AgentRunStep): string {
  if (step.status === "failed") return "failed";
  if (step.status === "skipped") return "completed";
  if (step.status !== "running") return "completed";
  if (step.executionTarget === "oci-llm") return "thinking";
  if (step.executionTarget === "host-file-search") return "searching";
  if (step.executionTarget === "gondolin-vm-command") return "terminal";
  return "executing";
}

function truncateChatText(value: string, max = 360): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
}

function displayPathForFileSearchMatch(candidate: FileSearchMatch): string {
  return `Local file / ${candidate.fileName}`;
}

function conversationToUi(
  conversation: ChatConversationRecord,
  messages: ChatMessageRecord[],
  peer: RelayPeerInfo | null = null,
  localAgentInstanceId: string | null = conversation.local_agent_instance_id
) {
  const last = messages.at(-1);
  const title = peer?.displayName || conversation.title;
  const peerAgentInstanceId = peer?.agentInstanceId ?? conversation.peer_agent_instance_id;
  return {
    id: conversation.id,
    title,
    subtitle: peerAgentInstanceId
      ? `${peer?.email ? `${peer.email} · ` : ""}Relay peer ${shortId(peerAgentInstanceId)}`
      : "Single-device local mode",
    peerUserId: peer?.userId ?? conversation.peer_user_id,
    agentInstanceId: peerAgentInstanceId,
    presence: peerAgentInstanceId ? (peer?.presence ?? "unknown") : "online",
    unread: conversation.unread_count,
    readState: conversationReadStateToUi(conversation),
    lastMessage: last ? summarizeChatMessage(last) : "No messages yet",
    pendingApprovals: messages.filter((message) => message.message_type === "approval").length,
    transferCount: messages.filter((message) => message.message_type === "transfer" || message.message_type === "receipt").length,
    messages: messages.map((message) => messageToTimeline(message, localAgentInstanceId, messages))
  };
}

function conversationReadStateToUi(conversation: ChatConversationRecord): ConversationReadState {
  return {
    conversationId: conversation.id,
    lastReadMessageId: conversation.last_read_message_id ?? undefined,
    unreadCount: conversation.unread_count,
    mentionCount: conversation.mention_count
  };
}

function timelineMeta(message: ChatMessageRecord, localAgentInstanceId: string | null = null, conversationMessages: ChatMessageRecord[] = []): Record<string, unknown> {
  const payload = message.payload_json;
  const senderIsRemote = Boolean(
    localAgentInstanceId &&
    message.sender_agent_instance_id &&
    message.sender_agent_instance_id !== localAgentInstanceId
  );
  const isSystem = message.message_type === "system_event";
  const originSide = isSystem ? "system" : senderIsRemote ? "remote" : "local";
  const authorKind =
    isSystem ? "system"
    : message.message_type === "human" ? "user"
    : senderIsRemote ? "remote_agent"
    : "local_agent";
  const authorLabel =
    isSystem ? "System"
    : message.message_type === "human"
      ? senderIsRemote
        ? String(payload.sender_label ?? payload.sender ?? "Peer")
        : "You"
      : senderIsRemote
        ? String(payload.sender_label ?? payload.requester ?? payload.sender ?? "Remote agent")
        : "Agent";
  const replyToId = typeof payload.reply_to_id === "string" ? payload.reply_to_id : null;
  const explicitThreadId = typeof payload.thread_id === "string" ? payload.thread_id : null;
  const isThreadReply = Boolean(explicitThreadId && explicitThreadId !== message.id);
  const threadId = explicitThreadId ?? message.id;
  const summary = isThreadReply ? null : threadSummary(conversationMessages, threadId, localAgentInstanceId);
  return {
    client_message_id: message.id,
    origin_side: originSide,
    author_id: message.sender_user_id ?? message.sender_agent_instance_id ?? authorKind,
    author_kind: authorKind,
    author_label: authorLabel,
    author_avatar_url: typeof payload.author_avatar_url === "string" ? payload.author_avatar_url : null,
    reply_to_id: replyToId,
    reply_preview: replyToId ? replyPreview(conversationMessages, replyToId, localAgentInstanceId) : null,
    thread_id: typeof payload.thread_id === "string" ? payload.thread_id : null,
    thread_count: summary?.replyCount ?? 0,
    thread_summary: summary,
    pinned: Boolean(payload.pinned ?? false),
    reactions: Array.isArray(payload.reactions) ? payload.reactions : [],
    attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
    embeds: Array.isArray(payload.embeds) ? payload.embeds : [],
    moderation: payload.moderation && typeof payload.moderation === "object"
      ? payload.moderation
      : { state: "visible" }
  };
}

function threadReplies(messages: ChatMessageRecord[], threadId: string): ChatMessageRecord[] {
  return messages
    .filter((message) => message.id !== threadId && message.payload_json.thread_id === threadId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

function safeMessagePreview(message: ChatMessageRecord): string {
  const raw = message.text ?? String(message.payload_json.status_text ?? message.payload_json.request_text ?? "");
  const compact = raw.replace(/\s+/g, " ").trim();
  return compact.length > 140 ? `${compact.slice(0, 137)}...` : compact;
}

function timelineAuthorLabel(message: ChatMessageRecord, localAgentInstanceId: string | null): string {
  const payload = message.payload_json;
  const senderIsRemote = Boolean(
    localAgentInstanceId &&
    message.sender_agent_instance_id &&
    message.sender_agent_instance_id !== localAgentInstanceId
  );
  if (message.message_type === "system_event") return "System";
  if (message.message_type === "human") return senderIsRemote ? String(payload.sender_label ?? payload.sender ?? "Peer") : "You";
  return senderIsRemote ? String(payload.sender_label ?? payload.requester ?? payload.sender ?? "Remote agent") : "Agent";
}

function replyPreview(messages: ChatMessageRecord[], messageId: string, localAgentInstanceId: string | null): Record<string, unknown> | null {
  const source = messages.find((message) => message.id === messageId);
  if (!source) {
    return {
      messageId,
      authorLabel: "Unknown",
      textPreview: "Original message is unavailable",
      deleted: true
    };
  }
  const moderation = source.payload_json.moderation as Record<string, unknown> | undefined;
  const deleted = Boolean(source.payload_json.deleted_at) || moderation?.state === "deleted";
  return {
    messageId: source.id,
    authorLabel: timelineAuthorLabel(source, localAgentInstanceId),
    textPreview: deleted ? "This message was deleted." : safeMessagePreview(source),
    deleted
  };
}

function threadSummary(messages: ChatMessageRecord[], threadId: string, localAgentInstanceId: string | null): Record<string, unknown> | null {
  const replies = threadReplies(messages, threadId);
  if (replies.length === 0) return null;
  const participants = new Map<string, { id: string; label: string; avatarUrl?: string }>();
  for (const reply of replies) {
    const id = reply.sender_user_id ?? reply.sender_agent_instance_id ?? timelineAuthorLabel(reply, localAgentInstanceId);
    if (!participants.has(id)) {
      participants.set(id, {
        id,
        label: timelineAuthorLabel(reply, localAgentInstanceId),
        avatarUrl: typeof reply.payload_json.author_avatar_url === "string" ? reply.payload_json.author_avatar_url : undefined
      });
    }
  }
  return {
    threadId,
    replyCount: replies.length,
    lastReplyAt: replies.at(-1)?.created_at,
    participants: Array.from(participants.values()).slice(0, 8)
  };
}

function messageToTimeline(message: ChatMessageRecord, localAgentInstanceId: string | null = null, conversationMessages: ChatMessageRecord[] = []): Record<string, unknown> {
  const payload = message.payload_json;
  const meta = timelineMeta(message, localAgentInstanceId, conversationMessages);
  if (message.message_type === "human") {
    const isIncoming = Boolean(
      localAgentInstanceId &&
      message.sender_agent_instance_id &&
      message.sender_agent_instance_id !== localAgentInstanceId
    );
    return {
      ...meta,
      kind: "human",
      id: message.id,
      conversation_id: message.conversation_id,
      sender_user_id: message.sender_user_id,
      sender_agent_instance_id: message.sender_agent_instance_id,
      receiver_agent_instance_id: message.receiver_agent_instance_id,
      direction: isIncoming ? "incoming" : "outgoing",
      sender_label: isIncoming ? String(payload.sender_label ?? payload.sender ?? "Peer") : "You",
      text: message.text ?? "",
      created_at: message.created_at,
      delivery_status: message.delivery_status,
      relay_task_id: typeof payload.relay_task_id === "string" ? payload.relay_task_id : null,
      delivery_receipt: typeof payload.delivery_receipt === "object" && payload.delivery_receipt !== null ? payload.delivery_receipt : null,
      delivery_status_updated_at: typeof payload.delivery_status_updated_at === "string" ? payload.delivery_status_updated_at : null
    };
  }
  if (message.message_type === "file_request") {
    return {
      ...meta,
      kind: "file_request",
      id: message.id,
      task_id: message.task_id ?? String(payload.task_id ?? message.id),
      requester: String(payload.requester ?? "You"),
      target: String(payload.target ?? "Peer"),
      natural_language_request: String(payload.natural_language_request ?? message.text ?? ""),
      query: String(payload.query ?? message.text ?? ""),
      status: String(payload.status ?? message.delivery_status),
      created_at: message.created_at,
      details: payload
    };
  }
  if (message.message_type === "approval") {
    return {
      ...meta,
      kind: "approval",
      id: message.id,
      created_at: message.created_at,
      card: {
        approval_id: String(payload.approval_id ?? payload.approvalId ?? message.id),
        task_id: String(payload.task_id ?? payload.taskId ?? message.task_id ?? ""),
        requester: String(payload.requester ?? "remote agent"),
        request_text: String(payload.request_text ?? payload.requestText ?? message.text ?? "File request"),
        candidates: Array.isArray(payload.candidates) ? payload.candidates : [],
        selected_candidate_id: payload.selected_candidate_id ? String(payload.selected_candidate_id) : null,
        status: String(payload.status ?? "pending"),
        feedback_text: payload.feedback_text ? String(payload.feedback_text) : null,
        expires_at: String(payload.expires_at ?? message.created_at),
        privacy_labels: Array.isArray(payload.privacy_labels) ? payload.privacy_labels : ["Local path hidden from recipient", "Approval required"]
      }
    };
  }
  if (message.message_type === "transfer") {
    return {
      ...meta,
      kind: "transfer",
      id: message.id,
      transfer_id: String(payload.transfer_id ?? message.id),
      task_id: String(payload.task_id ?? message.task_id ?? ""),
      file_name: String(payload.file_name ?? message.text ?? "File"),
      size_bytes: Number(payload.size_bytes ?? 0),
      sha256: String(payload.sha256 ?? ""),
      progress_percent: Number(payload.progress_percent ?? 0),
      status: String(payload.status ?? "preparing"),
      created_at: message.created_at
    };
  }
  if (message.message_type === "receipt") {
    return {
      ...meta,
      kind: "receipt",
      id: message.id,
      transfer_id: String(payload.transfer_id ?? message.id),
      task_id: String(payload.task_id ?? message.task_id ?? ""),
      file_name: String(payload.file_name ?? message.text ?? "File"),
      size_bytes: Number(payload.size_bytes ?? 0),
      sha256: String(payload.sha256 ?? ""),
      sender: String(payload.sender ?? "remote agent"),
      stored_path_display: String(payload.stored_path_display ?? "Agentic App Storage"),
      received_at: message.created_at,
      hash_verified: Boolean(payload.hash_verified ?? false)
    };
  }
  if (message.message_type === "agent_status") {
    return {
      ...meta,
      kind: "agent_status",
      id: message.id,
      task_id: message.task_id ?? String(payload.task_id ?? message.id),
      status_text: message.text ?? "",
      phase: String(payload.phase ?? "working"),
      created_at: message.created_at,
      details: payload
    };
  }
  return {
    ...meta,
    kind: "system_event",
    id: message.id,
    event_type: String(payload.event_type ?? payload.severity ?? "info"),
    text: message.text ?? "",
    severity: String(payload.severity ?? "info"),
    created_at: message.created_at
  };
}

function summarizeChatMessage(message: ChatMessageRecord): string {
  if (message.text) return message.text;
  if (message.message_type === "approval") return "Approval required";
  if (message.message_type === "transfer") return "Transfer update";
  if (message.message_type === "receipt") return "File received";
  return message.message_type;
}

function appendApprovalDecisionTimeline(
  chatRepo: ChatRepository,
  taskId: string,
  decision: "approved" | "rejected" | "feedback",
  details: Record<string, unknown>
): void {
  const conversation = chatRepo.listConversations().find((item) =>
    chatRepo.getMessages(item.id).some((message) => message.task_id === taskId)
  );
  if (!conversation) return;
  if (decision === "approved") {
    const fileName = String(details.fileName ?? "Selected file");
    chatRepo.appendMessage({
      conversationId: conversation.id,
      taskId,
      messageType: "agent_status",
      text: `You approved ${fileName}`,
      payload: { phase: "approved", approval_id: details.approvalId },
      deliveryStatus: "delivered"
    });
    chatRepo.appendMessage({
      conversationId: conversation.id,
      taskId,
      messageType: "transfer",
      text: fileName,
      payload: {
        transfer_id: details.transferId ?? `pending_${taskId}`,
        task_id: taskId,
        file_name: fileName,
        size_bytes: Number(details.sizeBytes ?? 0),
        sha256: String(details.sha256 ?? ""),
        progress_percent: 100,
        status: "stored"
      },
      deliveryStatus: "delivered"
    });
    return;
  }
  if (decision === "rejected") {
    chatRepo.appendMessage({
      conversationId: conversation.id,
      taskId,
      messageType: "system_event",
      text: "File request rejected",
      payload: { severity: "warning", approval_id: details.approvalId },
      deliveryStatus: "delivered"
    });
    return;
  }
  chatRepo.appendMessage({
    conversationId: conversation.id,
    taskId,
    messageType: "agent_status",
    text: "Feedback submitted. Search is being refined.",
    payload: { phase: "feedback_requested", approval_id: details.approvalId, feedback: details.feedback },
    deliveryStatus: "delivered"
  });
}

function appendRefinedApprovalTimeline(
  chatRepo: ChatRepository,
  taskId: string,
  approvalId: string,
  feedback: string,
  candidates: Array<Record<string, unknown>>
): void {
  const conversation = chatRepo.listConversations().find((item) =>
    chatRepo.getMessages(item.id).some((message) => message.task_id === taskId)
  );
  if (!conversation) return;
  chatRepo.appendMessage({
    conversationId: conversation.id,
    taskId,
    messageType: "approval",
    text: "Updated approval required",
    payload: {
      approval_id: approvalId,
      task_id: taskId,
      requester: "remote agent",
      request_text: feedback ? `Refined search: ${feedback}` : "Refined file request",
      status: "pending",
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      selected_candidate_id: candidates[0]?.candidate_id ? String(candidates[0].candidate_id) : null,
      feedback_text: feedback,
      candidates
    },
    deliveryStatus: "delivered"
  });
}

function approvalToSafeResponse(approval: {
  id: string;
  taskId: string;
  approvalType: string;
  requesterAgentId: string;
  ownerAgentId: string;
  status: string;
  selectedFileId: string | null;
  boundFilePath: string | null;
  boundSha256: string | null;
  boundSizeBytes: number | null;
  feedbackText: string | null;
  expiresAt: string;
  createdAt: string;
  decidedAt: string | null;
}): Record<string, unknown> {
  const fileName = approval.boundFilePath ? basename(approval.boundFilePath) : "Selected local file";
  const candidates = approval.selectedFileId ? [{
    candidate_id: approval.selectedFileId,
    file_name: fileName,
    display_path: "Local path hidden from recipient",
    extension: extname(fileName).toLowerCase(),
    mime_type: "application/octet-stream",
    size_bytes: approval.boundSizeBytes ?? 0,
    modified_at: approval.createdAt,
    match_score: approval.boundFilePath ? 1 : 0,
    match_reason: approval.boundFilePath ? "Bound approval candidate" : "No bound local file",
    safety_labels: ["Approval required", "Local path hidden from recipient"]
  }] : [];

  return {
    id: approval.id,
    task_id: approval.taskId,
    approval_type: approval.approvalType,
    requester_agent_id: approval.requesterAgentId,
    requester_display_name: approvalRequesterDisplayName(approval.id, approval.requesterAgentId),
    owner_agent_id: approval.ownerAgentId,
    status: approval.status,
    selected_file_id: approval.selectedFileId,
    bound_sha256: approval.boundSha256,
    bound_size_bytes: approval.boundSizeBytes,
    feedback_text: approval.feedbackText,
    expires_at: approval.expiresAt,
    created_at: approval.createdAt,
    decided_at: approval.decidedAt,
    candidates
  };
}

function approvalRequesterDisplayName(approvalId: string, fallback: string): string {
  try {
    const repo = new ChatRepository();
    for (const conversation of repo.listConversations()) {
      for (const message of repo.getMessages(conversation.id)) {
        const payload = message.payload_json;
        if (payload.approval_id !== approvalId) continue;
        const requester = typeof payload.requester === "string" ? payload.requester.trim() : "";
        if (requester && !isRawAgentId(requester)) return requester;
        if (conversation.title && !/^Remote agent ag/i.test(conversation.title)) return conversation.title;
      }
    }
  } catch {
    // Keep approval serialization safe even if chat history is unavailable.
  }
  return isRawAgentId(fallback) ? "Remote agent" : fallback;
}

function isRawAgentId(value: string): boolean {
  return /^ag[ei][_-]/i.test(value.trim()) || /^Remote agent ag[ei][_-]/i.test(value.trim());
}

function isUnboundFileTransferApproval(approval: {
  approvalType: string;
  boundFilePath: string | null;
  boundSha256: string | null;
  boundSizeBytes: number | null;
}): boolean {
  return (approval.approvalType === "file.transfer.offer" || approval.approvalType === "file.search.refinement") && (
    !approval.boundFilePath ||
    !approval.boundSha256 ||
    approval.boundSizeBytes == null
  );
}

function shortId(value: string): string {
  return value.length <= 14 ? value : `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function writeSse(raw: NodeJS.WritableStream, event: string, data: unknown): void {
  raw.write(`event: ${event}\n`);
  raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const host = process.env.SANDBOX_HOST ?? "127.0.0.1";
  const port = Number(process.env.SANDBOX_PORT ?? 3399);
  const server = buildServer();
  await server.listen({ host, port });
  console.log(`sandbox tool server listening on http://${host}:${port}`);
}
