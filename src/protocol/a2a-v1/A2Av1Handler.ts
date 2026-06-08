import { randomUUID } from "node:crypto";
import type { FastifyReply } from "fastify";
import {
  A2A_V1_MEDIA_TYPE,
  A2A_V1_VERSION_HEADER,
  A2A_ERROR_CODES,
  newServerTaskId,
  isTerminalV1State,
  type A2Av1AgentCard,
  type A2Av1Task,
  type A2Av1Message,
  type A2Av1Part,
  type A2Av1SendMessageRequest,
  type A2Av1SendMessageResponse,
  type A2Av1SendMessageConfiguration,
  type A2Av1ListTasksRequest,
  type A2Av1ListTasksResponse,
  type A2Av1TaskPushNotificationConfig,
  type A2Av1PushNotificationConfig,
  type A2Av1StreamEvent,
  type A2Av1TaskStatus,
  type A2Av1Artifact,
  type A2AError
} from "./types.js";
import type { A2Av1StreamEmitter } from "./A2Av1StreamHandler.js";

/**
 * A2A v1.0.0 HTTP+JSON service interface (per `a2a.proto`).
 *
 * Implementation note: This is a pure v1.0.0 implementation. No v0.3
 * compatibility layer is provided. The local/loopback v0.3 code in
 * `src/protocol/a2a/` is preserved for backward compatibility but is
 * not bridged to v1.
 *
 * Service methods:
 *   1. SendMessage                  — POST   /message:send
 *   2. SendStreamingMessage         — POST   /message:stream  (SSE)
 *   3. GetTask                      — GET    /tasks/{id}
 *   4. ListTasks                    — GET    /tasks
 *   5. CancelTask                   — POST   /tasks/{id}:cancel
 *   6. SubscribeToTask              - POST   /tasks/{id}:subscribe  (SSE)
 *   7. CreateTaskPushNotificationConfig   — POST   /tasks/{id}/pushNotificationConfigs
 *   8. GetTaskPushNotificationConfig       — GET    /tasks/{id}/pushNotificationConfigs/{configId}
 *   9. ListTaskPushNotificationConfigs     — GET    /tasks/{id}/pushNotificationConfigs
 *  10. DeleteTaskPushNotificationConfig    — DELETE /tasks/{id}/pushNotificationConfigs/{configId}
 *  11. GetExtendedAgentCard         — GET    /extendedAgentCard
 *
 * Multi-tenancy: All routes may be prefixed with `/{tenant}/` (e.g. `/v1/{tenant}/message:send`).
 */
export interface A2Av1Context {
  /** Card used for `/.well-known/agent-card.json` and the v1 route responses. */
  agentCard: A2Av1AgentCard;
  /** Send a message (non-streaming). Returns Task or Message. */
  onMessageSend: (
    message: A2Av1Message,
    configuration?: A2Av1SendMessageConfiguration,
    tenant?: string
  ) => Promise<A2Av1SendMessageResponse>;
  /** Stream a message via SSE. */
  onMessageStream: (
    message: A2Av1Message,
    configuration: A2Av1SendMessageConfiguration & { emit: A2Av1StreamEmitter; tenant?: string }
  ) => Promise<void>;
  /** Get a task by id. */
  onTaskGet: (
    id: string,
    historyLength?: number,
    tenant?: string
  ) => Promise<A2Av1Task | null>;
  /** List tasks with cursor-based pagination. */
  onTaskList: (
    params: A2Av1ListTasksRequest
  ) => Promise<A2Av1ListTasksResponse>;
  /** Cancel a task. */
  onTaskCancel: (id: string, tenant?: string) => Promise<A2Av1Task | null>;
  /** Resubscribe to a task's event stream. */
  onTaskResubscribe: (
    id: string,
    configuration: { emit: A2Av1StreamEmitter; tenant?: string }
  ) => Promise<void>;
  /** Save a push notification config for a task. */
  onPushNotificationConfigSet: (
    taskId: string,
    config: A2Av1PushNotificationConfig,
    tenant?: string
  ) => Promise<A2Av1TaskPushNotificationConfig>;
  /** Get a single push notification config. */
  onPushNotificationConfigGet: (
    taskId: string,
    configId: string,
    tenant?: string
  ) => Promise<A2Av1TaskPushNotificationConfig | null>;
  /** List all push notification configs for a task. */
  onPushNotificationConfigList: (
    taskId: string,
    tenant?: string
  ) => Promise<A2Av1TaskPushNotificationConfig[]>;
  /** Delete a push notification config. */
  onPushNotificationConfigDelete: (
    taskId: string,
    configId: string,
    tenant?: string
  ) => Promise<boolean>;
  /** Whether the agent supports the authenticated extended card. */
  supportsAuthenticatedExtendedCard?: () => boolean;
  /** Get the authenticated extended card. */
  onGetAuthenticatedExtendedCard?: (tenant?: string) => Promise<A2Av1AgentCard>;
}

