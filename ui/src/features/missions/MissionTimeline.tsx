import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Search, FileText, ShieldCheck, ArrowRight, CheckCircle2, Loader2, XCircle, Bot, User, Globe, Clock, Ban, ExternalLink, ChevronDown, ChevronRight, MessageSquarePlus } from "lucide-react";
import { useConversationMessages } from "../../hooks/queries";
import { AgenticReasoning } from "../../components/agentic-ai/AgenticReasoning";
import { AgenticToolCall } from "../../components/agentic-ai/AgenticToolCall";
import { ApprovalCard } from "../../features/approvals/ApprovalCard";
import { FileReceiptMessage } from "../../components/agentic-ai/FileReceiptMessage";
import { MissionThreadPanel } from "./MissionThreadPanel";
import type { TimelineMessage, AgentStatusMessage, FileCandidateApprovalMessage, FileReceiptMessage as FileReceiptMessageType } from "../../api/types";

interface MissionTimelineProps {
  conversationId: string | null;
  onSelectApproval?: (approvalId: string) => void;
}

function messageTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatMissionDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

interface MissionStep {
  id: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  timestamp: string;
  kind: "request" | "search" | "approval" | "transfer" | "receipt" | "reasoning" | "tool_call";
  message: TimelineMessage;
}

function buildMissionSteps(messages: TimelineMessage[]): MissionStep[] {
  const steps: MissionStep[] = [];
  let hasRequest = false;

  for (const msg of messages) {
    if (msg.kind === "human") {
      steps.push({
        id: `request-${msg.id}`,
        label: "Request",
        status: "completed",
        timestamp: msg.created_at,
        kind: "request",
        message: msg,
      });
      hasRequest = true;
    } else if (msg.kind === "agent_status") {
      const phase = (msg as AgentStatusMessage).phase;
      if (phase === "searching") {
        steps.push({
          id: `search-${msg.id}`,
          label: msg.status_text || "Searching files",
          status: "running",
          timestamp: msg.created_at,
          kind: "search",
          message: msg,
        });
      } else if (phase === "thinking") {
        steps.push({
          id: `reasoning-${msg.id}`,
          label: "Agent reasoning",
          status: "running",
          timestamp: msg.created_at,
          kind: "reasoning",
          message: msg,
        });
      } else if (phase === "completed") {
        const lastPending = steps.findLast((s) => s.status === "running");
        if (lastPending) lastPending.status = "completed";
        steps.push({
          id: `complete-${msg.id}`,
          label: msg.status_text || "Completed",
          status: "completed",
          timestamp: msg.created_at,
          kind: "reasoning",
          message: msg,
        });
      } else if (phase === "failed") {
        const lastPending = steps.findLast((s) => s.status === "running");
        if (lastPending) lastPending.status = "failed";
        steps.push({
          id: `failed-${msg.id}`,
          label: msg.status_text || "Failed",
          status: "failed",
          timestamp: msg.created_at,
          kind: "reasoning",
          message: msg,
        });
      }
    } else if (msg.kind === "approval") {
      const card = (msg as FileCandidateApprovalMessage).card;
      steps.push({
        id: `approval-${msg.id}`,
        label: `File approval: ${card.request_text}`,
        status: card.status === "pending" ? "running" : card.status === "approved" ? "completed" : "failed",
        timestamp: msg.created_at,
        kind: "approval",
        message: msg,
      });
    } else if (msg.kind === "transfer") {
      steps.push({
        id: `transfer-${msg.id}`,
        label: "Transferring file",
        status: "running",
        timestamp: msg.created_at,
        kind: "transfer",
        message: msg,
      });
    } else if (msg.kind === "receipt") {
      const receipt = msg as FileReceiptMessageType;
      steps.push({
        id: `receipt-${msg.id}`,
        label: `File sent: ${receipt.file_name}`,
        status: "completed",
        timestamp: receipt.received_at,
        kind: "receipt",
        message: msg,
      });
    }
  }

  return steps;
}

