import { useState, useMemo } from "react";
import { Shield, ShieldCheck, ShieldOff, Ban, BadgeCheck, BadgeAlert, Globe, ArrowRight, Search, X, Filter, type LucideIcon } from "lucide-react";
import { useTrustGraph, useContacts } from "../../hooks/queries";
import type { TrustRelationship } from "../../types";

type FilterMode = "all" | "verified" | "blocked" | "pending";

const TRUST_LEVEL_CONFIG: Record<string, { icon: LucideIcon; color: string; bg: string; label: string }> = {
  verified: { icon: ShieldCheck, color: "text-oa-green", bg: "bg-oa-green/10", label: "Verified" },
  unverified: { icon: BadgeAlert, color: "text-oa-amber", bg: "bg-oa-amber/10", label: "Unverified" },
  external: { icon: ShieldOff, color: "text-oa-red", bg: "bg-oa-red/10", label: "External" },
  local: { icon: Shield, color: "text-oa-blue", bg: "bg-oa-blue/10", label: "Local" },
  blocked: { icon: Ban, color: "text-oa-red", bg: "bg-oa-red/10", label: "Blocked" },
};

export function TrustGraph() {
  const { data: relationships = [] } = useTrustGraph();
  const { data: contactsData } = useContacts();
  const [filter, setFilter] = useState<FilterMode>("all");
  const [search, setSearch] = useState("");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const contacts = contactsData?.contacts ?? [];

  const nodes = useMemo(() => {
    const result: Array<{
      id: string;
      label: string;
      trustLevel: string;
      type: "local" | "remote";
      relationshipCount: number;
      capabilities: string[];
    }> = [];

    const seen = new Set<string>();

    for (const rel of relationships) {
      for (const id of [rel.localAgentInstanceId, rel.remoteAgentInstanceId]) {
        if (!seen.has(id)) {
          seen.add(id);
          const contact = contacts.find((c) => c.target_user_id === id || c.requester_user_id === id);
          result.push({
            id,
            label: contact?.target_user_id?.slice(0, 12) ?? id.slice(0, 12),
            trustLevel: rel.trustLevel ?? "unverified",
            type: id === rel.localAgentInstanceId ? "local" : "remote",
            relationshipCount: relationships.filter((r) => r.localAgentInstanceId === id || r.remoteAgentInstanceId === id).length,
            capabilities: rel.capabilities ?? [],
          });
        }
      }
    }

    if (result.length === 0) {
      result.push({
        id: "local-agent",
        label: "Local Agent",
        trustLevel: "local",
        type: "local",
        relationshipCount: 0,
        capabilities: ["a2a.v1", "file.request", "file.transfer"],
      });
    }

    return result;
  }, [relationships, contacts]);

  const filtered = useMemo(() => {
    return nodes.filter((n) => {
      if (filter === "blocked" && n.trustLevel !== "blocked") return false;
      if (filter === "verified" && n.trustLevel !== "verified") return false;
      if (filter === "pending" && n.trustLevel !== "unverified") return false;
      if (search && !n.label.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [nodes, filter, search]);

  const filters: { value: FilterMode; label: string }[] = [
    { value: "all", label: "All" },
    { value: "verified", label: "Verified" },
    { value: "blocked", label: "Blocked" },
    { value: "pending", label: "Pending" },
  ];

  return (
    <div className="flex flex-1 flex-col gap-4 p-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-oa-text">Trust Graph</h1>
          <p className="text-sm text-oa-text-muted">
            {nodes.length} agent{nodes.length !== 1 ? "s" : ""}
            &middot; {relationships.length} relationship{relationships.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-oa-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents..."
            className="h-10 w-full rounded-lg border border-oa-border bg-oa-surface pl-9 pr-3 text-xs text-oa-text outline-none focus:border-oa-blue"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-oa-text-muted hover:text-oa-text">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Filter className="h-3.5 w-3.5 text-oa-text-muted" />
        {filters.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`rounded-md px-2.5 py-1.5 text-[10px] font-medium transition ${
              filter === f.value ? "bg-oa-blue/20 text-oa-blue" : "text-oa-text-muted hover:bg-oa-surface hover:text-oa-text"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-oa-border bg-oa-surface/80 p-6">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="flex flex-col items-center gap-2 text-center">
              <Shield className="h-8 w-8 text-oa-text-muted" />
              <p className="text-sm text-oa-text-muted">No agents match your filters</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((node) => {
              const tc = TRUST_LEVEL_CONFIG[node.trustLevel] ?? TRUST_LEVEL_CONFIG.unverified;
              const TrustIcon = tc.icon;
              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => setSelectedNode(selectedNode === node.id ? null : node.id)}
                  className={`rounded-xl border p-4 text-left transition ${
                    selectedNode === node.id ? "border-oa-blue/50 bg-oa-blue/5" : "border-oa-border bg-oa-bg-elevated hover:border-oa-border-strong"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tc.bg}`}>
                      <TrustIcon className={`h-4 w-4 ${tc.color}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-oa-text">{node.label}</p>
                      <p className="truncate text-[9px] text-oa-text-muted font-mono">{node.id}</p>
                    </div>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[8px] font-medium ${tc.color} ${tc.bg}`}>
                      {tc.label}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-3 text-[10px] text-oa-text-muted">
                    <span className="flex items-center gap-1">
                      <ArrowRight className="h-3 w-3" />
                      {node.relationshipCount} connection{node.relationshipCount !== 1 ? "s" : ""}
                    </span>
                    <span className="flex items-center gap-1">
                      <Globe className="h-3 w-3" />
                      {node.type}
                    </span>
                  </div>
                  {selectedNode === node.id && node.capabilities.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1 border-t border-oa-border pt-3">
                      {node.capabilities.map((cap) => (
                        <span key={cap} className="rounded bg-oa-surface-2 px-1.5 py-0.5 text-[9px] text-oa-text-muted">{cap}</span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {relationships.length > 0 && (
        <div className="rounded-xl border border-oa-border bg-oa-surface/80 p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-oa-text-muted">Relationships</h3>
          <div className="space-y-2">
            {relationships.slice(0, 12).map((rel, i) => (
              <div key={`${rel.localAgentInstanceId}-${rel.remoteAgentInstanceId}-${i}`} className="flex items-center gap-3 rounded-lg border border-oa-border bg-oa-bg-elevated p-3">
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="font-medium text-oa-text">{rel.localAgentInstanceId.slice(0, 10)}...</span>
                  <ArrowRight className="h-3 w-3 text-oa-text-muted" />
                  <span className="font-medium text-oa-text">{rel.remoteAgentInstanceId.slice(0, 10)}...</span>
                </div>
                <span className={`ml-auto rounded px-1.5 py-0.5 text-[9px] font-medium ${
                  rel.trustLevel === "verified" ? "text-oa-green bg-oa-green/10" :
                  rel.trustLevel === "blocked" ? "text-oa-red bg-oa-red/10" :
                  "text-oa-amber bg-oa-amber/10"
                }`}>
                  {rel.trustLevel ?? "unverified"}
                </span>
                <span className="text-[9px] text-oa-text-disabled">{rel.capabilities?.slice(0, 2).join(", ") ?? ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
