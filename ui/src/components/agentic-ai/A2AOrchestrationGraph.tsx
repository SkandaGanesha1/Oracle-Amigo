import { CheckCircle2, Circle, Clock, XCircle } from "lucide-react";
import type { A2ATaskSummary, WorkflowEvent } from "../../api/types";

interface A2AOrchestrationGraphProps {
  task?: A2ATaskSummary | null;
  events?: WorkflowEvent[];
  compact?: boolean;
}

const defaultPhases = ["created", "intent", "search", "approval", "transfer", "complete"];

export function A2AOrchestrationGraph({ task, events = [], compact = false }: A2AOrchestrationGraphProps) {
  const normalized = normalizeEvents(events);
  const activeState = String(task?.state ?? task?.status ?? "").toLowerCase();
  const failed = /fail|error|reject|cancel/.test(activeState);
  const complete = /complete|stored|done/.test(activeState);

  const phases = normalized.length > 0
    ? normalized.map((event) => event.label)
    : defaultPhases;

  return (
    <section className="rounded-xl border border-oa-border bg-oa-surface/80 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-oa-blue/10">
          {failed ? <XCircle className="h-4 w-4 text-oa-red" /> : complete ? <CheckCircle2 className="h-4 w-4 text-oa-green" /> : <Clock className="h-4 w-4 text-oa-blue" />}
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-oa-text">A2A Orchestration</h3>
          <p className="truncate text-[10px] text-oa-text-muted">
            {task?.id ?? "No task selected"} {task?.status ? `- ${task.status}` : ""}
          </p>
        </div>
      </div>

      <div className={compact ? "space-y-2" : "grid gap-2 md:grid-cols-2 xl:grid-cols-3"}>
        {phases.map((phase, index) => {
          const event = normalized[index];
          const isLast = index === phases.length - 1;
          const done = complete || Boolean(event);
          const isActive = !complete && !failed && isLast;
          const Icon = failed && isLast ? XCircle : done ? CheckCircle2 : isActive ? Clock : Circle;
          const color = failed && isLast ? "text-oa-red" : done ? "text-oa-green" : isActive ? "text-oa-blue" : "text-oa-text-disabled";

          return (
            <div key={`${phase}-${index}`} className="rounded-lg border border-oa-border/60 bg-oa-bg-elevated p-3">
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${color}`} />
                <span className="truncate text-xs font-medium text-oa-text">{phase}</span>
              </div>
              {event?.detail && (
                <p className="mt-1 line-clamp-2 text-[10px] text-oa-text-muted">{event.detail}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function normalizeEvents(events: WorkflowEvent[]): Array<{ label: string; detail?: string }> {
  return events.map((event) => {
    const type = String(event.eventType ?? event.event_type ?? event.state_to ?? event.state_from ?? "workflow event");
    const payload = event.payloadJson ?? event.payload_json;
    return {
      label: type.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
      detail: typeof payload === "string" ? payload : payload ? JSON.stringify(payload) : undefined,
    };
  });
}
