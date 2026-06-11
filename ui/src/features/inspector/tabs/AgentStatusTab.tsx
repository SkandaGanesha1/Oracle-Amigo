import { useAgentDiagnostics } from "../../../hooks/queries";
import { Loader2 } from "lucide-react";

export function AgentStatusTab() {
  const { data: diagnostics, isLoading: diagLoading } = useAgentDiagnostics();

  return (
    <div className="flex flex-col gap-3 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">Agent Status</h3>
      {diagLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-oa-text-muted" />
        </div>
      ) : diagnostics ? (
        <div className="space-y-2">
          <StatusRow label="Status" value={diagnostics.health.status === "ok" ? "Running" : diagnostics.health.status} />
          <StatusRow
            label="Mode"
            value={diagnostics.health.dryRun ? "Dry run - Actions are previewed only" : "Live mode - Approved actions can run"}
            color={diagnostics.health.dryRun ? "text-oa-amber" : "text-oa-green"}
          />
          <StatusRow
            label="Cloud"
            value={diagnostics.cloud.cloud.status === "enrolled" ? "Connected" : diagnostics.cloud.cloud.status === "authenticated" ? "Authenticated" : "Disconnected"}
            color={diagnostics.cloud.cloud.status === "enrolled" ? "text-oa-green" : "text-oa-amber"}
          />
          <StatusRow
            label="Relay"
            value={diagnostics.relayInbox.running ? "Running" : "Stopped"}
            color={diagnostics.relayInbox.running ? "text-oa-green" : "text-oa-red"}
          />
          <div className="border-t border-oa-border pt-2">
            <p className="text-[10px] text-oa-text-muted">
              Relay inbox items: {diagnostics.relayInbox.lastItemCount}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-xs text-oa-text-disabled">Unable to load agent diagnostics</p>
      )}
    </div>
  );
}

function StatusRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-oa-surface px-2.5 py-1.5">
      <span className="text-xs text-oa-text-muted">{label}</span>
      <span className={`text-xs font-medium ${color ?? "text-oa-text"}`}>{value}</span>
    </div>
  );
}
