import { useAuditEvents } from "../../../hooks/queries";
import { Loader2, Activity, AlertCircle, CheckCircle2, Clock, User, FileText, Shield } from "lucide-react";

const eventIcons: Record<string, typeof Activity> = {
  approval_created: FileText,
  approval_approved: CheckCircle2,
  approval_rejected: AlertCircle,
  approval_feedback: FileText,
  relay_message_sent: Activity,
  relay_message_delivered: CheckCircle2,
  file_transferred: Shield,
  agent_run_started: Activity,
  agent_run_completed: CheckCircle2,
  agent_run_failed: AlertCircle,
  contact_requested: User,
  contact_accepted: User
};

const eventColors: Record<string, string> = {
  approval_created: "text-oa-blue",
  approval_approved: "text-oa-green",
  approval_rejected: "text-oa-red",
  approval_feedback: "text-oa-amber",
  relay_message_sent: "text-oa-blue",
  relay_message_delivered: "text-oa-green",
  file_transferred: "text-oa-purple",
  agent_run_started: "text-oa-blue",
  agent_run_completed: "text-oa-green",
  agent_run_failed: "text-oa-red",
  contact_requested: "text-oa-amber",
  contact_accepted: "text-oa-green"
};

export function ActivityTab() {
  const { data, isLoading } = useAuditEvents();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-oa-text-muted" />
      </div>
    );
  }

  const events = data?.events ?? [];

  if (events.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-oa-surface ring-1 ring-oa-border">
          <Activity className="h-5 w-5 text-oa-text-muted" />
        </div>
        <h3 className="text-sm font-medium text-oa-text-muted">Activity Feed</h3>
        <p className="mt-1 text-xs text-oa-text-disabled">No recent activity events</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">Activity Feed</h3>
        {data?.chainValid?.valid != null && (
          <span className={`text-[10px] ${data.chainValid.valid ? "text-oa-green" : "text-oa-red"}`}>
            Chain {data.chainValid.valid ? "valid" : "invalid"}
          </span>
        )}
      </div>

      <div className="space-y-1">
        {events.map((event) => {
          const Icon = eventIcons[event.eventType] ?? Activity;
          const color = eventColors[event.eventType] ?? "text-oa-text-muted";
          const time = new Date(event.createdAt);
          const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

          return (
            <div key={event.id} className="flex items-start gap-2.5 rounded-md px-2.5 py-2 transition-colors hover:bg-oa-surface/50">
              <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${color}`} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] font-medium text-oa-text">
                    {event.eventType.replace(/_/g, " ")}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-[10px] text-oa-text-disabled">
                    <Clock className="h-3 w-3" />
                    {timeStr}
                  </span>
                </div>
                <span className="truncate text-[10px] text-oa-text-muted">
                  Actor: {event.actorAgentId.slice(0, 16)}...
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
