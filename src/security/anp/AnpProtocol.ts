import { createPrivateKey, createPublicKey, randomBytes, randomUUID, sign, verify } from "node:crypto";
import {
  type EcdheKeyPair,
  type EncryptedPayload,
  type SessionKey,
  computeSecretKeyId,
  computeSharedSecret,
  decryptWithSessionKey,
  deriveSessionKey,
  encryptWithSessionKey,
  generateEcdheKeyPair,
} from "./AnpCrypto.js";
import { loadPrivateKeyPem, type LocalIdentity } from "../DeviceIdentity.js";

export const ANP_PROTOCOL_VERSION = "1.0";
export const ANP_META_PROTOCOL_VERSION = "1.0";
export const DEFAULT_ANP_SUITE = "TLS_AES_128_GCM_SHA256" as const;

export type AnpSuite = "TLS_AES_128_GCM_SHA256";

export interface AnpHandshakeContext {
  sessionId: string;
  ecdhe: EcdheKeyPair;
  sourceRandom: string; // hex
  destinationRandom?: string;
  sessionKey?: SessionKey;
  secretKeyId?: string;
  expiresAt: number;
}

export interface SourceHello {
  version: string;
  type: "sourceHello";
  sourceDid: string;
  sourcePublicKeyHex: string;
  metaProtocol: {
    version: string;
    supportedCapabilities: string[];
    candidateProtocols?: string[];
    protocolHash?: string;
  };
  sessionId: string;
  random: string; // hex 32 bytes
  ecdhe: {
    group: "secp256r1";
    publicKeyHex: string; // uncompressed point hex (65 bytes, starts with 04)
  };
  expires: number; // seconds
  proof: AnpProof;
}

export interface DestinationHello {
  version: string;
  type: "destinationHello";
  destinationDid: string;
  destinationPublicKeyHex: string;
  metaProtocol: {
    version: string;
    supportedCapabilities: string[];
    selectedProtocol?: string;
  };
  sessionId: string;
  random: string; // hex 32 bytes
  ecdhe: {
    group: "secp256r1";
    publicKeyHex: string;
  };
  expires: number;
  proof: AnpProof;
}

export interface FinishedMessage {
  version: string;
  type: "finished";
  sessionId: string;
  verifyData: EncryptedPayload;
  proof: AnpProof;
}

export interface AnpProof {
  type: "DataIntegrityProof";
  cryptosuite: "eddsa-jcs-2022";
  verificationMethod: string;
  created: string;
  proofPurpose: "assertionMethod";
  proofValue: string; // hex
}

export interface InitiateHandshakeInput {
  identity: LocalIdentity;
  sourceDid: string;
  destinationDid: string;
  supportedCapabilities?: string[];
  candidateProtocols?: string[];
  ttlSeconds?: number;
}

export interface RespondHandshakeInput {
  identity: LocalIdentity;
  sourceDid: string;
  destinationDid: string;
  sourceHello: SourceHello;
  supportedCapabilities?: string[];
  selectedProtocol?: string;
  ttlSeconds?: number;
}

export function initiateHandshake(input: InitiateHandshakeInput): { message: SourceHello; context: AnpHandshakeContext } {
  const ecdhe = generateEcdheKeyPair("secp256r1");
  const sessionId = randomUUID();
  const random = randomBytes(32).toString("hex");
  const expires = Math.floor(Date.now() / 1000) + (input.ttlSeconds ?? 300);
  const message: Omit<SourceHello, "proof"> = {
    version: ANP_PROTOCOL_VERSION,
    type: "sourceHello",
    sourceDid: input.sourceDid,
    sourcePublicKeyHex: input.identity.publicKey,
    metaProtocol: {
      version: ANP_META_PROTOCOL_VERSION,
      supportedCapabilities: input.supportedCapabilities ?? ["naturalLanguageProtocol", "verificationProtocol"],
      candidateProtocols: input.candidateProtocols,
    },
    sessionId,
    random,
    ecdhe: { group: "secp256r1", publicKeyHex: ecdhe.publicKey.toString("hex") },
    expires,
  };
  const proof = signAnpProof(input.identity, input.sourceDid + "#key-1", canonicalize(message), new Date().toISOString());
  const context: AnpHandshakeContext = {
    sessionId,
    ecdhe,
    sourceRandom: random,
    expiresAt: expires * 1000,
  };
  return { message: { ...message, proof }, context };
}

