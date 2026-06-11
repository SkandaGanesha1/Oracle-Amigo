import { useState, useMemo } from "react";
import { useConversations } from "../../hooks/queries";
import { Link } from "react-router-dom";
import type { Conversation } from "../../api/types";
import { ListChecks, Search, X, Clock, CheckCircle2, XCircle, AlertTriangle, ArrowRight } from "lucide-react";

const statusConfig = {
  running: { icon: Clock, color: "text-oa-blue", bg: "bg-oa-blue/10", label: "Running" },
  completed: { icon: CheckCircle2, color: "text-oa-green", bg: "bg-oa-green/10", label: "Completed" },
  failed: { icon: XCircle, color: "text-oa-red", bg: "bg-oa-red/10", label: "Failed" },
  partial: { icon: AlertTriangle, color: "text-oa-amber", bg: "bg-oa-amber/10", label: "Partial" },
} as const;

interface TaskEntry {
  id: string;
  conversationId: string;
  title: string;
  status: "running" | "completed" | "failed" | "partial";
  message: string;
  createdAt: string;
}

function extractTasks(conversationsData: { conversations: Conversation[] } | undefined): TaskEntry[] {
  if (!conversationsData?.conversations) return [];
  const tasks: TaskEntry[] = [];
  for (const conv of conversationsData.conversations) {
    for (const msg of conv.messages ?? []) {
      if (msg.kind === "agent_status") {
        const asMsg = msg as { kind: "agent_status"; created_at: string; phase: string; status_text: string };
        tasks.push({
          id: `${conv.id}-${asMsg.created_at}`,
          conversationId: conv.id,
          title: conv.title,
          status: asMsg.phase === "completed" ? "completed" : asMsg.phase === "failed" ? "failed" : "running",
          message: asMsg.status_text ?? "",
          createdAt: asMsg.created_at,
        });
      }
    }
  }
  tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return tasks.slice(0, 100);
}

const statusFilters = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
] as const;

export function TaskListView() {
  const { data: conversationsData, isLoading } = useConversations();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const tasks = useMemo(() => extractTasks(conversationsData), [conversationsData]);

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (search && !t.title.toLowerCase().includes(search.toLowerCase()) && !t.message.toLowerCase().includes(search.toLowerCase())) return false;
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      return true;
    });
  }, [tasks, search, statusFilter]);

  const running = tasks.filter((t) => t.status === "running").length;
  const failed = tasks.filter((t) => t.status === "failed").length;

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-oa-blue border-t-transparent" />
          <p className="text-xs text-oa-text-muted">Loading tasks...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6 max-w-5xl">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-oa-text">Tasks</h1>
        <p className="text-sm text-oa-text-muted">
          {tasks.length} task{tasks.length !== 1 ? "s" : ""}
          {running > 0 && ` - ${running} running`}
          {failed > 0 && ` - ${failed} failed`}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-oa-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks..."
            className="h-10 w-full rounded-lg border border-oa-border bg-oa-surface pl-10 pr-3 text-sm text-oa-text outline-none transition focus:border-oa-blue placeholder:text-oa-text-disabled"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 flex min-h-[48px] min-w-[48px] items-center justify-center text-oa-text-muted hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-oa-text-muted uppercase tracking-wider">Status</span>
          <div className="flex gap-1">
            {statusFilters.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setStatusFilter(opt.value)}
                className={`rounded-md px-2.5 py-1.5 text-[10px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue ${
                  statusFilter === opt.value ? "bg-oa-blue/20 text-oa-blue" : "text-oa-text-muted hover:bg-oa-surface hover:text-oa-text"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center max-w-sm">
            <ListChecks className="h-10 w-10 text-oa-text-muted" />
            <div>
              <p className="text-sm font-medium text-oa-text-muted">
                {search || statusFilter !== "all" ? "No tasks match your filters" : "No tasks yet"}
              </p>
              <p className="text-xs text-oa-text-disabled mt-1">
                {search || statusFilter !== "all" ? "Try adjusting your search or filters" : "Agent tasks will appear here when you chat with agents"}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {filtered.map((task) => {
            const config = statusConfig[task.status];
            const StatusIcon = config.icon;
            return (
              <div key={task.id} className="group flex items-start gap-3 rounded-xl border border-oa-border bg-oa-surface p-4 transition hover:border-oa-border-strong">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${config.bg}`}>
                  <StatusIcon className={`h-4 w-4 ${config.color}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium text-oa-text truncate">{task.title}</h3>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium ${config.color} ${config.bg}`}>
                      {config.label}
                    </span>
                  </div>
                  {task.message && (
                    <p className="mt-0.5 text-xs text-oa-text-muted line-clamp-2">{task.message}</p>
                  )}
                  <div className="mt-2 flex items-center gap-3 text-[10px] text-oa-text-disabled">
                    <span>{new Date(task.createdAt).toLocaleString()}</span>
                    <span>Conversation activity</span>
                  </div>
                </div>
                <Link
                  to={`/chats/${task.conversationId}`}
                  className="flex min-h-[48px] shrink-0 items-center gap-1 rounded-lg px-3 text-[10px] text-oa-text-muted opacity-0 transition hover:bg-oa-surface-2 hover:text-oa-text group-hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
                >
                  Open
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
