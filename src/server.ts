import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyReply } from "fastify";
import { z, ZodError, type ZodSchema } from "zod";
import { SandboxTool } from "./agent-tools/SandboxTool.js";
import {
  CloneRepoAndRunTestsSchema,
  CreateSandboxSessionSchema,
  RunCodeSchema,
  RunShellCommandSchema
} from "./agent-tools/ToolSchemas.js";
import { AgentRunService } from "./agent-runs/AgentRunService.js";
import type { AgentReasoner } from "./agent-runs/AgentDecision.js";
import { FileSearchService } from "./file-search/FileSearchService.js";
import { createLogger } from "./logging/Logger.js";
import { PersonalAgentProtocol } from "./protocol/PersonalAgentProtocol.js";
import { indexRoot, reindexAll } from "./retrieval/FileIndexer.js";
import { search as hybridSearch } from "./retrieval/HybridRetrievalPipeline.js";
import { createIntentExtractor } from "./intent/IntentExtractor.js";
import { createQueryRewriter } from "./intent/QueryRewriter.js";
import { refine as refineSearch } from "./retrieval/FeedbackRefiner.js";
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
import { getEvents, verifyChain } from "./security/AuditHashChain.js";
import { append as memAppend, getWindow as memGetWindow } from "./memory/ShortTermMemory.js";
import { record as epRecord } from "./memory/EpisodicMemory.js";
import { sendNotification as notifyBridge } from "./notification/NotificationBridgeClient.js";
import { deleteAgent, getAgent, listAgents, setTrustLevel, upsertAgent, type TrustLevel } from "./registry/AgentRegistry.js";
import { discoverAndRegister, refreshAgent } from "./registry/AgentDiscovery.js";
import { listStoredFiles, getStoredFile } from "./storage/AgenticStorage.js";
import { createTask as wfCreateTask, transition as wfTransition, listTasks as wfListTasks, getTask as wfGetTask } from "./workflow/TaskWorkflow.js";
import { getDb, resolveDbPath } from "./db/connection.js";
import { generateOrLoadIdentity } from "./security/DeviceIdentity.js";
import { CloudError, ControlPlaneClient } from "./cloud/ControlPlaneClient.js";
import { DirectoryClient } from "./cloud/DirectoryClient.js";
import { RelayClient } from "./cloud/RelayClient.js";
import { LocalCloudIdentityStore, defaultControlPlaneUrl, defaultProfileId, type LocalCloudIdentity } from "./cloud/LocalCloudIdentityStore.js";
import { DeviceEnrollmentService } from "./enrollment/DeviceEnrollmentService.js";
import { AgentRegistrationService } from "./enrollment/AgentRegistrationService.js";
import { HeartbeatService } from "./runtime/HeartbeatService.js";
import { InboxPoller } from "./runtime/InboxPoller.js";
import { RemoteTaskDispatcher } from "./runtime/RemoteTaskDispatcher.js";
import { ApprovalTransferOrchestrator } from "./runtime/ApprovalTransferOrchestrator.js";
import { ChatRepository, type ChatConversationRecord, type ChatMessageRecord } from "./chat/ChatRepository.js";

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

const FileIndexSchema = z.object({
  roots: z.array(z.string().trim().min(1)).default([])
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
  to_agent_instance_id: z.string().trim().min(1),
  text: z.string().trim().min(1).max(2000),
  a2a_task_id: z.string().trim().min(1).max(120).optional(),
  idempotency_key: z.string().trim().min(1).max(200).optional(),
  conversation_id: z.string().trim().min(1).max(200).optional(),
  message_id: z.string().trim().min(1).max(200).optional()
});

const DEFAULT_DEV_ORG_SLUG = "local-dev";

