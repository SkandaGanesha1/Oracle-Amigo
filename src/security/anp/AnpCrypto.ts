import { createCipheriv, createDecipheriv, createECDH, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Node's createECDH accepts the OpenSSL alias. secp256r1 == prime256v1.
function opensslCurve(curve: "secp256r1"): "prime256v1" {
  return "prime256v1";
}

export type AnpCurve = "secp256r1";

export interface EcdheKeyPair {
  privateKey: Buffer;
  publicKey: Buffer; // uncompressed point format (65 bytes, starts with 0x04)
}

export function generateEcdheKeyPair(curve: AnpCurve = "secp256r1"): EcdheKeyPair {
  const ecdh = createECDH(opensslCurve(curve));
  ecdh.generateKeys();
  return { privateKey: ecdh.getPrivateKey(), publicKey: ecdh.getPublicKey() };
}

export function computeSharedSecret(localPrivateKey: Buffer, remotePublicKey: Buffer, curve: AnpCurve = "secp256r1"): Buffer {
  const ecdh = createECDH(opensslCurve(curve));
  ecdh.setPrivateKey(localPrivateKey);
  return ecdh.computeSecret(remotePublicKey);
}

/**
 * HKDF-SHA256: extract+expand as defined in RFC 5869.
 * Returns the first `length` bytes of OKM.
 */
export function hkdfSha256(secret: Buffer, salt: Buffer, info: Buffer, length: number): Buffer {
  const actualSalt = salt.length === 0 ? Buffer.alloc(32) : salt;
  const prk = hmacSha256(actualSalt, secret);
  let previous = Buffer.alloc(0);
  const outputs: Buffer[] = [];
  let counter = 1;
  while (Buffer.concat(outputs).length < length) {
    const input = Buffer.concat([previous, info, Buffer.from([counter++])]);
    previous = hmacSha256(prk, input);
    outputs.push(previous);
  }
  return Buffer.concat(outputs).subarray(0, length);
}

function hmacSha256(key: Buffer, data: Buffer): Buffer<ArrayBuffer> {
  return createHmac("sha256", key).update(data).digest() as Buffer<ArrayBuffer>;
}

export interface SessionKey {
  key: Buffer; // 16 bytes for AES-128
  iv: Buffer; // 12 bytes
}

export function deriveSessionKey(sharedSecret: Buffer, nonce: Buffer, info: string, keyLength = 16): SessionKey {
  const fullKey = hkdfSha256(sharedSecret, Buffer.alloc(0), Buffer.from(info, "utf8"), keyLength + 12);
  return { key: fullKey.subarray(0, keyLength), iv: fullKey.subarray(keyLength, keyLength + 12) };
}

export interface EncryptedPayload {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64 (16 bytes)
  secretKeyId: string; // SHA-256 of (sourceHello.random + destinationHello.random), hex
}

export function encryptWithSessionKey(plaintext: string | Buffer, session: SessionKey, secretKeyId: string, aad?: Buffer): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-128-gcm", session.key, iv);
  if (aad) cipher.setAAD(aad);
  const input = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;
  const enc = Buffer.concat([cipher.update(input), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: enc.toString("base64"), iv: iv.toString("base64"), tag: tag.toString("base64"), secretKeyId };
}

export function decryptWithSessionKey(payload: EncryptedPayload, session: SessionKey, aad?: Buffer): Buffer {
  const decipher = createDecipheriv("aes-128-gcm", session.key, Buffer.from(payload.iv, "base64"));
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64")), decipher.final()]);
}

export function decryptWithSessionKeyAsString(payload: EncryptedPayload, session: SessionKey, aad?: Buffer): string {
  return decryptWithSessionKey(payload, session, aad).toString("utf8");
}

/**
 * Compute secretKeyId as SHA-256(sourceHelloRandom || destinationHelloRandom), hex.
 */
export function computeSecretKeyId(sourceRandom: string, destinationRandom: string): string {
  const h = createHmac("sha256", Buffer.alloc(0));
  h.update(sourceRandom);
  h.update(destinationRandom);
  return h.digest("hex");
}

/**
 * Constant-time comparison helper.
 */
export function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
