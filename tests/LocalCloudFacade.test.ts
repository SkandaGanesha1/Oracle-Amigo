import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../apps/control-plane/src/main.js";
import { resetConfigForTest } from "../apps/control-plane/src/config.js";
import { closeAll } from "../apps/control-plane/src/db/connection.js";
import { AuthClient } from "../src/cloud/AuthClient.js";
import { ControlPlaneClient } from "../src/cloud/ControlPlaneClient.js";
import { EnrollmentClient } from "../src/cloud/EnrollmentClient.js";
import { RelayClient } from "../src/cloud/RelayClient.js";
import { LocalCloudIdentityStore } from "../src/cloud/LocalCloudIdentityStore.js";
import { InboxPoller } from "../src/runtime/InboxPoller.js";
import { RemoteTaskDispatcher } from "../src/runtime/RemoteTaskDispatcher.js";
import { PersonalAgentProtocol } from "../src/protocol/PersonalAgentProtocol.js";
import { buildServer } from "../src/server.js";
import { getDb, _resetDb } from "../src/db/connection.js";

let controlPlane: FastifyInstance;
let localAgent: FastifyInstance;
let dataDir: string;
let controlPlaneUrl: string;
const localAgentToken = "local-cloud-facade-token-12345678901234567890";
const localAuthHeaders = { "x-local-agent-token": localAgentToken };

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "local-cloud-facade-"));
  const port = 21800 + Math.floor(Math.random() * 1000);
  controlPlaneUrl = `http://127.0.0.1:${port}`;
  resetConfigForTest({
    CONTROL_PLANE_PORT: String(port),
    CONTROL_PLANE_HOST: "127.0.0.1",
    CONTROL_PLANE_PUBLIC_URL: controlPlaneUrl,
    CONTROL_PLANE_DB_PATH: join(dataDir, "control-plane.db"),
    JWT_ACCESS_SECRET: "test-access-secret-must-be-16+",
    JWT_REFRESH_SECRET: "test-refresh-secret-must-be-16+",
    FILE_TRANSFER_STORE: join(dataDir, "transfers"),
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
  closeAll();
  process.env.AGENTIC_DB_PATH = join(dataDir, "local-agent.db");
  process.env.CONTROL_PLANE_URL = controlPlaneUrl;
  process.env.AGENTIC_PROFILE_ID = "test-profile";
  process.env.AGENTIC_DISABLE_RUNTIME_AUTOSTART = "true";
  process.env.LOCAL_AGENT_API_TOKEN = localAgentToken;
  _resetDb();
  controlPlane = await buildApp();
  await controlPlane.listen({ port, host: "127.0.0.1" });
  localAgent = buildServer();
  await localAgent.ready();
});

