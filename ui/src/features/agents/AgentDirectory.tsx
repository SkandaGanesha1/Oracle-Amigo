import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Wifi, WifiOff, Clock, Shield, Bot, BadgeCheck, BadgeAlert, HardDrive, Tags, Globe, X, ExternalLink, Sparkles } from "lucide-react";
import { useContacts, useConversations, useDiscoverRegistryAgent, useRegistryAgents, useSkills, useStartConversation, useUpdateRegistryTrust } from "../../hooks/queries";
import type { Contact, RegistryAgent, RegistryTrustLevel } from "../../api/types";

interface EnrichedContact extends Contact {
  displayName: string;
  presence: "online" | "offline" | "stale" | "unknown";
  trustLevel: "verified" | "unverified" | "external";
  deviceName: string;
}

function enrichContact(c: Contact): EnrichedContact {
  const email = c.target_user_id ?? c.requester_user_id ?? "unknown";
  return {
    ...c,
    displayName: email.split("@")[0] ?? email,
    presence: "online" as const,
    trustLevel: c.status === "accepted" ? "verified" as const : "unverified" as const,
    deviceName: "Remote agent",
  };
}

const trustOptions = [
  { value: "all", label: "All" },
  { value: "verified", label: "Verified" },
  { value: "unverified", label: "Unverified" },
  { value: "external", label: "External" },
] as const;

const presenceOptions = [
  { value: "all", label: "All" },
  { value: "online", label: "Online" },
  { value: "offline", label: "Offline" },
  { value: "stale", label: "Stale" },
] as const;

const presenceConfig: Record<string, { icon: typeof Wifi; color: string; label: string }> = {
  online: { icon: Wifi, color: "text-oa-green", label: "Online" },
  stale: { icon: Clock, color: "text-oa-amber", label: "Stale" },
  offline: { icon: WifiOff, color: "text-oa-text-muted", label: "Offline" },
  unknown: { icon: Clock, color: "text-oa-text-disabled", label: "Unknown" },
};

const trustConfig: Record<string, { icon: typeof BadgeCheck; color: string; label: string }> = {
  verified: { icon: BadgeCheck, color: "text-oa-green", label: "Verified" },
  unverified: { icon: BadgeAlert, color: "text-oa-amber", label: "Unverified" },
  external: { icon: BadgeAlert, color: "text-oa-red", label: "External" },
};

function AgentCard({ agent, onOpen, onSelect }: { agent: EnrichedContact; onOpen?: (agent: EnrichedContact) => void; onSelect?: (agent: EnrichedContact) => void }) {
  const pc = presenceConfig[agent.presence] ?? presenceConfig.unknown;
  const PresenceIcon = pc.icon;
  const tc = trustConfig[agent.trustLevel] ?? trustConfig.unverified;
  const TrustIcon = tc.icon;

  return (
    <div className="group rounded-xl border border-oa-border bg-oa-surface transition hover:border-oa-border-strong">
      <button type="button" onClick={() => onSelect?.(agent)} className="flex w-full items-start gap-3 p-4 text-left">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-oa-blue/20 to-oa-purple/20 text-xs font-bold text-oa-blue">
          {agent.displayName.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-oa-text truncate">{agent.displayName}</h3>
              <p className="text-[10px] text-oa-text-muted truncate">{agent.target_user_id}</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${tc.color} bg-current/10`}>
                <TrustIcon className="h-3 w-3" />
                {tc.label}
              </span>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${pc.color} bg-current/10`}>
                <PresenceIcon className="h-3 w-3" />
                {pc.label}
              </span>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-3 text-[10px] text-oa-text-muted">
            <span className="flex items-center gap-1">
              <HardDrive className="h-3 w-3" />
              {agent.deviceName}
            </span>
            <span className="flex items-center gap-1">
              <Globe className="h-3 w-3" />
              {agent.status}
            </span>
          </div>
          </div>
          <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {agent.target_user_id && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpen?.(agent); }}
                className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg text-oa-text-muted hover:bg-oa-surface-2 hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
                aria-label="Open chat with agent"
                title="Open chat"
              >
                <ExternalLink className="h-4 w-4" />
              </button>
            )}
          </div>
      </button>
    </div>
  );
}

interface AgentDirectoryProps {
  onSelectAgent?: (agentId: string) => void;
}

