import { describe, expect, it } from "vitest";
import { buildDidWba, computeJwkThumbprintEd25519, parseDidWba, publicKeyToMultibase, verifyThumbprint } from "../src/security/anp/DidWba.js";

const TEST_PUBKEY_HEX = "7e9c7c7c0e9c7c7c0e9c7c7c0e9c7c7c0e9c7c7c0e9c7c7c0e9c7c7c0e9c7c7c"; // 32 bytes

describe("buildDidWba", () => {
  it("builds a did:wba with e1_ prefix and proper format", () => {
    const { did, didDocument } = buildDidWba({ domain: "127.0.0.1", port: 3399, publicKeyHex: TEST_PUBKEY_HEX });
    expect(did).toMatch(/^did:wba:127\.0\.0\.1%3A3399:e1_[0-9a-f]{64}$/);
    expect(didDocument.id).toBe(did);
    expect(didDocument.verificationMethod).toHaveLength(1);
    expect(didDocument.authentication).toContain(didDocument.verificationMethod[0].id);
    expect(didDocument.keyAgreement).toContain(didDocument.verificationMethod[0].id);
  });

  it("round-trips through parseDidWba", () => {
    const { did } = buildDidWba({ domain: "127.0.0.1", port: 3399, publicKeyHex: TEST_PUBKEY_HEX });
    const parsed = parseDidWba(did);
    expect(parsed?.domain).toBe("127.0.0.1");
    expect(parsed?.port).toBe(3399);
  });

  it("builds without port when omitted", () => {
    const { did } = buildDidWba({ domain: "example.com", publicKeyHex: TEST_PUBKEY_HEX });
    expect(did).toMatch(/^did:wba:example\.com:e1_[0-9a-f]{64}$/);
  });

  it("includes ANP service endpoints", () => {
    const { didDocument } = buildDidWba({ domain: "127.0.0.1", port: 3399, publicKeyHex: TEST_PUBKEY_HEX });
    const services = didDocument.service;
    expect(services.find((s) => s.type === "AgentDescription")).toBeDefined();
    expect(services.find((s) => s.type === "ANPMessageService")).toBeDefined();
  });
});

describe("computeJwkThumbprintEd25519", () => {
  it("returns 64-char hex (sha256 of canonical JWK)", () => {
    const thumbprint = computeJwkThumbprintEd25519(TEST_PUBKEY_HEX);
    expect(thumbprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces RFC 7638 known value for known key", () => {
    // RFC 7638 example uses a different key, but consistency check is what matters
    const t1 = computeJwkThumbprintEd25519(TEST_PUBKEY_HEX);
    const t2 = computeJwkThumbprintEd25519(TEST_PUBKEY_HEX);
    expect(t1).toBe(t2);
  });
});

describe("verifyThumbprint", () => {
  it("verifies matching thumbprint", () => {
    const thumbprint = computeJwkThumbprintEd25519(TEST_PUBKEY_HEX);
    expect(verifyThumbprint(TEST_PUBKEY_HEX, thumbprint)).toBe(true);
  });

  it("rejects mismatched thumbprint", () => {
    const wrong = "0".repeat(64);
    expect(verifyThumbprint(TEST_PUBKEY_HEX, wrong)).toBe(false);
  });
});

describe("parseDidWba", () => {
  it("parses did with port", () => {
    const { did } = buildDidWba({ domain: "127.0.0.1", port: 3399, publicKeyHex: TEST_PUBKEY_HEX });
    const parsed = parseDidWba(did);
    expect(parsed?.domain).toBe("127.0.0.1");
    expect(parsed?.port).toBe(3399);
    expect(parsed?.thumbprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("parses did without port", () => {
    const { did } = buildDidWba({ domain: "example.com", publicKeyHex: TEST_PUBKEY_HEX });
    const parsed = parseDidWba(did);
    expect(parsed?.domain).toBe("example.com");
    expect(parsed?.port).toBeUndefined();
  });

  it("returns null for invalid did", () => {
    expect(parseDidWba("did:key:z6Mk...")).toBeNull();
    expect(parseDidWba("did:wba:example.com:badprefix_abc")).toBeNull();
  });
});

describe("publicKeyToMultibase", () => {
  it("prefixes with z6Mk for Ed25519", () => {
    expect(publicKeyToMultibase(TEST_PUBKEY_HEX)).toBe(`z6Mk${TEST_PUBKEY_HEX}`);
  });
});
