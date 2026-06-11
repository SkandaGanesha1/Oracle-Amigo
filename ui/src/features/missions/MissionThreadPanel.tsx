import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, MessageSquarePlus, Send, User, X } from "lucide-react";
import { useCreateMissionThreadMessage, useMissionThread } from "../../hooks/queries";

interface MissionThreadPanelProps {
  missionId: string | null;
  missionTitle?: string;
  open: boolean;
  onClose: () => void;
}

function initials(label: string): string {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "OA";
}

function renderMentions(body: string) {
  return body.split(/(@[a-zA-Z0-9_.-]+)/g).map((part, index) => {
    if (part.startsWith("@")) {
      return (
        <span key={`${part}-${index}`} className="rounded bg-oa-blue/10 px-1 font-medium text-oa-blue">
          {part}
        </span>
      );
    }
    return part;
  });
}

export function MissionThreadPanel({ missionId, missionTitle, open, onClose }: MissionThreadPanelProps) {
  const { data, isLoading } = useMissionThread(open ? missionId : null);
  const createMessage = useCreateMissionThreadMessage(missionId);
  const [body, setBody] = useState("");

  const messages = data?.messages ?? [];
  const sorted = useMemo(
    () => [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [messages]
  );

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || !missionId) return;
    await createMessage.mutateAsync(trimmed);
    setBody("");
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 360, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="glass-panel flex h-full w-[360px] shrink-0 flex-col overflow-hidden border-y-0 border-r-0"
          aria-label="Mission thread"
        >
          <div className="flex items-start justify-between gap-3 border-b border-oa-border px-4 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-oa-text-muted">
                <MessageSquarePlus className="h-3.5 w-3.5" />
                Mission Thread
              </p>
              <h3 className="mt-1 truncate text-sm font-semibold text-oa-text">
                {missionTitle ?? missionId ?? "Mission"}
              </h3>
              <p className="mt-0.5 text-[10px] text-oa-text-muted">Separate from the chat timeline</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-oa-text-muted hover:bg-oa-surface hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
              aria-label="Close mission thread"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {!missionId ? (
              <div className="rounded-lg border border-dashed border-oa-border bg-oa-bg-elevated p-4 text-center text-xs text-oa-text-muted">
                Select a mission to open its thread.
              </div>
            ) : isLoading ? (
              <div className="flex justify-center py-6">
                <div className="flex gap-1">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-oa-text-muted" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-oa-text-muted [animation-delay:120ms]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-oa-text-muted [animation-delay:240ms]" />
                </div>
              </div>
            ) : sorted.length === 0 ? (
              <div className="rounded-lg border border-dashed border-oa-border bg-oa-bg-elevated p-4 text-center">
                <Bot className="mx-auto h-7 w-7 text-oa-text-muted" />
                <p className="mt-2 text-xs font-medium text-oa-text">No mission comments yet</p>
                <p className="mt-1 text-[10px] text-oa-text-muted">Add context, decisions, or @mentions here without polluting chat.</p>
              </div>
            ) : (
              sorted.map((message) => {
                const isAgent = message.authorType === "agent";
                return (
                  <div key={message.id} className="flex gap-3">
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-semibold ${
                      isAgent ? "bg-oa-purple/20 text-oa-purple" : "bg-oa-blue/20 text-oa-blue"
                    }`}>
                      {isAgent ? <Bot className="h-4 w-4" /> : initials(message.authorLabel)}
                    </div>
                    <div className="min-w-0 flex-1 rounded-lg border border-oa-border bg-oa-bg-elevated p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium text-oa-text">{message.authorLabel}</span>
                        <span className="shrink-0 text-[9px] text-oa-text-disabled">
                          {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-oa-text-secondary">
                        {renderMentions(message.body)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-oa-border p-3">
            <div className="flex items-end gap-2 rounded-xl border border-oa-border bg-oa-bg p-2 focus-within:border-oa-blue">
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    void submit();
                  }
                }}
                rows={3}
                placeholder="Add mission context... use @mentions"
                className="min-h-[72px] flex-1 resize-none bg-transparent text-xs text-oa-text outline-none placeholder:text-oa-text-disabled"
              />
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!body.trim() || !missionId || createMessage.isPending}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-oa-blue text-white disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Send mission thread message"
              >
                {createMessage.isPending ? <User className="h-4 w-4 animate-pulse" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
