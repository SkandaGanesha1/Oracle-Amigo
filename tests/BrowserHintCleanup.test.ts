import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetDb } from "../src/db/connection.js";
import { FileSearchService } from "../src/file-search/FileSearchService.js";
import { buildServer } from "../src/server.js";
import { sanitizeUiCss } from "../scripts/sanitize-ui-css.js";

const token = "local-agent-token-for-browser-hint-tests-123456";
const ROOT = resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

describe("browser hint cleanup", () => {
  let tempDir = "";
  let allowedRoot = "";

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "oracle-amigo-browser-hints-"));
    allowedRoot = join(tempDir, "allowed");
    mkdirSync(allowedRoot, { recursive: true });
    await mkdir(allowedRoot, { recursive: true });
    await writeFile(join(allowedRoot, "safe.txt"), "safe");
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

  it("serves the web app manifest with the registered webmanifest media type", async () => {
    const server = buildServer(undefined, new FileSearchService([allowedRoot]));

    const manifest = await server.inject({ method: "GET", url: "/manifest.webmanifest" });
    expect(manifest.statusCode).toBe(200);
    expect(manifest.headers["content-type"]).toContain("application/manifest+json");
    expect(manifest.json()).toMatchObject({
      name: "Oracle Amigo",
      theme_color: "#7c3aed"
    });

    await server.close();
  });

  it("sets Secure on local UI session cookies for loopback hosts by default", async () => {
    const server = buildServer(undefined, new FileSearchService([allowedRoot]));

    const appShell = await server.inject({
      method: "GET",
      url: "/",
      headers: { host: "127.0.0.1:3399" }
    });
    expect(appShell.statusCode).toBe(200);
    const setCookie = appShell.headers["set-cookie"];
    const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookie).toContain("oa_local_ui_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");

    await server.close();
  });

  it("allows Secure to be disabled for incompatible local clients", async () => {
    vi.stubEnv("LOCAL_AGENT_UI_SESSION_SECURE", "false");
    const server = buildServer(undefined, new FileSearchService([allowedRoot]));

    const appShell = await server.inject({
      method: "GET",
      url: "/",
      headers: { host: "127.0.0.1:3399" }
    });
    expect(appShell.statusCode).toBe(200);
    const setCookie = appShell.headers["set-cookie"];
    const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookie).toContain("oa_local_ui_session=");
    expect(cookie).not.toContain("Secure");

    await server.close();
  });

  it("keeps browser compatibility warnings out of authored UI sources", () => {
    const html = read("ui/index.html");
    const styles = read("ui/src/styles.css");

    expect(html).toContain("manifest.webmanifest");
    expect(html).not.toContain('name="theme-color"');
    expect(styles).not.toContain("text-wrap: balance");
    expect(styles).not.toContain("scrollbar-width: none");
    expect(styles).not.toContain("text-size-adjust");
    expect(styles).toContain(".oa-user-rail::-webkit-scrollbar");
  });

  it("strips known generated CSS browser-hint warnings after Vite build", () => {
    const css = [
      "html,:host{-webkit-text-size-adjust:100%;text-size-adjust:100%;tab-size:4}",
      ".text-wrap{text-wrap:wrap}",
      ".keep{color:red;text-wrap:pretty}"
    ].join("");

    expect(sanitizeUiCss(css)).toBe("html,:host{tab-size:4}.keep{color:red;text-wrap:pretty}");
  });
});
