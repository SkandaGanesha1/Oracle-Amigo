import { describe, expect, it, vi } from "vitest";
import { SandboxSessionManager } from "../src/sandbox/SandboxSessionManager.js";

describe("SandboxSessionManager", () => {
  it("creates, runs, logs, and closes dry-run sessions", async () => {
    vi.stubEnv("SANDBOX_DRY_RUN", "true");
    const manager = new SandboxSessionManager();
    const session = await manager.createSession({ purpose: "test", networkProfile: "none", ttlSeconds: 30 });
    const result = await manager.runCommand(session.id, "node --version");

    expect(result.status).toBe("succeeded");
    expect(manager.getEvents(session.id).some((event) => event.type === "command.succeeded")).toBe(true);
    await expect(manager.closeSession(session.id)).resolves.toEqual({ sessionId: session.id, status: "closed" });
    vi.unstubAllEnvs();
  });
});
