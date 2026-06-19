import type { DatabaseSync } from "node:sqlite";
import { getDb } from "../db/connection.js";
import { appendAuditEvent } from "../security/AuditHashChain.js";
import { ControlPlaneClient } from "../cloud/ControlPlaneClient.js";
import { FileRelayClient } from "../cloud/FileRelayClient.js";
import { LocalCloudIdentityStore, defaultProfileId } from "../cloud/LocalCloudIdentityStore.js";
import { RelayClient } from "../cloud/RelayClient.js";
import { createIntentExtractor } from "../intent/IntentExtractor.js";
import { FileSearchService } from "../file-search/FileSearchService.js";
import { PersonalAgentProtocol } from "../protocol/PersonalAgentProtocol.js";
import { storeReceivedRelayFile } from "../storage/AgenticStorage.js";
import { createTask, transition } from "../workflow/TaskWorkflow.js";
import type { RelayInboxMessage } from "../cloud/RelayClient.js";
import { ChatRepository, type RelayDeliveryReceipt } from "../chat/ChatRepository.js";
import { withRecoveredDeviceToken } from "./CloudTokenRecovery.js";
import { PeerRoutingService } from "./PeerRoutingService.js";
import { resolveFileRequestCandidates, toApprovalCandidatePayload } from "./FileRequestCandidateResolver.js";
import { ReceiverAgentOrchestrator } from "./ReceiverAgentOrchestrator.js";

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
    private chatRepo = new ChatRepository(db),
    private fileSearch = new FileSearchService()
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

    const relayMessageType = String(message.type ?? "").trim().toLowerCase();
    const payloadKind = String(message.payload?.kind ?? "").trim().toLowerCase();

    if (relayMessageType === "file.transfer.available") {
      return this.handleTransferAvailable(message);
    }
    if (relayMessageType === "file.transfer.receipt") {
      return this.handleTransferReceipt(message);
    }
    if (relayMessageType === "file.request.status" || payloadKind === "file_request_status") {
      return this.handleFileRequestStatus(message);
    }
    if (relayMessageType === "message.send" || payloadKind === "message") {
      return this.handleMessageSend(message);
    }

    if (relayMessageType === "file.request" && message.payload && typeof message.payload === "object" && "voice_command_id" in message.payload) {
      return this.handleIncomingFileRequest(message);
    }

    const now = new Date().toISOString();
    try {
      const text = extractRequestText(message.payload);
      const conversation = await this.findOrCreateRelayConversation(message, "file.request");
      await this.sendFileRequestStatus(message, "request_delivered", "Request delivered to receiver agent").catch(() => {
        // Status events are best-effort; the local request flow remains authoritative.
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
          requester: conversation.title || message.from_agent_instance_id,
          target: message.to_agent_instance_id,
          natural_language_request: text,
          query: text,
          status: "received",
          relay_task_id: message.relay_task_id
        },
        deliveryStatus: "delivered"
      });
      transition(task.id, "INTENT_CLASSIFIED", { intent: this.intentExtractor.extract(text).intent, remote: true });
      await this.sendFileRequestStatus(message, "searching_receiver_files", "Receiver agent is searching local files").catch(() => {
        // Best-effort.
      });
      const resolved = await resolveFileRequestCandidates(text, this.fileSearch, { limit: 10 });
      transition(task.id, "SEARCH_QUERY_BUILT", { query: resolved.searchQuery });
      transition(task.id, "LOCAL_SEARCH_RUNNING", { query: resolved.searchQuery, source: resolved.source });
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
      const candidates = resolved.candidates;
      transition(task.id, "CANDIDATES_RANKED", { count: candidates.length });
      await this.sendFileRequestStatus(
        message,
        candidates.length > 0 ? "waiting_for_approval" : "no_candidate_found_waiting_for_refinement",
        candidates.length > 0
          ? "Receiver found candidate files and is waiting for owner approval"
          : "Receiver found no candidate files and is waiting for refinement or manual selection",
        {
          candidate_count: candidates.length,
          parsed_filename: resolved.parsed.exactFilename,
          search_source: resolved.source
        }
      ).catch(() => {
        // Best-effort.
      });
      const top = candidates[0];
      const boundTop = top && isHighConfidenceFileCandidate(top) ? top : null;
      const approval = await this.protocol.createApproval(task.id, {
        approvalType: boundTop ? "file.transfer.offer" : "file.search.refinement",
        requesterAgentId: message.from_agent_instance_id,
        ownerAgentId: message.to_agent_instance_id,
        selectedFileId: boundTop?.id ?? null,
        boundFilePath: boundTop?.boundFilePath ?? null,
        boundSha256: boundTop?.boundSha256 ?? null,
        boundSizeBytes: boundTop?.boundSizeBytes ?? null
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
        text: candidates.length > 0
          ? `Your agent found ${candidates.length} candidates`
          : "No candidate files found. Waiting for refinement or manual file choice.",
        payload: {
          phase: candidates.length > 0 ? "input_required" : "needs_refinement",
          relay_task_id: message.relay_task_id,
          parsed_filename: resolved.parsed.exactFilename,
          search_source: resolved.source
        },
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
          requester: conversation.title || message.from_agent_instance_id,
          request_text: text,
          requester_display_name: conversation.title || `Remote agent ${shortId(message.from_agent_instance_id)}`,
          target_display_name: "Local agent",
          status: approval.status,
          expires_at: approval.expiresAt,
          selected_candidate_id: approval.selectedFileId,
          approval_type: approval.approvalType,
          is_bound: Boolean(approval.boundFilePath && approval.boundSha256),
          search_source: resolved.source,
          parsed_filename: resolved.parsed.exactFilename,
          candidates: candidates.map(toApprovalCandidatePayload),
          low_confidence_candidates: resolved.lowConfidenceCandidates.map(toApprovalCandidatePayload),
          privacy_labels: ["Approval required", "Local path hidden from requester"]
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

  private async handleIncomingFileRequest(message: RelayInboxMessage): Promise<DispatchResult> {
    const now = new Date().toISOString();
    const text = extractRequestText(message.payload);
    const conversation = await this.findOrCreateRelayConversation(message, "file.request");

    await this.sendFileRequestStatus(message, "request_delivered", "Request delivered to receiver agent").catch(() => {});

    // Create a local task to track the state
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

    try {
      transition(task.id, "INTENT_CLASSIFIED", { intent: this.intentExtractor.extract(text).intent, remote: true });

      // Call ReceiverAgentOrchestrator to handle incoming request (file search + approval card + insert db)
      const orchestrator = new ReceiverAgentOrchestrator(this.db, this.profileId, this.chatRepo, this.fileSearch);
      const approval = await orchestrator.handleIncomingFileRequest(message, conversation.id, task.id);
      const candidateCount = JSON.parse(approval.candidatesJson).length;

      transition(task.id, "SEARCH_QUERY_BUILT", { query: text });
      transition(task.id, "LOCAL_SEARCH_RUNNING", { query: text, source: "hybrid" });
      transition(task.id, "CANDIDATES_RANKED", { count: candidateCount });
      transition(task.id, "APPROVAL_REQUIRED", { approvalId: approval.id, remote: true });

      await this.sendFileRequestStatus(
        message,
        candidateCount > 0 ? "waiting_for_approval" : "no_candidate_found_waiting_for_refinement",
        candidateCount > 0
          ? "Receiver found candidate files and is waiting for owner approval"
          : "Receiver found no candidate files and is waiting for refinement or manual selection",
        {
          candidate_count: candidateCount,
          parsed_filename: text,
          search_source: "hybrid"
        }
      ).catch(() => {});

      this.record(message, "created", task.id, null, now);
      return {
        relayTaskId: message.relay_task_id,
        localTaskId: task.id,
        approvalId: approval.id,
        status: "created"
      };
    } catch (err) {
      this.record(message, "failed", task.id, err instanceof Error ? err.message : String(err), now);
      return {
        relayTaskId: message.relay_task_id,
        localTaskId: task.id,
        approvalId: null,
        status: "failed"
      };
    }
  }

  private async handleMessageSend(message: RelayInboxMessage): Promise<DispatchResult> {
    const now = new Date().toISOString();
    const localTaskId = message.a2a_task_id ?? message.relay_task_id;
    try {
      const text = extractRequestText(message.payload);
      const conversation = await this.findOrCreateRelayConversation(message, "message.send");
      this.chatRepo.appendMessage({
        conversationId: conversation.id,
        taskId: localTaskId,
        senderAgentInstanceId: message.from_agent_instance_id,
        receiverAgentInstanceId: message.to_agent_instance_id,
        messageType: "human",
        text,
        payload: {
          relay_task_id: message.relay_task_id,
          a2a_task_id: message.a2a_task_id,
          message_kind: "message.send",
          sender_label: conversation.title || `Remote agent ${shortId(message.from_agent_instance_id)}`
        },
        deliveryStatus: "stored_by_remote_agent"
      });
      await this.sendDeliveryReceipt(message, {
        relay_task_id: message.relay_task_id,
        status: "stored_by_remote_agent",
        delivered_at: now,
        from_agent_instance_id: message.to_agent_instance_id,
        to_agent_instance_id: message.from_agent_instance_id
      }).catch(() => {
        // The local write is the source of truth; relay receipt is best-effort.
      });
      this.record(message, "created", localTaskId, null, now);
      return {
        relayTaskId: message.relay_task_id,
        localTaskId,
        approvalId: null,
        status: "created"
      };
    } catch (err) {
      const messageText = err instanceof Error ? err.message : String(err);
      await this.sendDeliveryReceipt(message, {
        relay_task_id: message.relay_task_id,
        status: "failed",
        delivered_at: now,
        error: messageText,
        from_agent_instance_id: message.to_agent_instance_id,
        to_agent_instance_id: message.from_agent_instance_id
      }).catch(() => {
        // Keep the failed dispatch unacked so the relay can retry.
      });
      this.record(message, "failed", localTaskId, messageText, now);
      return { relayTaskId: message.relay_task_id, localTaskId, approvalId: null, status: "failed" };
    }
  }

  private async handleTransferAvailable(message: RelayInboxMessage): Promise<DispatchResult> {
    const now = new Date().toISOString();
    const taskId = stringPayload(message, "task_id") || message.a2a_task_id || message.relay_task_id;
    try {
      const store = new LocalCloudIdentityStore(this.db);
      const identity = store.get(this.profileId);
      if (!identity?.deviceAccessToken || !identity.agentInstanceId) {
        throw new Error("Cloud enrollment is required before transfer download");
      }
      const transferId = requirePayload(message, "transfer_id");
      const expectedSha = requirePayload(message, "sha256").toLowerCase();
      const fileName = requirePayload(message, "file_name");
      const downloaded = await withRecoveredDeviceToken(store, this.profileId, async (fresh) =>
        new FileRelayClient(new ControlPlaneClient(fresh.controlPlaneUrl)).download(transferId, fresh.deviceAccessToken!)
      );
      const stored = storeReceivedRelayFile({
        transferId,
        senderAgentId: message.from_agent_instance_id,
        fileName: downloaded.file_name || fileName,
        data: downloaded.body,
        sha256: expectedSha
      });
      const displayPath = `Agentic App Storage/${stored.originalFileName}`;
      await withRecoveredDeviceToken(store, this.profileId, async (fresh) =>
        new FileRelayClient(new ControlPlaneClient(fresh.controlPlaneUrl)).receipt(transferId, {
          stored_path: displayPath,
          verified_sha256: stored.sha256
        }, fresh.deviceAccessToken!)
      );
      await withRecoveredDeviceToken(store, this.profileId, async (fresh) =>
        new RelayClient(new ControlPlaneClient(fresh.controlPlaneUrl)).send({
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
        }, fresh.deviceAccessToken!)
      );

      const conversation = await this.findOrCreateRelayConversation(message, "file.transfer");
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

  private async handleTransferReceipt(message: RelayInboxMessage): Promise<DispatchResult> {
    const taskId = stringPayload(message, "task_id") || message.a2a_task_id || message.relay_task_id;
    const conversation = await this.findOrCreateRelayConversation(message, "file.transfer");
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
    this.chatRepo.appendMessage({
      conversationId: conversation.id,
      taskId,
      senderAgentInstanceId: message.from_agent_instance_id,
      receiverAgentInstanceId: message.to_agent_instance_id,
      messageType: "agent_status",
      text: "File received and hash verified",
      payload: {
        ...message.payload,
        kind: "file_request_status",
        status: "file_received_hash_verified"
      },
      deliveryStatus: "delivered"
    });
    this.record(message, "created", taskId, null, new Date().toISOString());
    return { relayTaskId: message.relay_task_id, localTaskId: taskId, approvalId: null, status: "created" };
  }

  private async handleFileRequestStatus(message: RelayInboxMessage): Promise<DispatchResult> {
    const now = new Date().toISOString();
    const taskId = stringPayload(message, "task_id") || message.a2a_task_id || message.relay_task_id;
    try {
      const conversation = await this.findOrCreateRelayConversation(message, "file.request");
      const status = stringPayload(message, "status") ?? "status_update";
      const text = stringPayload(message, "text") ?? humanFileRequestStatus(status);
      this.chatRepo.appendMessage({
        conversationId: conversation.id,
        taskId,
        senderAgentInstanceId: message.from_agent_instance_id,
        receiverAgentInstanceId: message.to_agent_instance_id,
        messageType: "agent_status",
        text,
        payload: {
          ...message.payload,
          kind: "file_request_status",
          status
        },
        deliveryStatus: "delivered"
      });
      this.record(message, "created", taskId, null, now);
      return { relayTaskId: message.relay_task_id, localTaskId: taskId, approvalId: null, status: "created" };
    } catch (err) {
      this.record(message, "failed", taskId, err instanceof Error ? err.message : String(err), now);
      return { relayTaskId: message.relay_task_id, localTaskId: taskId, approvalId: null, status: "failed" };
    }
  }

  private async findOrCreateRelayConversation(message: RelayInboxMessage, capability = "message.send") {
    const store = new LocalCloudIdentityStore(this.db);
    const cloud = store.get(this.profileId);
    const route = await new PeerRoutingService(this.chatRepo, {
      identityStore: store,
      profileId: this.profileId
    }).resolveTarget({
      peerAgentInstanceId: message.from_agent_instance_id,
      capability,
      cloud
    });
    const peerUserId = route.userId ?? null;
    const peerAgentInstanceId = route.agentInstanceId ?? message.from_agent_instance_id;
    const title = route.displayName || `Remote agent ${shortId(message.from_agent_instance_id)}`;

    return this.chatRepo.getOrCreateCanonicalRelayConversation({
      localAgentInstanceId: message.to_agent_instance_id,
      peerUserId,
      peerAgentInstanceId,
      mode: "cloud_relay",
      title
    });
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

  private async sendDeliveryReceipt(message: RelayInboxMessage, receipt: RelayDeliveryReceipt): Promise<void> {
    const store = new LocalCloudIdentityStore(this.db);
    await withRecoveredDeviceToken(store, this.profileId, async (fresh) =>
      new RelayClient(new ControlPlaneClient(fresh.controlPlaneUrl)).respond(message.relay_task_id, { ...receipt }, fresh.deviceAccessToken!)
    );
  }

  private async sendFileRequestStatus(
    message: RelayInboxMessage,
    status: string,
    text: string,
    extra: Record<string, unknown> = {}
  ): Promise<void> {
    const store = new LocalCloudIdentityStore(this.db);
    await withRecoveredDeviceToken(store, this.profileId, async (fresh) =>
      new RelayClient(new ControlPlaneClient(fresh.controlPlaneUrl)).send({
        to_agent_instance_id: message.from_agent_instance_id,
        a2a_task_id: message.a2a_task_id ?? message.relay_task_id,
        type: "file.request.status",
        payload: {
          kind: "file_request_status",
          original_relay_task_id: message.relay_task_id,
          task_id: message.a2a_task_id ?? message.relay_task_id,
          status,
          text,
          ...extra
        },
        idempotency_key: `file-request-status:${message.relay_task_id}:${status}`
      }, fresh.deviceAccessToken!)
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

function humanFileRequestStatus(status: string): string {
  switch (status) {
    case "request_delivered":
      return "Request delivered to receiver agent";
    case "searching_receiver_files":
      return "Receiver agent is searching local files";
    case "no_candidate_found_waiting_for_refinement":
      return "No candidate found. Waiting for refinement.";
    case "waiting_for_approval":
      return "Waiting for owner approval";
    case "transfer_starting":
      return "Transfer starting";
    case "file_received_hash_verified":
      return "File received and hash verified";
    default:
      return "File request status updated";
  }
}

function isHighConfidenceFileCandidate(candidate: { score: number; reason: string }): boolean {
  const reason = candidate.reason.toLowerCase();
  return candidate.score >= 0.75 || reason.includes("exact") || reason.includes("normalized");
}

function redactLocalPaths(payload: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    clone[key] = /path/i.test(key) ? "[redacted]" : value;
  }
  return clone;
}
