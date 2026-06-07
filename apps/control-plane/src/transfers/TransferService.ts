import { createHash, randomUUID } from "node:crypto";
import type { Database as DB } from "better-sqlite3";
import { getDb } from "./../db/connection.js";
import { appendAuditEvent } from "./../audit/CloudAuditService.js";
import {
  createEncryptionParams, deleteTransferFiles, readDecryptedTransfer,
  transferStorePath, writeEncryptedTransfer
} from "./TransferStorage.js";
import { loadConfig } from "./../config.js";
import type { AgentInstanceId, OrgId, TransferId } from "./../types/cloud.js";
import type { TransferEncryptionParams } from "./TransferStorage.js";

export interface InitTransferInput {
  orgId: OrgId;
  fromAgentInstanceId: AgentInstanceId;
  toAgentInstanceId: AgentInstanceId;
  fileName: string;
  fileSize: number;
  sha256: string;
  relayTaskId?: string;
}

export interface InitTransferResult {
  transfer_id: TransferId;
  upload_url: string;
  download_url: string;
  receipt_url: string;
  expires_at: string;
  encryption_algo: string;
  aad_hex: string;
}

export function initTransfer(
  input: InitTransferInput,
  publicBaseUrl: string,
  opts: { db?: DB } = {}
): InitTransferResult {
  const db = opts.db ?? getDb();
  const cfg = loadConfig();
  // Sanity checks
  if (!input.fileName.trim()) throw new Error("file_name is required");
  if (input.fileName.includes("/") || input.fileName.includes("\\") || input.fileName.includes("..")) {
    throw new Error("Invalid file_name");
  }
  if (input.fileSize <= 0) throw new Error("file_size must be positive");
  if (input.fileSize > cfg.TRANSFER_MAX_FILE_SIZE_BYTES) {
    throw new Error(`File exceeds maximum size of ${cfg.TRANSFER_MAX_FILE_SIZE_BYTES} bytes`);
  }
  if (!/^[a-fA-F0-9]{64}$/.test(input.sha256)) throw new Error("sha256 must be a 64-character hex string");
  // Both agent instances must be active and in same org
  const fromRow = db.prepare("SELECT id, status FROM agent_instances WHERE org_id = ? AND id = ?")
    .get(input.orgId, input.fromAgentInstanceId) as { id: string; status: string } | undefined;
  if (!fromRow) throw new Error("From agent instance not found");
  if (fromRow.status !== "active") throw new Error("From agent instance is not active");
  const toRow = db.prepare("SELECT id, status FROM agent_instances WHERE org_id = ? AND id = ?")
    .get(input.orgId, input.toAgentInstanceId) as { id: string; status: string } | undefined;
  if (!toRow) throw new Error("To agent instance not found");
  if (toRow.status !== "active") throw new Error("To agent instance is not active");

  const transferId = `xfr_${randomUUID()}`;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + cfg.TRANSFER_TTL_SECONDS * 1000).toISOString();
  const params = createEncryptionParams(transferId, input.fileName, input.sha256);
  const aadHex = params.aad.toString("hex");
  // Pre-create the storage path placeholder (will be filled on upload)
  db.prepare(`
    INSERT INTO file_transfers (id, org_id, relay_task_id, from_agent_instance_id, to_agent_instance_id, file_name, file_size, sha256, storage_path, encryption_algo, status, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'initialized', ?, ?)
  `).run(
    transferId, input.orgId, input.relayTaskId ?? null, input.fromAgentInstanceId, input.toAgentInstanceId,
    input.fileName, input.fileSize, input.sha256.toLowerCase(),
    transferStorePath(transferId) + ".enc",
    params.algo, expiresAt, now
  );
  // Store encryption params reference in transfer_encryption_keys (server-side only)
  db.prepare(`
    INSERT INTO transfer_encryption_keys (id, transfer_id, org_id, wrapped_key, iv, aad, algo, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `tek_${randomUUID()}`, transferId, input.orgId,
    params.key.toString("hex"), params.iv.toString("hex"), aadHex, params.algo, now
  );
  appendAuditEvent({
    orgId: input.orgId,
    actorAgentInstanceId: input.fromAgentInstanceId,
    eventType: "TRANSFER_INITIALIZED",
    details: {
      transfer_id: transferId, to_agent_instance_id: input.toAgentInstanceId,
      file_name: input.fileName, file_size: input.fileSize, sha256: input.sha256
    }
  }, db);
  return {
    transfer_id: transferId,
    upload_url: `${publicBaseUrl}/v1/transfers/${transferId}/upload`,
    download_url: `${publicBaseUrl}/v1/transfers/${transferId}/download`,
    receipt_url: `${publicBaseUrl}/v1/transfers/${transferId}/receipt`,
    expires_at: expiresAt,
    encryption_algo: params.algo,
    aad_hex: aadHex
  };
}

export function uploadTransfer(
  orgId: OrgId,
  transferId: TransferId,
  fromAgentInstanceId: AgentInstanceId,
  data: Buffer
): { ok: true; status: "ready" } {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM file_transfers WHERE org_id = ? AND id = ?
  `).get(orgId, transferId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("Transfer not found");
  if (String(row.from_agent_instance_id) !== fromAgentInstanceId) {
    throw new Error("Not authorized to upload this transfer");
  }
  if (String(row.status) !== "initialized") {
    throw new Error(`Transfer is in state ${row.status}, cannot upload`);
  }
  const expiresAt = new Date(String(row.expires_at)).getTime();
  if (expiresAt < Date.now()) throw new Error("Transfer has expired");
  // Compute hash
  const actualSha = createHash("sha256").update(data).digest("hex");
  if (actualSha !== String(row.sha256)) {
    throw new Error(`SHA-256 mismatch: expected ${row.sha256}, got ${actualSha}`);
  }
  if (data.length !== Number(row.file_size)) {
    throw new Error(`Size mismatch: expected ${row.file_size}, got ${data.length}`);
  }
  // Get encryption params
  const keyRow = db.prepare("SELECT * FROM transfer_encryption_keys WHERE transfer_id = ?").get(transferId) as
    Record<string, unknown> | undefined;
  if (!keyRow) throw new Error("Encryption key not found for transfer");
  const params: TransferEncryptionParams = {
    key: Buffer.from(String(keyRow.wrapped_key), "hex"),
    iv: Buffer.from(String(keyRow.iv), "hex"),
    aad: Buffer.from(String(keyRow.aad), "hex"),
    algo: "AES-256-GCM"
  };
  writeEncryptedTransfer(transferId, data, params);
  db.prepare("UPDATE file_transfers SET status = 'ready' WHERE id = ?").run(transferId);
  appendAuditEvent({
    orgId, actorAgentInstanceId: fromAgentInstanceId, eventType: "TRANSFER_UPLOADED",
    details: { transfer_id: transferId, file_size: data.length, sha256: actualSha }
  }, db);
  return { ok: true, status: "ready" };
}

