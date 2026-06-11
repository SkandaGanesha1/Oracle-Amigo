import { useState, useMemo } from "react";
import { useConversations, useAgentRuns, useA2ATasks, usePauseMission, useResumeMission, useCancelMission, useRetryMission } from "../../hooks/queries";
import { Clock, CheckCircle2, XCircle, PauseCircle, PlayCircle, Ban, RefreshCw, Bot, Workflow, Search, type LucideIcon } from "lucide-react";
import { MissionTimeline } from "./MissionTimeline";
import type { A2ATaskSummary } from "../../types";
import { toast } from "../../components/primitives/OracleToast";

const STATUS_CONFIG: Record<string, { icon: LucideIcon; color: string; bg: string }> = {
  running: { icon: Clock, color: "text-oa-blue", bg: "bg-oa-blue/10" },
  completed: { icon: CheckCircle2, color: "text-oa-green", bg: "bg-oa-green/10" },
  failed: { icon: XCircle, color: "text-oa-red", bg: "bg-oa-red/10" },
  cancelled: { icon: Ban, color: "text-oa-text-muted", bg: "bg-oa-surface-2" },
};

function missionStatus(task: A2ATaskSummary): "running" | "completed" | "failed" | "cancelled" {
  const s = `${task.status} ${task.state}`.toLowerCase();
  if (/cancel/.test(s)) return "cancelled";
  if (/fail|error/.test(s)) return "failed";
  if (/done|complete/.test(s)) return "completed";
  return "running";
}

