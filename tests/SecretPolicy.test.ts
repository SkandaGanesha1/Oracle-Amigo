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

  it("redacts nested headers, cookies, OpenAI-style keys, and private keys", () => {
    const policy = new SecretPolicy();
    const redactedText = policy.redactText([
      "x-api-key: sk-abcdefghijklmnopqrstuvwxyz",
      "Cookie: session=abc123",
      "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"
    ].join("\n"));
    expect(redactedText).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(redactedText).not.toContain("session=abc123");
    expect(redactedText).not.toContain("BEGIN PRIVATE KEY");

    const redactedObject = policy.redactObject({
      headers: {
        Authorization: "Bearer abc",
        cookie: "sid=123"
      },
      safe: "visible"
    });
    expect(redactedObject).toEqual({
      headers: {
        Authorization: "[REDACTED]",
        cookie: "[REDACTED]"
      },
      safe: "visible"
    });
  });
});
