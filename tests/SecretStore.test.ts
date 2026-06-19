import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb, _resetDb } from "../src/db/connection.js";
import { LocalCloudIdentityStore } from "../src/cloud/LocalCloudIdentityStore.js";
import { FileSecretStore } from "../src/security/secrets/FileSecretStore.js";
import { createSecretStore, resetDefaultSecretStoreForTest } from "../src/security/secrets/SecretStoreFactory.js";
import { profileSecretPrefix, toSecretRef } from "../src/security/secrets/SecretStore.js";
import { loadPrivateKeyPem } from "../src/security/DeviceIdentity.js";

let tempDir: string | null = null;

afterEach(() => {
  _resetDb();
  resetDefaultSecretStoreForTest();
  vi.unstubAllEnvs();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("SecretStore", () => {
  it("FileSecretStore stores, lists, reads, deletes, and clears profile secrets in dev", () => {
    const store = new FileSecretStore({ rootDir: tempRoot(), env: { NODE_ENV: "development" } });
    const name = "profile/alice/cloud/user-access-token";

    store.set(name, "secret-token-value");

    expect(store.get(name)).toBe("secret-token-value");
    expect(store.list?.("profile/alice")).toContain(name);

    store.delete(name);
    expect(store.get(name)).toBeNull();

    store.set("profile/alice/cloud/device-access-token", "device-token");
    store.set("profile/bob/cloud/device-access-token", "bob-token");
    store.clearProfile("alice");
    expect(store.get("profile/alice/cloud/device-access-token")).toBeNull();
    expect(store.get("profile/bob/cloud/device-access-token")).toBe("bob-token");
  });

  it("production rejects FileSecretStore unless an explicit unsafe override is set", () => {
    expect(() => new FileSecretStore({
      rootDir: tempRoot(),
      env: { NODE_ENV: "production" }
    })).toThrow(/SECRET_STORE=file is unsafe in production/);

    expect(() => new FileSecretStore({
      rootDir: tempRoot(),
      env: { NODE_ENV: "production", ALLOW_UNSAFE_FILE_SECRET_STORE: "true" }
    })).not.toThrow();
  });

  it("factory resolves auto safely and rejects explicit production file store", () => {
    expect(createSecretStore({ NODE_ENV: "development", SECRET_STORE: "auto", ORACLE_AMIGO_SECRET_STORE_DIR: tempRoot() }, "win32").kind).toBe("file");
    expect(createSecretStore({ NODE_ENV: "production", SECRET_STORE: "auto" }, "win32").kind).toBe("windows");
    expect(() => createSecretStore({ NODE_ENV: "production", SECRET_STORE: "file", ORACLE_AMIGO_SECRET_STORE_DIR: tempRoot() })).toThrow(/SECRET_STORE=file is unsafe in production/);
  });

  it("LocalCloudIdentityStore stores token values through SecretStore and clears them on logout", () => {
    vi.stubEnv("AGENTIC_DB_PATH", join(tempRoot(), "agent.db"));
    const db = getDb();
    const secrets = new FileSecretStore({ rootDir: join(tempRoot(), "secrets"), env: { NODE_ENV: "test" } });
    const store = new LocalCloudIdentityStore(db, secrets);

    store.save("default", {
      controlPlaneUrl: "http://127.0.0.1:8080",
      userAccessToken: "user-token",
      deviceAccessToken: "device-token",
      refreshToken: "refresh-token",
      userRefreshToken: "user-refresh-token",
      deviceRefreshToken: "device-refresh-token",
      status: "enrolled"
    });

    const row = db.prepare("SELECT user_access_token, device_access_token, refresh_token FROM local_cloud_identity WHERE profile_id = ?").get("default") as Record<string, string>;
    expect(row.user_access_token).toMatch(/^secret:\/\//);
    expect(row.user_access_token).not.toContain("user-token");
    expect(store.get("default")).toMatchObject({
      userAccessToken: "user-token",
      deviceAccessToken: "device-token",
      refreshToken: "refresh-token",
      userRefreshToken: "user-refresh-token",
      deviceRefreshToken: "device-refresh-token"
    });

    store.clearTokens("default");

    expect(store.get("default")).toMatchObject({
      status: "disconnected",
      userAccessToken: null,
      deviceAccessToken: null,
      refreshToken: null,
      userRefreshToken: null,
      deviceRefreshToken: null
    });
  }, 30_000);

  it("LocalCloudIdentityStore keeps compatibility with existing raw SQLite token rows", () => {
    vi.stubEnv("AGENTIC_DB_PATH", join(tempRoot(), "agent.db"));
    const db = getDb();
    const secrets = new FileSecretStore({ rootDir: join(tempRoot(), "secrets"), env: { NODE_ENV: "test" } });
    db.prepare(`
      INSERT INTO local_cloud_identity
        (profile_id, control_plane_url, user_access_token, refresh_token, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("default", "http://127.0.0.1:8080", "raw-user-token", "raw-refresh-token", "authenticated", new Date().toISOString(), new Date().toISOString());

    const store = new LocalCloudIdentityStore(db, secrets);

    expect(store.get("default")).toMatchObject({
      userAccessToken: "raw-user-token",
      refreshToken: "raw-refresh-token"
    });
    store.save("default", { displayName: "Migrated User" });
    const row = db.prepare("SELECT user_access_token FROM local_cloud_identity WHERE profile_id = ?").get("default") as { user_access_token: string };
    expect(row.user_access_token).toMatch(/^secret:\/\//);
    expect(store.get("default")?.userAccessToken).toBe("raw-user-token");
  }, 30_000);

  it("loadPrivateKeyPem can read secret refs without exposing the value in the ref", () => {
    vi.stubEnv("SECRET_STORE", "file");
    vi.stubEnv("ORACLE_AMIGO_SECRET_STORE_DIR", tempRoot());
    resetDefaultSecretStoreForTest();
    const store = createSecretStore();
    const secretName = `${profileSecretPrefix("default")}/identity/agent-1/private-key`;
    store.set(secretName, "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----");

    expect(loadPrivateKeyPem({
      agentId: "agent-1",
      deviceId: "device-1",
      did: "did:key:test",
      publicKey: "00",
      privateKeyRef: toSecretRef(secretName)
    })).toContain("BEGIN PRIVATE KEY");
  });

  it("secret-name errors do not include secret values", () => {
    const store = new FileSecretStore({ rootDir: tempRoot(), env: { NODE_ENV: "test" } });
    expect(() => store.set("../bad", "super-secret-value")).toThrow(/Invalid secret/);
    try {
      store.set("../bad", "super-secret-value");
    } catch (error) {
      expect(String(error)).not.toContain("super-secret-value");
    }
  });
});

function tempRoot(): string {
  tempDir ??= mkdtempSync(join(tmpdir(), "oracle-amigo-secret-store-"));
  return tempDir;
}
