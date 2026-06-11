/**
 * Tests for the hardened ANP handshake primitives.
 *
 * Covers:
 *   - Canonical payload ordering and field binding
 *   - Signature round-trip with the canonical form
 *   - Replay protection (store accepts once, rejects second time)
 *   - Timing validation (expired, future-dated, invalid)
 *   - DID resolution for did:key
 *   - Trust level calculation across inputs
 *   - Handshake offer/response round-trip with the async verify path
 */
import { describe, it, expect } from "vitest";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import {
  canonicalizeAnpPayload,
  signAnpPayload,
  verifyAnpPayload,
  anpPayloadFingerprint,
  validateAnpTiming,
  type AnpCanonicalFields,
} from "../src/security/AnpCanonicalPayload.js";
import { AnpReplayStore } from "../src/security/AnpReplayProtection.js";
import { resolveDid, DidCache } from "../src/security/DidResolver.js";
import { calculateTrustLevel, isLoopbackAddress, isTrustAtLeast } from "../src/security/AnpTrustLevel.js";
import {
  ANP_HANDSHAKE_PROTOCOL,
  createHandshakeContext,
  createHandshakeOffer,
  createHandshakeResponse,
  verifyHandshakeOffer,
  verifyHandshakeResponse,
  verifyHandshakeOfferSync,
  verifyHandshakeResponseSync,
  getActivePeerSession,
} from "../src/security/AnpHandshakeAdapter.js";
import type { LocalIdentity } from "../src/security/DeviceIdentity.js";
import { base58btcEncode } from "./_didKeyHelper.js";

// --------- helpers ---------

function makeIdentity(): { ident: LocalIdentity; privateKey: string; publicKey: string } {
  const k = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  // Derive the public-key hex from the PEM by exporting the raw 32 bytes
  const { createPublicKey } = require("node:crypto") as typeof import("node:crypto");
  const pub = createPublicKey(k.publicKey);
  const rawDer = pub.export({ format: "der", type: "spki" }) as Buffer;
  // SPKI prefix for Ed25519 is 12 bytes
  const prefixLen = 12;
  const publicKey = rawDer.subarray(prefixLen).toString("hex");
  const ident: LocalIdentity = {
    agentId: randomUUID(),
    deviceId: randomUUID(),
    did: `did:key:z${randomUUID().replace(/-/g, "").slice(0, 42)}`,
    publicKey,
    privateKeyRef: "",
    privateKeyPem: k.privateKey,
  };
  return { ident, privateKey: k.privateKey, publicKey };
}

function makeFields(overrides: Partial<AnpCanonicalFields> = {}): AnpCanonicalFields {
  const now = new Date();
  return {
    protocol: ANP_HANDSHAKE_PROTOCOL,
    offer_id: randomUUID(),
    from_agent_id: "agent-a",
    from_agent_instance_id: "agent-a-instance",
    from_did: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
    to_peer: "peer-x",
    nonce: randomBytes(32).toString("hex"),
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 60_000).toISOString(),
    ...overrides,
  };
}

// --------- canonical payload ---------

