import { AlertTriangle, Bot, CheckCircle2, FileCheck2, FileText, MessageCircle, ShieldAlert } from "lucide-react";
import type { InboxItem, InboxItemKind } from "../../api/types";

const KIND_ICON: Record<InboxItemKind, typeof ShieldAlert> = {
  approval: ShieldAlert,
  file_request: FileText,
  file_transfer: FileCheck2,
  agent_run: Bot,
  mission: Bot,
  chat_message: MessageCircle,
  security_alert: AlertTriangle,
  audit_event: CheckCircle2,
  system: Bot
};

export function InboxItemRow({
  item,
  selected,
  onSelect,
  onQuickAction
}: {
  item: InboxItem;
  selected: boolean;
  onSelect: () => void;
  onQuickAction: (action: string, item: InboxItem) => void;
}) {
  const Icon = KIND_ICON[item.kind] ?? Bot;
  return (
    <button
      type="button"
      onClick={onSelect}
      data-selected={selected ? "true" : "false"}
      className="oa-inbox-row group flex w-full gap-3 px-3 py-3 text-left transition-colors hover:bg-white/[0.045] data-[selected=true]:bg-oa-blue/10 data-[selected=true]:shadow-[inset_0_0_0_1px_rgba(88,166,255,0.25)]"
    >
      <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
        item.priority === "critical" || item.priority === "high" ? "bg-oa-amber/10 text-oa-amber" : "bg-oa-blue/10 text-oa-blue"
      }`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="truncate text-sm font-semibold text-oa-text">{item.title}</p>
          {item.unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-oa-blue" aria-label="Unread" />}
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-oa-text-muted">{item.summary}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <InboxBadge tone={item.risk.level === "high" || item.risk.level === "critical" ? "warning" : "muted"}>{item.risk.level}</InboxBadge>
          <InboxBadge tone="muted">{item.status}</InboxBadge>
          {item.privacy.leavesDevice && <InboxBadge tone="warning">Leaves device</InboxBadge>}
          {item.requester?.verified && <InboxBadge tone="success">Verified</InboxBadge>}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <time className="text-[11px] text-oa-text-muted">{formatInboxTime(item.updatedAt)}</time>
        <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {item.actions.slice(0, 3).map((action) => (
            <span
              key={action.id}
              role="button"
              tabIndex={-1}
              onClick={(event) => {
                event.stopPropagation();
                onQuickAction(action.id, item);
              }}
              className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                action.primary ? "bg-oa-blue text-white" : action.destructive ? "bg-oa-red/10 text-oa-red" : "bg-oa-surface-2 text-oa-text-muted"
              }`}
            >
              {action.label}
            </span>
          ))}
        </div>
      </div>
    </button>
  );
}

function InboxBadge({ children, tone }: { children: string; tone: "muted" | "warning" | "success" }) {
  const className = {
    muted: "border-oa-border bg-oa-surface-2 text-oa-text-muted",
    warning: "border-oa-amber/20 bg-oa-amber/10 text-oa-amber",
    success: "border-oa-green/20 bg-oa-green/10 text-oa-green"
  }[tone];
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${className}`}>{children}</span>;
}

export function formatInboxTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const now = Date.now();
  if (now - date.getTime() < 24 * 60 * 60 * 1000) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}
