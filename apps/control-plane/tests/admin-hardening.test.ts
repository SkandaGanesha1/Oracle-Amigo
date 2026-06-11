import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import * as OTPAuth from "otpauth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/main.js";
import { resetConfigForTest } from "../src/config.js";
import { closeAll, getDb } from "../src/db/connection.js";
import { Crypto } from "../src/admin/index.js";

let app: FastifyInstance;
let dataDir: string;

function currentTotpFor(secret: string): string {
  return new OTPAuth.TOTP({
    issuer: "Oracle Amigo",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret)
  }).generate();
}

function getSetCookie(res: { headers: Record<string, unknown> }, name: string): string {
  const setCookie = res.headers["set-cookie"];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const found = cookies.map(String).find((cookie) => cookie.startsWith(`${name}=`));
  expect(found).toBeTruthy();
  return found!;
}

function readCookieValue(setCookie: string): string {
  return setCookie.split(";", 1)[0].split("=", 2)[1] ?? "";
}

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
  it("stores admin TOTP encrypted, hashes and rotates recovery codes, sets HttpOnly cookies, and revokes sessions", async () => {
    const start = await app.inject({ method: "POST", url: "/v1/admin/auth/setup/start", payload: {} });
    expect(start.statusCode).toBe(200);
    const setupStart = start.json();
    const setup = await app.inject({
      method: "POST",
      url: "/v1/admin/auth/setup",
      payload: {
        email: `hardening-admin-${Date.now()}@example.com`,
        display_name: "Hardening Admin",
        password: "correctHorseBatteryStaple-9!",
        totp_code: currentTotpFor(setupStart.secret_base32),
        setup_challenge: setupStart.challenge
      }
    });
    expect(setup.statusCode).toBe(201);
    const cookie = getSetCookie(setup, "admin_session");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Domain=");
    const sessionToken = readCookieValue(cookie);

    const body = setup.json();
    const adminUserId = body.user.id as string;
    const totpRow = getDb()
      .prepare("SELECT secret_encrypted FROM admin_totp_secrets WHERE admin_user_id = ?")
      .get(adminUserId) as { secret_encrypted: string };
    expect(totpRow.secret_encrypted).toBeTruthy();
    expect(totpRow.secret_encrypted).not.toBe(setupStart.secret_base32);
    expect(Crypto.decryptSecret(totpRow.secret_encrypted)).toBe(setupStart.secret_base32);

    const recoveryCodes = body.recovery_codes as string[];
    expect(recoveryCodes).toHaveLength(10);
    const recoveryRows = getDb()
      .prepare("SELECT code_hash, used_at FROM admin_recovery_codes WHERE admin_user_id = ? ORDER BY created_at ASC")
      .all(adminUserId) as Array<{ code_hash: string; used_at: string | null }>;
    expect(recoveryRows).toHaveLength(10);
    expect(recoveryRows.every((row) => /^[a-f0-9]{64}$/.test(row.code_hash))).toBe(true);
    expect(JSON.stringify(recoveryRows)).not.toContain(recoveryCodes[0].replace(/[\s-]/g, "").toUpperCase());

    const login = await app.inject({
      method: "POST",
      url: "/v1/admin/auth/login",
      payload: { email: body.user.email, password: "correctHorseBatteryStaple-9!" }
    });
    expect(login.statusCode).toBe(200);
    const recovery = await app.inject({
      method: "POST",
      url: "/v1/admin/auth/mfa/recovery",
      payload: { challenge: login.json().challenge, recovery_code: recoveryCodes[0] }
    });
    expect(recovery.statusCode).toBe(200);
    expect(recovery.json().recovery_codes).toHaveLength(10);
    const unusedAfterRotation = getDb()
      .prepare("SELECT COUNT(*) AS n FROM admin_recovery_codes WHERE admin_user_id = ? AND used_at IS NULL")
      .get(adminUserId) as { n: number };
    expect(unusedAfterRotation.n).toBe(10);
    const usedAfterRotation = getDb()
      .prepare("SELECT COUNT(*) AS n FROM admin_recovery_codes WHERE admin_user_id = ? AND used_at IS NOT NULL")
      .get(adminUserId) as { n: number };
    expect(usedAfterRotation.n).toBeGreaterThanOrEqual(10);

    const logout = await app.inject({
      method: "POST",
      url: "/v1/admin/auth/logout",
      headers: { cookie: `admin_session=${sessionToken}` }
    });
    expect(logout.statusCode).toBe(204);
    const me = await app.inject({
      method: "GET",
      url: "/v1/admin/auth/me",
      headers: { cookie: `admin_session=${sessionToken}` }
    });
    expect(me.statusCode).toBe(401);
  });

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
