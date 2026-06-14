import { useEffect, useMemo, useRef, useState, type Key, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Badge, Button, Drawer, Dropdown } from "@heroui/react";
import { Inbox, LoaderCircle, LogOut, Search, Settings, User as UserIcon, X } from "lucide-react";
import oracleLogoUrl from "../../../UI_images/oracle_logo.png";
import { OracleAvatar } from "../components/primitives/OracleAvatar";
import { useCloudStatus, useContacts, useConversations, useDirectorySearch, useLogout, usePendingApprovals, useStartConversation } from "../hooks/queries";
import { buildRailUsers, safePersonName, type RailUser } from "./userRailModel";
import type { AgentInstance, DirectoryUser, PeerPresence } from "../types";
import { ProfileDetails } from "../features/inspector/ProfileDetails";

export function UserRail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: conversationsData } = useConversations();
  const { data: cloudStatus } = useCloudStatus();
  const { data: contactsData } = useContacts(cloudStatus?.cloud?.status === "enrolled");
  const { data: directorySnapshot } = useDirectorySearch("", cloudStatus?.cloud?.status === "enrolled");
  const { approvalCards } = usePendingApprovals();
  const createConversation = useStartConversation();
  const [searchOpen, setSearchOpen] = useState(false);
  const conversations = conversationsData?.conversations ?? [];
  const users = useMemo(
    () => buildRailUsers(conversations, cloudStatus, contactsData?.contacts ?? [], directorySnapshot?.users ?? []),
    [cloudStatus, contactsData, conversations, directorySnapshot]
  );
  const unread = conversations.reduce((sum, conversation) => sum + (conversation.unread ?? 0), 0);
  const pendingApprovals = approvalCards.filter((card) => card.status === "pending").length;
  const inboxBadge = unread + pendingApprovals;

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
    <aside className="oa-user-rail relative z-40 flex h-full w-16 shrink-0 flex-col items-center gap-1.5 border-r border-black/40 bg-[#111214] px-2 py-3 md:w-[72px]" aria-label="People and inbox rail">
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
        <RailProfileButton cloudStatus={cloudStatus} />
      </div>

      {searchOpen && (
        <RailSearchPanel
          users={users}
          onClose={() => setSearchOpen(false)}
          onSelectUser={(user) => void openUser(user)}
        />
      )}
    </aside>
  );
}

function RailIconButton({
  active,
  badge = 0,
  children,
  label,
  onClick
}: {
  active: boolean;
  badge?: number;
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex min-h-[54px] w-full items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
      aria-label={label}
      aria-current={active ? "page" : undefined}
      title={label}
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
  );
}

function RailUserButton({ active, onClick, user }: { active: boolean; onClick: () => void; user: RailUser }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex min-h-[54px] w-full items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
      aria-label={`Open chat with ${user.displayName}`}
      aria-current={active ? "true" : undefined}
      title={`${user.displayName} - ${user.presence.label}`}
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
  );
}

