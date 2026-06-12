import { Bot, Wifi, WifiOff, Clock, Shield, Globe, HardDrive, BadgeCheck, BadgeAlert, BadgeX, Tags, Lock } from "lucide-react";
import { OracleAvatar } from "../primitives/OracleAvatar";
import type { AgentInstance, PresenceState } from "../../api/types";
import { normalizePeerPresence } from "../../lib/normalizePeerPresence";

interface AgentCardProps {
  agent: AgentInstance;
  presence?: PresenceState;
  trustLevel?: "verified" | "unverified" | "external" | "local";
  capabilities?: string[];
  permissionScope?: string;
  onSelect?: () => void;
  compact?: boolean;
}

const presenceConfig: Record<string, { icon: typeof Wifi; color: string; label: string }> = {
  online: { icon: Wifi, color: "text-oa-green", label: "Online" },
  stale: { icon: Clock, color: "text-oa-amber", label: "Stale" },
  offline: { icon: WifiOff, color: "text-oa-text-muted", label: "Offline" },
  revoked: { icon: Shield, color: "text-oa-red", label: "Revoked" },
  unknown: { icon: Clock, color: "text-oa-text-disabled", label: "Presence unavailable" },
};

const trustConfig: Record<string, { icon: typeof BadgeCheck | typeof BadgeAlert | typeof BadgeX | typeof Shield; color: string; label: string }> = {
  verified: { icon: BadgeCheck, color: "text-oa-green", label: "Verified" },
  unverified: { icon: BadgeAlert, color: "text-oa-amber", label: "Unverified" },
  external: { icon: BadgeX, color: "text-oa-red", label: "External" },
  local: { icon: Shield, color: "text-oa-blue", label: "Local" },
};

export function AgentCard({ agent, presence, trustLevel, capabilities, permissionScope, onSelect, compact = false }: AgentCardProps) {
  const normalizedPresence = normalizePeerPresence({
    presence: presence ?? "unknown",
    agentInstanceId: agent.agent_instance_id,
    lastHeartbeatAt: agent.last_seen_at,
    capabilities
  });
  const pc = {
    ...(presenceConfig[normalizedPresence.status === "unavailable" ? "unknown" : normalizedPresence.status] ?? presenceConfig.unknown),
    label: normalizedPresence.label
  };
  const PresenceIcon = pc.icon;
  const tc = trustLevel ? (trustConfig[trustLevel] ?? trustConfig.unverified) : null;

  const content = (
    <div className={`rounded-xl border border-oa-border bg-oa-surface ${onSelect ? "cursor-pointer transition hover:border-oa-border-strong" : ""} ${compact ? "p-3" : "p-4"}`}>
      <div className="flex items-start gap-3">
        <OracleAvatar
          seed={agent.agent_id}
          initials={agent.display_name.slice(0, 2).toUpperCase()}
          size={compact ? "sm" : "md"}
          className={compact ? "h-8 w-8 shrink-0" : "h-10 w-10 shrink-0"}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className={`font-semibold text-oa-text truncate ${compact ? "text-sm" : "text-base"}`}>
              {agent.display_name}
            </h3>
            <div className="flex items-center gap-1 shrink-0">
              {tc && (
                <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${tc.color} bg-current/10`}>
                  <tc.icon className="h-3 w-3" />
                  {tc.label}
                </span>
              )}
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${pc.color} bg-current/10`}>
                <PresenceIcon className="h-3 w-3" />
                {pc.label}
              </span>
            </div>
          </div>
          {!compact && (
            <p className="mt-0.5 text-xs text-oa-text-muted">Agent ID: {agent.agent_id.slice(0, 12)}...</p>
          )}
        </div>
      </div>

      {!compact && (
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-oa-text-muted">
            <HardDrive className="h-3 w-3 shrink-0" />
            <span>{agent.device_name ?? "Unknown device"}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-oa-text-muted">
            <Globe className="h-3 w-3 shrink-0" />
            <span className="truncate">{agent.relay_inbox_url}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-oa-text-muted">
            <Shield className="h-3 w-3 shrink-0" />
            <span className="font-mono text-[10px]">{agent.agent_card_hash.slice(0, 20)}...</span>
          </div>
          {agent.last_seen_at && (
            <div className="flex items-center gap-2 text-xs text-oa-text-muted">
              <Clock className="h-3 w-3 shrink-0" />
              <span>Last seen: {new Date(agent.last_seen_at).toLocaleString()}</span>
            </div>
          )}
          {capabilities && capabilities.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <Tags className="h-3 w-3 shrink-0 text-oa-text-muted" />
              {capabilities.map((cap) => (
                <span key={cap} className="rounded bg-oa-surface-2 px-1.5 py-0.5 text-[9px] text-oa-text-muted">
                  {cap}
                </span>
              ))}
            </div>
          )}
          {permissionScope && (
            <div className="flex items-center gap-2 text-xs text-oa-text-muted">
              <Lock className="h-3 w-3 shrink-0" />
              <span>{permissionScope}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (onSelect) {
    return <button type="button" onClick={onSelect} className="w-full text-left">{content}</button>;
  }
  return content;
}
