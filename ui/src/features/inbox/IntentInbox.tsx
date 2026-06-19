import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ShieldAlert, Bot, Clock, Users, MessageSquarePlus, Bell, AlertTriangle, Loader2 } from "lucide-react";
import { isCloudUserReady, useConversations, usePendingApprovals, useAgentRuns, useContacts, useCloudStatus } from "../../hooks/queries";
import { SidebarToggle } from "../../components/SidebarToggle";
import { OracleAvatar } from "../../components/primitives/OracleAvatar";
import { useSidebar } from "../../components/SidebarContext";

const emptyPlaceholders = ["No messages yet", "Conversation starting", "Starting conversation"];

function isEmptyPlaceholder(title: string, lastMessage: string, messages?: unknown[]): boolean {
  const hasHumanMessages = (messages ?? []).some((m) => (m as { kind?: string }).kind === "human");
  if (hasHumanMessages) return false;
  if ((messages ?? []).length < 2) return true;
  return emptyPlaceholders.some((p) => lastMessage?.includes(p));
}

interface InboxGroup {
  id: string;
  label: string;
  icon: typeof ShieldAlert;
  conversations: Array<{ id: string; title: string; subtitle: string; agentInstanceId: string | null; presence: string; unread: number; lastMessage: string }>;
  badge?: number;
  tone: string;
}

