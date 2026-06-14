import { describe, expect, it } from "vitest";
import { computeSecretKeyId, computeSharedSecret, decryptWithSessionKey, deriveSessionKey, encryptWithSessionKey, generateEcdheKeyPair, hkdfSha256, safeEqual } from "../src/security/anp/AnpCrypto.js";
import { AnpKeyRotationService } from "../src/security/anp/AnpKeyRotationService.js";

describe("generateEcdheKeyPair", () => {
  it("returns 32-byte private key and 65-byte public key (uncompressed secp256r1)", () => {
    const kp = generateEcdheKeyPair("secp256r1");
    expect(kp.privateKey.length).toBe(32);
    expect(kp.publicKey.length).toBe(65);
    expect(kp.publicKey[0]).toBe(0x04);
  });
});

describe("computeSharedSecret", () => {
  it("is symmetric — both sides derive the same secret", () => {
    const a = generateEcdheKeyPair();
    const b = generateEcdheKeyPair();
    const sab = computeSharedSecret(a.privateKey, b.publicKey);
    const sba = computeSharedSecret(b.privateKey, a.publicKey);
    expect(sab.equals(sba)).toBe(true);
    expect(sab.length).toBe(32);
  });
});

describe("hkdfSha256", () => {
  it("produces requested-length output", () => {
    const okm = hkdfSha256(Buffer.from("secret"), Buffer.from("salt"), Buffer.from("info"), 42);
    expect(okm.length).toBe(42);
  });

  it("is deterministic for same inputs", () => {
    const a = hkdfSha256(Buffer.from("secret"), Buffer.from("salt"), Buffer.from("info"), 16);
    const b = hkdfSha256(Buffer.from("secret"), Buffer.from("salt"), Buffer.from("info"), 16);
    expect(a.equals(b)).toBe(true);
  });

  it("differs when info changes", () => {
    const a = hkdfSha256(Buffer.from("secret"), Buffer.from("salt"), Buffer.from("info1"), 16);
    const b = hkdfSha256(Buffer.from("secret"), Buffer.from("salt"), Buffer.from("info2"), 16);
    expect(a.equals(b)).toBe(false);
  });
});

describe("deriveSessionKey", () => {
  it("returns 32-byte AES-256 key + 12-byte IV by default", () => {
    const shared = Buffer.alloc(32, 1);
    const session = deriveSessionKey(shared, Buffer.alloc(32, 2), "test-info");
    expect(session.key.length).toBe(32);
    expect(session.iv.length).toBe(12);
  });

  it("still derives 16-byte AES-128 keys for legacy compatibility", () => {
    const shared = Buffer.alloc(32, 1);
    const session = deriveSessionKey(shared, Buffer.alloc(32, 2), "test-info", 16);
    expect(session.key.length).toBe(16);
    expect(session.iv.length).toBe(12);
  });
});

describe("encrypt/decrypt round-trip", () => {
  it("recovers plaintext and detects tampering", () => {
    const shared = Buffer.alloc(32, 5);
    const session = deriveSessionKey(shared, Buffer.alloc(32, 6), "anp:test");
    const secretKeyId = computeSecretKeyId("a".repeat(64), "b".repeat(64));
    const payload = encryptWithSessionKey("hello-world", session, secretKeyId);
    const decoded = decryptWithSessionKey(payload, session).toString("utf8");
    expect(decoded).toBe("hello-world");
  });

  it("fails to decrypt with wrong IV", () => {
    const shared = Buffer.alloc(32, 5);
    const session = deriveSessionKey(shared, Buffer.alloc(32, 6), "anp:test");
    const payload = encryptWithSessionKey("hello", session, "kid");
    const tampered = { ...payload, iv: Buffer.alloc(12, 0xff).toString("base64") };
    expect(() => decryptWithSessionKey(tampered, session)).toThrow();
  });

  it("rejects invalid IV, tag, and key lengths", () => {
    const session = deriveSessionKey(Buffer.alloc(32, 5), Buffer.alloc(32, 6), "anp:test");
    const payload = encryptWithSessionKey("hello", session, "kid");
    expect(() => decryptWithSessionKey({ ...payload, iv: Buffer.alloc(11).toString("base64") }, session)).toThrow(/IV length/);
    expect(() => decryptWithSessionKey({ ...payload, tag: Buffer.alloc(15).toString("base64") }, session)).toThrow(/tag length/);
    expect(() => encryptWithSessionKey("hello", { key: Buffer.alloc(24), iv: Buffer.alloc(12) }, "kid")).toThrow(/key length/);
  });
});

describe("computeSecretKeyId", () => {
  it("returns 64-char hex", () => {
    const id = computeSecretKeyId("a".repeat(64), "b".repeat(64));
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is order-sensitive", () => {
    const id1 = computeSecretKeyId("a", "b");
    const id2 = computeSecretKeyId("b", "a");
    expect(id1).not.toBe(id2);
  });
});

describe("safeEqual", () => {
  it("returns true for equal buffers", () => {
    expect(safeEqual(Buffer.from("abc"), Buffer.from("abc"))).toBe(true);
  });
  it("returns false for different-length buffers", () => {
    expect(safeEqual(Buffer.from("a"), Buffer.from("ab"))).toBe(false);
  });
  it("returns false for different content same length", () => {
    expect(safeEqual(Buffer.from("a"), Buffer.from("b"))).toBe(false);
  });
});

describe("AnpKeyRotationService", () => {
  it("creates rotation metadata and detects expiry", () => {
    const service = new AnpKeyRotationService(1);
    const metadata = service.createMetadata(Buffer.alloc(32, 7), new Date("2026-01-01T00:00:00.000Z"));
    expect(metadata.algorithm).toBe("aes-256-gcm");
    expect(metadata.keyId).toMatch(/^[0-9a-f]{64}$/);
    expect(service.shouldRotate(metadata, new Date("2026-01-01T12:00:00.000Z"))).toBe(false);
    expect(service.shouldRotate(metadata, new Date("2026-01-02T00:00:01.000Z"))).toBe(true);
  });
});
