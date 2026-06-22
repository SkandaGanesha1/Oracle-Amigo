import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetDb } from "../src/db/connection.js";
import { FileSearchService } from "../src/file-search/FileSearchService.js";
import { LocalCloudIdentityStore } from "../src/cloud/LocalCloudIdentityStore.js";
import { UserTokenManager } from "../src/cloud/UserTokenManager.js";
import { buildServer } from "../src/server.js";

const localToken = "local-agent-token-for-user-token-manager-tests";

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

function saveCloudIdentity(controlPlaneUrl: string, patch: {
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

describe("user token refresh management", () => {
  let tempDir = "";
  let allowedRoot = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "oracle-amigo-user-token-"));
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

  it("uses a valid user access token without rotating the refresh token", async () => {
    let refreshCount = 0;
    let contactsAuth = "";
    const fakeControlPlane = createServer((req, res) => {
      if (req.url === "/v1/auth/refresh") {
        refreshCount += 1;
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "UNEXPECTED_REFRESH", message: "Refresh should not be called" }));
        return;
      }
      if (req.url === "/v1/contacts") {
        contactsAuth = String(req.headers.authorization ?? "");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ contacts: [] }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "NOT_FOUND", message: "Not found" }));
    });
    await new Promise<void>((resolve) => fakeControlPlane.listen(0, "127.0.0.1", resolve));
    const controlPlaneUrl = `http://127.0.0.1:${(fakeControlPlane.address() as AddressInfo).port}`;
    const server = buildServer(undefined, new FileSearchService([allowedRoot]));
    const accessToken = validJwt();
    saveCloudIdentity(controlPlaneUrl, { userAccessToken: accessToken, userRefreshToken: "refresh-token-a" });

    try {
      const contacts = await server.inject({
        method: "GET",
        url: "/cloud/contacts",
        headers: { "x-local-agent-token": localToken }
      });

      expect(contacts.statusCode).toBe(200);
      expect(contacts.json()).toEqual({ contacts: [] });
      expect(refreshCount).toBe(0);
      expect(contactsAuth).toBe(`Bearer ${accessToken}`);
    } finally {
      await server.close();
      await new Promise<void>((resolve, reject) => fakeControlPlane.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("single-flights concurrent refreshes for protected cloud routes", async () => {
    let refreshCount = 0;
    const refreshedAccessToken = validJwt();
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
      if (req.url === "/v1/contacts") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ contacts: [] }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "NOT_FOUND", message: "Not found" }));
    });
    await new Promise<void>((resolve) => fakeControlPlane.listen(0, "127.0.0.1", resolve));
    const controlPlaneUrl = `http://127.0.0.1:${(fakeControlPlane.address() as AddressInfo).port}`;
    const server = buildServer(undefined, new FileSearchService([allowedRoot]));
    saveCloudIdentity(controlPlaneUrl, { userAccessToken: jwtWithExp(1), userRefreshToken: "refresh-token-a" });

    try {
      const responses = await Promise.all([
        server.inject({ method: "GET", url: "/cloud/contacts", headers: { "x-local-agent-token": localToken } }),
        server.inject({ method: "GET", url: "/cloud/contacts", headers: { "x-local-agent-token": localToken } }),
        server.inject({ method: "GET", url: "/cloud/contacts", headers: { "x-local-agent-token": localToken } })
      ]);

      expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200]);
      expect(refreshCount).toBe(1);
      const updated = new LocalCloudIdentityStore().get("default");
      expect(updated?.userAccessToken).toBe(refreshedAccessToken);
      expect(updated?.userRefreshToken).toBe("refresh-token-b");
      expect(updated?.deviceRefreshToken).toBe("device-refresh-token");
    } finally {
      await server.close();
      await new Promise<void>((resolve, reject) => fakeControlPlane.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("refreshes an expired access token exactly once for concurrent token callers", async () => {
    let refreshCount = 0;
    const refreshedAccessToken = validJwt();
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
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "NOT_FOUND", message: "Not found" }));
    });
    await new Promise<void>((resolve) => fakeControlPlane.listen(0, "127.0.0.1", resolve));
    const controlPlaneUrl = `http://127.0.0.1:${(fakeControlPlane.address() as AddressInfo).port}`;
    saveCloudIdentity(controlPlaneUrl, { userAccessToken: jwtWithExp(1), userRefreshToken: "refresh-token-a" });

    try {
      const manager = new UserTokenManager(new LocalCloudIdentityStore());
      const tokens = await Promise.all(Array.from({ length: 10 }, () => manager.getFreshUserAccessToken("default")));

      expect(tokens).toEqual(new Array(10).fill(refreshedAccessToken));
      expect(refreshCount).toBe(1);
      const updated = new LocalCloudIdentityStore().get("default");
      expect(updated?.userAccessToken).toBe(refreshedAccessToken);
      expect(updated?.userRefreshToken).toBe("refresh-token-b");
    } finally {
      await new Promise<void>((resolve, reject) => fakeControlPlane.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("retries a protected cloud request once after downstream user-token rejection", async () => {
    let refreshCount = 0;
    let contactsCount = 0;
    const refreshedAccessToken = validJwt();
    const fakeControlPlane = createServer((req, res) => {
      if (req.url === "/v1/auth/refresh") {
        refreshCount += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          access_token: refreshedAccessToken,
          refresh_token: "refresh-token-b",
          expires_in: 900
        }));
        return;
      }
      if (req.url === "/v1/contacts") {
        contactsCount += 1;
        if (contactsCount === 1) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "TOKEN_EXPIRED", message: "Token expired" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ contacts: [] }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "NOT_FOUND", message: "Not found" }));
    });
    await new Promise<void>((resolve) => fakeControlPlane.listen(0, "127.0.0.1", resolve));
    const controlPlaneUrl = `http://127.0.0.1:${(fakeControlPlane.address() as AddressInfo).port}`;
    const server = buildServer(undefined, new FileSearchService([allowedRoot]));
    saveCloudIdentity(controlPlaneUrl, { userAccessToken: validJwt(), userRefreshToken: "refresh-token-a" });

    try {
      const contacts = await server.inject({
        method: "GET",
        url: "/cloud/contacts",
        headers: { "x-local-agent-token": localToken }
      });

      expect(contacts.statusCode).toBe(200);
      expect(contacts.json()).toEqual({ contacts: [] });
      expect(refreshCount).toBe(1);
      expect(contactsCount).toBe(2);
      expect(new LocalCloudIdentityStore().get("default")?.userRefreshToken).toBe("refresh-token-b");
    } finally {
      await server.close();
      await new Promise<void>((resolve, reject) => fakeControlPlane.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("keeps a newer stored token when refresh fails after another rotation", async () => {
    const savedAccessToken = validJwt();
    const fakeControlPlane = createServer((_req, res) => {
      new LocalCloudIdentityStore().save("default", {
        userAccessToken: savedAccessToken,
        userRefreshToken: "refresh-token-b",
        refreshToken: "refresh-token-b"
      });
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "REVOKED_REFRESH_TOKEN", message: "Refresh token has been revoked" }));
    });
    await new Promise<void>((resolve) => fakeControlPlane.listen(0, "127.0.0.1", resolve));
    const controlPlaneUrl = `http://127.0.0.1:${(fakeControlPlane.address() as AddressInfo).port}`;
    saveCloudIdentity(controlPlaneUrl, { userAccessToken: jwtWithExp(1), userRefreshToken: "refresh-token-a" });

    try {
      await expect(new UserTokenManager(new LocalCloudIdentityStore()).getFreshUserAccessToken("default"))
        .resolves.toBe(savedAccessToken);
      const updated = new LocalCloudIdentityStore().get("default");
      expect(updated?.userRefreshToken).toBe("refresh-token-b");
      expect(updated?.deviceRefreshToken).toBe("device-refresh-token");
    } finally {
      await new Promise<void>((resolve, reject) => fakeControlPlane.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("uses legacy refreshToken as a one-time user refresh migration fallback", async () => {
    let refreshCount = 0;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const refreshedAccessToken = validJwt();
    const fakeControlPlane = createServer((req, res) => {
      if (req.url === "/v1/auth/refresh") {
        refreshCount += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          access_token: refreshedAccessToken,
          refresh_token: "refresh-token-b",
          expires_in: 900
        }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "NOT_FOUND", message: "Not found" }));
    });
    await new Promise<void>((resolve) => fakeControlPlane.listen(0, "127.0.0.1", resolve));
    const controlPlaneUrl = `http://127.0.0.1:${(fakeControlPlane.address() as AddressInfo).port}`;
    saveCloudIdentity(controlPlaneUrl, {
      userAccessToken: jwtWithExp(1),
      userRefreshToken: null,
      refreshToken: "legacy-refresh-token"
    });

    try {
      await expect(new UserTokenManager(new LocalCloudIdentityStore()).getFreshUserAccessToken("default"))
        .resolves.toBe(refreshedAccessToken);
      expect(refreshCount).toBe(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("legacy cloud refreshToken"));
      const updated = new LocalCloudIdentityStore().get("default");
      expect(updated?.userRefreshToken).toBe("refresh-token-b");
      expect(updated?.refreshToken).toBe("refresh-token-b");
      expect(updated?.deviceRefreshToken).toBe("device-refresh-token");
    } finally {
      warn.mockRestore();
      await new Promise<void>((resolve, reject) => fakeControlPlane.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("does not use the device refresh token for user-token refresh", async () => {
    let refreshCount = 0;
    const fakeControlPlane = createServer((req, res) => {
      if (req.url === "/v1/auth/refresh") {
        refreshCount += 1;
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "UNEXPECTED_REFRESH", message: "Device refresh token must not be used" }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "NOT_FOUND", message: "Not found" }));
    });
    await new Promise<void>((resolve) => fakeControlPlane.listen(0, "127.0.0.1", resolve));
    const controlPlaneUrl = `http://127.0.0.1:${(fakeControlPlane.address() as AddressInfo).port}`;
    saveCloudIdentity(controlPlaneUrl, {
      userAccessToken: jwtWithExp(1),
      userRefreshToken: null,
      refreshToken: null
    });

    try {
      await expect(new UserTokenManager(new LocalCloudIdentityStore()).getFreshUserAccessToken("default"))
        .resolves.toBeNull();
      expect(refreshCount).toBe(0);
      expect(new LocalCloudIdentityStore().get("default")?.deviceRefreshToken).toBe("device-refresh-token");
    } finally {
      await new Promise<void>((resolve, reject) => fakeControlPlane.close((err) => err ? reject(err) : resolve()));
    }
  });
});
