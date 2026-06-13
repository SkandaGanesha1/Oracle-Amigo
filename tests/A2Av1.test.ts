import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import Fastify from "fastify";
import {
  A2Av1Handler,
  type A2Av1Context
} from "../src/protocol/a2a-v1/A2Av1Handler.js";
import { registerA2Av1Routes, registerA2Av1RoutesWithOptions, getA2Av1UrlRewriter } from "../src/protocol/a2a-v1/A2Av1Routes.js";
import {
  A2A_V1_MEDIA_TYPE,
  A2A_V1_PROTOCOL_VERSION,
  A2A_V1_VERSION_HEADER,
  A2A_V1_AGENT_CARD_PATH,
  A2A_ERROR_CODES,
  newServerTaskId,
  isTerminalV1State,
  type A2Av1AgentCard,
  type A2Av1Message,
  type A2Av1Task,
  type A2Av1TaskPushNotificationConfig,
  type A2Av1PushNotificationConfig
} from "../src/protocol/a2a-v1/types.js";
import {
  A2Av1PushNotificationStore,
  buildPushNotificationHeaders,
  deliverToTask
} from "../src/protocol/a2a-v1/A2Av1PushNotificationHandler.js";
import {
  buildV1AgentCard,
  signCardWithRs256,
  verifySignedCard,
  cardFingerprint,
  canonicalizeCard
} from "../src/protocol/a2a-v1/AgentCardV1.js";
import {
  A2Av1SseStreamer,
  makeV1Task,
  makeV1TextPart,
  makeV1Message,
  makeStatusUpdate,
  makeArtifactUpdate
} from "../src/protocol/a2a-v1/A2Av1StreamHandler.js";

interface MockState {
  tasks: Map<string, A2Av1Task>;
  messages: Map<string, A2Av1Message>;
  pushConfigs: A2Av1PushNotificationStore;
}

