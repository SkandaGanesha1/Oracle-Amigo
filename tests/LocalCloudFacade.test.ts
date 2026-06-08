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
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("local cloud facade", () => {
  it("stores login tokens and enrollment identity locally", async () => {
    const ts = Date.now();
    const signup = await localAgent.inject({
      method: "POST",
      url: "/cloud/signup",
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
  }, 60_000);

  it("passes through control-plane auth errors instead of masking them", async () => {
    const signup = await localAgent.inject({
      method: "POST",
      url: "/cloud/signup",
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

  it("returns a clear 502 when the selected control plane cannot be reached", async () => {
    const signup = await localAgent.inject({
      method: "POST",
      url: "/cloud/signup",
      payload: {
        email: `facade-offline-${Date.now()}@example.com`,
        password: "securePass123!",
        display_name: "Offline Control Plane",
        control_plane_url: "http://127.0.0.1:9"
      }
    });
    expect(signup.statusCode).toBe(502);
    expect(signup.json()).toMatchObject({
      error: "CONTROL_PLANE_UNAVAILABLE",
      message: expect.stringContaining("http://127.0.0.1:9")
    });
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
