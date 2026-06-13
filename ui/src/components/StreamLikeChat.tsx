// Legacy compatibility component retained for source-contract inventory only.
// Active Oracle Amigo V1 behavior lives in routed app/pages/features.
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Avatar } from "@heroui/react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowUp,
  Check,
  ChevronRight,
  Download,
  Clock3,
  ExternalLink,
  FileCheck,
  FileText,
  FolderOpen,
  Laptop,
  MessageCircle,
  PanelRightOpen,
  Paperclip,
  Presentation,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UserPlus,
  WifiOff,
  X
} from "lucide-react";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtItem,
  ChainOfThoughtStep,
  ChainOfThoughtTrigger
} from "@/components/ui/chain-of-thought";
import { Loader } from "@/components/ui/loader";
import { api } from "../api/client";
import { ApiRequestError } from "../api/localAgentClient";
import { safeExternalHref } from "../lib/safeUrl";
import type { AgentInstance, CandidateFile, ChatDiagnostics, CloudStatus, Conversation, DirectoryUser, StoredFile, TimelineMessage } from "../types";
import { SidebarProvider, useSidebar } from "./SidebarContext";
import { SidebarToggle } from "./SidebarToggle";

const MOBILE_BREAKPOINT = 768;

type SendState = "idle" | "sending";
type CloudConnectMode = "login" | "signup";
type CloudConnectInput = { mode: CloudConnectMode; email: string; password: string; displayName: string; controlPlaneUrl?: string; orgSlug?: string };
type DeviceEnrollmentInput = { deviceName: string; agentDisplayName: string; capabilities: string[] };
type HealthStatus = { status: string; dryRun: boolean; localAgentUrl?: string; controlPlaneUrl?: string; defaultOrgSlug?: string };
type RelayInboxStatus = { running: boolean; lastItemCount: number; lastError: string | null };
type RelayIssue = { title: string; message: string; tone: "warning" | "danger" };

export function StreamLikeChatApp() {
  return (
    <SidebarProvider>
      <StreamLikeChat />
    </SidebarProvider>
  );
}

