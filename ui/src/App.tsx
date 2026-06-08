import { useEffect, useReducer, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Archive,
  Bell,
  Check,
  ChevronLeft,
  Clock,
  Command,
  FileCheck,
  FileText,
  FolderOpen,
  Hash,
  Inbox,
  KeyRound,
  Loader2,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
  X
} from "lucide-react";
import { z } from "zod";
import { api } from "./api/client";
import {
  useAgentDiagnostics,
  useAuditEvents,
  useCloudStatus,
  useContacts,
  useDirectorySearch,
  usePendingApprovals,
  useReceivedFiles,
  useRealtimePolling
} from "./hooks/queries";
import type {
  AgentInstance,
  AuditEvent,
  CloudStatus,
  Conversation,
  DirectoryUser,
  FileCandidateApprovalCard,
  StoredFile,
  TimelineMessage
} from "./types";

const authSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  displayName: z.string().trim().optional(),
  orgSlug: z.string().trim().optional(),
  controlPlaneUrl: z.string().url("Enter a valid control-plane URL.")
});

type AuthMode = "login" | "signup";
type RightPanelTab = "agent" | "approvals" | "files" | "audit" | "settings";

interface ChatState {
  conversations: Conversation[];
  selectedConversationId: string | null;
  outbox: TimelineMessage[];
}

type ChatAction =
  | { type: "upsertConversation"; conversation: Conversation }
  | { type: "select"; id: string }
  | { type: "appendMessage"; conversationId: string; message: TimelineMessage }
  | { type: "updateMessage"; conversationId: string; messageId: string; patch: Partial<TimelineMessage> }
  | { type: "queue"; message: TimelineMessage }
  | { type: "clearQueued"; id: string };

const initialChatState: ChatState = {
  conversations: [localConversation()],
  selectedConversationId: "local-agent",
  outbox: []
};

