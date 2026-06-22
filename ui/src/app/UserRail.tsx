import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Badge } from "@heroui/react";
import { Inbox, LoaderCircle, LogOut, Search, Settings, User as UserIcon, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import oracleLogoUrl from "../../../UI_images/oracle_logo.png";
import { OracleAvatar } from "../components/primitives/OracleAvatar";
import { isCloudUserReady, useCloudStatus, useContacts, useConversations, useDirectorySearch, useLogout, usePendingApprovals, useStartConversation } from "../hooks/queries";
import { buildRailUsers, safePersonName, type RailUser } from "./userRailModel";
import type { AgentInstance, DirectoryUser, PeerPresence } from "../types";
import { AccountProfileDialog } from "./AccountProfileDialog";

export function UserRail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: conversationsData } = useConversations();
  const { data: cloudStatus } = useCloudStatus();
  const cloudDirectoryEnabled = isCloudUserReady(cloudStatus);
  const { data: contactsData } = useContacts(cloudDirectoryEnabled);
  const { approvalCards } = usePendingApprovals();
  const createConversation = useStartConversation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const conversations = conversationsData?.conversations ?? [];
  const users = useMemo(
    () => buildRailUsers(conversations, cloudStatus, contactsData?.contacts ?? []),
    [cloudStatus, contactsData, conversations]
  );
  const unread = conversations.reduce((sum, conversation) => sum + (conversation.unread ?? 0), 0);
  const pendingApprovals = approvalCards.filter((card) => card.status === "pending").length;
  const inboxBadge = unread + pendingApprovals;
  const profileDisplayName = cloudStatus?.cloud?.displayName ?? cloudStatus?.cloud?.userEmail ?? "Account";
  const profileAvatarSeed = cloudStatus?.cloud?.userEmail ?? profileDisplayName;

  useEffect(() => {
    function openSearch() {
      setSearchOpen(true);
    }
    window.addEventListener("oa-focus-directory-search", openSearch);
    return () => window.removeEventListener("oa-focus-directory-search", openSearch);
  }, []);

  async function openUser(user: RailUser) {
    if (user.conversationId) {
      navigate(`/chats/${user.conversationId}`);
    } else if (!user.isLocalAgent) {
      const result = await createConversation.mutateAsync({
        title: user.displayName,
        peer_user_id: user.id.startsWith("agent:") ? null : user.id,
        peer_agent_instance_id: user.presence.activeAgentInstanceId ?? (user.id.startsWith("agent:") ? user.id.slice("agent:".length) : null),
        mode: "cloud_relay"
      });
      const conversationId = result?.conversation?.id;
      navigate(conversationId ? `/chats/${conversationId}` : "/chats");
    } else {
      navigate("/chats/local-agent");
    }
    setSearchOpen(false);
  }

  return (
    <aside className="oa-user-rail relative z-40 flex h-full w-16 shrink-0 flex-col items-center gap-1.5 border-r border-black/40 bg-[#000000] px-2 py-3 md:w-[72px]" aria-label="People and inbox rail">
      <RailIconButton
        label="Oracle Amigo"
        active={location.pathname === "/chats"}
        onClick={() => navigate("/chats")}
      >
        <span className="brand-mark flex h-12 w-12 items-center justify-center rounded-2xl bg-white/95 p-1.5">
          <img
            src={oracleLogoUrl}
            alt="Oracle"
            draggable={false}
            className="h-8 w-10 object-contain"
          />
        </span>
      </RailIconButton>

      <RailIconButton
        label="Inbox"
        detail={inboxBadge > 0 ? `${inboxBadge} item${inboxBadge === 1 ? "" : "s"} need attention` : "No pending inbox items"}
        active={location.pathname.startsWith("/inbox")}
        onClick={() => navigate("/inbox")}
        badge={inboxBadge}
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#2b2d31] text-oa-text-muted transition-all duration-150 group-hover:rounded-2xl group-hover:bg-oa-surface group-hover:text-oa-text">
          <Inbox className="h-5 w-5" />
        </span>
      </RailIconButton>

      <RailIconButton
        label="Search directory"
        detail="Find people and start chats"
        active={searchOpen}
        onClick={() => setSearchOpen((value) => !value)}
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#2b2d31] text-oa-text-muted transition-all duration-150 group-hover:rounded-2xl group-hover:bg-oa-surface group-hover:text-oa-text">
          <Search className="h-5 w-5" />
        </span>
      </RailIconButton>

      <RailSeparator />

      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto overflow-x-hidden pb-2">
        {users.map((user) => (
          <RailUserButton
            key={user.id}
            user={user}
            active={Boolean(user.conversationId && location.pathname.includes(user.conversationId))}
            onClick={() => void openUser(user)}
          />
        ))}
      </div>

      <div className="flex w-full shrink-0 flex-col items-center gap-2 pt-2">
        <RailSeparator />
        <RailProfileButton cloudStatus={cloudStatus} onOpenProfile={() => setProfileOpen(true)} />
      </div>

      {searchOpen && (
        <RailSearchPanel
          users={users}
          onClose={() => setSearchOpen(false)}
          onSelectUser={(user) => void openUser(user)}
        />
      )}

      <AccountProfileDialog
        avatarSeed={profileAvatarSeed}
        displayName={profileDisplayName}
        isOpen={profileOpen}
        onOpenChange={setProfileOpen}
      />
    </aside>
  );
}

