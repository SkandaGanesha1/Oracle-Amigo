import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/main.js";
import { resetConfigForTest } from "../src/config.js";
import { closeAll } from "../src/db/connection.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let dataDir: string;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "control-plane-test-"));
  const dbPath = join(dataDir, "test.db");
  const store = join(dataDir, "transfers");
  resetConfigForTest({
    CONTROL_PLANE_PORT: "9999",
    CONTROL_PLANE_HOST: "127.0.0.1",
    CONTROL_PLANE_PUBLIC_URL: "http://127.0.0.1:9999",
    CONTROL_PLANE_DB_PATH: dbPath,
    JWT_ACCESS_SECRET: "test-access-secret-must-be-16+",
    JWT_REFRESH_SECRET: "test-refresh-secret-must-be-16+",
    FILE_TRANSFER_STORE: store,
    DEFAULT_ORG_SLUG: "test-org",
    DEV_ADMIN_TOKEN: "test-admin-token-1234",
    ACCESS_TOKEN_TTL_SECONDS: "900",
    REFRESH_TOKEN_TTL_SECONDS: "2592000",
    TRANSFER_TTL_SECONDS: "3600",
    TRANSFER_MAX_FILE_SIZE_BYTES: "104857600",
    RELAY_POLL_MAX_BATCH: "50",
    ARGON2_MEMORY_COST: "19456",
    ARGON2_TIME_COST: "2",
    ARGON2_PARALLELISM: "1",
    CONTROL_PLANE_ENV: "test"
  });
  // Close any existing connection from prior tests
  closeAll();
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
  // On Windows, better-sqlite3 may hold the file briefly; ignore cleanup errors
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("control-plane", () => {
  const userEmail = `alice-${Date.now()}@example.com`;
  const userPassword = "securePass123!";
  const fingerprint = `fp-alice-${Date.now()}`;
  let accessToken = "";
  let deviceToken = "";
  let agentInstanceId = "";
  let deviceId = "";
  let agentId = "";

  it("GET /health returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("oracle-amigo-control-plane");
  });

  it("POST /v1/auth/signup creates a user and returns tokens", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: userEmail,
        password: userPassword,
        display_name: "Alice"
      }
    });
    if (res.statusCode !== 201) console.error("SIGNUP FAILED:", res.statusCode, res.body);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.access_token).toBeTruthy();
    expect(body.refresh_token).toBeTruthy();
    expect(body.user.email).toBe(userEmail);
    accessToken = body.access_token;
  });

  it("POST /v1/auth/login returns tokens for valid credentials", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: userEmail, password: userPassword }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.access_token).toBeTruthy();
    expect(body.user.email).toBe(userEmail);
  });

  it("POST /v1/auth/login rejects invalid password", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: userEmail, password: "wrong-password" }
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/auth/me returns the current user with valid token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${accessToken}` }
    });
    if (res.statusCode !== 200) console.error("ME FAILED:", res.statusCode, res.body);
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe(userEmail);
  });

  it("POST /v1/enrollment/complete is idempotent and issues device JWT", async () => {
    const payload = {
      device: {
        device_name: "Alice's Laptop",
        os: "win32",
        public_key: "-----BEGIN PUBLIC KEY-----\nFAKEKEYFAKEKEYFAKEKEYFAKEKEYFAKEKEY\n-----END PUBLIC KEY-----",
        did: "did:wba:localhost:9999:ed25519:abc123"
      },
      agent: {
        display_name: "Alice's Oracle",
        version: "0.1.0",
        capabilities: ["encryptedMessage", "signedMessage", "fileTransfer"],
        agent_card: {
          name: "Alice's Oracle",
          version: "0.1.0",
          supportedInterfaces: []
        }
      }
    };
    const res1 = await app.inject({
      method: "POST",
      url: "/v1/enrollment/complete",
      headers: { authorization: `Bearer ${accessToken}` },
      payload
    });
    if (res1.statusCode !== 200) console.error("ENROLLMENT FAILED:", res1.statusCode, res1.body);
    expect(res1.statusCode).toBe(200);
    const body1 = res1.json();
    expect(body1.device_access_token).toBeTruthy();
    expect(body1.agent_instance_id).toBeTruthy();
    deviceToken = body1.device_access_token;
    agentInstanceId = body1.agent_instance_id;
    deviceId = body1.device_id;
    agentId = body1.agent_id;
    // Idempotent
    const res2 = await app.inject({
      method: "POST",
      url: "/v1/enrollment/complete",
      headers: { authorization: `Bearer ${accessToken}` },
      payload
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().agent_instance_id).toBe(agentInstanceId);
  });

  it("POST /v1/presence/heartbeat with device token works", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/presence/heartbeat",
      headers: { authorization: `Bearer ${deviceToken}` },
      payload: {
        agent_instance_id: agentInstanceId,
        device_id: deviceId,
        agent_id: agentId,
        status: "online"
      }
    });
    if (res.statusCode !== 200) console.error("HEARTBEAT FAILED:", res.statusCode, res.body);
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("GET /v1/admin/info with admin token works", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/info",
      headers: { authorization: `Bearer test-admin-token-1234` }
    });
    if (res.statusCode !== 200) console.error("ADMIN FAILED:", res.statusCode, res.body);
    expect(res.statusCode).toBe(200);
    expect(res.json().version).toBe("0.1.0");
  });

  it("GET /v1/admin/info rejects bad admin token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/info",
      headers: { authorization: `Bearer wrong` }
    });
    expect(res.statusCode).toBe(401);
  });
});
