/**
 * ReceiverAgentOrchestrator
 *
 * Runs on the RECEIVER's machine (e.g. Docin's PC) when an incoming
 * voice-triggered file request arrives via the relay.
 *
 * Agentic workflow:
 *  1. Parse the file request from relay payload
 *  2. Search local files using FileSearchService
 *  3. Create an approval card in the receiver's Chat UI
 *  4. Wait for receiver to approve/reject (human-in-the-loop)
 *  5. On approval: upload file via FileRelayClient
 *  6. Notify requester of transfer availability via relay
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "../db/connection.js";
import { appendAuditEvent } from "../security/AuditHashChain.js";
import { ChatRepository } from "../chat/ChatRepository.js";
import { FileSearchService } from "../file-search/FileSearchService.js";
import { LocalCloudIdentityStore, defaultProfileId } from "../cloud/LocalCloudIdentityStore.js";
import { resolveFileRequestCandidates, toReceiverApprovalCandidatePayload } from "./FileRequestCandidateResolver.js";
import type { RelayInboxMessage } from "../cloud/RelayClient.js";
import { sendNotification } from "../notification/NotificationBridgeClient.js";
import { signApprovalCallback } from "../security/SecurityGuards.js";

export interface ReceiverApprovalRecord {
  id: string;
  profileId: string;
  relayTaskId: string;
  a2aTaskId: string;
  requesterAgentInstanceId: string;
  requesterUserId: string | null;
  fileQuery: string;
  candidatesJson: string;
  status: "pending" | "approved" | "rejected" | "transferred" | "failed";
  selectedFilePath: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
}

export class ReceiverAgentOrchestrator {
  private readonly chatRepo: ChatRepository;
  private readonly fileSearch: FileSearchService;
  private readonly cloudStore: LocalCloudIdentityStore;

  constructor(
    private readonly db: DatabaseSync = getDb(),
    private readonly profileId = defaultProfileId(),
    chatRepo?: ChatRepository,
    fileSearch?: FileSearchService
  ) {
    this.chatRepo = chatRepo ?? new ChatRepository(db);
    this.fileSearch = fileSearch ?? new FileSearchService();
    this.cloudStore = new LocalCloudIdentityStore(db);
  }

  /**
   * Called by RemoteTaskDispatcher when a file.request relay message arrives.
   * Creates an approval record and posts an approval card to the receiver's chat.
   */
  async handleIncomingFileRequest(
    message: RelayInboxMessage,
    conversationId: string,
    taskId: string
  ): Promise<ReceiverApprovalRecord> {
    const fileQuery = extractFileQuery(message.payload);
    const now = new Date().toISOString();
    const approvalId = `rapproval_${randomUUID()}`;

    console.info(`[ReceiverAgentOrchestrator] Handling incoming file request: "${fileQuery}" from ${message.from_agent_instance_id}`);

    // Search local files for candidates
    const resolved = await resolveFileRequestCandidates(fileQuery, this.fileSearch, { limit: 5 });
    const candidates = resolved.candidates;

    console.info(`[ReceiverAgentOrchestrator] Found ${candidates.length} candidates for query: "${fileQuery}"`);

    // Persist approval record
    this.db.prepare(`
      INSERT INTO receiver_approvals
        (id, profile_id, relay_task_id, a2a_task_id, requester_agent_instance_id, requester_user_id,
         file_query, candidates_json, status, selected_file_path, error_message, created_at, updated_at, decided_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?, NULL)
    `).run(
      approvalId,
      this.profileId,
      message.relay_task_id,
      message.a2a_task_id ?? message.relay_task_id,
      message.from_agent_instance_id,
      extractUserId(message.payload),
      fileQuery,
      JSON.stringify(candidates.map(toReceiverApprovalCandidatePayload)),
      now,
      now
    );

    // Post approval card to receiver's chat UI
    this.chatRepo.appendMessage({
      conversationId,
      taskId,
      senderAgentInstanceId: message.to_agent_instance_id,
      receiverAgentInstanceId: message.from_agent_instance_id,
      messageType: "approval",
      text: `File request: "${fileQuery}"`,
      payload: {
        kind: "receiver_file_approval",
        approval_id: approvalId,
        relay_task_id: message.relay_task_id,
        a2a_task_id: message.a2a_task_id ?? message.relay_task_id,
        task_id: taskId,
        file_query: fileQuery,
        requester_agent_instance_id: message.from_agent_instance_id,
        status: "pending",
        candidates: candidates.map(toReceiverApprovalCandidatePayload),
        candidate_count: candidates.length,
        parsed_filename: resolved.parsed.exactFilename,
        search_source: resolved.source,
        voice_command_id: extractVoiceCommandId(message.payload)
      },
      deliveryStatus: "delivered"
    });

    // Fire OS notification (Windows toast) via local bridge
    const topCandidate = candidates[0];
    if (topCandidate) {
      const callbackPort = Number(process.env.SANDBOX_PORT ?? 3399);
      const nonce = randomBytes(16).toString("base64url");
      const signature = signApprovalCallback({
        approvalId,
        taskId,
        action: "notification",
        nonce
      });

      sendNotification({
        approvalId,
        taskId,
        candidateId: String(topCandidate.id),
        callbackNonce: nonce,
        callbackSignature: signature,
        requesterName: message.from_agent_instance_id,
        requestedItem: fileQuery,
        topCandidateFileName: topCandidate.fileName,
        localAgentCallbackPort: callbackPort,
      }).catch((err) => {
        console.warn("[ReceiverAgentOrchestrator] Failed to fire toast via notification bridge:", err);
      });
    }

    appendAuditEvent({
      actorAgentId: message.to_agent_instance_id,
      taskId,
      eventType: "RECEIVER_APPROVAL_CREATED",
      detailsJson: {
        approvalId,
        relayTaskId: message.relay_task_id,
        fileQuery,
        candidateCount: candidates.length
      }
    });

    return this.getApproval(approvalId)!;
  }

  getApproval(id: string): ReceiverApprovalRecord | null {
    const row = this.db.prepare("SELECT * FROM receiver_approvals WHERE id = ?").get(id) as
      Record<string, unknown> | undefined;
    return row ? rowToApproval(row) : null;
  }

  listPendingApprovals(): ReceiverApprovalRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM receiver_approvals WHERE profile_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 50"
    ).all(this.profileId) as Array<Record<string, unknown>>;
    return rows.map(rowToApproval);
  }

  listApprovals(options: { limit?: number; status?: string } = {}): ReceiverApprovalRecord[] {
    const limit = Math.min(options.limit ?? 50, 100);
    const rows = options.status
      ? this.db.prepare(
          "SELECT * FROM receiver_approvals WHERE profile_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?"
        ).all(this.profileId, options.status, limit) as Array<Record<string, unknown>>
      : this.db.prepare(
          "SELECT * FROM receiver_approvals WHERE profile_id = ? ORDER BY created_at DESC LIMIT ?"
        ).all(this.profileId, limit) as Array<Record<string, unknown>>;
    return rows.map(rowToApproval);
  }

  /**
   * Called when the receiver explicitly approves the file transfer.
   * Updates DB record and chat message payload.
   */
  approveTransfer(approvalId: string, selectedFilePath: string): ReceiverApprovalRecord {
    const approval = this.getApproval(approvalId);
    if (!approval) throw new ReceiverApprovalError("APPROVAL_NOT_FOUND", `Approval ${approvalId} not found`);
    if (approval.status !== "pending") {
      throw new ReceiverApprovalError("APPROVAL_ALREADY_DECIDED", `Approval is already ${approval.status}`);
    }

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE receiver_approvals
      SET status = 'approved', selected_file_path = ?, updated_at = ?, decided_at = ?
      WHERE id = ?
    `).run(selectedFilePath, now, now, approvalId);

    appendAuditEvent({
      actorAgentId: "local-agent",
      taskId: approval.a2aTaskId,
      eventType: "RECEIVER_APPROVED_FILE_TRANSFER",
      detailsJson: { approvalId, relayTaskId: approval.relayTaskId, selectedFilePath }
    });

    return this.getApproval(approvalId)!;
  }

  /**
   * Called when the receiver rejects the file transfer.
   */
  rejectTransfer(approvalId: string, reason?: string): ReceiverApprovalRecord {
    const approval = this.getApproval(approvalId);
    if (!approval) throw new ReceiverApprovalError("APPROVAL_NOT_FOUND", `Approval ${approvalId} not found`);
    if (approval.status !== "pending") {
      throw new ReceiverApprovalError("APPROVAL_ALREADY_DECIDED", `Approval is already ${approval.status}`);
    }

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE receiver_approvals
      SET status = 'rejected', error_message = ?, updated_at = ?, decided_at = ?
      WHERE id = ?
    `).run(reason ?? "Rejected by receiver", now, now, approvalId);

    appendAuditEvent({
      actorAgentId: "local-agent",
      taskId: approval.a2aTaskId,
      eventType: "RECEIVER_REJECTED_FILE_TRANSFER",
      detailsJson: { approvalId, relayTaskId: approval.relayTaskId, reason }
    });

    return this.getApproval(approvalId)!;
  }

  markTransferred(approvalId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(
      "UPDATE receiver_approvals SET status = 'transferred', updated_at = ? WHERE id = ?"
    ).run(now, approvalId);
  }

  markFailed(approvalId: string, error: string): void {
    const now = new Date().toISOString();
    this.db.prepare(
      "UPDATE receiver_approvals SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?"
    ).run(error, now, approvalId);
  }
}

