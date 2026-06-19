import { randomBytes, createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/main.js";
import { resetConfigForTest } from "../src/config.js";
import { closeAll, getControlPlaneStore } from "../src/db/connection.js";
import { postgresTestConfig, resetPostgresTestDatabase } from "./postgresTestHarness.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let dataDir: string;
let aliceDeviceToken = "";
let aliceDeviceId = "";
let aliceAgentId = "";
let aliceAgentInstanceId = "";
let bobDeviceToken = "";
let bobDeviceId = "";
let bobAgentInstanceId = "";

async function signupAndEnroll(email: string): Promise<{ accessToken: string; deviceToken: string; deviceId: string; agentId: string; agentInstanceId: string }> {
  const signup = await app.inject({
    method: "POST",
    url: "/v1/auth/signup",
    payload: { email, password: "securePass123!", display_name: email }
  });
  const accessToken = signup.json().access_token;
  const payload = {
    device: {
      device_name: `${email}'s Laptop`,
      os: "win32",
      public_key: `-----BEGIN PUBLIC KEY-----\n${email}\n-----END PUBLIC KEY-----`
    },
    agent: {
      display_name: `${email}'s Oracle`,
      version: "0.1.0",
      capabilities: ["fileTransfer"],
      agent_card: { name: `${email}'s Oracle`, version: "0.1.0" }
    }
  };
  const enroll = await app.inject({
    method: "POST",
    url: "/v1/enrollment/complete",
    headers: { authorization: `Bearer ${accessToken}` },
    payload
  });
  return {
    accessToken,
    deviceToken: enroll.json().device_access_token,
    deviceId: enroll.json().device_id,
    agentId: enroll.json().agent_id,
    agentInstanceId: enroll.json().agent_instance_id
  };
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "cp-transfer-"));
  await resetPostgresTestDatabase();
  resetConfigForTest(postgresTestConfig({
    CONTROL_PLANE_PORT: "9998",
    CONTROL_PLANE_HOST: "127.0.0.1",
    CONTROL_PLANE_PUBLIC_URL: "http://127.0.0.1:9998",
    JWT_ACCESS_SECRET: "test-access-secret-must-be-16+",
    JWT_REFRESH_SECRET: "test-refresh-secret-must-be-16+",
    FILE_TRANSFER_STORE: join(dataDir, "transfers"),
    DEFAULT_ORG_SLUG: "test-org",
    DEV_ADMIN_TOKEN: "test-admin-token-1234",
    ACCESS_TOKEN_TTL_SECONDS: "900",
    REFRESH_TOKEN_TTL_SECONDS: "2592000",
    TRANSFER_TTL_SECONDS: "3600",
    TRANSFER_MAX_FILE_SIZE_BYTES: "104857600",
    TRANSFER_KEK: "test-transfer-kek-please-make-it-thirtytwochars-or-more!!",
    RELAY_POLL_MAX_BATCH: "50",
    ARGON2_MEMORY_COST: "19456",
    ARGON2_TIME_COST: "2",
    ARGON2_PARALLELISM: "1",
    CONTROL_PLANE_ENV: "test",
    METRICS_ENABLED: "false"
  }));
  await closeAll();
  app = await buildApp();
  await app.ready();
  const alice = await signupAndEnroll(`alice-${Date.now()}-a@example.com`);
  aliceDeviceToken = alice.deviceToken;
  aliceDeviceId = alice.deviceId;
  aliceAgentId = alice.agentId;
  aliceAgentInstanceId = alice.agentInstanceId;
  const bob = await signupAndEnroll(`bob-${Date.now()}-b@example.com`);
  bobDeviceToken = bob.deviceToken;
  bobDeviceId = bob.deviceId;
  bobAgentInstanceId = bob.agentInstanceId;
});

