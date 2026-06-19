import type { AgentProfileDetail, FileCandidateApprovalCard, UserAgentSettings, VoiceCommandListResult, VoiceCommandRecord } from "../types";
import type { MissionsListResult, ConsentActionRequest } from "./types";
import { localAgentClient } from "./localAgentClient";
import { cloudAuthApi } from "./cloudAuthApi";
import { cloudDirectoryApi } from "./cloudDirectoryApi";
import { chatApi } from "./chatApi";
import { relayApi } from "./relayApi";
import { approvalsApi } from "./approvalsApi";
import { filesApi } from "./filesApi";
import { auditApi } from "./auditApi";
import { registryApi } from "./registryApi";
import { skillsApi } from "./skillsApi";
import { fileIndexApi } from "./fileIndexApi";
import { tasksApi } from "./tasksApi";
import { memoryApi } from "./memoryApi";
import { intentApi } from "./intentApi";
import { policyApi } from "./policyApi";
import { searchApi } from "./searchApi";
import { missionThreadsApi } from "./missionThreadsApi";
import { redactionsApi } from "./redactionsApi";
import { policyRulesApi } from "./policyRulesApi";
import { notificationsApi } from "./notificationsApi";
import { biometricApi } from "./biometricApi";
import { inboxApi } from "./inboxApi";

