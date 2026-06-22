import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { _resetDb } from "../src/db/connection.js";
import { FileSearchService } from "../src/file-search/FileSearchService.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "cloud-connectivity-"));
  process.env.AGENTIC_DB_PATH = join(tmpRoot, "agent.db");
  process.env.AGENTIC_STORAGE_ROOT = join(tmpRoot, "storage");
  process.env.SANDBOX_FILE_SEARCH_ROOTS = tmpRoot;
  process.env.AGENTIC_DISABLE_RUNTIME_AUTOSTART = "true";
  _resetDb();
});

afterEach(() => {
  _resetDb();
  delete process.env.AGENTIC_DB_PATH;
  delete process.env.AGENTIC_STORAGE_ROOT;
  delete process.env.SANDBOX_FILE_SEARCH_ROOTS;
  delete process.env.AGENTIC_DISABLE_RUNTIME_AUTOSTART;
  delete process.env.CONTROL_PLANE_URL;
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("cloud auth connectivity errors", () => {
  it("returns a clear unavailable response when the control-plane connection resets", async () => {
    const resetServer = await new Promise<Server>((resolve) => {
      const srv = createServer((_req, res) => {
        res.destroy(new Error("read ECONNRESET"));
      });
      srv.listen(0, "127.0.0.1", () => resolve(srv));
    });
    const address = resetServer.address();
    const port = typeof address === "object" && address ? address.port : 0;
    process.env.CONTROL_PLANE_URL = `http://127.0.0.1:${port}`;
    const server = buildServer(undefined, new FileSearchService([tmpRoot]));

    const response = await server.inject({
      method: "POST",
      url: "/cloud/login",
      payload: {
        email: "user@example.com",
        password: "password123"
      }
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ error: "CONTROL_PLANE_UNAVAILABLE" });
    await server.close();
    await new Promise<void>((resolve) => resetServer.close(() => resolve()));
  });
});