afterAll(async () => {
  if (app) await app.close();
  await closeAll();
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("file transfer relay", () => {
  it("POST /v1/transfers/init + PUT /v1/transfers/:id/upload + GET /v1/transfers/:id/download round-trips encrypted data", async () => {
    const plaintext = randomBytes(1024);
    const sha = createHash("sha256").update(plaintext).digest("hex");
    const init = await app.inject({
      method: "POST",
      url: "/v1/transfers/init",
      headers: { authorization: `Bearer ${aliceDeviceToken}` },
      payload: {
        to_agent_instance_id: bobAgentInstanceId,
        file_name: "secret.bin",
        file_size: plaintext.length,
        sha256: sha
      }
    });
    if (init.statusCode !== 200) console.error("INIT FAILED:", init.statusCode, init.body);
    expect(init.statusCode).toBe(200);
    const { transfer_id, upload_url } = init.json();
    expect(transfer_id).toBeTruthy();
    expect(upload_url).toContain(transfer_id);
    const keyRow = await getControlPlaneStore().one<{ wrapped_key: string }>(
      "SELECT wrapped_key FROM transfer_encryption_keys WHERE transfer_id = $1",
      [transfer_id]
    );
    expect(keyRow).toBeTruthy();
    expect(keyRow!.wrapped_key).toMatch(/^v2\./);
    expect(keyRow!.wrapped_key).not.toMatch(/^[a-f0-9]{64}$/i);

    const put = await app.inject({
      method: "PUT",
      url: `/v1/transfers/${transfer_id}/upload`,
      headers: { authorization: `Bearer ${aliceDeviceToken}`, "content-type": "application/octet-stream" },
      payload: plaintext
    });
    if (put.statusCode !== 200) console.error("UPLOAD FAILED:", put.statusCode, put.body);
    expect(put.statusCode).toBe(200);
    expect(put.json().status).toBe("ready");

    // Bob downloads
    const dl = await app.inject({
      method: "GET",
      url: `/v1/transfers/${transfer_id}/download`,
      headers: { authorization: `Bearer ${bobDeviceToken}` }
    });
    if (dl.statusCode !== 200) console.error("DOWNLOAD FAILED:", dl.statusCode, dl.body);
    expect(dl.statusCode).toBe(200);
    const downloaded = dl.rawPayload;
    const downloadedBuf = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded);
    const dlSha = createHash("sha256").update(downloadedBuf).digest("hex");
    expect(dlSha).toBe(sha);
  });

  it("POST /v1/transfers/:id/receipt records receipt", async () => {
    const plaintext = randomBytes(512);
    const sha = createHash("sha256").update(plaintext).digest("hex");
    const init = await app.inject({
      method: "POST",
      url: "/v1/transfers/init",
      headers: { authorization: `Bearer ${aliceDeviceToken}` },
      payload: {
        to_agent_instance_id: bobAgentInstanceId,
        file_name: "receipt.bin",
        file_size: plaintext.length,
        sha256: sha
      }
    });
    const { transfer_id } = init.json();
    await app.inject({
      method: "PUT",
      url: `/v1/transfers/${transfer_id}/upload`,
      headers: { authorization: `Bearer ${aliceDeviceToken}`, "content-type": "application/octet-stream" },
      payload: plaintext
    });
    const receipt = await app.inject({
      method: "POST",
      url: `/v1/transfers/${transfer_id}/receipt`,
      headers: { authorization: `Bearer ${bobDeviceToken}` },
      payload: { stored_path: "/mnt/agent-storage/receipts/secret.bin", verified_sha256: sha }
    });
    if (receipt.statusCode !== 200) console.error("RECEIPT FAILED:", receipt.statusCode, receipt.body);
    expect(receipt.statusCode).toBe(200);
    expect(receipt.json().status).toBe("completed");
  });

  it("rejects receipts before a transfer has been uploaded", async () => {
    const plaintext = randomBytes(512);
    const sha = createHash("sha256").update(plaintext).digest("hex");
    const init = await app.inject({
      method: "POST",
      url: "/v1/transfers/init",
      headers: { authorization: `Bearer ${aliceDeviceToken}` },
      payload: {
        to_agent_instance_id: bobAgentInstanceId,
        file_name: "premature-receipt.bin",
        file_size: plaintext.length,
        sha256: sha
      }
    });
    const { transfer_id } = init.json();
    const receipt = await app.inject({
      method: "POST",
      url: `/v1/transfers/${transfer_id}/receipt`,
      headers: { authorization: `Bearer ${bobDeviceToken}` },
      payload: { stored_path: "/mnt/agent-storage/receipts/premature.bin", verified_sha256: sha }
    });

    expect(receipt.statusCode).toBe(400);
    expect(receipt.body).toContain("cannot record receipt");
  });

  it("rejects uploads with mismatched hash", async () => {
    const plaintext = randomBytes(256);
    const claimedSha = "0000000000000000000000000000000000000000000000000000000000000000";
    const init = await app.inject({
      method: "POST",
      url: "/v1/transfers/init",
      headers: { authorization: `Bearer ${aliceDeviceToken}` },
      payload: {
        to_agent_instance_id: bobAgentInstanceId,
        file_name: "bad.bin",
        file_size: plaintext.length,
        sha256: claimedSha
      }
    });
    const { transfer_id } = init.json();
    const put = await app.inject({
      method: "PUT",
      url: `/v1/transfers/${transfer_id}/upload`,
      headers: { authorization: `Bearer ${aliceDeviceToken}`, "content-type": "application/octet-stream" },
      payload: plaintext
    });
    expect(put.statusCode).toBe(400);
  });

  it("does not allow a device token on user-authenticated routes", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${aliceDeviceToken}` }
    });
    expect(res.statusCode).toBe(401);
  });
});
