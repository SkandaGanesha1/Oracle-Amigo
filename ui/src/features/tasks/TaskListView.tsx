import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Ban, CheckCircle2, Clock, ListChecks, PauseCircle, PlayCircle, RefreshCw, Search, X, XCircle, AlertTriangle, type LucideIcon } from "lucide-react";
import { useCancelMission, usePauseMission, useResumeMission, useRetryMission, useTaskMissionProjections } from "../../hooks/queries";
import type { TaskMissionProjection } from "../../api/types";
import { toast } from "../../components/primitives/OracleToast";

const statusConfig: Record<TaskMissionProjection["status"], { icon: LucideIcon; color: string; bg: string; label: string }> = {
  running: { icon: Clock, color: "text-oa-blue", bg: "bg-oa-blue/10", label: "Running" },
  waiting: { icon: AlertTriangle, color: "text-oa-amber", bg: "bg-oa-amber/10", label: "Waiting" },
  completed: { icon: CheckCircle2, color: "text-oa-green", bg: "bg-oa-green/10", label: "Completed" },
  failed: { icon: XCircle, color: "text-oa-red", bg: "bg-oa-red/10", label: "Failed" },
  cancelled: { icon: Ban, color: "text-oa-text-muted", bg: "bg-oa-surface-2", label: "Cancelled" },
};

const statusFilters = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "waiting", label: "Waiting" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
] as const;

export function TaskListView() {
  const { data: tasks = [], isLoading } = useTaskMissionProjections();
  const pauseMission = usePauseMission();
  const resumeMission = useResumeMission();
  const cancelMission = useCancelMission();
  const retryMission = useRetryMission();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return tasks.filter((task) => {
      const haystack = `${task.title} ${task.message} ${task.owner} ${task.source}`.toLowerCase();
      if (q && !haystack.includes(q)) return false;
      if (statusFilter !== "all" && task.status !== statusFilter) return false;
      return true;
    });
  }, [search, statusFilter, tasks]);

  const running = tasks.filter((task) => task.status === "running").length;
  const failed = tasks.filter((task) => task.status === "failed").length;

  async function runControl(action: "pause" | "resume" | "cancel" | "retry", task: TaskMissionProjection) {
    if (!task.controlTaskId) return;
    try {
      if (action === "pause") await pauseMission.mutateAsync(task.controlTaskId);
      if (action === "resume") await resumeMission.mutateAsync(task.controlTaskId);
      if (action === "cancel") await cancelMission.mutateAsync(task.controlTaskId);
      if (action === "retry") await retryMission.mutateAsync(task.controlTaskId);
      toast.success(`Task ${action} requested`);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : `Failed to ${action} task`);
    }
  }

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
    <div className="flex max-w-5xl flex-1 flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-oa-text">Tasks</h1>
        <p className="text-sm text-oa-text-muted">
          {tasks.length} task{tasks.length !== 1 ? "s" : ""}
          {running > 0 && ` - ${running} running`}
          {failed > 0 && ` - ${failed} failed`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-oa-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tasks..."
            className="h-10 w-full rounded-lg border border-oa-border bg-oa-surface pl-10 pr-3 text-sm text-oa-text outline-none transition focus:border-oa-blue placeholder:text-oa-text-disabled"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 flex min-h-[48px] min-w-[48px] -translate-y-1/2 items-center justify-center text-oa-text-muted hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-oa-text-muted">Status</span>
          <div className="flex gap-1">
            {statusFilters.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setStatusFilter(option.value)}
                className={`rounded-md px-2.5 py-1.5 text-[10px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue ${
                  statusFilter === option.value ? "bg-oa-blue/20 text-oa-blue" : "text-oa-text-muted hover:bg-oa-surface hover:text-oa-text"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex max-w-sm flex-col items-center gap-3 text-center">
            <ListChecks className="h-10 w-10 text-oa-text-muted" />
            <div>
              <p className="text-sm font-medium text-oa-text-muted">
                {search || statusFilter !== "all" ? "No tasks match your filters" : "No tasks yet"}
              </p>
              <p className="mt-1 text-xs text-oa-text-disabled">
                {search || statusFilter !== "all" ? "Try adjusting your search or filters" : "Missions and A2A tasks will appear here when agents start work"}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {filtered.map((task) => (
            <TaskRow key={`${task.source}-${task.id}`} task={task} onControl={(action) => void runControl(action, task)} />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, onControl }: { task: TaskMissionProjection; onControl: (action: "pause" | "resume" | "cancel" | "retry") => void }) {
  const config = statusConfig[task.status];
  const StatusIcon = config.icon;
  const canControl = Boolean(task.controlTaskId);

  return (
    <div className="group flex items-start gap-3 rounded-xl border border-oa-border bg-oa-surface p-4 transition hover:border-oa-border-strong">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${config.bg}`}>
        <StatusIcon className={`h-4 w-4 ${config.color}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate text-sm font-medium text-oa-text">{task.title}</h3>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium ${config.color} ${config.bg}`}>
            {config.label}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-oa-text-muted">{task.message}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-oa-text-disabled">
          <span>{new Date(task.updatedAt).toLocaleString()}</span>
          <span>{task.source}</span>
          <span>{task.owner}</span>
          <span>{task.stepCount} step{task.stepCount === 1 ? "" : "s"}</span>
          <span>risk {task.riskLevel}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {canControl && task.status === "running" && (
          <>
            <IconButton label="Pause task" onClick={() => onControl("pause")} icon={PauseCircle} />
            <IconButton label="Cancel task" onClick={() => onControl("cancel")} icon={Ban} danger />
          </>
        )}
        {canControl && task.status === "waiting" && <IconButton label="Resume task" onClick={() => onControl("resume")} icon={PlayCircle} />}
        {canControl && task.status === "failed" && <IconButton label="Retry task" onClick={() => onControl("retry")} icon={RefreshCw} />}
        {task.conversationId && (
          <Link
            to={`/chats/${task.conversationId}`}
            className="flex min-h-[48px] shrink-0 items-center gap-1 rounded-lg px-3 text-[10px] text-oa-text-muted transition hover:bg-oa-surface-2 hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
          >
            Open
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}

function IconButton({ label, onClick, icon: Icon, danger }: { label: string; onClick: () => void; icon: LucideIcon; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue ${
        danger ? "text-oa-red hover:bg-oa-red/10" : "text-oa-text-muted hover:bg-oa-surface-2 hover:text-oa-text"
      }`}
      aria-label={label}
      title={label}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
