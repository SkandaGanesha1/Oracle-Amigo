import { useState, useMemo } from "react";
import { BadgeCheck, BadgeAlert, Shield, ShieldOff, Bot, Tags, Sliders, Power, PowerOff, Clock, AlertTriangle, CheckCircle2, XCircle, ExternalLink, MessageCircle, User, Globe, HardDrive, type LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMissions, useAuditEvents } from "../../hooks/queries";
import type { Contact, RegistryTrustLevel } from "../../api/types";

interface AgentProfileProps {
  agent: {
    id: string;
    displayName: string;
    targetUserId: string;
    trustLevel: "verified" | "unverified" | "external" | "local";
    presence: "online" | "offline" | "stale" | "unknown";
    capabilities?: string[];
    deviceName?: string;
    status?: string;
  };
  onClose?: () => void;
}

const TRUST_CONFIG: Record<string, { icon: LucideIcon; color: string; bg: string; label: string }> = {
  verified: { icon: BadgeCheck, color: "text-oa-green", bg: "bg-oa-green/10", label: "Verified" },
  unverified: { icon: BadgeAlert, color: "text-oa-amber", bg: "bg-oa-amber/10", label: "Unverified" },
  external: { icon: ShieldOff, color: "text-oa-red", bg: "bg-oa-red/10", label: "External" },
  local: { icon: Shield, color: "text-oa-blue", bg: "bg-oa-blue/10", label: "Local" },
};

const PRESENCE_CONFIG: Record<string, { icon: LucideIcon; color: string; label: string }> = {
  online: { icon: Globe, color: "text-oa-green", label: "Online" },
  stale: { icon: Clock, color: "text-oa-amber", label: "Stale" },
  offline: { icon: PowerOff, color: "text-oa-text-muted", label: "Offline" },
  unknown: { icon: Clock, color: "text-oa-text-disabled", label: "Unknown" },
};

const AUTONOMY_LEVELS = [
  { value: 0, label: "Manual", desc: "Ask for every action" },
  { value: 1, label: "Ask first", desc: "Confirm before non-trivial actions" },
  { value: 2, label: "Trusted only", desc: "Auto-approve routine requests" },
  { value: 3, label: "Full autonomy", desc: "Allow all within permission scope" },
];

