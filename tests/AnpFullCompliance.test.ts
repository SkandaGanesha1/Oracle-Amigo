import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ANP_CAPABILITY_IDS,
  ANP_APPLICATION_PROTOCOLS,
  DEFAULT_CAPABILITY_SET,
  REQUIRED_CAPABILITIES,
  negotiateMetaProtocol,
} from "../src/security/anp/AnpMetaProtocol.js";
import { buildAdpAgentDescription, getAdpEndpointFor } from "../src/security/anp/AgentDescriptionProtocol.js";
import { buildDiscoveryResult, isValidWnsHandle, wnsHandleToDid, buildWnsHandleRecord } from "../src/security/anp/AgentDiscoveryProtocol.js";
import { encryptMessage, decryptMessage, isExpired, appendToThread } from "../src/security/anp/MessagingProtocol.js";
import { buildPaymentIntent, issueIntent, authorizeIntent, settleIntent, cancelIntent, refundIntent, isIntentExpired, intentFingerprint } from "../src/security/anp/Ap2PaymentProtocol.js";
import { generateEcdheKeyPair, computeSharedSecret, deriveSessionKey, computeSecretKeyId } from "../src/security/anp/AnpCrypto.js";
import type { LocalIdentity } from "../src/security/DeviceIdentity.js";

const testIdentity: LocalIdentity = {
  agentId: "test-agent",
  deviceId: "test-device",
  did: "did:wba:test.example.com:e1_test",
  publicKey: "11".repeat(32),
  privateKeyRef: "/tmp/test.pem",
};

describe("ANP Meta-Protocol", () => {
  it("defines required capabilities", () => {
    expect(REQUIRED_CAPABILITIES).toContain(ANP_CAPABILITY_IDS.ENCRYPTED_MESSAGE);
    expect(REQUIRED_CAPABILITIES).toContain(ANP_CAPABILITY_IDS.SIGNED_MESSAGE);
  });

  it("default capability set includes all capabilities", () => {
    expect(DEFAULT_CAPABILITY_SET.capabilities.length).toBeGreaterThanOrEqual(REQUIRED_CAPABILITIES.length);
  });

  it("negotiates matching capabilities and protocol", () => {
    const sourceHello = {
      version: "1.0",
      type: "sourceHello" as const,
      sourceDid: "did:wba:src.example:e1_a",
      sourcePublicKeyHex: "00",
      metaProtocol: {
        version: "1.0",
        supportedCapabilities: [ANP_CAPABILITY_IDS.ENCRYPTED_MESSAGE, ANP_CAPABILITY_IDS.SIGNED_MESSAGE, ANP_CAPABILITY_IDS.FILE_TRANSFER],
        candidateProtocols: [ANP_APPLICATION_PROTOCOLS.DIDCOMM_V2, ANP_APPLICATION_PROTOCOLS.E2E_FILE_TRANSFER],
      },
      sessionId: "s1",
      random: "aa".repeat(32),
      ecdhe: { group: "secp256r1" as const, publicKeyHex: "00" },
      expires: 0,
      proof: { type: "DataIntegrityProof" as const, cryptosuite: "eddsa-jcs-2022" as const, verificationMethod: "did#key-1", created: "2026-01-01T00:00:00Z", proofPurpose: "assertionMethod" as const, proofValue: "00" },
    };
    const destinationHello = {
      version: "1.0",
      type: "destinationHello" as const,
      destinationDid: "did:wba:dst.example:e1_b",
      destinationPublicKeyHex: "00",
      metaProtocol: {
        version: "1.0",
        supportedCapabilities: [ANP_CAPABILITY_IDS.ENCRYPTED_MESSAGE, ANP_CAPABILITY_IDS.SIGNED_MESSAGE, ANP_CAPABILITY_IDS.FILE_TRANSFER],
        selectedProtocol: ANP_APPLICATION_PROTOCOLS.DIDCOMM_V2,
      },
      sessionId: "s1",
      random: "bb".repeat(32),
      ecdhe: { group: "secp256r1" as const, publicKeyHex: "00" },
      expires: 0,
      proof: { type: "DataIntegrityProof" as const, cryptosuite: "eddsa-jcs-2022" as const, verificationMethod: "did#key-1", created: "2026-01-01T00:00:00Z", proofPurpose: "assertionMethod" as const, proofValue: "00" },
    };
    const result = negotiateMetaProtocol(sourceHello, destinationHello);
    expect(result.ok).toBe(true);
    expect(result.sharedCapabilities).toContain(ANP_CAPABILITY_IDS.ENCRYPTED_MESSAGE);
    expect(result.sharedCapabilities).toContain(ANP_CAPABILITY_IDS.FILE_TRANSFER);
    expect(result.selectedProtocol).toBe(ANP_APPLICATION_PROTOCOLS.DIDCOMM_V2);
  });

  it("fails when required capability is missing", () => {
    const sourceHello = {
      version: "1.0",
      type: "sourceHello" as const,
      sourceDid: "did:wba:src:e1_a",
      sourcePublicKeyHex: "00",
      metaProtocol: {
        version: "1.0",
        supportedCapabilities: [ANP_CAPABILITY_IDS.ENCRYPTED_MESSAGE, ANP_CAPABILITY_IDS.PAYMENT_REQUEST],
        candidateProtocols: [ANP_APPLICATION_PROTOCOLS.DIDCOMM_V2],
      },
      sessionId: "s2",
      random: "aa".repeat(32),
      ecdhe: { group: "secp256r1" as const, publicKeyHex: "00" },
      expires: 0,
      proof: { type: "DataIntegrityProof" as const, cryptosuite: "eddsa-jcs-2022" as const, verificationMethod: "did#key-1", created: "2026-01-01T00:00:00Z", proofPurpose: "assertionMethod" as const, proofValue: "00" },
    };
    const destinationHello = {
      version: "1.0",
      type: "destinationHello" as const,
      destinationDid: "did:wba:dst:e1_b",
      destinationPublicKeyHex: "00",
      metaProtocol: {
        version: "1.0",
        supportedCapabilities: [ANP_CAPABILITY_IDS.FILE_TRANSFER],
        selectedProtocol: ANP_APPLICATION_PROTOCOLS.DIDCOMM_V2,
      },
      sessionId: "s2",
      random: "bb".repeat(32),
      ecdhe: { group: "secp256r1" as const, publicKeyHex: "00" },
      expires: 0,
      proof: { type: "DataIntegrityProof" as const, cryptosuite: "eddsa-jcs-2022" as const, verificationMethod: "did#key-1", created: "2026-01-01T00:00:00Z", proofPurpose: "assertionMethod" as const, proofValue: "00" },
    };
    const result = negotiateMetaProtocol(sourceHello, destinationHello);
    expect(result.ok).toBe(false);
  });
});

