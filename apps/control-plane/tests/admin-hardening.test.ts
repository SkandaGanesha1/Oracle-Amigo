import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/main.js";
import { resetConfigForTest } from "../src/config.js";
import { closeAll, getDb } from "../src/db/connection.js";

let app: FastifyInstance;
let dataDir: string;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "admin-hardening-test-"));
  resetConfigForTest({
    CONTROL_PLANE_PORT: "9998",
    CONTROL_PLANE_HOST: "127.0.0.1",
    CONTROL_PLANE_PUBLIC_URL: "http://127.0.0.1:9998",
    CONTROL_PLANE_DB_PATH: join(dataDir, "test.db"),
    JWT_ACCESS_SECRET: "test-access-secret-must-be-16+",
    JWT_REFRESH_SECRET: "test-refresh-secret-must-be-16+",
    FILE_TRANSFER_STORE: join(dataDir, "transfers"),
    DEFAULT_ORG_SLUG: "admin-hardening",
    DEV_ADMIN_TOKEN: "test-admin-token-1234",
    CONTROL_PLANE_ENV: "test"
  });
  closeAll();
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
  closeAll();
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // ignore Windows SQLite handle cleanup timing
  }
});

describe("admin hardening", () => {
  it("rejects normal user tokens on admin APIs", async () => {
    const enrolled = await signupAndEnroll("normal-user");
    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/users",
      headers: { authorization: `Bearer ${enrolled.accessToken}` }
    });
    expect(res.statusCode).toBe(401);
  });

  it("admin device revoke prevents heartbeat", async () => {
    const enrolled = await signupAndEnroll("device-revoke");
    const revoke = await app.inject({
      method: "POST",
      url: `/v1/admin/devices/${encodeURIComponent(enrolled.deviceId)}/revoke`,
      headers: { authorization: "Bearer test-admin-token-1234" },
      payload: {}
    });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().status).toBe("revoked");

    const heartbeat = await app.inject({
      method: "POST",
      url: "/v1/presence/heartbeat",
      headers: { authorization: `Bearer ${enrolled.deviceToken}` },
      payload: {
        agent_instance_id: enrolled.agentInstanceId,
        device_id: enrolled.deviceId,
        agent_id: enrolled.agentId,
        status: "online"
      }
    });
    expect(heartbeat.statusCode).toBe(401);
    expect(heartbeat.json().error).toBe("DEVICE_TOKEN_REVOKED");
  });

  it("disabled agent instance cannot poll relay inbox", async () => {
    const enrolled = await signupAndEnroll("agent-disable");
    const disable = await app.inject({
      method: "POST",
      url: `/v1/admin/agent-instances/${encodeURIComponent(enrolled.agentInstanceId)}/disable`,
      headers: { authorization: "Bearer test-admin-token-1234" },
      payload: {}
    });
    expect(disable.statusCode).toBe(200);

    const inbox = await app.inject({
      method: "GET",
      url: "/v1/relay/a2a/inbox",
      headers: { authorization: `Bearer ${enrolled.deviceToken}` }
    });
    expect(inbox.statusCode).toBe(403);
    expect(inbox.json().error).toBe("DEVICE_DISABLED");
  });

  it("production admin setup is guarded unless explicitly enabled", async () => {
    const prodDir = mkdtempSync(join(tmpdir(), "admin-prod-setup-test-"));
    const previous = { ...process.env };
    try {
      closeAll();
      resetConfigForTest({
        CONTROL_PLANE_ENV: "production",
        CONTROL_PLANE_PORT: "9997",
        CONTROL_PLANE_HOST: "127.0.0.1",
        CONTROL_PLANE_PUBLIC_URL: "https://control-plane.example.test",
        CONTROL_PLANE_DB_PATH: join(prodDir, "prod.db"),
        JWT_ACCESS_SECRET: "prod-access-secret-strong-enough-123",
        JWT_REFRESH_SECRET: "prod-refresh-secret-strong-enough-123",
        ADMIN_KEK: "prod-admin-kek-strong-enough-1234567890",
        ADMIN_COOKIE_HOST_PREFIX: "true",
        ADMIN_SETUP_ENABLED: "false"
      });
      const prodApp = await buildApp();
      await prodApp.ready();
      const res = await prodApp.inject({ method: "POST", url: "/v1/admin/auth/setup/start", payload: {} });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("SETUP_DISABLED_PRODUCTION");
      await prodApp.close();
    } finally {
      process.env = previous;
      closeAll();
      resetConfigForTest({
        CONTROL_PLANE_PORT: "9998",
        CONTROL_PLANE_HOST: "127.0.0.1",
        CONTROL_PLANE_PUBLIC_URL: "http://127.0.0.1:9998",
        CONTROL_PLANE_DB_PATH: join(dataDir, "test.db"),
        JWT_ACCESS_SECRET: "test-access-secret-must-be-16+",
        JWT_REFRESH_SECRET: "test-refresh-secret-must-be-16+",
        FILE_TRANSFER_STORE: join(dataDir, "transfers"),
        DEFAULT_ORG_SLUG: "admin-hardening",
        DEV_ADMIN_TOKEN: "test-admin-token-1234",
        CONTROL_PLANE_ENV: "test"
      });
      rmSync(prodDir, { recursive: true, force: true });
    }
  });
});

async function signupAndEnroll(label: string): Promise<{
  accessToken: string;
  deviceToken: string;
  deviceId: string;
  agentId: string;
  agentInstanceId: string;
}> {
  const email = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const signup = await app.inject({
    method: "POST",
    url: "/v1/auth/signup",
    payload: {
      email,
      password: "securePass123!",
      display_name: label
    }
  });
  expect(signup.statusCode).toBe(201);
  const accessToken = signup.json().access_token as string;

  const publicKey = `-----BEGIN PUBLIC KEY-----\n${label}-${Date.now()}-${Math.random()}\n-----END PUBLIC KEY-----`;
  const enrollment = await app.inject({
    method: "POST",
    url: "/v1/enrollment/complete",
    headers: { authorization: `Bearer ${accessToken}` },
    payload: {
      device: {
        device_name: `${label} laptop`,
        os: "win32",
        public_key: publicKey,
        did: `did:wba:localhost:${label}`
      },
      agent: {
        display_name: `${label} agent`,
        version: "0.1.0",
        capabilities: ["fileTransfer"],
        agent_card: {
          name: `${label} agent`,
          version: "0.1.0",
          supportedInterfaces: []
        }
      }
    }
  });
  expect(enrollment.statusCode).toBe(200);
  const body = enrollment.json();
  expect(getDb().prepare("SELECT id FROM devices WHERE id = ?").get(body.device_id)).toBeTruthy();
  return {
    accessToken,
    deviceToken: body.device_access_token,
    deviceId: body.device_id,
    agentId: body.agent_id,
    agentInstanceId: body.agent_instance_id
  };
}