function RailIconButton({
  active,
  badge = 0,
  children,
  detail,
  label,
  onClick
}: {
  active: boolean;
  badge?: number;
  children: ReactNode;
  detail?: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className="group relative flex min-h-[54px] w-full items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
          aria-label={label}
          aria-current={active ? "page" : undefined}
        >
          <span className={`absolute left-[-8px] w-1 rounded-r-full bg-white transition-all ${active ? "h-10" : "h-0 group-hover:h-5"}`} />
          <Badge.Anchor className="relative inline-flex">
            {children}
            {badge > 0 && (
              <Badge color="danger" size="sm" placement="top-right" className="oa-rail-count-badge">
                {badge > 99 ? "99+" : badge}
              </Badge>
            )}
          </Badge.Anchor>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10} className="oa-rail-tooltip">
        <RailLabelTooltip label={label} detail={detail} />
      </TooltipContent>
    </Tooltip>
  );
}

function RailUserButton({ active, onClick, user }: { active: boolean; onClick: () => void; user: RailUser }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className="group relative flex min-h-[54px] w-full items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
          aria-label={`Open chat with ${user.displayName}`}
          aria-current={active ? "true" : undefined}
        >
          <span className={`absolute left-[-8px] w-1 rounded-r-full bg-white transition-all ${active ? "h-10" : "h-0 group-hover:h-5"}`} />
          <StatusAvatar
            avatarSeed={user.avatarSeed}
            displayName={user.displayName}
            presence={user.presence}
            unread={user.unread}
            active={active}
            local={user.isLocalAgent}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10} className="oa-rail-tooltip oa-rail-tooltip-rich">
        <RailUserTooltip
          avatarSeed={user.avatarSeed}
          displayName={user.displayName}
          detail={user.email ?? user.presence.label}
          local={user.isLocalAgent}
          presence={user.presence}
        />
      </TooltipContent>
    </Tooltip>
  );
}

