import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/main.js";
import { resetConfigForTest } from "../src/config.js";
import { closeAll, getControlPlaneStore } from "../src/db/connection.js";
import { postgresTestConfig, resetPostgresTestDatabase } from "./postgresTestHarness.js";

let app: FastifyInstance;
let dataDir: string;
let aliceDeviceToken = "";
let aliceAgentInstanceId = "";
let bobDeviceToken = "";
let bobAgentInstanceId = "";

async function signupAndEnroll(email: string): Promise<{ deviceToken: string; agentInstanceId: string }> {
  const signup = await app.inject({
    method: "POST",
    url: "/v1/auth/signup",
    payload: { email, password: "securePass123!", display_name: email }
  });
  expect(signup.statusCode).toBe(201);
  const accessToken = signup.json().access_token;
  const enroll = await app.inject({
    method: "POST",
    url: "/v1/enrollment/complete",
    headers: { authorization: `Bearer ${accessToken}` },
    payload: {
      device: {
        device_name: `${email}'s Laptop`,
        os: "win32",
        public_key: `-----BEGIN PUBLIC KEY-----\n${email}\n-----END PUBLIC KEY-----`
      },
      agent: {
        display_name: `${email}'s Oracle`,
        version: "0.1.0",
        capabilities: ["message.send", "file.request"],
        agent_card: { name: `${email}'s Oracle`, version: "0.1.0" }
      }
    }
  });
  expect(enroll.statusCode).toBe(200);
  return {
    deviceToken: enroll.json().device_access_token,
    agentInstanceId: enroll.json().agent_instance_id
  };
}

async function sendRelay(id: string, payload: Record<string, unknown> = { kind: "message", text: "hello" }) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/relay/a2a/send",
    headers: { authorization: `Bearer ${aliceDeviceToken}` },
    payload: {
      to_agent_instance_id: bobAgentInstanceId,
      a2a_task_id: `task-${id}`,
      type: "message.send",
      payload,
      idempotency_key: `idem-${id}`
    }
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

async function fetchBobInbox() {
  const res = await app.inject({
    method: "GET",
    url: "/v1/relay/a2a/inbox?limit=20",
    headers: { authorization: `Bearer ${bobDeviceToken}` }
  });
  expect(res.statusCode).toBe(200);
  return res.json().items as Array<Record<string, unknown>>;
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "relay-delivery-test-"));
  await resetPostgresTestDatabase();
  resetConfigForTest(postgresTestConfig({
    CONTROL_PLANE_PORT: "9997",
    CONTROL_PLANE_HOST: "127.0.0.1",
    CONTROL_PLANE_PUBLIC_URL: "http://127.0.0.1:9997",
    JWT_ACCESS_SECRET: "test-access-secret-must-be-16+",
    JWT_REFRESH_SECRET: "test-refresh-secret-must-be-16+",
    FILE_TRANSFER_STORE: join(dataDir, "transfers"),
    DEFAULT_ORG_SLUG: "relay-delivery",
    DEV_ADMIN_TOKEN: "test-admin-token-1234",
    CONTROL_PLANE_ENV: "test",
    METRICS_ENABLED: "false",
    RELAY_MAX_DELIVERY_ATTEMPTS: "2",
    RELAY_RETRY_BASE_MS: "100",
    RELAY_RETRY_MAX_MS: "500",
    RELAY_TASK_TTL_SECONDS: "3600"
  }));
  await closeAll();
  app = await buildApp();
  await app.ready();
  const suffix = Date.now();
  const alice = await signupAndEnroll(`alice-relay-${suffix}@example.com`);
  aliceDeviceToken = alice.deviceToken;
  aliceAgentInstanceId = alice.agentInstanceId;
  const bob = await signupAndEnroll(`bob-relay-${suffix}@example.com`);
  bobDeviceToken = bob.deviceToken;
  bobAgentInstanceId = bob.agentInstanceId;
});