afterAll(async () => {
  if (localAgent) await localAgent.close();
  if (controlPlane) await controlPlane.close();
  closeAll();
  _resetDb();
  delete process.env.AGENTIC_DB_PATH;
  delete process.env.CONTROL_PLANE_URL;
  delete process.env.AGENTIC_PROFILE_ID;
  delete process.env.AGENTIC_DISABLE_RUNTIME_AUTOSTART;
  delete process.env.LOCAL_AGENT_API_TOKEN;
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("local cloud facade", () => {
  it("stores login tokens and enrollment identity locally", async () => {
    const ts = Date.now();
    const signup = await localAgent.inject({
      method: "POST",
      url: "/cloud/signup",
      headers: localAuthHeaders,
      payload: {
        email: `facade-alice-${ts}@example.com`,
        password: "securePass123!",
        display_name: "Facade Alice",
        control_plane_url: controlPlaneUrl
      }
    });
    expect(signup.statusCode).toBe(200);
    let stored = new LocalCloudIdentityStore().get("test-profile");
    expect(stored?.userAccessToken).toBeTruthy();
    expect(stored?.refreshToken).toBeTruthy();
    expect(stored?.status).toBe("authenticated");

    const enroll = await localAgent.inject({
      method: "POST",
      url: "/cloud/enroll",
      headers: localAuthHeaders,
      payload: {
        device_name: "Facade Alice Laptop",
        agent_display_name: "Facade Alice Agent"
      }
    });
    expect(enroll.statusCode).toBe(200);
    stored = new LocalCloudIdentityStore().get("test-profile");
    expect(stored?.deviceAccessToken).toBeTruthy();
    expect(stored?.agentInstanceId).toBeTruthy();
    expect(stored?.relayInboxUrl).toContain("/v1/relay/a2a/inbox");
    expect(stored?.status).toBe("enrolled");

    const status = await localAgent.inject({ method: "GET", url: "/cloud/status" });
    expect(status.statusCode).toBe(200);
    expect(status.body).not.toContain(stored!.deviceAccessToken!);
    expect(status.json().cloud.hasDeviceAccessToken).toBe(true);
    expect(status.json().controlPlane).toMatchObject({
      savedUrl: controlPlaneUrl,
      configuredUrl: controlPlaneUrl,
      matchesConfigured: true,
      reachable: true,
      status: "ok"
    });
  }, 60_000);

  it("clears stale device enrollment fields when signing in as a different cloud user", async () => {
    const store = new LocalCloudIdentityStore();
    const previous = store.get("test-profile");
    try {
      store.save("test-profile", {
        deviceId: "dev_stale",
        agentId: "agt_stale",
        agentInstanceId: "agi_stale",
        relayInboxUrl: "http://127.0.0.1:9/v1/relay/a2a/inbox",
        deviceAccessToken: "stale-device-token",
        deviceRefreshToken: "stale-device-refresh-token",
        status: "enrolled"
      });

      const signup = await localAgent.inject({
        method: "POST",
        url: "/cloud/signup",
        headers: localAuthHeaders,
        payload: {
          email: `facade-fresh-${Date.now()}@example.com`,
          password: "securePass123!",
          display_name: "Fresh Identity",
          control_plane_url: controlPlaneUrl
        }
      });
      expect(signup.statusCode).toBe(200);
      const stored = store.get("test-profile");
      expect(stored?.status).toBe("authenticated");
      expect(stored?.deviceId).toBeNull();
      expect(stored?.agentId).toBeNull();
      expect(stored?.agentInstanceId).toBeNull();
      expect(stored?.relayInboxUrl).toBeNull();
      expect(stored?.deviceAccessToken).toBeNull();
      expect(stored?.deviceRefreshToken).toBeNull();
    } finally {
      if (previous) {
        store.save("test-profile", {
          controlPlaneUrl: previous.controlPlaneUrl,
          orgId: previous.orgId,
          userId: previous.userId,
          userEmail: previous.userEmail,
          displayName: previous.displayName,
          deviceId: previous.deviceId,
          agentId: previous.agentId,
          agentInstanceId: previous.agentInstanceId,
          relayInboxUrl: previous.relayInboxUrl,
          userAccessToken: previous.userAccessToken,
          deviceAccessToken: previous.deviceAccessToken,
          refreshToken: previous.refreshToken,
          userRefreshToken: previous.userRefreshToken,
          deviceRefreshToken: previous.deviceRefreshToken,
          status: previous.status
        });
      }
    }
  }, 60_000);

  it("reports stale enrollment when the saved control plane is unreachable or mismatched", async () => {
    const store = new LocalCloudIdentityStore();
    const previous = store.get("test-profile");
    store.save("test-profile", {
      controlPlaneUrl: "http://127.0.0.1:9",
      status: "enrolled",
      userAccessToken: "test-user-token",
      deviceAccessToken: "test-device-token",
      agentInstanceId: "agi_dead-control-plane"
    });

    const status = await localAgent.inject({ method: "GET", url: "/cloud/status" });
    expect(status.statusCode).toBe(200);
    expect(status.json().controlPlane).toMatchObject({
      savedUrl: "http://127.0.0.1:9",
      configuredUrl: controlPlaneUrl,
      matchesConfigured: false,
      reachable: false,
      status: "unreachable"
    });
    if (previous) {
      store.save("test-profile", {
        controlPlaneUrl: previous.controlPlaneUrl,
        orgId: previous.orgId,
        userId: previous.userId,
        userEmail: previous.userEmail,
        displayName: previous.displayName,
        deviceId: previous.deviceId,
        agentId: previous.agentId,
        agentInstanceId: previous.agentInstanceId,
        relayInboxUrl: previous.relayInboxUrl,
        userAccessToken: previous.userAccessToken,
        deviceAccessToken: previous.deviceAccessToken,
        refreshToken: previous.refreshToken,
        userRefreshToken: previous.userRefreshToken,
        deviceRefreshToken: previous.deviceRefreshToken,
        status: previous.status
      });
    }
  }, 60_000);

  it("passes through control-plane auth errors instead of masking them", async () => {
    const signup = await localAgent.inject({
      method: "POST",
      url: "/cloud/signup",
      headers: localAuthHeaders,
      payload: {
        email: `facade-wrong-org-${Date.now()}@example.com`,
        password: "securePass123!",
        display_name: "Wrong Org",
        org_slug: "Oracle",
        control_plane_url: controlPlaneUrl
      }
    });
    expect(signup.statusCode).toBe(400);
    expect(signup.json()).toMatchObject({
      error: "ORG_NOT_FOUND",
      message: "Organization 'Oracle' does not exist"
    });
  }, 60_000);

  it("rejects an unallowlisted selected control plane before making a request", async () => {
    const signup = await localAgent.inject({
      method: "POST",
      url: "/cloud/signup",
      headers: localAuthHeaders,
      payload: {
        email: `facade-offline-${Date.now()}@example.com`,
        password: "securePass123!",
        display_name: "Offline Control Plane",
        control_plane_url: "http://127.0.0.1:9"
      }
    });
    expect(signup.statusCode).toBe(400);
    expect(signup.json()).toMatchObject({
      error: "INVALID_CONTROL_PLANE_URL",
      message: "Control plane URL is not allowlisted"
    });
  }, 60_000);

  it("maps cross-user device key conflicts and recovers after explicit local identity reset", async () => {
    const ts = Date.now();
    const firstSignup = await localAgent.inject({
      method: "POST",
      url: "/cloud/signup",
      headers: localAuthHeaders,
      payload: {
        email: `facade-owner-${ts}@example.com`,
        password: "securePass123!",
        display_name: "Original Owner",
        control_plane_url: controlPlaneUrl
      }
    });
    expect(firstSignup.statusCode).toBe(200);
    const ownerReset = await localAgent.inject({ method: "POST", url: "/cloud/device-identity/reset", headers: localAuthHeaders });
    expect(ownerReset.statusCode).toBe(200);
    const firstEnroll = await localAgent.inject({
      method: "POST",
      url: "/cloud/enroll",
      headers: localAuthHeaders,
      payload: {
        device_name: "Shared Laptop",
        agent_display_name: "Original Agent"
      }
    });
    expect(firstEnroll.statusCode).toBe(200);

    const secondSignup = await localAgent.inject({
      method: "POST",
      url: "/cloud/signup",
      headers: localAuthHeaders,
      payload: {
        email: `facade-new-owner-${ts}@example.com`,
        password: "securePass123!",
        display_name: "New Owner",
        control_plane_url: controlPlaneUrl
      }
    });
    expect(secondSignup.statusCode).toBe(200);
    const conflict = await localAgent.inject({
      method: "POST",
      url: "/cloud/enroll",
      headers: localAuthHeaders,
      payload: {
        device_name: "Shared Laptop",
        agent_display_name: "New Owner Agent"
      }
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      error: "DEVICE_KEY_OWNED_BY_OTHER_USER",
      message: "Device public key already enrolled by another user"
    });
    expect(conflict.body).not.toContain("BEGIN PRIVATE KEY");
    expect(conflict.body).not.toContain("deviceAccessToken");

    const reset = await localAgent.inject({ method: "POST", url: "/cloud/device-identity/reset", headers: localAuthHeaders });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({ ok: true });
    expect(reset.json().localPublicKeyFingerprint).toMatch(/^[a-f0-9]{16}$/);

    const recoveredEnroll = await localAgent.inject({
      method: "POST",
      url: "/cloud/enroll",
      headers: localAuthHeaders,
      payload: {
        device_name: "Shared Laptop",
        agent_display_name: "New Owner Agent"
      }
    });
    expect(recoveredEnroll.statusCode).toBe(200);
    expect(new LocalCloudIdentityStore().get("test-profile")?.status).toBe("enrolled");
  }, 60_000);

  it("reports expired local device tokens as recoverable cloud status", async () => {
    const store = new LocalCloudIdentityStore();
    const previous = store.get("test-profile");
    const expiredToken = `header.${Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url")}.sig`;
    store.save("test-profile", {
      status: "enrolled",
      deviceAccessToken: expiredToken,
      userRefreshToken: "refresh-token",
      agentInstanceId: "agi_expired"
    });
    const status = await localAgent.inject({ method: "GET", url: "/cloud/status" });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      tokenIssue: "expired",
      canRecoverDeviceToken: true
    });
    expect(status.json().localPublicKeyFingerprint).toMatch(/^[a-f0-9]{16}$/);
    if (previous) {
      store.save("test-profile", {
        controlPlaneUrl: previous.controlPlaneUrl,
        orgId: previous.orgId,
        userId: previous.userId,
        userEmail: previous.userEmail,
        displayName: previous.displayName,
        deviceId: previous.deviceId,
        agentId: previous.agentId,
        agentInstanceId: previous.agentInstanceId,
        relayInboxUrl: previous.relayInboxUrl,
        userAccessToken: previous.userAccessToken,
        deviceAccessToken: previous.deviceAccessToken,
        refreshToken: previous.refreshToken,
        userRefreshToken: previous.userRefreshToken,
        deviceRefreshToken: previous.deviceRefreshToken,
        status: previous.status
      });
    }
  }, 60_000);

  it("polls relay inbox and turns a remote file request into a pending approval", async () => {
    const cp = new ControlPlaneClient(controlPlaneUrl);
    const auth = new AuthClient(cp);
    const enrollment = new EnrollmentClient(cp);
    const relay = new RelayClient(cp);
    const ts = Date.now();
    const bob = await auth.signup({
      email: `facade-bob-${ts}@example.com`,
      password: "securePass123!",
      display_name: "Facade Bob"
    });
    const bobEnroll = await enrollment.enroll({
      device: {
        device_name: "Bob Laptop",
        public_key: `-----BEGIN PUBLIC KEY-----\n${"B".repeat(80)}-${ts}\n-----END PUBLIC KEY-----`
      },
      agent: {
        display_name: "Facade Bob Agent",
        version: "0.1.0",
        capabilities: ["a2a.v1", "file.request"],
        agent_card: { name: "Facade Bob Agent", version: "0.1.0" }
      }
    }, bob.access_token);
    const alice = new LocalCloudIdentityStore().get("test-profile");
    expect(alice?.agentInstanceId).toBeTruthy();

    const sent = await relay.send({
      to_agent_instance_id: alice!.agentInstanceId!,
      a2a_task_id: `remote-file-${ts}`,
      type: "file.request",
      payload: { kind: "file_request", text: "find the invoice pdf" },
      idempotency_key: `remote-file-${ts}`
    }, bobEnroll.device_access_token);
    expect(sent.relay_task_id).toBeTruthy();

    const protocol = new PersonalAgentProtocol();
    const dispatcher = new RemoteTaskDispatcher(protocol, getDb(), "test-profile");
    const poller = new InboxPoller(new LocalCloudIdentityStore(), dispatcher, "test-profile");
    const result = await poller.pollOnce();
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.dispatched[0].status).toBe("created");
    const approvals = protocol.listApprovals().filter((approval) => approval.status === "pending");
    expect(approvals.some((approval) => approval.requesterAgentId === bobEnroll.agent_instance_id)).toBe(true);
  }, 60_000);
});
