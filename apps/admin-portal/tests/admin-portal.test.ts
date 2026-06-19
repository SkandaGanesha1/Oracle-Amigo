import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { buildApp } from "../src/server.js";
import { resetAdminPortalConfigForTest } from "../src/config.js";

let portal: FastifyInstance;
let stubUpstream: FastifyInstance;
let stubPort: number;
let dataDir: string;
let staticRoot: string;

beforeAll(async () => {
  // Build a tiny stub upstream that responds to /v1/admin/auth/me + sets a session cookie
  stubUpstream = Fastify({ logger: false });
  stubUpstream.get("/v1/admin/auth/me", async (req, reply) => {
    const cookie = req.headers.cookie;
    if (!cookie || !cookie.includes("admin_session=stub-token")) {
      reply.code(401).send({ error: "UNAUTHORIZED", message: "Stub: no admin_session cookie" });
      return;
    }
    reply.header(
      "set-cookie",
      "admin_session=stub-token-1234567890abcdef; HttpOnly; SameSite=Strict; Path=/"
    );
    reply.send({
      user: { id: "stub-admin-id", email: "stub@example.com", display_name: "Stub Admin", totp_enrolled: true }
    });
  });
  stubUpstream.get("/v1/admin/auth/setup-status", async () => ({
    required: true,
    has_any_admin: false
  }));
  stubUpstream.get("/livez", async () => ({
    status: "ok",
    service: "oracle-amigo-control-plane"
  }));
  await stubUpstream.listen({ port: 0, host: "127.0.0.1" });
  const stubAddress = stubUpstream.server.address();
  if (!stubAddress || typeof stubAddress === "string") throw new Error("stub upstream did not bind");
  stubPort = stubAddress.port;

  dataDir = mkdtempSync(join(tmpdir(), "admin-portal-test-"));
  staticRoot = join(dataDir, "public");
  mkdirSync(staticRoot, { recursive: true });
  // Write a minimal SPA fallback index.html
  writeFileSync(
    join(staticRoot, "index.html"),
    `<!doctype html><html><head><title>Admin Portal</title></head><body><div id="root">portal</div></body></html>`,
    "utf8"
  );

  resetAdminPortalConfigForTest({
    ADMIN_PORTAL_PORT: "3399",
    ADMIN_PORTAL_HOST: "127.0.0.1",
    CONTROL_PLANE_URL: `http://127.0.0.1:${stubPort}`,
    ADMIN_STATIC_ROOT: staticRoot,
    ADMIN_PORTAL_LOG_LEVEL: "error"
  });
  portal = await buildApp();
  await portal.ready();
});

afterAll(async () => {
  if (portal) await portal.close();
  if (stubUpstream) await stubUpstream.close();
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("admin portal reverse-proxy + static + SPA fallback", () => {
  it("GET /health returns the portal status payload", async () => {
    const res = await portal.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("oracle-amigo-admin-portal");
    expect(body.upstream).toBe(`http://127.0.0.1:${stubPort}`);
  });

  it("GET /livez returns liveness status", async () => {
    const res = await portal.inject({ method: "GET", url: "/livez" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: "ok",
      service: "oracle-amigo-admin-portal"
    });
  });

  it("GET /ready returns readiness status when the control plane is live", async () => {
    const res = await portal.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: "ready",
      service: "oracle-amigo-admin-portal",
      upstream: `http://127.0.0.1:${stubPort}`
    });
  });

  it("GET /v1/admin/auth/setup-status proxies to upstream and returns its body", async () => {
    const res = await portal.inject({ method: "GET", url: "/v1/admin/auth/setup-status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ required: true, has_any_admin: false });
  });

  it("GET /v1/admin/auth/me without cookie → 401 from upstream", async () => {
    const res = await portal.inject({ method: "GET", url: "/v1/admin/auth/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("UNAUTHORIZED");
  });

  it("GET /v1/admin/auth/me with cookie → 200 from upstream + Set-Cookie forwarded back", async () => {
    const res = await portal.inject({
      method: "GET",
      url: "/v1/admin/auth/me",
      headers: { cookie: "admin_session=stub-token" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe("stub@example.com");
    // The upstream's set-cookie header must reach the client (this is the critical path
    // for the admin portal in production: the upstream control-plane sets the session cookie
    // and the portal must forward it back so the browser can persist it).
    const setCookie = res.headers["set-cookie"];
    expect(setCookie, "upstream set-cookie was not forwarded").toBeTruthy();
    const setCookieStr = Array.isArray(setCookie) ? setCookie.join("\n") : String(setCookie);
    expect(setCookieStr).toContain("admin_session=stub-token-1234567890abcdef");
    expect(setCookieStr).toContain("HttpOnly");
    expect(setCookieStr).toContain("SameSite=Strict");
  });

  it("GET / serves SPA index.html", async () => {
    const res = await portal.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("portal");
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("GET /audit (a non-/v1 client route) serves SPA fallback index.html", async () => {
    const res = await portal.inject({ method: "GET", url: "/audit" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("portal");
  });

  it("GET /v1/unknown-route on portal returns 404 (upstream or our notFound handler)", async () => {
    const res = await portal.inject({ method: "GET", url: "/v1/this-does-not-exist" });
    expect(res.statusCode).toBe(404);
    // Either the upstream stub's 404 (plain text "Not Found") or our structured NOT_FOUND.
    // The point of this test is just that the portal does NOT serve the SPA fallback for /v1/*.
    expect(res.body, "portal should not serve SPA index.html for /v1/* 404s").not.toContain("portal");
  });
});
