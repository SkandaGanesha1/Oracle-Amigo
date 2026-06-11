import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Brain, Clock, Database, Search } from "lucide-react";
import { useEpisodicMemory, useLongTermMemory, useMemoryConversations, useMemoryWindow } from "../../hooks/queries";

export function MemoryInspector() {
  const { data: conversationsData, isLoading } = useMemoryConversations();
  const conversations = conversationsData?.conversations ?? [];
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [memoryQuery, setMemoryQuery] = useState("");
  const activeConversationId = selectedConversationId ?? conversations[0]?.conversationId ?? null;
  const { data: windowData } = useMemoryWindow(activeConversationId);
  const { data: episodicData } = useEpisodicMemory(memoryQuery ? { query: memoryQuery, limit: 5 } : { limit: 5 });
  const { data: longTermData } = useLongTermMemory({ namespace: "default", query: memoryQuery, limit: 5 });

  useEffect(() => {
    if (!selectedConversationId && conversations[0]) {
      setSelectedConversationId(conversations[0].conversationId);
    }
  }, [conversations, selectedConversationId]);

  const windowMessages = windowData?.messages ?? [];
  const episodic = episodicData?.events ?? [];
  const longTerm = longTermData?.memories ?? [];
  const lastSeen = useMemo(() => conversations[0]?.lastMessageAt, [conversations]);

  return (
    <section className="rounded-xl border border-oa-border bg-oa-surface/80 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Brain className="h-4 w-4 text-oa-purple" />
        <h3 className="text-sm font-semibold text-oa-text">Memory Inspector</h3>
        {lastSeen && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-oa-text-muted">
            <Clock className="h-3 w-3" />
            {new Date(lastSeen).toLocaleString()}
          </span>
        )}
      </div>

      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-oa-text-muted" />
          <input
            value={memoryQuery}
            onChange={(event) => setMemoryQuery(event.target.value)}
            placeholder="Search episodic and long-term memory..."
            className="h-10 w-full rounded-lg border border-oa-border bg-oa-bg pl-9 pr-3 text-xs text-oa-text outline-none focus:border-oa-blue"
          />
        </div>
      </div>

      {isLoading ? (
        <p className="text-xs text-oa-text-muted">Loading memory...</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
          <div className="space-y-1">
            <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-oa-text-muted">Conversations</p>
            {conversations.length === 0 ? (
              <p className="rounded-lg border border-oa-border bg-oa-bg-elevated p-3 text-xs text-oa-text-muted">No memory conversations yet.</p>
            ) : conversations.slice(0, 8).map((conversation) => (
              <button
                key={conversation.conversationId}
                type="button"
                onClick={() => setSelectedConversationId(conversation.conversationId)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition ${
                  activeConversationId === conversation.conversationId
                    ? "border-oa-blue/50 bg-oa-blue/10 text-oa-text"
                    : "border-oa-border bg-oa-bg-elevated text-oa-text-muted hover:text-oa-text"
                }`}
              >
                <span className="block truncate font-medium">{conversation.conversationId}</span>
                <span className="text-[10px]">{conversation.messageCount} messages</span>
              </button>
            ))}
          </div>

          <div className="grid gap-3 xl:grid-cols-3">
            <MemoryColumn title="Short-Term Window" icon={<Brain className="h-3.5 w-3.5" />}>
              {windowMessages.length === 0 ? (
                <EmptyMemory />
              ) : windowMessages.slice(-6).map((message, index) => (
                <div key={`${message.createdAt}-${index}`} className="rounded-lg bg-oa-bg-elevated p-2">
                  <p className="text-[10px] font-semibold uppercase text-oa-text-muted">{message.role}</p>
                  <p className="mt-1 line-clamp-3 text-xs text-oa-text-secondary">{message.contentText}</p>
                </div>
              ))}
            </MemoryColumn>

            <MemoryColumn title="Episodic" icon={<Clock className="h-3.5 w-3.5" />}>
              {episodic.length === 0 ? (
                <EmptyMemory />
              ) : episodic.map((event, index) => (
                <div key={`${event.createdAt}-${index}`} className="rounded-lg bg-oa-bg-elevated p-2">
                  <p className="text-[10px] font-semibold uppercase text-oa-text-muted">{event.eventType}</p>
                  <p className="mt-1 line-clamp-3 text-xs text-oa-text-secondary">{event.summary}</p>
                </div>
              ))}
            </MemoryColumn>

            <MemoryColumn title="Long-Term" icon={<Database className="h-3.5 w-3.5" />}>
              {longTerm.length === 0 ? (
                <EmptyMemory />
              ) : longTerm.map((memory, index) => (
                <div key={`${memory.subjectId}-${index}`} className="rounded-lg bg-oa-bg-elevated p-2">
                  <p className="text-[10px] font-semibold uppercase text-oa-text-muted">{memory.subjectId}</p>
                  <p className="mt-1 line-clamp-3 text-xs text-oa-text-secondary">{memory.contentText}</p>
                </div>
              ))}
            </MemoryColumn>
          </div>
        </div>
      )}
    </section>
  );
}

function MemoryColumn({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-2 rounded-xl border border-oa-border/60 bg-oa-bg/60 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-oa-text-muted">
        {icon}
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function EmptyMemory() {
  return <p className="rounded-lg bg-oa-bg-elevated p-2 text-xs text-oa-text-muted">No entries available.</p>;
}
