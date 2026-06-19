import { useState } from "react";
import { X, Activity, User, FileText, Shield, Clock, AlertTriangle, Settings, Bot, PanelRight, Brain } from "lucide-react";
import { Button } from "@heroui/react";
import { ActivityTab, ProfileTab, FilesTab, SecurityTab, TimelineTab, AlertsTab, SettingsTab, AgentStatusTab } from "./tabs";
import { ChatSplitView } from "../../components/chat/ChatSplitView";
import { MemoryInspector } from "../../components/agentic-ai/MemoryInspector";

interface RightInspectorPanelProps {
  onClose: () => void;
  conversationId?: string | null;
}

type InspectorTab = "activity" | "context" | "memory" | "profile" | "files" | "security" | "timeline" | "alerts" | "settings" | "agent";

const inspectorTabs: { id: InspectorTab; label: string; shortLabel: string; Icon: typeof Activity }[] = [
  { id: "activity", label: "Activity", shortLabel: "Activity", Icon: Activity },
  { id: "context", label: "Context", shortLabel: "Context", Icon: PanelRight },
  { id: "memory", label: "Memory", shortLabel: "Memory", Icon: Brain },
  { id: "agent", label: "Agent status", shortLabel: "Agent", Icon: Bot },
  { id: "files", label: "Files", shortLabel: "Files", Icon: FileText },
  { id: "alerts", label: "Alerts", shortLabel: "Alerts", Icon: AlertTriangle },
  { id: "profile", label: "Profile", shortLabel: "Profile", Icon: User },
  { id: "security", label: "Security", shortLabel: "Security", Icon: Shield },
  { id: "timeline", label: "Timeline", shortLabel: "Timeline", Icon: Clock },
  { id: "settings", label: "Settings", shortLabel: "Settings", Icon: Settings },
];

export function RightInspectorPanel({ onClose, conversationId }: RightInspectorPanelProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>("activity");
  const activeTabLabel = inspectorTabs.find((tab) => tab.id === activeTab)?.label ?? "Inspector";

  return (
    <aside id="right-inspector-panel" className="oa-inspector-panel" aria-label="Inspector panel">
      <div className="oa-inspector-header">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">
            Inspector
          </h2>
          <p className="truncate text-[11px] text-oa-text-disabled">{activeTabLabel}</p>
        </div>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          onPress={onClose}
          aria-label="Close inspector"
          className="text-oa-text-muted"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="oa-inspector-tabs" role="tablist" aria-label="Inspector sections">
        {inspectorTabs.map(({ id, label, shortLabel, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            role="tab"
            aria-selected={activeTab === id}
            aria-controls={`inspector-tabpanel-${id}`}
            aria-label={label}
            title={label}
            className="oa-inspector-tab"
            data-active={activeTab === id ? "true" : "false"}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{shortLabel}</span>
          </button>
        ))}
      </div>

      <div
        className="flex flex-1 flex-col overflow-y-auto"
        role="tabpanel"
        id={`inspector-tabpanel-${activeTab}`}
        aria-label={activeTabLabel}
      >
        {activeTab === "activity" && <ActivityTab />}
        {activeTab === "context" && <ChatSplitView context={null} />}
        {activeTab === "memory" && <MemoryInspector conversationId={conversationId} />}
        {activeTab === "agent" && <AgentStatusTab />}
        {activeTab === "profile" && <ProfileTab />}
        {activeTab === "files" && <FilesTab />}
        {activeTab === "security" && <SecurityTab />}
        {activeTab === "timeline" && <TimelineTab />}
        {activeTab === "alerts" && <AlertsTab />}
        {activeTab === "settings" && <SettingsTab />}
      </div>
    </aside>
  );
}
