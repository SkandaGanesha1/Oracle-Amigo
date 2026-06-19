import { describe, expect, it } from "vitest";
import {
  localAgentDebugRoutesEnabled,
  validateLocalAgentProductionConfig
} from "../src/security/ProductionConfig.js";

describe("local agent production config validation", () => {
  it("requires A2A remote auth in production", () => {
    const result = validateLocalAgentProductionConfig({
      NODE_ENV: "production",
      AGENTIC_A2A_REMOTE_AUTH_REQUIRED: "false",
      SECRET_STORE: "windows"
    });

    expect(result.errors).toContain("AGENTIC_A2A_REMOTE_AUTH_REQUIRED must not be false in production");
  });

  it("accepts unset or true A2A remote auth because runtime auth is enabled by default", () => {
    expect(validateLocalAgentProductionConfig({ NODE_ENV: "production", SECRET_STORE: "windows" }).errors).not.toContain(
      "AGENTIC_A2A_REMOTE_AUTH_REQUIRED must not be false in production"
    );
    expect(validateLocalAgentProductionConfig({
      NODE_ENV: "production",
      AGENTIC_A2A_REMOTE_AUTH_REQUIRED: "true",
      SECRET_STORE: "windows"
    }).errors).toEqual([]);
  });

  it("rejects non-loopback bind in production without explicit override", () => {
    const result = validateLocalAgentProductionConfig({
      NODE_ENV: "production",
      SANDBOX_HOST: "0.0.0.0",
      SECRET_STORE: "windows"
    });

    expect(result.errors).toContain("SANDBOX_HOST must bind to 127.0.0.1/loopback in production unless LOCAL_AGENT_ALLOW_UNSAFE_PUBLIC_BIND=true");
  });

  it("accepts non-loopback bind only with explicit unsafe override", () => {
    const result = validateLocalAgentProductionConfig({
      NODE_ENV: "production",
      SANDBOX_HOST: "0.0.0.0",
      LOCAL_AGENT_ALLOW_UNSAFE_PUBLIC_BIND: "true",
      SECRET_STORE: "windows"
    });

    expect(result.errors).toEqual([]);
  });

  it("rejects production file secret storage unless explicitly overridden", () => {
    const result = validateLocalAgentProductionConfig({
      NODE_ENV: "production",
      SANDBOX_HOST: "127.0.0.1",
      SECRET_STORE: "file"
    });

    expect(result.errors).toContain("SECRET_STORE=file is unsafe in production; use windows/mac-keychain or set ALLOW_UNSAFE_FILE_SECRET_STORE=true only for a controlled lab");
  });

  it("allows production file secret storage only with explicit unsafe override", () => {
    const result = validateLocalAgentProductionConfig({
      NODE_ENV: "production",
      SANDBOX_HOST: "127.0.0.1",
      SECRET_STORE: "file",
      ALLOW_UNSAFE_FILE_SECRET_STORE: "true"
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings).toContain("Unsafe file-backed SecretStore is explicitly enabled in production");
  });

  it("disables local debug routes in production by default", () => {
    expect(localAgentDebugRoutesEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(localAgentDebugRoutesEnabled({
      NODE_ENV: "production",
      LOCAL_AGENT_ENABLE_DEBUG_ROUTES: "true"
    })).toBe(true);
    expect(localAgentDebugRoutesEnabled({
      NODE_ENV: "production",
      SANDBOX_HOST: "0.0.0.0",
      LOCAL_AGENT_ALLOW_UNSAFE_PUBLIC_BIND: "true",
      LOCAL_AGENT_ENABLE_DEBUG_ROUTES: "true"
    })).toBe(false);
  });
});
