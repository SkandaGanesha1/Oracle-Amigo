import { randomUUID } from "node:crypto";
import { getDb } from "../db/connection.js";

export type ApprovalBindingInput = {
  requestId: string; // idempotency key
  taskId: string;
  filePath: string;
  sha256: string;
  sizeBytes: number;
  recipientAgentId: string;
  ownerAgentId: string;
};

export type BoundApproval = {
  id: string;
  taskId: string;
  requestId: string;
  boundFilePath: string;
  boundSha256: string;
  boundSizeBytes: number;
  status: string;
  createdAt: string;
  expiresAt: string;
};

export function bindApproval(input: ApprovalBindingInput): BoundApproval {
  const db = getDb();

  // Idempotency: return existing record if requestId already bound
  const existing = db.prepare(
    "SELECT * FROM approval_requests WHERE id = ? LIMIT 1"
  ).get(input.requestId) as Record<string, unknown> | undefined;
  if (existing) return rowToBound(existing);

  const id = input.requestId; // use requestId as the approval ID for idempotency
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO approval_requests
      (id, task_id, approval_type, requester_agent_id, owner_agent_id, status,
       bound_file_path, bound_sha256, bound_size_bytes, expires_at, created_at)
    VALUES (?, ?, 'file.transfer.offer', ?, ?, 'pending', ?, ?, ?, ?, ?)
  `).run(id, input.taskId, input.recipientAgentId, input.ownerAgentId,
         input.filePath, input.sha256, input.sizeBytes, expiresAt, now);

  return {
    id,
    taskId: input.taskId,
    requestId: input.requestId,
    boundFilePath: input.filePath,
    boundSha256: input.sha256,
    boundSizeBytes: input.sizeBytes,
    status: "pending",
    createdAt: now,
    expiresAt,
  };
}

function rowToBound(row: Record<string, unknown>): BoundApproval {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    requestId: row.id as string,
    boundFilePath: row.bound_file_path as string,
    boundSha256: row.bound_sha256 as string,
    boundSizeBytes: Number(row.bound_size_bytes),
    status: row.status as string,
    createdAt: row.created_at as string,
    expiresAt: row.expires_at as string,
  };
}
