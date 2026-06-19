import { FileSecretStore } from "./FileSecretStore.js";
import { MacKeychainStore } from "./MacKeychainStore.js";
import type { SecretStore } from "./SecretStore.js";
import { WindowsCredentialStore } from "./WindowsCredentialStore.js";

export type SecretStoreKind = "auto" | "file" | "windows" | "mac-keychain";

let cachedStore: SecretStore | null = null;

export function resolveSecretStoreKind(env: NodeJS.ProcessEnv = process.env, platform = process.platform): SecretStoreKind {
  const configured = (env.SECRET_STORE ?? env.LOCAL_AGENT_SECRET_STORAGE ?? "auto").trim().toLowerCase();
  if (configured === "filesystem") return "file";
  if (configured === "os-keychain") return platform === "darwin" ? "mac-keychain" : "windows";
  if (configured === "mac" || configured === "keychain") return "mac-keychain";
  if (configured === "file" || configured === "windows" || configured === "mac-keychain" || configured === "auto") {
    return configured;
  }
  throw new Error(`Unsupported SECRET_STORE value: ${configured}`);
}

export function createSecretStore(env: NodeJS.ProcessEnv = process.env, platform = process.platform): SecretStore {
  const kind = resolveSecretStoreKind(env, platform);
  if (kind === "file") return new FileSecretStore({ env });
  if (kind === "windows") return new WindowsCredentialStore(env);
  if (kind === "mac-keychain") return new MacKeychainStore();

  if (env.NODE_ENV !== "production") return new FileSecretStore({ env });
  if (platform === "win32") return new WindowsCredentialStore(env);
  if (platform === "darwin") return new MacKeychainStore();
  return new FileSecretStore({ env });
}

export function getDefaultSecretStore(): SecretStore {
  cachedStore ??= createSecretStore();
  return cachedStore;
}

export function resetDefaultSecretStoreForTest(): void {
  cachedStore = null;
}

export function validateSecretStoreProductionConfig(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string[] {
  if (env.NODE_ENV !== "production") return [];
  const kind = resolveSecretStoreKind(env, platform);
  const effectiveKind = kind === "auto"
    ? platform === "win32" ? "windows" : platform === "darwin" ? "mac-keychain" : "file"
    : kind;
  if (effectiveKind === "file" && env.ALLOW_UNSAFE_FILE_SECRET_STORE !== "true") {
    return ["SECRET_STORE=file is unsafe in production; use windows/mac-keychain or set ALLOW_UNSAFE_FILE_SECRET_STORE=true only for a controlled lab"];
  }
  return [];
}
