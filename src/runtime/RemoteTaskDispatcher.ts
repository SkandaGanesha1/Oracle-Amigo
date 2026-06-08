import type { DatabaseSync } from "node:sqlite";
import { getDb } from "../db/connection.js";
import { appendAuditEvent } from "../security/AuditHashChain.js";
import { ControlPlaneClient } from "../cloud/ControlPlaneClient.js";
import { FileRelayClient } from "../cloud/FileRelayClient.js";
import { LocalCloudIdentityStore, defaultProfileId } from "../cloud/LocalCloudIdentityStore.js";
import { RelayClient } from "../cloud/RelayClient.js";
import { createIntentExtractor } from "../intent/IntentExtractor.js";
import { createQueryRewriter } from "../intent/QueryRewriter.js";
import { PersonalAgentProtocol } from "../protocol/PersonalAgentProtocol.js";
import { search as hybridSearch } from "../retrieval/HybridRetrievalPipeline.js";
import { storeReceivedRelayFile } from "../storage/AgenticStorage.js";
import { createTask, transition } from "../workflow/TaskWorkflow.js";
import type { RelayInboxMessage } from "../cloud/RelayClient.js";
import { ChatRepository } from "../chat/ChatRepository.js";

export interface DispatchResult {
  relayTaskId: string;
  localTaskId: string;
  approvalId: string | null;
  status: "created" | "duplicate" | "failed";
}

export class RemoteTaskDispatcher {
  private intentExtractor = createIntentExtractor();

  constructor(
    private protocol: PersonalAgentProtocol,
    private db: DatabaseSync = getDb(),
    private profileId = defaultProfileId(),
    private chatRepo = new ChatRepository(db)
  ) {}