function makeMockContext(): { ctx: A2Av1Context; state: MockState; card: A2Av1AgentCard } {
  const card = buildV1AgentCard(
    {
      name: "Test Agent v1",
      description: "Test A2A v1 agent",
      version: "1.0.0",
      organization: "Test Org",
      organizationUrl: "https://test.example.com",
      skills: [
        {
          id: "test.skill",
          name: "Test skill",
          description: "A test skill",
          tags: ["test"],
          inputModes: ["text/plain"],
          outputModes: ["application/json"]
        }
      ],
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["application/json"]
    },
    { publicBaseUrl: "http://127.0.0.1:3399" }
  );

  const state: MockState = {
    tasks: new Map(),
    messages: new Map(),
    pushConfigs: new A2Av1PushNotificationStore()
  };

  const ctx: A2Av1Context = {
    agentCard: card,
    onMessageSend: async (message) => {
      const id = newServerTaskId();
      const ctxId = message.contextId ?? newServerTaskId();
      const task: A2Av1Task = {
        id,
        contextId: ctxId,
        status: {
          state: "TASK_STATE_WORKING",
          timestamp: new Date().toISOString(),
          message: {
            messageId: newServerTaskId(),
            role: "ROLE_AGENT",
            parts: [{ text: "Echo: " + (message.parts[0] && "text" in message.parts[0] ? message.parts[0].text : "") }],
            contextId: ctxId,
            taskId: id,
            timestamp: new Date().toISOString()
          }
        },
        history: [message]
      };
      state.tasks.set(id, task);
      return task;
    },
    onMessageStream: async (message, configuration) => {
      const id = newServerTaskId();
      const ctxId = message.contextId ?? newServerTaskId();
      configuration.emit({
        type: "message",
        taskId: id,
        contextId: ctxId,
        message: makeV1Message({ role: "ROLE_AGENT", parts: [makeV1TextPart("stream hi")], contextId: ctxId, taskId: id })
      });
      configuration.emit({
        type: "status",
        event: makeStatusUpdate({ taskId: id, contextId: ctxId, state: "TASK_STATE_WORKING", final: false })
      });
      configuration.emit({
        type: "status",
        event: makeStatusUpdate({ taskId: id, contextId: ctxId, state: "TASK_STATE_COMPLETED", final: true })
      });
    },
    onTaskGet: async (id) => state.tasks.get(id) ?? null,
    onTaskList: async ({ contextId, state: stateFilter, pageSize = 50, pageToken }) => {
      let all = Array.from(state.tasks.values());
      if (contextId) all = all.filter((t) => t.contextId === contextId);
      if (stateFilter) all = all.filter((t) => t.status.state === stateFilter);
      const start = pageToken ? Number(Buffer.from(pageToken, "base64").toString("utf8")) : 0;
      const page = all.slice(start, start + pageSize);
      const nextIdx = start + page.length;
      const nextPageToken = nextIdx < all.length ? Buffer.from(String(nextIdx)).toString("base64") : undefined;
      return { tasks: page, nextPageToken, totalSize: all.length };
    },
    onTaskCancel: async (id) => {
      const t = state.tasks.get(id);
      if (!t) return null;
      t.status = { state: "TASK_STATE_CANCELED", timestamp: new Date().toISOString() };
      return t;
    },
    onTaskResubscribe: async (id, configuration) => {
      const t = state.tasks.get(id);
      if (!t) {
        configuration.emit({
          type: "status",
          event: makeStatusUpdate({ taskId: id, contextId: "", state: "TASK_STATE_FAILED", final: true })
        });
        return;
      }
      configuration.emit({
        type: "status",
        event: makeStatusUpdate({ taskId: t.id, contextId: t.contextId, state: t.status.state, final: isTerminalV1State(t.status.state) })
      });
    },
    onPushNotificationConfigSet: async (taskId, config) => {
      const stored = state.pushConfigs.set(taskId, config);
      return { taskId, taskPushNotificationConfig: stored.taskPushNotificationConfig };
    },
    onPushNotificationConfigGet: async (taskId, configId) => state.pushConfigs.get(taskId, configId),
    onPushNotificationConfigList: async (taskId) => state.pushConfigs.list(taskId),
    onPushNotificationConfigDelete: async (taskId, configId) => state.pushConfigs.delete(taskId, configId),
    supportsAuthenticatedExtendedCard: () => true,
    onGetAuthenticatedExtendedCard: async () => ({
      ...card,
      skills: [...card.skills, { id: "internal.diag", name: "Diagnostics", description: "Internal" }]
    })
  };

  return { ctx, state, card };
}

