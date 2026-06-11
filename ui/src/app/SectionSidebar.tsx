import { Bot, Inbox, ShieldCheck, FileText, ListChecks, ScrollText, Settings, Wifi, Clock, Search, Calendar, HardDrive, Ban, Bell, CheckCircle2, Database, Shield, SlidersHorizontal, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useSection } from "./SectionContext";
import { ConversationSidebar } from "../features/chat/ConversationSidebar";
import { useA2ATasks, useAgentRuns, useAuditEvents, useCloudStatus, useContacts, useConversations, usePendingApprovals, useReceivedFiles, useTransfers } from "../hooks/queries";
import { useParams } from "react-router-dom";
import { useSidebar } from "../components/SidebarContext";
import { SidebarToggle } from "../components/SidebarToggle";
import { useDensityPreference } from "../lib/uiPreferences";
import { IntentInbox } from "../features/inbox/IntentInbox";
import type { AgentStatusMessage } from "../api/types";

interface SidebarShellProps {
  label: string;
  icon: LucideIcon;
  children?: ReactNode;
  collapsed?: boolean;
}

function SidebarShell({ label, icon: Icon, children, collapsed = false }: SidebarShellProps) {
  return (
    <aside className={`glass-panel flex ${collapsed ? "w-16" : "w-72"} shrink-0 flex-col border-r border-oa-border`} role="navigation" aria-label={label}>
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <SidebarToggle />
        {!collapsed && <>
          <Icon className="h-4 w-4 text-oa-text-muted" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">{label}</h2>
        </>}
      </div>
      {!collapsed && (
        <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-3">
          {children}
        </div>
      )}
    </aside>
  );
}

