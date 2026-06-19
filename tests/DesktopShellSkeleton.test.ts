import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DESKTOP = join(ROOT, "apps", "desktop-shell");
const TAURI = join(DESKTOP, "src-tauri");

function read(path: string) {
  return readFileSync(join(ROOT, path), "utf8");
}

function readJson<T>(path: string): T {
  return JSON.parse(read(path)) as T;
}

describe("desktop shell skeleton", () => {
  it("adds root scripts without removing existing development scripts", () => {
    const pkg = readJson<{ scripts: Record<string, string> }>("package.json");

    expect(pkg.scripts.dev).toBe("tsx src/server.ts");
    expect(pkg.scripts["dev:ui"]).toBe("vite --host 127.0.0.1");
    expect(pkg.scripts["dev:desktop"]).toBe("npm --prefix apps/desktop-shell run tauri:dev");
    expect(pkg.scripts["build:desktop"]).toBe("npm --prefix apps/desktop-shell run tauri:build");
    expect(pkg.scripts["package:windows"]).toBe("npm --prefix apps/desktop-shell run package:windows");
  });

  it("contains required Tauri shell files and placeholder binaries folder", () => {
    for (const path of [
      join(DESKTOP, "package.json"),
      join(TAURI, "Cargo.toml"),
      join(TAURI, "tauri.conf.json"),
      join(TAURI, "src", "main.rs"),
      join(TAURI, "src", "lib.rs"),
      join(TAURI, "src", "health.rs"),
      join(TAURI, "src", "sidecars.rs"),
      join(TAURI, "binaries", "README.md")
    ]) {
      expect(existsSync(path), path).toBe(true);
    }
  });

  it("loads Agentic Chat UI assets in dev and build modes", () => {
    const config = readJson<{
      build: { devUrl: string; frontendDist: string; beforeDevCommand: string; beforeBuildCommand: string };
    }>("apps/desktop-shell/src-tauri/tauri.conf.json");

    expect(config.build.devUrl).toBe("http://127.0.0.1:5173");
    expect(config.build.frontendDist).toBe("../../../public");
    expect(config.build.beforeDevCommand).toContain("dev:ui");
    expect(config.build.beforeBuildCommand).toBe("");
  });

  it("keeps sidecar shell scope fixed and does not allow arbitrary commands", () => {
    const capability = readJson<{
      permissions: Array<string | { identifier: string; allow: Array<{ name: string; cmd?: string; sidecar?: boolean; args?: unknown }> }>;
    }>("apps/desktop-shell/src-tauri/capabilities/default.json");
    const scopes = capability.permissions.filter(
      (permission): permission is { identifier: string; allow: Array<{ name: string; cmd?: string; sidecar?: boolean; args?: unknown }> } =>
        typeof permission !== "string"
    );
    const allowed = scopes.flatMap((scope) => scope.allow);
    const names = Array.from(new Set(allowed.map((entry) => entry.name))).sort();

    expect(names).toEqual([
      "dev-local-agent",
      "dev-notification-bridge",
      "dev-quick-voice",
      "open-logs"
    ]);
    expect(allowed.filter((entry) => entry.sidecar).map((entry) => entry.name).sort()).toEqual([
      "dev-local-agent",
      "dev-notification-bridge",
      "dev-quick-voice"
    ]);
    expect(allowed.some((entry) => entry.args === true)).toBe(false);
    expect(allowed.some((entry) => "cwd" in entry)).toBe(false);
  });

  it("does not reference missing externalBin sidecar binaries", () => {
    const config = readJson<{ bundle?: { externalBin?: string[] } }>("apps/desktop-shell/src-tauri/tauri.conf.json");

    expect(config.bundle?.externalBin ?? []).toEqual([]);
  });

  it("documents sidecar strategy, secrets boundary, and Windows profile data layout", () => {
    const architecture = read("docs/desktop-shell-architecture.md");
    const roadmap = read("docs/installer-roadmap.md");
    const binariesReadme = read("apps/desktop-shell/src-tauri/binaries/README.md");

    for (const expected of [
      "%LOCALAPPDATA%/OracleAmigo/profiles/<profile>/",
      "agent.db",
      "storage/",
      "logs/",
      "config.json",
      "Do not bundle secrets",
      "externalBin"
    ]) {
      expect(architecture).toContain(expected);
    }

    expect(binariesReadme).toContain("target triple");
    expect(roadmap).toContain("Desktop Shell Skeleton");
    expect(roadmap).toContain("No production signing claim");
  });
});
