import { useState } from "react";
import { X, Activity, User, FileText, Shield, Clock, AlertTriangle, Settings, Bot, MoreHorizontal, PanelRight } from "lucide-react";
import { Button } from "@heroui/react";
import { ActivityTab, ProfileTab, FilesTab, SecurityTab, TimelineTab, AlertsTab, SettingsTab, AgentStatusTab } from "./tabs";
import { ChatSplitView } from "../../components/chat/ChatSplitView";

interface RightInspectorPanelProps {
  onClose: () => void;
}

type InspectorTab = "activity" | "context" | "profile" | "files" | "security" | "timeline" | "alerts" | "settings" | "agent";

const primaryTabs: { id: InspectorTab; label: string; Icon: typeof Activity }[] = [
  { id: "activity", label: "Activity", Icon: Activity },
  { id: "context", label: "Context", Icon: PanelRight },
  { id: "agent", label: "Agent", Icon: Bot },
  { id: "files", label: "Files", Icon: FileText },
  { id: "alerts", label: "Alerts", Icon: AlertTriangle },
  { id: "settings", label: "Settings", Icon: Settings },
];

const overflowTabs: { id: InspectorTab; label: string; Icon: typeof Activity }[] = [
  { id: "profile", label: "Profile", Icon: User },
  { id: "security", label: "Security", Icon: Shield },
  { id: "timeline", label: "Timeline", Icon: Clock },
];

export function RightInspectorPanel({ onClose }: RightInspectorPanelProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>("activity");
  const [showMore, setShowMore] = useState(false);

  function isOverflowTab(id: InspectorTab): boolean {
    return overflowTabs.some((t) => t.id === id);
  }

  function handleCloseMore() {
    setShowMore(false);
  }

  return (
    <aside id="right-inspector-panel" className="flex w-72 shrink-0 flex-col border-l border-oa-border bg-oa-sidebar-bg" aria-label="Inspector panel">
      <div className="flex items-center justify-between border-b border-oa-border px-3 py-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">
          Inspector
        </h2>
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

      <div className="flex items-center gap-0.5 border-b border-oa-border px-1.5 py-1.5">
        {primaryTabs.map(({ id, label, Icon }) => (
          <Button
            key={id}
            size="sm"
            variant={activeTab === id ? "primary" : "ghost"}
            onPress={() => setActiveTab(id)}
            aria-current={activeTab === id ? "page" : undefined}
            aria-label={label}
            className="flex-col gap-0.5 px-1 py-1 text-[8px] h-auto min-w-0"
          >
            <Icon className="h-3.5 w-3.5" />
            <span className={`${activeTab === id ? "" : "sr-only"}`}>{label}</span>
          </Button>
        ))}
        <div className="relative">
          <Button
            size="sm"
            variant="ghost"
            onPress={() => setShowMore((p) => !p)}
            aria-label="More tabs"
            className="flex-col gap-0.5 px-1 py-1 text-[8px] h-auto min-w-0"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
          {showMore && (
            <>
              <div className="fixed inset-0 z-10" onClick={handleCloseMore} />
              <div className="absolute right-0 top-full z-20 mt-1 flex flex-col rounded-lg border border-oa-border bg-oa-sidebar-bg p-1 shadow-lg">
                {overflowTabs.map(({ id, label, Icon }) => (
                  <Button
                    key={id}
                    size="sm"
                    variant={activeTab === id ? "primary" : "ghost"}
                    onPress={() => { setActiveTab(id); setShowMore(false); }}
                    aria-current={activeTab === id ? "page" : undefined}
                    className="justify-start gap-2 px-3 py-1.5 text-[11px] h-auto min-w-[120px]"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span>{label}</span>
                  </Button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto">
        {activeTab === "activity" && <ActivityTab />}
        {activeTab === "context" && <ChatSplitView context={null} />}
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