afterAll(async () => {
  if (app) await app.close();
  await closeAll();
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("relay delivery semantics", () => {
  it("dedupes duplicate sends and makes receiver ack idempotent", async () => {
    const id = `dedupe-${Date.now()}`;
    const first = await sendRelay(id);
    const duplicate = await sendRelay(id);
    expect(duplicate.relay_task_id).toBe(first.relay_task_id);
    expect(duplicate.relay_message_id).toBe(first.relay_message_id);
    expect(duplicate.status).toBe("queued");

    const aliceAgent = await getControlPlaneStore().one<{ org_id: string }>(
      "SELECT org_id FROM agent_instances WHERE id = $1",
      [aliceAgentInstanceId]
    );
    expect(aliceAgent?.org_id).toBeTruthy();
    const actualCount = await getControlPlaneStore().one<{ cnt: string }>(
      "SELECT COUNT(*) AS cnt FROM relay_messages WHERE org_id = $1 AND from_agent_instance_id = $2 AND idempotency_key = $3",
      [aliceAgent!.org_id, aliceAgentInstanceId, `idem-${id}`]
    );
    expect(Number(actualCount?.cnt ?? 0)).toBe(1);

    const inbox = await fetchBobInbox();
    const item = inbox.find((row) => row.relay_task_id === first.relay_task_id);
    expect(item).toMatchObject({ status: "delivered", attempt_count: 1 });

    const ack1 = await app.inject({
      method: "POST",
      url: `/v1/relay/a2a/${encodeURIComponent(first.relay_task_id)}/ack`,
      headers: { authorization: `Bearer ${bobDeviceToken}` }
    });
    expect(ack1.statusCode).toBe(200);
    expect(ack1.json().status).toBe("stored_by_remote_agent");
    const ack2 = await app.inject({
      method: "POST",
      url: `/v1/relay/a2a/${encodeURIComponent(first.relay_task_id)}/ack`,
      headers: { authorization: `Bearer ${bobDeviceToken}` }
    });
    expect(ack2.statusCode).toBe(200);
    expect(ack2.json().status).toBe("stored_by_remote_agent");
  });

  it("keeps failed local dispatches unacked and retries after backoff", async () => {
    const sent = await sendRelay(`retry-${Date.now()}`, { kind: "message", text: "retry me" });
    await expect(fetchBobInbox().then((items) => items.some((item) => item.relay_task_id === sent.relay_task_id))).resolves.toBe(true);

    await getControlPlaneStore().execute(
      "UPDATE relay_tasks SET next_retry_at = $1 WHERE id = $2",
      [new Date(Date.now() - 1000).toISOString(), sent.relay_task_id]
    );
    const retryInbox = await fetchBobInbox();
    const retryItem = retryInbox.find((row) => row.relay_task_id === sent.relay_task_id);
    expect(retryItem).toMatchObject({ attempt_count: 2 });
  });

  it("dead-letters tasks after max attempts", async () => {
    const sent = await sendRelay(`dead-letter-${Date.now()}`);
    await fetchBobInbox();
    await getControlPlaneStore().execute(`
      UPDATE relay_tasks
      SET attempt_count = max_attempts,
          next_retry_at = $1
      WHERE id = $2
    `, [new Date(Date.now() - 1000).toISOString(), sent.relay_task_id]);

    const inbox = await fetchBobInbox();
    expect(inbox.some((row) => row.relay_task_id === sent.relay_task_id)).toBe(false);
    const task = await app.inject({
      method: "GET",
      url: `/v1/relay/a2a/tasks/${encodeURIComponent(sent.relay_task_id)}`,
      headers: { authorization: `Bearer ${aliceDeviceToken}` }
    });
    expect(task.statusCode).toBe(200);
    expect(task.json()).toMatchObject({
      status: "failed",
      lastError: "max relay delivery attempts exhausted"
    });
  });

  it("does not deliver expired tasks", async () => {
    const sent = await sendRelay(`expired-${Date.now()}`);
    await getControlPlaneStore().execute(
      "UPDATE relay_tasks SET expires_at = $1 WHERE id = $2",
      [new Date(Date.now() - 1000).toISOString(), sent.relay_task_id]
    );
    await getControlPlaneStore().execute(
      "UPDATE relay_messages SET expires_at = $1 WHERE relay_task_id = $2",
      [new Date(Date.now() - 1000).toISOString(), sent.relay_task_id]
    );

    const inbox = await fetchBobInbox();
    expect(inbox.some((row) => row.relay_task_id === sent.relay_task_id)).toBe(false);
    const task = await app.inject({
      method: "GET",
      url: `/v1/relay/a2a/tasks/${encodeURIComponent(sent.relay_task_id)}`,
      headers: { authorization: `Bearer ${aliceDeviceToken}` }
    });
    expect(task.statusCode).toBe(200);
    expect(task.json().status).toBe("expired");
  });

  it("maps receiver responses to explicit relay task states", async () => {
    const sent = await sendRelay(`response-${Date.now()}`);
    await fetchBobInbox();
    const ack = await app.inject({
      method: "POST",
      url: `/v1/relay/a2a/${encodeURIComponent(sent.relay_task_id)}/ack`,
      headers: { authorization: `Bearer ${bobDeviceToken}` }
    });
    expect(ack.statusCode).toBe(200);

    const response = await app.inject({
      method: "POST",
      url: `/v1/relay/a2a/${encodeURIComponent(sent.relay_task_id)}/respond`,
      headers: { authorization: `Bearer ${bobDeviceToken}` },
      payload: { payload: { status: "waiting_for_approval", text: "Waiting for owner approval" } }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("waiting_approval");
  });
});
