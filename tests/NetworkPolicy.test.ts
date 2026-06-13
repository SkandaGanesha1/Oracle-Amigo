import { describe, expect, it } from "vitest";
import { NetworkPolicy } from "../src/policy/NetworkPolicy.js";

describe("NetworkPolicy", () => {
  it("resolves npm profile", () => {
    expect(new NetworkPolicy().resolve("npm").allowedHosts).toEqual(["registry.npmjs.org"]);
  });

  it("normalizes custom hosts", () => {
    expect(new NetworkPolicy().resolve("custom", ["HTTPS://Example.com/path", "example.com"]).allowedHosts).toEqual([
      "example.com"
    ]);
  });

  it("rejects private and metadata custom hosts", () => {
    const policy = new NetworkPolicy();
    expect(() => policy.resolve("custom", ["169.254.169.254"])).toThrow(/not allowed/);
    expect(() => policy.resolve("custom", ["127.0.0.1"])).toThrow(/not allowed/);
    expect(() => policy.resolve("custom", ["metadata.google.internal"])).toThrow(/not allowed/);
  });
});
