import { describe, expect, it } from "vitest";
import {
  handleA2ARequest,
  makeMessage,
  makeTask,
  makeTextPart,
  makeTaskStatusUpdate,
  type A2AContext,
} from "../src/protocol/a2a/A2AHandler.js";
import { A2A_PROTOCOL_VERSION, JSONRPC_ERROR_CODES } from "../src/protocol/a2a/types.js";
import { buildAgentCard, ORACLE_AMIGO_SKILLS } from "../src/protocol/a2a/AgentCard.js";

function makeMockContext(): { ctx: A2AContext; pushConfigs: Map<string, unknown[]>; tasks: Map<string, unknown> } {
  const pushConfigs = new Map<string, unknown[]>();
  const tasks = new Map<string, unknown>();
  const card = buildAgentCard({
    name: "Test Agent",
    description: "Test",
    version: A2A_PROTOCOL_VERSION,
    baseUrl: "http://127.0.0.1:3399",
    organization: "Test Org",
    skills: ORACLE_AMIGO_SKILLS,
    supportsAuthenticatedExtendedCard: true,
  });
  const ctx: A2AContext = {
    agentCard: card,
    onMessageSend: async (msg) => {
      const id = `task-${Math.random()}`;
      tasks.set(id, { id, message: msg });
      return makeTask({ id, contextId: msg.contextId, state: "working", history: [msg] });
    },
    onMessageStream: async (msg, { emit }) => {
      const id = `stream-${Math.random()}`;
      emit(makeMessage("agent", [makeTextPart("stream hi")], { contextId: msg.contextId, taskId: id }));
      emit(makeTaskStatusUpdate({ taskId: id, contextId: msg.contextId ?? id, state: "completed", final: true }));
    },
    onTaskGet: async (id) => tasks.get(id) as any ?? null,
    onTaskList: async () => ({ tasks: Array.from(tasks.values()) as any }),
    onTaskCancel: async (id) => {
      const t = tasks.get(id) as any;
      if (!t) return null;
      t.status = { state: "canceled" };
      return t;
    },
    onTaskResubscribe: async (id, { emit }) => {
      const t = tasks.get(id) as any;
      if (t) emit(makeTaskStatusUpdate({ taskId: id, contextId: t.contextId ?? id, state: "completed", final: true }));
    },
    onPushNotificationConfigSet: async (taskId, config) => {
      const list = pushConfigs.get(taskId) ?? [];
      const stored = { taskId, pushNotificationConfig: { ...config, id: config.id ?? "cfg-1" } };
      list.push(stored);
      pushConfigs.set(taskId, list);
      return stored as any;
    },
    onPushNotificationConfigGet: async (taskId, configId) => {
      const list = pushConfigs.get(taskId) ?? [];
      return (list.find((c: any) => !configId || c.pushNotificationConfig.id === configId) as any) ?? null;
    },
    onPushNotificationConfigList: async (taskId) => (pushConfigs.get(taskId) ?? []) as any,
    onPushNotificationConfigDelete: async (taskId, configId) => {
      const list = pushConfigs.get(taskId) ?? [];
      const idx = list.findIndex((c: any) => c.pushNotificationConfig.id === configId);
      if (idx < 0) return false;
      list.splice(idx, 1);
      return true;
    },
    supportsAuthenticatedExtendedCard: () => true,
    onGetAuthenticatedExtendedCard: async () => ({ ...card, skills: [...ORACLE_AMIGO_SKILLS, { id: "diag", name: "Diag", description: "d", tags: [] }] }),
  };
  return { ctx, pushConfigs, tasks };
}