export function downloadTransfer(
  orgId: OrgId,
  transferId: TransferId,
  toAgentInstanceId: AgentInstanceId
): { data: Buffer; fileName: string; sha256: string; fileSize: number } {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM file_transfers WHERE org_id = ? AND id = ?
  `).get(orgId, transferId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("Transfer not found");
  if (String(row.to_agent_instance_id) !== toAgentInstanceId) {
    throw new Error("Not authorized to download this transfer");
  }
  if (String(row.status) !== "ready" && String(row.status) !== "downloading" && String(row.status) !== "completed") {
    throw new Error(`Transfer is in state ${row.status}, cannot download`);
  }
  const expiresAt = new Date(String(row.expires_at)).getTime();
  if (expiresAt < Date.now()) throw new Error("Transfer has expired");
  const { data } = readDecryptedTransfer(
    transferId,
    String(row.file_name),
    String(row.sha256)
  );
  // Verify hash on download
  const actualSha = createHash("sha256").update(data).digest("hex");
  if (actualSha !== String(row.sha256)) {
    throw new Error("Transfer integrity check failed - SHA-256 mismatch after decryption");
  }
  db.prepare("UPDATE file_transfers SET status = 'downloading' WHERE id = ? AND status = 'ready'").run(transferId);
  return {
    data,
    fileName: String(row.file_name),
    sha256: actualSha,
    fileSize: data.length
  };
}

export function recordTransferReceipt(
  orgId: OrgId,
  transferId: TransferId,
  toAgentInstanceId: AgentInstanceId,
  receipt: { stored_path: string; verified_sha256: string }
): { ok: true; status: "completed" } {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM file_transfers WHERE org_id = ? AND id = ?
  `).get(orgId, transferId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("Transfer not found");
  if (String(row.to_agent_instance_id) !== toAgentInstanceId) {
    throw new Error("Not authorized to record receipt for this transfer");
  }
  if (String(row.sha256) !== receipt.verified_sha256.toLowerCase()) {
    throw new Error("Receipt SHA-256 does not match transfer hash");
  }
  const now = new Date().toISOString();
  db.prepare("UPDATE file_transfers SET status = 'completed', completed_at = ? WHERE id = ?").run(now, transferId);
  appendAuditEvent({
    orgId, actorAgentInstanceId: toAgentInstanceId, eventType: "TRANSFER_RECEIPT",
    details: {
      transfer_id: transferId, stored_path: receipt.stored_path,
      verified_sha256: receipt.verified_sha256
    }
  }, db);
  return { ok: true, status: "completed" };
}

export function expireOldTransfers(db: DB = getDb()): number {
  const now = new Date().toISOString();
  const rows = db.prepare(`
    SELECT id, file_name, sha256 FROM file_transfers
    WHERE status IN ('initialized', 'ready', 'uploading', 'downloading') AND expires_at < ?
  `).all(now) as Array<{ id: string; file_name: string; sha256: string }>;
  for (const r of rows) {
    try { deleteTransferFiles(r.id); } catch { /* ignore */ }
    db.prepare("UPDATE file_transfers SET status = 'expired' WHERE id = ?").run(r.id);
  }
  return rows.length;
}
