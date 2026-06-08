import type { FileCandidateApprovalCard } from "../types";
import { localAgentClient } from "./localAgentClient";
import { cloudAuthApi } from "./cloudAuthApi";
import { cloudDirectoryApi } from "./cloudDirectoryApi";
import { chatApi } from "./chatApi";
import { relayApi } from "./relayApi";
import { approvalsApi } from "./approvalsApi";
import { filesApi } from "./filesApi";
import { auditApi } from "./auditApi";

export const api = {
  health: () => localAgentClient.get<{
    status: string;
    dryRun: boolean;
    localAgentUrl?: string;
    controlPlaneUrl?: string;
    defaultOrgSlug?: string;
  }>("/health"),
  cloudStatus: cloudAuthApi.cloudStatus,
  signup: cloudAuthApi.signup,
  login: cloudAuthApi.login,
  logout: cloudAuthApi.logout,
  enroll: cloudAuthApi.enroll,
  me: cloudAuthApi.me,
  directoryUsers: cloudDirectoryApi.directoryUsers,
  userAgents: cloudDirectoryApi.userAgents,
  contacts: cloudDirectoryApi.contacts,
  requestContact: cloudDirectoryApi.requestContact,
  acceptContact: cloudDirectoryApi.acceptContact,
  conversations: chatApi.conversations,
  createConversation: chatApi.createConversation,
  conversationMessages: chatApi.messages,
  sendChatMessage: chatApi.send,
  localChat: chatApi.localChat,
  sendMessage: relayApi.sendMessage,
  sendFileRequest: relayApi.sendFileRequest,
  pendingApprovals: approvalsApi.pending,
  approve: approvalsApi.approve,
  reject: approvalsApi.reject,
  feedback: approvalsApi.feedback,
  rebindFile: approvalsApi.rebindFile,
  files: filesApi.receivedFiles,
  audit: auditApi.events,
  relayInboxStatus: relayApi.inboxStatus
};

export function mapApproval(row: Record<string, unknown>): FileCandidateApprovalCard {
  const selectedFileId = row.selected_file_id ?? row.selectedFileId;
  const boundFilePath = row.bound_file_path ?? row.boundFilePath;
  const boundSizeBytes = row.bound_size_bytes ?? row.boundSizeBytes;
  const createdAt = row.created_at ?? row.createdAt ?? new Date().toISOString();
  const expiresAt = row.expires_at ?? row.expiresAt ?? createdAt;
  const feedbackText = row.feedback_text ?? row.feedbackText;
  const candidates = Array.isArray(row.candidates) ? row.candidates as Array<Record<string, unknown>> : [];

  return {
    approval_id: String(row.id ?? row.approvalId ?? ""),
    task_id: String(row.task_id ?? row.taskId ?? ""),
    requester: String(row.requester_agent_id ?? row.requesterAgentId ?? "remote agent"),
    request_text: String(row.request_text ?? row.requestText ?? row.approval_type ?? "File request"),
    candidates: candidates.length > 0
      ? candidates.map((candidate) => ({
          candidate_id: String(candidate.candidate_id ?? candidate.id ?? ""),
          file_name: String(candidate.file_name ?? candidate.fileName ?? "Candidate file"),
          display_path: String(candidate.display_path ?? candidate.displayPath ?? "Local path hidden from recipient"),
          extension: String(candidate.extension ?? ""),
          mime_type: String(candidate.mime_type ?? candidate.mimeType ?? "application/octet-stream"),
          size_bytes: Number(candidate.size_bytes ?? candidate.sizeBytes ?? 0),
          modified_at: String(candidate.modified_at ?? candidate.modifiedAt ?? createdAt),
          match_score: Number(candidate.match_score ?? candidate.score ?? 0),
          match_reason: String(candidate.match_reason ?? candidate.reason ?? "Search candidate"),
          safety_labels: Array.isArray(candidate.safety_labels) ? candidate.safety_labels.map(String) : ["Approval required"]
        }))
      : selectedFileId
        ? [{
            candidate_id: String(selectedFileId),
            file_name: String(boundFilePath ?? "Selected local file").split(/[\\/]/).pop() ?? "Selected local file",
            display_path: "Local path hidden from recipient",
            extension: "",
            mime_type: "application/octet-stream",
            size_bytes: Number(boundSizeBytes ?? 0),
            modified_at: String(createdAt),
            match_score: 1,
            match_reason: "Bound approval candidate",
            safety_labels: ["Approval required", "Local path hidden from recipient"]
          }]
        : [],
    selected_candidate_id: selectedFileId ? String(selectedFileId) : null,
    status: String(row.status ?? "pending") as FileCandidateApprovalCard["status"],
    feedback_text: feedbackText ? String(feedbackText) : null,
    expires_at: String(expiresAt)
  };
}

export {
  auditApi,
  approvalsApi,
  chatApi,
  cloudAuthApi,
  cloudDirectoryApi,
  filesApi,
  localAgentClient,
  relayApi
};
