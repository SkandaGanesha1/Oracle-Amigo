import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { normalizeSecretName, profileSecretPrefix, type SecretStore } from "./SecretStore.js";

export interface FileSecretStoreOptions {
  rootDir?: string;
  env?: NodeJS.ProcessEnv;
}

export class FileSecretStore implements SecretStore {
  readonly kind = "file";
  readonly rootDir: string;

  constructor(options: FileSecretStoreOptions = {}) {
    const env = options.env ?? process.env;
    this.rootDir = resolve(options.rootDir ?? defaultSecretRoot(env));
    if (env.NODE_ENV === "production" && env.ALLOW_UNSAFE_FILE_SECRET_STORE !== "true") {
      throw new Error("SECRET_STORE=file is unsafe in production; set ALLOW_UNSAFE_FILE_SECRET_STORE=true only for a controlled lab");
    }
    mkdirSync(this.rootDir, { recursive: true, mode: 0o700 });
    chmodBestEffort(this.rootDir, 0o700);
  }

  get(name: string): string | null {
    const path = this.pathFor(name);
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { value?: unknown };
      return typeof parsed.value === "string" ? parsed.value : null;
    } catch {
      return null;
    }
  }

  set(name: string, value: string): void {
    const path = this.pathFor(name);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    chmodBestEffort(dirname(path), 0o700);
    writeFileSync(path, JSON.stringify({ value, updatedAt: new Date().toISOString() }), { mode: 0o600 });
    chmodBestEffort(path, 0o600);
  }

  delete(name: string): void {
    rmSync(this.pathFor(name), { force: true });
  }

  list(prefix = ""): string[] {
    const normalizedPrefix = prefix ? `${normalizeSecretName(prefix)}/` : "";
    return listJsonFiles(this.rootDir)
      .map((path) => path.slice(this.rootDir.length + 1).replace(/\\/g, "/").replace(/\.json$/, ""))
      .filter((name) => !normalizedPrefix || name === normalizedPrefix.slice(0, -1) || name.startsWith(normalizedPrefix));
  }

  clearProfile(profileId: string): void {
    rmSync(join(this.rootDir, profileSecretPrefix(profileId)), { recursive: true, force: true });
  }

  private pathFor(name: string): string {
    const normalized = normalizeSecretName(name);
    const path = resolve(this.rootDir, `${normalized}.json`);
    if (!path.startsWith(`${this.rootDir}\\`) && !path.startsWith(`${this.rootDir}/`) && path !== this.rootDir) {
      throw new Error("Invalid secret path");
    }
    return path;
  }
}

function defaultSecretRoot(env: NodeJS.ProcessEnv): string {
  if (env.ORACLE_AMIGO_SECRET_STORE_DIR) return env.ORACLE_AMIGO_SECRET_STORE_DIR;
  if (env.LOCALAPPDATA) return join(env.LOCALAPPDATA, "OracleAmigo", "secrets");
  return join(homedir(), ".oracle-amigo", "secrets");
}

function listJsonFiles(dir: string): string[] {
  try {
    const entries = statSync(dir).isDirectory() ? readdirSync(dir, { withFileTypes: true }) : [];
    return entries.flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return listJsonFiles(path);
      return entry.isFile() && entry.name.endsWith(".json") ? [path] : [];
    });
  } catch {
    return [];
  }
}

function chmodBestEffort(path: string, mode: number): void {
  if (process.platform === "win32") return;
  try { chmodSync(path, mode); } catch { /* best effort */ }
}
