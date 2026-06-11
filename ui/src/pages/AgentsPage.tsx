import { useState } from "react";
import { AgentDirectory } from "../features/agents";
import { AgentProfile } from "../features/agents/AgentProfile";
import { TrustGraph } from "../features/agents/TrustGraph";
import { useContacts, useConversations } from "../hooks/queries";
import { User, Share2, Shield, type LucideIcon } from "lucide-react";

type ViewMode = "directory" | "graph";

export function AgentsPage() {
  const { data: contactsData } = useContacts();
  const { data: conversationsData } = useConversations();
  const [view, setView] = useState<ViewMode>("directory");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const contacts = contactsData?.contacts ?? [];
  const convs = conversationsData?.conversations ?? [];

  const selectedAgent = selectedAgentId
    ? contacts.find((c) => c.target_user_id === selectedAgentId) ?? null
    : null;
  const selectedAgentRecord = selectedAgent as unknown as { display_name?: unknown } | null;
  const selectedAgentDisplayName =
    typeof selectedAgentRecord?.display_name === "string"
      ? selectedAgentRecord.display_name
      : selectedAgent?.target_user_id?.slice(0, 12) ?? "Agent";

  const agentProfile = selectedAgent ? {
    id: selectedAgent.target_user_id ?? selectedAgentId!,
    displayName: selectedAgentDisplayName,
    targetUserId: selectedAgent.target_user_id ?? selectedAgentId!,
    trustLevel: (selectedAgent.status === "accepted" ? "verified" : "unverified") as "verified" | "unverified" | "external" | "local",
    presence: "online" as const,
    capabilities: [],
    deviceName: "Remote agent",
    status: selectedAgent.status,
  } : null;

  const tabs: { value: ViewMode; label: string; icon: LucideIcon }[] = [
    { value: "directory", label: "Agents", icon: User },
    { value: "graph", label: "Trust Graph", icon: Share2 },
  ];

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex flex-1 flex-col min-w-0">
        <div className="flex items-center gap-1 border-b border-oa-border bg-oa-surface px-4">
          {tabs.map((tab) => {
            const TabIcon = tab.icon;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setView(tab.value)}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition ${
                  view === tab.value ? "border-oa-blue text-oa-text" : "border-transparent text-oa-text-muted hover:text-oa-text"
                }`}
              >
                <TabIcon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
          <span className="ml-auto text-[10px] text-oa-text-muted">
            {contacts.length + convs.filter((c) => c.agentInstanceId).length} agents
          </span>
        </div>

        {view === "directory" && (
          <div className="flex flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto">
              <AgentDirectory
                onSelectAgent={setSelectedAgentId}
              />
            </div>
            {agentProfile && (
              <div className="w-96 shrink-0 border-l border-oa-border overflow-y-auto">
                <AgentProfile agent={agentProfile} onClose={() => setSelectedAgentId(null)} />
              </div>
            )}
          </div>
        )}

        {view === "graph" && (
          <div className="flex-1 overflow-y-auto">
            <TrustGraph />
          </div>
        )}
      </div>
    </div>
  );
}
