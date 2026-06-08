import { createHash, createSign, createVerify, randomUUID } from "node:crypto";
import {
  A2A_V1_PROTOCOL_VERSION,
  newServerTaskId,
  type A2Av1AgentCard,
  type A2Av1Capabilities,
  type A2Av1Interface,
  type A2Av1JwsSignature,
  type A2Av1SecurityScheme,
  type A2Av1Skill
} from "./types.js";

export function canonicalizeCard(card: Record<string, unknown>): string {
  return canonicalizeJson(stripTopLevelSignatures(card), "$");
}

export function canonicalizeJson(value: unknown, path = "$"): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`JCS canonical JSON does not support non-finite number at ${path}`);
    }
    return JSON.stringify(value);
  }
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw new Error(`JCS canonical JSON does not support ${typeof value} at ${path}`);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => canonicalizeJson(item, `${path}[${index}]`)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const members = Object.keys(obj)
      .sort(compareCodePoints)
      .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(obj[key], `${path}.${key}`)}`);
    return `{${members.join(",")}}`;
  }
  throw new Error(`JCS canonical JSON does not support value at ${path}`);
}

function stripTopLevelSignatures(card: Record<string, unknown>): Record<string, unknown> {
  if (!("signatures" in card)) return card;
  const { signatures: _signatures, ...unsigned } = card;
  return unsigned;
}

function compareCodePoints(a: string, b: string): number {
  const ac = Array.from(a);
  const bc = Array.from(b);
  const len = Math.min(ac.length, bc.length);
  for (let i = 0; i < len; i++) {
    const av = ac[i].codePointAt(0) ?? 0;
    const bv = bc[i].codePointAt(0) ?? 0;
    if (av !== bv) return av - bv;
  }
  return ac.length - bc.length;
}

function removeUndefinedObjectMembers(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(removeUndefinedObjectMembers);
  if (v && typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj)) {
      if (typeof obj[k] !== "undefined") out[k] = removeUndefinedObjectMembers(obj[k]);
    }
    return out;
  }
  return v;
}

export interface V1CardBuildContext {
  publicBaseUrl: string;
  tenant?: string;
  capabilities?: Partial<A2Av1Capabilities>;
  /** For JWS signing; if absent, card is unsigned (still spec-compliant for unsigned cards) */
  signingKey?: { privateKeyPem: string; kid: string };
}

export interface V1CardBuildInput {
  name: string;
  description?: string;
  version: string;
  organization: string;
  organizationUrl?: string;
  skills: A2Av1Skill[];
  capabilities?: Partial<A2Av1Capabilities>;
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  documentationUrl?: string;
  iconUrl?: string;
  /** Extra security schemes (merged with defaults) */
  securitySchemes?: Record<string, A2Av1SecurityScheme>;
  /** Extra security requirements */
  securityRequirements?: Array<Record<string, string[]>>;
}

/**
 * Build a complete A2A v1.0.0 Agent Card from local agent metadata.
 *
 * Spec conformance:
 *  - `supportedInterfaces` populated (HTTP+JSON preferred)
 *  - `protocolVersion: "1.0"`
 *  - `preferredTransport: "HTTP+JSON"`
 *  - `defaultInputModes` / `defaultOutputModes` populated
 *  - `tenant` for multi-tenancy
 *  - JWS signature (RS256) over the canonicalized unsigned card (RFC 7515 compact)
 */
export function buildV1AgentCard(input: V1CardBuildInput, ctx: V1CardBuildContext): A2Av1AgentCard {
  const httpInterface: A2Av1Interface = {
    url: `${ctx.publicBaseUrl}/v1`,
    protocolBinding: "HTTP+JSON",
    protocolVersion: A2A_V1_PROTOCOL_VERSION,
    tenant: ctx.tenant,
    extensions: []
  };

  const skills: A2Av1Skill[] = (input.skills ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    tags: s.tags ?? [],
    examples: s.examples,
    inputModes: s.inputModes ?? ["text/plain"],
    outputModes: s.outputModes ?? ["text/plain"],
    securityRequirements: s.securityRequirements
  }));

  const capabilities: A2Av1Capabilities = {
    streaming: ctx.capabilities?.streaming ?? true,
    pushNotifications: ctx.capabilities?.pushNotifications ?? true,
    stateTransitionHistory: ctx.capabilities?.stateTransitionHistory ?? true,
    extendedAgentCard: ctx.capabilities?.extendedAgentCard ?? true,
    extensions: ctx.capabilities?.extensions
  };

  const defaultSecuritySchemes: Record<string, A2Av1SecurityScheme> = {
    "bearer-jwt": {
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
      description: "Bearer JWT issued by the local agent"
    }
  };

  const unsigned: Omit<A2Av1AgentCard, "signatures"> = {
    protocolVersion: A2A_V1_PROTOCOL_VERSION,
    name: input.name,
    description: input.description,
    url: ctx.publicBaseUrl,
    preferredTransport: "HTTP+JSON",
    supportedInterfaces: [httpInterface],
    iconUrl: input.iconUrl,
    provider: input.organizationUrl
      ? { organization: input.organization, url: input.organizationUrl }
      : { organization: input.organization, url: ctx.publicBaseUrl },
    version: input.version,
    documentationUrl: input.documentationUrl,
    capabilities,
    securitySchemes: { ...defaultSecuritySchemes, ...(input.securitySchemes ?? {}) },
    defaultInputModes: input.defaultInputModes ?? ["text/plain", "application/json"],
    defaultOutputModes: input.defaultOutputModes ?? ["text/plain", "application/json"],
    skills,
    tenant: ctx.tenant
  };

  const cleanUnsigned = removeUndefinedObjectMembers(unsigned) as Omit<A2Av1AgentCard, "signatures">;
  if (ctx.signingKey) {
    return signCardWithRs256(cleanUnsigned, ctx.signingKey.privateKeyPem, ctx.signingKey.kid);
  }
  return { ...cleanUnsigned } as A2Av1AgentCard;
}

/**
 * Sign the canonicalized card with RS256 (RFC 7515 compact JWS).
 *
 * Per the A2A v1 spec, the protected header includes `alg`, `kid`, `typ`,
 * and the payload is the base64url(canonical JSON of the unsigned card).
 */
export function signCardWithRs256(
  unsigned: Omit<A2Av1AgentCard, "signatures">,
  privateKeyPem: string,
  kid: string
): A2Av1AgentCard {
  const unsignedCanonical = canonicalizeCard(unsigned as unknown as Record<string, unknown>);
  const payload = Buffer.from(unsignedCanonical, "utf8").toString("base64url");
  const header = { alg: "RS256", kid, typ: "JOSE" };
  const protectedHeader = Buffer.from(canonicalizeCard(header), "utf8").toString("base64url");
  const signingInput = `${protectedHeader}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKeyPem).toString("base64url");
  const sig: A2Av1JwsSignature = {
    protected: protectedHeader,
    signature,
    header
  };
  return {
    ...unsigned,
    signatures: [sig]
  };
}

