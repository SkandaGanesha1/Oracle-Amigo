import { AlertTriangle, Archive, Bell, Bot, CheckCircle2, Clock3, Inbox, MessageCircle, ShieldAlert, XCircle } from "lucide-react";
import type { InboxBucket } from "../../api/types";

const BUCKETS: Array<{ id: InboxBucket; label: string; icon: typeof Inbox }> = [
  { id: "needs_my_approval", label: "Needs my approval", icon: ShieldAlert },
  { id: "agent_working", label: "Agent working", icon: Bot },
  { id: "waiting_on_others", label: "Waiting on others", icon: Clock3 },
  { id: "risky_sensitive", label: "Risky or sensitive", icon: AlertTriangle },
  { id: "mentions", label: "Mentions / messages", icon: MessageCircle },
  { id: "completed", label: "Completed", icon: CheckCircle2 },
  { id: "failed_blocked", label: "Failed / blocked", icon: XCircle },
  { id: "archived", label: "Archived", icon: Archive }
];

export function InboxBucketRail({
  activeBucket,
  counts,
  onBucketChange
}: {
  activeBucket: InboxBucket;
  counts: Record<InboxBucket, number>;
  onBucketChange: (bucket: InboxBucket) => void;
}) {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return (
    <aside className="oa-inbox-bucket-rail min-h-0 border-r border-oa-border bg-oa-sidebar-bg px-3 py-4">
      <div className="mb-4 px-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-oa-text-muted">
          <Bell className="h-3.5 w-3.5" />
          Action Center
        </div>
        <p className="mt-1 text-[11px] text-oa-text-disabled">{total} tracked items</p>
      </div>
      <div className="space-y-1">
        {BUCKETS.map((bucket) => {
          const Icon = bucket.icon;
          const active = bucket.id === activeBucket;
          const count = counts[bucket.id] ?? 0;
          return (
            <button
              key={bucket.id}
              type="button"
              onClick={() => onBucketChange(bucket.id)}
              className={`flex min-h-[38px] w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                active ? "bg-oa-blue/12 text-oa-text ring-1 ring-oa-blue/25" : "text-oa-text-muted hover:bg-white/[0.045] hover:text-oa-text"
              }`}
              aria-current={active ? "true" : undefined}
            >
              <Icon className={`h-4 w-4 shrink-0 ${active ? "text-oa-blue" : ""}`} />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{bucket.label}</span>
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${active ? "bg-oa-blue/20 text-oa-blue" : "bg-oa-surface-2 text-oa-text-muted"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
