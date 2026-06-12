import { motion } from "framer-motion";
import { ContextMenu } from "radix-ui";
import { useCallback, useState } from "react";
import { Check, AlertCircle, Activity, Copy, Link2, MessageSquareQuote, Pin, RotateCcw, ChevronDown, ChevronRight, User, Bot, ArrowRight, ShieldCheck } from "lucide-react";
import { OracleAvatar } from "../primitives/OracleAvatar";
import { MessageDeliveryState } from "../../features/chat/MessageDeliveryState";
import { MessageActions } from "./MessageActions";
import { RichMessageContent } from "./RichMessageContent";
import { AgentRunMessage } from "../agentic-ai/AgentRunMessage";
import { ApprovalCardMessage } from "../agentic-ai/ApprovalCardMessage";
import { TransferProgressMessage as TransferProgressCard } from "../agentic-ai/TransferProgressMessage";
import { FileReceiptMessage as FileReceiptCard } from "../agentic-ai/FileReceiptMessage";
import { FileRequestMessage as FileRequestCard } from "../agentic-ai/FileRequestMessage";
import { ThinkingBar as AgentPhaseThinkingBar } from "../agentic-ai/ThinkingBar";
import { ThinkingBar } from "../chat/ThinkingBar";
import { AgenticReasoning } from "../agentic-ai/AgenticReasoning";
import { AgenticToolCall } from "../agentic-ai/AgenticToolCall";
import { FeedbackBar } from "../agentic-ai/FeedbackBar";
import { safeDisplayText } from "../../lib/safeText";
import { useRelayTaskStatus } from "../../hooks/queries";
import type { TimelineMessage, AgentStatusMessage, HumanChatMessage, FileCandidateApprovalMessage, TransferProgressMessage, FileReceiptMessage, FileRequestMessage as FileRequestMessageType, A2ATaskMessage } from "../../api/types";
import type { DeliveryStatus } from "../../api/types";

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const AGENT_UUID_RE = /\b(?:ag[ei]_|run_|task_)[0-9a-f-]{36,}\b/gi;

function stripIds(text: string): string {
  return text.replace(AGENT_UUID_RE, "[ID]").replace(UUID_RE, "[ID]");
}

const avatarTone: Record<string, string> = {
  human: "coral",
  approval: "violet",
  transfer: "aqua",
  receipt: "aqua",
  system_event: "blue",
  file_request: "rose",
  agent_status: "rose",
  thinking_bar: "rose",
  a2a_task: "purple",
};

function agentPhaseLabel(phase: string): string {
  if (phase === "thinking") return "Agent is thinking";
  if (phase === "searching") return "Agent is searching";
  if (phase === "executing") return "Agent is working";
  if (phase === "completed") return "Agent";
  if (phase === "failed") return "Agent failed";
  return "Agent";
}

const authorLabel: Record<string, string> = {
  human: "You",
  approval: "Approval",
  transfer: "Transfer",
  receipt: "Receipt",
  system_event: "System",
  file_request: "File Request",
  thinking_bar: "Agent",
  a2a_task: "A2A Task",
};

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function messageCreatedAt(message: TimelineMessage): string {
  return message.kind === "receipt" ? (message as FileReceiptMessage).received_at : message.created_at;
}

const systemEventLabels: Record<string, string> = {
  relay_ready: "Connected",
  file_request_rejected: "File request rejected",
  file_request_approved: "File approved",
  transfer_complete: "File transferred",
  contact_requested: "Contact request sent",
  agent_run_started: "Task started",
  agent_run_completed: "Task completed",
  agent_run_failed: "Task failed",
};

function sanitizeSystemText(text: string): string {
  const t = safeDisplayText(text).trim();
  if (/relay chat ready/i.test(t)) return "Connected";
  if (/file requests? become a2a task/i.test(t)) return "Connected";
  if (/SUCCESS/i.test(t)) return t.replace(/✅?\s*SUCCESS\s*[:—\-]?\s*/i, "").trim() || "Connected";
  return t;
}