function RailProfileButton({
  cloudStatus,
  onOpenProfile
}: {
  cloudStatus: ReturnType<typeof useCloudStatus>["data"];
  onOpenProfile: () => void;
}) {
  const navigate = useNavigate();
  const logout = useLogout();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const displayName = cloudStatus?.cloud?.displayName ?? cloudStatus?.cloud?.userEmail ?? "Account";
  const avatarSeed = cloudStatus?.cloud?.userEmail ?? displayName;
  const presence: PeerPresence = {
    status: cloudStatus?.cloud?.status === "enrolled" ? "online" : "offline",
    reason: cloudStatus?.cloud?.status === "enrolled" ? "heartbeat_recent" : "not_enrolled",
    label: cloudStatus?.cloud?.status === "enrolled" ? "Online" : "Offline",
    activeAgentInstanceId: cloudStatus?.cloud?.agentInstanceId ?? undefined
  };
  const accountDetail = cloudStatus?.cloud?.userEmail ?? presence.label;

  async function handleLogout() {
    try {
      await logout.mutateAsync();
      navigate("/login", { replace: true });
    } catch {
      // The mutation owns user-facing error reporting.
    }
  }

  function handleAction(key: string) {
    if (key === "profile") {
      setPopoverOpen(false);
      window.setTimeout(onOpenProfile, 0);
      return;
    }
    if (key === "settings") {
      setPopoverOpen(false);
      navigate("/settings");
      return;
    }
    if (key === "logout" && !logout.isPending) {
      setPopoverOpen(false);
      void handleLogout();
    }
  }

  const LogoutIcon = logout.isPending ? LoaderCircle : LogOut;

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex w-full justify-center">
            <PopoverTrigger asChild>
              <button
                type="button"
                className="group relative flex min-h-[54px] w-full items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
                aria-label={`Account profile: ${displayName}`}
              >
                <StatusAvatar
                  avatarSeed={avatarSeed}
                  displayName={displayName}
                  presence={presence}
                />
              </button>
            </PopoverTrigger>
          </span>
        </TooltipTrigger>
        {!popoverOpen && (
          <TooltipContent side="right" sideOffset={10} className="oa-rail-tooltip oa-rail-tooltip-rich">
            <RailUserTooltip
              avatarSeed={avatarSeed}
              displayName={displayName}
              detail={cloudStatus?.cloud?.userEmail ?? presence.label}
              presence={presence}
            />
          </TooltipContent>
        )}
      </Tooltip>
      <PopoverContent
        side="right"
        align="end"
        sideOffset={12}
        className="oa-account-popover w-[15.5rem] max-w-[calc(100vw-92px)] rounded-xl border border-white/10 bg-[#171717] p-0 shadow-2xl"
        aria-label="Account actions"
      >
        <div className="oa-account-popover-header">
          <div className="oa-account-popover-avatar">
            <StatusAvatar
              avatarSeed={avatarSeed}
              displayName={displayName}
              presence={presence}
            />
          </div>
          <div className="min-w-0">
            <p className="oa-account-popover-name">{displayName}</p>
            <p className="oa-account-popover-detail">{accountDetail}</p>
          </div>
        </div>

        <div className="oa-account-popover-body">
          <button id="profile" type="button" className="oa-account-popover-item" onClick={() => handleAction("profile")}>
            <UserIcon className="h-4 w-4 shrink-0 text-oa-text-secondary" />
            <span>Profile</span>
          </button>
          <button id="settings" type="button" className="oa-account-popover-item" onClick={() => handleAction("settings")}>
            <Settings className="h-4 w-4 shrink-0 text-oa-text-secondary" />
            <span>Settings</span>
          </button>
        </div>

        <div className="oa-account-popover-footer">
          <button
            id="logout"
            type="button"
            className="oa-account-popover-signout"
            onClick={() => handleAction("logout")}
          disabled={logout.isPending}
        >
            <LogoutIcon className={`h-4 w-4 shrink-0 ${logout.isPending ? "animate-spin" : ""}`} />
            <span>Sign Out</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RailLabelTooltip({ detail, label }: { detail?: string; label: string }) {
  return (
    <div className="oa-rail-tooltip-label min-w-0">
      <p className="text-sm font-semibold text-oa-text">{label}</p>
      {detail && <p className="mt-0.5 max-w-48 truncate text-xs text-oa-text-muted">{detail}</p>}
    </div>
  );
}

function RailUserTooltip({
  avatarSeed,
  detail,
  displayName,
  local,
  presence
}: {
  avatarSeed: string;
  detail?: string | null;
  displayName: string;
  local?: boolean;
  presence: PeerPresence;
}) {
  return (
    <div className="oa-rail-tooltip-user flex min-w-0 items-center gap-3">
      <StatusAvatar
        avatarSeed={avatarSeed}
        displayName={displayName}
        local={local}
        presence={presence}
      />
      <span className="min-w-0">
        <span className="block max-w-44 truncate text-sm font-semibold text-oa-text">{displayName}</span>
        {detail && <span className="block max-w-44 truncate text-xs text-oa-text-muted">{detail}</span>}
      </span>
    </div>
  );
}

function StatusAvatar({
  active,
  avatarSeed,
  displayName,
  local,
  presence,
  unread
}: {
  active?: boolean;
  avatarSeed: string;
  displayName: string;
  local?: boolean;
  presence: PeerPresence;
  unread?: number;
}) {
  const initials = initialsFor(displayName);
  return (
    <Badge.Anchor className="oa-rail-avatar-anchor relative inline-flex h-10 w-10 overflow-visible">
      <OracleAvatar
        seed={avatarSeed}
        initials={local ? "MY" : initials}
        size="md"
        className={`oa-rail-avatar h-10 w-10 rounded-full ring-2 ring-transparent transition-all duration-150 ${active ? "ring-white/25" : ""}`}
      />
      {Boolean(unread) && (
        <Badge color="danger" size="sm" placement="top-right" className="oa-rail-count-badge">
          {(unread ?? 0) > 99 ? "99+" : unread}
        </Badge>
      )}
      <Badge
        color={badgeColorForPresence(presence)}
        size="md"
        placement="bottom-right"
        className={`oa-rail-presence-badge ${presence.status === "online" ? "oa-rail-presence-online" : "oa-rail-presence-offline"}`}
      />
    </Badge.Anchor>
  );
}

function RailSearchPanel({
  onClose,
  onSelectUser,
  users
}: {
  onClose: () => void;
  onSelectUser: (user: RailUser) => void;
  users: RailUser[];
}) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const { data: directoryData, error: directoryError, isError: directoryIsError, isFetching: directoryIsFetching } = useDirectorySearch(query);
  const createConversation = useStartConversation();
  const normalizedQuery = query.trim().toLowerCase();
  const knownPeople = users.filter((user) => !user.isLocalAgent);
  const existingMatches = normalizedQuery
    ? knownPeople.filter((user) =>
        `${user.displayName} ${user.email ?? ""}`.toLowerCase().includes(normalizedQuery)
      )
    : knownPeople;
  const existingUserIds = new Set(existingMatches.map((user) => user.id));
  const directoryUsers = (directoryData?.users ?? []).filter((user) => !existingUserIds.has(user.user_id));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function startDirectoryConversation(user: DirectoryUser) {
    const agent = bestDirectoryAgent(user.agents ?? []);
    const result = await createConversation.mutateAsync({
      title: user.display_name,
      peer_user_id: user.user_id,
      peer_agent_instance_id: agent?.agent_instance_id ?? null,
      mode: "cloud_relay"
    });
    const conversationId = result?.conversation?.id;
    if (conversationId) navigate(`/chats/${conversationId}`);
    onClose();
  }

  return (
    <div className="glass-panel-strong absolute left-full top-16 z-50 ml-3 w-[320px] rounded-xl p-3 shadow-2xl" role="dialog" aria-label="Search chats and directory">
      <div className="flex items-center gap-2 rounded-full bg-[#1e1f22] px-3 py-2 ring-1 ring-white/10">
        <Search className="h-4 w-4 text-oa-text-muted" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search chats or directory"
          className="min-w-0 flex-1 bg-transparent text-sm text-oa-text placeholder:text-oa-text-disabled focus:outline-none"
        />
        <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-full text-oa-text-muted hover:bg-white/10 hover:text-oa-text" aria-label="Close search">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 max-h-[420px] overflow-y-auto">
        {existingMatches.length > 0 && (
          <SearchGroup label={normalizedQuery ? "Chats and contacts" : "People"}>
            {existingMatches.map((user) => (
              <SearchUserRow key={user.id} label={user.displayName} presence={user.presence} seed={user.avatarSeed} onClick={() => onSelectUser(user)} />
            ))}
          </SearchGroup>
        )}
        {normalizedQuery && (
          <SearchGroup label="Directory">
            {directoryIsFetching ? (
              <p className="px-3 py-3 text-center text-xs text-oa-text-muted">Searching directory...</p>
            ) : directoryIsError ? (
              <p className="px-3 py-3 text-center text-xs text-oa-red">
                Directory unavailable: {directoryError instanceof Error ? directoryError.message : "try again after refreshing the local session."}
              </p>
            ) : directoryUsers.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-oa-text-muted">
                {existingMatches.length > 0 ? "No additional directory people found" : "No people found"}
              </p>
            ) : (
              directoryUsers.map((user) => (
                <SearchUserRow
                  key={user.user_id}
                  label={safePersonName(user.display_name, user.email)}
                  detail={user.email}
                  presence={{ status: user.presence === "online" ? "online" : "offline", reason: user.presence === "online" ? "heartbeat_recent" : "no_active_agent", label: user.presence === "online" ? "Online" : "Offline" }}
                  seed={user.email}
                  onClick={() => void startDirectoryConversation(user)}
                />
              ))
            )}
          </SearchGroup>
        )}
        {!normalizedQuery && existingMatches.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-oa-text-muted">
            Type a name or email to find people. Accepted contacts and existing chats will appear here when available.
          </p>
        )}
      </div>
    </div>
  );
}

function bestDirectoryAgent(agents: AgentInstance[]): AgentInstance | null {
  return agents.find((agent) => agent.status === "online") ?? agents.find((agent) => agent.status === "stale") ?? agents[0] ?? null;
}

function SearchGroup({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="mb-3">
      <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-oa-text-disabled">{label}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function SearchUserRow({
  detail,
  label,
  onClick,
  presence,
  seed
}: {
  detail?: string;
  label: string;
  onClick: () => void;
  presence: PeerPresence;
  seed: string;
}) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-[48px] w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue">
      <StatusAvatar avatarSeed={seed} displayName={label} presence={presence} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-oa-text">{label}</span>
        <span className="block truncate text-xs text-oa-text-muted">{detail ?? presence.label}</span>
      </span>
    </button>
  );
}

function RailSeparator() {
  return <div className="my-1 h-px w-8 rounded-full bg-white/10" />;
}

function badgeColorForPresence(presence: PeerPresence): "success" | "danger" {
  if (presence.status === "online") return "success";
  return "danger";
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (parts[0] ?? "U").slice(0, 2).toUpperCase();
}
