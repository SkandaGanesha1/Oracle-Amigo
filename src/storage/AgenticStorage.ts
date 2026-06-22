import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { getDb } from "../db/connection.js";

export type StagedFile = { stagedPath: string; sha256: string; sizeBytes: number; };
export type StoredFile = { id: string; transferId: string; storedPath: string; originalFileName: string; sha256: string; sizeBytes: number; receivedAt: string; };

export function storageRoot(): string {
  if (process.env.AGENTIC_STORAGE_ROOT) return process.env.AGENTIC_STORAGE_ROOT;
  if (process.platform === "win32" && process.env.LOCALAPPDATA)
    return join(process.env.LOCALAPPDATA, "AgenticApp", "storage");
  return join(homedir(), ".agentic-app", "storage");
}

export function ensureDirectories(): void {
  for (const sub of ["inbox", "sent", "staging", "approved", "temp", "previews"]) {
    mkdirSync(join(storageRoot(), sub), { recursive: true });
  }
}

function guardPath(filePath: string, allowedRoots: string[]): void {
  const resolved = resolve(filePath);
  const ok = allowedRoots.some((r) => {
    const root = resolve(r);
    return resolved === root || resolved.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
  });
  if (!ok) throw new Error(`Path traversal denied: ${filePath}`);
}

export async function stageFile(taskId: string, sourcePath: string, allowedRoots: string[]): Promise<StagedFile> {
  guardPath(sourcePath, allowedRoots);
  ensureDirectories();
  const stagingDir = join(storageRoot(), "staging", taskId);
  mkdirSync(stagingDir, { recursive: true });
  const dest = join(stagingDir, basename(sourcePath));
  const hash = createHash("sha256");
  let sizeBytes = 0;

  await pipeline(
    createReadStream(sourcePath),
    async function* (source) {
      for await (const chunk of source) {
        hash.update(chunk);
        sizeBytes += (chunk as Buffer).length;
        yield chunk;
      }
    },
    createWriteStream(dest)
  );

  return { stagedPath: dest, sha256: hash.digest("hex"), sizeBytes };
}

export function promoteToApproved(
  taskId: string, approvalId: string, staged: StagedFile, boundSha256: string,
  opts: { fromAgentId: string; toAgentId: string; mimeType?: string; }
): StoredFile {
  if (staged.sha256 !== boundSha256) {
    throw new Error(`SHA-256 mismatch: staged=${staged.sha256} bound=${boundSha256}`);
  }
  ensureDirectories();
  const approvedDir = join(storageRoot(), "approved", taskId);
  mkdirSync(approvedDir, { recursive: true });
  const dest = join(approvedDir, basename(staged.stagedPath));
  copyFileSync(staged.stagedPath, dest);
  try { rmSync(staged.stagedPath); } catch { /* ignore */ }

  const db = getDb();
  const id = randomUUID();
  const transferId = randomUUID();
  const now = new Date().toISOString();
  const fileName = basename(dest);

  db.prepare(`
    INSERT INTO transfers (id, task_id, from_agent_id, to_agent_id, file_name, mime_type, size_bytes, sha256, storage_path, transfer_mode, status, created_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', 'completed', ?, ?)
  `).run(transferId, taskId, opts.fromAgentId, opts.toAgentId, fileName, opts.mimeType ?? "application/octet-stream", staged.sizeBytes, staged.sha256, dest, now, now);

  db.prepare(`
    INSERT INTO received_files (id, transfer_id, sender_agent_id, stored_path, original_file_name, sha256, size_bytes, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, transferId, opts.fromAgentId, dest, fileName, staged.sha256, staged.sizeBytes, now);

  return { id, transferId, storedPath: dest, originalFileName: fileName, sha256: staged.sha256, sizeBytes: staged.sizeBytes, receivedAt: now };
}

export function storeReceivedRelayFile(input: {
  transferId: string;
  senderAgentId: string;
  fileName: string;
  data: Buffer;
  sha256: string;
}): StoredFile {
  ensureDirectories();
  const safeName = basename(input.fileName || "received-file");
  const inboxDir = join(storageRoot(), "inbox", input.transferId);
  mkdirSync(inboxDir, { recursive: true });
  const dest = join(inboxDir, safeName);
  const actualSha = createHash("sha256").update(input.data).digest("hex");
  if (actualSha !== input.sha256.toLowerCase()) {
    throw new Error(`SHA-256 mismatch: received=${actualSha} expected=${input.sha256}`);
  }
  writeFileSync(dest, input.data);

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO received_files (id, transfer_id, sender_agent_id, stored_path, original_file_name, sha256, size_bytes, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.transferId, input.senderAgentId, dest, safeName, actualSha, input.data.length, now);
  return {
    id,
    transferId: input.transferId,
    storedPath: dest,
    originalFileName: safeName,
    sha256: actualSha,
    sizeBytes: input.data.length,
    receivedAt: now
  };
}

export function listStoredFiles(): StoredFile[] {
  const rows = getDb().prepare("SELECT * FROM received_files ORDER BY received_at DESC").all() as Array<Record<string, unknown>>;
  return rows.map(rowToStored);
}

export function getStoredFile(fileId: string): StoredFile | null {
  const row = getDb().prepare("SELECT * FROM received_files WHERE id = ?").get(fileId) as Record<string, unknown> | undefined;
  return row ? rowToStored(row) : null;
}

function rowToStored(r: Record<string, unknown>): StoredFile {
  return { id: r.id as string, transferId: r.transfer_id as string, storedPath: r.stored_path as string, originalFileName: r.original_file_name as string, sha256: r.sha256 as string, sizeBytes: Number(r.size_bytes), receivedAt: r.received_at as string };
}
