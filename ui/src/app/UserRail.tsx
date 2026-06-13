import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Badge } from "@heroui/react";
import { Inbox, Search, Settings, X } from "lucide-react";
import oracleLogoUrl from "../../../UI_images/oracle_logo.png";
import { OracleAvatar } from "../components/primitives/OracleAvatar";
import { useCloudStatus, useContacts, useConversations, useDirectorySearch, usePendingApprovals, useStartConversation } from "../hooks/queries";
import { buildRailUsers, safePersonName, type RailUser } from "./userRailModel";
import type { DirectoryUser, PeerPresence } from "../types";

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
        peer_user_id: user.id,
        mode: "cloud_relay"
      });
      const conversationId = result?.conversation?.id;
      navigate(conversationId ? `/chats/${conversationId}` : "/chats");
    } else {
      navigate("/chats");
    }
    setSearchOpen(false);
  }

  return (
    <aside className="discord-user-rail relative z-40 flex h-full w-16 shrink-0 flex-col items-center gap-1.5 border-r border-black/40 bg-[#111214] px-2 py-3 md:w-[72px]" aria-label="People and inbox rail">
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
        <RailIconButton
          label="Settings"
          active={location.pathname.startsWith("/settings")}
          onClick={() => navigate("/settings")}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#2b2d31] text-oa-text-muted transition-all duration-150 group-hover:rounded-2xl group-hover:bg-oa-surface group-hover:text-oa-text">
            <Settings className="h-5 w-5" />
          </span>
        </RailIconButton>
        <RailProfileButton cloudStatus={cloudStatus} onClick={() => navigate("/settings")} />
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

function RailProfileButton({ cloudStatus, onClick }: { cloudStatus: ReturnType<typeof useCloudStatus>["data"]; onClick: () => void }) {
  const displayName = cloudStatus?.cloud?.displayName ?? cloudStatus?.cloud?.userEmail ?? "Account";
  const presence: PeerPresence = {
    status: cloudStatus?.cloud?.status === "enrolled" ? "online" : "offline",
    reason: cloudStatus?.cloud?.status === "enrolled" ? "heartbeat_recent" : "not_enrolled",
    label: cloudStatus?.cloud?.status === "enrolled" ? "Online" : "Offline",
    activeAgentInstanceId: cloudStatus?.cloud?.agentInstanceId ?? undefined
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex min-h-[54px] w-full items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
      aria-label={`Account profile: ${displayName}`}
      title={`${displayName} - ${presence.label}`}
    >
      <StatusAvatar
        avatarSeed={cloudStatus?.cloud?.userEmail ?? displayName}
        displayName={displayName}
        presence={presence}
      />
    </button>
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
    const result = await createConversation.mutateAsync({
      title: user.display_name,
      peer_user_id: user.user_id,
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
