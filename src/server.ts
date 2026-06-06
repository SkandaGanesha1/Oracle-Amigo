import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
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

const FileIndexSchema = z.object({
  roots: z.array(z.string().trim().min(1)).default([])
});

export function buildServer(
  tool = new SandboxTool(),
  fileSearch = new FileSearchService(),
  reasoner?: AgentReasoner
) {
  const logger = createLogger();
  const server = Fastify({ logger: false });
  const requestStartTimes = new WeakMap<object, number>();
  const publicDir = resolve(process.cwd(), "public");
  const agentRuns = new AgentRunService(tool, fileSearch, reasoner);
  const protocol = new PersonalAgentProtocol();
  const intentExtractor = createIntentExtractor();

  // Eagerly init identity with resolved db path so handlers don't re-read process.env
  const dbPath = resolveDbPath();
  const identity = generateOrLoadIdentity("Local User", dbPath);
  protocol.setIdentityPath(identity, dbPath);

  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      reply.status(400).send({ error: "Validation failed", issues: error.issues });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("Unknown sandbox session")) {
      reply.status(404).send({ error: message });
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

  server.addHook("onClose", async () => {});

  server.get("/health", async () => ({
    status: "ok",
    dryRun: process.env.SANDBOX_DRY_RUN === "true"
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

  server.get("/.well-known/agent-card.json", async () => {
    const discovered = await skillRegistry.ensureFresh();
    const merged: AgentCard = {
      ...agentCard,
      skills: [...agentCard.skills, ...discovered.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        tags: s.tags,
        examples: s.examples,
        inputModes: s.inputModes.length ? s.inputModes : ["text/plain"],
        outputModes: s.outputModes.length ? s.outputModes : ["application/json"],
      }))],
    };
    return merged;
  });

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

  server.get("/chat/conversations", async () => {
    const db = getDb();
    const rows = db.prepare("SELECT DISTINCT conversation_id FROM messages ORDER BY MAX(created_at) DESC").all() as Array<{ conversation_id: string }>;
    return { conversations: rows.map((r) => ({ id: r.conversation_id, mode: "single-device" })) };
  });

  server.get("/chat/conversations/:id/messages", async (request) => {
    const { id } = request.params as { id: string };
    const window = memGetWindow(id, 10000);
    return { conversationId: id, messages: window };
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
    const approval = protocol.applyApprovalDecision(id, "approve");
    if (!approval) return reply.status(404).send({ error: "Approval not found" });
    return approval;
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
    const approval = protocol.applyApprovalDecision(id, "reject");
    if (!approval) return reply.status(404).send({ error: "Approval not found" });
    return approval;
  });

  server.post("/approvals/:id/feedback", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { feedback?: string; rejectedFileIds?: number[]; originalQuery?: string };
    const approval = protocol.applyApprovalDecision(id, "feedback", body.feedback);
    if (!approval) return reply.status(404).send({ error: "Approval not found" });

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

    return {
      ok: true,
      previousApproval: approval,
      refinedSearch: refined,
      candidates: newCandidates,
      newApproval,
    };
  });

  server.post("/approvals/notification-callback", async (request) => {
    const body = (request.body ?? {}) as { approvalId?: string; taskId?: string; action?: string; feedback?: string };
    const action = (body.action ?? "approve") as "approve" | "reject" | "feedback";
    if (action !== "approve" && action !== "reject" && action !== "feedback") {
      return { ok: false, status: "invalid", error: `Unknown action: ${body.action}` };
    }
    const current = protocol.getApproval(body.approvalId ?? "");
    if (!current) return { ok: false, status: "not-found" };
    if (current.taskId !== (body.taskId ?? "")) {
      return { ok: false, status: "task-mismatch" };
    }
    const wasReplay = current.status !== "pending";
    if (wasReplay) {
      return {
        ok: true,
        approvalId: current.id,
        taskId: current.taskId,
        status: current.status,
        replay: true,
      };
    }
    const updated = protocol.applyApprovalDecision(body.approvalId ?? "", action, body.feedback);
    return {
      ok: true,
      approvalId: current.id,
      taskId: current.taskId,
      status: updated?.status ?? "unknown",
      replay: false,
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
    const body = (request.body ?? {}) as { offer?: { offerId: string; peer: string; nonce: string; createdAt: string; signature: string } };
    if (!body.offer) return { error: "Missing offer object" };
    const response = protocol.createHandshakeResponse(body.offer);
    return response;
  });

  server.post("/anp/handshake/verify-offer", async (request) => {
    const body = (request.body ?? {}) as { offer?: { offerId: string; peer: string; nonce: string; createdAt: string; signature: string }; publicKey?: string };
    if (!body.offer || !body.publicKey) return { ok: false, error: "Missing offer or publicKey" };
    return { ok: protocol.verifyHandshakeOffer(body.offer, body.publicKey) };
  });

  server.post("/anp/handshake/verify-response", async (request) => {
    const body = (request.body ?? {}) as { response?: { responseId: string; offerId: string; nonce: string; status: "accepted"; createdAt: string; signature: string }; publicKey?: string };
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
