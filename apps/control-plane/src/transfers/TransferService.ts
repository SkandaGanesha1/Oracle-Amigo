import { createHash, randomUUID } from "node:crypto";
import { getControlPlaneStore } from "./../db/connection.js";
import type { ControlPlaneStore } from "./../db/ControlPlaneStore.js";
import { appendAuditEvent } from "./../audit/CloudAuditService.js";
import {
  createEncryptionParams,
  deleteTransferFiles,
  readDecryptedTransfer,
  transferStorePath,
  unwrapTransferKey,
  wrapTransferKey,
  writeEncryptedTransfer
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

export async function initTransfer(
  input: InitTransferInput,
  publicBaseUrl: string,
  opts: { store?: ControlPlaneStore } = {}
): Promise<InitTransferResult> {
  const store = opts.store ?? getControlPlaneStore();
  const cfg = loadConfig();
  if (!input.fileName.trim()) throw new Error("file_name is required");
  if (input.fileName.includes("/") || input.fileName.includes("\\") || input.fileName.includes("..")) {
    throw new Error("Invalid file_name");
  }
  if (input.fileSize <= 0) throw new Error("file_size must be positive");
  if (input.fileSize > cfg.TRANSFER_MAX_FILE_SIZE_BYTES) {
    throw new Error(`File exceeds maximum size of ${cfg.TRANSFER_MAX_FILE_SIZE_BYTES} bytes`);
  }
  if (!/^[a-fA-F0-9]{64}$/.test(input.sha256)) throw new Error("sha256 must be a 64-character hex string");

  const fromRow = await store.one<{ id: string; status: string }>(
    "SELECT id, status FROM agent_instances WHERE org_id = $1 AND id = $2",
    [input.orgId, input.fromAgentInstanceId]
  );
  if (!fromRow) throw new Error("From agent instance not found");
  if (fromRow.status !== "active") throw new Error("From agent instance is not active");

  const toRow = await store.one<{ id: string; status: string }>(
    "SELECT id, status FROM agent_instances WHERE org_id = $1 AND id = $2",
    [input.orgId, input.toAgentInstanceId]
  );
  if (!toRow) throw new Error("To agent instance not found");
  if (toRow.status !== "active") throw new Error("To agent instance is not active");

  const transferId = `xfr_${randomUUID()}` as TransferId;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + cfg.TRANSFER_TTL_SECONDS * 1000).toISOString();
  const params = createEncryptionParams(transferId, input.fileName, input.sha256);
  const aadHex = params.aad.toString("hex");

  await store.transaction(async (tx) => {
    await tx.execute(`
      INSERT INTO file_transfers (id, org_id, relay_task_id, from_agent_instance_id, to_agent_instance_id, file_name, file_size, sha256, storage_path, encryption_algo, status, expires_at, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'initialized', $11, $12)
    `, [
      transferId,
      input.orgId,
      input.relayTaskId ?? null,
      input.fromAgentInstanceId,
      input.toAgentInstanceId,
      input.fileName,
      input.fileSize,
      input.sha256.toLowerCase(),
      transferStorePath(transferId) + ".enc",
      params.algo,
      expiresAt,
      now
    ]);
    await tx.execute(`
      INSERT INTO transfer_encryption_keys (id, transfer_id, org_id, wrapped_key, iv, aad, algo, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      `tek_${randomUUID()}`,
      transferId,
      input.orgId,
      wrapTransferKey(params.key, transferId),
      params.iv.toString("hex"),
      aadHex,
      params.algo,
      now
    ]);
    await appendAuditEvent({
      orgId: input.orgId,
      actorAgentInstanceId: input.fromAgentInstanceId,
      eventType: "TRANSFER_INITIALIZED",
      details: {
        transfer_id: transferId,
        to_agent_instance_id: input.toAgentInstanceId,
        file_name: input.fileName,
        file_size: input.fileSize,
        sha256: input.sha256
      }
    }, tx);
  });

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

export async function uploadTransfer(
  orgId: OrgId,
  transferId: TransferId,
  fromAgentInstanceId: AgentInstanceId,
  data: Buffer,
  store: ControlPlaneStore = getControlPlaneStore()
): Promise<{ ok: true; status: "ready" }> {
  return await store.transaction(async (tx) => {
    const claimed = await tx.execute(`
      UPDATE file_transfers
      SET status = 'uploading'
      WHERE org_id = $1 AND id = $2 AND from_agent_instance_id = $3 AND status = 'initialized'
    `, [orgId, transferId, fromAgentInstanceId]);
    if (claimed.changes !== 1) {
      const current = await tx.one<{ status: string; from_agent_instance_id: string }>(
        "SELECT status, from_agent_instance_id FROM file_transfers WHERE org_id = $1 AND id = $2",
        [orgId, transferId]
      );
      if (!current) throw new Error("Transfer not found");
      if (current.from_agent_instance_id !== fromAgentInstanceId) throw new Error("Not authorized to upload this transfer");
      throw new Error(`Transfer is in state ${current.status}, cannot upload`);
    }

    const row = await tx.one<Record<string, unknown>>(
      "SELECT * FROM file_transfers WHERE org_id = $1 AND id = $2",
      [orgId, transferId]
    );
    if (!row) throw new Error("Transfer not found");
    const expiresAt = new Date(String(row.expires_at)).getTime();
    if (expiresAt < Date.now()) throw new Error("Transfer has expired");
    const actualSha = createHash("sha256").update(data).digest("hex");
    if (actualSha !== String(row.sha256)) {
      throw new Error(`SHA-256 mismatch: expected ${row.sha256}, got ${actualSha}`);
    }
    if (data.length !== Number(row.file_size)) {
      throw new Error(`Size mismatch: expected ${row.file_size}, got ${data.length}`);
    }
    const keyRow = await tx.one<Record<string, unknown>>(
      "SELECT * FROM transfer_encryption_keys WHERE org_id = $1 AND transfer_id = $2",
      [orgId, transferId]
    );
    if (!keyRow) throw new Error("Encryption key not found for transfer");
    const params: TransferEncryptionParams = {
      key: unwrapTransferKey(String(keyRow.wrapped_key), transferId),
      iv: Buffer.from(String(keyRow.iv), "hex"),
      aad: Buffer.from(String(keyRow.aad), "hex"),
      algo: "AES-256-GCM"
    };
    writeEncryptedTransfer(transferId, data, params);
    const ready = await tx.execute(`
      UPDATE file_transfers SET status = 'ready'
      WHERE org_id = $1 AND id = $2 AND status = 'uploading'
    `, [orgId, transferId]);
    if (ready.changes !== 1) throw new Error("Transfer upload state changed unexpectedly");
    await appendAuditEvent({
      orgId,
      actorAgentInstanceId: fromAgentInstanceId,
      eventType: "TRANSFER_UPLOADED",
      details: { transfer_id: transferId, file_size: data.length, sha256: actualSha }
    }, tx);
    return { ok: true as const, status: "ready" as const };
  });
}

export async function downloadTransfer(
  orgId: OrgId,
  transferId: TransferId,
  toAgentInstanceId: AgentInstanceId,
  store: ControlPlaneStore = getControlPlaneStore()
): Promise<{ data: Buffer; fileName: string; sha256: string; fileSize: number }> {
  const row = await store.one<Record<string, unknown>>(
    "SELECT * FROM file_transfers WHERE org_id = $1 AND id = $2",
    [orgId, transferId]
  );
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
    String(row.sha256),
    await getTransferDecryptionKey(store, orgId, transferId)
  );
  const actualSha = createHash("sha256").update(data).digest("hex");
  if (actualSha !== String(row.sha256)) {
    throw new Error("Transfer integrity check failed - SHA-256 mismatch after decryption");
  }
  await store.execute(
    "UPDATE file_transfers SET status = 'downloading' WHERE org_id = $1 AND id = $2 AND status = 'ready'",
    [orgId, transferId]
  );
  return {
    data,
    fileName: String(row.file_name),
    sha256: actualSha,
    fileSize: data.length
  };
}

async function getTransferDecryptionKey(store: ControlPlaneStore, orgId: OrgId, transferId: TransferId): Promise<Buffer> {
  const keyRow = await store.one<Record<string, unknown>>(
    "SELECT * FROM transfer_encryption_keys WHERE org_id = $1 AND transfer_id = $2",
    [orgId, transferId]
  );
  if (!keyRow) throw new Error("Encryption key not found for transfer");
  return unwrapTransferKey(String(keyRow.wrapped_key), transferId);
}

export async function recordTransferReceipt(
  orgId: OrgId,
  transferId: TransferId,
  toAgentInstanceId: AgentInstanceId,
  receipt: { stored_path: string; verified_sha256: string },
  store: ControlPlaneStore = getControlPlaneStore()
): Promise<{ ok: true; status: "completed" }> {
  return await store.transaction(async (tx) => {
    const row = await tx.one<Record<string, unknown>>(
      "SELECT * FROM file_transfers WHERE org_id = $1 AND id = $2",
      [orgId, transferId]
    );
    if (!row) throw new Error("Transfer not found");
    if (String(row.to_agent_instance_id) !== toAgentInstanceId) {
      throw new Error("Not authorized to record receipt for this transfer");
    }
    if (String(row.sha256) !== receipt.verified_sha256.toLowerCase()) {
      throw new Error("Receipt SHA-256 does not match transfer hash");
    }
    const now = new Date().toISOString();
    const completed = await tx.execute(`
      UPDATE file_transfers SET status = 'completed', completed_at = $1
      WHERE org_id = $2 AND id = $3 AND to_agent_instance_id = $4 AND status IN ('ready', 'downloading')
    `, [now, orgId, transferId, toAgentInstanceId]);
    if (completed.changes !== 1) {
      throw new Error(`Transfer is in state ${row.status}, cannot record receipt`);
    }
    await appendAuditEvent({
      orgId,
      actorAgentInstanceId: toAgentInstanceId,
      eventType: "TRANSFER_RECEIPT",
      details: {
        transfer_id: transferId,
        stored_path: receipt.stored_path,
        verified_sha256: receipt.verified_sha256
      }
    }, tx);
    return { ok: true as const, status: "completed" as const };
  });
}

export async function expireOldTransfers(store: ControlPlaneStore = getControlPlaneStore()): Promise<number> {
  const now = new Date().toISOString();
  const rows = await store.query<{ id: string; file_name: string; sha256: string }>(`
    SELECT id, file_name, sha256 FROM file_transfers
    WHERE status IN ('initialized', 'ready', 'uploading', 'downloading') AND expires_at < $1
  `, [now]);
  for (const row of rows) {
    try { deleteTransferFiles(row.id); } catch { /* best effort */ }
    await store.execute(
      "UPDATE file_transfers SET status = 'expired' WHERE id = $1",
      [row.id]
    );
  }
  return rows.length;
}
