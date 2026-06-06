import { createHash, createPublicKey } from "node:crypto";

export interface DidWbaInput {
  domain: string;
  port?: number;
  publicKeyHex: string; // 32-byte Ed25519 public key in hex
}

export interface DidWbaIdentity {
  did: string;
  didDocument: DidDocument;
}

export interface DidDocument {
  "@context": string[];
  id: string;
  verificationMethod: VerificationMethod[];
  authentication: string[];
  keyAgreement: string[];
  service: ServiceEndpoint[];
  proof?: DataIntegrityProof;
}

export interface VerificationMethod {
  id: string;
  type: "Ed25519VerificationKey2020" | "Multikey";
  controller: string;
  publicKeyMultibase?: string;
  publicKeyHex?: string;
}

export interface ServiceEndpoint {
  id: string;
  type: "AgentDescription" | "ANPMessageService" | "ANPHandleService";
  serviceEndpoint: string;
  serviceDid?: string;
}

export interface DataIntegrityProof {
  type: "DataIntegrityProof";
  cryptosuite: "eddsa-jcs-2022";
  verificationMethod: string;
  created: string;
  proofPurpose: "assertionMethod";
  proofValue: string;
}

const E1_PREFIX = "e1_";
const MULTIBASE_ED25519_PREFIX = "z6Mk";

export function buildDidWba(input: DidWbaInput): DidWbaIdentity {
  const thumbprint = computeJwkThumbprintEd25519(input.publicKeyHex);
  const hostPart = input.port ? `${input.domain}%3A${input.port}` : input.domain;
  const did = `did:wba:${hostPart}:${E1_PREFIX}${thumbprint}`;
  return { did, didDocument: buildDidDocument(did, input.publicKeyHex, input.domain, input.port) };
}

export function buildDidDocument(did: string, publicKeyHex: string, domain: string, port?: number): DidDocument {
  const keyId = `${did}#key-1`;
  const scheme = port ? `http://${domain}:${port}` : `http://${domain}`;
  return {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/suites/eddsa-2022/v1",
    ],
    id: did,
    verificationMethod: [
      {
        id: keyId,
        type: "Ed25519VerificationKey2020",
        controller: did,
        publicKeyMultibase: `${MULTIBASE_ED25519_PREFIX}${publicKeyHex}`,
        publicKeyHex,
      },
    ],
    authentication: [keyId],
    keyAgreement: [keyId],
    service: [
      {
        id: `${did}#agent-description`,
        type: "AgentDescription",
        serviceEndpoint: `${scheme}/.well-known/agent-description.json`,
      },
      {
        id: `${did}#messaging`,
        type: "ANPMessageService",
        serviceEndpoint: `${scheme}/anp/message`,
      },
    ],
  };
}

export function computeJwkThumbprintEd25519(publicKeyHex: string): string {
  // RFC 7638 JWK thumbprint for Ed25519: lexicographically-ordered JSON of {crv, kty, x, y? actually for OKP it's {crv, kty, x}}
  // Ed25519 raw 32-byte key is the 'x' value, base64url-encoded (no padding)
  const x = base64UrlEncode(Buffer.from(publicKeyHex, "hex"));
  const jwk = { crv: "Ed25519", kty: "OKP", x };
  const canonical = canonicalizeJson(jwk);
  return createHash("sha256").update(canonical).digest("hex");
}

export function verifyThumbprint(publicKeyHex: string, thumbprint: string): boolean {
  return computeJwkThumbprintEd25519(publicKeyHex) === thumbprint.toLowerCase();
}

export function parseDidWba(did: string): { domain: string; port?: number; thumbprint: string } | null {
  // Format: did:wba:<hostPart>:e1_<64hex>
  // <hostPart> is either "domain" or "domain%3Aport" (percent-encoded port)
  const match = did.match(/^did:wba:([^:]+):e1_([0-9a-f]{64})$/i);
  if (!match) return null;
  const hostPart = decodeURIComponent(match[1]);
  const portMatch = hostPart.match(/^(.+):(\d+)$/);
  const domain = portMatch ? portMatch[1] : hostPart;
  const port = portMatch ? Number(portMatch[2]) : undefined;
  return { domain, port, thumbprint: match[2].toLowerCase() };
}

export function publicKeyFromMultibase(multibase: string): Buffer {
  if (!multibase.startsWith(MULTIBASE_ED25519_PREFIX)) {
    throw new Error(`Unsupported multibase prefix: ${multibase.slice(0, 4)}`);
  }
  return Buffer.from(multibase.slice(MULTIBASE_ED25519_PREFIX.length), "hex");
}

export function publicKeyToMultibase(publicKeyHex: string): string {
  return `${MULTIBASE_ED25519_PREFIX}${publicKeyHex}`;
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson((value as Record<string, unknown>)[k])}`);
  return `{${parts.join(",")}}`;
}

export function spkiFromPublicKeyHex(publicKeyHex: string): Buffer {
  // 32-byte Ed25519 raw public key -> DER-encoded SubjectPublicKeyInfo
  const rawKey = Buffer.from(publicKeyHex, "hex");
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  return Buffer.concat([spkiPrefix, rawKey]);
}

export function loadPublicKeyFromHex(publicKeyHex: string) {
  return createPublicKey({ key: spkiFromPublicKeyHex(publicKeyHex), format: "der", type: "spki" });
}
