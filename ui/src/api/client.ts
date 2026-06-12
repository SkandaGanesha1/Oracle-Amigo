import type { FileCandidateApprovalCard, Mission, MissionStep, MissionStatus, TrustRelationship, TrustLevel, Conversation } from "../types";
import type { MissionsListResult, ConsentActionRequest, TrustGraphResult } from "./types";
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

function buildMissionsFromConversations(data: { conversations: Conversation[] }): Mission[] {
  return (data.conversations ?? []).flatMap((conv) => {
    const missions: Mission[] = [];
    const approvalMessages = (conv.messages ?? []).filter((m) => m.kind === "approval");
    const agentStatusMessages = (conv.messages ?? []).filter((m) => m.kind === "agent_status");
    const transferMessages = (conv.messages ?? []).filter((m) => m.kind === "transfer" || m.kind === "receipt");

    if (approvalMessages.length === 0 && agentStatusMessages.length === 0) return [];

    for (const msg of approvalMessages) {
      if (msg.kind !== "approval") continue;
      const card = msg.card;
      const steps: MissionStep[] = [
        { id: `search-${msg.id}`, label: "Search", kind: "search", status: "completed", description: `Agent searched for: ${card.request_text}` },
        { id: `approval-${msg.id}`, label: "Approval", kind: "approval", status: card.status === "pending" ? "running" : "completed", description: `Approval ${card.status}` },
        { id: `transfer-${msg.id}`, label: "Transfer", kind: "transfer", status: "skipped", description: "Awaiting approval" },
      ];
      const hasTransfer = transferMessages.some((t) =>
        (t.kind === "transfer" || t.kind === "receipt") &&
        t.task_id === card.task_id
      );
      if (hasTransfer) steps[2].status = "completed";

      const fileName = card.candidates[0]?.file_name ?? card.request_text;
      missions.push({
        id: `mission-${msg.id}`,
        title: `File Request: ${fileName}`,
        description: card.request_text,
        status: card.status === "pending" ? "awaiting_approval" as MissionStatus : card.status === "expired" ? "failed" as MissionStatus : "completed" as MissionStatus,
        createdAt: msg.created_at,
        updatedAt: msg.created_at,
        requesterName: formatRequesterName(card.requester),
        requesterAgentName: formatRequesterName(card.requester),
        requesterAgentVerified: false,
        recipientName: "Me",
        recipientAgentName: "My Local Agent",
        steps,
        activeStepIndex: steps.findIndex((s) => s.status === "running"),
        consentRecordId: card.approval_id,
        conversationId: conv.id,
        artifactCount: 0,
        transferCount: hasTransfer ? 1 : 0,
      });
    }

    return missions;
  });
}

function formatRequesterName(id: string): string {
  if (/^ag[ei][_-]/i.test(id.trim())) return "Remote agent";
  if (id.length > 20 && id.includes("_")) return "Remote agent";
  return id;
}

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
  resetDeviceIdentity: cloudAuthApi.resetDeviceIdentity,
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
  biometricCapability: biometricApi.capability,
  relayInboxStatus: relayApi.inboxStatus,
  relayTaskStatus: relayApi.taskStatus,

  missions: async (): Promise<MissionsListResult> => {
    const convs = await chatApi.conversations();
    return { missions: buildMissionsFromConversations(convs) };
  },

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
  },

  trustGraph: async (): Promise<TrustGraphResult> => {
    const result = await cloudDirectoryApi.contacts();
    const contacts: Record<string, unknown>[] = (result?.contacts ?? []) as unknown as Record<string, unknown>[];
    const relationships: TrustRelationship[] = contacts.map((contact) => ({
      agentPairId: String(contact.id ?? ""),
      localAgentInstanceId: "",
      remoteAgentInstanceId: String((contact as Record<string, unknown>).requester_user_id ?? (contact as Record<string, unknown>).target_user_id ?? ""),
      remoteAgentName: String((contact as Record<string, unknown>).display_name ?? (contact as Record<string, unknown>).email ?? "Unknown agent"),
      remoteAgentOwnerName: String((contact as Record<string, unknown>).display_name ?? (contact as Record<string, unknown>).email ?? "Unknown"),
      trustLevel: "unverified" as TrustLevel,
      capabilities: ["request files", "send messages"],
      permissionScope: "Request files from local vault",
      isBlocked: false,
      lastInteractionAt: String((contact as Record<string, unknown>).updated_at ?? null),
      requestCount: 0,
      createdAt: String((contact as Record<string, unknown>).updated_at ?? new Date().toISOString()),
    }));
    return { relationships };
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
