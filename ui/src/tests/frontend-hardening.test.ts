/// <reference types="vitest/globals" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ApiRequestError, request } from "../api/localAgentClient";
import { safeExternalHref } from "../lib/safeUrl";
import { safeDisplayText } from "../lib/safeText";

const ROOT = resolve(__dirname, "../../..");

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("localAgentClient", () => {
  it("does not add JSON content type to bodyless GET requests", async () => {
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.has("Content-Type")).toBe(false);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(request<{ ok: boolean }>("/health")).resolves.toEqual({ ok: true });
  });

  it("returns undefined for empty successful responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));

    await expect(request<void>("/cloud/logout")).resolves.toBeUndefined();
  });

  it("preserves structured backend errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: "relay_unavailable", message: "Relay unavailable", relay_unavailable: true }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    )));

    await expect(request("/relay/send-message")).rejects.toMatchObject({
      name: "ApiRequestError",
      status: 503,
      message: "Relay unavailable",
      details: { error: "relay_unavailable", relay_unavailable: true }
    } satisfies Partial<ApiRequestError>);
  });
});

describe("frontend hardening source contracts", () => {
  it("blocks unsafe clickable URL schemes", () => {
    expect(safeExternalHref("javascript:alert(1)")).toBeUndefined();
    expect(safeExternalHref("data:text/html,<svg onload=alert(1)>")).toBeUndefined();
    expect(safeExternalHref("//evil.example/path")).toBeUndefined();
    expect(safeExternalHref("/storage/files/abc/open")).toBe("/storage/files/abc/open");
    expect(safeExternalHref("https://example.com/docs")).toBe("https://example.com/docs");

    const agentSources = read("ui/src/components/agentic-ai/AgentSources.tsx");
    const streamLike = read("ui/src/components/StreamLikeChat.tsx");
    const sharedSource = read("components/ui/source.tsx");
    const aiSources = read("src/components/ai/sources.tsx");
    expect(`${agentSources}\n${streamLike}\n${sharedSource}\n${aiSources}`).toContain("safeExternalHref");
    expect(agentSources).not.toContain("href={source.url}");
    expect(streamLike).not.toContain("href={candidate.preview_url}");
  });

  it("renders Shiki output as React tokens without raw HTML injection", () => {
    const shared = read("components/ui/code-block.tsx");
    const ai = read("src/components/ai/code-block.tsx");
    for (const source of [shared, ai]) {
      expect(source).toContain("codeToTokens");
      expect(source).toContain("renderTokenLines");
      expect(source).not.toContain("dangerouslySetInnerHTML");
      expect(source).not.toContain("codeToHtml");
    }
  });

  it("keeps local thread reply text out of persistent storage", () => {
    const threads = read("ui/src/lib/messageThreads.ts");
    const drawer = read("ui/src/components/stream-like/ThreadDrawer.tsx");
    expect(threads).toContain("replyTextById");
    expect(threads).toContain("migrateThreadStorage();");
    expect(threads).toContain("StoredThreadReply");
    expect(threads).toContain("function writeMap(map: StoredThreadMap)");
    expect(threads).toContain("REPLY_CONTENT_PLACEHOLDER");
    expect(drawer).toContain("full reply text stays in this browser session only");
  });

  it("migrates queued messages without persisting full retry text", () => {
    const hooks = read("ui/src/hooks/queries.ts");
    expect(hooks).toContain("function migrateQueueStorage");
    expect(hooks).toContain("migrateQueueStorage();");
    expect(hooks).toContain("textPreview");
    expect(hooks).toContain("queuedMessageText");
    expect(hooks).not.toContain("text: text");
  });

  it("cleans up frontend async error paths", () => {
    const hooks = read("ui/src/hooks/queries.ts");
    const voice = read("apps/voice-launcher/src/hooks/useHoldToTalk.ts");
    const legacyPanel = read("components/ui/agent-chat-panel.tsx");
    const admin = read("ui-admin/src/portal/PortalApp.tsx");

    expect(hooks).toContain("source.onerror = () =>");
    expect(hooks).toContain("source.close();");
    expect(voice).toContain("hideTimerRef");
    expect(voice).toContain("clearHideTimer");
    expect(legacyPanel).toContain("setMessagesIfMounted");
    expect(admin).toContain("clipboard.writeText(\"\")");
    expect(admin).toContain("clipboard contents may remain visible");
  });

  it("guards remaining URL and async lifecycle edges", () => {
    const redaction = read("ui/src/features/approvals/RedactionEditor.tsx");
    const audit = read("components/ui/audit-timeline.tsx");
    const transfer = read("components/ui/transfer-status.tsx");
    const runs = read("ui/src/components/agentic-ai/useAgentRunEvents.ts");
    const prompt = read("src/components/ai/prompt-input.tsx");
    const webPreview = read("src/components/ai/web-preview.tsx");
    const attachments = read("src/components/ai/attachments.tsx");
    const message = read("src/components/ai/message.tsx");
    const safeUrl = read("lib/safeUrl.ts");
    const image = read("components/ui/image.tsx");
    const realtime = read("ui/src/realtime/RealtimeTransport.ts");
    const legacyChat = read("ui/src/components/StreamLikeChat.tsx");
    const admin = read("ui-admin/src/portal/PortalApp.tsx");
    expect(redaction).toContain("safeExternalHref");
    expect(redaction).not.toContain("href={apply.data.job.downloadUrl}");
    expect(`${audit}\n${transfer}`).toContain("AbortController");
    expect(`${audit}\n${transfer}`).toContain("setError");
    expect(runs).toContain("new Event(\"parseerror\")");
    expect(prompt).toContain("mountedRef");
    expect(prompt).toContain("if (!mountedRef.current)");
    expect(webPreview).toContain("safeExternalHref(src ?? url)");
    expect(webPreview).toContain("referrerPolicy=\"no-referrer\"");
    expect(webPreview).not.toContain("allow-same-origin");
    expect(`${attachments}\n${prompt}\n${message}`).toContain("safeMediaSrc");
    expect(`${attachments}\n${prompt}\n${message}`).not.toContain("src={data.url}");
    expect(safeUrl).toContain("export function safeMediaSrc");
    expect(image).toContain("SAFE_IMAGE_TYPES");
    expect(image).toContain("safeImageMediaType");
    expect(realtime).toContain("function sameOriginSseUrl");
    expect(realtime).toContain("Cross-origin SSE endpoints are not allowed");
    expect(legacyChat).toContain("mountedRef");
    expect(legacyChat).toContain("if (!mountedRef.current) return;");
    expect(admin).toContain("clipboardClearTimerRef");
    expect(admin).toContain("onClearClipboardLater");
  });

  it("wraps the routed app in a render error boundary", () => {
    const app = read("ui/src/App.tsx");
    const boundary = read("ui/src/app/ErrorBoundary.tsx");
    expect(app).toContain("<ErrorBoundary>");
    expect(boundary).toContain("componentDidCatch");
    expect(boundary).toContain("Try again");
  });

  it("keeps the active message timeline virtualized and accessible", () => {
    const timeline = read("ui/src/features/chat/MessageTimeline.tsx");
    const virtualized = read("ui/src/components/stream-like/VirtualizedMessageList.tsx");
    expect(timeline).toContain("role=\"log\"");
    expect(timeline).toContain("aria-live=\"polite\"");
    expect(virtualized).toContain("useVirtualizer");
    expect(virtualized).toContain("estimateMessageSize");
    expect(virtualized).toContain("const showTyping = Boolean(typing)");
    expect(virtualized).toContain("className=\"flex gap-1\"");
    expect(virtualized).not.toContain("motion-safe:flex gap-1 hidden");
  });

  it("keeps routed pages and section rails out of placeholder mode", () => {
    const routedSources = [
      "ui/src/pages/AgentsPage.tsx",
      "ui/src/pages/InboxPage.tsx",
      "ui/src/pages/FilesPage.tsx",
      "ui/src/pages/TasksPage.tsx",
      "ui/src/pages/AuditPage.tsx",
      "ui/src/pages/SettingsPage.tsx",
      "ui/src/app/SectionSidebar.tsx",
      "ui/src/app/NavBar.tsx",
    ].map(read).join("\n");
    expect(routedSources).not.toMatch(/coming soon/i);
    expect(routedSources).toContain("Intent Inbox");
    expect(routedSources).toContain("<AgentDirectory");
    expect(routedSources).toContain("<VaultBrowser />");
    expect(routedSources).toContain("<MissionsPage />");
    expect(routedSources).toContain("<AuditLog />");
    expect(routedSources).toContain("<SettingsPanel />");
  });

  it("routes enrolled users to the intent inbox by default", () => {
    const routes = read("ui/src/app/routes.tsx");
    const nav = read("ui/src/app/NavBar.tsx");
    const rail = read("ui/src/app/UserRail.tsx");
    const section = read("ui/src/app/SectionContext.tsx");
    expect(routes).toContain("path=\"/inbox\"");
    expect(routes).toContain("to=\"/inbox\"");
    expect(nav).not.toContain("{ id: \"inbox\"");
    expect(rail).toContain("navigate(\"/inbox\")");
    expect(section).toContain("inbox: \"Inbox\"");
  });

  it("defines V1 typed API modules and query hooks for backend integrations", () => {
    const api = read("ui/src/api/client.ts");
    const hooks = read("ui/src/hooks/queries.ts");
    const server = read("src/server.ts");
    for (const expected of [
      "registryAgents",
      "skills",
      "indexedFiles",
      "transfers",
      "a2aTasks",
      "memoryConversations",
      "classifyIntent",
      "policySummary",
      "evaluateCommandPolicy",
      "auditVerify",
    ]) {
      expect(`${api}\n${hooks}`).toContain(expected);
    }
    for (const expected of [
      "\"/memory/conversations\"",
      "\"/intent/classify\"",
      "\"/intent/rewrite\"",
      "\"/policy/summary\"",
      "\"/policy/command/evaluate\"",
    ]) {
      expect(server).toContain(expected);
    }
  });

  it("uses named SSE workflow streams with polling fallback", () => {
    const realtime = read("ui/src/realtime/RealtimeTransport.ts");
    const hooks = read("ui/src/hooks/queries.ts");
    expect(realtime).toContain("SseSubscription");
    expect(realtime).toContain("addEventListener(subscription.eventName");
    expect(hooks).toContain("eventName: \"workflow_event\"");
    expect(hooks).toContain("queryClient.setQueryData");
    expect(realtime).toContain("PollingTransport");
    expect(realtime).not.toContain("return `${origin}/ws`");
  });

  it("adds advanced agentic V1 surfaces without unsupported apply actions", () => {
    const artifact = read("ui/src/components/agentic-ai/ArtifactRenderer.tsx");
    const memory = read("ui/src/components/agentic-ai/MemoryInspector.tsx");
    const graph = read("ui/src/components/agentic-ai/A2AOrchestrationGraph.tsx");
    const inbox = read("ui/src/pages/InboxPage.tsx");
    expect(inbox).toContain("<MemoryInspector />");
    expect(inbox).toContain("<ArtifactRenderer");
    expect(inbox).toContain("<A2AOrchestrationGraph");
    expect(memory).toContain("useMemoryConversations");
    expect(graph).toContain("WorkflowEvent");
    expect(artifact).toContain("/storage/files/");
    expect(artifact).not.toMatch(/Apply/i);
  });

  it("normalizes unsafe or damaged display text before rendering", () => {
    expect(safeDisplayText("hello\u0000 world")).toBe("hello world");
    expect(safeDisplayText("done \u00e2\u20ac\u201d ok \u00e2\u20ac\u00a6")).toBe("done - ok ...");

    const bubble = read("ui/src/components/stream-like/MessageBubble.tsx");
    const chatWindow = read("ui/src/features/chat/ChatWindow.tsx");
    expect(bubble).toContain("safeDisplayText(message.text)");
    expect(bubble).toContain("safeDisplayText(message.status_text)");
    expect(chatWindow).toContain("safeDisplayText(msg.text)");
  });

  it("renders chat text through safe markdown components", () => {
    const rich = read("ui/src/components/stream-like/RichMessageContent.tsx");
    const bubble = read("ui/src/components/stream-like/MessageBubble.tsx");
    expect(rich).toContain("react-markdown");
    expect(rich).toContain("remark-gfm");
    expect(rich).toContain("skipHtml");
    expect(rich).toContain("safeUrlTransform");
    expect(rich).toContain("AgentCodeBlock");
    expect(bubble).toContain("<RichMessageContent text={text} />");
    expect(bubble).not.toContain("<p className=\"whitespace-pre-wrap break-words\">{text}</p>");
  });

  it("persists message reactions with stable message IDs", () => {
    const store = read("ui/src/lib/messageReactions.ts");
    const actions = read("ui/src/components/stream-like/MessageActions.tsx");
    expect(store).toContain("oa-message-reactions-v1");
    expect(store).toContain("useSyncExternalStore");
    expect(actions).toContain("useMessageReactions(messageId)");
    expect(actions).toContain("toggleReaction(id)");
  });

  it("renders relay peer presence and incoming messages without false offline labels", () => {
    const header = read("ui/src/features/chat/ConversationHeader.tsx");
    const listItem = read("ui/src/features/chat/ConversationListItem.tsx");
    const bubble = read("ui/src/components/stream-like/MessageBubble.tsx");
    const hooks = read("ui/src/hooks/queries.ts");
    const mapper = read("ui/src/lib/normalizePeerPresence.ts");
    expect(header).toContain("normalizePeerPresence(conversation)");
    expect(listItem).toContain("normalizePeerPresence(conversation)");
    expect(mapper).toContain("Presence unavailable");
    expect(mapper).toContain("Old agent route - switch to current agent");
    expect(bubble).toContain("direction !== \"incoming\"");
    expect(bubble).toContain("humanMessage.sender_label");
    expect(bubble).toContain("showRetry={isOutgoingHuman}");
    expect(hooks).toContain("queryKeys.contacts");
  });

  it("uses a Discord-inspired user rail without raw agent rows", () => {
    const shell = read("ui/src/app/AppShell.tsx");
    const rail = read("ui/src/app/UserRail.tsx");
    const model = read("ui/src/app/userRailModel.ts");
    expect(shell).toContain("<UserRail />");
    expect(rail).toContain("Badge.Anchor");
    expect(rail).toContain("Search directory");
    expect(model).toContain("buildRailUsers");
    expect(model).toContain("safePersonName");
    expect(model).toContain("My local agent");
    expect(model).toContain("RAW_AGENT_RE");
    expect(model).toContain("directoryByAgentInstanceId");
    expect(model).toContain("peerUserIdForContact");
    expect(rail).toContain("Account profile:");
    expect(rail).toContain("label=\"Settings\"");
  });

  it("wires reply actions to the persistent thread drawer", () => {
    const main = read("ui/src/features/chat/MainChatLayout.tsx");
    const bubble = read("ui/src/components/stream-like/MessageBubble.tsx");
    const drawer = read("ui/src/components/stream-like/ThreadDrawer.tsx");
    const threadStore = read("ui/src/lib/messageThreads.ts");
    expect(main).toContain("oa-reply-to-message");
    expect(main).toContain("<ThreadDrawer");
    expect(bubble).toContain("Reply in thread");
    expect(threadStore).toContain("oa-message-threads-v1");
    expect(drawer).toContain("useMessageThread(subject?.messageId)");
  });

  it("applies glass/depth styling to the active shell surfaces", () => {
    const nav = read("ui/src/app/NavBar.tsx");
    const sidebar = read("ui/src/app/SectionSidebar.tsx");
    const header = read("ui/src/features/chat/ConversationHeader.tsx");
    const command = read("ui/src/components/CommandPalette.tsx");
    expect(nav).toContain("glass-panel-strong");
    expect(sidebar).toContain("glass-panel");
    expect(header).toContain("glass-panel");
    expect(command).toContain("glass-panel-strong");
  });

  it("exposes real transfer card actions without fake downloads", () => {
    const transfer = read("ui/src/components/agentic-ai/TransferProgressMessage.tsx");
    expect(transfer).toContain("Copy SHA-256 hash");
    expect(transfer).toContain("View in Files");
    expect(transfer).toContain("ContextMenu.Root");
    expect(transfer).not.toContain("/download");
  });

  it("protects app routes by cloud enrollment status", () => {
    const routes = read("ui/src/app/routes.tsx");
    const routeShell = read("ui/src/app/RouteShell.tsx");
    const enrollment = read("ui/src/features/enrollment/DeviceEnrollmentScreen.tsx");
    expect(routes).toContain("function RouteGate()");
    expect(routes).toContain("<Route element={<RouteShell />}>");
    expect(routes).toContain("status === \"disconnected\"");
    expect(routes).toContain("to=\"/login\"");
    expect(routes).toContain("status !== \"enrolled\"");
    expect(routes).toContain("hasDeviceAccessToken");
    expect(routes).toContain("data?.tokenIssue === \"expired\"");
    expect(routes).toContain("to=\"/enroll\"");
    expect(routes).toContain("<Route element={<RouteGate />}>");
    expect(routeShell).toContain("overflow-y-auto");
    expect(routeShell).toContain("data-testid=\"auth-route-scroll\"");
    expect(enrollment).toContain("<LogoutButton />");
    expect(enrollment).toContain("sticky bottom-0");
  });

  it("exposes explicit local device identity reset for cross-user enrollment conflicts", () => {
    const api = read("ui/src/api/cloudAuthApi.ts");
    const client = read("ui/src/api/client.ts");
    const hooks = read("ui/src/hooks/queries.ts");
    const enrollment = read("ui/src/features/enrollment/DeviceEnrollmentScreen.tsx");
    const server = read("src/server.ts");
    const identity = read("src/security/DeviceIdentity.ts");
    expect(api).toContain("\"/cloud/device-identity/reset\"");
    expect(client).toContain("resetDeviceIdentity");
    expect(hooks).toContain("export function useResetDeviceIdentity()");
    expect(enrollment).toContain("DEVICE_KEY_OWNED_BY_OTHER_USER");
    expect(enrollment).toContain("Reset local device identity and enroll");
    expect(server).toContain("server.post(\"/cloud/device-identity/reset\"");
    expect(server).toContain("structuredEnrollmentError");
    expect(identity).toContain("export function resetLocalIdentity");
  });

  it("recovers expired device auth across presence, inbox, relay, and transfer paths", () => {
    const recovery = read("src/runtime/CloudTokenRecovery.ts");
    const heartbeat = read("src/runtime/HeartbeatService.ts");
    const inbox = read("src/runtime/InboxPoller.ts");
    const transfers = read("src/runtime/ApprovalTransferOrchestrator.ts");
    const dispatcher = read("src/runtime/RemoteTaskDispatcher.ts");
    const server = read("src/server.ts");
    expect(recovery).toContain("isDeviceTokenExpiredError");
    expect(recovery).toContain("recoverDeviceToken");
    expect(heartbeat).toContain("withRecoveredDeviceToken");
    expect(inbox).toContain("withRecoveredDeviceToken");
    expect(transfers).toContain("withRecoveredDeviceToken");
    expect(dispatcher).toContain("withRecoveredDeviceToken");
    expect(server).toContain("withRecoveredDeviceToken(cloudStore, defaultProfileId()");
    expect(server).toContain("tokenIssue: recovery.tokenIssue");
    expect(server).toContain("canRecoverDeviceToken: recovery.canRecoverDeviceToken");
  });

  it("exposes active-shell logout through a bodyless backend call", () => {
    const api = read("ui/src/api/cloudAuthApi.ts");
    const hooks = read("ui/src/hooks/queries.ts");
    const nav = read("ui/src/app/NavBar.tsx");
    const button = read("ui/src/features/auth/LogoutButton.tsx");
    const service = read("src/enrollment/DeviceEnrollmentService.ts");
    expect(api).toContain("request<{ ok: boolean; remoteRevoked: boolean }>(\"/cloud/logout\", { method: \"POST\" })");
    expect(hooks).toContain("export function useLogout()");
    expect(hooks).toContain("logoutProtectedQueryRoots");
    expect(hooks).toContain("queryClient.setQueryData<CloudStatus | undefined>(queryKeys.cloudStatus, disconnectedCloudStatus)");
    expect(button).toContain("aria-label=\"Log out\"");
    expect(button).toContain("navigate(\"/login\"");
    expect(nav).toContain("<LogoutButton />");
    expect(service).toContain("remoteRevoked");
    expect(service).toContain("this.store.clearTokens(profileId)");
  });

  it("listens for backend agent-run snapshot events", () => {
    const hook = read("ui/src/components/agentic-ai/useAgentRunEvents.ts");
    expect(hook).toContain("addEventListener(\"snapshot\"");
    expect(hook).toContain("queryClient.setQueryData");
  });

  it("keeps queued messages reactive and retries stable client IDs", () => {
    const hooks = read("ui/src/hooks/queries.ts");
    const chatWindow = read("ui/src/features/chat/ChatWindow.tsx");
    expect(hooks).toContain("useSyncExternalStore");
    expect(hooks).toContain("emitQueueChange()");
    expect(hooks).toContain("clientMessageId: msg.clientMessageId");
    expect(hooks).not.toContain("clientMessageId: crypto.randomUUID()");
    expect(chatWindow).toContain("clientMessageId: messageId");
    expect(chatWindow).not.toContain("clientMessageId: crypto.randomUUID()");
  });

  it("makes chat empty-state and new-conversation controls focus directory search", () => {
    const main = read("ui/src/features/chat/MainChatLayout.tsx");
    const rail = read("ui/src/app/UserRail.tsx");
    const directory = read("ui/src/features/chat/DirectorySearch.tsx");
    expect(`${main}\n${rail}`).toContain("oa-focus-directory-search");
    expect(rail).toContain("setSearchOpen(true)");
    expect(directory).toContain("window.addEventListener(\"oa-focus-directory-search\"");
    expect(directory).toContain("inputRef.current?.focus()");
    expect(main).toContain("navigate(\"/approvals\")");
  });

  it("wires Phase 5 competitive features into active routed surfaces", () => {
    const server = read("src/server.ts");
    const command = read("ui/src/components/CommandPalette.tsx");
    const missionTimeline = read("ui/src/features/missions/MissionTimeline.tsx");
    const missionThread = read("ui/src/features/missions/MissionThreadPanel.tsx");
    const consent = read("ui/src/features/approvals/ConsentConsole.tsx");
    const redaction = read("ui/src/features/approvals/RedactionEditor.tsx");
    const biometric = read("ui/src/features/approvals/BiometricApproveButton.tsx");
    const notifications = read("ui/src/components/notifications/NotificationCenter.tsx");
    const settings = read("ui/src/features/settings/SettingsPanel.tsx");
    const vite = read("vite.config.ts");
    const html = read("ui/index.html");

    expect(server).toContain("\"/search/universal\"");
    expect(server).toContain("\"/missions/:missionId/thread\"");
    expect(server).toContain("\"/redactions/preview\"");
    expect(server).toContain("\"/notifications\"");
    expect(server).toContain("\"/policy/rules\"");
    expect(server).toContain("\"/manifest.webmanifest\"");
    expect(command).toContain("useUniversalSearch");
    expect(command).toContain("new Fuse");
    expect(command).toContain("oa-open-notifications");
    expect(missionTimeline).toContain("<MissionThreadPanel");
    expect(missionThread).toContain("useMissionThread");
    expect(consent).toContain("<RedactionEditor");
    expect(consent).toContain("<BiometricApproveButton");
    expect(redaction).toContain("useRedactionPreview");
    expect(redaction).toContain("useApplyRedaction");
    expect(redaction).toContain("page: 1");
    expect(biometric).toContain("useBiometricCapability");
    expect(notifications).toContain("useNotifications");
    expect(settings).toContain("usePolicyRules");
    expect(settings).toContain("Policy Rule Builder");
    expect(settings).toContain("Recent Notification Events");
    expect(vite).toContain("\"/search\"");
    expect(vite).toContain("\"/redactions\"");
    expect(html).toContain("manifest.webmanifest");
  });
});
