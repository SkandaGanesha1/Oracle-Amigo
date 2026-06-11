import { useAuditEvents } from "../../../hooks/queries";
import type { AuditEvent } from "../../../api/types";
import { Loader2, Clock, Circle, CheckCircle2, AlertCircle, Activity, User, FileText, Shield } from "lucide-react";

const eventIcons: Record<string, typeof Circle> = {
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
  approval_created: "border-oa-blue bg-oa-blue/20",
  approval_approved: "border-oa-green bg-oa-green/20",
  approval_rejected: "border-oa-red bg-oa-red/20",
  approval_feedback: "border-oa-amber bg-oa-amber/20",
  relay_message_sent: "border-oa-blue bg-oa-blue/20",
  relay_message_delivered: "border-oa-green bg-oa-green/20",
  file_transferred: "border-oa-purple bg-oa-purple/20",
  agent_run_started: "border-oa-blue bg-oa-blue/20",
  agent_run_completed: "border-oa-green bg-oa-green/20",
  agent_run_failed: "border-oa-red bg-oa-red/20",
  contact_requested: "border-oa-amber bg-oa-amber/20",
  contact_accepted: "border-oa-green bg-oa-green/20"
};

function groupEventsByDate(events: AuditEvent[]): Map<string, AuditEvent[]> {
  const groups = new Map<string, typeof events>();
  for (const event of events) {
    const date = new Date(event.createdAt).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    const existing = groups.get(date) ?? [];
    existing.push(event);
    groups.set(date, existing);
  }
  return groups;
}

export function TimelineTab() {
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
          <Clock className="h-5 w-5 text-oa-text-muted" />
        </div>
        <h3 className="text-sm font-medium text-oa-text-muted">Event Timeline</h3>
        <p className="mt-1 text-xs text-oa-text-disabled">No timeline events yet</p>
      </div>
    );
  }

  const grouped = groupEventsByDate(events);

  return (
    <div className="flex flex-col gap-3 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">Event Timeline</h3>

      <div className="space-y-4">
        {Array.from(grouped.entries()).map(([date, dateEvents]) => (
          <div key={date}>
            <div className="mb-2 flex items-center gap-2">
              <Clock className="h-3 w-3 text-oa-text-muted" />
              <span className="text-[10px] font-medium text-oa-text-muted">{date}</span>
            </div>

            <div className="ml-2 space-y-0 border-l-2 border-oa-border pl-3">
              {dateEvents.map((event, idx) => {
                const Icon = eventIcons[event.eventType] ?? Circle;
                const color = eventColors[event.eventType] ?? "border-oa-text-muted bg-oa-text-disabled";
                const time = new Date(event.createdAt);
                const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

                return (
                  <div key={event.id} className="relative pb-3">
                    <div className={`absolute -left-[19px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 ${color}`}>
                      <Icon className="h-2 w-2 text-oa-text" />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-oa-text">
                        {event.eventType.replace(/_/g, " ")}
                      </span>
                      <span className="text-[10px] text-oa-text-disabled">{timeStr}</span>
                    </div>
                    <p className="mt-0.5 truncate text-[10px] text-oa-text-muted">
                      Actor: {event.actorAgentId.slice(0, 20)}...
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
