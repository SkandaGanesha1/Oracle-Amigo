import { mkdtempSync, rmSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/main.js";
import { resetConfigForTest } from "../src/config.js";
import { closeAll } from "../src/db/connection.js";
import { getDb } from "../src/db/connection.js";
import type { FastifyInstance } from "fastify";
import { verifySignedCard } from "../../../src/protocol/a2a-v1/AgentCardV1.js";
import type { A2Av1AgentCard } from "../../../src/protocol/a2a-v1/types.js";

let app: FastifyInstance;
let dataDir: string;
let cardPublicKeyPem = "";

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "control-plane-test-"));
  const dbPath = join(dataDir, "test.db");
  const store = join(dataDir, "transfers");
  const cardKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  cardPublicKeyPem = cardKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
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
    CONTROL_PLANE_ENV: "test",
    AGENT_CARD_SIGNING_PRIVATE_KEY_PEM: cardKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    AGENT_CARD_SIGNING_KEY_ID: "test-control-plane-card",
    METRICS_ENABLED: "false"
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
  let userId = "";

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
    userId = body.user.user_id;
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
          protocolVersion: "1.0",
          name: "Alice's Oracle",
          version: "0.1.0",
          url: "http://127.0.0.1:3399",
          provider: { organization: "Oracle Amigo", url: "http://localhost:3399/provider" },
          supportedInterfaces: [
            {
              url: "http://127.0.0.1:3399/v1",
              protocolBinding: "HTTP+JSON",
              protocolVersion: "1.0",
              extensions: []
            }
          ],
          capabilities: { streaming: true, pushNotifications: true },
          defaultInputModes: ["text/plain", "application/json"],
          defaultOutputModes: ["text/plain", "application/json"],
          skills: [{ id: "file.request", name: "File Request", description: "Request files" }]
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

  it("GET /v1/directory/users returns relay metadata for active agents", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/directory/users?q=alice",
      headers: { authorization: `Bearer ${accessToken}` }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const user = body.users.find((u: { email: string }) => u.email === userEmail);
    expect(user).toBeDefined();
    expect(user.active_agent_instances).toBe(1);
    const agent = user.agents[0];
    expect(agent.relay_inbox_url).toBe("http://127.0.0.1:9999/v1/relay/a2a/inbox");
    expect(agent.agent_card_url).toBe(`http://127.0.0.1:9999/v1/relay/a2a/${agentInstanceId}`);
    expect(agent.agent_card_hash).toBeTruthy();
    expect(JSON.stringify(agent)).not.toMatch(/localhost|127\.0\.0\.1:3399|(?:^|[^A-Za-z])[A-Za-z]:[\\/]|file:\/\//);
  });

  it("GET /v1/directory/users/:id/agents returns card URLs for the user", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/directory/users/${encodeURIComponent(userId)}/agents`,
      headers: { authorization: `Bearer ${accessToken}` }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.agents[0].relay_inbox_url).toBe("http://127.0.0.1:9999/v1/relay/a2a/inbox");
    expect(body.agents[0].agent_card_url).toBe(`http://127.0.0.1:9999/v1/relay/a2a/${agentInstanceId}`);
  });

  it("GET /v1/directory/agent-instances/:id returns safe presence metadata", async () => {
    const userAuth = await app.inject({
      method: "GET",
      url: `/v1/directory/agent-instances/${encodeURIComponent(agentInstanceId)}`,
      headers: { authorization: `Bearer ${accessToken}` }
    });
    expect(userAuth.statusCode).toBe(200);
    expect(userAuth.json()).toMatchObject({
      user_id: userId,
      email: userEmail,
      agent_instance_id: agentInstanceId,
      device_id: deviceId,
      status: "online"
    });

    const deviceAuth = await app.inject({
      method: "GET",
      url: `/v1/directory/device/agent-instances/${encodeURIComponent(agentInstanceId)}`,
      headers: { authorization: `Bearer ${deviceToken}` }
    });
    expect(deviceAuth.statusCode).toBe(200);
    expect(deviceAuth.json().agent_card_url).toBe(`http://127.0.0.1:9999/v1/relay/a2a/${agentInstanceId}`);
    expect(JSON.stringify(deviceAuth.json())).not.toMatch(/device_access_token|refresh_token|public_key|private|(?:^|[^A-Za-z])[A-Za-z]:[\\/]|file:\/\//);
  });

  it("GET /v1/agents/:id/card returns a signed cloud-reachable card", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/agents/${agentInstanceId}/card`,
      headers: { authorization: `Bearer ${deviceToken}` }
    });
    expect(res.statusCode).toBe(200);
    const card = res.json() as A2Av1AgentCard;
    expect(card.url).toBe(`http://127.0.0.1:9999/v1/relay/a2a/${agentInstanceId}`);
    expect(card.supportedInterfaces.some((i) => i.protocolBinding === "HTTP+JSON" && i.url === `http://127.0.0.1:9999/v1/relay/a2a/${agentInstanceId}/v1`)).toBe(true);
    expect(JSON.stringify(card)).not.toMatch(/localhost|127\.0\.0\.1:3399|(?:^|[^A-Za-z])[A-Za-z]:[\\/]|file:\/\//);
    expect(card.skills.some((s) => s.id === "file.request")).toBe(true);
    expect(card.signatures?.[0].header.typ).toBe("JOSE");
    const verified = verifySignedCard(card, cardPublicKeyPem);
    expect(verified.url).toBe(`http://127.0.0.1:9999/v1/relay/a2a/${agentInstanceId}`);
    expect(() => verifySignedCard({ ...card, name: "Tampered" }, cardPublicKeyPem)).toThrow(/JWS signature verification failed/);
  });

  it("GET /v1/relay/a2a/:id returns the same relay-reachable cloud card", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/relay/a2a/${agentInstanceId}`,
      headers: { authorization: `Bearer ${deviceToken}` }
    });
    expect(res.statusCode).toBe(200);
    const card = res.json() as A2Av1AgentCard;
    expect(card.url).toBe(`http://127.0.0.1:9999/v1/relay/a2a/${agentInstanceId}`);
    expect(JSON.stringify(card)).not.toMatch(/localhost|127\.0\.0\.1:3399|(?:^|[^A-Za-z])[A-Za-z]:[\\/]|file:\/\//);
    expect(verifySignedCard(card, cardPublicKeyPem).url).toBe(card.url);
  });

  it("GET /v1/agents/:id/card rejects normal user tokens", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/agents/${agentInstanceId}/card`,
      headers: { authorization: `Bearer ${accessToken}` }
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/agents/:id/card does not expose cards across orgs", async () => {
    getDb().prepare("INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)")
      .run("org_other_card_test", "Other Org", "other-org", new Date().toISOString());
    const otherSignup = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        org_slug: "other-org",
        email: `other-${Date.now()}@example.com`,
        password: userPassword,
        display_name: "Other"
      }
    });
    expect(otherSignup.statusCode).toBe(201);
    const otherAccessToken = otherSignup.json().access_token;
    const otherEnrollment = await app.inject({
      method: "POST",
      url: "/v1/enrollment/complete",
      headers: { authorization: `Bearer ${otherAccessToken}` },
      payload: {
        device: {
          device_name: "Other Laptop",
          public_key: "-----BEGIN PUBLIC KEY-----\nOTHERKEYOTHERKEYOTHERKEYOTHERKEYOTHER\n-----END PUBLIC KEY-----"
        },
        agent: {
          display_name: "Other Agent",
          version: "0.1.0",
          capabilities: ["a2a.v1"],
          agent_card: {
            protocolVersion: "1.0",
            name: "Other Agent",
            version: "0.1.0",
            supportedInterfaces: [],
            capabilities: {},
            defaultInputModes: ["text/plain"],
            defaultOutputModes: ["text/plain"],
            skills: []
          }
        }
      }
    });
    expect(otherEnrollment.statusCode).toBe(200);
    const res = await app.inject({
      method: "GET",
      url: `/v1/agents/${agentInstanceId}/card`,
      headers: { authorization: `Bearer ${otherEnrollment.json().device_access_token}` }
    });
    expect(res.statusCode).toBe(404);
  });

  it("denies heartbeat after the device is revoked", async () => {
    getDb().prepare("UPDATE devices SET status = 'revoked' WHERE id = ?").run(deviceId);
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
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("DEVICE_DISABLED");
  });

  it("denies agent-card fetch after the device is revoked", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/agents/${agentInstanceId}/card`,
      headers: { authorization: `Bearer ${deviceToken}` }
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("DEVICE_DISABLED");
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