export function App() {
  const queryClient = useQueryClient();
  useRealtimePolling();
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [rightPanel, setRightPanel] = useState<RightPanelTab>("agent");
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [mobilePane, setMobilePane] = useState<"sidebar" | "chat" | "details">("chat");
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [authError, setAuthError] = useState<string | null>(null);

  const cloudStatus = useCloudStatus();
  const diagnostics = useAgentDiagnostics();
  const status = cloudStatus.data;
  const hasCloudUser = Boolean(status?.cloud.hasUserAccessToken);
  const health = { data: diagnostics.data?.health };
  const inboxStatus = { data: diagnostics.data?.relayInbox };
  const contacts = useContacts(hasCloudUser);
  const directory = useDirectorySearch(directoryQuery);
  const approvals = usePendingApprovals();
  const files = useReceivedFiles();
  const audit = useAuditEvents();

  const loginMutation = useMutation({
    mutationFn: (input: AuthFormValues) => api.login({
      email: input.email,
      password: input.password,
      org_slug: input.orgSlug || undefined,
      control_plane_url: input.controlPlaneUrl
    }),
    onSuccess: async () => {
      setAuthError(null);
      await queryClient.invalidateQueries({ queryKey: ["cloud-status"] });
    },
    onError: (err) => setAuthError(err instanceof Error ? err.message : "Login failed.")
  });

  const signupMutation = useMutation({
    mutationFn: (input: AuthFormValues) => api.signup({
      email: input.email,
      password: input.password,
      display_name: input.displayName || input.email,
      org_slug: input.orgSlug || undefined,
      control_plane_url: input.controlPlaneUrl
    }),
    onSuccess: async () => {
      setAuthError(null);
      await queryClient.invalidateQueries({ queryKey: ["cloud-status"] });
    },
    onError: (err) => setAuthError(err instanceof Error ? err.message : "Signup failed.")
  });

  const enrollMutation = useMutation({
    mutationFn: (input: { deviceName: string; agentName: string }) => api.enroll({
      device_name: input.deviceName,
      agent_display_name: input.agentName,
      capabilities: ["a2a.v1", "file.request", "file.transfer", "human.approval"]
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["cloud-status"] });
      await queryClient.invalidateQueries({ queryKey: ["relay-inbox-status"] });
    }
  });

  const logoutMutation = useMutation({
    mutationFn: api.logout,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    }
  });

  const selectedConversation = state.conversations.find((item) => item.id === state.selectedConversationId) ?? state.conversations[0];
  const pendingApprovalCards = approvals.approvalCards;

  useEffect(() => {
    for (const card of pendingApprovalCards) {
      dispatch({
        type: "appendMessage",
        conversationId: "local-agent",
        message: {
          kind: "approval",
          id: `approval-${card.approval_id}`,
          created_at: card.expires_at,
          card
        }
      });
    }
  }, [pendingApprovalCards]);

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowCommandPalette(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (cloudStatus.isLoading) {
    return <LoadingScreen />;
  }

  if (!status?.cloud.hasUserAccessToken) {
    return (
      <AuthScreen
        mode={authMode}
        setMode={setAuthMode}
        error={authError}
        loading={loginMutation.isPending || signupMutation.isPending}
        defaultControlPlaneUrl={status?.cloud.controlPlaneUrl ?? "http://127.0.0.1:8080"}
        defaultOrgSlug={status?.defaults?.orgSlug ?? "local-dev"}
        localAgentUrl={status?.defaults?.localAgentUrl ?? window.location.origin}
        onSubmit={(values) => authMode === "login" ? loginMutation.mutate(values) : signupMutation.mutate(values)}
      />
    );
  }

  if (status.cloud.status !== "enrolled") {
    return (
      <DeviceEnrollmentScreen
        status={status}
        loading={enrollMutation.isPending}
        error={enrollMutation.error instanceof Error ? enrollMutation.error.message : null}
        onEnroll={(values) => enrollMutation.mutate(values)}
      />
    );
  }

  return (
    <main className="app-shell" aria-label="Oracle Amigo agentic chat application">
      <TopBar
        status={status}
        healthOk={health.data?.status === "ok"}
        inboxStatus={inboxStatus.data}
        onCommand={() => setShowCommandPalette(true)}
        onLogout={() => logoutMutation.mutate()}
      />
      <div className="mobile-switcher" aria-label="Layout sections">
        <button type="button" className={mobilePane === "sidebar" ? "active" : ""} onClick={() => setMobilePane("sidebar")}>People</button>
        <button type="button" className={mobilePane === "chat" ? "active" : ""} onClick={() => setMobilePane("chat")}>Chat</button>
        <button type="button" className={mobilePane === "details" ? "active" : ""} onClick={() => setMobilePane("details")}>Details</button>
      </div>
      <section className="workspace" aria-label="Messaging workspace">
        <aside className={`sidebar ${mobilePane === "sidebar" ? "mobile-visible" : ""}`} aria-label="Contacts and conversations">
          <WorkspaceHeader status={status} />
          <DirectorySearch
            query={directoryQuery}
            setQuery={setDirectoryQuery}
            users={directory.data?.users ?? []}
            loading={directory.isFetching}
            onStartChat={async (user) => {
              const agents = await api.userAgents(user.user_id);
              const agent = agents.agents[0] ?? null;
              const created = await api.createConversation({
                peer_user_id: user.user_id,
                peer_agent_instance_id: agent?.agent_instance_id ?? null,
                title: user.display_name || user.email,
                mode: agent ? "cloud_relay" : "local"
              }).catch(() => null);
              const conversation = created?.conversation ?? conversationFromUser(user, agent);
              dispatch({ type: "upsertConversation", conversation });
              dispatch({ type: "select", id: conversation.id });
              setMobilePane("chat");
            }}
            onRequestContact={(user) => api.requestContact(user.user_id).then(() => queryClient.invalidateQueries({ queryKey: ["contacts"] }))}
          />
          <ConversationList
            conversations={state.conversations}
            selectedId={selectedConversation.id}
            onSelect={(id) => {
              dispatch({ type: "select", id });
              setMobilePane("chat");
            }}
            contacts={contacts.data?.contacts ?? []}
          />
        </aside>
        <ChatWindow
          className={mobilePane === "chat" ? "mobile-visible" : ""}
          conversation={selectedConversation}
          cloudStatus={status}
          online={health.data?.status === "ok" && !cloudStatus.error}
          queuedCount={state.outbox.length}
          onBack={() => setMobilePane("sidebar")}
          onOpenDetails={() => setMobilePane("details")}
          onSend={async (text) => {
            const optimistic = humanMessage(selectedConversation.id, text, status, selectedConversation.agentInstanceId);
            dispatch({ type: "appendMessage", conversationId: selectedConversation.id, message: optimistic });
            const looksLikeFileRequest = isFileRequest(text);
            const idempotencyKey = `ui-${optimistic.id}`;
            try {
              const result = await api.sendChatMessage(selectedConversation.id, {
                text,
                send_as: looksLikeFileRequest ? "file_request" : "normal",
                idempotency_key: idempotencyKey,
                client_message_id: optimistic.id
              });
              dispatch({ type: "updateMessage", conversationId: selectedConversation.id, messageId: optimistic.id, patch: { delivery_status: result.delivery_status } as Partial<TimelineMessage> });
              dispatch({
                type: "appendMessage",
                conversationId: selectedConversation.id,
                message: agentStatusMessage(result.task_id ?? result.relay_task_id ?? "chat", looksLikeFileRequest ? "Waiting for approval..." : "Message delivered", looksLikeFileRequest ? "input_required" : "sent")
              });
            } catch (err) {
              dispatch({ type: "updateMessage", conversationId: selectedConversation.id, messageId: optimistic.id, patch: { delivery_status: "failed" } as Partial<TimelineMessage> });
              dispatch({ type: "queue", message: optimistic });
              dispatch({
                type: "appendMessage",
                conversationId: selectedConversation.id,
                message: systemMessage("Relay unavailable. Message is waiting for connection.", "warning", err instanceof Error ? err.message : undefined)
              });
            }
          }}
        />
        <RightPanel
          className={mobilePane === "details" ? "mobile-visible" : ""}
          active={rightPanel}
          setActive={setRightPanel}
          conversation={selectedConversation}
          approvals={pendingApprovalCards}
          files={files.data?.files ?? []}
          audit={audit.data?.events ?? []}
          status={status}
          onClose={() => setMobilePane("chat")}
          onApprove={async (id) => {
            await api.approve(id);
            await queryClient.invalidateQueries({ queryKey: ["approvals"] });
            await queryClient.invalidateQueries({ queryKey: ["stored-files"] });
          }}
          onReject={async (id) => {
            await api.reject(id);
            await queryClient.invalidateQueries({ queryKey: ["approvals"] });
          }}
          onFeedback={async (id, feedback) => {
            await api.feedback(id, feedback);
            await queryClient.invalidateQueries({ queryKey: ["approvals"] });
          }}
        />
      </section>
      {showCommandPalette && (
        <CommandPalette
          conversations={state.conversations}
          files={files.data?.files ?? []}
          onClose={() => setShowCommandPalette(false)}
          onSelectConversation={(id) => {
            dispatch({ type: "select", id });
            setShowCommandPalette(false);
          }}
          setRightPanel={(panel) => {
            setRightPanel(panel);
            setMobilePane("details");
            setShowCommandPalette(false);
          }}
        />
      )}
    </main>
  );
}

