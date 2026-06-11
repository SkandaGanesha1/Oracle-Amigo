import { OracleAvatar } from "../primitives/OracleAvatar";
import { OracleBadge } from "../primitives/OracleBadge";

const presenceToColor: Record<string, "success" | "warning" | "default" | "danger"> = {
  online: "success",
  stale: "warning",
  offline: "default",
  revoked: "danger",
  unknown: "default",
};

interface ChannelPreviewProps {
  title: string;
  subtitle: string;
  lastMessage: string;
  unread: number;
  presence: string;
  pendingApprovals: number;
  transferCount: number;
  isActive: boolean;
  onClick: () => void;
}

export function ChannelPreview({
  title,
  subtitle,
  lastMessage,
  unread,
  presence,
  pendingApprovals,
  isActive,
  onClick,
}: ChannelPreviewProps) {
  const badgeColor = presenceToColor[presence] ?? "default";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
        isActive ? "bg-oa-bubble-bg ring-1 ring-oa-border" : "hover:bg-oa-surface"
      }`}
    >
      <div className="shrink-0">
        <OracleBadge color={badgeColor} anchor placement="bottom-right">
          <OracleAvatar
            seed={title}
            initials={title.slice(0, 2).toUpperCase()}
            size="sm"
            className="h-9 w-9"
          />
        </OracleBadge>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-oa-text">{title}</span>
          {unread > 0 && (
            <span className="ml-auto shrink-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-oa-blue px-1.5 text-[10px] font-bold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="truncate text-xs text-oa-text-muted">{lastMessage}</span>
          {pendingApprovals > 0 && (
            <span className="ml-auto shrink-0 rounded bg-oa-amber/20 px-1.5 py-0.5 text-[10px] font-medium text-oa-amber">
              {pendingApprovals} pending
            </span>
          )}
        </div>
        {subtitle && (
          <span className="truncate text-[10px] text-oa-text-disabled">{subtitle}</span>
        )}
      </div>
    </button>
  );
}
