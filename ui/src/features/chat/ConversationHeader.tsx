import { Badge } from "@heroui/react";
import { OracleAvatar } from "../../components/primitives/OracleAvatar";
import type { Conversation } from "../../api/types";
import { normalizePeerPresence } from "../../lib/normalizePeerPresence";

interface ConversationHeaderProps {
  conversation: Conversation;
  onToggleInspector?: () => void;
  inspectorOpen?: boolean;
}

function friendlifyName(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes("remote agent") || lower.startsWith("agi_") || /[0-9a-f]{8}-[0-9a-f]{4}-/.test(lower)) {
    return "Remote Agent";
  }
  return title;
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (parts[0] ?? "U").slice(0, 2).toUpperCase();
}

function isLocalConversation(conversation: Conversation): boolean {
  return conversation.id === "local-agent" || conversation.title.toLowerCase().includes("local agent");
}

export function ConversationHeader({ conversation }: ConversationHeaderProps) {
  const presence = normalizePeerPresence(conversation);
  const displayTitle = friendlifyName(conversation.title);
  const local = isLocalConversation(conversation);
  const initials = local ? "MY" : initialsFor(displayTitle);

  return (
    <header className="oa-chat-header glass-panel">
      <div className="oa-chat-header-identity">
        <Badge.Anchor className="oa-rail-avatar-anchor relative inline-flex h-10 w-10 overflow-visible">
          <OracleAvatar
            seed={local ? "local-agent" : displayTitle}
            initials={initials}
            size="md"
            className="oa-rail-avatar h-10 w-10 rounded-full ring-2 ring-transparent"
          />
          <Badge
            color={presence.status === "online" ? "success" : "danger"}
            size="md"
            placement="bottom-right"
            className={`oa-rail-presence-badge ${presence.status === "online" ? "oa-rail-presence-online" : "oa-rail-presence-offline"}`}
          />
        </Badge.Anchor>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-oa-chat-text">
            {displayTitle}
          </div>
        </div>
      </div>
    </header>
  );
}
