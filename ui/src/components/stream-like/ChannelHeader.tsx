import { OracleAvatar } from "../primitives/OracleAvatar";
import { OracleBadge } from "../primitives/OracleBadge";

const presenceToColor: Record<string, "success" | "warning" | "default" | "danger"> = {
  online: "success",
  stale: "warning",
  offline: "default",
  revoked: "danger",
  unknown: "default",
};

interface ChannelHeaderProps {
  title: string;
  presence?: string;
  onToggleInspector?: () => void;
  inspectorOpen?: boolean;
}

export function ChannelHeader({ title, presence = "unknown", onToggleInspector, inspectorOpen }: ChannelHeaderProps) {
  const badgeColor = presenceToColor[presence] ?? "default";

  return (
    <div className="flex items-center gap-3 border-b border-oa-border bg-oa-sidebar-bg px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        <OracleBadge color={badgeColor} anchor placement="bottom-right">
          <OracleAvatar
            seed={title}
            initials={title.slice(0, 2).toUpperCase()}
            size="sm"
            className="h-8 w-8"
          />
        </OracleBadge>
        <div>
          <h2 className="text-sm font-semibold text-oa-text">{title}</h2>
          <p className="text-[11px] capitalize text-oa-text-muted">{presence}</p>
        </div>
      </div>

      {onToggleInspector && (
        <button
          type="button"
          onClick={onToggleInspector}
          aria-label={inspectorOpen ? "Close inspector" : "Open inspector"}
          aria-expanded={inspectorOpen}
          aria-controls="right-inspector-panel"
          className={`ml-auto flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
            inspectorOpen ? "bg-oa-surface text-oa-text" : "text-oa-text-muted hover:bg-oa-surface hover:text-oa-text"
          }`}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17a2 2 0 0 1-2.83 0l-2.83-2.83a2 2 0 0 1 0-2.83l2.83-2.83a2 2 0 0 1 2.83 0l2.83 2.83a2 2 0 0 1 0 2.83l-2.83 2.83z" />
          </svg>
        </button>
      )}
    </div>
  );
}
