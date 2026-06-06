import { randomUUID } from "node:crypto";
import {
  type AgentCard,
  type Artifact,
  type JSONRPCError,
  type JSONRPCRequest,
  type JSONRPCResponse,
  type JSONRPCSuccess,
  type Message,
  type Part,
  type PushNotificationConfig,
  type SendStreamingMessageResult,
  type Task,
  type TaskListResult,
  type TaskPushNotificationConfig,
  type TaskState,
  JSONRPC_ERROR_CODES,
} from "./types.js";

export type A2AMethod =
  | "message/send"
  | "message/stream"
  | "tasks/get"
  | "tasks/list"
  | "tasks/cancel"
  | "tasks/resubscribe"
  | "tasks/pushNotificationConfig/set"
  | "tasks/pushNotificationConfig/get"
  | "tasks/pushNotificationConfig/list"
  | "tasks/pushNotificationConfig/delete"
  | "agent/getAuthenticatedExtendedCard";

export interface MessageStreamEmitter {
  (event: SendStreamingMessageResult | JSONRPCError): void;
}

export interface A2AContext {
  agentCard: AgentCard;
  onMessageSend: (
    message: Message,
    configuration?: {
      acceptedOutputModes?: string[];
      historyLength?: number;
      pushNotificationConfig?: PushNotificationConfig;
      blocking?: boolean;
    },
  ) => Promise<Task | Message>;
  onMessageStream: (
    message: Message,
    configuration: {
      emit: MessageStreamEmitter;
      acceptedOutputModes?: string[];
      historyLength?: number;
      pushNotificationConfig?: PushNotificationConfig;
      blocking?: boolean;
    },
  ) => Promise<void>;
  onTaskGet: (id: string, historyLength?: number) => Promise<Task | null>;
  onTaskList: (params: {
    contextId?: string;
    status?: TaskState;
    pageSize?: number;
    pageToken?: string;
    historyLength?: number;
  }) => Promise<TaskListResult>;
  onTaskCancel: (id: string) => Promise<Task | null>;
  onTaskResubscribe: (
    id: string,
    configuration: { emit: MessageStreamEmitter },
  ) => Promise<void>;
  onPushNotificationConfigSet: (
    taskId: string,
    config: PushNotificationConfig,
  ) => Promise<TaskPushNotificationConfig>;
  onPushNotificationConfigGet: (
    taskId: string,
    configId?: string,
  ) => Promise<TaskPushNotificationConfig | null>;
  onPushNotificationConfigList: (
    taskId: string,
  ) => Promise<TaskPushNotificationConfig[]>;
  onPushNotificationConfigDelete: (
    taskId: string,
    configId: string,
  ) => Promise<boolean>;
  supportsAuthenticatedExtendedCard?: () => boolean;
  onGetAuthenticatedExtendedCard?: () => Promise<AgentCard>;
}

