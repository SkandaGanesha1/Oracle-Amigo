import { useState } from "react";
import { ListOrdered, Clock, CheckCircle2, CircleDotDashed, CircleX, ArrowUpDown, Trash2 } from "lucide-react";

interface QueueItem {
  id: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed";
  priority?: "high" | "medium" | "low";
  queuedAt: string;
  description?: string;
}

interface AgentQueueProps {
  items: QueueItem[];
  onCancel?: (id: string) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  className?: string;
}

const priorityOrder = { high: 0, medium: 1, low: 2 };

export function AgentQueue({ items, onCancel, onReorder, className }: AgentQueueProps) {
  const [sortBy, setSortBy] = useState<"priority" | "date">("priority");
  const sorted = [...items].sort((a, b) =>
    sortBy === "priority"
      ? priorityOrder[a.priority ?? "medium"] - priorityOrder[b.priority ?? "medium"]
      : new Date(a.queuedAt).getTime() - new Date(b.queuedAt).getTime()
  );

  return (
    <div className={`rounded-xl border border-oa-border bg-oa-surface ${className ?? ""}`}>
      <div className="flex items-center justify-between border-b border-oa-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <ListOrdered className="h-4 w-4 text-oa-blue" />
          <span className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">Queue</span>
          <span className="rounded-full bg-oa-surface-2 px-1.5 py-0.5 text-[10px] text-oa-text-muted">{items.length}</span>
        </div>
        <button
          type="button"
          onClick={() => setSortBy((s) => (s === "priority" ? "date" : "priority"))}
          className="flex items-center gap-1 text-[10px] text-oa-text-muted hover:text-oa-text"
        >
          <ArrowUpDown className="h-3 w-3" />
          {sortBy === "priority" ? "Priority" : "Date"}
        </button>
      </div>

      <div className="max-h-72 space-y-1 overflow-y-auto p-2">
        {sorted.length === 0 ? (
          <p className="py-4 text-center text-xs text-oa-text-disabled">Queue is empty</p>
        ) : (
          sorted.map((item, index) => {
            const StatusIcon = item.status === "completed"
              ? CheckCircle2
              : item.status === "running"
                ? CircleDotDashed
                : item.status === "failed"
                  ? CircleX
                  : Clock;

            const iconColor = item.status === "completed"
              ? "text-oa-green"
              : item.status === "running"
                ? "text-oa-blue"
                : item.status === "failed"
                  ? "text-oa-red"
                  : "text-oa-text-muted";

            const priorityColor = item.priority === "high"
              ? "border-oa-red/30 bg-oa-red/5"
              : item.priority === "low"
                ? "border-oa-border bg-oa-bg-elevated"
                : "border-oa-border bg-oa-bg-elevated";

            return (
              <div
                key={item.id}
                className={`flex items-start gap-2.5 rounded-lg border p-2.5 ${priorityColor}`}
              >
                <StatusIcon className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor} ${item.status === "running" ? "animate-spin" : ""}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-oa-text truncate">{item.label}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {item.priority && item.priority !== "medium" && (
                        <span className={`text-[10px] font-medium ${item.priority === "high" ? "text-oa-red" : "text-oa-text-muted"}`}>
                          {item.priority}
                        </span>
                      )}
                      {item.status === "pending" && onCancel && (
                        <button
                          type="button"
                          onClick={() => onCancel(item.id)}
                          className="text-oa-text-muted hover:text-oa-red"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  {item.description && (
                    <p className="mt-0.5 text-[10px] text-oa-text-muted">{item.description}</p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
