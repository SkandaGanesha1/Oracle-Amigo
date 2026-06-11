import { useNavigate } from "react-router-dom";
import { MessageSquarePlus, Bell, AlertTriangle, ArrowLeftRight } from "lucide-react";
import { DirectorySearch } from "./DirectorySearch";
import { ConversationList } from "./ConversationList";
import { SidebarToggle } from "../../components/SidebarToggle";
import { usePendingApprovals } from "../../hooks/queries";
import type { Conversation } from "../../api/types";

interface ConversationSidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  sidebarOpen: boolean;
}

export function ConversationSidebar({ conversations, activeConversationId, sidebarOpen }: ConversationSidebarProps) {
  const navigate = useNavigate();
  const { approvalCards } = usePendingApprovals();

  const collapsed = !sidebarOpen;
  const now = Date.now();
  const activePendingCount = approvalCards.filter(
    (c) => c.status === "pending" && new Date(c.expires_at).getTime() > now
  ).length;
  const totalTransfers = conversations.reduce((sum, c) => sum + (c.transferCount ?? 0), 0);

  function handleSelect(id: string) {
    navigate(`/chats/${id}`);
  }

  function focusDirectorySearch() {
    window.dispatchEvent(new Event("oa-focus-directory-search"));
  }

  return (
    <aside className={`flex ${collapsed ? "w-16" : "w-72"} shrink-0 flex-col border-r border-oa-border bg-oa-sidebar-bg`} role="navigation" aria-label="Conversations">
      <div className="flex items-center gap-2 px-3 pt-3 pb-1">
        <SidebarToggle />
        {!collapsed && (
          <>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">
              <span className="flex items-center gap-1.5">
                <Bell className="h-3 w-3" />
                Conversations
              </span>
            </h2>
            <div className="ml-auto flex items-center gap-1">
              {activePendingCount > 0 && (
                <span className="flex items-center gap-1 rounded-md bg-oa-surface px-1.5 py-0.5 text-[10px] font-medium text-oa-text-muted" title="Pending approvals">
                  <AlertTriangle className="h-3 w-3" />
                  {activePendingCount}
                </span>
              )}
              {totalTransfers > 0 && (
                <span className="flex items-center gap-1 rounded-md bg-oa-purple/15 px-1.5 py-0.5 text-[10px] font-medium text-oa-purple" title="Active transfers">
                  <ArrowLeftRight className="h-3 w-3" />
                  {totalTransfers}
                </span>
              )}
              <button
                type="button"
                onClick={focusDirectorySearch}
                className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-md text-oa-text-muted transition-colors hover:bg-oa-surface hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
                aria-label="New conversation"
                title="New conversation"
              >
                <MessageSquarePlus className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </div>

      {!collapsed && <DirectorySearch />}

      {!collapsed && (
        <div className="flex-1 overflow-y-auto">
          <ConversationList
            conversations={conversations}
            activeConversationId={activeConversationId}
            onSelect={handleSelect}
          />
        </div>
      )}
    </aside>
  );
}
