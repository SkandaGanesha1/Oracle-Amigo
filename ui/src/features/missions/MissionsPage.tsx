import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useMissions, usePauseMission, useResumeMission, useCancelMission, useRetryMission } from "../../hooks/queries";
import { Clock, CheckCircle2, XCircle, PauseCircle, PlayCircle, Ban, RefreshCw, Bot, Workflow, Search, type LucideIcon } from "lucide-react";
import { MissionTimeline } from "./MissionTimeline";
import type { Mission, MissionStatus } from "../../types";
import { toast } from "../../components/primitives/OracleToast";

const STATUS_CONFIG: Record<string, { icon: LucideIcon; color: string; bg: string }> = {
  running: { icon: Clock, color: "text-oa-blue", bg: "bg-oa-blue/10" },
  completed: { icon: CheckCircle2, color: "text-oa-green", bg: "bg-oa-green/10" },
  failed: { icon: XCircle, color: "text-oa-red", bg: "bg-oa-red/10" },
  cancelled: { icon: Ban, color: "text-oa-text-muted", bg: "bg-oa-surface-2" },
};

function toUiStatus(status: MissionStatus): "running" | "completed" | "failed" | "cancelled" {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return "running";
}

function controlTaskId(mission: Mission): string | null {
  return mission.a2aTaskIds?.[0] ?? (mission.source === "a2a" ? mission.id : null);
}

export function MissionsPage() {
  const { data: missionData } = useMissions();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);

  const pauseMission = usePauseMission();
  const resumeMission = useResumeMission();
  const cancelMission = useCancelMission();
  const retryMission = useRetryMission();

  const missions = missionData ?? [];

  const filtered = useMemo(() => {
    return missions.filter((m) => {
      const haystack = `${m.title} ${m.description} ${m.requesterName} ${m.recipientName}`.toLowerCase();
      if (search && !haystack.includes(search.toLowerCase())) return false;
      if (statusFilter !== "all" && toUiStatus(m.status) !== statusFilter) return false;
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
                &middot; {missions.filter((m) => toUiStatus(m.status) === "running").length} active
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
                const uiStatus = toUiStatus(mission.status);
                const cfg = STATUS_CONFIG[uiStatus];
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
                            {mission.steps.length} step{mission.steps.length !== 1 ? "s" : ""}
                          </span>
                          {mission.updatedAt && (
                            <span>{new Date(mission.updatedAt).toLocaleDateString()}</span>
                          )}
                          {mission.source && <span>{mission.source.replaceAll("_", " ")}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {controlTaskId(mission) && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const taskId = controlTaskId(mission);
                              if (!taskId) return;
                              if (toUiStatus(mission.status) === "running") {
                                handlePause(taskId);
                              } else {
                                handleResume(taskId);
                              }
                            }}
                            disabled={pauseMission.isPending || resumeMission.isPending}
                            className="flex h-8 w-8 items-center justify-center rounded text-oa-text-muted hover:bg-oa-surface-2 disabled:opacity-50"
                            title={toUiStatus(mission.status) === "running" ? "Pause" : "Resume"}
                          >
                            {toUiStatus(mission.status) === "running" ? <PauseCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
                          </button>
                        )}
                        {mission.status === "failed" && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const taskId = controlTaskId(mission);
                              if (taskId) handleRetry(taskId);
                            }}
                            disabled={retryMission.isPending || !controlTaskId(mission)}
                            className="flex h-8 w-8 items-center justify-center rounded text-oa-text-muted hover:bg-oa-surface-2 disabled:opacity-50"
                            title="Retry"
                          >
                            <RefreshCw className="h-4 w-4" />
                          </button>
                        )}
                        {toUiStatus(mission.status) === "running" && controlTaskId(mission) && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const taskId = controlTaskId(mission);
                              if (taskId) handleCancel(taskId);
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
                        {(!mission.conversationId || mission.steps.length > 0) && (
                          <div className="space-y-2 py-3">
                            {mission.risk && (
                              <div className="flex flex-wrap gap-2 text-[10px] text-oa-text-muted">
                                <span className="rounded-full border border-oa-border px-2 py-1">Risk: {mission.risk.level}</span>
                                <span className="rounded-full border border-oa-border px-2 py-1">
                                  Data: {mission.dataMovement?.direction ?? "none"}
                                </span>
                                {mission.voiceCommandId && <span className="rounded-full border border-oa-border px-2 py-1">Voice linked</span>}
                              </div>
                            )}
                            <div className="flex flex-wrap gap-2 text-[10px]">
                              {mission.conversationId && (
                                <Link className="rounded-full border border-oa-border px-2 py-1 text-oa-blue hover:bg-oa-blue/10" to={`/chats/${mission.conversationId}`}>
                                  Open chat
                                </Link>
                              )}
                              {(mission.approvals?.length ?? 0) > 0 && (
                                <Link className="rounded-full border border-oa-border px-2 py-1 text-oa-amber hover:bg-oa-amber/10" to="/approvals">
                                  Open approval
                                </Link>
                              )}
                              <Link className="rounded-full border border-oa-border px-2 py-1 text-oa-text-muted hover:bg-oa-surface-2" to="/audit">
                                Open audit
                              </Link>
                            </div>
                            {mission.steps.slice(0, 6).map((step) => (
                              <div key={step.id} className="rounded-lg border border-oa-border bg-oa-bg px-3 py-2">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-xs font-medium text-oa-text">{step.label}</p>
                                  <span className="text-[10px] text-oa-text-muted">{step.status}</span>
                                </div>
                                <p className="mt-1 text-[10px] text-oa-text-muted">{step.description}</p>
                              </div>
                            ))}
                          </div>
                        )}
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
