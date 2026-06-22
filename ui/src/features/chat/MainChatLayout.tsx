import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useConversations, useConversationMessages, useCreateThreadReply, useUpdateConversationReadState } from "../../hooks/queries";
import { useActiveConversationLiveSync } from "../../hooks/useActiveConversationLiveSync";
import { ApiRequestError } from "../../api/localAgentClient";
import { api } from "../../api/client";
import { ConversationHeader } from "./ConversationHeader";
import { ChatWindow } from "./ChatWindow";
import { ChatCanvas, ChatCanvasEmptyState, ChatCanvasErrorState, ChatCanvasLoadingState } from "./ChatCanvas";
import { ThreadDrawer, type ThreadSubject } from "../../components/stream-like/ThreadDrawer";
import type { TimelineMessage, FileReceiptMessage } from "../../api/types";
import { AnimatePresence } from "../../components/primitives/MotionPrimitives";

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

export function MainChatLayout() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const { data: conversationsData } = useConversations();
  const messagesQuery = useConversationMessages(conversationId ?? null);
  const {
    data: messagesData,
    error: messagesError,
    isError: messagesIsError,
    isLoading,
    refetch: refetchMessages,
  } = messagesQuery;
  const [threadSubject, setThreadSubject] = useState<ThreadSubject | null>(null);
  const [refreshingSession, setRefreshingSession] = useState(false);
  const navigate = useNavigate();
  const canonicalConversationId = messagesData?.conversation?.id ?? messagesData?.conversationId ?? conversationId ?? null;
  const updateReadState = useUpdateConversationReadState(canonicalConversationId);
  const createThreadReply = useCreateThreadReply(canonicalConversationId, threadSubject?.messageId ?? null);

  const activeConversation = conversationsData?.conversations?.find((c) => c.id === conversationId) ?? messagesData?.conversation ?? null;
  const messages = messagesData?.messages ?? [];
  const readState = messagesData?.readState ?? activeConversation?.readState ?? null;
  useActiveConversationLiveSync(canonicalConversationId, messagesQuery);

  useEffect(() => {
    if (!conversationId || !canonicalConversationId || canonicalConversationId === conversationId) return;
    navigate(`/chats/${canonicalConversationId}`, { replace: true });
  }, [conversationId, canonicalConversationId, navigate]);

  const handleMarkRead = useCallback((messageId: string) => {
    if (!canonicalConversationId || updateReadState.isPending) return;
    if (!messages.some((message) => message.id === messageId)) return;
    if (readState?.lastReadMessageId === messageId && readState.unreadCount === 0) return;
    updateReadState.mutate(messageId);
  }, [canonicalConversationId, messages, readState?.lastReadMessageId, readState?.unreadCount, updateReadState]);

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

  const errorCopy = messagesIsError ? conversationLoadErrorCopy(messagesError) : null;
  const isMissingConversation = messagesError instanceof ApiRequestError && messagesError.status === 404;
  const isEmptyConversation = Boolean(activeConversation && conversationId && !isLoading && !messagesIsError && messages.length === 0);
  const emptyConversationState = isEmptyConversation && activeConversation ? (
    <ChatCanvasEmptyState
      title={activeConversation.title || "Oracle Amigo"}
      subtitle={`This is the beginning of your conversation with ${activeConversation.title || "this contact"}.`}
      onSearchDirectory={focusDirectorySearch}
      onOpenLocalAgent={() => navigate("/chats/local-agent")}
      onOpenApprovals={() => navigate("/approvals")}
    />
  ) : undefined;
  const header = activeConversation ? (
    <ConversationHeader conversation={activeConversation} />
  ) : undefined;
  const timeline = activeConversation ? (
    <ChatWindow
      conversation={activeConversation}
      messages={messages}
      loading={isLoading}
      conversationId={canonicalConversationId ?? conversationId ?? activeConversation.id}
      readState={readState}
      pageInfo={messagesData?.pageInfo}
      onMarkRead={handleMarkRead}
      emptyState={emptyConversationState}
    />
  ) : undefined;
  const loadingState = conversationId && isLoading && !messagesIsError ? <ChatCanvasLoadingState /> : undefined;
  const errorState = errorCopy ? (
    <ChatCanvasErrorState
      title={errorCopy.title}
      message={errorCopy.message}
      refreshing={refreshingSession}
      onRetry={() => void retryConversationLoad()}
      onOpenLocalAgent={isMissingConversation ? () => navigate("/chats/local-agent", { replace: true }) : undefined}
    />
  ) : undefined;
  const emptyState = !conversationId ? (
    <ChatCanvasEmptyState
      title="Oracle Amigo"
      subtitle="This is the beginning of your agentic chat canvas. Select a person, open your local agent, or review pending work."
      onSearchDirectory={focusDirectorySearch}
      onOpenLocalAgent={() => navigate("/chats/local-agent")}
      onOpenApprovals={() => navigate("/approvals")}
    />
  ) : undefined;
  return (
    <div className="chat-canvas flex h-full w-full">
      <ChatCanvas
        header={header}
        timeline={timeline}
        loadingState={loadingState}
        errorState={errorState}
        emptyState={emptyState}
      />
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
