import { useAgentDiagnostics, useCloudStatus } from "../../../hooks/queries";
import { Loader2, Shield, ShieldCheck, ShieldAlert, Wifi, Heart, Server, Lock, Radio } from "lucide-react";

export function SecurityTab() {
  const { data: diagnostics, isLoading: diagLoading } = useAgentDiagnostics();
  const { data: cloudStatus, isLoading: cloudLoading } = useCloudStatus();

  if (diagLoading || cloudLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-oa-text-muted" />
      </div>
    );
  }

  const health = diagnostics?.health;
  const cloud = diagnostics?.cloud?.cloud ?? cloudStatus?.cloud;
  const relayInbox = diagnostics?.relayInbox;

  return (
    <div className="flex flex-col gap-3 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">Security Status</h3>

      <div className="space-y-2">
        <SecurityRow
          icon={health?.status === "ok" ? ShieldCheck : ShieldAlert}
          label="Agent Health"
          value={health?.status ?? "unknown"}
          color={health?.status === "ok" ? "text-oa-green" : "text-oa-red"}
        />

        {health && (
          <SecurityRow
            icon={Lock}
            label="Dry Run"
            value={health.dryRun ? "Enabled" : "Disabled"}
            color={health.dryRun ? "text-oa-amber" : "text-oa-green"}
          />
        )}

        <SecurityRow
          icon={relayInbox?.running ? Wifi : Radio}
          label="Relay"
          value={relayInbox?.running ? "Running" : "Stopped"}
          color={relayInbox?.running ? "text-oa-green" : "text-oa-red"}
        />

        {cloud && (
          <>
            <SecurityRow
              icon={cloud.status === "enrolled" ? ShieldCheck : Shield}
              label="Cloud Status"
              value={cloud.status}
              color={cloud.status === "enrolled" ? "text-oa-green" : cloud.status === "authenticated" ? "text-oa-blue" : "text-oa-amber"}
            />

            {cloud.controlPlaneUrl && (
              <SecurityRow
                icon={Server}
                label="Control Plane"
                value={cloud.controlPlaneUrl}
                mono
              />
            )}
          </>
        )}

        {relayInbox && (
          <div className="mt-2 space-y-1 border-t border-oa-border pt-2">
            <DetailRow label="Inbox items" value={String(relayInbox.lastItemCount)} />
            {relayInbox.lastError && (
              <DetailRow label="Last error" value={relayInbox.lastError} color="text-oa-red" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SecurityRow({ icon: Icon, label, value, color, mono }: { icon: typeof Shield; label: string; value: string; color?: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 rounded-md bg-oa-surface px-2.5 py-1.5">
      <Icon className={`h-3.5 w-3.5 shrink-0 ${color ?? "text-oa-text-muted"}`} />
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <span className="text-[11px] text-oa-text-muted">{label}</span>
        <span className={`truncate text-[11px] font-medium ${color ?? "text-oa-text"} ${mono ? "font-mono" : ""}`}>
          {value}
        </span>
      </div>
    </div>
  );
}

function DetailRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between px-1">
      <span className="text-[10px] text-oa-text-muted">{label}</span>
      <span className={`truncate text-[10px] ${color ?? "text-oa-text-muted"}`}>{value}</span>
    </div>
  );
}
