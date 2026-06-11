import { IntentFirstInbox } from "../features/inbox/IntentFirstInbox";
import { A2AOrchestrationGraph } from "../components/agentic-ai/A2AOrchestrationGraph";
import { ArtifactRenderer } from "../components/agentic-ai/ArtifactRenderer";
import { MemoryInspector } from "../components/agentic-ai/MemoryInspector";
import { useA2ATaskEvents, useA2ATasks, useAgentRuns } from "../hooks/queries";

export function InboxPage() {
  const { data: runsData } = useAgentRuns();
  const { data: tasksData } = useA2ATasks();
  const latestRun = runsData?.runs?.[0] ?? null;
  const latestTask = tasksData?.tasks?.[0] ?? null;
  const { data: taskEventsData } = useA2ATaskEvents(latestTask?.id ?? null, Boolean(latestTask?.id));

  return (
    <div className="flex flex-1 overflow-y-auto bg-oa-bg">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.25em] text-oa-text-muted">Intent Inbox</p>
            <h1 className="text-2xl font-semibold text-oa-text">Triage approvals, missions, and sensitive transfers in one place.</h1>
            <p className="mt-1 max-w-2xl text-sm text-oa-text-muted">This view now uses the new triage, privacy, and command surfaces introduced for the Phase 5 redesign.</p>
          </div>
        </header>

        <IntentFirstInbox />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
          <MemoryInspector />
          <div className="space-y-4">
            <ArtifactRenderer run={latestRun} compact />
            <A2AOrchestrationGraph task={latestTask} events={taskEventsData?.events ?? []} compact />
          </div>
        </div>
      </div>
    </div>
  );
}