function messageText(message: TimelineMessage): string {
  if (message.kind === "human") return safeDisplayText(message.text);
  if (message.kind === "agent_status") return stripIds(safeDisplayText(message.status_text));
  if (message.kind === "thinking_bar") return safeDisplayText(message.state.summary);
  if (message.kind === "system_event") return sanitizeSystemText(message.text);
  if (message.kind === "file_request") return safeDisplayText(message.natural_language_request);
  if (message.kind === "approval") return safeDisplayText(message.card.request_text);
  if (message.kind === "transfer") return safeDisplayText(`${message.file_name} is ${message.status} (${message.progress_percent}%)`);
  if (message.kind === "receipt") return safeDisplayText(`${message.file_name} receipt ${message.hash_verified ? "verified" : "needs review"}`);
  return "";
}

function SeverityIcon({ severity }: { severity: string }) {
  const map: Record<string, typeof AlertCircle> = {
    info: Activity,
    warning: AlertCircle,
    error: AlertCircle,
    success: Check,
  };
  const Icon = map[severity] ?? Activity;
  const colorMap: Record<string, string> = {
    info: "text-oa-blue",
    warning: "text-oa-amber",
    error: "text-oa-red",
    success: "text-oa-green",
  };
  return <Icon className={`h-3.5 w-3.5 ${colorMap[severity] ?? "text-oa-text-muted"}`} />;
}

interface MessageBubbleProps {
  message: TimelineMessage;
  onRetry?: (messageId: string) => void;
}

