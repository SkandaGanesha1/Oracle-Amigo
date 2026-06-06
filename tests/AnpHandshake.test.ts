import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildDidWba } from "../src/security/anp/DidWba.js";
import { computeSecretKeyId, computeSharedSecret, deriveSessionKey } from "../src/security/anp/AnpCrypto.js";
import { ANP_PROTOCOL_VERSION, completeHandshakeAsInitiator, initiateHandshake, respondToHandshake, verifyAnpProof, verifyFinishedAsResponder } from "../src/security/anp/AnpProtocol.js";
import type { LocalIdentity } from "../src/security/DeviceIdentity.js";

function makeLocalIdentity(): LocalIdentity {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  // Extract raw 32-byte public key (last 32 bytes of SPKI)
  const b64 = publicKey.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const spki = Buffer.from(b64, "base64");
  const rawPubKeyHex = spki.subarray(-32).toString("hex");
  return {
    agentId: "agent-" + Math.random().toString(36).slice(2),
    deviceId: "device-" + Math.random().toString(36).slice(2),
    did: "did:key:test",
    publicKey: rawPubKeyHex,
    privateKeyRef: ":memory:",
    privateKeyPem: privateKey,
  };
}

function makeLocalDid(identity: { publicKey: string }, hostname: string, port: number) {
  return buildDidWba({ domain: hostname, port, publicKeyHex: identity.publicKey }).did;
}

// Patch loadPrivateKeyPem to return our in-memory PEM during tests
// Note: LocalIdentity has an optional `privateKeyPem` field; passing it makes
// loadPrivateKeyPem return it directly (no runtime override needed).

function canonicalizeForTest(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalizeForTest).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalizeForTest((value as Record<string, unknown>)[k])}`);
  return `{${parts.join(",")}}`;
}

describe("ANP Handshake Protocol", () => {
  it("completes a full 3-message handshake between Alice and Bob", () => {
    const aliceIdentity = makeLocalIdentity();
    const bobIdentity = makeLocalIdentity();
    const aliceDid = makeLocalDid(aliceIdentity, "127.0.0.1", 3399);
    const bobDid = makeLocalDid(bobIdentity, "127.0.0.1", 3499);

    const { message: sourceHello, context: aliceCtx } = initiateHandshake({
      identity: aliceIdentity,
      sourceDid: aliceDid,
      destinationDid: bobDid,
    });
    expect(sourceHello.type).toBe("sourceHello");
    expect(sourceHello.version).toBe(ANP_PROTOCOL_VERSION);
    expect(sourceHello.ecdhe.group).toBe("secp256r1");
    expect(sourceHello.ecdhe.publicKeyHex).toMatch(/^[0-9a-f]{130}$/);

    const { message: destHello, context: bobCtx } = respondToHandshake({
      identity: bobIdentity,
      sourceDid: aliceDid,
      destinationDid: bobDid,
      sourceHello,
    });
    expect(destHello.type).toBe("destinationHello");
    expect(destHello.sessionId).toBe(sourceHello.sessionId);
    expect(destHello.ecdhe.publicKeyHex).toMatch(/^[0-9a-f]{130}$/);

    const expectedSecretKeyId = computeSecretKeyId(sourceHello.random, destHello.random);

    const { message: aliceFinished, context: aliceCompleted } = completeHandshakeAsInitiator(aliceCtx, destHello, aliceIdentity, bobIdentity.publicKey);
    expect(aliceFinished.type).toBe("finished");
    expect(aliceFinished.verifyData.secretKeyId).toBe(expectedSecretKeyId);
    expect(aliceCompleted.sessionKey).toBeDefined();
    expect(aliceCompleted.secretKeyId).toBe(expectedSecretKeyId);

    // Bob derives his own session key and verifies Finished
    const bobSharedSecret = computeSharedSecret(bobCtx.ecdhe.privateKey, Buffer.from(sourceHello.ecdhe.publicKeyHex, "hex"));
    const bobSessionKey = deriveSessionKey(bobSharedSecret, Buffer.from(sourceHello.random + destHello.random, "hex"), `anp:${bobCtx.sessionId}`);
    const bobCompletedCtx = { ...bobCtx, sessionKey: bobSessionKey };
    const result = verifyFinishedAsResponder(bobCompletedCtx, aliceFinished, bobIdentity, expectedSecretKeyId);
    expect(result.ok).toBe(true);

    // Both sides derived the same session key
    expect(aliceCompleted.sessionKey?.key.equals(bobSessionKey.key)).toBe(true);
  });

  it("rejects Finished with wrong secretKeyId", () => {
    const alice = makeLocalIdentity();
    const bob = makeLocalIdentity();
    const aliceDid = makeLocalDid(alice, "127.0.0.1", 3399);
    const bobDid = makeLocalDid(bob, "127.0.0.1", 3499);

    const { message: src, context: aCtx } = initiateHandshake({ identity: alice, sourceDid: aliceDid, destinationDid: bobDid });
    const { message: dst, context: bCtx } = respondToHandshake({ identity: bob, sourceDid: aliceDid, destinationDid: bobDid, sourceHello: src });
    const { message: finished } = completeHandshakeAsInitiator(aCtx, dst, alice, bob.publicKey);

    const bShared = computeSharedSecret(bCtx.ecdhe.privateKey, Buffer.from(src.ecdhe.publicKeyHex, "hex"));
    const bSession = deriveSessionKey(bShared, Buffer.from(src.random + dst.random, "hex"), `anp:${bCtx.sessionId}`);
    const result = verifyFinishedAsResponder({ ...bCtx, sessionKey: bSession }, finished, bob, "wrong-secret-key-id");
    expect(result.ok).toBe(false);
  });

  it("source and destination proofs are Ed25519 signatures over canonical message", () => {
    const alice = makeLocalIdentity();
    const bob = makeLocalIdentity();
    const aliceDid = makeLocalDid(alice, "127.0.0.1", 3399);
    const bobDid = makeLocalDid(bob, "127.0.0.1", 3499);

    const { message: src } = initiateHandshake({ identity: alice, sourceDid: aliceDid, destinationDid: bobDid });
    const { message: dst } = respondToHandshake({ identity: bob, sourceDid: aliceDid, destinationDid: bobDid, sourceHello: src });

    expect(src.proof.cryptosuite).toBe("eddsa-jcs-2022");
    expect(src.proof.verificationMethod).toBe(`${aliceDid}#key-1`);
    expect(dst.proof.verificationMethod).toBe(`${bobDid}#key-1`);

    // The proof is computed over canonical(message) where message has NO `proof` field.
    // The proof itself is attached afterwards. Reconstruct that payload by stripping the proof.
    const srcWithoutProof = { ...src } as any;
    delete srcWithoutProof.proof;
    const dstWithoutProof = { ...dst } as any;
    delete dstWithoutProof.proof;
    const srcPayload = canonicalizeForTest(srcWithoutProof);
    const dstPayload = canonicalizeForTest(dstWithoutProof);
    expect(verifyAnpProof(alice.publicKey, src.proof.verificationMethod, srcPayload, src.proof)).toBe(true);
    expect(verifyAnpProof(bob.publicKey, dst.proof.verificationMethod, dstPayload, dst.proof)).toBe(true);
  });
});
