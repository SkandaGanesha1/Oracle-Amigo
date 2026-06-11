import type { LucideIcon } from "lucide-react";
import { z } from "zod";
import type { Mission, AuditEvent, ConsentRecord } from "../types";

export type RiskLevel = "low" | "medium" | "high";
export type Sensitivity = "low" | "medium" | "high" | "critical";
export type InboxAction = "preview" | "approve_once" | "redact_approve" | "ask_why" | "deny" | "revoke" | "snooze";
export type InboxItemType = "approval" | "mission" | "risk_alert";
export type MissionProgressStatus = "completed" | "current" | "pending" | "blocked";
export type BiometricType = "webauthn" | "windows_hello" | "fingerprint" | "pin_fallback";
export type InboxViewMode = "triage" | "search" | "privacy";
export type ChatViewMode = "main_timeline" | "threaded" | "thinking_bar_expanded" | "privacy_masked";

export interface TrustBadge {
  label: string;
  tone: "green" | "amber" | "red" | "blue";
}

export const ChainOfThoughtStepSchema = z.object({
  id: z.string(),
  description: z.string(),
  technicalTrace: z.string(),
  status: z.enum(["pending", "completed", "failed"]),
  timestamp: z.string(),
  toolUsed: z.string().optional(),
  confidence: z.number().min(0).max(1).optional()
});

export const ThinkingBarStateSchema = z.object({
  isActive: z.boolean(),
  steps: z.array(ChainOfThoughtStepSchema),
  currentStepId: z.string().optional(),
  summary: z.string(),
  progress: z.number().min(0).max(100),
  streamingText: z.string().optional()
});

export const MessageReactionSchema = z.object({
  emoji: z.string(),
  count: z.number().int().min(0),
  users: z.array(z.string())
});

export const SuggestedPromptSchema = z.object({
  text: z.string(),
  category: z.enum(["approval", "mission", "search", "memory"]),
  confidence: z.number().min(0).max(1)
});

export interface ChainOfThoughtStep {
  id: string;
  description: string;
  technicalTrace: string;
  status: "pending" | "completed" | "failed";
  timestamp: string;
  toolUsed?: string;
  confidence?: number;
}

export interface ThinkingBarState {
  isActive: boolean;
  steps: ChainOfThoughtStep[];
  currentStepId?: string;
  summary: string;
  progress: number;
  streamingText?: string;
}

export interface MessageReaction {
  emoji: string;
  count: number;
  users: string[];
}

export interface SuggestedPrompt {
  text: string;
  category: "approval" | "mission" | "search" | "memory";
  confidence: number;
}

export interface ChatSplitViewContext {
  messageId: string;
  trustGraph: Array<{ agentPairId?: string; trustLevel?: string; remoteAgentName?: string }>;
  riskScore: "low" | "medium" | "high";
  dataMovement: { leavesDevice: boolean; recipient?: unknown; expiresAt?: string; revocable: boolean };
  auditPreview: string[];
  memoryUsed: string[];
  actions: string[];
}

export interface ThreadedMessage {
  id: string;
  parentMessageId: string;
  content: string;
  author: { display_name?: string; agent_instance_id?: string };
  timestamp: string;
  reactions: MessageReaction[];
  missionId?: string;
}

export interface MissionProgress {
  stages: Array<{ name: string; status: MissionProgressStatus; timestamp?: string }>;
  currentStepDescription: string;
  percentage: number;
}

export interface BiometricCredential {
  type: BiometricType;
  verified: boolean;
  timestamp: string;
}

export interface RedactionConfig {
  pagesToRemove: number[];
  fieldsToRedact: string[];
  watermark: {
    text: string;
    position: "header" | "footer" | "diagonal";
    opacity: number;
    recipient: string;
  };
}

export interface PolicyRule {
  id: string;
  role: string;
  condition: {
    sensitivity?: Sensitivity;
    fileType?: string[];
    riskAbove?: RiskLevel;
    autoDeny?: boolean;
  };
  action: "allow" | "require_biometric" | "require_redaction" | "deny";
  expiresAt?: string;
}

export interface ActionableInboxItem {
  id: string;
  type: InboxItemType;
  title: string;
  summary: string;
  requester: {
    id?: string;
    name: string;
    owner?: string;
    trustBadge?: TrustBadge;
  };
  mission?: Mission;
  risk: RiskLevel;
  sensitivity: Sensitivity;
  actions: InboxAction[];
  progress?: MissionProgress;
  trustBadge: TrustBadge;
  isLeavingDevice: boolean;
  expiresAt?: string;
  watermarkText?: string;
  threadId?: string;
  privacyMasked: boolean;
  auditPreview?: string;
  lastUpdated: string;
}

export interface TriageGroup {
  id: "needs_approval" | "agent_working" | "waiting_on_others" | "risky" | "completed";
  label: string;
  icon: LucideIcon;
  count: number;
  items: ActionableInboxItem[];
  priority: number;
}

export interface UniversalSearchResult {
  id: string;
  type: "approval" | "conversation" | "file" | "mission" | "policy";
  title: string;
  summary: string;
  route: string;
}

export interface RedactedFile {
  id: string;
  fileName: string;
  sizeBytes: number;
  previewUrl?: string;
  auditEvent?: AuditEvent;
}

export interface InboxPolicyDecision {
  allowed: boolean;
  reason: string;
  requiredAction?: "biometric" | "redaction" | "deny";
}

export interface ThreadMessage {
  id: string;
  author: string;
  text: string;
  createdAt: string;
}

export interface PrivacySettings {
  enabled: boolean;
  maskFileNames: boolean;
  revealOnAuth: boolean;
}