function StreamLikeChat() {
  const { closeSidebar, sidebarOpen } = useSidebar();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TimelineMessage[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadOpen, setThreadOpen] = useState(true);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [cloudStatus, setCloudStatus] = useState<CloudStatus | null>(null);
  const [relayInboxStatus, setRelayInboxStatus] = useState<RelayInboxStatus | null>(null);
  const [cloudAuthError, setCloudAuthError] = useState<string | null>(null);
  const [relayStatusLoading, setRelayStatusLoading] = useState(false);
  const [cloudConnectLoading, setCloudConnectLoading] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<ChatDiagnostics | null>(null);
  const [diagnosticsIssue, setDiagnosticsIssue] = useState<string | null>(null);
  const [storedFiles, setStoredFiles] = useState<StoredFile[]>([]);
  const [storedFileIssue, setStoredFileIssue] = useState<string | null>(null);
  const [approvalIssue, setApprovalIssue] = useState<string | null>(null);
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [directoryResults, setDirectoryResults] = useState<DirectoryUser[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryIssue, setDirectoryIssue] = useState<string | null>(null);
  const [startingPeerId, setStartingPeerId] = useState<string | null>(null);
  const runStreamsRef = useRef<Map<string, EventSource>>(new Map());
  const mountedRef = useRef(true);

  const loadingMessagesRef = useRef<string | null>(null);
  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? conversations[0] ?? null,
    [activeConversationId, conversations]
  );

  useEffect(() => {
    void loadConversations();
    void loadRelayDiagnostics();
    void loadChatDiagnostics();
    void loadStoredFiles();
    return () => {
      mountedRef.current = false;
      for (const stream of runStreamsRef.current.values()) stream.close();
      runStreamsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!activeConversation?.id) {
      setMessages([]);
      return;
    }
    void loadMessages(activeConversation.id);
  }, [activeConversation?.id]);

  useEffect(() => {
    if (!activeConversation?.id) return;
    const conversationId = activeConversation.id;
    const timer = window.setInterval(() => {
      void loadMessages(conversationId, { silent: true });
      void loadConversations({ silent: true });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [activeConversation?.id]);

  useEffect(() => {
    const query = directoryQuery.trim();
    if (query.length < 2) {
      setDirectoryResults([]);
      setDirectoryIssue(null);
      setDirectoryLoading(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setDirectoryLoading(true);
      try {
        const result = await api.directoryUsers(query);
        if (!cancelled) {
          setDirectoryResults(result.users);
          setDirectoryIssue(null);
        }
      } catch (err) {
        if (!cancelled) {
          setDirectoryResults([]);
          setDirectoryIssue(err instanceof Error ? err.message : "Directory search failed.");
        }
      } finally {
        if (!cancelled) setDirectoryLoading(false);
      }
    }, 240);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [directoryQuery]);

  async function loadConversations(options: { silent?: boolean } = {}) {
    if (!options.silent) setLoadingConversations(true);
    if (!options.silent) setError(null);
    try {
      const result = await api.conversations();
      if (!mountedRef.current) return;
      setConversations(result.conversations);
      setActiveConversationId((current) => current ?? result.conversations[0]?.id ?? null);
    } catch (err) {
      if (!mountedRef.current) return;
      const fallback = createLocalConversation();
      setConversations((current) => current.length > 0 ? current : [fallback]);
      setActiveConversationId((current) => current ?? fallback.id);
      if (!options.silent) setError(err instanceof Error ? err.message : "Unable to load conversations.");
    } finally {
      if (!mountedRef.current) return;
      if (!options.silent) setLoadingConversations(false);
    }
  }

  async function loadRelayDiagnostics(options: { keepRecoveryMessage?: boolean } = {}) {
    setRelayStatusLoading(true);
    if (!options.keepRecoveryMessage) setRecoveryMessage(null);
    const [healthResult, cloudResult, inboxResult] = await Promise.allSettled([
      api.health(),
      api.cloudStatus(),
      api.relayInboxStatus()
    ]);

    if (!mountedRef.current) return;
    setHealth(healthResult.status === "fulfilled" ? healthResult.value : null);
    const nextCloudStatus = cloudResult.status === "fulfilled" ? cloudResult.value : null;
    const nextInboxStatus = inboxResult.status === "fulfilled" ? inboxResult.value : null;
    setCloudStatus(nextCloudStatus);
    setRelayInboxStatus(nextInboxStatus);
    if (
      nextCloudStatus?.cloud.status === "enrolled" &&
      nextCloudStatus.cloud.hasDeviceAccessToken &&
      nextCloudStatus.heartbeat.running &&
      nextCloudStatus.inbox.running &&
      nextInboxStatus?.running
    ) {
      setCloudAuthError(null);
    }
    setRelayStatusLoading(false);
  }

  async function loadMessages(conversationId: string, options: { silent?: boolean } = {}) {
    loadingMessagesRef.current = conversationId;
    if (!options.silent) setLoadingMessages(true);
    if (!options.silent) setError(null);
    try {
      const result = await api.conversationMessages(conversationId);
      if (!mountedRef.current) return;
      if (loadingMessagesRef.current !== conversationId) return;
      setMessages(result.messages);
      reconnectAgentRunStreams(conversationId, result.messages);
    } catch (err) {
      if (!mountedRef.current) return;
      if (loadingMessagesRef.current !== conversationId) return;
      if (!options.silent) setError(err instanceof Error ? err.message : "Unable to load messages.");
    } finally {
      if (!mountedRef.current) return;
      if (!options.silent && loadingMessagesRef.current === conversationId) setLoadingMessages(false);
    }
  }

  async function loadChatDiagnostics() {
    try {
      const result = await api.chatDiagnostics();
      if (!mountedRef.current) return;
      setDiagnostics(result);
      setDiagnosticsIssue(null);
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof ApiRequestError && err.status === 404) {
        setDiagnosticsIssue("The local backend is running an older chat API. Restart the backend so agent runs, diagnostics, and streaming are available.");
      } else {
        setDiagnosticsIssue(err instanceof Error ? err.message : "Unable to read local agent diagnostics.");
      }
      setDiagnostics(null);
    }
  }

  async function loadStoredFiles() {
    try {
      const result = await api.files();
      if (!mountedRef.current) return;
      setStoredFiles(result.files);
      setStoredFileIssue(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setStoredFiles([]);
      setStoredFileIssue(err instanceof Error ? err.message : "Unable to read received files.");
    }
  }

  function reconnectAgentRunStreams(conversationId: string, timeline: TimelineMessage[]) {
    const runIds = new Set<string>();
    for (const message of timeline) {
      if (message.kind !== "agent_status") continue;
      const runId = typeof message.details?.run_id === "string" ? message.details.run_id : null;
      const runStatus = typeof message.details?.run_status === "string" ? message.details.run_status : null;
      if (runId && runStatus === "running") runIds.add(runId);
    }
    for (const runId of runIds) subscribeToAgentRun(runId, conversationId);
  }

  function subscribeToAgentRun(runId: string, conversationId: string) {
    if (runStreamsRef.current.has(runId)) return;
    const stream = new EventSource(api.agentRunEventsUrl(runId));
    runStreamsRef.current.set(runId, stream);
    stream.addEventListener("snapshot", (event) => {
      let run: { status: string };
      try {
        run = JSON.parse((event as MessageEvent).data) as { status: string };
      } catch {
        stream.close();
        runStreamsRef.current.delete(runId);
        void loadMessages(conversationId);
        void loadChatDiagnostics();
        return;
      }
      void loadMessages(conversationId);
      void loadChatDiagnostics();
      if (run.status !== "running") {
        stream.close();
        runStreamsRef.current.delete(runId);
      }
    });
    stream.onerror = () => {
      stream.close();
      runStreamsRef.current.delete(runId);
      void loadMessages(conversationId);
      void loadChatDiagnostics();
    };
  }

  function selectConversation(conversationId: string) {
    setActiveConversationId(conversationId);
    if (window.innerWidth < MOBILE_BREAKPOINT) closeSidebar();
  }

  async function sendMessage(text: string) {
    if (!activeConversation) return;
    const conversationId = activeConversation.id;
    const relayIssue = relayIssueFor(activeConversation, cloudStatus, relayInboxStatus, cloudAuthError, health);
    if (relayIssue) {
      setError(relayIssue.message);
      return;
    }
    const optimistic = createHumanMessage(activeConversation.id, text);
    setMessages((current) => [...current, optimistic]);
    setConversations((current) => updateConversationPreview(current, conversationId, text));

    try {
      const looksLikeFileRequest = isFileRequest(text);
      const result = await api.sendChatMessage(conversationId, {
        text,
        send_as: looksLikeFileRequest ? "file_request" : "normal",
        client_message_id: optimistic.id,
        idempotency_key: `ui-${optimistic.id}`
      });
      setMessages((current) =>
        current.map((message) =>
          message.kind === "human" && message.id === optimistic.id
            ? { ...message, delivery_status: result.delivery_status }
            : message
        )
      );
      if (result.type === "file_request") {
        setMessages((current) => [
          ...current,
          createAgentStatus(
            result.task_id ?? result.relay_task_id ?? `task-${optimistic.id}`,
            "Waiting for approval",
            "approval_pending"
          )
        ]);
      }
      if (result.run_id) subscribeToAgentRun(result.run_id, conversationId);
      await loadMessages(conversationId);
      if (result.type === "file_request") {
        setMessages((current) =>
          current.length > 0
            ? current
            : [
                { ...optimistic, delivery_status: result.delivery_status },
                createAgentStatus(
                  result.task_id ?? result.relay_task_id ?? `task-${optimistic.id}`,
                  "Waiting for approval",
                  "approval_pending"
                )
              ]
        );
      }
      void loadStoredFiles();
      void loadChatDiagnostics();
    } catch (err) {
      setMessages((current) =>
        current.map((message) =>
          message.kind === "human" && message.id === optimistic.id
            ? { ...message, delivery_status: "failed" }
            : message
        )
      );
      if (err instanceof ApiRequestError && isRelayUnavailable(err.details)) {
        setError(relayFailureMessage(err));
        if (err.status === 401 || err.status === 403) {
          setCloudAuthError(err.message);
        }
        void loadRelayDiagnostics();
      } else {
        setError(err instanceof Error ? err.message : "Message failed to send.");
      }
    }
  }

  async function retryMessage(message: Extract<TimelineMessage, { kind: "human" }>) {
    const relayIssue = relayIssueFor(activeConversation, cloudStatus, relayInboxStatus, cloudAuthError, health);
    if (relayIssue) {
      setError(relayIssue.message);
      return;
    }
    setMessages((current) => current.filter((item) => item.id !== message.id));
    await sendMessage(message.text);
  }

  async function decideApproval(approvalId: string, decision: "approve" | "reject", feedback?: string) {
    setApprovalIssue(null);
    try {
      if (feedback?.trim()) await api.feedback(approvalId, feedback.trim());
      if (decision === "approve") {
        await api.approve(approvalId);
      } else {
        await api.reject(approvalId);
      }
      if (activeConversation?.id) await loadMessages(activeConversation.id);
      void loadStoredFiles();
      void loadChatDiagnostics();
    } catch (err) {
      setApprovalIssue(err instanceof Error ? err.message : "Approval decision failed.");
    }
  }

  async function startDirectoryConversation(user: DirectoryUser, agent?: AgentInstance) {
    const peerId = agent?.agent_instance_id ?? user.user_id;
    setStartingPeerId(peerId);
    setDirectoryIssue(null);
    try {
      const result = await api.createConversation({
        title: user.display_name || user.email,
        peer_user_id: user.user_id,
        peer_agent_instance_id: agent?.agent_instance_id ?? user.agents?.[0]?.agent_instance_id ?? null,
        mode: agent || user.active_agent_instances > 0 ? "cloud_relay" : "local"
      });
      setConversations((current) => {
        const withoutDuplicate = current.filter((conversation) => conversation.id !== result.conversation.id);
        return [result.conversation, ...withoutDuplicate];
      });
      setActiveConversationId(result.conversation.id);
      setDirectoryQuery("");
      setDirectoryResults([]);
      if (window.innerWidth < MOBILE_BREAKPOINT) closeSidebar();
    } catch (err) {
      setDirectoryIssue(err instanceof Error ? err.message : "Unable to start conversation.");
    } finally {
      setStartingPeerId(null);
    }
  }

  async function reconnectCloudSession() {
    try {
      await api.logout();
      setRecoveryMessage("Cloud session cleared. Log in and enroll again, then refresh relay status.");
    } catch (err) {
      setRecoveryMessage(err instanceof Error ? err.message : "Unable to clear the cloud session.");
    } finally {
      await loadRelayDiagnostics({ keepRecoveryMessage: true });
    }
  }

  async function connectCloudSession(input: CloudConnectInput) {
    setCloudConnectLoading(true);
    setRecoveryMessage(null);
    try {
      const controlPlaneUrl = input.controlPlaneUrl || cloudStatus?.controlPlane?.configuredUrl || cloudStatus?.defaults?.controlPlaneUrl || health?.controlPlaneUrl;
      const orgSlug = input.orgSlug || cloudStatus?.defaults?.orgSlug || health?.defaultOrgSlug;
      if (input.mode === "signup") {
        await api.signup({
          email: input.email,
          password: input.password,
          display_name: input.displayName || input.email,
          org_slug: orgSlug,
          control_plane_url: controlPlaneUrl
        });
      } else {
        await api.login({
          email: input.email,
          password: input.password,
          org_slug: orgSlug,
          control_plane_url: controlPlaneUrl
        });
      }
      await api.enroll({
        device_name: window.navigator.platform || "Local device",
        agent_display_name: "Oracle Amigo Local Agent",
        capabilities: ["a2a.v1", "file.request", "file.transfer"]
      });
      setRecoveryMessage(`Connected to ${controlPlaneUrl ?? "the configured control plane"} and started enrollment heartbeat.`);
      await loadRelayDiagnostics({ keepRecoveryMessage: true });
      await loadConversations();
    } catch (err) {
      setRecoveryMessage(err instanceof Error ? err.message : "Unable to connect this agent to the control plane.");
      await loadRelayDiagnostics({ keepRecoveryMessage: true });
    } finally {
      setCloudConnectLoading(false);
    }
  }

  async function authenticateCloudSession(input: CloudConnectInput) {
    setCloudConnectLoading(true);
    setRecoveryMessage(null);
    try {
      const controlPlaneUrl = input.controlPlaneUrl || cloudStatus?.controlPlane?.configuredUrl || cloudStatus?.defaults?.controlPlaneUrl || health?.controlPlaneUrl;
      const orgSlug = input.orgSlug || cloudStatus?.defaults?.orgSlug || health?.defaultOrgSlug;
      if (input.mode === "signup") {
        await api.signup({
          email: input.email,
          password: input.password,
          display_name: input.displayName || input.email,
          org_slug: orgSlug,
          control_plane_url: controlPlaneUrl
        });
      } else {
        await api.login({
          email: input.email,
          password: input.password,
          org_slug: orgSlug,
          control_plane_url: controlPlaneUrl
        });
      }
      setRecoveryMessage(input.mode === "signup" ? "Account created. Register this local agent to join the relay." : "Signed in. Register this local agent to join the relay.");
      await loadRelayDiagnostics({ keepRecoveryMessage: true });
    } catch (err) {
      setRecoveryMessage(err instanceof Error ? err.message : "Unable to authenticate with the control plane.");
      await loadRelayDiagnostics({ keepRecoveryMessage: true });
    } finally {
      setCloudConnectLoading(false);
    }
  }

  async function enrollCloudDevice(input: DeviceEnrollmentInput) {
    setCloudConnectLoading(true);
    setRecoveryMessage(null);
    try {
      await api.enroll({
        device_name: input.deviceName,
        agent_display_name: input.agentDisplayName,
        capabilities: input.capabilities
      });
      setRecoveryMessage("Device enrolled. Heartbeat and relay polling are ready.");
      await loadRelayDiagnostics({ keepRecoveryMessage: true });
      await loadConversations();
      void loadStoredFiles();
      void loadChatDiagnostics();
    } catch (err) {
      setRecoveryMessage(err instanceof Error ? err.message : "Unable to enroll this device.");
      await loadRelayDiagnostics({ keepRecoveryMessage: true });
    } finally {
      setCloudConnectLoading(false);
    }
  }

  function useLocalAgent() {
    const localConversation = conversations.find((conversation) => conversation.id === "local-agent" || !conversation.agentInstanceId);
    if (!localConversation) {
      setError("Local agent conversation is not available yet.");
      return;
    }
    selectConversation(localConversation.id);
  }

  const activeRelayIssue = relayIssueFor(activeConversation, cloudStatus, relayInboxStatus, cloudAuthError, health);

  if (!cloudStatus) {
    return (
      <main className="agentic-auth-shell" aria-label="Agentic Chat" role="region">
        <StateNotice icon={<Loader variant="loading-dots" text="Checking profile" size="md" />} title="Checking cloud profile" text="Reading local agent and control-plane status." />
      </main>
    );
  }

  const cloudSessionEnrolled = cloudStatus.cloud.status === "enrolled" && cloudStatus.cloud.hasDeviceAccessToken;
  if (!cloudSessionEnrolled) {
    return (
      <AuthEnrollmentExperience
        cloudConnectLoading={cloudConnectLoading}
        cloudStatus={cloudStatus}
        health={health}
        onAuthenticate={authenticateCloudSession}
        onEnroll={enrollCloudDevice}
        onRefresh={() => loadRelayDiagnostics({ keepRecoveryMessage: true })}
        recoveryMessage={recoveryMessage}
      />
    );
  }

  return (
    <main
      className={`stream-chat-layout ${sidebarOpen ? "" : "stream-chat-layout--sidebar-collapsed"} ${threadOpen ? "stream-chat-layout--thread-open" : ""}`}
      aria-label="Oracle Amigo agentic chat application"
    >
      <span hidden aria-label="Custom Stream-like agentic chat" />
      <ChannelList
        activeConversationId={activeConversation?.id ?? null}
        conversations={conversations}
        directoryIssue={directoryIssue}
        directoryLoading={directoryLoading}
        directoryQuery={directoryQuery}
        directoryResults={directoryResults}
        error={error}
        loading={loadingConversations}
        onRefresh={loadConversations}
        onSelect={selectConversation}
        onSearchDirectory={setDirectoryQuery}
        onStartConversation={startDirectoryConversation}
        startingPeerId={startingPeerId}
      />

      {sidebarOpen && <button type="button" className="stream-sidebar-backdrop" aria-label="Close channel list" onClick={closeSidebar} />}

      <ChannelWindow
        conversation={activeConversation}
        approvalIssue={approvalIssue}
        cloudStatus={cloudStatus}
        error={error}
        health={health}
        loadingMessages={loadingMessages}
        messages={messages}
        onApprovalDecision={decideApproval}
        onReload={() => activeConversation ? loadMessages(activeConversation.id) : undefined}
        onReconnectCloud={reconnectCloudSession}
        onConnectCloud={connectCloudSession}
        onRefreshRelay={() => loadRelayDiagnostics()}
        onRetryMessage={retryMessage}
        onSend={sendMessage}
        onToggleThread={() => setThreadOpen((current) => !current)}
        onUseLocalAgent={useLocalAgent}
        diagnostics={diagnostics}
        diagnosticsIssue={diagnosticsIssue}
        recoveryMessage={recoveryMessage}
        relayInboxStatus={relayInboxStatus}
        relayIssue={activeRelayIssue}
        relayStatusLoading={relayStatusLoading}
        cloudConnectLoading={cloudConnectLoading}
        threadOpen={threadOpen}
      />

      <ThreadPanel
        conversation={activeConversation}
        cloudStatus={cloudStatus}
        diagnostics={diagnostics}
        messages={messages}
        onClose={() => setThreadOpen(false)}
        onRefreshFiles={loadStoredFiles}
        open={threadOpen}
        storedFileIssue={storedFileIssue}
        storedFiles={storedFiles}
      />
    </main>
  );
}

function AuthEnrollmentExperience({
  cloudConnectLoading,
  cloudStatus,
  health,
  onAuthenticate,
  onEnroll,
  onRefresh,
  recoveryMessage
}: {
  cloudConnectLoading: boolean;
  cloudStatus: CloudStatus;
  health: HealthStatus | null;
  onAuthenticate: (input: CloudConnectInput) => Promise<void>;
  onEnroll: (input: DeviceEnrollmentInput) => Promise<void>;
  onRefresh: () => void | Promise<void>;
  recoveryMessage: string | null;
}) {
  const authenticated = cloudStatus.cloud.status === "authenticated" && cloudStatus.cloud.hasUserAccessToken;
  return (
    <main className="agentic-auth-shell" aria-label="Agentic Chat" role="region">
      <section className="agentic-auth-panel" aria-label={authenticated ? "Device enrollment" : "Cloud authentication"}>
        <div className="agentic-auth-brand">
          <span className="agentic-auth-logo"><Sparkles aria-hidden="true" /></span>
          <div>
            <strong>Oracle Amigo Agentic Command Chat</strong>
            <span>Secure personal-agent messaging, relay tasks, approvals, and verified file transfer.</span>
          </div>
        </div>

        <div className="agentic-auth-grid">
          <div className="agentic-auth-copy">
            <span className="agentic-auth-eyebrow">{authenticated ? "Enrollment" : "Authentication"}</span>
            <h1>{authenticated ? "Register this local agent" : "Connect your agentic workspace"}</h1>
            <p>
              {authenticated
                ? "Bind this device, register your personal agent, then start heartbeat and relay polling for directory visibility."
                : "Sign up or log in to the control plane before starting cloud relay conversations and approval-backed file transfers."}
            </p>
            <div className="agentic-auth-status-grid" aria-label="Connection status">
              <StatusChip tone={health ? "online" : "offline"} label="Local agent" value={health?.status ?? "unknown"} />
              <StatusChip tone={cloudStatus.controlPlane?.status === "ok" ? "relay" : "offline"} label="Control plane" value={cloudStatus.controlPlane?.status ?? "configured"} />
              <StatusChip tone={cloudStatus.heartbeat.running ? "heartbeat" : "offline"} label="Heartbeat" value={cloudStatus.heartbeat.running ? "active" : "stopped"} />
              <StatusChip tone={cloudStatus.inbox.running ? "relay" : "offline"} label="Relay polling" value={cloudStatus.inbox.running ? "active" : "stopped"} />
            </div>
          </div>

          {authenticated ? (
            <DeviceEnrollmentForm
              cloudStatus={cloudStatus}
              health={health}
              loading={cloudConnectLoading}
              onEnroll={onEnroll}
              onRefresh={onRefresh}
              recoveryMessage={recoveryMessage}
            />
          ) : (
            <AuthScreenForm
              cloudStatus={cloudStatus}
              health={health}
              loading={cloudConnectLoading}
              onAuthenticate={onAuthenticate}
              onRefresh={onRefresh}
              recoveryMessage={recoveryMessage}
            />
          )}
        </div>
      </section>
    </main>
  );
}

function AuthScreenForm({
  cloudStatus,
  health,
  loading,
  onAuthenticate,
  onRefresh,
  recoveryMessage
}: {
  cloudStatus: CloudStatus;
  health: HealthStatus | null;
  loading: boolean;
  onAuthenticate: (input: CloudConnectInput) => Promise<void>;
  onRefresh: () => void | Promise<void>;
  recoveryMessage: string | null;
}) {
  const [mode, setMode] = useState<CloudConnectMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [controlPlaneUrl, setControlPlaneUrl] = useState(cloudStatus.controlPlane?.configuredUrl ?? cloudStatus.defaults?.controlPlaneUrl ?? health?.controlPlaneUrl ?? "");
  const [orgSlug, setOrgSlug] = useState(cloudStatus.defaults?.orgSlug ?? health?.defaultOrgSlug ?? "");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || !email.trim() || !password) return;
    await onAuthenticate({
      mode,
      email: email.trim(),
      password,
      displayName: displayName.trim(),
      controlPlaneUrl: controlPlaneUrl.trim() || undefined,
      orgSlug: orgSlug.trim() || undefined
    });
  }

  return (
    <form className="agentic-auth-card" aria-label="Authentication form" onSubmit={(event) => void submit(event)}>
      <div className="agentic-auth-card-head">
        <UserPlus aria-hidden="true" />
        <div>
          <strong>{mode === "signup" ? "Create cloud profile" : "Log in to cloud profile"}</strong>
          <span>Credentials stay with the local agent backend.</span>
        </div>
      </div>
      <div className="auth-mode-tabs" role="tablist" aria-label="Authentication mode">
        <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "is-active" : ""} onClick={() => setMode("login")}>Login</button>
        <button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "is-active" : ""} onClick={() => setMode("signup")}>Signup</button>
      </div>
      <label>
        <span>Email</span>
        <input aria-label="Email" autoComplete="email" type="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} />
      </label>
      {mode === "signup" && (
        <label>
          <span>Display name</span>
          <input aria-label="Display name" autoComplete="name" type="text" value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} />
        </label>
      )}
      <label>
        <span>Password</span>
        <input aria-label="Password" autoComplete={mode === "login" ? "current-password" : "new-password"} type="password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} />
      </label>
      <label>
        <span>Control-plane URL</span>
        <input aria-label="Control-plane URL" type="url" value={controlPlaneUrl} onChange={(event) => setControlPlaneUrl(event.currentTarget.value)} />
      </label>
      <label>
        <span>Organization slug</span>
        <input aria-label="Organization slug" type="text" value={orgSlug} onChange={(event) => setOrgSlug(event.currentTarget.value)} />
      </label>
      {recoveryMessage && <p className="agentic-auth-message" role="status">{recoveryMessage}</p>}
      <div className="agentic-auth-actions">
        <button type="button" onClick={() => void onRefresh()} disabled={loading}>
          <RefreshCw aria-hidden="true" />
          Test connection
        </button>
        <button type="submit" disabled={loading || !email.trim() || !password}>
          {loading ? <Loader variant="circular" size="sm" /> : <Check aria-hidden="true" />}
          {mode === "signup" ? "Create account" : "Log in"}
        </button>
      </div>
    </form>
  );
}