  async dispatch(message: RelayInboxMessage): Promise<DispatchResult> {
    const existing = this.db.prepare(
      "SELECT * FROM local_relay_dispatches WHERE profile_id = ? AND relay_task_id = ?"
    ).get(this.profileId, message.relay_task_id) as Record<string, unknown> | undefined;
    if (existing) {
      return {
        relayTaskId: message.relay_task_id,
        localTaskId: String(existing.local_task_id),
        approvalId: null,
        status: "duplicate"
      };
    }

    if (message.type === "file.transfer.available") {
      return this.handleTransferAvailable(message);
    }
    if (message.type === "file.transfer.receipt") {
      return this.handleTransferReceipt(message);
    }

    const now = new Date().toISOString();
    try {
      const text = extractRequestText(message.payload);
      const conversation = this.chatRepo.createConversation({
        id: `relay_${message.from_agent_instance_id}`,
        localAgentInstanceId: message.to_agent_instance_id,
        peerAgentInstanceId: message.from_agent_instance_id,
        mode: "cloud_relay",
        title: `Remote agent ${shortId(message.from_agent_instance_id)}`
      });
      const task = createTask({
        contextId: message.a2a_task_id ?? message.relay_task_id,
        type: "file.request.search",
        metadata: {
          query: text,
          relayTaskId: message.relay_task_id,
          fromAgentInstanceId: message.from_agent_instance_id,
          remote: true
        },
        actorAgentId: message.from_agent_instance_id
      });
      this.chatRepo.appendMessage({
        conversationId: conversation.id,
        taskId: task.id,
        senderAgentInstanceId: message.from_agent_instance_id,
        receiverAgentInstanceId: message.to_agent_instance_id,
        messageType: "file_request",
        text,
        payload: {
          requester: message.from_agent_instance_id,
          target: message.to_agent_instance_id,
          natural_language_request: text,
          query: text,
          status: "received",
          relay_task_id: message.relay_task_id
        },
        deliveryStatus: "delivered"
      });
      transition(task.id, "INTENT_CLASSIFIED", { intent: this.intentExtractor.extract(text).intent, remote: true });
      transition(task.id, "SEARCH_QUERY_BUILT", { query: text });
      const rewritten = createQueryRewriter().rewrite(text);
      const searchQuery = rewritten.semanticQuery || text;
      transition(task.id, "LOCAL_SEARCH_RUNNING", { query: searchQuery });
      this.chatRepo.appendMessage({
        conversationId: conversation.id,
        taskId: task.id,
        senderAgentInstanceId: message.to_agent_instance_id,
        receiverAgentInstanceId: message.from_agent_instance_id,
        messageType: "agent_status",
        text: "Your agent is searching local files",
        payload: { phase: "searching", relay_task_id: message.relay_task_id },
        deliveryStatus: "delivered"
      });
      const candidates = hybridSearch(searchQuery, { limit: 10 });
      transition(task.id, "CANDIDATES_RANKED", { count: candidates.length });
      const top = candidates[0];
      const approval = await this.protocol.createApproval(task.id, {
        approvalType: "file.transfer.offer",
        requesterAgentId: message.from_agent_instance_id,
        ownerAgentId: message.to_agent_instance_id,
        selectedFileId: top ? String(top.id) : null,
        boundFilePath: top?.filePath ?? null,
        boundSha256: null,
        boundSizeBytes: top?.sizeBytes ?? null
      });
      transition(task.id, "APPROVAL_REQUIRED", {
        approvalId: approval.id,
        candidateCount: candidates.length,
        remote: true
      });
      this.chatRepo.appendMessage({
        conversationId: conversation.id,
        taskId: task.id,
        senderAgentInstanceId: message.to_agent_instance_id,
        receiverAgentInstanceId: message.from_agent_instance_id,
        messageType: "agent_status",
        text: `Your agent found ${candidates.length} candidates`,
        payload: { phase: "input_required", relay_task_id: message.relay_task_id },
        deliveryStatus: "delivered"
      });
      this.chatRepo.appendMessage({
        conversationId: conversation.id,
        taskId: task.id,
        senderAgentInstanceId: message.to_agent_instance_id,
        receiverAgentInstanceId: message.from_agent_instance_id,
        messageType: "approval",
        text: "Approval required",
        payload: {
          approval_id: approval.id,
          task_id: task.id,
          requester: message.from_agent_instance_id,
          request_text: text,
          status: approval.status,
          expires_at: approval.expiresAt,
          selected_candidate_id: approval.selectedFileId,
          candidates: candidates.map((candidate) => ({
            candidate_id: String(candidate.id),
            file_name: candidate.fileName,
            display_path: candidate.displayPath,
            extension: candidate.extension,
            mime_type: "application/octet-stream",
            size_bytes: candidate.sizeBytes,
            modified_at: candidate.modifiedAt,
            match_score: candidate.score,
            match_reason: candidate.reason,
            safety_labels: ["Approval required", "Local path hidden from recipient"]
          }))
        },
        deliveryStatus: "delivered"
      });
      this.record(message, "created", task.id, null, now);
      return { relayTaskId: message.relay_task_id, localTaskId: task.id, approvalId: approval.id, status: "created" };
    } catch (err) {
      this.record(message, "failed", null, err instanceof Error ? err.message : String(err), now);
      return { relayTaskId: message.relay_task_id, localTaskId: "", approvalId: null, status: "failed" };
    }
  }

