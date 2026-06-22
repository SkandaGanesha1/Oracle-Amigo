import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalCloudIdentityStore } from "../src/cloud/LocalCloudIdentityStore.js";
import { _resetDb } from "../src/db/connection.js";
import { FileSearchService } from "../src/file-search/FileSearchService.js";
import { buildServer } from "../src/server.js";

const localToken = "local-agent-token-for-cloud-token-refresh-e2e";

function jwtWithExp(exp: number): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
    Buffer.from(JSON.stringify({ exp })).toString("base64url"),
    "sig"
  ].join(".");
}

function validJwt(): string {
  return jwtWithExp(Math.floor(Date.now() / 1000) + 900);
}

function saveEnrolledCloudIdentity(controlPlaneUrl: string, patch: {
  userAccessToken: string | null;
  userRefreshToken: string | null;
  refreshToken?: string | null;
}): void {
  new LocalCloudIdentityStore().save("default", {
    controlPlaneUrl,
    orgId: "org_test",
    userId: "usr_test",
    userEmail: "user@example.com",
    displayName: "Test User",
    deviceId: "dev_test",
    agentId: "agt_test",
    agentInstanceId: "agi_test",
    relayInboxUrl: `${controlPlaneUrl}/v1/relay/a2a/inbox`,
    userAccessToken: patch.userAccessToken,
    refreshToken: patch.refreshToken ?? patch.userRefreshToken,
    userRefreshToken: patch.userRefreshToken,
    deviceAccessToken: "device-token",
    deviceRefreshToken: "device-refresh-token",
    status: "enrolled"
  });
}

describe("cloud token refresh e2e", () => {
  let tempDir = "";
  let allowedRoot = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "oracle-amigo-cloud-token-e2e-"));
    allowedRoot = join(tempDir, "allowed");
    mkdirSync(allowedRoot, { recursive: true });
    vi.stubEnv("AGENTIC_DB_PATH", join(tempDir, "agent.db"));
    vi.stubEnv("SANDBOX_FILE_SEARCH_ROOTS", allowedRoot);
    vi.stubEnv("LOCAL_AGENT_API_TOKEN", localToken);
    _resetDb();
  });

  afterEach(() => {
    _resetDb();
    vi.unstubAllEnvs();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("shares one refresh across concurrent contacts, directory, and profile requests", async () => {
    let refreshCount = 0;
    const refreshedAccessToken = validJwt();
    const seenAuthHeaders: string[] = [];
    const fakeControlPlane = createServer((req, res) => {
      if (req.url === "/v1/auth/refresh") {
        refreshCount += 1;
        setTimeout(() => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            access_token: refreshedAccessToken,
            refresh_token: "refresh-token-b",
            expires_in: 900
          }));
        }, 25);
        return;
      }

      if (req.url?.startsWith("/v1/contacts") || req.url?.startsWith("/v1/directory/users") || req.url === "/v1/auth/me") {
        seenAuthHeaders.push(String(req.headers.authorization ?? ""));
        res.writeHead(200, { "content-type": "application/json" });
        if (req.url === "/v1/auth/me") {
          res.end(JSON.stringify({
            user: {
              org_id: "org_test",
              user_id: "usr_test",
              email: "user@example.com",
              display_name: "Test User",
              status: "active"
            }
          }));
          return;
        }
        if (req.url?.startsWith("/v1/directory/users")) {
          res.end(JSON.stringify({ users: [] }));
          return;
        }
        res.end(JSON.stringify({ contacts: [] }));
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "NOT_FOUND", message: "Not found" }));
    });
    await new Promise<void>((resolve) => fakeControlPlane.listen(0, "127.0.0.1", resolve));
    const controlPlaneUrl = `http://127.0.0.1:${(fakeControlPlane.address() as AddressInfo).port}`;
    saveEnrolledCloudIdentity(controlPlaneUrl, {
      userAccessToken: jwtWithExp(1),
      userRefreshToken: "refresh-token-a"
    });
    const server = buildServer(undefined, new FileSearchService([allowedRoot]));

    try {
      const responses = await Promise.all([
        server.inject({ method: "GET", url: "/cloud/contacts", headers: { "x-local-agent-token": localToken } }),
        server.inject({ method: "GET", url: "/cloud/directory/users?q=alice", headers: { "x-local-agent-token": localToken } }),
        server.inject({ method: "GET", url: "/cloud/me", headers: { "x-local-agent-token": localToken } })
      ]);

      expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200]);
      expect(responses.every((response) => !response.body.includes("CLOUD_USER_TOKEN_EXPIRED"))).toBe(true);
      expect(refreshCount).toBe(1);
      expect(seenAuthHeaders).toEqual(new Array(3).fill(`Bearer ${refreshedAccessToken}`));
      const updated = new LocalCloudIdentityStore().get("default");
      expect(updated?.userAccessToken).toBe(refreshedAccessToken);
      expect(updated?.userRefreshToken).toBe("refresh-token-b");
      expect(updated?.deviceRefreshToken).toBe("device-refresh-token");
    } finally {
      await server.close();
      await new Promise<void>((resolve, reject) => fakeControlPlane.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("reports expired user auth in cloud status after an unrecoverable refresh failure", async () => {
    const fakeControlPlane = createServer((_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "REVOKED_REFRESH_TOKEN", message: "Refresh token has been revoked" }));
    });
    await new Promise<void>((resolve) => fakeControlPlane.listen(0, "127.0.0.1", resolve));
    const controlPlaneUrl = `http://127.0.0.1:${(fakeControlPlane.address() as AddressInfo).port}`;
    saveEnrolledCloudIdentity(controlPlaneUrl, {
      userAccessToken: jwtWithExp(1),
      userRefreshToken: "old-postgres-refresh-token"
    });
    const server = buildServer(undefined, new FileSearchService([allowedRoot]));

    try {
      const contacts = await server.inject({
        method: "GET",
        url: "/cloud/contacts",
        headers: { "x-local-agent-token": localToken }
      });
      expect(contacts.statusCode).toBe(401);
      expect(contacts.json()).toMatchObject({ error: "CLOUD_USER_TOKEN_EXPIRED" });

      const status = await server.inject({ method: "GET", url: "/cloud/status" });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({
        cloud: { hasUserAccessToken: false },
        userAuthIssue: "expired",
        canRecoverUserToken: false
      });
    } finally {
      await server.close();
      await new Promise<void>((resolve, reject) => fakeControlPlane.close((err) => err ? reject(err) : resolve()));
    }
  });
});