function StepIcon({ kind, status }: { kind: MissionStep["kind"]; status: MissionStep["status"] }) {
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-oa-blue" />;
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-oa-green" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-oa-red" />;
  if (kind === "request") return <User className="h-4 w-4 text-oa-text-muted" />;
  if (kind === "search") return <Search className="h-4 w-4 text-oa-text-muted" />;
  if (kind === "approval") return <ShieldCheck className="h-4 w-4 text-oa-amber" />;
  if (kind === "transfer" || kind === "receipt") return <ArrowRight className="h-4 w-4 text-oa-blue" />;
  return <Bot className="h-4 w-4 text-oa-text-muted" />;
}

export function MissionTimeline({ conversationId, onSelectApproval }: MissionTimelineProps) {
  const { data: msgsData, isLoading } = useConversationMessages(conversationId);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [threadOpen, setThreadOpen] = useState(false);

  const steps = useMemo(() => {
    const messages = msgsData?.messages ?? [];
    return buildMissionSteps(messages);
  }, [msgsData]);

  if (!conversationId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center max-w-sm">
          <Bot className="h-10 w-10 text-oa-text-muted" />
          <p className="text-sm font-medium text-oa-text-muted">Select a conversation</p>
          <p className="text-xs text-oa-text-disabled">Choose a conversation from the sidebar to see its mission timeline.</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-oa-blue" />
      </div>
    );
  }

  const activeStepIndex = steps.findIndex((s) => s.status === "running");
  const totalSteps = steps.length;
  const completedSteps = steps.filter((s) => s.status === "completed").length;
  const progressPct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  const missionId = conversationId ? `conversation-${conversationId}` : null;
  const missionTitle = steps[0]?.label ? `Mission: ${steps[0].label}` : "Mission discussion";

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
    <div className="flex flex-1 flex-col min-w-0 overflow-y-auto">
      <div className="border-b border-oa-border px-5 py-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-oa-text">Mission Timeline</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setThreadOpen(true)}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-oa-border bg-oa-surface-2 px-2.5 text-[10px] font-medium text-oa-text-muted hover:bg-oa-surface hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              Thread
            </button>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium uppercase ${
              activeStepIndex >= 0 ? "bg-oa-blue/10 text-oa-blue" :
              completedSteps === totalSteps && totalSteps > 0 ? "bg-oa-green/10 text-oa-green" :
              "bg-oa-surface-2 text-oa-text-muted"
            }`}>
              {activeStepIndex >= 0 ? "In Progress" :
               completedSteps === totalSteps && totalSteps > 0 ? "Complete" : "Idle"}
            </span>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-3 text-xs text-oa-text-muted">
          <span>{completedSteps}/{totalSteps} steps completed</span>
          {activeStepIndex >= 0 && (
            <>
              <span className="text-oa-text-disabled">&middot;</span>
              <span className="text-oa-blue font-medium">Currently: {steps[activeStepIndex].label}</span>
            </>
          )}
        </div>
        <div className="mt-2 h-1.5 w-full rounded-full bg-oa-surface-2 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-oa-blue to-oa-purple transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="mt-3 flex items-center gap-3 text-[10px] text-oa-text-muted">
          <span className="flex items-center gap-1">
            <User className="h-3 w-3" />
            You
          </span>
          <ArrowRight className="h-2.5 w-2.5" />
          <span className="flex items-center gap-1">
            <Bot className="h-3 w-3" />
            Agent
          </span>
          {steps.some((s) => s.kind === "transfer" || s.kind === "receipt") && (
            <>
              <ArrowRight className="h-2.5 w-2.5" />
              <span className="flex items-center gap-1">
                <Globe className="h-3 w-3" />
                Remote
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-1 p-4">
        {steps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Bot className="h-8 w-8 text-oa-text-muted" />
            <p className="text-sm text-oa-text-muted">No mission steps yet</p>
            <p className="text-xs text-oa-text-disabled">Messages will appear here as the agent processes your request.</p>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute left-[19px] top-3 bottom-3 w-0.5 bg-oa-border/50" />

            {steps.map((step, index) => {
              const isExpanded = expandedStep === step.id;
              const isLast = index === steps.length - 1;
              const stepKindLabel: Record<string, string> = {
                request: "Your request",
                search: "Searching files",
                approval: "Approval needed",
                transfer: "Transferring",
                receipt: "File received",
                reasoning: "Agent reasoning",
                tool_call: "Agent tool call",
              };

              return (
                <motion.div
                  key={step.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: index * 0.03 }}
                  className="relative flex gap-4 pb-3"
                >
                  <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-oa-border bg-oa-surface">
                    <StepIcon kind={step.kind} status={step.status} />
                  </div>

                  <div className="min-w-0 flex-1 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setExpandedStep(isExpanded ? null : step.id)}
                      aria-expanded={isExpanded}
                      className="flex w-full items-center justify-between gap-2 rounded-lg border border-oa-border bg-oa-surface px-3 py-2 text-left hover:border-oa-border-strong transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-oa-text">{step.label}</p>
                        <p className="text-[10px] text-oa-text-muted">{formatMissionDate(step.timestamp)}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium uppercase ${
                          step.status === "completed" ? "bg-oa-green/10 text-oa-green" :
                          step.status === "running" ? "bg-oa-blue/10 text-oa-blue" :
                          step.status === "failed" ? "bg-oa-red/10 text-oa-red" :
                          "bg-oa-surface-2 text-oa-text-muted"
                        }`}>
                          {step.status}
                        </span>
                        {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-oa-text-muted" /> : <ChevronRight className="h-3.5 w-3.5 text-oa-text-muted" />}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="mt-2 pl-2 space-y-2">
                        {step.kind === "approval" && (
                          <ApprovalCard card={(step.message as FileCandidateApprovalMessage).card} />
                        )}
                        {step.kind === "receipt" && (
                          <FileReceiptMessage message={step.message as FileReceiptMessageType} />
                        )}
                        {step.kind === "reasoning" && step.message.kind === "agent_status" && (
                          <>
                            <div className="rounded-lg border border-oa-border bg-oa-surface p-3">
                              <p className="text-xs text-oa-text-secondary">{((step.message) as AgentStatusMessage).status_text}</p>
                            </div>
                            <ReasoningFromDetails details={(step.message as AgentStatusMessage).details} />
                            <ToolCallsFromDetails details={(step.message as AgentStatusMessage).details} />
                          </>
                        )}
                        {step.kind === "request" && (
                          <div className="rounded-lg border border-oa-border bg-oa-bg-elevated p-3">
                            <p className="text-xs text-oa-text">{((step.message) as { text?: string }).text}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
    <MissionThreadPanel
      missionId={missionId}
      missionTitle={missionTitle}
      open={threadOpen}
      onClose={() => setThreadOpen(false)}
    />
    </div>
  );
}

function ReasoningFromDetails({ details }: { details?: Record<string, unknown> }) {
  if (!details?.reasoning_steps || !Array.isArray(details.reasoning_steps)) return null;
  return <AgenticReasoning steps={details.reasoning_steps as Array<{ id: string; title: string; content: string; details?: Record<string, unknown>; durationMs?: number }>} />;
}

function ToolCallsFromDetails({ details }: { details?: Record<string, unknown> }) {
  if (!details?.tool_calls || !Array.isArray(details.tool_calls)) return null;
  return (
    <>
      {details.tool_calls.map((tc: unknown, i: number) => {
        const call = tc as { tool?: string; name?: string; description?: string; params?: Array<{ name: string; value: unknown; type?: string }>; result?: { status: "success" | "error" | "running"; output?: string; error?: string; durationMs?: number } };
        return (
          <AgenticToolCall
            key={call.tool ?? call.name ?? i}
            toolName={call.tool ?? call.name ?? `tool_${i}`}
            description={call.description}
            params={call.params ?? []}
            result={call.result}
          />
        );
      })}
    </>
  );
}