  private async handleTransferAvailable(message: RelayInboxMessage): Promise<DispatchResult> {
    const now = new Date().toISOString();
    const taskId = stringPayload(message, "task_id") || message.a2a_task_id || message.relay_task_id;
    try {
      const identity = new LocalCloudIdentityStore(this.db).get(this.profileId);
      if (!identity?.deviceAccessToken || !identity.agentInstanceId) {
        throw new Error("Cloud enrollment is required before transfer download");
      }
      const transferId = requirePayload(message, "transfer_id");
      const expectedSha = requirePayload(message, "sha256").toLowerCase();
      const fileName = requirePayload(message, "file_name");
      const cp = new ControlPlaneClient(identity.controlPlaneUrl);
      const files = new FileRelayClient(cp);
      const relay = new RelayClient(cp);
      const downloaded = await files.download(transferId, identity.deviceAccessToken);
      const stored = storeReceivedRelayFile({
        transferId,
        senderAgentId: message.from_agent_instance_id,
        fileName: downloaded.file_name || fileName,
        data: downloaded.body,
        sha256: expectedSha
      });
      const displayPath = `Agentic App Storage/${stored.originalFileName}`;
      await files.receipt(transferId, {
        stored_path: displayPath,
        verified_sha256: stored.sha256
      }, identity.deviceAccessToken);
      await relay.send({
        to_agent_instance_id: message.from_agent_instance_id,
        a2a_task_id: taskId,
        type: "file.transfer.receipt",
        payload: {
          transfer_id: transferId,
          task_id: taskId,
          file_name: stored.originalFileName,
          size_bytes: stored.sizeBytes,
          sha256: stored.sha256,
          stored_path_display: displayPath,
          received_at: stored.receivedAt,
          hash_verified: true
        },
        idempotency_key: `transfer-receipt:${transferId}`
      }, identity.deviceAccessToken);

      const conversation = this.chatRepo.createConversation({
        id: `relay_${message.from_agent_instance_id}`,
        localAgentInstanceId: message.to_agent_instance_id,
        peerAgentInstanceId: message.from_agent_instance_id,
        mode: "cloud_relay",
        title: `Remote agent ${shortId(message.from_agent_instance_id)}`
      });
      this.chatRepo.appendMessage({
        conversationId: conversation.id,
        taskId,
        senderAgentInstanceId: message.from_agent_instance_id,
        receiverAgentInstanceId: message.to_agent_instance_id,
        messageType: "receipt",
        text: "Stored and hash verified",
        payload: {
          transfer_id: transferId,
          task_id: taskId,
          file_name: stored.originalFileName,
          size_bytes: stored.sizeBytes,
          sha256: stored.sha256,
          sender: message.from_agent_instance_id,
          stored_path_display: displayPath,
          received_at: stored.receivedAt,
          hash_verified: true
        },
        deliveryStatus: "delivered"
      });
      appendAuditEvent({
        actorAgentId: message.to_agent_instance_id,
        taskId,
        eventType: "CLOUD_TRANSFER_RECEIVED",
        detailsJson: { transferId, fileName: stored.originalFileName, sha256: stored.sha256 }
      });
      this.record(message, "created", taskId, null, now);
      return { relayTaskId: message.relay_task_id, localTaskId: taskId, approvalId: null, status: "created" };
    } catch (err) {
      this.record(message, "failed", taskId, err instanceof Error ? err.message : String(err), now);
      return { relayTaskId: message.relay_task_id, localTaskId: taskId, approvalId: null, status: "failed" };
    }
  }

  private handleTransferReceipt(message: RelayInboxMessage): DispatchResult {
    const taskId = stringPayload(message, "task_id") || message.a2a_task_id || message.relay_task_id;
    const conversation = this.chatRepo.createConversation({
      id: `relay_${message.from_agent_instance_id}`,
      localAgentInstanceId: message.to_agent_instance_id,
      peerAgentInstanceId: message.from_agent_instance_id,
      mode: "cloud_relay",
      title: `Remote agent ${shortId(message.from_agent_instance_id)}`
    });
    this.chatRepo.appendMessage({
      conversationId: conversation.id,
      taskId,
      senderAgentInstanceId: message.from_agent_instance_id,
      receiverAgentInstanceId: message.to_agent_instance_id,
      messageType: "receipt",
      text: "Receiver stored and verified the file",
      payload: message.payload,
      deliveryStatus: "delivered"
    });
    this.record(message, "created", taskId, null, new Date().toISOString());
    return { relayTaskId: message.relay_task_id, localTaskId: taskId, approvalId: null, status: "created" };
  }

  private record(message: RelayInboxMessage, status: string, localTaskId: string | null, error: string | null, now: string): void {
    this.db.prepare(`
      INSERT INTO local_relay_dispatches
        (profile_id, relay_task_id, a2a_task_id, type, status, local_task_id, payload_json, error_text, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      this.profileId,
      message.relay_task_id,
      message.a2a_task_id ?? null,
      message.type,
      status,
      localTaskId,
      JSON.stringify(redactLocalPaths(message.payload)),
      error,
      now,
      now
    );
  }
}

function requirePayload(message: RelayInboxMessage, key: string): string {
  const value = stringPayload(message, key);
  if (!value) throw new Error(`Relay payload missing ${key}`);
  return value;
}

function stringPayload(message: RelayInboxMessage, key: string): string | null {
  const value = message.payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function shortId(value: string): string {
  return value.length <= 14 ? value : `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function extractRequestText(payload: Record<string, unknown>): string {
  const candidates = [
    payload.text,
    payload.query,
    payload.prompt,
    typeof payload.message === "object" && payload.message ? (payload.message as Record<string, unknown>).text : null
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return JSON.stringify(payload);
}

function redactLocalPaths(payload: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    clone[key] = /path/i.test(key) ? "[redacted]" : value;
  }
  return clone;
}
