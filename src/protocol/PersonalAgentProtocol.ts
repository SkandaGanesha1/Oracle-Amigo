import { randomUUID, createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { AgentCard } from "@a2a-js/sdk";
import { getDb } from "../db/connection.js";
import { appendAuditEvent } from "../security/AuditHashChain.js";
import { generateOrLoadIdentity, type LocalIdentity } from "../security/DeviceIdentity.js";
import { createOrGetPeerSession, createHandshakeOffer as anpCreateOffer, verifyHandshakeOfferSync as anpVerifyOffer, createHandshakeResponse as anpCreateResponse, verifyHandshakeResponseSync as anpVerifyResponse, type HandshakeOffer, type HandshakeResponse, type PeerSession } from "../security/AnpHandshakeAdapter.js";
import { transition, createTask as wfCreateTask, getTask as wfGetTask } from "../workflow/TaskWorkflow.js";
import { stageFile, promoteToApproved } from "../storage/AgenticStorage.js";

export type ApprovalAction = "approve" | "reject" | "feedback";
export type ApprovalDecisionOutcome = "applied" | "replay" | "denied" | "not_found";

export type ApprovalRecord = {
  id: string;
  taskId: string;
  approvalType: string;
  requesterAgentId: string;
  ownerAgentId: string;
  status: "pending" | "approved" | "rejected" | "feedback_received" | "expired";
  selectedFileId: string | null;
  boundFilePath: string | null;
  boundSha256: string | null;
  boundSizeBytes: number | null;
  feedbackText: string | null;
  expiresAt: string;
  createdAt: string;
  decidedAt: string | null;
};

export type ApprovalDecisionResult = {
  approval: ApprovalRecord | null;
  outcome: ApprovalDecisionOutcome;
  replay: boolean;
  transferScheduled: boolean;
  error?: string;
};

export class PersonalAgentProtocol {
  private _identity: LocalIdentity | null = null;
  private _dbPath: string | undefined;

  setIdentityPath(identity: LocalIdentity, dbPath?: string): void {
    this._identity = identity;
    this._dbPath = dbPath;
  }

  async createApproval(taskId: string, input: {
    approvalType?: string;
    requesterAgentId?: string;
    ownerAgentId?: string;
    selectedFileId?: string | null;
    boundFilePath?: string | null;
    boundSha256?: string | null;
    boundSizeBytes?: number | null;
  }): Promise<ApprovalRecord> {
    const db = getDb(this._dbPath);
    const id = randomUUID();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    let boundSha256 = input.boundSha256 ?? null;
    let boundSizeBytes = input.boundSizeBytes ?? null;

    if (input.boundFilePath && (boundSha256 == null || boundSizeBytes == null)) {
      try {
        const info = await stat(input.boundFilePath);
        boundSizeBytes = info.size;
        boundSha256 = await hashFile(input.boundFilePath);
      } catch {
        // file may not exist or be unreadable; leave nulls
      }
    }

    const approvalType = input.approvalType ?? "file.transfer.offer";
    if (approvalType === "file.transfer.offer" && (!input.boundFilePath || !boundSha256 || boundSizeBytes == null)) {
      const error = new Error("APPROVAL_HAS_NO_BOUND_FILE");
      error.name = "APPROVAL_HAS_NO_BOUND_FILE";
      throw error;
    }

    db.prepare(`
      INSERT INTO approval_requests
        (id, task_id, approval_type, requester_agent_id, owner_agent_id, status,
         selected_file_id, bound_file_path, bound_sha256, bound_size_bytes, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
    `).run(id, taskId, approvalType,
      input.requesterAgentId ?? "local-user", input.ownerAgentId ?? "local-agent",
      input.selectedFileId ?? null, input.boundFilePath ?? null,
      boundSha256, boundSizeBytes, expiresAt, now);

    appendAuditEvent({
      actorAgentId: input.ownerAgentId ?? "local-agent",
      taskId,
      eventType: "APPROVAL_CREATED",
      detailsJson: {
        approvalId: id,
        approvalType,
        boundSha256,
        boundSizeBytes,
        boundFilePath: input.boundFilePath ? "[redacted]" : null
      }
    });
    return this.getApproval(id)!;
  }

  applyApprovalDecision(id: string, action: ApprovalAction, feedback?: string): ApprovalRecord | null {
    return this.applyApprovalDecisionWithResult(id, action, { feedback }).approval;
  }

  applyApprovalDecisionWithResult(
    id: string,
    action: ApprovalAction,
    options: { feedback?: string; idempotencyKey?: string } = {}
  ): ApprovalDecisionResult {
    const approval = this.getApproval(id);
    if (!approval) return { approval: null, outcome: "not_found", replay: false, transferScheduled: false, error: "Approval not found" };

    const db = getDb(this._dbPath);
    const now = new Date().toISOString();
    const idempotencyKey = options.idempotencyKey ?? `${id}|${approval.taskId}|${action}`;
    const existingKey = db.prepare(`
      SELECT * FROM approval_idempotency_keys
      WHERE approval_id = ? AND idempotency_key = ?
    `).get(id, idempotencyKey) as Record<string, unknown> | undefined;
    if (existingKey) {
      return {
        approval,
        outcome: "replay",
        replay: true,
        transferScheduled: false
      };
    }

    if (approval.status !== "pending") {
      const duplicateTerminal =
        (approval.status === "approved" && action === "approve") ||
        (approval.status === "rejected" && action === "reject");
      recordApprovalIdempotencyKey(db, id, idempotencyKey, action, approval.status, now);
      return {
        approval,
        outcome: duplicateTerminal ? "replay" : "denied",
        replay: duplicateTerminal,
        transferScheduled: false,
        error: duplicateTerminal ? undefined : `Approval is terminal: ${approval.status}`
      };
    }

    if (action === "approve") {
      db.prepare("UPDATE approval_requests SET status='approved', decided_at=? WHERE id=?").run(now, id);
      recordApprovalIdempotencyKey(db, id, idempotencyKey, action, "approved", now);
      try { transition(approval.taskId, "APPROVED", { approvalId: id }); } catch { /* already transitioned */ }

      let transferScheduled = false;
      if (approval.boundFilePath && approval.boundSha256) {
        const filePath = approval.boundFilePath;
        const sha256 = approval.boundSha256;
        const taskId = approval.taskId;
        // Best-effort async file staging
        const root = filePath.replace(/[\\/][^\\/]+$/, "") || ".";
        void stageFile(taskId, filePath, [root])
          .then((staged) => {
            const latest = this.getApproval(id);
            if (!latest || latest.status !== "approved") return;
            const existingTransfer = db.prepare("SELECT id FROM transfers WHERE task_id = ? AND sha256 = ? LIMIT 1").get(taskId, sha256);
            if (existingTransfer) return;
            try { transition(taskId, "FILE_HASHING", { sha256, sizeBytes: staged.sizeBytes }); } catch { /* already moved */ }
            try { transition(taskId, "FILE_STAGED", { stagedPath: staged.stagedPath }); } catch { /* already moved */ }
            const stored = promoteToApproved(taskId, id, staged, sha256, {
              fromAgentId: approval.requesterAgentId, toAgentId: approval.ownerAgentId,
            });
            try { transition(taskId, "TRANSFER_CREATED", { transferId: stored.transferId }); } catch { /* already moved */ }
            try { transition(taskId, "STORED_IN_AGENTIC_STORAGE", { storedPath: stored.storedPath }); } catch { /* already moved */ }
            try { transition(taskId, "RECEIPT_CREATED", { receiptId: stored.id }); } catch { /* already moved */ }
            try { transition(taskId, "AUDITED", { auditChainValidated: true }); } catch { /* already moved */ }
            try { transition(taskId, "COMPLETED", { storedId: stored.id }); } catch { /* already moved */ }
            appendAuditEvent({
              actorAgentId: approval.ownerAgentId, taskId, approvalId: id,
              eventType: "FILE_STORED", detailsJson: { storedId: stored.id, transferId: stored.transferId, sha256: stored.sha256 }
            });
          })
          .catch((err) => {
            appendAuditEvent({
              actorAgentId: approval.ownerAgentId, taskId, approvalId: id,
              eventType: "STORAGE_FAILED", detailsJson: { error: String((err as Error)?.message ?? err) }
            });
            try { transition(taskId, "FAILED", { stage: "storage", error: String((err as Error)?.message ?? err) }); } catch { /* ignore */ }
          });
        transferScheduled = true;
      }
      appendAuditEvent({ actorAgentId: approval.ownerAgentId, taskId: approval.taskId, approvalId: id, eventType: "APPROVED", detailsJson: {} });
      return { approval: this.getApproval(id)!, outcome: "applied", replay: false, transferScheduled };
    } else if (action === "reject") {
      db.prepare("UPDATE approval_requests SET status='rejected', decided_at=? WHERE id=?").run(now, id);
      recordApprovalIdempotencyKey(db, id, idempotencyKey, action, "rejected", now);
      try { transition(approval.taskId, "REJECTED", { approvalId: id }); } catch { /* ignore */ }
      appendAuditEvent({ actorAgentId: approval.ownerAgentId, taskId: approval.taskId, approvalId: id, eventType: "REJECTED", detailsJson: {} });
      return { approval: this.getApproval(id)!, outcome: "applied", replay: false, transferScheduled: false };
    } else {
      db.prepare("UPDATE approval_requests SET status='feedback_received', feedback_text=?, decided_at=? WHERE id=?").run(options.feedback ?? null, now, id);
      recordApprovalIdempotencyKey(db, id, idempotencyKey, action, "feedback_received", now);
      try { transition(approval.taskId, "USER_FEEDBACK_RECEIVED", { feedback: options.feedback }); } catch { /* ignore */ }
      appendAuditEvent({ actorAgentId: approval.ownerAgentId, taskId: approval.taskId, approvalId: id, eventType: "FEEDBACK_RECEIVED", detailsJson: { feedback: options.feedback } });
      return { approval: this.getApproval(id)!, outcome: "applied", replay: false, transferScheduled: false };
    }
  }

  getApproval(id: string): ApprovalRecord | null {
    const row = getDb(this._dbPath).prepare("SELECT * FROM approval_requests WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToApproval(row) : null;
  }

  listApprovals(): ApprovalRecord[] {
    return (getDb(this._dbPath).prepare("SELECT * FROM approval_requests ORDER BY created_at DESC").all() as Array<Record<string, unknown>>).map(rowToApproval);
  }

  createLocalIdentity(): LocalIdentity {
    if (this._identity) return this._identity;
    this._identity = generateOrLoadIdentity("Local User", this._dbPath);
    return this._identity;
  }

  createPeerSession(peer: { agentId: string; did: string; publicKey: string; trustLevel?: "local" | "loopback" | "verified" | "untrusted" }): PeerSession {
    return createOrGetPeerSession(peer);
  }

  createHandshakeOffer(peer: string): HandshakeOffer {
    const identity = this.createLocalIdentity();
    return anpCreateOffer(identity, peer);
  }

  verifyHandshakeOffer(offer: HandshakeOffer, publicKeyHex: string): boolean {
    // Backward-compat synchronous signature check.
    return anpVerifyOffer(offer, publicKeyHex);
  }

  createHandshakeResponse(offer: HandshakeOffer): HandshakeResponse {
    const identity = this.createLocalIdentity();
    return anpCreateResponse(offer, identity);
  }

  verifyHandshakeResponse(response: HandshakeResponse, publicKeyHex: string): boolean {
    return anpVerifyResponse(response, publicKeyHex);
  }

  listPeerSessions() {
    return (getDb(this._dbPath).prepare("SELECT * FROM peer_sessions ORDER BY created_at DESC").all() as Array<Record<string, unknown>>).map((r) => ({
      peerAgentId: r.peer_agent_id, peerDid: r.peer_did, peerPublicKey: r.peer_public_key,
      trustLevel: r.trust_level, status: r.status, createdAt: r.created_at, expiresAt: r.expires_at,
    }));
  }

  createTask(input: { contextId?: string; type?: string; metadata?: Record<string, unknown>; actorAgentId?: string }) {
    return wfCreateTask(input);
  }

  getTask(taskId: string) {
    return wfGetTask(taskId);
  }
}

function recordApprovalIdempotencyKey(
  db: ReturnType<typeof getDb>,
  approvalId: string,
  idempotencyKey: string,
  action: ApprovalAction,
  resultStatus: string,
  createdAt: string
): void {
  db.prepare(`
    INSERT OR IGNORE INTO approval_idempotency_keys
      (id, approval_id, idempotency_key, action, result_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), approvalId, idempotencyKey, action, resultStatus, createdAt);
}

function rowToApproval(r: Record<string, unknown>): ApprovalRecord {
  return {
    id: r.id as string, taskId: r.task_id as string, approvalType: r.approval_type as string,
    requesterAgentId: r.requester_agent_id as string, ownerAgentId: r.owner_agent_id as string,
    status: r.status as ApprovalRecord["status"],
    selectedFileId: (r.selected_file_id as string | null) ?? null,
    boundFilePath: (r.bound_file_path as string | null) ?? null,
    boundSha256: (r.bound_sha256 as string | null) ?? null,
    boundSizeBytes: r.bound_size_bytes != null ? Number(r.bound_size_bytes) : null,
    feedbackText: (r.feedback_text as string | null) ?? null,
    expiresAt: r.expires_at as string, createdAt: r.created_at as string,
    decidedAt: (r.decided_at as string | null) ?? null,
  };
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  return hash.digest("hex");
}
