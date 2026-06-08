/**
 * ANP canonical payload signing.
 *
 * Per ANP spec, handshakes bind the canonical representation of the full payload
 * (not just the nonce) so that an attacker cannot substitute fields. The canonical
 * form is RFC 8785 (JCS) flavor: recursively sorted keys, no whitespace, deterministic
 * number formatting.
 *
 */
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

export type AnpCanonicalFields = {
  protocol: string;
  offer_id: string;
  from_agent_id: string;
  from_agent_instance_id: string;
  from_did: string;
  to_peer: string;
  nonce: string;
  created_at: string;
  expires_at: string;
};

/**
 * Build RFC 8785-style canonical JSON for the signed ANP handshake payload.
 */
export function canonicalizeAnpPayload(fields: AnpCanonicalFields): string {
  const normalized = normalizeAnpPayload(fields);
  for (const [key, value] of Object.entries(normalized)) {
    if (typeof value !== "string") throw new Error(`ANP canonical payload field ${key} must be a string`);
  }
  return canonicalJson(normalized);
}

/** SHA-256 of the canonical string. */
export function anpPayloadFingerprint(fields: AnpCanonicalFields): string {
  return createHash("sha256").update(canonicalizeAnpPayload(fields), "utf8").digest("hex");
}

export function signAnpPayload(fields: AnpCanonicalFields, privateKeyPem: string): string {
  const privKey = createPrivateKey(privateKeyPem);
  const canonical = canonicalizeAnpPayload(fields);
  const sig = sign(null, Buffer.from(canonical, "utf8"), privKey);
  return sig.toString("hex");
}

export function verifyAnpPayload(
  fields: AnpCanonicalFields,
  signatureHex: string,
  publicKeyPemOrHex: string,
): boolean {
  try {
    const pubKey = resolvePublicKey(publicKeyPemOrHex);
    const canonical = canonicalizeAnpPayload(fields);
    return verify(null, Buffer.from(canonical, "utf8"), pubKey, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

function resolvePublicKey(pemOrHex: string) {
  if (pemOrHex.includes("BEGIN")) {
    return createPublicKey(pemOrHex);
  }
  // hex-encoded Ed25519 public key → wrap in SPKI DER
  const rawKey = Buffer.from(pemOrHex, "hex");
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  return createPublicKey({ key: Buffer.concat([spkiPrefix, rawKey]), format: "der", type: "spki" });
}

/** Expiry / creation-time validation. */
export function validateAnpTiming(
  fields: AnpCanonicalFields,
  now: Date = new Date(),
  skewSeconds = 30,
): { valid: boolean; reason?: string } {
  const normalized = normalizeAnpPayload(fields);
  const created = Date.parse(normalized.created_at);
  const expires = Date.parse(normalized.expires_at);
  if (Number.isNaN(created)) return { valid: false, reason: "invalid_created_at" };
  if (Number.isNaN(expires)) return { valid: false, reason: "invalid_expires_at" };
  if (expires <= created) return { valid: false, reason: "expires_before_created" };
  const nowMs = now.getTime();
  if (created > nowMs + skewSeconds * 1000) return { valid: false, reason: "created_at_in_future" };
  if (expires < nowMs - skewSeconds * 1000) return { valid: false, reason: "expired" };
  return { valid: true };
}

export function normalizeAnpPayload(fields: AnpCanonicalFields): AnpCanonicalFields {
  return {
    protocol: fields.protocol,
    offer_id: fields.offer_id,
    from_agent_id: fields.from_agent_id,
    from_agent_instance_id: fields.from_agent_instance_id,
    from_did: fields.from_did,
    to_peer: fields.to_peer,
    nonce: fields.nonce,
    created_at: fields.created_at,
    expires_at: fields.expires_at
  };
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((key) => obj[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