export class ReceiverApprovalError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

function rowToApproval(row: Record<string, unknown>): ReceiverApprovalRecord {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    relayTaskId: String(row.relay_task_id),
    a2aTaskId: String(row.a2a_task_id),
    requesterAgentInstanceId: String(row.requester_agent_instance_id),
    requesterUserId: typeof row.requester_user_id === "string" ? row.requester_user_id : null,
    fileQuery: String(row.file_query),
    candidatesJson: typeof row.candidates_json === "string" ? row.candidates_json : "[]",
    status: String(row.status) as ReceiverApprovalRecord["status"],
    selectedFilePath: typeof row.selected_file_path === "string" ? row.selected_file_path : null,
    errorMessage: typeof row.error_message === "string" ? row.error_message : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    decidedAt: typeof row.decided_at === "string" ? row.decided_at : null
  };
}

function extractFileQuery(payload: Record<string, unknown> | undefined): string {
  if (!payload) return "requested file";
  return (
    String(payload.requestText ?? payload.request_text ?? payload.text ?? payload.query ?? payload.file_query ?? "requested file")
  ).trim() || "requested file";
}

function extractUserId(payload: Record<string, unknown> | undefined): string | null {
  if (!payload) return null;
  const uid = payload.requester_user_id ?? payload.from_user_id ?? payload.user_id;
  return typeof uid === "string" && uid ? uid : null;
}

function extractVoiceCommandId(payload: Record<string, unknown> | undefined): string | null {
  if (!payload) return null;
  const vid = payload.voice_command_id;
  return typeof vid === "string" && vid ? vid : null;
}
