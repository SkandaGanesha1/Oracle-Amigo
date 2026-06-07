import type { FastifyReply } from "fastify";
import { A2A_V1_MEDIA_TYPE, A2A_V1_VERSION_HEADER } from "./types.js";
import type {
  A2Av1StreamEvent,
  A2Av1Task,
  A2Av1Message,
  A2Av1TaskStatusUpdateEvent,
  A2Av1TaskArtifactUpdateEvent
} from "./types.js";

/**
 * A2A v1.0.0 stream emitter — passed to the context's onMessageStream /
 * onTaskResubscribe handlers. The handler converts emitted events to SSE
 * data frames on the wire.
 */
export type A2Av1StreamEmitter = (event: A2Av1StreamEvent) => void;

/**
 * A2A v1 SSE serializer (Server-Sent Events).
 *
 * Per the A2A v1 spec, streaming endpoints (`/message:stream` and
 * `/tasks/{id}:subscribe`) emit Server-Sent Events where each SSE
 * `data:` line contains a JSON object.
 *
 * Each event sent to `emit` is wrapped into the correct JSON shape:
 *   - `{ type: "task" }`            → `{ task: A2Av1Task }`
 *   - `{ type: "message" }`         → `{ message: A2Av1Message }`
 *   - `{ type: "status" }`          → `{ statusUpdate: A2Av1TaskStatusUpdateEvent }`
 *   - `{ type: "artifact" }`        → `{ artifactUpdate: A2Av1TaskArtifactUpdateEvent }`
 */
export class A2Av1SseStreamer {
  constructor(
    private reply: FastifyReply,
    private onClose?: () => void
  ) {}

  /** Write the SSE response headers and prepare the underlying raw socket. */
  open(): void {
    // Tell Fastify to back off — we are managing the raw response.
    this.reply.hijack();
    this.reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "A2A-Version": "1.0"
    });
  }

  /** Emit a single event as an SSE data frame. */
  emit(event: A2Av1StreamEvent): void {
    const payload = serializeEvent(event);
    this.reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  /** Emit a comment (keep-alive). */
  ping(): void {
    this.reply.raw.write(`: ping\n\n`);
  }

  /** Close the stream. */
  close(): void {
    this.reply.raw.end();
    this.onClose?.();
  }
}

function serializeEvent(event: A2Av1StreamEvent): unknown {
  switch (event.type) {
    case "task":
      return { task: event.task };
    case "message":
      return { message: event.message };
    case "status":
      return { statusUpdate: event.event };
    case "artifact":
      return { artifactUpdate: event.event };
  }
}

/** Helper: build a task-status-update event. */
export function makeStatusUpdate(input: {
  taskId: string;
  contextId: string;
  state: A2Av1TaskStatusUpdateEvent["status"]["state"];
  message?: A2Av1Message;
  final: boolean;
  metadata?: Record<string, unknown>;
}): A2Av1TaskStatusUpdateEvent {
  return {
    taskId: input.taskId,
    contextId: input.contextId,
    status: {
      state: input.state,
      message: input.message,
      timestamp: new Date().toISOString()
    },
    final: input.final,
    metadata: input.metadata
  };
}

/** Helper: build a task-artifact-update event. */
export function makeArtifactUpdate(input: {
  taskId: string;
  contextId: string;
  artifact: import("./types.js").A2Av1Artifact;
  append?: boolean;
  lastChunk?: boolean;
  metadata?: Record<string, unknown>;
}): A2Av1TaskArtifactUpdateEvent {
  return {
    taskId: input.taskId,
    contextId: input.contextId,
    artifact: input.artifact,
    append: input.append,
    lastChunk: input.lastChunk,
    metadata: input.metadata
  };
}

/** Helper: make a v1 message with auto-generated messageId and timestamp. */
export function makeV1Message(input: {
  role: "ROLE_USER" | "ROLE_AGENT";
  parts: import("./types.js").A2Av1Part[];
  contextId?: string;
  taskId?: string;
  messageId?: string;
  metadata?: Record<string, unknown>;
}): A2Av1Message {
  return {
    messageId: input.messageId ?? crypto.randomUUID(),
    role: input.role,
    parts: input.parts,
    contextId: input.contextId,
    taskId: input.taskId,
    metadata: input.metadata,
    timestamp: new Date().toISOString()
  };
}

export function makeV1TextPart(text: string): import("./types.js").A2Av1Part {
  return { text };
}

export function makeV1DataPart(data: Record<string, unknown>): import("./types.js").A2Av1Part {
  return { data };
}

export function makeV1FilePart(file: {
  name?: string;
  mimeType?: string;
  bytes?: string;
  uri?: string;
}): import("./types.js").A2Av1Part {
  return { file };
}

export function makeV1TaskStatus(state: import("./types.js").TaskState, message?: A2Av1Message): A2Av1Task["status"] {
  return {
    state,
    message,
    timestamp: new Date().toISOString()
  };
}

export function makeV1Task(input: {
  id?: string;
  contextId?: string;
  state: import("./types.js").TaskState;
  message?: A2Av1Message;
  history?: A2Av1Message[];
  artifacts?: import("./types.js").A2Av1Artifact[];
  metadata?: Record<string, unknown>;
}): A2Av1Task {
  return {
    id: input.id ?? crypto.randomUUID(),
    contextId: input.contextId ?? crypto.randomUUID(),
    status: makeV1TaskStatus(input.state, input.message),
    history: input.history,
    artifacts: input.artifacts,
    metadata: input.metadata
  };
}
