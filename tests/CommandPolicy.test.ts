import { describe, expect, it } from "vitest";
import { CommandPolicy } from "../src/policy/CommandPolicy.js";

describe("CommandPolicy", () => {
  const policy = new CommandPolicy({ maxCommandLength: 500 });

  it("allows safe commands", () => {
    const decision = policy.evaluate("node --version");
    expect(decision.allowed).toBe(true);
    expect(decision.classification).toBe("general");
  });

  it("blocks dangerous commands", () => {
    const decision = policy.evaluate("rm -rf /");
    expect(decision.allowed).toBe(false);
    expect(decision.matchedRule).toMatch(/^destructive-/);
  });

  it("blocks PowerShell destructive and encoded command bypasses", () => {
    expect(policy.evaluate("Remove-Item C:\\Users\\Public\\* -Recurse -Force").allowed).toBe(false);
    expect(policy.evaluate("powershell.exe -EncodedCommand SQBFAFgA").matchedRule).toBe("encoded-powershell");
  });

  it("blocks metadata service access", () => {
    const decision = policy.evaluate("curl http://169.254.169.254/latest/meta-data");
    expect(decision.allowed).toBe(false);
    expect(decision.matchedRule).toBe("metadata-service");
  });

  it("blocks non-curl metadata fetch helpers", () => {
    const decision = policy.evaluate("Invoke-WebRequest http://169.254.169.254/latest/meta-data");
    expect(decision.allowed).toBe(false);
    expect(decision.matchedRule).toBe("metadata-service");
  });

  it("blocks sensitive environment printing", () => {
    const decision = policy.evaluate("printenv GITHUB_TOKEN");
    expect(decision.allowed).toBe(false);
    expect(decision.matchedRule).toBe("sensitive-env-print");
  });

  it("blocks dynamic shell bypasses and private network aliases", () => {
    expect(policy.evaluate("powershell -NoProfile -Command \"$c='Remove'+'-Item'; & $c -Recurse -Force C:\\tmp\"").matchedRule)
      .toBe("dynamic-powershell-invocation");
    expect(policy.evaluate("node -e \"require('http').get('http://2852039166/latest')\"").matchedRule)
      .toBe("private-network-target");
    expect(policy.evaluate("curl https://127.1/admin").matchedRule)
      .toBe("private-network-target");
  });

  it("blocks non-allowlisted command entrypoints", () => {
    const decision = policy.evaluate("perl -e 'print 1'");
    expect(decision.allowed).toBe(false);
    expect(decision.matchedRule).toBe("not-allowlisted");
  });
});
