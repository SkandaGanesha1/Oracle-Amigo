import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { A2Av1Handler } from "./A2Av1Handler.js";
import { A2Av1SseStreamer } from "./A2Av1StreamHandler.js";
import {
  A2A_V1_MEDIA_TYPE,
  A2A_V1_VERSION_HEADER,
  A2A_V1_AGENT_CARD_PATH,
  A2A_ERROR_CODES,
  type A2Av1SendMessageRequest,
  type A2Av1ListTasksRequest,
  type A2Av1PushNotificationConfig
} from "./types.js";
import type { A2AError } from "./types.js";

export interface A2Av1AuthContext {
  token: string;
  orgId?: string;
  callerAgentInstanceId?: string;
  targetAgentInstanceId?: string;
  skillScopes: string[];
}

export interface A2Av1RouteAuthOptions {
  requireRemoteAuth?: boolean;
  requireExtendedCardAuth?: boolean;
  verifyAuth?: (request: FastifyRequest, tenant?: string) => Promise<A2Av1AuthContext | null> | A2Av1AuthContext | null;
}

/**
 * Mount the A2A v1.0.0 HTTP+JSON routes on a Fastify instance.
 *
 * Spec-conformant URL patterns (per A2A v1.0.0 spec):
 *   GET    /.well-known/agent-card.json
 *   POST   /v1/message:send
 *   POST   /v1/message:stream
 *   GET    /v1/tasks
 *   GET    /v1/tasks/{id}
 *   POST   /v1/tasks/{id}:cancel
 *   POST   /v1/tasks/{id}:subscribe
 *   POST   /v1/tasks/{taskId}/pushNotificationConfigs
 *   GET    /v1/tasks/{taskId}/pushNotificationConfigs
 *   GET    /v1/tasks/{taskId}/pushNotificationConfigs/{configId}
 *   DELETE /v1/tasks/{taskId}/pushNotificationConfigs/{configId}
 *   GET    /v1/extendedAgentCard
 *
 * Note: Fastify's find-my-way router treats colons in URL paths as
 * parameter delimiters, so paths like `/v1/message:send` and
 * `/v1/message:stream` collide on the same internal route
 * `/v1/message:<param>`. To preserve the public spec URLs, this
 * implementation registers the routes at non-colon internal paths
 * (e.g. `/v1/message_send`) and exposes `getA2Av1UrlRewriter()` so
 * the caller can pass it to Fastify's `rewriteUrl` option at server
 * construction time. The public URL stays spec-compliant.
 *
 * Multi-tenancy: All routes (except agent-card) may be prefixed with
 * `/{tenant}/` (e.g. `/v1/{tenant}/message:send`).
 */
export function getA2Av1UrlRewriter(): (req: { url?: string | undefined }) => string {
  const rewrites: Array<[RegExp, string]> = [
    [/\/v1\/message:send(\?|$)/, "/v1/message_send$1"],
    [/\/v1\/message:stream(\?|$)/, "/v1/message_stream$1"],
    [/\/v1\/([^\/]+)\/message:send(\?|$)/, "/v1/$1/message_send$2"],
    [/\/v1\/([^\/]+)\/message:stream(\?|$)/, "/v1/$1/message_stream$2"],
    [/\/v1\/tasks\/([^:\/?]+):cancel(\?|$)/, "/v1/tasks/cancel/$1$2"],
    [/\/v1\/tasks\/([^:\/?]+):subscribe(\?|$)/, "/v1/tasks/subscribe/$1$2"],
    [/\/v1\/([^\/]+)\/tasks\/([^:\/?]+):cancel(\?|$)/, "/v1/$1/tasks/cancel/$2$3"],
    [/\/v1\/([^\/]+)\/tasks\/([^:\/?]+):subscribe(\?|$)/, "/v1/$1/tasks/subscribe/$2$3"]
  ];
  return (req) => {
    const url = req.url ?? "";
    for (const [pattern, replacement] of rewrites) {
      if (pattern.test(url)) {
        return url.replace(pattern, replacement);
      }
    }
    return url;
  };
}

