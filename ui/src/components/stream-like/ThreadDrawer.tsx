import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Clock, MessageSquare, Send, X } from "lucide-react";
import { useMessageThread } from "../../lib/messageThreads";
import { safeDisplayText } from "../../lib/safeText";
import { RichMessageContent } from "./RichMessageContent";

export interface ThreadSubject {
  messageId: string;
  title: string;
  text: string;
  createdAt: string;
  kind?: string;
}

interface ThreadDrawerProps {
  subject: ThreadSubject | null;
  onClose: () => void;
  onReply?: (messageId: string, text: string) => Promise<void>;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ThreadDrawer({ subject, onClose, onReply }: ThreadDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const replyInputRef = useRef<HTMLTextAreaElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [activeTab, setActiveTab] = useState<"thread" | "details">("thread");
  const { replies, addReply } = useMessageThread(subject?.messageId);

  useEffect(() => {
    if (!subject) return;
    previousFocusRef.current = document.activeElement as HTMLElement;
    closeRef.current?.focus();
    setReplyText("");
    setActiveTab("thread");
    return () => {
      previousFocusRef.current?.focus();
    };
  }, [subject]);

  useEffect(() => {
    if (!subject) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, subject]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [replies.length]);

  const handleSendReply = useCallback(async () => {
    if (!replyText.trim() || !subject || sending) return;
    const text = replyText.trim();
    setSending(true);
    addReply(text);
    setReplyText("");
    try {
      if (onReply) await onReply(subject.messageId, text);
    } catch {
      // Backend thread support is optional; local replies remain visible.
    } finally {
      setSending(false);
    }
  }, [addReply, onReply, replyText, sending, subject]);

  if (!subject) return null;

  return (
    <motion.div
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 32 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="glass-panel-strong fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l border-oa-border shadow-2xl"
      role="dialog"
      aria-label="Message thread"
      aria-modal="true"
    >
      <div className="flex items-center justify-between border-b border-oa-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <MessageSquare className="h-4 w-4 shrink-0 text-oa-blue" />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-oa-text">Message Thread</h3>
            <p className="truncate text-[10px] text-oa-text-muted">{subject.title}</p>
          </div>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close message thread"
          className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg text-oa-text-muted transition-colors hover:bg-oa-surface-2 hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex border-b border-oa-border">
        {(["thread", "details"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`flex-1 px-3 py-2 text-xs font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-oa-blue ${
              activeTab === tab ? "border-b-2 border-oa-blue text-oa-text" : "text-oa-text-muted hover:text-oa-text"
            }`}
            aria-pressed={activeTab === tab}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === "thread" && (
          <div className="space-y-3 p-3">
            <div className="rounded-xl border border-oa-border bg-oa-surface/80 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[10px] font-medium uppercase tracking-wider text-oa-text-muted">Original message</span>
                <span className="text-[10px] text-oa-text-disabled">{formatTime(subject.createdAt)}</span>
              </div>
              <RichMessageContent text={subject.text} />
            </div>

            {replies.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-oa-border py-8 text-center">
                <MessageSquare className="h-8 w-8 text-oa-text-muted" />
                <p className="text-xs text-oa-text-muted">No replies yet. Start the thread below.</p>
              </div>
            ) : (
              replies.map((reply) => (
                <div key={reply.id} className="flex justify-end">
                  <div className="max-w-[84%] rounded-2xl rounded-tr-md bg-oa-blue/20 px-3 py-2">
                    <div className="mb-0.5 flex items-center gap-2">
                      <span className="text-[10px] font-medium text-oa-blue">You</span>
                      <span className="text-[9px] text-oa-text-muted">{formatTime(reply.timestamp)}</span>
                    </div>
                    <RichMessageContent text={reply.text} />
                  </div>
                </div>
              ))
            )}
            <div ref={threadEndRef} />
          </div>
        )}

        {activeTab === "details" && (
          <div className="space-y-4 p-4">
            <div>
              <span className="text-[10px] font-medium uppercase tracking-wider text-oa-text-muted">Message ID</span>
              <p className="mt-0.5 break-all font-mono text-xs text-oa-text">{subject.messageId}</p>
            </div>
            <div>
              <span className="text-[10px] font-medium uppercase tracking-wider text-oa-text-muted">Kind</span>
              <p className="mt-0.5 text-xs text-oa-text">{safeDisplayText(subject.kind ?? "message")}</p>
            </div>
            <div>
              <span className="text-[10px] font-medium uppercase tracking-wider text-oa-text-muted">Created</span>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-oa-text">
                <Clock className="h-3.5 w-3.5 text-oa-text-muted" />
                {formatDate(subject.createdAt)} at {formatTime(subject.createdAt)}
              </div>
            </div>
            <div className="rounded-lg border border-oa-green/20 bg-oa-green/5 p-3">
              <div className="flex items-center gap-2 text-xs text-oa-green">
                <CheckCircle2 className="h-4 w-4" />
                Local thread reply metadata persists on this device; full reply text stays in this browser session only.
              </div>
            </div>
          </div>
        )}
      </div>

      {activeTab === "thread" && (
        <div className="border-t border-oa-border p-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={replyInputRef}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSendReply();
                }
              }}
              placeholder="Reply in thread..."
              rows={1}
              className="min-h-[44px] flex-1 resize-none rounded-lg border border-oa-border bg-oa-bg-elevated px-3 py-2 text-xs text-oa-text placeholder-oa-text-disabled outline-none transition focus:border-oa-blue"
              aria-label="Reply in thread"
            />
            <button
              type="button"
              onClick={() => void handleSendReply()}
              disabled={!replyText.trim() || sending}
              className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg bg-oa-blue text-white transition-colors hover:bg-oa-blue/80 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
              aria-label="Send reply"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
