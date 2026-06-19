import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { AuthClient } from "../src/cloud/AuthClient.js";
import { ControlPlaneClient } from "../src/cloud/ControlPlaneClient.js";
import { DirectoryClient } from "../src/cloud/DirectoryClient.js";
import { EnrollmentClient } from "../src/cloud/EnrollmentClient.js";
import { FileRelayClient } from "../src/cloud/FileRelayClient.js";
import { PresenceClient } from "../src/cloud/PresenceClient.js";
import { RelayClient } from "../src/cloud/RelayClient.js";
import { buildApp } from "../apps/control-plane/src/main.js";
import { resetConfigForTest } from "../apps/control-plane/src/config.js";
import { closeAll } from "../apps/control-plane/src/db/connection.js";
import { postgresTestConfig, resetPostgresTestDatabase } from "../apps/control-plane/tests/postgresTestHarness.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let dataDir: string;
let baseUrl = "";

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "cloud-client-"));
  const port = 19700 + Math.floor(Math.random() * 1000);
  await resetPostgresTestDatabase();
  resetConfigForTest(postgresTestConfig({
    CONTROL_PLANE_PORT: String(port),
    CONTROL_PLANE_HOST: "127.0.0.1",
    CONTROL_PLANE_PUBLIC_URL: `http://127.0.0.1:${port}`,
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
  }));
  await closeAll();
  app = await buildApp();
  await app.listen({ port, host: "127.0.0.1" });
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (app) await app.close();
  await closeAll();
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("local cloud clients", () => {
  it("signup → enrollment → heartbeat → directory → relay → file transfer", async () => {
    const cp = new ControlPlaneClient(baseUrl);
    const auth = new AuthClient(cp);
    const enr = new EnrollmentClient(cp);
    const dir = new DirectoryClient(cp);
    const pres = new PresenceClient(cp);
    const relay = new RelayClient(cp);
    const files = new FileRelayClient(cp);

    const ts = Date.now();
    let bundleA: Awaited<ReturnType<typeof auth.signup>>;
    try {
      bundleA = await auth.signup({
        email: `alice-${ts}@example.com`,
        password: "securePass123!",
        display_name: "Alice"
      });
    } catch (e) {
      console.error("SIGNUP FAILED:", e);
      throw e;
    }
    expect(bundleA.access_token).toBeTruthy();
    const enrollA = await enr.enroll({
      device: { device_name: "Alice's Laptop", os: "win32", public_key: `-----BEGIN PUBLIC KEY-----\n${"A".repeat(80)}-alice-${ts}\n-----END PUBLIC KEY-----` },
      agent: {
        display_name: "Alice's Oracle",
        version: "0.1.0",
        capabilities: ["fileTransfer", "encryptedMessage"],
        agent_card: { name: "Alice's Oracle", version: "0.1.0" }
      }
    }, bundleA.access_token);
    expect(enrollA.device_access_token).toBeTruthy();

    const bundleB = await auth.signup({
      email: `bob-${ts}@example.com`,
      password: "securePass123!",
      display_name: "Bob"
    });
    const enrollB = await enr.enroll({
      device: { device_name: "Bob's Laptop", os: "linux", public_key: `-----BEGIN PUBLIC KEY-----\n${"B".repeat(80)}-bob-${ts}\n-----END PUBLIC KEY-----` },
      agent: {
        display_name: "Bob's Oracle",
        version: "0.1.0",
        capabilities: ["fileTransfer"],
        agent_card: { name: "Bob's Oracle", version: "0.1.0" }
      }
    }, bundleB.access_token);

    // Heartbeat from Alice
    const hb = await pres.heartbeat({
      agent_instance_id: enrollA.agent_instance_id,
      status: "online"
    }, enrollA.device_access_token);
    expect(hb.ok).toBe(true);

    // Directory search
    const search = await dir.searchUsers("alice", bundleA.access_token);
    expect(search.users.length).toBeGreaterThan(0);

    // Relay: Alice sends to Bob
    const send = await relay.send({
      to_agent_instance_id: enrollB.agent_instance_id,
      a2a_task_id: `task-${ts}-1`,
      type: "message/send",
      payload: { kind: "ping", text: "hello bob" },
      idempotency_key: `idem-${ts}`
    }, enrollA.device_access_token);
    expect(send.status).toBeTruthy();
    const send2 = await relay.send({
      to_agent_instance_id: enrollB.agent_instance_id,
      a2a_task_id: `task-${ts}-1`,
      type: "message/send",
      payload: { kind: "ping", text: "hello bob" },
      idempotency_key: `idem-${ts}`
    }, enrollA.device_access_token);
    expect(send2.relay_task_id).toBe(send.relay_task_id);

    // Bob fetches inbox
    const inbox = await relay.fetchInbox({ limit: 10 }, enrollB.device_access_token);
    expect(inbox.items.length).toBeGreaterThan(0);
    const found = inbox.items.find((m) => m.relay_task_id === send.relay_task_id);
    expect(found).toBeDefined();
    await relay.ack(send.relay_task_id, enrollB.device_access_token);

    // File transfer
    const plaintext = randomBytes(2048);
    const sha = createHash("sha256").update(plaintext).digest("hex");
    const init = await files.init({
      to_agent_instance_id: enrollB.agent_instance_id,
      file_name: "blob.bin",
      file_size: plaintext.length,
      sha256: sha
    }, enrollA.device_access_token);
    expect(init.transfer_id).toBeTruthy();
    await files.upload(init.transfer_id, plaintext, enrollA.device_access_token);
    const dl = await files.download(init.transfer_id, enrollB.device_access_token);
    const dlSha = createHash("sha256").update(dl.body).digest("hex");
    expect(dlSha).toBe(sha);
    expect(dl.body.length).toBe(plaintext.length);
    const receipt = await files.receipt(init.transfer_id, {
      stored_path: "/agent/secure/blob.bin",
      verified_sha256: sha
    }, enrollB.device_access_token);
    expect(receipt.status).toBe("completed");

    // Refresh
    const refreshed = await auth.refresh(bundleA.refresh_token);
    expect(refreshed.access_token).toBeTruthy();
  }, 60_000);
});
