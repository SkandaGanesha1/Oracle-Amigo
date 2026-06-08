import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "../db/connection.js";
import { appendAuditEvent } from "../security/AuditHashChain.js";
import { ChatRepository } from "../chat/ChatRepository.js";
import { ControlPlaneClient } from "../cloud/ControlPlaneClient.js";
import { FileRelayClient } from "../cloud/FileRelayClient.js";
import { LocalCloudIdentityStore, defaultProfileId } from "../cloud/LocalCloudIdentityStore.js";
import { RelayClient } from "../cloud/RelayClient.js";
import { getTask } from "../workflow/TaskWorkflow.js";
import type { ApprovalRecord } from "../protocol/PersonalAgentProtocol.js";

export interface ApprovalTransferResult {
  status: "completed" | "skipped" | "failed";
  transferId: string | null;
  reason?: string;
}

export class ApprovalTransferOrchestrator {
  constructor(
    private db: DatabaseSync = getDb(),
    private store = new LocalCloudIdentityStore(db),
    private profileId = defaultProfileId(),
    private chatRepo = new ChatRepository(db)
  ) {}

  async scheduleForApproval(approval: ApprovalRecord): Promise<ApprovalTransferResult> {
    if (approval.status !== "approved") {
      return { status: "skipped", transferId: null, reason: `approval is ${approval.status}` };
    }
    if (!approval.boundFilePath) {
      return { status: "skipped", transferId: null, reason: "approval has no bound file path" };
    }

    const task = getTask(approval.taskId);
    const relayTaskId = typeof task?.metadataJson.relayTaskId === "string" ? task.metadataJson.relayTaskId : null;
    if (!relayTaskId) {
      return { status: "skipped", transferId: null, reason: "approval is not tied to a relay task" };
    }

    const existing = this.getJob(approval.id);
    if (existing?.status === "completed" && existing.transfer_id) {
      return { status: "completed", transferId: String(existing.transfer_id) };
    }
    if (existing?.status === "uploading" || existing?.status === "available_notified") {
      return { status: "skipped", transferId: existing.transfer_id ? String(existing.transfer_id) : null, reason: "transfer already in progress" };
    }

    this.createOrTouchJob(approval, relayTaskId);
    try {
      const identity = this.store.get(this.profileId);
      if (!identity?.deviceAccessToken || !identity.agentInstanceId) {
        throw new Error("Cloud enrollment is required before transfer upload");
      }
      if (identity.agentInstanceId !== approval.ownerAgentId) {
        throw new Error("Approval owner does not match enrolled local agent instance");
      }

      this.updateJob(approval.id, "hashing");
      const bytes = await readFile(approval.boundFilePath);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const sizeBytes = bytes.length;
      if (approval.boundSha256 && approval.boundSha256 !== sha256) {
        throw new Error(`Approved file SHA-256 changed: bound=${approval.boundSha256} actual=${sha256}`);
      }
      this.db.prepare("UPDATE approval_requests SET bound_sha256 = ?, bound_size_bytes = ? WHERE id = ?")
        .run(sha256, sizeBytes, approval.id);

      const cp = new ControlPlaneClient(identity.controlPlaneUrl);
      const files = new FileRelayClient(cp);
      const relay = new RelayClient(cp);
      const fileName = basename(approval.boundFilePath);

      this.updateJob(approval.id, "init_started");
      const init = await files.init({
        to_agent_instance_id: approval.requesterAgentId,
        file_name: fileName,
        file_size: sizeBytes,
        sha256,
        relay_task_id: relayTaskId
      }, identity.deviceAccessToken);

      this.updateJob(approval.id, "uploading", init.transfer_id);
      await files.upload(init.transfer_id, bytes, identity.deviceAccessToken);

      await relay.send({
        to_agent_instance_id: approval.requesterAgentId,
        a2a_task_id: approval.taskId,
        type: "file.transfer.available",
        payload: {
          transfer_id: init.transfer_id,
          relay_task_id: relayTaskId,
          approval_id: approval.id,
          task_id: approval.taskId,
          file_name: fileName,
          file_size: sizeBytes,
          sha256,
          from_agent_instance_id: approval.ownerAgentId
        },
        idempotency_key: `transfer-available:${approval.id}`
      }, identity.deviceAccessToken);

      this.updateJob(approval.id, "completed", init.transfer_id, null, new Date().toISOString());
      this.appendTransferTimeline(approval, init.transfer_id, fileName, sizeBytes, sha256);
      appendAuditEvent({
        actorAgentId: approval.ownerAgentId,
        taskId: approval.taskId,
        approvalId: approval.id,
        eventType: "CLOUD_TRANSFER_UPLOADED",
        detailsJson: {
          transferId: init.transfer_id,
          relayTaskId,
          fileName,
          sizeBytes,
          sha256
        }
      });
      return { status: "completed", transferId: init.transfer_id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.updateJob(approval.id, "failed", null, message);
      appendAuditEvent({
        actorAgentId: approval.ownerAgentId,
        taskId: approval.taskId,
        approvalId: approval.id,
        eventType: "CLOUD_TRANSFER_FAILED",
        detailsJson: { error: message }
      });
      return { status: "failed", transferId: null, reason: message };
    }
  }

  private getJob(approvalId: string): Record<string, unknown> | undefined {
    return this.db.prepare("SELECT * FROM approval_transfer_jobs WHERE approval_id = ?").get(approvalId) as
      Record<string, unknown> | undefined;
  }

  private createOrTouchJob(approval: ApprovalRecord, relayTaskId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO approval_transfer_jobs
        (id, approval_id, task_id, relay_task_id, status, attempts, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)
      ON CONFLICT(approval_id) DO UPDATE SET
        attempts = approval_transfer_jobs.attempts + 1,
        updated_at = excluded.updated_at
    `).run(randomUUID(), approval.id, approval.taskId, relayTaskId, now, now);
  }

  private updateJob(
    approvalId: string,
    status: string,
    transferId?: string | null,
    error?: string | null,
    completedAt?: string | null
  ): void {
    this.db.prepare(`
      UPDATE approval_transfer_jobs
      SET status = ?,
          transfer_id = COALESCE(?, transfer_id),
          last_error = ?,
          updated_at = ?,
          completed_at = COALESCE(?, completed_at)
      WHERE approval_id = ?
    `).run(status, transferId ?? null, error ?? null, new Date().toISOString(), completedAt ?? null, approvalId);
  }

  private appendTransferTimeline(
    approval: ApprovalRecord,
    transferId: string,
    fileName: string,
    sizeBytes: number,
    sha256: string
  ): void {
    const conversation = this.chatRepo.listConversations().find((item) =>
      this.chatRepo.getMessages(item.id).some((message) => message.task_id === approval.taskId)
    );
    if (!conversation) return;
    this.chatRepo.appendMessage({
      conversationId: conversation.id,
      taskId: approval.taskId,
      senderAgentInstanceId: approval.ownerAgentId,
      receiverAgentInstanceId: approval.requesterAgentId,
      messageType: "transfer",
      text: "Transfer uploaded to relay",
      payload: {
        transfer_id: transferId,
        task_id: approval.taskId,
        file_name: fileName,
        size_bytes: sizeBytes,
        sha256,
        progress_percent: 100,
        status: "available"
      },
      deliveryStatus: "delivered"
    });
  }
}
