import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetDb } from "../src/db/connection.js";
import { LocalCloudIdentityStore } from "../src/cloud/LocalCloudIdentityStore.js";
import { buildServer } from "../src/server.js";

describe("agentic V1 facade endpoints", () => {
  let previousDbPath: string | undefined;
  let tempDir: string | null = null;

  beforeEach(() => {
    previousDbPath = process.env.AGENTIC_DB_PATH;
    tempDir = mkdtempSync(join(tmpdir(), "oracle-amigo-v1-"));
    process.env.AGENTIC_DB_PATH = join(tempDir, "facade.db");
    _resetDb();
  });

  afterEach(() => {
    _resetDb();
    if (previousDbPath === undefined) {
      delete process.env.AGENTIC_DB_PATH;
    } else {
      process.env.AGENTIC_DB_PATH = previousDbPath;
    }
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  });

  it("validates intent facade input and returns a typed classification", async () => {
    const server = buildServer();
    const invalid = await server.inject({ method: "POST", url: "/intent/classify", payload: { text: "" } });
    expect(invalid.statusCode).toBe(400);

    const valid = await server.inject({
      method: "POST",
      url: "/intent/classify",
      payload: { text: "Find the latest harassment certification PDF" }
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.json()).toMatchObject({
      classification: {
        intent: "file_request",
        requestedItem: "Find the latest harassment certification PDF"
      }
    });
  });

  it("exposes memory facades without leaking raw local paths or secrets", async () => {
    const server = buildServer();
    const conversations = await server.inject({ method: "GET", url: "/memory/conversations" });
    expect(conversations.statusCode).toBe(200);
    expect(conversations.json()).toHaveProperty("conversations");

    const window = await server.inject({ method: "GET", url: "/memory/conversations/demo/window" });
    expect(window.statusCode).toBe(200);
    expect(JSON.stringify(window.json())).not.toMatch(/[A-Za-z]:\\\\Users\\\\/);
    expect(JSON.stringify(window.json())).not.toMatch(/Bearer\s+[A-Za-z0-9._-]+/);
  });

  it("simulates command policy decisions with redaction", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/policy/command/evaluate",
      payload: { command: "echo token=super-secret-value && rm -rf /", timeoutMs: 999999 }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.allowed).toBe(false);
    expect(body.classification).toBe("destructive");
    expect(body.redactedCommand).toContain("[REDACTED]");
    expect(body.redactedCommand).not.toContain("super-secret-value");
    expect(body.cappedTimeoutMs).toBeLessThanOrEqual(120000);
  });

  it("keeps indexed-file list responses on safe display fields", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/files/indexed" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty("items");
    expect(JSON.stringify(body)).not.toContain("filePath");
  });

  it("exposes audit verification and policy summary shapes", async () => {
    const server = buildServer();
    const verify = await server.inject({ method: "GET", url: "/audit/verify" });
    expect(verify.statusCode).toBe(200);
    expect(typeof verify.json().valid).toBe("boolean");

    const summary = await server.inject({ method: "GET", url: "/policy/summary" });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({
      command: {
        maxCommandLength: expect.any(Number),
        maxTimeoutMs: expect.any(Number)
      },
      secrets: {
        redactionEnabled: true
      }
    });
  });

  it("logs out locally even when remote token revocation is unavailable", async () => {
    const store = new LocalCloudIdentityStore();
    store.save("default", {
      controlPlaneUrl: "http://127.0.0.1:9",
      orgId: "org-test",
      userId: "user-test",
      userEmail: "alice@example.com",
      displayName: "Alice",
      deviceId: "device-test",
      agentId: "agent-test",
      agentInstanceId: "agent-instance-test",
      relayInboxUrl: "http://127.0.0.1:9/inbox",
      userAccessToken: "user-token",
      deviceAccessToken: "device-token",
      refreshToken: "refresh-token",
      userRefreshToken: "refresh-token",
      deviceRefreshToken: "device-refresh-token",
      status: "enrolled"
    });

    const server = buildServer();
    const statusBeforeLogout = await server.inject({ method: "GET", url: "/cloud/status" });
    expect(statusBeforeLogout.statusCode).toBe(200);
    const statusBody = JSON.stringify(statusBeforeLogout.json());
    expect(statusBody).not.toContain("user-token");
    expect(statusBody).not.toContain("device-token");
    expect(statusBody).not.toContain("refresh-token");
    expect(statusBody).not.toContain("device-refresh-token");
    expect(statusBeforeLogout.json().cloud).toMatchObject({
      hasUserAccessToken: true,
      hasDeviceAccessToken: true,
      hasRefreshToken: true
    });

    const logout = await server.inject({ method: "POST", url: "/cloud/logout" });
    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toMatchObject({ ok: true, remoteRevoked: false });

    const stored = store.get("default");
    expect(stored?.status).toBe("disconnected");
    expect(stored?.userAccessToken).toBeNull();
    expect(stored?.deviceAccessToken).toBeNull();
    expect(stored?.refreshToken).toBeNull();
    expect(stored?.userRefreshToken).toBeNull();
    expect(stored?.deviceRefreshToken).toBeNull();
  });
});
