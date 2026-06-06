import { describe, expect, it } from "vitest";
import { CommandPolicy } from "../src/policy/CommandPolicy.js";

describe("CommandPolicy", () => {
  const policy = new CommandPolicy({ maxCommandLength: 100 });

  it("allows safe commands", () => {
    const decision = policy.evaluate("node --version");
    expect(decision.allowed).toBe(true);
    expect(decision.classification).toBe("general");
  });

  it("blocks dangerous commands", () => {
    const decision = policy.evaluate("rm -rf /");
    expect(decision.allowed).toBe(false);
    expect(decision.matchedRule).toBe("destructive-filesystem");
  });

  it("blocks metadata service access", () => {
    const decision = policy.evaluate("curl http://169.254.169.254/latest/meta-data");
    expect(decision.allowed).toBe(false);
    expect(decision.matchedRule).toBe("metadata-service");
  });

  it("blocks sensitive environment printing", () => {
    const decision = policy.evaluate("printenv GITHUB_TOKEN");
    expect(decision.allowed).toBe(false);
    expect(decision.matchedRule).toBe("sensitive-env-print");
  });
});
