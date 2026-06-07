/**
 * ANP canonical payload signing.
 *
 * Per ANP spec, handshakes bind the canonical representation of the full payload
 * (not just the nonce) so that an attacker cannot substitute fields. The canonical
 * form is RFC 8785 (JCS) flavor: recursively sorted keys, no whitespace, deterministic
 * number formatting.
 *
 * The signed canonical string is built by concatenating the listed fields in a fixed
 * order, each prefixed with its length to prevent field-boundary ambiguity.
 */
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

export type AnpCanonicalFields = {
  peer: string;
  createdAt: string;     // ISO 8601 UTC
  expiresAt: string;     // ISO 8601 UTC
  offerId: string;
  fromDid: string;
  protocol: string;      // e.g. "anp/handshake/v1"
  nonce: string;         // hex
};

const FIELD_ORDER: Array<keyof AnpCanonicalFields> = [
  "peer",
  "createdAt",
  "expiresAt",
  "offerId",
  "fromDid",
  "protocol",
  "nonce",
];

/**
 * Build the canonical string for an ANP payload. Each field is prefixed with its
 * UTF-8 byte length (as a 4-digit big-endian hex) followed by a colon, then the
 * field value bytes. This prevents field-boundary confusion attacks.
 */
export function canonicalizeAnpPayload(fields: AnpCanonicalFields): string {
  let out = "";
  for (const key of FIELD_ORDER) {
    const value = fields[key];
    if (typeof value !== "string") {
      throw new Error(`ANP canonical payload field ${key} must be a string`);
    }
    const bytes = Buffer.from(value, "utf8");
    out += bytes.length.toString(16).padStart(4, "0") + ":" + bytes.toString("utf8");
  }
  return out;
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
  const created = Date.parse(fields.createdAt);
  const expires = Date.parse(fields.expiresAt);
  if (Number.isNaN(created)) return { valid: false, reason: "invalid_createdAt" };
  if (Number.isNaN(expires)) return { valid: false, reason: "invalid_expiresAt" };
  if (expires <= created) return { valid: false, reason: "expires_before_created" };
  const nowMs = now.getTime();
  if (created > nowMs + skewSeconds * 1000) return { valid: false, reason: "createdAt_in_future" };
  if (expires < nowMs - skewSeconds * 1000) return { valid: false, reason: "expired" };
  return { valid: true };
}
