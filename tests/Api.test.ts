import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server.js";

describe("HTTP API", () => {
  it("validates malformed session input", async () => {
    vi.stubEnv("SANDBOX_DRY_RUN", "true");
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/sessions",
      payload: { purpose: "", networkProfile: "npm" }
    });

    expect(response.statusCode).toBe(400);
    await server.close();
    vi.unstubAllEnvs();
  });

  it("returns events for a dry-run session", async () => {
    vi.stubEnv("SANDBOX_DRY_RUN", "true");
    const server = buildServer();
    const create = await server.inject({
      method: "POST",
      url: "/sessions",
      payload: { purpose: "api test", networkProfile: "none" }
    });
    const body = create.json<{ sessionId: string }>();

    await server.inject({
      method: "POST",
      url: `/sessions/${body.sessionId}/shell`,
      payload: { command: "uname -a" }
    });
    const events = await server.inject({ method: "GET", url: `/sessions/${body.sessionId}/events` });

    expect(events.statusCode).toBe(200);
    expect(events.json<{ events: unknown[] }>().events.length).toBeGreaterThan(0);
    await server.close();
    vi.unstubAllEnvs();
  });
});
