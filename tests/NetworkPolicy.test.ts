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
});
