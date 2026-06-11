import { Activity, Database, ShieldCheck, Workflow } from "lucide-react";
import type { ChatSplitViewContext } from "../../types";

interface ChatSplitViewProps {
  context: ChatSplitViewContext | null;
}

export function ChatSplitView({ context }: ChatSplitViewProps) {
  if (!context) {
    return (
      <div className="space-y-3 p-4 text-xs text-oa-text-muted">
        Select a message to inspect trust, data movement, memory, and audit context.
      </div>
    );
  }
  return (
    <div className="space-y-4 p-4">
      <section className="rounded-lg border border-oa-border bg-oa-surface/70 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-oa-text">
          <ShieldCheck className="h-4 w-4 text-oa-green" />
          Trust and Risk
        </div>
        <p className="text-xs text-oa-text-muted">Risk: {context.riskScore}</p>
        <p className="text-xs text-oa-text-muted">{context.trustGraph.length} trust relationship{context.trustGraph.length === 1 ? "" : "s"} available</p>
      </section>
      <section className="rounded-lg border border-oa-border bg-oa-surface/70 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-oa-text">
          <Database className="h-4 w-4 text-oa-blue" />
          Data Boundary
        </div>
        <p className="text-xs text-oa-text-muted">{context.dataMovement.leavesDevice ? "Data may leave this device" : "Data stays local"}</p>
        <p className="text-xs text-oa-text-muted">{context.dataMovement.revocable ? "Revocable access" : "No revocation metadata"}</p>
      </section>
      <section className="rounded-lg border border-oa-border bg-oa-surface/70 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-oa-text">
          <Activity className="h-4 w-4 text-oa-purple" />
          Audit Preview
        </div>
        <ul className="space-y-1 text-xs text-oa-text-muted">
          {context.auditPreview.slice(0, 4).map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>
      <section className="rounded-lg border border-oa-border bg-oa-surface/70 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-oa-text">
          <Workflow className="h-4 w-4 text-oa-amber" />
          Available Actions
        </div>
        <div className="flex flex-wrap gap-1.5">
          {context.actions.map((action) => (
            <span key={action} className="rounded-full border border-oa-border bg-oa-bg px-2 py-0.5 text-[10px] text-oa-text-muted">
              {action}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