/**
 * Verify a JWS-signed card. Returns the verified unsigned card or throws.
 */
export function verifySignedCard(
  card: A2Av1AgentCard,
  publicKeyPem: string
): Omit<A2Av1AgentCard, "signatures"> {
  if (!card.signatures || card.signatures.length === 0) {
    throw new Error("Card has no signatures");
  }
  const sig = card.signatures[0];

  // Reconstruct the unsigned card (strip signatures) and re-canonicalize
  const unsigned: Omit<A2Av1AgentCard, "signatures"> = { ...card };
  delete (unsigned as Partial<A2Av1AgentCard>).signatures;
  const payload = Buffer.from(canonicalizeCard(unsigned as unknown as Record<string, unknown>), "utf8").toString("base64url");
  const signingInput = `${sig.protected}.${payload}`;

  const verifier = createVerify("RSA-SHA256");
  verifier.update(signingInput);
  verifier.end();
  if (!verifier.verify(publicKeyPem, Buffer.from(sig.signature, "base64url"))) {
    throw new Error("JWS signature verification failed");
  }
  return unsigned;
}

export function cardFingerprint(
  card: A2Av1AgentCard | Omit<A2Av1AgentCard, "signatures">
): string {
  const hasSignatures = "signatures" in card && (card as A2Av1AgentCard).signatures;
  const unsigned = hasSignatures
    ? removeUndefinedObjectMembers({ ...(card as A2Av1AgentCard), signatures: undefined })
    : (card as Omit<A2Av1AgentCard, "signatures">);
  return createHash("sha256").update(canonicalizeCard(unsigned as unknown as Record<string, unknown>)).digest("hex");
}

export { newServerTaskId, randomUUID };