describe("A2A v0.3.0 protocol", () => {
  it("AgentCard has protocolVersion=0.3.0 and preferredTransport", () => {
    const card = buildAgentCard({
      name: "X", description: "Y", version: "1.0.0", baseUrl: "http://x",
      organization: "Org", skills: ORACLE_AMIGO_SKILLS,
    });
    expect(card.protocolVersion).toBe("0.3.0");
    expect(card.preferredTransport).toBe("JSONRPC");
    expect(card.capabilities.pushNotifications).toBe(true);
    expect(card.capabilities.streaming).toBe(true);
  });

  it("JSON-RPC error codes include v0.3.0 codes", () => {
    expect(JSONRPC_ERROR_CODES.PUSH_NOTIFICATION_NOT_SUPPORTED).toBe(-32003);
    expect(JSONRPC_ERROR_CODES.CONTENT_TYPE_NOT_SUPPORTED).toBe(-32005);
    expect(JSONRPC_ERROR_CODES.AUTHENTICATED_EXTENDED_CARD_NOT_CONFIGURED).toBe(-32007);
  });

  it("rejects non-JSON-RPC 2.0 requests", async () => {
    const { ctx } = makeMockContext();
    const response = await handleA2ARequest({ id: 1, method: "x", params: {} } as any, ctx);
    expect("error" in response).toBe(true);
    if ("error" in response) expect(response.error.code).toBe(JSONRPC_ERROR_CODES.INVALID_REQUEST);
  });

  it("rejects unknown method", async () => {
    const { ctx } = makeMockContext();
    const response = await handleA2ARequest({ jsonrpc: "2.0", id: 1, method: "nonsense/method", params: {} }, ctx);
    expect("error" in response).toBe(true);
    if ("error" in response) expect(response.error.code).toBe(JSONRPC_ERROR_CODES.METHOD_NOT_FOUND);
  });

  it("message/send returns a task with the new message and id", async () => {
    const { ctx } = makeMockContext();
    const msg = makeMessage("user", [makeTextPart("hello")]);
    const response = await handleA2ARequest({
      jsonrpc: "2.0", id: 1, method: "message/send", params: { message: msg },
    }, ctx);
    expect("result" in response).toBe(true);
    if ("result" in response) {
      const result = response.result as { kind: string; status: { state: string } };
      expect(result.kind).toBe("task");
      expect(result.status.state).toBe("working");
    }
  });

  it("message/stream returns the last streaming event", async () => {
    const { ctx } = makeMockContext();
    const msg = makeMessage("user", [makeTextPart("stream me")]);
    const response = await handleA2ARequest({
      jsonrpc: "2.0", id: 1, method: "message/stream", params: { message: msg },
    }, ctx);
    expect("result" in response).toBe(true);
    if ("result" in response) {
      const result = response.result as { kind: string; final: boolean };
      expect(result.kind).toBe("status-update");
      expect(result.final).toBe(true);
    }
  });

  it("tasks/list returns the task list", async () => {
    const { ctx, tasks } = makeMockContext();
    tasks.set("t1", { id: "t1", contextId: "c1", status: { state: "submitted" } });
    const response = await handleA2ARequest({
      jsonrpc: "2.0", id: 1, method: "tasks/list", params: {},
    }, ctx);
    expect("result" in response).toBe(true);
    if ("result" in response) {
      const result = response.result as { tasks: Array<{ id: string }> };
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].id).toBe("t1");
    }
  });

  it("tasks/cancel returns TASK_NOT_FOUND for unknown id", async () => {
    const { ctx } = makeMockContext();
    const response = await handleA2ARequest({
      jsonrpc: "2.0", id: 1, method: "tasks/cancel", params: { id: "missing" },
    }, ctx);
    expect("error" in response).toBe(true);
    if ("error" in response) expect(response.error.code).toBe(JSONRPC_ERROR_CODES.TASK_NOT_FOUND);
  });

  it("tasks/pushNotificationConfig/set stores config and returns it", async () => {
    const { ctx, pushConfigs } = makeMockContext();
    const response = await handleA2ARequest({
      jsonrpc: "2.0", id: 1, method: "tasks/pushNotificationConfig/set",
      params: { taskId: "t1", pushNotificationConfig: { url: "https://hook.example.com", token: "tok" } },
    }, ctx);
    expect("result" in response).toBe(true);
    if ("result" in response) {
      const result = response.result as { taskId: string; pushNotificationConfig: { url: string } };
      expect(result.taskId).toBe("t1");
      expect(result.pushNotificationConfig.url).toBe("https://hook.example.com");
    }
    expect(pushConfigs.get("t1")).toHaveLength(1);
  });

  it("tasks/pushNotificationConfig/get returns TASK_NOT_FOUND for unknown task", async () => {
    const { ctx } = makeMockContext();
    const response = await handleA2ARequest({
      jsonrpc: "2.0", id: 1, method: "tasks/pushNotificationConfig/get", params: { id: "missing" },
    }, ctx);
    expect("error" in response).toBe(true);
  });

  it("tasks/pushNotificationConfig/delete returns true and removes config", async () => {
    const { ctx, pushConfigs } = makeMockContext();
    await handleA2ARequest({
      jsonrpc: "2.0", id: 1, method: "tasks/pushNotificationConfig/set",
      params: { taskId: "t1", pushNotificationConfig: { url: "x", id: "cfg-1" } },
    }, ctx);
    const response = await handleA2ARequest({
      jsonrpc: "2.0", id: 1, method: "tasks/pushNotificationConfig/delete", params: { id: "t1", pushNotificationConfigId: "cfg-1" },
    }, ctx);
    expect("result" in response).toBe(true);
    expect(pushConfigs.get("t1") ?? []).toHaveLength(0);
  });

  it("agent/getAuthenticatedExtendedCard returns the extended card", async () => {
    const { ctx } = makeMockContext();
    const response = await handleA2ARequest({
      jsonrpc: "2.0", id: 1, method: "agent/getAuthenticatedExtendedCard", params: {},
    }, ctx);
    expect("result" in response).toBe(true);
    if ("result" in response) {
      const result = response.result as { supportsAuthenticatedExtendedCard: boolean; skills: Array<{ id: string }> };
      expect(result.supportsAuthenticatedExtendedCard).toBe(true);
      expect(result.skills.find((s) => s.id === "diag")).toBeDefined();
    }
  });
});