export function AgentDirectory({ onSelectAgent }: AgentDirectoryProps = {}) {
  const { data: contactsData, isLoading } = useContacts();
  const { data: conversationsData } = useConversations();
  const { data: registryData } = useRegistryAgents();
  const { data: skillsData } = useSkills();
  const updateTrust = useUpdateRegistryTrust();
  const discoverAgent = useDiscoverRegistryAgent();
  const startConversation = useStartConversation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [trustFilter, setTrustFilter] = useState("all");
  const [presenceFilter, setPresenceFilter] = useState("all");
  const [discoverUrl, setDiscoverUrl] = useState("");

  const agents = useMemo<EnrichedContact[]>(() => {
    if (contactsData?.contacts && contactsData.contacts.length > 0) {
      return contactsData.contacts.map(enrichContact);
    }
    const convs = conversationsData?.conversations ?? [];
    const seen = new Set<string>();
    return convs
      .filter((c) => c.agentInstanceId && !seen.has(c.agentInstanceId) && seen.add(c.agentInstanceId))
      .map((c) => {
        const email = c.agentInstanceId ?? "unknown";
        return {
          id: c.agentInstanceId ?? crypto.randomUUID(),
          target_user_id: c.agentInstanceId ?? "",
          requester_user_id: c.agentInstanceId ?? "",
          display_name: c.title || (c.agentInstanceId?.slice(0, 12) ?? "Agent"),
          email: "",
          status: c.presence === "online" ? "accepted" : "pending",
          created_at: "",
          updated_at: "",
          displayName: c.title || "Agent",
          presence: c.presence === "online" ? "online" as const : c.presence === "offline" ? "offline" as const : "unknown" as const,
          trustLevel: "unverified" as const,
          deviceName: "Remote agent",
        } as EnrichedContact;
      });
  }, [contactsData, conversationsData]);

  const handleSelect = useCallback((agent: EnrichedContact) => {
    onSelectAgent?.(agent.target_user_id);
  }, [onSelectAgent]);

  const filtered = useMemo(() => {
    return agents.filter((a) => {
      if (search && !a.displayName.toLowerCase().includes(search.toLowerCase()) && !a.target_user_id.toLowerCase().includes(search.toLowerCase())) return false;
      if (trustFilter !== "all" && a.trustLevel !== trustFilter) return false;
      if (presenceFilter !== "all" && a.presence !== presenceFilter) return false;
      return true;
    });
  }, [agents, search, trustFilter, presenceFilter]);

  const handleOpen = useCallback(async (agent: EnrichedContact) => {
    if (!agent.target_user_id) return;
    const result = await startConversation.mutateAsync({
      peer_user_id: agent.target_user_id,
      title: agent.displayName,
      mode: "cloud_relay"
    });
    navigate(`/chats/${result.conversation.id}`);
  }, [navigate, startConversation]);

  const handleDiscover = useCallback(async () => {
    if (!discoverUrl.trim()) return;
    await discoverAgent.mutateAsync({ url: discoverUrl.trim(), trustLevel: "discovered" });
    setDiscoverUrl("");
  }, [discoverAgent, discoverUrl]);

  const onlineCount = agents.filter((a) => a.presence === "online").length;
  const verifiedCount = agents.filter((a) => a.trustLevel === "verified").length;

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-oa-blue border-t-transparent" />
          <p className="text-xs text-oa-text-muted">Loading agents...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6 max-w-6xl">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-oa-text">Agents</h1>
        <p className="text-sm text-oa-text-muted">
          {agents.length} agent{agents.length !== 1 ? "s" : ""} - {onlineCount} online - {verifiedCount} verified
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-xl border border-oa-border bg-oa-surface/80 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Shield className="h-4 w-4 text-oa-blue" />
            <h2 className="text-sm font-semibold text-oa-text">Registry & Trust</h2>
            <span className="ml-auto text-[10px] text-oa-text-muted">{registryData?.count ?? 0} registered</span>
          </div>
          <div className="space-y-2">
            {(registryData?.agents ?? []).slice(0, 6).map((agent) => (
              <RegistryAgentRow
                key={agent.did}
                agent={agent}
                onTrust={(trustLevel) => updateTrust.mutate({ did: agent.did, trustLevel })}
              />
            ))}
            {(registryData?.agents ?? []).length === 0 && (
              <p className="rounded-lg border border-dashed border-oa-border bg-oa-bg-elevated p-3 text-xs text-oa-text-muted">
                No registry agents yet. Discover one by agent-card URL.
              </p>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={discoverUrl}
              onChange={(event) => setDiscoverUrl(event.target.value)}
              placeholder="https://agent.example/.well-known/agent-card.json"
              className="h-10 min-w-0 flex-1 rounded-lg border border-oa-border bg-oa-bg px-3 text-xs text-oa-text outline-none focus:border-oa-blue"
            />
            <button
              type="button"
              onClick={handleDiscover}
              disabled={!discoverUrl.trim() || discoverAgent.isPending}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-oa-border bg-oa-blue/10 px-3 text-xs text-oa-blue disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Discover
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-oa-border bg-oa-surface/80 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Tags className="h-4 w-4 text-oa-purple" />
            <h2 className="text-sm font-semibold text-oa-text">Capabilities</h2>
            <span className="ml-auto text-[10px] text-oa-text-muted">{skillsData?.count ?? 0} skills</span>
          </div>
          <div className="space-y-2">
            {(skillsData?.skills ?? []).slice(0, 5).map((skill) => (
              <div key={skill.id} className="rounded-lg border border-oa-border bg-oa-bg-elevated p-3">
                <p className="text-xs font-medium text-oa-text">{skill.name}</p>
                <p className="mt-0.5 line-clamp-2 text-[10px] text-oa-text-muted">{skill.description}</p>
              </div>
            ))}
            {(skillsData?.skills ?? []).length === 0 && (
              <p className="rounded-lg border border-dashed border-oa-border bg-oa-bg-elevated p-3 text-xs text-oa-text-muted">
                No local skill manifests loaded.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-oa-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents by name or ID..."
            className="h-10 w-full rounded-lg border border-oa-border bg-oa-surface pl-10 pr-3 text-sm text-oa-text outline-none transition focus:border-oa-blue placeholder:text-oa-text-disabled"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 flex min-h-[48px] min-w-[48px] items-center justify-center text-oa-text-muted hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-oa-text-muted uppercase tracking-wider">Trust</span>
          <div className="flex gap-1">
            {trustOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTrustFilter(opt.value)}
                className={`rounded-md px-2.5 py-1.5 text-[10px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue ${
                  trustFilter === opt.value ? "bg-oa-blue/20 text-oa-blue" : "text-oa-text-muted hover:bg-oa-surface hover:text-oa-text"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-oa-text-muted uppercase tracking-wider">Status</span>
          <div className="flex gap-1">
            {presenceOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPresenceFilter(opt.value)}
                className={`rounded-md px-2.5 py-1.5 text-[10px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue ${
                  presenceFilter === opt.value ? "bg-oa-blue/20 text-oa-blue" : "text-oa-text-muted hover:bg-oa-surface hover:text-oa-text"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center max-w-sm">
            <Bot className="h-10 w-10 text-oa-text-muted" />
            <div>
              <p className="text-sm font-medium text-oa-text-muted">
                {search || trustFilter !== "all" || presenceFilter !== "all" ? "No agents match your filters" : "No agents yet"}
              </p>
              <p className="text-xs text-oa-text-disabled mt-1">
                {search || trustFilter !== "all" || presenceFilter !== "all" ? "Try adjusting your search or filters" : "Agent contacts will appear here once you connect with other agents"}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          {filtered.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onOpen={handleOpen}
              onSelect={handleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RegistryAgentRow({ agent, onTrust }: { agent: RegistryAgent; onTrust: (trustLevel: RegistryTrustLevel) => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-oa-border bg-oa-bg-elevated p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-oa-blue/20 to-oa-purple/20 text-[10px] font-bold text-oa-blue">
        {agent.name.slice(0, 2).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-oa-text">{agent.name}</p>
        <p className="truncate text-[10px] text-oa-text-muted">{agent.did}</p>
        {agent.skills.length > 0 && (
          <p className="mt-1 truncate text-[10px] text-oa-text-disabled">{agent.skills.slice(0, 3).join(", ")}</p>
        )}
      </div>
      <select
        value={agent.trustLevel}
        onChange={(event) => onTrust(event.target.value as RegistryTrustLevel)}
        className="h-9 rounded-lg border border-oa-border bg-oa-surface px-2 text-[10px] text-oa-text outline-none focus:border-oa-blue"
        aria-label={`Trust level for ${agent.name}`}
      >
        {(["local", "loopback", "trusted", "discovered", "blocked"] as RegistryTrustLevel[]).map((trust) => (
          <option key={trust} value={trust}>{trust}</option>
        ))}
      </select>
    </div>
  );
}
