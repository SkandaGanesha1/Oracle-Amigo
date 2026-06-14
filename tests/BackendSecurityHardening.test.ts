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

  it("allows same-origin browser sessions through signed local UI cookies", async () => {
    const server = buildServer(undefined, new FileSearchService([allowedRoot]));

    const appShell = await server.inject({ method: "GET", url: "/chats/local-agent" });
    expect(appShell.statusCode).toBe(200);
    expect(appShell.headers["x-oracle-amigo-runtime"]).toBe("local-ui-session-v1");
    const setCookie = appShell.headers["set-cookie"];
    const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookie).toContain("oa_local_ui_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");

    const cookieHeader = cookie?.split(";", 1)[0];
    if (!cookieHeader) throw new Error("Missing local UI session cookie");

    const conversations = await server.inject({
      method: "GET",
      url: "/chat/conversations",
      headers: { cookie: cookieHeader }
    });
    expect(conversations.statusCode).toBe(200);

    const localMessages = await server.inject({
      method: "GET",
      url: "/chat/conversations/local-agent/messages",
      headers: { cookie: cookieHeader }
    });
    expect(localMessages.statusCode).toBe(200);
    expect(localMessages.json()).toMatchObject({
      conversation: { id: "local-agent" },
      readState: { conversationId: "local-agent" }
    });

    await server.close();
  });

  it("reports local UI session runtime support in health diagnostics", async () => {
    const server = buildServer(undefined, new FileSearchService([allowedRoot]));

    const health = await server.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({
      localUiSession: {
        enabled: true,
        runtime: "local-ui-session-v1",
        cookieName: "oa_local_ui_session"
      }
    });

    const diagnostics = await server.inject({
      method: "GET",
      url: "/chat/diagnostics",
      headers: { "x-local-agent-token": token }
    });
    expect(diagnostics.statusCode).toBe(200);
    expect(diagnostics.json()).toMatchObject({
      localUiSession: {
        enabled: true,
        runtime: "local-ui-session-v1",
        cookieName: "oa_local_ui_session"
      }
    });

    await server.close();
  });

  it("rejects tampered local UI session cookies", async () => {
    const server = buildServer(undefined, new FileSearchService([allowedRoot]));

    const response = await server.inject({
      method: "GET",
      url: "/chat/conversations",
      headers: { cookie: "oa_local_ui_session=v1.1718300000000.deadbeef.invalid" }
    });
    expect(response.statusCode).toBe(401);

    await server.close();
  });

  it("requires a local API token for local admin and private data routes", async () => {
    const server = buildServer(undefined, new FileSearchService([allowedRoot]));

    const routes = [
      { method: "POST", url: "/skills", payload: { manifest: { id: "safe-skill", name: "Safe Skill" }, body: "" } },
      { method: "POST", url: "/registry/discover", payload: { url: "https://example.com/.well-known/agent.json" } },
      { method: "GET", url: "/profile" },
      { method: "POST", url: "/profile/init", payload: {} },
      { method: "GET", url: "/search/universal?q=secret" },
      { method: "GET", url: "/missions/task-1/thread" },
      { method: "POST", url: "/missions/task-1/thread", payload: { body: "inject" } },
      { method: "POST", url: "/missions/task-1/pause", payload: {} },
      { method: "POST", url: "/missions/task-1/resume", payload: {} },
      { method: "POST", url: "/missions/task-1/cancel", payload: {} },
      { method: "POST", url: "/missions/task-1/retry", payload: {} },
      { method: "GET", url: "/cloud/me" },
      { method: "GET", url: "/cloud/directory/users" },
      { method: "GET", url: "/cloud/directory/users/usr_1/agents" },
      { method: "GET", url: "/cloud/contacts" },
      { method: "POST", url: "/cloud/contacts/request", payload: { target_user_id: "usr_2" } },
      { method: "POST", url: "/cloud/contacts/contact_1/accept", payload: {} },
      { method: "GET", url: "/relay/inbox/status" },
      { method: "GET", url: "/relay/task/relay_1/status" },
      { method: "POST", url: "/relay/send-message", payload: { peer_user_id: "usr_2", text: "hello" } },
      { method: "POST", url: "/relay/send-file-request", payload: { peer_user_id: "usr_2", text: "send file" } },
      { method: "GET", url: "/memory/conversations" },
      { method: "GET", url: "/chat/conversations" },
      { method: "GET", url: "/policy/summary" },
      { method: "GET", url: "/anp/identity" },
      { method: "POST", url: "/anp/messages/send", payload: { message: { id: "m1", type: "text", from: "a", to: "b", createdTime: Date.now(), body: {} } } },
      { method: "GET", url: "/anp/messages/thread/thread-1" },
      { method: "POST", url: "/anp/payment/intent", payload: { fromDid: "did:a", toDid: "did:b", lineItems: [{ id: "1", description: "x", quantity: 1, unitPrice: 1, currency: "USD" }], description: "x" } },
      { method: "POST", url: "/anp/payment/intent/intent-1/authorize", payload: {} },
      { method: "POST", url: "/anp/payment/intent/intent-1/settle", payload: {} },
      { method: "GET", url: "/anp/payment/intent/intent-1" }
    ] as const;

    for (const route of routes) {
      const response = await server.inject(route);
      expect(response.statusCode).toBe(401);
    }

    await server.close();
  });

  it("allows browser-safe cloud lifecycle routes without exposing the local API token", async () => {
    const server = buildServer(undefined, new FileSearchService([allowedRoot]));

    const logout = await server.inject({ method: "POST", url: "/cloud/logout", payload: {} });
    expect(logout.statusCode).toBe(200);

    const login = await server.inject({
      method: "POST",
      url: "/cloud/login",
      payload: {
        email: "user@example.com",
        password: "password123",
        control_plane_url: "http://127.0.0.1:65535"
      }
    });
    expect(login.statusCode).toBe(400);
    expect(login.json()).toMatchObject({ error: "INVALID_CONTROL_PLANE_URL" });

    await server.close();
  });

  it("rejects caller-supplied control plane URLs that are not explicitly allowed", async () => {
    const server = buildServer(undefined, new FileSearchService([allowedRoot]));
    const response = await server.inject({
      method: "POST",
      url: "/cloud/login",
      headers: { "x-local-agent-token": token },
      payload: {
        email: "user@example.com",
        password: "password123",
        control_plane_url: "http://127.0.0.1:65535"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "INVALID_CONTROL_PLANE_URL" });
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
