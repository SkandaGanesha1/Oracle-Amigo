import { Badge } from "@heroui/react";
import { Activity, MoreHorizontal, PanelRight, Pin, Search, ShieldCheck } from "lucide-react";
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

function dispatchChatCommand(command: string, detail?: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent(command, { detail }));
}

export function ConversationHeader({ conversation, onToggleInspector, inspectorOpen = false }: ConversationHeaderProps) {
  const presence = normalizePeerPresence(conversation);
  const displayTitle = friendlifyName(conversation.title);
  const local = isLocalConversation(conversation);
  const initials = local ? "MY" : initialsFor(displayTitle);
  const unreadCount = conversation.readState?.unreadCount ?? conversation.unread ?? 0;
  const pendingCount = conversation.pendingApprovals ?? 0;
  const transferCount = conversation.transferCount ?? 0;

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
          <div className="oa-chat-header-subline">
            <span className={`oa-presence-dot ${presence.status === "online" ? "online" : "offline"}`} aria-hidden="true" />
            <span>{presence.label}</span>
            {unreadCount > 0 && <span>{unreadCount} unread</span>}
            {pendingCount > 0 && <span>{pendingCount} approval{pendingCount === 1 ? "" : "s"}</span>}
            {transferCount > 0 && <span>{transferCount} transfer{transferCount === 1 ? "" : "s"}</span>}
          </div>
        </div>
      </div>
      <div className="oa-chat-header-toolbar" aria-label="Chat tools">
        <button
          type="button"
          className="oa-chat-header-search"
          onClick={() => dispatchChatCommand("oa-open-chat-search", { conversationId: conversation.id })}
          aria-label={`Search ${displayTitle}`}
          title="Search this chat"
        >
          <Search className="h-4 w-4" />
          <span>Search</span>
        </button>
        <button
          type="button"
          className="oa-chat-header-icon"
          onClick={() => dispatchChatCommand("oa-open-pinned-messages", { conversationId: conversation.id })}
          aria-label="Open pinned messages"
          title="Pinned messages"
        >
          <Pin className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="oa-chat-header-icon"
          onClick={() => dispatchChatCommand("oa-open-chat-activity", { conversationId: conversation.id })}
          aria-label="Open chat activity"
          title="Activity"
        >
          <Activity className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="oa-chat-header-icon"
          onClick={() => dispatchChatCommand("oa-open-security-context", { conversationId: conversation.id })}
          aria-label="Open security context"
          title="Security context"
        >
          <ShieldCheck className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="oa-chat-header-icon"
          onClick={onToggleInspector}
          aria-label={inspectorOpen ? "Close inspector" : "Open inspector"}
          aria-controls="right-inspector-panel"
          aria-pressed={inspectorOpen}
          title={inspectorOpen ? "Close inspector" : "Open inspector"}
        >
          <PanelRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="oa-chat-header-icon oa-chat-header-more"
          onClick={() => dispatchChatCommand("oa-open-chat-actions", { conversationId: conversation.id })}
          aria-label="More chat actions"
          title="More"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
