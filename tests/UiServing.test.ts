import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = resolve(repoRoot, "public");
const hasStaticUiAssets = existsSync(resolve(publicDir, "index.html"));

describe.skipIf(!hasStaticUiAssets)("Static UI serving", () => {
  it("serves the UI shell at the root route", async () => {
    vi.stubEnv("SANDBOX_DRY_RUN", "true");
    const server = buildServer();

    const response = await server.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(response.body).toContain("/assets/");

    await server.close();
    vi.unstubAllEnvs();
  });

  it("serves static UI assets under /assets", async () => {
    vi.stubEnv("SANDBOX_DRY_RUN", "true");
    const server = buildServer();
    const html = await server.inject({ method: "GET", url: "/" });
    const cssPath = html.body.match(/href="([^"]+\.css)"/)?.[1];
    const jsPath = html.body.match(/src="([^"]+\.js)"/)?.[1];

    expect(cssPath).toBeDefined();
    expect(jsPath).toBeDefined();

    const styles = await server.inject({ method: "GET", url: cssPath! });
    const app = await server.inject({ method: "GET", url: jsPath! });

    expect(styles.statusCode).toBe(200);
    expect(styles.headers["content-type"]).toContain("text/css");
    expect(styles.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(styles.body.trim().length).toBeGreaterThan(0);
    expect(app.statusCode).toBe(200);
    expect(app.headers["content-type"]).toMatch(/javascript/);
    expect(app.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(app.body.trim().length).toBeGreaterThan(0);

    await server.close();
    vi.unstubAllEnvs();
  });

  it("does not serve files outside the public asset directory", async () => {
    vi.stubEnv("SANDBOX_DRY_RUN", "true");
    const server = buildServer();

    const response = await server.inject({
      method: "GET",
      url: "/assets/%2e%2e/src/server.ts"
    });

    expect(response.statusCode).not.toBe(200);
    expect(response.body).not.toContain("buildServer");

    await server.close();
    vi.unstubAllEnvs();
  });
});