function Metric({ icon: Icon, label, value, tone = "muted" }: { icon: LucideIcon; label: string; value: string | number; tone?: "muted" | "blue" | "green" | "amber" | "red" }) {
  const toneClass = {
    muted: "text-oa-text-muted bg-oa-surface/70",
    blue: "text-oa-blue bg-oa-blue/10",
    green: "text-oa-green bg-oa-green/10",
    amber: "text-oa-amber bg-oa-amber/10",
    red: "text-oa-red bg-oa-red/10",
  }[tone];
  return (
    <div className={`mx-1 flex items-center gap-2 rounded-lg px-3 py-2 ${toneClass}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-[10px]">{label}</span>
      <span className="text-[10px] font-semibold">{value}</span>
    </div>
  );
}

import { RevealableText } from "../components/primitives/RevealableText";

function RecentItem({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="mx-1 rounded-lg border border-oa-border/60 bg-oa-surface/50 px-3 py-2">
      <p className="truncate text-[10px] font-medium text-oa-text">
        <RevealableText text={title} />
      </p>
      {detail && <p className="mt-0.5 truncate text-[9px] text-oa-text-muted">{detail}</p>}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function InboxSidebar() {
  const { sidebarOpen } = useSidebar();
  if (!sidebarOpen) return <SidebarShell label="Inbox" icon={Inbox} collapsed />;
  return <IntentInbox />;
}

function AgentsSidebar() {
  const { sidebarOpen } = useSidebar();
  const { data: contactsData } = useContacts();

  if (!sidebarOpen) return <SidebarShell label="Agents" icon={Bot} collapsed />;
  const contacts = contactsData?.contacts ?? [];
  const online = contacts.filter((c) => (c as { presence?: string }).presence !== "offline").length;
  const trusted = contacts.filter((c) => c.status === "accepted" || c.status === "active").length;

  return (
    <SidebarShell label="Agents" icon={Bot}>
      <Metric icon={Wifi} label="Online or reachable" value={online} tone="green" />
      <Metric icon={Shield} label="Trusted contacts" value={trusted} tone="blue" />
      <Metric icon={Bot} label="Total contacts" value={contacts.length} />
      <div className="px-1 pt-1">
        <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wider text-oa-text-disabled">Filters</p>
        <div className="flex flex-wrap gap-1">
          {["Trusted", "Online", "Local"].map((label) => (
            <span key={label} className="rounded-full border border-oa-border bg-oa-surface/60 px-2 py-1 text-[9px] text-oa-text-muted">
              {label}
            </span>
          ))}
        </div>
      </div>
    </SidebarShell>
  );
}

function ApprovalsSidebar() {
  const { sidebarOpen } = useSidebar();
  const { approvalCards } = usePendingApprovals();

  if (!sidebarOpen) return <SidebarShell label="Approvals" icon={ShieldCheck} collapsed />;
  const now = Date.now();
  const activePending = approvalCards.filter((c) => c.status === "pending" && new Date(c.expires_at).getTime() > now).length;
  const expired = approvalCards.filter((c) => c.status === "expired" || new Date(c.expires_at).getTime() <= now).length;

  return (
    <SidebarShell label="Approvals" icon={ShieldCheck}>
      <Metric icon={ShieldCheck} label="Pending decisions" value={activePending} tone="amber" />
      <Metric icon={Clock} label="Expired requests" value={expired} tone={expired > 0 ? "red" : "muted"} />
      <Metric icon={Search} label="Total cards" value={approvalCards.length} />
    </SidebarShell>
  );
}

function FilesSidebar() {
  const { sidebarOpen } = useSidebar();
  const { data } = useReceivedFiles();

  if (!sidebarOpen) return <SidebarShell label="Files" icon={FileText} collapsed />;
  const files = data?.files ?? [];
  const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  const recent = [...files]
    .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
    .slice(0, 3);

  return (
    <SidebarShell label="Files" icon={FileText}>
      <Metric icon={HardDrive} label="Stored files" value={files.length} tone="blue" />
      <Metric icon={Database} label="Received size" value={formatSize(totalBytes)} />
      <Metric icon={ShieldCheck} label="Hash records" value={files.filter((file) => file.sha256).length} tone="green" />
      {recent.length > 0 && (
        <div className="space-y-1 pt-1">
          <p className="px-3 text-[10px] font-medium uppercase tracking-wider text-oa-text-disabled">Recent files</p>
          {recent.map((file) => (
            <RecentItem key={file.id} title={file.originalFileName} detail={formatSize(file.sizeBytes)} />
          ))}
        </div>
      )}
    </SidebarShell>
  );
}

function TasksSidebar() {
  const { sidebarOpen } = useSidebar();
  const { data: conversationsData } = useConversations();

  if (!sidebarOpen) return <SidebarShell label="Tasks" icon={ListChecks} collapsed />;
  const messages = conversationsData?.conversations?.flatMap((c) => c.messages ?? []) ?? [];
  const agentMessages = messages.filter((m): m is AgentStatusMessage => m.kind === "agent_status");
  const completed = agentMessages.filter((m) => m.phase === "completed").length;
  const failed = agentMessages.filter((m) => m.phase === "failed").length;
  const running = agentMessages.filter((m) => m.phase !== "completed" && m.phase !== "failed").length;

  return (
    <SidebarShell label="Tasks" icon={ListChecks}>
      <Metric icon={Clock} label="Running" value={running} tone={running > 0 ? "blue" : "muted"} />
      <Metric icon={CheckCircle2} label="Completed" value={completed} tone="green" />
      <Metric icon={Ban} label="Failed" value={failed} tone={failed > 0 ? "red" : "muted"} />
    </SidebarShell>
  );
}

function AuditSidebar() {
  const { sidebarOpen } = useSidebar();
  const { data } = useAuditEvents();

  if (!sidebarOpen) return <SidebarShell label="Audit" icon={ScrollText} collapsed />;
  const events = data?.events ?? [];
  const eventTypes = new Set(events.map((e) => e.eventType));
  const chainValid = data?.chainValid?.valid;
  const recentTypes = events.slice(0, 3);

  return (
    <SidebarShell label="Audit" icon={ScrollText}>
      <Metric icon={Calendar} label="Events" value={events.length} />
      <Metric icon={Search} label="Event types" value={eventTypes.size} />
      <Metric icon={ShieldCheck} label="Chain status" value={chainValid === undefined ? "Unknown" : chainValid ? "Valid" : "Broken"} tone={chainValid === false ? "red" : chainValid ? "green" : "muted"} />
      {recentTypes.length > 0 && (
        <div className="space-y-1 pt-1">
          <p className="px-3 text-[10px] font-medium uppercase tracking-wider text-oa-text-disabled">Recent events</p>
          {recentTypes.map((event) => (
            <RecentItem key={event.id} title={event.eventType.replace(/_/g, " ")} detail={new Date(event.createdAt).toLocaleString()} />
          ))}
        </div>
      )}
    </SidebarShell>
  );
}

function SettingsSidebar() {
  const { sidebarOpen } = useSidebar();
  const { density } = useDensityPreference();
  const { data } = useCloudStatus();

  if (!sidebarOpen) return <SidebarShell label="Settings" icon={Settings} collapsed />;
  const status = data?.cloud.status ?? "disconnected";

  return (
    <SidebarShell label="Settings" icon={Settings}>
      <Metric icon={HardDrive} label="Account status" value={status} tone={status === "enrolled" ? "green" : "amber"} />
      <Metric icon={SlidersHorizontal} label="Density" value={density} tone="blue" />
      <Metric icon={Bell} label="Notifications" value="Configurable" />
      <div className="px-1 pt-1">
        <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wider text-oa-text-disabled">Quick links</p>
        {["Account", "Security", "Theme"].map((label) => (
          <RecentItem key={label} title={label} detail="Available in Settings" />
        ))}
      </div>
    </SidebarShell>
  );
}

export function SectionSidebar() {
  const section = useSection();
  const { conversationId } = useParams<{ conversationId?: string }>();
  const { data: conversationsData } = useConversations();
  const { sidebarOpen } = useSidebar();

  if (section === "chats") {
    return (
      <ConversationSidebar
        conversations={conversationsData?.conversations ?? []}
        activeConversationId={conversationId ?? null}
        sidebarOpen={sidebarOpen}
      />
    );
  }

  if (section === "inbox") return <InboxSidebar />;
  if (section === "agents") return <AgentsSidebar />;
  if (section === "approvals") return <ApprovalsSidebar />;
  if (section === "files") return <FilesSidebar />;
  if (section === "tasks") return <TasksSidebar />;
  if (section === "audit") return <AuditSidebar />;
  if (section === "settings") return <SettingsSidebar />;

  return null;
}