interface AuthFormValues {
  email: string;
  password: string;
  displayName: string;
  orgSlug: string;
  controlPlaneUrl: string;
}

function AuthScreen(props: {
  mode: AuthMode;
  setMode: (mode: AuthMode) => void;
  defaultControlPlaneUrl: string;
  defaultOrgSlug: string;
  localAgentUrl: string;
  loading: boolean;
  error: string | null;
  onSubmit: (values: AuthFormValues) => void;
}) {
  const [values, setValues] = useState<AuthFormValues>({
    email: "",
    password: "",
    displayName: "",
    orgSlug: props.defaultOrgSlug,
    controlPlaneUrl: props.defaultControlPlaneUrl
  });
  const [fieldError, setFieldError] = useState<string | null>(null);

  return (
    <main className="auth-screen">
      <section className="auth-panel" aria-labelledby="auth-title">
        <div>
          <p className="eyebrow">Oracle Amigo</p>
          <h1 id="auth-title">Agentic Chat</h1>
          <p className="muted">Sign in to connect your local personal agent with your workspace relay.</p>
          <div className="auth-runtime" aria-label="Connection status">
            <span>Agent {props.localAgentUrl}</span>
            <span>Control plane {values.controlPlaneUrl}</span>
          </div>
        </div>
        <div className="segmented" role="tablist" aria-label="Authentication mode">
          <button type="button" className={props.mode === "login" ? "active" : ""} onClick={() => props.setMode("login")}>Login</button>
          <button type="button" className={props.mode === "signup" ? "active" : ""} onClick={() => props.setMode("signup")}>Signup</button>
        </div>
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = authSchema.safeParse(values);
            if (!parsed.success) {
              setFieldError(parsed.error.issues[0]?.message ?? "Check the form values.");
              return;
            }
            setFieldError(null);
            props.onSubmit(values);
          }}
        >
          <label>Email<input value={values.email} onChange={(event) => setValues({ ...values, email: event.target.value })} autoComplete="email" /></label>
          {props.mode === "signup" && (
            <label>Display name<input value={values.displayName} onChange={(event) => setValues({ ...values, displayName: event.target.value })} autoComplete="name" /></label>
          )}
          <label>Password<input value={values.password} onChange={(event) => setValues({ ...values, password: event.target.value })} type="password" autoComplete={props.mode === "login" ? "current-password" : "new-password"} /></label>
          <label>Org slug<input value={values.orgSlug} onChange={(event) => setValues({ ...values, orgSlug: event.target.value })} placeholder={props.defaultOrgSlug} /></label>
          <label className="span-2">Control-plane URL<input value={values.controlPlaneUrl} onChange={(event) => setValues({ ...values, controlPlaneUrl: event.target.value })} /></label>
          {(fieldError || props.error) && <div className="error-banner" role="alert">{fieldError ?? props.error}</div>}
          <button type="submit" className="primary-action" disabled={props.loading}>
            {props.loading ? <Loader2 className="spin" /> : <KeyRound />}
            {props.mode === "login" ? "Login" : "Create account"}
          </button>
        </form>
      </section>
    </main>
  );
}

function DeviceEnrollmentScreen(props: {
  status: CloudStatus;
  loading: boolean;
  error: string | null;
  onEnroll: (values: { deviceName: string; agentName: string }) => void;
}) {
  const defaultDevice = navigator.platform || "Local device";
  const [deviceName, setDeviceName] = useState(defaultDevice);
  const [agentName, setAgentName] = useState(`${props.status.cloud.displayName ?? "My"}'s agent`);
  const fingerprint = shortId(props.status.cloud.userId ?? props.status.cloud.profileId);
  return (
    <main className="auth-screen">
      <section className="auth-panel enrollment" aria-labelledby="enroll-title">
        <p className="eyebrow">Device enrollment</p>
        <h1 id="enroll-title">Register this local agent</h1>
        <div className="identity-grid">
          <StatusTile label="Local device" value={deviceName} icon={<ShieldCheck />} />
          <StatusTile label="Device identity" value={fingerprint} icon={<Hash />} />
          <StatusTile label="Control plane" value={props.status.cloud.controlPlaneUrl} icon={<Wifi />} />
          <StatusTile label="Heartbeat" value={props.status.heartbeat.running ? "running" : "starts after enrollment"} icon={<Clock />} />
        </div>
        <div className="form-grid">
          <label>Device name<input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} /></label>
          <label>Agent display name<input value={agentName} onChange={(event) => setAgentName(event.target.value)} /></label>
        </div>
        <div className="capability-list" aria-label="Agent capabilities">
          {["A2A v1", "Relay polling", "File request workflow", "Human approval", "Hash verification"].map((item) => <span key={item}>{item}</span>)}
        </div>
        {props.error && <div className="error-banner" role="alert">{props.error}</div>}
        <button type="button" className="primary-action" disabled={props.loading} onClick={() => props.onEnroll({ deviceName, agentName })}>
          {props.loading ? <Loader2 className="spin" /> : <Check />}
          Enroll device and start agent
        </button>
      </section>
    </main>
  );
}