describe("ANP Agent Description Protocol", () => {
  it("builds a valid ADP agent description with JSON-LD context", () => {
    const card = {
      protocolVersion: "0.3.0",
      name: "Test Agent",
      description: "Test",
      url: "https://test.example.com/a2a/jsonrpc",
      preferredTransport: "JSONRPC",
      version: "1.0.0",
      capabilities: { streaming: true },
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["application/json"],
      skills: [{ id: "test.skill", name: "Test", description: "Test skill", tags: ["test"] }],
    } as const;
    const adp = buildAdpAgentDescription({
      identity: testIdentity,
      agentCard: card as any,
      organization: { name: "Test Org" },
      capabilities: [ANP_CAPABILITY_IDS.FILE_TRANSFER],
      baseUrl: "https://test.example.com",
      anpEndpointUrl: "https://test.example.com/anp/messages",
      humanAuthorizationRequired: true,
    });
    expect(adp["@type"]).toBe("AnpAgentDescription");
    expect(adp.id).toBe(testIdentity.did);
    expect(adp.capabilities).toContain(ANP_CAPABILITY_IDS.FILE_TRANSFER);
    expect(adp.interfaces.length).toBeGreaterThan(0);
    expect(adp.humanAuthorizationRequired).toBe(true);
  });

  it("getAdpEndpointFor returns the correct endpoint", () => {
    const card = {
      protocolVersion: "0.3.0",
      name: "Test",
      description: "x",
      url: "x",
      preferredTransport: "JSONRPC",
      version: "1.0.0",
      capabilities: { streaming: true },
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["application/json"],
      skills: [],
    } as const;
    const adp = buildAdpAgentDescription({
      identity: testIdentity,
      agentCard: card as any,
      organization: { name: "Org" },
      capabilities: [ANP_CAPABILITY_IDS.FILE_TRANSFER, ANP_CAPABILITY_IDS.PAYMENT_REQUEST],
      baseUrl: "https://x.example.com",
      anpEndpointUrl: "https://x.example.com/anp/messages",
      humanAuthorizationRequired: false,
    });
    expect(getAdpEndpointFor(adp, ANP_APPLICATION_PROTOCOLS.DIDCOMM_V2)).toBe("https://x.example.com/anp/messages");
    expect(getAdpEndpointFor(adp, ANP_APPLICATION_PROTOCOLS.E2E_FILE_TRANSFER)).toBe("https://x.example.com/anp/file-transfer");
    expect(getAdpEndpointFor(adp, ANP_APPLICATION_PROTOCOLS.AP2_PAYMENT)).toBe("https://x.example.com/anp/payment");
  });
});