export function AgentProfile({ agent, onClose }: AgentProfileProps) {
  const navigate = useNavigate();
  const [autonomy, setAutonomy] = useState(1);
  const [paused, setPaused] = useState(false);

  const { data: missionsData } = useMissions();
  const { data: auditData } = useAuditEvents();

  const tc = TRUST_CONFIG[agent.trustLevel] ?? TRUST_CONFIG.unverified;
  const pc = PRESENCE_CONFIG[agent.presence] ?? PRESENCE_CONFIG.unknown;
  const TrustIcon = tc.icon;
  const PresenceIcon = pc.icon;

  // Get real missions data for this agent (filter by agent-related missions)
  const recentMissions = useMemo(() => {
    const missions = missionsData ?? [];
    // For now, show all missions since we don't have agent-specific filtering
    return missions.slice(0, 3).map((m) => ({
      name: m.title,
      status: m.status === "completed" ? "completed" : m.status === "failed" ? "failed" : "running",
      date: new Date(m.createdAt).toLocaleDateString(),
      risk: "low" // Default risk level
    }));
  }, [missionsData]);

  // Get real audit events for this agent
  const riskHistory = useMemo(() => {
    const events = auditData?.events ?? [];
    // Filter events related to this agent
    const agentEvents = events.filter((e) => 
      e.actorAgentId === agent.targetUserId || 
      e.detailsJson?.agent_id === agent.targetUserId
    );
    return agentEvents.slice(0, 3).map((e) => ({
      event: e.eventType.replace(/_/g, " "),
      severity: e.eventType.includes("failed") || e.eventType.includes("error") || e.eventType.includes("revoked") ? "high" : 
               e.eventType.includes("warning") || e.eventType.includes("expired") ? "medium" : "low",
      date: new Date(e.createdAt).toLocaleDateString()
    }));
  }, [auditData, agent.targetUserId]);

  return (
    <div className="flex flex-col gap-5 p-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-oa-text">Agent Profile</h2>
        {onClose && (
          <button type="button" onClick={onClose} className="text-oa-text-muted hover:text-oa-text">
            <ExternalLink className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-oa-blue/20 to-oa-purple/20 text-lg font-bold text-oa-blue">
          {agent.displayName.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-oa-text">{agent.displayName}</h3>
          <p className="text-xs text-oa-text-muted font-mono truncate">{agent.targetUserId}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${tc.color} ${tc.bg}`}>
              <TrustIcon className="h-3 w-3" />
              {tc.label}
            </span>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${pc.color} bg-current/10`}>
              <PresenceIcon className="h-3 w-3" />
              {pc.label}
            </span>
            {paused && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-oa-amber bg-oa-amber/10">
                <PowerOff className="h-3 w-3" />
                Paused
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setPaused(!paused)}
            className={`flex h-9 w-9 items-center justify-center rounded-lg border transition ${
              paused ? "border-oa-red/30 bg-oa-red/5 text-oa-red" : "border-oa-border bg-oa-surface-2 text-oa-text-muted"
            }`}
            title={paused ? "Resume agent" : "Kill switch - pause agent"}
          >
            {paused ? <Power className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <section className="rounded-xl border border-oa-border bg-oa-surface/80 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Tags className="h-4 w-4 text-oa-purple" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">Capabilities</h3>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(agent.capabilities ?? ["a2a.v1", "file.request", "file.transfer"]).map((cap) => (
            <span key={cap} className="rounded-md border border-oa-border bg-oa-bg-elevated px-2 py-1 text-[10px] font-medium text-oa-text">
              {cap}
            </span>
          ))}
          {!agent.capabilities?.length && (
            <p className="text-xs text-oa-text-muted">No capability info available</p>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-oa-border bg-oa-surface/80 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Sliders className="h-4 w-4 text-oa-blue" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">Autonomy Level</h3>
          <span className="ml-auto text-[10px] font-medium text-oa-text">{AUTONOMY_LEVELS[autonomy].label}</span>
        </div>
        <input
          type="range"
          min={0}
          max={3}
          value={autonomy}
          onChange={(e) => setAutonomy(Number(e.target.value))}
          className="w-full accent-oa-blue"
          aria-label="Autonomy level"
        />
        <div className="mt-1 flex justify-between text-[9px] text-oa-text-muted">
          {AUTONOMY_LEVELS.map((l) => (
            <span key={l.value} className={autonomy === l.value ? "font-medium text-oa-text" : ""}>{l.label}</span>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-oa-text-secondary">{AUTONOMY_LEVELS[autonomy].desc}</p>
      </section>

      <section className="rounded-xl border border-oa-border bg-oa-surface/80 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4 text-oa-amber" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">Recent Missions</h3>
          <span className="ml-auto text-[10px] text-oa-text-muted">{recentMissions.length} total</span>
        </div>
        <div className="space-y-2">
          {recentMissions.map((m, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-oa-border bg-oa-bg-elevated p-3">
              {m.status === "completed" ? <CheckCircle2 className="h-4 w-4 text-oa-green shrink-0" /> :
               m.status === "failed" ? <XCircle className="h-4 w-4 text-oa-red shrink-0" /> :
               <Clock className="h-4 w-4 text-oa-blue shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-oa-text">{m.name}</p>
                <p className="text-[10px] text-oa-text-muted">{m.date}</p>
              </div>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[8px] font-medium ${
                m.risk === "high" ? "text-oa-red bg-oa-red/10" : m.risk === "medium" ? "text-oa-amber bg-oa-amber/10" : "text-oa-green bg-oa-green/10"
              }`}>
                {m.risk}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-oa-border bg-oa-surface/80 p-4">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-oa-amber" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">Risk History</h3>
          <span className="ml-auto text-[10px] text-oa-text-muted">{riskHistory.length} events</span>
        </div>
        <div className="space-y-2">
          {riskHistory.map((r, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-oa-border bg-oa-bg-elevated p-2.5">
              <AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${
                r.severity === "high" ? "text-oa-red" : r.severity === "medium" ? "text-oa-amber" : "text-oa-green"
              }`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[10px] text-oa-text">{r.event}</p>
                <p className="text-[9px] text-oa-text-muted">{r.date}</p>
              </div>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[8px] font-medium ${
                r.severity === "high" ? "text-oa-red bg-oa-red/10" : r.severity === "medium" ? "text-oa-amber bg-oa-amber/10" : "text-oa-green bg-oa-green/10"
              }`}>
                {r.severity}
              </span>
            </div>
          ))}
        </div>
      </section>

      <button
        type="button"
        onClick={() => navigate(`/chats/${agent.id}`)}
        className="flex items-center justify-center gap-2 rounded-lg bg-oa-blue px-4 py-2.5 text-sm font-medium text-white transition hover:bg-oa-blue/80"
      >
        <MessageCircle className="h-4 w-4" />
        Open conversation with {agent.displayName}
      </button>
    </div>
  );
}