export class A2Av1Handler {
  private cardCache: { card: A2Av1AgentCard; fingerprint: string } | null = null;

  constructor(private ctx: A2Av1Context) {}

  // ---- Card helpers ----

  getCard(): A2Av1AgentCard {
    if (this.cardCache) return this.cardCache.card;
    return this.ctx.agentCard;
  }

  invalidateCardCache(): void {
    this.cardCache = null;
  }

  setStandardHeaders(reply: FastifyReply): void {
    reply.header("content-type", A2A_V1_MEDIA_TYPE);
    reply.header(A2A_V1_VERSION_HEADER, "1.0");
  }

  v1ErrorReply(reply: FastifyReply, status: number, err: A2AError): FastifyReply {
    this.setStandardHeaders(reply);
    return reply.code(status).send(err);
  }

  // ---- SendMessage ----

  async handleSendMessage(
    body: A2Av1SendMessageRequest,
    tenant?: string
  ): Promise<A2Av1SendMessageResponse> {
    if (!body || !body.message) {
      throw Object.assign(new Error("Missing `message`"), {
        status: 400,
        code: A2A_ERROR_CODES.INVALID_AGENT_RESPONSE
      });
    }
    return this.ctx.onMessageSend(body.message, normalizeSendConfiguration(body.configuration), tenant);
  }

  // ---- GetTask ----

  async handleGetTask(
    id: string,
    historyLength?: number,
    tenant?: string
  ): Promise<A2Av1Task | null> {
    return this.ctx.onTaskGet(id, historyLength, tenant);
  }

  // ---- ListTasks ----

  async handleListTasks(q: A2Av1ListTasksRequest): Promise<A2Av1ListTasksResponse> {
    return this.ctx.onTaskList(q);
  }

  // ---- CancelTask ----

  async handleCancelTask(id: string, tenant?: string): Promise<A2Av1Task | null> {
    return this.ctx.onTaskCancel(id, tenant);
  }

  // ---- Push notification CRUD ----

  async handleCreatePushNotificationConfig(
    taskId: string,
    config: A2Av1PushNotificationConfig,
    tenant?: string
  ): Promise<A2Av1TaskPushNotificationConfig> {
    if (!this.ctx.agentCard.capabilities.pushNotifications) {
      throw Object.assign(new Error("Push notifications are not supported"), {
        status: 400,
        code: A2A_ERROR_CODES.PUSH_NOTIFICATION_NOT_SUPPORTED
      });
    }
    const id = config.id ?? randomUUID();
    return this.ctx.onPushNotificationConfigSet(taskId, { ...config, id }, tenant);
  }

  async handleGetPushNotificationConfig(
    taskId: string,
    configId: string,
    tenant?: string
  ): Promise<A2Av1TaskPushNotificationConfig | null> {
    return this.ctx.onPushNotificationConfigGet(taskId, configId, tenant);
  }

  async handleListPushNotificationConfigs(
    taskId: string,
    tenant?: string
  ): Promise<A2Av1TaskPushNotificationConfig[]> {
    return this.ctx.onPushNotificationConfigList(taskId, tenant);
  }

  async handleDeletePushNotificationConfig(
    taskId: string,
    configId: string,
    tenant?: string
  ): Promise<boolean> {
    return this.ctx.onPushNotificationConfigDelete(taskId, configId, tenant);
  }

  // ---- Extended card ----

  async handleGetExtendedAgentCard(tenant?: string): Promise<A2Av1AgentCard> {
    if (
      this.ctx.supportsAuthenticatedExtendedCard &&
      !this.ctx.supportsAuthenticatedExtendedCard()
    ) {
      throw Object.assign(new Error("Authenticated extended card not configured"), {
        status: 404,
        code: A2A_ERROR_CODES.AUTHENTICATED_EXTENDED_CARD_NOT_CONFIGURED
      });
    }
    if (this.ctx.onGetAuthenticatedExtendedCard) {
      return this.ctx.onGetAuthenticatedExtendedCard(tenant);
    }
    return this.ctx.agentCard;
  }

  // ---- Error helpers ----

  v1Error(status: number, code: number, message: string, data?: unknown): A2AError {
    return {
      type: `https://a2a.dev/errors/${code}`,
      title: "A2A error",
      status,
      code,
      detail: message,
      data
    };
  }
}

function normalizeSendConfiguration(
  configuration: A2Av1SendMessageConfiguration | undefined
): A2Av1SendMessageConfiguration | undefined {
  if (!configuration) return undefined;
  const taskPushNotificationConfig =
    configuration.taskPushNotificationConfig ?? configuration.pushNotificationConfig;
  return {
    ...configuration,
    taskPushNotificationConfig
  };
}

// Re-exports for convenience
export { isTerminalV1State, newServerTaskId };
export type {
  A2Av1AgentCard,
  A2Av1Task,
  A2Av1Message,
  A2Av1Part,
  A2Av1TaskStatus,
  A2Av1Artifact,
  A2Av1StreamEvent
};
