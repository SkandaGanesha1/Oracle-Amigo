import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { loadConfig } from "../config.js";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function deriveKey(): Buffer {
  const cfg = loadConfig();
  // Deterministic derivation from ADMIN_KEK. For rotation: prepend a key id and re-encrypt.
  return createHash("sha256").update(`oracle-amigo.admin.kek.v1:${cfg.ADMIN_KEK}`).digest();
}

export interface EncryptedPayload {
  iv: string;
  ciphertext: string;
  tag: string;
}

export function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Compact storage format: iv.ct.tag, all base64url.
  return [
    iv.toString("base64url"),
    ct.toString("base64url"),
    tag.toString("base64url")
  ].join(".");
}

export function decryptSecret(blob: string): string {
  const parts = blob.split(".");
  if (parts.length !== 3) throw new Error("Invalid ciphertext format");
  const [ivPart, ctPart, tagPart] = parts;
  const iv = Buffer.from(ivPart, "base64url");
  const ct = Buffer.from(ctPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  if (iv.length !== IV_BYTES) throw new Error("Invalid IV length");
  if (tag.length !== TAG_BYTES) throw new Error("Invalid auth tag length");
  const key = deriveKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

export function selfTest(): boolean {
  // Used by tests to confirm the KEK is usable in this process.
  const sample = `selftest-${Date.now()}`;
  const blob = encryptSecret(sample);
  return decryptSecret(blob) === sample;
}