export function respondToHandshake(input: RespondHandshakeInput): { message: DestinationHello; context: AnpHandshakeContext } {
  const ecdhe = generateEcdheKeyPair("secp256r1");
  const random = randomBytes(32).toString("hex");
  const expires = Math.floor(Date.now() / 1000) + (input.ttlSeconds ?? 300);
  const message: Omit<DestinationHello, "proof"> = {
    version: ANP_PROTOCOL_VERSION,
    type: "destinationHello",
    destinationDid: input.destinationDid,
    destinationPublicKeyHex: input.identity.publicKey,
    metaProtocol: {
      version: ANP_META_PROTOCOL_VERSION,
      supportedCapabilities: input.supportedCapabilities ?? input.sourceHello.metaProtocol.supportedCapabilities,
      selectedProtocol: input.selectedProtocol ?? input.sourceHello.metaProtocol.candidateProtocols?.[0],
    },
    sessionId: input.sourceHello.sessionId,
    random,
    ecdhe: { group: "secp256r1", publicKeyHex: ecdhe.publicKey.toString("hex") },
    expires,
  };
  const proof = signAnpProof(input.identity, input.destinationDid + "#key-1", canonicalize(message), new Date().toISOString());
  const context: AnpHandshakeContext = {
    sessionId: input.sourceHello.sessionId,
    ecdhe,
    sourceRandom: input.sourceHello.random,
    destinationRandom: random,
    expiresAt: expires * 1000,
  };
  return { message: { ...message, proof }, context };
}

export function completeHandshakeAsInitiator(sourceCtx: AnpHandshakeContext, destinationHello: DestinationHello, identity: LocalIdentity, destinationPublicKey: string): { message: FinishedMessage; context: AnpHandshakeContext } {
  const sharedSecret = computeSharedSecret(sourceCtx.ecdhe.privateKey, Buffer.from(destinationHello.ecdhe.publicKeyHex, "hex"), "secp256r1");
  const session = deriveSessionKey(sharedSecret, Buffer.from(sourceCtx.sourceRandom + destinationHello.random, "hex"), `anp:${sourceCtx.sessionId}`);
  const secretKeyId = computeSecretKeyId(sourceCtx.sourceRandom, destinationHello.random);
  // verifyData = encrypt(secretKeyId) under the derived session key
  const verifyData = encryptWithSessionKey(secretKeyId, session, secretKeyId);
  const proofPayload = canonicalize({ sessionId: sourceCtx.sessionId, type: "finished" });
  const proof = signAnpProof(identity, identity.did + "#key-1", proofPayload, new Date().toISOString());
  return {
    message: { version: ANP_PROTOCOL_VERSION, type: "finished", sessionId: sourceCtx.sessionId, verifyData, proof },
    context: { ...sourceCtx, destinationRandom: destinationHello.random, sessionKey: session, secretKeyId },
  };
}

export function verifyFinishedAsResponder(ctx: AnpHandshakeContext, finished: FinishedMessage, identity: LocalIdentity, expectedSecretKeyId: string): { ok: true; context: AnpHandshakeContext } | { ok: false; error: string } {
  if (!ctx.sessionKey) return { ok: false, error: "No session key derived" };
  try {
    const plaintext = decryptWithSessionKey(finished.verifyData, ctx.sessionKey).toString("utf8");
    if (plaintext !== expectedSecretKeyId) return { ok: false, error: "SecretKeyId mismatch" };
    return { ok: true, context: ctx };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function verifyAnpProof(publicKeyHex: string, _verificationMethod: string, payload: string, proof: AnpProof): boolean {
  try {
    const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
    const rawKey = Buffer.from(publicKeyHex, "hex");
    const spki = Buffer.concat([spkiPrefix, rawKey]);
    const pubKey = createPublicKey({ key: spki, format: "der", type: "spki" });
    return verify(null, Buffer.from(payload, "utf8"), pubKey, Buffer.from(proof.proofValue, "hex"));
  } catch {
    return false;
  }
}

function signAnpProof(identity: LocalIdentity, verificationMethod: string, payload: string, created: string): AnpProof {
  const privPem = loadPrivateKeyPem(identity);
  const privKey = createPrivateKey(privPem);
  // Ed25519 signs data directly; pass null for the digest algorithm
  const sig = sign(null, Buffer.from(payload, "utf8"), privKey);
  return {
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod,
    created,
    proofPurpose: "assertionMethod",
    proofValue: sig.toString("hex"),
  };
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`);
  return `{${parts.join(",")}}`;
}