function TopBar(props: {
  status: CloudStatus;
  healthOk: boolean;
  inboxStatus?: { running: boolean; lastItemCount: number; lastError: string | null };
  onCommand: () => void;
  onLogout: () => void;
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <MessageSquare />
        <div>
          <strong>Oracle Amigo</strong>
          <span>{props.status.cloud.userEmail}</span>
        </div>
      </div>
      <div className="topbar-status" aria-label="Connection status">
        <StatusPill ok={props.healthOk} text={props.healthOk ? "Local agent online" : "Local agent offline"} />
        <StatusPill ok={props.status.heartbeat.running} text={props.status.heartbeat.running ? "Heartbeat active" : "Heartbeat idle"} />
        <StatusPill ok={props.inboxStatus?.running ?? false} text={`Relay ${props.status.relayMode}`} />
      </div>
      <div className="topbar-actions">
        <button type="button" className="icon-button" onClick={props.onCommand} title="Command palette"><Command /></button>
        <button type="button" className="icon-button" onClick={props.onLogout} title="Logout"><LogOut /></button>
      </div>
    </header>
  );
}

function WorkspaceHeader({ status }: { status: CloudStatus }) {
  return (
    <section className="workspace-header">
      <div className="avatar">{initials(status.cloud.displayName ?? status.cloud.userEmail ?? "OA")}</div>
      <div>
        <strong>{status.cloud.displayName ?? "Local user"}</strong>
        <span>{shortId(status.cloud.agentInstanceId ?? status.cloud.agentId ?? "not-enrolled")}</span>
      </div>
    </section>
  );
}

