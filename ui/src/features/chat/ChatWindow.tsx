import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSendMessage, useSendFileRequest, useQueuedMessages, useRetryQueued, useCancelQueued, useLoadAroundMessage, useLoadBeforeMessages } from "../../hooks/queries";
import { MessageTimeline } from "./MessageTimeline";
import { ComposerDock } from "./ComposerDock";
import { SendConfirmation, SendConfirmationTitle, SendConfirmationMessage, SendConfirmationActions, SendConfirmationApprove, SendConfirmationReject } from "./SendConfirmation";
import { safeDisplayText } from "../../lib/safeText";
import { useTypingStates } from "../../components/stream-like/typingState";
import type { AgentStatusMessage, Conversation, ConversationMessagesResult, ConversationReadState, SystemEventMessage, TimelineMessage } from "../../api/types";

interface ChatWindowProps {
  conversation: Conversation;
  messages: TimelineMessage[];
  loading: boolean;
  conversationId: string;
  readState?: ConversationReadState | null;
  pageInfo?: ConversationMessagesResult["pageInfo"];
  onMarkRead?: (messageId: string) => void;
}

const bannerSeverities = new Set(["info", "success"]);

function sanitizeSystemText(msg: SystemEventMessage): string | null {
  const t = safeDisplayText(msg.text);
  if (!t) return null;
  if (isConnectionEvent(msg)) return null;
  if (/a2a task/i.test(t)) return null;
  if (/file requests? become/i.test(t)) return null;
  if (/SUCCESS/i.test(t)) return null;
  return t;
}

function isConnectionEvent(msg: SystemEventMessage): boolean {
  const t = safeDisplayText(msg.text);
  return /relay chat ready/i.test(t) || /SUCCESS/i.test(t);
}