describe("A2A v1.0.0 — types and helpers", () => {
  it("exports protocol version 1.0", () => {
    expect(A2A_V1_PROTOCOL_VERSION).toBe("1.0");
  });

  it("isTerminalV1State recognises the four terminal states", () => {
    expect(isTerminalV1State("TASK_STATE_COMPLETED")).toBe(true);
    expect(isTerminalV1State("TASK_STATE_FAILED")).toBe(true);
    expect(isTerminalV1State("TASK_STATE_REJECTED")).toBe(true);
    expect(isTerminalV1State("TASK_STATE_CANCELED")).toBe(true);
    expect(isTerminalV1State("TASK_STATE_WORKING")).toBe(false);
    expect(isTerminalV1State("TASK_STATE_SUBMITTED")).toBe(false);
    expect(isTerminalV1State("TASK_STATE_UNSPECIFIED")).toBe(false);
  });

  it("newServerTaskId returns a v4 UUID", () => {
    const id = newServerTaskId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});

describe("A2A v1.0.0 — AgentCardV1 builder and JWS", () => {
  it("buildV1AgentCard uses protocolVersion 1.0 and supportedInterfaces", () => {
    const card = buildV1AgentCard(
      {
        name: "Acme",
        description: "Acme agent",
        version: "1.0.0",
        organization: "Acme",
        skills: [{ id: "x", name: "X" }]
      },
      { publicBaseUrl: "http://127.0.0.1:3399" }
    );
    expect(card.protocolVersion).toBe("1.0");
    expect(card.supportedInterfaces).toHaveLength(1);
    expect(card.supportedInterfaces[0].protocolBinding).toBe("HTTP+JSON");
    expect(card.supportedInterfaces[0].protocolVersion).toBe("1.0");
    expect(card.preferredTransport).toBe("HTTP+JSON");
    // v1 spec: must NOT have `additionalInterfaces` (only v0.3 used that)
    expect("additionalInterfaces" in card).toBe(false);
  });

  it("canonicalizeCard produces stable output regardless of key order", () => {
    const a = canonicalizeCard({ b: 1, a: 2, c: { y: 1, x: 2 } });
    const b = canonicalizeCard({ c: { x: 2, y: 1 }, a: 2, b: 1 });
    expect(a).toBe(b);
  });

  it("canonicalizeCard excludes top-level signatures from the payload", () => {
    expect(canonicalizeCard({ b: 1, signatures: [{ signature: "ignored" }], a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("canonicalizeCard rejects values that are not valid JCS JSON", () => {
    expect(() => canonicalizeCard({ a: undefined })).toThrow(/undefined/);
    expect(() => canonicalizeCard({ a: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalizeCard({ a: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
    expect(() => canonicalizeCard({ a: -0 })).toThrow(/negative zero/);
    expect(() => canonicalizeCard({ a: () => "x" })).toThrow(/function/);
  });

  it("canonicalizeCard preserves array order and sorts unicode object keys by code point", () => {
    const out = canonicalizeCard({ z: [2, 1], "\u{1f600}": true, a: { b: 2, a: 1 } });
    expect(out).toBe('{"a":{"a":1,"b":2},"z":[2,1],"😀":true}');
  });

  it("JWS RS256 sign + verify round-trip", () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const card = buildV1AgentCard(
      { name: "X", version: "1.0.0", organization: "X", skills: [] },
      { publicBaseUrl: "http://127.0.0.1:3399" }
    );
    const signed = signCardWithRs256(
      card,
      privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      "test-kid-1"
    );
    expect(signed.signatures).toBeDefined();
    expect(signed.signatures).toHaveLength(1);
    expect(signed.signatures?.[0].header.typ).toBe("JOSE");
    const protectedHeader = JSON.parse(Buffer.from(signed.signatures![0].protected, "base64url").toString("utf8")) as { typ: string };
    expect(protectedHeader.typ).toBe("JOSE");
    const verified = verifySignedCard(
      signed,
      publicKey.export({ type: "spki", format: "pem" }).toString()
    );
    expect(verified.protocolVersion).toBe("1.0");
    expect(verified.name).toBe(card.name);
  });

  it("JWS verify rejects a tampered card", () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const card = buildV1AgentCard(
      { name: "X", version: "1.0.0", organization: "X", skills: [] },
      { publicBaseUrl: "http://127.0.0.1:3399" }
    );
    const signed = signCardWithRs256(
      card,
      privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      "test-kid-1"
    );
    const tampered: A2Av1AgentCard = { ...signed, name: "Tampered" };
    expect(() =>
      verifySignedCard(tampered, publicKey.export({ type: "spki", format: "pem" }).toString())
    ).toThrow(/JWS signature verification failed/);
  });

  it("cardFingerprint is stable for the same content", () => {
    const card = buildV1AgentCard(
      { name: "X", version: "1.0.0", organization: "X", skills: [] },
      { publicBaseUrl: "http://127.0.0.1:3399" }
    );
    const a = cardFingerprint(card);
    const b = cardFingerprint({ ...card });
    expect(a).toBe(b);
  });
});

describe("A2A v1.0.0 — Parts and Messages", () => {
  it("isTextPart / isFilePart / isDataPart discriminators work", async () => {
    const { isTextPart, isFilePart, isDataPart } = await import("../src/protocol/a2a-v1/types.js");
    const text = { text: "hi" };
    const file = { file: { name: "x.txt" } };
    const data = { data: { k: "v" } };
    expect(isTextPart(text as never)).toBe(true);
    expect(isFilePart(file as never)).toBe(true);
    expect(isDataPart(data as never)).toBe(true);
  });

  it("makeV1Task auto-generates id/contextId and timestamp", () => {
    const t = makeV1Task({ state: "TASK_STATE_WORKING" });
    expect(t.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(t.contextId).toMatch(/^[0-9a-f-]{36}$/);
    expect(t.status.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(t.status.state).toBe("TASK_STATE_WORKING");
  });
});

describe("A2A v1.0.0 — PushNotificationStore", () => {
  it("set/get/list/delete CRUD", () => {
    const store = new A2Av1PushNotificationStore();
    const c1 = store.set("task-1", { url: "https://example.com/webhook1", token: "tok1" });
    const c2 = store.set("task-1", { url: "https://example.com/webhook2" });
    const c3 = store.set("task-2", { url: "https://example.com/webhook3" });
    expect(store.list("task-1")).toHaveLength(2);
    expect(store.list("task-2")).toHaveLength(1);
    expect(store.get("task-1", c1.taskPushNotificationConfig.id!)).toBeDefined();
    expect(store.delete("task-1", c2.taskPushNotificationConfig.id!)).toBe(true);
    expect(store.list("task-1")).toHaveLength(1);
    expect(store.delete("task-1", "non-existent")).toBe(false);
    expect(store.size()).toBe(2);
  });

  it("buildPushNotificationHeaders includes bearer token + content-type", () => {
    const headers = buildPushNotificationHeaders(
      { url: "https://x", token: "opaque-tok", authentication: { schemes: ["bearer"], credentials: "abc" } },
      "{}"
    );
    expect(headers["Content-Type"]).toBe("application/a2a+json");
    expect(headers["A2A-Version"]).toBe("1.0");
    expect(headers.Authorization).toBe("Bearer abc");
    expect(headers["X-A2A-Notification-Token"]).toBe("opaque-tok");
  });

  it("buildPushNotificationHeaders encodes basic auth", () => {
    const headers = buildPushNotificationHeaders(
      { url: "https://x", authentication: { schemes: ["basic"], credentials: "user:pass" } },
      "{}"
    );
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("user:pass").toString("base64")}`);
  });

  it("deliverToTask posts to all registered URLs", async () => {
    const store = new A2Av1PushNotificationStore();
    const calls: Array<{ url: string; body: string }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), body: init?.body as string });
      return new Response("ok", { status: 200 });
    };
    store.set("task-A", { url: "https://a.example.com/hook" });
    store.set("task-A", { url: "https://b.example.com/hook" });
    const results = await deliverToTask(store, "task-A", JSON.stringify({ x: 1 }), fakeFetch);
    expect(calls).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("rejects private webhook URLs", () => {
    const store = new A2Av1PushNotificationStore();
    expect(() => store.set("task-A", { url: "http://169.254.169.254/latest/meta-data" })).toThrow(/HTTPS/);
    expect(() => store.set("task-A", { url: "https://127.0.0.1/hook" })).toThrow(/not allowed/);
  });
});

describe("A2A v1.0.0 — HTTP+JSON routes (full integration)", () => {
  let server: Awaited<ReturnType<typeof Fastify>>;
  let ctx: A2Av1Context;
  let state: MockState;
  let card: A2Av1AgentCard;
  let baseUrl: string;

  beforeEach(async () => {
    const mock = makeMockContext();
    ctx = mock.ctx;
    state = mock.state;
    card = mock.card;
    server = Fastify({ rewriteUrl: getA2Av1UrlRewriter() });
    // Register a2a+json content-type parser for the test server
    server.addContentTypeParser("application/a2a+json", { parseAs: "string" }, (_req: unknown, body: unknown, done: (err: Error | null, val?: unknown) => void) => {
      try { done(null, body ? JSON.parse(body as string) : {}); } catch (err) { done(err as Error, undefined); }
    });
    const handler = new A2Av1Handler(ctx);
    registerA2Av1Routes(server, handler);
    baseUrl = await server.listen({ host: "127.0.0.1", port: 0 });
  });

  afterEach(async () => {
    await server.close();
  });

  it("GET /.well-known/agent-card.json returns a v1 card", async () => {
    const res = await fetch(`${baseUrl}${A2A_V1_AGENT_CARD_PATH}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain(A2A_V1_MEDIA_TYPE);
    expect(res.headers.get(A2A_V1_VERSION_HEADER)).toBe("1.0");
    const body = (await res.json()) as A2Av1AgentCard;
    expect(body.protocolVersion).toBe("1.0");
    expect(body.supportedInterfaces).toBeDefined();
    expect("additionalInterfaces" in body).toBe(false);
    expect(JSON.stringify(body)).not.toContain('"kind"');
  });

  it("POST /v1/message:send creates a task with v1 SCREAMING_SNAKE_CASE state", async () => {
    const res = await fetch(`${baseUrl}/v1/message:send`, {
      method: "POST",
      headers: { "Content-Type": A2A_V1_MEDIA_TYPE, "A2A-Version": "1.0" },
      body: JSON.stringify({
        message: {
          messageId: newServerTaskId(),
          role: "ROLE_USER",
          parts: [{ text: "hello" }],
          contextId: "ctx-1"
        }
      })
    });
    expect(res.status).toBe(200);
    const task = (await res.json()) as A2Av1Task;
    expect(task.id).toBeDefined();
    expect(task.contextId).toBe("ctx-1");
    expect(task.status.state).toBe("TASK_STATE_WORKING");
    expect(task.history?.[0].role).toBe("ROLE_USER");
    expect(task.history?.[0].parts[0]).toEqual({ text: "hello" });
    // Members-based polymorphism: NO `kind` field anywhere in the wire payload.
    expect(JSON.stringify(task)).not.toContain('"kind"');
  });

  it("POST /v1/message:send validates missing message", async () => {
    const res = await fetch(`${baseUrl}/v1/message:send`, {
      method: "POST",
      headers: { "Content-Type": A2A_V1_MEDIA_TYPE },
      body: JSON.stringify({})
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: number };
    expect(body.code).toBe(A2A_ERROR_CODES.INVALID_AGENT_RESPONSE);
  });

  it("GET /v1/tasks/:id returns the task", async () => {
    const created = (await (await fetch(`${baseUrl}/v1/message:send`, {
      method: "POST",
      headers: { "Content-Type": A2A_V1_MEDIA_TYPE },
      body: JSON.stringify({
        message: { messageId: newServerTaskId(), role: "ROLE_USER", parts: [{ text: "x" }] }
      })
    })).json()) as A2Av1Task;
    const res = await fetch(`${baseUrl}/v1/tasks/${created.id}`);
    expect(res.status).toBe(200);
    const task = (await res.json()) as A2Av1Task;
    expect(task.id).toBe(created.id);
    expect(task.status.state).toBe("TASK_STATE_WORKING");
  });

  it("GET /v1/tasks/:id returns 404 TASK_NOT_FOUND for unknown id", async () => {
    const res = await fetch(`${baseUrl}/v1/tasks/nonexistent-id`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code?: number };
    expect(body.code).toBe(A2A_ERROR_CODES.TASK_NOT_FOUND);
  });

  it("GET /v1/tasks lists tasks with cursor pagination", async () => {
    // Create 3 tasks
    for (let i = 0; i < 3; i++) {
      await fetch(`${baseUrl}/v1/message:send`, {
        method: "POST",
        headers: { "Content-Type": A2A_V1_MEDIA_TYPE },
        body: JSON.stringify({
          message: { messageId: newServerTaskId(), role: "ROLE_USER", parts: [{ text: `t${i}` }] }
        })
      });
    }
    const res = await fetch(`${baseUrl}/v1/tasks?pageSize=2`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tasks: A2Av1Task[]; nextPageToken?: string };
    expect(body.tasks.length).toBe(2);
    expect(body.nextPageToken).toBeDefined();
  });

  it("POST /v1/tasks/:id:cancel transitions to TASK_STATE_CANCELED", async () => {
    const created = (await (await fetch(`${baseUrl}/v1/message:send`, {
      method: "POST",
      headers: { "Content-Type": A2A_V1_MEDIA_TYPE },
      body: JSON.stringify({
        message: { messageId: newServerTaskId(), role: "ROLE_USER", parts: [{ text: "x" }] }
      })
    })).json()) as A2Av1Task;
    const res = await fetch(`${baseUrl}/v1/tasks/${created.id}:cancel`, { method: "POST" });
    expect(res.status).toBe(200);
    const task = (await res.json()) as A2Av1Task;
    expect(task.status.state).toBe("TASK_STATE_CANCELED");
  });

  it("POST /v1/tasks/:id:subscribe supports the official subscribe route", async () => {
    const created = (await (await fetch(`${baseUrl}/v1/message:send`, {
      method: "POST",
      headers: { "Content-Type": A2A_V1_MEDIA_TYPE },
      body: JSON.stringify({
        message: { messageId: newServerTaskId(), role: "ROLE_USER", parts: [{ text: "x" }] }
      })
    })).json()) as A2Av1Task;
    const res = await fetch(`${baseUrl}/v1/tasks/${created.id}:subscribe`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("statusUpdate");
  });

  it("POST /v1/tasks/subscribe/:id remains a compatibility route", async () => {
    const created = (await (await fetch(`${baseUrl}/v1/message:send`, {
      method: "POST",
      headers: { "Content-Type": A2A_V1_MEDIA_TYPE },
      body: JSON.stringify({
        message: { messageId: newServerTaskId(), role: "ROLE_USER", parts: [{ text: "x" }] }
      })
    })).json()) as A2Av1Task;
    const res = await fetch(`${baseUrl}/v1/tasks/subscribe/${created.id}`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });

  it("POST /v1/tasks/:id/pushNotificationConfigs creates a config", async () => {
    const created = (await (await fetch(`${baseUrl}/v1/message:send`, {
      method: "POST",
      headers: { "Content-Type": A2A_V1_MEDIA_TYPE },
      body: JSON.stringify({
        message: { messageId: newServerTaskId(), role: "ROLE_USER", parts: [{ text: "x" }] }
      })
    })).json()) as A2Av1Task;
    const res = await fetch(`${baseUrl}/v1/tasks/${created.id}/pushNotificationConfigs`, {
      method: "POST",
      headers: { "Content-Type": A2A_V1_MEDIA_TYPE },
      body: JSON.stringify({
        taskPushNotificationConfig: { url: "https://example.com/hook", token: "tok" }
      })
    });
    expect(res.status).toBe(201);
    const config = (await res.json()) as A2Av1TaskPushNotificationConfig;
    expect(config.taskPushNotificationConfig.id).toBeDefined();
    expect(config.taskPushNotificationConfig.url).toBe("https://example.com/hook");
    expect("pushNotificationConfig" in config).toBe(false);
  });

  it("POST /v1/tasks/:id/pushNotificationConfigs accepts legacy pushNotificationConfig but emits taskPushNotificationConfig", async () => {
    const created = (await (await fetch(`${baseUrl}/v1/message:send`, {
      method: "POST",
      headers: { "Content-Type": A2A_V1_MEDIA_TYPE },
      body: JSON.stringify({
        message: { messageId: newServerTaskId(), role: "ROLE_USER", parts: [{ text: "x" }] }
      })
    })).json()) as A2Av1Task;
    const res = await fetch(`${baseUrl}/v1/tasks/${created.id}/pushNotificationConfigs`, {
      method: "POST",
      headers: { "Content-Type": A2A_V1_MEDIA_TYPE },
      body: JSON.stringify({
        pushNotificationConfig: { url: "https://legacy.example.com/hook", token: "tok" }
      })
    });
    expect(res.status).toBe(201);
    const config = (await res.json()) as A2Av1TaskPushNotificationConfig;
    expect(config.taskPushNotificationConfig.url).toBe("https://legacy.example.com/hook");
    expect("pushNotificationConfig" in config).toBe(false);
  });

  it("GET /v1/tasks/:id/pushNotificationConfigs lists configs", async () => {
    const created = (await (await fetch(`${baseUrl}/v1/message:send`, {
      method: "POST",
      headers: { "Content-Type": A2A_V1_MEDIA_TYPE },
      body: JSON.stringify({
        message: { messageId: newServerTaskId(), role: "ROLE_USER", parts: [{ text: "x" }] }
      })
    })).json()) as A2Av1Task;
    await fetch(`${baseUrl}/v1/tasks/${created.id}/pushNotificationConfigs`, {
      method: "POST",
      headers: { "Content-Type": A2A_V1_MEDIA_TYPE },
      body: JSON.stringify({ taskPushNotificationConfig: { url: "https://a.example.com" } })
    });
    const res = await fetch(`${baseUrl}/v1/tasks/${created.id}/pushNotificationConfigs`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { configs: A2Av1TaskPushNotificationConfig[] };
    expect(body.configs).toHaveLength(1);
  });

  it("DELETE /v1/tasks/:id/pushNotificationConfigs/:configId removes a config", async () => {
    const created = (await (await fetch(`${baseUrl}/v1/message:send`, {
      method: "POST",
      headers: { "Content-Type": A2A_V1_MEDIA_TYPE },
      body: JSON.stringify({
        message: { messageId: newServerTaskId(), role: "ROLE_USER", parts: [{ text: "x" }] }
      })
    })).json()) as A2Av1Task;
    const cfgRes = await (await fetch(`${baseUrl}/v1/tasks/${created.id}/pushNotificationConfigs`, {
      method: "POST",
      headers: { "Content-Type": A2A_V1_MEDIA_TYPE },
      body: JSON.stringify({ taskPushNotificationConfig: { url: "https://a.example.com" } })
    })).json() as A2Av1TaskPushNotificationConfig;
    const delRes = await fetch(
      `${baseUrl}/v1/tasks/${created.id}/pushNotificationConfigs/${cfgRes.taskPushNotificationConfig.id}`,
      { method: "DELETE" }
    );
    expect(delRes.status).toBe(204);
    const list = await (await fetch(`${baseUrl}/v1/tasks/${created.id}/pushNotificationConfigs`)).json() as { configs: unknown[] };
    expect(list.configs).toHaveLength(0);
  });

  it("GET /v1/extendedAgentCard returns the extended card", async () => {
    const res = await fetch(`${baseUrl}/v1/extendedAgentCard`, {
      headers: { Authorization: "Bearer local-test" }
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as A2Av1AgentCard;
    expect(body.skills.find((s) => s.id === "internal.diag")).toBeDefined();
  });

  it("GET /v1/extendedAgentCard requires auth", async () => {
    const res = await fetch(`${baseUrl}/v1/extendedAgentCard`);
    expect(res.status).toBe(401);
  });

  it("multi-tenancy: /v1/{tenant}/message:send works", async () => {
    const res = await fetch(`${baseUrl}/v1/acme-corp/message:send`, {
      method: "POST",
      headers: { "Content-Type": A2A_V1_MEDIA_TYPE },
      body: JSON.stringify({
        message: { messageId: newServerTaskId(), role: "ROLE_USER", parts: [{ text: "x" }] }
      })
    });
    expect(res.status).toBe(200);
    const task = (await res.json()) as A2Av1Task;
    expect(task.id).toBeDefined();
  });
});

describe("A2A v1.0.0 — Streaming (SSE)", () => {
  let server: Awaited<ReturnType<typeof Fastify>>;

  beforeEach(async () => {
    const mock = makeMockContext();
    server = Fastify({ rewriteUrl: getA2Av1UrlRewriter() });
    server.addContentTypeParser("application/a2a+json", { parseAs: "string" }, (_req: unknown, body: unknown, done: (err: Error | null, val?: unknown) => void) => {
      try { done(null, body ? JSON.parse(body as string) : {}); } catch (err) { done(err as Error, undefined); }
    });
    const handler = new A2Av1Handler(mock.ctx);
    registerA2Av1Routes(server, handler);
    await server.listen({ host: "127.0.0.1", port: 0 });
  });

  afterEach(async () => {
    await server.close();
  });

  it("POST /v1/message:stream emits SSE data frames with v1 shape", async () => {
    const addr = server.server.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    const url = `http://127.0.0.1:${addr.port}/v1/message:stream`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": A2A_V1_MEDIA_TYPE, "A2A-Version": "1.0" },
      body: JSON.stringify({
        message: { messageId: newServerTaskId(), role: "ROLE_USER", parts: [{ text: "hi" }] }
      })
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    // Each SSE data line begins with `data: {`
    const dataLines = text.split("\n").filter((l) => l.startsWith("data: "));
    expect(dataLines.length).toBeGreaterThan(0);
    const frames = dataLines.map((l) => JSON.parse(l.substring(6)));
    // At least one statusUpdate with `final: true`
    const final = frames.find((f) => f.statusUpdate && f.statusUpdate.final === true);
    expect(final).toBeDefined();
    expect(final.statusUpdate.status.state).toBe("TASK_STATE_COMPLETED");
  });
});

describe("A2A v1.0.0 — remote route auth", () => {
  let server: Awaited<ReturnType<typeof Fastify>>;
  let baseUrl: string;

  beforeEach(async () => {
    const mock = makeMockContext();
    server = Fastify({ rewriteUrl: getA2Av1UrlRewriter() });
    server.addContentTypeParser("application/a2a+json", { parseAs: "string" }, (_req: unknown, body: unknown, done: (err: Error | null, val?: unknown) => void) => {
      try { done(null, body ? JSON.parse(body as string) : {}); } catch (err) { done(err as Error, undefined); }
    });
    registerA2Av1RoutesWithOptions(server, new A2Av1Handler(mock.ctx), {
      requireRemoteAuth: true,
      verifyAuth: (request, tenant) => {
        const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
        if (token !== "valid-token") return null;
        return {
          token,
          orgId: "org-a",
          callerAgentInstanceId: "agent-a",
          targetAgentInstanceId: "agent-b",
          skillScopes: ["message.send"]
        };
      }
    });
    baseUrl = await server.listen({ host: "127.0.0.1", port: 0 });
  });

  afterEach(async () => {
    await server.close();
  });

  it("remote A2A route rejects no token", async () => {
    const res = await fetch(`${baseUrl}/v1/message:send`, {
      method: "POST",
      headers: { "Content-Type": A2A_V1_MEDIA_TYPE },
      body: JSON.stringify({
        message: { messageId: newServerTaskId(), role: "ROLE_USER", parts: [{ text: "x" }] }
      })
    });
    expect(res.status).toBe(401);
  });

  it("remote A2A route rejects cross-org caller", async () => {
    const res = await fetch(`${baseUrl}/v1/org-b/message:send`, {
      method: "POST",
      headers: {
        "Content-Type": A2A_V1_MEDIA_TYPE,
        Authorization: "Bearer valid-token",
        "X-A2A-Target-Agent-Instance-Id": "agent-b"
      },
      body: JSON.stringify({
        message: { messageId: newServerTaskId(), role: "ROLE_USER", parts: [{ text: "x" }] }
      })
    });
    expect(res.status).toBe(403);
  });
});

describe("A2A v1.0.0 — Error codes (port from v0.3 spec)", () => {
  it("exports the canonical A2A_ERROR_CODES table", () => {
    expect(A2A_ERROR_CODES.TASK_NOT_FOUND).toBe(-32001);
    expect(A2A_ERROR_CODES.TASK_NOT_CANCELABLE).toBe(-32002);
    expect(A2A_ERROR_CODES.PUSH_NOTIFICATION_NOT_SUPPORTED).toBe(-32003);
    expect(A2A_ERROR_CODES.UNSUPPORTED_OPERATION).toBe(-32004);
    expect(A2A_ERROR_CODES.CONTENT_TYPE_NOT_SUPPORTED).toBe(-32005);
    expect(A2A_ERROR_CODES.INVALID_AGENT_RESPONSE).toBe(-32006);
    expect(A2A_ERROR_CODES.AUTHENTICATED_EXTENDED_CARD_NOT_CONFIGURED).toBe(-32007);
  });
});
