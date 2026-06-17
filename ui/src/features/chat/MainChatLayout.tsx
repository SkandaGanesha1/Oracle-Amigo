import { useEffect, useState, useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import { useParams, useNavigate } from "react-router-dom";
import { AlertTriangle, Search, MessageSquareText, ListTodo, RefreshCw } from "lucide-react";
import { useActiveConversationRealtime, useConversations, useConversationMessages, useCreateThreadReply, useUpdateConversationReadState } from "../../hooks/queries";
import { ApiRequestError } from "../../api/localAgentClient";
import { api } from "../../api/client";
import { ConversationHeader } from "./ConversationHeader";
import { ChatWindow } from "./ChatWindow";
import { RightInspectorPanel } from "../inspector/RightInspectorPanel";
import { ThreadDrawer, type ThreadSubject } from "../../components/stream-like/ThreadDrawer";
import type { TimelineMessage, FileReceiptMessage } from "../../api/types";

function messageCreatedAt(message: TimelineMessage): string {
  return message.kind === "receipt" ? (message as FileReceiptMessage).received_at : message.created_at;
}

function messageTitle(message: TimelineMessage): string {
  if (message.kind === "human") return "You";
  if (message.kind === "agent_status") return "Agent";
  if (message.kind === "system_event") return "System";
  if (message.kind === "approval") return "Approval";
  if (message.kind === "transfer") return "Transfer";
  if (message.kind === "receipt") return "Receipt";
  if (message.kind === "file_request") return "File request";
  return "A2A task";
}

function messagePreviewText(message: TimelineMessage): string {
  if (message.kind === "human") return message.text;
  if (message.kind === "system_event") return message.text;
  if (message.kind === "agent_status") return message.status_text;
  if (message.kind === "file_request") return message.natural_language_request;
  if (message.kind === "approval") return message.card.request_text;
  if (message.kind === "transfer") return message.file_name;
  if (message.kind === "receipt") return message.file_name;
  return messageTitle(message);
}

function useInspectorState() {
  const [inspectorOpen, setInspectorOpen] = useState(false);

  const toggleInspector = useCallback(() => {
    setInspectorOpen((prev) => {
      const next = !prev;
      localStorage.setItem("oa-inspector-open", String(next));
      return next;
    });
  }, []);

  const closeInspector = useCallback(() => {
    setInspectorOpen(false);
    localStorage.setItem("oa-inspector-open", "false");
  }, []);

  return { inspectorOpen, toggleInspector, closeInspector };
}

function conversationLoadErrorCopy(error: unknown): { title: string; message: string } {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) {
      return {
        title: "Local agent session unavailable",
        message: "Reload this local app window to refresh the secure browser session, then open the chat again."
      };
    }
    if (error.status === 404) {
      return {
        title: "Conversation not found",
        message: "This chat could not be found locally. Reopen your local agent chat or select another person from the rail."
      };
    }
    return {
      title: "Conversation failed to load",
      message: error.message || `The local agent returned HTTP ${error.status}.`
    };
  }
  return {
    title: "Conversation failed to load",
    message: error instanceof Error ? error.message : "The local agent could not load this conversation."
  };
}

