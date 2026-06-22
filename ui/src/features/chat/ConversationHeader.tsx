import { Badge } from "@heroui/react";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { OracleAvatar } from "../../components/primitives/OracleAvatar";
import type { Conversation } from "../../api/types";
import { normalizePeerPresence } from "../../lib/normalizePeerPresence";
import { ConversationProfileCard } from "./ConversationProfileCard";

interface ConversationHeaderProps {
  conversation: Conversation;
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

function detailForProfile(conversation: Conversation, fallback: string): string {
  const subtitle = conversation.subtitle.trim();
  if (!subtitle) return fallback;
  return subtitle;
}

function dispatchChatCommand(command: string, detail?: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent(command, { detail }));
}

export function ConversationHeader({ conversation }: ConversationHeaderProps) {
  const presence = normalizePeerPresence(conversation);
  const displayTitle = friendlifyName(conversation.title);
  const description = conversation.subtitle.trim() || "Oracle Amigo conversation";
  const local = isLocalConversation(conversation);
  const initials = local ? "MY" : initialsFor(displayTitle);
  const avatarSeed = local ? "local-agent" : displayTitle;

  return (
    <header className="oa-chat-header glass-panel">
      <Dialog>
        <DialogTrigger asChild>
          <button
            type="button"
            className="oa-chat-header-identity"
            aria-label={`Open ${displayTitle} profile card`}
          >
            <Badge.Anchor className="oa-rail-avatar-anchor relative inline-flex h-10 w-10 overflow-visible">
              <OracleAvatar
                seed={avatarSeed}
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
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-semibold text-oa-chat-text">
                {displayTitle}
              </span>
            </span>
          </button>
        </DialogTrigger>
        <DialogContent
          className="oa-conversation-profile-dialog w-[24rem] max-w-[calc(100vw-32px)] border-0 bg-transparent p-0 shadow-none"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">{displayTitle} profile card</DialogTitle>
          <DialogDescription className="sr-only">{description}</DialogDescription>
          <ConversationProfileCard
            name={displayTitle}
            description={description}
            avatarSeed={avatarSeed}
            emailOrDetail={detailForProfile(conversation, description)}
            initials={initials}
            presenceStatus={presence.status}
          />
        </DialogContent>
      </Dialog>
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
    </header>
  );
}
