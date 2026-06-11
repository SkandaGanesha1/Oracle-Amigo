import { useMemo } from "react";
import { ConversationListItem } from "./ConversationListItem";
import type { Conversation } from "../../api/types";

const emptyPlaceholders = ["No messages yet", "Conversation starting", "Starting conversation"];
function isEmptyPlaceholder(conv: Conversation): boolean {
  const msgs = conv.messages ?? [];
  const hasHumanMessages = msgs.some((m) => m.kind === "human");
  if (hasHumanMessages) return false;
  if (msgs.length < 2) return true;
  const onlySystem = msgs.every((m) => m.kind === "system_event" || m.kind === "agent_status");
  if (onlySystem) return true;
  return (
    msgs.length === 0 && emptyPlaceholders.some((p) => conv.lastMessage?.includes(p))
  );
}

interface ConversationListProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelect: (id: string) => void;
}

export function ConversationList({ conversations, activeConversationId, onSelect }: ConversationListProps) {
  const { approvals, people, agents, inactive } = useMemo(() => {
    const approvals: Conversation[] = [];
    const people: Conversation[] = [];
    const agents: Conversation[] = [];
    const inactive: Conversation[] = [];
    for (const conv of conversations) {
      if (isEmptyPlaceholder(conv)) {
        inactive.push(conv);
      } else if (conv.pendingApprovals > 0) {
        approvals.push(conv);
      } else if (conv.agentInstanceId) {
        agents.push(conv);
      } else {
        people.push(conv);
      }
    }
    return { approvals, people, agents, inactive };
  }, [conversations]);

  const hasActive = approvals.length > 0 || people.length > 0 || agents.length > 0;

  if (!hasActive) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
        <p className="text-sm font-medium text-oa-text">Welcome to Oracle Amigo</p>
        <p className="text-xs text-oa-text-muted max-w-[200px]">
          Search the directory to find people and agents, or start a local conversation
        </p>
        <div className="flex flex-col gap-1.5 mt-1 w-full">
          <p className="text-[10px] text-oa-text-disabled">Try: browse the directory, start a chat, or check pending approvals</p>
        </div>
      </div>
    );
  }

  function renderSection(title: string, items: Conversation[], badge?: number) {
    if (items.length === 0) return null;
    return (
      <>
        <div className="flex items-center gap-1.5 px-3 py-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-oa-text-muted">{title}</span>
          {badge !== undefined && badge > 0 && (
            <span className="rounded-full bg-oa-amber/20 px-1.5 py-0.5 text-[9px] font-medium text-oa-amber leading-none">
              {badge}
            </span>
          )}
        </div>
        {items.map((conversation) => (
          <ConversationListItem
            key={conversation.id}
            conversation={conversation}
            isActive={conversation.id === activeConversationId}
            onSelect={onSelect}
          />
        ))}
      </>
    );
  }

  const hasPrev = (idx: number) => {
    const sections = [approvals, people, agents];
    return sections.slice(0, idx).some((s) => s.length > 0);
  };

  return (
    <div className="flex flex-col gap-0.5 px-2 py-2">
      {renderSection("Approvals", approvals)}
      {hasPrev(1) && approvals.length > 0 && <div className="pt-2" />}
      {renderSection("People", people)}
      {hasPrev(2) && people.length > 0 && <div className="pt-2" />}
      {renderSection("Agents", agents)}
      {inactive.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer px-3 py-1 text-[10px] uppercase tracking-wider text-oa-text-muted hover:text-oa-text-secondary">
            Inactive ({inactive.length})
          </summary>
          <div className="flex flex-col gap-0.5 pt-1">
            {inactive.map((conversation) => (
              <ConversationListItem
                key={conversation.id}
                conversation={conversation}
                isActive={conversation.id === activeConversationId}
                onSelect={onSelect}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
