import { describe, expect, it, vi } from "vitest";
import { SecretPolicy } from "../src/policy/SecretPolicy.js";

describe("SecretPolicy", () => {
  it("redacts env secret values and bearer tokens", () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_123456789012345678901234567890123456");
    const policy = new SecretPolicy();
    const redacted = policy.redactText("Authorization: Bearer ghp_123456789012345678901234567890123456");
    expect(redacted).not.toContain("ghp_123");
    expect(redacted).toContain("[REDACTED");
    vi.unstubAllEnvs();
  });

  it("redacts sensitive object keys", () => {
    const redacted = new SecretPolicy().redactObject({ npmToken: "abc", nested: { password: "pw" } });
    expect(redacted).toEqual({ npmToken: "[REDACTED]", nested: { password: "[REDACTED]" } });
  });
});