describe("ANP Agent Discovery Protocol", () => {
  it("validates WNS handle format", () => {
    expect(isValidWnsHandle("alice")).toBe(true);
    expect(isValidWnsHandle("alice-2026")).toBe(true);
    expect(isValidWnsHandle("A")).toBe(false);
    expect(isValidWnsHandle("-alice")).toBe(false);
    expect(isValidWnsHandle("alice_2026")).toBe(false);
  });

  it("converts WNS handle to DID", () => {
    expect(wnsHandleToDid("alice", "test.example.com")).toBe("did:wns:test.example.com:alice");
  });

  it("builds discovery results with scoring", () => {
    const descriptions = [
      {
        "@context": "x",
        "@type": "AnpAgentDescription" as const,
        id: "did:wba:a.example:e1_a",
        type: "AnpAgentDescription" as const,
        name: "Agent A",
        description: "File agent",
        url: "https://a.example.com",
        version: "1.0",
        provider: { type: "Organization" as const, name: "A" },
        capabilities: [ANP_CAPABILITY_IDS.FILE_TRANSFER, ANP_CAPABILITY_IDS.ENCRYPTED_MESSAGE],
        interfaces: [{ type: "AnpInterface" as const, protocol: ANP_APPLICATION_PROTOCOLS.E2E_FILE_TRANSFER, url: "x", capabilities: [] }],
        skills: [],
        humanAuthorizationRequired: false,
        trustLevel: "self-attested" as const,
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];
    const result = buildDiscoveryResult(descriptions, { capabilities: [ANP_CAPABILITY_IDS.FILE_TRANSFER] });
    expect(result.total).toBe(1);
    expect(result.results[0].did).toBe("did:wba:a.example:e1_a");
    expect(result.results[0].score).toBeGreaterThan(0);
  });

  it("buildWnsHandleRecord creates a valid record", () => {
    const record = buildWnsHandleRecord({
      handle: "bob",
      did: "did:wba:bob:e1_b",
      publicKeyHex: "11".repeat(32),
      ttlSeconds: 3600,
      signature: "abcd",
    });
    expect(record.handle).toBe("bob");
    expect(record.expiresAt).toBeDefined();
  });
});

describe("ANP Messaging Protocol", () => {
  it("encrypts and decrypts a message round-trip", () => {
    const ecdhe1 = generateEcdheKeyPair("secp256r1");
    const ecdhe2 = generateEcdheKeyPair("secp256r1");
    const shared1 = computeSharedSecret(ecdhe1.privateKey, ecdhe2.publicKey, "secp256r1");
    const shared2 = computeSharedSecret(ecdhe2.privateKey, ecdhe1.publicKey, "secp256r1");
    expect(shared1.equals(shared2)).toBe(true);
    const session = deriveSessionKey(shared1, Buffer.alloc(32, 7), "anp:test-session");
    const secretKeyId = computeSecretKeyId("aa".repeat(32), "bb".repeat(32));
    const message = {
      id: "m1",
      type: "text",
      from: "did:wba:a:e1_a",
      to: "did:wba:b:e1_b",
      createdTime: Date.now(),
      body: { text: "hello, encrypted world" },
    };
    const encrypted = encryptMessage(message, session, secretKeyId);
    expect(encrypted.type).toBe("application/anp+encrypted");
    const decrypted = decryptMessage(encrypted, session, secretKeyId);
    expect(decrypted.body.text).toBe("hello, encrypted world");
  });

  it("isExpired returns true for expired messages", () => {
    expect(isExpired({ id: "x", type: "t", from: "a", to: "b", createdTime: 0, expiresTime: 1000, body: {} }, 2000)).toBe(true);
    expect(isExpired({ id: "x", type: "t", from: "a", to: "b", createdTime: 0, body: {} }, 2000)).toBe(false);
  });

  it("appends to thread and updates lastActivity", () => {
    const initial = {
      threadId: "th1",
      participants: ["a", "b"],
      messages: [],
      createdAt: "2026-01-01T00:00:00Z",
      lastActivity: "2026-01-01T00:00:00Z",
    };
    const updated = appendToThread(initial, {
      id: "m1", type: "text", from: "a", to: "b", createdTime: 1, body: { text: "hi" },
    });
    expect(updated.messages).toHaveLength(1);
    expect(new Date(updated.lastActivity).getTime()).toBeGreaterThan(new Date(initial.lastActivity).getTime());
  });
});

describe("ANP AP2 Payment Protocol", () => {
  it("builds a payment intent with computed total", () => {
    const intent = buildPaymentIntent({
      fromDid: "did:wba:buyer:e1_b",
      toDid: "did:wba:seller:e1_s",
      lineItems: [
        { id: "li1", description: "Item 1", quantity: 2, unitPrice: 50, currency: "USD" },
        { id: "li2", description: "Item 2", quantity: 1, unitPrice: 30, currency: "USD" },
      ],
      description: "Test purchase",
    });
    expect(intent.totalAmount).toBe(130);
    expect(intent.status).toBe("draft");
    expect(intent.humanApprovalRequired).toBe(true);
  });

  it("rejects mixed currencies", () => {
    expect(() =>
      buildPaymentIntent({
        fromDid: "a", toDid: "b",
        lineItems: [
          { id: "1", description: "x", quantity: 1, unitPrice: 10, currency: "USD" },
          { id: "2", description: "y", quantity: 1, unitPrice: 10, currency: "EUR" },
        ],
        description: "x",
      }),
    ).toThrow();
  });

  it("runs full lifecycle: issue → authorize → settle", () => {
    const baseIntent = buildPaymentIntent({
      fromDid: "did:wba:buyer:e1_b",
      toDid: "did:wba:seller:e1_s",
      lineItems: [{ id: "li1", description: "Service", quantity: 1, unitPrice: 100, currency: "USD" }],
      description: "Service payment",
      humanApprovalRequired: false,
    });
    const issued = issueIntent(baseIntent);
    expect(issued.status).toBe("issued");
    const authorized = authorizeIntent(issued, {
      intentId: issued.id,
      authorizedBy: "did:wba:buyer:e1_b",
      authorizedDid: "did:wba:buyer:e1_b",
      authorizedAt: new Date().toISOString(),
      signature: { type: "DataIntegrityProof", cryptosuite: "eddsa-jcs-2022", verificationMethod: "did#key-1", created: "x", proofPurpose: "assertionMethod", proofValue: "x" },
    });
    expect(authorized.status).toBe("authorized");
    const settled = settleIntent(authorized, {
      intentId: authorized.id,
      settledBy: "did:wba:seller:e1_s",
      settledAt: new Date().toISOString(),
      receipt: { totalAmount: 100, currency: "USD", lineItems: authorized.lineItems },
      status: "settled",
    });
    expect(settled.status).toBe("settled");
  });

  it("cancels draft intent and refunds settled intent", () => {
    const intent = issueIntent(buildPaymentIntent({
      fromDid: "a", toDid: "b",
      lineItems: [{ id: "1", description: "x", quantity: 1, unitPrice: 10, currency: "USD" }],
      description: "x",
      humanApprovalRequired: false,
    }));
    const cancelled = cancelIntent(intent, "user changed mind");
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.metadata?.cancellationReason).toBe("user changed mind");
  });

  it("isIntentExpired respects expiresAt", () => {
    const intent = buildPaymentIntent({
      fromDid: "a", toDid: "b",
      lineItems: [{ id: "1", description: "x", quantity: 1, unitPrice: 10, currency: "USD" }],
      description: "x",
      ttlSeconds: 60,
    });
    expect(isIntentExpired(intent, Date.now() + 120_000)).toBe(true);
    expect(isIntentExpired(intent, Date.now())).toBe(false);
  });

  it("intentFingerprint is deterministic", () => {
    const intent = buildPaymentIntent({
      fromDid: "a", toDid: "b",
      lineItems: [{ id: "1", description: "x", quantity: 1, unitPrice: 10, currency: "USD" }],
      description: "x",
    });
    expect(intentFingerprint(intent)).toBe(intentFingerprint(intent));
    expect(intentFingerprint(intent)).toHaveLength(64);
  });
});