export function makeJSONRPCError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JSONRPCError {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

export function makeJSONRPCSuccess<R>(
  id: string | number | null,
  result: R,
): JSONRPCSuccess<R> {
  return { jsonrpc: "2.0", id, result };
}

function validateRequest(
  body: unknown,
): { ok: true; req: JSONRPCRequest } | { ok: false; error: JSONRPCError } {
  if (typeof body !== "object" || body === null) {
    return {
      ok: false,
      error: makeJSONRPCError(
        null,
        JSONRPC_ERROR_CODES.INVALID_REQUEST,
        "Request must be a JSON object",
      ),
    };
  }
  const req = body as JSONRPCRequest;
  if (req.jsonrpc !== "2.0") {
    return {
      ok: false,
      error: makeJSONRPCError(
        req.id ?? null,
        JSONRPC_ERROR_CODES.INVALID_REQUEST,
        "jsonrpc must be '2.0'",
      ),
    };
  }
  if (typeof req.method !== "string") {
    return {
      ok: false,
      error: makeJSONRPCError(
        req.id ?? null,
        JSONRPC_ERROR_CODES.INVALID_REQUEST,
        "method must be a string",
      ),
    };
  }
  return { ok: true, req };
}

function parseParams<T>(params: unknown): T {
  if (params === undefined || params === null) return {} as T;
  if (typeof params !== "object") {
    throw new Error("params must be an object");
  }
  return params as T;
}

export async function handleA2ARequest(
  body: unknown,
  ctx: A2AContext,
): Promise<JSONRPCResponse> {
  const validation = validateRequest(body);
  if (!validation.ok) return validation.error;
  const { req } = validation;

  try {
    switch (req.method) {
      case "message/send": {
        const params = parseParams<{
          message?: Message;
          configuration?: {
            acceptedOutputModes?: string[];
            historyLength?: number;
            pushNotificationConfig?: PushNotificationConfig;
            blocking?: boolean;
          };
        }>(req.params);
        if (!params.message) {
          return makeJSONRPCError(
            req.id ?? null,
            JSONRPC_ERROR_CODES.INVALID_PARAMS,
            "params.message is required",
          );
        }
        const result = await ctx.onMessageSend(params.message, params.configuration);
        return makeJSONRPCSuccess(req.id ?? null, result);
      }

      case "message/stream": {
        const params = parseParams<{
          message?: Message;
          configuration?: {
            acceptedOutputModes?: string[];
            historyLength?: number;
            pushNotificationConfig?: PushNotificationConfig;
            blocking?: boolean;
          };
        }>(req.params);
        if (!params.message) {
          return makeJSONRPCError(
            req.id ?? null,
            JSONRPC_ERROR_CODES.INVALID_PARAMS,
            "params.message is required",
          );
        }
        const events: Array<SendStreamingMessageResult | JSONRPCError> = [];
        const emit: MessageStreamEmitter = (event) => {
          events.push(event);
        };
        await ctx.onMessageStream(params.message, {
          ...(params.configuration ?? {}),
          emit,
        });
        const last = events[events.length - 1];
        if (last && "error" in last) {
          return last;
        }
        const taskResult =
          last && !("error" in last) ? (last as SendStreamingMessageResult) : null;
        return makeJSONRPCSuccess(req.id ?? null, taskResult);
      }

      case "tasks/get": {
        const params = parseParams<{ id?: string; historyLength?: number }>(req.params);
        if (!params.id) {
          return makeJSONRPCError(
            req.id ?? null,
            JSONRPC_ERROR_CODES.INVALID_PARAMS,
            "params.id is required",
          );
        }
        const task = await ctx.onTaskGet(params.id, params.historyLength);
        if (!task) {
          return makeJSONRPCError(
            req.id ?? null,
            JSONRPC_ERROR_CODES.TASK_NOT_FOUND,
            `Task not found: ${params.id}`,
          );
        }
        return makeJSONRPCSuccess(req.id ?? null, task);
      }

      case "tasks/list": {
        const params = parseParams<{
          contextId?: string;
          status?: TaskState;
          pageSize?: number;
          pageToken?: string;
          historyLength?: number;
        }>(req.params);
        const result = await ctx.onTaskList(params);
        return makeJSONRPCSuccess(req.id ?? null, result);
      }

      case "tasks/cancel": {
        const params = parseParams<{ id?: string }>(req.params);
        if (!params.id) {
          return makeJSONRPCError(
            req.id ?? null,
            JSONRPC_ERROR_CODES.INVALID_PARAMS,
            "params.id is required",
          );
        }
        const task = await ctx.onTaskCancel(params.id);
        if (!task) {
          return makeJSONRPCError(
            req.id ?? null,
            JSONRPC_ERROR_CODES.TASK_NOT_FOUND,
            `Task not found: ${params.id}`,
          );
        }
        return makeJSONRPCSuccess(req.id ?? null, task);
      }

      case "tasks/resubscribe": {
        const params = parseParams<{ id?: string }>(req.params);
        if (!params.id) {
          return makeJSONRPCError(
            req.id ?? null,
            JSONRPC_ERROR_CODES.INVALID_PARAMS,
            "params.id is required",
          );
        }
        const events: Array<SendStreamingMessageResult | JSONRPCError> = [];
        const emit: MessageStreamEmitter = (event) => {
          events.push(event);
        };
        await ctx.onTaskResubscribe(params.id, { emit });
        const last = events[events.length - 1];
        const taskResult =
          last && !("error" in last) ? (last as SendStreamingMessageResult) : null;
        return makeJSONRPCSuccess(req.id ?? null, taskResult);
      }

      case "tasks/pushNotificationConfig/set": {
        const params = parseParams<TaskPushNotificationConfig>(req.params);
        if (!params.taskId || !params.pushNotificationConfig) {
          return makeJSONRPCError(
            req.id ?? null,
            JSONRPC_ERROR_CODES.INVALID_PARAMS,
            "params.taskId and params.pushNotificationConfig are required",
          );
        }
        if (
          !ctx.agentCard.capabilities.pushNotifications
        ) {
          return makeJSONRPCError(
            req.id ?? null,
            JSONRPC_ERROR_CODES.PUSH_NOTIFICATION_NOT_SUPPORTED,
            "Push notifications are not supported by this agent",
          );
        }
        const result = await ctx.onPushNotificationConfigSet(
          params.taskId,
          params.pushNotificationConfig,
        );
        return makeJSONRPCSuccess(req.id ?? null, result);
      }

      case "tasks/pushNotificationConfig/get": {
        const params = parseParams<{
          id?: string;
          pushNotificationConfigId?: string;
        }>(req.params);
        if (!params.id) {
          return makeJSONRPCError(
            req.id ?? null,
            JSONRPC_ERROR_CODES.INVALID_PARAMS,
            "params.id is required",
          );
        }
        const result = await ctx.onPushNotificationConfigGet(
          params.id,
          params.pushNotificationConfigId,
        );
        if (!result) {
          return makeJSONRPCError(
            req.id ?? null,
            JSONRPC_ERROR_CODES.TASK_NOT_FOUND,
            `Push notification config not found for task: ${params.id}`,
          );
        }
        return makeJSONRPCSuccess(req.id ?? null, result);
      }

      case "tasks/pushNotificationConfig/list": {
        const params = parseParams<{ id?: string }>(req.params);
        if (!params.id) {
          return makeJSONRPCError(
            req.id ?? null,
            JSONRPC_ERROR_CODES.INVALID_PARAMS,
            "params.id is required",
          );
        }
        const result = await ctx.onPushNotificationConfigList(params.id);
        return makeJSONRPCSuccess(req.id ?? null, result);
      }

      case "tasks/pushNotificationConfig/delete": {
        const params = parseParams<{
          id?: string;
          pushNotificationConfigId?: string;
        }>(req.params);
        if (!params.id || !params.pushNotificationConfigId) {
          return makeJSONRPCError(
            req.id ?? null,
            JSONRPC_ERROR_CODES.INVALID_PARAMS,
            "params.id and params.pushNotificationConfigId are required",
          );
        }
        const ok = await ctx.onPushNotificationConfigDelete(
          params.id,
          params.pushNotificationConfigId,
        );
        if (!ok) {
          return makeJSONRPCError(
            req.id ?? null,
            JSONRPC_ERROR_CODES.TASK_NOT_FOUND,
            `Push notification config not found: ${params.pushNotificationConfigId}`,
          );
        }
        return makeJSONRPCSuccess(req.id ?? null, null);
      }

      case "agent/getAuthenticatedExtendedCard": {
        if (
          ctx.supportsAuthenticatedExtendedCard &&
          !ctx.supportsAuthenticatedExtendedCard()
        ) {
          return makeJSONRPCError(
            req.id ?? null,
            JSONRPC_ERROR_CODES.AUTHENTICATED_EXTENDED_CARD_NOT_CONFIGURED,
            "Agent does not support authenticated extended card",
          );
        }
        const card = ctx.onGetAuthenticatedExtendedCard
          ? await ctx.onGetAuthenticatedExtendedCard()
          : ctx.agentCard;
        return makeJSONRPCSuccess(req.id ?? null, card);
      }

      default:
        return makeJSONRPCError(
          req.id ?? null,
          JSONRPC_ERROR_CODES.METHOD_NOT_FOUND,
          `Method not found: ${req.method}`,
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return makeJSONRPCError(
      req.id ?? null,
      JSONRPC_ERROR_CODES.INTERNAL_ERROR,
      message,
    );
  }
}

export function makeTask(input: {
  id?: string;
  contextId?: string;
  state: TaskState;
  message?: Message;
  history?: Message[];
  artifacts?: Artifact[];
  metadata?: Record<string, unknown>;
}): Task {
  return {
    kind: "task",
    id: input.id ?? randomUUID(),
    contextId: input.contextId ?? randomUUID(),
    status: {
      state: input.state,
      message: input.message,
      timestamp: new Date().toISOString(),
    },
    history: input.history,
    artifacts: input.artifacts,
    metadata: input.metadata,
  };
}

export function makeTaskStatusUpdate(input: {
  taskId: string;
  contextId: string;
  state: TaskState;
  message?: Message;
  final: boolean;
  metadata?: Record<string, unknown>;
}): import("./types.js").TaskStatusUpdateEvent {
  return {
    kind: "status-update",
    taskId: input.taskId,
    contextId: input.contextId,
    status: {
      state: input.state,
      message: input.message,
      timestamp: new Date().toISOString(),
    },
    final: input.final,
    metadata: input.metadata,
  };
}

export function makeTaskArtifactUpdate(input: {
  taskId: string;
  contextId: string;
  artifact: Artifact;
  append?: boolean;
  lastChunk?: boolean;
  metadata?: Record<string, unknown>;
}): import("./types.js").TaskArtifactUpdateEvent {
  return {
    kind: "artifact-update",
    taskId: input.taskId,
    contextId: input.contextId,
    artifact: input.artifact,
    append: input.append,
    lastChunk: input.lastChunk,
    metadata: input.metadata,
  };
}

export function makeMessage(
  role: "user" | "agent",
  parts: Part[],
  opts: { contextId?: string; taskId?: string; metadata?: Record<string, unknown> } = {},
): Message {
  return {
    kind: "message",
    messageId: randomUUID(),
    role,
    parts,
    contextId: opts.contextId,
    taskId: opts.taskId,
    metadata: opts.metadata,
  };
}

export function makeTextPart(text: string): Part {
  return { kind: "text", text };
}

export function makeDataPart(data: Record<string, unknown>): Part {
  return { kind: "data", data };
}

export function makeFilePart(
  file: { name?: string; mimeType?: string; bytes?: string; uri?: string },
): Part {
  if (file.bytes !== undefined) {
    return {
      kind: "file",
      file: { name: file.name, mimeType: file.mimeType, bytes: file.bytes },
    };
  }
  if (file.uri !== undefined) {
    return {
      kind: "file",
      file: { name: file.name, mimeType: file.mimeType, uri: file.uri },
    };
  }
  throw new Error("FilePart requires either bytes or uri");
}
