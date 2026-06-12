import { OracleAvatar } from "../../components/primitives/OracleAvatar";
import { OracleBadge } from "../../components/primitives/OracleBadge";
import type { Conversation } from "../../api/types";
import { normalizePeerPresence, presenceBadgeColor } from "../../lib/normalizePeerPresence";

interface ConversationListItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (id: string) => void;
}

const FILENAME_EXT_RE = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|txt|csv|json|xml|exe|dll|bat|sh|ps1|png|jpg|gif|mp4|mp3)$/i;
const UUID_AGENT_RE = /^ag[ei]_[a-f0-9-]{36,}$/;

function sanitizeLabel(raw: string): string {
  if (UUID_AGENT_RE.test(raw.trim())) return "Remote agent conversation";
  if (FILENAME_EXT_RE.test(raw.trim())) {
    const ext = raw.trim().match(FILENAME_EXT_RE)?.[0]?.toUpperCase() ?? "FILE";
    return `Approval: ${ext} request`;
  }
  return raw;
}

export function ConversationListItem({ conversation, isActive, onSelect }: ConversationListItemProps) {
  const presence = normalizePeerPresence(conversation);
  const badgeColor = presenceBadgeColor(presence);
  const isAgent = Boolean(conversation.agentInstanceId && !conversation.peerUserId);
  const displayTitle = sanitizeLabel(conversation.title);
  const subtitle = isAgent
    ? `Remote agent \u00b7 ${presence.label}`
    : sanitizeLabel(conversation.lastMessage);

  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.id)}
      aria-current={isActive ? "true" : undefined}
      className={`flex min-h-[48px] w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2 ${
        isActive
          ? "bg-oa-bubble-bg ring-1 ring-oa-border"
          : "hover:bg-oa-surface"
      }`}
    >
      <div className="shrink-0">
        <OracleBadge color={badgeColor} anchor placement="bottom-right">
          <OracleAvatar
            seed={conversation.title}
            initials={conversation.title.slice(0, 2).toUpperCase()}
            size="sm"
            className="h-9 w-9"
          />
        </OracleBadge>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-oa-text">
            {displayTitle}
          </span>
          {conversation.unread > 0 && (
            <span className="ml-auto shrink-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-oa-blue px-1.5 text-[10px] font-bold text-white">
              {conversation.unread > 99 ? "99+" : conversation.unread}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="truncate text-xs text-oa-text-muted">
            {subtitle}
          </span>
        </div>
      </div>
    </button>
  );
}