function ConversationLoadErrorPanel({
  error,
  refreshing,
  onRetry,
  onOpenLocalAgent,
}: {
  error: unknown;
  refreshing?: boolean;
  onRetry: () => void;
  onOpenLocalAgent: () => void;
}) {
  const copy = conversationLoadErrorCopy(error);
  const isMissing = error instanceof ApiRequestError && error.status === 404;

  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-oa-surface ring-1 ring-oa-border">
          <AlertTriangle className="h-7 w-7 text-oa-red" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-oa-text">{copy.title}</h2>
          <p className="text-sm leading-6 text-oa-text-muted">{copy.message}</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={onRetry}
            disabled={refreshing}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-oa-blue px-3 py-2 text-sm font-medium text-white transition hover:bg-oa-blue/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing session" : "Retry"}
          </button>
          {isMissing && (
            <button
              type="button"
              onClick={onOpenLocalAgent}
              className="inline-flex min-h-[40px] items-center rounded-lg border border-oa-border bg-oa-surface px-3 py-2 text-sm font-medium text-oa-text transition hover:bg-oa-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
            >
              Open local agent
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function MainChatLayout() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const { data: conversationsData } = useConversations();
  const {
    data: messagesData,
    error: messagesError,
    isError: messagesIsError,
    isLoading,
    refetch: refetchMessages,
  } = useConversationMessages(conversationId ?? null);
  const updateReadState = useUpdateConversationReadState(conversationId ?? null);
  const { inspectorOpen, toggleInspector, closeInspector } = useInspectorState();
  const [threadSubject, setThreadSubject] = useState<ThreadSubject | null>(null);
  const [refreshingSession, setRefreshingSession] = useState(false);
  const createThreadReply = useCreateThreadReply(conversationId ?? null, threadSubject?.messageId ?? null);
  const navigate = useNavigate();

  const activeConversation = conversationsData?.conversations?.find((c) => c.id === conversationId) ?? messagesData?.conversation ?? null;
  const messages = messagesData?.messages ?? [];
  const readState = messagesData?.readState ?? activeConversation?.readState ?? null;
  useActiveConversationRealtime(conversationId ?? null, refetchMessages);

  const handleMarkRead = useCallback((messageId: string) => {
    if (!conversationId || updateReadState.isPending) return;
    if (readState?.lastReadMessageId === messageId && readState.unreadCount === 0) return;
    updateReadState.mutate(messageId);
  }, [conversationId, readState?.lastReadMessageId, readState?.unreadCount, updateReadState]);

  useEffect(() => {
    function handleReply(event: Event) {
      const detail = (event as CustomEvent<Partial<ThreadSubject> & { messageId?: string; label?: string }>).detail;
      if (!detail?.messageId) return;
      const message = messages.find((m) => m.id === detail.messageId);
      setThreadSubject({
        messageId: detail.messageId,
        title: detail.title ?? detail.label ?? (message ? messageTitle(message) : "Message"),
        text: detail.text ?? "",
        createdAt: detail.createdAt ?? (message ? messageCreatedAt(message) : new Date().toISOString()),
        kind: detail.kind ?? message?.kind,
      });
    }
    window.addEventListener("oa-reply-to-message", handleReply);
    return () => window.removeEventListener("oa-reply-to-message", handleReply);
  }, [messages]);

  useEffect(() => {
    function handleOpenThread(event: Event) {
      const threadId = (event as CustomEvent<{ threadId?: string }>).detail?.threadId;
      if (!threadId) return;
      const message = messages.find((m) => m.id === threadId || m.thread_id === threadId);
      setThreadSubject({
        messageId: threadId,
        title: message ? messageTitle(message) : "Message",
        text: message ? messagePreviewText(message) : "",
        createdAt: message ? messageCreatedAt(message) : new Date().toISOString(),
        kind: message?.kind,
      });
    }
    window.addEventListener("oa-open-thread", handleOpenThread);
    return () => window.removeEventListener("oa-open-thread", handleOpenThread);
  }, [messages]);

  const focusDirectorySearch = useCallback(() => {
    navigate("/chats");
    window.setTimeout(() => {
      window.dispatchEvent(new Event("oa-focus-directory-search"));
    }, 0);
  }, [navigate]);

  const retryConversationLoad = useCallback(async () => {
    if (messagesError instanceof ApiRequestError && messagesError.status === 401) {
      setRefreshingSession(true);
      try {
        await api.refreshLocalUiSession();
      } catch {
        window.location.reload();
        return;
      } finally {
        setRefreshingSession(false);
      }
    }
    await refetchMessages();
  }, [messagesError, refetchMessages]);

  return (
    <div className="chat-canvas flex h-full w-full">
      <div className="flex flex-1 flex-col min-w-0">
        {conversationId && (activeConversation || isLoading || messagesIsError) ? (
          <>
            {activeConversation && (
              <ConversationHeader
                conversation={activeConversation}
                onToggleInspector={toggleInspector}
                inspectorOpen={inspectorOpen}
              />
            )}
            <div className="flex flex-1 overflow-hidden">
              <div className="flex flex-1 flex-col min-w-0 bg-oa-chat-bg">
                {activeConversation ? (
                  <ChatWindow
                    conversation={activeConversation}
                    messages={messages}
                    loading={isLoading}
                    conversationId={conversationId}
                    readState={readState}
                    pageInfo={messagesData?.pageInfo}
                    onMarkRead={handleMarkRead}
                  />
                ) : messagesIsError ? (
                  <ConversationLoadErrorPanel
                    error={messagesError}
                    refreshing={refreshingSession}
                    onRetry={() => void retryConversationLoad()}
                    onOpenLocalAgent={() => navigate("/chats/local-agent", { replace: true })}
                  />
                ) : (
                  <div className="flex flex-1 items-center justify-center text-sm text-oa-text-muted">Loading conversation...</div>
                )}
              </div>

              {inspectorOpen && (
                <RightInspectorPanel
                  onClose={closeInspector}
                />
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="flex flex-col items-center gap-5 text-center max-w-sm">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-oa-surface ring-1 ring-oa-border">
                <MessageSquareText className="h-8 w-8 text-oa-text-muted" />
              </div>
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-semibold text-oa-text">Welcome</h2>
                <p className="text-sm text-oa-text-muted">
                  Select a person from the left rail or search the directory to start.
                </p>
              </div>
              <div className="flex flex-col gap-2 w-full">
                <button
                  type="button"
                  onClick={focusDirectorySearch}
                  className="flex min-h-[48px] items-center gap-2 rounded-lg bg-oa-surface px-4 py-2.5 text-sm text-oa-text transition-colors hover:bg-oa-bubble-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
                >
                  <Search className="h-4 w-4 text-oa-text-muted" />
                  <span>Search directory to find people</span>
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/approvals")}
                  className="flex min-h-[48px] items-center gap-2 rounded-lg bg-oa-surface px-4 py-2.5 text-sm text-oa-text transition-colors hover:bg-oa-bubble-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
                >
                  <ListTodo className="h-4 w-4 text-oa-text-muted" />
                  <span>View pending approvals and transfers</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <AnimatePresence>
        {threadSubject && (
          <ThreadDrawer
            subject={threadSubject}
            onClose={() => setThreadSubject(null)}
            onReply={async (_messageId, text) => {
              await createThreadReply.mutateAsync(text);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