function DeviceEnrollmentForm({
  cloudStatus,
  health,
  loading,
  onEnroll,
  onRefresh,
  recoveryMessage
}: {
  cloudStatus: CloudStatus;
  health: HealthStatus | null;
  loading: boolean;
  onEnroll: (input: DeviceEnrollmentInput) => Promise<void>;
  onRefresh: () => void | Promise<void>;
  recoveryMessage: string | null;
}) {
  const [deviceName, setDeviceName] = useState(window.navigator.platform || "Local device");
  const [agentDisplayName, setAgentDisplayName] = useState("Oracle Amigo Local Agent");
  const [capabilities, setCapabilities] = useState(["a2a.v1", "file.request", "file.transfer"]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || !deviceName.trim() || !agentDisplayName.trim()) return;
    await onEnroll({ deviceName: deviceName.trim(), agentDisplayName: agentDisplayName.trim(), capabilities });
  }

  function toggleCapability(capability: string) {
    setCapabilities((current) =>
      current.includes(capability) ? current.filter((item) => item !== capability) : [...current, capability]
    );
  }

  return (
    <form className="agentic-auth-card" aria-label="Device enrollment form" onSubmit={(event) => void submit(event)}>
      <div className="agentic-auth-card-head">
        <Laptop aria-hidden="true" />
        <div>
          <strong>Register this local agent</strong>
          <span>{cloudStatus.cloud.userEmail ?? "Authenticated profile"}</span>
        </div>
      </div>
      <div className="device-fingerprint-card" aria-label="Device fingerprint">
        <div>
          <span>Profile</span>
          <strong>{cloudStatus.cloud.profileId}</strong>
        </div>
        <div>
          <span>Control plane</span>
          <strong>{cloudStatus.cloud.controlPlaneUrl || health?.controlPlaneUrl || "configured endpoint"}</strong>
        </div>
        <div>
          <span>Device token</span>
          <strong>{cloudStatus.cloud.hasDeviceAccessToken ? "present" : "not enrolled"}</strong>
        </div>
      </div>
      <label>
        <span>Device name</span>
        <input aria-label="Device name" type="text" value={deviceName} onChange={(event) => setDeviceName(event.currentTarget.value)} />
      </label>
      <label>
        <span>Agent display name</span>
        <input aria-label="Agent display name" type="text" value={agentDisplayName} onChange={(event) => setAgentDisplayName(event.currentTarget.value)} />
      </label>
      <fieldset className="capability-review">
        <legend>Capabilities review</legend>
        {["a2a.v1", "file.request", "file.transfer", "audit.timeline"].map((capability) => (
          <label key={capability}>
            <input
              type="checkbox"
              checked={capabilities.includes(capability)}
              onChange={() => toggleCapability(capability)}
            />
            <span>{capability}</span>
          </label>
        ))}
      </fieldset>
      {recoveryMessage && <p className="agentic-auth-message" role="status">{recoveryMessage}</p>}
      <div className="agentic-auth-actions">
        <button type="button" onClick={() => void onRefresh()} disabled={loading}>
          <RefreshCw aria-hidden="true" />
          Refresh status
        </button>
        <button type="submit" disabled={loading || !deviceName.trim() || !agentDisplayName.trim()}>
          {loading ? <Loader variant="circular" size="sm" /> : <ShieldCheck aria-hidden="true" />}
          Enroll device and start agent
        </button>
      </div>
    </form>
  );
}