export function registerA2Av1Routes(server: FastifyInstance, handler: A2Av1Handler): void {
  return registerA2Av1RoutesWithOptions(server, handler);
}

export function registerA2Av1RoutesWithOptions(
  server: FastifyInstance,
  handler: A2Av1Handler,
  options: A2Av1RouteAuthOptions = {}
): void {
  // ---- Agent Card (well-known) ----
  // Skip if already registered (e.g. when the legacy v0.3 card is at the same path)
  if (!server.hasRoute({ method: "GET", url: A2A_V1_AGENT_CARD_PATH })) {
    server.get(A2A_V1_AGENT_CARD_PATH, async (_request, reply) => {
      reply.header("content-type", A2A_V1_MEDIA_TYPE);
      reply.header(A2A_V1_VERSION_HEADER, "1.0");
      return handler.getCard();
    });
  }

  // ---- Helper: set v1 standard headers on every response ----
  const setHeaders = (reply: FastifyReply) => {
    reply.header("content-type", A2A_V1_MEDIA_TYPE);
    reply.header(A2A_V1_VERSION_HEADER, "1.0");
  };

  // ---- Helper: extract tenant from URL params (multi-tenancy support) ----
  const extractTenant = (request: FastifyRequest): string | undefined => {
    const params = (request.params ?? {}) as Record<string, string>;
    if (typeof params.tenant === "string" && params.tenant.length > 0) return params.tenant;
    return undefined;
  };

  // ---- Helper: serialize A2AError ----
  const replyError = (reply: FastifyReply, status: number, code: number, message: string, data?: unknown) => {
    setHeaders(reply);
    const err: A2AError = {
      type: `https://a2a.dev/errors/${code}`,
      title: "A2A error",
      status,
      code,
      detail: message,
      data
    };
    return reply.code(status).send(err);
  };

  const authenticate = async (request: FastifyRequest, reply: FastifyReply, tenant: string | undefined, required: boolean) => {
    if (!required) return true;
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      replyError(reply, 401, A2A_ERROR_CODES.INVALID_AGENT_RESPONSE, "A2A bearer, device, or relay token is required");
      return false;
    }
    if (!options.verifyAuth) return true;
    const auth = await options.verifyAuth(request, tenant);
    if (!auth) {
      replyError(reply, 401, A2A_ERROR_CODES.INVALID_AGENT_RESPONSE, "A2A token is invalid");
      return false;
    }
    if (tenant && auth.orgId && tenant !== auth.orgId) {
      replyError(reply, 403, A2A_ERROR_CODES.INVALID_AGENT_RESPONSE, "A2A caller org does not match requested tenant");
      return false;
    }
    const target = (request.headers["x-a2a-target-agent-instance-id"] ?? request.headers["x-target-agent-instance-id"]) as string | undefined;
    if (auth.targetAgentInstanceId && target && auth.targetAgentInstanceId !== target) {
      replyError(reply, 403, A2A_ERROR_CODES.INVALID_AGENT_RESPONSE, "A2A caller target is not authorized");
      return false;
    }
    return true;
  };

  // ===== 1+2. SendMessage / SendStreamingMessage: POST /v1/message_send | /v1/message_stream =====
  const sendOrStreamMessageHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    setHeaders(reply);
    const body = (request.body ?? {}) as A2Av1SendMessageRequest;
    const tenant = extractTenant(request);
    if (!(await authenticate(request, reply, tenant, options.requireRemoteAuth ?? false))) return reply;
    const isStream = request.url.includes("/message_stream");

    if (isStream) {
      // SSE streaming - signal Fastify not to handle the response
      const sse = new A2Av1SseStreamer(reply);
      sse.open();
      try {
        await handler["ctx"].onMessageStream(body.message, {
          ...(body.configuration ?? {}),
          emit: (event) => sse.emit(event),
          tenant
        });
      } catch (err) {
        // SSE already open, so just emit a final error frame and close
        try {
          sse.emit({
            type: "status",
            event: {
              taskId: body.message.taskId ?? "",
              contextId: body.message.contextId ?? "",
              status: {
                state: "TASK_STATE_FAILED",
                timestamp: new Date().toISOString(),
                message: {
                  messageId: crypto.randomUUID(),
                  role: "ROLE_AGENT",
                  parts: [{ text: err instanceof Error ? err.message : "Stream error" }],
                  timestamp: new Date().toISOString()
                }
              },
              final: true
            }
          });
        } catch { /* ignore */ }
      } finally {
        try { sse.close(); } catch { /* ignore */ }
      }
      return reply;
    }

    // Default: non-streaming SendMessage
    try {
      if (!body || !body.message) {
        return replyError(
          reply,
          400,
          A2A_ERROR_CODES.INVALID_AGENT_RESPONSE,
          "Missing `message`"
        );
      }
      const result = await handler.handleSendMessage(body, tenant);
      return reply.send(result);
    } catch (err) {
      const e = err as Error & { status?: number; code?: number };
      return replyError(
        reply,
        e.status ?? 500,
        e.code ?? A2A_ERROR_CODES.INVALID_AGENT_RESPONSE,
        e.message ?? "SendMessage failed"
      );
    }
  };
  server.post("/v1/message_send", sendOrStreamMessageHandler);
  server.post("/v1/:tenant/message_send", sendOrStreamMessageHandler);
  server.post("/v1/message_stream", sendOrStreamMessageHandler);
  server.post("/v1/:tenant/message_stream", sendOrStreamMessageHandler);

  // ===== 3. ListTasks: GET /v1/tasks =====
  const listTasksHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    setHeaders(reply);
    try {
      const q = request.query as A2Av1ListTasksRequest;
      const tenant = extractTenant(request);
      if (!(await authenticate(request, reply, tenant, options.requireRemoteAuth ?? false))) return reply;
      const params: A2Av1ListTasksRequest = { ...q, tenant };
      const result = await handler.handleListTasks(params);
      return reply.send(result);
    } catch (err) {
      const e = err as Error & { status?: number; code?: number };
      return replyError(
        reply,
        e.status ?? 500,
        e.code ?? A2A_ERROR_CODES.INVALID_AGENT_RESPONSE,
        e.message ?? "ListTasks failed"
      );
    }
  };
  server.get("/v1/tasks", listTasksHandler);
  server.get("/v1/:tenant/tasks", listTasksHandler);

  // ===== 4. GetTask: GET /v1/tasks/:id =====
  const getTaskHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    setHeaders(reply);
    const params = request.params as { id: string; tenant?: string };
    const tenant = extractTenant(request);
    if (!(await authenticate(request, reply, tenant, options.requireRemoteAuth ?? false))) return reply;
    try {
      const historyLength = (request.query as { historyLength?: string })?.historyLength
        ? Number((request.query as { historyLength?: string }).historyLength)
        : undefined;
      const task = await handler.handleGetTask(params.id, historyLength, tenant);
      if (!task) {
        return replyError(reply, 404, A2A_ERROR_CODES.TASK_NOT_FOUND, `Task not found: ${params.id}`);
      }
      return reply.send(task);
    } catch (err) {
      const e = err as Error & { status?: number; code?: number };
      return replyError(reply, e.status ?? 500, e.code ?? A2A_ERROR_CODES.INVALID_AGENT_RESPONSE, e.message ?? "GetTask failed");
    }
  };
  server.get("/v1/tasks/:id", getTaskHandler);
  server.get("/v1/:tenant/tasks/:id", getTaskHandler);

  // ===== 5+6. CancelTask / SubscribeToTask: /v1/tasks/cancel/:id | /v1/tasks/subscribe/:id =====
  // Two routes registered under the rewritten paths.
  const cancelOrSubscribeHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    setHeaders(reply);
    const params = request.params as { id: string };
    const tenant = extractTenant(request);
    if (!(await authenticate(request, reply, tenant, options.requireRemoteAuth ?? false))) return reply;
    // After URL rewrite, "/tasks/subscribe/" is the subscribe path and
    // "/tasks/cancel/" is the cancel path.
    const isSubscribe = request.url.includes("/tasks/subscribe/") || request.raw.url?.includes("/tasks/subscribe/");
    const isCancel = request.url.includes("/tasks/cancel/") || request.raw.url?.includes("/tasks/cancel/");

    if (isSubscribe) {
      // SSE resubscribe
      const sse = new A2Av1SseStreamer(reply);
      sse.open();
      try {
        await handler["ctx"].onTaskResubscribe(params.id, {
          emit: (event) => sse.emit(event),
          tenant
        });
      } catch (err) {
        try {
          sse.emit({
            type: "status",
            event: {
              taskId: params.id,
              contextId: "",
              status: { state: "TASK_STATE_FAILED", timestamp: new Date().toISOString() },
              final: true
            }
          });
        } catch { /* ignore */ }
      } finally {
        try { sse.close(); } catch { /* ignore */ }
      }
      return reply;
    }

    // Default: cancel
    try {
      if (!isCancel) {
        return replyError(reply, 400, A2A_ERROR_CODES.UNSUPPORTED_OPERATION, "Unknown verb");
      }
      const task = await handler.handleCancelTask(params.id, tenant);
      if (!task) {
        return replyError(reply, 404, A2A_ERROR_CODES.TASK_NOT_FOUND, `Task not found: ${params.id}`);
      }
      return reply.send(task);
    } catch (err) {
      const e = err as Error & { status?: number; code?: number };
      return replyError(reply, e.status ?? 500, e.code ?? A2A_ERROR_CODES.TASK_NOT_CANCELABLE, e.message ?? "CancelTask failed");
    }
  };
  server.post("/v1/tasks/cancel/:id", cancelOrSubscribeHandler);
  server.post("/v1/:tenant/tasks/cancel/:id", cancelOrSubscribeHandler);
  server.post("/v1/tasks/subscribe/:id", cancelOrSubscribeHandler);
  server.post("/v1/:tenant/tasks/subscribe/:id", cancelOrSubscribeHandler);
  server.get("/v1/tasks/subscribe/:id", cancelOrSubscribeHandler);
  server.get("/v1/:tenant/tasks/subscribe/:id", cancelOrSubscribeHandler);

  // ===== 7. CreateTaskPushNotificationConfig: POST /v1/tasks/:taskId/pushNotificationConfigs =====
  const createPushConfigHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    setHeaders(reply);
    const params = request.params as { taskId: string };
    const tenant = extractTenant(request);
    if (!(await authenticate(request, reply, tenant, options.requireRemoteAuth ?? false))) return reply;
    const body = (request.body ?? {}) as { taskPushNotificationConfig?: A2Av1PushNotificationConfig; pushNotificationConfig?: A2Av1PushNotificationConfig };
    const pushConfig = body.taskPushNotificationConfig ?? body.pushNotificationConfig;
    try {
      if (!pushConfig) {
        return replyError(reply, 400, A2A_ERROR_CODES.INVALID_AGENT_RESPONSE, "taskPushNotificationConfig is required");
      }
      const config = await handler.handleCreatePushNotificationConfig(
        params.taskId,
        pushConfig,
        tenant
      );
      return reply.code(201).send(config);
    } catch (err) {
      const e = err as Error & { status?: number; code?: number };
      return replyError(
        reply,
        e.status ?? 500,
        e.code ?? A2A_ERROR_CODES.PUSH_NOTIFICATION_NOT_SUPPORTED,
        e.message ?? "CreatePushNotificationConfig failed"
      );
    }
  };
  server.post("/v1/tasks/:taskId/pushNotificationConfigs", createPushConfigHandler);
  server.post("/v1/:tenant/tasks/:taskId/pushNotificationConfigs", createPushConfigHandler);

  // ===== 8. GetTaskPushNotificationConfig: GET /v1/tasks/:taskId/pushNotificationConfigs/:configId =====
  const getPushConfigHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    setHeaders(reply);
    const params = request.params as { taskId: string; configId: string };
    const tenant = extractTenant(request);
    if (!(await authenticate(request, reply, tenant, options.requireRemoteAuth ?? false))) return reply;
    try {
      const config = await handler.handleGetPushNotificationConfig(
        params.taskId,
        params.configId,
        tenant
      );
      if (!config) {
        return replyError(reply, 404, A2A_ERROR_CODES.TASK_NOT_FOUND, `Push notification config not found: ${params.configId}`);
      }
      return reply.send(config);
    } catch (err) {
      const e = err as Error & { status?: number; code?: number };
      return replyError(reply, e.status ?? 500, e.code ?? A2A_ERROR_CODES.INVALID_AGENT_RESPONSE, e.message ?? "GetPushNotificationConfig failed");
    }
  };
  server.get("/v1/tasks/:taskId/pushNotificationConfigs/:configId", getPushConfigHandler);
  server.get("/v1/:tenant/tasks/:taskId/pushNotificationConfigs/:configId", getPushConfigHandler);

  // ===== 9. ListTaskPushNotificationConfigs: GET /v1/tasks/:taskId/pushNotificationConfigs =====
  const listPushConfigsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    setHeaders(reply);
    const params = request.params as { taskId: string };
    const tenant = extractTenant(request);
    if (!(await authenticate(request, reply, tenant, options.requireRemoteAuth ?? false))) return reply;
    try {
      const configs = await handler.handleListPushNotificationConfigs(params.taskId, tenant);
      return reply.send({ configs });
    } catch (err) {
      const e = err as Error & { status?: number; code?: number };
      return replyError(reply, e.status ?? 500, e.code ?? A2A_ERROR_CODES.INVALID_AGENT_RESPONSE, e.message ?? "ListPushNotificationConfigs failed");
    }
  };
  server.get("/v1/tasks/:taskId/pushNotificationConfigs", listPushConfigsHandler);
  server.get("/v1/:tenant/tasks/:taskId/pushNotificationConfigs", listPushConfigsHandler);

  // ===== 10. DeleteTaskPushNotificationConfig: DELETE /v1/tasks/:taskId/pushNotificationConfigs/:configId =====
  const deletePushConfigHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    setHeaders(reply);
    const params = request.params as { taskId: string; configId: string };
    const tenant = extractTenant(request);
    if (!(await authenticate(request, reply, tenant, options.requireRemoteAuth ?? false))) return reply;
    try {
      const ok = await handler.handleDeletePushNotificationConfig(
        params.taskId,
        params.configId,
        tenant
      );
      if (!ok) {
        return replyError(reply, 404, A2A_ERROR_CODES.TASK_NOT_FOUND, `Push notification config not found: ${params.configId}`);
      }
      return reply.code(204).send();
    } catch (err) {
      const e = err as Error & { status?: number; code?: number };
      return replyError(reply, e.status ?? 500, e.code ?? A2A_ERROR_CODES.INVALID_AGENT_RESPONSE, e.message ?? "DeletePushNotificationConfig failed");
    }
  };
  server.delete("/v1/tasks/:taskId/pushNotificationConfigs/:configId", deletePushConfigHandler);
  server.delete("/v1/:tenant/tasks/:taskId/pushNotificationConfigs/:configId", deletePushConfigHandler);

  // ===== 11. GetExtendedAgentCard: GET /v1/extendedAgentCard =====
  const extendedCardHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    setHeaders(reply);
    const tenant = extractTenant(request);
    if (!(await authenticate(request, reply, tenant, options.requireExtendedCardAuth ?? true))) return reply;
    try {
      const card = await handler.handleGetExtendedAgentCard(tenant);
      return reply.send(card);
    } catch (err) {
      const e = err as Error & { status?: number; code?: number };
      return replyError(
        reply,
        e.status ?? 500,
        e.code ?? A2A_ERROR_CODES.AUTHENTICATED_EXTENDED_CARD_NOT_CONFIGURED,
        e.message ?? "GetExtendedAgentCard failed"
      );
    }
  };
  server.get("/v1/extendedAgentCard", extendedCardHandler);
  server.get("/v1/:tenant/extendedAgentCard", extendedCardHandler);
}