describe("AnpCanonicalPayload", () => {
  it("canonicalize is deterministic for identical fields", () => {
    const fields = makeFields();
    const a = canonicalizeAnpPayload(fields);
    const b = canonicalizeAnpPayload(fields);
    expect(a).toBe(b);
  });

  it("canonicalize produces a fixed field order even when object key order differs", () => {
    const f1: AnpCanonicalFields = {
      protocol: ANP_HANDSHAKE_PROTOCOL,
      offer_id: "o",
      from_agent_id: "agent-a",
      from_agent_instance_id: "agent-a-instance",
      from_did: "did:key:z",
      to_peer: "p",
      nonce: "n",
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2026-01-02T00:00:00.000Z",
    };
    // Same fields, different key insertion order
    const f2: AnpCanonicalFields = {
      nonce: "n",
      protocol: ANP_HANDSHAKE_PROTOCOL,
      from_did: "did:key:z",
      offer_id: "o",
      from_agent_id: "agent-a",
      from_agent_instance_id: "agent-a-instance",
      expires_at: "2026-01-02T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
      to_peer: "p",
    };
    expect(canonicalizeAnpPayload(f1)).toBe(canonicalizeAnpPayload(f2));
  });

  it("changing any field changes the fingerprint", () => {
    const f1 = makeFields();
    const f2 = { ...f1, to_peer: "different" };
    expect(anpPayloadFingerprint(f1)).not.toBe(anpPayloadFingerprint(f2));
  });

  it("ignores camelCase compatibility aliases when building the signed canonical payload", () => {
    const fields = makeFields({
      offer_id: "signed-offer",
      from_did: "did:key:zsigned",
      to_peer: "signed-peer",
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2026-01-01T00:01:00.000Z",
    });
    const withAliases = {
      ...fields,
      offerId: "unsigned-alias-offer",
      fromDid: "did:key:zunsigned",
      peer: "unsigned-alias-peer",
      createdAt: "1999-01-01T00:00:00.000Z",
      expiresAt: "1999-01-01T00:01:00.000Z",
    } as AnpCanonicalFields & Record<string, string>;
    expect(canonicalizeAnpPayload(withAliases)).toBe(canonicalizeAnpPayload(fields));
  });

  it("sign/verify round-trip succeeds with correct key", () => {
    const { privateKey, publicKey } = makeIdentity();
    const fields = makeFields();
    const sig = signAnpPayload(fields, privateKey);
    expect(verifyAnpPayload(fields, sig, publicKey)).toBe(true);
  });

  it("verifyAnpPayload returns false with wrong key", () => {
    const a = makeIdentity();
    const b = makeIdentity();
    const fields = makeFields();
    const sig = signAnpPayload(fields, a.privateKey);
    expect(verifyAnpPayload(fields, sig, b.publicKey)).toBe(false);
  });

  it("verifyAnpPayload returns false when any field is tampered", () => {
    const { privateKey, publicKey } = makeIdentity();
    const fields = makeFields();
    const sig = signAnpPayload(fields, privateKey);
    for (const key of ["offer_id", "from_agent_id", "from_agent_instance_id", "from_did", "to_peer", "nonce", "created_at", "expires_at", "protocol"] as const) {
      expect(verifyAnpPayload({ ...fields, [key]: `${fields[key]}-tampered` }, sig, publicKey)).toBe(false);
    }
  });

  it("validateAnpTiming accepts a fresh, in-range payload", () => {
    expect(validateAnpTiming(makeFields()).valid).toBe(true);
  });

  it("validateAnpTiming rejects expired payloads", () => {
    const fields = makeFields({
      created_at: new Date(Date.now() - 120_000).toISOString(),
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(validateAnpTiming(fields).valid).toBe(false);
    expect(validateAnpTiming(fields).reason).toBe("expired");
  });

  it("validateAnpTiming rejects createdAt in the future", () => {
    const fields = makeFields({
      created_at: new Date(Date.now() + 120_000).toISOString(),
      expires_at: new Date(Date.now() + 180_000).toISOString(),
    });
    expect(validateAnpTiming(fields).valid).toBe(false);
    expect(validateAnpTiming(fields).reason).toBe("created_at_in_future");
  });
});

// --------- replay protection ---------

describe("AnpReplayStore", () => {
  it("accepts a nonce once, then rejects the same nonce", () => {
    const store = new AnpReplayStore();
    expect(store.checkAndRecord("peer", "offer", "n1")).toBe(true);
    expect(store.checkAndRecord("peer", "offer", "n1")).toBe(false);
  });

  it("different nonces are independent", () => {
    const store = new AnpReplayStore();
    expect(store.checkAndRecord("peer", "offer", "n1")).toBe(true);
    expect(store.checkAndRecord("peer", "offer", "n2")).toBe(true);
  });

  it("prunes expired entries", () => {
    const store = new AnpReplayStore({ ttlSeconds: 1 });
    store.checkAndRecord("peer", "offer", "n1", Date.now() - 10_000);
    expect(store.size()).toBe(1);
    store.checkAndRecord("peer", "offer", "n2", Date.now());
    expect(store.size()).toBe(1); // n1 pruned, n2 stored
  });
});

// --------- DID resolution ---------

describe("DidResolver", () => {
  it("resolves a synthetic did:key with self-contained public key", () => {
    // Use a known Ed25519 public key encoded as did:key
    const rawPub = "ab".repeat(32); // 32 bytes
    // base58btcEncode is imported at the top of the file
    const multicodec = Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(rawPub, "hex")]);
    const did = `did:key:z${base58btcEncode(multicodec)}`;
    return resolveDid(did).then((res) => {
      expect(res).not.toBeNull();
      expect(res!.publicKeyHex).toBe(rawPub);
      expect(res!.method).toBe("key");
    });
  });

  it("returns null for unknown DID method", async () => {
    expect(await resolveDid("did:unknown:abc")).toBeNull();
  });

  it("returns null for malformed did:key values", async () => {
    const rawPub = "ef".repeat(32);
    const wrongCodec = `did:key:z${base58btcEncode(Buffer.concat([Buffer.from([0xec, 0x01]), Buffer.from(rawPub, "hex")]))}`;
    const shortKey = `did:key:z${base58btcEncode(Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from("ef".repeat(31), "hex")]))}`;
    expect(await resolveDid("did:key:not-multibase")).toBeNull();
    expect(await resolveDid("did:key:z0invalid")).toBeNull();
    expect(await resolveDid(wrongCodec)).toBeNull();
    expect(await resolveDid(shortKey)).toBeNull();
  });

  it("resolves did:wba through well-known metadata with a hex Ed25519 public key", async () => {
    const rawPub = "aa".repeat(32);
    const did = "did:wba:agent.example:ed25519:fingerprint";
    const calls: string[] = [];
    const fetchImpl = async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ did, publicKey: rawPub }), { status: 200 });
    };
    const res = await resolveDid(did, { fetchImpl });
    expect(res).not.toBeNull();
    expect(res!.method).toBe("wba");
    expect(res!.controller).toBe("agent.example");
    expect(res!.publicKeyHex).toBe(rawPub);
    expect(calls).toEqual(["https://agent.example/.well-known/did.json"]);
  });

  it("returns null for did:wba resolution failure cases", async () => {
    const did = "did:wba:agent.example:ed25519:fingerprint";
    const rawPub = "aa".repeat(32);
    const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    expect(await resolveDid("did:wba::ed25519:fingerprint", {
      fetchImpl: async () => ok({ did, publicKey: rawPub }),
    })).toBeNull();
    expect(await resolveDid("did:wba:agent.example:rsa:fingerprint", {
      fetchImpl: async () => ok({ did, publicKey: rawPub }),
    })).toBeNull();
    expect(await resolveDid("did:wba:agent.example:70000:ed25519:fingerprint", {
      fetchImpl: async () => ok({ did, publicKey: rawPub }),
    })).toBeNull();
    expect(await resolveDid(did, {
      fetchImpl: async () => ok({ did, publicKey: rawPub }, 404),
    })).toBeNull();
    expect(await resolveDid(did, {
      fetchImpl: async () => ok({ did: "did:wba:other.example:ed25519:fingerprint", publicKey: rawPub }),
    })).toBeNull();
    expect(await resolveDid(did, {
      fetchImpl: async () => ok({ did, publicKey: "aa".repeat(31) }),
    })).toBeNull();
  });

  it("DidCache caches successful resolutions", async () => {
    const cache = new DidCache();
    const rawPub = "cd".repeat(32);
    // base58btcEncode is imported at the top of the file
    const multicodec = Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(rawPub, "hex")]);
    const did = `did:key:z${base58btcEncode(multicodec)}`;
    const r1 = await cache.resolve(did);
    const r2 = await cache.resolve(did);
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r1!.publicKeyHex).toBe(rawPub);
  });
});