function ChannelList(props: {
  activeConversationId: string | null;
  conversations: Conversation[];
  directoryIssue: string | null;
  directoryLoading: boolean;
  directoryQuery: string;
  directoryResults: DirectoryUser[];
  error: string | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onSearchDirectory: (query: string) => void;
  onSelect: (conversationId: string) => void;
  onStartConversation: (user: DirectoryUser, agent?: AgentInstance) => Promise<void>;
  startingPeerId: string | null;
}) {
  const filteredConversations = props.directoryQuery.trim()
    ? props.conversations.filter((conversation) =>
        `${conversation.title} ${conversation.subtitle} ${conversation.lastMessage}`.toLowerCase().includes(props.directoryQuery.trim().toLowerCase())
      )
    : props.conversations;
  return (
    <aside className="stream-channel-list" aria-label="Contacts and conversations">
      <span hidden aria-label="Channel list" />
      <header className="stream-channel-list-header">
        <div>
          <strong>Channels</strong>
          <span>Agentic conversations</span>
        </div>
        <SidebarToggle className="sidebar-toggle--collapse" />
      </header>

      <label className="stream-channel-search">
        <Search aria-hidden="true" />
        <input
          aria-label="Search channels and directory"
          onChange={(event) => props.onSearchDirectory(event.currentTarget.value)}
          placeholder="Search channels or people"
          value={props.directoryQuery}
        />
      </label>

      <div className="stream-channel-list-content">
        <DirectorySearchPanel
          issue={props.directoryIssue}
          loading={props.directoryLoading}
          onStartConversation={props.onStartConversation}
          query={props.directoryQuery}
          results={props.directoryResults}
          startingPeerId={props.startingPeerId}
        />

        {props.loading && <StateNotice icon={<Loader variant="classic" size="md" />} title="Loading conversations" />}
        {!props.loading && props.conversations.length === 0 && (
          <StateNotice icon={<MessageCircle />} title="No channels yet" text="Create or receive a conversation to see it here." />
        )}
        {!props.loading && props.conversations.length > 0 && filteredConversations.length === 0 && props.directoryQuery.trim().length > 0 && (
          <StateNotice icon={<Search />} title="No matching channels" text="Directory results appear above when the control plane is connected." />
        )}
        {!props.loading && filteredConversations.map((conversation) => (
          <button
            key={conversation.id}
            type="button"
            className={`stream-channel-preview ${conversation.id === props.activeConversationId ? "is-active" : ""}`}
            onClick={() => props.onSelect(conversation.id)}
          >
            <span className={`stream-presence-dot ${conversation.presence}`} />
            <span className="stream-channel-preview-copy">
              <strong>{conversation.title}</strong>
              <small>{conversation.lastMessage || conversation.subtitle}</small>
            </span>
            <span className="stream-channel-meta">
              <small>{conversation.unread > 0 ? conversation.unread : formatConversationKind(conversation)}</small>
              <ChevronRight aria-hidden="true" />
            </span>
          </button>
        ))}
      </div>

      <footer className="stream-channel-list-footer">
        <button type="button" onClick={() => void props.onRefresh()}>
          {props.loading ? <Loader variant="circular" size="sm" /> : <RefreshCw aria-hidden="true" />}
          Refresh channels
        </button>
      </footer>
    </aside>
  );
}

function DirectorySearchPanel({
  issue,
  loading,
  onStartConversation,
  query,
  results,
  startingPeerId
}: {
  issue: string | null;
  loading: boolean;
  onStartConversation: (user: DirectoryUser, agent?: AgentInstance) => Promise<void>;
  query: string;
  results: DirectoryUser[];
  startingPeerId: string | null;
}) {
  const active = query.trim().length >= 2;
  if (!active && !issue) return null;
  return (
    <section className="directory-search-panel" aria-label="Directory search">
      <div className="directory-search-head">
        <strong>Directory</strong>
        {loading ? <Loader variant="circular" size="sm" /> : <span>{results.length} result{results.length === 1 ? "" : "s"}</span>}
      </div>
      {issue && <span className="directory-search-issue">{issue}</span>}
      {!loading && !issue && active && results.length === 0 && (
        <span className="directory-search-empty">No people or agents found.</span>
      )}
      {results.map((user) => (
        <DirectoryUserResult
          key={user.user_id}
          onStartConversation={onStartConversation}
          startingPeerId={startingPeerId}
          user={user}
        />
      ))}
    </section>
  );
}

function DirectoryUserResult({
  onStartConversation,
  startingPeerId,
  user
}: {
  onStartConversation: (user: DirectoryUser, agent?: AgentInstance) => Promise<void>;
  startingPeerId: string | null;
  user: DirectoryUser;
}) {
  const primaryAgent = user.agents?.[0];
  const peerId = primaryAgent?.agent_instance_id ?? user.user_id;
  const starting = startingPeerId === peerId;
  return (
    <article className="directory-result-card">
      <div className="directory-result-main">
        <span className={`stream-presence-dot ${user.presence ?? "unknown"}`} />
        <div>
          <strong>{user.display_name || user.email}</strong>
          <span>{user.email}</span>
          <small>{user.active_agent_instances} active agent{user.active_agent_instances === 1 ? "" : "s"}</small>
        </div>
      </div>
      <button type="button" onClick={() => void onStartConversation(user, primaryAgent)} disabled={starting}>
        {starting ? <Loader variant="circular" size="sm" /> : <MessageCircle aria-hidden="true" />}
        Start
      </button>
    </article>
  );
}