function DirectorySearch(props: {
  query: string;
  setQuery: (value: string) => void;
  users: DirectoryUser[];
  loading: boolean;
  onStartChat: (user: DirectoryUser) => void;
  onRequestContact: (user: DirectoryUser) => void;
}) {
  return (
    <section className="directory-search" aria-labelledby="directory-title">
      <h2 id="directory-title"><Search /> Directory</h2>
      <div className="search-box">
        <Search />
        <input value={props.query} onChange={(event) => props.setQuery(event.target.value)} placeholder="Search people by name or email" />
      </div>
      <div className="directory-results" aria-live="polite">
        {props.loading && <div className="muted-row"><Loader2 className="spin" /> Searching...</div>}
        {!props.loading && props.query && props.users.length === 0 && <div className="muted-row">No registered people found.</div>}
        {props.users.map((user) => (
          <article key={user.user_id} className="person-row">
            <div className="avatar small">{initials(user.display_name || user.email)}</div>
            <div className="person-main">
              <strong>{user.display_name}</strong>
              <span>{user.email}</span>
              <div className="badge-line">
                <span className="privacy-badge"><ShieldCheck /> Personal Agent available</span>
                <span className="privacy-badge">{user.active_agent_instances} active</span>
              </div>
            </div>
            <div className="person-actions">
              <button type="button" className="icon-button" onClick={() => props.onRequestContact(user)} title="Request contact"><UserPlus /></button>
              <button type="button" className="secondary-action compact" onClick={() => props.onStartChat(user)}>Start</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ConversationList(props: {
  conversations: Conversation[];
  selectedId: string;
  contacts: Array<{ id: string; status: string }>;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="conversation-list" aria-labelledby="conversations-title">
      <h2 id="conversations-title"><Users /> Conversations</h2>
      {props.conversations.map((conversation) => (
        <button
          key={conversation.id}
          type="button"
          className={`conversation-row ${props.selectedId === conversation.id ? "active" : ""}`}
          onClick={() => props.onSelect(conversation.id)}
        >
          <div className="avatar small">{initials(conversation.title)}</div>
          <div className="conversation-main">
            <div className="conversation-title">
              <strong>{conversation.title}</strong>
              <PresenceDot state={conversation.presence} />
            </div>
            <span>{conversation.lastMessage}</span>
            <div className="badge-line">
              {conversation.pendingApprovals > 0 && <span className="mini-badge warning">{conversation.pendingApprovals} approvals</span>}
              {conversation.transferCount > 0 && <span className="mini-badge success">{conversation.transferCount} files</span>}
              {props.contacts.length > 0 && <span className="mini-badge">{props.contacts.length} contacts</span>}
            </div>
          </div>
          {conversation.unread > 0 && <span className="unread">{conversation.unread}</span>}
        </button>
      ))}
    </section>
  );
}

function ChatWindow(props: {
  className?: string;
  conversation: Conversation;
  cloudStatus: CloudStatus;
  online: boolean;
  queuedCount: number;
  onBack: () => void;
  onOpenDetails: () => void;
  onSend: (text: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: props.conversation.messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 112,
    overscan: 8
  });
  const previewFileRequest = isFileRequest(draft);

  async function submit() {
    if (!draft.trim() || sending) return;
    const text = draft;
    setDraft("");
    setSending(true);
    try {
      await props.onSend(text);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className={`chat-window ${props.className ?? ""}`} aria-label={`Conversation with ${props.conversation.title}`}>
      <header className="chat-header">
        <button type="button" className="icon-button mobile-only" onClick={props.onBack} title="Back to conversations"><ChevronLeft /></button>
        <div className="avatar small">{initials(props.conversation.title)}</div>
        <div>
          <strong>{props.conversation.title}</strong>
          <span>{props.conversation.subtitle}</span>
        </div>
        <div className="chat-header-actions">
          <StatusPill ok={props.online} text={props.online ? "connected" : "waiting for connection"} />
          <button type="button" className="icon-button" onClick={props.onOpenDetails} title="Open details"><MoreHorizontal /></button>
        </div>
      </header>
      {props.queuedCount > 0 && (
        <div className="warning-strip" role="status">
          <WifiOff /> {props.queuedCount} message{props.queuedCount === 1 ? "" : "s"} waiting for connection.
        </div>
      )}
      <div ref={parentRef} className="message-scroll" role="log" aria-live="polite" aria-relevant="additions text">
        <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const message = props.conversation.messages[item.index];
            return (
              <div
                key={message.id}
                className="virtual-message"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <MessageBubble message={message} />
              </div>
            );
          })}
        </div>
      </div>
      <footer className="composer" aria-label="Message composer">
        <div className="composer-tools">
          <button type="button" className="icon-button" title="Attach file"><Paperclip /></button>
          <div className="suggestions" aria-label="Command suggestions">
            {["/request-file", "/send-file", "/agent-card", "/status"].map((item) => <button type="button" key={item} onClick={() => setDraft(item + " ")}>{item}</button>)}
          </div>
        </div>
        {previewFileRequest && (
          <div className="request-preview">
            <FileText /> File-request detected. This will create an A2A task and wait for remote approval.
          </div>
        )}
        <div className="composer-row">
          <textarea
            value={draft}
            disabled={!props.online && props.conversation.id !== "local-agent"}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={props.online ? "Message a person or agent..." : "Offline. Messages will wait for connection."}
            rows={2}
          />
          <button type="button" className="send-button" disabled={!draft.trim() || sending} onClick={() => void submit()} title="Send message">
            {sending ? <Loader2 className="spin" /> : <Send />}
          </button>
        </div>
      </footer>
    </section>
  );
}

function MessageBubble({ message }: { message: TimelineMessage }) {
  if (message.kind === "human") {
    return (
      <article className={`bubble human ${message.delivery_status === "failed" ? "failed" : ""}`}>
        <p>{message.text}</p>
        <span>{formatTime(message.created_at)} - {message.delivery_status.replace("_", " ")}</span>
        {message.delivery_status === "failed" && <button type="button" className="retry-button">Retry</button>}
      </article>
    );
  }
  if (message.kind === "approval") return <ApprovalMessage card={message.card} />;
  if (message.kind === "file_request") {
    return (
      <article className="task-card">
        <div className="task-icon"><FileText /></div>
        <div>
          <strong>File request</strong>
          <p>{message.natural_language_request}</p>
          <span>{message.status}</span>
        </div>
      </article>
    );
  }
  if (message.kind === "transfer") {
    return (
      <article className="file-card">
        <FileCheck />
        <div>
          <strong>{message.file_name}</strong>
          <span>{formatBytes(message.size_bytes)} - {message.status}</span>
          <progress value={message.progress_percent} max={100} />
          <div className="badge-line"><span className="privacy-badge"><Hash /> Hash verified</span><span className="privacy-badge">Relay encrypted</span></div>
        </div>
      </article>
    );
  }
  if (message.kind === "receipt") {
    return (
      <article className="file-card">
        <Archive />
        <div>
          <strong>{message.file_name}</strong>
          <span>{message.stored_path_display} - {message.hash_verified ? "hash verified" : "verification failed"}</span>
        </div>
      </article>
    );
  }
  if (message.kind === "a2a_task") {
    return (
      <article className="task-card">
        <div className="task-icon"><FileText /></div>
        <div>
          <strong>A2A task</strong>
          <p>{message.protocol_state} - {message.internal_state}</p>
          <span>{formatTime(message.created_at)}</span>
        </div>
      </article>
    );
  }
  return (
    <article className={`bubble system ${message.kind === "system_event" ? message.severity : ""}`}>
      <p>{message.kind === "agent_status" ? message.status_text : message.text}</p>
      <span>{message.kind === "agent_status" ? message.phase : message.event_type} - {formatTime(message.created_at)}</span>
    </article>
  );
}

function ApprovalMessage({ card }: { card: FileCandidateApprovalCard }) {
  return (
    <article className="approval-message">
      <header>
        <div>
          <p className="eyebrow">Approval required</p>
          <h3>{card.request_text}</h3>
        </div>
        <span className={`status-chip ${card.status}`}>{card.status}</span>
      </header>
      <div className="badge-line">
        <span className="privacy-badge"><ShieldCheck /> Local path hidden from recipient</span>
        <span className="privacy-badge"><Bell /> Approval required</span>
        <span className="privacy-badge">E2E encryption not enabled</span>
      </div>
      <div className="candidate-list">
        {card.candidates.length === 0 && <p className="muted">No candidate is bound yet. Use feedback or choose manually from the approval center.</p>}
        {card.candidates.map((candidate) => (
          <div key={candidate.candidate_id} className="candidate-row">
            <FileText />
            <div>
              <strong>{candidate.file_name}</strong>
              <span>{candidate.display_path}</span>
              <small>{formatBytes(candidate.size_bytes)} - score {Math.round(candidate.match_score * 100)} - {candidate.match_reason}</small>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function RightPanel(props: {
  className?: string;
  active: RightPanelTab;
  setActive: (panel: RightPanelTab) => void;
  conversation: Conversation;
  approvals: FileCandidateApprovalCard[];
  files: StoredFile[];
  audit: AuditEvent[];
  status: CloudStatus;
  onClose: () => void;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onFeedback: (id: string, feedback: string) => Promise<void>;
}) {
  const tabs: Array<{ id: RightPanelTab; label: string; icon: ReactNode }> = [
    { id: "agent", label: "Agent", icon: <ShieldCheck /> },
    { id: "approvals", label: "Approvals", icon: <Bell /> },
    { id: "files", label: "Files", icon: <Inbox /> },
    { id: "audit", label: "Audit", icon: <Clock /> },
    { id: "settings", label: "Settings", icon: <Settings /> }
  ];
  return (
    <aside className={`details-panel ${props.className ?? ""}`} aria-label="Conversation details">
      <header className="details-header">
        <strong>Details</strong>
        <button type="button" className="icon-button mobile-only" onClick={props.onClose} title="Close details"><X /></button>
      </header>
      <nav className="details-tabs" aria-label="Details tabs">
        {tabs.map((tab) => (
          <button key={tab.id} type="button" className={props.active === tab.id ? "active" : ""} onClick={() => props.setActive(tab.id)}>
            {tab.icon}{tab.label}
          </button>
        ))}
      </nav>
      <div className="details-content">
        {props.active === "agent" && <AgentCardPanel conversation={props.conversation} status={props.status} />}
        {props.active === "approvals" && <ApprovalCenter approvals={props.approvals} onApprove={props.onApprove} onReject={props.onReject} onFeedback={props.onFeedback} />}
        {props.active === "files" && <ReceivedFilesView files={props.files} />}
        {props.active === "audit" && <AuditTimeline events={props.audit} />}
        {props.active === "settings" && <SettingsPanel status={props.status} />}
      </div>
    </aside>
  );
}

function AgentCardPanel({ conversation, status }: { conversation: Conversation; status: CloudStatus }) {
  return (
    <section className="panel-section">
      <h2>{conversation.title}</h2>
      <div className="identity-grid compact-grid">
        <StatusTile label="Agent instance" value={shortId(conversation.agentInstanceId ?? status.cloud.agentInstanceId ?? "local")} icon={<Hash />} />
        <StatusTile label="Device status" value={conversation.presence} icon={<Wifi />} />
        <StatusTile label="Relay reachable" value={conversation.agentInstanceId ? "yes" : "local only"} icon={<ShieldCheck />} />
        <StatusTile label="A2A skills" value="file.request, message.send" icon={<FileText />} />
      </div>
      <div className="badge-line stack">
        <span className="privacy-badge">A2A v1 compatible surface</span>
        <span className="privacy-badge">Human approval required for files</span>
        <span className="privacy-badge">No local path exposure</span>
      </div>
    </section>
  );
}

function ApprovalCenter(props: {
  approvals: FileCandidateApprovalCard[];
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onFeedback: (id: string, feedback: string) => Promise<void>;
}) {
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  if (props.approvals.length === 0) return <EmptyPanel icon={<Bell />} title="No pending approvals" text="Remote file requests will appear here and in the chat timeline." />;
  return (
    <section className="approval-center">
      {props.approvals.map((approval) => (
        <article key={approval.approval_id} className="approval-detail">
          <ApprovalMessage card={approval} />
          <div className="approval-actions">
            <button type="button" className="primary-action compact" onClick={() => void props.onApprove(approval.approval_id)}><Check /> Approve</button>
            <button type="button" className="secondary-action compact" onClick={() => void props.onReject(approval.approval_id)}><X /> Reject</button>
          </div>
          <label className="feedback-field">
            Feedback
            <textarea value={feedback[approval.approval_id] ?? ""} onChange={(event) => setFeedback({ ...feedback, [approval.approval_id]: event.target.value })} placeholder="Refine search: newer version, different folder, exact invoice number..." />
          </label>
          <button type="button" className="secondary-action compact" onClick={() => void props.onFeedback(approval.approval_id, feedback[approval.approval_id] ?? "")}>
            <RefreshCw /> Search again
          </button>
        </article>
      ))}
    </section>
  );
}

function ReceivedFilesView({ files }: { files: StoredFile[] }) {
  const [query, setQuery] = useState("");
  const filtered = files.filter((file) => file.originalFileName.toLowerCase().includes(query.toLowerCase()));
  return (
    <section className="panel-section">
      <div className="search-box"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search received files" /></div>
      {filtered.length === 0 && <EmptyPanel icon={<Inbox />} title="No received files" text="Completed transfers will appear here with hashes and receipts." />}
      {filtered.map((file) => (
        <article key={file.id} className="received-file">
          <FileCheck />
          <div>
            <strong>{file.originalFileName}</strong>
            <span>{formatBytes(file.sizeBytes)} - {formatTime(file.receivedAt)}</span>
            <code>{file.sha256.slice(0, 18)}...</code>
            <div className="file-actions">
              <a href={`/storage/files/${file.id}/download`} download>Open</a>
              <button type="button">Verify hash</button>
              <button type="button"><FolderOpen /> Show</button>
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}

function AuditTimeline({ events }: { events: AuditEvent[] }) {
  const [query, setQuery] = useState("");
  const filtered = events.filter((event) => `${event.eventType} ${event.taskId ?? ""} ${event.approvalId ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <section className="panel-section">
      <div className="search-box"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter audit by task, file, approval" /></div>
      {filtered.length === 0 && <EmptyPanel icon={<Clock />} title="No audit events" text="Local audit chain events will appear after agent actions." />}
      <ol className="audit-list">
        {filtered.map((event) => (
          <li key={event.id}>
            <span className="timeline-dot" />
            <strong>{event.eventType}</strong>
            <small>{formatTime(event.createdAt)} - task {shortId(event.taskId ?? "none")}</small>
            {event.approvalId && <code>approval {shortId(event.approvalId)}</code>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function SettingsPanel({ status }: { status: CloudStatus }) {
  return (
    <section className="panel-section settings-panel">
      <StatusTile label="Control plane" value={status.cloud.controlPlaneUrl} icon={<Wifi />} />
      <StatusTile label="Enrollment" value={status.cloud.status} icon={<ShieldCheck />} />
      <StatusTile label="Heartbeat last sent" value={status.heartbeat.lastError ? `error: ${status.heartbeat.lastError}` : "active"} icon={<Clock />} />
      <StatusTile label="Relay poll" value={status.inbox.lastError ? `error: ${status.inbox.lastError}` : `${status.inbox.lastItemCount} recent`} icon={<Inbox />} />
      <StatusTile label="Notification bridge" value="local callback ready" icon={<Bell />} />
      <StatusTile label="Storage location" value="Agentic App Storage" icon={<Archive />} />
      <div className="toggle-list">
        <label><input type="checkbox" defaultChecked /> Require approval before file transfer</label>
        <label><input type="checkbox" defaultChecked /> Hide local paths from recipients</label>
        <label><input type="checkbox" /> Enable experimental E2E encryption</label>
      </div>
    </section>
  );
}

function CommandPalette(props: {
  conversations: Conversation[];
  files: StoredFile[];
  onClose: () => void;
  onSelectConversation: (id: string) => void;
  setRightPanel: (panel: RightPanelTab) => void;
}) {
  const [query, setQuery] = useState("");
  const commands = [
    { id: "approvals", label: "Open Approval Center", action: () => props.setRightPanel("approvals") },
    { id: "files", label: "Search received files", action: () => props.setRightPanel("files") },
    { id: "audit", label: "Open audit timeline", action: () => props.setRightPanel("audit") },
    { id: "settings", label: "Open settings", action: () => props.setRightPanel("settings") },
    ...props.conversations.map((conversation) => ({ id: conversation.id, label: `Chat: ${conversation.title}`, action: () => props.onSelectConversation(conversation.id) })),
    ...props.files.slice(0, 5).map((file) => ({ id: file.id, label: `File: ${file.originalFileName}`, action: () => props.setRightPanel("files") }))
  ].filter((item) => item.label.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="command-palette">
        <div className="search-box"><Command /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search contacts, messages, files, settings" /></div>
        <div className="command-results">
          {commands.map((command) => <button key={command.id} type="button" onClick={command.action}>{command.label}</button>)}
        </div>
        <button type="button" className="secondary-action compact" onClick={props.onClose}>Close</button>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return <main className="auth-screen"><div className="loading-card"><Loader2 className="spin" /> Loading Oracle Amigo...</div></main>;
}

function StatusTile({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return <div className="status-tile">{icon}<span>{label}</span><strong>{value}</strong></div>;
}

function StatusPill({ ok, text }: { ok: boolean; text: string }) {
  return <span className={`status-pill ${ok ? "ok" : "off"}`}>{ok ? <Wifi /> : <WifiOff />}{text}</span>;
}

function PresenceDot({ state }: { state: string }) {
  return <span className={`presence-dot ${state}`} aria-label={`Presence ${state}`} />;
}

function EmptyPanel({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className="empty-panel">{icon}<strong>{title}</strong><span>{text}</span></div>;
}

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  if (action.type === "upsertConversation") {
    const existing = state.conversations.some((item) => item.id === action.conversation.id);
    return {
      ...state,
      conversations: existing
        ? state.conversations.map((item) => item.id === action.conversation.id ? action.conversation : item)
        : [action.conversation, ...state.conversations]
    };
  }
  if (action.type === "select") return { ...state, selectedConversationId: action.id };
  if (action.type === "appendMessage") {
    return {
      ...state,
      conversations: state.conversations.map((conversation) => {
        if (conversation.id !== action.conversationId) return conversation;
        if (conversation.messages.some((message) => message.id === action.message.id)) return conversation;
        return {
          ...conversation,
          messages: [...conversation.messages, action.message],
          lastMessage: summarizeMessage(action.message),
          pendingApprovals: action.message.kind === "approval" ? conversation.pendingApprovals + 1 : conversation.pendingApprovals,
          transferCount: action.message.kind === "transfer" || action.message.kind === "receipt" ? conversation.transferCount + 1 : conversation.transferCount
        };
      })
    };
  }
  if (action.type === "updateMessage") {
    return {
      ...state,
      conversations: state.conversations.map((conversation) => conversation.id === action.conversationId
        ? { ...conversation, messages: conversation.messages.map((message) => message.id === action.messageId ? ({ ...message, ...action.patch } as TimelineMessage) : message) }
        : conversation)
    };
  }
  if (action.type === "queue") return { ...state, outbox: [...state.outbox, action.message] };
  if (action.type === "clearQueued") return { ...state, outbox: state.outbox.filter((message) => message.id !== action.id) };
  return state;
}

function localConversation(): Conversation {
  return {
    id: "local-agent",
    title: "My local agent",
    subtitle: "Single-device local mode",
    agentInstanceId: null,
    presence: "online",
    unread: 0,
    lastMessage: "Ask for a file or status update",
    pendingApprovals: 0,
    transferCount: 0,
    messages: [
      systemMessage("Local agent ready. Cloud-connected chats use relay; local file requests stay on this device.", "info"),
      {
        kind: "agent_status",
        id: crypto.randomUUID(),
        task_id: "startup",
        status_text: "Diagnostics available: local health, relay status, heartbeat, approvals, files, audit.",
        phase: "ready",
        created_at: new Date().toISOString()
      }
    ]
  };
}

function conversationFromUser(user: DirectoryUser, agent: AgentInstance | null): Conversation {
  return {
    id: agent?.agent_instance_id ?? user.user_id,
    title: user.display_name || user.email,
    subtitle: agent ? `${user.email} - ${agent.display_name}` : `${user.email} - no active agent`,
    agentInstanceId: agent?.agent_instance_id ?? null,
    presence: agent?.status === "active" ? "online" : "offline",
    unread: 0,
    lastMessage: agent ? "Ready for relay chat" : "No reachable personal agent",
    pendingApprovals: 0,
    transferCount: 0,
    messages: [
      systemMessage(agent ? "Relay chat ready. File requests become A2A tasks." : "This user has no reachable agent instance.", agent ? "success" : "warning")
    ]
  };
}

function humanMessage(conversationId: string, text: string, status: CloudStatus, receiver: string | null): Extract<TimelineMessage, { kind: "human" }> {
  return {
    kind: "human",
    id: crypto.randomUUID(),
    conversation_id: conversationId,
    sender_user_id: status.cloud.userId,
    sender_agent_instance_id: status.cloud.agentInstanceId,
    receiver_agent_instance_id: receiver,
    text,
    created_at: new Date().toISOString(),
    delivery_status: "local_pending"
  };
}

function systemMessage(text: string, severity: "info" | "warning" | "error" | "success", details?: string): Extract<TimelineMessage, { kind: "system_event" }> {
  return {
    kind: "system_event",
    id: crypto.randomUUID(),
    event_type: details ? `${severity}: ${details}` : severity,
    text,
    severity,
    created_at: new Date().toISOString()
  };
}

function agentStatusMessage(taskId: string, text: string, phase: string): Extract<TimelineMessage, { kind: "agent_status" }> {
  return {
    kind: "agent_status",
    id: crypto.randomUUID(),
    task_id: taskId,
    status_text: text,
    phase,
    created_at: new Date().toISOString()
  };
}

function summarizeMessage(message: TimelineMessage): string {
  if (message.kind === "human") return message.text;
  if (message.kind === "approval") return "Approval required";
  if (message.kind === "agent_status") return message.status_text;
  if (message.kind === "system_event") return message.text;
  if (message.kind === "file_request") return message.natural_language_request;
  if (message.kind === "transfer") return `${message.file_name} ${message.status}`;
  if (message.kind === "a2a_task") return `${message.task_id} ${message.internal_state}`;
  return message.file_name;
}

function isFileRequest(text: string): boolean {
  return /^\/request-file\b/i.test(text) || /\b(find|send|share|get|request)\b.*\b(file|pdf|invoice|document|report|spreadsheet)\b/i.test(text);
}

function initials(value: string): string {
  return value.split(/\s|@/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "OA";
}

function shortId(value: string): string {
  return value.length <= 14 ? value : `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