// --------- trust level ---------

describe("AnpTrustLevel", () => {
  it("loopback beats everything except pinned/local", () => {
    expect(calculateTrustLevel({ did: null, resolution: null, isLoopback: true, hasPriorSession: false })).toBe("loopback");
  });

  it("untrusted when no DID and no loopback", () => {
    expect(calculateTrustLevel({ did: null, resolution: null, isLoopback: false, hasPriorSession: false })).toBe("untrusted");
  });

  it("untrusted for did:wba without prior session", () => {
    expect(calculateTrustLevel({
      did: "did:wba:host:ed25519:fp",
      resolution: { method: "wba" },
      isLoopback: false,
      hasPriorSession: false,
    })).toBe("untrusted");
  });

  it("verified for did:wba with prior session", () => {
    expect(calculateTrustLevel({
      did: "did:wba:host:ed25519:fp",
      resolution: { method: "wba" },
      isLoopback: false,
      hasPriorSession: true,
    })).toBe("verified");
  });

  it("verified for did:key with prior session", () => {
    expect(calculateTrustLevel({
      did: "did:key:z6Mk...",
      resolution: { method: "key" },
      isLoopback: false,
      hasPriorSession: true,
    })).toBe("verified");
  });

  it("pinned override wins", () => {
    expect(calculateTrustLevel({
      did: null, resolution: null, isLoopback: false, hasPriorSession: false, pinnedLevel: "local",
    })).toBe("local");
  });

  it("isLoopbackAddress detects loopback IPs and hostnames", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("127.5.6.7")).toBe(true);
    expect(isLoopbackAddress("localhost")).toBe(true);
    expect(isLoopbackAddress("foo.localhost")).toBe(true);
    expect(isLoopbackAddress("example.com")).toBe(false);
    expect(isLoopbackAddress("10.0.0.1")).toBe(false);
  });

  it("isTrustAtLeast orders levels correctly", () => {
    expect(isTrustAtLeast("local", "verified")).toBe(true);
    expect(isTrustAtLeast("verified", "loopback")).toBe(false);
    expect(isTrustAtLeast("untrusted", "untrusted")).toBe(true);
  });
});