export function IntentInbox() {
  const navigate = useNavigate();
  const { conversationId } = useParams<{ conversationId?: string }>();
  const { sidebarOpen } = useSidebar();
  const collapsed = !sidebarOpen;
  const { data: convsData, isLoading: convsLoading } = useConversations();
  const { approvalCards, isLoading: approvalsLoading } = usePendingApprovals();
  const { data: runsData, isLoading: runsLoading } = useAgentRuns();
  const { data: cloudStatus } = useCloudStatus();
  const cloudContactsEnabled = isCloudUserReady(cloudStatus);
  const { data: contactsData } = useContacts(cloudContactsEnabled);

  const isLoading = convsLoading || approvalsLoading || runsLoading;

  const convs = convsData?.conversations ?? [];
  const runs = runsData?.runs ?? [];
  const contacts = contactsData?.contacts ?? [];

  const now = Date.now();
  const activePendingApprovals = approvalCards.filter(
    (c) => c.status === "pending" && new Date(c.expires_at).getTime() > now
  );

  const groups = useMemo<InboxGroup[]>(() => {
    const result: InboxGroup[] = [];

    const agentWorkingConvs = convs.filter((c) =>
      (c.messages ?? []).some((m) =>
        m.kind === "agent_status" && (m as { phase?: string }).phase === "thinking"
      )
    );

    const waitingConvs = convs.filter((c) =>
      c.agentInstanceId && !agentWorkingConvs.includes(c) && !isEmptyPlaceholder(c.title, c.lastMessage, c.messages)
    );

    const recentPeopleConvs = convs.filter((c) =>
      !c.agentInstanceId && !agentWorkingConvs.includes(c) && !isEmptyPlaceholder(c.title, c.lastMessage, c.messages)
    );

    const convsNeedingApproval = convs.filter((c) => c.pendingApprovals > 0);

    if (activePendingApprovals.length > 0 || convsNeedingApproval.length > 0) {
      result.push({
        id: "approvals",
        label: "Needs my approval",
        icon: ShieldAlert,
        tone: "amber",
        badge: activePendingApprovals.length,
        conversations: convsNeedingApproval,
      });
    }

    if (runs.some((r) => r.status === "running")) {
      result.push({
        id: "working",
        label: "Agent is working",
        icon: Bot,
        tone: "blue",
        conversations: convs.filter((c) =>
          (c.messages ?? []).some((m) =>
            m.kind === "agent_status" && (m as { phase?: string }).phase !== "completed" && (m as { phase?: string }).phase !== "failed"
          )
        ),
      });
    }

    if (waitingConvs.length > 0) {
      result.push({
        id: "waiting",
        label: "Waiting on others",
        icon: Clock,
        tone: "muted",
        conversations: waitingConvs,
      });
    }

    if (recentPeopleConvs.length > 0) {
      result.push({
        id: "people",
        label: "Recent people",
        icon: Users,
        tone: "muted",
        conversations: recentPeopleConvs,
      });
    }

    return result;
  }, [convs, activePendingApprovals, runs]);

  if (collapsed) {
    return (
      <aside className="flex w-16 shrink-0 flex-col border-r border-oa-border bg-oa-sidebar-bg" role="navigation" aria-label="Intent Inbox">
        <div className="flex items-center justify-center px-3 pt-3 pb-1">
          <SidebarToggle />
        </div>
      </aside>
    );
  }

  if (isLoading) {
    return (
      <aside className="flex w-72 shrink-0 flex-col border-r border-oa-border bg-oa-sidebar-bg" role="navigation" aria-label="Intent Inbox">
        <div className="flex items-center gap-2 px-3 pt-3 pb-1">
          <SidebarToggle />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">
            <span className="flex items-center gap-1.5">
              <Bell className="h-3 w-3" />
              Inbox
            </span>
          </h2>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-oa-text-muted" />
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-oa-border bg-oa-sidebar-bg" role="navigation" aria-label="Intent Inbox">
      <div className="flex items-center gap-2 px-3 pt-3 pb-1">
        <SidebarToggle />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">
          <span className="flex items-center gap-1.5">
            <Bell className="h-3 w-3" />
            Inbox
          </span>
        </h2>
        <div className="ml-auto">
          <button
            type="button"
            onClick={() => navigate("/chats")}
            className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-md text-oa-text-muted transition-colors hover:bg-oa-surface hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
            aria-label="Open chat"
            title="Open chat"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <Bell className="h-8 w-8 text-oa-text-muted" />
            <p className="text-sm font-medium text-oa-text">All clear</p>
            <p className="text-xs text-oa-text-muted max-w-[200px]">
              No pending approvals, active tasks, or recent conversations.
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.id} className="pt-2 first:pt-0">
              <div className="flex items-center gap-1.5 px-3 py-1">
                <group.icon className={`h-3 w-3 ${
                  group.tone === "amber" ? "text-oa-amber" :
                  group.tone === "blue" ? "text-oa-blue" :
                  "text-oa-text-muted"
                }`} />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-oa-text-muted">{group.label}</span>
                {group.badge !== undefined && group.badge > 0 && (
                  <span className="rounded-full bg-oa-amber/20 px-1.5 py-0.5 text-[9px] font-medium text-oa-amber leading-none">
                    {group.badge}
                  </span>
                )}
              </div>
              <div className="mt-0.5 space-y-0.5">
                {group.conversations.slice(0, 5).map((conv) => (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => navigate(`/chats/${conv.id}`)}
                    aria-current={conv.id === conversationId ? "true" : undefined}
                    className={`flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2 ${
                      conv.id === conversationId
                        ? "bg-oa-blue/10 text-oa-text ring-1 ring-oa-blue/25"
                        : "hover:bg-oa-surface"
                    }`}
                  >
                    <OracleAvatar
                      seed={conv.title}
                      initials={conv.title.slice(0, 2).toUpperCase()}
                      size="sm"
                      className="h-8 w-8 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-oa-text">{conv.title}</p>
                      <p className="truncate text-xs text-oa-text-muted">{conv.lastMessage}</p>
                    </div>
                    {conv.unread > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-oa-blue px-1.5 text-[10px] font-bold text-white">
                        {conv.unread > 99 ? "99+" : conv.unread}
                      </span>
                    )}
                  </button>
                ))}
                {group.conversations.length > 5 && (
                  <button
                    type="button"
                    onClick={() => navigate("/chats")}
                    className="w-full px-3 py-1 text-left text-[10px] text-oa-blue hover:text-oa-blue/80"
                  >
                    +{group.conversations.length - 5} more
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
