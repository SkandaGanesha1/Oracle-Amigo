import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, unlinkSync, createReadStream } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, createHash, createHmac, type CipherGCM, type DecipherGCM } from "node:crypto";
import { loadConfig } from "./../config.js";

const ENCRYPTION_ALGO = "AES-256-GCM";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

export interface TransferEncryptionParams {
  key: Buffer;
  iv: Buffer;
  aad: Buffer;
  algo: typeof ENCRYPTION_ALGO;
}

export function deriveTransferKey(transferId: string, fileName: string, sha256: string): Buffer {
  // Derive a per-transfer key from server secret + transfer context using HMAC-SHA256
  const cfg = loadConfig();
  const serverSecret = cfg.JWT_ACCESS_SECRET;
  return createHmac("sha256", serverSecret)
    .update(`transfer-key-v1|${transferId}|${fileName}|${sha256}`)
    .digest();
}

export function createEncryptionParams(
  transferId: string,
  fileName: string,
  sha256: string
): TransferEncryptionParams {
  const key = deriveTransferKey(transferId, fileName, sha256);
  const iv = randomBytes(IV_LENGTH);
  const aad = createHash("sha256")
    .update(`${transferId}|${fileName}|${sha256}|${ENCRYPTION_ALGO}`)
    .digest();
  return { key, iv, aad, algo: ENCRYPTION_ALGO };
}

export function encryptBuffer(
  data: Buffer,
  params: TransferEncryptionParams
): { ciphertext: Buffer; tag: Buffer } {
  const cipher = createCipheriv(ENCRYPTION_ALGO, params.key, params.iv) as CipherGCM;
  cipher.setAAD(params.aad);
  const enc = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: enc, tag };
}

export function decryptBuffer(
  ciphertext: Buffer,
  tag: Buffer,
  params: TransferEncryptionParams
): Buffer {
  const decipher = createDecipheriv(ENCRYPTION_ALGO, params.key, params.iv) as DecipherGCM;
  decipher.setAAD(params.aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function resolveTransferStoreDir(): string {
  const cfg = loadConfig();
  return resolve(process.cwd(), cfg.FILE_TRANSFER_STORE);
}

export function transferStorePath(transferId: string): string {
  const dir = resolveTransferStoreDir();
  // Sanitize transferId to prevent path traversal
  const safeId = transferId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(dir, safeId);
}

export function ensureTransferDir(): string {
  const dir = resolveTransferStoreDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeEncryptedTransfer(transferId: string, data: Buffer, params: TransferEncryptionParams): string {
  const dir = ensureTransferDir();
  const path = transferStorePath(transferId);
  const { ciphertext, tag } = encryptBuffer(data, params);
  // Layout: [magic "OAT1" (4 bytes)] [iv (12 bytes)] [aad_len (4 bytes)] [aad (N bytes)] [tag (16 bytes)] [ciphertext]
  const magic = Buffer.from("OAT1", "utf8");
  const aad = params.aad;
  const aadLen = Buffer.alloc(4);
  aadLen.writeUInt32BE(aad.length, 0);
  const fullPath = `${path}.enc`;
  writeFileSync(fullPath, Buffer.concat([magic, params.iv, aadLen, aad, tag, ciphertext]));
  // Also write a sidecar JSON with metadata (NO key)
  const meta = {
    transfer_id: transferId,
    algo: params.algo,
    iv_length: IV_LENGTH,
    aad_length: aad.length,
    tag_length: 16,
    created_at: new Date().toISOString(),
    file_size: data.length,
    ciphertext_size: ciphertext.length
  };
  writeFileSync(`${path}.meta.json`, JSON.stringify(meta, null, 2));
  return fullPath;
}

export interface DecryptedTransfer {
  data: Buffer;
  fileSize: number;
  params: TransferEncryptionParams;
}

export function readDecryptedTransfer(
  transferId: string,
  fileName: string,
  sha256: string
): DecryptedTransfer {
  const path = transferStorePath(transferId);
  const encPath = `${path}.enc`;
  if (!existsSync(encPath)) throw new Error("Transfer not found");
  const blob = readFileSync(encPath);
  // Parse header
  if (blob.length < 4 + 12 + 4) throw new Error("Invalid transfer blob");
  const magic = blob.subarray(0, 4).toString("utf8");
  if (magic !== "OAT1") throw new Error("Invalid transfer magic");
  let offset = 4;
  const iv = Buffer.from(blob.subarray(offset, offset + 12));
  offset += 12;
  const aadLen = blob.readUInt32BE(offset);
  offset += 4;
  const aad = Buffer.from(blob.subarray(offset, offset + aadLen));
  offset += aadLen;
  const tag = Buffer.from(blob.subarray(offset, offset + 16));
  offset += 16;
  const ciphertext = Buffer.from(blob.subarray(offset));
  const key = deriveTransferKey(transferId, fileName, sha256);
  if (!aad.equals(createHash("sha256").update(`${transferId}|${fileName}|${sha256}|${ENCRYPTION_ALGO}`).digest())) {
    throw new Error("AAD mismatch - cannot decrypt");
  }
  const data = decryptBuffer(ciphertext, tag, { key, iv, aad, algo: ENCRYPTION_ALGO });
  return { data, fileSize: data.length, params: { key, iv, aad, algo: ENCRYPTION_ALGO } };
}

export function deleteTransferFiles(transferId: string): void {
  const path = transferStorePath(transferId);
  for (const ext of [".enc", ".meta.json"]) {
    const p = `${path}${ext}`;
    try { if (existsSync(p)) unlinkSync(p); } catch { /* ignore */ }
  }
}

export function getTransferFileSize(transferId: string): number | null {
  const path = transferStorePath(transferId) + ".enc";
  try { return statSync(path).size; } catch { return null; }
}

export function readTransferRange(
  transferId: string,
  start: number,
  end: number
): { stream: NodeJS.ReadableStream; totalSize: number } {
  const path = transferStorePath(transferId) + ".enc";
  const size = statSync(path).size;
  const stream = createReadStream(path, { start, end });
  return { stream, totalSize: size };
}