// --------- handshake end-to-end ---------

describe("Handshake end-to-end with hardening", () => {
  it("async offer/verify round-trip succeeds when DID resolution confirms key", async () => {
    const a = makeIdentity();
    // Build a did:key that matches `a.publicKey`
    // base58btcEncode is imported at the top of the file
    const multicodec = Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(a.publicKey, "hex")]);
    a.ident.did = `did:key:z${base58btcEncode(multicodec)}`;

    const ctx = createHandshakeContext();
    const offer = createHandshakeOffer(a.ident, "peer-b", ctx);
    const v = await verifyHandshakeOffer(offer, a.publicKey, ctx);
    expect(v.valid).toBe(true);
  });

  it("mutating compatibility aliases does not change signed offer verification", () => {
    const a = makeIdentity();
    const ctx = createHandshakeContext();
    const offer = createHandshakeOffer(a.ident, "peer-b", ctx);
    expect(verifyHandshakeOfferSync({
      ...offer,
      offerId: "unsigned-alias-offer",
      peer: "unsigned-alias-peer",
      createdAt: "1999-01-01T00:00:00.000Z",
      expiresAt: "1999-01-01T00:01:00.000Z",
      fromDid: "did:key:zunsigned-alias",
    } as typeof offer & Record<string, string>, a.publicKey)).toBe(true);
  });

  it("created handshake payloads emit only snake_case canonical fields", () => {
    const a = makeIdentity();
    const b = makeIdentity();
    const ctx = createHandshakeContext();
    const offer = createHandshakeOffer(a.ident, "peer-b", ctx) as Record<string, unknown>;
    const response = createHandshakeResponse(offer as ReturnType<typeof createHandshakeOffer>, b.ident, ctx) as Record<string, unknown>;
    for (const payload of [offer, response]) {
      expect(payload.offer_id).toBeTruthy();
      expect(payload.from_did).toBeTruthy();
      expect(payload.created_at).toBeTruthy();
      expect(payload.expires_at).toBeTruthy();
      expect(payload.offerId).toBeUndefined();
      expect(payload.fromDid).toBeUndefined();
      expect(payload.createdAt).toBeUndefined();
      expect(payload.expiresAt).toBeUndefined();
      expect(payload.peer).toBeUndefined();
    }
    expect(response.response_id).toBeTruthy();
    expect(response.responseId).toBeUndefined();
  });

  it("rejects a replayed offer (same nonce submitted twice)", async () => {
    const a = makeIdentity();
    // base58btcEncode is imported at the top of the file
    const multicodec = Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(a.publicKey, "hex")]);
    a.ident.did = `did:key:z${base58btcEncode(multicodec)}`;

    const ctx = createHandshakeContext();
    const offer = createHandshakeOffer(a.ident, "peer-b", ctx);
    const first = await verifyHandshakeOffer(offer, a.publicKey, ctx);
    const second = await verifyHandshakeOffer(offer, a.publicKey, ctx);
    expect(first.valid).toBe(true);
    expect(second.valid).toBe(false);
    expect(second.reason).toBe("replayed");
  });

  it("rejects when the DID does not resolve", async () => {
    const a = makeIdentity();
    a.ident.did = "did:wba:no-such-host.example:ed25519:fp";
    const ctx = createHandshakeContext();
    const offer = createHandshakeOffer(a.ident, "peer-b", ctx);
    const v = await verifyHandshakeOffer(offer, a.publicKey, ctx);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("did_unresolved");
  });

  it("rejects when the DID resolves to a different public key", async () => {
    const a = makeIdentity();
    const b = makeIdentity();
    // base58btcEncode is imported at the top of the file
    const multicodec = Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(b.publicKey, "hex")]);
    a.ident.did = `did:key:z${base58btcEncode(multicodec)}`; // DID points to b
    const ctx = createHandshakeContext();
    const offer = createHandshakeOffer(a.ident, "peer-b", ctx);
    const v = await verifyHandshakeOffer(offer, a.publicKey, ctx);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("did_key_mismatch");
  });

  it("response verify round-trip succeeds", async () => {
    const a = makeIdentity();
    const b = makeIdentity();
    // base58btcEncode is imported at the top of the file
    for (const i of [a, b]) {
      const multicodec = Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(i.publicKey, "hex")]);
      i.ident.did = `did:key:z${base58btcEncode(multicodec)}`;
    }
    const ctx = createHandshakeContext();
    const offer = createHandshakeOffer(a.ident, b.ident.agentId, ctx);
    const v1 = await verifyHandshakeOffer(offer, a.publicKey, ctx);
    expect(v1.valid).toBe(true);
    const response = createHandshakeResponse(offer, b.ident, ctx);
    const v2 = await verifyHandshakeResponse(response, b.publicKey, ctx);
    expect(v2.valid).toBe(true);
  });

  it("sync verify rejects an expired offer", () => {
    const a = makeIdentity();
    const ctx = createHandshakeContext({ defaultTtlSeconds: -1 });
    const offer = createHandshakeOffer(a.ident, "peer-b", ctx);
    expect(verifyHandshakeOfferSync(offer, a.publicKey)).toBe(false);
  });

  it("getActivePeerSession returns null for unknown peer", () => {
    const ctx = createHandshakeContext();
    expect(getActivePeerSession("never-seen", ctx)).toBeNull();
  });
});