export const api = {
  health: () => localAgentClient.get<{
    status: string;
    dryRun: boolean;
    localAgentUrl?: string;
    controlPlaneUrl?: string;
    defaultOrgSlug?: string;
  }>("/health"),
  refreshLocalUiSession: () => localAgentClient.get<{
    ok: boolean;
    localUiSession: {
      enabled: boolean;
      runtime: string;
      cookieName: string;
      wasValid: boolean;
    };
  }>("/local-ui-session"),
  cloudStatus: cloudAuthApi.cloudStatus,
  signup: cloudAuthApi.signup,
  login: cloudAuthApi.login,
  logout: cloudAuthApi.logout,
  resetDeviceIdentity: cloudAuthApi.resetDeviceIdentity,
  enroll: cloudAuthApi.enroll,
  me: cloudAuthApi.me,
  directoryUsers: cloudDirectoryApi.directoryUsers,
  userAgents: cloudDirectoryApi.userAgents,
  contacts: cloudDirectoryApi.contacts,
  requestContact: cloudDirectoryApi.requestContact,
  acceptContact: cloudDirectoryApi.acceptContact,
  agentProfiles: () => localAgentClient.get<{ count: number; profiles: AgentProfileDetail[] }>("/agent-profiles"),
  conversations: chatApi.conversations,
  createConversation: chatApi.createConversation,
  conversationMessages: chatApi.messages,
  updateConversationReadState: chatApi.updateReadState,
  sendChatMessage: chatApi.send,
  pinChatMessage: chatApi.pinMessage,
  setChatMessageReaction: chatApi.setMessageReaction,
  chatThread: chatApi.thread,
  createChatThreadReply: chatApi.createThreadReply,
  chatDiagnostics: chatApi.diagnostics,
  createAgentRun: chatApi.createAgentRun,
  agentRuns: chatApi.agentRuns,
  agentRun: chatApi.agentRun,
  agentRunEventsUrl: chatApi.agentRunEventsUrl,
  localChat: chatApi.localChat,
  sendMessage: relayApi.sendMessage,
  sendFileRequest: relayApi.sendFileRequest,
  pendingApprovals: approvalsApi.pending,
  approve: approvalsApi.approve,
  reject: approvalsApi.reject,
  feedback: approvalsApi.feedback,
  rebindFile: approvalsApi.rebindFile,
  files: filesApi.receivedFiles,
  verifyFile: filesApi.verifyFile,
  fileIndexRoots: fileIndexApi.roots,
  indexFileRoots: fileIndexApi.indexRoots,
  reindexFiles: fileIndexApi.reindex,
  searchFiles: fileIndexApi.search,
  indexedFiles: fileIndexApi.indexed,
  transfers: fileIndexApi.transfers,
  audit: auditApi.events,
  auditVerify: auditApi.verify,
  registryAgents: registryApi.agents,
  updateRegistryTrust: registryApi.trust,
  discoverRegistryAgent: registryApi.discover,
  skills: skillsApi.list,
  a2aTasks: tasksApi.list,
  a2aTask: tasksApi.get,
  a2aTaskEventsUrl: tasksApi.eventsUrl,
  parseWorkflowEvent: tasksApi.parseWorkflowEvent,
  memoryConversations: memoryApi.conversations,
  memoryWindow: memoryApi.window,
  episodicMemory: memoryApi.episodic,
  longTermMemory: memoryApi.longTerm,
  classifyIntent: intentApi.classify,
  rewriteIntent: intentApi.rewrite,
  policySummary: policyApi.summary,
  evaluateCommandPolicy: policyApi.evaluateCommand,
  universalSearch: searchApi.universal,
  missionThread: missionThreadsApi.list,
  createMissionThreadMessage: missionThreadsApi.create,
  missionThreadEventsUrl: missionThreadsApi.eventsUrl,
  redactionPreview: redactionsApi.preview,
  applyRedaction: redactionsApi.apply,
  policyRules: policyRulesApi.list,
  createPolicyRule: policyRulesApi.create,
  updatePolicyRule: policyRulesApi.update,
  deletePolicyRule: policyRulesApi.remove,
  evaluatePolicyRule: policyRulesApi.evaluate,
  notifications: notificationsApi.list,
  createNotification: notificationsApi.create,
  inboxItems: inboxApi.items,
  inboxItem: inboxApi.item,
  inboxAction: inboxApi.action,
  inboxBulk: inboxApi.bulk,
  biometricCapability: biometricApi.capability,
  relayInboxStatus: relayApi.inboxStatus,
  relayTaskStatus: relayApi.taskStatus,

  missions: () => localAgentClient.get<MissionsListResult>("/missions"),
  mission: (missionId: string) => localAgentClient.get<{ mission: MissionsListResult["missions"][number] }>(`/missions/${encodeURIComponent(missionId)}`),

  voiceStatus: () => localAgentClient.get<Record<string, unknown>>("/voice/status"),
  voiceCommands: (limit = 50, offset = 0) => localAgentClient.get<VoiceCommandListResult>(`/voice/commands?limit=${limit}&offset=${offset}`),
  voiceCommand: (id: string) => localAgentClient.get<{ command: VoiceCommandRecord }>(`/voice/commands/${encodeURIComponent(id)}`),
  createVoiceCommand: (input: { transcript: string; source: string; locale?: string; input_mode?: "typed" | "speech"; sttConfidence?: number }) =>
    localAgentClient.post<{ command: VoiceCommandRecord }>(`/voice/commands`, input),
  confirmVoiceCommand: (id: string, input: { idempotency_key?: string } = {}) =>
    localAgentClient.post<{ command: VoiceCommandRecord }>(`/voice/commands/${encodeURIComponent(id)}/confirm`, input),
  cancelVoiceCommand: (id: string) =>
    localAgentClient.post<{ command: VoiceCommandRecord }>(`/voice/commands/${encodeURIComponent(id)}/cancel`, {}),
  voiceCommandEventsUrl: (id: string) => `/voice/commands/${encodeURIComponent(id)}/events`,

  userAgentSettings: () => localAgentClient.get<{ settings: UserAgentSettings }>("/settings/user-agent"),
  updateUserAgentSettings: (settings: UserAgentSettings) => localAgentClient.put<{ settings: UserAgentSettings }>("/settings/user-agent", settings),

  // Mission control endpoints
  pauseMission: async (taskId: string) => {
    return localAgentClient.post<{ ok: boolean; status: string }>(`/missions/${taskId}/pause`, {});
  },
  resumeMission: async (taskId: string) => {
    return localAgentClient.post<{ ok: boolean; status: string }>(`/missions/${taskId}/resume`, {});
  },
  cancelMission: async (taskId: string) => {
    return localAgentClient.post<{ ok: boolean; status: string }>(`/missions/${taskId}/cancel`, {});
  },
  retryMission: async (taskId: string) => {
    return localAgentClient.post<{ ok: boolean; taskId: string; status: string }>(`/missions/${taskId}/retry`, {});
  },

  consentAction: async (req: ConsentActionRequest): Promise<{ ok: boolean }> => {
    if (req.action === "approve") {
      await approvalsApi.approve(req.consentId);
    } else if (req.action === "reject") {
      await approvalsApi.reject(req.consentId);
    }
    return { ok: true };
  }
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
    requester: String(row.requester_display_name ?? row.requesterDisplayName ?? row.requester_agent_id ?? row.requesterAgentId ?? "remote agent"),
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
          preview_url: typeof candidate.preview_url === "string" ? candidate.preview_url : typeof candidate.previewUrl === "string" ? candidate.previewUrl : undefined,
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
            preview_url: undefined,
            safety_labels: ["Approval required", "Local path hidden from recipient"]
          }]
        : [],
    selected_candidate_id: selectedFileId ? String(selectedFileId) : null,
    is_bound: Boolean(row.is_bound ?? row.isBound ?? (selectedFileId && boundFilePath)),
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
  fileIndexApi,
  filesApi,
  intentApi,
  localAgentClient,
  memoryApi,
  policyApi,
  policyRulesApi,
  searchApi,
  missionThreadsApi,
  redactionsApi,
  notificationsApi,
  biometricApi,
  registryApi,
  relayApi,
  skillsApi,
  tasksApi
};
