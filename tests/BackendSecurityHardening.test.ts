import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetDb, getDb } from "../src/db/connection.js";
import { FileSearchService } from "../src/file-search/FileSearchService.js";
import { buildServer } from "../src/server.js";
import { assertPublicHttpsUrl, assertPublicHttpsUrlResolved } from "../src/security/SecurityGuards.js";
import { getAnpSession, listAnpSessions, upsertAnpSession } from "../src/security/anp/AnpSession.js";

const token = "local-agent-token-for-security-tests-123456";

describe("backend security hardening", () => {
  let tempDir = "";
  let allowedRoot = "";
  let outsideRoot = "";

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "oracle-amigo-security-"));
    allowedRoot = join(tempDir, "allowed");
    outsideRoot = join(tempDir, "outside");
    await mkdir(allowedRoot, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    await writeFile(join(allowedRoot, "safe.txt"), "safe");
    await writeFile(join(outsideRoot, "secret.txt"), "secret");
    vi.stubEnv("AGENTIC_DB_PATH", join(tempDir, "agent.db"));
    vi.stubEnv("SANDBOX_FILE_SEARCH_ROOTS", allowedRoot);
    vi.stubEnv("LOCAL_AGENT_API_TOKEN", token);
    _resetDb();
  });

  afterEach(() => {
    _resetDb();
    vi.unstubAllEnvs();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("requires a local API token for privileged file endpoints", async () => {
    const server = buildServer(undefined, new FileSearchService([allowedRoot]));

    const missing = await server.inject({ method: "GET", url: "/files/indexed" });
    expect(missing.statusCode).toBe(401);

    const accepted = await server.inject({
      method: "GET",
      url: "/files/indexed",
      headers: { "x-local-agent-token": token }
    });
    expect(accepted.statusCode).toBe(200);

    await server.close();
  });

  it("requires a local API token for local admin and private data routes", async () => {
    const server = buildServer(undefined, new FileSearchService([allowedRoot]));

    const routes = [
      { method: "POST", url: "/skills", payload: { manifest: { id: "safe-skill", name: "Safe Skill" }, body: "" } },
      { method: "POST", url: "/registry/discover", payload: { url: "https://example.com/.well-known/agent.json" } },
      { method: "POST", url: "/cloud/logout", payload: {} },
      { method: "GET", url: "/memory/conversations" },
      { method: "GET", url: "/chat/conversations" },
      { method: "GET", url: "/policy/summary" }
    ] as const;

    for (const route of routes) {
      const response = await server.inject(route);
      expect(response.statusCode).toBe(401);
    }

    await server.close();
  });

  it("rejects registry discovery URLs that can SSRF local or private targets", async () => {
    const server = buildServer(undefined, new FileSearchService([allowedRoot]));
    const response = await server.inject({
      method: "POST",
      url: "/registry/discover",
      headers: { "x-local-agent-token": token },
      payload: { url: "http://127.0.0.1:8080/.well-known/agent.json" }
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().error).toMatch(/https|not allowed/i);
    await server.close();
  });

  it("rejects indexing outside configured roots", async () => {
    const server = buildServer(undefined, new FileSearchService([allowedRoot]));
    const response = await server.inject({
      method: "POST",
      url: "/files/index-roots",
      headers: { "x-local-agent-token": token },
      payload: { roots: [outsideRoot] }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "INVALID_INDEX_ROOT" });
    await server.close();
  });

  it("rejects private and credentialed push webhook URLs", async () => {
    expect(() => assertPublicHttpsUrl("https://user:pass@example.com/hook")).toThrow(/credentials/i);
    expect(() => assertPublicHttpsUrl("https://127.0.0.1/hook")).toThrow(/not allowed/i);
    await expect(assertPublicHttpsUrlResolved("https://169.254.169.254/latest")).rejects.toThrow(/not allowed/i);
  });

  it("does not persist or list plaintext ANP shared secrets", () => {
    upsertAnpSession({
      sessionId: "session-secure",
      sourceDid: "did:wba:source",
      destinationDid: "did:wba:destination",
      sourcePublicKeyHex: "aa",
      destinationPublicKeyHex: "bb",
      sharedSecretHex: "abcd".repeat(16),
      secretKeyId: "key-1",
      expiresAt: Date.now() + 60_000,
      status: "active"
    });

    expect(getAnpSession("session-secure")?.sharedSecretHex).toBe("abcd".repeat(16));
    expect(JSON.stringify(listAnpSessions())).not.toContain("abcd");
    const row = getDb().prepare("SELECT shared_secret_hex, encrypted_shared_secret FROM anp_sessions WHERE session_id = ?")
      .get("session-secure") as { shared_secret_hex: string; encrypted_shared_secret: string };
    expect(row.shared_secret_hex).toBe("");
    expect(row.encrypted_shared_secret).toBeTruthy();
    expect(row.encrypted_shared_secret).not.toContain("abcd");
  });
});