export function MissionsPage() {
  const { data: convsData } = useConversations();
  const { data: tasksData } = useA2ATasks();
  const { data: agentRunsData } = useAgentRuns();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);

  const pauseMission = usePauseMission();
  const resumeMission = useResumeMission();
  const cancelMission = useCancelMission();
  const retryMission = useRetryMission();

  const tasks = tasksData?.tasks ?? [];
  const convs = convsData?.conversations ?? [];
  const runs = agentRunsData?.runs ?? [];

  type MissionEntry = {
    id: string;
    conversationId: string;
    title: string;
    status: "running" | "completed" | "failed" | "cancelled";
    taskCount: number;
    lastActivity: string;
    tasks: A2ATaskSummary[];
  };

  const missions = useMemo<MissionEntry[]>(() => {
    const convMap = new Map(convs.map((c) => [c.id, c]));
    const grouped = new Map<string, A2ATaskSummary[]>();
    for (const task of tasks) {
      const key = task.id;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(task);
    }
    const result: MissionEntry[] = [];
    for (const [convId, missionTasks] of grouped) {
      const conv = convMap.get(convId);
      const statuses = missionTasks.map(missionStatus);
      const worst = statuses.includes("failed") ? "failed" : statuses.includes("running") ? "running" : statuses.includes("cancelled") ? "cancelled" : "completed";
      result.push({
        id: convId,
        conversationId: convId,
        title: conv?.title ?? `Mission ${convId.slice(0, 12)}...`,
        status: worst,
        taskCount: missionTasks.length,
        lastActivity: missionTasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]?.createdAt ?? "",
        tasks: missionTasks,
      });
    }
    for (const run of runs) {
      if (!result.find((m) => m.id === run.runId)) {
        result.push({
          id: run.runId,
          conversationId: run.runId,
          title: `Run ${run.runId.slice(0, 12)}...`,
          status: run.status === "running" ? "running" : run.status === "completed" ? "completed" : run.status === "failed" ? "failed" : "completed",
          taskCount: run.steps?.length ?? 0,
          lastActivity: run.createdAt ?? "",
          tasks: [],
        });
      }
    }
    result.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());
    return result;
  }, [tasks, convs, runs]);

  const filtered = useMemo(() => {
    return missions.filter((m) => {
      if (search && !m.title.toLowerCase().includes(search.toLowerCase())) return false;
      if (statusFilter !== "all" && m.status !== statusFilter) return false;
      return true;
    });
  }, [missions, search, statusFilter]);

  const selectedMission = missions.find((m) => m.id === selectedMissionId) ?? null;

  const handlePause = async (taskId: string) => {
    try {
      await pauseMission.mutateAsync(taskId);
      toast.success("Mission paused");
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "Failed to pause mission");
    }
  };

  const handleResume = async (taskId: string) => {
    try {
      await resumeMission.mutateAsync(taskId);
      toast.success("Mission resumed");
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "Failed to resume mission");
    }
  };

  const handleCancel = async (taskId: string) => {
    try {
      await cancelMission.mutateAsync(taskId);
      toast.success("Mission canceled");
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "Failed to cancel mission");
    }
  };

  const handleRetry = async (taskId: string) => {
    try {
      await retryMission.mutateAsync(taskId);
      toast.success("Mission retry initiated");
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "Failed to retry mission");
    }
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex flex-1 flex-col min-w-0">
        <div className="flex flex-col gap-4 overflow-y-auto p-6 max-w-6xl">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold text-oa-text">Missions</h1>
              <p className="text-sm text-oa-text-muted">
                {missions.length} mission{missions.length !== 1 ? "s" : ""}
                &middot; {missions.filter((m) => m.status === "running").length} active
                &middot; {missions.filter((m) => m.status === "failed").length} failed
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-oa-text-muted" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search missions..."
                  className="h-9 w-48 rounded-lg border border-oa-border bg-oa-bg pl-8 pr-2 text-xs text-oa-text outline-none focus:border-oa-blue"
                />
              </div>
              <div className="flex gap-1">
                {["all", "running", "completed", "failed", "cancelled"].map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setStatusFilter(opt)}
                    className={`rounded-md px-2 py-1 text-[10px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue ${
                      statusFilter === opt ? "bg-oa-blue/20 text-oa-blue" : "text-oa-text-muted hover:bg-oa-surface hover:text-oa-text"
                    }`}
                  >
                    {opt.charAt(0).toUpperCase() + opt.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="flex flex-1 items-center justify-center py-12">
              <div className="flex flex-col items-center gap-3 text-center max-w-sm">
                <Bot className="h-10 w-10 text-oa-text-muted" />
                <p className="text-sm font-medium text-oa-text-muted">
                  {search || statusFilter !== "all" ? "No missions match your filters" : "No missions yet"}
                </p>
                <p className="text-xs text-oa-text-disabled">
                  Missions appear here when you start agent conversations.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-1">
              {filtered.map((mission) => {
                const cfg = STATUS_CONFIG[mission.status];
                const StatusIcon = cfg.icon;
                return (
                  <div key={mission.id} className={`rounded-xl border transition ${
                    selectedMissionId === mission.id ? "border-oa-blue/50 bg-oa-blue/5" : "border-oa-border bg-oa-surface hover:border-oa-border-strong"
                  }`}>
                    <button
                      type="button"
                      onClick={() => setSelectedMissionId(selectedMissionId === mission.id ? null : mission.id)}
                      className="flex w-full items-center gap-3 p-4 text-left"
                    >
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${cfg.bg}`}>
                        <StatusIcon className={`h-4 w-4 ${cfg.color}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-medium text-oa-text truncate">{mission.title}</h3>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium ${cfg.color} ${cfg.bg}`}>
                            {mission.status}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-[10px] text-oa-text-muted">
                          <span className="flex items-center gap-1">
                            <Workflow className="h-3 w-3" />
                            {mission.taskCount} task{mission.taskCount !== 1 ? "s" : ""}
                          </span>
                          {mission.lastActivity && (
                            <span>{new Date(mission.lastActivity).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (mission.status === "running") {
                              handlePause(mission.id);
                            } else {
                              handleResume(mission.id);
                            }
                          }}
                          disabled={pauseMission.isPending || resumeMission.isPending}
                          className="flex h-8 w-8 items-center justify-center rounded text-oa-text-muted hover:bg-oa-surface-2 disabled:opacity-50"
                          title={mission.status === "running" ? "Pause" : "Resume"}
                        >
                          {mission.status === "running" ? <PauseCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
                        </button>
                        {mission.status === "failed" && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRetry(mission.id);
                            }}
                            disabled={retryMission.isPending}
                            className="flex h-8 w-8 items-center justify-center rounded text-oa-text-muted hover:bg-oa-surface-2 disabled:opacity-50"
                            title="Retry"
                          >
                            <RefreshCw className="h-4 w-4" />
                          </button>
                        )}
                        {mission.status === "running" && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCancel(mission.id);
                            }}
                            disabled={cancelMission.isPending}
                            className="flex h-8 w-8 items-center justify-center rounded text-oa-red/60 hover:bg-oa-red/10 hover:text-oa-red disabled:opacity-50"
                            title="Cancel"
                          >
                            <Ban className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </button>
                    {selectedMissionId === mission.id && (
                      <div className="border-t border-oa-border px-4 pb-4">
                        <MissionTimeline
                          conversationId={mission.conversationId}
                          onSelectApproval={() => {}}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