function RailProfileButton({ cloudStatus }: { cloudStatus: ReturnType<typeof useCloudStatus>["data"] }) {
  const navigate = useNavigate();
  const logout = useLogout();
  const [profileOpen, setProfileOpen] = useState(false);
  const displayName = cloudStatus?.cloud?.displayName ?? cloudStatus?.cloud?.userEmail ?? "Account";
  const avatarSeed = cloudStatus?.cloud?.userEmail ?? displayName;
  const presence: PeerPresence = {
    status: cloudStatus?.cloud?.status === "enrolled" ? "online" : "offline",
    reason: cloudStatus?.cloud?.status === "enrolled" ? "heartbeat_recent" : "not_enrolled",
    label: cloudStatus?.cloud?.status === "enrolled" ? "Online" : "Offline",
    activeAgentInstanceId: cloudStatus?.cloud?.agentInstanceId ?? undefined
  };

  async function handleLogout() {
    try {
      await logout.mutateAsync();
      navigate("/login", { replace: true });
    } catch {
      // The mutation owns user-facing error reporting.
    }
  }

  function handleAction(key: Key) {
    if (key === "profile") {
      setProfileOpen(true);
      return;
    }
    if (key === "settings") {
      navigate("/settings");
      return;
    }
    if (key === "logout" && !logout.isPending) {
      void handleLogout();
    }
  }

  const LogoutIcon = logout.isPending ? LoaderCircle : LogOut;

  return (
    <>
      <Dropdown>
        <Button
          className="group relative flex min-h-[54px] w-full items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
          aria-label={`Account profile: ${displayName}`}
          variant="ghost"
        >
          <StatusAvatar
            avatarSeed={avatarSeed}
            displayName={displayName}
            presence={presence}
          />
        </Button>
        <Dropdown.Popover className="oa-account-dropdown min-w-44 rounded-xl border border-white/10 bg-[#2F2F2F] p-1.5 shadow-2xl">
          <Dropdown.Menu aria-label="Account actions" className="oa-account-dropdown-menu" onAction={handleAction}>
            <Dropdown.Item id="profile" textValue="Profile" className="oa-account-dropdown-item">
              <UserIcon className="h-4 w-4 shrink-0 text-oa-text-muted" />
              <span>Profile</span>
            </Dropdown.Item>
            <Dropdown.Item id="settings" textValue="Settings" className="oa-account-dropdown-item">
              <Settings className="h-4 w-4 shrink-0 text-oa-text-muted" />
              <span>Settings</span>
            </Dropdown.Item>
            <Dropdown.Item id="logout" textValue="Log out" variant="danger" className="oa-account-dropdown-item oa-account-dropdown-item-danger">
              <LogoutIcon className={`h-4 w-4 shrink-0 text-oa-red ${logout.isPending ? "animate-spin" : ""}`} />
              <span>Log out</span>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      <AccountProfileDrawer
        avatarSeed={avatarSeed}
        displayName={displayName}
        isOpen={profileOpen}
        onOpenChange={setProfileOpen}
      />
    </>
  );
}

function AccountProfileDrawer({
  avatarSeed,
  displayName,
  isOpen,
  onOpenChange
}: {
  avatarSeed: string;
  displayName: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}) {
  return (
    <Drawer>
      <Drawer.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
        <Drawer.Content
          placement="right"
          className="oa-profile-drawer w-[360px] max-w-[calc(100vw-1.5rem)] border-l border-oa-border bg-[#1e1f22] text-oa-text shadow-2xl"
        >
          <Drawer.Dialog aria-label="Account profile drawer" className="flex h-full flex-col">
            <Drawer.Header className="flex items-center justify-between border-b border-oa-border px-4 py-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-oa-text-muted">Account</p>
                <h2 className="text-lg font-semibold text-oa-text">Profile</h2>
              </div>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                onPress={() => onOpenChange(false)}
                aria-label="Close profile drawer"
                className="text-oa-text-muted"
              >
                <X className="h-4 w-4" />
              </Button>
            </Drawer.Header>
            <Drawer.Body className="min-h-0 flex-1 overflow-y-auto p-0">
              <ProfileDetails
                className="p-4"
                header={
                  <div className="mb-2 flex items-center gap-3 rounded-xl bg-oa-surface px-3 py-3">
                    <OracleAvatar
                      seed={avatarSeed}
                      initials={initialsFor(displayName)}
                      size="md"
                      className="h-10 w-10 rounded-full"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-oa-text">{displayName}</p>
                      <p className="text-xs text-oa-text-muted">Oracle Amigo account</p>
                    </div>
                  </div>
                }
              />
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
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
  const { data: directoryData } = useDirectorySearch(query);
  const createConversation = useStartConversation();
  const existingMatches = users.filter((user) =>
    !user.isLocalAgent && user.displayName.toLowerCase().includes(query.trim().toLowerCase())
  );
  const directoryUsers = directoryData?.users ?? [];

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
        {query.trim() && existingMatches.length > 0 && (
          <SearchGroup label="Chats">
            {existingMatches.map((user) => (
              <SearchUserRow key={user.id} label={user.displayName} presence={user.presence} seed={user.avatarSeed} onClick={() => onSelectUser(user)} />
            ))}
          </SearchGroup>
        )}
        {query.trim() && (
          <SearchGroup label="Directory">
            {directoryUsers.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-oa-text-muted">No people found</p>
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
        {!query.trim() && (
          <p className="px-3 py-6 text-center text-xs text-oa-text-muted">
            Type a name or email to find people. Agent instances stay in diagnostics, not in the people rail.
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
