import { useState } from "react";
import { useAgentDiagnostics, useCloudStatus } from "../../../hooks/queries";
import { Loader2, Settings, Server, Radio, Globe, Wifi, Cpu, Hash, Zap, Eye, EyeOff } from "lucide-react";

export function SettingsTab() {
  const [showDev, setShowDev] = useState(false);
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
  const cloud = diagnostics?.cloud ?? cloudStatus;
  const relayInbox = diagnostics?.relayInbox;

  return (
    <div className="flex flex-col gap-3 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">Agent Configuration</h3>

      <div className="space-y-2">
        <SectionLabel>Connection</SectionLabel>

        {cloud?.relayMode && (
          <SettingRow icon={Radio} label="Relay Mode" value={cloud.relayMode} />
        )}

        <SectionLabel>Agent</SectionLabel>

        <SettingRow icon={Cpu} label="Mode" value={health?.dryRun ? "Dry Run (preview only)" : "Live (actions can run)"} />

        {cloud?.heartbeat && (
          <SettingRow
            icon={Wifi}
            label="Heartbeat"
            value={cloud.heartbeat.running ? "Running" : "Stopped"}
          />
        )}

        {cloud?.inbox && (
          <SettingRow icon={Zap} label="Inbox" value={cloud.inbox.running ? "Running" : "Stopped"} />
        )}

        {relayInbox && (
          <>
            <SectionLabel>Relay Inbox</SectionLabel>
            <SettingRow icon={Hash} label="Item Count" value={String(relayInbox.lastItemCount)} />
            <SettingRow
              icon={Wifi}
              label="Running"
              value={relayInbox.running ? "Yes" : "No"}
            />
            {relayInbox.lastError && (
              <div className="rounded-md bg-oa-surface px-2.5 py-1.5">
                <span className="text-[10px] text-oa-red">Error: {relayInbox.lastError}</span>
              </div>
            )}
          </>
        )}

        {cloud?.defaults && (
          <>
            <SectionLabel>Defaults</SectionLabel>
            {cloud.defaults.orgSlug && (
              <SettingRow icon={Hash} label="Default Org" value={cloud.defaults.orgSlug} />
            )}
          </>
        )}

        <div className="border-t border-oa-border pt-2 mt-2">
          <button
            type="button"
            onClick={() => setShowDev(!showDev)}
            className="flex items-center gap-1.5 text-[10px] text-oa-text-muted hover:text-oa-text transition-colors"
          >
            {showDev ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {showDev ? "Hide developer details" : "Show developer details"}
          </button>

          {showDev && (
            <div className="space-y-2 mt-2">
              {health?.localAgentUrl && (
                <SettingRow icon={Server} label="Local Agent URL" value={health.localAgentUrl} />
              )}
              {health?.controlPlaneUrl && (
                <SettingRow icon={Globe} label="Control Plane URL" value={health.controlPlaneUrl} />
              )}
              {cloud?.defaults?.localAgentUrl && (
                <SettingRow icon={Server} label="Default Local URL" value={cloud.defaults.localAgentUrl} />
              )}
              {cloud?.defaults?.controlPlaneUrl && (
                <SettingRow icon={Globe} label="Default CP URL" value={cloud.defaults.controlPlaneUrl} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="px-1 pt-1 text-[10px] font-medium uppercase tracking-wider text-oa-text-disabled">
      {children}
    </p>
  );
}

function SettingRow({ icon: Icon, label, value }: { icon: typeof Settings; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-md bg-oa-surface px-2.5 py-1.5">
      <Icon className="h-3.5 w-3.5 shrink-0 text-oa-text-muted" />
      <span className="min-w-0 flex-1 truncate text-[11px] text-oa-text-muted">{label}</span>
      <span className="max-w-[160px] truncate text-[11px] font-mono text-oa-text">{value}</span>
    </div>
  );
}