function agentSuggestions(text: string): string | null {
  const lower = text.toLowerCase();
  const hasPositiveResult = lower.includes("found") || lower.includes("matched") || lower.includes("candidates found");
  if (hasPositiveResult) return null;
  if (lower.includes("0 candidates") || lower.includes("found no") || lower.includes("no results") || lower.includes("nothing found") || lower.includes("could not find")) {
    return "Try a different search term or request a specific file by name.";
  }
  if (lower.includes("not available") || lower.includes("unreachable")) {
    return "Check if the remote agent is online and try again.";
  }
  return null;
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

function ReasoningFromDetails({ details }: { details?: Record<string, unknown> }) {
  if (!details?.reasoning_steps || !Array.isArray(details.reasoning_steps)) return null;
  return <AgenticReasoning steps={details.reasoning_steps as Array<{ id: string; title: string; content: string; details?: Record<string, unknown>; durationMs?: number }>} />;
}

function MissionHeader({ message }: { message: TimelineMessage }) {
  const [expanded, setExpanded] = useState(false);
  const msg = message as AgentStatusMessage;
  const hasDetails = !!msg.details?.reasoning_steps || !!msg.details?.tool_calls;
  const stepCount = msg.details?.reasoning_steps ? (msg.details.reasoning_steps as Array<unknown>).length : 0;
  const toolCount = msg.details?.tool_calls ? (msg.details.tool_calls as Array<unknown>).length : 0;
  return (
    <div className="mb-3 flex items-center gap-3 rounded-lg border border-oa-border bg-oa-surface px-3 py-2">
      <div className="flex items-center gap-1.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-oa-blue to-oa-purple text-[9px] font-bold text-white">M</span>
        <span className="text-xs font-medium text-oa-text">Mission</span>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-oa-text-muted">
        <span className="flex items-center gap-1">
          <User className="h-3 w-3" />
          You
        </span>
        <ArrowRight className="h-2.5 w-2.5" />
        <span className="flex items-center gap-1">
          <Bot className="h-3 w-3" />
          Agent
        </span>
        {hasDetails && (
          <span className="ml-1 text-[9px] text-oa-text-disabled">
            ({stepCount > 0 ? `${stepCount} step${stepCount > 1 ? "s" : ""}` : ""}{stepCount > 0 && toolCount > 0 ? ", " : ""}{toolCount > 0 ? `${toolCount} tool${toolCount > 1 ? "s" : ""}` : ""})
          </span>
        )}
      </div>
    </div>
  );
}

export function MessageBubble({ message, onRetry }: MessageBubbleProps) {
  const [pinned, setPinned] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [showAgentThinking, setShowAgentThinking] = useState(false);
  const isHuman = message.kind === "human";
  const humanMessage = isHuman ? message as HumanChatMessage : null;
  const isOutgoingHuman = isHuman && humanMessage?.direction !== "incoming";
  const relayTaskStatus = useRelayTaskStatus(
    humanMessage?.relay_task_id,
    isOutgoingHuman && (humanMessage?.delivery_status === "queued_at_relay" || humanMessage?.delivery_status === "delivered_to_remote_agent")
  );
  const deliveryStatus = relayTaskStatus.data?.delivery_status ?? humanMessage?.delivery_status ?? "sent";
  const failureReason = typeof humanMessage?.delivery_receipt?.error === "string"
    ? humanMessage.delivery_receipt.error
    : undefined;
  const tone = avatarTone[message.kind] ?? "rose";
  const label = humanMessage?.direction === "incoming"
    ? (humanMessage.sender_label ?? "Peer")
    : message.kind === "agent_status"
    ? agentPhaseLabel((message as AgentStatusMessage).phase)
    : (authorLabel[message.kind] ?? "Agent");
  const time = formatTime(messageCreatedAt(message));
  const text = messageText(message);
  const suggestion = message.kind === "agent_status" ? agentSuggestions(text) : null;
  const isThinking = message.kind === "agent_status" && (message as AgentStatusMessage).phase === "thinking";
  const isSearching = message.kind === "agent_status" && (message as AgentStatusMessage).phase === "searching";
  const hasAgentDetails = message.kind === "agent_status" && !!((message as AgentStatusMessage).details?.reasoning_steps || (message as AgentStatusMessage).details?.tool_calls);
  const isMissionStart = message.kind === "human" && (message as { text?: string }).text?.startsWith("/mission");

  const isAgentPhase = isThinking || isSearching;
  const isThinkingBar = message.kind === "thinking_bar";

  const containerClass = isOutgoingHuman
    ? "flex-row-reverse"
    : "flex-row";

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard can be unavailable in restricted browser contexts.
    }
  }, [text]);

  const handleCopyLink = useCallback(async () => {
    try {
      const path = `${window.location.pathname}#message-${message.id}`;
      await navigator.clipboard.writeText(path);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1600);
    } catch {
      // Clipboard can be unavailable in restricted browser contexts.
    }
  }, [message.id]);

  const handleReply = useCallback(() => {
    window.dispatchEvent(new CustomEvent("oa-reply-to-message", {
      detail: {
        messageId: message.id,
        text,
        label,
        createdAt: messageCreatedAt(message),
        kind: message.kind,
      },
    }));
  }, [label, message, text]);

  const handleTogglePin = useCallback(() => {
    setPinned((current) => !current);
  }, []);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <motion.div
          id={`message-${message.id}`}
          layout
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className={`density-message group/message flex gap-3 px-4 py-2 ${containerClass}`}
        >
          {!isOutgoingHuman && !isAgentPhase && !isThinkingBar && (
            <OracleAvatar
              seed={message.kind}
              initials={label.slice(0, 2).toUpperCase()}
              size="sm"
              className="mt-1 h-8 w-8 shrink-0 ring-2 ring-oa-blue/20"
            />
          )}

          <div className={`flex ${isThinkingBar ? "w-full max-w-[860px]" : "max-w-[75%]"} flex-col gap-1 ${isOutgoingHuman ? "items-end" : "items-start"}`}>
            {!isAgentPhase && !isThinkingBar && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-oa-text-secondary">{isOutgoingHuman ? "You" : label}</span>
                <span className="text-[10px] text-oa-text-muted">{time}</span>
                {pinned && <Pin className="h-3 w-3 rotate-45 text-oa-amber" aria-label="Pinned" />}
              </div>
            )}
            {isMissionStart && <MissionHeader message={message} />}

            <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
              isOutgoingHuman
                ? "bg-oa-bubble-bg text-oa-text rounded-tr-md shadow-lg shadow-black/10"
                : isAgentPhase || isThinkingBar
                  ? "bg-transparent p-0"
                  : "glass-panel text-oa-text rounded-tl-md"
            }`}>
              {message.kind === "system_event" && (
                <div className="mb-1 flex items-center gap-1.5">
                  <SeverityIcon severity={(message as TimelineMessage & { severity: string }).severity} />
                </div>
              )}

              {message.kind === "a2a_task" && <AgentRunMessage message={message as A2ATaskMessage} />}
              {message.kind === "approval" && (
                <>
                  <ApprovalCardMessage message={message as FileCandidateApprovalMessage} />
                  {((message as FileCandidateApprovalMessage).card.status === "approved" || (message as FileCandidateApprovalMessage).card.status === "rejected") && (
                    <div className="mt-2">
                      <FeedbackBar />
                    </div>
                  )}
                </>
              )}
              {message.kind === "transfer" && <TransferProgressCard message={message as TransferProgressMessage} />}
              {message.kind === "receipt" && <FileReceiptCard message={message as FileReceiptMessage} />}
              {message.kind === "file_request" && <FileRequestCard message={message as FileRequestMessageType} />}
              {isThinkingBar && <ThinkingBar state={message.state} privacyMasked />}
              {isAgentPhase && <AgentPhaseThinkingBar text={text} />}
              {message.kind === "human" || (message.kind === "agent_status" && !isAgentPhase) || message.kind === "system_event" ? (
                <>
                  {(message.kind === "human" || message.kind === "system_event") && (
                    <RichMessageContent text={text} />
                  )}
                  {message.kind === "agent_status" && !isAgentPhase && (
                    <>
                      <RichMessageContent text={text} />
                      <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-oa-green/20 bg-oa-green/10 px-2 py-0.5 text-[10px] text-oa-green">
                        <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                        Verified agent response
                      </div>
                      {hasAgentDetails && (
                        <>
                          <button
                            type="button"
                            onClick={() => setShowAgentThinking(!showAgentThinking)}
                            className="mt-2 flex items-center gap-1 text-[10px] text-oa-text-muted hover:text-oa-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-1"
                            aria-expanded={showAgentThinking}
                          >
                            {showAgentThinking ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            {showAgentThinking ? "Hide agent thinking" : "Show agent thinking"}
                          </button>
                          {showAgentThinking && (
                            <div className="mt-2 space-y-2 border-l-2 border-oa-border/30 pl-3">
                              <ReasoningFromDetails details={(message as AgentStatusMessage).details} />
                              <ToolCallsFromDetails details={(message as AgentStatusMessage).details} />
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}
                  {suggestion && (
                    <p className="mt-2 text-xs text-oa-text-muted border-t border-oa-border/30 pt-1.5">
                      {suggestion}
                    </p>
                  )}
                </>
              ) : null}
            </div>

            {isOutgoingHuman && (
              <MessageDeliveryState
                status={deliveryStatus as DeliveryStatus}
                failureReason={failureReason}
                onRetry={onRetry ? () => onRetry(message.id) : undefined}
              />
            )}

            {!isAgentPhase && !isThinkingBar && (
              <MessageActions
                text={text}
                onRetry={onRetry ? () => onRetry(message.id) : undefined}
                showRetry={isOutgoingHuman}
                messageId={message.id}
                pinned={pinned}
                onTogglePin={handleTogglePin}
                onReply={handleReply}
              />
            )}
          </div>
        </motion.div>
      </ContextMenu.Trigger>

      {!isAgentPhase && !isThinkingBar && (
        <ContextMenu.Portal>
          <ContextMenu.Content className="context-menu-surface z-[80] min-w-48 rounded-lg p-1">
            <ContextMenu.Item className="context-menu-item" onSelect={handleCopy}>
              <Copy className="h-3.5 w-3.5" />
              Copy message
            </ContextMenu.Item>
            <ContextMenu.Item className="context-menu-item" onSelect={handleCopyLink}>
              {linkCopied ? <Check className="h-3.5 w-3.5 text-oa-green" /> : <Link2 className="h-3.5 w-3.5" />}
              {linkCopied ? "Link copied" : "Copy local link"}
            </ContextMenu.Item>
            <ContextMenu.Item className="context-menu-item" onSelect={handleReply}>
              <MessageSquareQuote className="h-3.5 w-3.5" />
              Reply in thread
            </ContextMenu.Item>
            <ContextMenu.Item className="context-menu-item" onSelect={handleTogglePin}>
              <Pin className={`h-3.5 w-3.5 ${pinned ? "rotate-45 text-oa-amber" : ""}`} />
              {pinned ? "Unpin message" : "Pin message"}
            </ContextMenu.Item>
            {isOutgoingHuman && onRetry && (
              <ContextMenu.Item className="context-menu-item" onSelect={() => onRetry(message.id)}>
                <RotateCcw className="h-3.5 w-3.5" />
                Retry send
              </ContextMenu.Item>
            )}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      )}
    </ContextMenu.Root>
  );
}