function formatHeartbeat(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function createdAt(message: TimelineMessage): string {
  return message.kind === "receipt" ? message.received_at : message.created_at;
}

function statusGroupKey(message: AgentStatusMessage): string {
  const runId = typeof message.details?.run_id === "string" ? message.details.run_id : null;
  return runId ?? message.task_id ?? message.id;
}

function normalizeStepStatus(message: AgentStatusMessage): "pending" | "completed" | "failed" {
  const raw = String(message.details?.step_status ?? message.details?.run_status ?? message.phase ?? "").toLowerCase();
  if (["failed", "error", "rejected"].includes(raw)) return "failed";
  if (["completed", "complete", "skipped", "partial", "sent", "delivered", "ready"].includes(raw)) return "completed";
  return "pending";
}

function humanizeAgentStatus(message: AgentStatusMessage): string {
  const text = safeDisplayText(message.status_text).trim();
  const phase = message.phase.toLowerCase();
  const target = String(message.details?.execution_target ?? "");
  if (/choose tool|semantic_search|host-file-search|search/i.test(text) || /search/i.test(phase) || target === "host-file-search") {
    return "Searching relevant local context";
  }
  if (/inspect|confirm|check exact file|working directory|configured local roots/i.test(text)) {
    return "Checking the local evidence and access boundary";
  }
  if (/prepare final|final answer|found|not_found|need_help/i.test(text) || message.details?.final_status) {
    return "Preparing a user-facing answer";
  }
  if (/approval|consent|permission/i.test(text) || /approval|waiting|input_required/.test(phase)) {
    return "Waiting for your approval";
  }
  if (/execut|tool|command|terminal/i.test(text) || /execut|tool|terminal/.test(phase)) {
    return "Running a controlled local action";
  }
  if (/think|analyz|reason/i.test(text) || /thinking|analyzing/.test(phase)) {
    return "Understanding your request";
  }
  return text || "Updating the mission state";
}

function technicalTrace(message: AgentStatusMessage): string {
  const details = message.details ? JSON.stringify(message.details, null, 2) : "";
  return [message.status_text, details].filter(Boolean).join("\n\n");
}

function buildThinkingSummary(messages: AgentStatusMessage[]): string {
  const descriptions = messages.map(humanizeAgentStatus).filter((value, index, list) => list.indexOf(value) === index);
  if (descriptions.length === 0) return "The agent is working through your request.";
  if (descriptions.length === 1) return descriptions[0];
  return descriptions.slice(-3).join(" -> ");
}

function collapseAgentStatusMessages(messages: TimelineMessage[]): TimelineMessage[] {
  const output: TimelineMessage[] = [];
  const groups = new Map<string, AgentStatusMessage[]>();
  const inserted = new Set<string>();

  for (const message of messages) {
    if (message.kind !== "agent_status") {
      output.push(message);
      continue;
    }
    const key = statusGroupKey(message);
    groups.set(key, [...(groups.get(key) ?? []), message]);
    if (!inserted.has(key)) {
      inserted.add(key);
      output.push({
        kind: "thinking_bar",
        id: `thinking-${key}`,
        run_id: key,
        task_id: message.task_id,
        created_at: message.created_at,
        updated_at: message.created_at,
        sourceMessageIds: [],
        state: {
          isActive: true,
          steps: [],
          summary: "Agent is starting the mission.",
          progress: 8,
          streamingText: "Starting..."
        }
      });
    }
  }

  return output
    .map((message) => {
      if (message.kind !== "thinking_bar") return message;
      const group = groups.get(message.run_id) ?? [];
      const completedCount = group.filter((item) => normalizeStepStatus(item) === "completed").length;
      const failed = group.some((item) => normalizeStepStatus(item) === "failed");
      const active = !failed && group.some((item) => normalizeStepStatus(item) === "pending");
      const progress = group.length === 0 ? 8 : failed ? 100 : Math.max(12, Math.round((completedCount / group.length) * 100));
      return {
        ...message,
        updated_at: group.at(-1)?.created_at ?? message.updated_at,
        sourceMessageIds: group.map((item) => item.id),
        state: {
          isActive: active,
          steps: group.map((item, index) => ({
            id: item.id,
            description: humanizeAgentStatus(item),
            technicalTrace: technicalTrace(item),
            status: normalizeStepStatus(item),
            timestamp: item.created_at,
            toolUsed: typeof item.details?.command === "string" ? "local command" : typeof item.details?.execution_target === "string" ? item.details.execution_target : undefined,
            confidence: Math.min(0.98, 0.55 + index * 0.08)
          })),
          currentStepId: group.find((item) => normalizeStepStatus(item) === "pending")?.id ?? group.at(-1)?.id,
          summary: buildThinkingSummary(group),
          progress,
          streamingText: active ? humanizeAgentStatus(group.at(-1) ?? group[0]) : undefined
        }
      };
    })
    .sort((a, b) => createdAt(a).localeCompare(createdAt(b)));
}

export function ChatWindow({ conversation, messages, loading, conversationId, readState, pageInfo, onMarkRead }: ChatWindowProps) {
  const sendMessage = useSendMessage(conversationId);
  const sendFileRequest = useSendFileRequest(conversationId);
  const [pendingSend, setPendingSend] = useState<{ text: string; sendAs: "normal" | "file_request"; clientMessageId: string } | null>(null);
  const confirmingSendRef = useRef(false);
  const [jumpToMessageId, setJumpToMessageId] = useState<string | null>(null);
  const queuedMessages = useQueuedMessages(conversationId);
  const retryQueued = useRetryQueued(conversationId);
  const cancelQueued = useCancelQueued(conversationId);
  const loadAroundMessage = useLoadAroundMessage(conversationId);
  const loadBeforeMessages = useLoadBeforeMessages(conversationId);
  const typingStates = useTypingStates(conversationId);

  const { chatMessages, banners } = useMemo(() => {
    const chatMessages: TimelineMessage[] = [];
    const banners: SystemEventMessage[] = [];
    for (const msg of messages) {
      if (msg.kind === "system_event" && bannerSeverities.has(msg.severity)) {
        banners.push(msg);
      } else {
        chatMessages.push(msg);
      }
    }
    return { chatMessages: collapseAgentStatusMessages(chatMessages), banners };
  }, [messages]);

  const handleSend = useCallback(async (text: string, sendAs: "normal" | "file_request") => {
    if (sendAs === "normal") {
      await sendMessage.mutateAsync({ text, clientMessageId: crypto.randomUUID() });
      return;
    }
    // Confirmation path: setPendingSend({ text, sendAs }) plus a stable client message id.
    setPendingSend({ text, sendAs, clientMessageId: crypto.randomUUID() });
  }, [sendMessage]);

  const handleConfirmSend = useCallback(async () => {
    if (!pendingSend || confirmingSendRef.current) return;
    confirmingSendRef.current = true;
    const sender = pendingSend.sendAs === "file_request" ? sendFileRequest : sendMessage;
    try {
      await sender.mutateAsync({ text: pendingSend.text, clientMessageId: pendingSend.clientMessageId });
    } finally {
      confirmingSendRef.current = false;
      setPendingSend(null);
    }
  }, [pendingSend, sendMessage, sendFileRequest]);

  const handleCancelSend = useCallback(() => {
    setPendingSend(null);
  }, []);

  useEffect(() => {
    function handleJump(event: Event) {
      const messageId = (event as CustomEvent<{ messageId?: string }>).detail?.messageId;
      if (messageId) setJumpToMessageId(messageId);
    }
    window.addEventListener("oa-jump-to-message", handleJump);
    return () => window.removeEventListener("oa-jump-to-message", handleJump);
  }, []);

  const handleRetry = useCallback(async (messageId: string) => {
    const failedMsg = messages.find((m) => m.id === messageId && m.kind === "human");
    if (failedMsg && failedMsg.kind === "human") {
      await sendMessage.mutateAsync({ text: failedMsg.text, clientMessageId: messageId });
    }
  }, [messages, sendMessage]);

  const isSending = sendMessage.isPending || sendFileRequest.isPending;
  const typingLabel = typingStates.length > 0
    ? `${typingStates[0].actorLabel} is typing`
    : undefined;
  const connectionEvent = banners.find(isConnectionEvent);
  const visibleBanners = banners.filter((banner) => !isConnectionEvent(banner));

  return (
    <>
      {queuedMessages.length > 0 && (
        <div className="flex items-center gap-2 rounded-md bg-oa-amber/10 px-3 py-2 mx-4 mt-2 border border-oa-amber/20">
          <span className="text-[10px] text-oa-amber flex-1">
            {queuedMessages.length} {queuedMessages.length === 1 ? "message" : "messages"} queued - will retry automatically
          </span>
          <button
            type="button"
            onClick={retryQueued}
            className="min-h-[48px] px-2 text-[10px] text-oa-blue underline transition-colors hover:text-oa-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
          >
            Retry all
          </button>
          <button
            type="button"
            onClick={cancelQueued}
            className="min-h-[48px] px-2 text-[10px] text-oa-text-muted underline transition-colors hover:text-oa-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
          >
            Cancel all
          </button>
        </div>
      )}
      {connectionEvent && (
        <ConnectionStatusStrip at={connectionEvent.created_at} />
      )}
      {visibleBanners.length > 0 && (
        <div className="flex flex-col gap-1 px-4 pt-2">
          {visibleBanners.map((banner) => {
            const sanitized = sanitizeSystemText(banner);
            if (!sanitized) return null;
            return (
              <div key={banner.id} className="flex items-center gap-2 rounded-md bg-oa-surface/50 px-3 py-1.5">
                <span className="text-[10px] text-oa-text-muted">{sanitized}</span>
              </div>
            );
          })}
        </div>
      )}
      <MessageTimeline
        messages={chatMessages}
        loading={loading}
        onRetry={handleRetry}
        typing={typingStates.length > 0}
        typingLabel={typingLabel}
        conversationId={conversationId}
        readState={readState}
        onMarkRead={onMarkRead}
        hasMoreBefore={pageInfo?.hasMoreBefore ?? false}
        loadingBefore={loadBeforeMessages.isPending}
        loadBefore={(beforeMessageId) => loadBeforeMessages.mutateAsync(beforeMessageId).then(() => undefined)}
        jumpToMessageId={jumpToMessageId}
        loadAroundMessage={loadAroundMessage}
      />
      {pendingSend && (
        <div className="border-t border-oa-border px-4 py-3 bg-oa-surface">
          <SendConfirmation text={pendingSend.text} sendAs={pendingSend.sendAs} pending={isSending}>
            <SendConfirmationTitle>
              <SendConfirmationMessage />
            </SendConfirmationTitle>
            <SendConfirmationActions>
              <SendConfirmationReject onClick={handleCancelSend} />
              <SendConfirmationApprove onClick={handleConfirmSend} />
            </SendConfirmationActions>
          </SendConfirmation>
        </div>
      )}
      <ComposerDock
        conversationId={conversationId}
        onSend={handleSend}
        disabled={isSending || pendingSend !== null}
      />
    </>
  );
}

function ConnectionStatusStrip({ at }: { at?: string }) {
  const heartbeat = formatHeartbeat(at);
  return (
    <div className="oa-connection-strip" role="status" aria-live="polite">
      Agent link active{heartbeat ? ` • Last heartbeat ${heartbeat}` : ""}
    </div>
  );
}