function ChannelWindow(props: {
  conversation: Conversation | null;
  approvalIssue: string | null;
  cloudStatus: CloudStatus | null;
  diagnostics: ChatDiagnostics | null;
  diagnosticsIssue: string | null;
  error: string | null;
  health: HealthStatus | null;
  cloudConnectLoading: boolean;
  loadingMessages: boolean;
  messages: TimelineMessage[];
  onApprovalDecision: (approvalId: string, decision: "approve" | "reject", feedback?: string) => Promise<void>;
  onConnectCloud: (input: CloudConnectInput) => Promise<void>;
  onReload: () => void | Promise<void>;
  onReconnectCloud: () => void | Promise<void>;
  onRefreshRelay: () => void | Promise<void>;
  onRetryMessage: (message: Extract<TimelineMessage, { kind: "human" }>) => Promise<void>;
  onSend: (text: string) => Promise<void>;
  onToggleThread: () => void;
  onUseLocalAgent: () => void;
  recoveryMessage: string | null;
  relayInboxStatus: RelayInboxStatus | null;
  relayIssue: RelayIssue | null;
  relayStatusLoading: boolean;
  threadOpen: boolean;
}) {
  return (
    <section className="stream-channel" aria-label={props.conversation ? `Conversation with ${props.conversation.title}` : "Conversation"}>
      <header className="stream-channel-header">
        <SidebarToggle className="sidebar-toggle--expand" />
        <ChatAvatar
          alt={props.conversation?.title ?? "Agentic Chat"}
          className="stream-channel-avatar"
          tone={avatarToneForConversation(props.conversation)}
        />
        <div className="stream-channel-title">
          <strong>{props.conversation?.title ?? "Select a channel"}</strong>
          <span>{props.conversation?.subtitle ?? "Choose a channel from the list"}</span>
        </div>
        <CommandStatusBar
          cloudStatus={props.cloudStatus}
          health={props.health}
          relayInboxStatus={props.relayInboxStatus}
        />
        <button type="button" className="stream-icon-button" aria-label={props.threadOpen ? "Close thread panel" : "Open thread panel"} onClick={props.onToggleThread}>
          <PanelRightOpen aria-hidden="true" />
        </button>
      </header>

      <div className="stream-channel-notices">
        {props.error && (
          <div className="stream-alert" role="alert">
            <AlertCircle aria-hidden="true" />
            <span>{props.error}</span>
          </div>
        )}

        {props.approvalIssue && (
          <div className="stream-alert stream-alert--warning" role="alert">
            <AlertTriangle aria-hidden="true" />
            <span>{props.approvalIssue}</span>
          </div>
        )}

        {props.conversation && !props.conversation.agentInstanceId && props.diagnosticsIssue && (
          <div className="stream-alert stream-alert--warning" role="status">
            <AlertTriangle aria-hidden="true" />
            <span>{props.diagnosticsIssue}</span>
          </div>
        )}

        {props.relayIssue && (
          <RelayHealthBanner
            issue={props.relayIssue}
            loading={props.relayStatusLoading}
            cloudConnectLoading={props.cloudConnectLoading}
            onConnectCloud={props.onConnectCloud}
            onReconnectCloud={props.onReconnectCloud}
            onRefreshRelay={props.onRefreshRelay}
            onUseLocalAgent={props.onUseLocalAgent}
            recoveryMessage={props.recoveryMessage}
          />
        )}
      </div>

      {props.conversation && !props.conversation.agentInstanceId && props.diagnostics?.agentRuns.active ? (
        <div className="local-agent-status" role="status">
          <Loader variant="typing" size="sm" />
          <span>{props.diagnostics.agentRuns.active} backend run{props.diagnostics.agentRuns.active === 1 ? "" : "s"} active</span>
        </div>
      ) : null}

      <MessageList
        loading={props.loadingMessages}
        messages={props.messages}
        onApprovalDecision={props.onApprovalDecision}
        onRetryMessage={props.onRetryMessage}
      />

      <MessageComposer
        disabled={!props.conversation || Boolean(props.relayIssue)}
        onSend={props.onSend}
      />
    </section>
  );
}

function CommandStatusBar({
  cloudStatus,
  health,
  relayInboxStatus
}: {
  cloudStatus: CloudStatus | null;
  health: HealthStatus | null;
  relayInboxStatus: RelayInboxStatus | null;
}) {
  const email = cloudStatus?.cloud.userEmail ?? "local only";
  const enrolled = cloudStatus?.cloud.status === "enrolled";
  const heartbeat = cloudStatus?.heartbeat.running;
  const relay = cloudStatus?.inbox.running && relayInboxStatus?.running !== false;
  return (
    <div className="command-status-bar" aria-label="Connection status">
      <StatusChip tone={health ? "online" : "offline"} label="Local agent" value={health?.status ?? "unknown"} />
      <StatusChip tone={enrolled ? "online" : "offline"} label="Profile" value={email} />
      <StatusChip tone={heartbeat ? "heartbeat" : "offline"} label="Heartbeat" value={heartbeat ? "active" : "stopped"} />
      <StatusChip tone={relay ? "relay" : "offline"} label="Relay polling" value={relay ? "active" : "stopped"} />
      <StatusChip tone="local" label="Notifications" value="local bridge" />
    </div>
  );
}

function StatusChip({ label, tone, value }: { label: string; tone: "online" | "offline" | "heartbeat" | "relay" | "local"; value: string }) {
  return (
    <span className={`command-status-chip command-status-chip--${tone}`}>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function RelayHealthBanner({
  cloudConnectLoading,
  issue,
  loading,
  onConnectCloud,
  onReconnectCloud,
  onRefreshRelay,
  onUseLocalAgent,
  recoveryMessage
}: {
  cloudConnectLoading: boolean;
  issue: RelayIssue;
  loading: boolean;
  onConnectCloud: (input: CloudConnectInput) => Promise<void>;
  onReconnectCloud: () => void | Promise<void>;
  onRefreshRelay: () => void | Promise<void>;
  onUseLocalAgent: () => void;
  recoveryMessage: string | null;
}) {
  return (
    <section className={`relay-health-banner relay-health-banner--${issue.tone}`} aria-label="Relay health warning">
      <AlertTriangle aria-hidden="true" />
      <div className="relay-health-copy">
        <strong>{issue.title}</strong>
        <span>{issue.message}</span>
        {recoveryMessage && <small>{recoveryMessage}</small>}
      </div>
      <div className="relay-health-actions">
        <button type="button" onClick={() => void onReconnectCloud()}>Reconnect cloud session</button>
        <button type="button" onClick={() => void onRefreshRelay()}>
          {loading ? <Loader variant="circular" size="sm" /> : <RefreshCw aria-hidden="true" />}
          Refresh relay status
        </button>
        <button type="button" onClick={onUseLocalAgent}>Use local agent</button>
      </div>
      <CloudConnectForm loading={cloudConnectLoading} onConnect={onConnectCloud} />
    </section>
  );
}

function CloudConnectForm({
  loading,
  onConnect
}: {
  loading: boolean;
  onConnect: (input: CloudConnectInput) => Promise<void>;
}) {
  const [mode, setMode] = useState<CloudConnectMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || !email.trim() || !password) return;
    await onConnect({
      mode,
      email: email.trim(),
      password,
      displayName: displayName.trim()
    });
  }

  return (
    <form className="cloud-connect-form" aria-label="Connect local agent to control plane" onSubmit={(event) => void submit(event)}>
      <div className="cloud-connect-mode" role="group" aria-label="Cloud connection mode">
        <button type="button" className={mode === "login" ? "is-active" : ""} onClick={() => setMode("login")}>Log in</button>
        <button type="button" className={mode === "signup" ? "is-active" : ""} onClick={() => setMode("signup")}>Sign up</button>
      </div>
      <input
        aria-label="Cloud email"
        autoComplete="email"
        inputMode="email"
        onChange={(event) => setEmail(event.currentTarget.value)}
        placeholder="email"
        type="email"
        value={email}
      />
      {mode === "signup" && (
        <input
          aria-label="Display name"
          autoComplete="name"
          onChange={(event) => setDisplayName(event.currentTarget.value)}
          placeholder="display name"
          type="text"
          value={displayName}
        />
      )}
      <input
        aria-label="Cloud password"
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        onChange={(event) => setPassword(event.currentTarget.value)}
        placeholder="password"
        type="password"
        value={password}
      />
      <button type="submit" disabled={loading || !email.trim() || !password}>
        {loading ? <Loader variant="circular" size="sm" /> : <Check aria-hidden="true" />}
        Connect and enroll
      </button>
    </form>
  );
}

