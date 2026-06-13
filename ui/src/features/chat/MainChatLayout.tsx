import { useEffect, useState, useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import { useParams, useNavigate } from "react-router-dom";
import { Search, MessageSquareText, ListTodo } from "lucide-react";
import { useConversations, useConversationMessages } from "../../hooks/queries";
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

export function MainChatLayout() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const { data: conversationsData } = useConversations();
  const { data: messagesData, isLoading } = useConversationMessages(conversationId ?? null);
  const { inspectorOpen, toggleInspector, closeInspector } = useInspectorState();
  const [threadSubject, setThreadSubject] = useState<ThreadSubject | null>(null);
  const navigate = useNavigate();

  const activeConversation = conversationsData?.conversations?.find((c) => c.id === conversationId) ?? null;
  const messages = messagesData?.messages ?? [];

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

  const focusDirectorySearch = useCallback(() => {
    navigate("/chats");
    window.setTimeout(() => {
      window.dispatchEvent(new Event("oa-focus-directory-search"));
    }, 0);
  }, [navigate]);

  return (
    <div className="chat-canvas flex h-full w-full">
      <div className="flex flex-1 flex-col min-w-0">
        {activeConversation && conversationId ? (
          <>
            <ConversationHeader
              conversation={activeConversation}
              onToggleInspector={toggleInspector}
              inspectorOpen={inspectorOpen}
            />
            <div className="flex flex-1 overflow-hidden">
              <div className="flex flex-1 flex-col min-w-0 bg-oa-chat-bg">
                <ChatWindow
                  conversation={activeConversation}
                  messages={messages}
                  loading={isLoading}
                  conversationId={conversationId}
                />
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
          />
        )}
      </AnimatePresence>
    </div>
  );
}
