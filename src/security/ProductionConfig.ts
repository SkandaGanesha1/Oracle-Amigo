import { resolveSecretStoreKind, validateSecretStoreProductionConfig } from "./secrets/SecretStoreFactory.js";

export interface LocalAgentProductionValidationResult {
  errors: string[];
  warnings: string[];
}

export function isLocalAgentProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production";
}

export function validateLocalAgentProductionConfig(env: NodeJS.ProcessEnv = process.env): LocalAgentProductionValidationResult {
  if (!isLocalAgentProduction(env)) return { errors: [], warnings: [] };

  const errors: string[] = [];
  const warnings: string[] = [];
  const host = env.SANDBOX_HOST?.trim() || "127.0.0.1";

  if (env.AGENTIC_A2A_REMOTE_AUTH_REQUIRED === "false") {
    errors.push("AGENTIC_A2A_REMOTE_AUTH_REQUIRED must not be false in production");
  }
  if (!isLoopbackHost(host) && env.LOCAL_AGENT_ALLOW_UNSAFE_PUBLIC_BIND !== "true") {
    errors.push("SANDBOX_HOST must bind to 127.0.0.1/loopback in production unless LOCAL_AGENT_ALLOW_UNSAFE_PUBLIC_BIND=true");
  }

  errors.push(...validateSecretStoreProductionConfig(env));
  const storage = resolveSecretStoreKind(env);
  if ((storage === "file" || storage === "auto") && env.ALLOW_UNSAFE_FILE_SECRET_STORE === "true") {
    warnings.push("Unsafe file-backed SecretStore is explicitly enabled in production");
  }

  return { errors, warnings };
}

export function assertLocalAgentProductionConfig(env: NodeJS.ProcessEnv = process.env): LocalAgentProductionValidationResult {
  const result = validateLocalAgentProductionConfig(env);
  if (result.errors.length > 0) {
    throw new Error(`Unsafe local agent production configuration:\n${result.errors.map((issue) => `  - ${issue}`).join("\n")}`);
  }
  return result;
}

export function localAgentDebugRoutesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isLocalAgentProduction(env)) return true;
  const host = env.SANDBOX_HOST?.trim() || "127.0.0.1";
  if (!isLoopbackHost(host) && env.LOCAL_AGENT_ALLOW_UNSAFE_PUBLIC_BIND === "true") return false;
  return env.LOCAL_AGENT_ENABLE_DEBUG_ROUTES === "true";
}

function isLoopbackHost(value: string): boolean {
  const host = value.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host === "localhost.localdomain" ||
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1" ||
    host === "::ffff:127.0.0.1" ||
    host.startsWith("127.")
  );
}