function MessageList(props: {
  loading: boolean;
  messages: TimelineMessage[];
  onApprovalDecision: (approvalId: string, decision: "approve" | "reject", feedback?: string) => Promise<void>;
  onRetryMessage: (message: Extract<TimelineMessage, { kind: "human" }>) => Promise<void>;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const visibleMessages = props.messages.filter((message) => !isBackendTraceMessage(message));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [props.messages.length, props.loading]);

  return (
    <div className="stream-message-list" role="log" aria-live="polite" aria-relevant="additions text">
      {props.loading && <StateNotice icon={<Loader variant="loading-dots" text="Loading messages" size="md" />} title="Loading messages" />}
      {!props.loading && visibleMessages.length === 0 && (
        <StateNotice icon={<MessageCircle />} title="No messages yet" text="Start the conversation from the composer below." />
      )}
      {!props.loading && visibleMessages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          onApprovalDecision={props.onApprovalDecision}
          onRetryMessage={props.onRetryMessage}
          traceMessages={backendTraceForMessage(message, props.messages)}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function MessageBubble({
  message,
  onApprovalDecision,
  onRetryMessage,
  traceMessages
}: {
  message: TimelineMessage;
  onApprovalDecision: (approvalId: string, decision: "approve" | "reject", feedback?: string) => Promise<void>;
  onRetryMessage: (message: Extract<TimelineMessage, { kind: "human" }>) => Promise<void>;
  traceMessages: Extract<TimelineMessage, { kind: "agent_status" }>[];
}) {
  const human = message.kind === "human";
  return (
    <article className={`stream-message ${human ? "is-human" : "is-agent"} ${message.kind === "human" && message.delivery_status === "failed" ? "is-failed" : ""}`}>
      <ChatAvatar
        alt={human ? "You" : messageAuthor(message)}
        className="stream-message-avatar"
        tone={avatarToneForMessage(message)}
      />
      <div className="stream-message-body">
        <div className="stream-message-head">
          <strong>{human ? "You" : messageAuthor(message)}</strong>
          <span>{formatMessageTime(message)}</span>
        </div>
        <p>{messageText(message)}</p>
        {!human && messageActivityLoader(message)}
        {!human && message.kind === "approval" && (
          <ApprovalCard message={message} onDecision={onApprovalDecision} />
        )}
        {!human && traceMessages.length > 0 && <BackendTraceChain traceMessages={traceMessages} />}
        {message.kind === "human" && (
          <div className="stream-delivery-state">
            {deliveryIcon(message.delivery_status)}
            <span>{message.delivery_status.replace(/_/g, " ")}</span>
            {message.delivery_status === "failed" && (
              <button type="button" onClick={() => void onRetryMessage(message)}>Retry</button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function ApprovalCard({
  message,
  onDecision
}: {
  message: Extract<TimelineMessage, { kind: "approval" }>;
  onDecision: (approvalId: string, decision: "approve" | "reject", feedback?: string) => Promise<void>;
}) {
  const [feedback, setFeedback] = useState("");
  const [pendingDecision, setPendingDecision] = useState<"approve" | "reject" | null>(null);
  const terminal = ["approved", "rejected", "expired"].includes(message.card.status);

  async function decide(decision: "approve" | "reject") {
    if (terminal || pendingDecision) return;
    setPendingDecision(decision);
    try {
      await onDecision(message.card.approval_id, decision, feedback);
    } finally {
      setPendingDecision(null);
    }
  }

  return (
    <section className="approval-card" aria-label="Approval Center">
      <div className="approval-card-head">
        <div>
          <strong>Approval Center</strong>
          <span>Approving will send this exact file to this exact agent.</span>
        </div>
        <span className={`approval-status approval-status--${message.card.status}`}>{message.card.status.replace(/_/g, " ")}</span>
      </div>
      <FileResultList candidates={message.card.candidates} status={message.card.status} />
      <label className="approval-feedback">
        <span>Feedback refines search before approval</span>
        <textarea
          disabled={terminal || Boolean(pendingDecision)}
          onChange={(event) => setFeedback(event.currentTarget.value)}
          placeholder="Ask the agent to search again with more context..."
          value={feedback}
        />
      </label>
      <div className="approval-actions">
        <button type="button" onClick={() => void decide("reject")} disabled={terminal || Boolean(pendingDecision)}>
          {pendingDecision === "reject" ? <Loader variant="circular" size="sm" /> : <X aria-hidden="true" />}
          Reject
        </button>
        <button type="button" className="approval-actions-primary" onClick={() => void decide("approve")} disabled={terminal || Boolean(pendingDecision)}>
          {pendingDecision === "approve" ? <Loader variant="circular" size="sm" /> : <Check aria-hidden="true" />}
          Approve exact file
        </button>
      </div>
    </section>
  );
}

function BackendTraceChain({ traceMessages }: { traceMessages: Extract<TimelineMessage, { kind: "agent_status" }>[] }) {
  const groups = groupedTraceSteps(traceMessages);
  const streaming = traceMessages.some((message) => String(message.details?.run_status ?? "").toLowerCase() === "running");
  const durationMs = traceMessages.reduce((total, message) => total + (numberDetail(message, "duration_ms") ?? 0), 0);
  return (
    <div className="backend-trace-chain" aria-label="Backend trace">
      <div className="backend-trace-chain-head">
        <span>{streaming ? "Processing request" : "Processed request"}</span>
        <small>{formatDuration(durationMs)}</small>
      </div>
      <ChainOfThought className="backend-trace-steps">
        {groups.map((group, index) => (
          <ChainOfThoughtStep key={group.id} className="backend-trace-step" defaultOpen={streaming || index === groups.length - 1}>
            <ChainOfThoughtTrigger
              className="backend-trace-trigger"
              leftIcon={traceGroupIcon(group)}
              swapIconOnHover={false}
            >
              {group.title}
            </ChainOfThoughtTrigger>
            <ChainOfThoughtContent className="backend-trace-content">
              {group.items.map((item) => (
                <ChainOfThoughtItem key={item.label} className="backend-trace-item">
                  <span>{item.label}</span>
                  <code>{item.value}</code>
                </ChainOfThoughtItem>
              ))}
              {group.terminalOutput && (
                <div className="backend-terminal" aria-label={`${group.title} terminal output`}>
                  <div className="backend-terminal-head">
                    <span>Terminal</span>
                    {group.isStreaming && <Loader variant="terminal" size="sm" />}
                  </div>
                  <pre>{group.terminalOutput}</pre>
                </div>
              )}
            </ChainOfThoughtContent>
          </ChainOfThoughtStep>
        ))}
      </ChainOfThought>
    </div>
  );
}

function FileResultList({ candidates, status }: { candidates: CandidateFile[]; status: string }) {
  if (candidates.length === 0) return null;
  return (
    <div className="file-result-list" aria-label="File search results">
      {candidates.slice(0, 3).map((candidate) => (
        <FileResultCard key={candidate.candidate_id} candidate={candidate} status={status} />
      ))}
    </div>
  );
}

function FileResultCard({ candidate, status }: { candidate: CandidateFile; status: string }) {
  const extension = candidate.extension.toLowerCase();
  const Icon = ["ppt", "pptx"].includes(extension) ? Presentation : FileText;
  const previewUrl = safeExternalHref(candidate.preview_url);
  return (
    <div className="file-result-card">
      <div className={`file-result-icon file-result-icon--${["ppt", "pptx"].includes(extension) ? "presentation" : "document"}`}>
        <Icon aria-hidden="true" />
      </div>
      <div className="file-result-copy">
        <strong>{candidate.file_name}</strong>
        <span>{fileKindLabel(candidate)} · {formatBytes(candidate.size_bytes)} · {Math.round(candidate.match_score * 100)}% match</span>
        <small>{candidate.display_path}</small>
      </div>
      <div className="file-result-actions">
        <span>{status.replace(/_/g, " ")}</span>
        {previewUrl && (
          <a href={previewUrl} target="_blank" rel="noreferrer" aria-label={`Open preview for ${candidate.file_name}`}>
            <ExternalLink aria-hidden="true" />
          </a>
        )}
      </div>
    </div>
  );
}

function MessageComposer({ disabled, onSend }: { disabled: boolean; onSend: (text: string) => Promise<void> }) {
  const [draft, setDraft] = useState("");
  const [sendState, setSendState] = useState<SendState>("idle");
  const [files, setFiles] = useState<File[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const looksLikeFileRequest = isFileRequest(draft);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [draft]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if ((!text && files.length === 0) || disabled || sendState === "sending") return;
    setSendState("sending");
    try {
      await onSend(text || files.map((file) => file.name).join(", "));
      setDraft("");
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setSendState("idle");
    }
  }

  function addFiles(_fileList: FileList | null) {
    setFiles([]);
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, currentIndex) => currentIndex !== index));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <form className="stream-message-composer" aria-label="Message composer" onSubmit={(event) => void submit(event)}>
      {looksLikeFileRequest && <div className="stream-composer-hint"><FileCheck /> File-request detected</div>}
      <div
        className={`prompt-input-shell ${disabled ? "is-disabled" : ""}`}
        onClick={() => {
          if (!disabled) textareaRef.current?.focus();
        }}
      >
        {files.length > 0 && (
          <div className="prompt-file-list" aria-label="Attached files">
            {files.map((file, index) => (
              <span key={`${file.name}-${index}`} className="prompt-file-chip" onClick={(event) => event.stopPropagation()}>
                <Paperclip aria-hidden="true" />
                <span>{file.name}</span>
                <button type="button" aria-label={`Remove ${file.name}`} onClick={() => removeFile(index)}>
                  <X aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          aria-label="Message"
          disabled={disabled}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={disabled ? "Select a channel to start chatting" : "Message a person or agent"}
          value={draft}
        />
        <div className="prompt-input-actions">
          <label className="prompt-action-button is-disabled" title="Direct attachment is not enabled; use /request-file for approval-backed transfer" aria-label="Direct attachment is not enabled">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              disabled
              onChange={(event) => addFiles(event.currentTarget.files)}
            />
            <Paperclip aria-hidden="true" />
          </label>
          <button
            type="submit"
            className="prompt-send-button"
            title={sendState === "sending" ? "Stop generation" : "Send message"}
            aria-label={sendState === "sending" ? "Stop generation" : "Send message"}
            disabled={disabled || (!draft.trim() && files.length === 0)}
          >
            {sendState === "sending" ? <Loader variant="circular" size="sm" /> : <ArrowUp aria-hidden="true" />}
          </button>
        </div>
      </div>
    </form>
  );
}

function ThreadPanel({
  cloudStatus,
  conversation,
  diagnostics,
  messages,
  onClose,
  onRefreshFiles,
  open,
  storedFileIssue,
  storedFiles
}: {
  cloudStatus: CloudStatus | null;
  conversation: Conversation | null;
  diagnostics: ChatDiagnostics | null;
  messages: TimelineMessage[];
  onClose: () => void;
  onRefreshFiles: () => Promise<void>;
  open: boolean;
  storedFileIssue: string | null;
  storedFiles: StoredFile[];
}) {
  const traceMessages = messages.filter(isBackendTraceMessage);
  const workflowMessages = messages.filter((message) => ["file_request", "approval", "transfer", "receipt", "a2a_task"].includes(message.kind)).slice(-8);
  return (
    <aside className={`stream-thread-panel ${open ? "is-open" : ""}`} aria-label="Conversation details" aria-hidden={!open}>
      <span hidden aria-label="Right inspector panel" />
      <header>
        <div>
          <strong>Inspector</strong>
          <span>{conversation?.title ?? "No channel selected"}</span>
        </div>
        <button type="button" aria-label="Close thread panel" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </header>
      <div className="inspector-panel">
        <section className="inspector-section">
          <strong>Agent card panel</strong>
          <span>{cloudStatus?.cloud.agentInstanceId ?? conversation?.agentInstanceId ?? "Local agent"}</span>
          <div className="settings-policy-list" aria-label="Configured safety policy">
            <div>
              <ShieldCheck aria-hidden="true" />
              <span>Configured safety policy</span>
              <strong>Read-only</strong>
            </div>
            <div>
              <FileCheck aria-hidden="true" />
              <span>Approval before file transfer</span>
              <strong>Required</strong>
            </div>
          </div>
        </section>

        <section className="inspector-section">
          <div className="inspector-section-head">
            <strong>Approval Center</strong>
            <span>{messages.filter((message) => message.kind === "approval").length} cards</span>
          </div>
          {workflowMessages.length > 0 ? (
            <ol className="task-timeline-panel" aria-label="Task timeline panel">
              {workflowMessages.map((message) => (
                <li key={message.id}>
                  <small>{message.kind.replace(/_/g, " ")}</small>
                  <span>{messageText(message)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <span className="inspector-empty">No approval or transfer workflow yet.</span>
          )}
        </section>

        <section className="inspector-section">
          <div className="inspector-section-head">
            <strong>Received files</strong>
            <button type="button" onClick={() => void onRefreshFiles()}>
              <RefreshCw aria-hidden="true" />
              Refresh
            </button>
          </div>
          {storedFileIssue && <span className="inspector-error">{storedFileIssue}</span>}
          {storedFiles.length === 0 ? (
            <span className="inspector-empty">No received files yet.</span>
          ) : (
            <ul className="stored-file-list">
              {storedFiles.map((file) => (
                <ReceivedFileItem key={file.id} file={file} />
              ))}
            </ul>
          )}
        </section>
      </div>
      {traceMessages.length > 0 ? (
        <div className="backend-trace-panel">
          <strong>Backend trace</strong>
          {diagnostics && (
            <span>{diagnostics.agentRuns.active} active run{diagnostics.agentRuns.active === 1 ? "" : "s"} · {diagnostics.fileSearch.rootCount} file roots</span>
          )}
          <ol>
            {traceMessages.slice(-12).map((message) => (
              <li key={message.id}>
                <small>{String(message.details?.execution_target ?? message.phase)}</small>
                <span>{message.status_text}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="stream-thread-empty">
          <MessageCircle aria-hidden="true" />
          <strong>No backend trace yet</strong>
          <span>{messages.length} message{messages.length === 1 ? "" : "s"} in this channel</span>
        </div>
      )}
    </aside>
  );
}

function ReceivedFileItem({ file }: { file: StoredFile }) {
  const [verification, setVerification] = useState<string | null>(null);

  async function verify() {
    try {
      const result = await api.verifyFile(file.id);
      setVerification(result.hash_verified ? "Hash verified" : "Hash mismatch");
    } catch (err) {
      setVerification(err instanceof Error ? err.message : "Verification failed");
    }
  }

  return (
    <li className="stored-file-item">
      <div>
        <strong>{file.originalFileName}</strong>
        <span>{formatBytes(file.sizeBytes)} · {new Date(file.receivedAt).toLocaleString()}</span>
        <small>SHA-256 {file.sha256.slice(0, 12)}... · Local path hidden</small>
        {verification && <small>{verification}</small>}
      </div>
      <div className="stored-file-actions">
        <a href={`/storage/files/${encodeURIComponent(file.id)}/open`} target="_blank" rel="noreferrer" aria-label={`Open ${file.originalFileName}`}>
          <FolderOpen aria-hidden="true" />
        </a>
        <a href={`/storage/files/${encodeURIComponent(file.id)}/download`} aria-label={`Download ${file.originalFileName}`}>
          <Download aria-hidden="true" />
        </a>
        <button type="button" onClick={() => void verify()} aria-label={`Verify hash for ${file.originalFileName}`}>
          <ShieldCheck aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

function StateNotice({ icon, title, text }: { icon: React.ReactNode; title: string; text?: string }) {
  return (
    <div className="stream-state-notice">
      {icon}
      <strong>{title}</strong>
      {text && <span>{text}</span>}
    </div>
  );
}

function relayIssueFor(
  conversation: Conversation | null,
  cloudStatus: CloudStatus | null,
  relayInboxStatus: RelayInboxStatus | null,
  cloudAuthError: string | null,
  health: HealthStatus | null
): RelayIssue | null {
  if (!conversation?.agentInstanceId) return null;
  if (!health) {
    return {
      title: "Local backend status unknown",
      message: "The local agent has not confirmed its health yet. Refresh relay status before sending to this relay peer.",
      tone: "warning"
    };
  }
  if (!cloudStatus) {
    return {
      title: "Cloud status unavailable",
      message: "The local agent cannot read cloud enrollment status. Refresh relay status or reconnect the cloud session.",
      tone: "danger"
    };
  }
  if (cloudStatus.cloud.status !== "enrolled" || !cloudStatus.cloud.hasDeviceAccessToken) {
    return {
      title: "Cloud enrollment required",
      message: "This relay conversation needs an enrolled device token before messages can be sent.",
      tone: "danger"
    };
  }
  if (cloudAuthError) {
    return {
      title: "Cloud session needs reconnect",
      message: `The saved cloud session was rejected: ${cloudAuthError}. Log in and enroll again before sending to this relay peer.`,
      tone: "danger"
    };
  }
  if (cloudStatus.controlPlane?.status === "unreachable") {
    return {
      title: "Control plane unreachable",
      message: `This agent is enrolled against ${cloudStatus.controlPlane.savedUrl}, but that control plane is not reachable (${cloudStatus.controlPlane.message ?? "connection failed"}). Reconnect or enroll against ${cloudStatus.controlPlane.configuredUrl} so admin presence can update.`,
      tone: "danger"
    };
  }
  if (cloudStatus.controlPlane?.status === "mismatch") {
    return {
      title: "Control plane mismatch",
      message: cloudStatus.controlPlane.message ?? `This agent is enrolled against ${cloudStatus.controlPlane.savedUrl}, not ${cloudStatus.controlPlane.configuredUrl}.`,
      tone: "warning"
    };
  }
  if (!cloudStatus.heartbeat.running) {
    return {
      title: "Relay heartbeat is stopped",
      message: cloudStatus.heartbeat.lastError
        ? `Heartbeat is stopped: ${cloudStatus.heartbeat.lastError}`
        : "Heartbeat is not running, so the peer may see this device as offline.",
      tone: "warning"
    };
  }
  if (!cloudStatus.inbox.running || relayInboxStatus?.running === false) {
    return {
      title: "Relay inbox polling is stopped",
      message: relayInboxStatus?.lastError ?? cloudStatus.inbox.lastError ?? "Inbox polling is not running, so relay task responses cannot be received.",
      tone: "warning"
    };
  }
  if (cloudStatus.heartbeat.lastError || cloudStatus.inbox.lastError || relayInboxStatus?.lastError) {
    return {
      title: "Relay runtime has errors",
      message: cloudStatus.heartbeat.lastError ?? cloudStatus.inbox.lastError ?? relayInboxStatus?.lastError ?? "Relay runtime reported an error.",
      tone: "warning"
    };
  }
  return null;
}

function isRelayUnavailable(details: unknown): boolean {
  return Boolean(details && typeof details === "object" && "relay_unavailable" in details);
}

function relayFailureMessage(error: ApiRequestError): string {
  const details = error.details;
  if (details && typeof details === "object" && "message" in details && typeof details.message === "string") {
    return error.status === 401 || error.status === 403
      ? `Relay/auth unavailable: ${details.message}. Reconnect cloud session before retrying.`
      : `Relay unavailable: ${details.message}`;
  }
  return error.status === 401 || error.status === 403
    ? "Relay/auth unavailable. Reconnect cloud session before retrying."
    : error.message;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ChatAvatar({
  alt,
  className,
  tone
}: {
  alt: string;
  className: string;
  tone: string;
}) {
  return (
    <Avatar aria-label={alt} className={className}>
      <Avatar.Fallback>
        <span className={`abstract-avatar abstract-avatar--${tone}`} />
      </Avatar.Fallback>
    </Avatar>
  );
}

function createHumanMessage(conversationId: string, text: string): Extract<TimelineMessage, { kind: "human" }> {
  return {
    kind: "human",
    id: crypto.randomUUID(),
    conversation_id: conversationId,
    sender_user_id: null,
    sender_agent_instance_id: null,
    receiver_agent_instance_id: null,
    text,
    created_at: new Date().toISOString(),
    delivery_status: "local_pending"
  };
}

function createAgentStatus(taskId: string, text: string, phase: string): Extract<TimelineMessage, { kind: "agent_status" }> {
  return {
    kind: "agent_status",
    id: crypto.randomUUID(),
    task_id: taskId,
    status_text: text,
    phase,
    created_at: new Date().toISOString()
  };
}

function createLocalConversation(): Conversation {
  return {
    id: "local-agent",
    title: "My local agent",
    subtitle: "Local personal agent",
    agentInstanceId: null,
    presence: "online",
    unread: 0,
    lastMessage: "Ask for help, request files, or inspect local diagnostics.",
    pendingApprovals: 0,
    transferCount: 0,
    messages: []
  };
}

function updateConversationPreview(conversations: Conversation[], conversationId: string, text: string): Conversation[] {
  return conversations.map((conversation) =>
    conversation.id === conversationId
      ? { ...conversation, lastMessage: text, messages: [...conversation.messages] }
      : conversation
  );
}

function isFileRequest(text: string): boolean {
  return /^\/request-file\b/i.test(text) || /\b(find|send|share|get|request)\b.*\b(file|pdf|invoice|document|report|spreadsheet)\b/i.test(text);
}

type AgentStatusTimelineMessage = Extract<TimelineMessage, { kind: "agent_status" }>;
type TraceGroup = {
  id: string;
  title: string;
  status: string;
  isStreaming: boolean;
  items: { label: string; value: string }[];
  terminalOutput?: string;
};

function isBackendTraceMessage(message: TimelineMessage): message is AgentStatusTimelineMessage {
  if (message.kind !== "agent_status") return false;
  if (typeof message.details?.run_id !== "string") return false;
  return (
    typeof message.details.step_id === "string" ||
    typeof message.details.final_status === "string" ||
    typeof message.details.execution_target === "string" ||
    typeof message.details.command_count === "number"
  );
}

function runIdForMessage(message: TimelineMessage): string | null {
  if ((message.kind === "agent_status" || message.kind === "file_request") && typeof message.details?.run_id === "string") {
    return message.details.run_id;
  }
  return null;
}

function backendTraceForMessage(message: TimelineMessage, messages: TimelineMessage[]): AgentStatusTimelineMessage[] {
  const runId = runIdForMessage(message);
  if (!runId || message.kind === "human") return [];
  return messages.filter(
    (candidate): candidate is AgentStatusTimelineMessage =>
      isBackendTraceMessage(candidate) && candidate.details?.run_id === runId
  );
}

function groupedTraceSteps(traceMessages: AgentStatusTimelineMessage[]): TraceGroup[] {
  const analysis = traceMessages.filter((message) => stringDetail(message, "execution_target") === "agent-orchestrator" || stringDetail(message, "execution_target") === "oci-llm");
  const search = traceMessages.filter((message) => stringDetail(message, "execution_target") === "host-file-search" || stringDetail(message, "command"));
  const final = traceMessages.filter((message) => stringDetail(message, "final_status"));
  const groups = [
    buildTraceGroup("analysis", "Analyzing the request", analysis.length ? analysis : traceMessages.slice(0, 1)),
    buildTraceGroup("search", "Searching local files", search),
    buildTraceGroup("result", "Preparing result", final.length ? final : traceMessages.slice(-1))
  ];
  return groups.filter((group) => group.items.length > 0 || group.terminalOutput);
}

function buildTraceGroup(id: string, title: string, messages: AgentStatusTimelineMessage[]): TraceGroup {
  const durationMs = messages.reduce((total, message) => total + (numberDetail(message, "duration_ms") ?? 0), 0);
  const running = messages.some((message) => (stringDetail(message, "step_status") ?? stringDetail(message, "run_status") ?? "").toLowerCase() === "running");
  const failed = messages.some((message) => ["failed", "error"].includes((stringDetail(message, "step_status") ?? stringDetail(message, "run_status") ?? "").toLowerCase()));
  const completed = messages.length > 0 && messages.every((message) => ["completed", "skipped", "partial"].includes((stringDetail(message, "step_status") ?? stringDetail(message, "run_status") ?? "").toLowerCase()));
  const finalStatus = messages.map((message) => stringDetail(message, "final_status")).find(Boolean);
  const outputs = messages
    .map((message) => terminalLineForTrace(message))
    .filter((line): line is string => Boolean(line))
    .slice(-8)
    .join("\n");
  const summary = messages
    .map((message) => sanitizeTraceValue(message.status_text))
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
    .slice(-3)
    .join(" | ");
  const status = running ? "running" : failed ? "failed" : completed ? "completed" : "completed";
  return {
    id,
    title,
    status,
    isStreaming: running,
    items: [
      { label: "Status", value: finalStatus ? finalStatus.replace(/_/g, " ") : status },
      { label: "Duration", value: formatDuration(durationMs) },
      { label: "Summary", value: summary }
    ].filter((item) => item.value),
    terminalOutput: outputs || undefined
  };
}

function terminalLineForTrace(message: AgentStatusTimelineMessage): string | null {
  const command = stringDetail(message, "command");
  const stdout = stringDetail(message, "stdout");
  const stderr = stringDetail(message, "stderr");
  if (!command && !stdout && !stderr) return null;
  const parts = [
    command ? `> ${command}` : null,
    stdout ? sanitizeTraceValue(stdout) : null,
    stderr ? `ERROR: ${sanitizeTraceValue(stderr)}` : null
  ];
  return parts.filter(Boolean).join("\n");
}

function traceGroupIcon(group: TraceGroup) {
  if (["failed", "error"].includes(group.status)) return <AlertTriangle className="backend-trace-icon is-failed" aria-hidden="true" />;
  if (["completed", "skipped"].includes(status)) return <Check className="backend-trace-icon is-complete" aria-hidden="true" />;
  if (group.id === "search") return <Loader variant="terminal" size="sm" className="backend-trace-loader" />;
  return <Loader variant="text-shimmer" text="" size="sm" className="backend-trace-loader" />;
}

function stringDetail(message: AgentStatusTimelineMessage, key: string): string | null {
  const value = message.details?.[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function numberDetail(message: AgentStatusTimelineMessage, key: string): number | null {
  const value = message.details?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function truncateTraceValue(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 360 ? `${normalized.slice(0, 357)}...` : normalized;
}

function sanitizeTraceValue(value: string): string {
  return truncateTraceValue(value.replace(/[A-Za-z]:\\[^\r\n"]*?([^\\\r\n"]+\.[A-Za-z0-9]{1,8})/g, "$1"));
}

function formatDuration(ms: number): string {
  if (!ms) return "live";
  if (ms < 1000) return `${ms} ms`;
  return `${Math.ceil(ms / 1000)} sec`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileKindLabel(candidate: CandidateFile): string {
  const extension = candidate.extension.toLowerCase();
  if (["ppt", "pptx"].includes(extension)) return "PowerPoint Presentation";
  if (extension === "pdf") return "PDF document";
  return extension ? `${extension.toUpperCase()} file` : candidate.mime_type;
}

function messageText(message: TimelineMessage): string {
  if (message.kind === "human") return message.text;
  if (message.kind === "agent_status") return message.status_text;
  if (message.kind === "system_event") return message.text;
  if (message.kind === "file_request") return message.natural_language_request;
  if (message.kind === "approval") return message.card.request_text;
  if (message.kind === "transfer") return `${message.file_name} is ${message.status} (${message.progress_percent}%).`;
  if (message.kind === "receipt") return `${message.file_name} receipt ${message.hash_verified ? "verified" : "needs review"}.`;
  if (message.kind === "thinking_bar") return message.state.summary;
  return `${message.task_id} is ${message.internal_state}.`;
}

function messageActivityLoader(message: TimelineMessage) {
  if (message.kind === "agent_status") {
    const phase = message.phase.toLowerCase();
    if (["typing", "thinking", "ready", "sent", "delivered"].includes(phase)) {
      return <ActivityLoader label="Agent working" loader={<Loader variant="typing" size="md" className="stream-message-loader" />} />;
    }
    if (["analyzing", "searching", "verifying"].includes(phase)) {
      return <ActivityLoader label={phase === "searching" ? "Searching files" : "Analyzing"} loader={<Loader variant="text-shimmer" text={message.status_text} size="sm" className="stream-message-loader" />} />;
    }
    if (["transferring", "uploading", "downloading"].includes(phase)) {
      return <ActivityLoader label="Transferring" loader={<Loader variant="bars" size="md" className="stream-message-loader" />} />;
    }
    if (["terminal", "tool", "executing"].includes(phase)) {
      return <ActivityLoader label="Running tool" loader={<Loader variant="terminal" size="sm" className="stream-message-loader" />} />;
    }
    if (["input_required", "approval_pending", "waiting", "pending"].includes(phase)) {
      return <ActivityLoader label="Awaiting approval" loader={<Loader variant="pulse" size="sm" className="stream-message-loader" />} />;
    }
  }
  if (message.kind === "approval" && ["pending", "feedback_requested", "feedback"].includes(message.card.status)) {
    return <ActivityLoader label="Awaiting approval" loader={<Loader variant="pulse" size="sm" className="stream-message-loader" />} />;
  }
  if (message.kind === "transfer" && ["preparing", "uploading", "downloading", "verifying"].includes(message.status)) {
    return <ActivityLoader label="Transfer in progress" loader={<Loader variant="bars" size="md" className="stream-message-loader" />} />;
  }
  if (message.kind === "file_request") {
    const status = message.status.toLowerCase();
    const finalStatuses = ["complete", "failed", "rejected", "not_found", "need_help", "expired"];
    if (finalStatuses.includes(status)) return null;
    if (["submitted", "local_pending", "sent", "searching", "working", "running"].includes(status)) {
      return <ActivityLoader label="Finding files" loader={<Loader variant="terminal" size="sm" className="stream-message-loader" />} />;
    }
    if (["approval_pending", "pending", "input_required"].includes(status)) {
      return <ActivityLoader label="Awaiting approval" loader={<Loader variant="pulse" size="sm" className="stream-message-loader" />} />;
    }
  }
  return null;
}

function ActivityLoader({ label, loader }: { label: string; loader: React.ReactNode }) {
  return (
    <div className="stream-activity-loader">
      {loader}
      <span>{label}</span>
    </div>
  );
}

function messageAuthor(message: TimelineMessage): string {
  if (message.kind === "approval") return "Approval";
  if (message.kind === "transfer") return "Transfer";
  if (message.kind === "receipt") return "Receipt";
  if (message.kind === "system_event") return "System";
  return "Agent";
}

function deliveryIcon(status: string) {
  if (status === "failed") return <WifiOff aria-hidden="true" />;
  if (status === "local_pending") return <Clock3 aria-hidden="true" />;
  return <Check aria-hidden="true" />;
}

function formatMessageTime(message: TimelineMessage): string {
  const value = message.kind === "receipt" ? message.received_at : message.created_at;
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatConversationKind(conversation: Conversation): string {
  if (conversation.pendingApprovals > 0) return `${conversation.pendingApprovals} review`;
  if (conversation.transferCount > 0) return `${conversation.transferCount} files`;
  return conversation.presence;
}

function avatarToneForConversation(conversation: Conversation | null): string {
  if (!conversation) return "aqua";
  const tones = ["aqua", "violet", "coral", "blue", "rose"];
  return tones[hashSeed(conversation.id || conversation.title) % tones.length];
}

function avatarToneForMessage(message: TimelineMessage): string {
  if (message.kind === "human") return "coral";
  if (message.kind === "approval") return "violet";
  if (message.kind === "transfer" || message.kind === "receipt") return "aqua";
  if (message.kind === "system_event") return "blue";
  return "rose";
}

function hashSeed(value: string): number {
  let total = 0;
  for (const char of value) total += char.charCodeAt(0);
  return total % 12 + 1;
}