export function buildServer(
  tool = new SandboxTool(),
  fileSearch = new FileSearchService(),
  reasoner?: AgentReasoner
) {
  const logger = createLogger();
  const server = Fastify({ logger: false, rewriteUrl: getA2Av1UrlRewriter() });
  // A2A v1.0.0 uses `application/a2a+json` as its content type
  server.addContentTypeParser("application/a2a+json", { parseAs: "string" }, (_req, body, done) => {
    try { done(null, body ? JSON.parse(body as string) : {}); } catch (err) { done(err as Error, undefined); }
  });
  const requestStartTimes = new WeakMap<object, number>();
  const publicDir = resolve(process.cwd(), "public");
  const agentRuns = new AgentRunService(tool, fileSearch, reasoner);
  const protocol = new PersonalAgentProtocol();
  const intentExtractor = createIntentExtractor();
  const cloudStore = new LocalCloudIdentityStore();
  const deviceEnrollment = new DeviceEnrollmentService(cloudStore);
  const agentRegistration = new AgentRegistrationService(cloudStore);
  const chatRepo = new ChatRepository(getDb());
  const approvalTransfers = new ApprovalTransferOrchestrator(getDb(), cloudStore, defaultProfileId(), chatRepo);

  // Eagerly init identity with resolved db path so handlers don't re-read process.env
  const dbPath = resolveDbPath();
  const identity = generateOrLoadIdentity("Local User", dbPath);
  protocol.setIdentityPath(identity, dbPath);
  const remoteDispatcher = new RemoteTaskDispatcher(protocol, getDb(), defaultProfileId());
  const heartbeatService = new HeartbeatService(cloudStore, defaultProfileId());
  const inboxPoller = new InboxPoller(cloudStore, remoteDispatcher, defaultProfileId());

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

  server.addHook("onRequest", async (request) => {
    requestStartTimes.set(request, Date.now());
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
  });

  server.get("/health", async () => ({
    status: "ok",
    dryRun: process.env.SANDBOX_DRY_RUN === "true",
    localAgentUrl: localAgentUrl(),
    controlPlaneUrl: defaultControlPlaneUrl(),
    defaultOrgSlug: defaultOrgSlug()
  }));

  server.get("/profile", async () => {
    const identity = protocol.createLocalIdentity();
    return {
      agentId: identity.agentId,
      deviceId: identity.deviceId,
      did: identity.did,
      mode: "single-device",
      storageRoot: process.env.AGENTIC_STORAGE_ROOT ?? "./storage"
    };
  });

  server.post("/profile/init", async () => ({
    identity: protocol.createLocalIdentity(),
    session: protocol.createPeerSession({ agentId: protocol.createLocalIdentity().agentId, did: protocol.createLocalIdentity().did, publicKey: protocol.createLocalIdentity().publicKey, trustLevel: "local" })
  }));

  server.post("/cloud/signup", async (request) => {
    const body = parseBody(CloudAuthSchema, request.body);
    return deviceEnrollment.signup({
      email: body.email,
      password: body.password,
      display_name: body.display_name ?? body.email,
      org_slug: body.org_slug
    }, { controlPlaneUrl: body.control_plane_url ?? defaultControlPlaneUrl() });
  });

  server.post("/cloud/login", async (request) => {
    const body = parseBody(CloudAuthSchema.omit({ display_name: true }).extend({ display_name: z.string().optional() }), request.body);
    return deviceEnrollment.login({
      email: body.email,
      password: body.password,
      org_slug: body.org_slug
    }, { controlPlaneUrl: body.control_plane_url ?? defaultControlPlaneUrl() });
  });

  server.post("/cloud/logout", async () => {
    heartbeatService.stop();
    inboxPoller.stop();
    return deviceEnrollment.logout();
  });

  server.post("/cloud/enroll", async (request) => {
    const body = parseBody(CloudEnrollSchema, request.body ?? {});
    const result = await agentRegistration.enroll({
      deviceName: body.device_name,
      agentDisplayName: body.agent_display_name,
      version: body.version,
      capabilities: body.capabilities,
      agentCard: body.agent_card
    });
    if (process.env.AGENTIC_DISABLE_RUNTIME_AUTOSTART !== "true") {
      heartbeatService.start();
      inboxPoller.start();
    }
    return result;
  });

  server.get("/cloud/status", async () => {
    const cloud = cloudStore.getOrCreate();
    return {
      cloud: publicCloudIdentity(cloud),
      heartbeat: heartbeatService.status(),
      inbox: inboxPoller.status(),
      relayMode: process.env.AGENTIC_RELAY_MODE ?? "polling",
      defaults: {
        localAgentUrl: localAgentUrl(),
        controlPlaneUrl: defaultControlPlaneUrl(),
        orgSlug: defaultOrgSlug()
      }
    };
  });

  server.get("/cloud/me", async (request, reply) => {
    const cloud = requireCloudIdentity(cloudStore.get(), reply);
    if (!cloud) return;
    const token = requireUserAccessToken(cloud, reply);
    if (!token) return;
    const me = await new (await import("./cloud/AuthClient.js")).AuthClient(new ControlPlaneClient(cloud.controlPlaneUrl)).me(token);
    return me;
  });

  server.get("/cloud/directory/users", async (request, reply) => {
    const cloud = requireCloudIdentity(cloudStore.get(), reply);
    if (!cloud) return;
    const token = requireUserAccessToken(cloud, reply);
    if (!token) return;
    const q = ((request.query as { q?: string })?.q ?? "").trim();
    return new DirectoryClient(new ControlPlaneClient(cloud.controlPlaneUrl)).searchUsers(q, token);
  });

  server.get("/cloud/directory/users/:user_id/agents", async (request, reply) => {
    const cloud = requireCloudIdentity(cloudStore.get(), reply);
    if (!cloud) return;
    const token = requireUserAccessToken(cloud, reply);
    if (!token) return;
    const { user_id } = request.params as { user_id: string };
    return new DirectoryClient(new ControlPlaneClient(cloud.controlPlaneUrl)).getUserAgents(user_id, token);
  });

  server.get("/cloud/contacts", async (_request, reply) => {
    const cloud = requireCloudIdentity(cloudStore.get(), reply);
    if (!cloud) return;
    const token = requireUserAccessToken(cloud, reply);
    if (!token) return;
    return new DirectoryClient(new ControlPlaneClient(cloud.controlPlaneUrl)).listContacts(token);
  });

  server.post("/cloud/contacts/request", async (request, reply) => {
    const cloud = requireCloudIdentity(cloudStore.get(), reply);
    if (!cloud) return;
    const token = requireUserAccessToken(cloud, reply);
    if (!token) return;
    const body = parseBody(ContactRequestSchema, request.body);
    return new DirectoryClient(new ControlPlaneClient(cloud.controlPlaneUrl)).requestContact(body.target_user_id, token);
  });

  server.post("/cloud/contacts/:contact_id/accept", async (request, reply) => {
    const cloud = requireCloudIdentity(cloudStore.get(), reply);
    if (!cloud) return;
    const token = requireUserAccessToken(cloud, reply);
    if (!token) return;
    const { contact_id } = request.params as { contact_id: string };
    return new DirectoryClient(new ControlPlaneClient(cloud.controlPlaneUrl)).acceptContact(contact_id, token);
  });

  server.get("/relay/inbox/status", async () => inboxPoller.status());

  server.post("/relay/send-message", async (request, reply) => {
    const cloud = requireCloudIdentity(cloudStore.get(), reply);
    if (!cloud) return;
    const token = requireDeviceAccessToken(cloud, reply);
    if (!token) return;
    const body = parseBody(RelaySendSchema, request.body);
    const result = await new RelayClient(new ControlPlaneClient(cloud.controlPlaneUrl)).send({
      to_agent_instance_id: body.to_agent_instance_id,
      a2a_task_id: body.a2a_task_id ?? randomUUID(),
      type: "message.send",
      payload: { kind: "message", text: body.text },
      idempotency_key: body.idempotency_key
    }, token);
    if (body.message_id) chatRepo.markMessageStatus(body.message_id, "sent");
    return result;
  });

  server.post("/relay/send-file-request", async (request, reply) => {
    const cloud = requireCloudIdentity(cloudStore.get(), reply);
    if (!cloud) return;
    const token = requireDeviceAccessToken(cloud, reply);
    if (!token) return;
    const body = parseBody(RelaySendSchema, request.body);
    const a2aTaskId = body.a2a_task_id ?? randomUUID();
    const result = await new RelayClient(new ControlPlaneClient(cloud.controlPlaneUrl)).send({
      to_agent_instance_id: body.to_agent_instance_id,
      a2a_task_id: a2aTaskId,
      type: "file.request",
      payload: { kind: "file_request", text: body.text, requestText: body.text },
      idempotency_key: body.idempotency_key
    }, token);
    if (body.message_id) chatRepo.markMessageStatus(body.message_id, "sent");
    if (body.conversation_id) {
      chatRepo.appendMessage({
        conversationId: body.conversation_id,
        taskId: a2aTaskId,
        senderAgentInstanceId: cloud.agentInstanceId,
        receiverAgentInstanceId: body.to_agent_instance_id,
        messageType: "agent_status",
        text: "Waiting for remote approval",
        payload: { relay_task_id: result.relay_task_id, phase: "input_required" },
        deliveryStatus: "sent"
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
        list.push({ taskId: task.id, pushNotificationConfig: configuration.pushNotificationConfig });
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
        list.push({ taskId: task.id, pushNotificationConfig: configuration.pushNotificationConfig });
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
      const stored: TaskPushNotificationConfig = { taskId, pushNotificationConfig: { ...config, id } };
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
    requireRemoteAuth: process.env.AGENTIC_A2A_REMOTE_AUTH_REQUIRED === "true",
    verifyAuth: async (request, tenant) => {
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "").trim();
      if (!token) return null;
      const identity = cloudStore.get();
      if (!identity?.deviceAccessToken || identity.deviceAccessToken !== token) return null;
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

  server.post("/skills", async (request, reply) => {
    const body = (request.body ?? {}) as { path?: string; manifest?: any; body?: string };
    if (!body.path) return reply.status(400).send({ error: "path required" });
    if (!body.manifest?.id || !body.manifest?.name) return reply.status(400).send({ error: "manifest.id and manifest.name required" });
    try {
      await writeSkill(body.path, {
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
      const loaded = await loadSkillFromDir(body.path);
      if (loaded) skillRegistry.upsert(loaded);
      return reply.send({ ok: true, skill: loaded });
    } catch (err) {
      return reply.status(500).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  server.delete("/skills/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const skill = skillRegistry.get(params.id);
    if (!skill) return reply.status(404).send({ error: "Skill not found" });
    try {
      await deleteSkill(skill.path);
      skillRegistry.remove(params.id);
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

  server.post("/registry", async (request, reply) => {
    const body = (request.body ?? {}) as {
      did?: string;
      name?: string;
      description?: string;
      agentCardUrl?: string;
      anpEndpoint?: string;
      supportedProtocols?: string[];
      skills?: string[];
      trustLevel?: TrustLevel;
      notes?: string;
      autoFetch?: boolean;
    };
    if (!body.did || !body.name) return reply.status(400).send({ error: "did and name required" });
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

  server.delete("/registry/:did", async (request, reply) => {
    const params = request.params as { did: string };
    const decoded = decodeURIComponent(params.did);
    const ok = deleteAgent(decoded);
    if (!ok) return reply.status(404).send({ error: "Agent not found" });
    return { ok: true };
  });

  server.put("/registry/:did/trust", async (request, reply) => {
    const params = request.params as { did: string };
    const body = (request.body ?? {}) as { trustLevel?: TrustLevel };
    if (!body.trustLevel) return reply.status(400).send({ error: "trustLevel required" });
    const allowed: TrustLevel[] = ["local", "loopback", "trusted", "discovered", "blocked"];
    if (!allowed.includes(body.trustLevel)) return reply.status(400).send({ error: "invalid trustLevel" });
    const updated = setTrustLevel(decodeURIComponent(params.did), body.trustLevel);
    if (!updated) return reply.status(404).send({ error: "Agent not found" });
    return updated;
  });

  server.post("/registry/:did/refresh", async (request, reply) => {
    const params = request.params as { did: string };
    const decoded = decodeURIComponent(params.did);
    const result = await refreshAgent(decoded);
    if (!result) return reply.status(404).send({ ok: false, error: "Agent not found or no agentCardUrl" });
    return { ok: true, did: decoded, cardHash: result.cardHash };
  });

  server.post("/registry/discover", async (request, reply) => {
    const body = (request.body ?? {}) as { url?: string; trustLevel?: TrustLevel };
    if (!body.url) return reply.status(400).send({ error: "url required" });
    try {
      const result = await discoverAndRegister({ url: body.url, trustLevel: body.trustLevel });
      return reply.send({ ok: true, did: result.did, cardHash: result.cardHash, card: result.card });
    } catch (err) {
      return reply.status(502).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
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
    approvalId: string;
    candidates: Array<{ id: number; fileName: string; displayPath: string; extension: string; sizeBytes: number; modifiedAt: string; score: number; reason: string }>;
  }> {
    const intent = intentExtractor.extract(text);
    const task = wfCreateTask({ contextId: conversationId, type: "file.request.search", metadata: { query: text, intent }, actorAgentId: "local-user" });
    wfTransition(task.id, "INTENT_CLASSIFIED", { intent: intent.intent });
    wfTransition(task.id, "SEARCH_QUERY_BUILT", { query: text });
    const queryRewriter = createQueryRewriter();
    const rewritten = queryRewriter.rewrite(text);
    const searchQuery = rewritten.semanticQuery || text;
    const extensions = (rewritten.extensions.length > 0 ? rewritten.extensions : intent.extensions).length > 0
      ? { extensions: (rewritten.extensions.length > 0 ? rewritten.extensions : intent.extensions) }
      : undefined;
    wfTransition(task.id, "LOCAL_SEARCH_RUNNING", { query: searchQuery });
    const candidates = hybridSearch(searchQuery, { ...extensions, limit: 10 });
    wfTransition(task.id, "CANDIDATES_RANKED", { count: candidates.length });
    const topCandidate = candidates[0];
    const approval = await protocol.createApproval(task.id, {
      approvalType: "file.transfer.offer",
      requesterAgentId: "local-user",
      ownerAgentId: protocol.createLocalIdentity().agentId,
      selectedFileId: topCandidate ? String(topCandidate.id) : null,
      boundFilePath: topCandidate?.filePath ?? null,
      boundSha256: null,
      boundSizeBytes: topCandidate?.sizeBytes ?? null,
    });
    wfTransition(task.id, "APPROVAL_REQUIRED", { approvalId: approval.id, candidateCount: candidates.length });
    if (sourceMessageId) chatRepo.markMessageStatus(sourceMessageId, "delivered");
    chatRepo.appendMessage({
      conversationId,
      taskId: task.id,
      senderAgentInstanceId: protocol.createLocalIdentity().agentId,
      messageType: "agent_status",
      text: candidates.length > 0 ? `Your agent found ${candidates.length} candidates` : "Your agent did not find matching files",
      payload: { phase: candidates.length > 0 ? "input_required" : "completed" },
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
          candidate_id: String(candidate.id),
          file_name: candidate.fileName,
          display_path: candidate.displayPath,
          extension: candidate.extension,
          mime_type: "application/octet-stream",
          size_bytes: candidate.sizeBytes,
          modified_at: candidate.modifiedAt,
          match_score: candidate.score,
          match_reason: candidate.reason,
          safety_labels: ["Approval required", "Local path hidden from recipient"]
        }))
      },
      deliveryStatus: "delivered"
    });
    if (topCandidate) {
      const callbackPort = Number(process.env.SANDBOX_PORT ?? 3399);
      notifyBridge({
        approvalId: approval.id,
        taskId: task.id,
        candidateId: String(topCandidate.id),
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
      approvalId: approval.id,
      candidates: candidates.map((c) => ({
        id: c.id, fileName: c.fileName, displayPath: c.displayPath, extension: c.extension,
        sizeBytes: c.sizeBytes, modifiedAt: c.modifiedAt, score: c.score, reason: c.reason,
      }))
    };
  }

  server.post("/chat/messages", async (request) => {
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
      approvalType: "file.transfer.offer",
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
      notifyBridge({
        approvalId: approval.id,
        taskId: task.id,
        candidateId: String(topCandidate.id),
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

  server.post("/chat/conversations", async (request) => {
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
      text: body.peer_agent_instance_id ? "Relay chat ready. File requests become A2A tasks." : "Local chat ready.",
      payload: { severity: "success" },
      deliveryStatus: "delivered"
    });
    return { conversation: conversationToUi(conversation, chatRepo.getMessages(conversation.id)) };
  });

  server.get("/chat/conversations", async () => {
    const cloud = cloudStore.get();
    chatRepo.getOrCreateLocalConversation(cloud?.agentInstanceId ?? localIdentity.agentId);
    return {
      conversations: chatRepo.listConversations().map((conversation) =>
        conversationToUi(conversation, chatRepo.getMessages(conversation.id))
      )
    };
  });

  server.get("/chat/conversations/:id/messages", async (request) => {
    const { id } = request.params as { id: string };
    const messages = chatRepo.getMessages(id).map(messageToTimeline);
    return { conversationId: id, messages };
  });

  server.post("/chat/conversations/:id/messages", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = parseBody(ChatConversationSendSchema, request.body);
    const cloud = cloudStore.get();
    const conversation = chatRepo.getConversation(id);
    if (!conversation) return reply.status(404).send({ error: "Conversation not found" });
    const messageId = body.client_message_id ?? `msg_${randomUUID()}`;
    const isFileRequest = body.send_as === "file_request";
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
      const token = cloud?.deviceAccessToken;
      if (!cloud || !token) {
        chatRepo.markMessageStatus(messageId, "failed", "Device is not enrolled.");
        chatRepo.queueOutbox(messageId, id, { text: body.text, send_as: body.send_as }, "Device is not enrolled.");
        return reply.status(409).send({ error: "Device is not enrolled.", conversation_id: id, message_id: messageId });
      }
      try {
        const relay = await new RelayClient(new ControlPlaneClient(cloud.controlPlaneUrl)).send({
          to_agent_instance_id: conversation.peer_agent_instance_id,
          a2a_task_id: a2aTaskId ?? randomUUID(),
          type: isFileRequest ? "file.request" : "message.send",
          payload: isFileRequest
            ? { kind: "file_request", text: body.text, requestText: body.text }
            : { kind: "message", text: body.text },
          idempotency_key: body.idempotency_key ?? `ui-${messageId}`
        }, token);
        chatRepo.markMessageStatus(messageId, "sent");
        if (isFileRequest) {
          chatRepo.appendMessage({
            conversationId: id,
            taskId: a2aTaskId,
            senderAgentInstanceId: cloud.agentInstanceId,
            receiverAgentInstanceId: conversation.peer_agent_instance_id,
            messageType: "agent_status",
            text: "Waiting for remote approval",
            payload: { relay_task_id: relay.relay_task_id, phase: "input_required" },
            deliveryStatus: "sent"
          });
        }
        return {
          ok: true,
          conversation_id: id,
          message_id: messageId,
          relay_task_id: relay.relay_task_id,
          task_id: a2aTaskId ?? undefined,
          type: isFileRequest ? "file_request" : "message",
          delivery_status: "sent"
        };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        chatRepo.markMessageStatus(messageId, "failed", error);
        chatRepo.queueOutbox(messageId, id, { text: body.text, send_as: body.send_as }, error);
        return reply.status(503).send({ error, conversation_id: id, message_id: messageId });
      }
    }

    if (!isFileRequest) {
      chatRepo.markMessageStatus(messageId, "delivered");
      chatRepo.appendMessage({
        conversationId: id,
        senderAgentInstanceId: localIdentity.agentId,
        messageType: "agent_status",
        text: `I received your message: "${body.text}". This is a personal agent chat.`,
        payload: { phase: "completed" },
        deliveryStatus: "delivered"
      });
      return { ok: true, conversation_id: id, message_id: messageId, type: "message", delivery_status: "delivered" };
    }

    const local = await localFileRequestFlow(body.text, id, messageId);
    return {
      ok: true,
      conversation_id: id,
      message_id: messageId,
      task_id: local.taskId,
      type: "approval_required",
      delivery_status: "delivered"
    };
  });

  server.post("/files/index-roots", async (request) => {
    const { roots } = parseBody(FileIndexSchema, request.body ?? {});
    const results: Array<{ root: string; indexed: number }> = [];
    for (const root of roots ?? []) {
      const count = await indexRoot(root);
      results.push({ root, indexed: count });
    }
    return { ok: true, roots: results };
  });

  server.get("/files/index-roots", async () => ({ roots: fileSearch.getRoots() }));

  server.post("/files/reindex", async (request) => {
    const { roots } = parseBody(FileIndexSchema, request.body ?? {});
    const results: Array<{ root: string; indexed: number }> = [];
    for (const root of roots ?? []) {
      const count = await reindexAll(root);
      results.push({ root, indexed: count });
    }
    return { ok: true, message: "Incremental reindex completed.", roots: results };
  });

  server.post("/files/search", async (request) => {
    const { query } = parseBody(FileSearchSchema, request.body);
    const queryRewriter = createQueryRewriter();
    const rewritten = queryRewriter.rewrite(query);
    const searchQuery = rewritten.semanticQuery || query;
    const extensions = rewritten.extensions.length > 0 ? { extensions: rewritten.extensions } : undefined;
    const results = hybridSearch(searchQuery, { ...extensions, limit: 20 });
    return results;
  });

  server.get("/files/indexed", async (request) => {
    const q = (request.query ?? {}) as { limit?: string; offset?: string };
    const limit = Math.max(1, Math.min(500, Number(q.limit ?? 100)));
    const offset = Math.max(0, Number(q.offset ?? 0));
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, file_path, display_path, file_name, extension, size_bytes, modified_at
      FROM file_index
      ORDER BY modified_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as Array<Record<string, unknown>>;
    const total = (db.prepare("SELECT COUNT(*) as n FROM file_index").get() as { n: number }).n;
    const items = rows.map((r) => ({
      id: Number(r.id),
      filePath: r.file_path as string,
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

  server.get("/approvals/pending", async () => ({ approvals: protocol.listApprovals().filter((item) => item.status === "pending") }));

  server.get("/approvals/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const approval = protocol.getApproval(id);
    if (!approval) return reply.status(404).send({ error: "Approval not found" });
    return approval;
  });

  server.post("/approvals/:id/approve", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { idempotency_key?: string };
    const decision = protocol.applyApprovalDecisionWithResult(id, "approve", { idempotencyKey: body.idempotency_key });
    if (!decision.approval) return reply.status(404).send({ error: "Approval not found" });
    if (decision.outcome === "denied") return reply.status(409).send({ error: decision.error, approval: decision.approval });
    const cloudTransfer = await approvalTransfers.scheduleForApproval(decision.approval);
    if (decision.outcome === "applied") {
      appendApprovalDecisionTimeline(chatRepo, decision.approval.taskId, "approved", {
        approvalId: decision.approval.id,
        fileName: decision.approval.boundFilePath ? decision.approval.boundFilePath.split(/[\\/]/).pop() : "Selected file",
        sha256: decision.approval.boundSha256,
        sizeBytes: decision.approval.boundSizeBytes,
        transferId: cloudTransfer.transferId ?? undefined
      });
    }
    return { ...decision.approval, cloudTransfer };
  });

  server.post("/approvals/:id/rebind-file", async (request, reply) => {
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
      SET selected_file_id = ?, bound_file_path = ?, bound_size_bytes = ?, bound_sha256 = ?
      WHERE id = ?
    `).run(String(row.id), row.file_path, row.size_bytes, hash.digest("hex"), id);
    return protocol.getApproval(id);
  });

  server.post("/approvals/:id/reject", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { idempotency_key?: string };
    const decision = protocol.applyApprovalDecisionWithResult(id, "reject", { idempotencyKey: body.idempotency_key });
    if (!decision.approval) return reply.status(404).send({ error: "Approval not found" });
    if (decision.outcome === "denied") return reply.status(409).send({ error: decision.error, approval: decision.approval });
    if (decision.outcome === "applied") {
      appendApprovalDecisionTimeline(chatRepo, decision.approval.taskId, "rejected", { approvalId: decision.approval.id });
    }
    return decision.approval;
  });

  server.post("/approvals/:id/feedback", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { feedback?: string; rejectedFileIds?: number[]; originalQuery?: string };
    const decision = protocol.applyApprovalDecisionWithResult(id, "feedback", {
      feedback: body.feedback,
      idempotencyKey: `${id}|feedback|${body.feedback ?? ""}`
    });
    const approval = decision.approval;
    if (!approval) return reply.status(404).send({ error: "Approval not found" });
    if (decision.outcome === "denied") return reply.status(409).send({ error: decision.error, approval });
    if (decision.outcome === "replay") return { approval, newApproval: null, candidates: [] };
    appendApprovalDecisionTimeline(chatRepo, approval.taskId, "feedback", { approvalId: approval.id, feedback: body.feedback });

    // Re-run search with feedback: refine the query and exclude the previously rejected file IDs.
    const originalQuery = body.originalQuery ?? (approval.taskId ? (wfGetTask(approval.taskId)?.metadataJson?.query as string | undefined) ?? "" : "");
    const rejectedIds = body.rejectedFileIds ?? (approval.selectedFileId ? [Number(approval.selectedFileId)] : []);
    const refined = refineSearch(originalQuery, body.feedback ?? "", rejectedIds);

    // Transition to SEARCH_REFINED
    try { wfTransition(approval.taskId, "SEARCH_REFINED", { refinedQuery: refined.newQuery, rejected: rejectedIds }); } catch { /* already */ }

    // Re-search with new query and exclusions
    const newCandidates = hybridSearch(refined.newQuery, {
      ...refined.searchOptions,
      limit: 10,
    });

    // Create a new approval for the new top candidate
    const top = newCandidates[0];
    const newApproval = await protocol.createApproval(approval.taskId, {
      approvalType: "file.transfer.offer",
      requesterAgentId: approval.requesterAgentId,
      ownerAgentId: approval.ownerAgentId,
      selectedFileId: top ? String(top.id) : null,
      boundFilePath: top?.filePath ?? null,
      boundSha256: null,
      boundSizeBytes: top?.sizeBytes ?? null,
    });
    try { wfTransition(approval.taskId, "APPROVAL_REQUIRED", { approvalId: newApproval.id, candidateCount: newCandidates.length, refined: true }); } catch { /* ignore */ }
    appendRefinedApprovalTimeline(chatRepo, approval.taskId, newApproval.id, body.feedback ?? "", newCandidates.map((candidate) => ({
      candidate_id: String(candidate.id),
      file_name: candidate.fileName,
      display_path: candidate.displayPath,
      extension: candidate.extension,
      mime_type: "application/octet-stream",
      size_bytes: candidate.sizeBytes,
      modified_at: candidate.modifiedAt,
      match_score: candidate.score,
      match_reason: candidate.reason,
      safety_labels: ["Approval required", "Local path hidden from recipient"]
    })));

    return {
      ok: true,
      previousApproval: approval,
      refinedSearch: refined,
      candidates: newCandidates,
      newApproval,
    };
  });

  server.post("/approvals/notification-callback", async (request) => {
    const body = (request.body ?? {}) as { approvalId?: string; taskId?: string; action?: string; feedback?: string; idempotencyKey?: string; idempotency_key?: string };
    const action = (body.action ?? "approve") as "approve" | "reject" | "feedback";
    if (action !== "approve" && action !== "reject" && action !== "feedback") {
      return { ok: false, status: "invalid", error: `Unknown action: ${body.action}` };
    }
    const current = protocol.getApproval(body.approvalId ?? "");
    if (!current) return { ok: false, status: "not-found" };
    if (current.taskId !== (body.taskId ?? "")) {
      return { ok: false, status: "task-mismatch" };
    }
    const decision = protocol.applyApprovalDecisionWithResult(body.approvalId ?? "", action, {
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

  server.get("/transfers", async () => {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM transfers ORDER BY created_at DESC").all() as Array<Record<string, unknown>>;
    return { transfers: rows };
  });

  server.get("/storage/files", async () => {
    const files = listStoredFiles();
    return { files };
  });

  server.get("/storage/files/:id/open", async (request, reply) => {
    const { id } = request.params as { id: string };
    const stored = getStoredFile(id);
    if (!stored) return reply.status(404).send({ error: "File not found" });
    if (!existsSync(stored.storedPath)) return reply.status(404).send({ error: "File not found on disk" });
    const stream = createReadStream(stored.storedPath);
    return reply.type("application/octet-stream").header("Content-Disposition", `inline; filename="${stored.originalFileName}"`).send(stream);
  });

  server.get("/storage/files/:id/download", async (request, reply) => {
    const { id } = request.params as { id: string };
    const stored = getStoredFile(id);
    if (!stored) return reply.status(404).send({ error: "File not found" });
    if (!existsSync(stored.storedPath)) return reply.status(404).send({ error: "File not found on disk" });
    const stream = createReadStream(stored.storedPath);
    return reply.type("application/octet-stream").header("Content-Disposition", `attachment; filename="${stored.originalFileName}"`).send(stream);
  });

  server.get("/audit/events", async () => {
    const events = getEvents(100);
    const chainValid = verifyChain();
    return { events, chainValid };
  });

  server.get("/audit/verify", async () => {
    return verifyChain();
  });

  server.get("/anp/identity", async () => ({ identity: protocol.createLocalIdentity(), sessions: protocol.listPeerSessions() }));

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

  server.post("/anp/handshake/verify-offer", async (request) => {
    const body = (request.body ?? {}) as { offer?: import("./security/AnpHandshakeAdapter.js").HandshakeOffer; publicKey?: string };
    if (!body.offer || !body.publicKey) return { ok: false, error: "Missing offer or publicKey" };
    return { ok: protocol.verifyHandshakeOffer(body.offer, body.publicKey) };
  });

  server.post("/anp/handshake/verify-response", async (request) => {
    const body = (request.body ?? {}) as { response?: import("./security/AnpHandshakeAdapter.js").HandshakeResponse; publicKey?: string };
    if (!body.response || !body.publicKey) return { ok: false, error: "Missing response or publicKey" };
    return { ok: protocol.verifyHandshakeResponse(body.response, body.publicKey) };
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

  server.post("/anp/messages/send", async (request, reply) => {
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

  server.get("/anp/messages/thread/:threadId", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const thread = anpMessageThreads.get(threadId);
    if (!thread) return reply.status(404).send({ error: "Thread not found" });
    return reply.send(thread);
  });

  // ===== ANP AP2 Payment Protocol =====
  const ap2Intents = new Map<string, import("./security/anp/Ap2PaymentProtocol.ts").Ap2PaymentIntent>();
  const ap2Settlements = new Map<string, import("./security/anp/Ap2PaymentProtocol.ts").Ap2Settlement>();

  server.post("/anp/payment/intent", async (request, reply) => {
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

  server.post("/anp/payment/intent/:intentId/authorize", async (request, reply) => {
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

  server.post("/anp/payment/intent/:intentId/settle", async (request, reply) => {
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

  server.get("/anp/payment/intent/:intentId", async (request, reply) => {
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
    return reply.type("text/html; charset=utf-8").send(asset.content);
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

  server.get("/sessions", async () => ({
    sessions: tool.listSandboxSessions()
  }));

  server.post("/sessions", async (request) => {
    return tool.createSandboxSession(parseBody(CreateSandboxSessionSchema, request.body));
  });

  server.post("/sessions/:sessionId/shell", async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    return tool.runShellCommand(parseBody(RunShellCommandSchema, { ...(request.body as object), sessionId }));
  });

  server.post("/sessions/:sessionId/python", async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    return tool.runPythonCode(parseBody(RunCodeSchema, { ...(request.body as object), sessionId }));
  });

  server.post("/sessions/:sessionId/node", async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    return tool.runNodeCode(parseBody(RunCodeSchema, { ...(request.body as object), sessionId }));
  });

  server.post("/sessions/:sessionId/clone-and-test", async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    return tool.cloneRepoAndRunTests(parseBody(CloneRepoAndRunTestsSchema, { ...(request.body as object), sessionId }));
  });

  server.get("/sessions/:sessionId/events", async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    return { sessionId, events: tool.sessions.getEvents(sessionId) };
  });

  server.post("/agent/file-search", async (request) => {
    const { query } = parseBody(FileSearchSchema, request.body);
    return fileSearch.search(query);
  });

  server.post("/agent/runs", async (request) => {
    return agentRuns.createRun(parseBody(AgentRunSchema, request.body));
  });

  server.get("/agent/runs", async () => ({
    runs: agentRuns.listRuns()
  }));

  server.get("/agent/runs/:runId/events", async (request, reply) => {
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

  server.get("/agent/runs/:runId", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const run = agentRuns.getRun(runId);
    if (!run) {
      return reply.status(404).send({ error: "Agent run not found" });
    }
    return run;
  });

  server.get("/agent/files/:fileId", async (request, reply) => {
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

  server.delete("/sessions/:sessionId", async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    return tool.closeSandboxSession({ sessionId });
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

function parseBody<T>(schema: ZodSchema<T>, body: unknown): T {
  return schema.parse(body);
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

function localAgentUrl(): string {
  const host = process.env.SANDBOX_HOST ?? "127.0.0.1";
  const port = process.env.SANDBOX_PORT ?? "3399";
  return `http://${host}:${port}`;
}

function defaultOrgSlug(): string {
  return process.env.DEFAULT_ORG_SLUG?.trim() || DEFAULT_DEV_ORG_SLUG;
}

function publicCloudIdentity(identity: LocalCloudIdentity): Omit<LocalCloudIdentity, "userAccessToken" | "deviceAccessToken" | "refreshToken"> & {
  hasUserAccessToken: boolean;
  hasDeviceAccessToken: boolean;
  hasRefreshToken: boolean;
} {
  const { userAccessToken, deviceAccessToken, refreshToken, ...safe } = identity;
  return {
    ...safe,
    hasUserAccessToken: Boolean(userAccessToken),
    hasDeviceAccessToken: Boolean(deviceAccessToken),
    hasRefreshToken: Boolean(refreshToken)
  };
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

function requireDeviceAccessToken(identity: LocalCloudIdentity, reply: FastifyReply): string | null {
  if (!identity.deviceAccessToken) {
    reply.status(401).send({ error: "CLOUD_DEVICE_TOKEN_REQUIRED", message: "Cloud enrollment is required" });
    return null;
  }
  return identity.deviceAccessToken;
}

function conversationToUi(conversation: ChatConversationRecord, messages: ChatMessageRecord[]) {
  const last = messages.at(-1);
  return {
    id: conversation.id,
    title: conversation.title,
    subtitle: conversation.peer_agent_instance_id ? `Relay peer ${shortId(conversation.peer_agent_instance_id)}` : "Single-device local mode",
    agentInstanceId: conversation.peer_agent_instance_id,
    presence: conversation.peer_agent_instance_id ? "unknown" : "online",
    unread: conversation.unread_count,
    lastMessage: last ? summarizeChatMessage(last) : "No messages yet",
    pendingApprovals: messages.filter((message) => message.message_type === "approval").length,
    transferCount: messages.filter((message) => message.message_type === "transfer" || message.message_type === "receipt").length,
    messages: messages.map(messageToTimeline)
  };
}

function messageToTimeline(message: ChatMessageRecord): Record<string, unknown> {
  const payload = message.payload_json;
  if (message.message_type === "human") {
    return {
      kind: "human",
      id: message.id,
      conversation_id: message.conversation_id,
      sender_user_id: message.sender_user_id,
      sender_agent_instance_id: message.sender_agent_instance_id,
      receiver_agent_instance_id: message.receiver_agent_instance_id,
      text: message.text ?? "",
      created_at: message.created_at,
      delivery_status: message.delivery_status
    };
  }
  if (message.message_type === "file_request") {
    return {
      kind: "file_request",
      id: message.id,
      task_id: message.task_id ?? String(payload.task_id ?? message.id),
      requester: String(payload.requester ?? "You"),
      target: String(payload.target ?? "Peer"),
      natural_language_request: String(payload.natural_language_request ?? message.text ?? ""),
      query: String(payload.query ?? message.text ?? ""),
      status: String(payload.status ?? message.delivery_status),
      created_at: message.created_at
    };
  }
  if (message.message_type === "approval") {
    return {
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
