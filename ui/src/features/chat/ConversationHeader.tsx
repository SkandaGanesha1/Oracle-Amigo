import { PanelRightOpen, PanelRightClose } from "lucide-react";
import { OracleAvatar } from "../../components/primitives/OracleAvatar";
import { OracleBadge } from "../../components/primitives/OracleBadge";
import type { Conversation } from "../../api/types";

const presenceToBadgeColor: Record<string, "success" | "warning" | "default" | "danger"> = {
  online: "success",
  stale: "warning",
  offline: "default",
  revoked: "danger",
  unknown: "default",
};

interface ConversationHeaderProps {
  conversation: Conversation;
  onToggleInspector: () => void;
  inspectorOpen: boolean;
}

const presenceLabel: Record<string, string> = {
  online: "Online",
  offline: "Offline",
  stale: "Away",
  revoked: "Revoked",
  unknown: "Presence unavailable",
};

function friendlifyName(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes("remote agent") || lower.startsWith("agi_") || /[0-9a-f]{8}-[0-9a-f]{4}-/.test(lower)) {
    return "Remote Agent";
  }
  return title;
}

export function ConversationHeader({ conversation, onToggleInspector, inspectorOpen }: ConversationHeaderProps) {
  const presence = conversation.presence ?? "unknown";
  const badgeColor = presenceToBadgeColor[presence] ?? "default";
  const label = presenceLabel[presence] ?? "";
  const displayTitle = friendlifyName(conversation.title);

  return (
    <header className="glass-panel flex h-14 shrink-0 items-center gap-3 border-x-0 border-t-0 px-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="shrink-0">
          <OracleBadge color={badgeColor} anchor placement="bottom-right">
            <OracleAvatar
              seed={displayTitle}
              initials={displayTitle.slice(0, 2).toUpperCase()}
              size="sm"
              className="h-9 w-9"
            />
          </OracleBadge>
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold text-oa-text">
            {displayTitle}
          </span>
          {label && (
            <span className="text-xs text-oa-text-muted">
              {label}
            </span>
          )}
        </div>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={onToggleInspector}
          className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg text-oa-text-muted transition-colors hover:bg-oa-surface hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
          aria-label={inspectorOpen ? "Close inspector" : "Open inspector"}
          aria-expanded={inspectorOpen}
          aria-controls="right-inspector-panel"
          title={inspectorOpen ? "Close inspector" : "Open inspector"}
        >
          {inspectorOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );
}
